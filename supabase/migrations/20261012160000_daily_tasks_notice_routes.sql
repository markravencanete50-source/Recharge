-- Daily department to-dos (S3, ask A6) and notices for the next team (S3, ask B8).
--
-- Part A. Daily to-dos.
-- 1. private.workspace_daily_task_templates: what a department does on given days of the week (ISO
--    weekdays, 1 is Monday and 7 is Sunday). Admins keep the list; none are seeded. Removing a
--    template keeps its row (removed_at) so the to-dos it already made keep their link.
-- 2. Hub to-dos gain template_id. One to-do per template per day (unique index), so making a day's
--    to-dos again changes nothing.
-- 3. private.workspace_ensure_daily_todos(on_day): one open department to-do, due that day, for each
--    active template whose weekdays include the day. created_by is NOT NULL on hub items and no
--    automatic hub item existed before this, so a made to-do is created by the earliest active admin
--    (super_admin or admin, oldest profile first), or by the template's author when no admin is
--    active. When anything is made, the departments concerned get one notice (todo.daily_created).
--    "Today" is the UK date (private.workspace_daily_todo_zone()).
-- 4. Routes through workspace_teams_action: ensureDailyTodos {day?} (any team role, today only, one
--    write against the per-person limit), saveDailyTask {id?, department, title, details, weekdays,
--    active} and removeDailyTask {id} (admins only). Read section dailyTasks (admins only). A
--    service-role-only wrapper public.workspace_ensure_daily_todos() is for the backend's daily run.
--    The hub view also returns templateId.
--
-- Part B. Notice routes.
-- 5. private.workspace_notice_routes(event_type, role): which team hears about a ticked-off step. Seeded
--    only with events the database really writes with a work item (purchase, licensing, cleaning,
--    repair and direct-booking steps). There is no editor for it yet.
-- 6. An AFTER INSERT trigger on public.workspace_activity (only when work_id is set): for a routed
--    event, every active admin and every active person of a routed role assigned to the work item's
--    property gets an outbox row. Never the actor, never an owner, never a cleaner. The outbox's own
--    unique (user_id, event_id) is the dedupe key and every insert is "on conflict do nothing", so
--    the actions' own notices for the same event never collide with these. The trigger uses index
--    lookups only and swallows every error, so an activity insert can never fail because of it.
--
-- The client (owner) role is refused every new read and action. Safe to run more than once: tables,
-- columns, indexes, constraints and triggers are guarded, seeds use "on conflict do nothing", and each
-- patch of an existing function is skipped once its sentinel is present. Each anchor must occur once.

-- 1. Templates.
create table if not exists private.workspace_daily_task_templates (
 id uuid primary key default gen_random_uuid(),
 department text not null check(department in ('guest_relations','client_relations','cleaning','ready','accounts','management')),
 title text not null check(length(trim(title)) between 2 and 200),
 details text not null default '' check(length(details)<=3000),
 weekdays smallint[] not null check(cardinality(weekdays) between 1 and 7 and array_position(weekdays,null) is null and weekdays<@array[1,2,3,4,5,6,7]::smallint[]),
 active boolean not null default true,
 created_by uuid not null references public.workspace_profiles(user_id),
 updated_by uuid references public.workspace_profiles(user_id),
 removed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 version integer not null default 1 check(version>0)
);
create index if not exists workspace_daily_task_templates_live_idx on private.workspace_daily_task_templates(department,id) where removed_at is null;
create index if not exists workspace_daily_task_templates_creator_idx on private.workspace_daily_task_templates(created_by);
create index if not exists workspace_daily_task_templates_updater_idx on private.workspace_daily_task_templates(updated_by);
alter table private.workspace_daily_task_templates enable row level security;
revoke all on private.workspace_daily_task_templates from public,anon,authenticated;
drop trigger if exists business_write_limit on private.workspace_daily_task_templates;
create trigger business_write_limit before insert or update on private.workspace_daily_task_templates for each row execute function private.workspace_enforce_write_limit();

