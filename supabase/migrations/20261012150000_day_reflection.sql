-- End-of-day reflection (A7, client feedback build, 13 October 2026).
--
-- Before clocking out, Stays, Ready, Accounts and the cleaning manager write a short reflection for
-- the shift: what went well, what did not, any feedback, and the things they got done. The app shows
-- them a summary of their day to start from: tickets touched and completed, to-dos done and guest
-- replies sent. Cleaners and admins are not asked (they can still write one). Admins read everyone's
-- reflections, up to 31 days at a time, and mark them as read.
--
-- Saving a reflection also counts as the day's sign-off (a workspace_daily_signoffs row), so the
-- sign-off counts in team performance and the missed-day roll-over keep working.
--
-- The day of a reflection is the UK date the shift started: a shift from 22:00 to 02:00 belongs to
-- the day it began, the same day the missed-day roll-over checks. The summary counts that UK day.
--
-- 1. The rules (one immutable function each, mirrored in lib/feedback-defaults.ts).
-- 2. Table workspace_day_reflections.
-- 3. The day summary, the reads and the actions.
-- 4. Clocking out is refused while a required reflection is missing (the admin's closeShift is not
--    affected: it has its own function).
-- 5. Routes in the team read and action, after the hub anchors.
-- Safe to run twice: tables and indexes "if not exists", whole functions nobody else patches, and
-- each patch has its own marker. A missing or repeated anchor stops the migration.

-- 1. The rules ---------------------------------------------------------------------------------------
-- Who must write a reflection before clocking out (REFLECTION_REQUIRED_ROLES). Not cleaners, not admins.
create or replace function private.workspace_reflection_required(role text) returns boolean language sql immutable set search_path='' as $fn$
 select coalesce(role,'') in ('stays','ready','accounts','cleaning_manager')
$fn$;
-- "Went well" or "not so well" must hold at least this many characters (REFLECTION_MIN_CHARS).
create or replace function private.workspace_reflection_min_chars() returns integer language sql immutable set search_path='' as $fn$
 select 3
$fn$;
-- Admins read up to this many days at a time (REFLECTIONS_WINDOW_DAYS).
create or replace function private.workspace_reflections_window_days() returns integer language sql immutable set search_path='' as $fn$
 select 31
$fn$;

-- 2. The table ---------------------------------------------------------------------------------------
create table if not exists private.workspace_day_reflections (
 id uuid primary key default gen_random_uuid(),
 shift_id uuid not null unique references private.workspace_shifts(id) on delete cascade,
 user_id uuid not null references public.workspace_profiles(user_id),
 day date not null,
 went_well text not null default '' check(char_length(went_well)<=2000),
 not_well text not null default '' check(char_length(not_well)<=2000),
 feedback text not null default '' check(char_length(feedback)<=2000),
 -- The things the person says they got done: [{kind, ref, label}], at most 100.
 completed jsonb not null default '[]' check(case when jsonb_typeof(completed)='array' then jsonb_array_length(completed)<=100 else false end),
 -- The day summary as it stood when the reflection was saved.
 summary jsonb not null default '{}' check(jsonb_typeof(summary)='object'),
 reviewed_by uuid references public.workspace_profiles(user_id),
 reviewed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 version integer not null default 1 check(version>0),
 check((reviewed_by is null)=(reviewed_at is null))
);
create index if not exists workspace_day_reflections_day_idx on private.workspace_day_reflections(day desc,created_at desc);
create index if not exists workspace_day_reflections_user_idx on private.workspace_day_reflections(user_id,day desc);
create index if not exists workspace_day_reflections_reviewer_idx on private.workspace_day_reflections(reviewed_by);
alter table private.workspace_day_reflections enable row level security;
revoke all on private.workspace_day_reflections from public,anon,authenticated;
create or replace trigger business_write_limit before insert or update on private.workspace_day_reflections for each row execute function private.workspace_enforce_write_limit();

