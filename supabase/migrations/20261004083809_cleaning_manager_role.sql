-- Separate personal cleaner access from team oversight. No accounts are promoted.
alter table public.workspace_profiles drop constraint workspace_profiles_role_check;
alter table public.workspace_profiles add constraint workspace_profiles_role_check
  check (role in ('super_admin', 'admin', 'stays', 'cleans', 'cleaning_manager', 'ready', 'client'));

create or replace function private.has_workspace_module(requested_module text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_workspace_session() and exists (
    select 1 from public.workspace_profiles p where p.user_id = auth.uid() and p.status = 'active'
      and (p.role <> 'cleans' or requested_module in ('cleaning-schedule', 'cleaner-performance', 'cleans-invoices'))
      and (p.role in ('super_admin', 'admin') or exists (
        select 1 from public.workspace_module_grants g where g.user_id = p.user_id and g.module_id = requested_module
      ))
  );
$$;

create or replace function private.workspace_save_access(target_email text, next_name text, next_role text, next_status text, next_modules text[], next_responsibilities text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_role text; target_id uuid; previous_role text; previous_modules jsonb;
begin
  if not private.has_workspace_session() then raise exception 'Verified sign-in required' using errcode = '42501'; end if;
  if next_role = 'cleans' and exists (select 1 from unnest(next_modules) m where m not in ('cleaning-schedule', 'cleaner-performance', 'cleans-invoices')) then raise exception 'Cleaner access is limited to personal jobs, performance and invoices' using errcode = '42501'; end if;
  -- Serialize role changes, preventing two super-admins demoting each other concurrently.
  lock table public.workspace_profiles in share row exclusive mode;
  select role into actor_role from public.workspace_profiles where user_id = auth.uid() and status = 'active';
  if actor_role is null or actor_role not in ('super_admin', 'admin') then raise exception 'Admin access required' using errcode = '42501'; end if;
  select id into target_id from auth.users where lower(email) = lower(trim(target_email));
  if target_id is null then raise exception 'Create the sign-in account in Supabase first'; end if;
  if next_status = 'active' and not exists (select 1 from auth.users where id = target_id and email_confirmed_at is not null) then raise exception 'Verify this email before activating access'; end if;
  select role into previous_role from public.workspace_profiles where user_id = target_id;
  if actor_role <> 'super_admin' and (next_role in ('super_admin', 'admin') or previous_role in ('super_admin', 'admin')) then
    raise exception 'Only a super admin can manage admin accounts' using errcode = '42501';
  end if;
  if target_id = auth.uid() and previous_role = 'super_admin' and (next_role <> 'super_admin' or next_status <> 'active') then
    raise exception 'Another super admin must change your own access';
  end if;
  if previous_role = 'super_admin' and (next_role <> 'super_admin' or next_status <> 'active') and
    not exists (select 1 from public.workspace_profiles where user_id <> target_id and role = 'super_admin' and status = 'active') then
    raise exception 'Keep at least one active super admin';
  end if;
  if next_status = 'active' and next_role not in ('super_admin', 'admin') and coalesce(cardinality(next_modules), 0) = 0 then
    raise exception 'Select at least one tool for an active account';
  end if;
  if length(next_name) < 2 or length(next_name) > 200 or length(next_responsibilities) > 5000 then raise exception 'Invalid account details'; end if;
  select coalesce(jsonb_agg(module_id), '[]'::jsonb) into previous_modules from public.workspace_module_grants where user_id = target_id;
  update public.workspace_profiles set full_name = trim(next_name), role = next_role, status = next_status, responsibilities = next_responsibilities where user_id = target_id;
  if not found then raise exception 'Workspace profile is missing'; end if;
  delete from public.workspace_module_grants where user_id = target_id;
  insert into public.workspace_module_grants(user_id, module_id)
    select target_id, module_id from (select distinct unnest(next_modules) as module_id) g;
  insert into public.workspace_access_events(user_id, actor_id, event_type, old_access, new_access)
    values (target_id, auth.uid(), 'tool_access_changed', jsonb_build_object('modules', previous_modules), jsonb_build_object('modules', next_modules));
end;
$$;
