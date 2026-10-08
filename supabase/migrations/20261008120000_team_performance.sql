-- Team performance (8 October 2026). The team clocks in and out of their shifts in the app
-- (early 08:00-15:00 or 16:00, late 15:00-23:00, per department). Guest replies are timed:
-- green within 5 minutes, amber within 10, red after that, and each guest message is credited
-- to whoever was clocked in to guest relations when it arrived. 90% green is on track; 95% and
-- 100% unlock the bonus tiers. Targets are set by admins. Guest messages arrive from the channel
-- manager once it is connected (workspace_guest_messages_ingest, backend only).

create table private.workspace_shifts (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.workspace_profiles(user_id),
  department text not null check(department in ('guest_relations','client_relations','cleaning','ready','accounts','management')),
  clocked_in_at timestamptz not null default now(), clocked_out_at timestamptz, closed_by uuid references public.workspace_profiles(user_id),
  request_id uuid not null, unique(user_id,request_id), check(clocked_out_at is null or clocked_out_at>=clocked_in_at)
);
create unique index workspace_shifts_one_open_idx on private.workspace_shifts(user_id) where clocked_out_at is null;
create index workspace_shifts_time_idx on private.workspace_shifts(department,clocked_in_at);

create table private.workspace_performance_targets (
  singleton boolean primary key default true check(singleton),
  green_minutes integer not null default 5 check(green_minutes between 1 and 120),
  amber_minutes integer not null default 10 check(amber_minutes between 2 and 240),
  pass_percent integer not null default 90 check(pass_percent between 1 and 100),
  bonus_percents integer[] not null default array[95,100] check(cardinality(bonus_percents) between 0 and 5 and 0<all(bonus_percents) and 101>all(bonus_percents)),
  version integer not null default 1, updated_by uuid references public.workspace_profiles(user_id), updated_at timestamptz not null default now(),
  check(amber_minutes>green_minutes)
);
insert into private.workspace_performance_targets(singleton) values(true) on conflict do nothing;

create table private.workspace_guest_messages (
  id uuid primary key default gen_random_uuid(), source text not null check(length(source) between 1 and 40), external_id text not null check(length(external_id) between 1 and 200),
  thread_ref text not null check(length(thread_ref) between 1 and 200), property_id uuid references public.workspace_properties(id),
  channel text not null default 'other' check(channel in ('airbnb','booking_com','vrbo','direct','whatsapp','email','other')),
  direction text not null check(direction in ('guest','team')), sent_at timestamptz not null, author_user_id uuid references public.workspace_profiles(user_id),
  created_at timestamptz not null default now(), unique(source,external_id)
);
create index workspace_guest_messages_thread_idx on private.workspace_guest_messages(source,thread_ref,sent_at);
create index workspace_guest_messages_time_idx on private.workspace_guest_messages(sent_at);

