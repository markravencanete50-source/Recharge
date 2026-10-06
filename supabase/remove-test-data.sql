-- Removes everything created by seed-test-data.sql (records prefixed "[TEST]")
-- and the activity rows they generated. Run in the Supabase SQL editor.
begin;
create temporary table test_properties on commit drop as
  select id from public.workspace_properties where name like '[TEST]%';
delete from public.workspace_messages where thread_id in (select id from public.workspace_threads where property_id in (select id from test_properties));
delete from public.workspace_threads where property_id in (select id from test_properties);
delete from public.workspace_invoices where property_id in (select id from test_properties);
delete from public.workspace_work_updates where work_id in (select id from public.workspace_work_items where property_id in (select id from test_properties));
delete from private.workspace_notification_outbox where event_id in (select id from public.workspace_activity where property_id in (select id from test_properties))
  or work_id in (select id from public.workspace_work_items where property_id in (select id from test_properties));
delete from public.workspace_activity where property_id in (select id from test_properties)
  or work_id in (select id from public.workspace_work_items where property_id in (select id from test_properties));
delete from public.workspace_work_items where property_id in (select id from test_properties);
delete from public.workspace_property_assignments where property_id in (select id from test_properties);
delete from public.workspace_properties where id in (select id from test_properties);
commit;
