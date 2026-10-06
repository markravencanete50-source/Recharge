-- Onboarding is the root journey. Notify its owner and authorised team,
-- and open one Ready inspection handover as soon as the prerequisites pass.
create or replace function private.workspace_journey_event(target uuid,event text) returns void language plpgsql security definer set search_path='' as $$
declare j private.workspace_journeys; event_id bigint; begin
 select * into j from private.workspace_journeys where property_id=target;
 insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(auth.uid(),target,j.work_id,event) returning id into event_id;
 insert into private.workspace_notification_outbox(user_id,work_id,event_id)
 select p.user_id,j.work_id,event_id from public.workspace_profiles p where p.status='active' and (
  p.user_id=j.client_id or p.role in ('admin','super_admin') or
  (p.role='stays' and exists(select 1 from public.workspace_module_grants g join public.workspace_property_assignments a on a.user_id=g.user_id where g.user_id=p.user_id and g.module_id='property-onboarding' and a.property_id=target))
 ) on conflict do nothing;
 if j.stage='inspection_to_book' and not exists(select 1 from private.workspace_domain_details d join public.workspace_work_items w on w.id=d.work_id where w.property_id=target and d.kind='inspection') then
  perform private.workspace_handover(target,'new-property-inspection-board','Book the new property inspection','inspection',jsonb_build_object('phase','ready_to_book'));
 end if;
end $$;
revoke all on function private.workspace_journey_event(uuid,text) from public,anon,authenticated;

-- Generic work edits cannot complete an onboarding journey or inspection.
create function private.workspace_onboarding_status_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare j private.workspace_journeys; begin
 select * into j from private.workspace_journeys where work_id=new.id;
 if found and new.status is distinct from (case when j.stage='live' then 'completed' when j.stage='archived' then 'declined' else 'waiting' end) then
  raise exception 'Use the property onboarding journey' using errcode='42501';
 end if;
 if new.status='completed' and exists(select 1 from private.workspace_domain_details d join private.workspace_journeys p on p.property_id=new.property_id where d.work_id=new.id and d.kind='inspection' and p.stage<>'inspection_complete' and p.stage<>'live') then
  raise exception 'Completed inspection report required' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function private.workspace_onboarding_status_guard() from public,anon,authenticated;
create trigger onboarding_status_guard before update of status on public.workspace_work_items for each row execute function private.workspace_onboarding_status_guard();

create or replace function private.workspace_journey_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare action text; actor_role text:=private.workspace_actor_role(); v_request_id uuid; target uuid; owner_id uuid; j private.workspace_journeys;
 previous private.workspace_action_receipts; result jsonb; fields jsonb; task uuid; invoice public.workspace_invoices; entry jsonb;
