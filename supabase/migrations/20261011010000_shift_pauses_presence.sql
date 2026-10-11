-- Clock in and out, with pauses and overtime (11 October 2026).
--
-- While clocked in, a team member can pause for Lunch, a Break or an Emergency, then go back to
-- work, and once their shift is done they can switch to Overtime. Admins and super admins decide
-- whether each kind of pause counts as paid time; unpaid pauses come off the hours everywhere
-- (the timesheet, the Productivity Tool and team performance). An Emergency tells managers
-- straight away. Clocking out ends any pause.
--
-- Access control also shows who is online (the app checks in every minute while open) and who
-- is clocked in, on a pause or on overtime.

create table if not exists private.workspace_pause_policy (
 singleton boolean primary key default true check(singleton),
 lunch_paid boolean not null default false,
 break_paid boolean not null default true,
 emergency_paid boolean not null default true,
 version integer not null default 1 check(version>0),
 updated_by uuid references public.workspace_profiles(user_id),
 updated_at timestamptz not null default now()
);
insert into private.workspace_pause_policy(singleton) values(true) on conflict do nothing;

create table if not exists private.workspace_shift_pauses (
 id uuid primary key default gen_random_uuid(),
 shift_id uuid not null references private.workspace_shifts(id) on delete cascade,
 user_id uuid not null references public.workspace_profiles(user_id),
 kind text not null check(kind in ('lunch','break','emergency')),
 note text not null default '' check(char_length(note)<=200),
 started_at timestamptz not null default now(),
 ended_at timestamptz,
 check(ended_at is null or ended_at>=started_at)
);
create unique index if not exists workspace_shift_pauses_open_idx on private.workspace_shift_pauses(shift_id) where ended_at is null;
create index if not exists workspace_shift_pauses_shift_idx on private.workspace_shift_pauses(shift_id,started_at);
alter table private.workspace_shifts add column if not exists overtime_from timestamptz;

do $$ declare t text; begin
 foreach t in array array['workspace_pause_policy','workspace_shift_pauses'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated',t);
 end loop;
end $$;
drop trigger if exists business_write_limit on private.workspace_shift_pauses;
create trigger business_write_limit before insert or update on private.workspace_shift_pauses for each row execute function private.workspace_enforce_write_limit();

-- Clocking out (or a shift closed for someone) ends the pause they were on.
create or replace function private.workspace_shift_pause_close() returns trigger language plpgsql security definer set search_path='' as $fn$
begin
 if new.clocked_out_at is not null and old.clocked_out_at is null then
  update private.workspace_shift_pauses set ended_at=greatest(started_at,new.clocked_out_at) where shift_id=new.id and ended_at is null;
 end if;
 return new;
end $fn$;
drop trigger if exists workspace_shift_pause_close on private.workspace_shifts;
create trigger workspace_shift_pause_close after update of clocked_out_at on private.workspace_shifts for each row execute function private.workspace_shift_pause_close();

-- Minutes of a shift's unpaid pauses (by today's rules), within the shift and an optional window.
create or replace function private.workspace_shift_unpaid_minutes(shift uuid, lower_at timestamptz default null, upper_at timestamptz default null) returns numeric
language sql stable security definer set search_path='' as $fn$
 select coalesce(sum(greatest(0,extract(epoch from
   least(coalesce(x.ended_at,s.clocked_out_at,now()),coalesce(s.clocked_out_at,now()),coalesce(upper_at,'infinity'::timestamptz))
   -greatest(x.started_at,s.clocked_in_at,coalesce(lower_at,'-infinity'::timestamptz))))/60),0)
 from private.workspace_shift_pauses x join private.workspace_shifts s on s.id=x.shift_id join private.workspace_pause_policy pol on pol.singleton
 where x.shift_id=shift and not (case x.kind when 'lunch' then pol.lunch_paid when 'break' then pol.break_paid else pol.emergency_paid end)
$fn$;

