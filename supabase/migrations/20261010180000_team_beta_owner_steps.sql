-- Team beta: the app learns whether owner accounts are switched off, and the team records an owner's
-- decision on a repair cost (agreed by phone or email) for a property whose owner has no account, or
-- for any property while the beta is on. A note of how the owner agreed is kept with the approval.
create or replace function private.workspace_account() returns jsonb language plpgsql stable security definer set search_path='' as $fn$
begin
  if not private.has_workspace_session() then raise exception 'Verified sign-in required' using errcode = '42501'; end if;
  return private.workspace_account_json(auth.uid())||jsonb_build_object('teamOnly',coalesce((select m.team_only from private.workspace_beta_mode m where m.singleton),false));
end;
$fn$;

create or replace function private.workspace_team_records_owner(prop uuid) returns boolean language sql stable security definer set search_path='' as $fn$
 select private.workspace_actor_role() in ('admin','super_admin','stays') and private.workspace_can_property(prop,'stays-maintenance-reporting')
  and (coalesce((select m.team_only from private.workspace_beta_mode m where m.singleton),false)
   or not exists(select 1 from public.workspace_property_assignments a join public.workspace_profiles c on c.user_id=a.user_id where a.property_id=prop and a.assignment='client' and c.role='client' and c.status='active'))
