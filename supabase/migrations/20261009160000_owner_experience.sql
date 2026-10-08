-- Owners and approvals, as the client asked:
-- 1. An owner can decline a repair cost waiting for their approval, with a reason. The repair stays
--    open as "owner declined" so Stays (and admins) see why, and either re-quote it (back to the
--    owner) or close it. Stays on the property and admins are told.
-- 2. A second, company-wide spend limit: repairs above "management approval above £X" also need an
--    admin's approval, after the owner's (or straight away when the owner pre-authorised the cost).
--    It is off (null) until an admin sets it, so nothing changes until then. Admins approve or
--    decline from Management → Waiting on you.
-- 3. Owner reports: confirmed bookings, nights and payouts for the owner's own properties.

alter table private.workspace_finance_policy add column if not exists management_repair_limit_minor bigint check(management_repair_limit_minor between 0 and 100000000);

-- Whether a repair at this cost needs management approval: above the company-wide limit (when one
-- is set), unless management has already approved at least this amount.
create or replace function private.workspace_repair_needs_management(amount bigint, repair jsonb) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.workspace_finance_policy f where f.singleton and f.management_repair_limit_minor is not null and amount>f.management_repair_limit_minor)
  and amount>coalesce((repair->>'managementApprovedMinor')::bigint,-1);
$$;

-- Who approves repairs above the management limit.
create or replace function private.workspace_repair_managers() returns uuid[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(p.user_id order by p.user_id),'{}') from public.workspace_profiles p where p.role in ('admin','super_admin') and p.status='active';
$$;

-- Who hears about a decision on a repair's cost: Stays on the property, whoever last updated the
-- quote and (when asked) the admins.
create or replace function private.workspace_repair_team(prop uuid, repair jsonb, with_admins boolean) returns uuid[] language sql stable security definer set search_path='' as $$
 select coalesce(array_agg(distinct x.u),'{}') from (
  select a.user_id u from public.workspace_property_assignments a join public.workspace_profiles p on p.user_id=a.user_id
   join public.workspace_module_grants g on g.user_id=a.user_id and g.module_id='stays-maintenance-reporting'
   where a.property_id=prop and p.role='stays' and p.status='active'
  union select (repair->>'quoteRevisedBy')::uuid where repair->>'quoteRevisedBy' is not null
  union select m from unnest(case when with_admins then private.workspace_repair_managers() else '{}'::uuid[] end) m) x;
$$;