begin
 if actor_role is null then raise exception 'Active access required' using errcode='42501'; end if;
 action:=private.workspace_required_text(input,'action',1,60); v_request_id:=(input->>'requestId')::uuid;
 if v_request_id is null then raise exception 'Request identifier required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||v_request_id::text,0));
 select * into previous from private.workspace_action_receipts r where r.actor_id=auth.uid() and r.request_id=v_request_id;
 if found then
  if previous.actor_role<>actor_role or not (private.workspace_can_property((previous.result->>'propertyId')::uuid,'property-onboarding') or (actor_role='ready' and private.workspace_can_property((previous.result->>'propertyId')::uuid,'new-property-inspection-board'))) then raise exception 'Journey access changed' using errcode='42501';end if;
  if previous.input<>input then raise exception 'Request identifier reused' using errcode='23505'; end if; return previous.result;
 end if;
 if action='createEnquiry' then
  perform private.workspace_json_keys(input,array['action','requestId','clientId','name','address','region','propertyType','bedrooms','bathrooms']);
  if actor_role not in ('client','admin','super_admin','stays') or not private.has_workspace_module('property-onboarding') then raise exception 'Onboarding access denied' using errcode='42501'; end if;
  owner_id:=case when actor_role='client' then auth.uid() else (input->>'clientId')::uuid end;
  if owner_id is null or (actor_role='client' and input ? 'clientId' and (input->>'clientId')::uuid<>auth.uid()) or not exists(select 1 from public.workspace_profiles where user_id=owner_id and role='client' and status='active') then raise exception 'Active client required' using errcode='42501'; end if;
  insert into public.workspace_properties(name,address,region,bedrooms,created_by,request_id) values(
    private.workspace_required_text(input,'name',2,200),private.workspace_required_text(input,'address',5,1000),coalesce(input->>'region',''),(input->>'bedrooms')::int,auth.uid(),v_request_id) returning id into target;
  insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values(target,owner_id,'client',auth.uid());
  if actor_role='stays' then insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values(target,auth.uid(),'staff',auth.uid()); end if;
  insert into public.workspace_work_items(request_id,property_id,module_id,title,created_by,client_visible) values(v_request_id,target,'property-onboarding','Property onboarding',auth.uid(),true) returning id into task;
  insert into private.workspace_journeys(property_id,client_id,work_id,property_type,bathrooms) values(target,owner_id,task,private.workspace_required_text(input,'propertyType',2,120),(input->>'bathrooms')::int) returning * into j;
 else
  target:=(input->>'propertyId')::uuid;
  select * into j from private.workspace_journeys where property_id=target for update;
  if not found then raise exception 'Journey not found' using errcode='P0002'; end if;
  if not private.workspace_can_property(target,'property-onboarding') and not (actor_role in ('ready','stays') and private.workspace_can_property(target,'new-property-inspection-board') and action in ('bookInspection','completeInspection')) then raise exception 'Onboarding access denied' using errcode='42501'; end if;
  if j.version is distinct from (input->>'version')::int then raise exception 'Journey changed' using errcode='40001'; end if;
  if action='publishEstimate' then
   perform private.workspace_json_keys(input,array['action','requestId','propertyId','version','lowRateMinor','mediumRateMinor','highRateMinor','comparables','comments']);
   if actor_role not in ('stays','admin','super_admin') or j.stage not in ('enquiry','estimate','reviewing') then raise exception 'Estimate stage denied' using errcode='42501'; end if;
   if input->>'lowRateMinor' is null or input->>'mediumRateMinor' is null or input->>'highRateMinor' is null or (input->>'lowRateMinor')::bigint<100 or (input->>'mediumRateMinor')::bigint<(input->>'lowRateMinor')::bigint or (input->>'highRateMinor')::bigint<(input->>'mediumRateMinor')::bigint or (input->>'highRateMinor')::bigint>10000000 or jsonb_typeof(input->'comparables') is distinct from 'array' or jsonb_array_length(input->'comparables')>3 then raise exception 'Invalid estimate' using errcode='22023'; end if;
   for entry in select value from jsonb_array_elements(input->'comparables') loop
    perform private.workspace_json_keys(entry,array['name','url','adrMinor']);
    perform private.workspace_required_text(entry,'name',1,160);
    if private.workspace_required_text(entry,'url',9,1000)!~'^https://[^/@[:space:]]+([/:?#]|$)' or coalesce(entry->>'adrMinor','')!~'^\d+$' or (entry->>'adrMinor')::bigint>10000000 then raise exception 'Invalid comparable' using errcode='22023'; end if;
   end loop;
   update private.workspace_journeys set estimate=input-'action'-'requestId'-'propertyId'-'version',stage='estimate' where property_id=target;
  elsif action='decideEstimate' then
   perform private.workspace_json_keys(input,array['action','requestId','propertyId','version','decision','feedback','followUpOn']);
   if actor_role<>'client' or j.client_id<>auth.uid() or j.stage not in ('estimate','reviewing') then raise exception 'Owner estimate decision required' using errcode='42501'; end if;
   if coalesce(input->>'decision','') not in ('proceed','review','decline') or input->>'decision'='review' and (input->>'followUpOn')::date is null then raise exception 'Decision and follow-up required' using errcode='22023'; end if;
   update private.workspace_journeys set stage=case input->>'decision' when 'proceed' then 'agreement' when 'review' then 'reviewing' else 'archived' end,follow_up_on=(input->>'followUpOn')::date,feedback=coalesce(input->>'feedback','') where property_id=target;
   if input->>'decision'='decline' then update public.workspace_properties set status='archived',version=version+1 where id=target; update public.workspace_work_items set status='declined',version=version+1 where id=j.work_id; end if;
  elsif action='publishAgreement' then
   perform private.workspace_json_keys(input,array['action','requestId','propertyId','version','agreement']);
   if actor_role not in ('stays','admin','super_admin') or j.stage<>'agreement' or j.signed_at is not null then raise exception 'Agreement publishing denied' using errcode='42501'; end if;
   update private.workspace_journeys set agreement=private.workspace_required_text(input,'agreement',20,10000),agreement_revision=agreement_revision+1 where property_id=target;
  elsif action='signAgreement' then
   perform private.workspace_json_keys(input,array['action','requestId','propertyId','version','agreementRevision','signedName','consent']);
   if actor_role<>'client' or j.client_id<>auth.uid() or j.stage<>'agreement' or j.agreement='' or j.agreement_revision is distinct from (input->>'agreementRevision')::int or input->'consent' is distinct from 'true'::jsonb then raise exception 'Owner consent to current agreement required' using errcode='42501'; end if;
   update private.workspace_journeys set signed_name=private.workspace_required_text(input,'signedName',2,200),signed_at=now(),signed_revision=agreement_revision,stage='form' where property_id=target;
   perform private.workspace_handover(target,'onboarding-invoices','Issue onboarding invoice','onboarding_invoice',jsonb_build_object('journeyPropertyId',target,'recipientId',j.client_id));
  elsif action='submitForm' then
   perform private.workspace_json_keys(input,array['action','requestId','propertyId','version','form']); fields:=input->'form';
   perform private.workspace_json_keys(fields,array['businessName','bankAccountName','bankAccountNumber','bankSortCode','accessDate','accessInfo','utilitiesConnected','utilityInstallDate','prepaymentMeters','creditSwitchDate','broadbandConnected','broadbandInstallDate','hasGarden','mailPreference','warrantyDetails','preferredRepairContact','repairLimitMinor','fullRepairPermission','furnishingChoice','licensingRequired']);
   if actor_role<>'client' or j.client_id<>auth.uid() or j.stage<>'form' or j.signed_at is null then raise exception 'Signed owner form required' using errcode='42501'; end if;
   perform private.workspace_required_text(fields,'businessName',2,200); perform private.workspace_required_text(fields,'bankAccountName',2,200);
   if coalesce(fields->>'bankAccountNumber','')!~'^\d{8}$' or coalesce(fields->>'bankSortCode','')!~'^\d{2}-?\d{2}-?\d{2}$' or (fields->>'accessDate')::date is null or coalesce(fields->>'mailPreference','') not in ('photograph','open_and_photograph','leave_safely') or coalesce(fields->>'furnishingChoice','') not in ('self','recharge') or fields->>'repairLimitMinor' is null or (fields->>'repairLimitMinor')::bigint<0 or exists(select 1 from unnest(array['utilitiesConnected','prepaymentMeters','broadbandConnected','hasGarden','fullRepairPermission','licensingRequired']) k where jsonb_typeof(fields->k) is distinct from 'boolean') then raise exception 'Invalid onboarding preferences' using errcode='22023'; end if;
   perform private.workspace_required_text(fields,'accessInfo',2,10000);
   if (fields->>'repairLimitMinor')::bigint>10000000 or (not (fields->>'utilitiesConnected')::boolean and (fields->>'utilityInstallDate')::date is null) or ((fields->>'prepaymentMeters')::boolean and (fields->>'creditSwitchDate')::date is null) or (not (fields->>'broadbandConnected')::boolean and (fields->>'broadbandInstallDate')::date is null) then raise exception 'Planned utility dates required' using errcode='22023'; end if;
   update private.workspace_journeys set form=fields,submitted_at=now(),stage=case when exists(select 1 from public.workspace_invoices where id=j.invoice_id and status='paid') then 'inspection_to_book' else 'invoice' end where property_id=target;
   insert into private.workspace_property_secrets(property_id,access_instructions) values(target,fields->>'accessInfo') on conflict(property_id) do update set access_instructions=excluded.access_instructions;
   perform private.workspace_handover(target,'clean-property-onboarding','Review cleaning setup and mailbox preference','cleaning_setup',jsonb_build_object('mailPreference',fields->>'mailPreference'));
   if (fields->>'licensingRequired')::boolean then perform private.workspace_handover(target,'licensing','Complete licensing process','licensing','{}'); end if;
   if (fields->>'hasGarden')::boolean then perform private.workspace_handover(target,'routine-bin-garden-board','Arrange regular garden maintenance','garden_setup','{}'); end if;
   if fields->>'furnishingChoice'='recharge' then perform private.workspace_handover(target,'property-furnishing-board','Prepare furnishing quotation','furnishing_quote','{}'); end if;
  elsif action='linkInvoice' then
   perform private.workspace_json_keys(input,array['action','requestId','propertyId','version','invoiceId']);
   select * into invoice from public.workspace_invoices where id=(input->>'invoiceId')::uuid;
   if actor_role not in ('admin','super_admin') or j.signed_at is null or j.invoice_id is not null or invoice.property_id is distinct from target or invoice.recipient_id<>j.client_id or invoice.module_id<>'onboarding-invoices' or invoice.status='void' then raise exception 'Matching onboarding invoice required' using errcode='42501'; end if;
   update private.workspace_journeys set invoice_id=invoice.id,stage=case when submitted_at is not null and invoice.status='paid' then 'inspection_to_book' else stage end where property_id=target;
  elsif action='bookInspection' then
   perform private.workspace_json_keys(input,array['action','requestId','propertyId','version','inspectionOn']);
   if actor_role not in ('ready','stays','admin','super_admin') or j.stage<>'inspection_to_book' or not exists(select 1 from public.workspace_invoices where id=j.invoice_id and status='paid') or j.submitted_at is null or input->>'inspectionOn' is null or (input->>'inspectionOn')::date<(j.form->>'accessDate')::date then raise exception 'Paid invoice, completed form and access date required' using errcode='42501'; end if;
   update private.workspace_journeys set inspection_on=(input->>'inspectionOn')::date,stage='inspection_booked' where property_id=target;
   select w.id into task from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where w.property_id=target and d.kind='inspection' order by w.created_at limit 1;
   if task is null then
    task:=private.workspace_handover(target,'new-property-inspection-board','Complete booked property inspection','inspection',jsonb_build_object('phase','booked','inspectionOn',input->>'inspectionOn'));
   else
    update private.workspace_domain_details set data=jsonb_build_object('phase','booked','inspectionOn',input->>'inspectionOn') where work_id=task;
    update public.workspace_work_items set title='Complete booked property inspection' where id=task;
   end if;
   update public.workspace_work_items set due_on=(input->>'inspectionOn')::date where id=task;
  elsif action='completeInspection' then
   perform private.workspace_json_keys(input,array['action','requestId','propertyId','version','report']);
   if actor_role not in ('ready','stays','admin','super_admin') or j.stage<>'inspection_booked' then raise exception 'Booked inspection required' using errcode='42501'; end if;
   update private.workspace_journeys set inspection_report=private.workspace_required_text(input,'report',10,5000),inspection_completed_at=now(),stage='inspection_complete' where property_id=target;
   update public.workspace_work_items w set status='completed',completed_at=now(),version=version+1 where w.property_id=target and exists(select 1 from private.workspace_domain_details d where d.work_id=w.id and d.kind='inspection');
  elsif action='makeLive' then
   perform private.workspace_json_keys(input,array['action','requestId','propertyId','version','listingLinks']);
   if actor_role not in ('stays','admin','super_admin') or j.stage<>'inspection_complete' or jsonb_typeof(input->'listingLinks') is distinct from 'array' or jsonb_array_length(input->'listingLinks') not between 1 and 10 then raise exception 'Completed inspection and listing links required' using errcode='42501'; end if;
   for entry in select value from jsonb_array_elements(input->'listingLinks') loop
    perform private.workspace_json_keys(entry,array['platform','url']);
    if coalesce(entry->>'platform','') not in ('Airbnb','Booking.com','Direct','Comfy Workers') or private.workspace_required_text(entry,'url',9,1000)!~'^https://[^/@[:space:]]+([/:?#]|$)' then raise exception 'Valid HTTPS listing required' using errcode='22023'; end if;
   end loop;
   if exists(select 1 from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where w.property_id=target and d.kind in ('licensing','garden_setup','furnishing_quote','cleaning_setup','purchase') and w.status<>'completed') then raise exception 'Required onboarding handovers are unfinished' using errcode='42501'; end if;
   insert into private.workspace_listing_links(property_id,links) values(target,input->'listingLinks') on conflict(property_id) do update set links=excluded.links;
   update private.workspace_journeys set stage='live' where property_id=target;
   update public.workspace_properties set status='active',version=version+1 where id=target;
   update public.workspace_work_items set status='completed',completed_at=now(),version=version+1 where id=j.work_id;
  else raise exception 'Unknown journey action' using errcode='22023'; end if;
  update private.workspace_journeys set version=version+1,updated_at=now() where property_id=target returning * into j;
 end if;
 perform private.workspace_journey_event(target,'journey.'||action);
 result:=private.workspace_journey_view(j);
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),v_request_id,input,result);
 return result;
end $$;
revoke all on function private.workspace_journey_action(jsonb) from public,anon;
