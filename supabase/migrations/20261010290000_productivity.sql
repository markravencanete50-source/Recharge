-- The Productivity Tool: clock in and clock out are locked.
--  * The team only clocks in and out; nobody can change their own hours.
--  * A super admin can change anyone's hours directly (correct a shift, add one someone forgot,
--    close one left open). The change applies at once and is kept on record.
--  * An admin's change waits as a request until a super admin approves it. Only then does it reach
--    the timesheet, the hours and the team's performance; a declined or withdrawn one never does.
--  * Every change keeps who asked, who decided, the hours before and after, and why.
--  * Hours per person by week and by month, for any period up to a year.

create table if not exists private.workspace_shift_changes (
 id uuid primary key default gen_random_uuid(),
 kind text not null check(kind in ('edit','add','close')),
 shift_id uuid references private.workspace_shifts(id),
 user_id uuid not null references public.workspace_profiles(user_id),
 department text not null check(department in ('guest_relations','client_relations','cleaning','ready','accounts','management')),
 clocked_in_at timestamptz not null,
 clocked_out_at timestamptz,
 before jsonb,
 note text not null check(length(btrim(note)) between 3 and 500),
 status text not null default 'pending' check(status in ('pending','approved','declined','withdrawn','direct')),
 requested_by uuid not null references public.workspace_profiles(user_id),
 requested_at timestamptz not null default now(),
 decided_by uuid references public.workspace_profiles(user_id),
 decided_at timestamptz,
 decision_note text not null default '' check(length(decision_note)<=500),
 check(clocked_out_at is null or clocked_out_at>clocked_in_at),
 check((status='pending')=(decided_at is null)),
 check(kind='add' or shift_id is not null)
);
-- One change waiting per shift at a time.
create unique index if not exists workspace_shift_changes_one_pending_idx on private.workspace_shift_changes(shift_id) where status='pending';
create index if not exists workspace_shift_changes_status_idx on private.workspace_shift_changes(status,requested_at);
create index if not exists workspace_shift_changes_user_idx on private.workspace_shift_changes(user_id,clocked_in_at);
create index if not exists workspace_shift_changes_requester_idx on private.workspace_shift_changes(requested_by);
create index if not exists workspace_shift_changes_decider_idx on private.workspace_shift_changes(decided_by);
alter table private.workspace_shift_changes enable row level security;
revoke all on private.workspace_shift_changes from public,anon,authenticated;
create or replace trigger business_write_limit before insert or update on private.workspace_shift_changes for each row execute function private.workspace_enforce_write_limit();

-- Who approved a shift's hours (the super admin), next to who asked for the change (edited_by).
alter table private.workspace_shifts add column if not exists approved_by uuid references public.workspace_profiles(user_id);
create index if not exists workspace_shifts_approved_by_idx on private.workspace_shifts(approved_by);

create or replace function private.workspace_shift_change_json(c private.workspace_shift_changes) returns jsonb language sql stable security definer set search_path='' as $fn$
 select jsonb_build_object('id',c.id,'kind',c.kind,'status',c.status,'shiftId',c.shift_id,'userId',c.user_id,
  'fullName',(select p.full_name from public.workspace_profiles p where p.user_id=c.user_id),
  'department',c.department,'clockedInAt',c.clocked_in_at,'clockedOutAt',c.clocked_out_at,'before',c.before,'note',c.note,
  'requestedBy',c.requested_by,'requestedByName',(select p.full_name from public.workspace_profiles p where p.user_id=c.requested_by),'requestedAt',c.requested_at,
  'decidedBy',c.decided_by,'decidedByName',(select p.full_name from public.workspace_profiles p where p.user_id=c.decided_by),'decidedAt',c.decided_at,'decisionNote',c.decision_note)
$fn$;

-- The rules every shift's hours keep, checked when a change is asked for and again when it applies.
create or replace function private.workspace_shift_change_check(who uuid,skip_shift uuid,starts timestamptz,ends timestamptz,dept text) returns void language plpgsql security definer set search_path='' as $fn$
begin
 if starts is null then raise exception 'Choose when the shift started' using errcode='22023';end if;
 if starts>now() or ends>now() or ends<=starts or (coalesce(ends,now())-starts)>interval '24 hours' then raise exception 'A shift starts and ends in the past and lasts at most 24 hours' using errcode='22023';end if;
 if dept is null or dept not in ('guest_relations','client_relations','cleaning','ready','accounts','management') then raise exception 'Choose a department' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(who::text,77));
 if exists(select 1 from private.workspace_shifts x where x.user_id=who and x.id is distinct from skip_shift
   and x.clocked_in_at<coalesce(ends,'infinity'::timestamptz) and coalesce(x.clocked_out_at,'infinity'::timestamptz)>starts) then
  raise exception 'That overlaps another shift for this person' using errcode='23505';end if;
