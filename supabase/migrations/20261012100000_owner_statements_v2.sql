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
--    * changeovers: accepted, completed cleans in the period at the agreed value, or at the actual cost when
--      the clean's current review (else the property's mode) says so.
--    * the management fee on the payout after OTA fees, halves rounded away from zero; VAT on the rounded fee.
--    * lines in DEDUCTION_ORDER: OTA fees, changeovers, management fee, VAT, other payables (approved expenses),
--      each category in date order. Payout = gross less every line.
--    * it is blocked while a stay in the period is unsettled, or a clean that cost more than agreed waits for
--      a review on an agreed-fee property.
-- 3. prepareStatement goes to private.workspace_prepare_statement_v2: a month ({period}) or a date range
--    ({from, to}, to not included), method 'nights' unless the request says 'check_in_month'. It refuses a
--    period overlapping another statement for the property, refuses while blocked (a clear message, the
--    reasons in the error detail) and, for the same period, prepares the same draft again (an issued
--    statement must be voided first).
-- 4. A stay, payout or clean is locked once an issued or paid statement covers it: any period it overlaps
--    (daterange(period_start, period_end) && daterange(check_in, check_out)).
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

-- One property and one period, worked out without writing anything. Callers check access first.
-- own_statement: the statement being prepared again, so its own stays are not "already counted".
create or replace function private.workspace_statement_compute(prop uuid,from_on date,to_on date,statement_method text,own_statement uuid default null) returns jsonb
 language plpgsql stable security definer set search_path='' as $$
