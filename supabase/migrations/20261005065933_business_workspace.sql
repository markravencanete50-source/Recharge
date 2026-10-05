-- Empty live business workspace. Legacy D1 records are not automatically imported.
-- Writes go through checked, versioned RPCs. No anonymous access or client service key.
alter table public.workspace_profiles add column avatar_preset text not null default 'ocean'
  check(avatar_preset in ('forest','sage','ocean','plum','clay','slate'));
-- Editable Auth metadata may update appearance only. It never changes access.
create function private.workspace_sync_appearance() returns trigger language plpgsql security definer set search_path='' as $$
declare display text; avatar text;
begin
  display:=trim(coalesce(new.raw_user_meta_data->>'display_name',new.raw_user_meta_data->>'full_name',''));
  avatar:=new.raw_user_meta_data->>'avatar_preset';
  update public.workspace_profiles set full_name=case when length(display) between 2 and 200 then display else full_name end,
    avatar_preset=case when avatar in ('forest','sage','ocean','plum','clay','slate') then avatar else avatar_preset end
    where user_id=new.id;
  return new;
end $$;
revoke all on function private.workspace_sync_appearance() from public,anon,authenticated;
create trigger recharge_auth_appearance_updated after update of raw_user_meta_data on auth.users
  for each row execute function private.workspace_sync_appearance();
