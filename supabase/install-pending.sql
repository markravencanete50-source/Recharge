-- Rounds 6 to 8: the 7 migrations not yet installed, in filename order, in ONE transaction.
-- Paste the whole file into the Supabase SQL editor for project brixfalrrmzqoioggvfx and run it once.
-- If any statement fails, nothing is applied. Each migration is recorded in supabase_migrations.schema_migrations
-- under its filename version. Generated from supabase/migrations; do not edit by hand.
-- Running it a second time stops at the first line below and changes nothing.

begin;
set local lock_timeout='20s';
do $guard$ begin if exists(select 1 from supabase_migrations.schema_migrations where version like '20261016%' or version like '20261017%' or version like '20261018%') then raise exception 'Rounds 6 to 8 is already installed (or partly): stop and check'; end if; end $guard$;

-- ===== 20261016200000_todo_updates =====
-- Round 6, from Alex's video: each to-do keeps a log of updates (what, who, when).
--   * Anyone who can see the to-do can add an update (private.workspace_hub_can_see, the to-do's own rule).
--   * Owners never see staff to-dos: the hub read and this action refuse the client role.
--   * Ticking a to-do done logs "Marked done"; reopening it logs "Reopened".
--   * The hub view returns, for a to-do, the running total and the history newest first (up to 100).
-- Run-twice safe: the table and index are "if not exists", the functions are replaced, and each patch of a
-- shared function has a sentinel and a single-line anchor that must occur exactly once.

create table if not exists private.workspace_hub_item_updates (
 id bigint generated always as identity primary key,
 item_id uuid not null references private.workspace_hub_items(id) on delete cascade,
 body text not null check(length(trim(body)) between 1 and 2000),
 kind text not null default 'note' check(kind in ('note','done','reopened')),
 created_by uuid not null references public.workspace_profiles(user_id),
 created_at timestamptz not null default now()
);
create index if not exists workspace_hub_item_updates_item_idx on private.workspace_hub_item_updates(item_id,id desc);
create index if not exists workspace_hub_item_updates_creator_idx on private.workspace_hub_item_updates(created_by);
alter table private.workspace_hub_item_updates enable row level security;
revoke all on private.workspace_hub_item_updates from public,anon,authenticated;
drop trigger if exists business_write_limit on private.workspace_hub_item_updates;
create trigger business_write_limit before insert on private.workspace_hub_item_updates for each row execute function private.workspace_enforce_write_limit();

-- A to-do's updates, newest first, for the hub view.
create or replace function private.workspace_todo_updates_view(target uuid) returns jsonb language sql stable security definer set search_path='' as $fn$
 select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'text',u.body,'kind',u.kind,'byId',u.created_by,'byName',a.full_name,'at',u.created_at) order by u.id desc),'[]')
 from (select * from private.workspace_hub_item_updates x where x.item_id=target order by x.id desc limit 100) u
 left join public.workspace_profiles a on a.user_id=u.created_by
$fn$;