end $fn$;

-- A change reaching the shift itself: approved by a super admin, or made by one.
create or replace function private.workspace_shift_change_apply(c private.workspace_shift_changes,approver uuid) returns private.workspace_shifts language plpgsql security definer set search_path='' as $fn$
declare s private.workspace_shifts;ends timestamptz;
begin
 if c.kind='add' then
  perform private.workspace_shift_change_check(c.user_id,null,c.clocked_in_at,c.clocked_out_at,c.department);
  insert into private.workspace_shifts(user_id,department,clocked_in_at,clocked_out_at,request_id,edited_by,edited_at,edit_note,approved_by)
   values(c.user_id,c.department,c.clocked_in_at,c.clocked_out_at,c.id,c.requested_by,now(),c.note,approver) returning * into s;
  return s;
 end if;
 select * into s from private.workspace_shifts x where x.id=c.shift_id for update;
 if s.id is null then raise exception 'That shift no longer exists' using errcode='P0002';end if;
 -- Someone who clocked out while the change waited keeps their own clock-out, unless the change sets one.
 ends:=coalesce(c.clocked_out_at,s.clocked_out_at);
 perform private.workspace_shift_change_check(s.user_id,s.id,c.clocked_in_at,ends,c.department);
 update private.workspace_shifts set clocked_in_at=c.clocked_in_at,clocked_out_at=ends,department=c.department,
  edited_by=c.requested_by,edited_at=now(),edit_note=c.note,approved_by=approver,closed_by=case when c.kind='close' then c.requested_by else closed_by end
  where id=s.id returning * into s;
 return s;
end $fn$;

create or replace function private.workspace_shift_change_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();a text:=input->>'action';req uuid;prior private.workspace_action_receipts;result jsonb;
 s private.workspace_shifts;c private.workspace_shift_changes;who uuid;starts timestamptz;ends timestamptz;dept text;change_kind text;why text;event_id bigint;
