-- Clean costs and statement terms (WP-D).
--
-- 1. Each property's agreed terms gain two switches: vat_on_fee (VAT is charged on the management fee)
--    and clean_charge_mode ('agreed_fee', the default, or 'actual_cost'). The VAT rate is one constant,
--    private.workspace_vat_bps(), 20%.
-- 2. Cleaner invoices, as the cleaner sent them: a total and one line per clean. The total must equal the
--    lines, and a clean is on at most one live invoice (a rejected invoice frees its cleans). Cleaner
--    invoices are the business's cost: they never become workspace_expenses rows and never reach owners.
-- 3. The actual cost of a clean (private.workspace_clean_cost): the line on its live invoice, else the
--    assigned cleaner's rate. A clean that cost more than the agreed value is flagged; Accounts review it
--    and choose what the owner is charged (the agreed fee or the actual cost), with a note. A review goes
--    stale when the clean's actual cost changes, and the statement then waits for a new one.
-- 4. public.workspace_payables_action: recordCleanerInvoice, decideCleanerInvoice, reviewCleanCost, for
--    the finance roles only (Accounts, admins), each property checked.
-- 5. setStatementTerms accepts vatOnFee and cleanChargeMode. Its dispatch branch is replaced (the anchor
--    includes its json_keys line, because the plain branch line also occurs in the access check).
-- 6. Finance reports 'cleanerInvoices' and 'cleansToReview'; the statements list shows the new terms and
--    how many cleans in the month are waiting for a review.
--
-- Money is integer pence. Owners never see cleaner costs, review notes or invoices: the tables are private
-- and every reader is for finance roles only. Safe to run more than once.

-- 1. Terms and the VAT rate --------------------------------------------------------------------------------
alter table private.workspace_property_financials
  add column if not exists vat_on_fee boolean not null default false,
  add column if not exists clean_charge_mode text not null default 'agreed_fee';
do $$ begin
 if not exists(select 1 from pg_constraint where conrelid='private.workspace_property_financials'::regclass and conname='workspace_property_financials_clean_charge_mode_check') then
  alter table private.workspace_property_financials add constraint workspace_property_financials_clean_charge_mode_check check(clean_charge_mode in ('agreed_fee','actual_cost'));
 end if;
end $$;

-- Assumption (b): VAT at 20%, on the management fee only.
create or replace function private.workspace_vat_bps() returns integer language sql immutable set search_path='' as $$ select 2000 $$;

-- 2. Cleaner invoices --------------------------------------------------------------------------------------
create table if not exists private.workspace_cleaner_invoices (
 id uuid primary key default gen_random_uuid(),
 -- Who sent it, as written on the invoice, and the cleaner's profile when it is known.
 supplier text not null check(length(trim(supplier)) between 2 and 200),
 cleaner_id uuid references public.workspace_profiles(user_id),
 reference text not null check(length(trim(reference)) between 1 and 120),
 invoice_date date not null,
 total_minor bigint not null check(total_minor between 1 and 100000000),
 currency text not null default 'GBP' check(currency='GBP'),
 note text check(length(note)<=2000),
 status text not null default 'to_approve' check(status in ('to_approve','approved','rejected')),
 decision_note text check(length(decision_note)<=2000),
 decided_by uuid references public.workspace_profiles(user_id), decided_at timestamptz,
 created_by uuid not null references public.workspace_profiles(user_id), request_id uuid not null,
 version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(created_by,request_id)
);
-- One invoice per supplier and reference, unless it was rejected.
create unique index if not exists workspace_cleaner_invoices_ref_idx on private.workspace_cleaner_invoices(lower(supplier),lower(reference)) where status<>'rejected';
create index if not exists workspace_cleaner_invoices_status_idx on private.workspace_cleaner_invoices(status,invoice_date);

create table if not exists private.workspace_cleaner_invoice_lines (
 id uuid primary key default gen_random_uuid(),
 invoice_id uuid not null references private.workspace_cleaner_invoices(id),
 work_id uuid not null references public.workspace_work_items(id),
 property_id uuid not null references public.workspace_properties(id),
 amount_minor bigint not null check(amount_minor between 1 and 10000000),
 -- Live while its invoice is waiting or approved; a rejected invoice's lines are not live.
 live boolean not null default true,
 unique(invoice_id,work_id)
);
-- At most one live line per clean: a clean is never on two live invoices.
create unique index if not exists workspace_cleaner_invoice_lines_live_idx on private.workspace_cleaner_invoice_lines(work_id) where live;
create index if not exists workspace_cleaner_invoice_lines_invoice_idx on private.workspace_cleaner_invoice_lines(invoice_id);

