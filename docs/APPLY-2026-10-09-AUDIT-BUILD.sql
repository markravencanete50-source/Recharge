-- Paste this whole file into Supabase → SQL Editor → New query, then press Run.
-- It adds everything built from the client-feedback audit, in order:
--   20261009160000 owner_experience      Owner Approvals, Home and Reports; owner/management repair decline; management spend limit
--   20261009170000 calendar_inbox_replies Calendar payment runs, saved replies, property team conversations
--   20261009180000 cleans_disputes        Fair rejection rule, cleaner notices, manager disputes, pay rates, guests per clean, problem reports
--   20261009190000 management_oversight   Admin Home, owner approval reminders, sign-off rollover, history and decisions
--   20261009200000 accounts_ready         Expense paperwork, statement downloads, purchases and direct-booking invoices, Ready access and Home, automatic routine visits
-- Safe to run more than once. The last lines record each part in the migration history.

-- ================================================================================================
-- 20261009160000_owner_experience.sql
-- ================================================================================================
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

-- ================================================================================================
-- 20261009170000_calendar_inbox_replies.sql
-- ================================================================================================
-- Calendar, unified inbox, saved replies and property team conversations.
-- 1. Payment runs on the calendar: the shared schedule also returns owner statements (to issue,
--    issued and paid) for admins and accounts. Owners and cleaners never get them.
-- 2. Saved replies: short, editable answers for guests and owners. Everyone with the guest inbox
--    (and admins) uses them; admins and the Stays team keep the list. Nothing is seeded.
-- 3. Property team conversations: one group conversation per property (or per job) with the
--    team on that property, started from a job or a day on the calendar.
-- Written without "select ... into" so it can be pasted into the Supabase SQL editor. Safe to run more than once.

