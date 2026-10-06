-- Internal editing, assignment candidates and financial evidence. No external credentials.
alter table private.workspace_reservations add column version integer not null default 1 check(version>0), add column updated_at timestamptz not null default now();
alter table private.workspace_local_events add column version integer not null default 1 check(version>0), add column updated_at timestamptz not null default now(), add column archived_at timestamptz;
alter table private.workspace_notification_outbox add column read_at timestamptz;
create table private.workspace_estimate_models (
 property_id uuid primary key references public.workspace_properties(id), assumptions jsonb not null,
 result jsonb not null, version integer not null default 1 check(version>0),
 updated_by uuid not null references public.workspace_profiles(user_id), updated_at timestamptz not null default now()
);
alter table private.workspace_estimate_models enable row level security;
revoke all on private.workspace_estimate_models from public,anon,authenticated;
create trigger business_write_limit before insert or update or delete on private.workspace_estimate_models for each row execute function private.workspace_enforce_write_limit();

-- Separate entry instructions from OTA credentials even for callers using the old access RPC.
create or replace function private.workspace_property_details(target_property uuid,section text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();begin
 if actor is null then raise exception 'Active workspace access required' using errcode='42501';end if;
 if section='access' then
  if not ((actor not in ('client','cleans') and private.workspace_can_property(target_property,'property-database')) or
    (actor='cleans' and private.workspace_can_property(target_property,'cleaning-schedule') and exists(select 1 from public.workspace_work_items where property_id=target_property and assignee_id=auth.uid() and module_id='cleaning-schedule' and status in ('waiting','in_progress')))) then raise exception 'Property access denied' using errcode='42501';end if;
  return coalesce((select jsonb_build_object('accessInstructions',access_instructions) from private.workspace_property_secrets where property_id=target_property),'{}');
 elsif section='ota' then
  if actor in ('client','cleans','cleaning_manager') or not private.workspace_can_property(target_property,'ota-logins') then raise exception 'OTA access denied' using errcode='42501';end if;
  return coalesce((select jsonb_build_object('otaInstructions',ota_instructions) from private.workspace_property_secrets where property_id=target_property),'{}');
 elsif section='finance' then
  if not private.workspace_can_property(target_property,'owner-statements') then raise exception 'Financial access denied' using errcode='42501';end if;
  return coalesce((select jsonb_build_object('managementFeeBps',management_fee_bps,'paymentNotes',payment_notes) from private.workspace_property_financials where property_id=target_property),'{}');
 end if;
 raise exception 'Invalid section' using errcode='22023';
end $$;
create or replace function private.workspace_save_property_details(target_property uuid,expected_version integer,section text,input jsonb) returns void language plpgsql security definer set search_path='' as $$
declare v integer;begin
 if coalesce(private.workspace_actor_role(),'') not in ('admin','super_admin') then raise exception 'Admin access required' using errcode='42501';end if;
 select version into v from public.workspace_properties where id=target_property for update;
 if not found then raise exception 'Property not found' using errcode='P0002';end if;
 if v is distinct from expected_version then raise exception 'Property changed' using errcode='40001';end if;
 if section='access' then
  perform private.workspace_json_keys(input,array['accessInstructions']);
  if jsonb_typeof(input->'accessInstructions') is distinct from 'string' or length(input->>'accessInstructions')>5000 then raise exception 'Invalid access instructions' using errcode='22023';end if;
  insert into private.workspace_property_secrets(property_id,access_instructions) values(target_property,input->>'accessInstructions') on conflict(property_id) do update set access_instructions=excluded.access_instructions,updated_at=now();
 elsif section='ota' then
  perform private.workspace_json_keys(input,array['otaInstructions']);
  if jsonb_typeof(input->'otaInstructions') is distinct from 'string' or length(input->>'otaInstructions')>5000 then raise exception 'Invalid OTA instructions' using errcode='22023';end if;
  insert into private.workspace_property_secrets(property_id,ota_instructions) values(target_property,input->>'otaInstructions') on conflict(property_id) do update set ota_instructions=excluded.ota_instructions,updated_at=now();
 elsif section='finance' then
  perform private.workspace_json_keys(input,array['managementFeeBps','paymentNotes']);
  if jsonb_typeof(input->'paymentNotes') is distinct from 'string' or length(input->>'paymentNotes')>5000 or
    (input->>'managementFeeBps' is not null and (jsonb_typeof(input->'managementFeeBps') is distinct from 'number' or input->>'managementFeeBps'!~'^\d+$' or (input->>'managementFeeBps')::numeric>10000)) then raise exception 'Invalid financial details' using errcode='22023';end if;
  insert into private.workspace_property_financials(property_id,management_fee_bps,payment_notes) values(target_property,(input->>'managementFeeBps')::integer,input->>'paymentNotes') on conflict(property_id) do update set management_fee_bps=excluded.management_fee_bps,payment_notes=excluded.payment_notes,updated_at=now();
 else raise exception 'Invalid section' using errcode='22023';end if;
 update public.workspace_properties set version=version+1,updated_at=now() where id=target_property;
 insert into public.workspace_activity(actor_id,property_id,event_type) values(auth.uid(),target_property,'property_details.'||section||'.updated');
end $$;

-- Every source update, including imports, invalidates unpaid quotes made for obsolete dates.
create function private.workspace_reservation_edit_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if (new.check_in,new.check_out,new.status) is not distinct from (old.check_in,old.check_out,old.status) then return new;end if;
 -- Lock affected work before invalidation. All statements roll back together on failure.
 perform 1 from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where d.kind='direct_booking' and d.data->>'reservationId'=old.id::text for update of w;
 perform 1 from public.workspace_invoices i join private.workspace_domain_details d on d.work_id=i.work_id where d.kind='direct_booking' and d.data->>'reservationId'=old.id::text for update of i;
 if exists(select 1 from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
   where d.kind='direct_booking' and d.data->>'reservationId'=old.id::text and (w.status='completed' or exists(select 1 from public.workspace_invoices i where i.work_id=w.id and i.status='paid'))) then raise exception 'Resolve the paid or confirmed direct booking before changing this reservation' using errcode='23505';end if;
 update public.workspace_invoices i set status='void',version=version+1 where i.status='issued' and exists(select 1 from private.workspace_domain_details d where d.kind='direct_booking' and d.work_id=i.work_id and d.data->>'reservationId'=old.id::text);
 update public.workspace_work_items w set status='cancelled',version=version+1,updated_at=now() from private.workspace_domain_details d where d.work_id=w.id and d.kind='direct_booking_invoice' and exists(select 1 from private.workspace_domain_details s where s.kind='direct_booking' and s.work_id::text=d.data->>'sourceWorkId' and s.data->>'reservationId'=old.id::text) and w.status not in ('completed','cancelled');
 update private.workspace_domain_details d set data=d.data||jsonb_build_object('workStatus','cancelled','reservationChangedAt',now()),updated_at=now() from public.workspace_work_items w where w.id=d.work_id and d.kind='direct_booking' and d.data->>'reservationId'=old.id::text and w.status not in ('completed','cancelled');
 update public.workspace_work_items w set status='cancelled',version=version+1,updated_at=now() from private.workspace_domain_details d where w.id=d.work_id and d.kind='direct_booking' and d.data->>'reservationId'=old.id::text and w.status not in ('completed','cancelled');
 new.version:=old.version+1;new.updated_at:=now();return new;
end $$;
create trigger reservation_edit_guard before update on private.workspace_reservations for each row execute function private.workspace_reservation_edit_guard();

create function private.workspace_controls_read(section text,target_property uuid default null,target_work uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();result jsonb;feature text;begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 if section='notifications' then
  select coalesce(jsonb_agg(n),'[]') into result from(select a.id,a.event_type,a.property_id,a.work_id,a.created_at,o.read_at,
   'available_in_app' as status from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id
   where o.user_id=auth.uid() and (a.work_id is null or private.workspace_can_work(a.work_id)) and
    (a.property_id is null or actor in ('admin','super_admin') or exists(select 1 from public.workspace_property_assignments where property_id=a.property_id and user_id=auth.uid())) order by a.created_at desc,a.id desc limit 50) n;
  return result;
 end if;
 if target_property is null then raise exception 'Choose a property' using errcode='22023';end if;
 if section='resources' then
  if target_work is null then
   if actor not in ('admin','super_admin') or not private.workspace_can_property(target_property,'property-database') then raise exception 'Assignment permission required' using errcode='42501';end if;
   select coalesce(jsonb_agg(jsonb_build_object('userId',p.user_id,'fullName',p.full_name,'role',p.role,'assignment',a.assignment) order by p.full_name,p.user_id),'[]') into result from (select user_id,full_name,role,status from public.workspace_profiles where status='active' order by full_name,user_id limit 100) p left join public.workspace_property_assignments a on a.property_id=target_property and a.user_id=p.user_id where p.status='active';
  else
   if actor in ('client','cleans') or not private.workspace_can_work(target_work) or not exists(select 1 from public.workspace_work_items where id=target_work and property_id=target_property) then raise exception 'Assignment permission required' using errcode='42501';end if;
   select coalesce(jsonb_agg(c.value),'[]') into result from (select jsonb_build_object('userId',p.user_id,'fullName',p.full_name,'role',p.role) as value from public.workspace_profiles p join public.workspace_property_assignments a on a.user_id=p.user_id and a.property_id=target_property join public.workspace_work_items w on w.id=target_work where p.status='active' and p.role<>'client' and (p.role in ('admin','super_admin') or exists(select 1 from public.workspace_module_grants g where g.user_id=p.user_id and g.module_id=w.module_id)) order by p.full_name,p.user_id limit 100) c;
  end if;
 elsif section in ('reservations','events','estimate') then
  feature:=case section when 'reservations' then 'direct-bookings' when 'events' then 'weekly-performance' else 'property-onboarding' end;
  if actor not in ('stays','admin','super_admin') or not private.workspace_can_property(target_property,feature) then raise exception 'Property team access required' using errcode='42501';end if;
  if section='reservations' then select coalesce(jsonb_agg(r),'[]') into result from(select id,reference,check_in,check_out,status,source,version,updated_at from private.workspace_reservations where property_id=target_property order by check_in desc,id limit 100) r;
  elsif section='events' then select coalesce(jsonb_agg(r),'[]') into result from(select id,name,event_on,source_url,opportunity,version,updated_at,archived_at from private.workspace_local_events where property_id=target_property order by event_on desc,id limit 100) r;
  else select jsonb_build_object('assumptions',assumptions,'projection',m.result,'version',m.version,'updatedAt',m.updated_at) into result from private.workspace_estimate_models m where m.property_id=target_property;
  end if;
 else raise exception 'Unknown controls section' using errcode='22023';end if;
 return result;
end $$;

create function private.workspace_controls_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();a text;prop uuid;req uuid;prior private.workspace_action_receipts;result jsonb;v integer;
 r private.workspace_reservations;e private.workspace_local_events;w public.workspace_work_items;d private.workspace_domain_details;f uuid;policy private.workspace_booking_policy;
 assumptions jsonb;k text;amount bigint;module text;target uuid;model private.workspace_estimate_models;projection jsonb;gross numeric;ota numeric;fee numeric;rate bigint;
begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 a:=private.workspace_required_text(input,'action',1,50);req:=(input->>'requestId')::uuid;prop:=(input->>'propertyId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 -- Permissions are rechecked before returning a receipt, including after module/assignment changes.
 if a='markNotificationRead' then
  if not exists(select 1 from private.workspace_notification_outbox o join public.workspace_activity n on n.id=o.event_id where o.user_id=auth.uid() and n.id=(input->>'eventId')::bigint and (n.work_id is null or private.workspace_can_work(n.work_id)) and (n.property_id is null or actor in ('admin','super_admin') or exists(select 1 from public.workspace_property_assignments where property_id=n.property_id and user_id=auth.uid()))) then raise exception 'Notification access denied' using errcode='42501';end if;
 elsif a='issueOperationInvoice' then
  if actor in ('client','cleans') or not private.workspace_can_work((input->>'workId')::uuid) then raise exception 'Invoice work access required' using errcode='42501';end if;
  select * into w from public.workspace_work_items where id=(input->>'workId')::uuid and property_id=prop;
  if not found then raise exception 'Work access denied' using errcode='42501';end if;
  select * into d from private.workspace_domain_details where work_id=w.id;
  module:=case d.kind when 'cleaning' then 'cleans-invoices' when 'direct_booking' then 'owner-statements' when 'purchase' then 'purchase-order-invoices' when 'maintenance' then 'maintenance-reconciliation' end;
  if module is null or not private.workspace_can_property(prop,module) then raise exception 'Invoice module permission required' using errcode='42501';end if;
 else
  if a not in ('updateReservation','updateEvent','archiveEvent','saveEstimate') then raise exception 'Unknown controls action' using errcode='22023';end if;
  if actor not in ('stays','admin','super_admin') or prop is null or not private.workspace_can_property(prop,case a when 'updateReservation' then 'direct-bookings' when 'saveEstimate' then 'property-onboarding' else 'weekly-performance' end) then raise exception 'Property team permission required' using errcode='42501';end if;
 end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 select * into prior from private.workspace_action_receipts where actor_id=auth.uid() and request_id=req;
 if found then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;
 if a='updateReservation' then
  perform private.workspace_json_keys(input,array['action','requestId','propertyId','reservationId','version','checkIn','checkOut','status']);
  perform pg_advisory_xact_lock(hashtextextended(prop::text,42));
  select * into r from private.workspace_reservations where id=(input->>'reservationId')::uuid and property_id=prop for update;
  if not found then raise exception 'Reservation not found' using errcode='P0002';end if;
  if r.source<>'manual' then raise exception 'Use the owning booking source to change this reservation' using errcode='42501';end if;
  if r.version is distinct from (input->>'version')::integer then raise exception 'Reservation changed' using errcode='40001';end if;
  if input->>'checkIn' is null or input->>'checkOut' is null or (input->>'checkOut')::date<=(input->>'checkIn')::date or (input->>'checkOut')::date-(input->>'checkIn')::date>365 or coalesce(input->>'status','') not in ('enquiry','confirmed','cancelled') then raise exception 'Invalid reservation dates or status' using errcode='22023';end if;
  if input->>'status'='confirmed' and exists(select 1 from private.workspace_reservations where property_id=prop and id<>r.id and status='confirmed' and check_in<(input->>'checkOut')::date and check_out>(input->>'checkIn')::date) then raise exception 'Reservation overlaps occupied dates' using errcode='23505';end if;
  if (r.check_in,r.check_out,r.status) is distinct from ((input->>'checkIn')::date,(input->>'checkOut')::date,input->>'status') then
   update private.workspace_reservations set check_in=(input->>'checkIn')::date,check_out=(input->>'checkOut')::date,status=input->>'status' where id=r.id returning * into r;
   select * into policy from private.workspace_booking_policy where singleton;
   if r.status<>'cancelled' and r.check_out-r.check_in>=policy.minimum_nights then f:=private.workspace_handover(prop,'direct-bookings','Follow up updated reservation','direct_booking',jsonb_build_object('reservationId',r.id,'phase','follow_up','workStatus','waiting'));end if;
  end if;
  result:=jsonb_build_object('reservationId',r.id,'version',r.version,'followUpWorkId',f);
 elsif a in ('updateEvent','archiveEvent') then
  perform private.workspace_json_keys(input,case when a='archiveEvent' then array['action','requestId','propertyId','eventId','version'] else array['action','requestId','propertyId','eventId','version','name','eventOn','sourceUrl','opportunity'] end);
  select * into e from private.workspace_local_events where id=(input->>'eventId')::uuid and property_id=prop for update;
  if not found then raise exception 'Event not found' using errcode='P0002';end if;
  if e.version is distinct from (input->>'version')::integer then raise exception 'Event changed' using errcode='40001';end if;
  if e.archived_at is not null then raise exception 'Event already archived' using errcode='22023';end if;
  if a='archiveEvent' then update private.workspace_local_events set archived_at=now(),version=version+1,updated_at=now() where id=e.id returning version into v;
  else
   if private.workspace_required_text(input,'sourceUrl',9,1000)!~'^https://[^/@[:space:]]+([/:?#]|$)' or input->>'eventOn' is null then raise exception 'Real dated event source required' using errcode='22023';end if;
   update private.workspace_local_events set name=private.workspace_required_text(input,'name',2,200),event_on=(input->>'eventOn')::date,source_url=input->>'sourceUrl',opportunity=private.workspace_required_text(input,'opportunity',5,2000),version=version+1,updated_at=now() where id=e.id returning version into v;
  end if;
  result:=jsonb_build_object('eventId',e.id,'version',v);
 elsif a='markNotificationRead' then
  perform private.workspace_json_keys(input,array['action','requestId','eventId']);
  update private.workspace_notification_outbox set read_at=coalesce(read_at,now()) where user_id=auth.uid() and event_id=(input->>'eventId')::bigint returning jsonb_build_object('eventId',event_id::text,'readAt',read_at) into result;
 elsif a='saveEstimate' then
  perform private.workspace_json_keys(input,array['action','requestId','propertyId','version','assumptions']);
  assumptions:=input->'assumptions';perform private.workspace_json_keys(assumptions,array['availableNights','occupancyBps','directBookingBps','otaFeeBps','managementFeeBps','lowRateMinor','mediumRateMinor','highRateMinor']);
  foreach k in array array['availableNights','occupancyBps','directBookingBps','otaFeeBps','managementFeeBps','lowRateMinor','mediumRateMinor','highRateMinor'] loop
   if jsonb_typeof(assumptions->k) is distinct from 'number' or assumptions->>k!~'^\d+$' or (assumptions->>k)::numeric>(case when k like '%RateMinor' then 10000000 when k='availableNights' then 366 else 10000 end) then raise exception 'Invalid estimate assumptions' using errcode='22023';end if;
  end loop;
  if (assumptions->>'availableNights')::integer<1 or (assumptions->>'lowRateMinor')::bigint>(assumptions->>'mediumRateMinor')::bigint or (assumptions->>'mediumRateMinor')::bigint>(assumptions->>'highRateMinor')::bigint then raise exception 'Invalid estimate scenarios' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended(prop::text,43));
  select * into model from private.workspace_estimate_models where property_id=prop for update;
  if coalesce(model.version,0) is distinct from (input->>'version')::integer then raise exception 'Estimate changed' using errcode='40001';end if;
  projection:='[]';
  foreach k in array array['low','medium','high'] loop
   rate:=(assumptions->>(k||'RateMinor'))::bigint;
   gross:=round(rate::numeric*(assumptions->>'availableNights')::integer*(assumptions->>'occupancyBps')::integer/10000);
   ota:=round(gross*(10000-(assumptions->>'directBookingBps')::integer)*(assumptions->>'otaFeeBps')::integer/100000000);
   fee:=round(gross*(assumptions->>'managementFeeBps')::integer/10000);
   projection:=projection||jsonb_build_array(jsonb_build_object('scenario',k,'grossMinor',gross,'otaFeesMinor',ota,'managementFeesMinor',fee,'netBeforeOtherCostsMinor',gross-ota-fee));
  end loop;
  result:=jsonb_build_object('currency','GBP','basis','User-entered assumptions; management fee on gross; excludes cleaning, maintenance, taxes and other operating costs','occupiedNights',round((assumptions->>'availableNights')::numeric*(assumptions->>'occupancyBps')::integer/10000,2),'scenarios',projection);
  insert into private.workspace_estimate_models(property_id,assumptions,result,updated_by) values(prop,assumptions,result,auth.uid()) on conflict(property_id) do update set assumptions=excluded.assumptions,result=excluded.result,version=workspace_estimate_models.version+1,updated_by=auth.uid(),updated_at=now() returning version into v;
  result:=jsonb_build_object('propertyId',prop,'version',v,'projection',result);
 elsif a='issueOperationInvoice' then
  perform private.workspace_json_keys(input,array['action','requestId','propertyId','workId','version','recipientId','reference','amountMinor']);
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||req::text,0));
  select * into w from public.workspace_work_items where id=w.id for update;
  if w.version is distinct from (input->>'version')::integer then raise exception 'Work changed' using errcode='40001';end if;
  select * into d from private.workspace_domain_details where work_id=w.id;
  amount:=private.workspace_money(input,'amountMinor');
  if amount<=0 or (d.kind='cleaning' and d.data->>'phase'='accepted' and w.status='completed' or d.kind='direct_booking' and d.data->>'phase'='accepted' and w.status='approved' and amount=(d.data->>'quoteAmountMinor')::bigint or d.kind='purchase' and d.data->>'phase'='delivered' and w.status='approved' and amount<=(d.data->>'approvedAmountMinor')::bigint or d.kind='maintenance' and d.data->>'phase'='completed' and w.status='completed' and amount=(d.data->>'actualCostMinor')::bigint) is distinct from true then raise exception 'Approved financial evidence required' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended(w.id::text,44));
  if exists(select 1 from public.workspace_invoices where work_id=w.id and module_id=module and status<>'void') then raise exception 'Active invoice already exists for this work' using errcode='23505';end if;
  target:=private.workspace_create_invoice(jsonb_build_object('requestId',req,'propertyId',prop,'moduleId',module,'workId',w.id,'recipientId',(input->>'recipientId')::uuid,'reference',private.workspace_required_text(input,'reference',1,120),'amountMinor',amount,'currency','GBP'));
  result:=jsonb_build_object('invoiceId',target,'workId',w.id);
 end if;
 if a<>'markNotificationRead' then insert into public.workspace_activity(actor_id,property_id,event_type) values(auth.uid(),prop,'controls.'||a);end if;
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $$;
create function public.workspace_controls_read(section text,target_property uuid default null,target_work uuid default null) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_controls_read(section,target_property,target_work);$$;
create function public.workspace_controls_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_controls_action(input);$$;
revoke all on function private.workspace_controls_read(text,uuid,uuid),private.workspace_controls_action(jsonb),private.workspace_reservation_edit_guard() from public,anon,authenticated;
grant execute on function private.workspace_controls_read(text,uuid,uuid),private.workspace_controls_action(jsonb) to authenticated;
revoke all on function public.workspace_controls_read(text,uuid,uuid),public.workspace_controls_action(jsonb) from public,anon;
grant execute on function public.workspace_controls_read(text,uuid,uuid),public.workspace_controls_action(jsonb) to authenticated;
create function public.workspace_controls_version() returns integer language sql stable security invoker set search_path='' as $$select case when private.workspace_actor_role() is not null then 1 else null end;$$;
revoke all on function public.workspace_controls_version() from public,anon;
grant execute on function public.workspace_controls_version() to authenticated;