create table public.workspace_features (
  module_id text primary key, client_module text
);
insert into public.workspace_features(module_id, client_module) values
('daily-pricing', null),
('listing-health', null),
('client-furnishing', 'client-furnishing'),
('safety-maintenance', null),
('purchase-order', 'client-purchase-order-quotes'),
('purchase-order-requests', null),
('client-purchase-order-quotes', 'client-purchase-order-quotes'),
('property-database', null),
('property-onboarding', 'property-onboarding'),
('client-dashboard', null),
('client-property-maintenance', 'client-property-maintenance'),
('weekly-performance', null),
('maintenance-reporting', 'client-property-maintenance'),
('stays-maintenance-reporting', 'client-property-maintenance'),
('clean-reporting', null),
('aircover-reporting', null),
('cleaning-schedule', null),
('cleaner-performance', null),
('clean-client-database', null),
('cleaner-database', null),
('cleans-invoices', null),
('client-mailbox', 'client-mailbox'),
('replenishment-requests', null),
('ready-schedule', null),
('licensing', null),
('direct-bookings', null),
('ota-logins', null),
('guest-communication', null),
('property-furnishing-board', 'client-furnishing'),
('new-property-inspection-board', null),
('routine-bin-garden-board', null),
('clean-property-onboarding', null),
('maintenance-reconciliation', null),
('onboarding-invoices', null),
('purchase-order-invoices', null),
('purchase-order-accounts', null),
('owner-statements', null)
;
create table public.workspace_properties (
  id uuid primary key default gen_random_uuid(), name text not null check (length(trim(name)) between 2 and 200),
  address text not null default '' check(length(address)<=1000), region text not null default '' check(length(region)<=200),
  status text not null default 'onboarding' check(status in ('onboarding','active','archived')),
  bedrooms integer not null default 0 check(bedrooms between 0 and 100),
  created_by uuid not null references public.workspace_profiles(user_id), request_id uuid not null,
  version integer not null default 1 check(version>0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(created_by,request_id)
);
create table public.workspace_property_assignments (
  property_id uuid not null references public.workspace_properties(id), user_id uuid not null references public.workspace_profiles(user_id),
  assignment text not null check(assignment in ('client','cleaner','cleaning_manager','staff')),
  granted_by uuid not null references public.workspace_profiles(user_id), created_at timestamptz not null default now(),
  primary key(property_id,user_id)
);
create index workspace_assignments_user_idx on public.workspace_property_assignments(user_id,property_id);
create index workspace_assignments_granter_idx on public.workspace_property_assignments(granted_by);
create table private.workspace_property_secrets (
  property_id uuid primary key references public.workspace_properties(id), access_instructions text not null default '' check(length(access_instructions)<=10000),
  ota_instructions text not null default '' check(length(ota_instructions)<=10000), updated_at timestamptz not null default now()
);
create table private.workspace_property_financials (
  property_id uuid primary key references public.workspace_properties(id), management_fee_bps integer check(management_fee_bps between 0 and 10000),
  payment_notes text not null default '' check(length(payment_notes)<=10000), updated_at timestamptz not null default now()
);
create table public.workspace_work_items (
  id uuid primary key default gen_random_uuid(), request_id uuid not null,
  property_id uuid not null references public.workspace_properties(id), module_id text not null references public.workspace_features(module_id),
  title text not null check(length(trim(title)) between 2 and 200), description text not null default '' check(length(description)<=10000),
  status text not null default 'waiting' check(status in ('waiting','in_progress','in_review','approved','completed','cancelled','declined')),
  priority text not null default 'normal' check(priority in ('normal','high','urgent')),
  due_on date, assignee_id uuid references public.workspace_profiles(user_id),
  client_visible boolean not null default false, requires_client_approval boolean not null default false,
  created_by uuid not null references public.workspace_profiles(user_id), version integer not null default 1 check(version>0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), completed_at timestamptz,
  unique(created_by,request_id)
);
create index workspace_work_property_idx on public.workspace_work_items(property_id,module_id,created_at desc,id);
create index workspace_work_assignee_idx on public.workspace_work_items(assignee_id,due_on,id);
create index workspace_work_module_date_idx on public.workspace_work_items(module_id,created_at desc,id);
create table public.workspace_work_updates (
  id uuid primary key default gen_random_uuid(), work_id uuid not null references public.workspace_work_items(id),
  actor_id uuid not null references public.workspace_profiles(user_id), request_id uuid not null,
  previous_status text not null, next_status text not null, note text not null default '' check(length(note)<=5000),
  expected_version integer not null, created_at timestamptz not null default now(), unique(actor_id,request_id)
);
create index workspace_work_updates_work_idx on public.workspace_work_updates(work_id,created_at,id);
create table public.workspace_invoices (
  id uuid primary key default gen_random_uuid(), request_id uuid not null,
  property_id uuid not null references public.workspace_properties(id), work_id uuid references public.workspace_work_items(id),
  module_id text not null references public.workspace_features(module_id), recipient_id uuid not null references public.workspace_profiles(user_id),
  reference text not null check(length(reference) between 1 and 100), amount_minor bigint not null check(amount_minor between 0 and 999999999999),
  currency text not null check(currency in ('GBP','USD','EUR')), status text not null default 'issued' check(status in ('issued','paid','void')),
  issued_on date not null default current_date, paid_at timestamptz, created_by uuid not null references public.workspace_profiles(user_id),
  created_at timestamptz not null default now(), version integer not null default 1, unique(created_by,request_id), unique(reference)
);
create index workspace_invoices_property_idx on public.workspace_invoices(property_id,module_id,issued_on,id);
create index workspace_invoices_recipient_idx on public.workspace_invoices(recipient_id,issued_on,id);
create index workspace_invoices_work_idx on public.workspace_invoices(work_id);
create table public.workspace_threads (
  id uuid primary key default gen_random_uuid(), property_id uuid not null references public.workspace_properties(id),
  subject text not null check(length(trim(subject)) between 2 and 200), client_visible boolean not null default false,
  created_by uuid not null references public.workspace_profiles(user_id), request_id uuid not null, created_at timestamptz not null default now(), unique(created_by,request_id)
);
create index workspace_threads_property_idx on public.workspace_threads(property_id,created_at desc,id);
create table public.workspace_messages (
  id uuid primary key default gen_random_uuid(), request_id uuid not null, thread_id uuid not null references public.workspace_threads(id),
  author_id uuid not null references public.workspace_profiles(user_id), body text not null check(length(trim(body)) between 1 and 5000),
  created_at timestamptz not null default now(), unique(author_id,request_id)
);
create index workspace_messages_thread_idx on public.workspace_messages(thread_id,created_at,id);
create table public.workspace_activity (
  id bigint generated always as identity primary key, actor_id uuid references public.workspace_profiles(user_id),
  property_id uuid references public.workspace_properties(id), work_id uuid references public.workspace_work_items(id),
  event_type text not null, created_at timestamptz not null default now()
);
create index workspace_activity_property_idx on public.workspace_activity(property_id,created_at desc,id);
create index workspace_activity_work_idx on public.workspace_activity(work_id);
create index workspace_activity_actor_idx on public.workspace_activity(actor_id,created_at desc,id);
create table private.workspace_device_tokens (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.workspace_profiles(user_id),
  device_id uuid not null, push_token text not null check(length(push_token) between 20 and 200),
  platform text not null check(platform in ('ios','android')), updated_at timestamptz not null default now(), unique(user_id,device_id), unique(push_token)
);
create table private.workspace_notification_outbox (
  id bigint generated always as identity primary key, user_id uuid not null references public.workspace_profiles(user_id),
  work_id uuid references public.workspace_work_items(id), event_id bigint not null references public.workspace_activity(id),
  delivered_at timestamptz, attempts integer not null default 0, next_attempt_at timestamptz not null default now(),
  unique(user_id,event_id)
);
create index workspace_devices_user_idx on private.workspace_device_tokens(user_id);
create index workspace_notification_pending_idx on private.workspace_notification_outbox(next_attempt_at,id) where delivered_at is null;
create index workspace_notification_user_idx on private.workspace_notification_outbox(user_id);
create index workspace_notification_work_idx on private.workspace_notification_outbox(work_id);
create index workspace_notification_event_idx on private.workspace_notification_outbox(event_id);
create table private.workspace_write_limits (
  user_id uuid primary key references public.workspace_profiles(user_id),
  window_started_at timestamptz not null default now(), writes integer not null default 0
);
alter table private.workspace_write_limits enable row level security;
revoke all on private.workspace_write_limits from public,anon,authenticated;

create function private.workspace_actor_role() returns text language sql stable security definer set search_path='' as $$
  select role from public.workspace_profiles where user_id=auth.uid() and status='active' and private.has_workspace_session();
$$;
create function private.workspace_can_property(target uuid, feature text) returns boolean language sql stable security definer set search_path='' as $$
  select private.has_workspace_module(feature) and (
    private.workspace_actor_role() in ('admin','super_admin') or exists (
      select 1 from public.workspace_property_assignments a where a.property_id=target and a.user_id=auth.uid()
        and a.assignment=case private.workspace_actor_role() when 'client' then 'client' when 'cleans' then 'cleaner' when 'cleaning_manager' then 'cleaning_manager' else 'staff' end
    )
  );
$$;
create function private.workspace_can_work(target uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.workspace_work_items w join public.workspace_features f using(module_id) where w.id=target and (
    (private.workspace_actor_role()='client' and w.client_visible and f.client_module is not null and private.workspace_can_property(w.property_id,f.client_module)) or
    (private.workspace_actor_role()='cleans' and w.assignee_id=auth.uid() and private.workspace_can_property(w.property_id,w.module_id)) or
    (private.workspace_actor_role() not in ('client','cleans') and private.workspace_can_property(w.property_id,w.module_id))
  ));
$$;
create function private.workspace_can_thread(target uuid) returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.workspace_threads t where t.id=target and (
    (private.workspace_actor_role()='client' and t.client_visible and private.workspace_can_property(t.property_id,'client-mailbox')) or
    (private.workspace_actor_role() not in ('client','cleans') and private.workspace_can_property(t.property_id,'guest-communication'))
  ));
