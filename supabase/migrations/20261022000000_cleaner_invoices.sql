-- Cleaner invoices, part B of the cleaner process (owner Lee, from client Alex, 15 October 2026: "Just use any generic
-- invoice template"). Builds on what is there: private.workspace_cleaner_invoices and its lines (20261012090000), the
-- cleaner's rate and its history (20261009180000, 20261021500000), the cleaner's notices (private.workspace_clean_notify,
-- phone only since 20261021900000) and each role's Home (private.workspace_role_home, 20261021300000).
--
-- 1. Every accepted clean is recorded for pay (private.workspace_clean_earnings), whatever path accepted it: Guest
--    relations' or management's review, or a rejection overturned on dispute. A trigger on the clean's details fires when
--    its phase becomes 'accepted', so a rejected clean is recorded only once its redo is accepted. The cleaner's rate at
--    that moment is kept with it (the snapshot). A clean accepted before the cleaner has a rate waits, and takes the first
--    rate set for them.
-- 2. A pay period per cleaner, weekly (Monday to Sunday) by default or monthly (calendar month)
--    (private.workspace_cleaner_pay_periods), set by admins, super admins and Accounts with the Clean invoices tool, every
--    change kept in private.workspace_cleaner_pay_period_history like rates.
-- 3. At the end of each period, London time, private.workspace_cleaner_invoice_run(at) makes one invoice per cleaner with
--    the cleans accepted in that period (accepted before the period's end, on a day up to its end): status 'to_approve',
--    one line per clean at its snapshot rate, the total, and a number RC-CLN-YYYY-NNNN from a counter per year that only
--    ever goes up (private.workspace_cleaner_invoice_numbers). No invoice for a period with nothing accepted. A clean
--    accepted after its period ended is in the period it was accepted in, so it goes on the next invoice. A clean is never
--    on two invoices: the existing one-live-line-per-clean index holds, and a clean already on a live invoice (one Accounts
--    recorded by hand included) is never picked. The worker calls it hourly; a missed run catches up period by period.
--    Only cleans accepted from this migration on are recorded (no backfill): earlier ones stay with the existing
--    "Record cleaner invoice" flow, so nothing already paid by hand is invoiced again.
-- 4. Accounts (and admins): Approve, Query with a note back to the cleaner, and Mark paid with the paid date
--    (public.workspace_cleaner_pay_action). An invoice is due 7 days after it is issued. Approving also closes the clean's
--    "Invoice accepted property clean" task, as approving a recorded invoice does on screen. No bank details: none exist.
-- 5. Reads (public.workspace_cleaner_pay_read): 'invoices', 'invoice' (one, with its lines, for the invoice template),
--    'earnings' (paid this month and this year, waiting to be paid, and projected) and 'settings' (rates and periods).
--    Who sees what: a cleaner only their own; Accounts with the Clean invoices tool, admins and super admins everything; a
--    cleaning manager their own cleaners' invoices and earnings, read only; owners, Ready and Guest relations nothing.
-- 6. The cleaner's notices, through private.workspace_clean_notify (phone only): "Invoice RC-CLN-2026-0001 ready: £120.00
--    for 4 cleans", "Invoice approved: RC-CLN-2026-0001, £120.00", "Invoice RC-CLN-2026-0001 queried: <note>" and
--    "Paid: £120.00 (RC-CLN-2026-0001)". No property on these rows, so they never reach an owner's feed.
-- 7. Role Home (patched by anchor): cleaners get payPaidThisMonthMinor, payWaitingMinor and payProjectedMinor; Accounts
--    get cleanerInvoicesToApproveMinor, cleanerInvoicesToPay, cleanerInvoicesToPayMinor and cleanerInvoicesDueThisWeek.
--    Every existing key is unchanged.
--
-- Money is integer pence, GBP. Patches read the latest definition, need their anchor exactly once and are skipped once
-- their sentinel is present. Nothing is dropped or deleted. Safe to run twice.

-- 1. Accepted cleans, for pay -------------------------------------------------------------------------------------
create table if not exists private.workspace_clean_earnings (
 work_id uuid primary key references public.workspace_work_items(id),
 cleaner_id uuid not null references public.workspace_profiles(user_id),
 property_id uuid not null references public.workspace_properties(id),
 clean_on date not null,
 accepted_at timestamptz not null default now(),
 -- The cleaner's rate when the clean was accepted; null until they have one.
 rate_minor integer check(rate_minor between 1 and 100000),
 rate_set_at timestamptz
);
create index if not exists workspace_clean_earnings_cleaner_idx on private.workspace_clean_earnings(cleaner_id,accepted_at);
alter table private.workspace_clean_earnings enable row level security;
revoke all on private.workspace_clean_earnings from public,anon,authenticated;

create or replace function private.workspace_clean_accepted_earning() returns trigger language plpgsql security definer set search_path='' as $fn$
declare w public.workspace_work_items;
begin
 if new.kind<>'cleaning' or coalesce(new.data->>'phase','')<>'accepted' then return null;end if;
 if tg_op='UPDATE' and coalesce(old.data->>'phase','')='accepted' then return null;end if;
 select * into w from public.workspace_work_items where id=new.work_id;
 if w.id is null or w.assignee_id is null or w.property_id is null then return null;end if;
 if not exists(select 1 from public.workspace_profiles p where p.user_id=w.assignee_id and p.role='cleans') then return null;end if;
 insert into private.workspace_clean_earnings(work_id,cleaner_id,property_id,clean_on,accepted_at,rate_minor,rate_set_at)
 select w.id,w.assignee_id,w.property_id,coalesce(private.workspace_clean_day(w.id),(now() at time zone 'Europe/London')::date),now(),r.rate_minor,case when r.rate_minor is not null then now() end
 from (select 1) one left join private.workspace_cleaner_rates r on r.cleaner_id=w.assignee_id
 on conflict (work_id) do nothing;
 return null;
end $fn$;
create or replace trigger clean_accepted_earning after insert or update of data on private.workspace_domain_details
 for each row execute function private.workspace_clean_accepted_earning();

-- A clean accepted before the cleaner had a rate takes the first rate set for them (still not on an invoice).
create or replace function private.workspace_clean_earning_rate_fill() returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 update private.workspace_clean_earnings e set rate_minor=new.rate_minor,rate_set_at=now()
 where e.cleaner_id=new.cleaner_id and e.rate_minor is null
  and not exists(select 1 from private.workspace_cleaner_invoice_lines l where l.work_id=e.work_id and l.live);
 return null;
end $fn$;
create or replace trigger cleaner_rate_fills_earnings after insert or update of rate_minor on private.workspace_cleaner_rates
 for each row execute function private.workspace_clean_earning_rate_fill();

-- 2. Pay periods ---------------------------------------------------------------------------------------------------
create table if not exists private.workspace_cleaner_pay_periods (
 cleaner_id uuid primary key references public.workspace_profiles(user_id),
 period text not null default 'weekly' check(period in ('weekly','monthly')),
 version integer not null default 1 check(version>0),
 updated_by uuid not null references public.workspace_profiles(user_id),
 updated_at timestamptz not null default now()
);
alter table private.workspace_cleaner_pay_periods enable row level security;
revoke all on private.workspace_cleaner_pay_periods from public,anon,authenticated;

create table if not exists private.workspace_cleaner_pay_period_history (
 id bigint generated always as identity primary key,
 cleaner_id uuid not null references public.workspace_profiles(user_id),
 old_period text,
 new_period text not null,
 changed_by uuid not null references public.workspace_profiles(user_id),
 changed_at timestamptz not null default now()
);
create index if not exists workspace_cleaner_pay_period_history_cleaner_idx on private.workspace_cleaner_pay_period_history(cleaner_id,changed_at desc);
alter table private.workspace_cleaner_pay_period_history enable row level security;
revoke all on private.workspace_cleaner_pay_period_history from public,anon,authenticated;

create or replace function private.workspace_cleaner_pay_period_logged() returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 if tg_op='INSERT' or old.period is distinct from new.period then
  insert into private.workspace_cleaner_pay_period_history(cleaner_id,old_period,new_period,changed_by)
  values(new.cleaner_id,case when tg_op='UPDATE' then old.period else 'weekly' end,new.period,new.updated_by);
 end if;
 return null;
end $fn$;
create or replace trigger cleaner_pay_period_history after insert or update on private.workspace_cleaner_pay_periods
 for each row execute function private.workspace_cleaner_pay_period_logged();

-- 'weekly' (the default) or 'monthly'.
create or replace function private.workspace_cleaner_pay_period(cleaner uuid) returns text language sql stable security definer set search_path='' as $fn$
 select coalesce((select p.period from private.workspace_cleaner_pay_periods p where p.cleaner_id=cleaner),'weekly')
$fn$;
-- The first day of the period a day falls in, and the first day after it.
create or replace function private.workspace_pay_period_start(kind text,day date) returns date language sql immutable set search_path='' as $fn$
 select case when kind='monthly' then date_trunc('month',day)::date else date_trunc('week',day)::date end
$fn$;
create or replace function private.workspace_pay_period_after(kind text,start_on date) returns date language sql immutable set search_path='' as $fn$
 select case when kind='monthly' then (start_on+interval '1 month')::date else start_on+7 end
$fn$;
-- £1,234.50
create or replace function private.workspace_pounds(minor bigint) returns text language sql immutable set search_path='' as $fn$
 select '£'||to_char(coalesce(minor,0)/100.0,'FM999,999,999,990.00')
$fn$;

-- 3. Invoices made from accepted cleans --------------------------------------------------------------------------
create table if not exists private.workspace_cleaner_invoice_numbers (
 year integer primary key check(year between 2000 and 2999),
 last_number integer not null default 0 check(last_number>=0)
);
alter table private.workspace_cleaner_invoice_numbers enable row level security;
revoke all on private.workspace_cleaner_invoice_numbers from public,anon,authenticated;

alter table private.workspace_cleaner_invoices add column if not exists number text check(number ~ '^RC-CLN-\d{4}-\d{4,}$');
alter table private.workspace_cleaner_invoices add column if not exists generated boolean not null default false;
alter table private.workspace_cleaner_invoices add column if not exists period_kind text check(period_kind in ('weekly','monthly'));
alter table private.workspace_cleaner_invoices add column if not exists period_start date;
alter table private.workspace_cleaner_invoices add column if not exists period_end date;
alter table private.workspace_cleaner_invoices add column if not exists due_on date;
alter table private.workspace_cleaner_invoices add column if not exists query_note text check(length(query_note)<=2000);
alter table private.workspace_cleaner_invoices add column if not exists queried_by uuid references public.workspace_profiles(user_id);
alter table private.workspace_cleaner_invoices add column if not exists queried_at timestamptz;
alter table private.workspace_cleaner_invoices add column if not exists paid_on date;
alter table private.workspace_cleaner_invoices add column if not exists paid_by uuid references public.workspace_profiles(user_id);
alter table private.workspace_cleaner_invoices add column if not exists paid_at timestamptz;
create unique index if not exists workspace_cleaner_invoices_number_idx on private.workspace_cleaner_invoices(number) where number is not null;
-- One made invoice per cleaner and period (a rejected one frees its period and its cleans).
create unique index if not exists workspace_cleaner_invoices_period_idx on private.workspace_cleaner_invoices(cleaner_id,period_start,period_end) where generated and status<>'rejected';
create index if not exists workspace_cleaner_invoices_cleaner_idx on private.workspace_cleaner_invoices(cleaner_id,invoice_date desc);

-- Accepted cleans not on a live invoice and priced, for one cleaner, accepted before a moment and done before a day.
create or replace function private.workspace_clean_earnings_open(cleaner uuid,before_at timestamptz,before_day date) returns setof private.workspace_clean_earnings
language sql stable security definer set search_path='' as $fn$
 select e.* from private.workspace_clean_earnings e
 where e.cleaner_id=cleaner and e.rate_minor is not null and e.accepted_at<before_at and e.clean_on<before_day
  and not exists(select 1 from private.workspace_cleaner_invoice_lines l where l.work_id=e.work_id and l.live)
  and exists(select 1 from public.workspace_work_items w where w.id=e.work_id and w.status not in ('cancelled','declined'))
$fn$;

create or replace function private.workspace_cleaner_invoice_run(at_time timestamptz default now()) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare stamp timestamptz:=coalesce(at_time,now());today date:=(coalesce(at_time,now()) at time zone 'Europe/London')::date;
 c record;kind text;p_start date;p_after date;until_at timestamptz;made integer:=0;rounds integer;num integer;yr integer;ref text;inv private.workspace_cleaner_invoices;
 total bigint;cleans integer;who text;
begin
 -- One run at a time, and never alongside a hand-recorded invoice (the same lock), so "already on an invoice" is exact.
 perform pg_advisory_xact_lock(hashtextextended('workspace_cleaner_invoice_run',0));
 perform pg_advisory_xact_lock(hashtextextended('workspace_cleaner_invoice_lines',0));
 for c in select e.cleaner_id,min(e.accepted_at) first_at from private.workspace_clean_earnings e
  where e.rate_minor is not null and not exists(select 1 from private.workspace_cleaner_invoice_lines l where l.work_id=e.work_id and l.live)
  group by e.cleaner_id order by e.cleaner_id
 loop
  kind:=private.workspace_cleaner_pay_period(c.cleaner_id);
  p_start:=private.workspace_pay_period_start(kind,(c.first_at at time zone 'Europe/London')::date);
  rounds:=0;
  -- Each period that has ended (its last day is before today, London), oldest first.
  loop
   p_after:=private.workspace_pay_period_after(kind,p_start);
   exit when p_after>today or rounds>=120;
   rounds:=rounds+1;
   until_at:=p_after::timestamp at time zone 'Europe/London';
   select coalesce(sum(o.rate_minor),0),count(*) into total,cleans from private.workspace_clean_earnings_open(c.cleaner_id,until_at,p_after) o;
   if cleans>0 and not exists(select 1 from private.workspace_cleaner_invoices i where i.cleaner_id=c.cleaner_id and i.generated and i.status<>'rejected' and i.period_start=p_start and i.period_end=p_after-1) then
    yr:=extract(year from today)::integer;
    insert into private.workspace_cleaner_invoice_numbers(year,last_number) values(yr,1)
     on conflict(year) do update set last_number=private.workspace_cleaner_invoice_numbers.last_number+1 returning last_number into num;
    ref:='RC-CLN-'||yr||'-'||case when num<10000 then lpad(num::text,4,'0') else num::text end;
    who:=coalesce((select nullif(btrim(p.full_name),'') from public.workspace_profiles p where p.user_id=c.cleaner_id),'Cleaner');
    if length(who)<2 then who:='Cleaner '||who;end if;
    insert into private.workspace_cleaner_invoices(supplier,cleaner_id,reference,invoice_date,total_minor,created_by,request_id,number,generated,period_kind,period_start,period_end,due_on,created_at,updated_at)
     values(left(who,200),c.cleaner_id,ref,today,total,c.cleaner_id,gen_random_uuid(),ref,true,kind,p_start,p_after-1,today+7,stamp,stamp) returning * into inv;
    insert into private.workspace_cleaner_invoice_lines(invoice_id,work_id,property_id,amount_minor)
     select inv.id,o.work_id,o.property_id,o.rate_minor from private.workspace_clean_earnings_open(c.cleaner_id,until_at,p_after) o;
    perform private.workspace_clean_notify(c.cleaner_id,null,null,'cleaning.invoice_ready',
     'Invoice '||ref||' ready: '||private.workspace_pounds(total)||' for '||cleans||case when cleans=1 then ' clean' else ' cleans' end,false);
    made:=made+1;
   end if;
   p_start:=p_after;
  end loop;
 end loop;
 return jsonb_build_object('invoices',made);
end $fn$;
create or replace function public.workspace_cleaner_invoice_run() returns jsonb language sql security invoker set search_path='' as $fn$ select private.workspace_cleaner_invoice_run() $fn$;

-- 4. Who may see and act -----------------------------------------------------------------------------------------
-- Accounts with the Clean invoices tool, admins and super admins see every cleaner's pay; a cleaning manager their own
-- cleaners'; a cleaner their own. Nobody else.
create or replace function private.workspace_can_see_cleaner_pay(cleaner uuid) returns boolean language sql stable security definer set search_path='' as $fn$
 select case private.workspace_actor_role()
  when 'admin' then true when 'super_admin' then true
  when 'accounts' then private.has_workspace_module('cleans-invoices')
  when 'cleaning_manager' then cleaner is not null and private.workspace_manages_cleaner(cleaner)
  when 'cleans' then cleaner is not null and cleaner=auth.uid()
  else false end
$fn$;
create or replace function private.workspace_can_pay_cleaners() returns boolean language sql stable security definer set search_path='' as $fn$
 select coalesce(private.workspace_actor_role() in ('admin','super_admin') or (private.workspace_actor_role()='accounts' and private.has_workspace_module('cleans-invoices')),false)
$fn$;

-- One invoice as the screens and the invoice template show it.
create or replace function private.workspace_cleaner_pay_invoice(i private.workspace_cleaner_invoices,with_lines boolean) returns jsonb language sql stable security definer set search_path='' as $fn$
 select jsonb_build_object('id',i.id,'number',coalesce(i.number,i.reference),'reference',i.reference,'generated',i.generated,
  'cleanerId',i.cleaner_id,'cleanerName',coalesce((select nullif(btrim(p.full_name),'') from public.workspace_profiles p where p.user_id=i.cleaner_id),i.supplier),'supplier',i.supplier,
  'status',case when i.status='rejected' then 'rejected' when i.paid_on is not null then 'paid' else i.status end,
  'queried',i.status='to_approve' and i.queried_at is not null,'queryNote',i.query_note,'queriedAt',i.queried_at,
  'issueOn',i.invoice_date,'periodKind',i.period_kind,'periodStart',i.period_start,'periodEnd',i.period_end,'dueOn',coalesce(i.due_on,i.invoice_date+7),
  'approvedAt',case when i.status='approved' then i.decided_at end,'paidOn',i.paid_on,'totalMinor',i.total_minor,'currency',i.currency,'version',i.version,
  'lineCount',(select count(*) from private.workspace_cleaner_invoice_lines l where l.invoice_id=i.id and (l.live or i.status='rejected')))
  ||case when with_lines then jsonb_build_object('lines',coalesce((select jsonb_agg(jsonb_build_object('workId',l.work_id,'cleanOn',coalesce(e.clean_on,private.workspace_clean_day(l.work_id)),
     'propertyName',coalesce(nullif(btrim(pr.name),''),'Property'),'amountMinor',l.amount_minor)||coalesce(private.workspace_clean_times(l.work_id),'{}'::jsonb)
     order by coalesce(e.clean_on,private.workspace_clean_day(l.work_id)),pr.name,l.work_id)
    from private.workspace_cleaner_invoice_lines l join public.workspace_properties pr on pr.id=l.property_id left join private.workspace_clean_earnings e on e.work_id=l.work_id
    where l.invoice_id=i.id and (l.live or i.status='rejected')),'[]'::jsonb)) else '{}'::jsonb end
$fn$;

-- A cleaner's earnings: paid this month and this year (by the paid date, London), waiting to be paid (approved and to
-- approve, not paid), and projected for the current period: accepted cleans not on an invoice yet at their snapshot rate,
-- plus the cleans still to be accepted in the period at the current rate.
create or replace function private.workspace_cleaner_earnings(cleaner uuid,at_time timestamptz default now()) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare today date:=(coalesce(at_time,now()) at time zone 'Europe/London')::date;kind text:=private.workspace_cleaner_pay_period(cleaner);p_start date;p_after date;rate integer;
 accepted_minor bigint;accepted_count integer;unpriced integer;upcoming_count integer;result jsonb;
begin
 p_start:=private.workspace_pay_period_start(kind,today);p_after:=private.workspace_pay_period_after(kind,p_start);
 rate:=(select r.rate_minor from private.workspace_cleaner_rates r where r.cleaner_id=cleaner);
 select coalesce(sum(e.rate_minor),0),count(*) filter(where e.rate_minor is not null),count(*) filter(where e.rate_minor is null) into accepted_minor,accepted_count,unpriced
  from private.workspace_clean_earnings e where e.cleaner_id=cleaner and not exists(select 1 from private.workspace_cleaner_invoice_lines l where l.work_id=e.work_id and l.live)
   and exists(select 1 from public.workspace_work_items w where w.id=e.work_id and w.status not in ('cancelled','declined'));
 select count(*) into upcoming_count from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
  where d.kind='cleaning' and w.assignee_id=cleaner and w.status not in ('completed','cancelled','declined') and coalesce(d.data->>'phase','')<>'accepted'
   and w.due_on>=p_start and w.due_on<p_after and not exists(select 1 from private.workspace_clean_earnings e where e.work_id=w.id);
 select jsonb_build_object(
  'paidThisMonthMinor',coalesce(sum(i.total_minor) filter(where i.paid_on>=date_trunc('month',today)::date and i.paid_on<=today),0),
  'paidThisYearMinor',coalesce(sum(i.total_minor) filter(where i.paid_on>=date_trunc('year',today)::date and i.paid_on<=today),0),
  'waitingMinor',coalesce(sum(i.total_minor) filter(where i.paid_on is null and i.status in ('approved','to_approve')),0),
  'waitingApprovedMinor',coalesce(sum(i.total_minor) filter(where i.paid_on is null and i.status='approved'),0),
  'waitingToApproveMinor',coalesce(sum(i.total_minor) filter(where i.paid_on is null and i.status='to_approve'),0),
  'waitingCount',count(*) filter(where i.paid_on is null and i.status in ('approved','to_approve')))
  into result from private.workspace_cleaner_invoices i where i.cleaner_id=cleaner and i.status<>'rejected';
 return result||jsonb_build_object('cleanerId',cleaner,'periodKind',kind,'periodStart',p_start,'periodEnd',p_after-1,'rateMinor',rate,
  'acceptedNotInvoicedMinor',accepted_minor,'acceptedNotInvoicedCount',accepted_count,'unpricedCount',unpriced,
  'upcomingCount',upcoming_count,'upcomingMinor',case when rate is null then 0 else upcoming_count*rate end,
  'projectedMinor',accepted_minor+case when rate is null then 0 else upcoming_count*rate end);
end $fn$;

create or replace function private.workspace_cleaner_pay_read(section text,target_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();i private.workspace_cleaner_invoices;who uuid;
begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 if not (actor in ('cleans','cleaning_manager','admin','super_admin') or (actor='accounts' and private.has_workspace_module('cleans-invoices'))) then
  raise exception 'Cleaner pay access required' using errcode='42501';
 end if;
 if section='invoices' then
  -- target_id narrows to one cleaner. Newest first, up to 300.
  return coalesce((select jsonb_agg(private.workspace_cleaner_pay_invoice(x,false) order by x.invoice_date desc,x.created_at desc,x.id)
   from (select v.* from private.workspace_cleaner_invoices v
    where (target_id is null or v.cleaner_id=target_id) and (private.workspace_can_pay_cleaners() or (v.status<>'rejected' and private.workspace_can_see_cleaner_pay(v.cleaner_id)))
    order by v.invoice_date desc,v.created_at desc,v.id limit 300) x),'[]'::jsonb);
 elsif section='invoice' then
  select * into i from private.workspace_cleaner_invoices v where v.id=target_id;
  if i.id is null or not (private.workspace_can_pay_cleaners() or (i.status<>'rejected' and private.workspace_can_see_cleaner_pay(i.cleaner_id))) then raise exception 'Invoice not found' using errcode='P0002';end if;
  return private.workspace_cleaner_pay_invoice(i,true);
 elsif section='earnings' then
  who:=coalesce(target_id,case when actor='cleans' then auth.uid() end);
  if who is null or not private.workspace_can_see_cleaner_pay(who) or not exists(select 1 from public.workspace_profiles p where p.user_id=who and p.role='cleans') then raise exception 'Cleaner not found' using errcode='P0002';end if;
  return private.workspace_cleaner_earnings(who);
 elsif section='settings' then
  if actor='cleans' then raise exception 'Cleaner pay access required' using errcode='42501';end if;
  return jsonb_build_object('canEdit',private.workspace_can_pay_cleaners(),'cleaners',coalesce((select jsonb_agg(jsonb_build_object('cleanerId',p.user_id,'fullName',p.full_name,
    'rateMinor',r.rate_minor,'rateVersion',coalesce(r.version,0),'period',coalesce(pp.period,'weekly'),'periodVersion',coalesce(pp.version,0)) order by p.full_name,p.user_id)
   from public.workspace_profiles p left join private.workspace_cleaner_rates r on r.cleaner_id=p.user_id left join private.workspace_cleaner_pay_periods pp on pp.cleaner_id=p.user_id
   where p.role='cleans' and p.status='active' and private.workspace_can_see_cleaner_pay(p.user_id)),'[]'::jsonb));
 end if;
 raise exception 'Unknown cleaner pay section' using errcode='22023';
end $fn$;
create or replace function public.workspace_cleaner_pay_read(section text,target_id uuid default null) returns jsonb language sql security invoker set search_path='' as $fn$ select private.workspace_cleaner_pay_read(section,target_id) $fn$;

-- Approve, query, mark paid; and a cleaner's pay period. Admins, super admins and Accounts with the Clean invoices tool.
create or replace function private.workspace_cleaner_pay_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();a text;req uuid;prior private.workspace_action_receipts;result jsonb;i private.workspace_cleaner_invoices;
 cleaner uuid;paid date;today date:=(now() at time zone 'Europe/London')::date;query_text text;pp private.workspace_cleaner_pay_periods;
begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 if input is null or jsonb_typeof(input)<>'object' then raise exception 'Unknown or oversized workflow input' using errcode='22023';end if;
 a:=private.workspace_required_text(input,'action',1,50);
 if coalesce(input->>'requestId','')!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Request identifier required' using errcode='22023';end if;
 req:=(input->>'requestId')::uuid;
 if not private.workspace_can_pay_cleaners() then raise exception 'Only Accounts and admins can do this' using errcode='42501';end if;
 if a in ('approvePayInvoice','queryPayInvoice','markPayInvoicePaid') then
  if a='approvePayInvoice' then perform private.workspace_json_keys(input,array['action','requestId','invoiceId','version']);
  elsif a='queryPayInvoice' then perform private.workspace_json_keys(input,array['action','requestId','invoiceId','version','note']);
  else perform private.workspace_json_keys(input,array['action','requestId','invoiceId','version','paidOn']);end if;
  if coalesce(input->>'invoiceId','')!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' or not exists(select 1 from private.workspace_cleaner_invoices where id=(input->>'invoiceId')::uuid) then raise exception 'Invoice not found' using errcode='P0002';end if;
  if exists(select 1 from private.workspace_cleaner_invoice_lines l where l.invoice_id=(input->>'invoiceId')::uuid and not private.workspace_can_property(l.property_id,'cleans-invoices')) then raise exception 'Property finance access denied' using errcode='42501';end if;
 elsif a='setCleanerPayPeriod' then
  perform private.workspace_json_keys(input,array['action','requestId','cleanerId','period','version']);
 else raise exception 'Unknown cleaner pay action' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 select * into prior from private.workspace_action_receipts where actor_id=auth.uid() and request_id=req;
 if found then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;

 if a='setCleanerPayPeriod' then
  if coalesce(input->>'cleanerId','')!~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'Choose a cleaner' using errcode='22023';end if;
  cleaner:=(input->>'cleanerId')::uuid;
  if not exists(select 1 from public.workspace_profiles c where c.user_id=cleaner and c.role='cleans') then raise exception 'Only cleaners have a pay period' using errcode='22023';end if;
  if coalesce(input->>'period','') not in ('weekly','monthly') then raise exception 'Choose weekly or monthly' using errcode='22023';end if;
  if jsonb_typeof(input->'version') is distinct from 'number' or input->>'version'!~'^\d+$' then raise exception 'Pay period version required' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended('cleaner-pay-period:'||cleaner::text,0));
  if coalesce((select p.version from private.workspace_cleaner_pay_periods p where p.cleaner_id=cleaner),0)<>(input->>'version')::int then raise exception 'The pay period was changed by someone else. Refresh and try again' using errcode='40001';end if;
  insert into private.workspace_cleaner_pay_periods(cleaner_id,period,updated_by) values(cleaner,input->>'period',auth.uid())
   on conflict(cleaner_id) do update set period=excluded.period,version=private.workspace_cleaner_pay_periods.version+1,updated_by=excluded.updated_by,updated_at=now()
   returning * into pp;
  result:=jsonb_build_object('cleanerId',pp.cleaner_id,'period',pp.period,'version',pp.version);
  insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'cleaning.pay_period_set');
 else
  select * into i from private.workspace_cleaner_invoices where id=(input->>'invoiceId')::uuid for update;
  if jsonb_typeof(input->'version') is distinct from 'number' or i.version is distinct from (input->>'version')::integer then raise exception 'The invoice was changed by someone else. Refresh and try again' using errcode='40001';end if;
  if a='approvePayInvoice' then
   if i.status<>'to_approve' then raise exception 'Only an invoice waiting for approval can be approved' using errcode='42501';end if;
   if exists(select 1 from private.workspace_cleaner_invoice_lines l join private.workspace_domain_details d on d.work_id=l.work_id where l.invoice_id=i.id and l.live and d.kind='cleaning' and not private.workspace_clean_form_in(d.data)) then
    raise exception 'Every clean on this invoice needs its clean form before the invoice can be approved' using errcode='22023';
   end if;
   update private.workspace_cleaner_invoices set status='approved',decided_by=auth.uid(),decided_at=now(),version=version+1,updated_at=now() where id=i.id returning * into i;
   -- The cleans' "Invoice accepted property clean" tasks are done.
   update private.workspace_domain_details d set data=d.data||jsonb_build_object('workStatus','completed','invoiceId',i.id),updated_at=now()
    from public.workspace_work_items w where w.id=d.work_id and d.kind='cleaning_invoice' and w.status not in ('completed','cancelled')
     and d.data->>'sourceWorkId' in (select l.work_id::text from private.workspace_cleaner_invoice_lines l where l.invoice_id=i.id and l.live);
   update public.workspace_work_items w set status='completed',completed_at=now(),version=version+1,updated_at=now()
    from private.workspace_domain_details d where d.work_id=w.id and d.kind='cleaning_invoice' and w.status not in ('completed','cancelled')
     and d.data->>'sourceWorkId' in (select l.work_id::text from private.workspace_cleaner_invoice_lines l where l.invoice_id=i.id and l.live);
   perform private.workspace_clean_notify(i.cleaner_id,null,null,'cleaning.invoice_approved','Invoice approved: '||coalesce(i.number,i.reference)||', '||private.workspace_pounds(i.total_minor),false);
  elsif a='queryPayInvoice' then
   if i.status<>'to_approve' then raise exception 'Only an invoice waiting for approval can be queried' using errcode='42501';end if;
   query_text:=private.workspace_required_text(input,'note',5,2000);
   update private.workspace_cleaner_invoices set query_note=query_text,queried_by=auth.uid(),queried_at=now(),version=version+1,updated_at=now() where id=i.id returning * into i;
   perform private.workspace_clean_notify(i.cleaner_id,null,null,'cleaning.invoice_queried','Invoice '||coalesce(i.number,i.reference)||' queried: '||query_text,false);
  else
   if i.status<>'approved' or i.paid_on is not null then raise exception 'Only an approved invoice that is not paid yet can be marked paid' using errcode='42501';end if;
   if jsonb_typeof(input->'paidOn') is distinct from 'string' or input->>'paidOn'!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Enter the date it was paid' using errcode='22023';end if;
   begin paid:=(input->>'paidOn')::date; exception when others then raise exception 'Enter the date it was paid' using errcode='22023'; end;
   if to_char(paid,'YYYY-MM-DD')<>input->>'paidOn' or paid>today or paid<i.invoice_date then raise exception 'The paid date must be between the invoice date and today' using errcode='22023';end if;
   update private.workspace_cleaner_invoices set paid_on=paid,paid_by=auth.uid(),paid_at=now(),version=version+1,updated_at=now() where id=i.id returning * into i;
   perform private.workspace_clean_notify(i.cleaner_id,null,null,'cleaning.invoice_paid','Paid: '||private.workspace_pounds(i.total_minor)||' ('||coalesce(i.number,i.reference)||')',false);
  end if;
  -- No property: the invoice is the business's cost, never on an owner's feed.
  insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'finance.cleaner_invoice_'||case a when 'approvePayInvoice' then 'approved' when 'queryPayInvoice' then 'queried' else 'paid' end);
  result:=private.workspace_cleaner_pay_invoice(i,false);
 end if;
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $fn$;
create or replace function public.workspace_cleaner_pay_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $fn$ select private.workspace_cleaner_pay_action(input) $fn$;

