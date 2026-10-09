-- Team beta onboarding. Owners have no accounts while the beta runs, so the team takes a property
-- from enquiry to live on the owner's behalf:
--  * an enquiry may be started without an owner account, with the enquirer's contact details;
--  * on a property with no owner account the team records the owner's estimate decision, the signed
--    agreement and the set-up form;
--  * an administrator records the onboarding invoice as handled outside the app.
-- A property that does have an owner account keeps the owner-only steps exactly as before.
alter table private.workspace_journeys alter column client_id drop not null;
alter table private.workspace_journeys add column if not exists enquiry jsonb not null default '{}';
alter table private.workspace_journeys add column if not exists invoice_outside_at timestamptz;
alter table private.workspace_journeys add column if not exists invoice_outside_note text not null default '';

-- The enquiry form's details, checked and trimmed. Without an owner account the contact name and an
-- email or phone number are required, so the team can reply.
create or replace function private.workspace_enquiry_details(d jsonb, contact_required boolean) returns jsonb language plpgsql immutable set search_path='' as $fn$
declare k text; res jsonb:='{}';
begin
 if jsonb_typeof(d) is distinct from 'object' then raise exception 'Invalid enquiry details' using errcode='22023'; end if;
 perform private.workspace_json_keys(d,array['contactName','companyName','email','phone','existingClient','wcs','parking','garden','photoLink','notes']);
 foreach k in array array['contactName','companyName','email','phone','parking','garden','photoLink','notes'] loop
  if d ? k then
   if jsonb_typeof(d->k)<>'string' or length(d->>k)>(array[300,3000])[(k='notes')::int+1] then raise exception 'Invalid enquiry details' using errcode='22023'; end if;
   if btrim(d->>k)<>'' then res:=res||jsonb_build_object(k,btrim(d->>k)); end if;
  end if;
 end loop;
 if d ? 'existingClient' then
  if jsonb_typeof(d->'existingClient')<>'boolean' then raise exception 'Invalid enquiry details' using errcode='22023'; end if;
  res:=res||jsonb_build_object('existingClient',d->'existingClient');
 end if;
 if d ? 'wcs' then
  if jsonb_typeof(d->'wcs')<>'number' or d->>'wcs'!~'^\d+$' or (d->>'wcs')::int>40 then raise exception 'Invalid enquiry details' using errcode='22023'; end if;
  res:=res||jsonb_build_object('wcs',(d->>'wcs')::int);
 end if;
 if res ? 'email' and res->>'email'!~'^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'Enter a valid email address' using errcode='22023'; end if;
 if res ? 'phone' and res->>'phone'!~'^\+?[0-9 ()-]{7,20}$' then raise exception 'Enter a valid phone number' using errcode='22023'; end if;
 if res ? 'photoLink' and res->>'photoLink'!~'^https://[^/@[:space:]]+([/:?#]|$)' then raise exception 'The photo link must start with https://' using errcode='22023'; end if;
 if contact_required and (length(coalesce(res->>'contactName',''))<2 or not (res ? 'email' or res ? 'phone')) then raise exception 'Add the contact''s name and an email or phone number' using errcode='22023'; end if;
 return res;
end $fn$;
revoke all on function private.workspace_enquiry_details(jsonb,boolean) from public,anon,authenticated;

create or replace function private.workspace_journey_view(j private.workspace_journeys)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare safe_form jsonb; begin
 safe_form:=j.form-'bankAccountName'-'bankAccountNumber'-'bankSortCode'-'accessInfo';
 return jsonb_build_object('propertyId',j.property_id,'clientId',j.client_id,'workId',j.work_id,'stage',j.stage,'propertyType',j.property_type,'bathrooms',j.bathrooms,
 'estimate',j.estimate,'followUpOn',j.follow_up_on,'feedback',j.feedback,'agreement',j.agreement,'agreementRevision',j.agreement_revision,
 'signedName',j.signed_name,'signedAt',j.signed_at,'signedRevision',j.signed_revision,'form',safe_form,'submittedAt',j.submitted_at,
 'invoiceId',j.invoice_id,'inspectionOn',j.inspection_on,'inspectionCompletedAt',j.inspection_completed_at,'inspectionReport',j.inspection_report,'inspectionChecks',j.inspection_checks,'version',j.version,
 'enquiry',j.enquiry,'ownerAccount',j.client_id is not null,'invoiceOutsideAt',j.invoice_outside_at,'invoiceOutsideNote',j.invoice_outside_note,
 'questions',coalesce((select jsonb_agg(jsonb_build_object('id',q.id,'question',q.question,'askedAt',q.asked_at,'askedByOwner',q.asked_by=j.client_id,'answer',q.answer,'answeredAt',q.answered_at) order by q.asked_at)
   from private.workspace_journey_questions q where q.property_id=j.property_id),'[]'));
