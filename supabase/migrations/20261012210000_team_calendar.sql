-- Team calendar (client ask A9):
--  * the guest's name on a stay in the calendar, for staff other than cleaners. Reservations carry no name, so it comes from the
--    guest conversation about that stay: matched on the platform booking code first, else on the same property and the same dates.
--    Owners and cleaners (and the cleaning manager) never receive it; an owner's own stay never has one.
--  * team events: your own absences, meetings, time away, training and so on. You add and cancel your own, admins anyone's.
--    The whole team (cleaners too) reads them for a window of up to 62 days; owners never do.
-- Routes follow the anchor-and-append rule: each patch keeps its anchor first, has its own sentinel, and raises when the anchor
-- is missing or repeated, so parallel migrations can patch the same functions in any order.

-- ---------------------------------------------------------------- assumptions, one function each
-- Who sees the guest's name in the calendar (client decision, to confirm): staff other than cleaners.
create or replace function private.workspace_guest_name_visible(actor_role text) returns boolean language sql immutable set search_path='' as $fn$
 select coalesce(actor_role in ('admin','super_admin','stays','ready','accounts'),false)
$fn$;
-- Longest team event, in days from the first day to the last, and how far a date may sit from today.
create or replace function private.workspace_team_event_max_days() returns integer language sql immutable set search_path='' as $fn$ select 365 $fn$;
create or replace function private.workspace_team_events_max_window() returns integer language sql immutable set search_path='' as $fn$ select 62 $fn$;

-- ---------------------------------------------------------------- guest name for a stay
-- The codes a stay can be known by in a conversation: the platform booking code, its tidy form (Hostaway's long "...-confirmation-CODE"
-- reference) and the stay's own reference, in capitals.
create or replace function private.workspace_stay_codes(channel_reference text,reference text) returns text[] language sql immutable set search_path='' as $fn$
 select coalesce(array_agg(distinct upper(btrim(c))),'{}') from unnest(array[channel_reference,regexp_replace(channel_reference,'^.*-confirmation-(.+)$','\1'),reference]) c where c is not null and btrim(c)<>''
$fn$;

create index if not exists workspace_guest_threads_resref_idx on private.workspace_guest_threads(upper(reservation_ref)) where reservation_ref is not null;
create index if not exists workspace_guest_threads_dates_idx on private.workspace_guest_threads(property_id,check_in,check_out) where guest_name is not null;

create or replace function private.workspace_stay_guest_name(reservation uuid) returns text language plpgsql stable security definer set search_path='' as $fn$
declare r private.workspace_reservations;codes text[];guest text;
begin
 select * into r from private.workspace_reservations x where x.id=reservation;
 if r.id is null or private.workspace_is_owner_stay(r) then return null;end if;
 codes:=private.workspace_stay_codes(r.channel_reference,r.reference);
 -- 1. the conversation that carries this stay's booking code (on this property, or not yet placed on one)
 if cardinality(codes)>0 then
  select t.guest_name into guest from private.workspace_guest_threads t
   where t.guest_name is not null and t.reservation_ref is not null and upper(t.reservation_ref)=any(codes) and (t.property_id is null or t.property_id=r.property_id)
   order by (t.property_id is not null) desc,t.last_message_at desc nulls last,t.created_at desc limit 1;
 end if;
 -- 2. else the conversation for the same property and dates, unless it belongs to another confirmed stay's booking code
 if guest is null then
  select t.guest_name into guest from private.workspace_guest_threads t
   where t.guest_name is not null and t.property_id=r.property_id and t.check_in=r.check_in and t.check_out=r.check_out
    and (t.reservation_ref is null or not exists(select 1 from private.workspace_reservations o where o.property_id=r.property_id and o.id<>r.id and o.status='confirmed'
      and upper(t.reservation_ref)=any(private.workspace_stay_codes(o.channel_reference,o.reference))))
   order by t.last_message_at desc nulls last,t.created_at desc limit 1;
 end if;
 return guest;
end $fn$;