begin
 if a in ('editShift','addShift','closeShift','withdrawShiftChange') then
  if actor is null or actor not in ('admin','super_admin') then
   raise exception '%',case when a='closeShift' then 'Management access required' else 'Only admins correct timesheets' end using errcode='42501';end if;
 elsif a='decideShiftChange' then
  if actor is distinct from 'super_admin' then raise exception 'Only a super admin approves timesheet changes' using errcode='42501';end if;
 else raise exception 'Unknown team action' using errcode='22023';end if;
 req:=(input->>'requestId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 prior:=(select x from private.workspace_action_receipts x where x.actor_id=auth.uid() and x.request_id=req);
 if prior.actor_id is not null then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;

 if a in ('editShift','addShift','closeShift') then
  if a='editShift' then
   perform private.workspace_json_keys(input,array['action','requestId','shiftId','clockedInAt','clockedOutAt','department','note']);
   select * into s from private.workspace_shifts x where x.id=(input->>'shiftId')::uuid for update;
   if s.id is null then raise exception 'Shift not found' using errcode='P0002';end if;
   who:=s.user_id;change_kind:='edit';starts:=(input->>'clockedInAt')::timestamptz;ends:=(input->>'clockedOutAt')::timestamptz;dept:=coalesce(input->>'department',s.department);
   -- Only a shift that is still running may stay open.
   if ends is null and s.clocked_out_at is not null then raise exception 'Choose when the shift ended' using errcode='22023';end if;
  elsif a='addShift' then
   perform private.workspace_json_keys(input,array['action','requestId','userId','clockedInAt','clockedOutAt','department','note']);
   who:=(input->>'userId')::uuid;change_kind:='add';starts:=(input->>'clockedInAt')::timestamptz;ends:=(input->>'clockedOutAt')::timestamptz;dept:=input->>'department';
   if who is null or not exists(select 1 from public.workspace_profiles p where p.user_id=who and p.role<>'client') then raise exception 'Choose someone on the team' using errcode='22023';end if;
   if ends is null then raise exception 'Choose when the shift ended' using errcode='22023';end if;
  else
   -- For someone who forgot to clock out: when they actually stopped.
   perform private.workspace_json_keys(input,array['action','requestId','shiftId','endedAt','note']);
   select * into s from private.workspace_shifts x where x.id=(input->>'shiftId')::uuid for update;
   if s.id is null or s.clocked_out_at is not null then raise exception 'That shift has already ended' using errcode='P0002';end if;
   who:=s.user_id;change_kind:='close';starts:=s.clocked_in_at;ends:=least(now(),(input->>'endedAt')::timestamptz);dept:=s.department;
   if ends is null then raise exception 'Choose when the shift ended' using errcode='22023';end if;
  end if;
  why:=case when a='closeShift' and not (input ? 'note') then 'Forgot to clock out' else private.workspace_required_text(input,'note',3,500) end;
  perform private.workspace_shift_change_check(who,s.id,starts,ends,dept);
  insert into private.workspace_shift_changes(kind,shift_id,user_id,department,clocked_in_at,clocked_out_at,before,note,status,requested_by,decided_by,decided_at)
   values(change_kind,s.id,who,dept,starts,ends,
    case when s.id is not null then jsonb_build_object('clockedInAt',s.clocked_in_at,'clockedOutAt',s.clocked_out_at,'department',s.department) end,
    why,case when actor='super_admin' then 'direct' else 'pending' end,auth.uid(),
    case when actor='super_admin' then auth.uid() end,case when actor='super_admin' then now() end)
   on conflict (shift_id) where status='pending' do nothing returning * into c;
  if c.id is null then raise exception 'A change to this shift is already waiting for approval' using errcode='23505';end if;
  if actor='super_admin' then
   s:=private.workspace_shift_change_apply(c,auth.uid());
   update private.workspace_shift_changes set shift_id=s.id where id=c.id;
   result:=private.workspace_shift_json(s)||jsonb_build_object('editNote',s.edit_note,'status','direct','changeId',c.id);
   insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'team.shift_corrected') returning id into event_id;
   insert into private.workspace_notification_outbox(user_id,event_id) select who,event_id where who is distinct from auth.uid() on conflict do nothing;
  else
   result:=private.workspace_shift_change_json(c);
   insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'team.shift_change_requested') returning id into event_id;
   insert into private.workspace_notification_outbox(user_id,event_id)
    select p.user_id,event_id from public.workspace_profiles p where p.role='super_admin' and p.status='active' and p.user_id<>auth.uid() on conflict do nothing;
  end if;

 elsif a='decideShiftChange' then
  perform private.workspace_json_keys(input,array['action','requestId','changeId','decision','note']);
  select * into c from private.workspace_shift_changes x where x.id=(input->>'changeId')::uuid for update;
  if c.id is null then raise exception 'Change not found' using errcode='P0002';end if;
  if c.status<>'pending' then raise exception 'This change has already been decided' using errcode='22023';end if;
  if input ? 'note' and (jsonb_typeof(input->'note')<>'string' or length(input->>'note')>500) then raise exception 'The note is too long' using errcode='22023';end if;
  if input->>'decision'='approve' then
   s:=private.workspace_shift_change_apply(c,auth.uid());
   update private.workspace_shift_changes set status='approved',shift_id=s.id,decided_by=auth.uid(),decided_at=now(),decision_note=coalesce(btrim(input->>'note'),'') where id=c.id returning * into c;
   insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'team.shift_change_approved') returning id into event_id;
   insert into private.workspace_notification_outbox(user_id,event_id) select c.requested_by,event_id where c.requested_by<>auth.uid() on conflict do nothing;
   insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'team.shift_corrected') returning id into event_id;
   insert into private.workspace_notification_outbox(user_id,event_id) select c.user_id,event_id where c.user_id<>auth.uid() on conflict do nothing;
  elsif input->>'decision'='decline' then
   update private.workspace_shift_changes set status='declined',decided_by=auth.uid(),decided_at=now(),decision_note=private.workspace_required_text(input,'note',3,500) where id=c.id returning * into c;
   insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'team.shift_change_declined') returning id into event_id;
   insert into private.workspace_notification_outbox(user_id,event_id) select c.requested_by,event_id where c.requested_by<>auth.uid() on conflict do nothing;
  else raise exception 'Choose approve or decline' using errcode='22023';end if;
  result:=private.workspace_shift_change_json(c);

 else
  perform private.workspace_json_keys(input,array['action','requestId','changeId']);
  select * into c from private.workspace_shift_changes x where x.id=(input->>'changeId')::uuid for update;
  if c.id is null then raise exception 'Change not found' using errcode='P0002';end if;
  if c.status<>'pending' then raise exception 'This change has already been decided' using errcode='22023';end if;
  if c.requested_by<>auth.uid() and actor<>'super_admin' then raise exception 'Only the admin who asked can withdraw it' using errcode='42501';end if;
  update private.workspace_shift_changes set status='withdrawn',decided_by=auth.uid(),decided_at=now() where id=c.id returning * into c;
  result:=private.workspace_shift_change_json(c);
 end if;
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $fn$;

