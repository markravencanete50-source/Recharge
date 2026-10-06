-- Labelled test data for end-to-end testing. Run through trusted Supabase
-- administration (SQL editor) AFTER provision-owner.sql has made the owner an
-- active super admin. Every record is prefixed "[TEST]" and is removed by
-- remove-test-data.sql. No real guests, clients, addresses or money.
begin;
do $$
declare
  owner_id uuid;
  p1 uuid; p2 uuid; p3 uuid;
  w1 uuid; t1 uuid;
begin
  select user_id into owner_id from public.workspace_profiles where role = 'super_admin' and status = 'active' limit 1;
  if owner_id is null then raise exception 'Provision the owner super admin first (supabase/provision-owner.sql)'; end if;
  if exists (select 1 from public.workspace_properties where name like '[TEST]%') then
    raise exception 'Test data already exists. Run remove-test-data.sql first to reseed';
  end if;

  insert into public.workspace_properties(name, address, region, status, bedrooms, created_by, request_id, latitude, longitude)
  values ('[TEST] Harbour View Flat', '1 Test Quay, Example Town', 'Edinburgh', 'active', 2, owner_id, gen_random_uuid(), 55.9765, -3.1700)
  returning id into p1;
  insert into public.workspace_properties(name, address, region, status, bedrooms, created_by, request_id, latitude, longitude)
  values ('[TEST] Garden Cottage', '2 Test Lane, Example Village', 'Highlands', 'active', 3, owner_id, gen_random_uuid(), 57.4778, -4.2247)
  returning id into p2;
  insert into public.workspace_properties(name, address, region, status, bedrooms, created_by, request_id)
  values ('[TEST] New Listing Studio', '3 Test Street, Example City', 'Glasgow', 'onboarding', 1, owner_id, gen_random_uuid())
  returning id into p3;

  insert into public.workspace_work_items(request_id, property_id, module_id, title, description, status, priority, due_on, assignee_id, created_by)
  values (gen_random_uuid(), p1, 'maintenance-reporting', '[TEST] Leaking kitchen tap', 'Test maintenance report for checking the repair workflow.', 'waiting', 'high', current_date + 1, owner_id, owner_id)
  returning id into w1;
  insert into public.workspace_work_items(request_id, property_id, module_id, title, description, status, priority, due_on, created_by) values
    (gen_random_uuid(), p1, 'cleaning-schedule', '[TEST] Turnover clean after checkout', 'Test clean for the schedule view.', 'in_progress', 'normal', current_date, owner_id),
    (gen_random_uuid(), p2, 'listing-health', '[TEST] Weekly listing check', 'Test listing health task.', 'waiting', 'normal', current_date + 2, owner_id),
    (gen_random_uuid(), p2, 'replenishment-requests', '[TEST] Restock toiletries', 'Test replenishment request.', 'in_review', 'normal', current_date + 3, owner_id),
    (gen_random_uuid(), p3, 'property-onboarding', '[TEST] Collect keys and photos', 'Test onboarding task.', 'waiting', 'urgent', current_date + 5, owner_id),
    (gen_random_uuid(), p2, 'safety-maintenance', '[TEST] Smoke alarm test', 'Test completed safety check.', 'completed', 'normal', current_date - 2, owner_id);

  insert into public.workspace_threads(property_id, subject, client_visible, created_by, request_id)
  values (p1, '[TEST] Guest arrival questions', false, owner_id, gen_random_uuid())
  returning id into t1;
  insert into public.workspace_messages(request_id, thread_id, author_id, body) values
    (gen_random_uuid(), t1, owner_id, '[TEST] What time is check-in on Friday?'),
    (gen_random_uuid(), t1, owner_id, '[TEST] Check-in is from 3pm. Keys are in the lockbox.');

  insert into public.workspace_invoices(request_id, property_id, module_id, recipient_id, reference, amount_minor, currency, status, created_by)
  values (gen_random_uuid(), p2, 'purchase-order-accounts', owner_id, '[TEST] INV-0001', 4500, 'GBP', 'issued', owner_id);
end;
$$;
commit;
