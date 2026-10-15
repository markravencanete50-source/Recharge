-- VA pay and the monthly Request for Invoice (owner Lee, 15 October 2026: a VA's pay is "their bonuses and monthly
-- payment", "this should be visible on the Management team"; then: VA pay is in US dollars and per hour). A Request for
-- Invoice is Recharge telling the VA: "please invoice us for this amount".
--
-- Who the VAs are (private.workspace_va_area): the admin and Stays team. Exactly: a profile whose role is not client,
-- cleans or super_admin, and who is an admin or whose KPI area is guest_relations, client_relations, accounts or
-- management. The KPI area is the KPI tracker's (private.workspace_kpi_area, 20261015100000): the rota department
-- (private.workspace_staff_rota), else the role's area (stays is guest_relations, accounts is accounts, admin is
-- management). Cleaners, cleaning managers and Ready are VAs only if the rota puts them in one of those four
-- departments; owners (client) and super admins never are.
--
-- Who manages VA pay (private.workspace_va_pay_manager): admins and super admins, and VAs whose KPI area is management,
-- the same "management area" the KPI tracker's combined management measure uses (20261016310000). They see every VA's
-- pay setup and requests and act on them, never on their own: nobody edits their own pay or issues, approves, adjusts, rejects
-- or marks paid their own request. Every other VA sees only their own requests, read only. Nobody else (other roles,
-- owners, Ready, cleaners, guests) sees any of it.
--
-- 1. Pay setup per VA (private.workspace_va_pay_settings): an hourly rate in US cents (null: not set, so no request),
--    and a bonus in US cents for each KPI tier the VA can reach: at the target, at tier 2 and at tier 3. Currency is
--    USD for every VA. Each change is version-checked and kept whole in private.workspace_va_pay_settings_history with
--    who and when.
-- 2. The bonus rule. The VA's area has one bonus KPI (counts_for_bonus, the KPI tracker). Its value for the VA and the
--    month comes from the KPI tracker's own functions (private.workspace_kpi_person_value, then
--    private.workspace_kpi_result for the target and tier); nothing is worked out again here. The KPI tracker numbers
--    the tiers beyond the target 1, 2...; here they are tier 2 and tier 3, the target being the first:
--      on target, no tier beyond it          the "at target" amount
--      first tier beyond the target           the "tier 2" amount
--      second tier beyond it (or higher)      the "tier 3" amount
--    Only the highest tier reached pays; the amounts never add up. Below the target, or nothing to measure, no bonus.
--    The management area's bonus KPI is the combined Guest relations and Client relations measure, which normally
--    answers only a signed-in manager; the monthly run (no signed-in user) is let through with a transaction setting
--    that only the run sets (patch below).
-- 3. The monthly run, private.workspace_va_pay_run(at): on the 1st of each month (London), for the month just ended,
--    one request per VA who has an hourly rate and clocked time in that month. A missed day catches up until the 7th.
--    Hours come from the timesheet's shifts as they stand (an admin's correction changes the shift itself): each shift
--    that started in the month and is clocked out, minus its unpaid pauses (private.workspace_shift_unpaid_minutes, the
--    function the timesheet uses). A shift still open is left out. Minutes are rounded per day, as the timesheet shows
--    them, and the month is the sum of the days. Hours amount = minutes x hourly rate / 60, rounded to the nearest cent
--    (half a cent rounds up). The rate and bonus amounts are those in force at the end of the month (the latest history
--    row before it), else the current ones. One request per VA per month is enforced by a unique key (va_id,
--    period_start), so the run is safe to repeat. Numbered RC-VA-YYYY-NNNN (issue year) from a counter that only goes up.
--    Status to_approve; due 7 days after the issue date.
-- 4. Management: issue now (the run's work for one VA and one chosen month that has ended, within two years, when it
--    has no request yet: same unique key, numbering and history line, version-checked against the VA's pay setup),
--    approve (then due on the due date), query with a note (shown to the VA), adjust before approval with a
--    reason (an hours correction in minutes and/or the bonus amount; null puts the bonus back to the KPI's), reject with
--    a note, and mark paid with the paid date. Each is version-checked and recorded in
--    private.workspace_va_pay_request_changes with who, when and the reason.
-- 5. Notices: the VA is told in the app when their request is approved, paid, queried (with the note) or rejected (with
--    the reason): vapay.request_approved, vapay.request_paid, vapay.request_queried, vapay.request_rejected. In the app only: the email, phone and web push claims skip vapay notices (patches below).
-- 6. Reads, public.workspace_va_pay_read(section, target): 'access', 'requests', 'request', 'setup'. Actions,
--    public.workspace_va_pay_action(input): saveVaPay, issueVaRequest, approveVaRequest, queryVaRequest, adjustVaRequest,
--    rejectVaRequest, markVaRequestPaid. The run, public.workspace_va_pay_run(): service_role only (the worker, hourly).
--
-- Money is integer US cents. Patches read the latest definition, need their anchor exactly once (kept at the start of
-- the replacement) and are skipped once their sentinel is present. Nothing is dropped or deleted. Safe to run twice.
-- Does not use the cleaner invoice tables.

-- 1. Pay setup ------------------------------------------------------------------------------------------------------
create table if not exists private.workspace_va_pay_settings (
 user_id uuid primary key references public.workspace_profiles(user_id),
 currency text not null default 'USD' check(currency='USD'),
 hourly_rate_minor integer check(hourly_rate_minor between 1 and 100000),
 bonus_target_minor integer not null default 0 check(bonus_target_minor between 0 and 10000000),
 bonus_tier2_minor integer not null default 0 check(bonus_tier2_minor between 0 and 10000000),
 bonus_tier3_minor integer not null default 0 check(bonus_tier3_minor between 0 and 10000000),
 version integer not null default 1 check(version>0),
 updated_by uuid not null references public.workspace_profiles(user_id),
 updated_at timestamptz not null default now()
);
create index if not exists workspace_va_pay_settings_updated_by_idx on private.workspace_va_pay_settings(updated_by);
alter table private.workspace_va_pay_settings enable row level security;
revoke all on private.workspace_va_pay_settings from public,anon,authenticated;

create table if not exists private.workspace_va_pay_settings_history (
 id bigint generated always as identity primary key,
 user_id uuid not null references public.workspace_profiles(user_id),
 before jsonb,
 after jsonb not null,
 changed_by uuid not null references public.workspace_profiles(user_id),
 changed_at timestamptz not null default now()
);
create index if not exists workspace_va_pay_settings_history_user_idx on private.workspace_va_pay_settings_history(user_id,changed_at desc);
create index if not exists workspace_va_pay_settings_history_by_idx on private.workspace_va_pay_settings_history(changed_by);
alter table private.workspace_va_pay_settings_history enable row level security;
revoke all on private.workspace_va_pay_settings_history from public,anon,authenticated;

-- 3. Requests -------------------------------------------------------------------------------------------------------
create table if not exists private.workspace_va_pay_numbers (
 year integer primary key check(year between 2000 and 2999),
 last_number integer not null default 0 check(last_number>=0)
);
alter table private.workspace_va_pay_numbers enable row level security;
revoke all on private.workspace_va_pay_numbers from public,anon,authenticated;

create table if not exists private.workspace_va_pay_requests (
 id uuid primary key default gen_random_uuid(),
 number text not null unique check(number ~ '^RC-VA-\d{4}-\d{4,}$'),
 va_id uuid not null references public.workspace_profiles(user_id),
 va_name text not null check(length(va_name) between 1 and 200),
 area text,
 period_start date not null check(extract(day from period_start)=1),
 period_end date not null check(period_end>=period_start),
 currency text not null default 'USD' check(currency='USD'),
 hourly_rate_minor integer not null check(hourly_rate_minor between 1 and 100000),
 worked_minutes integer not null check(worked_minutes>=0),
 days jsonb not null default '[]'::jsonb,
 hours_adjust_minutes integer not null default 0 check(hours_adjust_minutes between -44640 and 44640),
 hours_adjust_reason text check(length(hours_adjust_reason)<=500),
 hours_minor bigint not null check(hours_minor>=0),
 kpi_id uuid references private.workspace_kpis(id),
 kpi_name text,
 kpi_value integer,
 kpi_tier text check(kpi_tier in ('target','tier2','tier3')),
 bonus_auto_minor bigint not null default 0 check(bonus_auto_minor>=0),
 bonus_adjusted_minor bigint check(bonus_adjusted_minor>=0),
 bonus_adjust_reason text check(length(bonus_adjust_reason)<=500),
 total_minor bigint not null check(total_minor>=0),
 status text not null default 'to_approve' check(status in ('to_approve','approved','paid','rejected')),
 issue_on date not null,
 due_on date not null,
 query_note text check(length(query_note)<=2000),
 queried_by uuid references public.workspace_profiles(user_id),
 queried_at timestamptz,
 approved_by uuid references public.workspace_profiles(user_id),
 approved_at timestamptz,
 rejected_by uuid references public.workspace_profiles(user_id),
 rejected_at timestamptz,
 reject_note text check(length(reject_note)<=2000),
 paid_on date,
 paid_by uuid references public.workspace_profiles(user_id),
 paid_at timestamptz,
 version integer not null default 1 check(version>0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(worked_minutes+hours_adjust_minutes>=0),
 check((status='paid')=(paid_on is not null))
);
-- The run's key: one request per VA per month.
create unique index if not exists workspace_va_pay_requests_month_idx on private.workspace_va_pay_requests(va_id,period_start);
create index if not exists workspace_va_pay_requests_status_idx on private.workspace_va_pay_requests(status,issue_on);
create index if not exists workspace_va_pay_requests_kpi_idx on private.workspace_va_pay_requests(kpi_id);
create index if not exists workspace_va_pay_requests_queried_by_idx on private.workspace_va_pay_requests(queried_by);
create index if not exists workspace_va_pay_requests_approved_by_idx on private.workspace_va_pay_requests(approved_by);
create index if not exists workspace_va_pay_requests_rejected_by_idx on private.workspace_va_pay_requests(rejected_by);
create index if not exists workspace_va_pay_requests_paid_by_idx on private.workspace_va_pay_requests(paid_by);
alter table private.workspace_va_pay_requests enable row level security;
revoke all on private.workspace_va_pay_requests from public,anon,authenticated;

create table if not exists private.workspace_va_pay_request_changes (
 id bigint generated always as identity primary key,
 request_id uuid not null references private.workspace_va_pay_requests(id),
 change text not null check(change in ('issued','queried','adjusted','approved','rejected','paid')),
 reason text check(length(reason)<=2000),
 before jsonb,
 after jsonb not null,
 changed_by uuid references public.workspace_profiles(user_id),
 changed_at timestamptz not null default now()
);
create index if not exists workspace_va_pay_request_changes_request_idx on private.workspace_va_pay_request_changes(request_id,changed_at);
create index if not exists workspace_va_pay_request_changes_by_idx on private.workspace_va_pay_request_changes(changed_by);
alter table private.workspace_va_pay_request_changes enable row level security;
revoke all on private.workspace_va_pay_request_changes from public,anon,authenticated;

-- Who is a VA, and their KPI area; null when they are not a VA (see the header).
create or replace function private.workspace_va_area(target uuid) returns text language sql stable security definer set search_path='' as $fn$
 select x.area from (select p.role,private.workspace_kpi_area(p.role,r.department) area from public.workspace_profiles p
   left join private.workspace_staff_rota r on r.user_id=p.user_id where p.user_id=target) x
 where x.role not in ('client','cleans','super_admin') and (x.role='admin' or x.area in ('guest_relations','client_relations','accounts','management'))
$fn$;
create or replace function private.workspace_is_va(target uuid) returns boolean language sql stable security definer set search_path='' as $fn$
 select target is not null and private.workspace_va_area(target) is not null
$fn$;
-- Admins, super admins, and VAs whose KPI area is management (signed in and active).
create or replace function private.workspace_va_pay_manager() returns boolean language sql stable security definer set search_path='' as $fn$
 select coalesce(private.workspace_actor_role() in ('admin','super_admin')
  or (private.workspace_actor_role() is not null and private.workspace_va_area(auth.uid())='management'),false)
$fn$;
-- $1,234.50
create or replace function private.workspace_usd(minor bigint) returns text language sql immutable set search_path='' as $fn$
 select '$'||to_char(coalesce(minor,0)/100.0,'FM999,999,999,990.00')
$fn$;
-- The hours amount: minutes x hourly rate / 60, rounded to the nearest cent, half a cent up (numeric round).
create or replace function private.workspace_va_hours_minor(minutes integer,rate_minor integer) returns bigint language sql immutable set search_path='' as $fn$
 select round(greatest(coalesce(minutes,0),0)::numeric*coalesce(rate_minor,0)/60)::bigint
$fn$;
-- The bonus rule. kpi_tier's "tier" counts the tiers beyond the target (1 is the first). The highest tier reached pays,
-- alone: tier3 for the second tier beyond the target or higher, tier2 for the first, target for on target, else none.
create or replace function private.workspace_va_bonus_tier(result jsonb) returns text language sql immutable set search_path='' as $fn$
 select case when result->>'value' is null then null
  when coalesce((result->>'tier')::int,0)>=2 then 'tier3' when coalesce((result->>'tier')::int,0)=1 then 'tier2'
  when coalesce((result->>'onTarget')::boolean,false) then 'target' end
$fn$;
create or replace function private.workspace_va_bonus_amount(tier text,s jsonb) returns bigint language sql immutable set search_path='' as $fn$
 select coalesce(case tier when 'tier3' then (s->>'bonus_tier3_minor')::bigint when 'tier2' then (s->>'bonus_tier2_minor')::bigint
  when 'target' then (s->>'bonus_target_minor')::bigint end,0)
$fn$;

-- One request for one VA and one month: the work of the monthly run and of management's "Issue now". Returns the new
-- request, or null when there is nothing to issue (already requested, not a VA, no hourly rate in force, or no clocked
-- time in the month). `replies` are the month's guest waits (private.workspace_kpi_reply_rows); null reads them here.
-- `issued_by` is who issued it by hand (null for the run), kept on the history line; issued by hand, each of those
-- cases raises a plain message instead of returning null.
create or replace function private.workspace_va_pay_issue(va uuid,p_start date,issue_on date,stamp timestamptz,replies jsonb default null,issued_by uuid default null)
returns private.workspace_va_pay_requests language plpgsql security definer set search_path='' as $fn$
declare p_end date:=(p_start+interval '1 month'-interval '1 day')::date;lower_at timestamptz;upper_at timestamptz;va_area text:=private.workspace_va_area(va);
 s jsonb;days jsonb;worked integer;k private.workspace_kpis;res jsonb;tier text;bonus bigint:=0;hours bigint;num integer;yr integer;ref text;req private.workspace_va_pay_requests;
begin
 if va_area is null then
  if issued_by is null then return null;end if;
  raise exception 'Only VAs have VA pay' using errcode='22023';
 end if;
 if exists(select 1 from private.workspace_va_pay_requests q where q.va_id=va and q.period_start=p_start) then
  if issued_by is null then return null;end if;
  raise exception 'There is already a request for that month' using errcode='23505';
 end if;
 lower_at:=p_start::timestamp at time zone 'Europe/London';upper_at:=(p_end+1)::timestamp at time zone 'Europe/London';
 -- The rate and bonus amounts in force at the end of the month, else the current ones.
 s:=coalesce((select h.after from private.workspace_va_pay_settings_history h where h.user_id=va and h.changed_at<upper_at order by h.changed_at desc,h.id desc limit 1),
  (select to_jsonb(x) from private.workspace_va_pay_settings x where x.user_id=va));
 if s is null or s->>'hourly_rate_minor' is null then
  if issued_by is null then return null;end if;
  raise exception 'Set an hourly rate first: there was none at the end of that month' using errcode='22023';
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('day',d.day,'minutes',d.minutes) order by d.day),'[]'::jsonb),coalesce(sum(d.minutes),0)::int into days,worked
 from (select (h.clocked_in_at at time zone 'Europe/London')::date as day,
   round(sum(extract(epoch from h.clocked_out_at-h.clocked_in_at)/60-private.workspace_shift_unpaid_minutes(h.id)))::int minutes
  from private.workspace_shifts h where h.user_id=va and h.clocked_out_at is not null and h.clocked_in_at>=lower_at and h.clocked_in_at<upper_at
  group by 1) d where d.minutes>0;
 if worked<=0 then
  if issued_by is null then return null;end if;
  raise exception 'No clocked time in that month' using errcode='22023';
 end if;
 hours:=private.workspace_va_hours_minor(worked,(s->>'hourly_rate_minor')::int);
 -- The bonus: the VA's own value for their area's bonus KPI, from the KPI tracker's functions.
 select * into k from private.workspace_kpis x where x.area=va_area and x.counts_for_bonus and x.active order by x.sort_order,x.created_at limit 1;
 if k.id is not null then
  replies:=coalesce(replies,(select jsonb_agg(jsonb_build_object('u',x.user_id,'m',x.minutes,'a',x.answered)) from private.workspace_kpi_reply_rows(lower_at,upper_at) x),'[]'::jsonb);
  res:=private.workspace_kpi_result(k,private.workspace_kpi_person_value(k.measure,k.minutes,va,p_start,p_end,
   (select coalesce(jsonb_agg(e),'[]'::jsonb) from jsonb_array_elements(replies) e where e->>'u'=va::text)));
  tier:=private.workspace_va_bonus_tier(res);
  bonus:=private.workspace_va_bonus_amount(tier,s);
 end if;
 yr:=extract(year from issue_on)::integer;
 insert into private.workspace_va_pay_numbers(year,last_number) values(yr,1)
  on conflict(year) do update set last_number=private.workspace_va_pay_numbers.last_number+1 returning last_number into num;
 ref:='RC-VA-'||yr||'-'||case when num<10000 then lpad(num::text,4,'0') else num::text end;
 insert into private.workspace_va_pay_requests(number,va_id,va_name,area,period_start,period_end,hourly_rate_minor,worked_minutes,days,hours_minor,
   kpi_id,kpi_name,kpi_value,kpi_tier,bonus_auto_minor,total_minor,issue_on,due_on,created_at,updated_at)
  values(ref,va,left(coalesce(nullif(btrim((select p.full_name from public.workspace_profiles p where p.user_id=va)),''),'VA'),200),va_area,p_start,p_end,
   (s->>'hourly_rate_minor')::int,worked,days,hours,k.id,k.name,(res->>'value')::int,tier,bonus,hours+bonus,issue_on,issue_on+7,stamp,stamp)
  on conflict (va_id,period_start) do nothing returning * into req;
 if req.id is not null then
  insert into private.workspace_va_pay_request_changes(request_id,change,reason,after,changed_by)
   values(req.id,'issued',case when issued_by is not null then 'Issued now by management' end,to_jsonb(req),issued_by);
 end if;
 return req;
end $fn$;

-- The run (service_role, hourly from the worker). See the header, part 3.
create or replace function private.workspace_va_pay_run(at_time timestamptz default now()) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare stamp timestamptz:=coalesce(at_time,now());today date:=(coalesce(at_time,now()) at time zone 'Europe/London')::date;
 p_start date;replies jsonb;v record;made integer:=0;
begin
 perform pg_advisory_xact_lock(hashtextextended('workspace_va_pay_run',0));
 -- The 1st of the month, catching up to the 7th.
 if extract(day from today)>7 then return jsonb_build_object('requests',0);end if;
 p_start:=(date_trunc('month',today)-interval '1 month')::date;
 -- The combined management measure answers this run (no signed-in user), for this transaction only.
 perform set_config('recharge.va_pay_run','on',true);
 replies:=coalesce((select jsonb_agg(jsonb_build_object('u',x.user_id,'m',x.minutes,'a',x.answered))
  from private.workspace_kpi_reply_rows(p_start::timestamp at time zone 'Europe/London',(date_trunc('month',today))::timestamp at time zone 'Europe/London') x),'[]'::jsonb);
 for v in select p.user_id from public.workspace_profiles p
  where private.workspace_is_va(p.user_id) and not exists(select 1 from private.workspace_va_pay_requests q where q.va_id=p.user_id and q.period_start=p_start)
  order by p.user_id
 loop
  if (private.workspace_va_pay_issue(v.user_id,p_start,today,stamp,replies,null)).id is not null then made:=made+1;end if;
 end loop;
 return jsonb_build_object('requests',made,'periodStart',p_start,'periodEnd',(date_trunc('month',today)-interval '1 day')::date);
end $fn$;
create or replace function public.workspace_va_pay_run() returns jsonb language sql security invoker set search_path='' as $fn$ select private.workspace_va_pay_run() $fn$;

-- 6. Reads ----------------------------------------------------------------------------------------------------------
-- One request as the screens and the document show it. The changes (with reasons and names) are for management only.
create or replace function private.workspace_va_pay_request_view(q private.workspace_va_pay_requests,full_view boolean,manager boolean) returns jsonb
language sql stable security definer set search_path='' as $fn$
 select jsonb_build_object('id',q.id,'number',q.number,'vaId',q.va_id,'vaName',q.va_name,'area',q.area,'periodStart',q.period_start,'periodEnd',q.period_end,
  'status',q.status,'queried',q.status='to_approve' and q.queried_at is not null,'queryNote',q.query_note,'queriedAt',q.queried_at,
  'issueOn',q.issue_on,'dueOn',q.due_on,'approvedAt',q.approved_at,'paidOn',q.paid_on,'rejectNote',q.reject_note,'currency',q.currency,
  'hourlyRateMinor',q.hourly_rate_minor,'workedMinutes',q.worked_minutes,'hoursAdjustMinutes',q.hours_adjust_minutes,'hoursAdjustReason',q.hours_adjust_reason,
  'minutes',q.worked_minutes+q.hours_adjust_minutes,'hoursMinor',q.hours_minor,
  'kpiName',q.kpi_name,'kpiValue',q.kpi_value,'kpiTier',q.kpi_tier,'bonusAutoMinor',q.bonus_auto_minor,'bonusAdjusted',q.bonus_adjusted_minor is not null,
  'bonusAdjustReason',q.bonus_adjust_reason,'bonusMinor',coalesce(q.bonus_adjusted_minor,q.bonus_auto_minor),'totalMinor',q.total_minor,'version',q.version,
  'own',q.va_id=auth.uid())
  ||case when full_view then jsonb_build_object('days',q.days) else '{}'::jsonb end
  ||case when full_view and manager then jsonb_build_object('changes',coalesce((select jsonb_agg(jsonb_build_object('change',c.change,'reason',c.reason,'changedAt',c.changed_at,
    'changedByName',coalesce((select p.full_name from public.workspace_profiles p where p.user_id=c.changed_by),'Automatic')) order by c.changed_at,c.id)
   from private.workspace_va_pay_request_changes c where c.request_id=q.id),'[]'::jsonb)) else '{}'::jsonb end
$fn$;

create or replace function private.workspace_va_pay_read(section text,target_id uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();manager boolean;va boolean;q private.workspace_va_pay_requests;
begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 manager:=private.workspace_va_pay_manager();va:=actor<>'client' and private.workspace_is_va(auth.uid());
 if section='access' then
  return jsonb_build_object('canManage',manager,'isVa',va);
 end if;
 if not (manager or va) then raise exception 'VA pay access required' using errcode='42501';end if;
 if section='requests' then
  -- target_id narrows to one VA. Newest first, up to 500.
  return coalesce((select jsonb_agg(private.workspace_va_pay_request_view(x,false,manager) order by x.period_start desc,x.va_name,x.id)
   from (select r.* from private.workspace_va_pay_requests r where (manager or r.va_id=auth.uid()) and (target_id is null or r.va_id=target_id)
    order by r.period_start desc,r.va_name,r.id limit 500) x),'[]'::jsonb);
 elsif section='request' then
  select * into q from private.workspace_va_pay_requests r where r.id=target_id;
  if q.id is null or not (manager or q.va_id=auth.uid()) then raise exception 'Request not found' using errcode='P0002';end if;
  return private.workspace_va_pay_request_view(q,true,manager);
 elsif section='setup' then
  if not manager then raise exception 'Only management can see VA pay' using errcode='42501';end if;
  return jsonb_build_object('canEdit',true,'currency','USD',
   'vas',coalesce((select jsonb_agg(jsonb_build_object('userId',p.user_id,'fullName',p.full_name,'role',p.role,'area',private.workspace_va_area(p.user_id),
     'active',p.status='active','own',p.user_id=auth.uid(),'hourlyRateMinor',s.hourly_rate_minor,'bonusTargetMinor',coalesce(s.bonus_target_minor,0),
     'bonusTier2Minor',coalesce(s.bonus_tier2_minor,0),'bonusTier3Minor',coalesce(s.bonus_tier3_minor,0),'version',coalesce(s.version,0),'updatedAt',s.updated_at,
     'updatedByName',(select u.full_name from public.workspace_profiles u where u.user_id=s.updated_by)) order by p.full_name,p.user_id)
    from public.workspace_profiles p left join private.workspace_va_pay_settings s on s.user_id=p.user_id
    where private.workspace_is_va(p.user_id) and (p.status='active' or s.user_id is not null)),'[]'::jsonb),
   'bonusKpis',coalesce((select jsonb_agg(jsonb_build_object('area',k.area,'kpiId',k.id,'name',k.name,'direction',k.direction,'targetPercent',k.target_percent,
     'bonusTiers',to_jsonb(k.bonus_tiers),'placeholder',k.placeholder) order by array_position(private.workspace_kpi_areas(),k.area))
    from private.workspace_kpis k where k.counts_for_bonus and k.active and k.area in ('guest_relations','client_relations','accounts','management','cleaning','ready')),'[]'::jsonb),
   'history',coalesce((select jsonb_agg(jsonb_build_object('userId',h.user_id,'fullName',(select p.full_name from public.workspace_profiles p where p.user_id=h.user_id),
     'before',h.before,'after',h.after,'changedAt',h.changed_at,'changedByName',(select p.full_name from public.workspace_profiles p where p.user_id=h.changed_by)) order by h.changed_at desc,h.id desc)
    from (select * from private.workspace_va_pay_settings_history order by changed_at desc,id desc limit 50) h),'[]'::jsonb));
 end if;
 raise exception 'Unknown VA pay section' using errcode='22023';
end $fn$;
create or replace function public.workspace_va_pay_read(section text,target_id uuid default null) returns jsonb language sql security invoker set search_path='' as $fn$ select private.workspace_va_pay_read(section,target_id) $fn$;

-- 4. Actions --------------------------------------------------------------------------------------------------------
-- A whole number in a JSON field, within bounds; null when the field is absent or null.
create or replace function private.workspace_va_int(input jsonb,field text,low bigint,high bigint,what text) returns bigint language plpgsql immutable set search_path='' as $fn$
begin
 if not (input ? field) or jsonb_typeof(input->field)='null' then return null;end if;
 if jsonb_typeof(input->field)<>'number' or input->>field!~'^-?\d{1,12}$' or (input->>field)::bigint not between low and high then
  raise exception '%',what using errcode='22023';
 end if;
 return (input->>field)::bigint;
end $fn$;

create or replace function private.workspace_va_pay_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();a text;req uuid;prior private.workspace_action_receipts;result jsonb;
 q private.workspace_va_pay_requests;old private.workspace_va_pay_requests;s private.workspace_va_pay_settings;olds private.workspace_va_pay_settings;
 va uuid;today date:=(now() at time zone 'Europe/London')::date;paid date;p_start date;note_text text;adj bigint;bon bigint;change text;
 uuid_re constant text:='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 if input is null or jsonb_typeof(input)<>'object' then raise exception 'Unknown or oversized workflow input' using errcode='22023';end if;
 a:=private.workspace_required_text(input,'action',1,50);
 if coalesce(input->>'requestId','')!~uuid_re then raise exception 'Request identifier required' using errcode='22023';end if;
 req:=(input->>'requestId')::uuid;
 if not private.workspace_va_pay_manager() then raise exception 'Only management can do this' using errcode='42501';end if;
 if a='saveVaPay' then perform private.workspace_json_keys(input,array['action','requestId','vaId','version','hourlyRateMinor','bonusTargetMinor','bonusTier2Minor','bonusTier3Minor']);
 elsif a='issueVaRequest' then perform private.workspace_json_keys(input,array['action','requestId','vaId','month','version']);
 elsif a='approveVaRequest' then perform private.workspace_json_keys(input,array['action','requestId','id','version']);
 elsif a in ('queryVaRequest','rejectVaRequest') then perform private.workspace_json_keys(input,array['action','requestId','id','version','note']);
 elsif a='adjustVaRequest' then perform private.workspace_json_keys(input,array['action','requestId','id','version','hoursAdjustMinutes','bonusMinor','reason']);
 elsif a='markVaRequestPaid' then perform private.workspace_json_keys(input,array['action','requestId','id','version','paidOn']);
 else raise exception 'Unknown VA pay action' using errcode='22023';end if;
 if jsonb_typeof(input->'version') is distinct from 'number' or input->>'version'!~'^\d{1,9}$' then raise exception 'Version required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 select * into prior from private.workspace_action_receipts where actor_id=auth.uid() and request_id=req;
 if found then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;

 if a='saveVaPay' then
  if coalesce(input->>'vaId','')!~uuid_re then raise exception 'Choose a VA' using errcode='22023';end if;
  va:=(input->>'vaId')::uuid;
  if not private.workspace_is_va(va) then raise exception 'Only VAs have VA pay' using errcode='22023';end if;
  if va=auth.uid() then raise exception 'Someone else in management sets your own pay' using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended('va-pay:'||va::text,0));
  select * into olds from private.workspace_va_pay_settings x where x.user_id=va for update;
  if coalesce(olds.version,0)<>(input->>'version')::int then raise exception 'The pay setup was changed by someone else. Refresh and try again' using errcode='40001';end if;
  insert into private.workspace_va_pay_settings(user_id,hourly_rate_minor,bonus_target_minor,bonus_tier2_minor,bonus_tier3_minor,updated_by)
   values(va,private.workspace_va_int(input,'hourlyRateMinor',1,100000,'The hourly rate is from $0.01 to $1,000.00'),
    coalesce(private.workspace_va_int(input,'bonusTargetMinor',0,10000000,'Each bonus is from $0.00 to $100,000.00'),0),
    coalesce(private.workspace_va_int(input,'bonusTier2Minor',0,10000000,'Each bonus is from $0.00 to $100,000.00'),0),
    coalesce(private.workspace_va_int(input,'bonusTier3Minor',0,10000000,'Each bonus is from $0.00 to $100,000.00'),0),auth.uid())
   on conflict(user_id) do update set hourly_rate_minor=excluded.hourly_rate_minor,bonus_target_minor=excluded.bonus_target_minor,bonus_tier2_minor=excluded.bonus_tier2_minor,
    bonus_tier3_minor=excluded.bonus_tier3_minor,version=private.workspace_va_pay_settings.version+1,updated_by=excluded.updated_by,updated_at=now()
   returning * into s;
  insert into private.workspace_va_pay_settings_history(user_id,before,after,changed_by) values(va,case when olds.user_id is not null then to_jsonb(olds) end,to_jsonb(s),auth.uid());
  result:=jsonb_build_object('vaId',s.user_id,'hourlyRateMinor',s.hourly_rate_minor,'bonusTargetMinor',s.bonus_target_minor,'bonusTier2Minor',s.bonus_tier2_minor,
   'bonusTier3Minor',s.bonus_tier3_minor,'currency',s.currency,'version',s.version);
 elsif a='issueVaRequest' then
  -- Issue now: the monthly run's work for one VA and one month that has ended. The version is the VA's pay setup
  -- version as management saw it (0 when there is none yet).
  if coalesce(input->>'vaId','')!~uuid_re then raise exception 'Choose a VA' using errcode='22023';end if;
  va:=(input->>'vaId')::uuid;
  if va=auth.uid() then raise exception 'Someone else in management issues your own request' using errcode='42501';end if;
  if jsonb_typeof(input->'month') is distinct from 'string' or input->>'month'!~'^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Choose a month' using errcode='22023';end if;
  p_start:=(input->>'month'||'-01')::date;
  if p_start>=date_trunc('month',today)::date then raise exception 'Choose a month that has ended' using errcode='22023';end if;
  if p_start<(date_trunc('month',today)-interval '24 months')::date then raise exception 'Choose a month in the last two years' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended('va-pay:'||va::text,0));
  perform pg_advisory_xact_lock(hashtextextended('workspace_va_pay_run',0));
  select * into olds from private.workspace_va_pay_settings x where x.user_id=va for update;
  if coalesce(olds.version,0)<>(input->>'version')::int then raise exception 'The pay setup was changed by someone else. Refresh and try again' using errcode='40001';end if;
  q:=private.workspace_va_pay_issue(va,p_start,today,now(),null,auth.uid());
  result:=private.workspace_va_pay_request_view(q,false,true);
 else
  if coalesce(input->>'id','')!~uuid_re then raise exception 'Request not found' using errcode='P0002';end if;
  select * into old from private.workspace_va_pay_requests x where x.id=(input->>'id')::uuid for update;
  if old.id is null then raise exception 'Request not found' using errcode='P0002';end if;
  if old.va_id=auth.uid() then raise exception 'Someone else in management decides your own request' using errcode='42501';end if;
  if old.version<>(input->>'version')::int then raise exception 'The request was changed by someone else. Refresh and try again' using errcode='40001';end if;
  if a='approveVaRequest' then
   if old.status<>'to_approve' then raise exception 'Only a request waiting for approval can be approved' using errcode='42501';end if;
   update private.workspace_va_pay_requests set status='approved',approved_by=auth.uid(),approved_at=now(),version=version+1,updated_at=now() where id=old.id returning * into q;
   change:='approved';
   perform private.workspace_clean_notify(q.va_id,null,null,'vapay.request_approved',
    'Request '||q.number||' approved: please send us your invoice for '||private.workspace_usd(q.total_minor),false);
  elsif a='queryVaRequest' then
   if old.status<>'to_approve' then raise exception 'Only a request waiting for approval can be queried' using errcode='42501';end if;
   note_text:=private.workspace_required_text(input,'note',5,2000);
   update private.workspace_va_pay_requests set query_note=note_text,queried_by=auth.uid(),queried_at=now(),version=version+1,updated_at=now() where id=old.id returning * into q;
   change:='queried';
   perform private.workspace_clean_notify(q.va_id,null,null,'vapay.request_queried','Request '||q.number||' queried: '||note_text,false);
  elsif a='rejectVaRequest' then
   if old.status<>'to_approve' then raise exception 'Only a request waiting for approval can be rejected' using errcode='42501';end if;
   note_text:=private.workspace_required_text(input,'note',5,2000);
   update private.workspace_va_pay_requests set status='rejected',reject_note=note_text,rejected_by=auth.uid(),rejected_at=now(),version=version+1,updated_at=now() where id=old.id returning * into q;
   change:='rejected';
   perform private.workspace_clean_notify(q.va_id,null,null,'vapay.request_rejected','Request '||q.number||' rejected: '||note_text,false);
  elsif a='adjustVaRequest' then
   if old.status<>'to_approve' then raise exception 'Only a request waiting for approval can be adjusted' using errcode='42501';end if;
   if not (input ? 'hoursAdjustMinutes' or input ? 'bonusMinor') then raise exception 'Change the hours or the bonus' using errcode='22023';end if;
   note_text:=private.workspace_required_text(input,'reason',5,500);
   adj:=case when input ? 'hoursAdjustMinutes' then coalesce(private.workspace_va_int(input,'hoursAdjustMinutes',-44640,44640,'The hours correction is in whole minutes'),0) else old.hours_adjust_minutes end;
   if old.worked_minutes+adj<0 then raise exception 'The correction cannot take the hours below zero' using errcode='22023';end if;
   bon:=case when input ? 'bonusMinor' then private.workspace_va_int(input,'bonusMinor',0,10000000,'The bonus is from $0.00 to $100,000.00') else old.bonus_adjusted_minor end;
   update private.workspace_va_pay_requests set hours_adjust_minutes=adj,
     hours_adjust_reason=case when input ? 'hoursAdjustMinutes' then case when adj=0 then null else note_text end else hours_adjust_reason end,
     hours_minor=private.workspace_va_hours_minor((worked_minutes+adj)::int,hourly_rate_minor),
     bonus_adjusted_minor=bon,bonus_adjust_reason=case when input ? 'bonusMinor' then case when bon is null then null else note_text end else bonus_adjust_reason end,
     total_minor=private.workspace_va_hours_minor((worked_minutes+adj)::int,hourly_rate_minor)+coalesce(bon,bonus_auto_minor),
     version=version+1,updated_at=now() where id=old.id returning * into q;
   change:='adjusted';
  else
   if old.status<>'approved' then raise exception 'Only an approved request can be marked paid' using errcode='42501';end if;
   if jsonb_typeof(input->'paidOn') is distinct from 'string' or input->>'paidOn'!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Enter the date it was paid' using errcode='22023';end if;
   begin paid:=(input->>'paidOn')::date; exception when others then raise exception 'Enter the date it was paid' using errcode='22023'; end;
   if to_char(paid,'YYYY-MM-DD')<>input->>'paidOn' or paid>today or paid<old.issue_on then raise exception 'The paid date must be between the issue date and today' using errcode='22023';end if;
   update private.workspace_va_pay_requests set status='paid',paid_on=paid,paid_by=auth.uid(),paid_at=now(),version=version+1,updated_at=now() where id=old.id returning * into q;
   change:='paid';
   perform private.workspace_clean_notify(q.va_id,null,null,'vapay.request_paid','Paid: '||private.workspace_usd(q.total_minor)||' ('||q.number||')',false);
  end if;
  insert into private.workspace_va_pay_request_changes(request_id,change,reason,before,after,changed_by) values(q.id,change,note_text,to_jsonb(old),to_jsonb(q),auth.uid());
  result:=private.workspace_va_pay_request_view(q,false,true);
 end if;
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $fn$;
create or replace function public.workspace_va_pay_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $fn$ select private.workspace_va_pay_action(input) $fn$;

