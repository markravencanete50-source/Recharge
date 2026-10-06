-- Rollback-only hosted validation. Does not create accounts or business fixtures.
begin;
do $$ declare t text;signature text;begin
 if (select count(*) from supabase_migrations.schema_migrations where version in ('20261005092605','20261005093514','20261005095332','20261005103726','20261005110625'))<>5 then raise exception 'Workflow migrations incomplete';end if;
 foreach t in array array['workspace_journeys','workspace_domain_details','workspace_action_receipts','workspace_listing_links','workspace_booking_policy','workspace_reservations','workspace_media_evidence','workspace_cleaning_reviews','workspace_local_events'] loop
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname=t and c.relrowsecurity) or has_table_privilege('authenticated','private.'||t,'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('anon','private.'||t,'SELECT,INSERT,UPDATE,DELETE') then raise exception 'Unsafe workflow table %',t;end if;
 end loop;
 if (select confirmed from private.workspace_booking_policy) then raise exception 'Policy unexpectedly confirmed';end if;
 if (select minimum_nights from private.workspace_booking_policy)<>7 then raise exception 'Initial stay threshold mismatch';end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef) then raise exception 'Public definer found';end if;
 foreach signature in array array['private.workspace_handover(uuid,text,text,text,jsonb)','private.workspace_journey_view(private.workspace_journeys)','private.workspace_operation_view(uuid)','private.workspace_money(jsonb,text)'] loop
  if has_function_privilege('anon',signature,'EXECUTE') or has_function_privilege('authenticated',signature,'EXECUTE') then raise exception 'Private helper exposed %',signature;end if;
 end loop;
end $$;
select set_config('request.jwt.claims','{}',true);
set local role authenticated;
do $$ begin
 begin perform public.workspace_journey_read(null);raise exception 'Unapproved journey read accepted';exception when insufficient_privilege then null;end;
 begin perform public.workspace_journey_action('{}');raise exception 'Unapproved journey mutation accepted';exception when insufficient_privilege then null;end;
 begin perform public.workspace_operations_read(null);raise exception 'Unapproved operation read accepted';exception when insufficient_privilege then null;end;
 begin perform public.workspace_operations_action('{}');raise exception 'Unapproved operation mutation accepted';exception when insufficient_privilege then null;end;
 begin perform public.workspace_portfolio_read('portfolio');raise exception 'Unapproved portfolio read accepted';exception when insufficient_privilege then null;end;
 begin perform public.workspace_portfolio_action('{}');raise exception 'Unapproved portfolio mutation accepted';exception when insufficient_privilege then null;end;
end $$;
reset role;set local role anon;
do $$ begin
 begin perform public.workspace_journey_read(null);raise exception 'Anonymous journey accepted';exception when insufficient_privilege then null;end;
 begin perform public.workspace_operations_action('{}');raise exception 'Anonymous operational mutation accepted';exception when insufficient_privilege then null;end;
 begin perform public.workspace_portfolio_read('bookingPolicy');raise exception 'Anonymous policy read accepted';exception when insufficient_privilege then null;end;
end $$;
reset role;rollback;
select 'Workflow RLS and invocation checks passed; no accounts or business records created' as verification;
select 'Workflow migrations' check_name,count(*)::text result from supabase_migrations.schema_migrations where version in ('20261005092605','20261005093514','20261005095332','20261005103726','20261005110625')
union all select 'Discount confirmed',confirmed::text from private.workspace_booking_policy
union all select 'Registered users',count(*)::text from auth.users
union all select 'Live properties',count(*)::text from public.workspace_properties
union all select 'Public definer functions',count(*)::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prosecdef;
