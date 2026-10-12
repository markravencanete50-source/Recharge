-- Reconciliation, version 2: VRBO joins Airbnb and Booking.com, and payout reports are held line by line.
--
-- 1. VRBO is a reconciled platform. Payout reports accept it, and every place in the five live finance
--    functions that listed the two platforms now lists three (replaced everywhere, then checked).
-- 2. Each payout line keeps what the report said about it: gross, the platform's fees (stored as
--    positive amounts), the cleaning fee, the date paid, the line type and a line key. The key is built
--    by the upload screen from the code, date, type, amount, payout reference and an occurrence number,
--    so the same line in an overlapping report is recognised and held once. Lines without a key (the
--    report had no date or reference) are never de-duplicated; only a byte-identical file is refused.
-- 3. Uploading a report goes through private.workspace_import_payout_report: new lines are added,
--    lines already held are counted and skipped, lines for a cancelled stay are counted. Lines in the
--    old shape (reference and amount only) keep today's rules exactly.
-- 4. Any active line can be set aside with a reason (a duplicate, a line for another business), unless
--    its stay is in an issued or paid statement.
-- 5. A stay's payout row adds the line count, whether funds arrived, whether it was approved before
--    they did, a repeated amount hint, gross and OTA fees.
-- 6. Reconciliation's "unexpected" lines are now lines with no confirmed stay, each with the stay's
--    status when a stay has the code (so a cancelled stay can be tagged).
-- 7. public.workspace_finance_report: finance reports by section, 'payoutLines' now; later sections
--    are functions named private.workspace_report_<section in snake case> added by later migrations.
--
-- Money is integer pence. Owners never see payout lines: the tables stay private and every reader is
-- for finance roles only. Safe to run more than once.

-- 1. VRBO in the reports' channel check, added to whatever the check holds now.
do $$
declare
 adds constant text[][] := array[
  ['private.workspace_payout_reports','workspace_payout_reports_channel_check','vrbo']
 ];
 def text;
begin
 for i in 1..array_length(adds,1) loop
  def:=(select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid=adds[i][1]::regclass and c.conname=adds[i][2]);
  if def is null or position('ARRAY[' in def)=0 then raise exception 'Check % is missing', adds[i][2]; end if;
  if position(quote_literal(adds[i][3]) in def)=0 then
   execute format('alter table %s drop constraint %I',adds[i][1],adds[i][2]);
   execute format('alter table %s add constraint %I %s',adds[i][1],adds[i][2],replace(def,'ARRAY[','ARRAY['||quote_literal(adds[i][3])||'::text, '));
  end if;
 end loop;
end $$;

-- 2. What each report added, and what each line said.
alter table private.workspace_payout_reports
  add column if not exists new_line_count integer,
  add column if not exists new_minor bigint;
-- Every line of an earlier report was new when it was uploaded.
update private.workspace_payout_reports set new_line_count=line_count where new_line_count is null;
update private.workspace_payout_reports set new_minor=total_minor where new_minor is null;
alter table private.workspace_payout_reports alter column new_line_count set not null, alter column new_minor set not null;

alter table private.workspace_payout_lines
  add column if not exists channel text,
  add column if not exists line_key text check(length(line_key) between 1 and 300),
  add column if not exists gross_minor bigint check(gross_minor between -100000000 and 100000000),
  add column if not exists commission_minor bigint check(commission_minor between -100000000 and 100000000),
  add column if not exists host_fee_minor bigint check(host_fee_minor between -100000000 and 100000000),
  add column if not exists payment_fee_minor bigint check(payment_fee_minor between -100000000 and 100000000),
  add column if not exists cleaning_fee_minor bigint check(cleaning_fee_minor between -100000000 and 100000000),
  add column if not exists paid_on date,
  add column if not exists line_type text check(length(trim(line_type)) between 1 and 60);
