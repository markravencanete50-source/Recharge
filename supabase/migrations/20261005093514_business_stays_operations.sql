-- Recorded operational evidence, not simulated Hostaway/media delivery.
create table private.workspace_reservations (
 id uuid primary key default gen_random_uuid(), property_id uuid not null references public.workspace_properties(id),
 reference text not null check(length(reference) between 1 and 120), check_in date not null, check_out date not null,
 status text not null check(status in ('enquiry','confirmed','cancelled')), source text not null check(source in ('manual','hostaway','direct')),
 created_by uuid not null references public.workspace_profiles(user_id), created_at timestamptz not null default now(),
 check(check_out>check_in and check_out-check_in<=365),unique(property_id,reference)
);
create index workspace_reservations_dates_idx on private.workspace_reservations(property_id,check_in,check_out) where status='confirmed';
create table private.workspace_media_evidence (
 id uuid primary key default gen_random_uuid(), property_id uuid not null references public.workspace_properties(id),
 work_id uuid not null references public.workspace_work_items(id), owner_id uuid not null references public.workspace_profiles(user_id),
 purpose text not null check(purpose in ('cleaning','mailbox','delivery','licence','maintenance')),
 provider_id text not null unique, verified_at timestamptz not null, created_at timestamptz not null default now()
);
create table private.workspace_cleaning_reviews (
 id uuid primary key default gen_random_uuid(),work_id uuid not null references public.workspace_work_items(id),
 cleaner_id uuid not null references public.workspace_profiles(user_id),reviewer_id uuid not null references public.workspace_profiles(user_id),
 accepted boolean not null,guest_feedback text not null,review_note text not null,created_at timestamptz not null default now()
);
create index workspace_cleaning_reviews_cleaner_idx on private.workspace_cleaning_reviews(cleaner_id,created_at);
-- Only a verified server-side upload callback may insert evidence. No browser register-URL endpoint.
do $$ declare t text; begin
 foreach t in array array['workspace_reservations','workspace_media_evidence','workspace_cleaning_reviews'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated',t);
  execute format('create trigger business_write_limit before insert or update or delete on private.%I for each row execute function private.workspace_enforce_write_limit()',t);
 end loop;
end $$;
create trigger booking_policy_write_limit before update on private.workspace_booking_policy for each row execute function private.workspace_enforce_write_limit();
update public.workspace_features set client_module='client-purchase-order-quotes' where module_id='purchase-order-requests';

create function private.workspace_money(input jsonb,k text) returns bigint language plpgsql set search_path='' as $$
declare n bigint;begin
 if jsonb_typeof(input->k) is distinct from 'number' or coalesce(input->>k,'')!~'^\d+$' then raise exception 'Integer amount required' using errcode='22023'; end if;
 n:=(input->>k)::bigint;if n>10000000 then raise exception 'Amount exceeds limit' using errcode='22023';end if;return n;
end $$;
create function private.workspace_operation_access(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.workspace_can_work(target) or exists(select 1 from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
 where w.id=target and private.workspace_actor_role()='ready' and (d.kind='maintenance' and d.data->>'referredAt' is not null and private.workspace_can_property(w.property_id,'maintenance-reporting') or d.kind='purchase' and d.data->>'phase' in ('ordered','delivered','reconciled') and private.workspace_can_property(w.property_id,'purchase-order')));
$$;
create function private.workspace_operation_view(target uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('workId',w.id,'propertyId',w.property_id,'moduleId',w.module_id,'title',w.title,'status',w.status,'version',w.version,'assigneeId',w.assignee_id,'dueOn',w.due_on,'kind',d.kind,
 'data',case when private.workspace_actor_role()='client' then d.data-'guestEvidence'-'reservationId'-'troubleshooting'-'warrantyContactEvidence' else d.data end)
 from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where w.id=target;
$$;
create function private.workspace_operations_read(target_property uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare items jsonb;begin
 if private.workspace_actor_role() is null then raise exception 'Active access required' using errcode='42501';end if;
 select coalesce(jsonb_agg(private.workspace_operation_view(w.id) order by w.updated_at desc),'[]') into items from
 (select w.* from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where (target_property is null or w.property_id=target_property) and private.workspace_operation_access(w.id) order by w.updated_at desc limit 100) w;
 return items;
end $$;

-- Guard generic work/invoice RPCs too: domain gates cannot be skipped using another endpoint.
create function private.workspace_operation_status_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare d private.workspace_domain_details;begin
 select * into d from private.workspace_domain_details where work_id=new.id;
 if found and new.status is distinct from old.status and d.kind in ('licensing','direct_booking','maintenance','cleaning','purchase') then
  if new.status is distinct from coalesce(d.data->>'workStatus','waiting') then raise exception 'Use the evidence-based workflow action' using errcode='42501';end if;
 end if;return new;
end $$;
create trigger operation_status_guard before update of status on public.workspace_work_items for each row execute function private.workspace_operation_status_guard();
create function private.workspace_operation_invoice_guard() returns trigger language plpgsql security definer set search_path='' as $$
declare d private.workspace_domain_details;begin
 if new.module_id='cleans-invoices' then
  select * into d from private.workspace_domain_details where work_id=new.work_id;
  if not found or d.kind<>'cleaning' or d.data->>'phase'<>'accepted' then raise exception 'Accepted cleaning report required before invoicing' using errcode='42501';end if;
 end if;return new;
end $$;
create trigger operation_invoice_guard before insert on public.workspace_invoices for each row execute function private.workspace_operation_invoice_guard();

create function private.workspace_operations_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
<<operation>>
declare actor text:=private.workspace_actor_role(); a text; req uuid; prop uuid; target uuid; prior private.workspace_action_receipts;
 w public.workspace_work_items; d private.workspace_domain_details; policy private.workspace_booking_policy; reservation private.workspace_reservations;
 invoice public.workspace_invoices; j private.workspace_journeys; data jsonb; result jsonb; feature text; kind text; title text;
 next_status text; step text; amount bigint; evidence_count integer; event_id bigint; entry jsonb;
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
    perform private.workspace_json_keys(data,array['checkedOn','platform','listingVisible','reviewSentiment','reviewAcknowledged','suspended','evidence']);
    if actor not in ('stays','admin','super_admin') or coalesce(data->>'platform','') not in ('Airbnb','Booking.com','Direct','Comfy Workers') or (data->>'checkedOn')::date is null or coalesce(data->>'reviewSentiment','') not in ('none','positive','negative') or exists(select 1 from unnest(array['listingVisible','reviewAcknowledged','suspended']) k where jsonb_typeof(data->k) is distinct from 'boolean') or (data->>'reviewSentiment'<>'none' and not (data->>'reviewAcknowledged')::boolean) then raise exception 'Acknowledge reviews and record listing evidence' using errcode='22023';end if;
    perform private.workspace_required_text(data,'evidence',5,2000);
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
    perform private.workspace_json_keys(data,array['issue','reservationId','estimatedCostMinor','hazard']);
    if actor not in ('client','stays','admin','super_admin') or jsonb_typeof(data->'hazard') is distinct from 'boolean' then raise exception 'Repair request denied' using errcode='42501';end if;
    perform private.workspace_required_text(data,'issue',5,3000);amount:=private.workspace_money(data,'estimatedCostMinor');
    if data->>'reservationId' is not null and not exists(select 1 from private.workspace_reservations where id=(data->>'reservationId')::uuid and property_id=prop) then raise exception 'Reservation belongs to another property' using errcode='42501';end if;
    data:=data||jsonb_build_object('phase',case when coalesce((j.form->>'fullRepairPermission')::boolean,false) or amount<=coalesce((j.form->>'repairLimitMinor')::bigint,0) then 'triage' else 'owner_approval' end,'warrantyRequired',coalesce(j.form->>'warrantyDetails','')<>'','workStatus','waiting');
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
   if kind='listing_health' then update public.workspace_work_items set status='completed',completed_at=now() where id=target;end if;
   if kind in ('maintenance','purchase') then update public.workspace_work_items set client_visible=true where id=target;end if;
   if kind='cleaning' then update public.workspace_work_items set due_on=(data->>'dueOn')::date where id=target;end if;
   if kind='listing_health' and (data->>'reviewSentiment'='negative' or (data->>'suspended')::boolean or not (data->>'listingVisible')::boolean) then
    perform private.workspace_handover(prop,'listing-health','Review listing and prepare relisting','relisting',jsonb_build_object('sourceWorkId',target));
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
   elsif kind in ('cleaning_setup','garden_setup','furnishing_quote','relisting') and step='completeHandover' then
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
    perform private.workspace_json_keys(data,array['troubleshooting','warrantyContactEvidence','guestUpdate']);
    if actor not in ('stays','admin','super_admin') or d.data->>'phase'<>'triage' then raise exception 'Owner budget consent before referral required' using errcode='42501';end if;
    perform private.workspace_required_text(data,'troubleshooting',5,2000);perform private.workspace_required_text(data,'guestUpdate',5,2000);
    if (d.data->>'warrantyRequired')::boolean then perform private.workspace_required_text(data,'warrantyContactEvidence',10,2000);end if;
    data:=data||jsonb_build_object('phase','referred','referredAt',now());next_status:='in_progress';
   elsif kind='maintenance' and step='bookRepair' then
    perform private.workspace_json_keys(data,array['repairOn','contractor','guestUpdate']);
    if actor not in ('ready','stays','admin','super_admin') or d.data->>'phase'<>'referred' or (data->>'repairOn')::date is null then raise exception 'Ready referral required' using errcode='42501';end if;
    perform private.workspace_required_text(data,'contractor',2,200);perform private.workspace_required_text(data,'guestUpdate',5,2000);data:=data||jsonb_build_object('phase','booked');
    update public.workspace_work_items set due_on=(data->>'repairOn')::date where id=target;
   elsif kind='maintenance' and step='completeRepair' then
    perform private.workspace_json_keys(data,array['report','actualCostMinor','guestUpdate']);
    if actor not in ('ready','stays','admin','super_admin') or d.data->>'phase'<>'booked' then raise exception 'Booked repair required' using errcode='42501';end if;
    perform private.workspace_required_text(data,'report',10,3000);perform private.workspace_required_text(data,'guestUpdate',5,2000);amount:=private.workspace_money(data,'actualCostMinor');
    if amount>(d.data->>'estimatedCostMinor')::bigint then raise exception 'Increased repair cost requires a new owner-approved request' using errcode='42501';end if;
    data:=data||jsonb_build_object('phase','completed');next_status:='completed';
    perform private.workspace_handover(prop,'maintenance-reconciliation','Reconcile completed property repair','maintenance_invoice',jsonb_build_object('sourceWorkId',target,'actualCostMinor',amount));
   elsif kind='cleaning' and step='submitCleaning' then
    perform private.workspace_json_keys(data,array['checks','report','photoIds','mailAction']);
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
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);return result;
end $$;
create function public.workspace_operations_read(target_property uuid default null) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_operations_read(target_property);$$;
create function public.workspace_operations_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_operations_action(input);$$;
revoke all on function private.workspace_money(jsonb,text),private.workspace_operation_access(uuid),private.workspace_operation_view(uuid),private.workspace_operations_read(uuid),private.workspace_operation_status_guard(),private.workspace_operation_invoice_guard(),private.workspace_operations_action(jsonb) from public,anon,authenticated;
grant execute on function private.workspace_operations_read(uuid),private.workspace_operations_action(jsonb) to authenticated;
revoke all on function public.workspace_operations_read(uuid),public.workspace_operations_action(jsonb) from public,anon;
grant execute on function public.workspace_operations_read(uuid),public.workspace_operations_action(jsonb) to authenticated;