-- Patches: the combined management measure answers the monthly run; vapay notices stay in the app.
do $patch$
declare
 fixes constant text[][] := array[
  -- The run sets recharge.va_pay_run for its own transaction and has no signed-in user; it reads the measure as an admin would.
  ['private.workspace_kpi_teams_combined(date,date)',
   $q$my_area:=(select private.workspace_kpi_area(p.role,r.department) from public.workspace_profiles p left join private.workspace_staff_rota r on r.user_id=p.user_id where p.user_id=auth.uid());$q$,
   $q$my_area:=(select private.workspace_kpi_area(p.role,r.department) from public.workspace_profiles p left join private.workspace_staff_rota r on r.user_id=p.user_id where p.user_id=auth.uid());
 -- VA pay (20261022200000): the monthly run, with no signed-in user, reads the measure for a VA's bonus.
 if auth.uid() is null and coalesce(current_setting('recharge.va_pay_run',true),'')='on' then actor:='admin';end if;$q$,
   $q$current_setting('recharge.va_pay_run',true)$q$],
  -- No email for a vapay notice.
  ['private.integration_claim_notifications(boolean,boolean)',
   $q$join public.workspace_activity ra on ra.id=o.event_id and ra.created_at>now()-interval '24 hours'$q$,
   $q$join public.workspace_activity ra on ra.id=o.event_id and ra.created_at>now()-interval '24 hours' and ra.event_type not like 'vapay.%'$q$,
   $q$ra.event_type not like 'vapay.%'$q$],
  -- No phone push for a vapay notice.
  ['private.integration_claim_notifications(boolean,boolean)',
   $q$join public.workspace_activity rp on rp.id=o.event_id and rp.created_at>now()-interval '24 hours'$q$,
   $q$join public.workspace_activity rp on rp.id=o.event_id and rp.created_at>now()-interval '24 hours' and rp.event_type not like 'vapay.%'$q$,
   $q$rp.event_type not like 'vapay.%'$q$],
  -- No web push for a vapay notice.
  ['private.integration_claim_web_push()',
   $q$where a.created_at>now()-interval '1 day'$q$,
   $q$where a.created_at>now()-interval '1 day' and a.event_type not like 'vapay.%'$q$,
   $q$a.event_type not like 'vapay.%'$q$]
 ];
 definition text;hits integer;
