-- Who looks after what, who works when, and when each job happens:
--  * the responsibilities register: each recurring duty with the person who owns it, their backup,
--    the department and how often it comes round; the whole team can read it, admins keep it;
--  * the rota by date: each person's planned shift (early, late, both or off) day by day, read by the
--    whole team and planned by admins, next to a daily timesheet of the hours actually clocked;
--    admins can correct a shift's times or add one someone forgot, with a note of why;
--  * a start time, and optionally an end time, on any dated piece of work, shown on the calendar.

create table if not exists private.workspace_responsibilities (
 id uuid primary key default gen_random_uuid(),
 department text not null check(department in ('guest_relations','client_relations','cleaning','ready','accounts','management')),
 title text not null check(length(trim(title)) between 2 and 200),
 details text not null default '' check(length(details)<=3000),
 owner_id uuid references public.workspace_profiles(user_id),
 backup_id uuid references public.workspace_profiles(user_id),
 frequency text not null default 'as_needed' check(frequency in ('daily','weekly','monthly','as_needed')),
 created_by uuid not null references public.workspace_profiles(user_id),
 updated_by uuid references public.workspace_profiles(user_id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 version integer not null default 1 check(version>0),
 check(backup_id is null or backup_id is distinct from owner_id)
);
create index if not exists workspace_responsibilities_owner_idx on private.workspace_responsibilities(owner_id);
create index if not exists workspace_responsibilities_backup_idx on private.workspace_responsibilities(backup_id);
create index if not exists workspace_responsibilities_creator_idx on private.workspace_responsibilities(created_by);
create index if not exists workspace_responsibilities_updater_idx on private.workspace_responsibilities(updated_by);
alter table private.workspace_responsibilities enable row level security;
revoke all on private.workspace_responsibilities from public,anon,authenticated;
create or replace trigger business_write_limit before insert or update on private.workspace_responsibilities for each row execute function private.workspace_enforce_write_limit();
-- A removed duty stays on record, with who removed it and when.
alter table private.workspace_responsibilities add column if not exists removed_at timestamptz;
alter table private.workspace_responsibilities add column if not exists removed_by uuid references public.workspace_profiles(user_id);
create index if not exists workspace_responsibilities_remover_idx on private.workspace_responsibilities(removed_by);

create table if not exists private.workspace_rota_days (
 user_id uuid not null references public.workspace_profiles(user_id) on delete cascade,
 day date not null,
 shift text not null check(shift in ('early','late','both','off')),
 department text check(department in ('guest_relations','client_relations','cleaning','ready','accounts','management')),
 note text not null default '' check(length(note)<=300),
 updated_by uuid references public.workspace_profiles(user_id),
 updated_at timestamptz not null default now(),
 primary key(user_id,day)
);
create index if not exists workspace_rota_days_day_idx on private.workspace_rota_days(day);
create index if not exists workspace_rota_days_updater_idx on private.workspace_rota_days(updated_by);
alter table private.workspace_rota_days enable row level security;
revoke all on private.workspace_rota_days from public,anon,authenticated;
create or replace trigger business_write_limit before insert or update on private.workspace_rota_days for each row execute function private.workspace_enforce_write_limit();
-- A cleared day stays on record (who cleared it is the last updater) until it is planned again.
alter table private.workspace_rota_days add column if not exists cleared_at timestamptz;

-- A corrected or added shift keeps who changed it and why.
alter table private.workspace_shifts add column if not exists edited_by uuid references public.workspace_profiles(user_id);
alter table private.workspace_shifts add column if not exists edited_at timestamptz;
alter table private.workspace_shifts add column if not exists edit_note text not null default '' check(length(edit_note)<=500);
create index if not exists workspace_shifts_edited_by_idx on private.workspace_shifts(edited_by);
create index if not exists workspace_shifts_closed_by_idx on private.workspace_shifts(closed_by);
create index if not exists workspace_shifts_user_time_idx on private.workspace_shifts(user_id,clocked_in_at);

-- Times on dated work (UK local time, like the dates).
alter table public.workspace_work_items add column if not exists due_time time;
alter table public.workspace_work_items add column if not exists due_end_time time;
do $$ begin
 if not exists(select 1 from pg_constraint where conname='workspace_work_items_due_times_check') then
  alter table public.workspace_work_items add constraint workspace_work_items_due_times_check
   check((due_time is null or due_on is not null) and (due_end_time is null or (due_time is not null and due_end_time>due_time)));
 end if;
end $$;

create or replace function private.workspace_team_member(target uuid) returns boolean language sql stable security definer set search_path='' as $fn$
 select exists(select 1 from public.workspace_profiles p where p.user_id=target and p.status='active' and p.role<>'client')
$fn$;

-- ---------------------------------------------------------------- responsibilities
create or replace function private.workspace_responsibilities_read() returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();
begin
 if actor is null or actor='client' then raise exception 'Team access required' using errcode='42501';end if;
 return jsonb_build_object(
  'canEdit',actor in ('admin','super_admin'),
  'items',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'department',r.department,'title',r.title,'details',r.details,'frequency',r.frequency,
    'ownerId',r.owner_id,'ownerName',o.full_name,'backupId',r.backup_id,'backupName',b.full_name,'updatedAt',r.updated_at,'version',r.version)
    order by r.department,r.title,r.id),'[]')
   from private.workspace_responsibilities r left join public.workspace_profiles o on o.user_id=r.owner_id left join public.workspace_profiles b on b.user_id=r.backup_id where r.removed_at is null),
  'people',(select coalesce(jsonb_agg(jsonb_build_object('userId',p.user_id,'fullName',p.full_name,'role',p.role,'department',s.department) order by p.full_name,p.user_id),'[]')
   from public.workspace_profiles p left join private.workspace_staff_rota s on s.user_id=p.user_id where p.status='active' and p.role<>'client'));
end $fn$;

create or replace function private.workspace_responsibility_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();a text:=input->>'action';req uuid;prior private.workspace_action_receipts;result jsonb;
 r private.workspace_responsibilities;owner uuid;backup uuid;event_id bigint;notify uuid[]:='{}';
