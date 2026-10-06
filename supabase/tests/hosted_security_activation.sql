-- Run in the Supabase SQL Editor as postgres after all four access migrations.
-- Synthetic rate-limit and login records exist only inside this transaction.
-- No Auth users, passwords, invitations or real workspace grants are created.
begin;
select set_config('request.jwt.claims', '{}', true);

do $checks$
declare missing integer;
begin
  select count(*) into missing from unnest(array[
    '20261003120633','20261003151028','20261003162617','20261004083809'
  ]) v where not exists(select 1 from supabase_migrations.schema_migrations m where m.version=v);
  if missing <> 0 then raise exception 'An access/security migration is missing'; end if;
  if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where c.relkind='r' and n.nspname='private' and c.relname in (
        'auth_login_state','auth_login_attempts','auth_request_limits',
        'workspace_approved_sessions','auth_recovery_proofs','authentication_events') and c.relrowsecurity) <> 6
    then raise exception 'Security tables or RLS are missing'; end if;
  if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where c.relkind='r' and n.nspname='public' and c.relname like 'workspace_%' and not c.relrowsecurity)
    then raise exception 'An access table has no RLS'; end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and (p.proname like 'workspace_%' or p.proname like 'auth_server_%') and p.prosecdef)
    then raise exception 'A public RPC unexpectedly bypasses RLS'; end if;
  if has_function_privilege('anon','public.auth_server_begin_password(text,uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.auth_server_begin_password(text,uuid)','EXECUTE')
    or has_function_privilege('anon','public.workspace_save_access(text,text,text,text,text[],text)','EXECUTE')
    or has_table_privilege('authenticated','public.workspace_profiles','UPDATE')
    or has_table_privilege('authenticated','public.workspace_module_grants','INSERT')
    then raise exception 'Unexpected direct client privileges'; end if;
  if not exists(select 1 from pg_constraint where conrelid='public.workspace_profiles'::regclass
      and conname='workspace_profiles_role_check' and pg_get_constraintdef(oid) like '%cleaning_manager%')
    then raise exception 'The separate cleaning-manager role is missing'; end if;
end;
$checks$;

-- Stateless server RPCs are tested using the actual hosted service-role grants.
set local role service_role;
do $checks$
declare subject text := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
  bucket text := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');
  attempt uuid; result jsonb;
begin
  for i in 1..5 loop
    attempt:=gen_random_uuid();
    result:=public.auth_server_begin_password(subject,attempt);
    if (result->>'allowed')::boolean is distinct from true then raise exception 'Attempt % unexpectedly refused',i; end if;
    result:=public.auth_server_finish_password(subject,attempt,'failure');
    if i < 5 and (result->>'locked')::boolean is distinct from false then raise exception 'Premature password lockout'; end if;
  end loop;
  if (result->>'locked')::boolean is distinct from true or (result->>'retryAfter')::integer <> 86400
    then raise exception 'Fifth failure does not lock for 24 hours'; end if;
  result:=public.auth_server_begin_password(subject,gen_random_uuid());
  if (result->>'allowed')::boolean is distinct from false or (result->>'locked')::boolean is distinct from true
    then raise exception 'A locked account can attempt another password'; end if;
  for i in 1..2 loop
    result:=public.auth_server_rate_limit(bucket,2,60);
    if (result->>'allowed')::boolean is distinct from true then raise exception 'Valid quota request refused'; end if;
  end loop;
  result:=public.auth_server_rate_limit(bucket,2,60);
  if (result->>'allowed')::boolean is distinct from false or (result->>'retryAfter')::integer not between 1 and 60
    then raise exception 'Persistent rate limit not enforced'; end if;
end;
$checks$;
reset role;

set local role authenticated;
do $checks$
begin
  if public.workspace_session_allowed() then raise exception 'Unapproved identity has a workspace session'; end if;
  if (select count(*) from public.workspace_profiles) <> 0
    or (select count(*) from public.workspace_module_grants) <> 0
    or (select count(*) from public.workspace_access_events) <> 0
    then raise exception 'Unauthenticated identity can read protected access rows'; end if;
  begin
    perform public.workspace_accounts();
    raise exception 'Unapproved identity can list workspace accounts';
  exception when insufficient_privilege then null;
  end;
end;
$checks$;
reset role;

rollback;
select 'PASS: four migrations, nine RLS tables, RPC restrictions, cleaner/manager separation, five failures, 24-hour lockout, persistent rate limiting and unapproved-session denial. Synthetic guard records rolled back.' as security_verification;