-- The decisions on a repair's cost: the owner declining it, management approving or declining it,
-- and Stays closing a declined repair. Returns the repair's new details, its status when it changes,
-- and who to tell. Called by workspace_operations_action, which has already checked the work access,
-- version and that the repair is open.
create or replace function private.workspace_repair_decision(step text, prop uuid, repair jsonb, input jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();phase text:=repair->>'phase';begin
 if step='declineBudget' then
  perform private.workspace_json_keys(input,array['reason']);
  if actor is distinct from 'client' or not private.workspace_can_property(prop,'client-property-maintenance') or phase is distinct from 'owner_approval' then raise exception 'Only the owner can decline a repair waiting for their approval' using errcode='42501';end if;
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
end $$;

-- A new quote on a repair: where it goes next, beyond the owner's own limit (handled by reviseQuote).
-- After the owner declined, it always goes back to the owner. After management declined, the owner
-- approves first if it is now above what they agreed and their limit, then management if needed.
-- Otherwise a higher quote above the management limit goes to management.
create or replace function private.workspace_repair_requote(prop uuid, amount bigint, repair jsonb, change jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare j private.workspace_journeys;owner_ok boolean;begin
 j:=(select x from private.workspace_journeys x where x.property_id=prop);
 owner_ok:=coalesce((j.form->>'fullRepairPermission')::boolean,false) or amount<=coalesce((j.form->>'repairLimitMinor')::bigint,0);
 if repair->>'phase'='owner_declined' then
  return jsonb_build_object('phase','owner_approval','resumePhase',repair->'resumePhase');
 elsif repair->>'phase'='management_declined' then
  if not owner_ok and amount>coalesce((repair->>'ownerApprovedMinor')::bigint,-1) then return jsonb_build_object('phase','owner_approval','resumePhase',repair->'resumePhase');end if;
  if private.workspace_repair_needs_management(amount,repair) then return jsonb_build_object('phase','management_approval','resumePhase',repair->'resumePhase');end if;
  return jsonb_build_object('phase',coalesce(repair->>'resumePhase','triage'),'resumePhase',null);
 elsif change->>'phase' is null and amount>coalesce((repair->>'estimatedCostMinor')::bigint,0) and private.workspace_repair_needs_management(amount,repair) then
  return jsonb_build_object('phase','management_approval','resumePhase',repair->>'phase');
 end if;
 return '{}'::jsonb;
end $$;

-- Repairs waiting for management approval, for Management → Waiting on you.
create or replace function private.workspace_management_repairs() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('workId',w.id,'version',w.version,'title',w.title,'propertyId',w.property_id,'propertyName',p.name,
   'issue',d.data->>'issue','repairType',d.data->>'repairType','urgent',coalesce((d.data->>'urgent')::boolean,false),'hazard',coalesce((d.data->>'hazard')::boolean,false),
   'estimatedCostMinor',(d.data->>'estimatedCostMinor')::bigint,'previousEstimateMinor',(d.data->>'previousEstimateMinor')::bigint,'quoteReason',d.data->>'quoteReason',
   'ownerApprovedAt',d.data->>'ownerApprovedAt','limitMinor',(select f.management_repair_limit_minor from private.workspace_finance_policy f where f.singleton),'waitingSince',w.updated_at) order by w.updated_at,w.id),'[]')
 from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id join public.workspace_properties p on p.id=w.property_id
 where d.kind='maintenance' and d.data->>'phase'='management_approval' and w.status not in ('completed','cancelled');
$$;

-- The management limit is set by admins, next to the expense approval limit.
create or replace function private.workspace_set_repair_limit(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare policy private.workspace_finance_policy;amount bigint;begin
 if private.workspace_actor_role() is null or private.workspace_actor_role() not in ('admin','super_admin') then raise exception 'Management access required' using errcode='42501';end if;
 perform private.workspace_json_keys(input,array['action','requestId','version','managementRepairLimitMinor']);
 perform 1 from private.workspace_finance_policy f where f.singleton for update;
 policy:=(select f from private.workspace_finance_policy f where f.singleton);
 if policy.version is distinct from (input->>'version')::integer then raise exception 'Policy changed' using errcode='40001';end if;
 if jsonb_typeof(input->'managementRepairLimitMinor')='null' then amount:=null;else amount:=private.workspace_money(input,'managementRepairLimitMinor');end if;
 update private.workspace_finance_policy set management_repair_limit_minor=amount,version=version+1,updated_by=auth.uid(),updated_at=now() where singleton returning * into policy;
 insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'finance.repair_limit_updated');
 return jsonb_build_object('managementRepairLimitMinor',policy.management_repair_limit_minor,'expenseApprovalLimitMinor',policy.expense_approval_limit_minor,'version',policy.version);
end $$;