$$;
revoke all on function private.workspace_actor_role(),private.workspace_can_property(uuid,text),private.workspace_can_work(uuid),private.workspace_can_thread(uuid) from public,anon,authenticated;
grant execute on function private.workspace_actor_role(),private.workspace_can_property(uuid,text),private.workspace_can_work(uuid),private.workspace_can_thread(uuid) to authenticated;
-- Enforced inside PostgreSQL too, so a valid user cannot evade write limits via direct REST RPCs.
create function private.workspace_enforce_write_limit() returns trigger language plpgsql security definer set search_path='' as $$
declare total integer;
begin
  if auth.uid() is null then
    if tg_op='DELETE' then return old; end if;
    return new; -- trusted database administration; clients have no direct-write grants
  end if;
  if private.workspace_actor_role() is null then raise exception 'Active workspace access required' using errcode='42501'; end if;
  insert into private.workspace_write_limits(user_id,writes) values(auth.uid(),1)
  on conflict(user_id) do update set
    writes=case when workspace_write_limits.window_started_at<=now()-interval '1 minute' then 1 else workspace_write_limits.writes+1 end,
    window_started_at=case when workspace_write_limits.window_started_at<=now()-interval '1 minute' then now() else workspace_write_limits.window_started_at end
  returning writes into total;
  if total>60 then raise exception 'Too many changes. Wait a minute before trying again' using errcode='P0429'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function private.workspace_enforce_write_limit() from public,anon,authenticated;
do $$ declare t text; begin
  foreach t in array array['workspace_properties','workspace_property_assignments','workspace_work_items','workspace_invoices','workspace_threads','workspace_messages'] loop
    execute format('create trigger business_write_limit before insert or update or delete on public.%I for each row execute function private.workspace_enforce_write_limit()',t);
  end loop;
end $$;

do $$ declare t text; begin
  foreach t in array array['workspace_features','workspace_properties','workspace_property_assignments','workspace_work_items','workspace_work_updates','workspace_invoices','workspace_threads','workspace_messages','workspace_activity'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon,authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
  end loop;
  foreach t in array array['workspace_property_secrets','workspace_property_financials','workspace_device_tokens','workspace_notification_outbox'] loop
    execute format('alter table private.%I enable row level security',t);
    execute format('revoke all on private.%I from public,anon,authenticated',t);
  end loop;
end $$;
revoke all on sequence public.workspace_activity_id_seq,private.workspace_notification_outbox_id_seq from public,anon,authenticated;
create policy features_active on public.workspace_features for select to authenticated using ((select private.workspace_actor_role()) is not null);
create policy properties_assigned on public.workspace_properties for select to authenticated using (
  (select private.workspace_actor_role()) in ('admin','super_admin') or exists (
    select 1 from public.workspace_property_assignments a where a.property_id=id and a.user_id=(select auth.uid())
  )
);
create policy assignments_admin_or_self on public.workspace_property_assignments for select to authenticated using (
  (select private.workspace_actor_role()) in ('admin','super_admin') or ((select private.workspace_actor_role()) is not null and user_id=(select auth.uid()))
);
create policy work_scoped on public.workspace_work_items for select to authenticated using(private.workspace_can_work(id));
create policy updates_scoped on public.workspace_work_updates for select to authenticated using(private.workspace_can_work(work_id));
create policy invoices_scoped on public.workspace_invoices for select to authenticated using(
  ((select private.workspace_actor_role())='client' and recipient_id=(select auth.uid()) and private.workspace_can_property(property_id,'client-dashboard')) or
  ((select private.workspace_actor_role())<>'client' and private.workspace_can_property(property_id,module_id) and ((select private.workspace_actor_role())<>'cleans' or recipient_id=(select auth.uid())))
);
create policy threads_scoped on public.workspace_threads for select to authenticated using(private.workspace_can_thread(id));
create policy messages_scoped on public.workspace_messages for select to authenticated using(private.workspace_can_thread(thread_id));
create policy activity_scoped on public.workspace_activity for select to authenticated using (
  (select private.workspace_actor_role()) in ('admin','super_admin') or (
    (select private.workspace_actor_role()) is not null and (
      actor_id=(select auth.uid()) or (work_id is not null and private.workspace_can_work(work_id))
    )
  )
);

-- Audit has no description, contact, account or access-code payload. Users cannot forge it.
create function private.workspace_record_activity() returns trigger language plpgsql security definer set search_path='' as $$
declare event_id bigint; target_property uuid; target_work uuid; recipient uuid;
begin
  if tg_table_name='workspace_properties' then target_property:=new.id;
  elsif tg_table_name='workspace_work_items' then target_property:=new.property_id; target_work:=new.id; recipient:=new.assignee_id;
  elsif tg_table_name='workspace_invoices' then target_property:=new.property_id; target_work:=new.work_id; recipient:=new.recipient_id;
  else target_property:=case when tg_op='DELETE' then old.property_id else new.property_id end; end if;
  insert into public.workspace_activity(actor_id,property_id,work_id,event_type)
    values(auth.uid(),target_property,target_work,tg_table_name || '.' || lower(tg_op)) returning id into event_id;
  if recipient is not null and recipient is distinct from auth.uid() then
    insert into private.workspace_notification_outbox(user_id,work_id,event_id) values(recipient,target_work,event_id);
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;
revoke all on function private.workspace_record_activity() from public,anon,authenticated;
create trigger property_activity after insert or update on public.workspace_properties for each row execute function private.workspace_record_activity();
create trigger work_activity after insert or update on public.workspace_work_items for each row execute function private.workspace_record_activity();
create trigger invoice_activity after insert or update on public.workspace_invoices for each row execute function private.workspace_record_activity();
create trigger assignment_activity after insert or update or delete on public.workspace_property_assignments for each row execute function private.workspace_record_activity();

create function private.workspace_save_property(input jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid; previous public.workspace_properties;
begin
  if private.workspace_actor_role() not in ('admin','super_admin') or private.workspace_actor_role() is null then raise exception 'Admin access required' using errcode='42501'; end if;
  if jsonb_typeof(input)<>'object' or input is null or exists(select 1 from jsonb_object_keys(input) k where k not in ('id','version','requestId','name','address','region','bedrooms','status')) then raise exception 'Invalid property fields' using errcode='22023'; end if;
  target:=nullif(input->>'id','')::uuid;
  if target is null then
    if input->>'requestId' is null then raise exception 'Request identifier required' using errcode='22023'; end if;
    perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||(input->>'requestId'),0));
    select * into previous from public.workspace_properties where created_by=auth.uid() and request_id=(input->>'requestId')::uuid;
    if found then
      if previous.name is distinct from input->>'name' or previous.address is distinct from coalesce(input->>'address','') or previous.region is distinct from coalesce(input->>'region','') or previous.bedrooms is distinct from coalesce((input->>'bedrooms')::integer,0) or previous.status is distinct from coalesce(input->>'status','onboarding') then raise exception 'Request identifier already used' using errcode='22023'; end if;
      return previous.id;
    end if;
    insert into public.workspace_properties(name,address,region,bedrooms,status,created_by,request_id)
      values(input->>'name',coalesce(input->>'address',''),coalesce(input->>'region',''),coalesce((input->>'bedrooms')::integer,0),coalesce(input->>'status','onboarding'),auth.uid(),(input->>'requestId')::uuid) returning id into target;
  else
    select * into previous from public.workspace_properties where id=target for update;
    if not found then raise exception 'Property not found' using errcode='P0002'; end if;
    if previous.version is distinct from (input->>'version')::integer then raise exception 'Record changed. Refresh and try again' using errcode='40001'; end if;
    update public.workspace_properties set name=input->>'name',address=coalesce(input->>'address',''),region=coalesce(input->>'region',''),bedrooms=coalesce((input->>'bedrooms')::integer,0),status=coalesce(input->>'status','onboarding'),version=version+1,updated_at=now() where id=target;
  end if;
  return target;