-- 7. Role Home ---------------------------------------------------------------------------------------------------
do $patch$
declare
 fixes constant text[][] := array[
  ['private.workspace_role_home(text)',
   $q$||jsonb_build_object('toRespond',$q$,
   $q$||(select jsonb_build_object('payPaidThisMonthMinor',(x->>'paidThisMonthMinor')::bigint,'payWaitingMinor',(x->>'waitingMinor')::bigint,'payProjectedMinor',(x->>'projectedMinor')::bigint)
     -- Cleaner invoices (20261022000000): the cleaner's own pay.
     from (select private.workspace_cleaner_earnings(me) x) earned)
   ||jsonb_build_object('toRespond',$q$,
   $q$Cleaner invoices (20261022000000): the cleaner's own pay$q$],
  ['private.workspace_role_home(text)',
   $q$'cleanerInvoicesToApprove',(select count(*) from private.workspace_cleaner_invoices i where i.status='to_approve'),$q$,
   $q$'cleanerInvoicesToApprove',(select count(*) from private.workspace_cleaner_invoices i where i.status='to_approve'),
   -- Cleaner invoices (20261022000000): what waits for approval and payment, in pence.
   'cleanerInvoicesToApproveMinor',(select coalesce(sum(i.total_minor),0) from private.workspace_cleaner_invoices i where i.status='to_approve'),
   'cleanerInvoicesToPay',(select count(*) from private.workspace_cleaner_invoices i where i.status='approved' and i.paid_on is null),
   'cleanerInvoicesToPayMinor',(select coalesce(sum(i.total_minor),0) from private.workspace_cleaner_invoices i where i.status='approved' and i.paid_on is null),
   'cleanerInvoicesDueThisWeek',(select count(*) from private.workspace_cleaner_invoices i where i.status='approved' and i.paid_on is null and coalesce(i.due_on,i.invoice_date+7)<week_start+7),$q$,
   $q$Cleaner invoices (20261022000000): what waits for approval and payment$q$]
 ];
 definition text;hits integer;
begin
 for i in 1..array_length(fixes,1) loop
  definition:=pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in definition)=0 then
   hits:=(length(definition)-length(replace(definition,fixes[i][2],'')))/length(fixes[i][2]);
   if hits<>1 then raise exception 'Cleaner invoices patch %: anchor found % times in %',i,hits,fixes[i][1];end if;
   execute replace(definition,fixes[i][2],fixes[i][3]);
   if position(fixes[i][4] in pg_get_functiondef(fixes[i][1]::regprocedure))=0 then raise exception 'Cleaner invoices patch % did not take in %',i,fixes[i][1];end if;
  end if;
 end loop;
end $patch$;

-- Who may call what. The run is for the backend only; the reads and actions for signed-in people, checked inside.
revoke all on function private.workspace_clean_accepted_earning(),private.workspace_clean_earning_rate_fill(),private.workspace_cleaner_pay_period_logged(),
 private.workspace_cleaner_pay_period(uuid),private.workspace_pay_period_start(text,date),private.workspace_pay_period_after(text,date),private.workspace_pounds(bigint),
 private.workspace_clean_earnings_open(uuid,timestamptz,date),private.workspace_cleaner_invoice_run(timestamptz),public.workspace_cleaner_invoice_run(),
 private.workspace_can_see_cleaner_pay(uuid),private.workspace_can_pay_cleaners(),private.workspace_cleaner_pay_invoice(private.workspace_cleaner_invoices,boolean),
 private.workspace_cleaner_earnings(uuid,timestamptz),private.workspace_cleaner_pay_read(text,uuid),public.workspace_cleaner_pay_read(text,uuid),
 private.workspace_cleaner_pay_action(jsonb),public.workspace_cleaner_pay_action(jsonb) from public,anon,authenticated;
grant execute on function private.workspace_cleaner_invoice_run(timestamptz),public.workspace_cleaner_invoice_run() to service_role;
-- The public wrappers run as the caller, so the caller may execute the private function they call.
grant execute on function private.workspace_cleaner_pay_read(text,uuid),public.workspace_cleaner_pay_read(text,uuid),
 private.workspace_cleaner_pay_action(jsonb),public.workspace_cleaner_pay_action(jsonb) to authenticated;
