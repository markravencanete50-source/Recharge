-- Owner statements, version 2 (WP-E): any period, stays shared by nights, OTA fees and VAT on their own lines.
--
-- 1. A statement covers period_start (included) to period_end (not included), the same half-open range as
--    daterange(period_start, period_end). Earlier statements are backfilled to their month's end and keep the
--    method 'check_in_month' (a stay's money belongs to the period it checks in). The "starts on the 1st"
--    check is dropped. New columns hold gross, OTA fees, the VAT rate and amount, nights booked and
--    available, and the clean charge mode the statement used.
-- 2. private.workspace_statement_compute works a statement out without writing anything. It is the SQL twin
--    of statementFor in lib/statement-maths.ts and must give exactly the same figures:
--    * stays: confirmed stays touching the period. Method 'nights' shares a stay's gross and OTA fee by the
--      nights inside the period, share(x) = floor(x*through/N) - floor(x*before/N), worked exactly in numeric;
--      the payout share is the gross share less the fee share, so the parts of a stay always add up.
--      Method 'check_in_month' counts a stay in full in the period it checks in. Owner stays count nights only.
--      Gross = settled amount + OTA fee; OTA fee = the payout row's fees (itemised, else gross less paid),
--      else 0 and flagged for a platform stay.
--    * a stay whose money is already in a statement of the other method (an old-style monthly statement) is
--      counted for its nights only, so its money is never in two statements.
--    * once an issued or paid statement has counted a stay, later statements take their share of it from the
--      copy stored on that statement, never from the stay as it is now (see the compute function below), so a
--      stay moved, extended or paid differently afterwards is never counted twice and never blocks again.
--    * a split that would lose money is refused: a stay shared by nights on one statement and by check-in on
--      another, or a period that a later statement relies on to count a stay in full.
--    * changeovers: accepted, completed cleans in the period at the agreed value, or at the actual cost when
--      the clean's current review (else the property's mode) says so.
--    * the management fee on the payout after OTA fees, halves rounded away from zero; VAT on the rounded fee.
--    * lines in DEDUCTION_ORDER: OTA fees, changeovers, management fee, VAT, other payables (approved expenses),
--      each category in date order. Payout = gross less every line.
--    * it is blocked while a stay in the period is unsettled, or a clean that cost more than agreed waits for
--      a review on an agreed-fee property.
-- 3. prepareStatement goes to private.workspace_prepare_statement_v2: a month ({period}) or a date range
--    ({from, to}, to not included). A new statement shares stays by nights unless the request says
--    'check_in_month'; preparing a draft again keeps its own method unless the request names another. It
--    refuses a period overlapping another statement for the property, refuses while blocked (a clear message,
--    the reasons in the error detail) and, for the same period, prepares the same draft again (an issued
--    statement must be voided first). issueStatement works the draft out again and refuses if anything changed;
--    voidStatement refuses while a later statement relies on this one to count a stay in full.
-- 4. A stay, payout or clean is locked once an issued or paid statement covers it: any period it overlaps
--    (daterange(period_start, period_end) && daterange(check_in, check_out)), never the whole month a
--    custom period starts in.
--    Bulk approval leaves a stay whose payout lines repeat an amount for a person to check (repeatedAmountSkipped).
-- 5. private.workspace_statement_view is replaced: the period, method, gross, OTA fees, VAT, nights and
--    occupancy. Finance staff see the whole detail; everyone else (owners) gets it without 'internal' (the
--    flags, which can reveal cleaner costs), 'cleanCosts' (each clean's real cost and review note) and
--    'alreadyCounted'.
-- 6. The statements list shows every statement overlapping the month; the finance report 'statementPreview'
--    shows a period's figures, lines and blocking reasons before it is prepared.
--
-- Money is integer pence. Safe to run more than once.

-- 1. Statement periods and figures ---------------------------------------------------------------------------
alter table private.workspace_owner_statements
  add column if not exists period_end date,
  add column if not exists method text not null default 'check_in_month',
  add column if not exists gross_minor bigint,
  add column if not exists ota_fees_minor bigint,
  add column if not exists vat_bps integer not null default 0,
  add column if not exists vat_minor bigint not null default 0,
  add column if not exists nights_booked integer,
  add column if not exists nights_available integer,
  add column if not exists clean_charge_mode text;
update private.workspace_owner_statements set period_end=(period_start+interval '1 month')::date where period_end is null;

-- A statement written without an end (today's monthly statements) ends with its month.
create or replace function private.workspace_statement_period_end() returns trigger language plpgsql set search_path='' as $$
begin
 if new.period_end is null then new.period_end:=(new.period_start+interval '1 month')::date; end if;
 return new;
end $$;
revoke all on function private.workspace_statement_period_end() from public,anon,authenticated;
drop trigger if exists workspace_statement_period_end on private.workspace_owner_statements;
create trigger workspace_statement_period_end before insert or update on private.workspace_owner_statements for each row execute function private.workspace_statement_period_end();
alter table private.workspace_owner_statements alter column period_end set not null;

alter table private.workspace_owner_statements drop constraint if exists workspace_owner_statements_period_start_check;
do $$
declare
 checks constant text[][] := array[
  ['workspace_owner_statements_period_check','check(period_end>period_start and period_end-period_start<=366)'],
  ['workspace_owner_statements_method_check',$q$check(method in ('nights','check_in_month'))$q$],
  ['workspace_owner_statements_vat_check','check(vat_bps between 0 and 10000)'],
  ['workspace_owner_statements_nights_check','check(nights_booked>=0 and nights_available>0)'],
  ['workspace_owner_statements_clean_mode_check',$q$check(clean_charge_mode in ('agreed_fee','actual_cost'))$q$]
 ];
begin
 for i in 1..array_length(checks,1) loop
  if not exists(select 1 from pg_constraint where conrelid='private.workspace_owner_statements'::regclass and conname=checks[i][1]) then
   execute format('alter table private.workspace_owner_statements add constraint %I %s',checks[i][1],checks[i][2]);
  end if;
 end loop;
end $$;
create index if not exists workspace_owner_statements_range_idx on private.workspace_owner_statements(property_id,period_start,period_end) where status<>'void';

-- 2. Statement maths -----------------------------------------------------------------------------------------
-- Floor division, exact for any size (numeric div truncates towards zero; the divisor is positive).
create or replace function private.workspace_floor_div(a numeric,b numeric) returns numeric language sql immutable set search_path='' as $$
 select div(a,b)-case when mod(a,b)<>0 and a<0 then 1 else 0 end;
$$;
-- The share of x for nights before+1..through of a stay of `nights` nights (prorate in lib/statement-maths.ts).
create or replace function private.workspace_prorate(x bigint,before_nights integer,through_nights integer,nights integer) returns bigint language plpgsql immutable set search_path='' as $$
begin
 if nights is null or nights<=0 or before_nights is null or through_nights is null or before_nights<0 or through_nights<before_nights or through_nights>nights then
  raise exception 'Nights before and through must satisfy 0 <= before <= through <= nights' using errcode='22023';
 end if;
 return (private.workspace_floor_div(x::numeric*through_nights,nights)-private.workspace_floor_div(x::numeric*before_nights,nights))::bigint;
end $$;
-- minor x bps / 10000, halves rounded away from zero, exact (percentOfMinor in lib/statement-maths.ts).
create or replace function private.workspace_percent_of_minor(minor bigint,bps integer) returns bigint language sql immutable set search_path='' as $$
 select (div(minor::numeric*bps,10000)+case when abs(mod(minor::numeric*bps,10000))*2>=10000 then sign(minor::numeric*bps) else 0 end)::bigint;
$$;
-- '15%', '12.5%': the rate in a line's label, as `${bps / 100}%` in lib/statement-maths.ts.
create or replace function private.workspace_percent_label(bps integer) returns text language sql immutable set search_path='' as $$
 select trim_scale(bps::numeric/100)::text||'%';
$$;
create or replace function private.workspace_channel_label(channel text) returns text language sql immutable set search_path='' as $$
 select case channel when 'airbnb' then 'Airbnb' when 'booking_com' then 'Booking.com' when 'vrbo' then 'Vrbo' when 'direct' then 'Direct' when 'other' then 'Other' else channel end;
$$;
-- FEE_BASE: the fee is charged on the payout after OTA fees ('payout_after_ota_fees') or on 'gross'. One switch.
create or replace function private.workspace_statement_fee_base() returns text language sql immutable set search_path='' as $$ select 'payout_after_ota_fees'::text $$;
-- STATEMENT_WAITS_FOR_CLEAN_REVIEW: a clean that cost more than agreed waits for a review on an agreed-fee property.
create or replace function private.workspace_statement_waits_for_clean_review() returns boolean language sql immutable set search_path='' as $$ select true $$;
-- An owner's own stay (Hostaway's "ownerstay"): channel 'other', code 'Owner stay'. Nights only, no money.
create or replace function private.workspace_is_owner_stay(r private.workspace_reservations) returns boolean language sql stable set search_path='' as $$
 select r.channel='other' and lower(trim(coalesce(r.channel_reference,'')))='owner stay';
$$;

-- One stay entry of a stored statement (detail.stays[]), read safely: null unless it names a stay. counted and
-- wholeStay default to true (an old-style monthly statement counted every stay it lists, in full). The stored
-- copy of the stay's money: the stay* keys a version 2 statement keeps on every stay it counts, else, for an
-- old-style entry (no counted key), the amount it counted (the settled payout, no OTA fee) and the stay's dates.
create or replace function private.workspace_statement_entry(e jsonb) returns jsonb language sql immutable set search_path='' as $$
 select case when jsonb_typeof(e)='object' and coalesce(e->>'reservationId','')~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
  jsonb_build_object('reservationId',lower(e->>'reservationId'),
   'counted',case when jsonb_typeof(e->'counted')='boolean' then (e->>'counted')::boolean else true end,
   'wholeStay',case when jsonb_typeof(e->'wholeStay')='boolean' then (e->>'wholeStay')::boolean else true end)
  ||case
   when jsonb_typeof(e->'stayGrossMinor')='number' and jsonb_typeof(e->'stayOtaFeeMinor')='number' and jsonb_typeof(e->'staySettledMinor')='number'
    and jsonb_typeof(e->'stayNights')='number' and coalesce(e->>'stayCheckIn','')~'^\d{4}-\d{2}-\d{2}$' and coalesce(e->>'stayCheckOut','')~'^\d{4}-\d{2}-\d{2}$' then
    jsonb_build_object('grossMinor',e->'stayGrossMinor','otaFeeMinor',e->'stayOtaFeeMinor','settledMinor',e->'staySettledMinor','nights',e->'stayNights',
     'checkIn',e->>'stayCheckIn','checkOut',e->>'stayCheckOut')
   when not e ? 'counted' and jsonb_typeof(e->'amountMinor')='number' and coalesce(e->>'checkIn','')~'^\d{4}-\d{2}-\d{2}$' and coalesce(e->>'checkOut','')~'^\d{4}-\d{2}-\d{2}$' then
    jsonb_build_object('grossMinor',e->'amountMinor','otaFeeMinor',0,'settledMinor',e->'amountMinor','nights',to_jsonb((e->>'checkOut')::date-(e->>'checkIn')::date),
     'checkIn',e->>'checkIn','checkOut',e->>'checkOut')
   else '{}'::jsonb end
 end;
$$;

-- One property and one period, worked out without writing anything. Callers check access first.
-- own_statement: the statement being prepared (or checked) again, so its own stays are not "already counted".
--
-- The stored copy (money defects M1 and M2 of the 12 October review). The first issued or paid statement of a
-- method that counts a stay keeps a copy of the stay's money on it: the whole stay's gross, OTA fee, settled
-- amount, nights and dates (stayGrossMinor, stayOtaFeeMinor, staySettledMinor, stayNights, stayCheckIn,
-- stayCheckOut, and wholeStay when this statement took all of it). From then on every statement of that method
-- takes its share of the stay from the copy (prorated over the copy's nights, or in full where the copy's
-- check-in falls by check-in), never from the stay as it is now, and never waits for the stay to settle again.
-- So the parts of a stay across statements always add up to the copy taken at the first issue, however the stay
-- or its payout changes later (moved, extended, cancelled, paid a different amount); a change is flagged
-- (internal) stay_changed_after_statement:<id>, and the money left over shows in lateMoneyAfterStatement.
-- The copy belongs to the property of the statement that holds it: a stay moved to another property counts
-- there for its nights only. Drafts never hold a copy for others (issueStatement checks a draft again).
--
-- Splits that would lose money block the statement (defects M3 and M7):
--  * stay_method_conflict: a statement of the other method put part of the stay on by nights, or (by nights)
--    part of the stay would be taken while a statement counted by check-in covers its other nights.
--  * stay_relied_on: another live statement left the stay to a statement of the other method counting it in
--    full (its alreadyCounted), and after this one nothing would.
create or replace function private.workspace_statement_compute(prop uuid,from_on date,to_on date,statement_method text,own_statement uuid default null) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare
 f private.workspace_property_financials;mode text;vat_on boolean;vat_rate integer;whole boolean;
 r private.workspace_reservations;pr jsonb;n integer;nip integer;bef integer;thr integer;in_money boolean;is_owner boolean;live boolean;
 settled bigint;fee bigint;gross bigint;share_gross bigint;share_fee bigint;took boolean;full_share boolean;
 ids uuid[];own_ids uuid[];id_texts text[];held jsonb;relying jsonb;b jsonb;b_here boolean;w_in date;w_out date;w_n integer;
 stay_gross bigint;stay_fee bigint;stay_settled bigint;other_full boolean;other_part boolean;entry jsonb;listed uuid[]:='{}';rid uuid;
 c record;st jsonb;agreed bigint;actual bigint;reviewed boolean;flagged boolean;basis text;charge bigint;
 x private.workspace_expenses;
 flags jsonb:='[]';blocked jsonb:='[]';stays jsonb:='[]';ota_lines jsonb:='[]';clean_lines jsonb:='[]';payable_lines jsonb:='[]';vat_lines jsonb:='[]';fee_lines jsonb;
 cleans jsonb:='[]';expenses jsonb:='[]';already jsonb:='[]';
 gross_total bigint:=0;ota_total bigint:=0;clean_total bigint:=0;clean_count integer:=0;pay_total bigint:=0;booked integer:=0;available integer;
 base bigint;fee_minor bigint;vat_minor bigint;
begin
 if statement_method is null or statement_method not in ('nights','check_in_month') then raise exception 'Choose how stays are counted: by nights or by check-in' using errcode='22023';end if;
 if from_on is null or to_on is null or to_on<=from_on then raise exception 'The period must end after it starts' using errcode='22023';end if;
 if to_on-from_on>366 then raise exception 'Choose a period of up to a year' using errcode='22023';end if;
 select * into f from private.workspace_property_financials where property_id=prop;
 if f.management_fee_bps is null or f.cleaning_cost_minor is null then raise exception 'Set the management fee and cleaning cost from the agreement first' using errcode='22023';end if;
 mode:=coalesce(f.clean_charge_mode,'agreed_fee');vat_on:=coalesce(f.vat_on_fee,false);vat_rate:=private.workspace_vat_bps();
 available:=to_on-from_on;whole:=statement_method='check_in_month';

 -- The stays: confirmed stays of the property touching the period, and stays whose stored copy (on an issued or
 -- paid statement of this property and method) shares money into it, whatever has happened to them since.
 ids:=array(
  select y.id from private.workspace_reservations y where y.property_id=prop and y.status='confirmed' and y.check_in<to_on and y.check_out>from_on
  union
  select (q.v->>'reservationId')::uuid from private.workspace_owner_statements o
   cross join lateral jsonb_array_elements(case when jsonb_typeof(o.detail->'stays')='array' then o.detail->'stays' else '[]'::jsonb end) e
   cross join lateral (select private.workspace_statement_entry(e) v) q
   where o.property_id=prop and o.status in ('issued','paid') and o.method=statement_method and o.id is distinct from own_statement
    and (q.v->>'counted')::boolean and q.v ? 'grossMinor' and (q.v->>'checkIn')::date<to_on and (q.v->>'checkOut')::date>from_on);
 -- The stays this statement counted before it is worked out again (another statement may rely on them).
 own_ids:=array(select distinct (q.v->>'reservationId')::uuid from private.workspace_owner_statements o
   cross join lateral jsonb_array_elements(case when jsonb_typeof(o.detail->'stays')='array' then o.detail->'stays' else '[]'::jsonb end) e
   cross join lateral (select private.workspace_statement_entry(e) v) q
   where o.id=own_statement and (q.v->>'counted')::boolean);
 id_texts:=array(select u::text from unnest(ids||own_ids) u);
 -- What every other live statement (of any property) did with those stays, first issued first.
 held:=coalesce((select jsonb_agg(jsonb_build_object('statementId',o.id,'propertyId',o.property_id,'method',o.method,'issued',o.status in ('issued','paid'))||q.v
   order by o.issued_at nulls last,o.period_start,o.id)
  from private.workspace_owner_statements o
  cross join lateral jsonb_array_elements(case when jsonb_typeof(o.detail->'stays')='array' then o.detail->'stays' else '[]'::jsonb end) e
  cross join lateral (select private.workspace_statement_entry(e) v) q
  where o.status<>'void' and o.id is distinct from own_statement and q.v->>'reservationId'=any(id_texts)),'[]'::jsonb);
 -- Live statements that left one of those stays to a statement of the other method (their alreadyCounted).
 relying:=coalesce((select jsonb_agg(jsonb_build_object('statementId',o.id,'method',o.method,'reservationId',lower(a)))
  from private.workspace_owner_statements o
  cross join lateral jsonb_array_elements_text(case when jsonb_typeof(o.detail->'alreadyCounted')='array' then o.detail->'alreadyCounted' else '[]'::jsonb end) a
  where o.status<>'void' and o.id is distinct from own_statement and lower(a)=any(id_texts)),'[]'::jsonb);

 -- Stays, in check-in order (then id): nights inside the period, and the money share by the method.
 for r in select * from private.workspace_reservations y where y.id=any(ids) order by y.check_in,y.id loop
  n:=r.check_out-r.check_in;
  live:=r.property_id=prop and r.status='confirmed';
  nip:=case when live then greatest(0,least(r.check_out,to_on)-greatest(r.check_in,from_on)) else 0 end;
  booked:=booked+nip;
  is_owner:=private.workspace_is_owner_stay(r);
  -- The stored copy: the first issued or paid statement of this method that counted the stay.
  b:=(select h.v from jsonb_array_elements(held) with ordinality h(v,k)
   where h.v->>'reservationId'=r.id::text and (h.v->>'issued')::boolean and h.v->>'method'=statement_method and (h.v->>'counted')::boolean and h.v ? 'grossMinor'
   order by h.k limit 1);
  b_here:=b is not null and (b->>'propertyId')::uuid=prop;
  -- The money window: the copy's dates and nights once a copy holds the stay, else the stay's own.
  if b_here then w_in:=(b->>'checkIn')::date;w_out:=(b->>'checkOut')::date;w_n:=(b->>'nights')::integer;
  else w_in:=r.check_in;w_out:=r.check_out;w_n:=n;end if;
  bef:=case when whole then 0 else least(greatest(from_on-w_in,0),w_n) end;
  thr:=case when whole then w_n else least(greatest(to_on-w_in,0),w_n) end;
  in_money:=case when whole then w_in>=from_on and w_in<to_on else thr>bef end;
  full_share:=whole or (bef=0 and thr=w_n);
  -- Money already on a statement of the other method: in full (counted, nights only here), or part of it by nights.
  other_full:=exists(select 1 from jsonb_array_elements(held) h where h->>'reservationId'=r.id::text and h->>'method'<>statement_method and (h->>'counted')::boolean and (h->>'wholeStay')::boolean);
  other_part:=exists(select 1 from jsonb_array_elements(held) h where h->>'reservationId'=r.id::text and h->>'method'<>statement_method and (h->>'counted')::boolean and not (h->>'wholeStay')::boolean);
  if r.channel in ('airbnb','booking_com','vrbo') then
   pr:=private.workspace_payout_row(r);settled:=(pr->>'settledMinor')::bigint;fee:=(pr->>'otaFeesMinor')::bigint;
  else settled:=r.payout_minor;fee:=null;
  end if;
  if is_owner and settled is not null and settled<>0 then flags:=flags||to_jsonb('owner_stay_amount_ignored:'||r.id);end if;
  share_gross:=0;share_fee:=0;took:=false;stay_gross:=null;stay_fee:=null;stay_settled:=null;
  if other_part then blocked:=blocked||to_jsonb('stay_method_conflict:'||r.id);
  elsif other_full and in_money and not (is_owner and b is null) then already:=already||to_jsonb(r.id::text);
  elsif b is not null then
   -- From the stored copy, never from the stay as it is now.
   if b_here and in_money then
    stay_gross:=(b->>'grossMinor')::bigint;stay_fee:=(b->>'otaFeeMinor')::bigint;stay_settled:=(b->>'settledMinor')::bigint;
    if full_share then share_gross:=stay_gross;share_fee:=stay_fee;
    else share_gross:=private.workspace_prorate(stay_gross,bef,thr,w_n);share_fee:=private.workspace_prorate(stay_fee,bef,thr,w_n);
    end if;
    took:=true;
   end if;
   if not b_here or not live or r.check_in<>(b->>'checkIn')::date or r.check_out<>(b->>'checkOut')::date
    or settled is distinct from (b->>'settledMinor')::bigint or (settled is not null and coalesce(fee,0)<>(b->>'otaFeeMinor')::bigint) then
    flags:=flags||to_jsonb('stay_changed_after_statement:'||r.id);
   end if;
  elsif in_money and not is_owner then
   if settled is null then blocked:=blocked||to_jsonb('stay_unsettled:'||r.id);
   else
    if fee is null then
     fee:=0;
     if r.channel in ('airbnb','booking_com','vrbo') then flags:=flags||to_jsonb('ota_fee_unknown:'||r.id);end if;
    end if;
    gross:=settled+fee;
    if full_share then share_gross:=gross;share_fee:=fee;
    else share_gross:=private.workspace_prorate(gross,bef,thr,w_n);share_fee:=private.workspace_prorate(fee,bef,thr,w_n);
    end if;
    stay_gross:=gross;stay_fee:=fee;stay_settled:=settled;
    took:=true;
   end if;
  end if;
  -- By nights, part of a stay whose other nights sit on a statement counted by check-in would never be paid.
  if statement_method='nights' and took and not full_share and exists(select 1 from private.workspace_owner_statements o where o.property_id=prop and o.status<>'void'
    and o.id is distinct from own_statement and o.method='check_in_month' and daterange(o.period_start,o.period_end) && daterange(w_in,w_out)) then
   blocked:=blocked||to_jsonb('stay_method_conflict:'||r.id);
  end if;
  -- A statement that left the stay to one of the other method counting it in full must still have one.
  if exists(select 1 from jsonb_array_elements(relying) q where q->>'reservationId'=r.id::text
    and not ((statement_method<>q->>'method' and took and full_share)
     or exists(select 1 from jsonb_array_elements(held) h where h->>'reservationId'=r.id::text and h->>'statementId'<>q->>'statementId'
      and h->>'method'<>q->>'method' and (h->>'counted')::boolean and (h->>'wholeStay')::boolean))) then
   blocked:=blocked||to_jsonb('stay_relied_on:'||r.id);
  end if;
  gross_total:=gross_total+share_gross;
  if share_fee<>0 then
   ota_lines:=ota_lines||jsonb_build_array(jsonb_build_object('kind','ota_fee','date',r.check_in,'label',private.workspace_channel_label(r.channel)||' fees','amountMinor',share_fee,'refId',r.id));
   ota_total:=ota_total+share_fee;
  end if;
  entry:=jsonb_build_object('reservationId',r.id,'reference',r.reference,'channel',r.channel,'channelReference',r.channel_reference,
   'checkIn',r.check_in,'checkOut',r.check_out,'guests',r.guests,'nights',n,'nightsInPeriod',nip,'ownerStay',is_owner,'counted',took,
   'grossMinor',share_gross,'otaFeeMinor',share_fee,'payoutMinor',share_gross-share_fee,'amountMinor',share_gross-share_fee);
  -- The copy of the whole stay's money this share was taken from (carried on unchanged from the first copy).
  if took then
   entry:=entry||jsonb_build_object('stayGrossMinor',stay_gross,'stayOtaFeeMinor',stay_fee,'staySettledMinor',stay_settled,'stayNights',w_n,
    'stayCheckIn',w_in,'stayCheckOut',w_out,'wholeStay',full_share);
  end if;
  stays:=stays||jsonb_build_array(entry);
  listed:=listed||r.id;
 end loop;
 if booked>available then flags:=flags||to_jsonb('nights_exceed_period'::text);end if;
 -- A stay this statement used to count in full, no longer in its period, that another statement still relies on.
 for rid in select y from unnest(own_ids) y where not y=any(listed) order by y::text loop
  if exists(select 1 from jsonb_array_elements(relying) q where q->>'reservationId'=rid::text
    and not exists(select 1 from jsonb_array_elements(held) h where h->>'reservationId'=rid::text and h->>'statementId'<>q->>'statementId'
     and h->>'method'<>q->>'method' and (h->>'counted')::boolean and (h->>'wholeStay')::boolean)) then
   blocked:=blocked||to_jsonb('stay_relied_on:'||rid);
  end if;
 end loop;

 -- Changeovers: billable cleans in the period, in date order (then id).
 for c in select w.id,w.due_on from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
  where w.property_id=prop and d.kind='cleaning' and d.data->>'phase'='accepted' and w.status='completed' and w.due_on>=from_on and w.due_on<to_on order by w.due_on,w.id loop
  agreed:=f.cleaning_cost_minor;
  st:=private.workspace_clean_review_state(c.id);
  actual:=(st->>'actualMinor')::bigint;reviewed:=coalesce((st->>'reviewed')::boolean,false);
  flagged:=actual is not null and actual>agreed;
  if flagged then
   flags:=flags||to_jsonb('clean_over_agreed:'||c.id);
   if private.workspace_statement_waits_for_clean_review() and not reviewed and mode='agreed_fee' then blocked:=blocked||to_jsonb('clean_unreviewed:'||c.id);end if;
  end if;
  basis:=case when reviewed then st->>'decision' else mode end;
  charge:=agreed;
  if basis='actual_cost' then
   if actual is null then flags:=flags||to_jsonb('clean_cost_unknown:'||c.id);else charge:=actual;end if;
  end if;
  clean_lines:=clean_lines||jsonb_build_array(jsonb_build_object('kind','changeover','date',c.due_on,'label','Changeover clean','amountMinor',charge,'refId',c.id));
  clean_total:=clean_total+charge;clean_count:=clean_count+1;
  cleans:=cleans||jsonb_build_array(jsonb_build_object('workId',c.id,'cleanDate',c.due_on,'agreedMinor',agreed,'actualMinor',actual,'costSource',st->>'costSource',
   'flagged',flagged,'reviewed',reviewed,'state',st->>'state','decision',st->>'decision','note',st->>'note',
   'basis',basis,'chargedMinor',charge));
 end loop;

 -- Other payables: approved expenses received in the period, in date order (then id).
 for x in select * from private.workspace_expenses e where e.property_id=prop and e.status='approved' and e.received_on>=from_on and e.received_on<to_on order by e.received_on,e.id loop
  payable_lines:=payable_lines||jsonb_build_array(jsonb_build_object('kind','payable','date',x.received_on,'label',x.description,'amountMinor',x.amount_minor,'refId',x.id));
  pay_total:=pay_total+x.amount_minor;
  expenses:=expenses||jsonb_build_array(jsonb_build_object('expenseId',x.id,'supplier',x.supplier,'reference',x.reference,'category',x.category,'description',x.description,'amountMinor',x.amount_minor,'receivedOn',x.received_on));
 end loop;

 base:=case private.workspace_statement_fee_base() when 'gross' then gross_total else gross_total-ota_total end;
 fee_minor:=private.workspace_percent_of_minor(base,f.management_fee_bps);
 vat_minor:=case when vat_on then private.workspace_percent_of_minor(fee_minor,vat_rate) else 0 end;
 fee_lines:=jsonb_build_array(jsonb_build_object('kind','management_fee','date',from_on,'label','Management fee ('||private.workspace_percent_label(f.management_fee_bps)||')','amountMinor',fee_minor,'refId',null));
 if vat_on then vat_lines:=jsonb_build_array(jsonb_build_object('kind','vat','date',from_on,'label','VAT on the management fee ('||private.workspace_percent_label(vat_rate)||')','amountMinor',vat_minor,'refId',null));end if;

 return jsonb_build_object('periodStart',from_on,'periodEnd',to_on,'method',statement_method,
  'terms',jsonb_build_object('managementFeeBps',f.management_fee_bps,'cleaningCostMinor',f.cleaning_cost_minor,'vatOnFee',vat_on,'vatRateBps',case when vat_on then vat_rate else 0 end,
   'cleanChargeMode',mode,'feeBase',private.workspace_statement_fee_base()),
  'lines',ota_lines||clean_lines||fee_lines||vat_lines||payable_lines,'stays',stays,'expenses',expenses,'cleans',cleans,'alreadyCounted',already,
  'grossMinor',gross_total,'otaFeesMinor',ota_total,'revenueMinor',gross_total-ota_total,'changeoversMinor',clean_total,'cleaningCount',clean_count,
  'feeBaseMinor',base,'feeMinor',fee_minor,'vatMinor',vat_minor,'payablesMinor',pay_total,
  'payoutMinor',gross_total-ota_total-clean_total-fee_minor-vat_minor-pay_total,
  'nightsBooked',booked,'nightsAvailable',available,'flags',flags,'blocked',jsonb_array_length(blocked)>0,'blockedReasons',blocked);
end $$;

-- A date sent by the statements screen: YYYY-MM-DD and a real day.
create or replace function private.workspace_statement_date(input jsonb,k text) returns date language plpgsql immutable set search_path='' as $$
declare d date;
begin
 if jsonb_typeof(input->k) is distinct from 'string' or input->>k!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Choose the statement dates' using errcode='22023';end if;
 begin d:=(input->>k)::date; exception when others then raise exception 'Choose the statement dates' using errcode='22023'; end;
 if to_char(d,'YYYY-MM-DD')<>input->>k or d<'2000-01-01'::date or d>'2100-12-31'::date then raise exception 'Choose the statement dates' using errcode='22023';end if;
 return d;
end $$;

-- 3. Preparing a statement. Called by workspace_finance_action after its access and receipt checks.
create or replace function private.workspace_prepare_statement_v2(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare prop uuid:=(input->>'propertyId')::uuid;from_on date;to_on date;statement_method text;asked_method text;s private.workspace_owner_statements;c jsonb;statement_detail jsonb;
 unsettled integer;unreviewed integer;relied integer;conflicts integer;
begin
 perform private.workspace_json_keys(input,array['action','requestId','propertyId','period','from','to','method']);
 if input ? 'period' then
  if input ? 'from' or input ? 'to' then raise exception 'Choose a month or dates, not both' using errcode='22023';end if;
  from_on:=private.workspace_period(input->>'period');to_on:=(from_on+interval '1 month')::date;
  if from_on>date_trunc('month',current_date)::date then raise exception 'Statements cover a month that has started' using errcode='22023';end if;
 elsif input ? 'from' and input ? 'to' then
  -- `to` is the first day not included, as daterange(from, to).
  from_on:=private.workspace_statement_date(input,'from');to_on:=private.workspace_statement_date(input,'to');
  if to_on<=from_on then raise exception 'The period must end after it starts' using errcode='22023';end if;
  if from_on>current_date then raise exception 'Statements cover a period that has started' using errcode='22023';end if;
 else raise exception 'Choose a month or dates' using errcode='22023';
 end if;
 if input ? 'method' and jsonb_typeof(input->'method')<>'null' then
  if coalesce(input->>'method','') not in ('nights','check_in_month') then raise exception 'Choose how stays are counted: by nights or by check-in' using errcode='22023';end if;
  asked_method:=input->>'method';
 end if;
 -- One statement change per property at a time, so the overlap check is exact.
 perform pg_advisory_xact_lock(hashtextextended('workspace_owner_statement:'||prop::text,77));
 select * into s from private.workspace_owner_statements where property_id=prop and status<>'void' and period_start=from_on and period_end=to_on for update;
 if found and s.status<>'draft' then raise exception 'This statement has been issued. Void it before preparing again' using errcode='42501';end if;
 -- Preparing a draft again keeps the method it was prepared with (an old monthly draft counts stays by check-in)
 -- unless the request asks for another one; a new statement shares stays by nights unless asked otherwise.
 statement_method:=coalesce(asked_method,s.method,'nights');
 if exists(select 1 from private.workspace_owner_statements o where o.property_id=prop and o.status<>'void' and o.id is distinct from s.id
   and daterange(o.period_start,o.period_end) && daterange(from_on,to_on)) then
  raise exception 'Another statement already covers part of these dates. Void it or choose other dates' using errcode='22023';
 end if;
 c:=private.workspace_statement_compute(prop,from_on,to_on,statement_method,s.id);
 if (c->>'blocked')::boolean then
  unsettled:=(select count(*) from jsonb_array_elements_text(c->'blockedReasons') b where b like 'stay\_unsettled:%');
  unreviewed:=(select count(*) from jsonb_array_elements_text(c->'blockedReasons') b where b like 'clean\_unreviewed:%');
  relied:=(select count(*) from jsonb_array_elements_text(c->'blockedReasons') b where b like 'stay\_relied\_on:%');
  conflicts:=(select count(*) from jsonb_array_elements_text(c->'blockedReasons') b where b like 'stay\_method\_conflict:%');
  -- A split that would lose money comes first: no amount of reconciling fixes it.
  raise exception '%',case
    when relied>0 then 'A statement prepared later leaves a stay to this period to count in full. Void the later statement first'
    when conflicts>0 then 'A stay in this period is on another statement counted the other way (by nights or by check-in). Prepare this period the same way, or void that statement first'
    when unsettled>0 and unreviewed>0 then 'Reconcile every stay in the period and review the cleans that cost more than agreed first'
    when unsettled>0 then 'Reconcile every stay in the period first' else 'Review the cleans that cost more than agreed first' end
   using errcode='22023',detail=(c->'blockedReasons')::text;
 end if;
 -- Owners read everything here except 'internal' (the flags), 'cleanCosts' (what each clean really cost, and
 -- the review notes) and 'alreadyCounted'. See private.workspace_statement_view.
 statement_detail:=jsonb_build_object('stays',c->'stays','expenses',c->'expenses','cleaningCostMinor',c->'terms'->'cleaningCostMinor','lines',c->'lines',
  'feeBaseMinor',c->'feeBaseMinor','feeBase',c->'terms'->'feeBase','internal',c->'flags','cleanCosts',c->'cleans','alreadyCounted',c->'alreadyCounted');
 if s.id is null then
  insert into private.workspace_owner_statements(property_id,period_start,period_end,method,revenue_minor,cleaning_count,cleaning_minor,expenses_minor,fee_bps,fee_minor,payout_minor,detail,prepared_by,
   gross_minor,ota_fees_minor,vat_bps,vat_minor,nights_booked,nights_available,clean_charge_mode)
  values(prop,from_on,to_on,statement_method,(c->>'revenueMinor')::bigint,(c->>'cleaningCount')::integer,(c->>'changeoversMinor')::bigint,(c->>'payablesMinor')::bigint,
   (c->'terms'->>'managementFeeBps')::integer,(c->>'feeMinor')::bigint,(c->>'payoutMinor')::bigint,statement_detail,auth.uid(),
   (c->>'grossMinor')::bigint,(c->>'otaFeesMinor')::bigint,(c->'terms'->>'vatRateBps')::integer,(c->>'vatMinor')::bigint,(c->>'nightsBooked')::integer,(c->>'nightsAvailable')::integer,c->'terms'->>'cleanChargeMode')
  returning * into s;
 else
  update private.workspace_owner_statements set method=statement_method,revenue_minor=(c->>'revenueMinor')::bigint,cleaning_count=(c->>'cleaningCount')::integer,
   cleaning_minor=(c->>'changeoversMinor')::bigint,expenses_minor=(c->>'payablesMinor')::bigint,fee_bps=(c->'terms'->>'managementFeeBps')::integer,fee_minor=(c->>'feeMinor')::bigint,
   payout_minor=(c->>'payoutMinor')::bigint,detail=statement_detail,gross_minor=(c->>'grossMinor')::bigint,ota_fees_minor=(c->>'otaFeesMinor')::bigint,vat_bps=(c->'terms'->>'vatRateBps')::integer,
   vat_minor=(c->>'vatMinor')::bigint,nights_booked=(c->>'nightsBooked')::integer,nights_available=(c->>'nightsAvailable')::integer,clean_charge_mode=c->'terms'->>'cleanChargeMode',
   prepared_by=auth.uid(),version=version+1,updated_at=now() where id=s.id returning * into s;
 end if;
 insert into public.workspace_activity(actor_id,property_id,event_type) values(auth.uid(),prop,'finance.statement_prepared');
 return private.workspace_statement_view(s);
end $$;

-- 4. A clean is locked by private.workspace_statement_day_locked (20261012090000), which reads period_end
-- once it exists; stays and payouts by private.workspace_payout_stay_locked (20261012080000), see 7.

-- 5. The statement as the screens read it. Nobody has patched this function, so it is replaced whole (the
-- first part copied from its latest definition). Only finance staff see the internal parts of the detail.
create or replace function private.workspace_statement_view(s private.workspace_owner_statements) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',s.id,'propertyId',s.property_id,'propertyName',p.name,'period',to_char(s.period_start,'YYYY-MM'),'status',s.status,
  'revenueMinor',s.revenue_minor,'cleaningCount',s.cleaning_count,'cleaningMinor',s.cleaning_minor,'expensesMinor',s.expenses_minor,
  'feeBps',s.fee_bps,'feeMinor',s.fee_minor,'payoutMinor',s.payout_minor,
  'detail',case when private.workspace_finance_role() then s.detail else s.detail-'internal'-'cleanCosts'-'alreadyCounted' end,
  'payoutMethod',s.payout_method,'payoutReference',s.payout_reference,'paidAt',s.paid_at,'issuedAt',s.issued_at,'version',s.version,'updatedAt',s.updated_at)
  ||jsonb_build_object('periodStart',s.period_start,'periodEnd',s.period_end,'periodLastDay',s.period_end-1,'method',s.method,
  'grossMinor',s.gross_minor,'otaFeesMinor',s.ota_fees_minor,'vatRateBps',s.vat_bps,'vatMinor',s.vat_minor,
  'nightsBooked',s.nights_booked,'nightsAvailable',s.nights_available,
  'occupancyBps',case when s.nights_booked is not null and s.nights_available>0 then round(s.nights_booked*10000.0/s.nights_available)::integer end,
  'cleanChargeMode',s.clean_charge_mode)
 from public.workspace_properties p where p.id=s.property_id;
$$;

-- 6. 'statementPreview' (through public.workspace_finance_report): one property, from_on to to_on (to_on not
-- included, as prepareStatement), filters {method}. The figures, lines and reasons it would be blocked. Without a
-- method it uses the one prepareStatement would: the method of the statement already held for these dates, else
-- nights, so the figures checked are the figures prepared.
-- lateMoneyAfterStatement (internal, defect X3): the property's stays whose money has changed since an issued or
-- paid statement stored its copy (a later adjustment line, a resolution payout, a payout that arrived different
-- after it was approved, a direct stay's amount changed): the payout row's settled amount now differs from the
-- copy's. That money is on no statement; nothing moves it onto one yet. workspace_payout_row already shows the
-- difference (state 'different' with receivedMinor against expectedMinor). lateMoneyAfterStatementCount counts them.
create or replace function private.workspace_report_statement_preview(target_property uuid,target_id uuid,from_on date,to_on date,filters jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare statement_method text;own private.workspace_owner_statements;late jsonb;
begin
 if target_property is null then raise exception 'Choose a property' using errcode='22023';end if;
 if from_on is null or to_on is null then raise exception 'Choose the statement dates' using errcode='22023';end if;
 if jsonb_typeof(filters)='object' then
  if exists(select 1 from jsonb_object_keys(filters) k where k not in ('method')) then raise exception 'Invalid report filters' using errcode='22023';end if;
  statement_method:=filters->>'method';
 end if;
 select * into own from private.workspace_owner_statements o where o.property_id=target_property and o.status<>'void' and o.period_start=from_on and o.period_end=to_on limit 1;
 statement_method:=coalesce(statement_method,own.method,'nights');
 late:=coalesce((select jsonb_agg(distinct q.v->>'reservationId') from private.workspace_owner_statements o
   cross join lateral jsonb_array_elements(case when jsonb_typeof(o.detail->'stays')='array' then o.detail->'stays' else '[]'::jsonb end) e
   cross join lateral (select private.workspace_statement_entry(e) v) q
   join private.workspace_reservations r on r.id::text=q.v->>'reservationId'
   where o.property_id=target_property and o.status in ('issued','paid') and (q.v->>'counted')::boolean and q.v ? 'settledMinor'
    and (case when r.channel in ('airbnb','booking_com','vrbo') then (private.workspace_payout_row(r)->>'settledMinor')::bigint else r.payout_minor end)
     is distinct from (q.v->>'settledMinor')::bigint),'[]'::jsonb);
 return private.workspace_statement_compute(target_property,from_on,to_on,statement_method,own.id)||jsonb_build_object('section','statementPreview','propertyId',target_property,
  'statements',(select coalesce(jsonb_agg(private.workspace_statement_view(o) order by o.period_start,o.id),'[]'::jsonb) from private.workspace_owner_statements o
   where o.property_id=target_property and o.status<>'void' and daterange(o.period_start,o.period_end) && daterange(from_on,to_on)),
  'lateMoneyAfterStatement',late,'lateMoneyAfterStatementCount',jsonb_array_length(late));
end $$;

-- Issuing checks the draft again (defect X1): the same compute must still give the same figures, line by line and
-- stay by stay (the shares and the stored copies a later statement will take its share from), and must not be
-- blocked. Otherwise the statement has to be prepared again first.
create or replace function private.workspace_statement_money(d jsonb) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object(
  'stays',coalesce((select jsonb_agg(jsonb_build_array(e->>'reservationId',e->'counted',e->'nightsInPeriod',e->'grossMinor',e->'otaFeeMinor',e->'stayGrossMinor',e->'stayOtaFeeMinor',
     e->'staySettledMinor',e->'stayNights',e->>'stayCheckIn',e->>'stayCheckOut',e->'wholeStay') order by e->>'reservationId')
   from jsonb_array_elements(case when jsonb_typeof(d->'stays')='array' then d->'stays' else '[]'::jsonb end) e),'[]'::jsonb),
  'lines',coalesce((select jsonb_agg(jsonb_build_array(l->>'kind',l->>'refId',l->'amountMinor') order by k)
   from jsonb_array_elements(case when jsonb_typeof(d->'lines')='array' then d->'lines' else '[]'::jsonb end) with ordinality t(l,k)),'[]'::jsonb),
  'alreadyCounted',coalesce(d->'alreadyCounted','[]'::jsonb));
$$;
create or replace function private.workspace_statement_issue_check(s private.workspace_owner_statements) returns void language plpgsql stable security definer set search_path='' as $$
declare c jsonb;
begin
 c:=private.workspace_statement_compute(s.property_id,s.period_start,s.period_end,s.method,s.id);
 if (c->>'blocked')::boolean
  or (s.gross_minor,s.ota_fees_minor,s.revenue_minor,s.cleaning_count,s.cleaning_minor,s.expenses_minor,s.fee_bps,s.fee_minor,s.vat_bps,s.vat_minor,s.payout_minor,s.nights_booked,s.nights_available)
   is distinct from ((c->>'grossMinor')::bigint,(c->>'otaFeesMinor')::bigint,(c->>'revenueMinor')::bigint,(c->>'cleaningCount')::integer,(c->>'changeoversMinor')::bigint,(c->>'payablesMinor')::bigint,
    (c->'terms'->>'managementFeeBps')::integer,(c->>'feeMinor')::bigint,(c->'terms'->>'vatRateBps')::integer,(c->>'vatMinor')::bigint,(c->>'payoutMinor')::bigint,(c->>'nightsBooked')::integer,(c->>'nightsAvailable')::integer)
  or private.workspace_statement_money(s.detail)<>private.workspace_statement_money(c) then
  raise exception 'Figures changed, prepare the statement again' using errcode='22023',detail=(c->'blockedReasons')::text;
 end if;
end $$;
-- Voiding a statement that another live statement relies on to count a stay in full (its alreadyCounted) would
-- leave that stay's money on no statement (defect M3): the later statement has to be voided first, unless a third
-- statement still counts the stay in full the other way.
create or replace function private.workspace_statement_void_check(s private.workspace_owner_statements) returns void language plpgsql stable security definer set search_path='' as $$
begin
 if exists(select 1 from private.workspace_owner_statements n
   cross join lateral jsonb_array_elements_text(case when jsonb_typeof(n.detail->'alreadyCounted')='array' then n.detail->'alreadyCounted' else '[]'::jsonb end) a
   cross join lateral jsonb_array_elements(case when jsonb_typeof(s.detail->'stays')='array' then s.detail->'stays' else '[]'::jsonb end) e
   cross join lateral (select private.workspace_statement_entry(e) v) q
   where n.status<>'void' and n.id<>s.id and n.method<>s.method and lower(a)=q.v->>'reservationId' and (q.v->>'counted')::boolean and (q.v->>'wholeStay')::boolean
    and not exists(select 1 from private.workspace_owner_statements w
     cross join lateral jsonb_array_elements(case when jsonb_typeof(w.detail->'stays')='array' then w.detail->'stays' else '[]'::jsonb end) e2
     cross join lateral (select private.workspace_statement_entry(e2) v) q2
     where w.status<>'void' and w.id<>s.id and w.id<>n.id and w.method<>n.method and q2.v->>'reservationId'=q.v->>'reservationId'
      and (q2.v->>'counted')::boolean and (q2.v->>'wholeStay')::boolean)) then
  raise exception 'A statement prepared later leaves a stay to this one to count in full. Void the later statement first' using errcode='22023';
 end if;
end $$;

revoke all on function private.workspace_floor_div(numeric,numeric),private.workspace_prorate(bigint,integer,integer,integer),private.workspace_percent_of_minor(bigint,integer),
 private.workspace_percent_label(integer),private.workspace_channel_label(text),private.workspace_statement_fee_base(),private.workspace_statement_waits_for_clean_review(),
 private.workspace_is_owner_stay(private.workspace_reservations),private.workspace_statement_compute(uuid,date,date,text,uuid),private.workspace_statement_date(jsonb,text),
 private.workspace_prepare_statement_v2(jsonb),private.workspace_statement_view(private.workspace_owner_statements),
 private.workspace_report_statement_preview(uuid,uuid,date,date,jsonb),private.workspace_statement_entry(jsonb),private.workspace_statement_money(jsonb),
 private.workspace_statement_issue_check(private.workspace_owner_statements),private.workspace_statement_void_check(private.workspace_owner_statements) from public,anon,authenticated;

-- 7. Patches to the live finance functions. Each anchor must occur exactly once; the marker says the patch is
-- already in place. A missing or repeated anchor stops the migration.
do $$
declare
 fixes constant text[][] := array[
  -- prepareStatement goes to version 2. The old branch is renamed: the access check before it refuses any
  -- action it does not know, so it never runs.
  ['private.workspace_finance_action(jsonb)',
   $q$elsif a='prepareStatement' then$q$,
   $q$elsif a='prepareStatement' then
  result:=private.workspace_prepare_statement_v2(input);

 elsif a='retired:prepareStatement' then$q$,
   $q$private.workspace_prepare_statement_v2(input)$q$],
  -- Locks: any issued or paid statement period the stay overlaps, not only the month it starts in.
  ['private.workspace_finance_action(jsonb)',
   $q$if exists(select 1 from private.workspace_owner_statements where property_id=prop and status in ('issued','paid') and period_start=date_trunc('month',r.check_in)::date) then raise exception 'Void the issued statement before changing this reservation' using errcode='42501';end if;$q$,
   $q$-- Reservation values are locked while an issued or paid statement covers the stay.
  if private.workspace_payout_stay_locked(r) then raise exception 'Void the issued statement before changing this reservation' using errcode='42501';end if;$q$,
   $q$-- Reservation values are locked while an issued or paid statement covers the stay.$q$],
  ['private.workspace_finance_action(jsonb)',
   $q$if exists(select 1 from private.workspace_owner_statements where property_id=r.property_id and status in ('issued','paid') and period_start=date_trunc('month',r.check_in)::date) then raise exception 'Void the issued statement before changing this reservation' using errcode='42501';end if;$q$,
   $q$-- A payout is locked while an issued or paid statement covers the stay.
  if private.workspace_payout_stay_locked(r) then raise exception 'Void the issued statement before changing this reservation' using errcode='42501';end if;$q$,
   $q$-- A payout is locked while an issued or paid statement covers the stay.$q$],
  ['private.workspace_agree_payouts(jsonb)',
   $q$elsif exists(select 1 from private.workspace_owner_statements where property_id=r.property_id and status in ('issued','paid') and period_start=date_trunc('month',r.check_in)::date) then reason:='locked';$q$,
   $q$elsif private.workspace_payout_stay_locked(r) then reason:='locked';$q$,
   $q$workspace_payout_stay_locked(r) then reason:='locked'$q$],
  -- Issuing checks the draft again: the figures must not have changed since it was prepared (X1).
  ['private.workspace_finance_action(jsonb)',
   $q$if s.status<>'draft' then raise exception 'Only a draft statement can be issued' using errcode='42501';end if;$q$,
   $q$if s.status<>'draft' then raise exception 'Only a draft statement can be issued' using errcode='42501';end if;
   perform private.workspace_statement_issue_check(s);$q$,
   $q$private.workspace_statement_issue_check(s)$q$],
  -- Voiding refuses while a later statement relies on this one to count a stay in full.
  ['private.workspace_finance_action(jsonb)',
   $q$if s.status='issued' and actor not in ('admin','super_admin') then raise exception 'Management must void an issued statement' using errcode='42501';end if;$q$,
   $q$if s.status='issued' and actor not in ('admin','super_admin') then raise exception 'Management must void an issued statement' using errcode='42501';end if;
   perform private.workspace_statement_void_check(s);$q$,
   $q$private.workspace_statement_void_check(s)$q$],
  -- Bulk approval never agrees a stay whose payout lines repeat an amount (often an overlapping report, so the
  -- amount received may be doubled): it is left as 'different' to check one by one, and counted (M6).
  ['private.workspace_agree_payouts(jsonb)',
   $q$include_different boolean:=false;$q$,
   $q$include_different boolean:=false;repeated integer:=0;$q$,
   $q$repeated integer:=0;$q$],
  ['private.workspace_agree_payouts(jsonb)',
   $q$elsif st='different' and not include_different then reason:='different';$q$,
   $q$elsif st='different' and not include_different then reason:='different';
   elsif st='different' and payout->>'repeatedAmount' is not null then reason:='different';repeated:=repeated+1;$q$,
   $q$payout->>'repeatedAmount' is not null then reason:='different';repeated:=repeated+1;$q$],
  ['private.workspace_agree_payouts(jsonb)',
   $q$'atReceived',at_received,'skipped',skipped);$q$,
   $q$'atReceived',at_received,'skipped',skipped,'repeatedAmountSkipped',repeated);$q$,
   $q$'repeatedAmountSkipped',repeated$q$],
  -- The statements list: every statement overlapping the month, whatever its dates.
  ['private.workspace_finance_read(text,uuid,text,uuid,text)',
   $q$'unsettledPayouts',(select count(*) from private.workspace_reservations r where r.property_id=p.id$q$,
   $q$'periodStatements',(select coalesce(jsonb_agg(private.workspace_statement_view(s) order by s.period_start,s.id),'[]'::jsonb) from private.workspace_owner_statements s
     where s.property_id=p.id and s.status<>'void' and daterange(s.period_start,s.period_end) && daterange(start_on,end_on)),
    'unsettledPayouts',(select count(*) from private.workspace_reservations r where r.property_id=p.id$q$,
   $q$'periodStatements'$q$]
 ];
 definition text;found_count integer;
begin
 for i in 1..array_length(fixes, 1) loop
  definition := pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in definition) = 0 then
   found_count := (length(definition) - length(replace(definition, fixes[i][2], ''))) / length(fixes[i][2]);
   if found_count <> 1 then raise exception 'Patch anchor found % times in % (%), expected once', found_count, fixes[i][1], i; end if;
   execute replace(definition, fixes[i][2], fixes[i][3]);
   if position(fixes[i][4] in pg_get_functiondef(fixes[i][1]::regprocedure)) = 0 then raise exception 'Patch did not take in % (%)', fixes[i][1], i; end if;
  end if;
 end loop;
end $$;