end $$;
create function private.workspace_assign_property(target_property uuid,target_user uuid,assignment_kind text) returns void language plpgsql security definer set search_path='' as $$
declare target_role text;
begin
  if coalesce(private.workspace_actor_role(),'') not in ('admin','super_admin') then raise exception 'Admin access required' using errcode='42501'; end if;
  select role into target_role from public.workspace_profiles where user_id=target_user and status='active';
  if target_role is null or assignment_kind is null or assignment_kind<>(case target_role when 'client' then 'client' when 'cleans' then 'cleaner' when 'cleaning_manager' then 'cleaning_manager' else 'staff' end) then raise exception 'Active account and matching assignment required' using errcode='22023'; end if;
  insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values(target_property,target_user,assignment_kind,auth.uid())
    on conflict(property_id,user_id) do update set assignment=excluded.assignment,granted_by=excluded.granted_by;
end $$;
create function private.workspace_unassign_property(target_property uuid,target_user uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  if coalesce(private.workspace_actor_role(),'') not in ('admin','super_admin') then raise exception 'Admin access required' using errcode='42501'; end if;
  delete from public.workspace_property_assignments where property_id=target_property and user_id=target_user;
end $$;

create function private.workspace_create_work(input jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid; actor_role text:=private.workspace_actor_role(); property uuid; feature text; client_feature text; assigned uuid; existing public.workspace_work_items; visible boolean;
begin
  if actor_role is null then raise exception 'Active workspace access required' using errcode='42501'; end if;
  if input is null or jsonb_typeof(input)<>'object' or exists(select 1 from jsonb_object_keys(input) k where k not in ('requestId','propertyId','moduleId','title','description','priority','dueOn','assigneeId','clientVisible')) then raise exception 'Invalid work fields' using errcode='22023'; end if;
  property:=(input->>'propertyId')::uuid; feature:=input->>'moduleId'; assigned:=nullif(input->>'assigneeId','')::uuid;
  select client_module into client_feature from public.workspace_features where module_id=feature;
  if actor_role='cleans' or (actor_role='client' and (client_feature is null or not private.workspace_can_property(property,client_feature))) or (actor_role<>'client' and not private.workspace_can_property(property,feature)) then raise exception 'Work access denied' using errcode='42501'; end if;
  if actor_role='client' and (assigned is not null or coalesce(input->>'priority','normal')<>'normal') then raise exception 'Only staff can assign or prioritise work' using errcode='42501'; end if;
  if assigned is not null and not exists(select 1 from public.workspace_profiles p join public.workspace_property_assignments a on a.user_id=p.user_id where p.user_id=assigned and p.status='active' and p.role<>'client' and a.property_id=property and a.assignment=(case p.role when 'cleans' then 'cleaner' when 'cleaning_manager' then 'cleaning_manager' else 'staff' end) and (p.role in ('admin','super_admin') or exists(select 1 from public.workspace_module_grants g where g.user_id=p.user_id and g.module_id=feature))) then raise exception 'Assignee requires active property and tool access' using errcode='22023'; end if;
  visible:=actor_role='client' or coalesce((input->>'clientVisible')::boolean,false);
  -- Concurrent retries serialize on the actor/request pair, before duplicate detection.
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||(input->>'requestId'),0));
  select * into existing from public.workspace_work_items where created_by=auth.uid() and request_id=(input->>'requestId')::uuid;
  if found then
    if existing.property_id is distinct from property or existing.module_id is distinct from feature or existing.title is distinct from input->>'title' or existing.description is distinct from coalesce(input->>'description','') or existing.assignee_id is distinct from assigned or existing.due_on is distinct from nullif(input->>'dueOn','')::date or existing.priority is distinct from coalesce(input->>'priority','normal') or existing.client_visible is distinct from visible then raise exception 'Request identifier already used' using errcode='22023'; end if;
    return existing.id;
  end if;
  insert into public.workspace_work_items(request_id,property_id,module_id,title,description,priority,due_on,assignee_id,client_visible,created_by)
    values((input->>'requestId')::uuid,property,feature,input->>'title',coalesce(input->>'description',''),coalesce(input->>'priority','normal'),nullif(input->>'dueOn','')::date,assigned,visible,auth.uid()) returning id into target;
  return target;