-- 3. Clean cost reviews ------------------------------------------------------------------------------------
create table if not exists private.workspace_clean_cost_reviews (
 work_id uuid primary key references public.workspace_work_items(id),
 decision text not null check(decision in ('agreed_fee','actual_cost')),
 note text not null check(length(trim(note)) between 5 and 2000),
 -- The actual cost that was reviewed. The review is stale once the clean's actual cost differs.
 actual_cost_minor bigint not null,
 agreed_minor bigint,
 reviewed_by uuid not null references public.workspace_profiles(user_id),
 reviewed_at timestamptz not null default now(),
 version integer not null default 1 check(version>0)
);

do $$ declare t text; begin
 foreach t in array array['workspace_cleaner_invoices','workspace_cleaner_invoice_lines','workspace_clean_cost_reviews'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated',t);
 end loop;
 -- Invoice lines are bounded per invoice instead, so one invoice is one counted change (as payout lines).
 foreach t in array array['workspace_cleaner_invoices','workspace_clean_cost_reviews'] loop
  execute format('drop trigger if exists business_write_limit on private.%I',t);
  execute format('create trigger business_write_limit before insert or update on private.%I for each row execute function private.workspace_enforce_write_limit()',t);
 end loop;
end $$;

-- Assumption (e): the actual cost of a clean is the line on its live invoice, else the assigned cleaner's rate.
create or replace function private.workspace_clean_cost(work uuid) returns bigint language sql stable security definer set search_path='' as $$
 select coalesce(
  (select l.amount_minor from private.workspace_cleaner_invoice_lines l where l.work_id=work and l.live),
  (select r.rate_minor::bigint from public.workspace_work_items w join private.workspace_cleaner_rates r on r.cleaner_id=w.assignee_id where w.id=work));
$$;

-- A clean's cost against the agreed value, and its review. Staff only: callers check access first.
-- state (for a clean that cost more than agreed): 'flagged' (no review), 'reviewed', or 'stale' (its cost changed since).
create or replace function private.workspace_clean_review_state(work uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare w public.workspace_work_items;agreed bigint;mode text;actual bigint:=private.workspace_clean_cost(work);src text;rv private.workspace_clean_cost_reviews;
 flagged boolean;reviewed boolean;
begin
 select * into w from public.workspace_work_items where id=work;
 if not found then return null;end if;
 select f.cleaning_cost_minor,f.clean_charge_mode into agreed,mode from private.workspace_property_financials f where f.property_id=w.property_id;
 src:=case when exists(select 1 from private.workspace_cleaner_invoice_lines l where l.work_id=work and l.live) then 'invoice' when actual is not null then 'rate' end;
 select * into rv from private.workspace_clean_cost_reviews where work_id=work;
 flagged:=coalesce(actual>agreed,false);
 reviewed:=rv.work_id is not null and rv.actual_cost_minor is not distinct from actual;
 return jsonb_build_object('workId',w.id,'propertyId',w.property_id,'cleanDate',w.due_on,'workStatus',w.status,'cleanerId',w.assignee_id,
  'agreedMinor',agreed,'actualMinor',actual,'costSource',src,'chargeMode',coalesce(mode,'agreed_fee'),'flagged',flagged,'reviewed',reviewed,
  'state',case when not flagged then null when reviewed then 'reviewed' when rv.work_id is not null then 'stale' else 'flagged' end,
  'decision',rv.decision,'note',rv.note,'reviewedAt',rv.reviewed_at,'reviewedActualMinor',rv.actual_cost_minor,'reviewVersion',rv.version);
end $$;

create or replace function private.workspace_cleaner_invoice_view(i private.workspace_cleaner_invoices) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',i.id,'supplier',i.supplier,'cleanerId',i.cleaner_id,'cleanerName',(select p.full_name from public.workspace_profiles p where p.user_id=i.cleaner_id),
  'reference',i.reference,'invoiceDate',i.invoice_date,'totalMinor',i.total_minor,'currency',i.currency,'note',i.note,'status',i.status,
  'decisionNote',i.decision_note,'decidedAt',i.decided_at,'version',i.version,'createdAt',i.created_at,
  'lineCount',(select count(*) from private.workspace_cleaner_invoice_lines l where l.invoice_id=i.id),
  'lines',coalesce((select jsonb_agg(jsonb_build_object('lineId',l.id,'workId',l.work_id,'propertyId',l.property_id,'propertyName',p.name,'cleanDate',w.due_on,
    'amountMinor',l.amount_minor,'live',l.live,'agreedMinor',f.cleaning_cost_minor,'overAgreed',coalesce(l.amount_minor>f.cleaning_cost_minor,false))
    order by w.due_on,l.work_id)
   from private.workspace_cleaner_invoice_lines l join public.workspace_work_items w on w.id=l.work_id join public.workspace_properties p on p.id=l.property_id
   left join private.workspace_property_financials f on f.property_id=l.property_id where l.invoice_id=i.id),'[]'::jsonb));
$$;

-- 4. Payables actions ---------------------------------------------------------------------------------------
-- {supplier, reference, invoiceDate, totalMinor, lines: [{workId, amountMinor}], note?, cleanerId?}. With cleanerId, every
-- clean on it must be that cleaner's.
create or replace function private.workspace_record_cleaner_invoice(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare lines jsonb:=input->'lines';line jsonb;line_no integer:=0;cleaner uuid;total bigint;sum_lines bigint;invoice_on date;inv private.workspace_cleaner_invoices;
 w public.workspace_work_items;supplier_name text;
begin
 perform private.workspace_json_keys(input-'lines',array['action','requestId','supplier','cleanerId','reference','invoiceDate','totalMinor','note']);
 if jsonb_typeof(lines) is distinct from 'array' or jsonb_array_length(lines) not between 1 and 200 or octet_length(lines::text)>65536 then raise exception 'Add between 1 and 200 cleans to the invoice' using errcode='22023';end if;
 for line in select value from jsonb_array_elements(lines) loop
  line_no:=line_no+1;
  if jsonb_typeof(line)<>'object' or exists(select 1 from jsonb_object_keys(line) k where k not in ('workId','amountMinor'))
   or coalesce(line->>'workId','')!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   or jsonb_typeof(line->'amountMinor') is distinct from 'number' or line->>'amountMinor'!~'^\d{1,8}$' or (line->>'amountMinor')::bigint not between 1 and 10000000 then
   raise exception 'Invalid invoice line %',line_no using errcode='22023';
  end if;
 end loop;
 if (select count(distinct lower(value->>'workId')) from jsonb_array_elements(lines))<>jsonb_array_length(lines) then raise exception 'A clean is on the invoice twice' using errcode='22023';end if;
 supplier_name:=private.workspace_required_text(input,'supplier',2,200);
 if input ? 'cleanerId' and jsonb_typeof(input->'cleanerId')<>'null' then
  if coalesce(input->>'cleanerId','')!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Choose a cleaner' using errcode='22023';end if;
  cleaner:=(input->>'cleanerId')::uuid;
  if not exists(select 1 from public.workspace_profiles p where p.user_id=cleaner and p.role='cleans') then raise exception 'Choose a cleaner' using errcode='22023';end if;
 end if;
 if jsonb_typeof(input->'totalMinor') is distinct from 'number' or input->>'totalMinor'!~'^\d{1,9}$' or (input->>'totalMinor')::bigint not between 1 and 100000000 then raise exception 'Enter the invoice total' using errcode='22023';end if;
 total:=(input->>'totalMinor')::bigint;
 select sum((value->>'amountMinor')::bigint) into sum_lines from jsonb_array_elements(lines);
 if sum_lines<>total then raise exception 'The invoice total must equal its lines' using errcode='22023';end if;
 if jsonb_typeof(input->'invoiceDate') is distinct from 'string' or input->>'invoiceDate'!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Enter the invoice date' using errcode='22023';end if;
 begin invoice_on:=(input->>'invoiceDate')::date; exception when others then raise exception 'Enter the invoice date' using errcode='22023'; end;
 if to_char(invoice_on,'YYYY-MM-DD')<>input->>'invoiceDate' or invoice_on>current_date or invoice_on<'2000-01-01'::date then raise exception 'Enter the invoice date' using errcode='22023';end if;
 if input ? 'note' and jsonb_typeof(input->'note')<>'null' and (jsonb_typeof(input->'note')<>'string' or length(input->>'note')>2000) then raise exception 'Invalid field note' using errcode='22023';end if;

 -- One invoice at a time, so "already on another invoice" is exact.
 perform pg_advisory_xact_lock(hashtextextended('workspace_cleaner_invoice_lines',0));
 for line in select value from jsonb_array_elements(lines) loop
  select x.* into w from public.workspace_work_items x join private.workspace_domain_details d on d.work_id=x.id where x.id=(line->>'workId')::uuid and d.kind='cleaning';
  if w.id is null or w.status in ('cancelled','declined') then raise exception 'Each line must be a clean on the schedule' using errcode='22023';end if;
  if not private.workspace_can_property(w.property_id,'cleans-invoices') then raise exception 'Property finance access denied' using errcode='42501';end if;
  if cleaner is not null and w.assignee_id is distinct from cleaner then raise exception 'The clean on % was not done by this cleaner',to_char(w.due_on,'DD/MM/YYYY') using errcode='22023';end if;
  if exists(select 1 from private.workspace_cleaner_invoice_lines l where l.work_id=w.id and l.live) then
   raise exception 'The clean on % is already on another invoice',to_char(w.due_on,'DD/MM/YYYY') using errcode='22023';
  end if;
 end loop;
 if exists(select 1 from private.workspace_cleaner_invoices i where lower(i.supplier)=lower(supplier_name) and lower(i.reference)=lower(trim(input->>'reference')) and i.status<>'rejected') then
  raise exception 'This invoice has already been recorded' using errcode='22023';
 end if;
 insert into private.workspace_cleaner_invoices(supplier,cleaner_id,reference,invoice_date,total_minor,note,created_by,request_id)
  values(supplier_name,cleaner,private.workspace_required_text(input,'reference',1,120),invoice_on,total,nullif(trim(coalesce(input->>'note','')),''),auth.uid(),(input->>'requestId')::uuid) returning * into inv;
 insert into private.workspace_cleaner_invoice_lines(invoice_id,work_id,property_id,amount_minor)
  select inv.id,w2.id,w2.property_id,(x->>'amountMinor')::bigint from jsonb_array_elements(lines) x join public.workspace_work_items w2 on w2.id=(x->>'workId')::uuid;
 -- No property on the activity: the invoice is the business's cost, never shown on an owner's feed.
 insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'finance.cleaner_invoice_recorded');
 return private.workspace_cleaner_invoice_view(inv);
end $$;

create or replace function private.workspace_decide_cleaner_invoice(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare inv private.workspace_cleaner_invoices;target text;
begin
 perform private.workspace_json_keys(input,array['action','requestId','invoiceId','version','decision','note']);
 if coalesce(input->>'decision','') not in ('approve','reject') then raise exception 'Choose approve or reject' using errcode='22023';end if;
 target:=case input->>'decision' when 'approve' then 'approved' else 'rejected' end;
 select * into inv from private.workspace_cleaner_invoices where id=(input->>'invoiceId')::uuid for update;
 if not found then raise exception 'Invoice not found' using errcode='P0002';end if;
 -- The same decision again changes nothing.
 if inv.status=target then return private.workspace_cleaner_invoice_view(inv);end if;
 if inv.status<>'to_approve' then raise exception 'This invoice has already been decided' using errcode='42501';end if;
 -- The version is optional; when sent, the invoice must not have changed since the screen loaded it.
 if input ? 'version' and inv.version is distinct from (input->>'version')::integer then raise exception 'Invoice changed' using errcode='40001';end if;
 if target='rejected' then
  update private.workspace_cleaner_invoices set status='rejected',decision_note=private.workspace_required_text(input,'note',5,2000),decided_by=auth.uid(),decided_at=now(),version=version+1,updated_at=now() where id=inv.id returning * into inv;
  -- Its cleans are free for a corrected invoice; their actual cost falls back to the cleaner's rate.
  update private.workspace_cleaner_invoice_lines set live=false where invoice_id=inv.id;
 else
  if input ? 'note' and jsonb_typeof(input->'note')<>'null' and (jsonb_typeof(input->'note')<>'string' or length(input->>'note')>2000) then raise exception 'Invalid field note' using errcode='22023';end if;
  update private.workspace_cleaner_invoices set status='approved',decision_note=nullif(trim(coalesce(input->>'note','')),''),decided_by=auth.uid(),decided_at=now(),version=version+1,updated_at=now() where id=inv.id returning * into inv;
 end if;
 insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'finance.cleaner_invoice_'||inv.status);
 return private.workspace_cleaner_invoice_view(inv);
end $$;

-- A day is locked once an issued or paid statement for the property covers it: the statement's own period, never
-- the rest of the month a shorter statement starts in. Until statements carry an end date (20261012100000), each is
-- the month it starts (as that migration backfills).
create or replace function private.workspace_statement_day_locked(prop uuid,day date) returns boolean language plpgsql stable security definer set search_path='' as $$
declare locked boolean;
begin
 if exists(select 1 from pg_catalog.pg_attribute a where a.attrelid='private.workspace_owner_statements'::regclass and a.attname='period_end' and not a.attisdropped) then
  execute 'select exists(select 1 from private.workspace_owner_statements s where s.property_id=$1 and s.status in (''issued'',''paid'') and s.period_start<=$2 and $2<coalesce(s.period_end,(s.period_start+interval ''1 month'')::date))'
   into locked using prop,day;
 else
  locked:=exists(select 1 from private.workspace_owner_statements s where s.property_id=prop and s.status in ('issued','paid')
   and s.period_start<=day and day<(s.period_start+interval '1 month')::date);
 end if;
 return coalesce(locked,false);
end $$;

create or replace function private.workspace_review_clean_cost(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare work uuid;st jsonb;note text;rv private.workspace_clean_cost_reviews;
begin
 perform private.workspace_json_keys(input,array['action','requestId','workId','decision','note']);
 work:=(input->>'workId')::uuid;
 if coalesce(input->>'decision','') not in ('agreed_fee','actual_cost') then raise exception 'Choose the agreed fee or the actual cost' using errcode='22023';end if;
 note:=private.workspace_required_text(input,'note',5,2000);
 perform 1 from public.workspace_work_items where id=work for update;
 st:=private.workspace_clean_review_state(work);
 if not (st->>'flagged')::boolean then raise exception 'Only a clean that cost more than agreed needs a review' using errcode='22023';end if;
 if private.workspace_statement_day_locked((st->>'propertyId')::uuid,(st->>'cleanDate')::date) then
  raise exception 'Void the issued statement before changing this clean' using errcode='42501';
 end if;
 select * into rv from private.workspace_clean_cost_reviews where work_id=work;
 -- The same review of the same cost changes nothing.
 if found and rv.decision=input->>'decision' and rv.note=note and rv.actual_cost_minor is not distinct from (st->>'actualMinor')::bigint then return st;end if;
 insert into private.workspace_clean_cost_reviews(work_id,decision,note,actual_cost_minor,agreed_minor,reviewed_by)
  values(work,input->>'decision',note,(st->>'actualMinor')::bigint,(st->>'agreedMinor')::bigint,auth.uid())
  on conflict(work_id) do update set decision=excluded.decision,note=excluded.note,actual_cost_minor=excluded.actual_cost_minor,agreed_minor=excluded.agreed_minor,
   reviewed_by=excluded.reviewed_by,reviewed_at=now(),version=private.workspace_clean_cost_reviews.version+1;
 insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'finance.clean_cost_reviewed');
 return private.workspace_clean_review_state(work);
end $$;

-- The payables router. Authority is checked before any receipt is replayed, so revoked access cannot reuse one.
create or replace function private.workspace_payables_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();a text;req uuid;prior private.workspace_action_receipts;result jsonb;prop uuid;
begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 if input is null or jsonb_typeof(input)<>'object' then raise exception 'Unknown or oversized workflow input' using errcode='22023';end if;
 a:=private.workspace_required_text(input,'action',1,50);
 if coalesce(input->>'requestId','')!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Request identifier required' using errcode='22023';end if;
 req:=(input->>'requestId')::uuid;
 if not private.workspace_finance_role() then raise exception 'Accounts access required' using errcode='42501';end if;
 if a in ('recordCleanerInvoice','decideCleanerInvoice') then
  if not private.has_workspace_module('cleans-invoices') then raise exception 'Accounts access required' using errcode='42501';end if;
  if a='decideCleanerInvoice' then
   if coalesce(input->>'invoiceId','')!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' or not exists(select 1 from private.workspace_cleaner_invoices where id=(input->>'invoiceId')::uuid) then raise exception 'Invoice not found' using errcode='P0002';end if;
   if exists(select 1 from private.workspace_cleaner_invoice_lines l where l.invoice_id=(input->>'invoiceId')::uuid and not private.workspace_can_property(l.property_id,'cleans-invoices')) then raise exception 'Property finance access denied' using errcode='42501';end if;
  end if;
 elsif a='reviewCleanCost' then
  if coalesce(input->>'workId','')!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Clean not found' using errcode='P0002';end if;
  select w.property_id into prop from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where w.id=(input->>'workId')::uuid and d.kind='cleaning';
  if prop is null then raise exception 'Clean not found' using errcode='P0002';end if;
  if not private.workspace_can_property(prop,'owner-statements') then raise exception 'Property finance access denied' using errcode='42501';end if;
 else raise exception 'Unknown payables action' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 select * into prior from private.workspace_action_receipts where actor_id=auth.uid() and request_id=req;
 if found then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;
 if a='recordCleanerInvoice' then result:=private.workspace_record_cleaner_invoice(input);
 elsif a='decideCleanerInvoice' then result:=private.workspace_decide_cleaner_invoice(input);
 else result:=private.workspace_review_clean_cost(input);
 end if;
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $$;
create or replace function public.workspace_payables_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.workspace_payables_action(input); $$;

-- 5. Statement terms, with the two new switches. Fields not sent keep their current values; the reply adds
-- the switches when the caller sent either, so older callers get the reply they know.
create or replace function private.workspace_set_statement_terms(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare prop uuid:=(input->>'propertyId')::uuid;amount bigint;f private.workspace_property_financials;vat boolean;mode text;result jsonb;
begin
 perform private.workspace_json_keys(input,array['action','requestId','propertyId','managementFeeBps','cleaningCostMinor','vatOnFee','cleanChargeMode']);
 if jsonb_typeof(input->'managementFeeBps') is distinct from 'number' or coalesce(input->>'managementFeeBps','')!~'^\d{1,5}$' or (input->>'managementFeeBps')::int>10000 then raise exception 'Invalid management fee' using errcode='22023';end if;
 amount:=private.workspace_money(input,'cleaningCostMinor');
 if amount>1000000 then raise exception 'Invalid cleaning cost' using errcode='22023';end if;
 if input ? 'vatOnFee' then
  if jsonb_typeof(input->'vatOnFee') is distinct from 'boolean' then raise exception 'Choose whether VAT is charged on the fee' using errcode='22023';end if;
  vat:=(input->>'vatOnFee')::boolean;
 end if;
 if input ? 'cleanChargeMode' then
  if coalesce(input->>'cleanChargeMode','') not in ('agreed_fee','actual_cost') then raise exception 'Choose how cleans are charged' using errcode='22023';end if;
  mode:=input->>'cleanChargeMode';
 end if;
 insert into private.workspace_property_financials(property_id,management_fee_bps,cleaning_cost_minor,vat_on_fee,clean_charge_mode)
  values(prop,(input->>'managementFeeBps')::int,amount,coalesce(vat,false),coalesce(mode,'agreed_fee'))
  on conflict(property_id) do update set management_fee_bps=excluded.management_fee_bps,cleaning_cost_minor=excluded.cleaning_cost_minor,
   vat_on_fee=coalesce(vat,private.workspace_property_financials.vat_on_fee),clean_charge_mode=coalesce(mode,private.workspace_property_financials.clean_charge_mode),updated_at=now()
  returning * into f;
 result:=jsonb_build_object('propertyId',prop,'managementFeeBps',f.management_fee_bps,'cleaningCostMinor',f.cleaning_cost_minor);
 if input ? 'vatOnFee' or input ? 'cleanChargeMode' then result:=result||jsonb_build_object('vatOnFee',f.vat_on_fee,'cleanChargeMode',f.clean_charge_mode,'vatRateBps',private.workspace_vat_bps());end if;
 insert into public.workspace_activity(actor_id,property_id,event_type) values(auth.uid(),prop,'finance.terms_updated');
 return result;
end $$;

-- 6. Finance reports (reached through public.workspace_finance_report after its finance-role checks).
-- 'cleanerInvoices': filters {status, cleanerId, region}; target_id one invoice; dates on the invoice date (inclusive);
-- target_property or region: invoices with a clean at that property or in that region. Up to 200, newest first.
create or replace function private.workspace_report_cleaner_invoices(target_property uuid,target_id uuid,from_on date,to_on date,filters jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare f_status text;f_cleaner uuid;f_region text;result jsonb;
begin
 if not private.has_workspace_module('cleans-invoices') then raise exception 'Accounts access required' using errcode='42501';end if;
 if jsonb_typeof(filters)='object' then
  if exists(select 1 from jsonb_object_keys(filters) k where k not in ('status','cleanerId','region')) then raise exception 'Invalid report filters' using errcode='22023';end if;
  f_status:=filters->>'status';f_region:=nullif(trim(filters->>'region'),'');
  if f_status is not null and f_status not in ('to_approve','approved','rejected') then raise exception 'Invalid report filters' using errcode='22023';end if;
  if filters->>'cleanerId' is not null then
   if filters->>'cleanerId'!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Invalid report filters' using errcode='22023';end if;
   f_cleaner:=(filters->>'cleanerId')::uuid;
  end if;
 end if;
 with base as (
  select i.* from private.workspace_cleaner_invoices i
  where (target_id is null or i.id=target_id) and (f_status is null or i.status=f_status) and (f_cleaner is null or i.cleaner_id=f_cleaner)
   and (from_on is null or i.invoice_date>=from_on) and (to_on is null or i.invoice_date<=to_on)
   and (target_property is null or exists(select 1 from private.workspace_cleaner_invoice_lines l where l.invoice_id=i.id and l.property_id=target_property))
   and (f_region is null or exists(select 1 from private.workspace_cleaner_invoice_lines l join public.workspace_properties p on p.id=l.property_id where l.invoice_id=i.id and lower(p.region)=lower(f_region)))
   -- Every property on the invoice must be one the reader can finance.
   and not exists(select 1 from private.workspace_cleaner_invoice_lines l where l.invoice_id=i.id and not private.workspace_can_property(l.property_id,'cleans-invoices'))
 ), page as (select * from base order by invoice_date desc,created_at desc,id limit 200)
 select jsonb_build_object('section','cleanerInvoices','count',(select count(*) from base),'more',(select count(*) from base)>200,
  'toApproveMinor',(select coalesce(sum(total_minor) filter(where status='to_approve'),0) from base),
  'invoices',coalesce((select jsonb_agg(private.workspace_cleaner_invoice_view(p) order by p.invoice_date desc,p.created_at desc,p.id) from page p),'[]'::jsonb)) into result;
 return result;
end $$;

-- 'cleansToReview': billable cleans (accepted and completed) that cost more than the agreed value, each with its state
-- ('flagged', 'reviewed' or 'stale'). filters {state: 'all' (default) | 'toReview' (flagged or stale) | 'reviewed', region};
-- dates on the clean's day (inclusive). Up to 500, in date order.
create or replace function private.workspace_report_cleans_to_review(target_property uuid,target_id uuid,from_on date,to_on date,filters jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare f_state text:='all';f_region text;result jsonb;
begin
 if jsonb_typeof(filters)='object' then
  if exists(select 1 from jsonb_object_keys(filters) k where k not in ('state','region')) then raise exception 'Invalid report filters' using errcode='22023';end if;
  f_state:=coalesce(filters->>'state','all');f_region:=nullif(trim(filters->>'region'),'');
  if f_state not in ('toReview','reviewed','all') then raise exception 'Invalid report filters' using errcode='22023';end if;
 end if;
 with base as (
  select private.workspace_clean_review_state(w.id) st,p.name property_name,(select x.full_name from public.workspace_profiles x where x.user_id=w.assignee_id) cleaner_name
  from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id join public.workspace_properties p on p.id=w.property_id
  where d.kind='cleaning' and d.data->>'phase'='accepted' and w.status='completed'
   and (target_property is null or w.property_id=target_property) and (target_id is null or w.id=target_id)
   and (f_region is null or lower(p.region)=lower(f_region))
   and (from_on is null or w.due_on>=from_on) and (to_on is null or w.due_on<=to_on)
   and private.workspace_can_property(w.property_id,'owner-statements')
 ), flagged as (
  select * from base where (st->>'flagged')::boolean
   and (f_state='all' or (f_state='toReview' and not (st->>'reviewed')::boolean) or (f_state='reviewed' and (st->>'reviewed')::boolean))
 )
 select jsonb_build_object('section','cleansToReview','count',(select count(*) from flagged),'more',(select count(*) from flagged)>500,
  'toReviewCount',(select count(*) from flagged where not (st->>'reviewed')::boolean),
  'cleans',coalesce((select jsonb_agg(st||jsonb_build_object('propertyName',property_name,'cleanerName',cleaner_name) order by st->>'cleanDate',st->>'workId')
   from (select * from flagged order by st->>'cleanDate',st->>'workId' limit 500) x),'[]'::jsonb)) into result;
 return result;
end $$;

revoke all on function private.workspace_vat_bps(),private.workspace_clean_cost(uuid),private.workspace_clean_review_state(uuid),private.workspace_statement_day_locked(uuid,date),
 private.workspace_cleaner_invoice_view(private.workspace_cleaner_invoices),private.workspace_record_cleaner_invoice(jsonb),
 private.workspace_decide_cleaner_invoice(jsonb),private.workspace_review_clean_cost(jsonb),private.workspace_payables_action(jsonb),
 private.workspace_set_statement_terms(jsonb),private.workspace_report_cleaner_invoices(uuid,uuid,date,date,jsonb),
 private.workspace_report_cleans_to_review(uuid,uuid,date,date,jsonb) from public,anon,authenticated;
-- The public wrapper runs as the caller, so the caller may execute the router (as the finance action).
grant execute on function private.workspace_payables_action(jsonb) to authenticated;
revoke all on function public.workspace_payables_action(jsonb) from public,anon,authenticated;
grant execute on function public.workspace_payables_action(jsonb) to authenticated;

-- 7. Patches to the live finance functions. Each anchor must occur exactly once; the marker says the patch is
-- already in place. A missing or repeated anchor stops the migration.
do $$
declare
 fixes constant text[][] := array[
  -- The plain "elsif a='setStatementTerms' then" line occurs twice (the access check and the dispatch), so
  -- the anchor includes the dispatch's json_keys line. The old branch is renamed and can never run.
  ['private.workspace_finance_action(jsonb)',
   $q$ elsif a='setStatementTerms' then
  perform private.workspace_json_keys(input,array['action','requestId','propertyId','managementFeeBps','cleaningCostMinor']);$q$,
   $q$ elsif a='setStatementTerms' then
  result:=private.workspace_set_statement_terms(input);

 elsif a='retired:setStatementTerms' then
  perform private.workspace_json_keys(input,array['action','requestId','propertyId','managementFeeBps','cleaningCostMinor']);$q$,
   $q$private.workspace_set_statement_terms(input)$q$],
  -- The statements list shows the new terms and the cleans in the month waiting for a review.
  ['private.workspace_finance_read(text,uuid,text,uuid,text)',
   $q$'terms',(select jsonb_build_object('managementFeeBps',f.management_fee_bps,'cleaningCostMinor',f.cleaning_cost_minor) from private.workspace_property_financials f where f.property_id=p.id),$q$,
   $q$'terms',(select jsonb_build_object('managementFeeBps',f.management_fee_bps,'cleaningCostMinor',f.cleaning_cost_minor,'vatOnFee',f.vat_on_fee,'cleanChargeMode',f.clean_charge_mode,'vatRateBps',private.workspace_vat_bps()) from private.workspace_property_financials f where f.property_id=p.id),
    'cleansToReview',(select count(*) from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
     where w.property_id=p.id and d.kind='cleaning' and d.data->>'phase'='accepted' and w.status='completed' and w.due_on>=start_on and w.due_on<end_on
     and (private.workspace_clean_review_state(w.id)->>'flagged')::boolean and not (private.workspace_clean_review_state(w.id)->>'reviewed')::boolean),$q$,
   $q$'cleanChargeMode',f.clean_charge_mode$q$]
 ];
 definition text;found_count integer;
 plain constant text := $q$elsif a='setStatementTerms' then$q$;
begin
 -- Why the anchor is two lines: before the patch the plain branch line is in the access check and the dispatch.
 definition := pg_get_functiondef('private.workspace_finance_action(jsonb)'::regprocedure);
 if position('private.workspace_set_statement_terms(input)' in definition) = 0 then
  found_count := (length(definition) - length(replace(definition, plain, ''))) / length(plain);
  if found_count <> 2 then raise exception 'Expected the plain setStatementTerms line twice, found %', found_count; end if;
 end if;
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