update private.workspace_payout_lines l set channel=r.channel from private.workspace_payout_reports r where r.id=l.report_id and l.channel is null;
alter table private.workspace_payout_lines alter column channel set not null;
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='private.workspace_payout_reports'::regclass and conname='workspace_payout_reports_new_check') then
  alter table private.workspace_payout_reports add constraint workspace_payout_reports_new_check check(new_line_count between 0 and line_count);
 end if;
 if not exists(select 1 from pg_constraint where conrelid='private.workspace_payout_lines'::regclass and conname='workspace_payout_lines_channel_check') then
  alter table private.workspace_payout_lines add constraint workspace_payout_lines_channel_check check(channel in ('airbnb','booking_com','vrbo'));
 end if;
end $$;
-- One line per key in each channel. A report may now hold the same code more than once (a stay and its adjustment).
create unique index if not exists workspace_payout_lines_key_idx on private.workspace_payout_lines(channel,line_key) where line_key is not null;
drop index if exists private.workspace_payout_lines_ref_idx;
create index if not exists workspace_payout_lines_channel_ref_idx on private.workspace_payout_lines(channel,upper(reference));
do $$ declare t text; begin
 foreach t in array array['workspace_payout_reports','workspace_payout_lines'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated',t);
 end loop;
end $$;

-- 3. Helpers. A money value on a payout line: absent, null, or whole pence within the limit.
create or replace function private.workspace_payout_minor_ok(value jsonb, required boolean) returns boolean language sql immutable set search_path='' as $$
 select case when value is null or jsonb_typeof(value)='null' then not required
  else jsonb_typeof(value)='number' and value::text ~ '^-?\d{1,9}$' and abs(value::text::bigint)<=100000000 end;
$$;
-- A stay is locked once a statement covering it has been issued or paid: the month it starts in, and
-- (once statements carry an end date) any issued period it overlaps.
create or replace function private.workspace_payout_stay_locked(target private.workspace_reservations) returns boolean language plpgsql stable security definer set search_path='' as $$
declare locked boolean;
begin
 if target.id is null then return false; end if;
 locked:=exists(select 1 from private.workspace_owner_statements s where s.property_id=target.property_id and s.status in ('issued','paid') and s.period_start=date_trunc('month',target.check_in)::date);
 if not locked and exists(select 1 from pg_catalog.pg_attribute a where a.attrelid='private.workspace_owner_statements'::regclass and a.attname='period_end' and not a.attisdropped) then
  execute 'select exists(select 1 from private.workspace_owner_statements s where s.property_id=$1 and s.status in (''issued'',''paid'') and s.period_end is not null and daterange(s.period_start,s.period_end) && daterange($2,$3))'
   into locked using target.property_id,target.check_in,target.check_out;
 end if;
 return coalesce(locked,false);
end $$;

-- 4. Uploading a payout report. Called by workspace_finance_action after its access and receipt checks.
create or replace function private.workspace_import_payout_report(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 lines jsonb:=input->'lines';line jsonb;line_no integer:=0;chan text:=input->>'channel';legacy boolean;hash text;total bigint;
 rep private.workspace_payout_reports;new_count integer;new_total bigint;inserted integer;result jsonb;
 line_keys constant text[]:=array['reference','amountMinor','grossMinor','commissionMinor','hostFeeMinor','paymentFeeMinor','cleaningFeeMinor','paidOn','lineType','key'];
 y integer;m integer;d integer;
begin
 -- Lines are validated here, not by the generic 16 KiB workflow helper.
 perform private.workspace_json_keys(input-'lines',array['action','requestId','channel','fileName']);
 if coalesce(chan,'') not in ('airbnb','booking_com','vrbo') or jsonb_typeof(lines) is distinct from 'array' or jsonb_array_length(lines) not between 1 and 2000 then
  raise exception 'Upload between 1 and 2,000 payout lines' using errcode='22023';
 end if;
 -- The old shape: every line is a reference and an amount, nothing else.
 legacy:=not exists(select 1 from jsonb_array_elements(lines) x where jsonb_typeof(x)<>'object' or exists(select 1 from jsonb_object_keys(x) k where k not in ('reference','amountMinor')));
 if octet_length(lines::text)>(case when legacy then 262144 else 1048576 end) then raise exception 'Upload between 1 and 2,000 payout lines' using errcode='22023';end if;

 if legacy then
  -- Today's rules, unchanged.
  for line in select value from jsonb_array_elements(lines) loop
   if jsonb_typeof(line)<>'object' or exists(select 1 from jsonb_object_keys(line) k where k not in ('reference','amountMinor')) or jsonb_typeof(line->'reference') is distinct from 'string' or length(trim(line->>'reference')) not between 1 and 120
    or jsonb_typeof(line->'amountMinor') is distinct from 'number' or line->>'amountMinor'!~'^-?\d+$' or abs((line->>'amountMinor')::numeric)>100000000 then raise exception 'Invalid payout line' using errcode='22023';end if;
  end loop;
  if (select count(distinct upper(trim(value->>'reference'))) from jsonb_array_elements(lines))<>jsonb_array_length(lines) then raise exception 'Combine repeated reservation codes before upload' using errcode='22023';end if;
  select md5(string_agg(upper(trim(value->>'reference'))||':'||(value->>'amountMinor'),',' order by upper(trim(value->>'reference')))),sum((value->>'amountMinor')::bigint) into hash,total from jsonb_array_elements(lines);
 else
  for line in select value from jsonb_array_elements(lines) loop
   line_no:=line_no+1;
   if jsonb_typeof(line)<>'object' or exists(select 1 from jsonb_object_keys(line) k where not(k=any(line_keys)))
    or jsonb_typeof(line->'reference') is distinct from 'string' or length(trim(line->>'reference')) not between 1 and 120
    or not private.workspace_payout_minor_ok(line->'amountMinor',true)
    or not private.workspace_payout_minor_ok(line->'grossMinor',false) or not private.workspace_payout_minor_ok(line->'commissionMinor',false)
    or not private.workspace_payout_minor_ok(line->'hostFeeMinor',false) or not private.workspace_payout_minor_ok(line->'paymentFeeMinor',false)
    or not private.workspace_payout_minor_ok(line->'cleaningFeeMinor',false)
    or (line ? 'lineType' and jsonb_typeof(line->'lineType')<>'null' and (jsonb_typeof(line->'lineType')<>'string' or length(trim(line->>'lineType')) not between 1 and 60))
    or (line ? 'key' and jsonb_typeof(line->'key')<>'null' and (jsonb_typeof(line->'key')<>'string' or length(line->>'key') not between 1 and 300 or trim(line->>'key')=''))
    or (line ? 'paidOn' and jsonb_typeof(line->'paidOn')<>'null' and (jsonb_typeof(line->'paidOn')<>'string' or line->>'paidOn'!~'^\d{4}-\d{2}-\d{2}$')) then
    raise exception 'Invalid payout line %',line_no using errcode='22023';
   end if;
   if jsonb_typeof(line->'paidOn')='string' then
    y:=substr(line->>'paidOn',1,4)::integer;m:=substr(line->>'paidOn',6,2)::integer;d:=substr(line->>'paidOn',9,2)::integer;
    if y not between 2000 and 2100 or m not between 1 and 12 or d<1 or d>extract(day from make_date(y,m,1)+interval '1 month'-interval '1 day') then raise exception 'Invalid payout line %',line_no using errcode='22023';end if;
   end if;
  end loop;
  -- Keys are unique within a file (they carry an occurrence number), so a repeat means the file is wrong.
  if exists(select 1 from jsonb_array_elements(lines) x where jsonb_typeof(x->'key')='string' group by x->>'key' having count(*)>1) then
   raise exception 'The file repeats a payout line. Export the report again and upload that' using errcode='22023';
  end if;
  select md5('v2:'||lines::text),sum((value->>'amountMinor')::bigint) into hash,total from jsonb_array_elements(lines);
 end if;
 if exists(select 1 from private.workspace_payout_reports where channel=chan and content_hash=hash) then raise exception 'This payout report has already been uploaded' using errcode='23505';end if;

 -- One upload at a time per channel, so "already held" is exact.
 perform pg_advisory_xact_lock(hashtextextended('workspace_payout_import:'||chan,0));
 select count(*),coalesce(sum((x->>'amountMinor')::bigint),0) into new_count,new_total from jsonb_array_elements(lines) x
  where jsonb_typeof(x->'key') is distinct from 'string' or not exists(select 1 from private.workspace_payout_lines h where h.channel=chan and h.line_key=x->>'key');
 insert into private.workspace_payout_reports(channel,file_name,content_hash,line_count,total_minor,new_line_count,new_minor,uploaded_by,request_id)
  values(chan,private.workspace_required_text(input,'fileName',1,200),hash,jsonb_array_length(lines),total,new_count,new_total,auth.uid(),(input->>'requestId')::uuid) returning * into rep;
 insert into private.workspace_payout_lines(report_id,channel,reference,amount_minor,gross_minor,commission_minor,host_fee_minor,payment_fee_minor,cleaning_fee_minor,paid_on,line_type,line_key)
  select rep.id,chan,trim(x->>'reference'),(x->>'amountMinor')::bigint,
   case when jsonb_typeof(x->'grossMinor')='number' then (x->>'grossMinor')::bigint end,
   case when jsonb_typeof(x->'commissionMinor')='number' then (x->>'commissionMinor')::bigint end,
   case when jsonb_typeof(x->'hostFeeMinor')='number' then (x->>'hostFeeMinor')::bigint end,
   case when jsonb_typeof(x->'paymentFeeMinor')='number' then (x->>'paymentFeeMinor')::bigint end,
   case when jsonb_typeof(x->'cleaningFeeMinor')='number' then (x->>'cleaningFeeMinor')::bigint end,
   case when jsonb_typeof(x->'paidOn')='string' then (x->>'paidOn')::date end,
   case when jsonb_typeof(x->'lineType')='string' then trim(x->>'lineType') end,
   case when jsonb_typeof(x->'key')='string' then x->>'key' end
  from jsonb_array_elements(lines) with ordinality t(x,n)
  where jsonb_typeof(x->'key') is distinct from 'string' or not exists(select 1 from private.workspace_payout_lines h where h.channel=chan and h.line_key=x->>'key')
  order by n
  on conflict (channel,line_key) where line_key is not null do nothing;
 get diagnostics inserted = row_count;
 if inserted<>new_count then raise exception 'Payout lines changed during the upload. Try again' using errcode='40001';end if;

 -- Counts over the lines this upload added. A stay "matches" only when it is confirmed.
 select jsonb_build_object('reportId',rep.id,'channel',rep.channel,'lineCount',rep.line_count,'totalMinor',rep.total_minor,
  'newLines',rep.new_line_count,'newMinor',rep.new_minor,'alreadyHeld',rep.line_count-rep.new_line_count,
  'cancelledStay',count(*) filter(where x.id is not null and x.status<>'confirmed'),
  'matchedReservations',count(distinct x.id) filter(where x.status='confirmed'),
  'unexpectedLines',count(*) filter(where x.status is distinct from 'confirmed')) into result
 from private.workspace_payout_lines l left join private.workspace_reservations x on x.channel=l.channel and upper(x.channel_reference)=upper(l.reference)
 where l.report_id=rep.id;
 insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'finance.payout_report_uploaded');
 return result;
end $$;

-- 5. Setting a line aside: any active line, with a reason, unless its stay's statement is issued or paid.
create or replace function private.workspace_set_aside_payout_line(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare l private.workspace_payout_lines;stay private.workspace_reservations;reason text;
begin
 perform private.workspace_json_keys(input,array['action','requestId','lineId','note']);
 reason:=private.workspace_required_text(input,'note',5,2000);
 if coalesce(input->>'lineId','')!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Payout line not found' using errcode='P0002';end if;
 select * into l from private.workspace_payout_lines where id=(input->>'lineId')::uuid for update;
 if not found then raise exception 'Payout line not found' using errcode='P0002';end if;
 if l.set_aside_at is not null then raise exception 'This payout line has already been set aside' using errcode='P0002';end if;
 select * into stay from private.workspace_reservations x where x.channel=l.channel and upper(x.channel_reference)=upper(l.reference);
 if stay.id is not null then
  if not private.workspace_can_property(stay.property_id,'owner-statements') then raise exception 'Property finance access denied' using errcode='42501';end if;
  if private.workspace_payout_stay_locked(stay) then raise exception 'Void the issued statement before changing this stay' using errcode='42501';end if;
 end if;
 update private.workspace_payout_lines set set_aside_note=reason,set_aside_by=auth.uid(),set_aside_at=now() where id=l.id returning * into l;
 insert into public.workspace_activity(actor_id,property_id,event_type) values(auth.uid(),stay.property_id,'finance.payout_line_set_aside');
 return jsonb_build_object('lineId',l.id,'setAsideAt',l.set_aside_at,'reservationId',stay.id,
  'payout',case when stay.id is not null then private.workspace_payout_row(stay) end);
end $$;

-- 6. A stay's payout row: the same keys as before, plus what its lines say. Nobody has patched this
-- function, so it is replaced whole (copied from its latest definition).
create or replace function private.workspace_payout_row(target private.workspace_reservations) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare received bigint:=private.workspace_payout_received(target);agreement private.workspace_payout_agreements;state text;
 line_count integer:=0;fees bigint;repeated bigint;settled bigint;begin
 select * into agreement from private.workspace_payout_agreements where reservation_id=target.id;
 state:=case
  when found and agreement.received_snapshot_minor is not distinct from received then 'agreed'
  when target.channel_reference is null then 'no_reference'
  when received is null then 'missing'
  when target.payout_minor is null then 'no_expected_amount'
  when received=target.payout_minor then 'matched'
  else 'different' end;
 settled:=case state when 'matched' then received when 'agreed' then agreement.agreed_minor end;
 if target.channel_reference is not null then
  -- The same lines as workspace_payout_received. OTA fees: the itemised fees on a line, else its gross
  -- less what was paid; null when no line says (the statement flags that).
  select count(*),sum(case when l.commission_minor is not null or l.host_fee_minor is not null or l.payment_fee_minor is not null
     then coalesce(l.commission_minor,0)+coalesce(l.host_fee_minor,0)+coalesce(l.payment_fee_minor,0)
    when l.gross_minor is not null then l.gross_minor-l.amount_minor end)
   into line_count,fees
   from private.workspace_payout_lines l join private.workspace_payout_reports r on r.id=l.report_id
   where r.channel=target.channel and upper(l.reference)=upper(target.channel_reference) and l.set_aside_at is null;
  -- A hint for a difference: the same amount paid more than once (often an overlapping report).
  if state='different' then
   select l.amount_minor into repeated from private.workspace_payout_lines l join private.workspace_payout_reports r on r.id=l.report_id
    where r.channel=target.channel and upper(l.reference)=upper(target.channel_reference) and l.set_aside_at is null and l.amount_minor<>0
    group by l.amount_minor having count(*)>1 order by abs(l.amount_minor) desc,l.amount_minor desc limit 1;
  end if;
 end if;
 return jsonb_build_object('reservationId',target.id,'propertyId',target.property_id,'reference',target.reference,'channel',target.channel,
  'channelReference',target.channel_reference,'checkIn',target.check_in,'checkOut',target.check_out,'guests',target.guests,
  'expectedMinor',target.payout_minor,'receivedMinor',received,'agreedMinor',case when state='agreed' then agreement.agreed_minor end,
  'agreementNote',case when state='agreed' then agreement.note end,'state',state,'version',target.version,
  'settledMinor',settled,
  'lineCount',line_count,'fundsReceived',line_count>0,
  'agreedBeforeFunds',state='agreed' and agreement.received_snapshot_minor is null,
  'repeatedAmount',repeated,'otaFeesMinor',fees,
  'grossMinor',case when settled is not null then settled+coalesce(fees,0) end);
end $$;

revoke all on function private.workspace_payout_minor_ok(jsonb,boolean),private.workspace_payout_stay_locked(private.workspace_reservations),
 private.workspace_import_payout_report(jsonb),private.workspace_set_aside_payout_line(jsonb),
 private.workspace_payout_row(private.workspace_reservations) from public,anon,authenticated;

-- 7. Patches to the live finance functions. Each anchor is one line and must occur exactly once; the
-- marker says the patch is already in place. A missing anchor stops the migration.
do $$
declare
 fixes constant text[][] := array[
  -- The finance action routes uploads and set-asides to the functions above. The old branches are
  -- renamed: the access check before them refuses any action it does not know, so they never run.
  ['private.workspace_finance_action(jsonb)',
   $q$elsif a='importPayoutReport' then$q$,
   $q$elsif a='importPayoutReport' then
  result:=private.workspace_import_payout_report(input);

 elsif a='retired:importPayoutReport' then$q$,
   $q$private.workspace_import_payout_report(input)$q$],
  ['private.workspace_finance_action(jsonb)',
   $q$elsif a='setAsidePayoutLine' then$q$,
   $q$elsif a='setAsidePayoutLine' then
  result:=private.workspace_set_aside_payout_line(input);

 elsif a='retired:setAsidePayoutLine' then$q$,
   $q$private.workspace_set_aside_payout_line(input)$q$],
  -- Reconciliation: "unexpected" lines are lines with no confirmed stay, tagged with the stay's status.
  ['private.workspace_finance_read(text,uuid,text,uuid,text)',
   $q$'unexpected',(select coalesce(jsonb_agg(jsonb_build_object('lineId',l.id,'channel',rp.channel,'reference',l.reference,'amountMinor',l.amount_minor,'fileName',rp.file_name,'uploadedAt',rp.created_at) order by rp.created_at,l.reference),'[]')$q$,
   $q$-- Lines with no confirmed stay: no stay has the code, or it is cancelled or an enquiry (stayStatus).
   'unexpected',(select coalesce(jsonb_agg(jsonb_build_object('lineId',l.id,'channel',rp.channel,'reference',l.reference,'amountMinor',l.amount_minor,'fileName',rp.file_name,'uploadedAt',rp.created_at,
     'paidOn',l.paid_on,'lineType',l.line_type,'stayStatus',stay.status,'reservationId',stay.id) order by rp.created_at,l.reference),'[]')$q$,
   $q$'stayStatus',stay.status$q$],
  ['private.workspace_finance_read(text,uuid,text,uuid,text)',
   $q$from private.workspace_payout_lines l join private.workspace_payout_reports rp on rp.id=l.report_id where l.set_aside_at is null and target_property is null$q$,
   $q$from private.workspace_payout_lines l join private.workspace_payout_reports rp on rp.id=l.report_id
     left join private.workspace_reservations stay on stay.channel=rp.channel and upper(stay.channel_reference)=upper(l.reference)
     where l.set_aside_at is null and (target_property is null or stay.property_id=target_property)$q$,
   $q$left join private.workspace_reservations stay on stay.channel=rp.channel$q$],
  ['private.workspace_finance_read(text,uuid,text,uuid,text)',
   $q$and not exists(select 1 from private.workspace_reservations r where r.channel=rp.channel and upper(r.channel_reference)=upper(l.reference))),$q$,
   $q$and stay.status is distinct from 'confirmed'),$q$,
   $q$and stay.status is distinct from 'confirmed'),$q$],
  ['private.workspace_finance_read(text,uuid,text,uuid,text)',
   $q$'reports',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'channel',channel,'fileName',file_name,'lineCount',line_count,'totalMinor',total_minor,'uploadedAt',created_at) order by created_at desc),'[]')$q$,
   $q$'reports',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'channel',channel,'fileName',file_name,'lineCount',line_count,'totalMinor',total_minor,'uploadedAt',created_at,'newLineCount',new_line_count,'newMinor',new_minor) order by created_at desc),'[]')$q$,
   $q$'newLineCount',new_line_count$q$]
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