begin
 for i in 1..array_length(fixes,1) loop
  definition:=pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in definition)=0 then
   hits:=(length(definition)-length(replace(definition,fixes[i][2],'')))/length(fixes[i][2]);
   if hits<>1 then raise exception 'VA pay patch %: anchor found % times in %',i,hits,fixes[i][1];end if;
   execute replace(definition,fixes[i][2],fixes[i][3]);
   if position(fixes[i][4] in pg_get_functiondef(fixes[i][1]::regprocedure))=0 then raise exception 'VA pay patch % did not take in %',i,fixes[i][1];end if;
  end if;
 end loop;
end $patch$;

-- Who may call what. The run is for the backend only; the reads and actions for signed-in people, checked inside.
revoke all on function private.workspace_va_area(uuid),private.workspace_is_va(uuid),private.workspace_va_pay_manager(),private.workspace_usd(bigint),
 private.workspace_va_hours_minor(integer,integer),private.workspace_va_bonus_tier(jsonb),private.workspace_va_bonus_amount(text,jsonb),
 private.workspace_va_pay_issue(uuid,date,date,timestamptz,jsonb,uuid),private.workspace_va_pay_run(timestamptz),public.workspace_va_pay_run(),
 private.workspace_va_pay_request_view(private.workspace_va_pay_requests,boolean,boolean),private.workspace_va_pay_read(text,uuid),public.workspace_va_pay_read(text,uuid),
 private.workspace_va_int(jsonb,text,bigint,bigint,text),private.workspace_va_pay_action(jsonb),public.workspace_va_pay_action(jsonb) from public,anon,authenticated;
grant execute on function private.workspace_va_pay_run(timestamptz),public.workspace_va_pay_run() to service_role;
-- The public wrappers run as the caller, so the caller may execute the private function they call.
grant execute on function private.workspace_va_pay_read(text,uuid),public.workspace_va_pay_read(text,uuid),
 private.workspace_va_pay_action(jsonb),public.workspace_va_pay_action(jsonb) to authenticated;