-- The generic invoice endpoint must enforce the same gates as the operation endpoint.
create or replace function private.workspace_operation_invoice_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare d private.workspace_domain_details;w public.workspace_work_items;expected_module text;begin
 select * into d from private.workspace_domain_details where work_id=new.work_id;
 if new.module_id='cleans-invoices' and (d.kind='cleaning' and d.data->>'phase'='accepted') is distinct from true then raise exception 'Accepted cleaning report required before invoicing' using errcode='42501';end if;
 if d.kind in ('cleaning','direct_booking','purchase','maintenance') then
  select * into w from public.workspace_work_items where id=new.work_id for update;
  expected_module:=case d.kind when 'cleaning' then 'cleans-invoices' when 'direct_booking' then 'owner-statements' when 'purchase' then 'purchase-order-invoices' else 'maintenance-reconciliation' end;
  if d.kind='purchase' and new.module_id='purchase-order-accounts' then expected_module:='purchase-order-accounts';end if;
  if new.module_id<>expected_module or new.currency<>'GBP' or new.amount_minor<=0 or not private.workspace_can_work(w.id) or
   (d.kind='cleaning' and d.data->>'phase'='accepted' and w.status='completed' or d.kind='direct_booking' and d.data->>'phase'='accepted' and w.status='approved' and new.amount_minor=(d.data->>'quoteAmountMinor')::bigint or d.kind='purchase' and d.data->>'phase'='delivered' and w.status='approved' and new.amount_minor<=(d.data->>'approvedAmountMinor')::bigint or d.kind='maintenance' and d.data->>'phase'='completed' and w.status='completed' and new.amount_minor=(d.data->>'actualCostMinor')::bigint) is distinct from true then raise exception 'Approved financial evidence required' using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended(w.id::text,44));
  if exists(select 1 from public.workspace_invoices where work_id=w.id and status<>'void') then raise exception 'Active invoice already exists for this work' using errcode='23505';end if;
 end if;
 return new;