-- 8. Three platforms wherever the five live functions listed two. Replaced everywhere it occurs (a
-- declared replace-all), then checked: no two-platform list may remain and the new list must be there.
do $$
declare
 targets constant text[] := array['private.workspace_finance_action(jsonb)','private.workspace_finance_read(text,uuid,text,uuid,text)',
  'private.workspace_agree_payouts(jsonb)','private.workspace_owner_period_cell(uuid,date)','private.workspace_management_overview()'];
 old_list constant text := $q$('airbnb','booking_com')$q$;
 new_list constant text := $q$('airbnb','booking_com','vrbo')$q$;
 sentinel constant text := $q$'booking_com','vrbo')$q$;
 -- Any other spelling of a two-platform list (spaces, either order, an array).
 old_pattern constant text := $r$('airbnb'\s*,\s*'booking_com'|'booking_com'\s*,\s*'airbnb')\s*[)\]]$r$;
 t text;definition text;occurrences integer;
begin
 foreach t in array targets loop
  definition := pg_get_functiondef(t::regprocedure);
  occurrences := (length(definition) - length(replace(definition, old_list, ''))) / length(old_list);
  if occurrences = 0 and position(sentinel in definition) = 0 then raise exception 'Two-platform list missing in %', t; end if;
  if occurrences > 0 then
   execute replace(definition, old_list, new_list);
   raise notice 'Replaced % two-platform lists in %', occurrences, t;
  end if;
  definition := pg_get_functiondef(t::regprocedure);
  if definition ~ old_pattern then raise exception 'A two-platform list is still in %', t; end if;
  if position(sentinel in definition) = 0 then raise exception 'The three-platform list is missing in %', t; end if;
 end loop;