$fn$;
revoke all on function private.workspace_team_records_owner(uuid) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION private.workspace_operations_action(input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
<<operation>>
declare actor text:=private.workspace_actor_role(); a text; req uuid; prop uuid; target uuid; prior private.workspace_action_receipts;
 w public.workspace_work_items; d private.workspace_domain_details; policy private.workspace_booking_policy; reservation private.workspace_reservations;
 invoice public.workspace_invoices; j private.workspace_journeys; data jsonb; result jsonb; feature text; kind text; title text;
 next_status text; step text; amount bigint; evidence_count integer; event_id bigint; entry jsonb; notify_users uuid[]:='{}';
begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 a:=private.workspace_required_text(input,'action',1,60);req:=(input->>'requestId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 select * into prior from private.workspace_action_receipts r where r.actor_id=auth.uid() and r.request_id=req;
 if found then
  if prior.actor_role<>actor or (a='configureBookingPolicy' and actor<>'super_admin') or (a='recordReservation' and not private.workspace_can_property((prior.result->'reservation'->>'property_id')::uuid,'direct-bookings')) or (a in ('createOperation','updateOperation') and not private.workspace_operation_access((prior.result->>'workId')::uuid)) then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;return prior.result;
 end if;
 if a='configureBookingPolicy' then
  perform private.workspace_json_keys(input,array['action','requestId','version','minimumNights','discountBps','discountCapMinor','confirmed']);
  if actor<>'super_admin' then raise exception 'Super admin policy approval required' using errcode='42501';end if;
  select * into policy from private.workspace_booking_policy where singleton for update;
  if policy.version is distinct from (input->>'version')::int then raise exception 'Policy changed' using errcode='40001';end if;
  if coalesce(input->>'minimumNights','')!~'^\d+$' or (input->>'minimumNights')::int not between 1 and 365 or coalesce(input->>'discountBps','')!~'^\d+$' or (input->>'discountBps')::int>10000 or jsonb_typeof(input->'confirmed') is distinct from 'boolean' then raise exception 'Invalid policy' using errcode='22023';end if;
  update private.workspace_booking_policy set minimum_nights=(input->>'minimumNights')::int,discount_bps=(input->>'discountBps')::int,discount_cap_minor=private.workspace_money(input,'discountCapMinor'),confirmed=(input->>'confirmed')::boolean,version=version+1 where singleton returning * into policy;
  result:=to_jsonb(policy)-'singleton';
  insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'policy.direct_booking_updated');
 elsif a='recordReservation' then
  perform private.workspace_json_keys(input,array['action','requestId','propertyId','reference','checkIn','checkOut','status']);
  prop:=(input->>'propertyId')::uuid;
  if actor not in ('stays','admin','super_admin') or not private.workspace_can_property(prop,'direct-bookings') then raise exception 'Reservation access denied' using errcode='42501';end if;
  perform pg_advisory_xact_lock(hashtextextended(prop::text,42));
  if coalesce(input->>'status','') not in ('enquiry','confirmed','cancelled') or (input->>'checkIn')::date is null or (input->>'checkOut')::date is null then raise exception 'Reservation dates required' using errcode='22023';end if;
  if input->>'status'='confirmed' and exists(select 1 from private.workspace_reservations where property_id=prop and status='confirmed' and check_in<(input->>'checkOut')::date and check_out>(input->>'checkIn')::date) then raise exception 'Reservation overlaps occupied dates' using errcode='23505';end if;
  insert into private.workspace_reservations(property_id,reference,check_in,check_out,status,source,created_by)
   values(prop,private.workspace_required_text(input,'reference',1,120),(input->>'checkIn')::date,(input->>'checkOut')::date,input->>'status','manual',auth.uid()) returning * into reservation;
  select * into policy from private.workspace_booking_policy where singleton;
  if reservation.status<>'cancelled' and reservation.check_out-reservation.check_in>=policy.minimum_nights then
   target:=private.workspace_handover(prop,'direct-bookings','Follow up eligible direct booking','direct_booking',jsonb_build_object('reservationId',reservation.id,'phase','follow_up','workStatus','waiting'));
  end if;
  result:=jsonb_build_object('reservation',to_jsonb(reservation),'followUpWorkId',target,'discountConfirmed',policy.confirmed);
 else
  if a='createOperation' then
   perform private.workspace_json_keys(input,array['action','requestId','propertyId','kind','data']);
   prop:=(input->>'propertyId')::uuid;kind:=input->>'kind';data:=input->'data';
   select * into j from private.workspace_journeys where property_id=prop;
   if kind='listing_health' then
    feature:='listing-health';title:='Daily listing health check';
    perform private.workspace_json_keys(data,array['checkedOn','platform','listingVisible','reviewSentiment','reviewAcknowledged','suspended','evidence','relist']);
    if data ? 'relist' and jsonb_typeof(data->'relist') is distinct from 'boolean' then raise exception 'Choose whether to re-list' using errcode='22023';end if;
    if actor not in ('stays','admin','super_admin') or coalesce(data->>'platform','') not in ('Airbnb','Booking.com','Direct','Comfy Workers') or (data->>'checkedOn')::date is null or coalesce(data->>'reviewSentiment','') not in ('none','positive','negative') or exists(select 1 from unnest(array['listingVisible','reviewAcknowledged','suspended']) k where jsonb_typeof(data->k) is distinct from 'boolean') or (data->>'reviewSentiment'<>'none' and not (data->>'reviewAcknowledged')::boolean) then raise exception 'Acknowledge reviews and record listing evidence' using errcode='22023';end if;
    perform private.workspace_required_text(data,'evidence',5,2000);
   elsif kind='guest_review' then
    -- One guest review, acknowledged as good or bad; a bad one can be sent for re-listing.
    feature:='listing-health';title:='Guest review';
    perform private.workspace_json_keys(data,array['platform','reviewedOn','rating','outOf','sentiment','summary','relist','response']);
    if actor not in ('stays','admin','super_admin') or coalesce(data->>'platform','') not in ('Airbnb','Booking.com','Direct','Comfy Workers') or (data->>'reviewedOn')::date is null or (data->>'reviewedOn')::date>current_date
     or coalesce(data->>'outOf','') not in ('5','10') or coalesce(data->>'rating','')!~'^\d+$' or (data->>'rating')::int not between 1 and (data->>'outOf')::int
     or coalesce(data->>'sentiment','') not in ('positive','neutral','negative') or jsonb_typeof(data->'relist') is distinct from 'boolean' or ((data->>'relist')::boolean and data->>'sentiment'<>'negative') then raise exception 'Record the review, its rating and whether it is good or bad' using errcode='22023';end if;
    perform private.workspace_required_text(data,'summary',5,2000);
    if data ? 'response' and length(coalesce(data->>'response',''))>2000 then raise exception 'Response is too long' using errcode='22023';end if;
   elsif kind='daily_pricing' then
    feature:='daily-pricing';title:='Daily pricing decision';
    perform private.workspace_json_keys(data,array['night','currentRateMinor','proposedRateMinor','decision','reason']);
    if actor not in ('stays','admin','super_admin') or (data->>'night')::date is null or (data->>'night')::date not between current_date and current_date+6 or coalesce(data->>'decision','') not in ('hold','change') then raise exception 'Choose a vacant night in the next seven days' using errcode='22023';end if;
    perform pg_advisory_xact_lock(hashtextextended(prop::text,42));
    if exists(select 1 from private.workspace_reservations where property_id=prop and status='confirmed' and check_in<=(data->>'night')::date and check_out>(data->>'night')::date) then raise exception 'Night is occupied' using errcode='22023';end if;
    perform private.workspace_money(data,'currentRateMinor');perform private.workspace_money(data,'proposedRateMinor');perform private.workspace_required_text(data,'reason',5,2000);
    if data->>'decision'='hold' and data->'currentRateMinor'<>data->'proposedRateMinor' then raise exception 'Hold must retain the current rate' using errcode='22023';end if;
    data:=data||jsonb_build_object('phase','proposed');
   elsif kind='maintenance' then
    feature:='stays-maintenance-reporting';title:='Property repair request';
    perform private.workspace_json_keys(data,array['issue','reservationId','estimatedCostMinor','hazard','repairType','urgent']);
    if coalesce(data->>'repairType','other') not in ('heating','hot_water','leak','toilet_drain','electrics','appliance','wifi','locks_access','pests','damage','other') or (data ? 'urgent' and jsonb_typeof(data->'urgent') is distinct from 'boolean') then raise exception 'Choose a repair type' using errcode='22023';end if;
    if actor not in ('client','stays','admin','super_admin') or jsonb_typeof(data->'hazard') is distinct from 'boolean' then raise exception 'Repair request denied' using errcode='42501';end if;
    perform private.workspace_required_text(data,'issue',5,3000);amount:=private.workspace_money(data,'estimatedCostMinor');
    if data->>'reservationId' is not null and not exists(select 1 from private.workspace_reservations where id=(data->>'reservationId')::uuid and property_id=prop) then raise exception 'Reservation belongs to another property' using errcode='42501';end if;
    data:=data||jsonb_build_object('phase',case when coalesce((j.form->>'fullRepairPermission')::boolean,false) or amount<=coalesce((j.form->>'repairLimitMinor')::bigint,0) then 'triage' else 'owner_approval' end,'warrantyRequired',coalesce(j.form->>'warrantyDetails','')<>'','workStatus','waiting','repairType',coalesce(data->>'repairType','other'),'urgent',coalesce((data->>'urgent')::boolean,false),'contactFirst',nullif(j.form->>'preferredRepairContact',''),'warrantyDetails',nullif(j.form->>'warrantyDetails',''),'reportedBy',auth.uid());
    if data->>'phase'='triage' and private.workspace_repair_needs_management(amount,'{}'::jsonb) then data:=data||jsonb_build_object('phase','management_approval');notify_users:=private.workspace_repair_managers();end if;
   elsif kind='cleaning' then
    feature:='cleaning-schedule';title:='Assigned property clean';
    perform private.workspace_json_keys(data,array['dueOn','checklist']);
    if actor not in ('cleaning_manager','stays','admin','super_admin') or (data->>'dueOn')::date is null or jsonb_typeof(data->'checklist') is distinct from 'array' or jsonb_array_length(data->'checklist') not between 1 and 30 or exists(select 1 from jsonb_array_elements(data->'checklist') e where jsonb_typeof(e)<>'string' or length(trim(e#>>'{}')) not between 1 and 200) then raise exception 'Cleaning manager checklist required' using errcode='42501';end if;
    data:=data||jsonb_build_object('phase','assigned','workStatus','waiting','mailPreference',j.form->>'mailPreference');
   elsif kind='purchase' then
    feature:='purchase-order-requests';title:='Property purchase request';
    perform private.workspace_json_keys(data,array['requirements','budgetMinor']);
    if actor not in ('client','stays','ready','admin','super_admin') then raise exception 'Purchase permission required' using errcode='42501';end if;
    perform private.workspace_required_text(data,'requirements',5,3000);perform private.workspace_money(data,'budgetMinor');data:=data||jsonb_build_object('phase','requested','workStatus','waiting');
    notify_users:=array(select p.user_id from public.workspace_profiles p join public.workspace_module_grants g on g.user_id=p.user_id and g.module_id='purchase-order-accounts' where p.role='accounts' and p.status='active');
   else raise exception 'Unknown operational kind' using errcode='22023';end if;
   if not private.workspace_can_property(prop,case when actor='client' and kind='maintenance' then 'client-property-maintenance' when actor='client' and kind='purchase' then 'client-purchase-order-quotes' when actor='ready' and kind='purchase' then 'purchase-order' else feature end) then raise exception 'Property tool access denied' using errcode='42501';end if;
   -- One actual check per property/platform/day and one actual rate decision per night/day.
   if kind in ('listing_health','daily_pricing') then
    perform pg_advisory_xact_lock(hashtextextended(prop::text||kind||coalesce(data->>'checkedOn',data->>'night')||coalesce(data->>'platform','')||current_date::text,0));
    if exists(select 1 from private.workspace_domain_details dd join public.workspace_work_items ww on ww.id=dd.work_id where ww.property_id=prop and dd.kind=operation.kind and ww.created_at::date=current_date and (operation.kind='listing_health' and dd.data->>'checkedOn'=operation.data->>'checkedOn' and dd.data->>'platform'=operation.data->>'platform' or operation.kind='daily_pricing' and dd.data->>'night'=operation.data->>'night')) then raise exception 'Daily check already exists' using errcode='23505';end if;
   end if;
   target:=private.workspace_handover(prop,feature,title,kind,data);
   if kind in ('listing_health','guest_review') then update public.workspace_work_items set status='completed',completed_at=now() where id=target;update private.workspace_domain_details dd set data=dd.data||'{"workStatus":"completed"}' where dd.work_id=target;end if;
   if kind in ('maintenance','purchase') then update public.workspace_work_items set client_visible=true where id=target;end if;
   if kind='cleaning' then update public.workspace_work_items set due_on=(data->>'dueOn')::date where id=target;end if;
   if kind='listing_health' and ((data->>'suspended')::boolean or not (data->>'listingVisible')::boolean or coalesce((data->>'relist')::boolean,false)) then
    perform private.workspace_handover(prop,'listing-health','Re-list the property','relisting',jsonb_build_object('sourceWorkId',target,'phase','to_relist','reason',case when (data->>'suspended')::boolean then 'suspended' when not (data->>'listingVisible')::boolean then 'hidden' else 'review' end,'platform',data->>'platform'));
   end if;
   if kind='guest_review' and (data->>'relist')::boolean then
    perform private.workspace_handover(prop,'listing-health','Re-list the property','relisting',jsonb_build_object('sourceWorkId',target,'phase','to_relist','reason','review','platform',data->>'platform'));
   end if;
  elsif a='updateOperation' then
   perform private.workspace_json_keys(input,array['action','requestId','workId','version','step','data']);target:=(input->>'workId')::uuid;step:=input->>'step';
   if not private.workspace_operation_access(target) then raise exception 'Work access denied' using errcode='42501';end if;
   select * into w from public.workspace_work_items where id=target for update;prop:=w.property_id;
   select * into d from private.workspace_domain_details where work_id=target for update;kind:=d.kind;data:=input->'data';
   if w.version is distinct from (input->>'version')::int then raise exception 'Record changed' using errcode='40001';end if;
   if w.status in ('completed','cancelled') then raise exception 'Work already closed' using errcode='22023';end if;
   next_status:=w.status;
   if kind='daily_pricing' and step='recordApplied' then
    perform private.workspace_json_keys(data,array['evidence']);
    if actor not in ('stays','admin','super_admin') or d.data->>'phase'<>'proposed' then raise exception 'Pricing action denied' using errcode='42501';end if;
    perform private.workspace_required_text(data,'evidence',5,2000);data:=data||jsonb_build_object('phase','applied','appliedAt',now());next_status:='completed';
   elsif kind='licensing' and step='recordGranted' then
    perform private.workspace_json_keys(data,array['reference','grantedOn','checklist','evidence']);
    if actor not in ('stays','admin','super_admin') or (data->>'grantedOn')::date is null or (data->>'grantedOn')::date>current_date or data->'checklist' is distinct from '{"application":true,"safetyChecks":true,"authorityGrant":true}'::jsonb then raise exception 'Authority grant and completed checklist required' using errcode='42501';end if;
    perform private.workspace_required_text(data,'reference',2,120);perform private.workspace_required_text(data,'evidence',10,3000);data:=data||jsonb_build_object('phase','granted','verifiedBy',auth.uid());next_status:='completed';
   elsif kind='licensing' and step='submitApplication' then
    perform private.workspace_json_keys(data,array['authority','applicationReference','submittedOn']);
    if actor not in ('stays','admin','super_admin') or coalesce(d.data->>'phase','') not in ('','to_apply') or (data->>'submittedOn')::date is null or (data->>'submittedOn')::date>current_date then raise exception 'Record the submitted licence application' using errcode='22023';end if;
    perform private.workspace_required_text(data,'authority',2,200);perform private.workspace_required_text(data,'applicationReference',2,120);
    data:=data||jsonb_build_object('phase','applied');next_status:='in_progress';
   elsif kind='licensing' and step='recordSafetyChecks' then
    perform private.workspace_json_keys(data,array['checks','evidence']);
    if actor not in ('stays','admin','super_admin') or d.data->>'phase' is distinct from 'applied' or data->'checks' is distinct from '{"gasSafety":true,"electrical":true,"alarms":true,"legionella":true,"epc":true,"insurance":true}'::jsonb then raise exception 'Every licensing safety check must be complete' using errcode='22023';end if;
    perform private.workspace_required_text(data,'evidence',10,3000);data:=data||jsonb_build_object('phase','checks_done');
   elsif kind='relisting' and step='startRelisting' then
    perform private.workspace_json_keys(data,array['note']);
    if actor not in ('stays','admin','super_admin') or coalesce(d.data->>'phase','to_relist')<>'to_relist' then raise exception 'Re-listing already started' using errcode='22023';end if;
    perform private.workspace_required_text(data,'note',5,2000);data:=data||jsonb_build_object('phase','relisting','startedBy',auth.uid());next_status:='in_progress';
   elsif kind='direct_booking' and step='recordGuestDecline' then
    perform private.workspace_json_keys(data,array['reason']);
    if actor not in ('stays','admin','super_admin') or d.data->>'phase' not in ('follow_up','quoted') then raise exception 'Only an open offer can be declined' using errcode='42501';end if;
    perform private.workspace_required_text(data,'reason',5,2000);data:=data||jsonb_build_object('phase','declined');next_status:='cancelled';
   elsif kind in ('cleaning_setup','garden_setup','furnishing_quote','relisting','onboarding_invoice','direct_booking_invoice','maintenance_invoice','cleaning_invoice') and step='completeHandover' then
    perform private.workspace_json_keys(data,array['evidence']);
    if actor in ('client','cleans') then raise exception 'Team review required' using errcode='42501';end if;
    perform private.workspace_required_text(data,'evidence',10,3000);next_status:='completed';data:=data||jsonb_build_object('phase','completed');
   elsif kind='direct_booking' and step='prepareQuote' then
    perform private.workspace_json_keys(data,array['checkIn','checkOut','baseAmountMinor']);
    if actor not in ('stays','admin','super_admin') or d.data->>'phase'<>'follow_up' then raise exception 'Quote action denied' using errcode='42501';end if;
    select * into policy from private.workspace_booking_policy where singleton for share;
    if not policy.confirmed then raise exception 'Alex has not confirmed the discount policy' using errcode='42501';end if;
    if (data->>'checkIn')::date is null or (data->>'checkOut')::date is null or (data->>'checkOut')::date-(data->>'checkIn')::date not between policy.minimum_nights and 365 then raise exception 'Eligible stay dates required' using errcode='22023';end if;
    amount:=private.workspace_money(data,'baseAmountMinor');
    data:=data||jsonb_build_object('quoteAmountMinor',amount-least(amount*policy.discount_bps/10000,policy.discount_cap_minor),'policyVersion',policy.version,'phase','quoted');next_status:='in_progress';
   elsif kind='direct_booking' and step='recordGuestAcceptance' then
    perform private.workspace_json_keys(data,array['guestEvidence']);
    if actor not in ('stays','admin','super_admin') or d.data->>'phase'<>'quoted' then raise exception 'Quoted guest acceptance required' using errcode='42501';end if;
    perform private.workspace_required_text(data,'guestEvidence',10,2000);data:=data||jsonb_build_object('phase','accepted');next_status:='approved';
    perform private.workspace_handover(prop,'owner-statements','Issue direct booking invoice','direct_booking_invoice',jsonb_build_object('sourceWorkId',target,'quoteAmountMinor',d.data->'quoteAmountMinor'));
   elsif kind='direct_booking' and step='confirmBooking' then
    perform private.workspace_json_keys(data,array['invoiceId','reference']);
    select * into invoice from public.workspace_invoices where id=(data->>'invoiceId')::uuid;
    if actor not in ('stays','admin','super_admin') or d.data->>'phase'<>'accepted' or invoice.id is null or invoice.work_id is distinct from target or invoice.property_id<>prop or invoice.status<>'paid' or invoice.currency<>'GBP' or invoice.amount_minor is distinct from (d.data->>'quoteAmountMinor')::bigint then raise exception 'Matching paid booking invoice required' using errcode='42501';end if;
    perform pg_advisory_xact_lock(hashtextextended(prop::text,42));
    if exists(select 1 from private.workspace_reservations where property_id=prop and status='confirmed' and check_in<(d.data->>'checkOut')::date and check_out>(d.data->>'checkIn')::date) then raise exception 'Reservation overlaps occupied dates' using errcode='23505';end if;
    insert into private.workspace_reservations(property_id,reference,check_in,check_out,status,source,created_by) values(prop,private.workspace_required_text(data,'reference',1,120),(d.data->>'checkIn')::date,(d.data->>'checkOut')::date,'confirmed','direct',auth.uid());
    data:=data||jsonb_build_object('phase','confirmed');next_status:='completed';
   elsif kind='maintenance' and step in ('declineBudget','approveManagement','declineManagement','closeRepair') then
    entry:=private.workspace_repair_decision(step,prop,d.data,data);
    data:=entry->'data';next_status:=coalesce(entry->>'status',next_status);notify_users:=array(select value::uuid from jsonb_array_elements_text(entry->'notify'));
   elsif kind='maintenance' and step='approveBudget' then
    perform private.workspace_json_keys(data,array['consent','ownerAgreement']);
    if d.data->>'phase'<>'owner_approval' or data->'consent' is distinct from 'true'::jsonb
     or not ((actor='client' and private.workspace_can_property(prop,'client-property-maintenance') and not data ? 'ownerAgreement') or (actor<>'client' and private.workspace_team_records_owner(prop)))
     then raise exception 'Property owner spending consent required' using errcode='42501';end if;
    if actor<>'client' then data:=data||jsonb_build_object('ownerAgreement',private.workspace_required_text(data,'ownerAgreement',5,500),'ownerApprovalRecordedBy',auth.uid());end if;
    data:=data||jsonb_build_object('phase',coalesce(d.data->>'resumePhase','triage'),'resumePhase',null,'ownerApprovedBy',auth.uid(),'ownerApprovedAt',now());
    data:=data||jsonb_build_object('ownerApprovedMinor',(d.data->>'estimatedCostMinor')::bigint);
    if private.workspace_repair_needs_management((d.data->>'estimatedCostMinor')::bigint,d.data) then data:=data||jsonb_build_object('phase','management_approval','resumePhase',coalesce(d.data->>'resumePhase','triage'));notify_users:=private.workspace_repair_managers();end if;
   elsif kind='maintenance' and step='referReady' then
    perform private.workspace_json_keys(data,array['troubleshooting','warrantyContactEvidence','guestUpdate','urgent']);
    if data ? 'urgent' and jsonb_typeof(data->'urgent') is distinct from 'boolean' then raise exception 'Choose whether it is urgent' using errcode='22023';end if;
    if actor not in ('stays','admin','super_admin') or d.data->>'phase'<>'triage' then raise exception 'Owner budget consent before referral required' using errcode='42501';end if;
    perform private.workspace_required_text(data,'troubleshooting',5,2000);perform private.workspace_required_text(data,'guestUpdate',5,2000);
    if (d.data->>'warrantyRequired')::boolean then perform private.workspace_required_text(data,'warrantyContactEvidence',10,2000);end if;
    data:=data||jsonb_build_object('phase','referred','referredAt',now(),'referredBy',auth.uid(),'urgent',coalesce((data->>'urgent')::boolean,(d.data->>'urgent')::boolean,false));next_status:='in_progress';
    notify_users:=array(select a.user_id from public.workspace_property_assignments a join public.workspace_profiles p on p.user_id=a.user_id join public.workspace_module_grants g on g.user_id=a.user_id and g.module_id='maintenance-reporting'
     where a.property_id=prop and p.role='ready' and p.status='active');
    if cardinality(notify_users)=0 then notify_users:=array(select user_id from public.workspace_profiles where role in ('admin','super_admin') and status='active');end if;
   elsif kind='maintenance' and step='reviseQuote' then
    perform private.workspace_json_keys(data,array['quoteMinor','reason']);
    if actor not in ('ready','stays','admin','super_admin') or coalesce(d.data->>'phase','') not in ('triage','referred','booked','owner_declined','management_declined') or (actor='ready' and d.data->>'phase' in ('owner_declined','management_declined')) then raise exception 'Only an open repair can be re-quoted' using errcode='42501';end if;
    perform private.workspace_required_text(data,'reason',5,2000);amount:=private.workspace_money(data,'quoteMinor');
    select * into j from private.workspace_journeys where property_id=prop;
    data:=jsonb_build_object('estimatedCostMinor',amount,'previousEstimateMinor',(d.data->>'estimatedCostMinor')::bigint,'quoteReason',data->>'reason','quoteRevisedAt',now(),'quoteRevisedBy',auth.uid())
     ||case when amount>coalesce((d.data->>'estimatedCostMinor')::bigint,0) and not (coalesce((j.form->>'fullRepairPermission')::boolean,false) or amount<=coalesce((j.form->>'repairLimitMinor')::bigint,0))
       then jsonb_build_object('phase','owner_approval','resumePhase',d.data->>'phase') else '{}'::jsonb end;
    data:=data||private.workspace_repair_requote(prop,amount,d.data,data);
    if data->>'phase'='management_approval' then notify_users:=private.workspace_repair_managers();end if;
   elsif kind='maintenance' and step='bookRepair' then
    perform private.workspace_json_keys(data,array['repairOn','contractor','guestUpdate']);
    if actor not in ('ready','stays','admin','super_admin') or d.data->>'phase'<>'referred' or (data->>'repairOn')::date is null then raise exception 'Ready referral required' using errcode='42501';end if;
    perform private.workspace_required_text(data,'contractor',2,200);perform private.workspace_required_text(data,'guestUpdate',5,2000);data:=data||jsonb_build_object('phase','booked');
    update public.workspace_work_items set due_on=(data->>'repairOn')::date where id=target;
    notify_users:=array(select (d.data->>'referredBy')::uuid where d.data->>'referredBy' is not null union select a.user_id from public.workspace_property_assignments a join public.workspace_profiles p on p.user_id=a.user_id join public.workspace_module_grants g on g.user_id=a.user_id and g.module_id='stays-maintenance-reporting' where a.property_id=prop and p.role='stays' and p.status='active');
   elsif kind='maintenance' and step='completeRepair' then
    perform private.workspace_json_keys(data,array['report','actualCostMinor','guestUpdate','photoIds']);perform private.workspace_check_repair_photos(target,data->'photoIds');
    if actor not in ('ready','stays','admin','super_admin') or d.data->>'phase'<>'booked' then raise exception 'Booked repair required' using errcode='42501';end if;
    perform private.workspace_required_text(data,'report',10,3000);perform private.workspace_required_text(data,'guestUpdate',5,2000);amount:=private.workspace_money(data,'actualCostMinor');
    if amount>(d.data->>'estimatedCostMinor')::bigint then raise exception 'Increased repair cost requires a new owner-approved request' using errcode='42501';end if;
    data:=data||jsonb_build_object('phase','completed');next_status:='completed';
    perform private.workspace_handover(prop,'maintenance-reconciliation','Reconcile completed property repair','maintenance_invoice',jsonb_build_object('sourceWorkId',target,'actualCostMinor',amount));
    perform private.workspace_repair_draft_expense(target,amount,data);
    notify_users:=array(select (d.data->>'referredBy')::uuid where d.data->>'referredBy' is not null union select a.user_id from public.workspace_property_assignments a join public.workspace_profiles p on p.user_id=a.user_id join public.workspace_module_grants g on g.user_id=a.user_id and g.module_id='stays-maintenance-reporting' where a.property_id=prop and p.role='stays' and p.status='active');
   elsif kind='cleaning' and step='submitCleaning' then
    perform private.workspace_json_keys(data,array['checks','report','photoIds','mailAction','mailNote','mailPhotoIds','condition']);
    if data ? 'condition' then data:=jsonb_set(data,'{condition}',private.workspace_clean_condition(data->'condition')); end if;
    if data ? 'mailPhotoIds' then
     if jsonb_typeof(data->'mailPhotoIds') is distinct from 'array' or jsonb_array_length(data->'mailPhotoIds')>20 or coalesce(data->>'mailAction','none') not in ('photograph','open_and_photograph')
      or (select count(distinct e.id) from private.workspace_media_evidence e where e.work_id=target and e.owner_id=auth.uid() and e.purpose='mailbox' and e.id::text in (select value#>>'{}' from jsonb_array_elements(data->'mailPhotoIds')))<>jsonb_array_length(data->'mailPhotoIds')
     then raise exception 'Post photos must be verified photos of this clean' using errcode='22023';end if;
    end if;
    if actor<>'cleans' or w.assignee_id is distinct from auth.uid() or d.data->>'phase'<>'assigned' then raise exception 'Assigned cleaner report required' using errcode='42501';end if;
    if data->'checks' is distinct from d.data->'checklist' then raise exception 'Complete every required checklist item' using errcode='22023';end if;
    perform private.clean_photo_check(target,prop,d.data->'checklist',auth.uid());
    if jsonb_typeof(data->'photoIds') is distinct from 'array' or jsonb_array_length(data->'photoIds') not between 1 and 30 then raise exception 'Verified cleaning photos required' using errcode='22023';end if;
    select count(distinct e.id) into evidence_count from private.workspace_media_evidence e where e.work_id=target and e.property_id=prop and e.owner_id=auth.uid() and e.purpose='cleaning' and e.id::text in(select value#>>'{}' from jsonb_array_elements(data->'photoIds'));
    if evidence_count<>jsonb_array_length(data->'photoIds') then raise exception 'Verified cleaning photos required' using errcode='42501';end if;
    if coalesce(data->>'mailAction','none')<>'none' and data->>'mailAction' is distinct from d.data->>'mailPreference' then raise exception 'Follow property owner mailbox consent' using errcode='42501';end if;
    perform private.workspace_required_text(data,'report',5,3000);data:=data||jsonb_build_object('phase','review','submittedBy',auth.uid());next_status:='in_review';
   elsif kind='cleaning' and step='reportCleanProblem' then
    perform private.workspace_json_keys(data,array['issue','urgent','repairType','photoIds']);
    if actor<>'cleans' or w.assignee_id is distinct from auth.uid() then raise exception 'Only the cleaner on this clean can report a problem from it' using errcode='42501';end if;
    if jsonb_typeof(data->'urgent') is distinct from 'boolean' or coalesce(data->>'repairType','other') not in ('heating','hot_water','leak','toilet_drain','electrics','appliance','wifi','locks_access','pests','damage','other') then raise exception 'Say what kind of problem it is and whether it is urgent' using errcode='22023';end if;
    if jsonb_array_length(coalesce(d.data->'problems','[]'::jsonb))>=10 then raise exception 'Ten problems are already reported on this clean. Ask the Stays team' using errcode='22023';end if;
    if data ? 'photoIds' and (jsonb_typeof(data->'photoIds') is distinct from 'array' or jsonb_array_length(data->'photoIds') not between 1 and 10
     or (select count(distinct e.id) from private.workspace_media_evidence e where e.work_id=target and e.owner_id=auth.uid() and e.purpose='maintenance' and e.id::text in (select value#>>'{}' from jsonb_array_elements(data->'photoIds')))<>jsonb_array_length(data->'photoIds'))
     then raise exception 'Photos must be saved photos of this problem' using errcode='22023';end if;
    j:=(select x from private.workspace_journeys x where x.property_id=prop);
    entry:=jsonb_build_object('issue',private.workspace_required_text(data,'issue',5,3000),'estimatedCostMinor',0,'hazard',false,'phase','triage','warrantyRequired',coalesce(j.form->>'warrantyDetails','')<>'','workStatus','waiting',
     'repairType',coalesce(data->>'repairType','other'),'urgent',(data->>'urgent')::boolean,'contactFirst',nullif(j.form->>'preferredRepairContact',''),'warrantyDetails',nullif(j.form->>'warrantyDetails',''),
     'reportedBy',auth.uid(),'reportedFromClean',target);
    declare repair uuid; begin
     repair:=private.workspace_handover(prop,'stays-maintenance-reporting','Property repair request','maintenance',entry);
     update public.workspace_work_items set client_visible=true where id=repair;
     -- The photos move to the repair, where Stays and Ready see them.
     update private.workspace_media_evidence set work_id=repair where work_id=target and owner_id=auth.uid() and purpose='maintenance' and id::text in (select value#>>'{}' from jsonb_array_elements(coalesce(data->'photoIds','[]'::jsonb)));
     data:=jsonb_build_object('problems',coalesce(d.data->'problems','[]'::jsonb)||jsonb_build_array(jsonb_build_object('repairWorkId',repair,'issue',entry->>'issue','repairType',entry->>'repairType','urgent',entry->'urgent','photos',coalesce(jsonb_array_length(data->'photoIds'),0),'reportedAt',now())));
    end;
   elsif kind='cleaning' and step='reviewCleaning' then
    perform private.workspace_json_keys(data,array['accepted','guestFeedback','reviewNote']);
    if actor not in ('cleaning_manager','stays','admin','super_admin') or w.assignee_id=auth.uid() or d.data->>'phase'<>'review' or jsonb_typeof(data->'accepted') is distinct from 'boolean' then raise exception 'Independent cleaning manager review required' using errcode='42501';end if;
    perform private.workspace_required_text(data,'reviewNote',5,2000);
    perform private.workspace_required_text(data,'guestFeedback',5,2000);
    insert into private.workspace_cleaning_reviews(work_id,cleaner_id,reviewer_id,accepted,guest_feedback,review_note) values(target,w.assignee_id,auth.uid(),(data->>'accepted')::boolean,data->>'guestFeedback',data->>'reviewNote');
    insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(auth.uid(),prop,target,case when (data->>'accepted')::boolean then 'cleaning.accepted' else 'cleaning.rejected' end) returning id into event_id;
    insert into private.workspace_notification_outbox(user_id,work_id,event_id) select w.assignee_id,target,event_id where w.assignee_id is not null and w.assignee_id is distinct from auth.uid() on conflict do nothing;
    data:=data||jsonb_build_object('phase',case when (data->>'accepted')::boolean then 'accepted' else 'assigned' end,'reviewedBy',auth.uid());
    next_status:=case when (data->>'accepted')::boolean then 'completed' else 'waiting' end;
    if next_status='completed' then perform private.workspace_handover(prop,'cleans-invoices','Invoice accepted property clean','cleaning_invoice',jsonb_build_object('sourceWorkId',target,'cleanerId',w.assignee_id,'cleanerName',(select p.full_name from public.workspace_profiles p where p.user_id=w.assignee_id),'cleanedOn',w.due_on));end if;
    if next_status='waiting' then
     data:=data||jsonb_build_object('complaintWorkId',private.workspace_handover(prop,'cleaner-performance','Review guest complaint with cleaner','cleaning_complaint',jsonb_build_object('sourceWorkId',target,'cleanerId',w.assignee_id,'requiresManagementDecision',true,
      'report',d.data->'report','checklist',d.data->'checklist','photoIds',d.data->'photoIds','reviewNote',data->>'reviewNote','guestFeedback',data->>'guestFeedback','reviewedBy',auth.uid(),'cleanedOn',w.due_on)),
      'disputeDecision',null,'disputeNote',null,'disputeDecidedAt',null);
     if (select count(*) from private.workspace_cleaning_reviews r where r.cleaner_id=w.assignee_id and not r.accepted and r.overturned_at is null and r.created_at>=date_trunc('month',current_date)::date)>=2 then
      if not exists(select 1 from private.workspace_domain_details dd join public.workspace_work_items ww on ww.id=dd.work_id where dd.kind='cleaner_management_review' and dd.data->>'cleanerId'=w.assignee_id::text and ww.status<>'completed') then
       perform private.workspace_handover(prop,'cleaner-performance','Management review after repeated complaints','cleaner_management_review',jsonb_build_object('cleanerId',w.assignee_id,'requiresManagementDecision',true));
      end if;
     end if;
    end if;
   elsif kind='purchase' and step='approvePurchase' then
    perform private.workspace_json_keys(data,array['approvedAmountMinor','approvalNote','budgetItemId','quantity']);
    if data ? 'budgetItemId' and (coalesce(data->>'quantity','')!~'^\d+$' or (data->>'quantity')::int not between 1 and 100 or not exists(select 1 from private.workspace_purchase_budget b where b.id=(data->>'budgetItemId')::uuid and b.active)) then raise exception 'Choose a budget chart item and how many' using errcode='22023';end if;
    if data ? 'budgetItemId' then
     if private.workspace_money(data,'approvedAmountMinor')>(select b.max_unit_minor*(data->>'quantity')::int from private.workspace_purchase_budget b where b.id=(data->>'budgetItemId')::uuid) then raise exception 'Over the budget chart for this item' using errcode='22023';end if;
     data:=data||(select jsonb_build_object('budgetItem',b.item,'budgetMaxMinor',b.max_unit_minor*(data->>'quantity')::int) from private.workspace_purchase_budget b where b.id=(data->>'budgetItemId')::uuid);
    end if;
    if not (actor in ('admin','super_admin') or (actor='accounts' and private.has_workspace_module('purchase-order-accounts'))) or d.data->>'phase'<>'requested' then raise exception 'Accounts approval required' using errcode='42501';end if;
    amount:=private.workspace_money(data,'approvedAmountMinor');if amount>(d.data->>'budgetMinor')::bigint then raise exception 'Purchase exceeds requested budget' using errcode='22023';end if;
    perform private.workspace_required_text(data,'approvalNote',5,2000);data:=data||jsonb_build_object('phase','approved');next_status:='approved';
   elsif kind='purchase' and step='recordOrder' then
    perform private.workspace_json_keys(data,array['orderReference','supplier']);
    if not (actor in ('admin','super_admin') or (actor='accounts' and private.has_workspace_module('purchase-order-accounts'))) or d.data->>'phase'<>'approved' then raise exception 'Approved Accounts order required' using errcode='42501';end if;
    perform private.workspace_required_text(data,'orderReference',2,200);perform private.workspace_required_text(data,'supplier',2,200);data:=data||jsonb_build_object('phase','ordered');
    perform private.workspace_handover(prop,'purchase-order','Evidence ordered purchase delivery','purchase_delivery',jsonb_build_object('sourceWorkId',target));
   elsif kind='purchase' and step='recordDelivery' then
    perform private.workspace_json_keys(data,array['receivedOn','evidence','photoIds']);
    if actor not in ('ready','admin','super_admin') or d.data->>'phase'<>'ordered' or (data->>'receivedOn')::date is null or (data->>'receivedOn')::date>current_date then raise exception 'Ordered purchase and Ready delivery evidence required' using errcode='42501';end if;
    perform private.workspace_required_text(data,'evidence',10,3000);
    if jsonb_typeof(data->'photoIds') is distinct from 'array' or jsonb_array_length(data->'photoIds') not between 1 and 30 then raise exception 'Verified delivery photos required' using errcode='42501';end if;
    select count(distinct e.id) into evidence_count from private.workspace_media_evidence e where e.property_id=prop and e.work_id=target and e.purpose='delivery' and e.id::text in(select value#>>'{}' from jsonb_array_elements(data->'photoIds'));
    if evidence_count<>jsonb_array_length(data->'photoIds') then raise exception 'Verified delivery photos required' using errcode='42501';end if;
    data:=data||jsonb_build_object('phase','delivered');
   elsif kind='purchase' and step='reconcilePurchase' then
    perform private.workspace_json_keys(data,array['invoiceId','reconciliation']);
    select * into invoice from public.workspace_invoices where id=(data->>'invoiceId')::uuid;
    if not (actor in ('admin','super_admin') or (actor='accounts' and private.has_workspace_module('purchase-order-accounts'))) or d.data->>'phase'<>'delivered' or invoice.id is null or invoice.work_id is distinct from target or invoice.property_id<>prop or invoice.status<>'paid' or invoice.currency<>'GBP' or invoice.amount_minor>(d.data->>'approvedAmountMinor')::bigint or invoice.module_id not in ('purchase-order-invoices','purchase-order-accounts') then raise exception 'Matching paid purchase invoice and delivery required' using errcode='42501';end if;
    perform private.workspace_required_text(data,'reconciliation',10,3000);data:=data||jsonb_build_object('phase','reconciled');next_status:='completed';
   else raise exception 'Step is not available in this workflow' using errcode='22023';end if;
   update private.workspace_domain_details set data=d.data||operation.data||jsonb_build_object('workStatus',next_status),updated_at=now() where work_id=target;
   update public.workspace_work_items set status=next_status,version=version+1,updated_at=now(),completed_at=case when next_status='completed' then now() else null end where id=target;
  else raise exception 'Unknown operational action' using errcode='22023';end if;
  result:=private.workspace_operation_view(target);
 end if;
 insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(auth.uid(),prop,target,'operations.'||a||coalesce('.'||step,'')) returning id into event_id;
 -- In-app notification source. External delivery remains queued until a configured provider confirms it.
 insert into private.workspace_notification_outbox(user_id,work_id,event_id) select user_id,target,event_id from public.workspace_property_assignments where property_id=prop and assignment='client' on conflict do nothing;
 insert into private.workspace_notification_outbox(user_id,work_id,event_id) select distinct u,target,event_id from unnest(notify_users) u where u is not null and u is distinct from auth.uid() on conflict do nothing;
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);return result;
end $function$;

CREATE OR REPLACE FUNCTION private.workspace_repair_decision(step text, prop uuid, repair jsonb, input jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare actor text:=private.workspace_actor_role();phase text:=repair->>'phase';begin
 if step='declineBudget' then
  perform private.workspace_json_keys(input,array['reason']);
  if not ((actor='client' and private.workspace_can_property(prop,'client-property-maintenance')) or (actor is distinct from 'client' and private.workspace_team_records_owner(prop))) or phase is distinct from 'owner_approval' then raise exception 'Only the owner can decline a repair waiting for their approval' using errcode='42501';end if;
  return jsonb_build_object('data',jsonb_build_object('phase','owner_declined','ownerDeclinedReason',private.workspace_required_text(input,'reason',5,2000),'ownerDeclinedBy',auth.uid(),'ownerDeclinedAt',now()),
   'notify',to_jsonb(private.workspace_repair_team(prop,repair,true)));
 elsif step='approveManagement' then
  perform private.workspace_json_keys(input,array['note']);
  if actor not in ('admin','super_admin') or phase is distinct from 'management_approval' then raise exception 'Management approval required' using errcode='42501';end if;
  if input ? 'note' and (jsonb_typeof(input->'note') is distinct from 'string' or length(input->>'note')>2000) then raise exception 'The note is too long' using errcode='22023';end if;
  return jsonb_build_object('data',jsonb_build_object('phase',coalesce(repair->>'resumePhase','triage'),'resumePhase',null,'managementApprovedBy',auth.uid(),'managementApprovedAt',now(),
   'managementApprovedMinor',(repair->>'estimatedCostMinor')::bigint,'managementNote',nullif(trim(coalesce(input->>'note','')),'')),
   'notify',to_jsonb(private.workspace_repair_team(prop,repair,false)));
 elsif step='declineManagement' then
  perform private.workspace_json_keys(input,array['reason']);
  if actor not in ('admin','super_admin') or phase is distinct from 'management_approval' then raise exception 'Management approval required' using errcode='42501';end if;
  return jsonb_build_object('data',jsonb_build_object('phase','management_declined','managementDeclinedReason',private.workspace_required_text(input,'reason',5,2000),'managementDeclinedBy',auth.uid(),'managementDeclinedAt',now()),
   'notify',to_jsonb(private.workspace_repair_team(prop,repair,false)));
 elsif step='closeRepair' then
  perform private.workspace_json_keys(input,array['note']);
  if actor not in ('stays','admin','super_admin') or not private.workspace_can_property(prop,'stays-maintenance-reporting') or coalesce(phase,'') not in ('owner_declined','management_declined') then raise exception 'Only a declined repair can be closed here' using errcode='42501';end if;
  return jsonb_build_object('data',jsonb_build_object('phase','closed','closedNote',private.workspace_required_text(input,'note',5,2000),'closedBy',auth.uid(),'closedAt',now()),'status','cancelled','notify','[]'::jsonb);
 end if;
 raise exception 'Step is not available in this workflow' using errcode='22023';
end $function$;