do $$ declare t text; begin
 foreach t in array array['workspace_shifts','workspace_performance_targets','workspace_guest_messages'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated',t);
 end loop;
 foreach t in array array['workspace_shifts','workspace_performance_targets'] loop
  execute format('create trigger business_write_limit before insert or update on private.%I for each row execute function private.workspace_enforce_write_limit()',t);
 end loop;
end $$;

-- Every guest message that starts a wait (the first in a thread, or the first after a team reply),
-- graded by how long the reply took and credited to whoever was on guest relations at the time.
-- A message still waiting counts once it is past the amber limit.
create function private.workspace_response_rows(lower_at timestamptz,upper_at timestamptz) returns table(message_id uuid,sent_at timestamptz,minutes numeric,grade text,user_id uuid)
language sql stable security definer set search_path='' as $$
 with t as (select * from private.workspace_performance_targets where singleton),
 m as (select g.id,g.source,g.thread_ref,g.direction,g.sent_at,lag(g.direction) over(partition by g.source,g.thread_ref order by g.sent_at,g.id) prev
  from private.workspace_guest_messages g where g.sent_at<upper_at and g.sent_at>=lower_at-interval '1 day'),
 asks as (select m.id,m.sent_at,(select min(r.sent_at) from private.workspace_guest_messages r where r.source=m.source and r.thread_ref=m.thread_ref and r.direction='team' and r.sent_at>=m.sent_at) replied_at
  from m where m.direction='guest' and (m.prev is null or m.prev='team') and m.sent_at>=lower_at),
 timed as (select a.id,a.sent_at,a.replied_at,extract(epoch from coalesce(a.replied_at,now())-a.sent_at)/60 mins from asks a)
 select x.id,x.sent_at,round(x.mins::numeric,1),
  case when x.mins<=t.green_minutes then 'green' when x.mins<=t.amber_minutes then 'amber' else 'red' end,s.user_id
 from timed x cross join t
 left join private.workspace_shifts s on s.department='guest_relations' and s.clocked_in_at<=x.sent_at and (s.clocked_out_at is null or s.clocked_out_at>x.sent_at)
 where x.replied_at is not null or x.mins>t.amber_minutes;
$$;

create function private.workspace_shift_json(s private.workspace_shifts) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',s.id,'userId',s.user_id,'fullName',(select p.full_name from public.workspace_profiles p where p.user_id=s.user_id),'department',s.department,
  'clockedInAt',s.clocked_in_at,'clockedOutAt',s.clocked_out_at);
$$;