end $$;

-- Existing read endpoints also expose current versions and omit archived events.
create or replace function private.workspace_portfolio_read(section text,target_property uuid default null,start_on date default null,end_on date default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role(); result jsonb;begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 if section='portfolio' then
  if actor not in ('admin','super_admin','client','stays') or not private.has_workspace_module(case when actor='client' then 'client-dashboard' else 'property-database' end) then raise exception 'Portfolio access denied' using errcode='42501';end if;
  with permitted as(select p.* from public.workspace_properties p where (target_property is null or p.id=target_property) and private.workspace_can_property(p.id,case when actor='client' then 'client-dashboard' else 'property-database' end)),
  rows as(select p.*,j.stage,j.client_id from permitted p left join private.workspace_journeys j on j.property_id=p.id order by p.updated_at desc limit 100)
  select jsonb_build_object('properties',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'address',p.address,'region',p.region,'status',p.status,'bedrooms',p.bedrooms,'latitude',p.latitude,'longitude',p.longitude,'hostawayListingId',p.hostaway_listing_id,'version',p.version,'stage',p.stage,'clientId',p.client_id,'listingLinks',coalesce(l.links,'[]')) order by p.updated_at desc) from rows p left join private.workspace_listing_links l on l.property_id=p.id),'[]'),
   'count',(select count(*) from permitted),'more',(select count(*)>100 from permitted),
   'regions',coalesce((select jsonb_agg(r) from(select region,count(*) as properties from permitted group by region order by region) r),'[]'),
   'clients',coalesce((select jsonb_agg(c) from(select j.client_id,count(*) as properties from permitted p join private.workspace_journeys j on j.property_id=p.id group by j.client_id order by j.client_id) c),'[]')) into result;
 elsif section='bookingPolicy' then
  if actor not in ('stays','admin','super_admin') or not private.has_workspace_module('direct-bookings') then raise exception 'Booking policy access denied' using errcode='42501';end if;
  select to_jsonb(p)-'singleton' into result from private.workspace_booking_policy p;
 elsif section in ('reservations','vacancies') then
  if actor not in ('stays','admin','super_admin') or not private.workspace_can_property(target_property,'daily-pricing') then raise exception 'Pricing calendar access denied' using errcode='42501';end if;
  if section='reservations' then select coalesce(jsonb_agg(r),'[]') into result from(select id,reference,check_in,check_out,status,source,version,updated_at from private.workspace_reservations where property_id=target_property order by check_in desc limit 100) r;
  else select coalesce(jsonb_agg(jsonb_build_object('night',night::date,'occupied',exists(select 1 from private.workspace_reservations r where r.property_id=target_property and r.status='confirmed' and r.check_in<=night::date and r.check_out>night::date)) order by night),'[]') into result from generate_series(current_date::timestamp,(current_date+6)::timestamp,'1 day') night;end if;
 elsif section='weekly' then
  if actor not in ('client','stays','admin','super_admin') or not private.workspace_can_property(target_property,case when actor='client' then 'client-dashboard' else 'weekly-performance' end) then raise exception 'Property report access denied' using errcode='42501';end if;
  if start_on is null or end_on is null or end_on<start_on or end_on-start_on>30 then raise exception 'Choose up to 31 report days' using errcode='22023';end if;
  select jsonb_build_object('propertyId',p.id,'propertyName',p.name,'from',start_on,'to',end_on,'dateBasis','Europe/London',
   'listingChecks',coalesce((select jsonb_agg(jsonb_build_object('workId',w.id,'checkedOn',d.data->>'checkedOn','platform',d.data->>'platform','listingVisible',d.data->'listingVisible','reviewSentiment',d.data->>'reviewSentiment','reviewAcknowledged',d.data->'reviewAcknowledged','suspended',d.data->'suspended','evidence',d.data->>'evidence')) from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where w.property_id=p.id and d.kind='listing_health' and (d.data->>'checkedOn')::date between start_on and end_on),'[]'),
   'pricing',coalesce((select jsonb_agg(jsonb_build_object('workId',w.id,'night',d.data->>'night','decision',d.data->>'decision','currentRateMinor',d.data->'currentRateMinor','proposedRateMinor',d.data->'proposedRateMinor','reason',d.data->>'reason','phase',d.data->>'phase','appliedAt',d.data->>'appliedAt')) from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where w.property_id=p.id and d.kind='daily_pricing' and (w.created_at at time zone 'Europe/London')::date between start_on and end_on),'[]'),
   'events',coalesce((select jsonb_agg(jsonb_build_object('name',e.name,'eventOn',e.event_on,'sourceUrl',e.source_url,'opportunity',e.opportunity)) from private.workspace_local_events e where e.property_id=p.id and e.archived_at is null and (e.created_at at time zone 'Europe/London')::date between start_on and end_on),'[]')) into result from public.workspace_properties p where p.id=target_property;
 elsif section='notifications' then
  result:=private.workspace_controls_read('notifications',null,null);
 elsif section='onboardingPayout' then
  if not (actor='client' and private.workspace_can_property(target_property,'client-dashboard') or actor in ('admin','super_admin') and private.workspace_can_property(target_property,'owner-statements')) then raise exception 'Payout details access denied' using errcode='42501';end if;
  select jsonb_build_object('bankAccountName',form->>'bankAccountName','bankAccountNumber',form->>'bankAccountNumber','bankSortCode',form->>'bankSortCode') into result from private.workspace_journeys where property_id=target_property;
  -- Deliberately excluded from portfolio, work, notifications and downloadable reports.
 else raise exception 'Unknown portfolio section' using errcode='22023';end if;
 return result;
end $$;