create or replace function private.workspace_pause_policy_json() returns jsonb language sql stable security definer set search_path='' as $fn$
 select jsonb_build_object('lunchPaid',p.lunch_paid,'breakPaid',p.break_paid,'emergencyPaid',p.emergency_paid,'version',p.version,'updatedAt',p.updated_at,
  'updatedBy',(select full_name from public.workspace_profiles where user_id=p.updated_by)) from private.workspace_pause_policy p where p.singleton
$fn$;

-- A shift as the app shows it: now with the pause it is on, its pauses, overtime and unpaid minutes.
create or replace function private.workspace_shift_json(s private.workspace_shifts) returns jsonb language sql stable security definer set search_path='' as $fn$
 select jsonb_build_object('id',s.id,'userId',s.user_id,'fullName',(select p.full_name from public.workspace_profiles p where p.user_id=s.user_id),'department',s.department,
  'clockedInAt',s.clocked_in_at,'clockedOutAt',s.clocked_out_at,'overtimeFrom',s.overtime_from,
  'pause',(select jsonb_build_object('kind',x.kind,'startedAt',x.started_at,'note',x.note) from private.workspace_shift_pauses x where x.shift_id=s.id and x.ended_at is null),
  'pauses',coalesce((select jsonb_agg(jsonb_build_object('kind',x.kind,'startedAt',x.started_at,'endedAt',x.ended_at) order by x.started_at) from private.workspace_shift_pauses x where x.shift_id=s.id),'[]'::jsonb),
  'unpaidMinutes',round(private.workspace_shift_unpaid_minutes(s.id))::int);
$fn$;

-- Pausing, going back to work, overtime, and the pay rules for pauses.
create or replace function private.workspace_pause_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare me uuid:=auth.uid();actor text:=private.workspace_actor_role();a text:=input->>'action';s private.workspace_shifts;open_pause private.workspace_shift_pauses;ev bigint;pol private.workspace_pause_policy;
begin
 if actor is null or actor='client' then raise exception 'Team access required' using errcode='42501';end if;
 if a='savePausePolicy' then
  perform private.workspace_json_keys(input,array['action','requestId','lunchPaid','breakPaid','emergencyPaid','version']);
  if actor not in ('admin','super_admin') then raise exception 'Management access required' using errcode='42501';end if;
  if jsonb_typeof(input->'lunchPaid')<>'boolean' or jsonb_typeof(input->'breakPaid')<>'boolean' or jsonb_typeof(input->'emergencyPaid')<>'boolean' then raise exception 'Choose paid or unpaid for each' using errcode='22023';end if;
  select * into pol from private.workspace_pause_policy where singleton for update;
  if pol.version is distinct from (input->>'version')::integer then raise exception 'Someone else changed these rules. Open them again.' using errcode='40001';end if;
  update private.workspace_pause_policy set lunch_paid=(input->>'lunchPaid')::boolean,break_paid=(input->>'breakPaid')::boolean,emergency_paid=(input->>'emergencyPaid')::boolean,
   version=version+1,updated_by=me,updated_at=now() where singleton;
  insert into public.workspace_activity(actor_id,event_type) values(me,'team.pause_rules_saved');
  return private.workspace_pause_policy_json();
 end if;
 if a not in ('startPause','endPause','startOvertime') then raise exception 'Unknown team action' using errcode='22023';end if;
 select * into s from private.workspace_shifts where user_id=me and clocked_out_at is null for update;
 if s.id is null then raise exception 'Clock in first' using errcode='22023';end if;
 select * into open_pause from private.workspace_shift_pauses where shift_id=s.id and ended_at is null;
 if a='startPause' then
  perform private.workspace_json_keys(input,array['action','requestId','kind','note']);
  if coalesce(input->>'kind','') not in ('lunch','break','emergency') then raise exception 'Choose lunch, a break or an emergency' using errcode='22023';end if;
  if char_length(coalesce(input->>'note',''))>200 then raise exception 'Keep the note to 200 characters' using errcode='22023';end if;
  -- Already on this pause (a second tap): nothing changes.
  if open_pause.id is not null and open_pause.kind=input->>'kind' then return private.workspace_shift_json(s);end if;
  if open_pause.id is not null then update private.workspace_shift_pauses set ended_at=now() where id=open_pause.id;end if;
  insert into private.workspace_shift_pauses(shift_id,user_id,kind,note) values(s.id,me,input->>'kind',trim(coalesce(input->>'note','')));
  if input->>'kind'='emergency' then
   insert into public.workspace_activity(actor_id,event_type) values(me,'team.emergency') returning id into ev;
   insert into private.workspace_notification_outbox(user_id,event_id)
    select p.user_id,ev from public.workspace_profiles p where p.status='active' and p.role in ('admin','super_admin') and p.user_id<>me
    on conflict do nothing;
  end if;
 elsif a='endPause' then
  perform private.workspace_json_keys(input,array['action','requestId']);
  if open_pause.id is not null then update private.workspace_shift_pauses set ended_at=now() where id=open_pause.id;end if;
 else
  perform private.workspace_json_keys(input,array['action','requestId']);
  if open_pause.id is not null then update private.workspace_shift_pauses set ended_at=now() where id=open_pause.id;end if;
  if s.overtime_from is null then update private.workspace_shifts set overtime_from=now() where id=s.id;end if;
 end if;
 return private.workspace_shift_json((select x from private.workspace_shifts x where x.id=s.id));
