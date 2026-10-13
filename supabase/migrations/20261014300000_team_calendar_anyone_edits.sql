-- Team calendar, who may edit (Lee, 13 October 2026): anyone on the team (cleaners and the cleaning manager too) can add, change
-- and cancel absences, meetings, time away, training and other entries for anyone on the team. Owners never can, and never read them.
-- Every entry records who last edited it and when (updated_by, updated_at), and the read returns both so the calendar can show them.
-- The person an entry is for is still told when someone else adds, changes or cancels it (team.event_set, team.event_cancelled);
-- those notices carry no work or property, so the activity_scoped policy already keeps them from owners.
-- The read and the action are replaced whole (only 20261012210000 defines them; nothing patches them). The routes are unchanged.

-- ---------------------------------------------------------------- assumption, one function
-- Who may change someone else's entry (client decision, confirmed by Lee): everyone on the team. Return false to go back to
-- "your own; admins anyone's".
create or replace function private.workspace_team_events_anyone_edits() returns boolean language sql immutable set search_path='' as $fn$ select true $fn$;

-- ---------------------------------------------------------------- who last edited
alter table private.workspace_team_events add column if not exists updated_by uuid references public.workspace_profiles(user_id);
create index if not exists workspace_team_events_editor_idx on private.workspace_team_events(updated_by);
-- Rows saved before this migration: the last edit is the cancel if there was one, else whoever added it.
update private.workspace_team_events set updated_by=coalesce(cancelled_by,created_by) where updated_by is null;

-- ---------------------------------------------------------------- read
-- Every team role (cleaners too), never owners. canEditAll says whether this person may change other people's entries.
-- editedBy is the name of whoever last added, changed or cancelled the entry; editedAt is when.
create or replace function private.workspace_team_events_read(start_on date,end_on date) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();
begin
 if actor is null or actor='client' then raise exception 'Team access required' using errcode='42501';end if;
 if start_on is null or end_on is null or end_on<start_on or end_on-start_on>private.workspace_team_events_max_window() then raise exception 'Choose up to 62 days' using errcode='22023';end if;
 return jsonb_build_object('from',start_on,'to',end_on,'canEditAll',actor in ('admin','super_admin') or private.workspace_team_events_anyone_edits(),
  'events',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'userId',x.user_id,'fullName',x.full_name,'role',x.role,'kind',x.kind,'title',x.title,
     'startsOn',x.starts_on,'endsOn',x.ends_on,'startTime',to_char(x.start_time,'HH24:MI'),'endTime',to_char(x.end_time,'HH24:MI'),'location',x.location,
     'mine',x.user_id=auth.uid(),'version',x.version,
     'editedById',x.editor_id,'editedBy',x.editor_name,'editedAt',x.updated_at,'added',x.version=1) order by x.starts_on,x.start_time nulls first,x.full_name,x.id),'[]')
   from (select e.*,p.full_name,p.role,coalesce(e.updated_by,e.created_by) editor_id,ed.full_name editor_name
     from private.workspace_team_events e join public.workspace_profiles p on p.user_id=e.user_id
     left join public.workspace_profiles ed on ed.user_id=coalesce(e.updated_by,e.created_by)
     where e.cancelled_at is null and e.starts_on<=end_on and e.ends_on>=start_on and p.status='active' and p.role<>'client'
     order by e.starts_on,e.id limit 500) x));
end $fn$;

-- ---------------------------------------------------------------- actions
-- saveTeamEvent {id?, version?, userId?, kind, title, startsOn, endsOn, startTime?, endTime?, location?} and cancelTeamEvent {id, version?}.
-- Anyone on the team adds one for anyone on the team (userId) and changes or cancels anyone's; each write records who made it.
create or replace function private.workspace_team_events_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();a text:=input->>'action';req uuid;prior private.workspace_action_receipts;result jsonb;e private.workspace_team_events;
 for_others boolean;target uuid;sd date;ed date;st time;et time;loc text;event_id bigint;
