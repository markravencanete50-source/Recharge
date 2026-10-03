-- Privileged helpers stay private. Public RPCs are invokers with explicit grants.
create function private.has_workspace_session()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from auth.sessions s join auth.users u on u.id = s.user_id
    where s.user_id = auth.uid() and s.id::text = auth.jwt() ->> 'session_id'
      and u.email_confirmed_at is not null
      and (s.not_after is null or s.not_after > now())
  );
$$;
revoke all on function private.has_workspace_session() from public, anon, authenticated;
grant execute on function private.has_workspace_session() to authenticated;

create or replace function private.is_workspace_super_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_workspace_session() and exists (
    select 1 from public.workspace_profiles where user_id = auth.uid() and status = 'active' and role = 'super_admin'
  );
$$;
create or replace function private.has_workspace_module(requested_module text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.has_workspace_session() and exists (
    select 1 from public.workspace_profiles p where p.user_id = auth.uid() and p.status = 'active'
      and (p.role in ('super_admin', 'admin') or exists (
        select 1 from public.workspace_module_grants g where g.user_id = p.user_id and g.module_id = requested_module
      ))
  );
$$;

create function private.workspace_account_json(target_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('userId', p.user_id, 'email', u.email, 'fullName', p.full_name,
    'role', p.role, 'status', p.status, 'responsibilities', p.responsibilities,
    'modules', coalesce((select jsonb_agg(g.module_id order by g.module_id) from public.workspace_module_grants g where g.user_id = p.user_id), '[]'::jsonb))
  from public.workspace_profiles p join auth.users u on u.id = p.user_id where p.user_id = target_id;
$$;
revoke all on function private.workspace_account_json(uuid) from public, anon, authenticated;

create function private.workspace_account()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_workspace_session() then raise exception 'Verified sign-in required' using errcode = '42501'; end if;
  return private.workspace_account_json(auth.uid());
end;
$$;

create function private.workspace_accounts()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.has_workspace_session() or not exists (
    select 1 from public.workspace_profiles where user_id = auth.uid() and status = 'active' and role in ('super_admin', 'admin')
  ) then raise exception 'Admin access required' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(private.workspace_account_json(user_id) order by full_name)
    from public.workspace_profiles), '[]'::jsonb);
end;
$$;

create function private.workspace_save_access(target_email text, next_name text, next_role text, next_status text, next_modules text[], next_responsibilities text)
returns void language plpgsql security definer set search_path = '' as $$
declare actor_role text; target_id uuid; previous_role text; previous_modules jsonb;
begin
  if not private.has_workspace_session() then raise exception 'Verified sign-in required' using errcode = '42501'; end if;
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

create function private.workspace_request_access(requested_name text, requested_role text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.has_workspace_session() then raise exception 'Verified sign-in required' using errcode = '42501'; end if;
  if requested_role not in ('client', 'stays', 'cleans', 'ready') or length(requested_name) not between 2 and 200 then raise exception 'Invalid account request'; end if;
  update public.workspace_profiles set full_name = requested_name, role = requested_role
    where user_id = auth.uid() and status = 'pending';
  if not found then raise exception 'Only pending accounts can request a role'; end if;
end;
$$;

revoke all on function private.workspace_account(), private.workspace_accounts(), private.workspace_request_access(text, text),
  private.workspace_save_access(text, text, text, text, text[], text) from public, anon, authenticated;
grant execute on function private.workspace_account(), private.workspace_accounts(), private.workspace_request_access(text, text),
  private.workspace_save_access(text, text, text, text, text[], text) to authenticated;

create function public.workspace_account() returns jsonb language sql security invoker set search_path = '' as $$ select private.workspace_account(); $$;
create function public.workspace_accounts() returns jsonb language sql security invoker set search_path = '' as $$ select private.workspace_accounts(); $$;
create function public.workspace_save_access(target_email text, next_name text, next_role text, next_status text, next_modules text[], next_responsibilities text)
returns void language sql security invoker set search_path = '' as $$ select private.workspace_save_access(target_email, next_name, next_role, next_status, next_modules, next_responsibilities); $$;
create function public.workspace_request_access(requested_name text, requested_role text)
returns void language sql security invoker set search_path = '' as $$ select private.workspace_request_access(requested_name, requested_role); $$;
revoke all on function public.workspace_account(), public.workspace_accounts(), public.workspace_request_access(text, text),
  public.workspace_save_access(text, text, text, text, text[], text) from public, anon, authenticated;
grant execute on function public.workspace_account(), public.workspace_accounts(), public.workspace_request_access(text, text),
  public.workspace_save_access(text, text, text, text, text[], text) to authenticated;

comment on function public.workspace_save_access(text, text, text, text, text[], text) is
  'Checked actor, verified live session, role hierarchy, immediate revocation, atomic grants and access audit. No email-owner shortcut.';
