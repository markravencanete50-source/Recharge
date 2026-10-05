-- Rollback-only checks. Creates no Auth users, business records or permission grants.
begin;
do $$
declare object_name text; count_tables integer;
begin
  if not exists(select 1 from supabase_migrations.schema_migrations where version='20261005065933' and name='business_workspace') then raise exception 'Business migration not recorded'; end if;
  if not exists(select 1 from supabase_migrations.schema_migrations where version='20261005075617' and name='business_device_limits') then raise exception 'Device limits not recorded'; end if;
  if (select count(*) from pg_trigger where tgrelid='private.workspace_device_tokens'::regclass and tgname in ('device_count_limit','device_write_limit'))<>2 then raise exception 'Device quotas incomplete'; end if;
  select count(*) into count_tables from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind='r' and n.nspname in ('public','private') and c.relname in ('workspace_features','workspace_properties','workspace_property_assignments','workspace_work_items','workspace_work_updates','workspace_invoices','workspace_threads','workspace_messages','workspace_activity','workspace_property_secrets','workspace_property_financials','workspace_device_tokens','workspace_notification_outbox','workspace_write_limits') and c.relrowsecurity;
  if count_tables<>14 then raise exception 'Business RLS protection incomplete'; end if;
  if (select count(*) from public.workspace_features)<>37 then raise exception 'Feature catalogue mismatch'; end if;
  if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef) then raise exception 'Exposed definer function'; end if;
  foreach object_name in array array['workspace_properties','workspace_property_assignments','workspace_work_items','workspace_work_updates','workspace_invoices','workspace_threads','workspace_messages','workspace_activity'] loop
    if has_table_privilege('anon','public.'||object_name,'SELECT') or has_table_privilege('authenticated','public.'||object_name,'INSERT,UPDATE,DELETE') then raise exception 'Unsafe direct business grant on %',object_name; end if;
  end loop;
  foreach object_name in array array['workspace_property_secrets','workspace_property_financials','workspace_device_tokens','workspace_notification_outbox','workspace_write_limits'] loop
    if has_table_privilege('authenticated','private.'||object_name,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'Restricted table directly exposed: %',object_name; end if;
  end loop;
end $$;
select set_config('request.jwt.claims','{}',true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.workspace_properties)<>0 or (select count(*) from public.workspace_work_items)<>0 then raise exception 'Unapproved caller sees business records'; end if;
  begin perform public.workspace_save_property(jsonb_build_object('name','Must never be created','requestId','00000000-0000-4000-8000-000000000001'));
    raise exception 'Unauthorized property creation accepted'; exception when insufficient_privilege then null; end;
  begin perform public.workspace_report(current_date-30,current_date);
    raise exception 'Unauthorized reports accepted'; exception when insufficient_privilege then null; end;
  begin perform public.workspace_property_details('00000000-0000-4000-8000-000000000001','access');
    raise exception 'Unauthorized access details accepted'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set local role anon;
do $$ begin
  begin perform public.workspace_save_property('{}'::jsonb);
    raise exception 'Anonymous RPC accepted'; exception when insufficient_privilege then null; end;
end $$;
reset role;
rollback;
select 'Business RLS, direct-write denial, private-field isolation and unapproved/anonymous RPC checks passed; all test changes rolled back' as verification;