end $$;

-- 9. Finance reports, for finance roles only. 'payoutLines': each payout line with its stay, filtered by
-- property, stay (target_id), dates (the day paid, else the day uploaded, both inclusive) and filters
-- {channel, reportId, state: 'active' | 'setAside' | 'noConfirmedStay'}. Up to 500 lines, newest first.
-- Any other section is a function a later migration adds, private.workspace_report_<snake_case>(uuid,uuid,date,date,jsonb),
-- reached only after the same access checks; until it exists the report needs a database update.
create or replace function private.workspace_finance_report(section text,target_property uuid default null,target_id uuid default null,from_on date default null,to_on date default null,filters jsonb default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();result jsonb;f_channel text;f_report uuid;f_state text;fname text;
begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 if not private.workspace_finance_role() or not private.has_workspace_module('owner-statements') then raise exception 'Accounts access required' using errcode='42501';end if;
 if target_property is not null and not private.workspace_can_property(target_property,'owner-statements') then raise exception 'Property finance access denied' using errcode='42501';end if;
 if from_on is not null and to_on is not null and from_on>to_on then raise exception 'Choose a date range' using errcode='22023';end if;
 if filters is not null and jsonb_typeof(filters)<>'null' and (jsonb_typeof(filters)<>'object' or octet_length(filters::text)>4096) then raise exception 'Invalid report filters' using errcode='22023';end if;
 if section is null or section!~'^[a-z][A-Za-z]{1,39}$' then raise exception 'Unknown finance report' using errcode='22023';end if;

 if section='payoutLines' then
  if jsonb_typeof(filters)='object' then
   if exists(select 1 from jsonb_object_keys(filters) k where k not in ('channel','reportId','state')) then raise exception 'Invalid report filters' using errcode='22023';end if;
   f_channel:=filters->>'channel';f_state:=filters->>'state';
   if f_channel is not null and f_channel not in ('airbnb','booking_com','vrbo') then raise exception 'Invalid report filters' using errcode='22023';end if;
   if f_state is not null and f_state not in ('active','setAside','noConfirmedStay') then raise exception 'Invalid report filters' using errcode='22023';end if;
   if filters->>'reportId' is not null then
    if filters->>'reportId'!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Invalid report filters' using errcode='22023';end if;
    f_report:=(filters->>'reportId')::uuid;
   end if;
  end if;
  with base as (
   select l.*,rp.file_name,rp.created_at uploaded_at,stay,stay.id stay_id,stay.property_id stay_property,stay.reference stay_reference,stay.status stay_status,
    stay.check_in stay_check_in,stay.check_out stay_check_out,coalesce(l.paid_on,(rp.created_at at time zone 'Europe/London')::date) on_date
   from private.workspace_payout_lines l join private.workspace_payout_reports rp on rp.id=l.report_id
   left join private.workspace_reservations stay on stay.channel=l.channel and upper(stay.channel_reference)=upper(l.reference)
   where (target_property is null or stay.property_id=target_property) and (target_id is null or stay.id=target_id)
    and (f_channel is null or l.channel=f_channel) and (f_report is null or l.report_id=f_report)
    and (f_state is null or (f_state='active' and l.set_aside_at is null) or (f_state='setAside' and l.set_aside_at is not null)
     or (f_state='noConfirmedStay' and l.set_aside_at is null and stay.status is distinct from 'confirmed'))
    and (from_on is null or coalesce(l.paid_on,(rp.created_at at time zone 'Europe/London')::date)>=from_on)
    and (to_on is null or coalesce(l.paid_on,(rp.created_at at time zone 'Europe/London')::date)<=to_on)
  ), page as (select * from base order by on_date desc,uploaded_at desc,upper(reference),id limit 500)
  select jsonb_build_object('section','payoutLines','count',(select count(*) from base),
   'activeMinor',(select coalesce(sum(amount_minor) filter(where set_aside_at is null),0) from base),
   'more',(select count(*) from base)>500,
   'lines',coalesce((select jsonb_agg(jsonb_build_object('lineId',p.id,'reportId',p.report_id,'fileName',p.file_name,'uploadedAt',p.uploaded_at,
     'channel',p.channel,'reference',p.reference,'amountMinor',p.amount_minor,'grossMinor',p.gross_minor,'commissionMinor',p.commission_minor,
     'hostFeeMinor',p.host_fee_minor,'paymentFeeMinor',p.payment_fee_minor,'cleaningFeeMinor',p.cleaning_fee_minor,'paidOn',p.paid_on,'lineType',p.line_type,
     'keyed',p.line_key is not null,'active',p.set_aside_at is null,'setAsideNote',p.set_aside_note,'setAsideAt',p.set_aside_at,
     'setAsideBy',(select w.full_name from public.workspace_profiles w where w.user_id=p.set_aside_by),
     'reservationId',p.stay_id,'propertyId',p.stay_property,'propertyName',(select x.name from public.workspace_properties x where x.id=p.stay_property),
     'stayReference',p.stay_reference,'stayStatus',p.stay_status,'checkIn',p.stay_check_in,'checkOut',p.stay_check_out,
     'locked',private.workspace_payout_stay_locked(p.stay),
     'canSetAside',p.set_aside_at is null and not private.workspace_payout_stay_locked(p.stay))
    order by p.on_date desc,p.uploaded_at desc,upper(p.reference),p.id) from page p),'[]'::jsonb)) into result;
  return result;
 end if;

 fname:='workspace_report_'||lower(regexp_replace(section,'([A-Z])','_\1','g'));
 if to_regprocedure(format('private.%I(uuid,uuid,date,date,jsonb)',fname)) is null then raise exception 'This report needs a database update' using errcode='0A000';end if;
 execute format('select private.%I($1,$2,$3,$4,$5)',fname) into result using target_property,target_id,from_on,to_on,filters;
 return result;
end $$;
create or replace function public.workspace_finance_report(section text,target_property uuid default null,target_id uuid default null,from_on date default null,to_on date default null,filters jsonb default null)
returns jsonb language sql security invoker set search_path='' as $$select private.workspace_finance_report(section,target_property,target_id,from_on,to_on,filters);$$;
revoke all on function private.workspace_finance_report(text,uuid,uuid,date,date,jsonb),public.workspace_finance_report(text,uuid,uuid,date,date,jsonb) from public,anon,authenticated;
grant execute on function private.workspace_finance_report(text,uuid,uuid,date,date,jsonb),public.workspace_finance_report(text,uuid,uuid,date,date,jsonb) to authenticated;