declare
 f private.workspace_property_financials;mode text;vat_on boolean;vat_rate integer;whole boolean;
 r private.workspace_reservations;pr jsonb;n integer;nip integer;bef integer;thr integer;in_money boolean;is_owner boolean;elsewhere boolean;
 settled bigint;fee bigint;gross bigint;share_gross bigint;share_fee bigint;took boolean;
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

 -- Stays, in check-in order (then id): nights inside the period, and the money share by the method.
 for r in select * from private.workspace_reservations y where y.property_id=prop and y.status='confirmed' and y.check_in<to_on and y.check_out>from_on order by y.check_in,y.id loop
  n:=r.check_out-r.check_in;
  nip:=greatest(0,least(r.check_out,to_on)-greatest(r.check_in,from_on));
  bef:=case when whole then 0 else least(greatest(from_on-r.check_in,0),n) end;
  thr:=case when whole then n else least(greatest(to_on-r.check_in,0),n) end;
  in_money:=case when whole then r.check_in>=from_on and r.check_in<to_on else thr>bef end;
  booked:=booked+nip;
  is_owner:=private.workspace_is_owner_stay(r);
  -- Money already in a statement of the other method (a monthly statement counts a stay where it checks in).
  elsewhere:=not is_owner and in_money and exists(select 1 from private.workspace_owner_statements o
   cross join lateral jsonb_array_elements(case when jsonb_typeof(o.detail->'stays')='array' then o.detail->'stays' else '[]'::jsonb end) e
   where o.property_id=prop and o.status<>'void' and o.method<>statement_method and o.id is distinct from own_statement
    and e->>'reservationId'=r.id::text and coalesce((e->>'counted')::boolean,true));
  if r.channel in ('airbnb','booking_com','vrbo') then
   pr:=private.workspace_payout_row(r);settled:=(pr->>'settledMinor')::bigint;fee:=(pr->>'otaFeesMinor')::bigint;
  else settled:=r.payout_minor;fee:=null;
  end if;
  if is_owner and settled is not null and settled<>0 then flags:=flags||to_jsonb('owner_stay_amount_ignored:'||r.id);end if;
  share_gross:=0;share_fee:=0;took:=false;
  if elsewhere then already:=already||to_jsonb(r.id::text);
  elsif in_money and not is_owner then
   if settled is null then blocked:=blocked||to_jsonb('stay_unsettled:'||r.id);
   else
    if fee is null then
     fee:=0;
     if r.channel in ('airbnb','booking_com','vrbo') then flags:=flags||to_jsonb('ota_fee_unknown:'||r.id);end if;
    end if;
    gross:=settled+fee;
    if whole or (bef=0 and thr=n) then share_gross:=gross;share_fee:=fee;
    else share_gross:=private.workspace_prorate(gross,bef,thr,n);share_fee:=private.workspace_prorate(fee,bef,thr,n);
    end if;
    took:=true;
   end if;
  end if;
  gross_total:=gross_total+share_gross;
  if share_fee<>0 then
   ota_lines:=ota_lines||jsonb_build_array(jsonb_build_object('kind','ota_fee','date',r.check_in,'label',private.workspace_channel_label(r.channel)||' fees','amountMinor',share_fee,'refId',r.id));
   ota_total:=ota_total+share_fee;
  end if;
  stays:=stays||jsonb_build_array(jsonb_build_object('reservationId',r.id,'reference',r.reference,'channel',r.channel,'channelReference',r.channel_reference,
   'checkIn',r.check_in,'checkOut',r.check_out,'guests',r.guests,'nights',n,'nightsInPeriod',nip,'ownerStay',is_owner,'counted',took,
   'grossMinor',share_gross,'otaFeeMinor',share_fee,'payoutMinor',share_gross-share_fee,'amountMinor',share_gross-share_fee));
 end loop;
 if booked>available then flags:=flags||to_jsonb('nights_exceed_period'::text);end if;

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
declare prop uuid:=(input->>'propertyId')::uuid;from_on date;to_on date;statement_method text:='nights';s private.workspace_owner_statements;c jsonb;statement_detail jsonb;
 unsettled integer;unreviewed integer;
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
  statement_method:=input->>'method';
 end if;
 -- One statement change per property at a time, so the overlap check is exact.
 perform pg_advisory_xact_lock(hashtextextended('workspace_owner_statement:'||prop::text,77));
 select * into s from private.workspace_owner_statements where property_id=prop and status<>'void' and period_start=from_on and period_end=to_on for update;
 if found and s.status<>'draft' then raise exception 'This statement has been issued. Void it before preparing again' using errcode='42501';end if;
 if exists(select 1 from private.workspace_owner_statements o where o.property_id=prop and o.status<>'void' and o.id is distinct from s.id
   and daterange(o.period_start,o.period_end) && daterange(from_on,to_on)) then
  raise exception 'Another statement already covers part of these dates. Void it or choose other dates' using errcode='22023';
 end if;
 c:=private.workspace_statement_compute(prop,from_on,to_on,statement_method,s.id);
 if (c->>'blocked')::boolean then
  unsettled:=(select count(*) from jsonb_array_elements_text(c->'blockedReasons') b where b like 'stay\_unsettled:%');
  unreviewed:=(select count(*) from jsonb_array_elements_text(c->'blockedReasons') b where b like 'clean\_unreviewed:%');
  raise exception '%',case when unsettled>0 and unreviewed>0 then 'Reconcile every stay in the period and review the cleans that cost more than agreed first'
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
-- included, as prepareStatement), filters {method}. The figures, lines and reasons it would be blocked.
create or replace function private.workspace_report_statement_preview(target_property uuid,target_id uuid,from_on date,to_on date,filters jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare statement_method text:='nights';own uuid;
begin
 if target_property is null then raise exception 'Choose a property' using errcode='22023';end if;
 if from_on is null or to_on is null then raise exception 'Choose the statement dates' using errcode='22023';end if;
 if jsonb_typeof(filters)='object' then
  if exists(select 1 from jsonb_object_keys(filters) k where k not in ('method')) then raise exception 'Invalid report filters' using errcode='22023';end if;
  statement_method:=coalesce(filters->>'method','nights');
 end if;
 own:=(select o.id from private.workspace_owner_statements o where o.property_id=target_property and o.status<>'void' and o.period_start=from_on and o.period_end=to_on limit 1);
 return private.workspace_statement_compute(target_property,from_on,to_on,statement_method,own)||jsonb_build_object('section','statementPreview','propertyId',target_property,
  'statements',(select coalesce(jsonb_agg(private.workspace_statement_view(o) order by o.period_start,o.id),'[]'::jsonb) from private.workspace_owner_statements o
   where o.property_id=target_property and o.status<>'void' and daterange(o.period_start,o.period_end) && daterange(from_on,to_on)));
end $$;

revoke all on function private.workspace_floor_div(numeric,numeric),private.workspace_prorate(bigint,integer,integer,integer),private.workspace_percent_of_minor(bigint,integer),
 private.workspace_percent_label(integer),private.workspace_channel_label(text),private.workspace_statement_fee_base(),private.workspace_statement_waits_for_clean_review(),
 private.workspace_is_owner_stay(private.workspace_reservations),private.workspace_statement_compute(uuid,date,date,text,uuid),private.workspace_statement_date(jsonb,text),
 private.workspace_prepare_statement_v2(jsonb),private.workspace_statement_view(private.workspace_owner_statements),
 private.workspace_report_statement_preview(uuid,uuid,date,date,jsonb) from public,anon,authenticated;

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