end $fn$;

revoke all on function private.workspace_shift_pause_close(),private.workspace_shift_unpaid_minutes(uuid,timestamptz,timestamptz),private.workspace_pause_policy_json(),
 private.workspace_pause_action(jsonb) from public,anon,authenticated;

do $$
declare
 fixes text[][] := array[
  -- The team actions send pauses, overtime and the pause rules here.
  ['private.workspace_teams_action(jsonb)',
   $q$ if input->>'action' in ('inviteEnquiry','resendEnquiry','markEnquiryEmail','startValuing','closeEnquiry') then return private.workspace_client_enquiry_action(input);end if;$q$,
   $q$ if input->>'action' in ('startPause','endPause','startOvertime','savePausePolicy') then return private.workspace_pause_action(input);end if;
 if input->>'action' in ('inviteEnquiry','resendEnquiry','markEnquiryEmail','startValuing','closeEnquiry') then return private.workspace_client_enquiry_action(input);end if;$q$,
   $q$private.workspace_pause_action(input)$q$],
  -- Everyone sees the pay rules with their own shift.
  ['private.workspace_shift_read(text,date,date)',
   $q$'responses',(select count(*) from private.workspace_response_rows(lower_at,upper_at) r where r.user_id=auth.uid()),$q$,
   $q$'responses',(select count(*) from private.workspace_response_rows(lower_at,upper_at) r where r.user_id=auth.uid()),
   'pausePolicy',private.workspace_pause_policy_json(),$q$,
   $q$'pausePolicy',private.workspace_pause_policy_json()$q$],
  -- Team performance hours leave out unpaid pauses.
  ['private.workspace_shift_read(text,date,date)',
   $q$sum(extract(epoch from least(coalesce(s.clocked_out_at,now()),upper_at)-greatest(s.clocked_in_at,lower_at))/60)$q$,
   $q$sum(extract(epoch from least(coalesce(s.clocked_out_at,now()),upper_at)-greatest(s.clocked_in_at,lower_at))/60-private.workspace_shift_unpaid_minutes(s.id,lower_at,upper_at))$q$,
   $q$private.workspace_shift_unpaid_minutes(s.id,lower_at,upper_at)$q$],
  -- The timesheet: paid minutes, and each shift's pauses and overtime.
  ['private.workspace_timesheet_read(date,date,uuid)',
   $q$extract(epoch from coalesce(h.clocked_out_at,now())-h.clocked_in_at)/60$q$,
   $q$(extract(epoch from coalesce(h.clocked_out_at,now())-h.clocked_in_at)/60-private.workspace_shift_unpaid_minutes(h.id))$q$,
   $q$-private.workspace_shift_unpaid_minutes(h.id))$q$],
  ['private.workspace_timesheet_read(date,date,uuid)',
   $q$'editNote',h.edit_note)$q$,
   $q$'editNote',h.edit_note,'overtimeFrom',h.overtime_from,'unpaidMinutes',round(private.workspace_shift_unpaid_minutes(h.id))::int,
          'pauses',coalesce((select jsonb_agg(jsonb_build_object('kind',x.kind,'startedAt',x.started_at,'endedAt',x.ended_at) order by x.started_at) from private.workspace_shift_pauses x where x.shift_id=h.id),'[]'::jsonb))$q$,
   $q$'overtimeFrom',h.overtime_from,'unpaidMinutes'$q$],
  -- The Productivity Tool: paid minutes, and overtime by person, week and month.
  ['private.workspace_productivity_read(date,date,uuid)',
   $q$extract(epoch from coalesce(h.clocked_out_at,now())-h.clocked_in_at)/60 as minutes$q$,
   $q$extract(epoch from coalesce(h.clocked_out_at,now())-h.clocked_in_at)/60-private.workspace_shift_unpaid_minutes(h.id) as minutes,
   coalesce(extract(epoch from coalesce(h.clocked_out_at,now())-h.overtime_from)/60,0) as overtime$q$,
   $q$coalesce(extract(epoch from coalesce(h.clocked_out_at,now())-h.overtime_from)/60,0) as overtime$q$],
  ['private.workspace_productivity_read(date,date,uuid)',
   $q$'minutes',(select coalesce(round(sum(h.minutes)),0)::int from hours h where h.user_id=f.user_id),$q$,
   $q$'minutes',(select coalesce(round(sum(h.minutes)),0)::int from hours h where h.user_id=f.user_id),
   'overtimeMinutes',(select coalesce(round(sum(h.overtime)),0)::int from hours h where h.user_id=f.user_id),$q$,
   $q$'overtimeMinutes',(select coalesce(round(sum(h.overtime))$q$],
  ['private.workspace_productivity_read(date,date,uuid)',
   $q$round(sum(h.minutes))::int minutes,$q$,
   $q$round(sum(h.minutes))::int minutes,round(sum(h.overtime))::int overtime,$q$,
   $q$round(sum(h.overtime))::int overtime,$q$],
  ['private.workspace_productivity_read(date,date,uuid)',
   $q$'minutes',w.minutes,$q$,
   $q$'minutes',w.minutes,'overtime',w.overtime,$q$,
   $q$'overtime',w.overtime,$q$],
  ['private.workspace_productivity_read(date,date,uuid)',
   $q$'minutes',m.minutes,$q$,
   $q$'minutes',m.minutes,'overtime',m.overtime,$q$,
   $q$'overtime',m.overtime,$q$],
  -- Access control: when each person was last in the app, and their shift right now.
  ['private.workspace_access_person(uuid)',
   $q$'closed',exists(select 1 from private.workspace_closed_accounts c where c.user_id=p.user_id))$q$,
   $q$'closed',exists(select 1 from private.workspace_closed_accounts c where c.user_id=p.user_id),
  'seenAt',(select x.seen_at from private.workspace_presence x where x.user_id=p.user_id),
  'shift',(select private.workspace_shift_json(s) from private.workspace_shifts s where s.user_id=p.user_id and s.clocked_out_at is null))$q$,
   $q$'seenAt',(select x.seen_at from private.workspace_presence x$q$]
 ];
 definition text;
begin
 for i in 1..array_length(fixes, 1) loop
  definition := pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in definition) = 0 then
   if position(fixes[i][2] in definition) = 0 then raise exception 'Patch anchor missing in % (%)', fixes[i][1], i; end if;
   execute replace(definition, fixes[i][2], fixes[i][3]);
  end if;
 end loop;
end $$;