-- ---------------------------------------------------------------- team events
create table if not exists private.workspace_team_events (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.workspace_profiles(user_id),
 kind text not null check(kind in ('absence','meeting','away','training','other')),
 title text not null check(length(trim(title)) between 2 and 200),
 starts_on date not null,
 ends_on date not null,
 start_time time,
 end_time time,
 location text not null default '' check(length(location)<=200),
 created_by uuid not null references public.workspace_profiles(user_id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 cancelled_at timestamptz,
 cancelled_by uuid references public.workspace_profiles(user_id),
 version integer not null default 1 check(version>0),
 check(ends_on>=starts_on and ends_on-starts_on<=365),
 check(end_time is null or start_time is not null),
 check(end_time is null or ends_on>starts_on or end_time>start_time),
 check(cancelled_by is null or cancelled_at is not null)
);
create index if not exists workspace_team_events_user_idx on private.workspace_team_events(user_id,starts_on);
create index if not exists workspace_team_events_window_idx on private.workspace_team_events(starts_on,ends_on) where cancelled_at is null;
create index if not exists workspace_team_events_creator_idx on private.workspace_team_events(created_by);
create index if not exists workspace_team_events_canceller_idx on private.workspace_team_events(cancelled_by);
alter table private.workspace_team_events enable row level security;
revoke all on private.workspace_team_events from public,anon,authenticated;
create or replace trigger business_write_limit before insert or update on private.workspace_team_events for each row execute function private.workspace_enforce_write_limit();

-- Read: every team role (cleaners too), never owners. Staff names and roles, so the client role is refused.
create or replace function private.workspace_team_events_read(start_on date,end_on date) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();
begin
 if actor is null or actor='client' then raise exception 'Team access required' using errcode='42501';end if;
 if start_on is null or end_on is null or end_on<start_on or end_on-start_on>private.workspace_team_events_max_window() then raise exception 'Choose up to 62 days' using errcode='22023';end if;
 return jsonb_build_object('from',start_on,'to',end_on,'canEditAll',actor in ('admin','super_admin'),
  'events',(select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'userId',x.user_id,'fullName',x.full_name,'role',x.role,'kind',x.kind,'title',x.title,
     'startsOn',x.starts_on,'endsOn',x.ends_on,'startTime',to_char(x.start_time,'HH24:MI'),'endTime',to_char(x.end_time,'HH24:MI'),'location',x.location,
     'mine',x.user_id=auth.uid(),'version',x.version) order by x.starts_on,x.start_time nulls first,x.full_name,x.id),'[]')
   from (select e.*,p.full_name,p.role from private.workspace_team_events e join public.workspace_profiles p on p.user_id=e.user_id
     where e.cancelled_at is null and e.starts_on<=end_on and e.ends_on>=start_on and p.status='active' and p.role<>'client'
     order by e.starts_on,e.id limit 500) x));
end $fn$;

-- Actions: saveTeamEvent {id?, version?, userId?, kind, title, startsOn, endsOn, startTime?, endTime?, location?} and cancelTeamEvent {id, version?}.
-- Your own events; admins and super admins can add one for anyone (userId) and change or cancel anyone's.
create or replace function private.workspace_team_events_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();a text:=input->>'action';req uuid;prior private.workspace_action_receipts;result jsonb;e private.workspace_team_events;
 is_admin boolean;target uuid;sd date;ed date;st time;et time;loc text;event_id bigint;
