-- Round 5 (October 2026): the nine migrations not yet installed, in filename order, in ONE transaction.
-- Paste the whole file into the Supabase SQL editor for project brixfalrrmzqoioggvfx and run it once.
-- If any statement fails, nothing is applied. Each migration is recorded in supabase_migrations.schema_migrations
-- under its filename version. Generated from supabase/migrations; do not edit by hand.
-- Running it a second time stops at the first line below and changes nothing.

begin;
set local lock_timeout='20s';
do $guard$ begin if exists(select 1 from supabase_migrations.schema_migrations where version like '20261015%') then raise exception 'Round 5 is already installed (or partly): stop and check'; end if; end $guard$;

-- ===== 20261015100000_kpi_tracker =====
-- KPI tracker (lead developer's round 5, 13 October 2026). Alex wants the performance targets to be his own KPIs,
-- edited by admins in the app, one per area counting for the bonus, the rest tracked. Lee told Alex the backend
-- comes first, so this migration is the whole of the database side.
--
-- 1. private.workspace_kpis: one row per KPI. Name, area (the six rota departments), measure key, minutes (only for
--    the measures that take them), direction (from the measure: higher or lower is better), target percentage (null
--    for a KPI that is tracked only), bonus tiers beyond the target, counts_for_bonus (at most one active KPI per area,
--    enforced by a unique index), placeholder (the numbers are not Alex's yet), active, sort order and version, who
--    created it and who changed it last. Nothing is ever deleted: a KPI is switched off.
-- 2. private.workspace_kpi_changes: every change with who made it, when, and the row before and after.
-- 3. The measure catalogue, private.workspace_kpi_measures(). To add a measure: add its entry there (key, label,
--    whether it takes minutes, direction, the areas it fits) and a branch in private.workspace_kpi_person_value and,
--    when a team is not just the average of its people, in private.workspace_kpi_team_value. Measures:
--      guest_reply_within   share of guest messages answered within N minutes (higher is better)
--      guest_reply_over     share of guest messages that waited longer than N minutes (lower is better)
--      daily_work_done      the daily-work percentage of private.workspace_daily_work (Stays shift days)
--      performance_score    the blended score Team performance already shows (reply times with daily work)
--      clean_forms_on_time  share of a cleaner's cleans with the form in by 18:00 on the day
--    A KPI with nothing to measure in the period has no value (null), never 0%.
-- 4. Guest replies come from private.workspace_kpi_reply_rows: the same conversations, waits and credit (whoever was
--    clocked in to guest relations when the message arrived) as private.workspace_response_rows, but every wait is
--    returned with whether it was answered, so any number of minutes can be judged. A wait is settled for "within N"
--    once it was answered or has already lasted longer than N; a wait still inside N is not counted either way yet.
--    A wait closed by marking the conversation Done (no reply) is left out, as before.
-- 5. Seed: Guest relations "Replies within 5 minutes" counts for the bonus with the pass mark and bonus tiers of
--    private.workspace_performance_targets (80, then 90 and 95 on the live database); within 10, 30 and 60 minutes and
--    "waiting over 60 minutes" are tracked only. The other five areas get one placeholder bonus KPI each at 80, 90 and
--    95: client relations on daily work, cleaning on forms in on time, ready, accounts and management on the score.
--    Seeded rows carry a seed_key, so a second run adds nothing.
-- 6. Reads and writes go through the team routes (anchors after the hub routes, like 20261012140000):
--      workspace_teams_read('kpis', from, to): the KPIs, and for the period each person's and each team's value,
--        target and tier reached per KPI, plus the guest relations reply breakdown (5, 10, 30, 60 minutes, over 60).
--        Admins see everyone, every area and the change log; anyone else on the team sees only themself and their
--        own area. Owners are refused.
--      workspace_teams_action saveKpi, setKpiActive, moveKpi: admins and super admins only.
--
-- private.workspace_performance_targets stays as it is and is still read by: the reply grades of
-- workspace_response_rows (green and amber minutes), the score, onTrack and bonusTier of the teamPerformance read and
-- the client relations reply times (pass mark and tiers), the daily-work targets and their weight. The screens now take
-- the bonus from the area's bonus KPI instead of those tiers.
--
-- Safe to run more than once: tables and indexes are guarded, functions are replaced whole (nobody else patches them),
-- the seed skips rows already there and each route patch is skipped once its sentinel is present.

create table if not exists private.workspace_kpis (
 id uuid primary key default gen_random_uuid(),
 seed_key text unique,
 name text not null check(length(trim(name)) between 2 and 120),
 area text not null check(area in ('guest_relations','client_relations','cleaning','ready','accounts','management')),
 measure text not null check(measure ~ '^[a-z_]{2,40}$'),
 minutes integer check(minutes is null or minutes between 1 and 1440),
 direction text not null check(direction in ('higher','lower')),
 target_percent integer check(target_percent is null or target_percent between 0 and 100),
 bonus_tiers integer[] not null default '{}' check(cardinality(bonus_tiers)<=5 and 0<=all(bonus_tiers) and 100>=all(bonus_tiers)),
 counts_for_bonus boolean not null default false,
 placeholder boolean not null default false,
 active boolean not null default true,
 sort_order integer not null default 0,
 version integer not null default 1 check(version>0),
 created_by uuid references public.workspace_profiles(user_id),
 created_at timestamptz not null default now(),
 updated_by uuid references public.workspace_profiles(user_id),
 updated_at timestamptz not null default now(),
 check(not counts_for_bonus or (active and target_percent is not null)),
 check(target_percent is not null or cardinality(bonus_tiers)=0)
);
create unique index if not exists workspace_kpis_one_bonus_idx on private.workspace_kpis(area) where counts_for_bonus and active;
create index if not exists workspace_kpis_area_idx on private.workspace_kpis(area,sort_order);
create index if not exists workspace_kpis_created_by_idx on private.workspace_kpis(created_by);
create index if not exists workspace_kpis_updated_by_idx on private.workspace_kpis(updated_by);
alter table private.workspace_kpis enable row level security;
revoke all on private.workspace_kpis from public,anon,authenticated;

create table if not exists private.workspace_kpi_changes (
 id bigint generated always as identity primary key,
 kpi_id uuid not null references private.workspace_kpis(id) on delete cascade,
 change text not null check(change in ('seeded','created','edited','switched_off','switched_on','moved')),
 before jsonb,
 after jsonb not null,
 changed_by uuid references public.workspace_profiles(user_id),
 changed_at timestamptz not null default now()
);
create index if not exists workspace_kpi_changes_kpi_idx on private.workspace_kpi_changes(kpi_id,changed_at desc);
create index if not exists workspace_kpi_changes_by_idx on private.workspace_kpi_changes(changed_by);
alter table private.workspace_kpi_changes enable row level security;
revoke all on private.workspace_kpi_changes from public,anon,authenticated;

-- The measure catalogue. The order here is the order of the admin's list.
create or replace function private.workspace_kpi_measures() returns jsonb language sql immutable set search_path='' as $fn$
 select '[
  {"key":"guest_reply_within","label":"Guest messages answered within the minutes set","needsMinutes":true,"direction":"higher","areas":["guest_relations"]},
  {"key":"guest_reply_over","label":"Guest messages waiting longer than the minutes set","needsMinutes":true,"direction":"lower","areas":["guest_relations"]},
  {"key":"daily_work_done","label":"Daily work done against its targets","needsMinutes":false,"direction":"higher","areas":["guest_relations","client_relations"]},
  {"key":"performance_score","label":"Performance score","needsMinutes":false,"direction":"higher","areas":["guest_relations","client_relations","cleaning","ready","accounts","management"]},
  {"key":"clean_forms_on_time","label":"Cleaning forms in by 18:00 on the day","needsMinutes":false,"direction":"higher","areas":["cleaning"]}
 ]'::jsonb;
$fn$;

create or replace function private.workspace_kpi_areas() returns text[] language sql immutable set search_path='' as $fn$
 select array['guest_relations','client_relations','cleaning','ready','accounts','management'];
$fn$;

-- The area a person's KPIs follow: their rota department, else their role's (lib/feedback-defaults.ts had the same map).
create or replace function private.workspace_kpi_area(role text,department text) returns text language sql immutable set search_path='' as $fn$
 select coalesce(department,case role when 'stays' then 'guest_relations' when 'cleans' then 'cleaning' when 'cleaning_manager' then 'cleaning'
  when 'ready' then 'ready' when 'accounts' then 'accounts' when 'admin' then 'management' when 'super_admin' then 'management' end);
$fn$;

-- Every guest wait that started in the period, with whether it was answered. The conversation logic is
-- private.workspace_response_rows (20261012050000) word for word; only the last step differs: nothing is graded and no
-- wait is dropped for being short, so the caller can judge any number of minutes.
create or replace function private.workspace_kpi_reply_rows(lower_at timestamptz,upper_at timestamptz)
 returns table(message_id uuid,sent_at timestamptz,minutes numeric,answered boolean,user_id uuid)
language sql stable security definer set search_path='' as $$
 with m as (select e.id,e.source,e.thread_ref,e.direction,e.sent_at,e.eff_at,lag(e.direction) over(partition by e.source,e.thread_ref order by e.eff_at,e.id) prev
  from (select g.id,g.source,g.thread_ref,g.direction,g.sent_at,
    case when g.direction='guest' and exists(select 1 from private.workspace_guest_thread_marks k where k.source=g.source and k.thread_ref=g.thread_ref and k.marked_at>=g.sent_at and k.marked_at<g.created_at) then g.created_at else g.sent_at end eff_at
   from private.workspace_guest_messages g where g.sent_at<upper_at and g.sent_at>=lower_at-interval '1 day'
   union all select k.id,k.source,k.thread_ref,'mark',k.marked_at,k.marked_at from private.workspace_guest_thread_marks k where k.marked_at<upper_at and k.marked_at>=lower_at-interval '1 day') e),
 asks as (select m.id,m.sent_at,e.at ended_at,e.kind ended_by from m
  left join lateral (select x.at,x.kind from (
    select r.sent_at at,'team' kind from private.workspace_guest_messages r where r.source=m.source and r.thread_ref=m.thread_ref and r.direction='team' and r.sent_at>=m.sent_at
    union all select k.marked_at,'mark' from private.workspace_guest_thread_marks k where k.source=m.source and k.thread_ref=m.thread_ref and k.marked_at>=m.eff_at) x
   order by x.at,x.kind desc limit 1) e on true
  where m.direction='guest' and (m.prev is null or m.prev in ('team','mark')) and m.sent_at>=lower_at),
 timed as (select a.id,a.sent_at,a.ended_by,extract(epoch from coalesce(a.ended_at,now())-a.sent_at)/60 mins from asks a)
 select x.id,x.sent_at,x.mins::numeric,coalesce(x.ended_by='team',false),s.user_id
 from timed x
 left join private.workspace_shifts s on s.department='guest_relations' and s.clocked_in_at<=x.sent_at and (s.clocked_out_at is null or s.clocked_out_at>x.sent_at)
 where x.ended_by is distinct from 'mark';
$$;

-- Replies are passed around as a JSON list of {u: user id, m: minutes, a: answered}, worked out once per read.
-- "Within N": answered within N out of the waits settled for N. "Over N": waits longer than N out of the same.
-- Rounded against the person: down when higher is better, up when lower is better.
create or replace function private.workspace_kpi_reply_value(measure text,minutes integer,replies jsonb) returns jsonb language sql immutable set search_path='' as $fn$
 with r as (select (e->>'m')::numeric m,(e->>'a')::boolean a from jsonb_array_elements(coalesce(replies,'[]'::jsonb)) e),
 d as (select count(*) filter(where r.a or r.m>minutes) settled,count(*) filter(where r.a and r.m<=minutes) inside,count(*) filter(where r.m>minutes) over_n from r)
 select jsonb_build_object('measured',d.settled,'count',case when measure='guest_reply_over' then d.over_n else d.inside end,
  'value',case when minutes is null or d.settled=0 then null when measure='guest_reply_over' then ceil(d.over_n*100.0/d.settled)::int else floor(d.inside*100.0/d.settled)::int end)
 from d;
$fn$;

-- The guest relations breakdown: answered within 5, 10, 30 and 60 minutes, and waiting over 60, each out of the waits
-- settled for its minutes (the same sums as the KPIs), plus how many are still waiting for a reply.
create or replace function private.workspace_kpi_reply_bands(replies jsonb) returns jsonb language sql immutable set search_path='' as $fn$
 select jsonb_build_object(
  'waits',(select count(*) from jsonb_array_elements(coalesce(replies,'[]'::jsonb))),
  'stillWaiting',(select count(*) from jsonb_array_elements(coalesce(replies,'[]'::jsonb)) e where not (e->>'a')::boolean),
  'bands',jsonb_build_array(
   jsonb_build_object('key','within5','minutes',5)||private.workspace_kpi_reply_value('guest_reply_within',5,replies),
   jsonb_build_object('key','within10','minutes',10)||private.workspace_kpi_reply_value('guest_reply_within',10,replies),
   jsonb_build_object('key','within30','minutes',30)||private.workspace_kpi_reply_value('guest_reply_within',30,replies),
   jsonb_build_object('key','within60','minutes',60)||private.workspace_kpi_reply_value('guest_reply_within',60,replies),
   jsonb_build_object('key','over60','minutes',60)||private.workspace_kpi_reply_value('guest_reply_over',60,replies)));
$fn$;

-- Cleaning forms in on time for the given cleaners' cleans on days in the period. A clean is counted once its form is
-- in or 18:00 on its day has passed. It is on time when the form is in and the sweep never had to remind anyone
-- (no unsubmittedAt) or warn management (no formWarningAt). Credited to the clean's current cleaner.
create or replace function private.workspace_kpi_clean_forms(cleaners uuid[],start_on date,end_on date) returns jsonb language sql stable security definer set search_path='' as $fn$
 with c as (select private.workspace_clean_form_in(d.data) form_in,d.data,private.workspace_clean_form_day(w.due_on,d.data) clean_day
  from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
  where d.kind='cleaning' and w.assignee_id=any(cleaners) and w.status not in ('cancelled','declined')),
 s as (select count(*) filter(where c.form_in or private.workspace_clean_form_is_due(c.clean_day,now()) or c.data ? 'unsubmittedAt') settled,
   count(*) filter(where c.form_in and not (c.data ? 'unsubmittedAt') and not (c.data ? 'formWarningAt')) on_time
  from c where c.clean_day between start_on and end_on)
 select jsonb_build_object('measured',s.settled,'count',s.on_time,'value',case when s.settled>0 then floor(s.on_time*100.0/s.settled)::int end) from s;
$fn$;

-- One person's value for one measure. `replies` are that person's own.
create or replace function private.workspace_kpi_person_value(measure text,minutes integer,target uuid,start_on date,end_on date,replies jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
declare t private.workspace_performance_targets;w jsonb;total bigint;green bigint;score numeric;
begin
 if measure in ('guest_reply_within','guest_reply_over') then
  return private.workspace_kpi_reply_value(measure,minutes,replies);
 elsif measure='daily_work_done' then
  w:=private.workspace_daily_work(target,start_on,end_on);
  return jsonb_build_object('value',(w->>'workPercent')::int,'measured',case when w->>'workPercent' is not null then (w->>'daysWorked')::int else 0 end);
 elsif measure='performance_score' then
  -- The Team performance score: green replies (as private.workspace_response_rows grades them) blended with daily work.
  t:=(select x from private.workspace_performance_targets x where singleton);
  select count(*) filter(where (e->>'a')::boolean or (e->>'m')::numeric>t.amber_minutes),count(*) filter(where (e->>'a')::boolean and (e->>'m')::numeric<=t.green_minutes)
   into total,green from jsonb_array_elements(coalesce(replies,'[]'::jsonb)) e;
  w:=private.workspace_daily_work(target,start_on,end_on);
  score:=private.workspace_blend_score(case when total>0 then green*100.0/total end,(w->>'workPercent')::numeric,t.work_weight);
  return jsonb_build_object('value',floor(score)::int,'measured',case when score is null then 0 else total+coalesce((w->>'daysWorked')::int,0) end);
 elsif measure='clean_forms_on_time' then
  return private.workspace_kpi_clean_forms(array[target],start_on,end_on);
 end if;
 return jsonb_build_object('value',null,'measured',0);
end $fn$;

-- A team's value for one measure: guest replies across every guest message (whoever was or was not on shift), cleaning
-- forms across every clean of the area's cleaners, anything else the average of the members who have a value.
create or replace function private.workspace_kpi_team_value(measure text,minutes integer,members uuid[],start_on date,end_on date,replies jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
begin
 if measure in ('guest_reply_within','guest_reply_over') then
  return private.workspace_kpi_reply_value(measure,minutes,replies);
 elsif measure='clean_forms_on_time' then
  return private.workspace_kpi_clean_forms(members,start_on,end_on);
 end if;
 return (select jsonb_build_object('value',floor(avg((v->>'value')::numeric))::int,'measured',count(*) filter(where v->>'value' is not null))
  from unnest(members) u
  cross join lateral (select private.workspace_kpi_person_value(measure,minutes,u,start_on,end_on,
   (select coalesce(jsonb_agg(e),'[]'::jsonb) from jsonb_array_elements(coalesce(replies,'[]'::jsonb)) e where e->>'u'=u::text)) v) x);
end $fn$;

-- Where a value stands: on target or not, and the bonus tier reached (1 is the first tier beyond the target, null when
-- none is reached yet) with that tier's threshold.
create or replace function private.workspace_kpi_tier(direction text,target integer,tiers integer[],value integer) returns jsonb language sql immutable set search_path='' as $fn$
 select case when value is null or target is null then jsonb_build_object('onTarget',null,'tier',null,'tierAt',null)
  when direction='lower' then (select jsonb_build_object('onTarget',value<=target,'tier',nullif(count(*) filter(where value<=b),0),'tierAt',min(b) filter(where value<=b))
   from unnest(tiers) b where b<target)
  else (select jsonb_build_object('onTarget',value>=target,'tier',nullif(count(*) filter(where value>=b),0),'tierAt',max(b) filter(where value>=b))
   from unnest(tiers) b where b>target) end;
$fn$;

create or replace function private.workspace_kpi_result(k private.workspace_kpis,v jsonb) returns jsonb language sql immutable set search_path='' as $fn$
 select jsonb_build_object('kpiId',k.id,'value',coalesce(v->'value','null'::jsonb),'measured',coalesce((v->>'measured')::int,0),'count',coalesce(v->'count','null'::jsonb))
  ||private.workspace_kpi_tier(k.direction,k.target_percent,k.bonus_tiers,(v->>'value')::int);
$fn$;

create or replace function private.workspace_kpi_view(k private.workspace_kpis,full_view boolean) returns jsonb language sql stable security definer set search_path='' as $fn$
 select jsonb_build_object('id',k.id,'name',k.name,'area',k.area,'measure',k.measure,'minutes',k.minutes,'direction',k.direction,
  'targetPercent',k.target_percent,'bonusTiers',to_jsonb(k.bonus_tiers),'countsForBonus',k.counts_for_bonus,'placeholder',k.placeholder,
  'active',k.active,'sortOrder',k.sort_order,'version',k.version,'updatedAt',k.updated_at)
  ||case when full_view then jsonb_build_object('updatedByName',(select p.full_name from public.workspace_profiles p where p.user_id=k.updated_by)) else '{}'::jsonb end;
$fn$;

create or replace function private.workspace_kpis_read(start_on date,end_on date) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();admin boolean;lower_at timestamptz;upper_at timestamptz;my_area text;replies jsonb;areas text[]:=private.workspace_kpi_areas();
begin
 if actor is null or actor='client' then raise exception 'Team access required' using errcode='42501';end if;
 admin:=actor in ('admin','super_admin');
 start_on:=coalesce(start_on,(now() at time zone 'Europe/London')::date-6);end_on:=coalesce(end_on,(now() at time zone 'Europe/London')::date);
 if end_on<start_on or end_on-start_on>92 then raise exception 'Choose up to 92 days' using errcode='22023';end if;
 lower_at:=start_on::timestamp at time zone 'Europe/London';upper_at:=(end_on+1)::timestamp at time zone 'Europe/London';
 my_area:=(select private.workspace_kpi_area(p.role,r.department) from public.workspace_profiles p left join private.workspace_staff_rota r on r.user_id=p.user_id where p.user_id=auth.uid());
 replies:=coalesce((select jsonb_agg(jsonb_build_object('u',x.user_id,'m',x.minutes,'a',x.answered)) from private.workspace_kpi_reply_rows(lower_at,upper_at) x),'[]'::jsonb);
 return jsonb_build_object('from',start_on,'to',end_on,'canEdit',admin,'myArea',my_area,'measures',private.workspace_kpi_measures(),
  'kpis',coalesce((select jsonb_agg(private.workspace_kpi_view(k,admin) order by array_position(areas,k.area),k.sort_order,k.created_at)
   from private.workspace_kpis k where k.active or admin),'[]'::jsonb),
  'people',coalesce((select jsonb_agg(jsonb_build_object('userId',pe.user_id,'fullName',pe.full_name,'role',pe.role,'area',pe.area,
     'results',coalesce((select jsonb_agg(private.workspace_kpi_result(k,private.workspace_kpi_person_value(k.measure,k.minutes,pe.user_id,start_on,end_on,mine.r)) order by k.sort_order,k.created_at)
       from private.workspace_kpis k where k.active and k.area=pe.area),'[]'::jsonb),
     'guestReplies',case when pe.area='guest_relations' or jsonb_array_length(mine.r)>0 then private.workspace_kpi_reply_bands(mine.r) end) order by pe.full_name,pe.user_id)
   from (select p.user_id,p.full_name,p.role,private.workspace_kpi_area(p.role,r.department) area from public.workspace_profiles p
     left join private.workspace_staff_rota r on r.user_id=p.user_id
     where p.status='active' and p.role<>'client' and (admin or p.user_id=auth.uid())) pe
   cross join lateral (select coalesce(jsonb_agg(e),'[]'::jsonb) r from jsonb_array_elements(replies) e where e->>'u'=pe.user_id::text) mine),'[]'::jsonb),
  'teams',coalesce((select jsonb_agg(jsonb_build_object('area',tm.area,'members',cardinality(tm.members),
     'results',coalesce((select jsonb_agg(private.workspace_kpi_result(k,private.workspace_kpi_team_value(k.measure,k.minutes,tm.members,start_on,end_on,replies)) order by k.sort_order,k.created_at)
       from private.workspace_kpis k where k.active and k.area=tm.area),'[]'::jsonb),
     'guestReplies',case when tm.area='guest_relations' then private.workspace_kpi_reply_bands(replies) end) order by array_position(areas,tm.area))
   from (select a area,array(select p.user_id from public.workspace_profiles p left join private.workspace_staff_rota r on r.user_id=p.user_id
      where p.status='active' and p.role<>'client' and private.workspace_kpi_area(p.role,r.department)=a order by p.user_id) members
     from unnest(areas) a where admin or a=my_area) tm),'[]'::jsonb),
  'changes',case when admin then coalesce((select jsonb_agg(jsonb_build_object('kpiId',c.kpi_id,'change',c.change,'changedAt',c.changed_at,
     'changedByName',(select p.full_name from public.workspace_profiles p where p.user_id=c.changed_by)) order by c.changed_at desc,c.id desc)
   from (select * from private.workspace_kpi_changes order by changed_at desc,id desc limit 50) c),'[]'::jsonb) else '[]'::jsonb end);
end $fn$;

create or replace function private.workspace_kpi_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();a text:=input->>'action';req uuid;prior private.workspace_action_receipts;result jsonb;
 k private.workspace_kpis;old private.workspace_kpis;nb private.workspace_kpis;m jsonb;tiers integer[];mins integer;target integer;change text;bonus boolean;
begin
 if actor is null or actor='client' then raise exception 'Team access required' using errcode='42501';end if;
 if actor not in ('admin','super_admin') then raise exception 'Only admins change the KPIs' using errcode='42501';end if;
 req:=(input->>'requestId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 prior:=(select r from private.workspace_action_receipts r where r.actor_id=auth.uid() and r.request_id=req);
 if prior.actor_id is not null then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;
 -- One KPI change at a time, so "one bonus KPI per area" and the order are checked against settled rows.
 perform pg_advisory_xact_lock(hashtextextended('workspace_kpis',0));

 if input->>'kpiId' is not null then
  select * into old from private.workspace_kpis x where x.id=(input->>'kpiId')::uuid for update;
  if old.id is null then raise exception 'KPI not found' using errcode='P0002';end if;
  if old.version is distinct from (input->>'version')::int then raise exception 'Changed by someone else. Refresh and try again' using errcode='40001';end if;
 end if;

 if a='saveKpi' then
  perform private.workspace_json_keys(input,array['action','requestId','kpiId','version','name','area','measure','minutes','targetPercent','bonusTiers','countsForBonus','placeholder']);
  if jsonb_typeof(input->'name') is distinct from 'string' or length(trim(input->>'name')) not between 2 and 120 then raise exception 'Give the KPI a name' using errcode='22023';end if;
  if not coalesce(input->>'area'=any(private.workspace_kpi_areas()),false) then raise exception 'Choose an area' using errcode='22023';end if;
  m:=(select e from jsonb_array_elements(private.workspace_kpi_measures()) e where e->>'key'=input->>'measure');
  if m is null then raise exception 'Choose a measure from the list' using errcode='22023';end if;
  if not (m->'areas') ? (input->>'area') then raise exception 'That measure does not fit this area' using errcode='22023';end if;
  if (m->>'needsMinutes')::boolean then
   if jsonb_typeof(input->'minutes') is distinct from 'number' or input->>'minutes'!~'^\d{1,4}$' or (input->>'minutes')::int not between 1 and 1440 then raise exception 'Set the minutes, from 1 to 1440' using errcode='22023';end if;
   mins:=(input->>'minutes')::int;
  elsif jsonb_typeof(input->'minutes') is distinct from 'null' and input ? 'minutes' then raise exception 'This measure takes no minutes' using errcode='22023';
  end if;
  if jsonb_typeof(input->'targetPercent') is not distinct from 'null' or not (input ? 'targetPercent') then target:=null;
  elsif jsonb_typeof(input->'targetPercent')<>'number' or input->>'targetPercent'!~'^\d{1,3}$' or (input->>'targetPercent')::int>100 then raise exception 'The target is a percentage from 0 to 100' using errcode='22023';
  else target:=(input->>'targetPercent')::int;
  end if;
  if input ? 'bonusTiers' and (jsonb_typeof(input->'bonusTiers')<>'array' or jsonb_array_length(input->'bonusTiers')>5
   or exists(select 1 from jsonb_array_elements(input->'bonusTiers') e where jsonb_typeof(e)<>'number' or e#>>'{}'!~'^\d{1,3}$' or (e#>>'{}')::int>100)) then
   raise exception 'Bonus tiers are up to five percentages from 0 to 100' using errcode='22023';
  end if;
  tiers:=array(select distinct (e#>>'{}')::int from jsonb_array_elements(coalesce(input->'bonusTiers','[]'::jsonb)) e order by 1);
  if cardinality(tiers)>0 and target is null then raise exception 'Set a target before the bonus tiers' using errcode='22023';end if;
  if m->>'direction'='lower' and exists(select 1 from unnest(tiers) b where b>=target) then raise exception 'Lower is better here, so each bonus tier must be below the target' using errcode='22023';end if;
  if m->>'direction'='higher' and exists(select 1 from unnest(tiers) b where b<=target) then raise exception 'Each bonus tier must be above the target' using errcode='22023';end if;
  if input ? 'countsForBonus' and jsonb_typeof(input->'countsForBonus')<>'boolean' then raise exception 'Say whether it counts for the bonus' using errcode='22023';end if;
  if input ? 'placeholder' and jsonb_typeof(input->'placeholder')<>'boolean' then raise exception 'Say whether it is a placeholder' using errcode='22023';end if;
  bonus:=coalesce((input->>'countsForBonus')::boolean,false);
  if bonus and target is null then raise exception 'A bonus KPI needs a target' using errcode='22023';end if;
  if bonus and old.id is not null and not old.active then raise exception 'Switch the KPI on before it counts for the bonus' using errcode='22023';end if;
  if bonus and exists(select 1 from private.workspace_kpis x where x.area=input->>'area' and x.counts_for_bonus and x.active and x.id is distinct from old.id) then
   raise exception 'Only one KPI in each area counts for the bonus. Untick "%" first',(select x.name from private.workspace_kpis x where x.area=input->>'area' and x.counts_for_bonus and x.active and x.id is distinct from old.id)
    using errcode='23505';
  end if;
  if old.id is null then
   insert into private.workspace_kpis(name,area,measure,minutes,direction,target_percent,bonus_tiers,counts_for_bonus,placeholder,sort_order,created_by,updated_by)
    values(trim(input->>'name'),input->>'area',input->>'measure',mins,m->>'direction',target,tiers,bonus,coalesce((input->>'placeholder')::boolean,false),
     coalesce((select max(x.sort_order) from private.workspace_kpis x where x.area=input->>'area'),0)+1,auth.uid(),auth.uid())
    returning * into k;
   change:='created';
  else
   update private.workspace_kpis set name=trim(input->>'name'),area=input->>'area',measure=input->>'measure',minutes=mins,direction=m->>'direction',target_percent=target,
     bonus_tiers=tiers,counts_for_bonus=bonus,placeholder=coalesce((input->>'placeholder')::boolean,false),
     sort_order=case when area=input->>'area' then sort_order else coalesce((select max(x.sort_order) from private.workspace_kpis x where x.area=input->>'area'),0)+1 end,
     version=version+1,updated_by=auth.uid(),updated_at=now()
    where id=old.id returning * into k;
   change:='edited';
  end if;

 elsif a='setKpiActive' then
  perform private.workspace_json_keys(input,array['action','requestId','kpiId','version','active']);
  if old.id is null then raise exception 'Choose a KPI' using errcode='22023';end if;
  if jsonb_typeof(input->'active') is distinct from 'boolean' then raise exception 'Say whether the KPI is on' using errcode='22023';end if;
  if old.active=(input->>'active')::boolean then raise exception '%',case when old.active then 'This KPI is already on' else 'This KPI is already off' end using errcode='22023';end if;
  -- A KPI switched off no longer counts for the bonus; switching it back on does not make it count again by itself.
  update private.workspace_kpis set active=(input->>'active')::boolean,counts_for_bonus=false,version=version+1,updated_by=auth.uid(),updated_at=now()
   where id=old.id returning * into k;
  change:=case when k.active then 'switched_on' else 'switched_off' end;

 elsif a='moveKpi' then
  perform private.workspace_json_keys(input,array['action','requestId','kpiId','version','direction']);
  if old.id is null then raise exception 'Choose a KPI' using errcode='22023';end if;
  if coalesce(input->>'direction','') not in ('up','down') then raise exception 'Move it up or down' using errcode='22023';end if;
  -- Number the area 1, 2, 3... in its current order first, so equal or missing places never stall a move.
  update private.workspace_kpis x set sort_order=o.n from (select y.id,row_number() over(order by y.sort_order,y.created_at,y.id) n from private.workspace_kpis y where y.area=old.area) o
   where x.id=o.id and x.sort_order is distinct from o.n;
  select * into old from private.workspace_kpis x where x.id=old.id;
  select * into nb from private.workspace_kpis x where x.area=old.area and x.sort_order=old.sort_order+case when input->>'direction'='up' then -1 else 1 end for update;
  if nb.id is null then raise exception '%',case when input->>'direction'='up' then 'It is already first' else 'It is already last' end using errcode='22023';end if;
  update private.workspace_kpis set sort_order=old.sort_order,version=version+1,updated_by=auth.uid(),updated_at=now() where id=nb.id;
  insert into private.workspace_kpi_changes(kpi_id,change,before,after,changed_by)
   select nb.id,'moved',to_jsonb(nb),to_jsonb(x),auth.uid() from private.workspace_kpis x where x.id=nb.id;
  update private.workspace_kpis set sort_order=nb.sort_order,version=version+1,updated_by=auth.uid(),updated_at=now() where id=old.id returning * into k;
  change:='moved';
 else raise exception 'Unknown KPI action' using errcode='22023';
 end if;

 insert into private.workspace_kpi_changes(kpi_id,change,before,after,changed_by) values(k.id,change,case when old.id is not null then to_jsonb(old) end,to_jsonb(k),auth.uid());
 result:=private.workspace_kpi_view(k,true);
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $fn$;

revoke all on function private.workspace_kpi_measures(),private.workspace_kpi_areas(),private.workspace_kpi_area(text,text),
 private.workspace_kpi_reply_rows(timestamptz,timestamptz),private.workspace_kpi_reply_value(text,integer,jsonb),private.workspace_kpi_reply_bands(jsonb),
 private.workspace_kpi_clean_forms(uuid[],date,date),private.workspace_kpi_person_value(text,integer,uuid,date,date,jsonb),
 private.workspace_kpi_team_value(text,integer,uuid[],date,date,jsonb),private.workspace_kpi_tier(text,integer,integer[],integer),
 private.workspace_kpi_result(private.workspace_kpis,jsonb),private.workspace_kpi_view(private.workspace_kpis,boolean),
 private.workspace_kpis_read(date,date),private.workspace_kpi_action(jsonb) from public,anon,authenticated;

-- 5. The seed. The guest relations bonus KPI takes the pass mark and tiers of the old targets (tiers kept only above the
-- pass mark); everything else is Alex's example (80, 90, 95) and marked as a placeholder until he sends his own.
with t as (select coalesce((select x.pass_percent from private.workspace_performance_targets x where singleton),80) pass,
  coalesce((select x.bonus_percents from private.workspace_performance_targets x where singleton),array[90,95]) tiers),
added as (
 insert into private.workspace_kpis(seed_key,name,area,measure,minutes,direction,target_percent,bonus_tiers,counts_for_bonus,placeholder,sort_order)
 select v.seed_key,v.name,v.area,v.measure,v.minutes,v.direction,
  case when v.seed_key='guest_reply_within_5' then t.pass else v.target end,
  case when v.seed_key='guest_reply_within_5' then array(select distinct b from unnest(t.tiers) b where b>t.pass order by b) else v.tiers end,
  v.bonus,v.placeholder,v.sort_order
 from t cross join (values
  ('guest_reply_within_5','Replies within 5 minutes','guest_relations','guest_reply_within',5,'higher',80,array[90,95],true,false,1),
  ('guest_reply_within_10','Replies within 10 minutes','guest_relations','guest_reply_within',10,'higher',null::integer,array[]::integer[],false,false,2),
  ('guest_reply_within_30','Replies within 30 minutes','guest_relations','guest_reply_within',30,'higher',null,array[]::integer[],false,false,3),
  ('guest_reply_within_60','Replies within 60 minutes','guest_relations','guest_reply_within',60,'higher',null,array[]::integer[],false,false,4),
  ('guest_reply_over_60','Replies waiting over 60 minutes','guest_relations','guest_reply_over',60,'lower',null,array[]::integer[],false,false,5),
  ('client_relations_daily_work','Daily work done','client_relations','daily_work_done',null,'higher',80,array[90,95],true,true,1),
  ('cleaning_forms_on_time','Cleaning forms in on time','cleaning','clean_forms_on_time',null,'higher',80,array[90,95],true,true,1),
  ('ready_score','Performance score','ready','performance_score',null,'higher',80,array[90,95],true,true,1),
  ('accounts_score','Performance score','accounts','performance_score',null,'higher',80,array[90,95],true,true,1),
  ('management_score','Performance score','management','performance_score',null,'higher',80,array[90,95],true,true,1)
 ) v(seed_key,name,area,measure,minutes,direction,target,tiers,bonus,placeholder,sort_order)
 on conflict (seed_key) do nothing
 returning *)
insert into private.workspace_kpi_changes(kpi_id,change,after) select added.id,'seeded',to_jsonb(added) from added;

-- 6. Routes, appended after the hub anchors of the latest definitions.
do $$
declare
 -- function, anchor (must occur exactly once, kept at the start of the replacement), replacement, sentinel
 fixes constant text[][] := array[
  ['private.workspace_teams_read(text,date,date,uuid,uuid)',
   $q$elsif section='hub' then result:=private.workspace_hub_read();$q$,
   $q$elsif section='hub' then result:=private.workspace_hub_read();
 elsif section='kpis' then result:=private.workspace_kpis_read(start_on,end_on);$q$,
   $q$result:=private.workspace_kpis_read(start_on,end_on);$q$],
  ['private.workspace_teams_action(jsonb)',
   $q$if a in ('saveHubItem','moveHubItem') then return private.workspace_hub_action(input);end if;$q$,
   $q$if a in ('saveHubItem','moveHubItem') then return private.workspace_hub_action(input);end if;
 if a in ('saveKpi','setKpiActive','moveKpi') then return private.workspace_kpi_action(input);end if;$q$,
   $q$return private.workspace_kpi_action(input);$q$]
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

insert into supabase_migrations.schema_migrations(version,name) values('20261015100000','kpi_tracker');

-- ===== 20261015110000_payout_stay_summary =====
-- What the "Approve the payout" sheet shows before anyone approves (Lee, 13 October 2026: "all of the information should show:
-- the property, the guest, the amount, the date etc, to make sure they know what they are approving").
--
-- The reconciliation read already gives the reference, platform, platform code, dates, guests and the money. This adds the
-- rest as one finance report, 'payoutStay' (public.workspace_finance_report('payoutStay', null, <reservation id>)), reached
-- only after that function's finance-role and Accounts checks, like every other report:
--   propertyName, propertyAddress, status (confirmed, cancelled or enquiry), guestName (staff only: finance roles, never an
--   owner), nights, lines (the payout lines matched to the stay: paid on, file, amount, gross, set aside or not),
--   statement (the issued or paid owner statement that holds the stay's money, if any), and the warnings:
--   changedSinceStatement (dates, money or status changed since that statement stored its copy) and
--   differentAfterStatement (the money settled now differs from that copy).
-- The repeated-amount warning is already on the reconciliation row (repeatedAmount).
-- Read only; nothing is patched. Safe to run more than once.

create or replace function private.workspace_report_payout_stay(target_property uuid,target_id uuid,from_on date,to_on date,filters jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
declare r private.workspace_reservations;prop public.workspace_properties;held jsonb;st_id uuid;st private.workspace_owner_statements;settled bigint;
begin
 if target_id is null then raise exception 'Choose a stay' using errcode='22023';end if;
 if filters is not null and jsonb_typeof(filters)='object' and exists(select 1 from jsonb_object_keys(filters)) then raise exception 'Invalid report filters' using errcode='22023';end if;
 select * into r from private.workspace_reservations x where x.id=target_id;
 if r.id is null or (target_property is not null and r.property_id<>target_property) or not private.workspace_can_property(r.property_id,'owner-statements') then
  raise exception 'Stay not found' using errcode='P0002';
 end if;
 select * into prop from public.workspace_properties x where x.id=r.property_id;
 settled:=case when r.channel in ('airbnb','booking_com','vrbo') then (private.workspace_payout_row(r)->>'settledMinor')::bigint else r.payout_minor end;
 -- The first issued or paid statement whose stored copy counts this stay.
 select o.id,q.v into st_id,held from private.workspace_owner_statements o
  cross join lateral jsonb_array_elements(case when jsonb_typeof(o.detail->'stays')='array' then o.detail->'stays' else '[]'::jsonb end) e
  cross join lateral (select private.workspace_statement_entry(e) v) q
  where o.property_id=r.property_id and o.status in ('issued','paid') and q.v->>'reservationId'=r.id::text and coalesce((q.v->>'counted')::boolean,false)
  order by o.period_start,o.id limit 1;
 select * into st from private.workspace_owner_statements o where o.id=st_id;
 return jsonb_build_object('section','payoutStay','reservationId',r.id,'propertyId',r.property_id,
  'propertyName',prop.name,'propertyAddress',prop.address,'status',r.status,
  'guestName',private.workspace_stay_guest_name(r.id),'guests',r.guests,'checkIn',r.check_in,'checkOut',r.check_out,'nights',r.check_out-r.check_in,
  'lines',coalesce((select jsonb_agg(jsonb_build_object('lineId',l.id,'paidOn',l.paid_on,'uploadedAt',rp.created_at,'fileName',rp.file_name,'reference',l.reference,
     'amountMinor',l.amount_minor,'grossMinor',l.gross_minor,'active',l.set_aside_at is null) order by coalesce(l.paid_on,(rp.created_at at time zone 'Europe/London')::date),rp.created_at,l.id)
   from private.workspace_payout_lines l join private.workspace_payout_reports rp on rp.id=l.report_id
   where r.channel_reference is not null and rp.channel=r.channel and upper(l.reference)=upper(r.channel_reference)),'[]'::jsonb),
  'locked',private.workspace_payout_stay_locked(r),
  'statement',case when st.id is not null then jsonb_build_object('id',st.id,'periodStart',st.period_start,'periodEnd',st.period_end,'status',st.status) end,
  'changedSinceStatement',held is not null and (r.status<>'confirmed' or r.check_in::text<>held->>'checkIn' or r.check_out::text<>held->>'checkOut'
    or settled is distinct from (held->>'settledMinor')::bigint),
  'differentAfterStatement',held is not null and held ? 'settledMinor' and settled is distinct from (held->>'settledMinor')::bigint);
end $fn$;

revoke all on function private.workspace_report_payout_stay(uuid,uuid,date,date,jsonb) from public,anon,authenticated;

insert into supabase_migrations.schema_migrations(version,name) values('20261015110000','payout_stay_summary');

-- ===== 20261015120000_clean_form_submitted_at =====
-- When a cleaning form was sent (lead developer, 13 October 2026). A clean recorded who sent its form (submittedBy) but not
-- when, so "cleaning forms in on time" (the KPI tracker, 20261015100000) could only rely on the sweep's reminder marker.
--
-- 1. private.workspace_operations_action: submitting the cleaning report now also stamps data.submittedAt (UTC, ISO),
--    set by the server. The app sends nothing new. A clean sent back after a review and sent again keeps its first
--    stamp, so a correction does not make a form that was on time late.
-- 2. private.workspace_kpi_clean_forms (replaced whole; only 20261015100000 defines it): a clean with submittedAt is on
--    time when that is at or before 18:00 London on its day (private.workspace_clean_form_due_time()). An older clean
--    without the stamp falls back to the reminder rule: on time when its form is in and the sweep never reminded the
--    cleaner (unsubmittedAt) or warned management (formWarningAt).
--
-- The patch reads the LATEST definition, needs its anchor exactly once and is skipped once applied, so the migration is
-- safe to run twice.

do $patch$
declare
 definition text;n integer;
 anchor constant text:=$q$data:=data||jsonb_build_object('phase','review','submittedBy',auth.uid());next_status:='in_review';$q$;
 replacement constant text:=$q$data:=data||jsonb_build_object('phase','review','submittedBy',auth.uid(),'submittedAt',coalesce(d.data->'submittedAt',to_jsonb(to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))));next_status:='in_review';$q$;
 sentinel constant text:=$q$'submittedAt',coalesce(d.data->'submittedAt'$q$;
begin
 definition:=pg_get_functiondef('private.workspace_operations_action(jsonb)'::regprocedure);
 if position(sentinel in definition)=0 then
  n:=(length(definition)-length(replace(definition,anchor,'')))/length(anchor);
  if n<>1 then raise exception 'Patch anchor found % times in private.workspace_operations_action(jsonb), expected once',n;end if;
  execute replace(definition,anchor,replacement);
  if position(sentinel in pg_get_functiondef('private.workspace_operations_action(jsonb)'::regprocedure))=0 then raise exception 'Patch did not take in private.workspace_operations_action(jsonb)';end if;
 end if;
end $patch$;

-- On time: sent by 18:00 London on the clean's day when the stamp is there; otherwise the reminder rule.
create or replace function private.workspace_clean_form_on_time(item jsonb,clean_day date) returns boolean language plpgsql stable set search_path='' as $fn$
begin
 if not private.workspace_clean_form_in(item) then return false;end if;
 if jsonb_typeof(item->'submittedAt')='string' then
  return clean_day is not null and ((item->>'submittedAt')::timestamptz at time zone private.workspace_clean_form_zone())<=(clean_day::timestamp+private.workspace_clean_form_due_time()::time);
 end if;
 return not (item ? 'unsubmittedAt') and not (item ? 'formWarningAt');
exception when others then
 return not (item ? 'unsubmittedAt') and not (item ? 'formWarningAt');
end $fn$;

create or replace function private.workspace_kpi_clean_forms(cleaners uuid[],start_on date,end_on date) returns jsonb language sql stable security definer set search_path='' as $fn$
 with c as (select private.workspace_clean_form_in(d.data) form_in,d.data,private.workspace_clean_form_day(w.due_on,d.data) clean_day
  from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
  where d.kind='cleaning' and w.assignee_id=any(cleaners) and w.status not in ('cancelled','declined')),
 s as (select count(*) filter(where c.form_in or private.workspace_clean_form_is_due(c.clean_day,now()) or c.data ? 'unsubmittedAt') settled,
   count(*) filter(where private.workspace_clean_form_on_time(c.data,c.clean_day)) on_time
  from c where c.clean_day between start_on and end_on)
 select jsonb_build_object('measured',s.settled,'count',s.on_time,'value',case when s.settled>0 then floor(s.on_time*100.0/s.settled)::int end) from s;
$fn$;

revoke all on function private.workspace_clean_form_on_time(jsonb,date),private.workspace_kpi_clean_forms(uuid[],date,date) from public,anon,authenticated;

insert into supabase_migrations.schema_migrations(version,name) values('20261015120000','clean_form_submitted_at');

-- ===== 20261015200000_enquiry_property_on_submit =====
-- Every new enquiry is in Properties straight away (approved by Lee, docs/notes-session-B.md section 5).
-- When a landlord submits the New Property Enquiry Form (workspace_enquiry_public, action submit), the
-- same transaction now creates:
--   * the property: status onboarding, named from the first line of the address (the same rule as
--     valuationDraft in lib/client-enquiry.ts), region left blank so the region trigger fills it from the
--     address, created_by = the team member who sent the link;
--   * its onboarding journey at stage enquiry, with no owner (client_id null) and only the property's facts
--     (WCs, parking, garden, photo link, existing client). Contact details stay on the enquiry;
--   * the "Property onboarding" work item, created_by = the link sender.
-- The journey's insert trigger gives the onboarding team (Guest relations with property onboarding) their
-- usual staff assignment; it now falls back to the work item's creator for granted_by, as nobody is signed
-- in on a public submit.
-- Duplicates are flagged, never merged: duplicate_of names an existing property at the same address (case,
-- spacing, punctuation and the postcode's space ignored), and duplicate_reason says why ('same_address', or
-- 'existing_client' when the landlord said they already work with us).
-- Start valuing reuses that property: the team's corrections (name, address, region, type, rooms, enquiry
-- details) are saved onto it instead of creating a second one. Closing the enquiry archives the journey and
-- the property and marks the onboarding work item declined (the journey's own rule for an archived journey,
-- which workspace_onboarding_status_guard enforces), while the journey is still at stage enquiry.
-- Privacy: owners, cleaners and Ready have no assignment, so never see it. Accounts read every property
-- (table policy and workspace_can_property); both now leave out a property whose journey is still at stage
-- enquiry, whoever created it.
-- No backfill: enquiries already answered keep today's flow (docs/notes-session-B.md lists them).
-- Shared functions are patched by anchor and append (the anchor stays word for word at the start of its
-- replacement, each patch has its own sentinel, a missing or repeated anchor raises). Safe to run twice.

alter table private.workspace_client_enquiries add column if not exists duplicate_of uuid references public.workspace_properties(id);
alter table private.workspace_client_enquiries add column if not exists duplicate_reason text not null default '';
create index if not exists workspace_client_enquiries_duplicate_idx on private.workspace_client_enquiries(duplicate_of);
do $$
declare c record;
begin
 -- "valuing exactly when a property is linked" no longer holds: an answered enquiry has its property, and a
 -- closed one keeps its archived property. Valuing still needs one.
 for c in select conname from pg_constraint where conrelid='private.workspace_client_enquiries'::regclass and contype='c'
   and pg_get_constraintdef(oid) like '%property_id IS NOT NULL%' and conname<>'workspace_client_enquiries_valuing_property' loop
  execute format('alter table private.workspace_client_enquiries drop constraint %I', c.conname);
 end loop;
 if not exists(select 1 from pg_constraint where conrelid='private.workspace_client_enquiries'::regclass and conname='workspace_client_enquiries_valuing_property') then
  alter table private.workspace_client_enquiries add constraint workspace_client_enquiries_valuing_property check(status<>'valuing' or property_id is not null);
 end if;
 if not exists(select 1 from pg_constraint where conrelid='private.workspace_client_enquiries'::regclass and conname='workspace_client_enquiries_duplicate_reason') then
  alter table private.workspace_client_enquiries add constraint workspace_client_enquiries_duplicate_reason check(duplicate_reason in ('','same_address','existing_client'));
 end if;
end $$;

-- The property's name from its address: the first line, or "17 Warrender Park Road (3F2)" when the first
-- line is only a flat's position. Mirrors valuationDraft in lib/client-enquiry.ts (tests check they agree).
create or replace function private.workspace_enquiry_property_name(address text) returns text language plpgsql immutable set search_path='' as $fn$
declare parts text[]; name text;
begin
 select coalesce(array_agg(btrim(x.part) order by x.n),'{}') into parts
  from regexp_split_to_table(coalesce(address,''),'[\n,]') with ordinality as x(part,n) where btrim(x.part)<>'';
 if cardinality(parts)>1 and char_length(parts[1])<=10 and parts[1]~'[0-9]' and parts[2]~*'[a-z]{3}' then name:=parts[2]||' ('||parts[1]||')';
 else name:=coalesce(parts[1],btrim(coalesce(address,'')));
 end if;
 name:=left(name,200);
 return case when char_length(btrim(name))>=2 then name else 'New enquiry' end;
end $fn$;

-- An address reduced for comparing: lower case, the postcode's space removed, punctuation and spacing
-- collapsed, and a trailing UK, United Kingdom or Scotland dropped.
create or replace function private.workspace_address_key(address text) returns text language sql immutable set search_path='' as $fn$
 select regexp_replace(btrim(regexp_replace(regexp_replace(lower(coalesce(address,'')),'([a-z]{1,2}[0-9][a-z0-9]?)\s*([0-9][a-z]{2})','\1\2','g'),'[^a-z0-9]+',' ','g')),'(\s+(uk|united kingdom|scotland))+$','')
$fn$;

-- True while a property's onboarding journey is at stage enquiry (nobody has valued it yet).
create or replace function private.workspace_property_unvalued(target uuid) returns boolean language sql stable security definer set search_path='' as $fn$
 select exists(select 1 from private.workspace_journeys j where j.property_id=target and j.stage='enquiry')
$fn$;

-- The property, journey and work item for an answered enquiry, once. Called from the public submit only.
create or replace function private.workspace_enquiry_create_property(enquiry_id uuid) returns uuid language plpgsql security definer set search_path='' as $fn$
declare e private.workspace_client_enquiries; ans jsonb; prop uuid; task uuid; key text; dup uuid; details jsonb:='{}';
begin
 select * into e from private.workspace_client_enquiries x where x.id=enquiry_id for update;
 if e.id is null or e.answers is null then raise exception 'Enquiry not answered' using errcode='22023';end if;
 if e.property_id is not null then return e.property_id;end if;
 ans:=e.answers;
 insert into public.workspace_properties(name,address,region,bedrooms,created_by,request_id)
  values(private.workspace_enquiry_property_name(ans->>'propertyAddress'),left(btrim(ans->>'propertyAddress'),1000),'',
   coalesce((ans->>'bedrooms')::int,0),e.sent_by,md5(e.id::text||':enquiry-property')::uuid) returning id into prop;
 insert into public.workspace_work_items(request_id,property_id,module_id,title,created_by,client_visible)
  values(md5(e.id::text||':enquiry-work')::uuid,prop,'property-onboarding','Property onboarding',e.sent_by,true) returning id into task;
 -- Only the property's facts; the landlord's name, email, phone and notes stay on the enquiry.
 if jsonb_typeof(ans->'wcs')='number' then details:=details||jsonb_build_object('wcs',ans->'wcs');end if;
 if btrim(coalesce(ans->>'parking',''))<>'' then details:=details||jsonb_build_object('parking',left(btrim(ans->>'parking'),300));end if;
 if btrim(coalesce(ans->>'garden',''))<>'' then details:=details||jsonb_build_object('garden',left(btrim(ans->>'garden'),300));end if;
 if coalesce(ans->>'mediaLink','')<>'' then details:=details||jsonb_build_object('photoLink',left(ans->>'mediaLink',300));end if;
 if ans->>'existingClient' in ('yes','no') then details:=details||jsonb_build_object('existingClient',ans->>'existingClient'='yes');end if;
 insert into private.workspace_journeys(property_id,client_id,work_id,property_type,bathrooms,enquiry)
  values(prop,null,task,left(btrim(ans->>'propertyType'),120),coalesce((ans->>'bathrooms')::int,0),private.workspace_enquiry_details(details,false));
 -- A possible duplicate: the same address as another property still in use.
 key:=private.workspace_address_key(ans->>'propertyAddress');
 if key<>'' then
  select p.id into dup from public.workspace_properties p where p.id<>prop and p.status<>'archived' and private.workspace_address_key(p.address)=key order by p.created_at,p.id limit 1;
 end if;
 update private.workspace_client_enquiries set property_id=prop,duplicate_of=dup,
  duplicate_reason=case when dup is not null then 'same_address' when ans->>'existingClient'='yes' then 'existing_client' else '' end
  where id=e.id;
 return prop;
end $fn$;

-- Start valuing on an enquiry that already has its property: the team's corrections go onto it.
create or replace function private.workspace_enquiry_value_property(e private.workspace_client_enquiries, input jsonb) returns void language plpgsql security definer set search_path='' as $fn$
declare j private.workspace_journeys;
begin
 select * into j from private.workspace_journeys x where x.property_id=e.property_id for update;
 if j.property_id is null then raise exception 'Journey not found' using errcode='P0002';end if;
 -- Once the onboarding has moved on (an estimate was sent from the property), its details are left alone.
 if j.stage='enquiry' then
  update public.workspace_properties set name=private.workspace_required_text(input,'name',2,200),address=private.workspace_required_text(input,'address',5,1000),
   region=coalesce(input->>'region',''),bedrooms=coalesce((input->>'bedrooms')::int,0),version=version+1,updated_at=now() where id=e.property_id;
  update private.workspace_journeys set property_type=private.workspace_required_text(input,'propertyType',2,120),bathrooms=coalesce((input->>'bathrooms')::int,0),
   enquiry=private.workspace_enquiry_details(coalesce(input->'enquiry','{}'),j.client_id is null),version=version+1,updated_at=now() where property_id=e.property_id;
 end if;
 if private.workspace_actor_role()='stays' then
  insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values(e.property_id,auth.uid(),'staff',auth.uid()) on conflict(property_id,user_id) do nothing;
 end if;
end $fn$;

-- Closing an enquiry whose property nobody has valued yet archives the property: the journey, the property
-- and its onboarding work item, which reads declined like any archived journey's (the onboarding status guard
-- allows only that once the journey is archived). Nothing is deleted. A property that has moved on is left as it is.
create or replace function private.workspace_enquiry_archive_property(prop uuid) returns void language plpgsql security definer set search_path='' as $fn$
declare j private.workspace_journeys;
begin
 if prop is null then return;end if;
 select * into j from private.workspace_journeys x where x.property_id=prop for update;
 if j.property_id is null or j.stage<>'enquiry' then return;end if;
 update private.workspace_journeys set stage='archived',version=version+1,updated_at=now() where property_id=prop;
 update public.workspace_properties set status='archived',version=version+1,updated_at=now() where id=prop;
 update public.workspace_work_items set status='declined',version=version+1,updated_at=now() where id=j.work_id and status<>'declined';
end $fn$;

revoke all on function private.workspace_enquiry_property_name(text),private.workspace_address_key(text),private.workspace_enquiry_create_property(uuid),
 private.workspace_enquiry_value_property(private.workspace_client_enquiries,jsonb),private.workspace_enquiry_archive_property(uuid) from public,anon,authenticated,service_role;
revoke all on function private.workspace_property_unvalued(uuid) from public,anon;
grant execute on function private.workspace_property_unvalued(uuid) to authenticated;

-- Accounts see every property except one still at the enquiry stage.
create or replace function private.workspace_can_property(target uuid, feature text) returns boolean language sql stable security definer set search_path='' as $$
  select private.has_workspace_module(feature) and (
    private.workspace_actor_role() in ('admin','super_admin') or
    (private.workspace_actor_role()='accounts' and private.workspace_finance_feature(feature) and exists(select 1 from public.workspace_properties p where p.id=target) and not private.workspace_property_unvalued(target)) or
    exists (
      select 1 from public.workspace_property_assignments a where a.property_id=target and a.user_id=auth.uid()
        and a.assignment=case private.workspace_actor_role() when 'client' then 'client' when 'cleans' then 'cleaner' when 'cleaning_manager' then 'cleaning_manager' else 'staff' end
    )
  );
$$;
alter policy properties_assigned on public.workspace_properties using (
 (select private.workspace_actor_role()) is not null and (select private.workspace_onboarded()) and
 ((select private.workspace_actor_role()) in ('admin','super_admin') or ((select private.workspace_actor_role())='accounts' and not private.workspace_property_unvalued(id))
  or exists(select 1 from public.workspace_property_assignments a where a.property_id=id and a.user_id=(select auth.uid())))
);

do $$
declare
 fixes constant text[][] := array[
  -- The public submit creates the property in the same transaction. (The enquiry.received notice is
  -- unchanged: giving it a property would change who reads it under activity_scoped.)
  ['private.workspace_enquiry_public(jsonb)',
   $q$update private.workspace_client_enquiries set status='received',answers=ans,submitted_at=now(),version=version+1 where id=e.id returning * into e;$q$,
   $q$update private.workspace_client_enquiries set status='received',answers=ans,submitted_at=now(),version=version+1 where id=e.id returning * into e;
  perform private.workspace_enquiry_create_property(e.id);
  select * into e from private.workspace_client_enquiries x where x.id=e.id;$q$,
   $q$perform private.workspace_enquiry_create_property(e.id);$q$],
  -- Start valuing: reuse the property the submit made, and finish there (the same receipt and answer as the
  -- rest of the action). Enquiries answered before this migration have no property and keep the old path.
  -- One-line anchor (the comment just after startValuing's version check), so the patch matches whatever line
  -- endings the function was created with.
  ['private.workspace_client_enquiry_action(jsonb)',
   $q$-- The property and its onboarding journey, made exactly as an enquiry added by hand.$q$,
   $q$-- The property and its onboarding journey, made exactly as an enquiry added by hand.
  if e.property_id is not null then
   perform private.workspace_enquiry_value_property(e,input);
   update private.workspace_client_enquiries set status='valuing',valued_by=auth.uid(),valued_at=now(),version=version+1 where id=e.id returning * into e;
   result:=private.workspace_client_enquiry_view(e);
   insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
   return result;
  end if;$q$,
   $q$perform private.workspace_enquiry_value_property(e,input);$q$],
  -- Closing archives the property while nobody has valued it.
  ['private.workspace_client_enquiry_action(jsonb)',
   $q$update private.workspace_client_enquiries set status='closed',closed_by=auth.uid(),closed_at=now(),close_note=private.workspace_required_text(input,'note',3,500),version=version+1 where id=e.id returning * into e;$q$,
   $q$update private.workspace_client_enquiries set status='closed',closed_by=auth.uid(),closed_at=now(),close_note=private.workspace_required_text(input,'note',3,500),version=version+1 where id=e.id returning * into e;
  perform private.workspace_enquiry_archive_property(e.property_id);$q$,
   $q$perform private.workspace_enquiry_archive_property(e.property_id);$q$],
  -- The team sees a possible duplicate on the enquiry.
  ['private.workspace_client_enquiry_view(private.workspace_client_enquiries)',
   $q$'closeNote',e.close_note,'version',e.version)$q$,
   $q$'closeNote',e.close_note,'version',e.version)||jsonb_build_object('duplicateOf',e.duplicate_of,'duplicateReason',nullif(e.duplicate_reason,''),
  'duplicateOfName',(select x.name from public.workspace_properties x where x.id=e.duplicate_of))$q$,
   $q$'duplicateOfName'$q$],
  -- Nobody is signed in on a public submit, and the journey has no owner: the work item's creator grants.
  ['private.workspace_assign_onboarding_team()',
   $q$coalesce(auth.uid(),new.client_id)$q$,
   $q$coalesce(auth.uid(),new.client_id,(select w.created_by from public.workspace_work_items w where w.id=new.work_id))$q$,
   $q$coalesce(auth.uid(),new.client_id,(select w.created_by$q$]
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

insert into supabase_migrations.schema_migrations(version,name) values('20261015200000','enquiry_property_on_submit');

-- ===== 20261015210000_menu_layouts =====
-- Menu order per role (Lee's request, round 5). A super admin rearranges the left panel for each role in
-- Access control → Menu order: the order of the sections, and the order of the links inside each section.
-- The same order drives the desktop panel and the phone (lib/menu-layout.ts merges it). It only REORDERS:
-- what a role may see still comes from its role and tools, never from this table.
--  * private.workspace_menu_layouts: one small row per role (section keys in order, and per section the link
--    keys in order), with version, updated_by and updated_at. Empty arrays mean the default order.
--  * Team read section menuLayout: anyone signed in gets their OWN role's layout, order data only. While a
--    super admin views as someone, the reads run as that person, so they get that person's role.
--  * Team read section menuLayouts: super admins get every role's layout with who changed it last.
--  * Team actions saveMenuLayout and resetMenuLayout: super admins only, with an optimistic version check.
--    Every change is written to workspace_access_events (menu_order_saved, menu_order_reset), with the role,
--    the old and the new order.
-- Routes are appended after the hub anchors in workspace_teams_read and workspace_teams_action (anchor kept
-- word for word, own sentinel, a missing or repeated anchor raises). Safe to run twice.

create table if not exists private.workspace_menu_layouts (
 role text primary key check(role in ('super_admin','admin','stays','cleaning_manager','cleans','ready','accounts','client')),
 sections jsonb not null default '[]' check(jsonb_typeof(sections)='array'),
 items jsonb not null default '{}' check(jsonb_typeof(items)='object'),
 version integer not null default 1 check(version>0),
 updated_by uuid references public.workspace_profiles(user_id),
 updated_at timestamptz not null default now()
);
create index if not exists workspace_menu_layouts_updated_by_idx on private.workspace_menu_layouts(updated_by);
alter table private.workspace_menu_layouts enable row level security;
revoke all on private.workspace_menu_layouts from public,anon,authenticated;

-- A layout as the app reads it. Only order data, unless the caller is a super admin (who also sees who changed it).
create or replace function private.workspace_menu_layout_view(target_role text,full_view boolean) returns jsonb language sql stable security definer set search_path='' as $fn$
 select jsonb_build_object('role',target_role,'sections',coalesce(m.sections,'[]'::jsonb),'items',coalesce(m.items,'{}'::jsonb),'version',coalesce(m.version,0))
  ||case when full_view then jsonb_build_object('updatedAt',m.updated_at,'updatedByName',(select nullif(btrim(p.full_name),'') from public.workspace_profiles p where p.user_id=m.updated_by)) else '{}'::jsonb end
 from (select 1) one left join private.workspace_menu_layouts m on m.role=target_role
$fn$;

-- Your own role's menu order.
create or replace function private.workspace_menu_layout_read() returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();
begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 return private.workspace_menu_layout_view(actor,false);
end $fn$;

-- Every role's menu order, for the editor.
create or replace function private.workspace_menu_layouts_read() returns jsonb language plpgsql stable security definer set search_path='' as $fn$
begin
 if private.workspace_actor_role() is distinct from 'super_admin' then raise exception 'Only super admins can change the menu order' using errcode='42501';end if;
 return (select jsonb_agg(private.workspace_menu_layout_view(r,true) order by n) from unnest(array['super_admin','admin','stays','cleaning_manager','cleans','ready','accounts','client']) with ordinality as x(r,n));
end $fn$;

-- A list of stable keys: strings of lower-case letters, digits and : _ = -, each once, at most `most`.
create or replace function private.workspace_menu_keys(list jsonb,most integer) returns jsonb language plpgsql immutable set search_path='' as $fn$
begin
 if jsonb_typeof(list) is distinct from 'array' or jsonb_array_length(list)>most
  or exists(select 1 from jsonb_array_elements(list) k where jsonb_typeof(k)<>'string' or (k#>>'{}')!~'^[a-z0-9:_=-]{1,80}$')
  or (select count(distinct k) from jsonb_array_elements_text(list) k)<>jsonb_array_length(list) then
  raise exception 'Invalid menu order' using errcode='22023';
 end if;
 return list;
end $fn$;

create or replace function private.workspace_menu_layout_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();a text:=input->>'action';req uuid;prior private.workspace_action_receipts;result jsonb;
 target text;m private.workspace_menu_layouts;sections jsonb:='[]';items jsonb:='{}';k text;v jsonb;before jsonb;
begin
 if actor is distinct from 'super_admin' then raise exception 'Only super admins can change the menu order' using errcode='42501';end if;
 req:=(input->>'requestId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 prior:=(select x from private.workspace_action_receipts x where x.actor_id=auth.uid() and x.request_id=req);
 if prior.actor_id is not null then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;
 if a='saveMenuLayout' then perform private.workspace_json_keys(input,array['action','requestId','role','version','sections','items']);
 else perform private.workspace_json_keys(input,array['action','requestId','role','version']);end if;
 target:=input->>'role';
 if target is null or target not in ('super_admin','admin','stays','cleaning_manager','cleans','ready','accounts','client') then raise exception 'Choose a role' using errcode='22023';end if;
 if jsonb_typeof(input->'version') is distinct from 'number' then raise exception 'Version required' using errcode='22023';end if;
 select * into m from private.workspace_menu_layouts x where x.role=target for update;
 if coalesce(m.version,0)<>(input->>'version')::int then raise exception 'Changed by someone else. Refresh and try again' using errcode='40001';end if;
 before:=jsonb_build_object('role',target,'sections',coalesce(m.sections,'[]'::jsonb),'items',coalesce(m.items,'{}'::jsonb));
 if a='saveMenuLayout' then
  sections:=private.workspace_menu_keys(input->'sections',40);
  if jsonb_typeof(input->'items') is distinct from 'object' or (select count(*) from jsonb_object_keys(input->'items'))>40 then raise exception 'Invalid menu order' using errcode='22023';end if;
  for k,v in select x.key,x.value from jsonb_each(input->'items') x loop
   if k!~'^[a-z0-9:_=-]{1,80}$' then raise exception 'Invalid menu order' using errcode='22023';end if;
   items:=items||jsonb_build_object(k,private.workspace_menu_keys(v,80));
  end loop;
 elsif a<>'resetMenuLayout' then raise exception 'Unknown team action' using errcode='22023';
 end if;
 insert into private.workspace_menu_layouts(role,sections,items,version,updated_by,updated_at) values(target,sections,items,coalesce(m.version,0)+1,auth.uid(),now())
  on conflict(role) do update set sections=excluded.sections,items=excluded.items,version=private.workspace_menu_layouts.version+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
 -- The access history names the super admin who changed it; the role is in the detail.
 insert into public.workspace_access_events(user_id,actor_id,event_type,old_access,new_access)
  values(auth.uid(),auth.uid(),case when a='saveMenuLayout' then 'menu_order_saved' else 'menu_order_reset' end,before,jsonb_build_object('role',target,'sections',sections,'items',items));
 result:=private.workspace_menu_layout_view(target,true);
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $fn$;

revoke all on function private.workspace_menu_layout_view(text,boolean),private.workspace_menu_layout_read(),private.workspace_menu_layouts_read(),
 private.workspace_menu_keys(jsonb,integer),private.workspace_menu_layout_action(jsonb) from public,anon,authenticated;

do $$
declare
 fixes constant text[][] := array[
  ['private.workspace_teams_read(text,date,date,uuid,uuid)',
   $q$elsif section='hub' then result:=private.workspace_hub_read();$q$,
   $q$elsif section='hub' then result:=private.workspace_hub_read();
 elsif section='menuLayout' then result:=private.workspace_menu_layout_read();
 elsif section='menuLayouts' then result:=private.workspace_menu_layouts_read();$q$,
   $q$result:=private.workspace_menu_layout_read();$q$],
  ['private.workspace_teams_action(jsonb)',
   $q$if a in ('saveHubItem','moveHubItem') then return private.workspace_hub_action(input);end if;$q$,
   $q$if a in ('saveHubItem','moveHubItem') then return private.workspace_hub_action(input);end if;
 if a in ('saveMenuLayout','resetMenuLayout') then return private.workspace_menu_layout_action(input);end if;$q$,
   $q$return private.workspace_menu_layout_action(input);$q$]
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

insert into supabase_migrations.schema_migrations(version,name) values('20261015210000','menu_layouts');

-- ===== 20261015300000_chat_notice_every_message =====
-- Chat notices, one per message (Lee, round 5): every new message in a chat tells everyone who hears that chat, not once per
-- conversation until it is opened (20261014320000). Who hears a chat is unchanged (private.chat_audience: the members; for an
-- owner's conversation the owner and the team that answers owners; for a team channel its department, admins only Management and
-- Everyone). The sender is never told, a person who blocked the sender is never told, and nobody outside the audience is told.
-- Email and push still go only for notices under 24 hours old (integration_claim_notifications), so a busy chat now pushes on
-- every message.
-- The send branch tells everyone due by private.chat_notice_due (20261014320000); from here everyone is due. Replaced whole (only
-- 20261014320000 defines it). private.chat_notified keeps recording when each person was last told; nothing reads it now.
create or replace function private.chat_notice_due(target uuid,subject uuid) returns boolean language sql stable security definer set search_path='' as $fn$
 select true
$fn$;
revoke all on function private.chat_notice_due(uuid,uuid) from public,anon,authenticated;

insert into supabase_migrations.schema_migrations(version,name) values('20261015300000','chat_notice_every_message');

-- ===== 20261015310000_guest_message_notices =====
-- Guest message notices (Lee, round 5): every guest message that arrives tells the Stays (Guest relations) team who can open it and
-- the admins, at any hour, night included (no quiet hours). Until now a guest message told nobody; the team saw it only through the
-- Guests badge and the "guests waiting" to-do.
-- Who is told about a message on a property:
--  * every active admin and super admin;
--  * every active person with the stays role who holds the guest communication tool and is assigned to that property as staff
--    (for a conversation not yet matched to a property: every such Stays person, as the guest inbox shares those with everyone);
--  * never the person who logged the message by hand, never an owner, cleaner or Ready (workspace_guest_messaging_role).
-- Each guest message adds one 'guest.message' activity row carrying the property (no work item, so the activity_scoped policy keeps it
-- from anyone who cannot already see everything, and the workflow notice routes, which fire only for rows with a work item, are not
-- involved) and one notice per person. Email and push go only for notices under 24 hours old, as for every notice.
-- Where: an AFTER INSERT trigger on private.workspace_guest_messages, once per statement, over the rows actually inserted. That covers
-- the Hostaway import (workspace_hostaway_messages_ingest, through workspace_guest_messages_ingest), any other channel feed through
-- workspace_guest_messages_ingest, and a message logged by hand (logMessage), without patching any of the three; a message that was
-- already stored (on conflict do nothing) is not inserted again and tells nobody again. Only guest messages sent in the last 24 hours
-- notify, so a first import that brings in up to 14 days of history does not flood anyone. Team replies notify nobody.
-- The trigger swallows its own errors (a warning), so a notice can never stop a guest message being stored.

-- The people told about a guest message on a property (null: not yet matched to a property).
create or replace function private.workspace_guest_message_recipients(prop uuid) returns setof uuid language sql stable security definer set search_path='' as $fn$
 select p.user_id from public.workspace_profiles p
 where p.status='active' and (
  p.role in ('admin','super_admin')
  or (p.role='stays' and private.workspace_guest_messaging_role(p.role)
   and exists(select 1 from public.workspace_module_grants g where g.user_id=p.user_id and g.module_id='guest-communication')
   and (prop is null or exists(select 1 from public.workspace_property_assignments a where a.property_id=prop and a.user_id=p.user_id and a.assignment='staff'))))
$fn$;

create or replace function private.workspace_guest_message_notices() returns trigger language plpgsql security definer set search_path='' as $fn$
declare m record;ev bigint;me uuid:=auth.uid();
begin
 begin
  for m in select a.property_id from added a where a.direction='guest' and a.sent_at>now()-interval '24 hours' order by a.sent_at,a.id loop
   insert into public.workspace_activity(actor_id,property_id,event_type) values(me,m.property_id,'guest.message') returning id into ev;
   insert into private.workspace_notification_outbox(user_id,event_id)
    select u,ev from private.workspace_guest_message_recipients(m.property_id) u where u is distinct from me
   on conflict do nothing;
  end loop;
 exception when others then
  -- A notice is never worth losing the guest's message.
  raise warning 'Guest message notices skipped: %',sqlerrm;
 end;
 return null;
end $fn$;

drop trigger if exists workspace_guest_message_notices on private.workspace_guest_messages;
create trigger workspace_guest_message_notices after insert on private.workspace_guest_messages
 referencing new table as added for each statement execute function private.workspace_guest_message_notices();

revoke all on function private.workspace_guest_message_recipients(uuid),private.workspace_guest_message_notices() from public,anon,authenticated;

insert into supabase_migrations.schema_migrations(version,name) values('20261015310000','guest_message_notices');

-- ===== 20261015320000_owner_chat_closed =====
-- Messages redesign (Lee, round 5): the Clients tab filters owner conversations into Needs a reply, Waiting for reply and Closed, like
-- the Guests tab. Guest conversations already have Done; owner conversations had no such state. From here the team that answers an
-- owner (private.chat_owner_team: admins, the client relations or management rota, Stays on the owner's properties) can close an owner
-- conversation and reopen it. A new message from anyone reopens it by itself. Owners never close and never see whether it is closed.
-- "Who spoke last" is already in the list (last.fromOwner), so it needs no change.
-- chat_summary gains 'closed' (true only for the team's view of a closed owner conversation) by anchor and append, and the chat action
-- routes 'closeConversation' by anchor and append (the anchor stays first, a sentinel stops a second run, a missing or repeated anchor
-- raises).

alter table private.chat_conversations add column if not exists closed_at timestamptz;
alter table private.chat_conversations add column if not exists closed_by uuid references public.workspace_profiles(user_id);
create index if not exists chat_conversations_closed_by_idx on private.chat_conversations(closed_by);
alter table private.chat_conversations drop constraint if exists chat_conversations_closed_owner_only;
alter table private.chat_conversations add constraint chat_conversations_closed_owner_only check(closed_at is null or kind='owner');

-- closeConversation {conversationId, closed}: the owner team closes (true) or reopens (false) an owner conversation.
create or replace function private.chat_close_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare me uuid:=auth.uid();actor text:=private.workspace_actor_role();c private.chat_conversations;
begin
 perform private.workspace_json_keys(input,array['action','conversationId','closed']);
 if actor is null or actor='client' then raise exception 'Team access required' using errcode='42501';end if;
 if jsonb_typeof(input->'closed') is distinct from 'boolean' then raise exception 'Choose close or reopen' using errcode='22023';end if;
 select * into c from private.chat_conversations x where x.id=(input->>'conversationId')::uuid for update;
 if c.id is null or c.kind<>'owner' or not private.chat_owner_team(c.owner_id,me) then raise exception 'Conversation not found' using errcode='42501';end if;
 if (input->>'closed')::boolean then
  update private.chat_conversations set closed_at=coalesce(closed_at,now()),closed_by=coalesce(closed_by,me) where id=c.id returning * into c;
 else
  update private.chat_conversations set closed_at=null,closed_by=null where id=c.id returning * into c;
 end if;
 return private.chat_summary(c,me);
end $fn$;

-- Any new message reopens a closed owner conversation.
create or replace function private.chat_reopen_on_message() returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 update private.chat_conversations set closed_at=null,closed_by=null where id=new.conversation_id and closed_at is not null;
 return null;
end $fn$;
drop trigger if exists chat_reopen_on_message on private.chat_messages;
create trigger chat_reopen_on_message after insert on private.chat_messages for each row when (new.kind='text') execute function private.chat_reopen_on_message();

revoke all on function private.chat_close_action(jsonb),private.chat_reopen_on_message() from public,anon,authenticated;

do $patch$
declare
 fixes text[][]:=array[
  ['private.chat_summary(private.chat_conversations,uuid)',
   $q$'named',c.kind<>'group' or c.title is not null,$q$,
   $q$'named',c.kind<>'group' or c.title is not null,
  'closed',c.kind='owner' and c.owner_id<>me and c.closed_at is not null,$q$,
   $q$'closed',c.kind='owner' and c.owner_id<>me and c.closed_at is not null$q$],
  ['private.workspace_chat_action(jsonb)',
   $q$if a in ('reportMessage','blockUser','unblockUser') then return private.chat_moderation_action(input);end if;$q$,
   $q$if a in ('reportMessage','blockUser','unblockUser') then return private.chat_moderation_action(input);end if;
 if a='closeConversation' then return private.chat_close_action(input);end if;$q$,
   $q$if a='closeConversation' then return private.chat_close_action(input)$q$]
 ];
 definition text;hits integer;
begin
 for i in 1..array_length(fixes,1) loop
  definition:=pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in definition)=0 then
   hits:=(length(definition)-length(replace(definition,fixes[i][2],'')))/length(fixes[i][2]);
   if hits<>1 then raise exception 'Patch anchor found % times in % (patch %)',hits,fixes[i][1],i;end if;
   execute replace(definition,fixes[i][2],fixes[i][3]);
   if position(fixes[i][4] in pg_get_functiondef(fixes[i][1]::regprocedure))=0 then raise exception 'Patch did not take in % (patch %)',fixes[i][1],i;end if;
  end if;
 end loop;
end $patch$;

insert into supabase_migrations.schema_migrations(version,name) values('20261015320000','owner_chat_closed');

-- ===== 20261015330000_guest_message_notices_onboarded =====
-- Guest message notices (20261015310000): a Stays person still mid-onboarding cannot open the guest inbox yet (has_workspace_module
-- refuses until private.workspace_onboarded() is true: every required contract signed and every required course done), so they are no
-- longer told about guest messages either. Admins and super admins are never asked to onboard, so they are unchanged. The check is
-- the same one the guest inbox uses, private.workspace_onboarding_status(person)->>'complete', for the person being told. Once
-- they finish onboarding they are told about the next guest message as usual (earlier ones are not sent again).
-- Replaced whole (only 20261015310000 defines it; nothing patches it).
create or replace function private.workspace_guest_message_recipients(prop uuid) returns setof uuid language sql stable security definer set search_path='' as $fn$
 select p.user_id from public.workspace_profiles p
 where p.status='active' and (
  p.role in ('admin','super_admin')
  or (p.role='stays' and private.workspace_guest_messaging_role(p.role)
   and exists(select 1 from public.workspace_module_grants g where g.user_id=p.user_id and g.module_id='guest-communication')
   and (prop is null or exists(select 1 from public.workspace_property_assignments a where a.property_id=prop and a.user_id=p.user_id and a.assignment='staff'))
   and coalesce((private.workspace_onboarding_status(p.user_id)->>'complete')::boolean,false)))
$fn$;
revoke all on function private.workspace_guest_message_recipients(uuid) from public,anon,authenticated;

insert into supabase_migrations.schema_migrations(version,name) values('20261015330000','guest_message_notices_onboarded');

commit;

-- Afterwards this should list nine rows:
-- select version,name from supabase_migrations.schema_migrations where version like '20261015%' order by 1;