-- 2. The link from a hub to-do to the template that made it.
alter table private.workspace_hub_items add column if not exists template_id uuid references private.workspace_daily_task_templates(id);
create unique index if not exists workspace_hub_items_template_day_idx on private.workspace_hub_items(template_id,due_on) where template_id is not null;
do $$ begin
 if not exists(select 1 from pg_constraint where conname='workspace_hub_items_template_todo' and conrelid='private.workspace_hub_items'::regclass) then
  alter table private.workspace_hub_items add constraint workspace_hub_items_template_todo check(template_id is null or (kind='todo' and due_on is not null and department is not null));
 end if;
end $$;

-- The assumptions, one function each: the clock "today" is read on, and the most templates one run makes.
create or replace function private.workspace_daily_todo_zone() returns text language sql immutable set search_path='' as $fn$ select 'Europe/London'::text $fn$;
create or replace function private.workspace_daily_todo_limit() returns integer language sql immutable set search_path='' as $fn$ select 200 $fn$;
create or replace function private.workspace_daily_todo_today() returns date language sql stable set search_path='' as $fn$
 select (now() at time zone private.workspace_daily_todo_zone())::date
$fn$;

-- 3. Make a day's to-dos.
create or replace function private.workspace_ensure_daily_todos(on_day date) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare creator uuid;due_count integer:=0;made integer:=0;departments text[];event_id bigint;
begin
 if on_day is null then raise exception 'Choose a day' using errcode='22023';end if;
 creator:=(select p.user_id from public.workspace_profiles p where p.status='active' and p.role in ('super_admin','admin') order by p.created_at,p.user_id limit 1);
 with due as (
   select t.id,t.department,t.title,t.details,t.created_by from private.workspace_daily_task_templates t
   where t.active and t.removed_at is null and extract(isodow from on_day)::smallint=any(t.weekdays)
   order by t.department,t.created_at,t.id limit private.workspace_daily_todo_limit()),
  made_rows as (
   insert into private.workspace_hub_items(kind,title,details,department,due_on,status,created_by,template_id)
   select 'todo',d.title,d.details,d.department,on_day,'open',coalesce(creator,d.created_by),d.id from due d
   on conflict (template_id,due_on) where template_id is not null do nothing
   returning department)
 select (select count(*) from due),(select count(*) from made_rows),(select array_agg(distinct m.department) from made_rows m) into due_count,made,departments;
 if made>0 then
  insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'todo.daily_created') returning id into event_id;
  insert into private.workspace_notification_outbox(user_id,event_id)
   select distinct r.user_id,event_id from private.workspace_staff_rota r join public.workspace_profiles p on p.user_id=r.user_id and p.status='active' and p.role<>'client'
   where r.department=any(departments) and r.user_id is distinct from auth.uid() on conflict do nothing;
 end if;
 return jsonb_build_object('day',on_day,'due',due_count,'created',made);
end $fn$;

create or replace function private.workspace_daily_task_view(t private.workspace_daily_task_templates) returns jsonb language sql stable security definer set search_path='' as $fn$
 select jsonb_build_object('id',t.id,'department',t.department,'title',t.title,'details',t.details,'weekdays',to_jsonb(t.weekdays),'active',t.active,
  'createdByName',(select p.full_name from public.workspace_profiles p where p.user_id=t.created_by),'createdAt',t.created_at,'updatedAt',t.updated_at,'version',t.version,
  'lastMadeOn',(select max(i.due_on) from private.workspace_hub_items i where i.template_id=t.id))
$fn$;

-- 4a. The admins' list of templates.
create or replace function private.workspace_daily_tasks_read() returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();
begin
 if actor is null or actor not in ('admin','super_admin') then raise exception 'Management access required' using errcode='42501';end if;
 return jsonb_build_object('section','dailyTasks','today',private.workspace_daily_todo_today(),
  'templates',(select coalesce(jsonb_agg(private.workspace_daily_task_view(t) order by t.department,lower(t.title),t.id),'[]'::jsonb)
   from private.workspace_daily_task_templates t where t.removed_at is null));
end $fn$;

-- 4b. The actions.
create or replace function private.workspace_daily_task_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();a text:=input->>'action';req uuid;prior private.workspace_action_receipts;result jsonb;
 t private.workspace_daily_task_templates;today date:=private.workspace_daily_todo_today();txt text;days smallint[];changes integer;