begin
 if actor is null or actor not in ('admin','super_admin') then raise exception 'Only admins keep the responsibilities register' using errcode='42501';end if;
 req:=(input->>'requestId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 prior:=(select x from private.workspace_action_receipts x where x.actor_id=auth.uid() and x.request_id=req);
 if prior.actor_id is not null then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;
 if a='saveResponsibility' then
  perform private.workspace_json_keys(input,array['action','requestId','id','version','department','title','details','ownerId','backupId','frequency']);
  owner:=(input->>'ownerId')::uuid;backup:=(input->>'backupId')::uuid;
  if coalesce(input->>'department','') not in ('guest_relations','client_relations','cleaning','ready','accounts','management') then raise exception 'Choose a department' using errcode='22023';end if;
  if coalesce(input->>'frequency','as_needed') not in ('daily','weekly','monthly','as_needed') then raise exception 'Choose how often' using errcode='22023';end if;
  if input ? 'details' and (jsonb_typeof(input->'details')<>'string' or length(input->>'details')>3000) then raise exception 'The details are too long' using errcode='22023';end if;
  if (owner is not null and not private.workspace_team_member(owner)) or (backup is not null and not private.workspace_team_member(backup)) then raise exception 'Choose someone on the team' using errcode='22023';end if;
  if owner is not null and owner=backup then raise exception 'The backup must be someone else' using errcode='22023';end if;
  if input ? 'id' then
   select * into r from private.workspace_responsibilities x where x.id=(input->>'id')::uuid and x.removed_at is null for update;
   if r.id is null then raise exception 'Responsibility not found' using errcode='P0002';end if;
   if r.version is distinct from (input->>'version')::int then raise exception 'Changed by someone else. Refresh and try again' using errcode='40001';end if;
   notify:=array(select u from unnest(array[owner,backup]) u where u is not null and u is distinct from r.owner_id and u is distinct from r.backup_id);
   update private.workspace_responsibilities set department=input->>'department',title=private.workspace_required_text(input,'title',2,200),details=coalesce(btrim(input->>'details'),details),
    owner_id=owner,backup_id=backup,frequency=coalesce(input->>'frequency',frequency),updated_by=auth.uid(),updated_at=now(),version=version+1 where id=r.id returning * into r;
  else
   insert into private.workspace_responsibilities(department,title,details,owner_id,backup_id,frequency,created_by,updated_by)
    values(input->>'department',private.workspace_required_text(input,'title',2,200),coalesce(btrim(input->>'details'),''),owner,backup,coalesce(input->>'frequency','as_needed'),auth.uid(),auth.uid()) returning * into r;
   notify:=array(select u from unnest(array[owner,backup]) u where u is not null);
  end if;
  result:=jsonb_build_object('id',r.id,'version',r.version);
  insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'team.responsibility_given') returning id into event_id;
 elsif a='removeResponsibility' then
  perform private.workspace_json_keys(input,array['action','requestId','id','version']);
  select * into r from private.workspace_responsibilities x where x.id=(input->>'id')::uuid and x.removed_at is null for update;
  if r.id is null then raise exception 'Responsibility not found' using errcode='P0002';end if;
  if r.version is distinct from (input->>'version')::int then raise exception 'Changed by someone else. Refresh and try again' using errcode='40001';end if;
  update private.workspace_responsibilities set removed_at=now(),removed_by=auth.uid(),updated_by=auth.uid(),updated_at=now(),version=version+1 where id=r.id;
  result:=jsonb_build_object('id',r.id,'removed',true);
  insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'team.responsibility_removed') returning id into event_id;
 else raise exception 'Unknown team action' using errcode='22023';end if;
 insert into private.workspace_notification_outbox(user_id,event_id) select distinct u,event_id from unnest(notify) u where u is distinct from auth.uid() on conflict do nothing;
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $fn$;

-- ---------------------------------------------------------------- rota by date and timesheets
create or replace function private.workspace_rota_plan_read(start_on date,end_on date) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();
begin
 if actor is null or actor='client' then raise exception 'Team access required' using errcode='42501';end if;
 if start_on is null or end_on is null or end_on<start_on or end_on-start_on>31 then raise exception 'Choose up to 31 days' using errcode='22023';end if;
 return jsonb_build_object('from',start_on,'to',end_on,'canEdit',actor in ('admin','super_admin'),
  'people',(select coalesce(jsonb_agg(jsonb_build_object('userId',p.user_id,'fullName',p.full_name,'role',p.role,'department',s.department,'usualShift',s.usual_shift,
    'days',(select coalesce(jsonb_agg(jsonb_build_object('day',d.day,'shift',d.shift,'department',d.department,'note',d.note) order by d.day),'[]')
      from private.workspace_rota_days d where d.user_id=p.user_id and d.cleared_at is null and d.day between start_on and end_on))
    order by (s.department is null),s.department,p.full_name,p.user_id),'[]')
   from public.workspace_profiles p left join private.workspace_staff_rota s on s.user_id=p.user_id where p.status='active' and p.role<>'client'));
end $fn$;