end $function$;

create or replace function private.workspace_journey_action(input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare action text; for_owner boolean; actor_role text:=private.workspace_actor_role(); v_request_id uuid; target uuid; owner_id uuid; j private.workspace_journeys;
 previous private.workspace_action_receipts; result jsonb; fields jsonb; task uuid; invoice public.workspace_invoices; entry jsonb;
begin
 if actor_role is null then raise exception 'Active access required' using errcode='42501'; end if;
 action:=private.workspace_required_text(input,'action',1,60); v_request_id:=(input->>'requestId')::uuid;
 if v_request_id is null then raise exception 'Request identifier required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||v_request_id::text,0));
 select * into previous from private.workspace_action_receipts r where r.actor_id=auth.uid() and r.request_id=v_request_id;
 if found then
  if previous.actor_role<>actor_role or not (private.workspace_can_property((previous.result->>'propertyId')::uuid,'property-onboarding') or (actor_role='ready' and private.workspace_can_property((previous.result->>'propertyId')::uuid,'new-property-inspection-board'))) then raise exception 'Journey access changed' using errcode='42501';end if;
  if previous.input<>(input#-'{form,bankAccountName}'#-'{form,bankAccountNumber}'#-'{form,bankSortCode}') then raise exception 'Request identifier reused' using errcode='23505'; end if; return previous.result;
 end if;
 if action='createEnquiry' then
  perform private.workspace_json_keys(input,array['action','requestId','clientId','name','address','region','propertyType','bedrooms','bathrooms','enquiry']);
  if actor_role not in ('client','admin','super_admin','stays') or not private.has_workspace_module('property-onboarding') then raise exception 'Onboarding access denied' using errcode='42501'; end if;
  owner_id:=case when actor_role='client' then auth.uid() else (input->>'clientId')::uuid end;
  -- The team may start an enquiry for someone without an owner account (the team beta has none).
  if (owner_id is null and actor_role='client') or (actor_role='client' and input ? 'clientId' and (input->>'clientId')::uuid<>auth.uid()) or (owner_id is not null and not exists(select 1 from public.workspace_profiles where user_id=owner_id and role='client' and status='active')) then raise exception 'Active client required' using errcode='42501'; end if;
  fields:=private.workspace_enquiry_details(coalesce(input->'enquiry','{}'),owner_id is null);
  insert into public.workspace_properties(name,address,region,bedrooms,created_by,request_id) values(
    private.workspace_required_text(input,'name',2,200),private.workspace_required_text(input,'address',5,1000),coalesce(input->>'region',''),(input->>'bedrooms')::int,auth.uid(),v_request_id) returning id into target;
  if owner_id is not null then insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values(target,owner_id,'client',auth.uid()); end if;
  if actor_role='stays' then insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values(target,auth.uid(),'staff',auth.uid()); end if;
  insert into public.workspace_work_items(request_id,property_id,module_id,title,created_by,client_visible) values(v_request_id,target,'property-onboarding','Property onboarding',auth.uid(),true) returning id into task;
  insert into private.workspace_journeys(property_id,client_id,work_id,property_type,bathrooms,enquiry) values(target,owner_id,task,private.workspace_required_text(input,'propertyType',2,120),(input->>'bathrooms')::int,fields) returning * into j;
 else
  target:=(input->>'propertyId')::uuid;
  select * into j from private.workspace_journeys where property_id=target for update;
  if not found then raise exception 'Journey not found' using errcode='P0002'; end if;
  if not private.workspace_can_property(target,'property-onboarding') and not (actor_role in ('ready','stays') and private.workspace_can_property(target,'new-property-inspection-board') and action in ('bookInspection','completeInspection')) then raise exception 'Onboarding access denied' using errcode='42501'; end if;
  if j.version is distinct from (input->>'version')::int then raise exception 'Journey changed' using errcode='40001'; end if;
  for_owner:=(actor_role='client' and j.client_id is not distinct from auth.uid()) or (j.client_id is null and actor_role in ('stays','admin','super_admin'));
  if action='publishEstimate' then
   perform private.workspace_json_keys(input,array['action','requestId','propertyId','version','lowRateMinor','mediumRateMinor','highRateMinor','comparables','comments','occupancyBps','directBookingBps','otaFeeBps','managementFeeBps']);
   if actor_role not in ('stays','admin','super_admin') or j.stage not in ('enquiry','estimate','reviewing') then raise exception 'Estimate stage denied' using errcode='42501'; end if;
   if input->>'lowRateMinor' is null or input->>'mediumRateMinor' is null or input->>'highRateMinor' is null or (input->>'lowRateMinor')::bigint<100 or (input->>'mediumRateMinor')::bigint<(input->>'lowRateMinor')::bigint or (input->>'highRateMinor')::bigint<(input->>'mediumRateMinor')::bigint or (input->>'highRateMinor')::bigint>10000000 or jsonb_typeof(input->'comparables') is distinct from 'array' or jsonb_array_length(input->'comparables')>3 then raise exception 'Invalid estimate' using errcode='22023'; end if;
   for entry in select value from jsonb_array_elements(input->'comparables') loop
    perform private.workspace_json_keys(entry,array['name','url','adrMinor']);
    perform private.workspace_required_text(entry,'name',1,160);
    if private.workspace_required_text(entry,'url',9,1000)!~'^https://[^/@[:space:]]+([/:?#]|$)' or coalesce(entry->>'adrMinor','')!~'^\d+$' or (entry->>'adrMinor')::bigint>10000000 then raise exception 'Invalid comparable' using errcode='22023'; end if;
   end loop;
   if exists(select 1 from unnest(array['occupancyBps','directBookingBps','otaFeeBps','managementFeeBps']) k where input ? k and (jsonb_typeof(input->k) is distinct from 'number' or input->>k!~'^\d+$' or (input->>k)::numeric>10000)) then raise exception 'Invalid estimate assumptions' using errcode='22023'; end if;
   update private.workspace_journeys set estimate=input-'action'-'requestId'-'propertyId'-'version',stage='estimate' where property_id=target;
  elsif action='decideEstimate' then
   perform private.workspace_json_keys(input,array['action','requestId','propertyId','version','decision','feedback','followUpOn']);
   if not for_owner or j.stage not in ('estimate','reviewing') then raise exception 'Owner estimate decision required' using errcode='42501'; end if;
   if coalesce(input->>'decision','') not in ('proceed','review','decline') or input->>'decision'='review' and (input->>'followUpOn')::date is null then raise exception 'Decision and follow-up required' using errcode='22023'; end if;
   update private.workspace_journeys set stage=case input->>'decision' when 'proceed' then 'agreement' when 'review' then 'reviewing' else 'archived' end,follow_up_on=(input->>'followUpOn')::date,feedback=coalesce(input->>'feedback','') where property_id=target;
   if input->>'decision'='decline' then update public.workspace_properties set status='archived',version=version+1 where id=target; update public.workspace_work_items set status='declined',version=version+1 where id=j.work_id; end if;
  elsif action='publishAgreement' then
   perform private.workspace_json_keys(input,array['action','requestId','propertyId','version','agreement']);
   if actor_role not in ('stays','admin','super_admin') or j.stage<>'agreement' or j.signed_at is not null then raise exception 'Agreement publishing denied' using errcode='42501'; end if;
   update private.workspace_journeys set agreement=private.workspace_required_text(input,'agreement',20,10000),agreement_revision=agreement_revision+1 where property_id=target;
  elsif action='signAgreement' then
   perform private.workspace_json_keys(input,array['action','requestId','propertyId','version','agreementRevision','signedName','consent']);
   if not for_owner or j.stage<>'agreement' or j.agreement='' or j.agreement_revision is distinct from (input->>'agreementRevision')::int or input->'consent' is distinct from 'true'::jsonb then raise exception 'Owner consent to current agreement required' using errcode='42501'; end if;
   update private.workspace_journeys set signed_name=private.workspace_required_text(input,'signedName',2,200),signed_at=now(),signed_revision=agreement_revision,stage='form' where property_id=target;
   -- Without an owner account the invoice is handled outside the app (recordInvoiceOutside).
   if j.client_id is not null then perform private.workspace_handover(target,'onboarding-invoices','Issue onboarding invoice','onboarding_invoice',jsonb_build_object('journeyPropertyId',target,'recipientId',j.client_id)); end if;
  elsif action='submitForm' then
   perform private.workspace_json_keys(input,array['action','requestId','propertyId','version','form']); fields:=input->'form';
   perform private.workspace_json_keys(fields,array['businessName','bankAccountName','bankAccountNumber','bankSortCode','accessDate','accessInfo','utilitiesConnected','utilityInstallDate','prepaymentMeters','creditSwitchDate','broadbandConnected','broadbandInstallDate','hasGarden','mailPreference','warrantyDetails','preferredRepairContact','repairLimitMinor','fullRepairPermission','furnishingChoice','licensingRequired','gasElectricMeters','operatingStatus']);
   if not for_owner or j.stage<>'form' or j.signed_at is null then raise exception 'Signed owner form required' using errcode='42501'; end if;
   perform private.workspace_required_text(fields,'businessName',2,200); perform private.workspace_required_text(fields,'bankAccountName',2,200);
   if coalesce(fields->>'bankAccountNumber','')!~'^\d{8}$' or coalesce(fields->>'bankSortCode','')!~'^\d{2}-?\d{2}-?\d{2}$' or (fields->>'accessDate')::date is null or coalesce(fields->>'mailPreference','') not in ('photograph','open_and_photograph','leave_safely') or coalesce(fields->>'furnishingChoice','') not in ('self','recharge') or fields->>'repairLimitMinor' is null or (fields->>'repairLimitMinor')::bigint<0 or exists(select 1 from unnest(array['utilitiesConnected','prepaymentMeters','broadbandConnected','hasGarden','fullRepairPermission','licensingRequired']) k where jsonb_typeof(fields->k) is distinct from 'boolean') then raise exception 'Invalid onboarding preferences' using errcode='22023'; end if;
   perform private.workspace_required_text(fields,'accessInfo',2,10000);
   if length(coalesce(fields->>'gasElectricMeters',''))>2000 or length(coalesce(fields->>'operatingStatus',''))>2000 or exists(select 1 from unnest(array['gasElectricMeters','operatingStatus']) k where fields ? k and jsonb_typeof(fields->k)<>'string') then raise exception 'Invalid onboarding preferences' using errcode='22023'; end if;
   perform private.workspace_store_bank_details(target,j.client_id,fields);
   fields:=fields-'bankAccountName'-'bankAccountNumber'-'bankSortCode';
   input:=input#-'{form,bankAccountName}'#-'{form,bankAccountNumber}'#-'{form,bankSortCode}';
   if (fields->>'repairLimitMinor')::bigint>10000000 or (not (fields->>'utilitiesConnected')::boolean and (fields->>'utilityInstallDate')::date is null) or ((fields->>'prepaymentMeters')::boolean and (fields->>'creditSwitchDate')::date is null) or (not (fields->>'broadbandConnected')::boolean and (fields->>'broadbandInstallDate')::date is null) then raise exception 'Planned utility dates required' using errcode='22023'; end if;
   update private.workspace_journeys set form=fields,submitted_at=now(),stage=case when j.invoice_outside_at is not null or exists(select 1 from public.workspace_invoices where id=j.invoice_id and status='paid') then 'inspection_to_book' else 'invoice' end where property_id=target;
   insert into private.workspace_property_secrets(property_id,access_instructions) values(target,fields->>'accessInfo') on conflict(property_id) do update set access_instructions=excluded.access_instructions;
   perform private.workspace_handover(target,'clean-property-onboarding','Review cleaning setup and mailbox preference','cleaning_setup',jsonb_build_object('mailPreference',fields->>'mailPreference'));
   if (fields->>'licensingRequired')::boolean then perform private.workspace_handover(target,'licensing','Complete licensing process','licensing','{}'); end if;
   if (fields->>'hasGarden')::boolean then perform private.workspace_handover(target,'routine-bin-garden-board','Arrange regular garden maintenance','garden_setup','{}');
    if not exists(select 1 from private.workspace_routine_plans where property_id=target and module_id='routine-bin-garden-board' and active) then
     insert into private.workspace_routine_plans(property_id,module_id,title,checklist,frequency,day_of_month,assignee_id,active,starts_on,created_by,request_id)
      values(target,'routine-bin-garden-board','Garden and bins','["Cut the grass and tidy the edges","Weed beds and paths","Clear leaves and litter","Check the bins go out on collection day and come back in","Note anything that needs a repair"]'::jsonb,
       'monthly',1,null,true,date_trunc('month',current_date)::date,auth.uid(),gen_random_uuid());
    end if;
   end if;
   if fields->>'furnishingChoice'='recharge' then perform private.workspace_handover(target,'property-furnishing-board','Prepare furnishing quotation','furnishing_quote','{}'); end if;
  elsif action='linkInvoice' then
   perform private.workspace_json_keys(input,array['action','requestId','propertyId','version','invoiceId']);
   select * into invoice from public.workspace_invoices where id=(input->>'invoiceId')::uuid;
   if actor_role not in ('admin','super_admin') or j.signed_at is null or (j.invoice_id is not null and j.invoice_id<>invoice.id) or invoice.property_id is distinct from target or invoice.recipient_id is distinct from j.client_id or invoice.module_id<>'onboarding-invoices' or invoice.status='void' then raise exception 'Matching onboarding invoice required' using errcode='42501'; end if;
   update private.workspace_journeys set invoice_id=invoice.id,stage=case when submitted_at is not null and invoice.status='paid' then 'inspection_to_book' else stage end where property_id=target;
  elsif action='recordInvoiceOutside' then
   -- Without an owner account there is no one to address an invoice to, so an administrator records
   -- the onboarding invoice handled elsewhere (for example raised and paid in the accounts system).
   perform private.workspace_json_keys(input,array['action','requestId','propertyId','version','note']);
   if actor_role not in ('admin','super_admin') or j.client_id is not null or j.signed_at is null or j.invoice_outside_at is not null or j.stage not in ('form','invoice') then raise exception 'Only for a signed property without an owner account' using errcode='42501'; end if;
   update private.workspace_journeys set invoice_outside_at=now(),invoice_outside_note=private.workspace_required_text(input,'note',3,500),stage=case when submitted_at is not null then 'inspection_to_book' else stage end where property_id=target;
   update public.workspace_work_items w set status='completed',completed_at=now(),version=version+1 where w.property_id=target and w.status<>'completed' and exists(select 1 from private.workspace_domain_details d where d.work_id=w.id and d.kind='onboarding_invoice');
  elsif action='bookInspection' then
   perform private.workspace_json_keys(input,array['action','requestId','propertyId','version','inspectionOn']);
   if actor_role not in ('ready','stays','admin','super_admin') or j.stage<>'inspection_to_book' or (j.invoice_outside_at is null and not exists(select 1 from public.workspace_invoices where id=j.invoice_id and status='paid')) or j.submitted_at is null or input->>'inspectionOn' is null or (input->>'inspectionOn')::date<(j.form->>'accessDate')::date then raise exception 'Paid invoice, completed form and access date required' using errcode='42501'; end if;
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
   perform private.workspace_json_keys(input,array['action','requestId','propertyId','version','report','checks','issues']);
   if input ? 'checks' and (jsonb_typeof(input->'checks') is distinct from 'object' or exists(select 1 from jsonb_each(input->'checks') c where jsonb_typeof(c.value)<>'boolean' or c.key not in ('keysAccess','alarms','heatingHotWater','appliances','wifi','damage','furnishing','safetyItems','guestReady'))) then raise exception 'Invalid inspection checklist' using errcode='22023'; end if;
   if length(coalesce(input->>'issues',''))>3000 then raise exception 'Issues note is too long' using errcode='22023'; end if;
   if actor_role not in ('ready','stays','admin','super_admin') or j.stage<>'inspection_booked' then raise exception 'Booked inspection required' using errcode='42501'; end if;
   update private.workspace_journeys set inspection_report=private.workspace_required_text(input,'report',10,5000),inspection_checks=jsonb_build_object('checks',coalesce(input->'checks','{}'),'issues',coalesce(input->>'issues','')),inspection_completed_at=now(),stage='inspection_complete' where property_id=target;
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
  elsif action='askQuestion' then
   perform private.workspace_json_keys(input,array['action','requestId','propertyId','version','question']);
   if not ((actor_role='client' and j.client_id is not distinct from auth.uid()) or actor_role in ('stays','admin','super_admin')) then raise exception 'Only the owner or the team can ask here' using errcode='42501'; end if;
   insert into private.workspace_journey_questions(property_id,asked_by,question) values(target,auth.uid(),private.workspace_required_text(input,'question',5,2000));
  elsif action='answerQuestion' then
   perform private.workspace_json_keys(input,array['action','requestId','propertyId','version','questionId','answer']);
   if actor_role not in ('stays','admin','super_admin') then raise exception 'Team answer required' using errcode='42501'; end if;
   update private.workspace_journey_questions set answer=private.workspace_required_text(input,'answer',2,2000),answered_by=auth.uid(),answered_at=now()
    where id=(input->>'questionId')::uuid and property_id=target and answered_at is null;
   if not found then raise exception 'That question has already been answered' using errcode='22023'; end if;
  else raise exception 'Unknown journey action' using errcode='22023'; end if;
  update private.workspace_journeys set version=version+1,updated_at=now() where property_id=target returning * into j;
 end if;
 perform private.workspace_journey_event(target,'journey.'||action);
 result:=private.workspace_journey_view(j);
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),v_request_id,input,result);
 return result;
end $function$;