begin
 if actor is null or actor='client' then raise exception 'Team access required' using errcode='42501';end if;
 if a is null or a not in ('ensureDailyTodos','saveDailyTask','removeDailyTask') then raise exception 'Unknown daily task action' using errcode='22023';end if;
 if a<>'ensureDailyTodos' and actor not in ('admin','super_admin') then raise exception 'Management access required' using errcode='42501';end if;
 req:=(input->>'requestId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 prior:=(select r from private.workspace_action_receipts r where r.actor_id=auth.uid() and r.request_id=req);
 if prior.actor_id is not null then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;

 if a='ensureDailyTodos' then
  perform private.workspace_json_keys(input,array['action','requestId','day']);
  if input ? 'day' and input->'day'<>'null'::jsonb then
   if jsonb_typeof(input->'day')<>'string' or (input->>'day')!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Choose a valid date' using errcode='22023';end if;
   if (input->>'day')::date<>today then raise exception 'Daily to-dos are made for today only' using errcode='22023';end if;
  end if;
  -- The whole run is one change against the per-person limit; the to-dos it writes are not counted again.
  insert into private.workspace_write_limits(user_id,writes) values(auth.uid(),1)
   on conflict(user_id) do update set
    writes=case when workspace_write_limits.window_started_at<=now()-interval '1 minute' then 1 else workspace_write_limits.writes+1 end,
    window_started_at=case when workspace_write_limits.window_started_at<=now()-interval '1 minute' then now() else workspace_write_limits.window_started_at end
   returning writes into changes;
  if changes>60 then raise exception 'Too many changes. Wait a minute before trying again' using errcode='P0429';end if;
  perform set_config('recharge.bulk_write','on',true);
  result:=private.workspace_ensure_daily_todos(today);
  perform set_config('recharge.bulk_write','off',true);

 elsif a='saveDailyTask' then
  perform private.workspace_json_keys(input,array['action','requestId','id','department','title','details','weekdays','active']);
  if coalesce(input->>'department','') not in ('guest_relations','client_relations','cleaning','ready','accounts','management') then raise exception 'Choose a department' using errcode='22023';end if;
  txt:=private.workspace_required_text(input,'title',2,200);
  if input ? 'details' and (jsonb_typeof(input->'details')<>'string' or length(trim(input->>'details'))>3000) then raise exception 'The details are too long' using errcode='22023';end if;
  if jsonb_typeof(input->'weekdays') is distinct from 'array' or jsonb_array_length(input->'weekdays') not between 1 and 7
   or exists(select 1 from jsonb_array_elements(input->'weekdays') e where jsonb_typeof(e)<>'number' or e::text!~'^[1-7]$')
   or (select count(distinct e::text) from jsonb_array_elements(input->'weekdays') e)<>jsonb_array_length(input->'weekdays') then
   raise exception 'Choose the days of the week, each once' using errcode='22023';
  end if;
  days:=array(select distinct (e#>>'{}')::smallint d from jsonb_array_elements(input->'weekdays') e order by d);
  if jsonb_typeof(input->'active') is distinct from 'boolean' then raise exception 'Say whether the daily task is on' using errcode='22023';end if;
  if input ? 'id' and input->'id'<>'null'::jsonb then
   select * into t from private.workspace_daily_task_templates x where x.id=(input->>'id')::uuid and x.removed_at is null for update;
   if t.id is null then raise exception 'Daily task not found' using errcode='P0002';end if;
   update private.workspace_daily_task_templates set department=input->>'department',title=txt,details=coalesce(trim(input->>'details'),''),weekdays=days,
    active=(input->>'active')::boolean,updated_by=auth.uid(),updated_at=now(),version=version+1 where id=t.id returning * into t;
  else
   insert into private.workspace_daily_task_templates(department,title,details,weekdays,active,created_by)
    values(input->>'department',txt,coalesce(trim(input->>'details'),''),days,(input->>'active')::boolean,auth.uid()) returning * into t;
  end if;
  result:=private.workspace_daily_task_view(t);
  insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'hub.daily_task_saved');

 else
  perform private.workspace_json_keys(input,array['action','requestId','id']);
  if jsonb_typeof(input->'id') is distinct from 'string' then raise exception 'Choose the daily task' using errcode='22023';end if;
  select * into t from private.workspace_daily_task_templates x where x.id=(input->>'id')::uuid and x.removed_at is null for update;
  if t.id is null then raise exception 'Daily task not found' using errcode='P0002';end if;
  update private.workspace_daily_task_templates set active=false,removed_at=now(),updated_by=auth.uid(),updated_at=now(),version=version+1 where id=t.id returning * into t;
  result:=jsonb_build_object('id',t.id,'removed',true);
  insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'hub.daily_task_removed');
 end if;
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $fn$;

-- The backend's daily run (service role only): today's to-dos, by the UK date.
create or replace function public.workspace_ensure_daily_todos() returns jsonb language sql security invoker set search_path='' as $fn$
 select private.workspace_ensure_daily_todos(private.workspace_daily_todo_today());
$fn$;

revoke all on function private.workspace_daily_todo_zone(),private.workspace_daily_todo_limit(),private.workspace_daily_todo_today(),
 private.workspace_ensure_daily_todos(date),private.workspace_daily_task_view(private.workspace_daily_task_templates),
 private.workspace_daily_tasks_read(),private.workspace_daily_task_action(jsonb) from public,anon,authenticated;
revoke all on function public.workspace_ensure_daily_todos() from public,anon,authenticated;
grant execute on function private.workspace_daily_todo_zone(),private.workspace_daily_todo_limit(),private.workspace_daily_todo_today(),
 private.workspace_ensure_daily_todos(date),public.workspace_ensure_daily_todos() to service_role;

-- 5. Notice routes.
create table if not exists private.workspace_notice_routes (
 event_type text not null check(length(event_type) between 3 and 120 and event_type~'^[a-z_]+(\.[A-Za-z_]+)+$'),
 role text not null check(role in ('stays','cleaning_manager','ready','accounts')),
 created_at timestamptz not null default now(),
 primary key(event_type,role)
);
alter table private.workspace_notice_routes enable row level security;
revoke all on private.workspace_notice_routes from public,anon,authenticated;

-- Each event below is written to workspace_activity with its work item: the operations steps by
-- workspace_operations_action ('operations.'||action||'.'||step), cleaning.accepted and
-- cleaning.rejected by its reviewCleaning step, finance.purchase_invoice_recorded by
-- workspace_accounts_action. The role is the team that acts next, or that needs to know.
insert into private.workspace_notice_routes(event_type,role) values
 -- Purchases: approved and ordered go to Ready, who receive it; delivered and invoiced go to Accounts,
 -- who reconcile it; closed goes back to whoever asked (Stays and Ready).
 ('operations.updateOperation.approvePurchase','ready'),('operations.updateOperation.approvePurchase','stays'),
 ('operations.updateOperation.recordOrder','ready'),
 ('operations.updateOperation.recordDelivery','accounts'),
 ('finance.purchase_invoice_recorded','accounts'),
 ('operations.updateOperation.reconcilePurchase','ready'),('operations.updateOperation.reconcilePurchase','stays'),
 -- Licensing: an application goes to Ready for the safety checks; checks done go back to Stays; a
 -- granted licence goes to Stays and Accounts.
 ('operations.updateOperation.submitApplication','ready'),
 ('operations.updateOperation.recordSafetyChecks','stays'),
 ('operations.updateOperation.recordGranted','stays'),('operations.updateOperation.recordGranted','accounts'),
 -- Cleaning: a submitted clean goes to its reviewers; an accepted one to Stays (guest ready) and
 -- Accounts (the cleaner's invoice); a rejected one to the cleaning manager; a problem found on a
 -- clean to Stays and Ready.
 ('operations.updateOperation.submitCleaning','cleaning_manager'),('operations.updateOperation.submitCleaning','stays'),
 ('cleaning.accepted','stays'),('cleaning.accepted','accounts'),
 ('cleaning.rejected','cleaning_manager'),
 ('operations.updateOperation.reportCleanProblem','stays'),('operations.updateOperation.reportCleanProblem','ready'),
 -- Repairs: each decision goes to whoever moves it on next.
 ('operations.updateOperation.referReady','ready'),
 ('operations.updateOperation.approveBudget','stays'),('operations.updateOperation.approveBudget','ready'),
 ('operations.updateOperation.declineBudget','stays'),
 ('operations.updateOperation.approveManagement','stays'),('operations.updateOperation.approveManagement','ready'),
 ('operations.updateOperation.declineManagement','stays'),
 ('operations.updateOperation.reviseQuote','stays'),
 ('operations.updateOperation.bookRepair','stays'),
 ('operations.updateOperation.completeRepair','stays'),('operations.updateOperation.completeRepair','accounts'),
 ('operations.updateOperation.closeRepair','stays'),('operations.updateOperation.closeRepair','ready'),
 -- Direct bookings: an offer and a decline keep Stays in step; an accepted offer goes to Accounts (the
 -- booking invoice); a confirmed booking to Accounts and the cleaning manager (a new stay to clean for).
 ('operations.updateOperation.prepareQuote','stays'),
 ('operations.updateOperation.recordGuestDecline','stays'),
 ('operations.updateOperation.recordGuestAcceptance','accounts'),
 ('operations.updateOperation.confirmBooking','accounts'),('operations.updateOperation.confirmBooking','cleaning_manager')
on conflict do nothing;

-- Admins are found by role on every routed event.
create index if not exists workspace_profiles_active_role_idx on public.workspace_profiles(role) where status='active';

-- 6. The trigger. Only index lookups: the routes by event, the work item by id, the property's
-- assignments by property, profiles by id and active admins by role.
create or replace function private.workspace_notice_route_activity() returns trigger language plpgsql security definer set search_path='' as $fn$
declare prop uuid;
begin
 begin
  if new.work_id is null or not exists(select 1 from private.workspace_notice_routes r where r.event_type=new.event_type) then return null;end if;
  select w.property_id into prop from public.workspace_work_items w where w.id=new.work_id;
  insert into private.workspace_notification_outbox(user_id,work_id,event_id)
  select n.user_id,new.work_id,new.id from (
    select p.user_id from public.workspace_profiles p where p.status='active' and p.role in ('admin','super_admin')
    union
    select p.user_id from private.workspace_notice_routes r
     join public.workspace_property_assignments a on a.property_id=prop and a.assignment=case r.role when 'cleaning_manager' then 'cleaning_manager' else 'staff' end
     join public.workspace_profiles p on p.user_id=a.user_id and p.role=r.role and p.status='active'
     where r.event_type=new.event_type) n
  where n.user_id is distinct from new.actor_id and n.user_id is distinct from auth.uid()
  on conflict do nothing;
 exception when others then
  -- A notice is never worth losing the change it describes.
  raise warning 'Notice routes skipped for activity %: %',new.id,sqlerrm;
 end;
 return null;
end $fn$;
revoke all on function private.workspace_notice_route_activity() from public,anon,authenticated;
drop trigger if exists workspace_notice_routes on public.workspace_activity;
create trigger workspace_notice_routes after insert on public.workspace_activity for each row when (new.work_id is not null)
 execute function private.workspace_notice_route_activity();

-- 7. Patch the hub view and the teams routes from their latest definitions.
do $$
declare
 -- function, anchor (must occur exactly once), replacement, sentinel (present once patched)
 fixes constant text[][] := array[
  ['private.workspace_hub_view(private.workspace_hub_items)',
   $q$'clientId',item.client_id,$q$,
   $q$'clientId',item.client_id,'templateId',item.template_id,$q$,
   $q$'templateId',item.template_id$q$],
  ['private.workspace_teams_read(text,date,date,uuid,uuid)',
   $q$elsif section='hub' then result:=private.workspace_hub_read();$q$,
   $q$elsif section='hub' then result:=private.workspace_hub_read(); elsif section='dailyTasks' then result:=private.workspace_daily_tasks_read();$q$,
   $q$private.workspace_daily_tasks_read()$q$],
  ['private.workspace_teams_action(jsonb)',
   $q$if a in ('saveHubItem','moveHubItem') then return private.workspace_hub_action(input);end if;$q$,
   $q$if a in ('saveHubItem','moveHubItem') then return private.workspace_hub_action(input);end if; if a in ('ensureDailyTodos','saveDailyTask','removeDailyTask') then return private.workspace_daily_task_action(input);end if;$q$,
   $q$private.workspace_daily_task_action(input)$q$]
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