end $$;
create function private.workspace_transition_work(target_work uuid,expected_version integer,next_status text,note text,request_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare item public.workspace_work_items; prior public.workspace_work_updates; actor_role text:=private.workspace_actor_role(); target uuid;
begin
  if not private.workspace_can_work(target_work) then raise exception 'Work access denied' using errcode='42501'; end if;
  if next_status is null or note is null or length(note)>5000 or request_id is null then raise exception 'Invalid update' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||request_id::text,0));
  select * into prior from public.workspace_work_updates u where u.actor_id=auth.uid() and u.request_id=workspace_transition_work.request_id;
  if found then
    if prior.work_id is distinct from target_work or prior.next_status is distinct from next_status or prior.note is distinct from note or prior.expected_version is distinct from expected_version then raise exception 'Request identifier already used' using errcode='22023'; end if;
    return prior.id;
  end if;
  select * into item from public.workspace_work_items where id=target_work for update;
  if item.version is distinct from expected_version then raise exception 'Record changed. Refresh and try again' using errcode='40001'; end if;
  if actor_role='cleans' then
    if not ((item.status='waiting' and next_status='in_progress') or (item.status='in_progress' and next_status='in_review')) then raise exception 'Cleaner can only start and submit their assigned job' using errcode='42501'; end if;
  elsif actor_role='client' then
    if not ((item.created_by=auth.uid() and item.status='waiting' and next_status='cancelled') or (item.requires_client_approval and item.status='in_review' and next_status in ('approved','declined'))) then raise exception 'Client action denied' using errcode='42501'; end if;
  else
    if next_status='approved' and actor_role not in ('admin','super_admin','cleaning_manager','stays') then raise exception 'Approval permission required' using errcode='42501'; end if;
    if next_status='approved' and actor_role not in ('admin','super_admin') and (item.assignee_id=auth.uid() or (item.created_by=auth.uid() and item.module_id<>'cleaning-schedule')) then raise exception 'Another reviewer must approve this work' using errcode='42501'; end if;
    if not ((item.status='waiting' and next_status in ('in_progress','cancelled')) or (item.status='in_progress' and next_status in ('in_review','cancelled')) or (item.status='in_review' and next_status in ('approved','declined','in_progress')) or (item.status='approved' and next_status='completed') or (item.status='declined' and next_status='in_progress')) then raise exception 'Invalid status transition' using errcode='22023'; end if;
    if item.requires_client_approval and next_status in ('approved','declined') and actor_role not in ('admin','super_admin') then raise exception 'Client approval required' using errcode='42501'; end if;
  end if;
  update public.workspace_work_items set status=next_status,version=version+1,updated_at=now(),completed_at=case when next_status='completed' then now() else null end where id=target_work;
  insert into public.workspace_work_updates(work_id,actor_id,request_id,previous_status,next_status,note,expected_version)
    values(target_work,auth.uid(),request_id,item.status,next_status,note,expected_version) returning id into target;
  return target;
end $$;

-- Wrappers never execute as the database owner. Private definers validate the caller.
create function public.workspace_save_property(input jsonb) returns uuid language sql security invoker set search_path='' as $$ select private.workspace_save_property(input); $$;
create function public.workspace_assign_property(target_property uuid,target_user uuid,assignment_kind text) returns void language sql security invoker set search_path='' as $$ select private.workspace_assign_property(target_property,target_user,assignment_kind); $$;
create function public.workspace_unassign_property(target_property uuid,target_user uuid) returns void language sql security invoker set search_path='' as $$ select private.workspace_unassign_property(target_property,target_user); $$;
create function public.workspace_create_work(input jsonb) returns uuid language sql security invoker set search_path='' as $$ select private.workspace_create_work(input); $$;
create function public.workspace_transition_work(target_work uuid,expected_version integer,next_status text,note text,request_id uuid) returns uuid language sql security invoker set search_path='' as $$ select private.workspace_transition_work(target_work,expected_version,next_status,note,request_id); $$;
create function private.workspace_assign_work(target_work uuid,expected_version integer,target_user uuid) returns void language plpgsql security definer set search_path='' as $$
declare item public.workspace_work_items;
begin
  if coalesce(private.workspace_actor_role(),'') in ('','client','cleans') or not private.workspace_can_work(target_work) then raise exception 'Assignment permission required' using errcode='42501'; end if;
  select * into item from public.workspace_work_items where id=target_work for update;
  if item.version is distinct from expected_version then raise exception 'Record changed. Refresh and try again' using errcode='40001'; end if;
  if item.status in ('completed','cancelled') then raise exception 'Closed work cannot be reassigned' using errcode='22023'; end if;
  if target_user is not null and not exists(select 1 from public.workspace_profiles p join public.workspace_property_assignments a on a.user_id=p.user_id where p.user_id=target_user and p.status='active' and p.role<>'client' and a.property_id=item.property_id and a.assignment=(case p.role when 'cleans' then 'cleaner' when 'cleaning_manager' then 'cleaning_manager' else 'staff' end) and (p.role in ('admin','super_admin') or exists(select 1 from public.workspace_module_grants g where g.user_id=p.user_id and g.module_id=item.module_id))) then raise exception 'Assignee requires active property and tool access' using errcode='22023'; end if;
  update public.workspace_work_items set assignee_id=target_user,version=version+1,updated_at=now() where id=target_work;