create or replace function private.workspace_timesheet_read(start_on date,end_on date,target_user uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();admin boolean;lower_at timestamptz;upper_at timestamptz;
begin
 if actor is null or actor='client' then raise exception 'Team access required' using errcode='42501';end if;
 if start_on is null or end_on is null or end_on<start_on or end_on-start_on>31 then raise exception 'Choose up to 31 days' using errcode='22023';end if;
 admin:=actor in ('admin','super_admin');
 if not admin and target_user is not null and target_user<>auth.uid() then raise exception 'You can only see your own timesheet' using errcode='42501';end if;
 lower_at:=start_on::timestamp at time zone 'Europe/London';upper_at:=(end_on+1)::timestamp at time zone 'Europe/London';
 return jsonb_build_object('from',start_on,'to',end_on,'canEdit',admin,
  'people',(select coalesce(jsonb_agg(person order by person->>'fullName',person->>'userId'),'[]') from (
   select jsonb_build_object('userId',p.user_id,'fullName',p.full_name,'role',p.role,'active',p.status='active','department',s.department,
    'days',(select coalesce(jsonb_agg(jsonb_build_object('day',x.day,
       'planned',(select jsonb_build_object('shift',d.shift,'department',d.department,'note',d.note) from private.workspace_rota_days d where d.user_id=p.user_id and d.day=x.day and d.cleared_at is null),
       'shifts',(select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'department',h.department,'clockedInAt',h.clocked_in_at,'clockedOutAt',h.clocked_out_at,
          'minutes',round(extract(epoch from coalesce(h.clocked_out_at,now())-h.clocked_in_at)/60)::int,'edited',h.edited_at is not null or h.closed_by is not null,'editNote',h.edit_note) order by h.clocked_in_at),'[]')
         from private.workspace_shifts h where h.user_id=p.user_id and (h.clocked_in_at at time zone 'Europe/London')::date=x.day),
       'minutes',(select coalesce(round(sum(extract(epoch from coalesce(h.clocked_out_at,now())-h.clocked_in_at)/60)),0)::int
         from private.workspace_shifts h where h.user_id=p.user_id and (h.clocked_in_at at time zone 'Europe/London')::date=x.day)) order by x.day),'[]')
      from (select (h.clocked_in_at at time zone 'Europe/London')::date as day from private.workspace_shifts h where h.user_id=p.user_id and h.clocked_in_at>=lower_at and h.clocked_in_at<upper_at
            union select d.day from private.workspace_rota_days d where d.user_id=p.user_id and d.cleared_at is null and d.day between start_on and end_on) x),
    'totalMinutes',(select coalesce(round(sum(extract(epoch from coalesce(h.clocked_out_at,now())-h.clocked_in_at)/60)),0)::int
      from private.workspace_shifts h where h.user_id=p.user_id and h.clocked_in_at>=lower_at and h.clocked_in_at<upper_at)) person
   from public.workspace_profiles p left join private.workspace_staff_rota s on s.user_id=p.user_id
   where p.role<>'client' and (admin or p.user_id=auth.uid()) and (target_user is null or p.user_id=target_user)
    and (p.status='active' or exists(select 1 from private.workspace_shifts h where h.user_id=p.user_id and h.clocked_in_at>=lower_at and h.clocked_in_at<upper_at))) people));
end $fn$;

create or replace function private.workspace_rota_plan_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();a text:=input->>'action';req uuid;prior private.workspace_action_receipts;result jsonb;
 who uuid;entry jsonb;on_day date;s private.workspace_shifts;starts timestamptz;ends timestamptz;event_id bigint;changed integer:=0;dept text;
begin
 if actor is null or actor not in ('admin','super_admin') then raise exception 'Only admins plan the rota and correct timesheets' using errcode='42501';end if;
 req:=(input->>'requestId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 prior:=(select x from private.workspace_action_receipts x where x.actor_id=auth.uid() and x.request_id=req);
 if prior.actor_id is not null then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;

 if a='planRota' then
  perform private.workspace_json_keys(input,array['action','requestId','userId','days']);
  who:=(input->>'userId')::uuid;
  if who is null or not private.workspace_team_member(who) then raise exception 'Choose someone on the team' using errcode='22023';end if;
  if jsonb_typeof(input->'days') is distinct from 'array' or jsonb_array_length(input->'days') not between 1 and 31 then raise exception 'Plan between 1 and 31 days at a time' using errcode='22023';end if;
  for entry in select value from jsonb_array_elements(input->'days') loop
   perform private.workspace_json_keys(entry,array['day','shift','department','note']);
   if coalesce(entry->>'day','')!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Choose a valid date' using errcode='22023';end if;
   on_day:=(entry->>'day')::date;
   if on_day<current_date-31 or on_day>current_date+366 then raise exception 'Plan from a month ago to a year ahead' using errcode='22023';end if;
   if entry->>'shift' is null then
    update private.workspace_rota_days set cleared_at=now(),updated_by=auth.uid(),updated_at=now() where user_id=who and day=on_day and cleared_at is null;
   else
    dept:=nullif(entry->>'department','');
    if entry->>'shift' not in ('early','late','both','off') or (dept is not null and dept not in ('guest_relations','client_relations','cleaning','ready','accounts','management'))
     or (entry ? 'note' and (jsonb_typeof(entry->'note')<>'string' or length(entry->>'note')>300)) then raise exception 'Choose early, late, both or off' using errcode='22023';end if;
    insert into private.workspace_rota_days(user_id,day,shift,department,note,updated_by)
     values(who,on_day,entry->>'shift',case when entry->>'shift'='off' then null else coalesce(dept,(select r.department from private.workspace_staff_rota r where r.user_id=who)) end,coalesce(btrim(entry->>'note'),''),auth.uid())
     on conflict(user_id,day) do update set shift=excluded.shift,department=excluded.department,note=excluded.note,updated_by=excluded.updated_by,updated_at=now(),cleared_at=null;
   end if;
   changed:=changed+1;
  end loop;
  result:=jsonb_build_object('userId',who,'days',changed);
  insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'team.rota_planned') returning id into event_id;

 elsif a in ('editShift','addShift') then
  if a='editShift' then
   perform private.workspace_json_keys(input,array['action','requestId','shiftId','clockedInAt','clockedOutAt','department','note']);
   select * into s from private.workspace_shifts x where x.id=(input->>'shiftId')::uuid for update;
   if s.id is null then raise exception 'Shift not found' using errcode='P0002';end if;
   who:=s.user_id;
  else
   perform private.workspace_json_keys(input,array['action','requestId','userId','clockedInAt','clockedOutAt','department','note']);
   who:=(input->>'userId')::uuid;
   if who is null or not exists(select 1 from public.workspace_profiles p where p.user_id=who and p.role<>'client') then raise exception 'Choose someone on the team' using errcode='22023';end if;
  end if;
  starts:=(input->>'clockedInAt')::timestamptz;ends:=(input->>'clockedOutAt')::timestamptz;
  dept:=coalesce(input->>'department',s.department);
  if starts is null then raise exception 'Choose when the shift started' using errcode='22023';end if;
  -- Only a shift that is still running may stay open.
  if ends is null and (a='addShift' or s.clocked_out_at is not null) then raise exception 'Choose when the shift ended' using errcode='22023';end if;
  if starts>now() or ends>now() or ends<=starts or (coalesce(ends,now())-starts)>interval '24 hours' then raise exception 'A shift starts and ends in the past and lasts at most 24 hours' using errcode='22023';end if;
  if dept is null or dept not in ('guest_relations','client_relations','cleaning','ready','accounts','management') then raise exception 'Choose a department' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended(who::text,77));
  if exists(select 1 from private.workspace_shifts x where x.user_id=who and x.id is distinct from s.id and x.clocked_in_at<coalesce(ends,'infinity'::timestamptz) and coalesce(x.clocked_out_at,'infinity'::timestamptz)>starts) then
   raise exception 'That overlaps another shift for this person' using errcode='23505';end if;
  if a='editShift' then
   update private.workspace_shifts set clocked_in_at=starts,clocked_out_at=ends,department=dept,edited_by=auth.uid(),edited_at=now(),edit_note=private.workspace_required_text(input,'note',3,500)
    where id=s.id returning * into s;
  else
   insert into private.workspace_shifts(user_id,department,clocked_in_at,clocked_out_at,request_id,edited_by,edited_at,edit_note)
    values(who,dept,starts,ends,req,auth.uid(),now(),private.workspace_required_text(input,'note',3,500)) returning * into s;
  end if;
  result:=private.workspace_shift_json(s)||jsonb_build_object('editNote',s.edit_note);
  insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'team.shift_corrected') returning id into event_id;
 else raise exception 'Unknown team action' using errcode='22023';end if;
 insert into private.workspace_notification_outbox(user_id,event_id) select who,event_id where who is distinct from auth.uid() on conflict do nothing;
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $fn$;