-- 1. Payment runs on the schedule ----------------------------------------------------------------
-- Each statement sits on the day it was paid, else the day it was issued, else (a draft) the first
-- day after its month, when it is due to be issued.
create or replace function private.workspace_schedule_payments(start_on date, end_on date, target_property uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select case when coalesce(private.workspace_actor_role() in ('admin','super_admin','accounts'),false) then coalesce((
  select jsonb_agg(x.item order by x.item->>'date',x.item->>'propertyName',x.item->>'statementId') from (
   select jsonb_build_object('statementId',s.id,'propertyId',s.property_id,'propertyName',p.name,'period',to_char(s.period_start,'YYYY-MM'),'status',s.status,
    'payoutMinor',s.payout_minor,'date',s.on_day,'issuedAt',s.issued_at,'paidAt',s.paid_at,'reference',s.payout_reference) item
   from (select o.*,coalesce((o.paid_at at time zone 'Europe/London')::date,(o.issued_at at time zone 'Europe/London')::date,(o.period_start+interval '1 month')::date) on_day
     from private.workspace_owner_statements o where o.status in ('draft','issued','paid') and (target_property is null or o.property_id=target_property)) s
   join public.workspace_properties p on p.id=s.property_id
   where s.on_day between start_on and end_on and private.workspace_can_property(s.property_id,'owner-statements')
   order by s.on_day,s.id limit 500) x),'[]'::jsonb) else '[]'::jsonb end;
$$;
revoke all on function private.workspace_schedule_payments(date,date,uuid) from public,anon,authenticated;

do $$
declare
 fixes constant text[][] := array[
  ['private.workspace_teams_read(text,date,date,uuid,uuid)',
   $q$select jsonb_build_object('from',start_on,'to',end_on,$q$,
   $q$select jsonb_build_object('from',start_on,'to',end_on,'payments',private.workspace_schedule_payments(start_on,end_on,target_property),$q$,
   $q$private.workspace_schedule_payments(start_on,end_on,target_property)$q$]
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

-- 2. Saved replies -------------------------------------------------------------------------------
create table if not exists private.workspace_saved_replies (
 id uuid primary key default gen_random_uuid(),
 title text not null check(char_length(trim(title)) between 2 and 80),
 body text not null check(char_length(trim(body)) between 2 and 2000),
 audience text not null default 'all' check(audience in ('guest','owner','all')),
 created_by uuid not null references public.workspace_profiles(user_id),
 created_at timestamptz not null default now(),
 updated_by uuid references public.workspace_profiles(user_id),
 updated_at timestamptz not null default now(),
 version integer not null default 1 check(version>0)
);
create index if not exists workspace_saved_replies_created_by_idx on private.workspace_saved_replies(created_by);
create index if not exists workspace_saved_replies_updated_by_idx on private.workspace_saved_replies(updated_by);
alter table private.workspace_saved_replies enable row level security;
revoke all on private.workspace_saved_replies from public,anon,authenticated;
drop trigger if exists business_write_limit on private.workspace_saved_replies;
create trigger business_write_limit before insert or update or delete on private.workspace_saved_replies for each row execute function private.workspace_enforce_write_limit();

-- Who uses them: admins, and team members with the guest inbox (who also answer owners).
create or replace function private.saved_replies_can_read() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(private.workspace_actor_role() in ('admin','super_admin')
  or (private.workspace_actor_role() not in ('client','cleans') and private.has_workspace_module('guest-communication')),false);
$$;
create or replace function private.saved_reply_json(r private.workspace_saved_replies) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',r.id,'title',r.title,'body',r.body,'audience',r.audience,'version',r.version,'updatedAt',r.updated_at,
  'updatedBy',(select p.full_name from public.workspace_profiles p where p.user_id=coalesce(r.updated_by,r.created_by)));
$$;
create or replace function private.workspace_saved_replies_read() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.saved_replies_can_read() then raise exception 'Saved replies are for the guest inbox team' using errcode='42501';end if;
 return jsonb_build_object('canEdit',coalesce(private.workspace_actor_role() in ('admin','super_admin','stays'),false),
  'replies',coalesce((select jsonb_agg(private.saved_reply_json(r) order by lower(r.title),r.id) from private.workspace_saved_replies r),'[]'));
end $$;
create or replace function private.workspace_saved_replies_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a text:=input->>'action';target uuid:=(input->>'replyId')::uuid;r private.workspace_saved_replies;begin
 if not private.saved_replies_can_read() or coalesce(private.workspace_actor_role() not in ('admin','super_admin','stays'),true) then
  raise exception 'Only admins and the Stays team change saved replies' using errcode='42501';end if;
 if a='saveReply' then
  perform private.workspace_json_keys(input,array['action','replyId','version','title','body','audience']);
  if char_length(trim(coalesce(input->>'title',''))) not between 2 and 80 then raise exception 'Give the reply a title of 2 to 80 characters' using errcode='22023';end if;
  if char_length(trim(coalesce(input->>'body',''))) not between 2 and 2000 then raise exception 'Write a reply of 2 to 2,000 characters' using errcode='22023';end if;
  if coalesce(input->>'audience','') not in ('guest','owner','all') then raise exception 'Choose who the reply is for' using errcode='22023';end if;
  if target is null then
   insert into private.workspace_saved_replies(title,body,audience,created_by) values(trim(input->>'title'),trim(input->>'body'),input->>'audience',auth.uid()) returning * into r;
  else
   update private.workspace_saved_replies set title=trim(input->>'title'),body=trim(input->>'body'),audience=input->>'audience',updated_by=auth.uid(),updated_at=now(),version=version+1
    where id=target and version=(input->>'version')::integer returning * into r;
  end if;
 elsif a='deleteReply' then
  perform private.workspace_json_keys(input,array['action','replyId','version']);
  delete from private.workspace_saved_replies where id=target and version=(input->>'version')::integer returning * into r;
 else raise exception 'Unknown saved reply action' using errcode='22023';end if;
 if r.id is null then
  if exists(select 1 from private.workspace_saved_replies where id=target) then raise exception 'Someone else changed this reply. Refresh and try again' using errcode='40001';end if;
  raise exception 'Saved reply not found' using errcode='P0002';
 end if;
 if a='deleteReply' then return jsonb_build_object('id',r.id,'deleted',true);end if;
 return private.saved_reply_json(r);
end $$;
revoke all on function private.saved_replies_can_read(),private.saved_reply_json(private.workspace_saved_replies),
 private.workspace_saved_replies_read(),private.workspace_saved_replies_action(jsonb) from public,anon,authenticated;

-- 3. Property team conversations -----------------------------------------------------------------
alter table private.chat_conversations add column if not exists property_team boolean not null default false;
create index if not exists chat_conversations_property_team_idx on private.chat_conversations(property_id,work_id) where property_team;

-- Finds or starts the team conversation for a property (or one job there). Its members: the
-- caller, the Stays and Ready staff and cleaning managers assigned to the property, and the job's
-- assignee. Other cleaners and admins are only added when they start it themselves. Anyone
-- already in it stays; people newly assigned are added when it is opened again.
create or replace function private.chat_start_property(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid();actor text:=private.workspace_actor_role();prop uuid;wid uuid;w public.workspace_work_items;conv private.chat_conversations;
 people uuid[];new_id uuid:=gen_random_uuid();label text;begin
 perform private.workspace_json_keys(input,array['action','propertyId','workId']);
 prop:=(input->>'propertyId')::uuid;wid:=(input->>'workId')::uuid;
 if actor is null or actor='client' or prop is null or not exists(select 1 from public.workspace_properties where id=prop)
  or not (actor in ('admin','super_admin') or exists(select 1 from public.workspace_property_assignments x where x.property_id=prop and x.user_id=me and x.assignment in ('staff','cleaning_manager','cleaner')))
 then raise exception 'Property not found' using errcode='42501';end if;
 if wid is not null then
  w:=(select x from public.workspace_work_items x where x.id=wid);
  if w.id is null or w.property_id<>prop or not private.workspace_operation_access(wid) then raise exception 'Job not found' using errcode='42501';end if;
 end if;
 people:=array(
  select a.user_id from public.workspace_property_assignments a join public.workspace_profiles p on p.user_id=a.user_id and p.status='active'
   where a.property_id=prop and ((a.assignment='staff' and p.role in ('stays','ready')) or (a.assignment='cleaning_manager' and p.role='cleaning_manager'))
  union select w.assignee_id where w.assignee_id is not null and private.chat_is_team(w.assignee_id)
  union select me);
 perform pg_advisory_xact_lock(hashtextextended('chat-property:'||prop::text||':'||coalesce(wid::text,''),0));
 conv:=(select c from private.chat_conversations c where c.property_team and c.kind='group' and c.property_id=prop and c.work_id is not distinct from wid order by c.created_at,c.id limit 1);
 if conv.id is null then
  label:=(select left(case when w.id is null then p.name||' team' else w.title||' · '||p.name end,80) from public.workspace_properties p where p.id=prop);
  insert into private.chat_conversations(id,kind,title,property_id,work_id,created_by,property_team) values(new_id,'group',label,prop,wid,me,true);
  conv:=(select c from private.chat_conversations c where c.id=new_id);
 end if;
 insert into private.chat_members(conversation_id,user_id) select conv.id,u from unnest(people) u on conflict do nothing;
 return private.chat_summary(conv,me);
end $$;
revoke all on function private.chat_start_property(jsonb) from public,anon,authenticated;

-- Messages routes the new actions and the saved replies list (added before the "unknown" errors).
do $$
declare
 fixes constant text[][] := array[
  ['private.workspace_chat_action(jsonb)',
   $q$raise exception 'Unknown chat action' using errcode='22023';$q$,
   $q$if a='startProperty' then return private.chat_start_property(input);end if;
 if a in ('saveReply','deleteReply') then return private.workspace_saved_replies_action(input);end if;
 raise exception 'Unknown chat action' using errcode='22023';$q$,
   $q$private.chat_start_property(input)$q$],
  ['private.workspace_chat_read(text,uuid,timestamptz)',
   $q$raise exception 'Unknown chat section' using errcode='22023';$q$,
   $q$if section='savedReplies' then return private.workspace_saved_replies_read();end if;
 raise exception 'Unknown chat section' using errcode='22023';$q$,
   $q$private.workspace_saved_replies_read()$q$]
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

-- ================================================================================================
-- 20261009180000_cleans_disputes.sql
-- ================================================================================================
-- Cleaners, clean reviews and disputes, as the client asked:
-- * A cleaner goes to a management review on their second upheld rejection this month, the same rule as the
--   monthly warning (an overturned rejection, or one from an earlier month, no longer counts).
-- * Cleaners hear when a clean is accepted or rejected, and when a dispute about it is decided. The clean keeps
--   the reviewer's reason and the dispute's outcome, so the cleaner sees both on the clean.
-- * Cleaning managers decide disputes (uphold or overturn) for the properties they manage, as admins do. The
--   dispute keeps what the cleaner submitted (report, checklist, photos) and why it was rejected. Deciding whether
--   a cleaner stays on the rota is still for admins.
-- * A pay rate per clean for each cleaner, set by admins or the cleaner's cleaning manager. The cleaner sees their
--   month and its amount; Accounts sees the amount for the cleans it invoices.
-- * Each clean shows how many guests are leaving and arriving next, for cleaners too: counts and dates only.
-- * A cleaner can report a problem from a clean. It becomes a repair in triage for the property's Stays team,
--   with optional photos, and the clean lists what was reported.

-- Pay rates ---------------------------------------------------------------------------------------------------
create table if not exists private.workspace_cleaner_rates (
 cleaner_id uuid primary key references public.workspace_profiles(user_id),
 rate_minor integer not null check(rate_minor between 1 and 100000),
 version integer not null default 1 check(version>0),
 updated_by uuid not null references public.workspace_profiles(user_id),
 updated_at timestamptz not null default now()
);
alter table private.workspace_cleaner_rates enable row level security;
revoke all on private.workspace_cleaner_rates from public,anon,authenticated;
drop trigger if exists business_write_limit on private.workspace_cleaner_rates;
create trigger business_write_limit before insert or update on private.workspace_cleaner_rates for each row execute function private.workspace_enforce_write_limit();

-- Admins manage every cleaner; a cleaning manager manages cleaners on a property they look after.
create or replace function private.workspace_manages_cleaner(cleaner uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.workspace_profiles c where c.user_id=cleaner and c.role='cleans') and (
  private.workspace_actor_role() in ('admin','super_admin') or (private.workspace_actor_role()='cleaning_manager' and exists(
   select 1 from public.workspace_property_assignments a where a.user_id=cleaner and a.assignment='cleaner' and private.workspace_can_property(a.property_id,'cleaner-performance'))))
$$;

create or replace function private.workspace_cleaner_rate_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();req uuid;cleaner uuid;prior private.workspace_action_receipts;rate private.workspace_cleaner_rates;result jsonb;
begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 perform private.workspace_json_keys(input,array['action','requestId','cleanerId','rateMinor','version']);
 req:=(input->>'requestId')::uuid;cleaner:=(input->>'cleanerId')::uuid;
 if req is null or cleaner is null then raise exception 'Choose a cleaner' using errcode='22023';end if;
 if not private.workspace_manages_cleaner(cleaner) then raise exception 'Only admins and the cleaner''s cleaning manager can set their rate' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 prior:=(select r from private.workspace_action_receipts r where r.actor_id=auth.uid() and r.request_id=req);
 if prior.actor_id is not null then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;
 if jsonb_typeof(input->'rateMinor') is distinct from 'number' or input->>'rateMinor'!~'^\d+$' or (input->>'rateMinor')::bigint not between 1 and 100000 then raise exception 'Enter a rate between £0.01 and £1,000 a clean' using errcode='22023';end if;
 if jsonb_typeof(input->'version') is distinct from 'number' or input->>'version'!~'^\d+$' then raise exception 'Rate version required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('cleaner-rate:'||cleaner::text,0));
 if coalesce((select r.version from private.workspace_cleaner_rates r where r.cleaner_id=cleaner),0)<>(input->>'version')::int then raise exception 'The rate was changed by someone else. Refresh and try again' using errcode='40001';end if;
 insert into private.workspace_cleaner_rates(cleaner_id,rate_minor,updated_by) values(cleaner,(input->>'rateMinor')::int,auth.uid())
  on conflict(cleaner_id) do update set rate_minor=excluded.rate_minor,version=private.workspace_cleaner_rates.version+1,updated_by=excluded.updated_by,updated_at=now()
  returning * into rate;
 result:=jsonb_build_object('cleanerId',rate.cleaner_id,'rateMinor',rate.rate_minor,'version',rate.version);
 insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'cleaning.rate_set');
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $$;

-- Rates for the cleaners this person may see: admins and Accounts (for invoicing) see all, a cleaning manager
-- sees their own cleaners.
create or replace function private.workspace_cleaner_rates_read() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();
begin
 if actor is null or not (actor in ('admin','super_admin','cleaning_manager') or (actor='accounts' and private.has_workspace_module('cleans-invoices'))) then raise exception 'Cleaner rates access required' using errcode='42501';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('cleanerId',p.user_id,'fullName',p.full_name,'rateMinor',r.rate_minor,'version',r.version,'updatedAt',r.updated_at) order by p.full_name,p.user_id),'[]')
  from private.workspace_cleaner_rates r join public.workspace_profiles p on p.user_id=r.cleaner_id
  where actor<>'cleaning_manager' or private.workspace_manages_cleaner(r.cleaner_id));
end $$;

-- Disputes ----------------------------------------------------------------------------------------------------
-- Admins decide any dispute; a cleaning manager decides disputes on the properties they manage.
create or replace function private.workspace_can_decide_dispute(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select private.workspace_actor_role() in ('admin','super_admin') or (private.workspace_actor_role()='cleaning_manager' and exists(
  select 1 from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
  where w.id=target and d.kind='cleaning_complaint' and private.workspace_can_property(w.property_id,'cleaner-performance')))
$$;

-- Upholding or overturning a rejected clean (every "decideComplaint" now comes here). Overturning removes the
-- rejection from the cleaner's record and, if the clean was not redone, accepts it for invoicing. The outcome is
-- written on the clean and the cleaner is told.
create or replace function private.workspace_decide_clean_dispute(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();req uuid;prior private.workspace_action_receipts;result jsonb;
 w public.workspace_work_items;d private.workspace_domain_details;src public.workspace_work_items;sd private.workspace_domain_details;cleaner uuid;event_id bigint;
begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 req:=(input->>'requestId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 if not private.workspace_can_decide_dispute((input->>'workId')::uuid) then raise exception 'Management access required' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 prior:=(select r from private.workspace_action_receipts r where r.actor_id=auth.uid() and r.request_id=req);
 if prior.actor_id is not null then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;
 perform private.workspace_json_keys(input,array['action','requestId','workId','version','outcome','note']);
 perform 1 from public.workspace_work_items x where x.id=(input->>'workId')::uuid for update;
 w:=(select x from public.workspace_work_items x where x.id=(input->>'workId')::uuid);
 d:=(select x from private.workspace_domain_details x where x.work_id=w.id);
 if w.id is null or d.work_id is null or d.kind<>'cleaning_complaint' then raise exception 'Decision not found' using errcode='P0002';end if;
 if w.version is distinct from (input->>'version')::integer then raise exception 'Decision changed' using errcode='40001';end if;
 if w.status in ('completed','cancelled') then raise exception 'Already decided' using errcode='42501';end if;
 if coalesce(input->>'outcome','') not in ('upheld','overturned') then raise exception 'Choose an outcome' using errcode='22023';end if;
 update private.workspace_domain_details set data=data||jsonb_build_object('decision',input->>'outcome','decisionNote',private.workspace_required_text(input,'note',5,2000),'decidedBy',auth.uid(),'decidedAt',now(),'workStatus','completed'),updated_at=now() where work_id=w.id;
 insert into public.workspace_work_updates(work_id,actor_id,request_id,previous_status,next_status,note,expected_version) values(w.id,auth.uid(),req,w.status,'completed',input->>'note',w.version);
 update public.workspace_work_items set status='completed',completed_at=now(),version=version+1,updated_at=now() where id=w.id returning * into w;
 cleaner:=(d.data->>'cleanerId')::uuid;
 perform 1 from public.workspace_work_items x where x.id=(d.data->>'sourceWorkId')::uuid for update;
 src:=(select x from public.workspace_work_items x where x.id=(d.data->>'sourceWorkId')::uuid);
 sd:=(select x from private.workspace_domain_details x where x.work_id=src.id);
 if input->>'outcome'='overturned' then
  -- The rejection no longer counts against the cleaner.
  update private.workspace_cleaning_reviews set overturned_at=now(),overturned_by=auth.uid(),overturn_note=input->>'note'
   where id=(select r.id from private.workspace_cleaning_reviews r where r.work_id=src.id and r.cleaner_id=cleaner and not r.accepted and r.overturned_at is null order by r.created_at desc limit 1);
  -- If the clean has not been redone, it is accepted as originally submitted and can be invoiced.
  if src.id is not null and sd.kind='cleaning' and sd.data->>'phase'='assigned' and src.status='waiting' and src.assignee_id=cleaner and sd.data ? 'submittedBy' then
   update private.workspace_domain_details set data=data||jsonb_build_object('phase','accepted','workStatus','completed','overturnedBy',auth.uid()),updated_at=now() where work_id=src.id;
   insert into public.workspace_work_updates(work_id,actor_id,request_id,previous_status,next_status,note,expected_version) values(src.id,auth.uid(),gen_random_uuid(),src.status,'completed','Rejection overturned by management',src.version);
   update public.workspace_work_items set status='completed',completed_at=now(),version=version+1,updated_at=now() where id=src.id;
   perform private.workspace_handover(src.property_id,'cleans-invoices','Invoice accepted property clean','cleaning_invoice',jsonb_build_object('sourceWorkId',src.id,'cleanerId',src.assignee_id,
    'cleanerName',(select p.full_name from public.workspace_profiles p where p.user_id=src.assignee_id),'cleanedOn',src.due_on));
  end if;
 end if;
 -- The clean shows the outcome to its cleaner, unless a later rejection of the same clean is now the open one.
 if sd.kind='cleaning' and coalesce(sd.data->>'complaintWorkId',w.id::text)=w.id::text then
  update private.workspace_domain_details set data=data||jsonb_build_object('complaintWorkId',w.id,'disputeDecision',input->>'outcome','disputeNote',input->>'note','disputeDecidedAt',now()),updated_at=now() where work_id=src.id;
 end if;
 result:=jsonb_build_object('workId',w.id,'version',w.version,'status',w.status,'outcome',input->>'outcome');
 insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(auth.uid(),w.property_id,w.id,'cleaning.decision_'||(input->>'outcome'));
 if cleaner is not null then
  insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(auth.uid(),w.property_id,case when src.assignee_id=cleaner then src.id end,'cleaning.dispute_'||(input->>'outcome')) returning id into event_id;
  insert into private.workspace_notification_outbox(user_id,work_id,event_id) values(cleaner,case when src.assignee_id=cleaner then src.id end,event_id) on conflict do nothing;
 end if;
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $$;

-- Guests for each clean ---------------------------------------------------------------------------------------
-- For each clean in the schedule the person can see: guests on the stay it follows, and the date and guests of the
-- next arrival at that property. Nothing else about the booking leaves the database.
create or replace function private.workspace_clean_guests(start_on date,end_on date,target_property uuid,target_user uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('workId',c.id,
   'guestsLeaving',(select r.guests from private.workspace_reservations r where r.property_id=c.property_id and r.status='confirmed'
     and (r.id::text=c.data->>'reservationId' or (c.data->>'reservationId' is null and r.check_out=c.due_on)) order by r.check_out desc,r.id limit 1),
   'nextArrivalOn',n.check_in,'nextArrivalGuests',n.guests) order by c.due_on,c.id),'[]')
 from (select w.id,w.property_id,w.due_on,d.data from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
   where d.kind='cleaning' and w.due_on between start_on and end_on and w.status not in ('cancelled','declined') and (target_property is null or w.property_id=target_property)
    and (target_user is null or w.assignee_id=target_user) and private.workspace_can_work(w.id) order by w.due_on,w.id limit 500) c
 left join lateral (select r.check_in,r.guests from private.workspace_reservations r where r.property_id=c.property_id and r.status='confirmed' and r.check_in>=c.due_on order by r.check_in,r.id limit 1) n on true
$$;

revoke all on function private.workspace_manages_cleaner(uuid),private.workspace_cleaner_rate_action(jsonb),private.workspace_cleaner_rates_read(),
 private.workspace_can_decide_dispute(uuid),private.workspace_decide_clean_dispute(jsonb),private.workspace_clean_guests(date,date,uuid,uuid) from public,anon,authenticated;

-- Patches to shared functions, each inside the cleaning parts only -----------------------------------------------
do $$
declare
 fixes constant text[][] := array[
  -- Second-rejection rule: upheld (not overturned) rejections this month, like the monthly warning.
  ['private.workspace_operations_action(jsonb)',
   $q$if (select count(distinct work_id) from private.workspace_cleaning_reviews where cleaner_id=w.assignee_id and not accepted)>=2 then$q$,
   $q$if (select count(*) from private.workspace_cleaning_reviews r where r.cleaner_id=w.assignee_id and not r.accepted and r.overturned_at is null and r.created_at>=date_trunc('month',current_date)::date)>=2 then$q$,
   $q$r.overturned_at is null and r.created_at>=date_trunc('month',current_date)::date)>=2 then$q$],
  -- The cleaner hears the review's result.
  ['private.workspace_operations_action(jsonb)',
   $q$insert into private.workspace_cleaning_reviews(work_id,cleaner_id,reviewer_id,accepted,guest_feedback,review_note) values(target,w.assignee_id,auth.uid(),(data->>'accepted')::boolean,data->>'guestFeedback',data->>'reviewNote');$q$,
   $q$insert into private.workspace_cleaning_reviews(work_id,cleaner_id,reviewer_id,accepted,guest_feedback,review_note) values(target,w.assignee_id,auth.uid(),(data->>'accepted')::boolean,data->>'guestFeedback',data->>'reviewNote');
    insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(auth.uid(),prop,target,case when (data->>'accepted')::boolean then 'cleaning.accepted' else 'cleaning.rejected' end) returning id into event_id;
    insert into private.workspace_notification_outbox(user_id,work_id,event_id) select w.assignee_id,target,event_id where w.assignee_id is not null and w.assignee_id is distinct from auth.uid() on conflict do nothing;$q$,
   $q$'cleaning.accepted'$q$],
  -- The dispute keeps what was submitted and why it was rejected; the clean links to its open dispute.
  ['private.workspace_operations_action(jsonb)',
   $q$perform private.workspace_handover(prop,'cleaner-performance','Review guest complaint with cleaner','cleaning_complaint',jsonb_build_object('sourceWorkId',target,'cleanerId',w.assignee_id,'requiresManagementDecision',true));$q$,
   $q$data:=data||jsonb_build_object('complaintWorkId',private.workspace_handover(prop,'cleaner-performance','Review guest complaint with cleaner','cleaning_complaint',jsonb_build_object('sourceWorkId',target,'cleanerId',w.assignee_id,'requiresManagementDecision',true,
      'report',d.data->'report','checklist',d.data->'checklist','photoIds',d.data->'photoIds','reviewNote',data->>'reviewNote','guestFeedback',data->>'guestFeedback','reviewedBy',auth.uid(),'cleanedOn',w.due_on)),
      'disputeDecision',null,'disputeNote',null,'disputeDecidedAt',null);$q$,
   $q$'complaintWorkId',private.workspace_handover($q$],
  -- A cleaner reports a problem found on the clean: a repair in triage for the Stays team, with optional photos.
  ['private.workspace_operations_action(jsonb)',
   $q$elsif kind='cleaning' and step='reviewCleaning' then$q$,
   $q$elsif kind='cleaning' and step='reportCleanProblem' then
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
   elsif kind='cleaning' and step='reviewCleaning' then$q$,
   $q$step='reportCleanProblem'$q$],
  -- The assigned cleaner may add photos of a problem to their clean.
  ['private.workspace_prepare_upload(jsonb)',
   $q$(purpose in ('cleaning','mailbox') and d.kind='cleaning' and w.assignee_id=auth.uid() and actor='cleans') or$q$,
   $q$(purpose in ('cleaning','mailbox') and d.kind='cleaning' and w.assignee_id=auth.uid() and actor='cleans') or
 (purpose='maintenance' and d.kind='cleaning' and w.assignee_id=auth.uid() and actor='cleans') or$q$,
   $q$(purpose='maintenance' and d.kind='cleaning'$q$],
  ['private.integration_commit_upload(uuid,jsonb)',
   $q$(i.purpose in ('cleaning','mailbox') and kind='cleaning' and w.assignee_id=i.owner_id and actor='cleans') or$q$,
   $q$(i.purpose in ('cleaning','mailbox') and kind='cleaning' and w.assignee_id=i.owner_id and actor='cleans') or
 (i.purpose='maintenance' and kind='cleaning' and w.assignee_id=i.owner_id and actor='cleans') or$q$,
   $q$(i.purpose='maintenance' and kind='cleaning'$q$],
  -- Disputes are decided by admins or the cleaning manager; pay rates are set by the same people.
  ['private.workspace_teams_action(jsonb)',
   $q$if a in ('decideComplaint','decideCleanerReview','saveCourse') then$q$,
   $q$if a='decideComplaint' then return private.workspace_decide_clean_dispute(input);end if;
 if a='setCleanerRate' then return private.workspace_cleaner_rate_action(input);end if;
 if a in ('decideComplaint','decideCleanerReview','saveCourse') then$q$,
   $q$workspace_decide_clean_dispute$q$],
  -- Guests per clean in the schedule; cleaner pay rates for Accounts and cleaning managers.
  ['private.workspace_teams_read(text,date,date,uuid,uuid)',
   $q$'stays',case when actor='cleans' then '[]'::jsonb else$q$,
   $q$'cleanGuests',private.workspace_clean_guests(start_on,end_on,target_property,target_user),'stays',case when actor='cleans' then '[]'::jsonb else$q$,
   $q$workspace_clean_guests$q$],
  ['private.workspace_teams_read(text,date,date,uuid,uuid)',
   $q$elsif section='performance' then$q$,
   $q$elsif section='cleanerRates' then result:=private.workspace_cleaner_rates_read();
 elsif section='performance' then$q$,
   $q$workspace_cleaner_rates_read$q$],
  -- A cleaner's month: their rate and the cleans it pays for (accepted, or overturned and not redone), and the
  -- disputes decided this month. The rate is shown to the cleaner, admins and cleaning managers only.
  ['private.workspace_cleaner_month(uuid,date)',
   $q$'openComplaints',(select$q$,
   $q$'rateMinor',case when private.workspace_actor_role() in ('admin','super_admin','cleaning_manager') or cleaner=auth.uid() then (select r.rate_minor from private.workspace_cleaner_rates r where r.cleaner_id=cleaner) end,
  'rateVersion',case when private.workspace_actor_role() in ('admin','super_admin','cleaning_manager') or cleaner=auth.uid() then coalesce((select r.version from private.workspace_cleaner_rates r where r.cleaner_id=cleaner),0) end,
  'paidCleans',(select count(*) from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where d.kind='cleaning_invoice' and d.data->>'cleanerId'=cleaner::text and w.status<>'cancelled' and w.created_at>=start_on and w.created_at<(start_on+interval '1 month')),
  'decidedComplaints',(select coalesce(jsonb_agg(jsonb_build_object('workId',w.id,'propertyId',w.property_id,'sourceWorkId',d.data->>'sourceWorkId','decision',d.data->>'decision','decisionNote',d.data->>'decisionNote','decidedAt',w.completed_at) order by w.completed_at desc),'[]')
    from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where d.kind='cleaning_complaint' and d.data->>'cleanerId'=cleaner::text and w.status='completed' and w.completed_at>=start_on and w.completed_at<(start_on+interval '1 month')),
  'openComplaints',(select$q$,
   $q$'decidedComplaints'$q$]
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

-- ================================================================================================
-- 20261009190000_management_oversight.sql
-- ================================================================================================
-- Management oversight: the business at a glance for admins, owners chased when an approval stalls
-- (a reminder after 48 hours, then client relations after 96), yesterday's unfinished Stays checks
-- rolled over for management, unusual owner payouts, and a history of every change and decision.

-- When a repair starts waiting for the owner's approval, wherever that happens (a new request
-- above the owner's limit, or a quote revised above it), so waits are measured from then.
create or replace function private.workspace_stamp_owner_approval() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.kind='maintenance' and new.data->>'phase'='owner_approval' and (tg_op='INSERT' or old.data->>'phase' is distinct from 'owner_approval') then
  new.data:=new.data||jsonb_build_object('ownerApprovalSince',now());
 end if;
 return new;
end $$;
drop trigger if exists owner_approval_stamped on private.workspace_domain_details;
create trigger owner_approval_stamped before insert or update of data on private.workspace_domain_details for each row execute function private.workspace_stamp_owner_approval();

-- Everything waiting on an owner: repairs at owner approval, and published estimates awaiting the
-- owner's decision. Older repairs without the stamp fall back to the revised quote or creation time.
create or replace function private.workspace_owner_waits() returns table(kind text,work_id uuid,property_id uuid,title text,waiting_since timestamptz,estimated_cost_minor bigint)
language sql stable security definer set search_path='' as $$
 select 'repair'::text,w.id,w.property_id,w.title,
  coalesce((d.data->>'ownerApprovalSince')::timestamptz,case when d.data->>'resumePhase' is not null then (d.data->>'quoteRevisedAt')::timestamptz end,w.created_at),
  (d.data->>'estimatedCostMinor')::bigint
 from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
 where d.kind='maintenance' and d.data->>'phase'='owner_approval' and w.status not in ('completed','cancelled','declined')
 union all
 select 'estimate'::text,j.work_id,j.property_id,'Estimate waiting for the owner’s decision',
  coalesce((select max(a.created_at) from public.workspace_activity a where a.property_id=j.property_id and a.event_type='journey.publishEstimate'),j.updated_at),null::bigint
 from private.workspace_journeys j join public.workspace_properties p on p.id=j.property_id where j.stage='estimate' and p.status<>'archived';
$$;

-- One row per wait (a repair that goes back to the owner later starts a new one), so each
-- reminder and escalation goes out once.
create table if not exists private.workspace_owner_chases (
 work_id uuid not null references public.workspace_work_items(id) on delete cascade,
 waiting_since timestamptz not null,
 kind text not null check(kind in ('repair','estimate')),
 reminded_at timestamptz,
 escalated_at timestamptz,
 escalated_to uuid[] not null default '{}',
 manual_at timestamptz,
 manual_by uuid references public.workspace_profiles(user_id),
 manual_count integer not null default 0,
 created_at timestamptz not null default now(),
 primary key(work_id,waiting_since)
);
alter table private.workspace_owner_chases enable row level security;
revoke all on private.workspace_owner_chases from public,anon,authenticated;

-- A notice to the property's owners that something is waiting for them.
create or replace function private.workspace_remind_owner(target uuid,waiting_kind text,prop uuid,at_time timestamptz) returns integer language plpgsql security definer set search_path='' as $$
declare ev bigint;sent integer;begin
 insert into public.workspace_activity(actor_id,property_id,work_id,event_type,created_at)
  values(auth.uid(),prop,target,case waiting_kind when 'repair' then 'repairs.owner_reminder' else 'journey.estimate_reminder' end,at_time) returning id into ev;
 insert into private.workspace_notification_outbox(user_id,work_id,event_id)
  select a.user_id,target,ev from public.workspace_property_assignments a join public.workspace_profiles u on u.user_id=a.user_id
  where a.property_id=prop and a.assignment='client' and u.status='active' on conflict do nothing;
 get diagnostics sent=row_count;
 return sent;
end $$;

-- Who chases an owner: client relations on the property, else anyone in client relations, else admins.
create or replace function private.workspace_owner_chasers(prop uuid) returns uuid[] language sql stable security definer set search_path='' as $$
 select coalesce(
  nullif(array(select r.user_id from private.workspace_staff_rota r join public.workspace_profiles p on p.user_id=r.user_id
    join public.workspace_property_assignments a on a.user_id=r.user_id and a.property_id=prop and a.assignment='staff'
    where r.department='client_relations' and p.status='active' and p.role<>'client' order by r.user_id),'{}'),
  nullif(array(select r.user_id from private.workspace_staff_rota r join public.workspace_profiles p on p.user_id=r.user_id
    where r.department='client_relations' and p.status='active' and p.role<>'client' order by r.user_id),'{}'),
  array(select p.user_id from public.workspace_profiles p where p.role in ('admin','super_admin') and p.status='active' order by p.user_id));
$$;

-- Run by the backend every 15 minutes: owners get one reminder once something has waited 48 hours,
-- and client relations are told once it has waited 96. Bounded per run; the next run carries on.
create or replace function private.workspace_chase_owner_approvals(at_time timestamptz default now()) returns jsonb language plpgsql security definer set search_path='' as $$
declare r record;ev bigint;who uuid[];reminded integer:=0;escalated integer:=0;begin
 perform pg_advisory_xact_lock(hashtext('workspace_chase_owner_approvals'));
 for r in select o.kind wait_kind,o.work_id,o.property_id,o.waiting_since,x.reminded_at,x.escalated_at from private.workspace_owner_waits() o
   left join private.workspace_owner_chases x on x.work_id=o.work_id and x.waiting_since=o.waiting_since
   where o.waiting_since<=at_time-interval '48 hours' and (x.reminded_at is null or (x.escalated_at is null and o.waiting_since<=at_time-interval '96 hours'))
   order by o.waiting_since,o.work_id limit 50 loop
  insert into private.workspace_owner_chases(work_id,waiting_since,kind) values(r.work_id,r.waiting_since,r.wait_kind) on conflict do nothing;
  if r.reminded_at is null then
   perform private.workspace_remind_owner(r.work_id,r.wait_kind,r.property_id,at_time);
   update private.workspace_owner_chases set reminded_at=at_time where work_id=r.work_id and waiting_since=r.waiting_since;
   reminded:=reminded+1;
  end if;
  if r.escalated_at is null and r.waiting_since<=at_time-interval '96 hours' then
   who:=private.workspace_owner_chasers(r.property_id);
   -- Tied to the property, not the item, so client relations see it even without the repair tool.
   insert into public.workspace_activity(property_id,event_type,created_at)
    values(r.property_id,case r.wait_kind when 'repair' then 'repairs.owner_escalated' else 'journey.estimate_escalated' end,at_time) returning id into ev;
   insert into private.workspace_notification_outbox(user_id,event_id) select distinct u,ev from unnest(who) u on conflict do nothing;
   update private.workspace_owner_chases set escalated_at=at_time,escalated_to=who where work_id=r.work_id and waiting_since=r.waiting_since;
   escalated:=escalated+1;
  end if;
 end loop;
 return jsonb_build_object('reminded',reminded,'escalated',escalated);
end $$;
create or replace function public.workspace_chase_owner_approvals() returns jsonb language sql security invoker set search_path='' as $$ select private.workspace_chase_owner_approvals() $$;

-- The management queue's owner approvals: how long each has waited and when the owner was last reminded.
create or replace function private.workspace_stalled_owner_approvals() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('workId',o.work_id,'kind',o.kind,'title',o.title,'propertyId',o.property_id,'propertyName',p.name,
   'estimatedCostMinor',o.estimated_cost_minor,'waitingSince',o.waiting_since,'remindedAt',greatest(x.reminded_at,x.manual_at),'escalatedAt',x.escalated_at,
   'canRemindAt',greatest(x.reminded_at,x.manual_at)+interval '24 hours') order by o.waiting_since,o.work_id),'[]')
 from private.workspace_owner_waits() o join public.workspace_properties p on p.id=o.property_id
 left join private.workspace_owner_chases x on x.work_id=o.work_id and x.waiting_since=o.waiting_since
 where o.waiting_since<now()-interval '48 hours';
$$;

-- Unusual owner payouts: statements not yet paid whose payout is negative, or more than 50% below
-- or above the property's average over its previous three statements. Hidden once management
-- approves that payout.
create table if not exists private.workspace_payout_approvals (
 statement_id uuid not null references private.workspace_owner_statements(id) on delete cascade,
 payout_minor bigint not null,
 approved_by uuid not null references public.workspace_profiles(user_id),
 approved_at timestamptz not null default now(),
 note text not null default '' check(length(note)<=2000),
 primary key(statement_id,payout_minor)
);
alter table private.workspace_payout_approvals enable row level security;
revoke all on private.workspace_payout_approvals from public,anon,authenticated;

create or replace function private.workspace_unusual_payouts() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(private.workspace_statement_view(x.s)||jsonb_build_object('averageMinor',x.average_minor,'previousStatements',x.previous,'reason',x.reason)
   order by (x.s).period_start,(x.s).id),'[]')
 from (
  select s,prev.average_minor,prev.previous,
   case when s.payout_minor<0 then 'negative'
    when prev.average_minor>0 and s.payout_minor<prev.average_minor*0.5 then 'low'
    when prev.average_minor>0 and s.payout_minor>prev.average_minor*1.5 then 'high' end reason
  from private.workspace_owner_statements s
  cross join lateral (select round(avg(t.payout_minor))::bigint average_minor,count(*)::integer previous from (
    select q.payout_minor from private.workspace_owner_statements q where q.property_id=s.property_id and q.status<>'void' and q.period_start<s.period_start
    order by q.period_start desc limit 3) t) prev
  where s.status in ('draft','issued') and not exists(select 1 from private.workspace_payout_approvals a where a.statement_id=s.id and a.payout_minor=s.payout_minor)
 ) x where x.reason is not null;
$$;

-- Yesterday's Stays checks: each morning after 08:00 (London), anyone on the Stays team who worked a
-- guest or client relations shift yesterday but didn't sign off, or whose listing checks weren't
-- done, rolls over to management until an admin marks it as seen.
create table if not exists private.workspace_missed_days (
 user_id uuid not null references public.workspace_profiles(user_id) on delete cascade,
 day date not null,
 signed_off boolean not null,
 listings_due integer not null default 0,
 missed_listings jsonb not null default '[]',
 created_at timestamptz not null default now(),
 seen_at timestamptz,
 seen_by uuid references public.workspace_profiles(user_id),
 primary key(user_id,day)
);
create table if not exists private.workspace_rollover_runs (
 day date primary key,
 missed integer not null,
 ran_at timestamptz not null default now()
);
alter table private.workspace_missed_days enable row level security;
alter table private.workspace_rollover_runs enable row level security;
revoke all on private.workspace_missed_days,private.workspace_rollover_runs from public,anon,authenticated;

create or replace function private.workspace_roll_over_signoffs(at_time timestamptz default now()) returns jsonb language plpgsql security definer set search_path='' as $$
declare today date:=(at_time at time zone 'Europe/London')::date;yesterday date:=today-1;person record;missed jsonb;due integer;signed boolean;n integer:=0;ev bigint;begin
 if extract(hour from at_time at time zone 'Europe/London')<8 then return jsonb_build_object('day',yesterday,'ran',false);end if;
 perform pg_advisory_xact_lock(hashtext('workspace_roll_over_signoffs'));
 if exists(select 1 from private.workspace_rollover_runs where day=yesterday) then return jsonb_build_object('day',yesterday,'ran',false);end if;
 for person in select p.user_id from public.workspace_profiles p where p.role='stays' and p.status='active'
   and exists(select 1 from private.workspace_shifts s where s.user_id=p.user_id and s.department in ('guest_relations','client_relations') and (s.clocked_in_at at time zone 'Europe/London')::date=yesterday)
   order by p.user_id limit 500 loop
  signed:=exists(select 1 from private.workspace_daily_signoffs o where o.user_id=person.user_id and o.day=yesterday);
  -- Their live properties (with the listing health tool), and those with no listing check dated yesterday.
  due:=(select count(*) from public.workspace_properties pr where pr.status='active'
    and exists(select 1 from public.workspace_property_assignments a where a.property_id=pr.id and a.user_id=person.user_id and a.assignment='staff')
    and exists(select 1 from public.workspace_module_grants g where g.user_id=person.user_id and g.module_id='listing-health'));
  missed:=coalesce((select jsonb_agg(jsonb_build_object('propertyId',pr.id,'propertyName',pr.name) order by pr.name,pr.id) from public.workspace_properties pr where pr.status='active'
    and exists(select 1 from public.workspace_property_assignments a where a.property_id=pr.id and a.user_id=person.user_id and a.assignment='staff')
    and exists(select 1 from public.workspace_module_grants g where g.user_id=person.user_id and g.module_id='listing-health')
    and not exists(select 1 from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
     where w.property_id=pr.id and d.kind='listing_health' and d.data->>'checkedOn'=to_char(yesterday,'YYYY-MM-DD'))),'[]');
  if not signed or jsonb_array_length(missed)>0 then
   insert into private.workspace_missed_days(user_id,day,signed_off,listings_due,missed_listings) values(person.user_id,yesterday,signed,due,missed) on conflict do nothing;
   n:=n+1;
  end if;
 end loop;
 insert into private.workspace_rollover_runs(day,missed) values(yesterday,n);
 if n>0 then
  insert into public.workspace_activity(event_type,created_at) values('stays.missed_yesterday',at_time) returning id into ev;
  insert into private.workspace_notification_outbox(user_id,event_id) select p.user_id,ev from public.workspace_profiles p where p.role in ('admin','super_admin') and p.status='active' on conflict do nothing;
 end if;
 return jsonb_build_object('day',yesterday,'ran',true,'missed',n);
end $$;
create or replace function public.workspace_roll_over_signoffs() returns jsonb language sql security invoker set search_path='' as $$ select private.workspace_roll_over_signoffs() $$;

create or replace function private.workspace_missed_days_json() returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('userId',m.user_id,'fullName',p.full_name,'day',m.day,'signedOff',m.signed_off,'listingsDue',m.listings_due,
   'missedListings',m.missed_listings,'createdAt',m.created_at) order by m.day desc,p.full_name,m.user_id),'[]')
 from private.workspace_missed_days m join public.workspace_profiles p on p.user_id=m.user_id
 where m.seen_at is null and m.day>=(now() at time zone 'Europe/London')::date-14;
$$;

-- People's own writes count towards the usual per-minute limit.
do $$
declare t text;begin
 foreach t in array array['workspace_owner_chases','workspace_payout_approvals','workspace_missed_days'] loop
  execute format('drop trigger if exists business_write_limit on private.%I',t);
  execute format('create trigger business_write_limit before insert or update on private.%I for each row execute function private.workspace_enforce_write_limit()',t);
 end loop;
end $$;

-- Across the business, for admins' Home: Stays, Cleans, Ready and Accounts at a glance.
create or replace function private.workspace_management_overview() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();today date:=(now() at time zone 'Europe/London')::date;month_start date;month_end date;begin
 if coalesce(actor,'') not in ('admin','super_admin') then raise exception 'Management access required' using errcode='42501';end if;
 month_start:=date_trunc('month',today)::date;month_end:=(month_start+interval '1 month')::date;
 return jsonb_build_object('today',today,
  'stays',jsonb_build_object(
   'listingsToCheck',(select count(*) from public.workspace_properties p where p.status='active' and not exists(select 1 from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
     where w.property_id=p.id and d.kind='listing_health' and d.data->>'checkedOn'=to_char(today,'YYYY-MM-DD'))),
   'relistingsOpen',(select count(*) from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where d.kind='relisting' and w.status not in ('completed','cancelled')),
   'emptyNights',(select count(*) from public.workspace_properties p cross join generate_series(today::timestamp,(today+6)::timestamp,interval '1 day') n where p.status='active'
     and not exists(select 1 from private.workspace_reservations r where r.property_id=p.id and r.status='confirmed' and r.check_in<=n::date and r.check_out>n::date)
     and not exists(select 1 from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where w.property_id=p.id and d.kind='daily_pricing' and d.data->>'night'=to_char(n,'YYYY-MM-DD'))),
   'guestsWaiting',case when private.has_workspace_module('guest-communication') then (select count(*) from private.workspace_guest_threads t where t.status='open' and (private.guest_thread_json(t)->>'waitingSince') is not null) end),
  'cleans',(select jsonb_build_object(
   'today',count(*) filter(where d.kind='cleaning' and w.due_on=today and w.status not in ('cancelled','declined')),
   'doneToday',count(*) filter(where d.kind='cleaning' and w.due_on=today and w.status='completed'),
   'unassignedToday',count(*) filter(where d.kind='cleaning' and w.due_on=today and w.assignee_id is null and w.status not in ('completed','cancelled','declined')),
   'toReview',count(*) filter(where d.kind='cleaning' and d.data->>'phase'='review' and w.status not in ('completed','cancelled')),
   'disputes',count(*) filter(where d.kind='cleaning_complaint' and w.status not in ('completed','cancelled')))
   from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where d.kind in ('cleaning','cleaning_complaint')),
  'ready',(select jsonb_build_object(
   'ownerApproval',count(*) filter(where d.kind='maintenance' and d.data->>'phase'='owner_approval'),
   'toRefer',count(*) filter(where d.kind='maintenance' and d.data->>'phase'='triage'),
   'referred',count(*) filter(where d.kind='maintenance' and d.data->>'phase'='referred'),
   'booked',count(*) filter(where d.kind='maintenance' and d.data->>'phase'='booked'),
   'visitsDue',count(*) filter(where d.kind='routine_visit' and w.due_on>=month_start and w.due_on<month_end))
   from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where d.kind in ('maintenance','routine_visit') and w.status not in ('completed','cancelled','declined')),
  'accounts',jsonb_build_object(
   'expensesToApprove',(select count(*) from private.workspace_expenses x where x.status='to_approve'),
   'overLimit',(select count(*) from private.workspace_expenses x,private.workspace_finance_policy f where x.status='to_approve' and f.expense_approval_limit_minor is not null and x.amount_minor>f.expense_approval_limit_minor),
   'payoutsToReconcile',(select count(*) from private.workspace_reservations r where r.status='confirmed' and r.channel in ('airbnb','booking_com') and r.check_in>=month_start and r.check_in<month_end
     and private.workspace_payout_row(r)->>'settledMinor' is null),
   'statementsToIssue',(select count(*) from private.workspace_owner_statements s where s.status='draft')));
end $$;

-- One work item's history: status changes with their notes, each step taken (with what was
-- recorded for it), clean reviews, expense decisions and owner chases. Same access as the item.
create or replace function private.workspace_work_history(target uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();d private.workspace_domain_details;staff boolean;begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 if target is null or not private.workspace_operation_access(target) then raise exception 'Work not found' using errcode='P0002';end if;
 d:=(select x from private.workspace_domain_details x where x.work_id=target);
 staff:=actor not in ('client','cleans');
 return jsonb_build_object('kind',d.kind,'entries',coalesce((select jsonb_agg(h.e order by h.happened,h.n) from (
  select u.created_at happened,1 n,jsonb_build_object('type','status','at',u.created_at,'by',p.full_name,'from',u.previous_status,'to',u.next_status,'note',nullif(u.note,'')) e
   from public.workspace_work_updates u left join public.workspace_profiles p on p.user_id=u.actor_id where u.work_id=target
  union all
  select a.created_at,2,jsonb_build_object('type','event','at',a.created_at,'by',p.full_name,'event',a.event_type,
    'note',nullif(case a.event_type
     when 'operations.createOperation' then coalesce(d.data->>'issue',d.data->>'evidence',d.data->>'reason',d.data->>'requirements',d.data->>'summary')
     when 'operations.updateOperation.referReady' then case when staff then d.data->>'troubleshooting' else d.data->>'guestUpdate' end
     when 'operations.updateOperation.bookRepair' then concat_ws(' · ',d.data->>'contractor',d.data->>'repairOn')
     when 'operations.updateOperation.completeRepair' then d.data->>'report'
     when 'operations.updateOperation.reviseQuote' then d.data->>'quoteReason'
     when 'operations.updateOperation.startRelisting' then d.data->>'note'
     when 'operations.updateOperation.recordApplied' then d.data->>'evidence'
     when 'operations.updateOperation.completeHandover' then d.data->>'evidence'
     when 'operations.updateOperation.recordGuestDecline' then d.data->>'reason'
     when 'operations.updateOperation.recordGuestAcceptance' then case when staff then d.data->>'guestEvidence' end
     when 'operations.updateOperation.approvePurchase' then d.data->>'approvalNote'
     when 'operations.updateOperation.recordOrder' then concat_ws(' · ',d.data->>'supplier',d.data->>'orderReference')
     when 'operations.updateOperation.recordDelivery' then d.data->>'evidence'
     when 'operations.updateOperation.reconcilePurchase' then d.data->>'reconciliation'
     when 'operations.updateOperation.submitApplication' then concat_ws(' · ',d.data->>'authority',d.data->>'applicationReference')
     when 'operations.updateOperation.recordSafetyChecks' then d.data->>'evidence'
     when 'operations.updateOperation.recordGranted' then d.data->>'evidence'
     when 'operations.updateOperation.submitCleaning' then d.data->>'report'
     when 'cleaning.cleaner_responded' then d.data->>'cleanerStatement'
    end,''),
    'evidence',case a.event_type
     when 'operations.updateOperation.submitCleaning' then jsonb_array_length(coalesce(d.data->'photoIds','[]'))||' photos'
     when 'operations.updateOperation.recordDelivery' then jsonb_array_length(coalesce(d.data->'photoIds','[]'))||' delivery photos'
     when 'operations.updateOperation.approveBudget' then 'Owner’s consent recorded'
     when 'operations.updateOperation.recordSafetyChecks' then 'Safety checklist complete'
     when 'operations.updateOperation.recordGranted' then 'Licence '||coalesce(d.data->>'reference','')
     when 'operations.updateOperation.reconcilePurchase' then 'Paid invoice matched'
     when 'operations.updateOperation.confirmBooking' then 'Paid booking invoice matched'
     when 'operations.updateOperation.referReady' then case when staff and d.data->>'warrantyContactEvidence' is not null then 'Warranty contacted' end
    end)
   from public.workspace_activity a left join public.workspace_profiles p on p.user_id=a.actor_id
   where a.work_id=target and a.event_type not in ('workspace_work_items.update','operations.updateOperation.reviewCleaning')
  union all
  select r.created_at,3,jsonb_build_object('type','review','at',r.created_at,'by',p.full_name,'accepted',r.accepted,'note',r.review_note,'guestFeedback',r.guest_feedback)
   from private.workspace_cleaning_reviews r left join public.workspace_profiles p on p.user_id=r.reviewer_id where r.work_id=target and actor<>'client'
  union all
  select r.overturned_at,4,jsonb_build_object('type','overturned','at',r.overturned_at,'by',p.full_name,'note',r.overturn_note)
   from private.workspace_cleaning_reviews r left join public.workspace_profiles p on p.user_id=r.overturned_by where r.work_id=target and r.overturned_at is not null and actor<>'client'
  union all
  select x.decided_at,5,jsonb_build_object('type','expense','at',x.decided_at,'by',p.full_name,'status',x.status,'note',x.decision_note,'amountMinor',x.amount_minor,'supplier',x.supplier)
   from private.workspace_expenses x left join public.workspace_profiles p on p.user_id=x.decided_by where x.work_id=target and x.decided_at is not null and actor in ('admin','super_admin','accounts')
  union all
  select c.escalated_at,6,jsonb_build_object('type','escalated','at',c.escalated_at,'to',(select string_agg(p.full_name,', ' order by p.full_name) from public.workspace_profiles p where p.user_id=any(c.escalated_to)))
   from private.workspace_owner_chases c where c.work_id=target and c.escalated_at is not null and staff
  order by 1,2 limit 300) h),'[]'));
end $$;

-- Management decisions over the last 90 days, newest first: repairs the owner approved, work
-- approved or declined, expenses decided, clean disputes, cleaner reviews and payouts approved.
create or replace function private.workspace_decisions_report() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare since timestamptz:=now()-interval '90 days';begin
 if coalesce(private.workspace_actor_role(),'') not in ('admin','super_admin') then raise exception 'Management access required' using errcode='42501';end if;
 return coalesce((select jsonb_agg(r.e order by r.happened desc) from (
  select (d.data->>'ownerApprovedAt')::timestamptz happened,jsonb_build_object('at',d.data->>'ownerApprovedAt','area','repairs','decision','Repair approved by the owner','outcome','approved',
    'title',w.title,'propertyName',pr.name,'amountMinor',(d.data->>'estimatedCostMinor')::bigint,'by',p.full_name,'note',null) e
   from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id join public.workspace_properties pr on pr.id=w.property_id
   left join public.workspace_profiles p on p.user_id::text=d.data->>'ownerApprovedBy'
   where d.kind='maintenance' and (d.data->>'ownerApprovedAt')::timestamptz>=since
  union all
  select u.created_at,jsonb_build_object('at',u.created_at,'area','work','decision',case u.next_status when 'approved' then 'Work approved' else 'Work declined' end,'outcome',u.next_status,
    'title',w.title,'propertyName',pr.name,'amountMinor',null,'by',p.full_name,'note',nullif(u.note,''))
   from public.workspace_work_updates u join public.workspace_work_items w on w.id=u.work_id join public.workspace_properties pr on pr.id=w.property_id
   left join public.workspace_profiles p on p.user_id=u.actor_id
   where u.next_status in ('approved','declined') and u.created_at>=since
  union all
  select x.decided_at,jsonb_build_object('at',x.decided_at,'area','accounts','decision',case x.status when 'approved' then 'Expense approved' else 'Expense rejected' end,'outcome',x.status,
    'title',x.supplier||' · '||x.reference,'propertyName',pr.name,'amountMinor',x.amount_minor,'by',p.full_name,'note',x.decision_note)
   from private.workspace_expenses x join public.workspace_properties pr on pr.id=x.property_id left join public.workspace_profiles p on p.user_id=x.decided_by
   where x.status in ('approved','rejected') and x.decided_at>=since
  union all
  select (d.data->>'decidedAt')::timestamptz,jsonb_build_object('at',d.data->>'decidedAt','area','cleans',
    'decision',case d.kind when 'cleaning_complaint' then 'Clean dispute' else 'Cleaner review' end,'outcome',d.data->>'decision',
    'title',coalesce(c.full_name,'Cleaner'),'propertyName',pr.name,'amountMinor',null,'by',p.full_name,'note',d.data->>'decisionNote')
   from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id join public.workspace_properties pr on pr.id=w.property_id
   left join public.workspace_profiles p on p.user_id::text=d.data->>'decidedBy' left join public.workspace_profiles c on c.user_id::text=d.data->>'cleanerId'
   where d.kind in ('cleaning_complaint','cleaner_management_review') and (d.data->>'decidedAt')::timestamptz>=since
  union all
  select a.approved_at,jsonb_build_object('at',a.approved_at,'area','accounts','decision','Owner payout approved','outcome','approved',
    'title',to_char(s.period_start,'YYYY-MM')||' statement','propertyName',pr.name,'amountMinor',a.payout_minor,'by',p.full_name,'note',nullif(a.note,''))
   from private.workspace_payout_approvals a join private.workspace_owner_statements s on s.id=a.statement_id join public.workspace_properties pr on pr.id=s.property_id
   left join public.workspace_profiles p on p.user_id=a.approved_by where a.approved_at>=since
  order by 1 desc limit 1000) r),'[]');
end $$;

-- Reads for the oversight screens.
create or replace function private.workspace_oversight_read(section text,target uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if private.workspace_actor_role() is null then raise exception 'Active access required' using errcode='42501';end if;
 if section='overview' then return private.workspace_management_overview();
 elsif section='history' then return private.workspace_work_history(target);
 elsif section='decisions' then return private.workspace_decisions_report();
 end if;
 raise exception 'Unknown oversight section' using errcode='22023';
end $$;

-- Management's own actions: remind an owner now (once a day per item), mark a missed day as seen,
-- and approve an unusual owner payout.
create or replace function private.workspace_oversight_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();a text;req uuid;prior private.workspace_action_receipts;result jsonb;target uuid;
 wait_kind text;wait_since timestamptz;wait_property uuid;last_reminder timestamptz;sent integer;s private.workspace_owner_statements;begin
 if coalesce(actor,'') not in ('admin','super_admin') then raise exception 'Management access required' using errcode='42501';end if;
 a:=private.workspace_required_text(input,'action',1,40);req:=(input->>'requestId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 prior:=(select x from private.workspace_action_receipts x where x.actor_id=auth.uid() and x.request_id=req);
 if prior.request_id is not null then
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;
 if a='remindOwner' then
  perform private.workspace_json_keys(input,array['action','requestId','workId']);
  target:=(input->>'workId')::uuid;
  wait_since:=(select o.waiting_since from private.workspace_owner_waits() o where o.work_id=target limit 1);
  if wait_since is null then raise exception 'Nothing on this item is waiting for the owner' using errcode='22023';end if;
  wait_kind:=(select o.kind from private.workspace_owner_waits() o where o.work_id=target limit 1);
  wait_property:=(select w.property_id from public.workspace_work_items w where w.id=target);
  last_reminder:=(select greatest(c.reminded_at,c.manual_at) from private.workspace_owner_chases c where c.work_id=target and c.waiting_since=wait_since);
  if last_reminder>now()-interval '24 hours' then raise exception 'The owner was reminded in the last 24 hours. You can remind them again tomorrow.' using errcode='22023';end if;
  if not exists(select 1 from public.workspace_property_assignments pa join public.workspace_profiles u on u.user_id=pa.user_id where pa.property_id=wait_property and pa.assignment='client' and u.status='active') then
   raise exception 'This property has no owner to remind' using errcode='22023';end if;
  -- A reminder sent by hand counts as the 48-hour one, so the owner isn't sent two.
  insert into private.workspace_owner_chases(work_id,waiting_since,kind,reminded_at,manual_at,manual_by,manual_count) values(target,wait_since,wait_kind,now(),now(),auth.uid(),1)
   on conflict(work_id,waiting_since) do update set reminded_at=coalesce(workspace_owner_chases.reminded_at,excluded.reminded_at),manual_at=excluded.manual_at,manual_by=excluded.manual_by,manual_count=workspace_owner_chases.manual_count+1;
  sent:=private.workspace_remind_owner(target,wait_kind,wait_property,now());
  result:=jsonb_build_object('workId',target,'remindedAt',now(),'owners',sent);
 elsif a='markMissedSeen' then
  perform private.workspace_json_keys(input,array['action','requestId','userId','day']);
  update private.workspace_missed_days set seen_at=now(),seen_by=auth.uid() where user_id=(input->>'userId')::uuid and day=(input->>'day')::date and seen_at is null;
  if not found then raise exception 'Already marked as seen' using errcode='P0002';end if;
  result:=jsonb_build_object('userId',input->>'userId','day',input->>'day','seen',true);
 elsif a='approvePayout' then
  perform private.workspace_json_keys(input,array['action','requestId','statementId','version','note']);
  if length(coalesce(input->>'note',''))>2000 then raise exception 'Note is too long' using errcode='22023';end if;
  s:=(select x from private.workspace_owner_statements x where x.id=(input->>'statementId')::uuid);
  if s.id is null then raise exception 'Statement not found' using errcode='P0002';end if;
  if s.version is distinct from (input->>'version')::integer then raise exception 'Statement changed' using errcode='40001';end if;
  if s.status not in ('draft','issued') then raise exception 'Only a statement not yet paid can be approved' using errcode='22023';end if;
  insert into private.workspace_payout_approvals(statement_id,payout_minor,approved_by,note) values(s.id,s.payout_minor,auth.uid(),trim(coalesce(input->>'note',''))) on conflict do nothing;
  insert into public.workspace_activity(actor_id,property_id,event_type) values(auth.uid(),s.property_id,'finance.payout_approved');
  result:=jsonb_build_object('statementId',s.id,'payoutMinor',s.payout_minor,'approved',true);
 else raise exception 'Unknown oversight action' using errcode='22023';end if;
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $$;

create or replace function public.workspace_oversight_read(section text,target uuid default null) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_oversight_read(section,target);$$;
create or replace function public.workspace_oversight_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_oversight_action(input);$$;

revoke all on function private.workspace_stamp_owner_approval(),private.workspace_owner_waits(),private.workspace_remind_owner(uuid,text,uuid,timestamptz),
 private.workspace_owner_chasers(uuid),private.workspace_stalled_owner_approvals(),private.workspace_unusual_payouts(),private.workspace_missed_days_json(),
 private.workspace_management_overview(),private.workspace_work_history(uuid),private.workspace_decisions_report() from public,anon,authenticated;
revoke all on function private.workspace_chase_owner_approvals(timestamptz),public.workspace_chase_owner_approvals(),
 private.workspace_roll_over_signoffs(timestamptz),public.workspace_roll_over_signoffs() from public,anon,authenticated;
grant execute on function private.workspace_chase_owner_approvals(timestamptz),public.workspace_chase_owner_approvals(),
 private.workspace_roll_over_signoffs(timestamptz),public.workspace_roll_over_signoffs() to service_role;
revoke all on function private.workspace_oversight_read(text,uuid),private.workspace_oversight_action(jsonb),
 public.workspace_oversight_read(text,uuid),public.workspace_oversight_action(jsonb) from public,anon;
grant execute on function private.workspace_oversight_read(text,uuid),private.workspace_oversight_action(jsonb),
 public.workspace_oversight_read(text,uuid),public.workspace_oversight_action(jsonb) to authenticated;

-- The management queue gains unusual payouts and missed days, and measures owner approvals from
-- when they started waiting (the later key replaces the earlier one in the object).
do $$
declare
 fixes constant text[][] := array[
  ['private.workspace_teams_read(text,date,date,uuid,uuid)',
   $q$'ownerBalancesDue',(select coalesce(jsonb_agg(private.workspace_statement_view(s) order by s.period_start),'[]') from private.workspace_owner_statements s where s.status in ('draft','issued') and s.payout_minor<0)$q$,
   $q$'ownerBalancesDue',(select coalesce(jsonb_agg(private.workspace_statement_view(s) order by s.period_start),'[]') from private.workspace_owner_statements s where s.status in ('draft','issued') and s.payout_minor<0),
   'stalledOwnerApprovals',private.workspace_stalled_owner_approvals(),'unusualPayouts',private.workspace_unusual_payouts(),'missedYesterday',private.workspace_missed_days_json()$q$,
   $q$workspace_unusual_payouts$q$]
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

-- ================================================================================================
-- 20261009200000_accounts_ready.sql
-- ================================================================================================
-- Accounts and the Ready team, from the client's feedback:
--  * Expense paperwork: Accounts attach photos or scans of the supplier invoice (and before and
--    after photos) to an expense through the existing private photo store, link an expense to the
--    finished repair or purchase it pays for, and see the repair's own photos once linked.
--  * A completed repair becomes a draft expense for Accounts straight away (contractor, actual
--    cost, the completion report and the repair's photos). The "Reconcile completed property
--    repair" task is still created as before; other screens and the owner invoice depend on it.
--  * A repair is marked paid when its expense is approved, its invoice is paid or its invoice task
--    is closed, so Ready can follow a repair from the Stays report to payment.
--  * Purchases: Accounts record the supplier's invoice against a delivered purchase and mark it
--    paid, so "Reconcile the delivered purchase" can close it.
--  * Stays working a direct booking can see (and pick) that booking's invoice, without gaining
--    owner statements.
--  * Ready can read the owner's access instructions for the properties they look after.
--  * Ready Home: repairs by stage and this month's routine visits per property.
--  * Routine visits are created automatically for this month and next, and the person doing a
--    visit is reminded three days before it is due (once).
-- Safe to run more than once.

-- 1. New values in existing checks, added to whatever the checks hold now.
do $$
declare
 adds constant text[][] := array[
  ['private.workspace_expenses','workspace_expenses_status_check','draft'],
  ['private.workspace_expenses','workspace_expenses_source_check','repair'],
  ['private.workspace_media_evidence','workspace_media_evidence_purpose_check','expense'],
  ['private.workspace_upload_intents','workspace_upload_intents_purpose_check','expense']
 ];
 def text;
begin
 for i in 1..array_length(adds,1) loop
  def:=(select pg_get_constraintdef(c.oid) from pg_constraint c where c.conrelid=adds[i][1]::regclass and c.conname=adds[i][2]);
  if def is null or position('ARRAY[' in def)=0 then raise exception 'Check % is missing', adds[i][2]; end if;
  if position(quote_literal(adds[i][3]) in def)=0 then
   execute format('alter table %s drop constraint %I',adds[i][1],adds[i][2]);
   execute format('alter table %s add constraint %I %s',adds[i][1],adds[i][2],replace(def,'ARRAY[','ARRAY['||quote_literal(adds[i][3])||'::text, '));
  end if;
 end loop;
end $$;

-- 2. Photos can belong to an expense instead of a work item (an invoice for utilities has no job).
alter table private.workspace_media_evidence alter column work_id drop not null;
alter table private.workspace_media_evidence add column if not exists expense_id uuid references private.workspace_expenses(id);
alter table private.workspace_upload_intents alter column work_id drop not null;
alter table private.workspace_upload_intents add column if not exists expense_id uuid references private.workspace_expenses(id);
do $$ begin
 if not exists(select 1 from pg_constraint where conname='workspace_media_evidence_target_check') then
  alter table private.workspace_media_evidence add constraint workspace_media_evidence_target_check check(work_id is not null or expense_id is not null);
 end if;
 if not exists(select 1 from pg_constraint where conname='workspace_upload_intents_target_check') then
  alter table private.workspace_upload_intents add constraint workspace_upload_intents_target_check check((work_id is null)<>(expense_id is null));
 end if;
end $$;
create index if not exists workspace_media_evidence_expense_idx on private.workspace_media_evidence(expense_id);
create index if not exists workspace_upload_intents_expense_idx on private.workspace_upload_intents(expense_id);

-- 3. Expense paperwork uploads. Accounts and management add them: to an expense still being
-- decided, or to a delivered purchase waiting for its supplier invoice. Returns the property, or
-- null when not allowed. The subject is passed in, because the upload is committed by the server.
create or replace function private.workspace_expense_upload_property(subject uuid, target_expense uuid, target_work uuid) returns uuid
language sql stable security definer set search_path='' as $$
 select coalesce(
  (select x.property_id from private.workspace_expenses x join public.workspace_profiles p on p.user_id=subject and p.status='active'
    where target_work is null and x.id=target_expense and x.status in ('draft','to_approve','queried')
    and (p.role in ('admin','super_admin') or (p.role='accounts' and exists(select 1 from public.workspace_module_grants g where g.user_id=subject and g.module_id='maintenance-reconciliation')))),
  (select w.property_id from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id join public.workspace_profiles p on p.user_id=subject and p.status='active'
    where target_expense is null and w.id=target_work and d.kind='purchase' and d.data->>'phase'='delivered' and w.status not in ('completed','cancelled')
    and (p.role in ('admin','super_admin') or (p.role='accounts' and exists(select 1 from public.workspace_module_grants g where g.user_id=subject and g.module_id='purchase-order-accounts')))));
$$;

create or replace function private.workspace_prepare_expense_upload(input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare intent private.workspace_upload_intents;target_expense uuid;target_work uuid;nonce uuid;
begin
 perform private.workspace_json_keys(input,array['requestId','workId','expenseId','purpose','contentHash']);
 target_expense:=(input->>'expenseId')::uuid;target_work:=(input->>'workId')::uuid;
 if private.workspace_actor_role() is null or input->>'purpose' is distinct from 'expense' or (target_expense is null)=(target_work is null) then raise exception 'Upload access denied' using errcode='42501';end if;
 if private.workspace_expense_upload_property(auth.uid(),target_expense,target_work) is null then raise exception 'Upload purpose or work stage denied' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||(input->>'requestId'),9));
 intent:=(select i from private.workspace_upload_intents i where i.owner_id=auth.uid() and i.request_id=(input->>'requestId')::uuid);
 if intent.id is not null then
  if intent.work_id is distinct from target_work or intent.expense_id is distinct from target_expense or intent.purpose<>'expense' or intent.content_hash<>input->>'contentHash' then raise exception 'Request identifier already used' using errcode='22023';end if;
  if intent.evidence_id is null and intent.expires_at<now() then raise exception 'Upload request expired' using errcode='22023';end if;
 else
  nonce:=gen_random_uuid();
  insert into private.workspace_upload_intents(id,owner_id,request_id,work_id,expense_id,purpose,content_hash,public_id)
   values(nonce,auth.uid(),(input->>'requestId')::uuid,target_work,target_expense,'expense',input->>'contentHash','recharge/'||nonce::text) returning * into intent;
 end if;
 return jsonb_build_object('id',intent.id,'publicId',intent.public_id,'evidenceId',intent.evidence_id);
end $$;

-- Committed by the server once the photo is stored; permission is checked again for its owner.
create or replace function private.integration_commit_expense_upload(target_intent uuid, asset jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare i private.workspace_upload_intents;prop uuid;e uuid;
begin
 i:=(select x from private.workspace_upload_intents x where x.id=target_intent);
 if i.id is null then raise exception 'Upload not found' using errcode='P0002';end if;
 if not exists(select 1 from public.workspace_profiles p where p.user_id=i.owner_id and p.status='active' and p.role in ('accounts','admin','super_admin')) then raise exception 'Upload access revoked' using errcode='42501';end if;
 if i.evidence_id is not null then return i.evidence_id;end if;
 if i.expires_at<now() then raise exception 'Upload expired' using errcode='22023';end if;
 prop:=private.workspace_expense_upload_property(i.owner_id,i.expense_id,i.work_id);
 if prop is null then raise exception 'Upload permission changed' using errcode='42501';end if;
 perform private.workspace_json_keys(asset,array['assetId','publicId','version','format','bytes']);
 if asset->>'publicId' is distinct from i.public_id or coalesce(asset->>'assetId','')='' or coalesce(asset->>'format','') not in ('jpg','png','webp') or jsonb_typeof(asset->'bytes') is distinct from 'number' or jsonb_typeof(asset->'version') is distinct from 'number' or (asset->>'bytes')::integer not between 12 and 8388608 or (asset->>'version')::bigint<1 then raise exception 'Invalid verified asset' using errcode='22023';end if;
 insert into private.workspace_media_evidence(property_id,work_id,expense_id,owner_id,purpose,provider_id,verified_at,asset_version,asset_format,asset_bytes,provider_asset_id)
  values(prop,i.work_id,i.expense_id,i.owner_id,'expense',i.public_id,now(),(asset->>'version')::bigint,asset->>'format',(asset->>'bytes')::integer,asset->>'assetId') returning id into e;
 update private.workspace_upload_intents set evidence_id=e where id=i.id;
 return e;
end $$;

-- Who sees expense paperwork: Accounts and management for that property's expenses, including
-- the repair's own photos once they are evidence on an expense.
create or replace function private.workspace_expense_media_visible(e private.workspace_media_evidence) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(private.workspace_actor_role() in ('accounts','admin','super_admin'),false) and (
  exists(select 1 from private.workspace_expenses x where x.id=e.expense_id and private.workspace_can_property(x.property_id,'maintenance-reconciliation'))
  or exists(select 1 from private.workspace_expense_evidence v join private.workspace_expenses x on x.id=v.expense_id where v.media_id=e.id and private.workspace_can_property(x.property_id,'maintenance-reconciliation')))
$$;
revoke all on function private.workspace_expense_upload_property(uuid,uuid,uuid),private.workspace_prepare_expense_upload(jsonb),
 private.integration_commit_expense_upload(uuid,jsonb),private.workspace_expense_media_visible(private.workspace_media_evidence) from public,anon,authenticated;

-- 4. A repair's after photos, sent with "Record the completed repair" (photos saved on this repair).
create or replace function private.workspace_check_repair_photos(repair uuid, ids jsonb) returns void
language plpgsql stable security definer set search_path='' as $$
begin
 if ids is null then return;end if;
 if jsonb_typeof(ids)<>'array' or jsonb_array_length(ids)>30 or exists(select 1 from jsonb_array_elements(ids) x where jsonb_typeof(x)<>'string')
  or (select count(distinct m.id) from private.workspace_media_evidence m where m.work_id=repair and m.purpose='maintenance' and m.id::text in (select value#>>'{}' from jsonb_array_elements(ids)))<>jsonb_array_length(ids)
 then raise exception 'After photos must be photos saved on this repair' using errcode='22023';end if;
end $$;

-- 5. The draft expense for a completed repair: the contractor, the actual cost, the completion
-- report and the repair's photos. Accounts add the supplier's invoice and send it for approval.
create or replace function private.workspace_repair_draft_expense(repair uuid, amount bigint, report jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare w public.workspace_work_items;d private.workspace_domain_details;e private.workspace_expenses;after_ids jsonb:=coalesce(report->'photoIds','[]'::jsonb);
begin
 if amount is null or amount<1 then return null;end if;
 if exists(select 1 from private.workspace_expenses x where x.work_id=repair and x.source='repair') then return null;end if;
 w:=(select x from public.workspace_work_items x where x.id=repair);
 d:=(select x from private.workspace_domain_details x where x.work_id=repair);
 insert into private.workspace_expenses(property_id,work_id,supplier,reference,category,description,amount_minor,received_on,source,status,created_by,request_id)
  values(w.property_id,repair,left(coalesce(nullif(trim(d.data->>'contractor'),''),'Repair contractor'),200),'REPAIR-'||upper(left(replace(repair::text,'-',''),10)),'maintenance',
   left('Repair: '||coalesce(nullif(trim(d.data->>'issue'),''),w.title),3000),amount,current_date,'repair','draft',auth.uid(),gen_random_uuid()) returning * into e;
 insert into private.workspace_expense_evidence(expense_id,kind,label,work_id,note,added_by)
  values(e.id,'report','Repair completion report',repair,left(coalesce(nullif(trim(report->>'report'),''),'Repair completed'),2000),auth.uid());
 insert into private.workspace_expense_evidence(expense_id,kind,label,media_id,added_by)
  select e.id,'photo',case when after_ids ? m.id::text then 'After photo' else 'Before photo' end,m.id,auth.uid()
  from (select x.id from private.workspace_media_evidence x where x.work_id=repair and x.purpose='maintenance' order by after_ids ? x.id::text desc,x.verified_at,x.id limit 12) m;
 insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(auth.uid(),w.property_id,repair,'finance.expense_drafted');
 return e.id;
end $$;

-- 6. Paid: a repair's expense approved, its invoice paid, or its invoice task closed.
create or replace function private.workspace_mark_repair_paid(repair uuid, via text) returns void
language sql security definer set search_path='' as $$
 update private.workspace_domain_details set data=data||jsonb_build_object('paidAt',now(),'paidVia',via),updated_at=now()
  where work_id=repair and kind='maintenance' and data->>'phase'='completed' and not (data ? 'paidAt');
$$;
create or replace function private.workspace_repair_paid_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='workspace_expenses' then
  if new.status='approved' and new.work_id is not null then perform private.workspace_mark_repair_paid(new.work_id,'expense');end if;
 elsif tg_table_name='workspace_invoices' then
  if new.status='paid' and new.work_id is not null then perform private.workspace_mark_repair_paid(new.work_id,'invoice');end if;
 elsif new.status='completed' then
  perform private.workspace_mark_repair_paid((d.data->>'sourceWorkId')::uuid,'invoice_task') from private.workspace_domain_details d
   where d.work_id=new.id and d.kind='maintenance_invoice' and d.data->>'sourceWorkId' is not null;
 end if;
 return new;
end $$;
revoke all on function private.workspace_check_repair_photos(uuid,jsonb),private.workspace_repair_draft_expense(uuid,bigint,jsonb),
 private.workspace_mark_repair_paid(uuid,text),private.workspace_repair_paid_trigger() from public,anon,authenticated;
drop trigger if exists repair_paid_expense on private.workspace_expenses;
create trigger repair_paid_expense after update of status on private.workspace_expenses for each row when (new.status is distinct from old.status) execute function private.workspace_repair_paid_trigger();
drop trigger if exists repair_paid_invoice on public.workspace_invoices;
create trigger repair_paid_invoice after update of status on public.workspace_invoices for each row when (new.status is distinct from old.status) execute function private.workspace_repair_paid_trigger();
drop trigger if exists repair_paid_task on public.workspace_work_items;
create trigger repair_paid_task after update of status on public.workspace_work_items for each row when (new.status is distinct from old.status) execute function private.workspace_repair_paid_trigger();
-- Repairs already paid before this change.
update private.workspace_domain_details d set data=d.data||jsonb_build_object('paidAt',now(),'paidVia','expense')
 where d.kind='maintenance' and d.data->>'phase'='completed' and not (d.data ? 'paidAt') and exists(select 1 from private.workspace_expenses x where x.work_id=d.work_id and x.status='approved');
update private.workspace_domain_details d set data=d.data||jsonb_build_object('paidAt',now(),'paidVia','invoice')
 where d.kind='maintenance' and d.data->>'phase'='completed' and not (d.data ? 'paidAt') and exists(select 1 from public.workspace_invoices i where i.work_id=d.work_id and i.status='paid');
update private.workspace_domain_details d set data=d.data||jsonb_build_object('paidAt',now(),'paidVia','invoice_task')
 where d.kind='maintenance' and d.data->>'phase'='completed' and not (d.data ? 'paidAt') and exists(select 1 from private.workspace_domain_details t join public.workspace_work_items tw on tw.id=t.work_id
  where t.kind='maintenance_invoice' and t.data->>'sourceWorkId'=d.work_id::text and tw.status='completed');

-- 7. Accounts actions: attach saved photos to an expense, link it to its job, send a draft for
-- approval, and record a purchase's supplier invoice (optionally already paid).
create or replace function private.workspace_accounts_action(input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();a text;req uuid;prop uuid;prior private.workspace_action_receipts;result jsonb;
 e private.workspace_expenses;w public.workspace_work_items;d private.workspace_domain_details;inv public.workspace_invoices;amount bigint;job uuid;ref text;label text;note text;
begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 a:=private.workspace_required_text(input,'action',1,50);req:=(input->>'requestId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 if a in ('attachExpensePhotos','linkExpenseJob','submitDraftExpense') then
  prop:=(select x.property_id from private.workspace_expenses x where x.id=(input->>'expenseId')::uuid);
  if prop is null or not private.workspace_finance_role() or not private.workspace_can_property(prop,'maintenance-reconciliation') then raise exception 'Accounts approval access required' using errcode='42501';end if;
 elsif a='recordPurchaseInvoice' then
  prop:=(select x.property_id from public.workspace_work_items x where x.id=(input->>'purchaseId')::uuid);
  if prop is null or not (actor in ('admin','super_admin') or (actor='accounts' and private.workspace_can_property(prop,'purchase-order-accounts'))) then raise exception 'Accounts purchase access required' using errcode='42501';end if;
 else raise exception 'Unknown Accounts action' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 prior:=(select r from private.workspace_action_receipts r where r.actor_id=auth.uid() and r.request_id=req);
 if prior.request_id is not null then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;

 if a in ('attachExpensePhotos','linkExpenseJob','submitDraftExpense') then
  perform 1 from private.workspace_expenses where id=(input->>'expenseId')::uuid for update;
  e:=(select x from private.workspace_expenses x where x.id=(input->>'expenseId')::uuid);
  if e.status not in ('draft','to_approve','queried') then raise exception 'This expense has already been decided' using errcode='42501';end if;
 end if;

 if a='attachExpensePhotos' then
  perform private.workspace_json_keys(input,array['action','requestId','expenseId','kind','label','mediaIds','note']);
  if coalesce(input->>'kind','') not in ('invoice','photo','quote','report') then raise exception 'Choose an evidence type' using errcode='22023';end if;
  label:=private.workspace_required_text(input,'label',2,180);
  if input ? 'note' and (jsonb_typeof(input->'note')<>'string' or length(input->>'note')>2000) then raise exception 'Note is too long' using errcode='22023';end if;
  note:=nullif(trim(coalesce(input->>'note','')),'');
  if jsonb_typeof(input->'mediaIds') is distinct from 'array' or jsonb_array_length(input->'mediaIds') not between 1 and 20 or exists(select 1 from jsonb_array_elements(input->'mediaIds') x where jsonb_typeof(x)<>'string' or x#>>'{}'!~'^[0-9a-fA-F-]{36}$')
   or (select count(distinct m.id) from private.workspace_media_evidence m where m.id::text in (select lower(value#>>'{}') from jsonb_array_elements(input->'mediaIds'))
       and (m.expense_id=e.id or (m.work_id is not null and m.work_id=e.work_id and m.property_id=e.property_id)))<>jsonb_array_length(input->'mediaIds')
  then raise exception 'Add photos saved on this expense or on its linked job' using errcode='22023';end if;
  insert into private.workspace_expense_evidence(expense_id,kind,label,media_id,note,added_by)
   select e.id,input->>'kind',case when x.n=1 then label else label||' ('||x.n||')' end,x.id,note,auth.uid()
   from (select (value#>>'{}')::uuid id,ordinality n from jsonb_array_elements(input->'mediaIds') with ordinality) x
   where not exists(select 1 from private.workspace_expense_evidence v where v.expense_id=e.id and v.media_id=x.id);
  update private.workspace_expenses set version=version+1,updated_at=now() where id=e.id returning * into e;
  result:=private.workspace_expense_view(e,true);

 elsif a='linkExpenseJob' then
  perform private.workspace_json_keys(input,array['action','requestId','expenseId','version','workId']);
  if e.version is distinct from (input->>'version')::integer then raise exception 'Expense changed' using errcode='40001';end if;
  job:=(input->>'workId')::uuid;
  if job is not null and not exists(select 1 from public.workspace_work_items jw join private.workspace_domain_details jd on jd.work_id=jw.id
    where jw.id=job and jw.property_id=e.property_id and jw.status in ('approved','completed')
    and ((jd.kind='maintenance' and jd.data->>'phase'='completed') or (jd.kind='purchase' and jd.data->>'phase' in ('delivered','reconciled')))) then raise exception 'Choose a finished repair or delivered purchase at this property' using errcode='22023';end if;
  update private.workspace_expenses set work_id=job,version=version+1,updated_at=now() where id=e.id returning * into e;
  result:=private.workspace_expense_view(e,true);
  insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(auth.uid(),e.property_id,job,'finance.expense_linked');

 elsif a='submitDraftExpense' then
  perform private.workspace_json_keys(input,array['action','requestId','expenseId','version','supplier','reference','amountMinor','receivedOn','description']);
  if e.version is distinct from (input->>'version')::integer then raise exception 'Expense changed' using errcode='40001';end if;
  if e.status<>'draft' then raise exception 'Only a draft is sent for approval' using errcode='42501';end if;
  amount:=private.workspace_money(input,'amountMinor');
  if amount<1 or (input->>'receivedOn') is null or (input->>'receivedOn')!~'^\d{4}-\d{2}-\d{2}$' or (input->>'receivedOn')::date>current_date then raise exception 'Add the amount and the date the invoice was received' using errcode='22023';end if;
  if exists(select 1 from private.workspace_expenses x where x.id<>e.id and x.status<>'rejected' and lower(x.supplier)=lower(trim(input->>'supplier')) and lower(x.reference)=lower(trim(input->>'reference'))) then raise exception 'This supplier invoice is already recorded' using errcode='22023';end if;
  update private.workspace_expenses set supplier=private.workspace_required_text(input,'supplier',2,200),reference=private.workspace_required_text(input,'reference',1,120),
   description=private.workspace_required_text(input,'description',5,3000),amount_minor=amount,received_on=(input->>'receivedOn')::date,status='to_approve',version=version+1,updated_at=now()
   where id=e.id returning * into e;
  result:=private.workspace_expense_view(e,true);
  insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(auth.uid(),e.property_id,e.work_id,'finance.expense_received');

 elsif a='recordPurchaseInvoice' then
  perform private.workspace_json_keys(input,array['action','requestId','purchaseId','reference','amountMinor','paid']);
  perform 1 from public.workspace_work_items where id=(input->>'purchaseId')::uuid for update;
  w:=(select x from public.workspace_work_items x where x.id=(input->>'purchaseId')::uuid);
  d:=(select x from private.workspace_domain_details x where x.work_id=w.id);
  if d.kind is distinct from 'purchase' or d.data->>'phase' is distinct from 'delivered' or w.status<>'approved' then raise exception 'Record the invoice once the purchase has been delivered' using errcode='22023';end if;
  if jsonb_typeof(input->'paid') is distinct from 'boolean' then raise exception 'Say whether the supplier has been paid' using errcode='22023';end if;
  amount:=private.workspace_money(input,'amountMinor');
  if amount<1 or amount>coalesce((d.data->>'approvedAmountMinor')::bigint,0) then raise exception 'The invoice is more than the approved amount' using errcode='22023';end if;
  ref:=private.workspace_required_text(input,'reference',1,100);
  inv:=(select x from public.workspace_invoices x where x.work_id=w.id and x.status<>'void' order by x.created_at desc limit 1);
  if inv.id is not null then
   if inv.reference<>ref or inv.amount_minor<>amount then raise exception 'Another invoice is already recorded for this purchase' using errcode='22023';end if;
  else
   if exists(select 1 from public.workspace_invoices x where x.reference=ref) then raise exception 'That invoice reference is already recorded. Add the supplier name to it' using errcode='22023';end if;
   insert into public.workspace_invoices(request_id,property_id,work_id,module_id,recipient_id,reference,amount_minor,currency,created_by)
    values(req,w.property_id,w.id,'purchase-order-accounts',auth.uid(),ref,amount,'GBP',auth.uid()) returning * into inv;
  end if;
  if (input->>'paid')::boolean and inv.status='issued' then
   update public.workspace_invoices set status='paid',paid_at=now(),version=version+1 where id=inv.id returning * into inv;
  end if;
  result:=jsonb_build_object('invoiceId',inv.id,'workId',w.id,'reference',inv.reference,'amountMinor',inv.amount_minor,'status',inv.status);
  insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(auth.uid(),w.property_id,w.id,'finance.purchase_invoice_recorded');
 end if;
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $$;

-- Jobs an expense can be linked to: finished repairs and delivered purchases at the property.
create or replace function private.workspace_accounts_read(section text, target_property uuid default null, target_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if private.workspace_actor_role() is null then raise exception 'Active access required' using errcode='42501';end if;
 if section='jobs' then
  if target_property is null or not private.workspace_finance_role() or not private.workspace_can_property(target_property,'maintenance-reconciliation') then raise exception 'Accounts approval access required' using errcode='42501';end if;
  return (select coalesce(jsonb_agg(j.v order by j.done desc,j.id),'[]') from (
   select w.id,coalesce(w.completed_at,w.updated_at) done,jsonb_build_object('workId',w.id,'kind',d.kind,'title',w.title,
    'detail',left(coalesce(d.data->>'issue',d.data->>'requirements',w.title),200),'phase',d.data->>'phase',
    'supplier',coalesce(d.data->>'contractor',d.data->>'supplier'),'costMinor',coalesce((d.data->>'actualCostMinor')::bigint,(d.data->>'approvedAmountMinor')::bigint),
    'doneOn',(coalesce(w.completed_at,w.updated_at) at time zone 'Europe/London')::date,
    'photoCount',(select count(*) from private.workspace_media_evidence m where m.work_id=w.id and m.purpose in ('maintenance','delivery'))) v
   from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
   where w.property_id=target_property and w.status in ('approved','completed') and w.updated_at>now()-interval '400 days'
    and ((d.kind='maintenance' and d.data->>'phase'='completed') or (d.kind='purchase' and d.data->>'phase' in ('delivered','reconciled')))
   order by coalesce(w.completed_at,w.updated_at) desc limit 40) j);
 end if;
 raise exception 'Unknown Accounts section' using errcode='22023';
end $$;

-- 8. Ready Home: repairs at each stage, from the Stays report to payment, and this month's
-- routine visits for each property the person looks after.
create or replace function private.workspace_ready_home() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();today date:=(now() at time zone 'Europe/London')::date;month_start date;props uuid[];
begin
 if actor is null or actor not in ('ready','stays','admin','super_admin') then raise exception 'Ready access required' using errcode='42501';end if;
 month_start:=date_trunc('month',today)::date;
 props:=array(select p.id from public.workspace_properties p where p.status<>'archived' and (actor in ('admin','super_admin')
  or exists(select 1 from public.workspace_property_assignments s where s.property_id=p.id and s.user_id=auth.uid() and s.assignment='staff')));
 return jsonb_build_object('month',to_char(month_start,'YYYY-MM'),'today',today,
  'stages',(select coalesce(jsonb_object_agg(x.stage,x.n),'{}') from (
    select case when d.data->>'phase'='completed' and d.data ? 'paidAt' then 'paid' else coalesce(d.data->>'phase','triage') end stage,count(*) n
    from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
    where d.kind='maintenance' and w.property_id=any(props) and w.status not in ('cancelled','declined')
     and (private.workspace_can_property(w.property_id,'maintenance-reporting') or private.workspace_can_property(w.property_id,'stays-maintenance-reporting'))
     and (coalesce(d.data->>'phase','')<>'completed'
      or (not (d.data ? 'paidAt') and coalesce(w.completed_at,w.updated_at)>=now()-interval '90 days')
      or (d.data ? 'paidAt' and (d.data->>'paidAt')::timestamptz>=month_start::timestamp at time zone 'Europe/London'))
    group by 1) x),
  'visits',(select coalesce(jsonb_agg(jsonb_build_object('propertyId',p.id,'propertyName',p.name,'items',v.items) order by p.name,p.id),'[]')
    from public.workspace_properties p cross join lateral (
     select coalesce(jsonb_agg(jsonb_build_object('workId',w.id,'title',w.title,'dueOn',w.due_on,'status',w.status,'assigneeName',a.full_name,'mine',w.assignee_id=auth.uid()) order by w.due_on,w.id),'[]') items,count(*) n
     from private.workspace_routine_visits rv join public.workspace_work_items w on w.id=rv.work_id left join public.workspace_profiles a on a.user_id=w.assignee_id
     where rv.period_start=month_start and w.property_id=p.id and w.status not in ('cancelled','declined') and private.workspace_can_work(w.id)) v
    where p.id=any(props) and (v.n>0 or exists(select 1 from private.workspace_routine_plans r where r.property_id=p.id and r.active and private.workspace_can_property(p.id,r.module_id)))));
end $$;

-- 9. Routine visits for this month and next, created on a schedule (bounded per run), and one
-- reminder to whoever does a visit three days before it is due: the assignee, otherwise Ready on
-- the property, otherwise management. Run by the server every 15 minutes.
create or replace function private.workspace_routine_auto(at_time timestamptz default now()) returns jsonb
language plpgsql security definer set search_path='' as $$
declare today date:=(at_time at time zone 'Europe/London')::date;start_on date;plan private.workspace_routine_plans;target uuid;visit record;ev bigint;who uuid[];
 created integer:=0;remaining integer:=0;reminded integer:=0;
begin
 perform pg_advisory_xact_lock(hashtextextended('workspace_routine_auto',0));
 foreach start_on in array array[date_trunc('month',today)::date,(date_trunc('month',today)+interval '1 month')::date] loop
  for plan in select r.* from private.workspace_routine_plans r join public.workspace_properties p on p.id=r.property_id
    where r.active and p.status<>'archived' and r.starts_on<=start_on
    and (r.frequency='monthly' or ((extract(year from start_on)-extract(year from r.starts_on))*12+extract(month from start_on)-extract(month from r.starts_on))::int%3=0)
    and not exists(select 1 from private.workspace_routine_visits v where v.plan_id=r.id and v.period_start=start_on) order by start_on,r.property_id,r.id loop
   if created>=40 then remaining:=remaining+1;continue;end if;
   target:=private.workspace_handover(plan.property_id,plan.module_id,plan.title,'routine_visit',jsonb_build_object('planId',plan.id,'period',to_char(start_on,'YYYY-MM'),'checklist',plan.checklist,'scheduled',true));
   update public.workspace_work_items set due_on=start_on+plan.day_of_month-1,assignee_id=case when exists(select 1 from public.workspace_property_assignments s join public.workspace_profiles p on p.user_id=s.user_id
     where s.property_id=plan.property_id and s.user_id=plan.assignee_id and s.assignment='staff' and p.status='active') then plan.assignee_id end where id=target;
   insert into private.workspace_routine_visits(plan_id,period_start,work_id) values(plan.id,start_on,target);
   created:=created+1;
  end loop;
 end loop;
 for visit in select w.id,w.property_id,w.module_id,w.assignee_id from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
   where d.kind='routine_visit' and w.status in ('waiting','in_progress') and w.due_on between today and today+3 and not (d.data ? 'reminderSentAt') order by w.due_on,w.id limit 200 loop
  who:=array(select p.user_id from public.workspace_profiles p where p.user_id=visit.assignee_id and p.status='active');
  if cardinality(who)=0 then who:=array(select s.user_id from public.workspace_property_assignments s join public.workspace_profiles p on p.user_id=s.user_id
   join public.workspace_module_grants g on g.user_id=s.user_id and g.module_id=visit.module_id where s.property_id=visit.property_id and s.assignment='staff' and p.role='ready' and p.status='active');end if;
  if cardinality(who)=0 then who:=array(select p.user_id from public.workspace_profiles p where p.role in ('admin','super_admin') and p.status='active');end if;
  insert into public.workspace_activity(property_id,work_id,event_type,created_at) values(visit.property_id,visit.id,'routine.visit_due',at_time) returning id into ev;
  insert into private.workspace_notification_outbox(user_id,work_id,event_id) select distinct u,visit.id,ev from unnest(who) u on conflict do nothing;
  update private.workspace_domain_details set data=data||jsonb_build_object('reminderSentAt',at_time),updated_at=now() where work_id=visit.id;
  reminded:=reminded+1;
 end loop;
 return jsonb_build_object('created',created,'remaining',remaining,'reminded',reminded);
end $$;

-- 10. Stays working a direct booking see that booking's invoice (only invoices on direct-booking
-- work at properties where they hold direct bookings), so they can confirm it once paid.
create or replace function private.workspace_direct_booking_invoice_visible(target_work uuid, target_property uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select target_work is not null and coalesce(private.workspace_actor_role() in ('stays','admin','super_admin'),false)
  and private.workspace_can_property(target_property,'direct-bookings')
  and exists(select 1 from private.workspace_domain_details d join public.workspace_work_items w on w.id=d.work_id where d.work_id=target_work and d.kind='direct_booking' and w.property_id=target_property);
$$;
revoke all on function private.workspace_direct_booking_invoice_visible(uuid,uuid) from public,anon;
grant execute on function private.workspace_direct_booking_invoice_visible(uuid,uuid) to authenticated;
drop policy if exists invoices_direct_booking on public.workspace_invoices;
create policy invoices_direct_booking on public.workspace_invoices for select to authenticated using (private.workspace_direct_booking_invoice_visible(work_id,property_id));

-- 11. Ready read a property's access instructions (not logins or finance) when they look after it.
create or replace function private.workspace_ready_property(target uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select private.workspace_actor_role()='ready' and (private.workspace_can_property(target,'maintenance-reporting')
  or private.workspace_can_property(target,'new-property-inspection-board') or private.workspace_can_property(target,'ready-schedule'));
$$;
revoke all on function private.workspace_ready_property(uuid),private.workspace_accounts_action(jsonb),private.workspace_accounts_read(text,uuid,uuid),
 private.workspace_ready_home(),private.workspace_routine_auto(timestamptz) from public,anon,authenticated;

-- 12. Patches to existing functions, each inside its own feature's branch.
do $$
declare
 fixes constant text[][] := array[
  -- Uploads: expense paperwork goes to its own checks.
  ['private.workspace_prepare_upload(jsonb)',
   $q$perform private.workspace_json_keys(input,array['requestId','workId','purpose','contentHash']);$q$,
   $q$if input->>'purpose'='expense' then return private.workspace_prepare_expense_upload(input);end if;
 perform private.workspace_json_keys(input,array['requestId','workId','purpose','contentHash']);$q$,
   $q$workspace_prepare_expense_upload$q$],
  ['private.integration_commit_upload(uuid,jsonb)',
   $q$if not found then raise exception 'Upload not found' using errcode='P0002';end if;$q$,
   $q$if not found then raise exception 'Upload not found' using errcode='P0002';end if;
 if i.purpose='expense' then return private.integration_commit_expense_upload(i.id,asset);end if;$q$,
   $q$integration_commit_expense_upload$q$],
  ['private.workspace_media_visible(private.workspace_media_evidence)',
   $q$private.workspace_operation_access(e.work_id)$q$,
   $q$private.workspace_operation_access(e.work_id) or private.workspace_expense_media_visible(e)$q$,
   $q$workspace_expense_media_visible$q$],
  -- Completing a repair: optional after photos, then the draft expense for Accounts.
  ['private.workspace_operations_action(jsonb)',
   $q$perform private.workspace_json_keys(data,array['report','actualCostMinor','guestUpdate']);$q$,
   $q$perform private.workspace_json_keys(data,array['report','actualCostMinor','guestUpdate','photoIds']);perform private.workspace_check_repair_photos(target,data->'photoIds');$q$,
   $q$workspace_check_repair_photos$q$],
  ['private.workspace_operations_action(jsonb)',
   $q$perform private.workspace_handover(prop,'maintenance-reconciliation','Reconcile completed property repair','maintenance_invoice',jsonb_build_object('sourceWorkId',target,'actualCostMinor',amount));$q$,
   $q$perform private.workspace_handover(prop,'maintenance-reconciliation','Reconcile completed property repair','maintenance_invoice',jsonb_build_object('sourceWorkId',target,'actualCostMinor',amount));
    perform private.workspace_repair_draft_expense(target,amount,data);$q$,
   $q$workspace_repair_draft_expense$q$],
  -- Draft expenses: listed, counted, evidenced and rejectable like the others.
  ['private.workspace_finance_read(text,uuid,text,uuid,text)',
   $q$if status_filter is not null and status_filter not in ('to_approve','queried','approved','rejected') then$q$,
   $q$if status_filter is not null and status_filter not in ('draft','to_approve','queried','approved','rejected') then$q$,
   $q$not in ('draft','to_approve','queried','approved','rejected')$q$],
  ['private.workspace_finance_read(text,uuid,text,uuid,text)',
   $q$'queriedCount',count(*) filter(where status='queried'),$q$,
   $q$'queriedCount',count(*) filter(where status='queried'),'draftCount',count(*) filter(where status='draft'),$q$,
   $q$'draftCount'$q$],
  ['private.workspace_finance_action(jsonb)',
   $q$if e.status not in ('to_approve','queried') then raise exception 'Evidence can only be added before a decision'$q$,
   $q$if e.status not in ('draft','to_approve','queried') then raise exception 'Evidence can only be added before a decision'$q$,
   $q$not in ('draft','to_approve','queried') then raise exception 'Evidence$q$],
  ['private.workspace_finance_action(jsonb)',
   $q$if e.status not in ('to_approve','queried') then raise exception 'Expense already decided'$q$,
   $q$if e.status not in ('draft','to_approve','queried') then raise exception 'Expense already decided'$q$,
   $q$not in ('draft','to_approve','queried') then raise exception 'Expense already$q$],
  -- Ready: the access instructions for properties they look after.
  ['private.workspace_property_details(uuid,text)',
   $q$if not ((actor not in ('client','cleans') and private.workspace_can_property(target_property,'property-database')) or$q$,
   $q$if not ((actor not in ('client','cleans') and private.workspace_can_property(target_property,'property-database')) or private.workspace_ready_property(target_property) or$q$,
   $q$workspace_ready_property$q$]
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

-- 13. Public wrappers.
create or replace function public.workspace_accounts_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_accounts_action(input);$$;
create or replace function public.workspace_accounts_read(section text, target_property uuid default null, target_id uuid default null) returns jsonb language sql security invoker set search_path='' as $$select private.workspace_accounts_read(section,target_property,target_id);$$;
create or replace function public.workspace_ready_home() returns jsonb language sql security invoker set search_path='' as $$select private.workspace_ready_home();$$;
create or replace function public.workspace_routine_auto() returns jsonb language sql security invoker set search_path='' as $$select private.workspace_routine_auto();$$;
revoke all on function public.workspace_accounts_action(jsonb),public.workspace_accounts_read(text,uuid,uuid),public.workspace_ready_home() from public,anon;
grant execute on function private.workspace_accounts_action(jsonb),private.workspace_accounts_read(text,uuid,uuid),private.workspace_ready_home(),
 public.workspace_accounts_action(jsonb),public.workspace_accounts_read(text,uuid,uuid),public.workspace_ready_home() to authenticated;
revoke all on function public.workspace_routine_auto() from public,anon,authenticated;
grant execute on function private.workspace_routine_auto(timestamptz),public.workspace_routine_auto() to service_role;


insert into supabase_migrations.schema_migrations(version,name) values
 ('20261009160000','owner_experience'),('20261009170000','calendar_inbox_replies'),('20261009180000','cleans_disputes'),
 ('20261009190000','management_oversight'),('20261009200000','accounts_ready') on conflict do nothing;

select 'Audit build is up to date' as result;