-- 3. Summary, reads and actions ----------------------------------------------------------------------
-- What one person did on one UK day: work they touched (any activity on it) or completed, to-dos they
-- marked done and guest replies they sent. items lists the completed tickets and to-dos (newest first,
-- up to 50 of each) in the shape the reflection's "completed" list takes.
create or replace function private.workspace_day_summary(target uuid, on_day date) returns jsonb language sql stable security definer set search_path='' as $fn$
 with b as (select (on_day::timestamp at time zone 'Europe/London') lo,((on_day+1)::timestamp at time zone 'Europe/London') hi),
 touched as (select distinct a.work_id from public.workspace_activity a,b
   where a.actor_id=target and a.work_id is not null and a.created_at>=b.lo and a.created_at<b.hi),
 finished as (select u.work_id,max(u.created_at) done_at from public.workspace_work_updates u,b
   where u.actor_id=target and u.next_status='completed' and u.created_at>=b.lo and u.created_at<b.hi group by u.work_id),
 todos as (select i.id,i.title,i.decided_at done_at from private.workspace_hub_items i,b
   where i.kind='todo' and i.status='done' and i.decided_by=target and i.decided_at>=b.lo and i.decided_at<b.hi)
 select jsonb_build_object('day',on_day,
  'ticketsTouched',(select count(*) from (select work_id from touched union select work_id from finished) x),
  'ticketsCompleted',(select count(*) from finished),
  'todosDone',(select count(*) from todos),
  'guestReplies',(select count(*) from private.workspace_guest_messages g,b
    where g.direction='team' and g.author_user_id=target and g.sent_at>=b.lo and g.sent_at<b.hi and g.delivery is distinct from 'failed'),
  'items',coalesce((select jsonb_agg(x.item order by x.done_at desc) from (
    (select jsonb_build_object('kind','ticket','ref',f.work_id,'label',left(w.title,200)) item,f.done_at from finished f join public.workspace_work_items w on w.id=f.work_id order by f.done_at desc limit 50)
    union all
    (select jsonb_build_object('kind','todo','ref',t.id,'label',left(t.title,200)),t.done_at from todos t order by t.done_at desc limit 50)) x),'[]'::jsonb))
$fn$;

create or replace function private.workspace_reflection_view(r private.workspace_day_reflections) returns jsonb language sql stable security definer set search_path='' as $fn$
 select jsonb_build_object('id',r.id,'shiftId',r.shift_id,'userId',r.user_id,
  'fullName',(select p.full_name from public.workspace_profiles p where p.user_id=r.user_id),
  'role',(select p.role from public.workspace_profiles p where p.user_id=r.user_id),
  'department',(select s.department from private.workspace_shifts s where s.id=r.shift_id),
  'day',r.day,'wentWell',r.went_well,'notWell',r.not_well,'feedback',r.feedback,'completed',r.completed,'summary',r.summary,
  'createdAt',r.created_at,'updatedAt',r.updated_at,'reviewedAt',r.reviewed_at,
  'reviewedByName',(select p.full_name from public.workspace_profiles p where p.user_id=r.reviewed_by),'version',r.version)
$fn$;

-- True while the signed-in person must still write the reflection for their open shift.
create or replace function private.workspace_reflection_missing(role text) returns boolean language sql stable security definer set search_path='' as $fn$
 select private.workspace_reflection_required(role) and exists(select 1 from private.workspace_shifts s
  where s.user_id=auth.uid() and s.clocked_out_at is null and not exists(select 1 from private.workspace_day_reflections r where r.shift_id=s.id))
$fn$;