-- ---------------------------------------------------------------- times on dated work
create or replace function private.workspace_work_time_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();req uuid;prior private.workspace_action_receipts;result jsonb;w public.workspace_work_items;
 due date;starts time;ends time;
begin
 if actor is null or actor in ('client','cleans') then raise exception 'Only the team can set times' using errcode='42501';end if;
 perform private.workspace_json_keys(input,array['action','requestId','workId','version','dueOn','startTime','endTime']);
 req:=(input->>'requestId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 prior:=(select x from private.workspace_action_receipts x where x.actor_id=auth.uid() and x.request_id=req);
 if prior.actor_id is not null then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;
 select * into w from public.workspace_work_items x where x.id=(input->>'workId')::uuid for update;
 if w.id is null or not private.workspace_can_work(w.id) then raise exception 'Work not found' using errcode='P0002';end if;
 if w.status in ('completed','cancelled','declined') then raise exception 'This is already closed' using errcode='22023';end if;
 if w.version is distinct from (input->>'version')::int then raise exception 'Changed by someone else. Refresh and try again' using errcode='40001';end if;
 if coalesce(input->>'dueOn','')!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Choose a date' using errcode='22023';end if;
 due:=(input->>'dueOn')::date;
 if due<current_date-31 or due>current_date+366 then raise exception 'Choose a date from a month ago to a year ahead' using errcode='22023';end if;
 if coalesce(input->>'startTime','00:00')!~'^([01]\d|2[0-3]):[0-5]\d$' or coalesce(input->>'endTime','00:00')!~'^([01]\d|2[0-3]):[0-5]\d$' then raise exception 'Enter times as HH:MM, for example 10:30' using errcode='22023';end if;
 starts:=(input->>'startTime')::time;ends:=(input->>'endTime')::time;
 if ends is not null and (starts is null or ends<=starts) then raise exception 'The end time must be after the start time' using errcode='22023';end if;
 update public.workspace_work_items set due_on=due,due_time=starts,due_end_time=ends,version=version+1,updated_at=now() where id=w.id returning * into w;
 result:=jsonb_build_object('workId',w.id,'version',w.version,'dueOn',w.due_on,'dueTime',to_char(w.due_time,'HH24:MI'),'endTime',to_char(w.due_end_time,'HH24:MI'));
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $fn$;

revoke all on function private.workspace_team_member(uuid),private.workspace_responsibilities_read(),private.workspace_responsibility_action(jsonb),
 private.workspace_rota_plan_read(date,date),private.workspace_timesheet_read(date,date,uuid),private.workspace_rota_plan_action(jsonb),
 private.workspace_work_time_action(jsonb) from public,anon,authenticated;

-- ---------------------------------------------------------------- routes, and times in the schedule and work views
CREATE OR REPLACE FUNCTION private.workspace_teams_read(section text, start_on date DEFAULT NULL::date, end_on date DEFAULT NULL::date, target_property uuid DEFAULT NULL::uuid, target_user uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor text:=private.workspace_actor_role();result jsonb;month_start date;begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 if section='schedule' then
  if start_on is null or end_on is null or end_on<start_on or end_on-start_on>62 then raise exception 'Choose up to 62 days' using errcode='22023';end if;
  if target_user is not null and actor in ('client','cleans') and target_user<>auth.uid() then raise exception 'Schedule access denied' using errcode='42501';end if;
  select jsonb_build_object('from',start_on,'to',end_on,'payments',private.workspace_schedule_payments(start_on,end_on,target_property),
   'work',(select coalesce(jsonb_agg(jsonb_build_object('workId',w.id,'propertyId',w.property_id,'propertyName',p.name,'moduleId',w.module_id,'title',w.title,'status',w.status,
     'dueOn',w.due_on,'dueTime',to_char(w.due_time,'HH24:MI'),'endTime',to_char(w.due_end_time,'HH24:MI'),'assigneeId',w.assignee_id,'assigneeName',a.full_name,'kind',d.kind,'version',w.version) order by w.due_on,w.due_time nulls first,w.id),'[]')
     from (select * from public.workspace_work_items w where w.due_on between start_on and end_on and w.status not in ('cancelled','declined')
       and (target_property is null or w.property_id=target_property) and (target_user is null or w.assignee_id=target_user) and private.workspace_can_work(w.id) order by w.due_on,w.id limit 500) w
     join public.workspace_properties p on p.id=w.property_id left join public.workspace_profiles a on a.user_id=w.assignee_id left join private.workspace_domain_details d on d.work_id=w.id),
   'cleanGuests',private.workspace_clean_guests(start_on,end_on,target_property,target_user),'stays',case when actor='cleans' then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('reservationId',r.id,'propertyId',r.property_id,'propertyName',p.name,
     'checkIn',r.check_in,'checkOut',r.check_out,'guests',r.guests,'channel',case when actor='client' then null else r.channel end) order by r.check_in,r.id),'[]')
     from (select * from private.workspace_reservations r where r.status='confirmed' and r.check_in<=end_on and r.check_out>=start_on and (target_property is null or r.property_id=target_property)
       and (case actor when 'client' then private.workspace_can_property(r.property_id,'client-dashboard') when 'accounts' then private.workspace_can_property(r.property_id,'owner-statements')
         else private.workspace_can_property(r.property_id,'cleaning-schedule') or private.workspace_can_property(r.property_id,'direct-bookings') or private.workspace_can_property(r.property_id,'ready-schedule') end)
       order by r.check_in,r.id limit 500) r join public.workspace_properties p on p.id=r.property_id) end) into result;
 elsif section='cleanerRates' then result:=private.workspace_cleaner_rates_read();
 elsif section='defaultCleaners' then result:=private.workspace_default_cleaners_read();
 elsif section='hub' then result:=private.workspace_hub_read();
 elsif section='responsibilities' then result:=private.workspace_responsibilities_read();
 elsif section='rotaPlan' then result:=private.workspace_rota_plan_read(start_on,end_on);
 elsif section='timesheet' then result:=private.workspace_timesheet_read(start_on,end_on,target_user);
 elsif section='performance' then
  month_start:=date_trunc('month',coalesce(start_on,current_date))::date;
  if actor='cleans' then return jsonb_build_array(private.workspace_cleaner_month(auth.uid(),month_start));end if;
  if actor not in ('cleaning_manager','stays','admin','super_admin') or not private.has_workspace_module('cleaner-performance') then raise exception 'Cleaner performance access required' using errcode='42501';end if;
  select coalesce(jsonb_agg(private.workspace_cleaner_month(c.user_id,month_start) order by c.full_name,c.user_id),'[]') into result from public.workspace_profiles c
   where c.role='cleans' and c.status='active' and (target_user is null or c.user_id=target_user) and (actor in ('admin','super_admin') or exists(select 1 from public.workspace_property_assignments a
    where a.user_id=c.user_id and a.assignment='cleaner' and private.workspace_can_property(a.property_id,'cleaner-performance')));
 elsif section='management' then
  if actor not in ('admin','super_admin') then raise exception 'Management access required' using errcode='42501';end if;
  month_start:=date_trunc('month',current_date)::date;
  select jsonb_build_object(
   'cleaningDecisions',(select coalesce(jsonb_agg(jsonb_build_object('workId',w.id,'version',w.version,'kind',d.kind,'title',w.title,'propertyId',w.property_id,'propertyName',p.name,
     'cleanerId',d.data->>'cleanerId','cleanerName',c.full_name,'cleanerStatement',d.data->>'cleanerStatement','sourceWorkId',d.data->>'sourceWorkId','createdAt',w.created_at) order by w.created_at),'[]')
     from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id join public.workspace_properties p on p.id=w.property_id
     left join public.workspace_profiles c on c.user_id::text=d.data->>'cleanerId' where d.kind in ('cleaning_complaint','cleaner_management_review') and w.status not in ('completed','cancelled')),
   'expensesOverLimit',(select coalesce(jsonb_agg(private.workspace_expense_view(x,false) order by x.received_on),'[]') from private.workspace_expenses x,private.workspace_finance_policy f
     where x.status='to_approve' and f.expense_approval_limit_minor is not null and x.amount_minor>f.expense_approval_limit_minor),
   'repairApprovals',private.workspace_management_repairs(),
   'cleanerWarnings',(select coalesce(jsonb_agg(m.v order by m.v->>'fullName'),'[]') from (select private.workspace_cleaner_month(c.user_id,month_start) v from public.workspace_profiles c where c.role='cleans' and c.status='active') m where (m.v->>'warning')::boolean),
   'ownerBalancesDue',(select coalesce(jsonb_agg(private.workspace_statement_view(s) order by s.period_start),'[]') from private.workspace_owner_statements s where s.status in ('draft','issued') and s.payout_minor<0),
   'stalledOwnerApprovals',private.workspace_stalled_owner_approvals(),'unusualPayouts',private.workspace_unusual_payouts(),'missedYesterday',private.workspace_missed_days_json()
  ) into result;
 elsif section='routines' then
  if actor not in ('ready','stays','admin','super_admin') then raise exception 'Routine maintenance access required' using errcode='42501';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'propertyId',r.property_id,'propertyName',p.name,'moduleId',r.module_id,'title',r.title,'checklist',r.checklist,'frequency',r.frequency,
   'dayOfMonth',r.day_of_month,'assigneeId',r.assignee_id,'active',r.active,'startsOn',r.starts_on,'version',r.version,
   'lastVisit',(select jsonb_build_object('period',to_char(v.period_start,'YYYY-MM'),'workId',v.work_id) from private.workspace_routine_visits v where v.plan_id=r.id order by v.period_start desc limit 1)) order by p.name,r.title,r.id),'[]') into result
   from private.workspace_routine_plans r join public.workspace_properties p on p.id=r.property_id where (target_property is null or r.property_id=target_property) and private.workspace_can_property(r.property_id,r.module_id);
 elsif section='training' then
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'audience',c.audience,'summary',c.summary,'body',c.body,'videoUrl',c.video_url,'minutes',c.minutes,'published',c.published,'required',c.required,'version',c.version,'files',private.workspace_course_files_json(c.id),
   'completedAt',(select t.completed_at from private.workspace_training_progress t where t.course_id=c.id and t.user_id=auth.uid()),
   'completions',case when actor in ('admin','super_admin') then (select count(*) from private.workspace_training_progress t where t.course_id=c.id) end) order by c.title,c.id),'[]') into result
   from private.workspace_training_courses c where (actor in ('admin','super_admin') or (c.published and ('all'=any(c.audience) or actor=any(c.audience))));
 elsif section in ('onboarding','contracts','myContracts') then result:=private.workspace_onboarding_read(section);
 elsif section='rota' then result:=private.workspace_rota_read();
 elsif section='budgetChart' then result:=private.workspace_budget_read();
 elsif section='signoff' then result:=private.workspace_signoff_read();
 elsif section in ('shift','teamPerformance') then result:=private.workspace_shift_read(section,start_on,end_on);
 elsif section='mailbox' then result:=private.workspace_mailbox_read();
 else raise exception 'Unknown team section' using errcode='22023';end if;
 return result;