-- Owner reports: confirmed stays overlapping the dates at the properties the owner can see (admins
-- see every property), with nights, guests, platform, reservation code and payout, plus totals per
-- property (nights booked inside the dates, and payouts for stays checking out inside them).
create or replace function private.workspace_owner_bookings(start_on date, end_on date) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();begin
 if actor is null or actor not in ('client','admin','super_admin') then raise exception 'Owner reports access required' using errcode='42501';end if;
 if start_on is null or end_on is null or end_on<start_on or end_on-start_on>400 then raise exception 'Choose up to 400 days' using errcode='22023';end if;
 return (with props as (
   select p.id,p.name from public.workspace_properties p where p.status<>'archived' and private.workspace_can_property(p.id,'client-dashboard')
  ), stays as (
   select r.id,r.property_id,pr.name,r.reference,r.check_in,r.check_out,r.guests,r.channel,r.channel_reference,r.payout_minor from private.workspace_reservations r join props pr on pr.id=r.property_id
   where r.status='confirmed' and r.check_in<=end_on and r.check_out>=start_on order by r.check_in,r.id limit 3000
  )
  select jsonb_build_object('from',start_on,'to',end_on,
   'properties',(select coalesce(jsonb_agg(jsonb_build_object('propertyId',p.id,'propertyName',p.name,
      'stays',(select count(*) from stays s where s.property_id=p.id),
      'bookedNights',(select coalesce(sum(greatest(0,least(s.check_out,end_on+1)-greatest(s.check_in,start_on))),0) from stays s where s.property_id=p.id),
      'payoutMinor',(select coalesce(sum(s.payout_minor),0) from stays s where s.property_id=p.id and s.check_out between start_on and end_on)) order by p.name,p.id),'[]') from props p),
   'stays',(select coalesce(jsonb_agg(jsonb_build_object('reservationId',s.id,'propertyId',s.property_id,'propertyName',s.name,'reference',s.reference,'checkIn',s.check_in,'checkOut',s.check_out,
      'nights',s.check_out-s.check_in,'guests',s.guests,'channel',s.channel,'channelReference',s.channel_reference,'payoutMinor',s.payout_minor) order by s.check_in,s.id),'[]') from stays s)));
end $$;
create or replace function public.workspace_owner_bookings(start_on date, end_on date) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_owner_bookings(start_on,end_on);$$;

revoke all on function private.workspace_repair_needs_management(bigint,jsonb),private.workspace_repair_managers(),private.workspace_repair_team(uuid,jsonb,boolean),
 private.workspace_repair_decision(text,uuid,jsonb,jsonb),private.workspace_repair_requote(uuid,bigint,jsonb,jsonb),private.workspace_management_repairs(),private.workspace_set_repair_limit(jsonb) from public,anon,authenticated;
revoke all on function private.workspace_owner_bookings(date,date),public.workspace_owner_bookings(date,date) from public,anon;
grant execute on function private.workspace_owner_bookings(date,date),public.workspace_owner_bookings(date,date) to authenticated;