-- Section 'reflection': your own day. The open shift (if any), its UK day, the summary of that day,
-- the reflection saved for the shift (or, when not clocked in, the latest saved today), and whether
-- one is still needed before you can clock out.
create or replace function private.workspace_reflection_read() returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();s private.workspace_shifts;r private.workspace_day_reflections;d date;
begin
 if actor is null or actor='client' then raise exception 'Team access required' using errcode='42501';end if;
 select * into s from private.workspace_shifts x where x.user_id=auth.uid() and x.clocked_out_at is null order by x.clocked_in_at desc limit 1;
 d:=coalesce((s.clocked_in_at at time zone 'Europe/London')::date,(now() at time zone 'Europe/London')::date);
 if s.id is not null then
  select * into r from private.workspace_day_reflections x where x.shift_id=s.id;
 else
  select * into r from private.workspace_day_reflections x where x.user_id=auth.uid() and x.day=d order by x.created_at desc limit 1;
 end if;
 return jsonb_build_object('required',private.workspace_reflection_required(actor),'day',d,
  'shift',case when s.id is not null then jsonb_build_object('id',s.id,'department',s.department,'clockedInAt',s.clocked_in_at) end,
  'summary',private.workspace_day_summary(auth.uid(),d),
  'reflection',case when r.id is not null then private.workspace_reflection_view(r) end,
  'missing',private.workspace_reflection_required(actor) and s.id is not null and r.id is null);
end $fn$;

-- Section 'reflections': admins read everyone's, newest day first, up to 31 days at a time.
create or replace function private.workspace_reflections_read(start_on date, end_on date) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();
begin
 if actor is null or actor='client' then raise exception 'Team access required' using errcode='42501';end if;
 if actor not in ('admin','super_admin') then raise exception 'Management access required' using errcode='42501';end if;
 if start_on is null or end_on is null or end_on<start_on or end_on-start_on>private.workspace_reflections_window_days() then
  raise exception 'Choose up to % days',private.workspace_reflections_window_days() using errcode='22023';end if;
 return jsonb_build_object('from',start_on,'to',end_on,
  'unreviewed',(select count(*) from private.workspace_day_reflections r where r.day between start_on and end_on and r.reviewed_at is null),
  'items',(select coalesce(jsonb_agg(private.workspace_reflection_view(r) order by r.day desc,r.created_at desc,r.id),'[]'::jsonb) from (
    select * from private.workspace_day_reflections x where x.day between start_on and end_on order by x.day desc,x.created_at desc,x.id limit 1000) r));
end $fn$;

-- One of the three notes: a string, trimmed, up to 2000 characters (may be empty).
create or replace function private.workspace_reflection_note(input jsonb, k text) returns text language plpgsql immutable set search_path='' as $fn$
begin
 if jsonb_typeof(input->k) is distinct from 'string' or char_length(btrim(input->>k))>2000 then raise exception 'Invalid field %',k using errcode='22023';end if;
 return btrim(input->>k);
end $fn$;

-- saveReflection: for your own open shift only. Saving again (a new request) changes it while the
-- shift is open. The first save also signs off the day and tells the admins.
-- markReflectionsReviewed: admins mark reflections as read; each person hears once.
create or replace function private.workspace_reflection_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();a text:=input->>'action';req uuid;prior private.workspace_action_receipts;result jsonb;
 s private.workspace_shifts;r private.workspace_day_reflections;d date;ww text;nw text;fb text;done jsonb;snap jsonb;event_id bigint;
 ids uuid[];authors uuid[];n integer;
