-- Run as postgres in a development database. All synthetic rows roll back.
begin;
insert into auth.users(id, email, raw_user_meta_data) values
  ('10000000-0000-4000-8000-000000000001', 'recharge-test-client@example.invalid', '{"role":"super_admin","status":"active"}'),
  ('10000000-0000-4000-8000-000000000002', 'recharge-test-pending@example.invalid', '{}'),
  ('10000000-0000-4000-8000-000000000003', 'recharge-test-revoked@example.invalid', '{}'),
  ('10000000-0000-4000-8000-000000000004', 'recharge-test-super-admin@example.invalid', '{}');
do $$ begin
  if not exists (select 1 from public.workspace_profiles
    where user_id = '10000000-0000-4000-8000-000000000001' and role = 'client' and status = 'pending')
  then raise exception 'User metadata elevated access'; end if;
  if has_table_privilege('anon', 'public.workspace_profiles', 'SELECT')
    or has_table_privilege('authenticated', 'public.workspace_profiles', 'UPDATE')
    or has_table_privilege('authenticated', 'public.workspace_module_grants', 'INSERT')
    or has_table_privilege('authenticated', 'public.workspace_access_events', 'DELETE')
  then raise exception 'Unexpected write or anonymous privileges'; end if;
end $$;
update public.workspace_profiles set status = 'active'
where user_id = '10000000-0000-4000-8000-000000000001';
update public.workspace_profiles set status = 'revoked'
where user_id = '10000000-0000-4000-8000-000000000003';
update public.workspace_profiles set role = 'super_admin', status = 'active'
where user_id = '10000000-0000-4000-8000-000000000004';
insert into public.workspace_module_grants(user_id, module_id)
select user_id, 'client-dashboard' from public.workspace_profiles
where user_id in ('10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
do $$ begin
  if (select count(*) from public.workspace_profiles) <> 1 then raise exception 'Client can see other users'; end if;
  if (select count(*) from public.workspace_access_events) <> 0 then raise exception 'Client can read access events'; end if;
  if (select count(*) from public.workspace_module_grants) <> 1 then raise exception 'Client module grants are incorrect'; end if;
  if private.is_workspace_super_admin() or private.has_workspace_module('property-database')
  then raise exception 'Client has admin or unassigned module access'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
do $$ begin
  if (select count(*) from public.workspace_module_grants) <> 0
    or private.has_workspace_module('client-dashboard')
  then raise exception 'Pending account has module access'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated"}', true);
do $$ begin
  if (select count(*) from public.workspace_module_grants) <> 0
    or private.has_workspace_module('client-dashboard')
  then raise exception 'Revoked account has module access'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated"}', true);
do $$ begin
  if not private.is_workspace_super_admin()
    or (select count(*) from public.workspace_profiles) <> 4
    or (select count(*) from public.workspace_access_events) <> 7
  then raise exception 'Super admin cannot monitor access'; end if;
end $$;
select set_config('request.jwt.claims', '{}', true);
do $$ begin
  if private.is_workspace_super_admin() or private.has_workspace_module('client-dashboard')
  then raise exception 'Missing user identity grants access'; end if;
end $$;
reset role;
rollback;
select 'PASS: metadata forgery, isolation, pending, revoked, super admin, missing identity, write denial; fixtures rolled back' as result;