-- The rota plan action keeps only the rota; shift hours change through the action above.
create or replace function private.workspace_rota_plan_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();a text:=input->>'action';req uuid;prior private.workspace_action_receipts;result jsonb;
 who uuid;entry jsonb;on_day date;event_id bigint;changed integer:=0;dept text;
begin
 if actor is null or actor not in ('admin','super_admin') then raise exception 'Only admins plan the rota' using errcode='42501';end if;
 if a<>'planRota' then raise exception 'Unknown team action' using errcode='22023';end if;
 req:=(input->>'requestId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 prior:=(select x from private.workspace_action_receipts x where x.actor_id=auth.uid() and x.request_id=req);
 if prior.actor_id is not null then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;
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
 insert into private.workspace_notification_outbox(user_id,event_id) select who,event_id where who is distinct from auth.uid() on conflict do nothing;
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $fn$;

-- Hours per person for a period (up to a year), by week (from Monday) and by month. A shift counts
-- on the day it started, in UK time; one still running counts up to now. Admins see everyone on
-- the team; anyone else sees only their own.
create or replace function private.workspace_productivity_read(start_on date,end_on date,target_user uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();admin boolean;lower_at timestamptz;upper_at timestamptz;people jsonb;
begin
 if actor is null or actor='client' then raise exception 'Team access required' using errcode='42501';end if;
 if start_on is null or end_on is null or end_on<start_on or end_on-start_on>366 then raise exception 'Choose up to a year' using errcode='22023';end if;
 admin:=actor in ('admin','super_admin');
 if not admin and target_user is not null and target_user<>auth.uid() then raise exception 'You can only see your own hours' using errcode='42501';end if;
 lower_at:=start_on::timestamp at time zone 'Europe/London';upper_at:=(end_on+1)::timestamp at time zone 'Europe/London';
 with hours as (
  select h.user_id,(h.clocked_in_at at time zone 'Europe/London')::date as day,extract(epoch from coalesce(h.clocked_out_at,now())-h.clocked_in_at)/60 as minutes
  from private.workspace_shifts h where h.clocked_in_at>=lower_at and h.clocked_in_at<upper_at and (admin or h.user_id=auth.uid()) and (target_user is null or h.user_id=target_user)
 ), folks as (
  select p.user_id,p.full_name,p.role,p.status,r.department from public.workspace_profiles p left join private.workspace_staff_rota r on r.user_id=p.user_id
  where p.role<>'client' and (admin or p.user_id=auth.uid()) and (target_user is null or p.user_id=target_user)
   and (p.status='active' or exists(select 1 from hours h where h.user_id=p.user_id))
 )
 select coalesce(jsonb_agg(jsonb_build_object('userId',f.user_id,'fullName',f.full_name,'role',f.role,'active',f.status='active','department',f.department,
   'onShift',exists(select 1 from private.workspace_shifts h where h.user_id=f.user_id and h.clocked_out_at is null),
   'minutes',(select coalesce(round(sum(h.minutes)),0)::int from hours h where h.user_id=f.user_id),
   'shifts',(select count(*)::int from hours h where h.user_id=f.user_id),
   'days',(select count(distinct h.day)::int from hours h where h.user_id=f.user_id),
   'weeks',(select coalesce(jsonb_agg(jsonb_build_object('start',w.k,'minutes',w.minutes,'shifts',w.shifts,'days',w.days) order by w.k),'[]') from (
     select date_trunc('week',h.day)::date k,round(sum(h.minutes))::int minutes,count(*)::int shifts,count(distinct h.day)::int days from hours h where h.user_id=f.user_id group by 1) w),
   'months',(select coalesce(jsonb_agg(jsonb_build_object('month',m.k,'minutes',m.minutes,'shifts',m.shifts,'days',m.days) order by m.k),'[]') from (
     select to_char(h.day,'YYYY-MM') k,round(sum(h.minutes))::int minutes,count(*)::int shifts,count(distinct h.day)::int days from hours h where h.user_id=f.user_id group by 1) m)
  ) order by f.full_name,f.user_id),'[]') into people from folks f;
 return jsonb_build_object('from',start_on,'to',end_on,'canEdit',admin,'canApprove',actor='super_admin',
  'pending',case when admin then (select count(*)::int from private.workspace_shift_changes c where c.status='pending') else 0 end,'people',people);
end $fn$;

-- Changes to hours: those waiting for a super admin, and the latest decided or made directly.
create or replace function private.workspace_shift_changes_read() returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();
begin
 if actor is null or actor not in ('admin','super_admin') then raise exception 'Management access required' using errcode='42501';end if;
 return jsonb_build_object('canApprove',actor='super_admin','me',auth.uid(),
  'pending',(select coalesce(jsonb_agg(private.workspace_shift_change_json(c) order by c.requested_at,c.id),'[]') from private.workspace_shift_changes c where c.status='pending'),
  'recent',(select coalesce(jsonb_agg(private.workspace_shift_change_json(c) order by c.decided_at desc,c.id),'[]') from (
    select * from private.workspace_shift_changes x where x.status<>'pending' order by x.decided_at desc,x.id limit 60) c));
end $fn$;

revoke all on function private.workspace_shift_change_json(private.workspace_shift_changes),private.workspace_shift_change_check(uuid,uuid,timestamptz,timestamptz,text),
 private.workspace_shift_change_apply(private.workspace_shift_changes,uuid),private.workspace_shift_change_action(jsonb),private.workspace_rota_plan_action(jsonb),
 private.workspace_productivity_read(date,date,uuid),private.workspace_shift_changes_read() from public,anon,authenticated;

-- Routes: shift hours change only through the change action (closing a shift left open included),
-- and the timesheet shows the changes waiting for approval.
do $$
declare
 fixes text[][] := array[
  ['private.workspace_teams_action(jsonb)',
   $q$ if input->>'action' in ('clockIn','clockOut','closeShift','saveTargets') then return private.workspace_shift_action(input);end if;$q$,
   $q$ if input->>'action' in ('editShift','addShift','closeShift','decideShiftChange','withdrawShiftChange') then return private.workspace_shift_change_action(input);end if;
 if input->>'action' in ('clockIn','clockOut','closeShift','saveTargets') then return private.workspace_shift_action(input);end if;$q$,
   $q$private.workspace_shift_change_action(input)$q$],
  ['private.workspace_teams_read(text,date,date,uuid,uuid)',
   $q$ elsif section='timesheet' then result:=private.workspace_timesheet_read(start_on,end_on,target_user);$q$,
   $q$ elsif section='timesheet' then result:=private.workspace_timesheet_read(start_on,end_on,target_user);
 elsif section='productivity' then result:=private.workspace_productivity_read(start_on,end_on,target_user);
 elsif section='shiftChanges' then result:=private.workspace_shift_changes_read();$q$,
   $q$private.workspace_productivity_read(start_on,end_on,target_user)$q$],
  ['private.workspace_timesheet_read(date,date,uuid)',
   $q$return jsonb_build_object('from',start_on,'to',end_on,'canEdit',admin,$q$,
   $q$return jsonb_build_object('from',start_on,'to',end_on,'canEdit',admin,'canApprove',actor='super_admin',
  'pending',case when admin then (select coalesce(jsonb_agg(private.workspace_shift_change_json(c) order by c.clocked_in_at,c.id),'[]') from private.workspace_shift_changes c
    where c.status='pending' and (target_user is null or c.user_id=target_user) and ((c.clocked_in_at>=lower_at and c.clocked_in_at<upper_at)
     or ((c.before->>'clockedInAt')::timestamptz>=lower_at and (c.before->>'clockedInAt')::timestamptz<upper_at))) else '[]'::jsonb end,$q$,
   $q$'canApprove',actor='super_admin'$q$]
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