begin
 if actor is null or actor='client' then raise exception 'Team access required' using errcode='42501';end if;
 if coalesce(a,'') not in ('saveReflection','markReflectionsReviewed') then raise exception 'Unknown team action' using errcode='22023';end if;
 if a='markReflectionsReviewed' and actor not in ('admin','super_admin') then raise exception 'Management access required' using errcode='42501';end if;
 req:=(input->>'requestId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 prior:=(select x from private.workspace_action_receipts x where x.actor_id=auth.uid() and x.request_id=req);
 if prior.actor_id is not null then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;

 if a='saveReflection' then
  perform private.workspace_json_keys(input,array['action','requestId','shiftId','wentWell','notWell','feedback','completed'],120000);
  ww:=private.workspace_reflection_note(input,'wentWell');nw:=private.workspace_reflection_note(input,'notWell');fb:=private.workspace_reflection_note(input,'feedback');
  if char_length(ww)<private.workspace_reflection_min_chars() and char_length(nw)<private.workspace_reflection_min_chars() then
   raise exception 'Say what went well or what did not' using errcode='22023';end if;
  if (case when jsonb_typeof(input->'completed') is distinct from 'array' then true when jsonb_array_length(input->'completed')>100 then true
   else exists(select 1 from jsonb_array_elements(input->'completed') e where case when jsonb_typeof(e)<>'object' then true
    else exists(select 1 from jsonb_object_keys(e) k where k not in ('kind','ref','label'))
     or jsonb_typeof(e->'kind') is distinct from 'string' or char_length(btrim(e->>'kind')) not between 1 and 40
     or jsonb_typeof(e->'label') is distinct from 'string' or char_length(btrim(e->>'label')) not between 1 and 200
     or coalesce(jsonb_typeof(e->'ref'),'null') not in ('null','string') or char_length(btrim(coalesce(e->>'ref','')))>80 end) end) then
   raise exception 'Check the list of things done' using errcode='22023';end if;
  done:=coalesce((select jsonb_agg(jsonb_build_object('kind',btrim(e->>'kind'),'ref',nullif(btrim(e->>'ref'),''),'label',btrim(e->>'label')) order by o)
   from jsonb_array_elements(input->'completed') with ordinality t(e,o)),'[]'::jsonb);
  -- Your own open shift: the one named, or the one you are on.
  if input->>'shiftId' is not null then
   select * into s from private.workspace_shifts x where x.id=(input->>'shiftId')::uuid for update;
   if s.id is null or s.user_id<>auth.uid() then raise exception 'Shift not found' using errcode='P0002';end if;
   if s.clocked_out_at is not null then raise exception 'That shift has already ended' using errcode='P0001';end if;
  else
   select * into s from private.workspace_shifts x where x.user_id=auth.uid() and x.clocked_out_at is null order by x.clocked_in_at desc limit 1 for update;
   if s.id is null then raise exception 'You are not clocked in' using errcode='P0001';end if;
  end if;
  d:=(s.clocked_in_at at time zone 'Europe/London')::date;
  snap:=private.workspace_day_summary(auth.uid(),d);
  select * into r from private.workspace_day_reflections x where x.shift_id=s.id for update;
  if r.id is null then
   insert into private.workspace_day_reflections(shift_id,user_id,day,went_well,not_well,feedback,completed,summary)
    values(s.id,auth.uid(),d,ww,nw,fb,done,snap) returning * into r;
   -- The reflection is the day's sign-off (one per person per day, whichever came first).
   insert into private.workspace_daily_signoffs(user_id,day,confirmations,snapshot,note)
    values(auth.uid(),d,jsonb_build_object('reflection',true),private.workspace_signoff_snapshot(),'') on conflict do nothing;
   insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'reflection.saved') returning id into event_id;
   insert into private.workspace_notification_outbox(user_id,event_id)
    select p.user_id,event_id from public.workspace_profiles p where p.role in ('admin','super_admin') and p.status='active' and p.user_id<>auth.uid() on conflict do nothing;
  else
   -- A changed reflection is unread again.
   update private.workspace_day_reflections x set went_well=ww,not_well=nw,feedback=fb,completed=done,summary=snap,
    reviewed_by=null,reviewed_at=null,updated_at=now(),version=x.version+1 where x.id=r.id returning * into r;
  end if;
  result:=private.workspace_reflection_view(r);

 else
  perform private.workspace_json_keys(input,array['action','requestId','ids']);
  if (case when jsonb_typeof(input->'ids') is distinct from 'array' then true when jsonb_array_length(input->'ids') not between 1 and 100 then true
   else exists(select 1 from jsonb_array_elements(input->'ids') e where jsonb_typeof(e)<>'string' or e#>>'{}'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') end) then
   raise exception 'Choose the reflections to mark as read' using errcode='22023';end if;
  ids:=array(select distinct (e#>>'{}')::uuid from jsonb_array_elements(input->'ids') e);
  with marked as (
   update private.workspace_day_reflections x set reviewed_by=auth.uid(),reviewed_at=now(),version=x.version+1
    where x.id=any(ids) and x.reviewed_at is null returning x.user_id)
  select coalesce(array_agg(distinct m.user_id),'{}'),count(*) into authors,n from marked m;
  if n>0 then
   insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'reflection.reviewed') returning id into event_id;
   insert into private.workspace_notification_outbox(user_id,event_id)
    select u,event_id from unnest(authors) u where u is distinct from auth.uid() on conflict do nothing;
  end if;
  result:=jsonb_build_object('reviewed',n,'ids',coalesce((select jsonb_agg(x.id order by x.id) from private.workspace_day_reflections x where x.id=any(ids) and x.reviewed_at is not null),'[]'::jsonb));
 end if;
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $fn$;

revoke all on function private.workspace_reflection_required(text),private.workspace_reflection_min_chars(),private.workspace_reflections_window_days(),
 private.workspace_day_summary(uuid,date),private.workspace_reflection_view(private.workspace_day_reflections),private.workspace_reflection_missing(text),
 private.workspace_reflection_read(),private.workspace_reflections_read(date,date),private.workspace_reflection_note(jsonb,text),
 private.workspace_reflection_action(jsonb) from public,anon,authenticated;

-- 4 and 5. Patches to the latest definitions -------------------------------------------------------
-- function, anchor (must occur exactly once, kept word for word at the start of the replacement),
-- replacement, marker. The clockOut anchor includes its json_keys line so it can only match the
-- dispatch branch; it is matched with the line break the stored definition uses.
do $$
declare
 fixes text[][] := array[
  ['private.workspace_shift_action(jsonb)',
   $q$elsif a='clockOut' then{NL}  perform private.workspace_json_keys(input,array['action','requestId']);$q$,
   $q$elsif a='clockOut' then{NL}  perform private.workspace_json_keys(input,array['action','requestId']);{NL}  if private.workspace_reflection_missing(actor) then raise exception 'Fill in your end-of-day reflection before clocking out' using errcode='P0001';end if;$q$,
   $q$private.workspace_reflection_missing(actor)$q$],
  ['private.workspace_teams_read(text,date,date,uuid,uuid)',
   $q$elsif section='hub' then result:=private.workspace_hub_read();$q$,
   $q$elsif section='hub' then result:=private.workspace_hub_read();{NL} elsif section='reflection' then result:=private.workspace_reflection_read();{NL} elsif section='reflections' then result:=private.workspace_reflections_read(start_on,end_on);$q$,
   $q$result:=private.workspace_reflections_read(start_on,end_on);$q$],
  ['private.workspace_teams_action(jsonb)',
   $q$if a in ('saveHubItem','moveHubItem') then return private.workspace_hub_action(input);end if;$q$,
   $q$if a in ('saveHubItem','moveHubItem') then return private.workspace_hub_action(input);end if;{NL} if a in ('saveReflection','markReflectionsReviewed') then return private.workspace_reflection_action(input);end if;$q$,
   $q$return private.workspace_reflection_action(input);$q$]
 ];
 definition text;nl text;anchor text;found_count integer;
begin
 for i in 1..array_length(fixes, 1) loop
  definition := pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in definition) = 0 then
   -- The stored text keeps the line breaks of the file that defined it: try CRLF, then LF.
   nl := chr(13)||chr(10);
   if position(replace(fixes[i][2], '{NL}', nl) in definition) = 0 then nl := chr(10); end if;
   anchor := replace(fixes[i][2], '{NL}', nl);
   found_count := (length(definition) - length(replace(definition, anchor, ''))) / length(anchor);
   if found_count <> 1 then raise exception 'Patch anchor found % times in % (%), expected once', found_count, fixes[i][1], i; end if;
   execute replace(definition, anchor, replace(fixes[i][3], '{NL}', nl));
   if position(fixes[i][4] in pg_get_functiondef(fixes[i][1]::regprocedure)) = 0 then raise exception 'Patch did not take in % (%)', fixes[i][1], i; end if;
  end if;
 end loop;
end $$;