-- Add an update: { action: 'addTodoUpdate', requestId, id, text }. Returns the to-do's view with its history.
create or replace function private.workspace_todo_update_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();req uuid;prior private.workspace_action_receipts;result jsonb;item private.workspace_hub_items;txt text;event_id bigint;
begin
 if actor is null or actor='client' then raise exception 'Team access required' using errcode='42501';end if;
 if input->>'action' is distinct from 'addTodoUpdate' then raise exception 'Unknown to-do action' using errcode='22023';end if;
 perform private.workspace_json_keys(input,array['action','requestId','id','text']);
 req:=(input->>'requestId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 prior:=(select r from private.workspace_action_receipts r where r.actor_id=auth.uid() and r.request_id=req);
 if prior.actor_id is not null then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;
 select * into item from private.workspace_hub_items i where i.id=(input->>'id')::uuid for update;
 if item.id is null or item.kind<>'todo' or not private.workspace_hub_can_see(item) then raise exception 'To-do not found' using errcode='P0002';end if;
 txt:=private.workspace_required_text(input,'text',1,2000);
 insert into private.workspace_hub_item_updates(item_id,body,kind,created_by) values(item.id,txt,'note',auth.uid());
 update private.workspace_hub_items set updated_at=now() where id=item.id returning * into item;
 result:=private.workspace_hub_view(item);
 -- Whoever it is for, and whoever set it, hear about it (not the person writing).
 insert into public.workspace_activity(actor_id,property_id,event_type) values(auth.uid(),item.property_id,'hub.todo_updated') returning id into event_id;
 insert into private.workspace_notification_outbox(user_id,event_id) select distinct u,event_id from unnest(array[item.assignee_id,item.created_by]) u
  where u is not null and u is distinct from auth.uid() on conflict do nothing;
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $fn$;

revoke all on function private.workspace_todo_updates_view(uuid),private.workspace_todo_update_action(jsonb) from public,anon,authenticated;

do $$
declare
 -- function, anchor (single line, must occur exactly once), replacement, sentinel (present once patched)
 fixes constant text[][] := array[
  ['private.workspace_hub_view(private.workspace_hub_items)',
   $q$'templateId',item.template_id,$q$,
   $q$'templateId',item.template_id,'updateCount',case when item.kind='todo' then (select count(*) from private.workspace_hub_item_updates u where u.item_id=item.id) else 0 end,'updates',case when item.kind='todo' then private.workspace_todo_updates_view(item.id) else '[]'::jsonb end,$q$,
   $q$private.workspace_todo_updates_view(item.id)$q$],
  ['private.workspace_hub_action(jsonb)',
   $q$event:='hub.'||item.kind||'_'||st;$q$,
   $q$event:='hub.'||item.kind||'_'||st; if item.kind='todo' then insert into private.workspace_hub_item_updates(item_id,body,kind,created_by) values(item.id,case when st='done' then 'Marked done' else 'Reopened' end,case when st='done' then 'done' else 'reopened' end,auth.uid()); end if;$q$,
   $q$'Marked done'$q$],
  ['private.workspace_teams_action(jsonb)',
   $q$if a in ('saveHubItem','moveHubItem') then return private.workspace_hub_action(input);end if;$q$,
   $q$if a in ('saveHubItem','moveHubItem') then return private.workspace_hub_action(input);end if; if a='addTodoUpdate' then return private.workspace_todo_update_action(input);end if;$q$,
   $q$private.workspace_todo_update_action(input)$q$]
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

insert into supabase_migrations.schema_migrations(version,name) values ('20261016200000','todo_updates');

-- ===== 20261016210000_delete_client_enquiry =====
-- Round 6, Lee: "we should be able to delete client enquiries." A test entry, or a form sent by mistake.
--   * Admins and super admins only. Owners, staff and everyone else are refused.
--   * Only while nothing has happened beyond the enquiry: the property it made is still at the enquiry stage
--     (or archived by closing the enquiry), with no signed agreement, no owner, no invoice, and nothing else
--     pointing at the property or its onboarding item (stays, money, other work, to-dos, photos, flags...).
--     Otherwise: "This enquiry has moved on. Close it instead." Close is unchanged.
--   * Deletes the enquiry with its answers, the property made on submit, its onboarding journey and work item,
--     their activity and notices, and the onboarding team's access to it. The uploaded photos and videos are
--     queued in private.workspace_storage_removals; the site's server removes the stored copies straight away
--     and marks them removed (lib/client-enquiry-server.ts).
--   * The access history keeps a "client_enquiry.deleted" entry: who, when, and the enquiry's name and company
--     (no email, phone or address).
-- Run-twice safe: "if not exists", replaced functions, and a sentinel on the one route patch.

create table if not exists private.workspace_storage_removals (
 id bigint generated always as identity primary key,
 bucket text not null check(bucket in ('enquiry-files')),
 path text not null check(length(path) between 1 and 500),
 reason text not null check(length(reason) between 1 and 80),
 queued_by uuid references public.workspace_profiles(user_id),
 queued_at timestamptz not null default now(),
 removed_at timestamptz
);
create index if not exists workspace_storage_removals_pending_idx on private.workspace_storage_removals(bucket,path) where removed_at is null;
create index if not exists workspace_storage_removals_queued_by_idx on private.workspace_storage_removals(queued_by);
alter table private.workspace_storage_removals enable row level security;
revoke all on private.workspace_storage_removals from public,anon,authenticated;

-- What stops a delete: anything still pointing at the property or its onboarding item, other than what the
-- enquiry itself made. Read from the foreign keys, so a table added later counts too.
create or replace function private.workspace_enquiry_moved_on(prop uuid, task uuid) returns boolean language plpgsql stable security definer set search_path='' as $fn$
declare r record; found boolean;
begin
 for r in select c.conrelid, c.conrelid::regclass::text as tbl, a.attname, c.confrelid from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
  where c.contype='f' and c.confrelid in ('public.workspace_properties'::regclass,'public.workspace_work_items'::regclass) loop
  if r.confrelid='public.workspace_properties'::regclass then
   continue when r.conrelid in ('private.workspace_journeys'::regclass,'public.workspace_activity'::regclass,'private.workspace_client_enquiries'::regclass,
    'private.workspace_journey_questions'::regclass);
   if r.conrelid='public.workspace_work_items'::regclass then
    if exists(select 1 from public.workspace_work_items w where w.property_id=prop and w.id is distinct from task) then return true;end if;
    continue;
   end if;
   if r.conrelid='public.workspace_property_assignments'::regclass then
    if exists(select 1 from public.workspace_property_assignments x where x.property_id=prop and x.assignment<>'staff') then return true;end if;
    continue;
   end if;
   execute format('select exists(select 1 from %s where %I=$1)',r.tbl,r.attname) into found using prop;
  else
   continue when task is null or r.conrelid in ('private.workspace_journeys'::regclass,'public.workspace_activity'::regclass,'private.workspace_notification_outbox'::regclass,
    'public.workspace_work_updates'::regclass,'private.workspace_domain_details'::regclass,'private.workspace_upload_intents'::regclass);
   execute format('select exists(select 1 from %s where %I=$1)',r.tbl,r.attname) into found using task;
  end if;
  if found then return true;end if;
 end loop;
 return false;
end $fn$;

-- { action: 'deleteEnquiry', requestId, enquiryId, version }. Returns { deleted, enquiryId, paths }.
create or replace function private.workspace_client_enquiry_delete(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();req uuid;prior private.workspace_action_receipts;result jsonb;
 e private.workspace_client_enquiries;j private.workspace_journeys;prop uuid;task uuid;paths text[];events bigint[];
begin
 if actor is null or actor not in ('admin','super_admin') then raise exception 'Only management can delete an enquiry' using errcode='42501';end if;
 if input->>'action' is distinct from 'deleteEnquiry' then raise exception 'Unknown team action' using errcode='22023';end if;
 perform private.workspace_json_keys(input,array['action','requestId','enquiryId','version']);
 req:=(input->>'requestId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 prior:=(select x from private.workspace_action_receipts x where x.actor_id=auth.uid() and x.request_id=req);
 if prior.actor_id is not null then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;
 select * into e from private.workspace_client_enquiries x where x.id=(input->>'enquiryId')::uuid for update;
 if e.id is null then raise exception 'Enquiry not found' using errcode='P0002';end if;
 if e.version is distinct from (input->>'version')::int then raise exception 'Changed by someone else. Refresh and try again' using errcode='40001';end if;
 prop:=e.property_id;
 if prop is not null then
  select * into j from private.workspace_journeys x where x.property_id=prop for update;
  task:=j.work_id;
  if j.property_id is not null and (j.stage not in ('enquiry','archived') or j.client_id is not null or j.signed_at is not null or j.signed_name is not null or j.invoice_id is not null)
   or exists(select 1 from public.workspace_properties p where p.id=prop and p.status not in ('onboarding','archived'))
   or private.workspace_enquiry_moved_on(prop,task) then
   raise exception 'This enquiry has moved on. Close it instead.' using errcode='22023';
  end if;
 end if;

 -- The photos and videos: queued, and handed back for the server to remove now.
 paths:=array(select f->>'path' from jsonb_array_elements(e.files) f where coalesce(f->>'path','')<>'');
 insert into private.workspace_storage_removals(bucket,path,reason,queued_by) select 'enquiry-files',x,'client_enquiry.deleted',auth.uid() from unnest(paths) x;

 -- The access history keeps who deleted which enquiry, by name only.
 insert into public.workspace_access_events(user_id,actor_id,event_type,old_access,new_access)
  values(auth.uid(),auth.uid(),'client_enquiry.deleted',jsonb_strip_nulls(jsonb_build_object('enquiryId',e.id,
   'name',left(coalesce(nullif(btrim(e.answers->>'fullName'),''),e.recipient_name),200),'company',nullif(left(btrim(coalesce(e.answers->>'companyName','')),200),''),
   'status',e.status,'stage',j.stage,'propertyDeleted',prop is not null)),null);

 update private.workspace_client_enquiries set duplicate_of=null where duplicate_of=prop and prop is not null;
 delete from private.workspace_client_enquiries where id=e.id;
 if prop is not null then
  events:=array(select a.id from public.workspace_activity a where a.property_id=prop or (task is not null and a.work_id=task));
  delete from private.workspace_notification_deliveries d where d.outbox_id in (select o.id from private.workspace_notification_outbox o where o.event_id=any(events) or (task is not null and o.work_id=task));
  delete from private.workspace_notification_outbox o where o.event_id=any(events) or (task is not null and o.work_id=task);
  delete from public.workspace_activity a where a.id=any(events);
  delete from private.workspace_journey_questions q where q.property_id=prop;
  delete from private.workspace_journeys x where x.property_id=prop;
  if task is not null then
   delete from public.workspace_work_updates u where u.work_id=task;
   delete from private.workspace_domain_details d where d.work_id=task;
   delete from private.workspace_upload_intents u where u.work_id=task;
   delete from public.workspace_work_items w where w.id=task;
  end if;
  delete from public.workspace_property_assignments x where x.property_id=prop;
  -- Rows the property itself just wrote while the deletes ran.
  delete from public.workspace_activity a where a.property_id=prop;
  delete from public.workspace_properties p where p.id=prop;
 end if;

 result:=jsonb_build_object('deleted',true,'enquiryId',e.id,'propertyDeleted',prop is not null,'paths',to_jsonb(paths));
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $fn$;

-- The server, after removing the stored copies, marks what it removed (only what this person queued).
create or replace function private.workspace_storage_removed(bucket_name text, removed text[]) returns integer language plpgsql security definer set search_path='' as $fn$
declare n integer;
begin
 if private.workspace_actor_role() not in ('admin','super_admin') then raise exception 'Only management can do this' using errcode='42501';end if;
 if cardinality(removed)>100 then raise exception 'Too many files' using errcode='22023';end if;
 update private.workspace_storage_removals s set removed_at=now() where s.bucket=bucket_name and s.path=any(removed) and s.removed_at is null and s.queued_by=auth.uid();
 get diagnostics n=row_count;
 return n;
end $fn$;
create or replace function public.workspace_storage_removed(bucket_name text, removed text[]) returns integer language sql security invoker set search_path='' as $$select private.workspace_storage_removed(bucket_name,removed);$$;

revoke all on function private.workspace_enquiry_moved_on(uuid,uuid),private.workspace_client_enquiry_delete(jsonb) from public,anon,authenticated;
revoke all on function private.workspace_storage_removed(text,text[]),public.workspace_storage_removed(text,text[]) from public,anon;
grant execute on function private.workspace_storage_removed(text,text[]),public.workspace_storage_removed(text,text[]) to authenticated;

do $$
declare
 -- function, anchor (single line, must occur exactly once), replacement, sentinel (present once patched)
 fixes constant text[][] := array[
  ['private.workspace_teams_action(jsonb)',
   $q$if a in ('saveHubItem','moveHubItem') then return private.workspace_hub_action(input);end if;$q$,
   $q$if a in ('saveHubItem','moveHubItem') then return private.workspace_hub_action(input);end if; if a='deleteEnquiry' then return private.workspace_client_enquiry_delete(input);end if;$q$,
   $q$private.workspace_client_enquiry_delete(input)$q$]
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

insert into supabase_migrations.schema_migrations(version,name) values ('20261016210000','delete_client_enquiry');

-- ===== 20261016300000_notice_details =====
-- Updates feed, round 6 (Lee: "instead of saying new task for your team it should be specific what type of task"). The feed read
-- (workspace_controls_read('notifications'), behind the header bell) now returns, for each notice, what the app needs to say what it
-- is: the work item's title and kind (workspace_domain_details) and module, the property's name and address (from the notice, else
-- from its work item), and who did it. All in the same single query, by left joins, with no per-row lookups.
-- Who did it: for team roles, the person's name ("You" for yourself) or nobody (automatic: a sweep, a cron or a channel feed). For
-- owners it is never a staff name: "You" for their own action, otherwise "Recharge", and never "automatic". Which notices a person
-- gets is unchanged (their own outbox, the work and property checks already in the read).
-- Email and push: the two claim functions also return the work kind, so the subject can name the type of work. They still carry no
-- property, title or names (lib/notice-copy.ts: the details stay behind sign-in).
-- All three are patched by anchor and append: the anchor stays first, a sentinel stops a second run, a missing or repeated anchor
-- raises.
do $patch$
declare
 fixes text[][]:=array[
  ['private.workspace_controls_read(text,uuid,uuid)',
   $q$select a.id,a.event_type,a.property_id,a.work_id,a.created_at,o.read_at,$q$,
   $q$select a.id,a.event_type,a.property_id,a.work_id,a.created_at,o.read_at,
   w.title as work_title,dd.kind as work_kind,w.module_id as work_module,pr.name as property_name,pr.address as property_address,
   (a.actor_id is null and actor<>'client') as automatic,
   case when a.actor_id=auth.uid() then 'You' when actor='client' then 'Recharge' when a.actor_id is null then null else ap.full_name end as actor_name,$q$,
   $q$w.title as work_title,dd.kind as work_kind$q$],
  ['private.workspace_controls_read(text,uuid,uuid)',
   $q$from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id$q$,
   $q$from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id
   left join public.workspace_work_items w on w.id=a.work_id left join private.workspace_domain_details dd on dd.work_id=a.work_id
   left join public.workspace_properties pr on pr.id=coalesce(a.property_id,w.property_id) left join public.workspace_profiles ap on ap.user_id=a.actor_id$q$,
   $q$left join private.workspace_domain_details dd on dd.work_id=a.work_id$q$],
  ['private.integration_claim_notifications(boolean,boolean)',
   $q$'eventType',(select a.event_type from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.id=claimed.outbox_id)$q$,
   $q$'eventType',(select a.event_type from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.id=claimed.outbox_id),
   'workKind',(select dd.kind from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id join private.workspace_domain_details dd on dd.work_id=a.work_id where o.id=claimed.outbox_id)$q$,
   $q$'workKind',(select dd.kind$q$],
  ['private.integration_claim_web_push()',
   $q$'eventType',c.event_type$q$,
   $q$'eventType',c.event_type,'workKind',(select dd.kind from private.workspace_notification_outbox o2 join public.workspace_activity a2 on a2.id=o2.event_id join private.workspace_domain_details dd on dd.work_id=a2.work_id where o2.id=c.outbox_id)$q$,
   $q$'workKind',(select dd.kind$q$]
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

insert into supabase_migrations.schema_migrations(version,name) values ('20261016300000','notice_details');

-- ===== 20261016310000_management_bonus_combined =====
-- Management bonus, round 6 (Alex: "Managers bonus will be based off of how guest relations and client relations perform").
-- The KPI tracker (20261015100000) seeded the management bonus KPI on the manager's own performance score. From here a
-- new measure, teams_combined, measures the two teams together over the same period:
--   Guest relations   team-wide share of guest messages answered within the green minutes of
--                     private.workspace_performance_targets (5 on the live database), out of the waits settled for those
--                     minutes: every guest message, whoever was on shift (the same sums as the guest reply KPIs).
--   Client relations  team-wide daily work: the average daily-work percentage of the client relations team (the people
--                     whose KPI area is client_relations), as the team value of daily_work_done already works it out.
--   Combined          the average of the two, equal weight for now (Alex to confirm). When one team has nothing to measure
--                     the other is used alone; when neither has, there is no value ("Nothing to measure yet"). Rounded
--                     down, like every "higher is better" KPI.
-- The result also carries the two parts, so the bar can show "Guest relations 86% · Client relations 74%".
--
-- Who gets it: the figures are worked out only for admins and super admins, and for people whose KPI area is management
-- (their rota department). The KPI read already keeps a KPI's values to people in its area, and to admins; the measure
-- checks again itself, so nobody else (owners, cleaners, Ready, guest or client relations) gets a team figure through it.
-- The parts are team totals: no names and no per-person figures.
--
-- 1. private.workspace_kpi_measures() is replaced whole (only 20261015100000 defines it) with the new measure at the end;
--    it fits the management area only.
-- 2. private.workspace_kpi_teams_combined(start_on,end_on): the measure itself.
-- 3. Anchor-and-append patches (the anchor stays first, a sentinel stops a second run, a missing or repeated anchor
--    raises): a branch in private.workspace_kpi_person_value and in private.workspace_kpi_team_value, and
--    private.workspace_kpi_result passes the parts through.
-- 4. The seeded management bonus KPI ("Performance score", seed_key management_score) moves to the new measure and is
--    named "Guest relations and Client relations, combined", if it is still on the performance score. Its target, tiers
--    and placeholder flag stay as they are (80, 90, 95, placeholder, unless an admin has changed them). The change is
--    logged like any other. A second run finds it already moved and does nothing.

create or replace function private.workspace_kpi_measures() returns jsonb language sql immutable set search_path='' as $fn$
 select '[
  {"key":"guest_reply_within","label":"Guest messages answered within the minutes set","needsMinutes":true,"direction":"higher","areas":["guest_relations"]},
  {"key":"guest_reply_over","label":"Guest messages waiting longer than the minutes set","needsMinutes":true,"direction":"lower","areas":["guest_relations"]},
  {"key":"daily_work_done","label":"Daily work done against its targets","needsMinutes":false,"direction":"higher","areas":["guest_relations","client_relations"]},
  {"key":"performance_score","label":"Performance score","needsMinutes":false,"direction":"higher","areas":["guest_relations","client_relations","cleaning","ready","accounts","management"]},
  {"key":"clean_forms_on_time","label":"Cleaning forms in by 18:00 on the day","needsMinutes":false,"direction":"higher","areas":["cleaning"]},
  {"key":"teams_combined","label":"Guest relations and Client relations, combined","needsMinutes":false,"direction":"higher","areas":["management"]}
 ]'::jsonb;
$fn$;

create or replace function private.workspace_kpi_teams_combined(start_on date,end_on date) returns jsonb
language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();my_area text;t private.workspace_performance_targets;replies jsonb;guest jsonb;client jsonb;g integer;c integer;
begin
 my_area:=(select private.workspace_kpi_area(p.role,r.department) from public.workspace_profiles p left join private.workspace_staff_rota r on r.user_id=p.user_id where p.user_id=auth.uid());
 if actor is null or actor='client' or not coalesce(actor in ('admin','super_admin') or my_area='management',false) then return jsonb_build_object('value',null,'measured',0);end if;
 t:=(select x from private.workspace_performance_targets x where singleton);
 replies:=coalesce((select jsonb_agg(jsonb_build_object('m',x.minutes,'a',x.answered))
  from private.workspace_kpi_reply_rows(start_on::timestamp at time zone 'Europe/London',(end_on+1)::timestamp at time zone 'Europe/London') x),'[]'::jsonb);
 guest:=private.workspace_kpi_reply_value('guest_reply_within',t.green_minutes,replies);
 client:=(select jsonb_build_object('value',floor(avg((w->>'workPercent')::numeric))::int,'measured',count(*) filter(where w->>'workPercent' is not null))
  from public.workspace_profiles p left join private.workspace_staff_rota r on r.user_id=p.user_id
  cross join lateral (select private.workspace_daily_work(p.user_id,start_on,end_on) w) d
  where p.status='active' and p.role<>'client' and private.workspace_kpi_area(p.role,r.department)='client_relations');
 g:=(guest->>'value')::int;c:=(client->>'value')::int;
 return jsonb_build_object(
  'value',case when g is not null and c is not null then floor((g+c)/2.0)::int else coalesce(g,c) end,
  'measured',coalesce((guest->>'measured')::int,0)+coalesce((client->>'measured')::int,0),
  'parts',jsonb_build_array(
   jsonb_build_object('area','guest_relations','value',g,'measured',coalesce((guest->>'measured')::int,0)),
   jsonb_build_object('area','client_relations','value',c,'measured',coalesce((client->>'measured')::int,0))));
end $fn$;

revoke all on function private.workspace_kpi_measures(),private.workspace_kpi_teams_combined(date,date) from public,anon,authenticated;

do $patch$
declare
 fixes text[][]:=array[
  ['private.workspace_kpi_person_value(text,integer,uuid,date,date,jsonb)',
   $q$return private.workspace_kpi_clean_forms(array[target],start_on,end_on);$q$,
   $q$return private.workspace_kpi_clean_forms(array[target],start_on,end_on);
 elsif measure='teams_combined' then
  return private.workspace_kpi_teams_combined(start_on,end_on);$q$,
   $q$return private.workspace_kpi_teams_combined(start_on,end_on);$q$],
  ['private.workspace_kpi_team_value(text,integer,uuid[],date,date,jsonb)',
   $q$return private.workspace_kpi_clean_forms(members,start_on,end_on);$q$,
   $q$return private.workspace_kpi_clean_forms(members,start_on,end_on);
 elsif measure='teams_combined' then
  return private.workspace_kpi_teams_combined(start_on,end_on);$q$,
   $q$return private.workspace_kpi_teams_combined(start_on,end_on);$q$],
  ['private.workspace_kpi_result(private.workspace_kpis,jsonb)',
   $q$||private.workspace_kpi_tier(k.direction,k.target_percent,k.bonus_tiers,(v->>'value')::int)$q$,
   $q$||private.workspace_kpi_tier(k.direction,k.target_percent,k.bonus_tiers,(v->>'value')::int)
  ||case when v ? 'parts' then jsonb_build_object('parts',v->'parts') else '{}'::jsonb end$q$,
   $q$jsonb_build_object('parts',v->'parts')$q$]
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

-- 4. The seeded management bonus KPI moves to the new measure, logged as an edit by nobody (like the seed).
with old as (select * from private.workspace_kpis where seed_key='management_score' and measure='performance_score' for update),
moved as (
 update private.workspace_kpis k set measure='teams_combined',direction='higher',minutes=null,
  name=case when k.name='Performance score' then 'Guest relations and Client relations, combined' else k.name end,
  version=k.version+1,updated_at=now()
 from old where k.id=old.id
 returning k.id,to_jsonb(old) before,to_jsonb(k) after)
insert into private.workspace_kpi_changes(kpi_id,change,before,after) select moved.id,'edited',moved.before,moved.after from moved;

insert into supabase_migrations.schema_migrations(version,name) values ('20261016310000','management_bonus_combined');

-- ===== 20261016500000_inbound_email =====
-- Email for guests and clients through Resend (round 6, Session F).
--   guestrelations@rechargegroup.co.uk -> Messages > Guests (source 'email'); ownerrelations@rechargegroup.co.uk -> Messages > Clients.
-- Fasthosts keeps both mailboxes and forwards a copy to Resend inbound; the Worker verifies Resend's signed webhook, fetches the
-- email, drops spam and failed SPF/DKIM/DMARC, and stores it through the functions below (service role only).
-- Guest email goes through workspace_guest_messages_ingest, so the privacy rules of the guest inbox apply unchanged: owners, cleaners
-- and Ready never see it (workspace_guest_messaging_role), in the database as well as on screen. Owner email goes into that owner's
-- own conversation. Replies go out through Resend: guests synchronously (the existing sendReply action, once per request id), owners
-- through an outbox the Worker empties every minute. Safe to run twice.

-- ---------------------------------------------------------------- tables
alter table private.workspace_guest_threads add column if not exists guest_email text check(guest_email is null or char_length(guest_email) between 3 and 320);
create index if not exists workspace_guest_threads_email_idx on private.workspace_guest_threads(lower(guest_email)) where source='email';

-- One row per email Resend delivered (its id), so a repeated webhook is stored once. Dropped emails keep no content.
create table if not exists private.workspace_email_inbound (
 email_id text primary key check(char_length(email_id) between 1 and 200),
 mailbox text not null check(mailbox in ('guest','owner')),
 outcome text not null check(outcome in ('stored','dropped')),
 reason text check(reason is null or char_length(reason)<=200),
 from_address text check(from_address is null or char_length(from_address)<=320),
 received_at timestamptz not null default now()
);
create index if not exists workspace_email_inbound_time_idx on private.workspace_email_inbound(received_at);

-- The mail headers of each stored email, in or out: what a reply's In-Reply-To and References are matched against.
create table if not exists private.workspace_email_messages (
 id uuid primary key default gen_random_uuid(),
 mailbox text not null check(mailbox in ('guest','owner')),
 direction text not null check(direction in ('in','out')),
 guest_message_id uuid references private.workspace_guest_messages(id) on delete cascade,
 chat_message_id uuid references private.chat_messages(id) on delete cascade,
 rfc_message_id text check(rfc_message_id is null or char_length(rfc_message_id) between 1 and 998),
 in_reply_to text check(in_reply_to is null or char_length(in_reply_to)<=998),
 refs text[] not null default '{}' check(cardinality(refs)<=50),
 from_address text check(from_address is null or char_length(from_address)<=320),
 to_address text check(to_address is null or char_length(to_address)<=320),
 subject text check(subject is null or char_length(subject)<=300),
 created_at timestamptz not null default now(),
 check((guest_message_id is not null)::int+(chat_message_id is not null)::int=1)
);
create unique index if not exists workspace_email_messages_rfc_idx on private.workspace_email_messages(lower(rfc_message_id)) where rfc_message_id is not null;
create unique index if not exists workspace_email_messages_guest_idx on private.workspace_email_messages(guest_message_id) where guest_message_id is not null;
create unique index if not exists workspace_email_messages_chat_idx on private.workspace_email_messages(chat_message_id) where chat_message_id is not null;

-- Attachments kept in the private bucket 'email-files' (type and size checked from the bytes by the Worker).
create table if not exists private.workspace_email_attachments (
 id uuid primary key default gen_random_uuid(),
 guest_message_id uuid references private.workspace_guest_messages(id) on delete cascade,
 chat_message_id uuid references private.chat_messages(id) on delete cascade,
 path text not null unique check(char_length(path) between 3 and 300),
 filename text not null check(char_length(filename) between 1 and 200),
 mime text not null check(mime in ('image/jpeg','image/png','image/webp','image/gif','application/pdf')),
 bytes integer not null check(bytes between 1 and 10485760),
 created_at timestamptz not null default now(),
 check((guest_message_id is not null)::int+(chat_message_id is not null)::int=1)
);
create index if not exists workspace_email_attachments_guest_idx on private.workspace_email_attachments(guest_message_id);
create index if not exists workspace_email_attachments_chat_idx on private.workspace_email_attachments(chat_message_id);

-- Owner email from an address we do not know, waiting for Client relations; and addresses they matched to an owner.
create table if not exists private.workspace_email_unknown_senders (
 email_id text primary key references private.workspace_email_inbound(email_id) on delete cascade,
 from_address text not null check(char_length(from_address) between 3 and 320),
 from_name text check(from_name is null or char_length(from_name)<=200),
 subject text check(subject is null or char_length(subject)<=300),
 body text not null default '' check(char_length(body)<=5000),
 rfc_message_id text, in_reply_to text, refs text[] not null default '{}',
 received_at timestamptz not null default now(),
 status text not null default 'open' check(status in ('open','assigned','dismissed')),
 owner_id uuid references public.workspace_profiles(user_id),
 resolved_by uuid references public.workspace_profiles(user_id),
 resolved_at timestamptz
);
create index if not exists workspace_email_unknown_open_idx on private.workspace_email_unknown_senders(status,received_at desc);
create table if not exists private.workspace_email_owner_addresses (
 address text primary key check(address=lower(address) and char_length(address) between 3 and 320),
 owner_id uuid not null references public.workspace_profiles(user_id) on delete cascade,
 added_by uuid references public.workspace_profiles(user_id),
 created_at timestamptz not null default now()
);

-- Replies to owners who wrote by email, sent by the Worker through Resend (once per row: the row id is the idempotency key).
create table if not exists private.workspace_email_outbox (
 id uuid primary key default gen_random_uuid(),
 chat_message_id uuid not null unique references private.chat_messages(id) on delete cascade,
 mailbox text not null default 'owner' check(mailbox='owner'),
 to_address text not null check(char_length(to_address) between 3 and 320),
 subject text not null check(char_length(subject)<=300),
 body text not null check(char_length(body) between 1 and 4000),
 in_reply_to text, refs text[] not null default '{}',
 status text not null default 'pending' check(status in ('pending','sending','sent','failed')),
 attempts integer not null default 0,
 error text check(error is null or char_length(error)<=300),
 rfc_message_id text,
 claimed_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists workspace_email_outbox_due_idx on private.workspace_email_outbox(status,created_at);

do $$ declare t text; begin
 foreach t in array array['workspace_email_inbound','workspace_email_messages','workspace_email_attachments','workspace_email_unknown_senders','workspace_email_owner_addresses','workspace_email_outbox'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated',t);
 end loop;
end $$;

-- A private bucket for the attachments (where storage exists; the tests have none).
do $$ begin
 if to_regclass('storage.buckets') is not null then
  execute $q$insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
   values('email-files','email-files',false,10485760,array['image/jpeg','image/png','image/webp','image/gif','application/pdf'])
   on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=excluded.allowed_mime_types$q$;
 end if;
end $$;

-- ---------------------------------------------------------------- helpers
create or replace function private.workspace_email_clean(v text) returns text language sql immutable set search_path='' as $$
 select nullif(lower(btrim(v)),'')
$$;
create or replace function private.workspace_email_valid(v text) returns boolean language sql immutable set search_path='' as $$
 select v ~ '^[a-z0-9._%+''-]+@[a-z0-9.-]+\.[a-z]{2,}$' and char_length(v)<=320
$$;
-- The Message-ID of an email, kept without angle brackets and capitals.
create or replace function private.workspace_email_msgid(v text) returns text language sql immutable set search_path='' as $$
 select nullif(lower(btrim(btrim(coalesce(v,'')),'<>')),'')
$$;
-- Quoted text and long signatures stay in the mailbox; the conversation keeps the new text.
create or replace function private.workspace_email_attachments_add(input jsonb,gm uuid,cm uuid) returns void language plpgsql security definer set search_path='' as $$
declare a jsonb;begin
 if jsonb_typeof(input->'attachments')='array' then
  for a in select value from jsonb_array_elements(input->'attachments') limit 10 loop
   insert into private.workspace_email_attachments(guest_message_id,chat_message_id,path,filename,mime,bytes)
    values(gm,cm,a->>'path',left(coalesce(nullif(a->>'filename',''),'attachment'),200),a->>'mime',(a->>'bytes')::integer) on conflict(path) do nothing;
  end loop;
 end if;
end $$;

-- ---------------------------------------------------------------- drops
-- The Worker dropped an email (spam, failed SPF/DKIM/DMARC, no valid sender): only the fact is kept, never the content.
create or replace function private.workspace_email_drop(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare n integer;begin
 if jsonb_typeof(input)<>'object' or exists(select 1 from jsonb_object_keys(input) k where k not in ('emailId','mailbox','from','reason'))
  or jsonb_typeof(input->'emailId') is distinct from 'string' or input->>'mailbox' not in ('guest','owner') then raise exception 'Invalid email drop' using errcode='22023';end if;
 insert into private.workspace_email_inbound(email_id,mailbox,outcome,reason,from_address)
  values(left(input->>'emailId',200),input->>'mailbox','dropped',left(coalesce(input->>'reason',''),200),left(private.workspace_email_clean(input->>'from'),320)) on conflict do nothing;
 get diagnostics n=row_count;
 return jsonb_build_object('recorded',n=1);
end $$;

-- ---------------------------------------------------------------- guest email in
-- Matching, in this order (never on the display name):
--   1. In-Reply-To / References against an email we stored (sent or received);
--   2. a booking code (6 to 20 letters and digits) from a stay, found in the subject or text, against that stay's conversation;
--   3. the sender's address against an earlier email conversation;
--   4. otherwise a new unmatched email conversation (property empty, shared with everyone who may use the guest inbox).
create or replace function private.workspace_email_guest_ingest(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare eid text;sender text;sname text;subj text;txt text;at timestamptz;mid text;irt text;refs text[];ids text[];
 th private.workspace_guest_threads;st private.workspace_reservations;code text;how text;ref text;fresh boolean:=false;gm uuid;body text;n integer;
begin
 if jsonb_typeof(input)<>'object' or exists(select 1 from jsonb_object_keys(input) k where k not in ('emailId','from','fromName','subject','text','receivedAt','messageId','inReplyTo','references','attachments'))
  or jsonb_typeof(input->'emailId') is distinct from 'string' or char_length(coalesce(input->>'emailId',''))=0 then raise exception 'Invalid email' using errcode='22023';end if;
 eid:=left(input->>'emailId',200);sender:=private.workspace_email_clean(input->>'from');
 if sender is null or not private.workspace_email_valid(sender) then raise exception 'Invalid sender' using errcode='22023';end if;
 sname:=nullif(left(btrim(coalesce(input->>'fromName','')),120),'');subj:=left(btrim(coalesce(input->>'subject','')),300);
 txt:=btrim(coalesce(input->>'text',''));at:=coalesce((input->>'receivedAt')::timestamptz,now());
 if at>now()+interval '5 minutes' then at:=now();end if;
 mid:=private.workspace_email_msgid(input->>'messageId');irt:=private.workspace_email_msgid(input->>'inReplyTo');
 refs:=coalesce((select array_agg(distinct r) from (select private.workspace_email_msgid(x) r from jsonb_array_elements_text(case when jsonb_typeof(input->'references')='array' then input->'references' else '[]'::jsonb end) x limit 50) q where r is not null),'{}');
 insert into private.workspace_email_inbound(email_id,mailbox,outcome,from_address,received_at) values(eid,'guest','stored',sender,at) on conflict do nothing;
 get diagnostics n=row_count;
 if n=0 then return jsonb_build_object('duplicate',true);end if;
 ids:=array_remove(array[irt]||refs,null);
 -- 1. a reply to something we stored
 if cardinality(ids)>0 then
  select t.* into th from private.workspace_email_messages e join private.workspace_guest_messages g on g.id=e.guest_message_id
   join private.workspace_guest_threads t on t.source=g.source and t.thread_ref=g.thread_ref
   where e.mailbox='guest' and lower(e.rfc_message_id)=any(ids) order by t.last_message_at desc nulls last limit 1;
  if th.id is not null then how:='reply';end if;
 end if;
 -- 2. a booking code of a stay
 if th.id is null then
  select r.* into st from private.workspace_reservations r where r.status='confirmed' and r.check_out>=current_date-30 and exists(select 1 from unnest(private.workspace_stay_codes(r.channel_reference,r.reference)) c
   where c ~ '^[A-Z0-9]{6,20}$' and upper(subj||' '||txt) ~ ('(^|[^A-Z0-9])'||c||'([^A-Z0-9]|$)')) order by r.check_in desc limit 1;
  if st.id is not null then
   select c into code from unnest(private.workspace_stay_codes(st.channel_reference,st.reference)) c where c ~ '^[A-Z0-9]{6,20}$' and upper(subj||' '||txt) ~ ('(^|[^A-Z0-9])'||c||'([^A-Z0-9]|$)') limit 1;
   select * into th from private.workspace_guest_threads t where t.source='email' and upper(t.reservation_ref)=code order by t.last_message_at desc nulls last limit 1;
   how:='booking';ref:=code;
  end if;
 end if;
 -- 3. the same sender as an earlier email conversation
 if th.id is null then
  select * into th from private.workspace_guest_threads t where t.source='email' and lower(t.guest_email)=sender order by t.last_message_at desc nulls last limit 1;
  if th.id is not null then how:='sender';end if;
 end if;
 -- 4. new
 if th.id is null then
  fresh:=true;how:=coalesce(how,'new');
 end if;
 body:=case when fresh and subj<>'' then 'Subject: '||subj||E'\n\n'||txt else txt end;
 if body='' then body:='(no text)';end if;
 perform private.workspace_guest_messages_ingest(jsonb_build_object('source','email','messages',jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
  'externalId','email:'||eid,'threadRef',coalesce(th.thread_ref,'email:'||gen_random_uuid()::text),'channel','email','direction','guest','sentAt',at,'body',body,
  'guestName',case when th.id is null or th.guest_name is null then coalesce(sname,sender) end,'propertyId',case when th.id is null then st.property_id end,
  'reservationRef',case when th.id is null then ref end,'checkIn',case when th.id is null then st.check_in end,'checkOut',case when th.id is null then st.check_out end)))));
 select g.id,t.id into gm,th.id from private.workspace_guest_messages g join private.workspace_guest_threads t on t.source=g.source and t.thread_ref=g.thread_ref where g.source='email' and g.external_id='email:'||eid;
 update private.workspace_guest_threads set guest_email=coalesce(guest_email,sender) where id=th.id;
 insert into private.workspace_email_messages(mailbox,direction,guest_message_id,rfc_message_id,in_reply_to,refs,from_address,subject)
  values('guest','in',gm,mid,irt,refs,sender,nullif(subj,'')) on conflict do nothing;
 perform private.workspace_email_attachments_add(input,gm,null);
 return jsonb_build_object('stored',true,'threadId',th.id,'matched',how);
end $$;

-- ---------------------------------------------------------------- owner email in
create or replace function private.workspace_email_owner_find(sender text) returns uuid language sql stable security definer set search_path='' as $$
 select coalesce(
  (select a.owner_id from private.workspace_email_owner_addresses a join public.workspace_profiles p on p.user_id=a.owner_id and p.role='client' and p.status='active' where a.address=sender),
  (select p.user_id from public.workspace_profiles p join auth.users u on u.id=p.user_id where p.role='client' and p.status='active' and lower(u.email)=sender order by p.created_at limit 1))
$$;

-- Posts the email into the owner's one conversation with Recharge, as the owner, and tells whoever answers owners.
create or replace function private.workspace_email_owner_post(owner uuid,eid text,body text,at timestamptz,input jsonb,sender text,subj text,mid text,irt text,refs text[]) returns uuid language plpgsql security definer set search_path='' as $$
declare conv private.chat_conversations;msg uuid:=gen_random_uuid();req uuid:=md5('email:'||eid)::uuid;ev bigint;begin
 conv:=(select c from private.chat_conversations c where c.kind='owner' and c.owner_id=owner);
 if conv.id is null then
  insert into private.chat_conversations(kind,owner_id,created_by) values('owner',owner,owner) on conflict do nothing;
  conv:=(select c from private.chat_conversations c where c.kind='owner' and c.owner_id=owner);
  insert into private.chat_members(conversation_id,user_id) values(conv.id,owner) on conflict do nothing;
 end if;
 insert into private.chat_messages(id,conversation_id,author_id,body,request_id,created_at) values(msg,conv.id,owner,left(btrim(body),4000),req,at) on conflict(author_id,request_id) do nothing;
 msg:=(select m.id from private.chat_messages m where m.author_id=owner and m.request_id=req);
 update private.chat_conversations set last_message_at=greatest(last_message_at,at) where id=conv.id;
 insert into private.workspace_email_messages(mailbox,direction,chat_message_id,rfc_message_id,in_reply_to,refs,from_address,subject)
  values('owner','in',msg,mid,irt,refs,sender,nullif(subj,'')) on conflict do nothing;
 perform private.workspace_email_attachments_add(input,null,msg);
 insert into public.workspace_activity(actor_id,property_id,event_type) values(owner,conv.property_id,'chat.owner_message') returning id into ev;
 insert into private.workspace_notification_outbox(user_id,event_id)
  select u,ev from private.chat_audience(conv.id) u where u<>owner and not private.chat_blocked(u,owner) on conflict do nothing;
 return msg;
end $$;

create or replace function private.workspace_email_owner_ingest(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare eid text;sender text;sname text;subj text;txt text;at timestamptz;mid text;irt text;refs text[];owner uuid;n integer;body text;begin
 if jsonb_typeof(input)<>'object' or exists(select 1 from jsonb_object_keys(input) k where k not in ('emailId','from','fromName','subject','text','receivedAt','messageId','inReplyTo','references','attachments'))
  or jsonb_typeof(input->'emailId') is distinct from 'string' or char_length(coalesce(input->>'emailId',''))=0 then raise exception 'Invalid email' using errcode='22023';end if;
 eid:=left(input->>'emailId',200);sender:=private.workspace_email_clean(input->>'from');
 if sender is null or not private.workspace_email_valid(sender) then raise exception 'Invalid sender' using errcode='22023';end if;
 sname:=nullif(left(btrim(coalesce(input->>'fromName','')),200),'');subj:=left(btrim(coalesce(input->>'subject','')),300);
 txt:=btrim(coalesce(input->>'text',''));at:=coalesce((input->>'receivedAt')::timestamptz,now());
 if at>now()+interval '5 minutes' then at:=now();end if;
 mid:=private.workspace_email_msgid(input->>'messageId');irt:=private.workspace_email_msgid(input->>'inReplyTo');
 refs:=coalesce((select array_agg(distinct r) from (select private.workspace_email_msgid(x) r from jsonb_array_elements_text(case when jsonb_typeof(input->'references')='array' then input->'references' else '[]'::jsonb end) x limit 50) q where r is not null),'{}');
 insert into private.workspace_email_inbound(email_id,mailbox,outcome,from_address,received_at) values(eid,'owner','stored',sender,at) on conflict do nothing;
 get diagnostics n=row_count;
 if n=0 then return jsonb_build_object('duplicate',true);end if;
 body:=case when subj<>'' then 'Subject: '||subj||E'\n\n'||txt else txt end;
 if btrim(body)='' then body:='(no text)';end if;
 owner:=private.workspace_email_owner_find(sender);
 if owner is null then
  insert into private.workspace_email_unknown_senders(email_id,from_address,from_name,subject,body,rfc_message_id,in_reply_to,refs,received_at)
   values(eid,sender,sname,nullif(subj,''),left(body,5000),mid,irt,refs,at);
  return jsonb_build_object('stored',true,'matched','unknown');
 end if;
 perform private.workspace_email_owner_post(owner,eid,body,at,input,sender,subj,mid,irt,refs);
 return jsonb_build_object('stored',true,'matched','owner');
end $$;

-- ---------------------------------------------------------------- unknown senders (Client relations)
create or replace function private.workspace_email_owner_team() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(private.workspace_actor_role() in ('admin','super_admin')
  or (private.workspace_actor_role() in ('stays') and exists(select 1 from private.workspace_staff_rota r where r.user_id=auth.uid() and r.department in ('client_relations','management'))),false)
$$;

create or replace function private.workspace_email_unknown_read() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.workspace_email_owner_team() then raise exception 'Client relations access required' using errcode='42501';end if;
 return jsonb_build_object('senders',coalesce((select jsonb_agg(jsonb_build_object('id',u.email_id,'from',u.from_address,'name',u.from_name,'subject',u.subject,'body',u.body,'receivedAt',u.received_at) order by u.received_at desc)
  from (select * from private.workspace_email_unknown_senders where status='open' order by received_at desc limit 200) u),'[]'));
end $$;

create or replace function private.workspace_email_unknown_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid();a text:=input->>'action';u private.workspace_email_unknown_senders;owner uuid;begin
 if not private.workspace_email_owner_team() then raise exception 'Client relations access required' using errcode='42501';end if;
 perform private.workspace_json_keys(input,array['action','id','ownerId']);
 select * into u from private.workspace_email_unknown_senders where email_id=input->>'id' for update;
 if u.email_id is null or u.status<>'open' then raise exception 'Email not found' using errcode='P0002';end if;
 if a='dismiss' then
  update private.workspace_email_unknown_senders set status='dismissed',resolved_by=me,resolved_at=now() where email_id=u.email_id;
 elsif a='assign' then
  owner:=(input->>'ownerId')::uuid;
  if owner is null or not exists(select 1 from public.workspace_profiles where user_id=owner and role='client' and status='active') or not private.chat_owner_team(owner,me) then raise exception 'Owner not found' using errcode='42501';end if;
  -- This address now counts as the owner's, so their next emails land in the conversation by themselves.
  insert into private.workspace_email_owner_addresses(address,owner_id,added_by) values(u.from_address,owner,me) on conflict(address) do nothing;
  perform private.workspace_email_owner_post(owner,u.email_id,u.body,u.received_at,'{}'::jsonb,u.from_address,u.subject,u.rfc_message_id,u.in_reply_to,u.refs);
  update private.workspace_email_unknown_senders set status='assigned',owner_id=owner,resolved_by=me,resolved_at=now() where email_id=u.email_id;
 else raise exception 'Unknown action' using errcode='22023';end if;
 return jsonb_build_object('ok',true);
end $$;

-- ---------------------------------------------------------------- attachments: who may open them
-- Returns the stored path of each attachment the signed-in person may open; the Worker then signs a short link.
create or replace function private.workspace_email_files(ids uuid[]) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'path',a.path,'filename',a.filename,'mime',a.mime,'bytes',a.bytes)),'[]')
 from private.workspace_email_attachments a where a.id=any(ids) and (
  (a.guest_message_id is not null and private.workspace_guest_messaging_role(private.workspace_actor_role()) and exists(
    select 1 from private.workspace_guest_messages g join private.workspace_guest_threads t on t.source=g.source and t.thread_ref=g.thread_ref
    where g.id=a.guest_message_id and private.guest_inbox_can(t.property_id)))
  or (a.chat_message_id is not null and exists(select 1 from private.chat_messages m where m.id=a.chat_message_id and private.chat_can(m.conversation_id,auth.uid()))))
$$;

-- ---------------------------------------------------------------- replies out
-- A conversation that began as an email is answered by email: to the sender's address, as guestrelations@, with In-Reply-To and
-- References from the latest email in the conversation.
create or replace function private.workspace_email_reply_context(th private.workspace_guest_threads) returns jsonb language sql stable security definer set search_path='' as $$
 with last as (select e.* from private.workspace_email_messages e join private.workspace_guest_messages g on g.id=e.guest_message_id
   where g.source=th.source and g.thread_ref=th.thread_ref and e.rfc_message_id is not null order by g.sent_at desc,g.id desc limit 1),
 first as (select e.subject from private.workspace_email_messages e join private.workspace_guest_messages g on g.id=e.guest_message_id
   where g.source=th.source and g.thread_ref=th.thread_ref and e.subject is not null order by g.sent_at,g.id limit 1)
 select jsonb_build_object('to',th.guest_email,'subject',(select case when s.subject ~* '^(re|aw):' then s.subject else 'Re: '||s.subject end from first s),
  'inReplyTo',(select l.rfc_message_id from last l),'references',coalesce((select to_jsonb((l.refs||l.rfc_message_id)[greatest(1,cardinality(l.refs||l.rfc_message_id)-19):]) from last l),'[]'::jsonb))
$$;

-- The team's reply, after Resend accepted it (service role): stored once per request, with the Message-ID it went out under.
create or replace function private.workspace_email_reply_result(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare rq private.workspace_guest_reply_requests;th private.workspace_guest_threads;gm uuid;ext text;begin
 if jsonb_typeof(input)<>'object' or exists(select 1 from jsonb_object_keys(input) k where k not in ('requestId','ok','resendId','messageId','error'))
  or jsonb_typeof(input->'requestId') is distinct from 'string' or input->>'requestId'!~'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or jsonb_typeof(input->'ok') is distinct from 'boolean' then raise exception 'Invalid reply result' using errcode='22023';end if;
 select * into rq from private.workspace_guest_reply_requests where request_id=(input->>'requestId')::uuid for update;
 if not found then raise exception 'Reply request not found' using errcode='P0002';end if;
 if rq.status='sent' then return jsonb_build_object('recorded',false);end if;
 if not (input->>'ok')::boolean then
  update private.workspace_guest_reply_requests set status='failed',error=nullif(left(coalesce(input->>'error',''),300),'') where request_id=rq.request_id;
  return jsonb_build_object('recorded',true);
 end if;
 th:=(select x from private.workspace_guest_threads x where x.id=rq.thread_id for update);
 ext:='email-out:'||rq.request_id;
 insert into private.workspace_guest_messages as g(source,external_id,thread_ref,property_id,channel,direction,sent_at,author_user_id,body,delivery)
  values(th.source,ext,th.thread_ref,th.property_id,'email','team',now(),rq.user_id,rq.body,'sent') on conflict(source,external_id) do nothing;
 gm:=(select g.id from private.workspace_guest_messages g where g.source=th.source and g.external_id=ext);
 insert into private.workspace_email_messages(mailbox,direction,guest_message_id,rfc_message_id,in_reply_to,from_address,to_address)
  values('guest','out',gm,private.workspace_email_msgid(input->>'messageId'),null,'guestrelations@rechargegroup.co.uk',th.guest_email) on conflict do nothing;
 update private.workspace_guest_threads set last_message_at=greatest(coalesce(last_message_at,now()),now()) where id=th.id;
 update private.workspace_guest_reply_requests set status='sent',hostaway_message_id=null,error=null where request_id=rq.request_id;
 return jsonb_build_object('recorded',true);
end $$;

-- A team reply in an owner conversation whose latest owner message came by email is queued to be emailed too.
create or replace function private.workspace_email_owner_reply_queue() returns trigger language plpgsql security definer set search_path='' as $fn$
declare c private.chat_conversations;e private.workspace_email_messages;begin
 begin
  select * into c from private.chat_conversations where id=new.conversation_id and kind='owner';
  if c.id is null or new.author_id=c.owner_id then return new;end if;
  -- the owner's latest message, and only when it arrived by email
  select e2.* into e from private.chat_messages m join private.workspace_email_messages e2 on e2.chat_message_id=m.id and e2.direction='in'
   where m.conversation_id=c.id and m.author_id=c.owner_id and m.created_at=(select max(x.created_at) from private.chat_messages x where x.conversation_id=c.id and x.author_id=c.owner_id)
   order by m.id limit 1;
  if e.id is not null and e.from_address is not null then
   insert into private.workspace_email_outbox(chat_message_id,to_address,subject,body,in_reply_to,refs)
    values(new.id,e.from_address,case when coalesce(e.subject,'') ~* '^(re|aw):' then e.subject else 'Re: '||coalesce(e.subject,'Your message') end,left(new.body,4000),e.rfc_message_id,(e.refs||e.rfc_message_id)[greatest(1,cardinality(e.refs||e.rfc_message_id)-19):])
    on conflict(chat_message_id) do nothing;
  end if;
 exception when others then
  -- A queued email is never worth losing the team's message.
  raise warning 'Owner email reply not queued: %',sqlerrm;
 end;
 return new;
end $fn$;
drop trigger if exists workspace_email_owner_reply_queue on private.chat_messages;
create trigger workspace_email_owner_reply_queue after insert on private.chat_messages for each row execute function private.workspace_email_owner_reply_queue();

-- The Worker takes due rows (or a row left "sending" for over 5 minutes) and reports each result; a row is sent once.
create or replace function private.workspace_email_outbox_claim(max_rows integer default 10) returns jsonb language sql security definer set search_path='' as $$
 with due as (select o.id from private.workspace_email_outbox o where (o.status='pending' or (o.status='sending' and o.claimed_at<now()-interval '5 minutes')) and o.attempts<5
   order by o.created_at limit greatest(1,least(coalesce(max_rows,10),25)) for update skip locked),
 taken as (update private.workspace_email_outbox o set status='sending',attempts=o.attempts+1,claimed_at=now() from due where o.id=due.id
   returning o.id,o.to_address,o.subject,o.body,o.in_reply_to,o.refs,o.created_at)
 select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'to',t.to_address,'subject',t.subject,'body',t.body,'inReplyTo',t.in_reply_to,'references',to_jsonb(t.refs)) order by t.created_at),'[]'::jsonb) from taken t
$$;
create or replace function private.workspace_email_outbox_result(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare o private.workspace_email_outbox;begin
 if jsonb_typeof(input)<>'object' or exists(select 1 from jsonb_object_keys(input) k where k not in ('id','ok','messageId','error'))
  or jsonb_typeof(input->'id') is distinct from 'string' or jsonb_typeof(input->'ok') is distinct from 'boolean' then raise exception 'Invalid outbox result' using errcode='22023';end if;
 select * into o from private.workspace_email_outbox where id=(input->>'id')::uuid for update;
 if not found then raise exception 'Outbox row not found' using errcode='P0002';end if;
 if o.status='sent' then return jsonb_build_object('recorded',false);end if;
 if (input->>'ok')::boolean then
  update private.workspace_email_outbox set status='sent',error=null,rfc_message_id=private.workspace_email_msgid(input->>'messageId') where id=o.id;
  insert into private.workspace_email_messages(mailbox,direction,chat_message_id,rfc_message_id,from_address,to_address,subject)
   values('owner','out',o.chat_message_id,private.workspace_email_msgid(input->>'messageId'),'ownerrelations@rechargegroup.co.uk',o.to_address,o.subject) on conflict do nothing;
 else
  update private.workspace_email_outbox set status=case when attempts>=5 then 'failed' else 'pending' end,error=nullif(left(coalesce(input->>'error',''),300),'') where id=o.id;
 end if;
 return jsonb_build_object('recorded',true);
end $$;

-- ---------------------------------------------------------------- public wrappers and grants
create or replace function public.workspace_email_guest_ingest(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_email_guest_ingest(input);$$;
create or replace function public.workspace_email_owner_ingest(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_email_owner_ingest(input);$$;
create or replace function public.workspace_email_drop(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_email_drop(input);$$;
create or replace function public.workspace_email_reply_result(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_email_reply_result(input);$$;
create or replace function public.workspace_email_outbox_claim(max_rows integer default 10) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_email_outbox_claim(max_rows);$$;
create or replace function public.workspace_email_outbox_result(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_email_outbox_result(input);$$;
create or replace function public.workspace_email_unknown_read() returns jsonb language sql security invoker set search_path='' as $$select private.workspace_email_unknown_read();$$;
create or replace function public.workspace_email_unknown_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_email_unknown_action(input);$$;
create or replace function public.workspace_email_files(ids uuid[]) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_email_files(ids);$$;

revoke all on function
 private.workspace_email_clean(text),private.workspace_email_valid(text),private.workspace_email_msgid(text),private.workspace_email_attachments_add(jsonb,uuid,uuid),
 private.workspace_email_owner_find(text),private.workspace_email_owner_post(uuid,text,text,timestamptz,jsonb,text,text,text,text,text[]),
 private.workspace_email_owner_team(),private.workspace_email_reply_context(private.workspace_guest_threads),private.workspace_email_owner_reply_queue()
 from public,anon,authenticated,service_role;
revoke all on function
 private.workspace_email_guest_ingest(jsonb),private.workspace_email_owner_ingest(jsonb),private.workspace_email_drop(jsonb),private.workspace_email_reply_result(jsonb),
 private.workspace_email_outbox_claim(integer),private.workspace_email_outbox_result(jsonb),private.workspace_email_unknown_read(),private.workspace_email_unknown_action(jsonb),private.workspace_email_files(uuid[]),
 public.workspace_email_guest_ingest(jsonb),public.workspace_email_owner_ingest(jsonb),public.workspace_email_drop(jsonb),public.workspace_email_reply_result(jsonb),
 public.workspace_email_outbox_claim(integer),public.workspace_email_outbox_result(jsonb),public.workspace_email_unknown_read(),public.workspace_email_unknown_action(jsonb),public.workspace_email_files(uuid[])
 from public,anon,authenticated,service_role;
grant execute on function
 private.workspace_email_guest_ingest(jsonb),private.workspace_email_owner_ingest(jsonb),private.workspace_email_drop(jsonb),private.workspace_email_reply_result(jsonb),
 private.workspace_email_outbox_claim(integer),private.workspace_email_outbox_result(jsonb),
 public.workspace_email_guest_ingest(jsonb),public.workspace_email_owner_ingest(jsonb),public.workspace_email_drop(jsonb),public.workspace_email_reply_result(jsonb),
 public.workspace_email_outbox_claim(integer),public.workspace_email_outbox_result(jsonb) to service_role;
grant execute on function
 private.workspace_email_unknown_read(),private.workspace_email_unknown_action(jsonb),private.workspace_email_files(uuid[]),
 public.workspace_email_unknown_read(),public.workspace_email_unknown_action(jsonb),public.workspace_email_files(uuid[]) to authenticated;

-- ---------------------------------------------------------------- patches by anchor (exactly one anchor each, with a sentinel)
-- 1. workspace_guest_reply_begin: email conversations can be replied to; the Hostaway pause only concerns Hostaway; the result carries
--    what the Worker needs to send an email.
-- 2. workspace_guest_inbox_read: each message lists its attachments.
do $patch$
declare
 fixes text[][]:=array[
  ['private.workspace_guest_reply_begin(private.workspace_guest_threads,uuid,text)',
   $q$if th.id is null or th.source<>'hostaway' then raise exception 'Only Hostaway conversations can be replied to from here' using errcode='22023';end if;$q$,
   $q$if th.id is null or th.source not in ('hostaway','email') then raise exception 'Only Hostaway conversations can be replied to from here' using errcode='22023';end if;$q$,
   $q$th.source not in ('hostaway','email')$q$],
  ['private.workspace_guest_reply_begin(private.workspace_guest_threads,uuid,text)',
   $q$if (select paused from private.workspace_hostaway_sync_state where singleton) then raise exception 'Hostaway is paused, so replies can’t be sent from here' using errcode='22023';end if;$q$,
   $q$if th.source='hostaway' and (select paused from private.workspace_hostaway_sync_state where singleton) then raise exception 'Hostaway is paused, so replies can’t be sent from here' using errcode='22023';end if;$q$,
   $q$if th.source='hostaway' and (select paused$q$],
  ['private.workspace_guest_reply_begin(private.workspace_guest_threads,uuid,text)',
   $q$return jsonb_build_object('send',true,'conversationId',th.thread_ref,'requestId',req);$q$,
   $q$return jsonb_build_object('send',true,'conversationId',th.thread_ref,'requestId',req)||case when th.source='email' then jsonb_build_object('source','email','email',private.workspace_email_reply_context(th)) else '{}'::jsonb end;$q$,
   $q$jsonb_build_object('source','email','email'$q$],
  ['private.workspace_guest_inbox_read(text,uuid,text)',
   $q$'author',(select p.full_name from public.workspace_profiles p where p.user_id=m.author_user_id)) order by m.sent_at,m.id)$q$,
   $q$'author',(select p.full_name from public.workspace_profiles p where p.user_id=m.author_user_id),
     'files',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'filename',a.filename,'mime',a.mime,'bytes',a.bytes) order by a.created_at) from private.workspace_email_attachments a where a.guest_message_id=m.id),'[]'::jsonb)) order by m.sent_at,m.id)$q$,
   $q$'files',coalesce((select jsonb_agg(jsonb_build_object('id',a.id$q$]
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

insert into supabase_migrations.schema_migrations(version,name) values ('20261016500000','inbound_email');

-- ===== 20261017300000_updates_open_and_older =====
-- Updates feed, round 7 (follow-up to round 6, 20261016300000).
-- 1. Open any update. Tapping an update whose work item is not in the loaded work list did nothing. A single-item read,
--    private.workspace_operation_read(target), returns that one item with exactly the rules of the work list
--    (private.workspace_operations_read): a work item with its details, that private.workspace_operation_access lets the
--    person see, shaped by private.workspace_operation_view (owners get the owner view, never staff fields). Anything
--    else, whether it does not exist or the person may not see it, is the same "Work item not found", so nothing leaks.
-- 2. Older updates. The feed read returns the newest 50. private.workspace_notifications_read(before_id) returns the 50
--    before a given update (by time, then id, as the feed is ordered), so the app can page back 50 at a time. The cursor
--    must be one of the person's own updates. The query is the round 6 one, unchanged: the same rows, fields, owner rule
--    and checks. The notifications branch of private.workspace_controls_read is replaced whole by a call to it (with no
--    cursor), so there is one copy of the query.
-- Safe to run twice: functions are replaced whole, and the branch is replaced only while it still holds the old query.
-- Note for later migrations: the notifications query now lives in private.workspace_notifications_read, not in
-- private.workspace_controls_read; anchor patches for the feed belong there.

create or replace function private.workspace_operation_read(target uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
begin
 if private.workspace_actor_role() is null then raise exception 'Active access required' using errcode='42501';end if;
 if target is null or not exists(select 1 from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where w.id=target)
  or not private.workspace_operation_access(target) then
  raise exception 'Work item not found' using errcode='P0002';
 end if;
 return private.workspace_operation_view(target);
end $fn$;

create or replace function public.workspace_operation_read(target uuid) returns jsonb language sql set search_path='' as $fn$
 select private.workspace_operation_read(target);
$fn$;

create or replace function private.workspace_notifications_read(before_id bigint) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();cursor_at timestamptz;result jsonb;
begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 if before_id is not null then
  cursor_at:=(select a.created_at from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.user_id=auth.uid() and a.id=before_id);
  if cursor_at is null then raise exception 'Choose one of your updates' using errcode='22023';end if;
 end if;
 select coalesce(jsonb_agg(n),'[]') into result from(select a.id,a.event_type,a.property_id,a.work_id,a.created_at,o.read_at,
  w.title as work_title,dd.kind as work_kind,w.module_id as work_module,pr.name as property_name,pr.address as property_address,
  (a.actor_id is null and actor<>'client') as automatic,
  case when a.actor_id=auth.uid() then 'You' when actor='client' then 'Recharge' when a.actor_id is null then null else ap.full_name end as actor_name,
  'available_in_app' as status from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id
  left join public.workspace_work_items w on w.id=a.work_id left join private.workspace_domain_details dd on dd.work_id=a.work_id
  left join public.workspace_properties pr on pr.id=coalesce(a.property_id,w.property_id) left join public.workspace_profiles ap on ap.user_id=a.actor_id
  where o.user_id=auth.uid() and (a.work_id is null or private.workspace_can_work(a.work_id)) and
   (a.property_id is null or actor in ('admin','super_admin') or exists(select 1 from public.workspace_property_assignments where property_id=a.property_id and user_id=auth.uid()))
   and (before_id is null or (a.created_at,a.id)<(cursor_at,before_id))
  order by a.created_at desc,a.id desc limit 50) n;
 return result;
end $fn$;

create or replace function public.workspace_notifications_read(before_id bigint) returns jsonb language sql set search_path='' as $fn$
 select private.workspace_notifications_read(before_id);
$fn$;

-- As the work list and the feed read: signed-in people only (each function checks who is asking itself).
revoke all on function private.workspace_operation_read(uuid),private.workspace_notifications_read(bigint),
 public.workspace_operation_read(uuid),public.workspace_notifications_read(bigint) from public,anon,authenticated;
grant execute on function private.workspace_operation_read(uuid),private.workspace_notifications_read(bigint),
 public.workspace_operation_read(uuid),public.workspace_notifications_read(bigint) to authenticated;

-- The notifications branch, from "if section='notifications' then" to its "end if;", becomes a call to the function above.
-- Only while it still holds the old query (the outbox join and the limit of 50); after that the sentinel stops a second run.
do $patch$
declare definition text;branch text;
begin
 definition:=pg_get_functiondef('private.workspace_controls_read(text,uuid,uuid)'::regprocedure);
 if position('return private.workspace_notifications_read(null);' in definition)>0 then return;end if;
 branch:=substring(definition from '(if section=''notifications'' then.*?\n *end if;)');
 if branch is null or (length(definition)-length(replace(definition,'if section=''notifications'' then','')))/length('if section=''notifications'' then')<>1 then
  raise exception 'The notifications branch of workspace_controls_read was not found once';
 end if;
 if position('from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id' in branch)=0 or position('limit 50) n;' in branch)=0
  or position('w.title as work_title,dd.kind as work_kind' in branch)=0 then
  raise exception 'The notifications branch of workspace_controls_read is not the expected query; check before replacing it';
 end if;
 execute replace(definition,branch,'if section=''notifications'' then'||chr(10)||'  return private.workspace_notifications_read(null);'||chr(10)||' end if;');
 if position('return private.workspace_notifications_read(null);' in pg_get_functiondef('private.workspace_controls_read(text,uuid,uuid)'::regprocedure))=0 then
  raise exception 'Patch did not take in workspace_controls_read';
 end if;
end $patch$;

insert into supabase_migrations.schema_migrations(version,name) values ('20261017300000','updates_open_and_older');

-- ===== 20261018300000_management_bonus_weighting =====
-- Management bonus weighting, round 8 (Lee: Alex sets the KPIs and their numbers in the app, and the system follows).
-- The combined measure (teams_combined, 20261016310000) weighed Guest relations and Client relations 50/50. Admins now set
-- the Guest relations share on the KPI, from 0 to 100%; Client relations gets the rest. Left unset, it is 50.
--   private.workspace_kpis.guest_share   nullable whole percentage, used only by teams_combined (null reads as 50).
--   The value: both teams measured, floor((guest x share + client x (100 - share)) / 100); one team with nothing to
--   measure, the other counts alone; neither, no value. Each part carries its share, for "Guest relations 86% (60%)".
--   Saving: saveKpi takes guestShare (a whole number from 0 to 100, or null) for the combined measure only, and keeps the
--   stored share when an edit leaves it out. Admins only, as every KPI change; the change history records it with the row.
--   Reading: the KPI view returns guestShare (50 when unset) for the combined measure, null for any other.
-- private.workspace_kpi_result is replaced whole (only 20261015100000 defines it; only 20261016310000 patched it, and its
-- patch is carried over). The save action and the view are patched by anchor and append (the anchor stays first, a
-- sentinel stops a second run, a missing or repeated anchor raises). Safe to run twice.

alter table private.workspace_kpis add column if not exists guest_share integer check(guest_share is null or guest_share between 0 and 100);

-- The combined value at a share, from the two parts the measure returns, and each part's share.
create or replace function private.workspace_kpi_weighted(v jsonb,share integer) returns jsonb language sql immutable set search_path='' as $fn$
 with p as (select (select (e->>'value')::int from jsonb_array_elements(coalesce(v->'parts','[]'::jsonb)) e where e->>'area'='guest_relations' limit 1) g,
   (select (e->>'value')::int from jsonb_array_elements(coalesce(v->'parts','[]'::jsonb)) e where e->>'area'='client_relations' limit 1) c)
 select v||jsonb_build_object(
  'value',case when p.g is not null and p.c is not null then floor((p.g*share+p.c*(100-share))/100.0)::int else coalesce(p.g,p.c) end,
  'parts',coalesce((select jsonb_agg(e||jsonb_build_object('share',case when e->>'area'='guest_relations' then share else 100-share end) order by o)
   from jsonb_array_elements(coalesce(v->'parts','[]'::jsonb)) with ordinality x(e,o)),'[]'::jsonb))
 from p;
$fn$;

create or replace function private.workspace_kpi_result(k private.workspace_kpis,v jsonb) returns jsonb language sql immutable set search_path='' as $fn$
 select jsonb_build_object('kpiId',k.id,'value',coalesce(w.r->'value','null'::jsonb),'measured',coalesce((w.r->>'measured')::int,0),'count',coalesce(w.r->'count','null'::jsonb))
  ||private.workspace_kpi_tier(k.direction,k.target_percent,k.bonus_tiers,(w.r->>'value')::int)
  ||case when w.r ? 'parts' then jsonb_build_object('parts',w.r->'parts') else '{}'::jsonb end
 from (select case when k.measure='teams_combined' then private.workspace_kpi_weighted(v,coalesce(k.guest_share,50)) else v end r) w;
$fn$;

revoke all on function private.workspace_kpi_weighted(jsonb,integer),private.workspace_kpi_result(private.workspace_kpis,jsonb) from public,anon,authenticated;

do $patch$
declare
 fixes text[][]:=array[
  -- The share, a variable of the save action.
  ['private.workspace_kpi_action(jsonb)',
   $q$mins integer;target integer;change text;bonus boolean;$q$,
   $q$mins integer;target integer;change text;bonus boolean;share integer;$q$,
   $q$bonus boolean;share integer;$q$],
  -- saveKpi accepts guestShare.
  ['private.workspace_kpi_action(jsonb)',
   $q$'targetPercent','bonusTiers','countsForBonus','placeholder'$q$,
   $q$'targetPercent','bonusTiers','countsForBonus','placeholder','guestShare'$q$,
   $q$'placeholder','guestShare'$q$],
  -- Checked and worked out with the other fields: a whole number from 0 to 100, for the combined measure only; an edit
  -- that leaves it out keeps the stored share.
  ['private.workspace_kpi_action(jsonb)',
   $q$bonus:=coalesce((input->>'countsForBonus')::boolean,false);$q$,
   $q$bonus:=coalesce((input->>'countsForBonus')::boolean,false);
  if input ? 'guestShare' and jsonb_typeof(input->'guestShare')<>'null' and (jsonb_typeof(input->'guestShare')<>'number'
   or case when input->>'guestShare'~'^\d{1,3}$' then (input->>'guestShare')::int>100 else true end) then
   raise exception 'The Guest relations share is a whole percentage from 0 to 100' using errcode='22023';
  end if;
  if input->>'measure'<>'teams_combined' and input ? 'guestShare' and jsonb_typeof(input->'guestShare')<>'null' then
   raise exception 'Only the combined measure takes a Guest relations share' using errcode='22023';
  end if;
  share:=case when input->>'measure'<>'teams_combined' then null when input ? 'guestShare' then (input->>'guestShare')::int
   when old.measure='teams_combined' then old.guest_share end;$q$,
   $q$share:=case when input->>'measure'<>'teams_combined' then null$q$],
  -- Stored with the new KPI and with an edit, before the change history row is written from k.
  ['private.workspace_kpi_action(jsonb)',
   $q$change:='created';$q$,
   $q$change:='created';
   update private.workspace_kpis set guest_share=share where id=k.id returning * into k;$q$,
   $q$change:='created';
   update private.workspace_kpis set guest_share=share where id=k.id$q$],
  ['private.workspace_kpi_action(jsonb)',
   $q$change:='edited';$q$,
   $q$change:='edited';
   update private.workspace_kpis set guest_share=share where id=k.id returning * into k;$q$,
   $q$change:='edited';
   update private.workspace_kpis set guest_share=share where id=k.id$q$],
  -- The view: the share for the combined measure (50 when unset), null for any other.
  ['private.workspace_kpi_view(private.workspace_kpis,boolean)',
   $q$'version',k.version,'updatedAt',k.updated_at)$q$,
   $q$'version',k.version,'updatedAt',k.updated_at)||jsonb_build_object('guestShare',case when k.measure='teams_combined' then coalesce(k.guest_share,50) end)$q$,
   $q$jsonb_build_object('guestShare'$q$]
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

insert into supabase_migrations.schema_migrations(version,name) values ('20261018300000','management_bonus_weighting');

commit;