begin
 if actor is null or actor='client' then raise exception 'Team access required' using errcode='42501';end if;
 if a is null or a not in ('saveTeamEvent','cancelTeamEvent') then raise exception 'Unknown team action' using errcode='22023';end if;
 is_admin:=actor in ('admin','super_admin');
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
   if e.user_id<>auth.uid() and not is_admin then raise exception 'You can only change your own events' using errcode='42501';end if;
   if e.cancelled_at is not null then raise exception 'This event was cancelled' using errcode='22023';end if;
   if input ? 'userId' and (input->>'userId')::uuid is distinct from e.user_id then raise exception 'An event stays with the person it is for' using errcode='22023';end if;
   if input ? 'version' and e.version is distinct from (input->>'version')::integer then raise exception 'Changed by someone else. Refresh and try again' using errcode='40001';end if;
   update private.workspace_team_events set kind=input->>'kind',title=btrim(input->>'title'),starts_on=sd,ends_on=ed,start_time=st,end_time=et,location=loc,
    version=version+1,updated_at=now() where id=e.id returning * into e;
  else
   target:=coalesce((input->>'userId')::uuid,auth.uid());
   if target<>auth.uid() and not is_admin then raise exception 'You can only add your own events' using errcode='42501';end if;
   if not private.workspace_team_member(target) then raise exception 'Choose someone on the team' using errcode='22023';end if;
   insert into private.workspace_team_events(user_id,kind,title,starts_on,ends_on,start_time,end_time,location,created_by)
    values(target,input->>'kind',btrim(input->>'title'),sd,ed,st,et,loc,auth.uid()) returning * into e;
  end if;
  result:=jsonb_build_object('id',e.id,'version',e.version,'userId',e.user_id);
  -- Someone else's calendar changed by an admin: tell them. Your own changes need no notice.
  if e.user_id<>auth.uid() then
   insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'team.event_set') returning id into event_id;
   insert into private.workspace_notification_outbox(user_id,event_id) values(e.user_id,event_id) on conflict do nothing;
  end if;
 else
  perform private.workspace_json_keys(input,array['action','requestId','id','version']);
  select * into e from private.workspace_team_events x where x.id=(input->>'id')::uuid for update;
  if e.id is null then raise exception 'Event not found' using errcode='P0002';end if;
  if e.user_id<>auth.uid() and not is_admin then raise exception 'You can only cancel your own events' using errcode='42501';end if;
  if input ? 'version' and e.version is distinct from (input->>'version')::integer then raise exception 'Changed by someone else. Refresh and try again' using errcode='40001';end if;
  if e.cancelled_at is null then
   update private.workspace_team_events set cancelled_at=now(),cancelled_by=auth.uid(),version=version+1,updated_at=now() where id=e.id returning * into e;
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

revoke all on function private.workspace_guest_name_visible(text),private.workspace_team_event_max_days(),private.workspace_team_events_max_window(),
 private.workspace_stay_codes(text,text),private.workspace_stay_guest_name(uuid),private.workspace_team_events_read(date,date),
 private.workspace_team_events_action(jsonb) from public,anon,authenticated;

-- ---------------------------------------------------------------- routes and the schedule's guest name (anchor and append)
do $patch$
declare
 fixes text[][]:=array[
  -- the schedule's stays gain guestName for staff other than cleaners; the anchor stays first
  ['private.workspace_teams_read(text,date,date,uuid,uuid)',
   $q$'checkIn',r.check_in,'checkOut',r.check_out,'guests',r.guests,$q$,
   $q$'checkIn',r.check_in,'checkOut',r.check_out,'guests',r.guests,'guestName',case when private.workspace_guest_name_visible(actor) then private.workspace_stay_guest_name(r.id) end,$q$,
   $q$'guestName',case when private.workspace_guest_name_visible(actor)$q$],
  ['private.workspace_teams_read(text,date,date,uuid,uuid)',
   $q$elsif section='hub' then result:=private.workspace_hub_read();$q$,
   $q$elsif section='hub' then result:=private.workspace_hub_read();
 elsif section='teamEvents' then result:=private.workspace_team_events_read(start_on,end_on);$q$,
   $q$section='teamEvents' then result:=private.workspace_team_events_read(start_on,end_on)$q$],
  ['private.workspace_teams_action(jsonb)',
   $q$if a in ('saveHubItem','moveHubItem') then return private.workspace_hub_action(input);end if;$q$,
   $q$if a in ('saveHubItem','moveHubItem') then return private.workspace_hub_action(input);end if;
 if a in ('saveTeamEvent','cancelTeamEvent') then return private.workspace_team_events_action(input);end if;$q$,
   $q$if a in ('saveTeamEvent','cancelTeamEvent') then return private.workspace_team_events_action(input);end if;$q$]
 ];
 definition text;hits integer;
begin
 for i in 1..array_length(fixes,1) loop
  definition:=pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in definition)=0 then
   hits:=(length(definition)-length(replace(definition,fixes[i][2],'')))/length(fixes[i][2]);
   if hits<>1 then raise exception 'Patch anchor found % times in % (patch %)',hits,fixes[i][1],i;end if;
   execute replace(definition,fixes[i][2],fixes[i][3]);
  end if;
 end loop;
end $patch$;