end $$;
create function private.workspace_request_client_approval(target_work uuid,expected_version integer) returns void language plpgsql security definer set search_path='' as $$
declare item public.workspace_work_items;
begin
  if coalesce(private.workspace_actor_role(),'') in ('','client','cleans') or not private.workspace_can_work(target_work) then raise exception 'Approval request permission required' using errcode='42501'; end if;
  select * into item from public.workspace_work_items where id=target_work for update;
  if item.version is distinct from expected_version then raise exception 'Record changed. Refresh and try again' using errcode='40001'; end if;
  if item.status<>'in_progress' or not exists(select 1 from public.workspace_features f where f.module_id=item.module_id and f.client_module is not null) then raise exception 'This work cannot request client approval' using errcode='22023'; end if;
  update public.workspace_work_items set client_visible=true,requires_client_approval=true,status='in_review',version=version+1,updated_at=now() where id=target_work;
end $$;
create function private.workspace_create_invoice(input jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid; previous public.workspace_invoices; property uuid; feature text; recipient uuid; work uuid;
begin
  if input is null or jsonb_typeof(input)<>'object' or exists(select 1 from jsonb_object_keys(input) k where k not in ('requestId','propertyId','moduleId','workId','recipientId','reference','amountMinor','currency','issuedOn')) then raise exception 'Invalid invoice fields' using errcode='22023'; end if;
  property:=(input->>'propertyId')::uuid;feature:=input->>'moduleId';recipient:=(input->>'recipientId')::uuid;work:=nullif(input->>'workId','')::uuid;
  if coalesce(private.workspace_actor_role(),'') in ('','client','cleans') or feature is null or feature not in ('cleans-invoices','onboarding-invoices','purchase-order-invoices','purchase-order-accounts','maintenance-reconciliation','owner-statements') or not private.workspace_can_property(property,feature) then raise exception 'Invoice permission required' using errcode='42501'; end if;
  if not exists(select 1 from public.workspace_property_assignments a join public.workspace_profiles p on p.user_id=a.user_id where a.user_id=recipient and a.property_id=property and p.status='active') then raise exception 'Recipient must have active property access' using errcode='22023'; end if;
  if work is not null and not exists(select 1 from public.workspace_work_items w where w.id=work and w.property_id=property and w.status in ('approved','completed')) then raise exception 'Invoice requires approved work from the same property' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||(input->>'requestId'),0));
  select * into previous from public.workspace_invoices where created_by=auth.uid() and request_id=(input->>'requestId')::uuid;
  if found then
    if previous.property_id is distinct from property or previous.module_id is distinct from feature or previous.work_id is distinct from work or previous.recipient_id is distinct from recipient or previous.reference is distinct from input->>'reference' or previous.amount_minor is distinct from (input->>'amountMinor')::bigint or previous.currency is distinct from input->>'currency' or previous.issued_on is distinct from coalesce(nullif(input->>'issuedOn','')::date,current_date) then raise exception 'Request identifier already used' using errcode='22023'; end if;
    return previous.id;
  end if;
  insert into public.workspace_invoices(request_id,property_id,work_id,module_id,recipient_id,reference,amount_minor,currency,issued_on,created_by)
    values((input->>'requestId')::uuid,property,work,feature,recipient,input->>'reference',(input->>'amountMinor')::bigint,input->>'currency',coalesce(nullif(input->>'issuedOn','')::date,current_date),auth.uid()) returning id into target;
  return target;
end $$;
create function private.workspace_set_invoice_status(target_invoice uuid,expected_version integer,next_status text) returns void language plpgsql security definer set search_path='' as $$
declare previous public.workspace_invoices;
begin
  if coalesce(private.workspace_actor_role(),'') not in ('admin','super_admin') then raise exception 'Admin payment confirmation required' using errcode='42501'; end if;
  select * into previous from public.workspace_invoices where id=target_invoice for update;
  if not found then raise exception 'Invoice not found' using errcode='P0002'; end if;
  if previous.version is distinct from expected_version then raise exception 'Record changed. Refresh and try again' using errcode='40001'; end if;
  if previous.status<>'issued' or next_status is null or next_status not in ('paid','void') then raise exception 'Invalid invoice transition' using errcode='22023'; end if;
  update public.workspace_invoices set status=next_status,paid_at=case when next_status='paid' then now() else null end,version=version+1 where id=target_invoice;
end $$;
create function private.workspace_create_thread(target_property uuid,subject text,client_visible boolean,request_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid; actor_role text:=private.workspace_actor_role(); previous public.workspace_threads; visible boolean;
begin
  if actor_role is null or actor_role='cleans' or not private.workspace_can_property(target_property,case when actor_role='client' then 'client-mailbox' else 'guest-communication' end) then raise exception 'Communication access denied' using errcode='42501'; end if;
  if request_id is null then raise exception 'Request identifier required' using errcode='22023'; end if;
  visible:=actor_role='client' or coalesce(client_visible,false);
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||request_id::text,0));
  select * into previous from public.workspace_threads t where t.created_by=auth.uid() and t.request_id=workspace_create_thread.request_id;
  if found then
    if previous.property_id is distinct from target_property or previous.subject is distinct from subject or previous.client_visible is distinct from visible then raise exception 'Request identifier already used' using errcode='22023'; end if;
    return previous.id;
  end if;
  insert into public.workspace_threads(property_id,subject,client_visible,created_by,request_id) values(target_property,subject,visible,auth.uid(),request_id) returning id into target;
  return target;