end $function$;

CREATE OR REPLACE FUNCTION private.workspace_teams_action(input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor text:=private.workspace_actor_role();a text;req uuid;prop uuid;prior private.workspace_action_receipts;result jsonb;
 w public.workspace_work_items;d private.workspace_domain_details;src public.workspace_work_items;sd private.workspace_domain_details;
 plan private.workspace_routine_plans;course private.workspace_training_courses;start_on date;target uuid;created jsonb:='[]';remaining integer:=0;n integer:=0;assignee uuid;
begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 if input->>'action' in ('saveContract','setCourseRequired','signContract') then return private.workspace_onboarding_action(input);end if;
 if input->>'action' in ('clockIn','clockOut','closeShift','saveTargets') then return private.workspace_shift_action(input);end if;
 if input->>'action'='signOffDay' then return private.workspace_signoff_action(input);end if;
 if input->>'action' in ('saveBudgetItem','removeBudgetItem') then return private.workspace_budget_action(input);end if;
 if input->>'action'='saveRota' then return private.workspace_rota_action(input);end if;
 a:=private.workspace_required_text(input,'action',1,50);req:=(input->>'requestId')::uuid;prop:=(input->>'propertyId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 if a='decideComplaint' then return private.workspace_decide_clean_dispute(input);end if;
 if a='setCleanerRate' then return private.workspace_cleaner_rate_action(input);end if;
 if a='setDefaultCleaner' then return private.workspace_default_cleaner_action(input);end if;
 if a in ('saveHubItem','moveHubItem') then return private.workspace_hub_action(input);end if;
 if a in ('saveResponsibility','removeResponsibility') then return private.workspace_responsibility_action(input);end if;
 if a in ('planRota','editShift','addShift') then return private.workspace_rota_plan_action(input);end if;
 if a='setWorkTime' then return private.workspace_work_time_action(input);end if;
 if a in ('decideComplaint','decideCleanerReview','saveCourse') then
  if actor not in ('admin','super_admin') then raise exception 'Management access required' using errcode='42501';end if;
 elsif a='addCleanerStatement' then
  if actor<>'cleans' or not exists(select 1 from private.workspace_domain_details x where x.work_id=(input->>'workId')::uuid and x.kind='cleaning_complaint' and x.data->>'cleanerId'=auth.uid()::text) then raise exception 'Only the cleaner concerned can respond' using errcode='42501';end if;
 elsif a='saveRoutinePlan' then
  if input->>'planId' is not null then select property_id into prop from private.workspace_routine_plans where id=(input->>'planId')::uuid;end if;
  if actor not in ('ready','stays','admin','super_admin') or prop is null or not private.workspace_can_property(prop,coalesce(input->>'moduleId','')) then raise exception 'Routine maintenance access required' using errcode='42501';end if;
 elsif a='generateRoutineVisits' then
  if actor not in ('ready','stays','admin','super_admin') then raise exception 'Routine maintenance access required' using errcode='42501';end if;
 elsif a='completeCourse' then
  if not exists(select 1 from private.workspace_training_courses c where c.id=(input->>'courseId')::uuid and c.published and ('all'=any(c.audience) or actor=any(c.audience) or actor in ('admin','super_admin'))) then raise exception 'Course not available' using errcode='P0002';end if;
 else raise exception 'Unknown team action' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 select * into prior from private.workspace_action_receipts where actor_id=auth.uid() and request_id=req;
 if found then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;

 if a in ('decideComplaint','decideCleanerReview') then
  perform private.workspace_json_keys(input,array['action','requestId','workId','version','outcome','note']);
  select * into w from public.workspace_work_items where id=(input->>'workId')::uuid for update;
  select * into d from private.workspace_domain_details where work_id=w.id for update;
  if not found or d.kind<>(case a when 'decideComplaint' then 'cleaning_complaint' else 'cleaner_management_review' end) then raise exception 'Decision not found' using errcode='P0002';end if;
  if w.version is distinct from (input->>'version')::integer then raise exception 'Decision changed' using errcode='40001';end if;
  if w.status in ('completed','cancelled') then raise exception 'Already decided' using errcode='42501';end if;
  if coalesce(input->>'outcome','')<>all(case a when 'decideComplaint' then array['upheld','overturned'] else array['no_action','supervised','removed_from_rota'] end) then raise exception 'Choose an outcome' using errcode='22023';end if;
  update private.workspace_domain_details set data=data||jsonb_build_object('decision',input->>'outcome','decisionNote',private.workspace_required_text(input,'note',5,2000),'decidedBy',auth.uid(),'decidedAt',now(),'workStatus','completed'),updated_at=now() where work_id=w.id;
  insert into public.workspace_work_updates(work_id,actor_id,request_id,previous_status,next_status,note,expected_version) values(w.id,auth.uid(),req,w.status,'completed',input->>'note',w.version);
  update public.workspace_work_items set status='completed',completed_at=now(),version=version+1,updated_at=now() where id=w.id returning * into w;
  if a='decideCleanerReview' and input->>'outcome'='removed_from_rota' then
   -- Off every property, and their open cleans go back to the cleaning manager to reassign.
   delete from public.workspace_property_assignments where user_id::text=d.data->>'cleanerId' and assignment='cleaner';
   update public.workspace_work_items cw set assignee_id=null,version=cw.version+1,updated_at=now()
    from private.workspace_domain_details cd where cd.work_id=cw.id and cd.kind='cleaning' and cw.assignee_id::text=d.data->>'cleanerId' and cw.status not in ('completed','cancelled');
  end if;
  if a='decideComplaint' and input->>'outcome'='overturned' then
   -- The rejection no longer counts against the cleaner.
   update private.workspace_cleaning_reviews set overturned_at=now(),overturned_by=auth.uid(),overturn_note=input->>'note'
    where id=(select r.id from private.workspace_cleaning_reviews r where r.work_id=(d.data->>'sourceWorkId')::uuid and r.cleaner_id::text=d.data->>'cleanerId' and not r.accepted and r.overturned_at is null order by r.created_at desc limit 1);
   -- If the clean has not been redone, it is accepted as originally submitted and can be invoiced.
   select * into src from public.workspace_work_items where id=(d.data->>'sourceWorkId')::uuid for update;
   select * into sd from private.workspace_domain_details where work_id=src.id for update;
   if src.id is not null and sd.kind='cleaning' and sd.data->>'phase'='assigned' and src.status='waiting' and src.assignee_id::text=d.data->>'cleanerId' and sd.data ? 'submittedBy' then
    update private.workspace_domain_details set data=data||jsonb_build_object('phase','accepted','workStatus','completed','overturnedBy',auth.uid()),updated_at=now() where work_id=src.id;
    insert into public.workspace_work_updates(work_id,actor_id,request_id,previous_status,next_status,note,expected_version) values(src.id,auth.uid(),gen_random_uuid(),src.status,'completed','Rejection overturned by management',src.version);
    update public.workspace_work_items set status='completed',completed_at=now(),version=version+1,updated_at=now() where id=src.id;
    perform private.workspace_handover(src.property_id,'cleans-invoices','Invoice accepted property clean','cleaning_invoice',jsonb_build_object('sourceWorkId',src.id,'cleanerId',src.assignee_id));
   end if;
  end if;
  result:=jsonb_build_object('workId',w.id,'version',w.version,'status',w.status,'outcome',input->>'outcome');
  insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(auth.uid(),w.property_id,w.id,'cleaning.decision_'||(input->>'outcome'));

 elsif a='addCleanerStatement' then
  perform private.workspace_json_keys(input,array['action','requestId','workId','statement']);
  select * into w from public.workspace_work_items where id=(input->>'workId')::uuid for update;
  select * into d from private.workspace_domain_details where work_id=w.id for update;
  if w.status in ('completed','cancelled') then raise exception 'This complaint has been decided' using errcode='42501';end if;
  if d.data ? 'cleanerStatement' then raise exception 'You have already responded' using errcode='23505';end if;
  update private.workspace_domain_details set data=data||jsonb_build_object('cleanerStatement',private.workspace_required_text(input,'statement',10,2000),'cleanerStatementAt',now()),updated_at=now() where work_id=w.id;
  result:=jsonb_build_object('workId',w.id,'responded',true);
  insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(auth.uid(),w.property_id,w.id,'cleaning.cleaner_responded');

 elsif a='saveRoutinePlan' then
  perform private.workspace_json_keys(input,array['action','requestId','planId','version','propertyId','moduleId','title','checklist','frequency','dayOfMonth','assigneeId','active']);
  if coalesce(input->>'frequency','') not in ('monthly','quarterly') or jsonb_typeof(input->'dayOfMonth') is distinct from 'number' or input->>'dayOfMonth'!~'^\d+$' or (input->>'dayOfMonth')::int not between 1 and 28
   or jsonb_typeof(input->'active') is distinct from 'boolean' or jsonb_typeof(input->'checklist') is distinct from 'array' or jsonb_array_length(input->'checklist') not between 1 and 30
   or exists(select 1 from jsonb_array_elements(input->'checklist') e where jsonb_typeof(e)<>'string' or length(trim(e#>>'{}')) not between 1 and 200) then raise exception 'Invalid routine plan' using errcode='22023';end if;
  assignee:=(input->>'assigneeId')::uuid;
  if assignee is not null and not exists(select 1 from public.workspace_profiles p join public.workspace_property_assignments s on s.user_id=p.user_id and s.property_id=prop and s.assignment='staff'
   where p.user_id=assignee and p.status='active' and p.role in ('ready','stays','admin','super_admin')) then raise exception 'Assign someone on this property team' using errcode='42501';end if;
  if input->>'planId' is null then
   insert into private.workspace_routine_plans(property_id,module_id,title,checklist,frequency,day_of_month,assignee_id,active,starts_on,created_by,request_id)
    values(prop,input->>'moduleId',private.workspace_required_text(input,'title',2,200),input->'checklist',input->>'frequency',(input->>'dayOfMonth')::int,assignee,(input->>'active')::boolean,date_trunc('month',current_date)::date,auth.uid(),req) returning * into plan;
  else
   select * into plan from private.workspace_routine_plans where id=(input->>'planId')::uuid for update;
   if plan.version is distinct from (input->>'version')::integer then raise exception 'Routine plan changed' using errcode='40001';end if;
   if plan.property_id<>prop or plan.module_id<>input->>'moduleId' then raise exception 'Create a new plan for another property or board' using errcode='22023';end if;
   update private.workspace_routine_plans set title=private.workspace_required_text(input,'title',2,200),checklist=input->'checklist',frequency=input->>'frequency',day_of_month=(input->>'dayOfMonth')::int,
    assignee_id=assignee,active=(input->>'active')::boolean,version=version+1,updated_at=now() where id=plan.id returning * into plan;
  end if;
  result:=jsonb_build_object('id',plan.id,'version',plan.version,'active',plan.active);
  insert into public.workspace_activity(actor_id,property_id,event_type) values(auth.uid(),plan.property_id,'routine.plan_saved');

 elsif a='generateRoutineVisits' then
  perform private.workspace_json_keys(input,array['action','requestId','period']);
  start_on:=private.workspace_period(input->>'period');
  if start_on<date_trunc('month',current_date)::date or start_on>(date_trunc('month',current_date)+interval '2 months')::date then raise exception 'Generate visits for this month or the next two' using errcode='22023';end if;
  -- Bounded per call to stay inside the write quota; call again while remaining is above zero.
  for plan in select r.* from private.workspace_routine_plans r where r.active and r.starts_on<=start_on and private.workspace_can_property(r.property_id,r.module_id)
    and (r.frequency='monthly' or ((extract(year from start_on)-extract(year from r.starts_on))*12+extract(month from start_on)-extract(month from r.starts_on))::int%3=0)
    and not exists(select 1 from private.workspace_routine_visits v where v.plan_id=r.id and v.period_start=start_on) order by r.property_id,r.id loop
   if n>=10 then remaining:=remaining+1;continue;end if;
   target:=private.workspace_handover(plan.property_id,plan.module_id,plan.title,'routine_visit',jsonb_build_object('planId',plan.id,'period',to_char(start_on,'YYYY-MM'),'checklist',plan.checklist));
   -- A previous assignee who has left the property team is not carried over.
   update public.workspace_work_items set due_on=start_on+plan.day_of_month-1,assignee_id=case when exists(select 1 from public.workspace_property_assignments s join public.workspace_profiles p on p.user_id=s.user_id
     where s.property_id=plan.property_id and s.user_id=plan.assignee_id and s.assignment='staff' and p.status='active') then plan.assignee_id end where id=target;
   insert into private.workspace_routine_visits(plan_id,period_start,work_id) values(plan.id,start_on,target);
   created:=created||jsonb_build_array(target);n:=n+1;
  end loop;
  result:=jsonb_build_object('period',to_char(start_on,'YYYY-MM'),'created',created,'remaining',remaining);

 elsif a='saveCourse' then
  perform private.workspace_json_keys(input,array['action','requestId','courseId','version','title','audience','summary','body','videoUrl','minutes','published','redoRequired']);perform private.workspace_onboarding_refresh();
  if jsonb_typeof(input->'audience') is distinct from 'array' or jsonb_typeof(input->'published') is distinct from 'boolean' or jsonb_typeof(input->'minutes') is distinct from 'number' or input->>'minutes'!~'^\d+$'
   or exists(select 1 from jsonb_array_elements(input->'audience') e where jsonb_typeof(e)<>'string') or (input->'videoUrl' is not null and jsonb_typeof(input->'videoUrl')<>'string')
   or (input->'summary' is not null and jsonb_typeof(input->'summary')<>'string') then raise exception 'Invalid course' using errcode='22023';end if;
  if input->>'courseId' is null then
   insert into private.workspace_training_courses(title,audience,summary,body,video_url,minutes,published,created_by,request_id)
    values(private.workspace_required_text(input,'title',2,200),array(select distinct value#>>'{}' from jsonb_array_elements(input->'audience')),coalesce(trim(input->>'summary'),''),
    private.workspace_required_text(input,'body',10,50000),nullif(trim(input->>'videoUrl'),''),(input->>'minutes')::int,(input->>'published')::boolean,auth.uid(),req) returning * into course;
  else
   select * into course from private.workspace_training_courses where id=(input->>'courseId')::uuid for update;
   if not found then raise exception 'Course not found' using errcode='P0002';end if;
   if course.version is distinct from (input->>'version')::integer then raise exception 'Course changed' using errcode='40001';end if;
   update private.workspace_training_courses set title=private.workspace_required_text(input,'title',2,200),audience=array(select distinct value#>>'{}' from jsonb_array_elements(input->'audience')),
    summary=coalesce(trim(input->>'summary'),''),body=private.workspace_required_text(input,'body',10,50000),video_url=nullif(trim(input->>'videoUrl'),''),minutes=(input->>'minutes')::int,
    published=(input->>'published')::boolean,version=version+1,updated_at=now() where id=course.id returning * into course;if coalesce((input->>'redoRequired')::boolean,false) then delete from private.workspace_training_progress where course_id=course.id;end if;
  end if;
  result:=jsonb_build_object('id',course.id,'version',course.version,'published',course.published);
  insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'training.course_saved');perform private.workspace_onboarding_refresh();

 elsif a='completeCourse' then
  perform private.workspace_json_keys(input,array['action','requestId','courseId']);
  insert into private.workspace_training_progress(course_id,user_id) values((input->>'courseId')::uuid,auth.uid()) on conflict do nothing;perform private.workspace_onboarding_progress(auth.uid());
  select jsonb_build_object('courseId',course_id,'completedAt',completed_at) into result from private.workspace_training_progress where course_id=(input->>'courseId')::uuid and user_id=auth.uid();
 end if;
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $function$;

-- Each piece of work with its times, and when it was raised and last changed.
CREATE OR REPLACE FUNCTION private.workspace_operation_view(target uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select jsonb_build_object('workId',w.id,'propertyId',w.property_id,'moduleId',w.module_id,'title',w.title,'status',w.status,'version',w.version,'assigneeId',w.assignee_id,'dueOn',w.due_on,'dueTime',to_char(w.due_time,'HH24:MI'),'endTime',to_char(w.due_end_time,'HH24:MI'),'kind',d.kind,'createdAt',w.created_at,'updatedAt',w.updated_at,
 'data',case when private.workspace_actor_role()='client' then d.data-'guestEvidence'-'reservationId'-'troubleshooting'-'warrantyContactEvidence' else d.data end)
 from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where w.id=target;
$function$;