-- Wire the decisions into the existing repair steps, the management queue and the finance policy.
do $$
declare
 fixes constant text[][] := array[
  -- The owner's decline, management's decision and closing a declined repair.
  ['private.workspace_operations_action(jsonb)',
   $q$elsif kind='maintenance' and step='approveBudget' then$q$,
   $q$elsif kind='maintenance' and step in ('declineBudget','approveManagement','declineManagement','closeRepair') then
    entry:=private.workspace_repair_decision(step,prop,d.data,data);
    data:=entry->'data';next_status:=coalesce(entry->>'status',next_status);notify_users:=array(select value::uuid from jsonb_array_elements_text(entry->'notify'));
   elsif kind='maintenance' and step='approveBudget' then$q$,
   $q$workspace_repair_decision(step$q$],
  -- After the owner approves, a cost above the management limit goes to management next.
  ['private.workspace_operations_action(jsonb)',
   $q$data:=data||jsonb_build_object('phase',coalesce(d.data->>'resumePhase','triage'),'resumePhase',null,'ownerApprovedBy',auth.uid(),'ownerApprovedAt',now());$q$,
   $q$data:=data||jsonb_build_object('phase',coalesce(d.data->>'resumePhase','triage'),'resumePhase',null,'ownerApprovedBy',auth.uid(),'ownerApprovedAt',now());
    data:=data||jsonb_build_object('ownerApprovedMinor',(d.data->>'estimatedCostMinor')::bigint);
    if private.workspace_repair_needs_management((d.data->>'estimatedCostMinor')::bigint,d.data) then data:=data||jsonb_build_object('phase','management_approval','resumePhase',coalesce(d.data->>'resumePhase','triage'));notify_users:=private.workspace_repair_managers();end if;$q$,
   $q$'ownerApprovedMinor'$q$],
  -- A new repair the owner pre-authorised, above the management limit, goes to management first.
  ['private.workspace_operations_action(jsonb)',
   $q$'reportedBy',auth.uid());$q$,
   $q$'reportedBy',auth.uid());
    if data->>'phase'='triage' and private.workspace_repair_needs_management(amount,'{}'::jsonb) then data:=data||jsonb_build_object('phase','management_approval');notify_users:=private.workspace_repair_managers();end if;$q$,
   $q$workspace_repair_needs_management(amount,'{}'::jsonb)$q$],
  -- Stays and admins can re-quote a declined repair.
  ['private.workspace_operations_action(jsonb)',
   $q$not in ('triage','referred','booked') then raise exception 'Only an open repair can be re-quoted'$q$,
   $q$not in ('triage','referred','booked','owner_declined','management_declined') or (actor='ready' and d.data->>'phase' in ('owner_declined','management_declined')) then raise exception 'Only an open repair can be re-quoted'$q$,
   $q$'booked','owner_declined','management_declined')$q$],
  -- Where a new quote goes next, beyond the owner's own limit.
  ['private.workspace_operations_action(jsonb)',
   $q$then jsonb_build_object('phase','owner_approval','resumePhase',d.data->>'phase') else '{}'::jsonb end;$q$,
   $q$then jsonb_build_object('phase','owner_approval','resumePhase',d.data->>'phase') else '{}'::jsonb end;
    data:=data||private.workspace_repair_requote(prop,amount,d.data,data);
    if data->>'phase'='management_approval' then notify_users:=private.workspace_repair_managers();end if;$q$,
   $q$workspace_repair_requote(prop$q$],
  -- Management → Waiting on you lists repairs above the management limit.
  ['private.workspace_teams_read(text,date,date,uuid,uuid)',
   $q$'stalledOwnerApprovals',(select coalesce($q$,
   $q$'repairApprovals',private.workspace_management_repairs(),
   'stalledOwnerApprovals',(select coalesce($q$,
   $q$workspace_management_repairs()$q$],
  -- Admins set the management limit through Accounts, next to the expense approval limit.
  ['private.workspace_finance_action(jsonb)',
   $q$if a in ('setFinancePolicy') then$q$,
   $q$if a='setRepairApprovalLimit' then
  if actor not in ('admin','super_admin') then raise exception 'Management access required' using errcode='42501';end if;
 elsif a in ('setFinancePolicy') then$q$,
   $q$elsif a in ('setFinancePolicy') then$q$],
  ['private.workspace_finance_action(jsonb)',
   $q$if a='setFinancePolicy' then$q$,
   $q$if a='setRepairApprovalLimit' then result:=private.workspace_set_repair_limit(input);
 elsif a='setFinancePolicy' then$q$,
   $q$workspace_set_repair_limit(input)$q$],
  ['private.workspace_finance_read(text,uuid,text,uuid,text)',
   $q$result:=jsonb_build_object('expenseApprovalLimitMinor',policy.expense_approval_limit_minor,'version',policy.version,'updatedAt',policy.updated_at);$q$,
   $q$result:=jsonb_build_object('expenseApprovalLimitMinor',policy.expense_approval_limit_minor,'managementRepairLimitMinor',policy.management_repair_limit_minor,'version',policy.version,'updatedAt',policy.updated_at);$q$,
   $q$'managementRepairLimitMinor',policy.management_repair_limit_minor$q$]
 ];
 definition text;
begin
 for i in 1..array_length(fixes, 1) loop
  definition := pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in definition) = 0 then
   if position(fixes[i][2] in definition) = 0 then raise exception 'Patch anchor missing in % (%)', fixes[i][1], i; end if;
   execute replace(definition, fixes[i][2], fixes[i][3]);
  end if;
 end loop;
end $$;
