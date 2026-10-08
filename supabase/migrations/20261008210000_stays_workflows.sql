-- Stays and repairs, as the client described them:
-- * Guest reviews are logged one by one and acknowledged as good or bad; a bad one can be sent for
--   re-listing. A listing check only re-lists on its own when the listing is hidden or suspended
--   (or the person chooses to). Re-listing has a "started" stage before it is complete.
-- * Licensing runs application -> safety checks -> grant.
-- * A direct-booking offer can be closed when the guest says no.
-- * Repairs carry a repair type, an urgent flag and the owner's "contact first" details. Ready on
--   the property hears about a referral straight away (admins if no Ready is assigned), and Stays
--   hear when Ready books and completes the repair.
-- * Stays sign off their daily checks, and the sign-offs and reviews count in Team performance.
create or replace function private.workspace_operations_action(input jsonb)
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
   elsif kind='maintenance' and step='approveBudget' then
    perform private.workspace_json_keys(data,array['consent']);
    if actor<>'client' or not private.workspace_can_property(prop,'client-property-maintenance') or d.data->>'phase'<>'owner_approval' or data->'consent' is distinct from 'true'::jsonb then raise exception 'Property owner spending consent required' using errcode='42501';end if;
    data:=data||jsonb_build_object('phase','triage','ownerApprovedBy',auth.uid(),'ownerApprovedAt',now());
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
   elsif kind='maintenance' and step='bookRepair' then
    perform private.workspace_json_keys(data,array['repairOn','contractor','guestUpdate']);
    if actor not in ('ready','stays','admin','super_admin') or d.data->>'phase'<>'referred' or (data->>'repairOn')::date is null then raise exception 'Ready referral required' using errcode='42501';end if;
    perform private.workspace_required_text(data,'contractor',2,200);perform private.workspace_required_text(data,'guestUpdate',5,2000);data:=data||jsonb_build_object('phase','booked');
    update public.workspace_work_items set due_on=(data->>'repairOn')::date where id=target;
    notify_users:=array(select (d.data->>'referredBy')::uuid where d.data->>'referredBy' is not null union select a.user_id from public.workspace_property_assignments a join public.workspace_profiles p on p.user_id=a.user_id join public.workspace_module_grants g on g.user_id=a.user_id and g.module_id='stays-maintenance-reporting' where a.property_id=prop and p.role='stays' and p.status='active');
   elsif kind='maintenance' and step='completeRepair' then
    perform private.workspace_json_keys(data,array['report','actualCostMinor','guestUpdate']);
    if actor not in ('ready','stays','admin','super_admin') or d.data->>'phase'<>'booked' then raise exception 'Booked repair required' using errcode='42501';end if;
    perform private.workspace_required_text(data,'report',10,3000);perform private.workspace_required_text(data,'guestUpdate',5,2000);amount:=private.workspace_money(data,'actualCostMinor');
    if amount>(d.data->>'estimatedCostMinor')::bigint then raise exception 'Increased repair cost requires a new owner-approved request' using errcode='42501';end if;
    data:=data||jsonb_build_object('phase','completed');next_status:='completed';
    perform private.workspace_handover(prop,'maintenance-reconciliation','Reconcile completed property repair','maintenance_invoice',jsonb_build_object('sourceWorkId',target,'actualCostMinor',amount));
    notify_users:=array(select (d.data->>'referredBy')::uuid where d.data->>'referredBy' is not null union select a.user_id from public.workspace_property_assignments a join public.workspace_profiles p on p.user_id=a.user_id join public.workspace_module_grants g on g.user_id=a.user_id and g.module_id='stays-maintenance-reporting' where a.property_id=prop and p.role='stays' and p.status='active');
   elsif kind='cleaning' and step='submitCleaning' then
    perform private.workspace_json_keys(data,array['checks','report','photoIds','mailAction','mailNote']);
    if actor<>'cleans' or w.assignee_id is distinct from auth.uid() or d.data->>'phase'<>'assigned' then raise exception 'Assigned cleaner report required' using errcode='42501';end if;
    if data->'checks' is distinct from d.data->'checklist' then raise exception 'Complete every required checklist item' using errcode='22023';end if;
    if jsonb_typeof(data->'photoIds') is distinct from 'array' or jsonb_array_length(data->'photoIds') not between 1 and 30 then raise exception 'Verified cleaning photos required' using errcode='22023';end if;
    select count(distinct e.id) into evidence_count from private.workspace_media_evidence e where e.work_id=target and e.property_id=prop and e.owner_id=auth.uid() and e.purpose='cleaning' and e.id::text in(select value#>>'{}' from jsonb_array_elements(data->'photoIds'));
    if evidence_count<>jsonb_array_length(data->'photoIds') then raise exception 'Verified cleaning photos required' using errcode='42501';end if;
    if coalesce(data->>'mailAction','none')<>'none' and data->>'mailAction' is distinct from d.data->>'mailPreference' then raise exception 'Follow property owner mailbox consent' using errcode='42501';end if;
    perform private.workspace_required_text(data,'report',5,3000);data:=data||jsonb_build_object('phase','review','submittedBy',auth.uid());next_status:='in_review';
   elsif kind='cleaning' and step='reviewCleaning' then
    perform private.workspace_json_keys(data,array['accepted','guestFeedback','reviewNote']);
    if actor not in ('cleaning_manager','stays','admin','super_admin') or w.assignee_id=auth.uid() or d.data->>'phase'<>'review' or jsonb_typeof(data->'accepted') is distinct from 'boolean' then raise exception 'Independent cleaning manager review required' using errcode='42501';end if;
    perform private.workspace_required_text(data,'reviewNote',5,2000);
    perform private.workspace_required_text(data,'guestFeedback',5,2000);
    insert into private.workspace_cleaning_reviews(work_id,cleaner_id,reviewer_id,accepted,guest_feedback,review_note) values(target,w.assignee_id,auth.uid(),(data->>'accepted')::boolean,data->>'guestFeedback',data->>'reviewNote');
    data:=data||jsonb_build_object('phase',case when (data->>'accepted')::boolean then 'accepted' else 'assigned' end,'reviewedBy',auth.uid());
    next_status:=case when (data->>'accepted')::boolean then 'completed' else 'waiting' end;
    if next_status='completed' then perform private.workspace_handover(prop,'cleans-invoices','Invoice accepted property clean','cleaning_invoice',jsonb_build_object('sourceWorkId',target,'cleanerId',w.assignee_id));end if;
    if next_status='waiting' then
     perform private.workspace_handover(prop,'cleaner-performance','Review guest complaint with cleaner','cleaning_complaint',jsonb_build_object('sourceWorkId',target,'cleanerId',w.assignee_id,'requiresManagementDecision',true));
     if (select count(distinct work_id) from private.workspace_cleaning_reviews where cleaner_id=w.assignee_id and not accepted)>=2 then
      if not exists(select 1 from private.workspace_domain_details dd join public.workspace_work_items ww on ww.id=dd.work_id where dd.kind='cleaner_management_review' and dd.data->>'cleanerId'=w.assignee_id::text and ww.status<>'completed') then
       perform private.workspace_handover(prop,'cleaner-performance','Management review after repeated complaints','cleaner_management_review',jsonb_build_object('cleanerId',w.assignee_id,'requiresManagementDecision',true));
      end if;
     end if;
    end if;
   elsif kind='purchase' and step='approvePurchase' then
    perform private.workspace_json_keys(data,array['approvedAmountMinor','approvalNote']);
    if actor not in ('admin','super_admin') or d.data->>'phase'<>'requested' then raise exception 'Accounts approval required' using errcode='42501';end if;
    amount:=private.workspace_money(data,'approvedAmountMinor');if amount>(d.data->>'budgetMinor')::bigint then raise exception 'Purchase exceeds requested budget' using errcode='22023';end if;
    perform private.workspace_required_text(data,'approvalNote',5,2000);data:=data||jsonb_build_object('phase','approved');next_status:='approved';
   elsif kind='purchase' and step='recordOrder' then
    perform private.workspace_json_keys(data,array['orderReference','supplier']);
    if actor not in ('admin','super_admin') or d.data->>'phase'<>'approved' then raise exception 'Approved Accounts order required' using errcode='42501';end if;
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
    if actor not in ('admin','super_admin') or d.data->>'phase'<>'delivered' or invoice.id is null or invoice.work_id is distinct from target or invoice.property_id<>prop or invoice.status<>'paid' or invoice.currency<>'GBP' or invoice.amount_minor>(d.data->>'approvedAmountMinor')::bigint or invoice.module_id not in ('purchase-order-invoices','purchase-order-accounts') then raise exception 'Matching paid purchase invoice and delivery required' using errcode='42501';end if;
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
end $function$
;

create table private.workspace_daily_signoffs (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.workspace_profiles(user_id),
 day date not null,
 confirmations jsonb not null,
 snapshot jsonb not null,
 note text not null default '' check(length(note)<=2000),
 created_at timestamptz not null default now(),
 unique(user_id,day)
);
alter table private.workspace_daily_signoffs enable row level security;
revoke all on private.workspace_daily_signoffs from public,anon,authenticated;
create index workspace_daily_signoffs_day_idx on private.workspace_daily_signoffs(day desc);

-- What is still open for the person today, from the work they can see.
create function private.workspace_signoff_snapshot() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object(
  'openRelistings',(select count(*) from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
    where d.kind='relisting' and w.status not in ('completed','cancelled') and private.workspace_operation_access(w.id)),
  'listingChecksToday',(select count(*) from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
    where d.kind='listing_health' and w.created_by=auth.uid() and (w.created_at at time zone 'Europe/London')::date=(now() at time zone 'Europe/London')::date),
  'reviewsToday',(select count(*) from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
    where d.kind='guest_review' and w.created_by=auth.uid() and (w.created_at at time zone 'Europe/London')::date=(now() at time zone 'Europe/London')::date),
  'flaggedToday',(select count(*) from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
    where d.kind='listing_health' and ((d.data->>'suspended')::boolean or not (d.data->>'listingVisible')::boolean) and private.workspace_operation_access(w.id)
    and (w.created_at at time zone 'Europe/London')::date=(now() at time zone 'Europe/London')::date));
$$;

create function private.workspace_signoff_read() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();today date:=(now() at time zone 'Europe/London')::date;begin
 if actor not in ('stays','admin','super_admin') then raise exception 'Stays access required' using errcode='42501';end if;
 return jsonb_build_object('today',today,'snapshot',private.workspace_signoff_snapshot(),
  'mine',(select jsonb_build_object('createdAt',o.created_at,'note',o.note) from private.workspace_daily_signoffs o where o.user_id=auth.uid() and o.day=today),
  'recent',case when actor in ('admin','super_admin') then coalesce((select jsonb_agg(jsonb_build_object('day',o.day,'fullName',p.full_name,'createdAt',o.created_at,'note',o.note,'snapshot',o.snapshot) order by o.created_at desc)
    from private.workspace_daily_signoffs o join public.workspace_profiles p on p.user_id=o.user_id where o.day>today-14),'[]') else '[]' end);
end $$;

create function private.workspace_signoff_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();req uuid;prior private.workspace_action_receipts;snap jsonb;result jsonb;today date:=(now() at time zone 'Europe/London')::date;begin
 if actor not in ('stays','admin','super_admin') then raise exception 'Stays access required' using errcode='42501';end if;
 perform private.workspace_json_keys(input,array['action','requestId','allVisible','reviewsHandled','suspensionsHandled','relistingsDone','note']);
 req:=(input->>'requestId')::uuid;if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 select * into prior from private.workspace_action_receipts where actor_id=auth.uid() and request_id=req;
 if found then
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;
 if exists(select 1 from unnest(array['allVisible','reviewsHandled','suspensionsHandled','relistingsDone']) k where input->k is distinct from 'true'::jsonb) then raise exception 'Confirm every daily check before signing off' using errcode='22023';end if;
 if length(coalesce(input->>'note',''))>2000 then raise exception 'Note is too long' using errcode='22023';end if;
 snap:=private.workspace_signoff_snapshot();
 if (snap->>'openRelistings')::int>0 and length(trim(coalesce(input->>'note','')))<5 then raise exception 'Say where the open re-listings are up to' using errcode='22023';end if;
 if exists(select 1 from private.workspace_daily_signoffs where user_id=auth.uid() and day=today) then raise exception 'You have already signed off today' using errcode='23505';end if;
 insert into private.workspace_daily_signoffs(user_id,day,confirmations,snapshot,note)
  values(auth.uid(),today,jsonb_build_object('allVisible',true,'reviewsHandled',true,'suspensionsHandled',true,'relistingsDone',true),snap,trim(coalesce(input->>'note','')));
 result:=jsonb_build_object('day',today,'snapshot',snap);
 insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'stays.daily_signoff');
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $$;
revoke all on function private.workspace_signoff_snapshot(),private.workspace_signoff_read(),private.workspace_signoff_action(jsonb) from public,anon,authenticated;