end $$;
create function private.workspace_send_message(target_thread uuid,message_body text,request_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid; previous public.workspace_messages;
begin
  if not private.workspace_can_thread(target_thread) then raise exception 'Communication access denied' using errcode='42501'; end if;
  if request_id is null then raise exception 'Request identifier required' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||request_id::text,0));
  select * into previous from public.workspace_messages m where m.author_id=auth.uid() and m.request_id=workspace_send_message.request_id;
  if found then
    if previous.thread_id is distinct from target_thread or previous.body is distinct from message_body then raise exception 'Request identifier already used' using errcode='22023'; end if;
    return previous.id;
  end if;
  insert into public.workspace_messages(request_id,thread_id,author_id,body) values(request_id,target_thread,auth.uid(),message_body) returning id into target;
  insert into public.workspace_activity(actor_id,property_id,event_type) select auth.uid(),property_id,'message.sent' from public.workspace_threads where id=target_thread;
  return target;
end $$;
create function private.workspace_property_details(target_property uuid,section text) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if private.workspace_actor_role() is null then raise exception 'Active workspace access required' using errcode='42501'; end if;
  if section='access' then
    if not ((private.workspace_actor_role() not in ('client','cleans') and (private.workspace_can_property(target_property,'property-database') or private.workspace_can_property(target_property,'ota-logins'))) or (private.workspace_actor_role()='cleans' and private.workspace_can_property(target_property,'cleaning-schedule') and exists(select 1 from public.workspace_work_items where property_id=target_property and assignee_id=auth.uid() and status in ('waiting','in_progress')))) then raise exception 'Property access denied' using errcode='42501'; end if;
    if private.workspace_actor_role()='cleans' then return coalesce((select jsonb_build_object('accessInstructions',access_instructions) from private.workspace_property_secrets where property_id=target_property),'{}'::jsonb); end if;
    return coalesce((select jsonb_build_object('accessInstructions',access_instructions,'otaInstructions',ota_instructions) from private.workspace_property_secrets where property_id=target_property),'{}'::jsonb);
  elsif section='finance' then
    if not private.workspace_can_property(target_property,'owner-statements') then raise exception 'Financial access denied' using errcode='42501'; end if;
    return coalesce((select jsonb_build_object('managementFeeBps',management_fee_bps,'paymentNotes',payment_notes) from private.workspace_property_financials where property_id=target_property),'{}'::jsonb);
  else raise exception 'Invalid section' using errcode='22023'; end if;
end $$;
create function private.workspace_save_property_details(target_property uuid,expected_version integer,section text,input jsonb) returns void language plpgsql security definer set search_path='' as $$
declare previous public.workspace_properties;
begin
  if coalesce(private.workspace_actor_role(),'') not in ('admin','super_admin') then raise exception 'Admin access required' using errcode='42501'; end if;
  if input is null or jsonb_typeof(input)<>'object' then raise exception 'Invalid property details' using errcode='22023'; end if;
  select * into previous from public.workspace_properties where id=target_property for update;
  if not found then raise exception 'Property not found' using errcode='P0002'; end if;
  if previous.version is distinct from expected_version then raise exception 'Record changed. Refresh and try again' using errcode='40001'; end if;
  if section='access' then
    if exists(select 1 from jsonb_object_keys(input) k where k not in ('accessInstructions','otaInstructions')) then raise exception 'Invalid access fields' using errcode='22023'; end if;
    insert into private.workspace_property_secrets(property_id,access_instructions,ota_instructions) values(target_property,coalesce(input->>'accessInstructions',''),coalesce(input->>'otaInstructions','')) on conflict(property_id) do update set access_instructions=excluded.access_instructions,ota_instructions=excluded.ota_instructions,updated_at=now();
  elsif section='finance' then
    if exists(select 1 from jsonb_object_keys(input) k where k not in ('managementFeeBps','paymentNotes')) then raise exception 'Invalid finance fields' using errcode='22023'; end if;
    insert into private.workspace_property_financials(property_id,management_fee_bps,payment_notes) values(target_property,(input->>'managementFeeBps')::integer,coalesce(input->>'paymentNotes','')) on conflict(property_id) do update set management_fee_bps=excluded.management_fee_bps,payment_notes=excluded.payment_notes,updated_at=now();
  else raise exception 'Invalid section' using errcode='22023'; end if;
  update public.workspace_properties set version=version+1,updated_at=now() where id=target_property;
  insert into public.workspace_activity(actor_id,property_id,event_type) values(auth.uid(),target_property,'property_details.'||section||'.updated');
end $$;
create function private.workspace_register_device(device_id uuid,push_token text,platform text) returns void language plpgsql security definer set search_path='' as $$
begin
  if private.workspace_actor_role() is null then raise exception 'Active workspace access required' using errcode='42501'; end if;
  if device_id is null or push_token is null or push_token !~ '^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$' or platform is null or platform not in ('ios','android') then raise exception 'Invalid device registration' using errcode='22023'; end if;
  delete from private.workspace_device_tokens d where d.push_token=workspace_register_device.push_token or (d.user_id=auth.uid() and d.device_id=workspace_register_device.device_id);
  insert into private.workspace_device_tokens(user_id,device_id,push_token,platform) values(auth.uid(),device_id,push_token,platform);
