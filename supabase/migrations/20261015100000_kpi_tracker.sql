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