begin
 if actor is null or actor='client' then raise exception 'Team access required' using errcode='42501';end if;
 if a is null or a not in ('saveTeamEvent','cancelTeamEvent') then raise exception 'Unknown team action' using errcode='22023';end if;
 for_others:=actor in ('admin','super_admin') or private.workspace_team_events_anyone_edits();
 req:=(input->>'requestId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 prior:=(select x from private.workspace_action_receipts x where x.actor_id=auth.uid() and x.request_id=req);
 if prior.actor_id is not null then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;
 if a='saveTeamEvent' then
  perform private.workspace_json_keys(input,array['action','requestId','id','version','userId','kind','title','startsOn','endsOn','startTime','endTime','location']);
  if coalesce(input->>'kind','') not in ('absence','meeting','away','training','other') then raise exception 'Choose what this is' using errcode='22023';end if;
  perform private.workspace_required_text(input,'title',2,200);
  if jsonb_typeof(input->'startsOn') is distinct from 'string' or jsonb_typeof(input->'endsOn') is distinct from 'string'
   or input->>'startsOn'!~'^\d{4}-\d{2}-\d{2}$' or input->>'endsOn'!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Choose the dates' using errcode='22023';end if;
  begin sd:=(input->>'startsOn')::date;ed:=(input->>'endsOn')::date;
  exception when others then raise exception 'Choose the dates' using errcode='22023';end;
  if ed<sd then raise exception 'The end date must be on or after the start date' using errcode='22023';end if;
  if ed-sd>private.workspace_team_event_max_days() then raise exception 'Choose up to a year' using errcode='22023';end if;
  if sd<current_date-366 or ed>current_date+731 then raise exception 'Choose dates within the last year and the next two' using errcode='22023';end if;
  if (input ? 'startTime' and jsonb_typeof(input->'startTime') not in ('string','null')) or (input ? 'endTime' and jsonb_typeof(input->'endTime') not in ('string','null'))
   or coalesce(input->>'startTime','00:00')!~'^([01]\d|2[0-3]):[0-5]\d$' or coalesce(input->>'endTime','00:00')!~'^([01]\d|2[0-3]):[0-5]\d$' then raise exception 'Choose the times' using errcode='22023';end if;
  st:=(input->>'startTime')::time;et:=(input->>'endTime')::time;
  if et is not null and st is null then raise exception 'Add the start time too' using errcode='22023';end if;
  if et is not null and ed=sd and et<=st then raise exception 'The end time must be after the start time' using errcode='22023';end if;
  if input ? 'location' and (jsonb_typeof(input->'location') not in ('string','null') or length(coalesce(input->>'location',''))>200) then raise exception 'The place is too long' using errcode='22023';end if;
  loc:=btrim(coalesce(input->>'location',''));
  if input ? 'id' then
   select * into e from private.workspace_team_events x where x.id=(input->>'id')::uuid for update;
   if e.id is null then raise exception 'Event not found' using errcode='P0002';end if;
   if e.user_id<>auth.uid() and not for_others then raise exception 'You can only change your own events' using errcode='42501';end if;
   if e.user_id<>auth.uid() and not private.workspace_team_member(e.user_id) then raise exception 'This person is no longer on the team' using errcode='22023';end if;
   if e.cancelled_at is not null then raise exception 'This event was cancelled' using errcode='22023';end if;
   if input ? 'userId' and (input->>'userId')::uuid is distinct from e.user_id then raise exception 'An event stays with the person it is for' using errcode='22023';end if;
   if input ? 'version' and e.version is distinct from (input->>'version')::integer then raise exception 'Changed by someone else. Refresh and try again' using errcode='40001';end if;
   update private.workspace_team_events set kind=input->>'kind',title=btrim(input->>'title'),starts_on=sd,ends_on=ed,start_time=st,end_time=et,location=loc,
    version=version+1,updated_at=now(),updated_by=auth.uid() where id=e.id returning * into e;
  else
   target:=coalesce((input->>'userId')::uuid,auth.uid());
   if target<>auth.uid() and not for_others then raise exception 'You can only add your own events' using errcode='42501';end if;
   if not private.workspace_team_member(target) then raise exception 'Choose someone on the team' using errcode='22023';end if;
   insert into private.workspace_team_events(user_id,kind,title,starts_on,ends_on,start_time,end_time,location,created_by,updated_by)
    values(target,input->>'kind',btrim(input->>'title'),sd,ed,st,et,loc,auth.uid(),auth.uid()) returning * into e;
  end if;
  result:=jsonb_build_object('id',e.id,'version',e.version,'userId',e.user_id);
  -- Someone else's calendar changed: tell them. Your own changes need no notice.
  if e.user_id<>auth.uid() then
   insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'team.event_set') returning id into event_id;
   insert into private.workspace_notification_outbox(user_id,event_id) values(e.user_id,event_id) on conflict do nothing;
  end if;
 else
  perform private.workspace_json_keys(input,array['action','requestId','id','version']);
  select * into e from private.workspace_team_events x where x.id=(input->>'id')::uuid for update;
  if e.id is null then raise exception 'Event not found' using errcode='P0002';end if;
  if e.user_id<>auth.uid() and not for_others then raise exception 'You can only cancel your own events' using errcode='42501';end if;
  if input ? 'version' and e.version is distinct from (input->>'version')::integer then raise exception 'Changed by someone else. Refresh and try again' using errcode='40001';end if;
  if e.cancelled_at is null then
   update private.workspace_team_events set cancelled_at=now(),cancelled_by=auth.uid(),version=version+1,updated_at=now(),updated_by=auth.uid() where id=e.id returning * into e;
   if e.user_id<>auth.uid() then
    insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'team.event_cancelled') returning id into event_id;
    insert into private.workspace_notification_outbox(user_id,event_id) values(e.user_id,event_id) on conflict do nothing;
   end if;
  end if;
  result:=jsonb_build_object('id',e.id,'version',e.version,'cancelled',true);
 end if;
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $fn$;

revoke all on function private.workspace_team_events_anyone_edits(),private.workspace_team_events_read(date,date),private.workspace_team_events_action(jsonb)
 from public,anon,authenticated;