end $$;
create function private.workspace_unregister_device(device_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.has_workspace_session() then raise exception 'Sign-in required' using errcode='42501'; end if;
  delete from private.workspace_device_tokens d where d.user_id=auth.uid() and d.device_id=workspace_unregister_device.device_id;
end $$;
create function public.workspace_assign_work(target_work uuid,expected_version integer,target_user uuid) returns void language sql security invoker set search_path='' as $$ select private.workspace_assign_work(target_work,expected_version,target_user); $$;
create function public.workspace_request_client_approval(target_work uuid,expected_version integer) returns void language sql security invoker set search_path='' as $$ select private.workspace_request_client_approval(target_work,expected_version); $$;
create function public.workspace_create_invoice(input jsonb) returns uuid language sql security invoker set search_path='' as $$ select private.workspace_create_invoice(input); $$;
create function public.workspace_set_invoice_status(target_invoice uuid,expected_version integer,next_status text) returns void language sql security invoker set search_path='' as $$ select private.workspace_set_invoice_status(target_invoice,expected_version,next_status); $$;
create function public.workspace_create_thread(target_property uuid,subject text,client_visible boolean,request_id uuid) returns uuid language sql security invoker set search_path='' as $$ select private.workspace_create_thread(target_property,subject,client_visible,request_id); $$;
create function public.workspace_send_message(target_thread uuid,message_body text,request_id uuid) returns uuid language sql security invoker set search_path='' as $$ select private.workspace_send_message(target_thread,message_body,request_id); $$;
create function public.workspace_property_details(target_property uuid,section text) returns jsonb language sql security invoker set search_path='' as $$ select private.workspace_property_details(target_property,section); $$;
create function public.workspace_save_property_details(target_property uuid,expected_version integer,section text,input jsonb) returns void language sql security invoker set search_path='' as $$ select private.workspace_save_property_details(target_property,expected_version,section,input); $$;
create function public.workspace_register_device(device_id uuid,push_token text,platform text) returns void language sql security invoker set search_path='' as $$ select private.workspace_register_device(device_id,push_token,platform); $$;
create function public.workspace_unregister_device(device_id uuid) returns void language sql security invoker set search_path='' as $$ select private.workspace_unregister_device(device_id); $$;
do $$ declare f record; begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('private','public') and p.proname in ('workspace_assign_work','workspace_request_client_approval','workspace_create_invoice','workspace_set_invoice_status','workspace_create_thread','workspace_send_message','workspace_property_details','workspace_save_property_details','workspace_register_device','workspace_unregister_device') loop
    execute format('revoke all on function %s from public,anon,authenticated',f.sig);
    execute format('grant execute on function %s to authenticated',f.sig);
  end loop;
end $$;
revoke all on function private.workspace_save_property(jsonb),private.workspace_assign_property(uuid,uuid,text),private.workspace_unassign_property(uuid,uuid),private.workspace_create_work(jsonb),private.workspace_transition_work(uuid,integer,text,text,uuid) from public,anon,authenticated;
revoke all on function public.workspace_save_property(jsonb),public.workspace_assign_property(uuid,uuid,text),public.workspace_unassign_property(uuid,uuid),public.workspace_create_work(jsonb),public.workspace_transition_work(uuid,integer,text,text,uuid) from public,anon,authenticated;
grant execute on function private.workspace_save_property(jsonb),private.workspace_assign_property(uuid,uuid,text),private.workspace_unassign_property(uuid,uuid),private.workspace_create_work(jsonb),private.workspace_transition_work(uuid,integer,text,text,uuid) to authenticated;
grant execute on function public.workspace_save_property(jsonb),public.workspace_assign_property(uuid,uuid,text),public.workspace_unassign_property(uuid,uuid),public.workspace_create_work(jsonb),public.workspace_transition_work(uuid,integer,text,text,uuid) to authenticated;
-- RLS runs as the caller before aggregation. This returns counts, never ticket text.
create function public.workspace_report(from_date date,to_date date) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare role text; series jsonb; property_count bigint;
begin
  role:=private.workspace_actor_role();
  if role is null then raise exception 'Active workspace access required' using errcode='42501'; end if;
  if from_date is null or to_date is null or to_date<from_date or to_date-from_date>731 then raise exception 'Invalid report period' using errcode='22023'; end if;
  with classified as (
    select (w.created_at at time zone 'Europe/London')::date date,
      case when w.module_id in ('maintenance-reporting','stays-maintenance-reporting','client-property-maintenance') then 'repairs'
        when w.module_id in ('cleaning-schedule','cleaner-performance','clean-reporting','clean-property-onboarding') then 'cleans'
        when w.module_id='property-onboarding' then 'onboarding'
        when w.module_id='client-mailbox' then 'mail' else 'workflows' end source,
      case when w.status='completed' then 'complete' when w.status in ('waiting','in_review','declined') then 'waiting' else 'progress' end status
    from public.workspace_work_items w where w.status<>'cancelled' and w.created_at >= (from_date::timestamp at time zone 'Europe/London') and w.created_at < ((to_date+1)::timestamp at time zone 'Europe/London')
  ), counts as (select date,source,status,count(*) count from classified group by date,source,status)
  select coalesce(jsonb_agg(jsonb_build_object('date',date,'source',source,'status',status,'count',count) order by date,source,status),'[]'::jsonb) into series from counts;
  select count(*) into property_count from public.workspace_properties where status<>'archived';
  return jsonb_build_object('series',series,'propertyCount',property_count,'role',role);
end $$;
revoke all on function public.workspace_report(date,date) from public,anon,authenticated;
grant execute on function public.workspace_report(date,date) to authenticated;
notify pgrst,'reload schema';