create function private.workspace_shift_read(section text,start_on date,end_on date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();admin boolean;lower_at timestamptz;upper_at timestamptz;t private.workspace_performance_targets;begin
 if actor is null or actor='client' then raise exception 'Team access required' using errcode='42501';end if;
 admin:=actor in ('admin','super_admin');
 select * into t from private.workspace_performance_targets where singleton;
 if section='shift' then
  -- The person's own shift, and their own scorecard for the last 30 days.
  lower_at:=(current_date-29)::timestamp at time zone 'Europe/London';upper_at:=now();
  return jsonb_build_object('open',(select private.workspace_shift_json(s) from private.workspace_shifts s where s.user_id=auth.uid() and s.clocked_out_at is null),
   'today',coalesce((select jsonb_agg(private.workspace_shift_json(s) order by s.clocked_in_at) from private.workspace_shifts s where s.user_id=auth.uid()
     and s.clocked_in_at>=(current_date::timestamp at time zone 'Europe/London')),'[]'),
   'green',(select count(*) from private.workspace_response_rows(lower_at,upper_at) r where r.user_id=auth.uid() and r.grade='green'),
   'responses',(select count(*) from private.workspace_response_rows(lower_at,upper_at) r where r.user_id=auth.uid()),
   'passPercent',t.pass_percent);
 elsif section='teamPerformance' then
  if start_on is null or end_on is null or end_on<start_on or end_on-start_on>92 then raise exception 'Choose up to 92 days' using errcode='22023';end if;
  lower_at:=start_on::timestamp at time zone 'Europe/London';upper_at:=(end_on+1)::timestamp at time zone 'Europe/London';
  return jsonb_build_object(
   'targets',jsonb_build_object('greenMinutes',t.green_minutes,'amberMinutes',t.amber_minutes,'passPercent',t.pass_percent,'bonusPercents',to_jsonb(t.bonus_percents),'version',t.version),
   'onShift',case when admin then coalesce((select jsonb_agg(private.workspace_shift_json(s) order by s.department,s.clocked_in_at) from private.workspace_shifts s where s.clocked_out_at is null),'[]') else '[]' end,
   'messages',(select count(*) from private.workspace_guest_messages g where g.sent_at>=lower_at and g.sent_at<upper_at),
   'unassigned',(select jsonb_build_object('green',count(*) filter(where r.grade='green'),'amber',count(*) filter(where r.grade='amber'),'red',count(*) filter(where r.grade='red'))
     from private.workspace_response_rows(lower_at,upper_at) r where r.user_id is null and admin),
   'people',coalesce((select jsonb_agg(item order by item->>'fullName') from (
    select jsonb_build_object('userId',p.user_id,'fullName',p.full_name,'role',p.role,
     'shifts',(select count(*) from private.workspace_shifts s where s.user_id=p.user_id and s.clocked_in_at<upper_at and coalesce(s.clocked_out_at,now())>lower_at),
     'minutes',(select coalesce(round(sum(extract(epoch from least(coalesce(s.clocked_out_at,now()),upper_at)-greatest(s.clocked_in_at,lower_at))/60)),0)::int
       from private.workspace_shifts s where s.user_id=p.user_id and s.clocked_in_at<upper_at and coalesce(s.clocked_out_at,now())>lower_at),
     'green',r.green,'amber',r.amber,'red',r.red,
     'percentGreen',case when r.total>0 then floor(r.green*100.0/r.total)::int end,
     'onTrack',case when r.total>0 then r.green*100.0/r.total>=t.pass_percent end,
     'bonusTier',case when r.total>0 then (select max(b) from unnest(t.bonus_percents) b where r.green*100.0/r.total>=b) end,
     'listingChecks',(select count(*) from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where d.kind='listing_health' and w.created_by=p.user_id and w.created_at>=lower_at and w.created_at<upper_at),
     'pricingDecisions',(select count(*) from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where d.kind='daily_pricing' and w.created_by=p.user_id and w.created_at>=lower_at and w.created_at<upper_at)) item
    from public.workspace_profiles p
    cross join lateral (select count(*) filter(where x.grade='green') green,count(*) filter(where x.grade='amber') amber,count(*) filter(where x.grade='red') red,count(*) total
      from private.workspace_response_rows(lower_at,upper_at) x where x.user_id=p.user_id) r
    where p.status='active' and p.role<>'client' and (admin or p.user_id=auth.uid())) people),'[]'));
 end if;
 raise exception 'Unknown team section' using errcode='22023';
end $$;

create function private.workspace_shift_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();a text;req uuid;prior private.workspace_action_receipts;result jsonb;s private.workspace_shifts;t private.workspace_performance_targets;bonuses integer[];begin
 if actor is null or actor='client' then raise exception 'Team access required' using errcode='42501';end if;
 a:=private.workspace_required_text(input,'action',1,50);req:=(input->>'requestId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 if a in ('closeShift','saveTargets') and actor not in ('admin','super_admin') then raise exception 'Management access required' using errcode='42501';end if;
 if a='clockIn' and not private.workspace_onboarded() then raise exception 'Finish your onboarding before clocking in' using errcode='42501';end if;
 if a not in ('clockIn','clockOut','closeShift','saveTargets') then raise exception 'Unknown team action' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 select * into prior from private.workspace_action_receipts where actor_id=auth.uid() and request_id=req;
 if found then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;

 if a='clockIn' then
  perform private.workspace_json_keys(input,array['action','requestId','department']);
  if exists(select 1 from private.workspace_shifts where user_id=auth.uid() and clocked_out_at is null) then raise exception 'You are already clocked in' using errcode='23505';end if;
  insert into private.workspace_shifts(user_id,department,request_id) values(auth.uid(),private.workspace_required_text(input,'department',2,40),req) returning * into s;
 elsif a='clockOut' then
  perform private.workspace_json_keys(input,array['action','requestId']);
  update private.workspace_shifts set clocked_out_at=now() where user_id=auth.uid() and clocked_out_at is null returning * into s;
  if not found then raise exception 'You are not clocked in' using errcode='P0002';end if;
 elsif a='closeShift' then
  -- For someone who forgot to clock out: the admin sets when the shift ended.
  perform private.workspace_json_keys(input,array['action','requestId','shiftId','endedAt']);
  update private.workspace_shifts set clocked_out_at=greatest(clocked_in_at,least(now(),(input->>'endedAt')::timestamptz)),closed_by=auth.uid()
   where id=(input->>'shiftId')::uuid and clocked_out_at is null returning * into s;
  if not found then raise exception 'That shift has already ended' using errcode='P0002';end if;
 elsif a='saveTargets' then
  perform private.workspace_json_keys(input,array['action','requestId','version','greenMinutes','amberMinutes','passPercent','bonusPercents']);
  if jsonb_typeof(input->'bonusPercents') is distinct from 'array' or exists(select 1 from jsonb_array_elements(input->'bonusPercents') e where jsonb_typeof(e)<>'number') then raise exception 'Invalid targets' using errcode='22023';end if;
  bonuses:=array(select distinct (e#>>'{}')::int from jsonb_array_elements(input->'bonusPercents') e order by 1);
  select * into t from private.workspace_performance_targets where singleton for update;
  if t.version is distinct from (input->>'version')::integer then raise exception 'Targets changed' using errcode='40001';end if;
  update private.workspace_performance_targets set green_minutes=(input->>'greenMinutes')::int,amber_minutes=(input->>'amberMinutes')::int,pass_percent=(input->>'passPercent')::int,
   bonus_percents=bonuses,version=version+1,updated_by=auth.uid(),updated_at=now() where singleton returning * into t;
  result:=jsonb_build_object('version',t.version);
 end if;
 if a<>'saveTargets' then result:=private.workspace_shift_json(s);end if;
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $$;

-- Backend only: the channel manager's guest messages, stored once each.
create function private.workspace_guest_messages_ingest(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare added integer;begin
 if jsonb_typeof(input->'messages') is distinct from 'array' or jsonb_array_length(input->'messages')>2000 then raise exception 'Invalid messages' using errcode='22023';end if;
 insert into private.workspace_guest_messages(source,external_id,thread_ref,property_id,channel,direction,sent_at,author_user_id)
  select private.workspace_required_text(input,'source',1,40),m->>'externalId',m->>'threadRef',(m->>'propertyId')::uuid,coalesce(m->>'channel','other'),m->>'direction',(m->>'sentAt')::timestamptz,(m->>'authorUserId')::uuid
  from jsonb_array_elements(input->'messages') m on conflict do nothing;
 get diagnostics added=row_count;
 return jsonb_build_object('added',added);
end $$;
create function public.workspace_guest_messages_ingest(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_guest_messages_ingest(input);$$;

-- Route through the team endpoints. (Patched in place: the live definitions use CRLF line endings.)
do $$
declare
 fixes constant text[][] := array[
  ['private.workspace_teams_read(text,date,date,uuid,uuid)', $q$ else raise exception 'Unknown team section' using errcode='22023';end if;$q$,
   $q$ elsif section in ('shift','teamPerformance') then result:=private.workspace_shift_read(section,start_on,end_on);
 else raise exception 'Unknown team section' using errcode='22023';end if;$q$, 'workspace_shift_read'],
  ['private.workspace_teams_action(jsonb)', $q$then return private.workspace_onboarding_action(input);end if;$q$,
   $q$then return private.workspace_onboarding_action(input);end if;
 if input->>'action' in ('clockIn','clockOut','closeShift','saveTargets') then return private.workspace_shift_action(input);end if;$q$, 'workspace_shift_action']
 ];
 definition text;
begin
 for i in 1..array_length(fixes, 1) loop
  definition := pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in definition) = 0 then
   if position(fixes[i][2] in definition) = 0 then raise exception 'Patch anchor missing in %', fixes[i][1]; end if;
   execute replace(definition, fixes[i][2], fixes[i][3]);
  end if;
 end loop;
end $$;

revoke all on function private.workspace_response_rows(timestamptz,timestamptz),private.workspace_shift_json(private.workspace_shifts),private.workspace_shift_read(text,date,date),
 private.workspace_shift_action(jsonb),private.workspace_guest_messages_ingest(jsonb),public.workspace_guest_messages_ingest(jsonb) from public,anon,authenticated,service_role;
grant execute on function private.workspace_guest_messages_ingest(jsonb),public.workspace_guest_messages_ingest(jsonb) to service_role;