-- Route through the team endpoints, and count sign-offs and reviews in Team performance.
do $$
declare
 fixes constant text[][] := array[
  ['private.workspace_teams_read(text,date,date,uuid,uuid)', $q$ elsif section in ('shift','teamPerformance') then$q$,
   $q$ elsif section='signoff' then result:=private.workspace_signoff_read();
 elsif section in ('shift','teamPerformance') then$q$, 'workspace_signoff_read'],
  ['private.workspace_teams_action(jsonb)', $q$ if input->>'action' in ('clockIn','clockOut','closeShift','saveTargets') then return private.workspace_shift_action(input);end if;$q$,
   $q$ if input->>'action' in ('clockIn','clockOut','closeShift','saveTargets') then return private.workspace_shift_action(input);end if;
 if input->>'action'='signOffDay' then return private.workspace_signoff_action(input);end if;$q$, 'workspace_signoff_action'],
  ['private.workspace_shift_read(text,date,date)', $q$'pricingDecisions',(select count(*)$q$,
   $q$'signOffs',(select count(*) from private.workspace_daily_signoffs o where o.user_id=p.user_id and o.day between start_on and end_on),
     'reviewsLogged',(select count(*) from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where d.kind='guest_review' and w.created_by=p.user_id and w.created_at>=lower_at and w.created_at<upper_at),
     'pricingDecisions',(select count(*)$q$, 'signOffs']
 ];
 definition text;
begin
 for i in 1..array_length(fixes, 1) loop
  definition := pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in definition) = 0 then
   if position(fixes[i][2] in definition) = 0 then raise exception 'Patch anchor missing in %', fixes[i][1]; end if;
   execute replace(definition, fixes[i][2], fixes[i][3]);
  end if;
 end loop;
end $$;
