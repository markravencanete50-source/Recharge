-- Repairs with contractors (Lee, 15 October 2026). Ready accounts are outside contractors; one contractor per job.
--
--  * Report from the guest chat: a repair may carry guestConversationId (the guest inbox conversation). It must be
--    for the same property (or for a stay at it); when the repair has no reservationId and the conversation carries a
--    stay's booking code at this property, the stay is filled in. Only the guest team (Stays, management) can do this.
--  * Send to contractor: referReady needs readyUserId, a Ready user who works on the property (staff assignment and
--    the maintenance-reporting tool). The repair keeps assignedReadyId and assignedReadyName; only that contractor is
--    told. New step reassignReady {readyUserId, reason} (Stays, management): while the contractor has the job
--    (referred, booked, or waiting for approval after referral). Both contractors are told. A booked visit is
--    cancelled, so the new contractor books their own.
--  * New read workspace_repair_contractors(property_id): the contractors for a property, for the picker.
--    Stays and management only. trade is null for now (no trade is stored on a profile yet).
--  * One contractor per job: a Ready user sees a repair only when it is assigned to them. Repairs referred before
--    this change, with no assignedReadyId, keep the old rule (any Ready user on the property, once referred).
--    This applies everywhere a repair is read: work items and their updates and activity (RLS), the repairs list and
--    details, photos and files, Ready Home counts, the calendar, notifications and push, uploads, and the repair's
--    team chat (a contractor taken off a job can no longer open its chat).
--  * Estimate from the contractor (Lee and Daniel's flow): reviseQuote by a Ready user is a contractor estimate
--    (quoteSource 'contractor', data.teamReview true), with optional quoteFileIds (files saved on the repair). It goes
--    to phase team_review (resumePhase 'referred', or 'booked' when the visit is already booked) and the team are told.
--    Management (admins and super admins) are asked to review it (event operations.updateOperation.estimateToReview);
--    Stays on the property are told for information. New step reviewDone {note?} is management's approval (admins and
--    super admins only; only in team_review): within the owner's limit (or with full permission, or an amount the
--    owner already approved) it is approved straight away (autoApprovedAt, autoApprovedMinor, autoApprovalLimitMinor,
--    autoApprovalSource); otherwise the owner is asked (owner_approval). Management, Stays and the contractor are told
--    the outcome (the contractor never the limit); owners get every repair update, as before.
--    The owner's limit as it is now is kept on an estimate under review (ownerLimitMinor, ownerFullPermission,
--    ownerLimitSource) for Stays and management; these and autoApprovalLimitMinor/autoApprovalSource are never sent to
--    a Ready user.
--    Contractor estimates never go to management approval. Estimates the team enter keep today's rules.
--    Once approved and back in referred, bookingApprovedAt is set and the contractor is told "Approved, please book
--    the visit" (event operations.updateOperation.approvedToBook); an owner's approval also tells Alex. A new estimate
--    waiting for review or approval clears bookingApprovedAt.
--    Fix: a re-quote on a repair that already has a contractor resumes to referred, never triage.
--  * The owner's limit per property: the Limit Changer value when one is set (private.workspace_repair_limits),
--    otherwise the owner's set-up form (repairLimitMinor / fullRepairPermission), otherwise always ask the owner.
--    It is also the owner's pre-authorisation for the team's estimates (it replaces reading the form directly).
--  * Limit Changer: read workspace_repair_limits_read() (admin, super_admin): the company limit and every owner with
--    their properties and limits. Owners are grouped by owner account (client assignment, else the onboarding
--    journey's client), else by the name on the onboarding enquiry, else each property on its own.
--    workspace_repair_limits_action({requestId, action:'setRepairLimit', propertyIds, limitMinor, fullPermission})
--    (super admin only) sets limits, keeps a history, and approves straight away every estimate waiting for an owner
--    on those properties that is now within the limit (returned as autoApproved).
--  * Booking: bookRepair needs visitFrom and visitTo ('HH:MM', Europe/London, from before to); the work item gets
--    the times for the calendar. data.clashes lists stays at the property that day which the window overlaps
--    ({checkIn, checkOut, label}, label like "Guest stay, check-in 14:00", never a guest name); a clash only warns.
--    The result also carries clashes at the top level. contractor defaults to the assigned contractor's name.
--    Stays are told, as before, so they can tell the guest.
--  * Completion: completeRepair takes optional invoiceFileIds (files saved on the repair); the draft expense gets
--    them as invoice evidence, and the contractor's estimate files as quote evidence. Files are not counted as photos.
--  * Files: repair files may be PDFs. The upload commit accepts 'pdf' only for a repair's own files (purpose
--    'maintenance' on a maintenance job), and the private bucket accepts application/pdf. No check constraint changes.
--  * Ready lockdown (approved by the lead): Ready no longer get guest names (calendar stays) and get only the
--    inspection fields of an onboarding journey (no estimate, enquiry, agreement, signature, feedback, form,
--    questions or invoice details).
--  * Owners see the repair as before, but not which staff account does it (assignedReadyId/Name, previous ones),
--    why it moved, management's review note or the guest conversation id. The booked contractor name still shows.
--
-- Patched by anchor (each anchor must occur exactly once; each patch is skipped once its sentinel is present):
--   private.workspace_operations_action(jsonb), private.workspace_can_work(uuid), private.workspace_operation_access(uuid),
--   private.integration_can_work(uuid,uuid), private.chat_can(uuid,uuid), private.chat_start_property(jsonb),
--   private.workspace_ready_home(), private.workspace_notice_route_activity(), private.workspace_repair_requote(uuid,bigint,jsonb,jsonb),
--   private.workspace_repair_draft_expense(uuid,bigint,jsonb), private.workspace_check_repair_photos(uuid,jsonb),
--   private.integration_commit_upload(uuid,jsonb), private.workspace_owner_work_data(jsonb), private.workspace_guest_name_visible(text),
--   private.workspace_journey_view(private.workspace_journeys), private.workspace_operation_view(uuid),
--   private.workspace_repair_needs_management(bigint,jsonb), private.workspace_repair_needs_owner(uuid,bigint,jsonb).
-- No DROP or DELETE. Safe to run twice.

-- 1. The private bucket also takes PDFs (repair estimates and invoices). Only where Supabase Storage exists.
do $$ begin
 if to_regclass('storage.buckets') is not null then
  execute $q$update storage.buckets set allowed_mime_types=allowed_mime_types||array['application/pdf']
   where id='workspace-media' and allowed_mime_types is not null and not ('application/pdf'=any(allowed_mime_types))$q$;
 end if;
end $$;

-- 2. Limit Changer: a repair spending limit per property, set by a super admin, and its history.
create table if not exists private.workspace_repair_limits (
 property_id uuid primary key references public.workspace_properties(id),
 limit_minor bigint check(limit_minor is null or limit_minor>=0),
 full_permission boolean not null default false,
 updated_by uuid not null references public.workspace_profiles(user_id),
 updated_at timestamptz not null default now(),
 check(not (full_permission and limit_minor is not null))
);
create table if not exists private.workspace_repair_limit_history (
 id bigint generated always as identity primary key,
 property_id uuid not null references public.workspace_properties(id),
 changed_by uuid not null references public.workspace_profiles(user_id),
 changed_at timestamptz not null default now(),
 before jsonb,
 after jsonb not null,
 request_id uuid not null
);
create index if not exists workspace_repair_limit_history_property_idx on private.workspace_repair_limit_history(property_id,changed_at desc);
alter table private.workspace_repair_limits enable row level security;
alter table private.workspace_repair_limit_history enable row level security;
revoke all on private.workspace_repair_limits,private.workspace_repair_limit_history from public,anon,authenticated;

-- 3. Helpers.

-- The owner's limit for a property: {limitMinor, fullPermission, source:'set'|'form'|'none', updatedBy, updatedAt}.
create or replace function private.workspace_repair_owner_limit(prop uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select case
  when l.property_id is not null then jsonb_build_object('limitMinor',l.limit_minor,'fullPermission',l.full_permission,'source','set','updatedBy',l.updated_by,'updatedAt',l.updated_at)
  when j.form ? 'repairLimitMinor' or j.form ? 'fullRepairPermission' then jsonb_build_object('limitMinor',case when coalesce((j.form->>'fullRepairPermission')::boolean,false) then null else coalesce((j.form->>'repairLimitMinor')::bigint,0) end,
   'fullPermission',coalesce((j.form->>'fullRepairPermission')::boolean,false),'source','form','updatedBy',null,'updatedAt',null)
  else jsonb_build_object('limitMinor',null,'fullPermission',false,'source','none','updatedBy',null,'updatedAt',null) end
 from (select prop p) x left join private.workspace_repair_limits l on l.property_id=x.p left join private.workspace_journeys j on j.property_id=x.p
 limit 1;
$$;

-- Whether the owner's limit covers this amount.
create or replace function private.workspace_repair_owner_allows(prop uuid, amount bigint) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((o->>'fullPermission')::boolean,false) or (o->>'limitMinor' is not null and amount<=(o->>'limitMinor')::bigint)
 from (select private.workspace_repair_owner_limit(prop) o) x;
$$;

-- What the team see on an estimate waiting for their review: the owner's limit as it is now.
create or replace function private.workspace_repair_owner_snapshot(prop uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('ownerLimitMinor',(o->>'limitMinor')::bigint,'ownerFullPermission',(o->>'fullPermission')::boolean,'ownerLimitSource',o->>'source')
 from (select private.workspace_repair_owner_limit(prop) o) x;
$$;

-- Whether the owner must approve this estimate. A contractor's estimate (after the team's review): unless it is within
-- the owner's limit or an amount they already approved; always when the owner's last word was no. The team's
-- estimates: today's rule (at or over the company limit and not pre-authorised).
create or replace function private.workspace_repair_owner_needed(prop uuid, amount bigint, repair jsonb) returns boolean language sql stable security definer set search_path='' as $$
 select case when coalesce((repair->>'teamReview')::boolean,false) then
   (repair->>'ownerDeclinedAt' is not null and (repair->>'ownerApprovedAt' is null or (repair->>'ownerApprovedAt')::timestamptz<(repair->>'ownerDeclinedAt')::timestamptz))
   or (not private.workspace_repair_owner_allows(prop,amount) and amount>coalesce((repair->>'ownerApprovedMinor')::bigint,-1))
  else private.workspace_repair_needs_owner(prop,amount,repair) end;
$$;

-- One property's row on the Limit Changer.
create or replace function private.workspace_repair_limit_row(prop uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('propertyId',p.id,'propertyName',p.name,'limitMinor',(o->>'limitMinor')::bigint,'fullPermission',(o->>'fullPermission')::boolean,'source',o->>'source',
   'updatedBy',o->>'updatedBy','updatedByName',(select nullif(trim(u.full_name),'') from public.workspace_profiles u where u.user_id=(o->>'updatedBy')::uuid),'updatedAt',o->>'updatedAt')
 from public.workspace_properties p cross join lateral (select private.workspace_repair_owner_limit(p.id) o) x where p.id=prop;
$$;

-- Limit Changer: every owner, their properties and each property's limit, with the company limit for the team's
-- estimates. Admins and super admins; only super admins change limits.
create or replace function private.workspace_repair_limits_read() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();begin
 if actor is null or actor not in ('admin','super_admin') then raise exception 'Management access required' using errcode='42501';end if;
 return jsonb_build_object('companyLimitMinor',private.workspace_repair_limit(),'canEdit',actor='super_admin','owners',coalesce((
  select jsonb_agg(jsonb_build_object('ownerKey',o.owner_key,'ownerName',o.owner_name,'properties',o.properties) order by o.owner_name is null,lower(o.owner_name),o.owner_key)
  from (select x.owner_key,min(x.owner_name) owner_name,jsonb_agg(private.workspace_repair_limit_row(x.id) order by lower(x.name),x.id) properties
   from (select p.id,p.name,
     case when c.owner_id is not null then 'user:'||c.owner_id::text when e.enquiry_name is not null then 'name:'||lower(e.enquiry_name) else 'property:'||p.id::text end owner_key,
     coalesce((select nullif(trim(u.full_name),'') from public.workspace_profiles u where u.user_id=c.owner_id),e.enquiry_name) owner_name
    from public.workspace_properties p
    left join private.workspace_journeys j on j.property_id=p.id
    cross join lateral (select coalesce((select a.user_id from public.workspace_property_assignments a where a.property_id=p.id and a.assignment='client' order by a.user_id limit 1),j.client_id) owner_id) c
    cross join lateral (select nullif(trim(coalesce(nullif(trim(j.enquiry->>'contactName'),''),j.enquiry->>'companyName')),'') enquiry_name) e
    where p.status<>'archived') x
   group by x.owner_key) o),'[]'::jsonb));
end $$;
create or replace function public.workspace_repair_limits_read() returns jsonb language sql security invoker set search_path='' as $$
 select private.workspace_repair_limits_read();
$$;

-- Limit Changer: set the limit for one or more properties (super admin only). Estimates waiting for the owner on
-- those properties that are now within the limit are approved straight away, as when the team mark a review done.
create or replace function private.workspace_repair_limits_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();req uuid;prior private.workspace_action_receipts;ids uuid[];lim bigint;full_perm boolean;
 prop uuid;approved uuid[]:='{}';r record;o jsonb;resume text;amount bigint;event_id bigint;result jsonb;
begin
 if actor is distinct from 'super_admin' then raise exception 'Only a super admin can change repair limits' using errcode='42501';end if;
 perform private.workspace_json_keys(input,array['requestId','action','propertyIds','limitMinor','fullPermission']);
 if coalesce(input->>'requestId','')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Request identifier required' using errcode='22023';end if;
 req:=(input->>'requestId')::uuid;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 select * into prior from private.workspace_action_receipts x where x.actor_id=auth.uid() and x.request_id=req;
 if found then
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;
 if input->>'action' is distinct from 'setRepairLimit' then raise exception 'Unknown repair limit action' using errcode='22023';end if;
 if jsonb_typeof(input->'propertyIds') is distinct from 'array' or jsonb_array_length(input->'propertyIds') not between 1 and 200
  or exists(select 1 from jsonb_array_elements(input->'propertyIds') x where jsonb_typeof(x)<>'string' or x#>>'{}'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
 then raise exception 'Choose the properties' using errcode='22023';end if;
 ids:=array(select distinct (x#>>'{}')::uuid from jsonb_array_elements(input->'propertyIds') x);
 if exists(select 1 from unnest(ids) i where not exists(select 1 from public.workspace_properties p where p.id=i)) then raise exception 'Property not found' using errcode='22023';end if;
 if jsonb_typeof(input->'fullPermission') is distinct from 'boolean' then raise exception 'Say whether the owner gave full permission' using errcode='22023';end if;
 full_perm:=(input->>'fullPermission')::boolean;
 lim:=case when coalesce(jsonb_typeof(input->'limitMinor'),'null')='null' then null else private.workspace_money(input,'limitMinor') end;
 if full_perm and lim is not null then raise exception 'Choose a limit or full permission, not both' using errcode='22023';end if;
 foreach prop in array ids loop
  insert into private.workspace_repair_limit_history(property_id,changed_by,before,after,request_id)
   values(prop,auth.uid(),(select jsonb_build_object('limitMinor',l.limit_minor,'fullPermission',l.full_permission,'updatedBy',l.updated_by,'updatedAt',l.updated_at) from private.workspace_repair_limits l where l.property_id=prop),
    jsonb_build_object('limitMinor',lim,'fullPermission',full_perm),req);
  insert into private.workspace_repair_limits(property_id,limit_minor,full_permission,updated_by,updated_at) values(prop,lim,full_perm,auth.uid(),now())
   on conflict(property_id) do update set limit_minor=excluded.limit_minor,full_permission=excluded.full_permission,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
  -- Estimates waiting for the team's review show the owner's limit as it is now.
  update private.workspace_domain_details d set data=d.data||private.workspace_repair_owner_snapshot(prop),updated_at=now()
   from public.workspace_work_items w where w.id=d.work_id and w.property_id=prop and d.kind='maintenance' and d.data->>'phase'='team_review' and w.status not in ('completed','cancelled');
 end loop;
 for r in select w.id,w.property_id,d.data from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
   where d.kind='maintenance' and d.data->>'phase'='owner_approval' and w.property_id=any(ids) and w.status not in ('completed','cancelled') order by w.created_at,w.id for update of w loop
  amount:=coalesce((r.data->>'estimatedCostMinor')::bigint,0);
  if private.workspace_repair_owner_needed(r.property_id,amount,r.data) then continue;end if;
  o:=private.workspace_repair_owner_limit(r.property_id);
  resume:=coalesce(r.data->>'resumePhase',case when r.data->>'assignedReadyId' is not null then 'referred' else 'triage' end);
  update private.workspace_domain_details set data=data||jsonb_build_object('phase',resume,'resumePhase',null,'autoApprovedAt',now(),'autoApprovedMinor',amount,
    'autoApprovalLimitMinor',(o->>'limitMinor')::bigint,'autoApprovalSource',o->>'source')
    ||case when resume='referred' and r.data->>'assignedReadyId' is not null then jsonb_build_object('bookingApprovedAt',now()) else '{}'::jsonb end,updated_at=now()
   where work_id=r.id;
  update public.workspace_work_items set version=version+1,updated_at=now() where id=r.id;
  insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(auth.uid(),r.property_id,r.id,'operations.repairLimit.autoApproved') returning id into event_id;
  insert into private.workspace_notification_outbox(user_id,work_id,event_id)
   select distinct u,r.id,event_id from (
    select (r.data->>'assignedReadyId')::uuid u where r.data->>'assignedReadyId' is not null
    union select m from unnest(private.workspace_repair_managers()) m
    union select a.user_id from public.workspace_property_assignments a where a.property_id=r.property_id and a.assignment='client') x
   where u is not null and u is distinct from auth.uid() on conflict do nothing;
  approved:=approved||r.id;
 end loop;
 insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'management.repair_limits_changed');
 result:=jsonb_build_object('properties',(select jsonb_agg(private.workspace_repair_limit_row(i) order by i) from unnest(ids) i),'autoApproved',to_jsonb(approved));
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $$;
create or replace function public.workspace_repair_limits_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $$
 select private.workspace_repair_limits_action(input);
$$;

-- Whether this person may see this repair as a Ready user: it is assigned to them, or it was referred before
-- contractors were assigned and nobody is assigned. Anything that is not a repair: yes (other rules apply).
create or replace function private.workspace_repair_ready_sees(target uuid, subject uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select d.data->>'assignedReadyId'=subject::text or (d.data->>'assignedReadyId' is null and d.data->>'referredAt' is not null)
  from private.workspace_domain_details d where d.work_id=target and d.kind='maintenance'),true);
$$;

-- The contractor for a repair: an active Ready user who works on the property.
create or replace function private.workspace_repair_assign(prop uuid, ready_id text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare person uuid;name text;begin
 if coalesce(ready_id,'')!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Choose the contractor for this job' using errcode='22023';end if;
 person:=ready_id::uuid;
 select coalesce(nullif(trim(p.full_name),''),'Contractor') into name from public.workspace_profiles p
  where p.user_id=person and p.role='ready' and p.status='active'
   and exists(select 1 from public.workspace_property_assignments a where a.property_id=prop and a.user_id=person and a.assignment='staff')
   and exists(select 1 from public.workspace_module_grants g where g.user_id=person and g.module_id='maintenance-reporting');
 if name is null then raise exception 'Choose a contractor who works on this property' using errcode='22023';end if;
 return jsonb_build_object('assignedReadyId',person,'assignedReadyName',name,'assignedAt',now());
end $$;

-- The contractor joins the repair's team chat, when there is one.
create or replace function private.workspace_repair_chat_join(repair uuid, person uuid) returns void language sql security definer set search_path='' as $$
 insert into private.chat_members(conversation_id,user_id) select c.id,person from private.chat_conversations c where c.work_id=repair and c.property_team and person is not null
 on conflict do nothing;
$$;

-- Contractors for a property, for the "Send to contractor" picker. Stays and management only.
create or replace function private.workspace_repair_contractors(property_id uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();prop uuid:=property_id;begin
 if actor is null or actor not in ('stays','admin','super_admin') or not private.workspace_can_property(prop,'stays-maintenance-reporting') then
  raise exception 'Stays or management access required' using errcode='42501';
 end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',p.user_id,'name',coalesce(nullif(trim(p.full_name),''),'Contractor'),'trade',null) order by lower(coalesce(nullif(trim(p.full_name),''),'Contractor')),p.user_id)
  from public.workspace_profiles p
  where p.role='ready' and p.status='active'
   and exists(select 1 from public.workspace_property_assignments a where a.property_id=prop and a.user_id=p.user_id and a.assignment='staff')
   and exists(select 1 from public.workspace_module_grants g where g.user_id=p.user_id and g.module_id='maintenance-reporting')),'[]'::jsonb);
end $$;
create or replace function public.workspace_repair_contractors(property_id uuid) returns jsonb language sql security invoker set search_path='' as $$
 select private.workspace_repair_contractors(property_id);
$$;

-- A repair reported from a guest conversation: the conversation must be for this property (or for a stay at it);
-- the stay it carries fills in reservationId when none was given.
create or replace function private.workspace_repair_guest_thread(prop uuid, data jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare t private.workspace_guest_threads;stay uuid;begin
 if not data ? 'guestConversationId' then return data;end if;
 if coalesce(private.workspace_actor_role(),'') not in ('stays','admin','super_admin') then raise exception 'Only the guest team can report a repair from a guest conversation' using errcode='42501';end if;
 if jsonb_typeof(data->'guestConversationId') is distinct from 'string' or data->>'guestConversationId'!~*'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Choose the guest conversation' using errcode='22023';end if;
 select * into t from private.workspace_guest_threads x where x.id=(data->>'guestConversationId')::uuid;
 if t.id is null then raise exception 'Guest conversation not found' using errcode='22023';end if;
 stay:=(select r.id from private.workspace_reservations r where r.property_id=prop and t.reservation_ref is not null
   and upper(t.reservation_ref)=any(private.workspace_stay_codes(r.channel_reference,r.reference)) order by (r.status='confirmed') desc,r.check_in desc,r.id limit 1);
 if t.property_id is distinct from prop and (t.property_id is not null or stay is null) then raise exception 'The guest conversation is for another property' using errcode='42501';end if;
 if data->>'reservationId' is not null and stay is not null and data->>'reservationId'<>stay::text then raise exception 'The guest conversation is for another stay' using errcode='22023';end if;
 return data||jsonb_build_object('guestConversationId',t.id)||case when data->>'reservationId' is null and stay is not null then jsonb_build_object('reservationId',stay) else '{}'::jsonb end;
end $$;

-- Files saved on this repair (a contractor's estimate or invoice: photos or PDFs). Returns the list, or null.
create or replace function private.workspace_repair_files(repair uuid, ids jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if ids is null or ids='null'::jsonb then return null;end if;
 if jsonb_typeof(ids)<>'array' or jsonb_array_length(ids)>10 or exists(select 1 from jsonb_array_elements(ids) x where jsonb_typeof(x)<>'string')
  or (select count(distinct m.id) from private.workspace_media_evidence m where m.work_id=repair and m.purpose='maintenance' and m.id::text in (select value#>>'{}' from jsonb_array_elements(ids)))<>jsonb_array_length(ids)
 then raise exception 'Files must be saved on this repair' using errcode='22023';end if;
 return ids;
end $$;

-- Stays at the property that the visit overlaps on its day. Guests arrive from 14:00 and leave by 10:00.
-- Never names the guest.
create or replace function private.workspace_repair_clashes(prop uuid, day date, visit_from time, visit_to time) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('checkIn',to_char(r.check_in,'YYYY-MM-DD'),'checkOut',to_char(r.check_out,'YYYY-MM-DD'),
   'label',case when r.check_in=day then 'Guest stay, check-in 14:00' when r.check_out=day then 'Guest stay, check-out 10:00' else 'Guest stay, guests in all day' end)
   order by r.check_in,r.id),'[]'::jsonb)
 from private.workspace_reservations r
 where r.property_id=prop and r.status='confirmed' and r.check_in<=day and r.check_out>=day
  and ((r.check_in<day and r.check_out>day) or (r.check_in=day and visit_to>'14:00'::time) or (r.check_out=day and visit_from<'10:00'::time));
$$;

-- A booked visit: day, window and clashes. The contractor's name is the default for who does the work.
create or replace function private.workspace_repair_visit(prop uuid, repair jsonb, input jsonb) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare day date;visit_from time;visit_to time;begin
 if private.workspace_actor_role()='ready' and repair->>'assignedReadyId' is not null and repair->>'assignedReadyId'<>auth.uid()::text then raise exception 'Only the contractor on this job can book it' using errcode='42501';end if;
 if coalesce(input->>'repairOn','')!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Choose the day of the visit' using errcode='22023';end if;
 if coalesce(input->>'visitFrom','')!~'^([01]\d|2[0-3]):[0-5]\d$' or coalesce(input->>'visitTo','')!~'^([01]\d|2[0-3]):[0-5]\d$' then raise exception 'Choose the visit time, from and to' using errcode='22023';end if;
 day:=(input->>'repairOn')::date;visit_from:=(input->>'visitFrom')::time;visit_to:=(input->>'visitTo')::time;
 if visit_to<=visit_from then raise exception 'The visit must end after it starts' using errcode='22023';end if;
 return jsonb_build_object('visitFrom',to_char(visit_from,'HH24:MI'),'visitTo',to_char(visit_to,'HH24:MI'),'clashes',private.workspace_repair_clashes(prop,day,visit_from,visit_to),'bookedBy',auth.uid(),'bookedAt',now())
  ||case when nullif(trim(coalesce(input->>'contractor','')),'') is null and repair->>'assignedReadyName' is not null then jsonb_build_object('contractor',repair->>'assignedReadyName') else '{}'::jsonb end;
end $$;

-- After a repair step: when the contractor's job is approved and back in referred, it is approved to book;
-- a new estimate waiting for approval clears that.
create or replace function private.workspace_repair_after_step(step text, repair jsonb, change jsonb) returns jsonb language sql stable security definer set search_path='' as $$
 select case
  when (repair||change)->>'assignedReadyId' is null then jsonb_build_object('data','{}'::jsonb)
  when step in ('reviseQuote','reviewDone','approveManagement','approveBudget') and (repair||change)->>'phase'='referred'
   then jsonb_build_object('data',jsonb_build_object('bookingApprovedAt',now()),'approved',true,'readyId',(repair||change)->>'assignedReadyId',
    'alex',step='approveBudget' and coalesce(((repair||change)->>'teamReview')::boolean,false))
  when step='reviseQuote' and (repair||change)->>'phase' in ('team_review','management_approval','owner_approval') then jsonb_build_object('data',jsonb_build_object('bookingApprovedAt',null))
  else jsonb_build_object('data','{}'::jsonb) end;
$$;

-- 4. Patches.
do $patch$
declare
 fixes constant text[][] := array[
  -- 1. A repair can be reported from a guest conversation.
  ['private.workspace_operations_action(jsonb)',
   $a$perform private.workspace_json_keys(data,array['issue','reservationId','estimatedCostMinor','hazard','repairType','urgent','quoteSource']);perform private.workspace_repair_quote_source(data);$a$,
   $r$data:=private.workspace_repair_guest_thread(prop,data);perform private.workspace_json_keys(data-'guestConversationId',array['issue','reservationId','estimatedCostMinor','hazard','repairType','urgent','quoteSource']);perform private.workspace_repair_quote_source(data);$r$,
   $s$data:=private.workspace_repair_guest_thread(prop,data);$s$],
  -- 2. Send to one contractor.
  ['private.workspace_operations_action(jsonb)',
   $a$perform private.workspace_json_keys(data,array['troubleshooting','warrantyContactEvidence','guestUpdate','urgent']);$a$,
   $r$perform private.workspace_json_keys(data,array['troubleshooting','warrantyContactEvidence','guestUpdate','urgent','readyUserId']);$r$,
   $s$'guestUpdate','urgent','readyUserId']);$s$],
  ['private.workspace_operations_action(jsonb)',
   $a$'urgent',coalesce((data->>'urgent')::boolean,(d.data->>'urgent')::boolean,false));next_status:='in_progress';$a$,
   $r$'urgent',coalesce((data->>'urgent')::boolean,(d.data->>'urgent')::boolean,false))||private.workspace_repair_assign(prop,data->>'readyUserId');data:=data-'readyUserId';next_status:='in_progress';perform private.workspace_repair_chat_join(target,(data->>'assignedReadyId')::uuid);$r$,
   $s$data:=data-'readyUserId';next_status:='in_progress';$s$],
  -- 3. ...and only that contractor is told.
  ['private.workspace_operations_action(jsonb)',
   $a$if cardinality(notify_users)=0 then notify_users:=array(select user_id from public.workspace_profiles where role in ('admin','super_admin') and status='active');end if;$a$,
   $r$notify_users:=array(select (data->>'assignedReadyId')::uuid where data->>'assignedReadyId' is not null);if cardinality(notify_users)=0 then notify_users:=array(select user_id from public.workspace_profiles where role in ('admin','super_admin') and status='active');end if;$r$,
   $s$notify_users:=array(select (data->>'assignedReadyId')::uuid where$s$],
  -- 4. Move the job to another contractor.
  ['private.workspace_operations_action(jsonb)',
   $a$elsif kind='maintenance' and step='bookRepair' then$a$,
   $r$elsif kind='maintenance' and step='reassignReady' then
    perform private.workspace_json_keys(data,array['readyUserId','reason']);
    if actor not in ('stays','admin','super_admin') or not private.workspace_can_property(prop,'stays-maintenance-reporting') or d.data->>'referredAt' is null or coalesce(d.data->>'phase','') not in ('referred','booked','team_review','management_approval','owner_approval') then raise exception 'Only a repair with a contractor can go to another contractor' using errcode='42501';end if;
    if data->>'readyUserId' is not distinct from d.data->>'assignedReadyId' then raise exception 'This contractor already has the job' using errcode='22023';end if;
    entry:=private.workspace_repair_assign(prop,data->>'readyUserId');
    data:=entry||jsonb_build_object('reassignReason',private.workspace_required_text(data,'reason',5,2000),'reassignedBy',auth.uid(),'reassignedAt',now(),'previousReadyId',d.data->'assignedReadyId','previousReadyName',d.data->'assignedReadyName');
    if d.data->>'phase'='booked' then
     data:=data||jsonb_build_object('phase','referred','repairOn',null,'visitFrom',null,'visitTo',null,'clashes',null,'contractor',entry->>'assignedReadyName','bookedBy',null,'bookedAt',null);next_status:='in_progress';
     update public.workspace_work_items set due_on=null,due_time=null,due_end_time=null where id=target;
    end if;
    perform private.workspace_repair_chat_join(target,(entry->>'assignedReadyId')::uuid);
    notify_users:=array(select x from unnest(array[(entry->>'assignedReadyId')::uuid,(d.data->>'assignedReadyId')::uuid]) x where x is not null);
   elsif kind='maintenance' and step='reviewDone' then
    perform private.workspace_json_keys(data,array['note']);
    if actor not in ('admin','super_admin') or d.data->>'phase' is distinct from 'team_review' then raise exception 'Only management can approve a contractor''s estimate waiting for review' using errcode='42501';end if;
    if data ? 'note' and (jsonb_typeof(data->'note') is distinct from 'string' or length(data->>'note')>2000) then raise exception 'The note is too long' using errcode='22023';end if;
    amount:=coalesce((d.data->>'estimatedCostMinor')::bigint,0);entry:=private.workspace_repair_owner_limit(prop);
    data:=jsonb_build_object('reviewedBy',auth.uid(),'reviewedAt',now(),'reviewNote',nullif(trim(coalesce(data->>'note','')),''))||private.workspace_repair_owner_snapshot(prop);
    if private.workspace_repair_owner_needed(prop,amount,d.data) then
     data:=data||jsonb_build_object('phase','owner_approval','resumePhase',coalesce(d.data->>'resumePhase','referred'));
    else
     data:=data||jsonb_build_object('phase',coalesce(d.data->>'resumePhase','referred'),'resumePhase',null,'autoApprovedAt',now(),'autoApprovedMinor',amount,'autoApprovalLimitMinor',(entry->>'limitMinor')::bigint,'autoApprovalSource',entry->>'source');
    end if;
    notify_users:=private.workspace_repair_managers()||private.workspace_repair_team(prop,d.data,false)||array(select (d.data->>'assignedReadyId')::uuid where d.data->>'assignedReadyId' is not null);
   elsif kind='maintenance' and step='bookRepair' then$r$,
   $s$elsif kind='maintenance' and step='reassignReady' then$s$],
  -- 5. The contractor's estimate, with its files.
  ['private.workspace_operations_action(jsonb)',
   $a$perform private.workspace_json_keys(data,array['quoteMinor','reason','quoteSource']);entry:=jsonb_build_object('quoteSource',private.workspace_repair_quote_source(data));$a$,
   $r$perform private.workspace_json_keys(data,array['quoteMinor','reason','quoteSource','quoteFileIds']);if actor='ready' then data:=data||'{"quoteSource":"contractor"}'::jsonb;end if;entry:=jsonb_build_object('quoteSource',private.workspace_repair_quote_source(data));entry:=entry||jsonb_build_object('quoteFileIds',private.workspace_repair_files(target,data->'quoteFileIds'),'teamReview',actor='ready');$r$,
   $s$entry:=entry||jsonb_build_object('quoteFileIds',$s$],
  ['private.workspace_operations_action(jsonb)',
   $a$data:=data||entry;data:=data||private.workspace_repair_requote(prop,amount,d.data,data);$a$,
   $r$data:=data||entry;data:=data||private.workspace_repair_requote(prop,amount,d.data,data);
    if actor='ready' then
     data:=data||jsonb_build_object('phase','team_review','resumePhase',case when d.data->>'phase'='booked' then 'booked' when d.data->>'phase'='team_review' then coalesce(d.data->>'resumePhase','referred') else 'referred' end,
      'teamReview',true,'reviewedBy',null,'reviewedAt',null,'reviewNote',null,'autoApprovedAt',null,'autoApprovedMinor',null,'autoApprovalLimitMinor',null,'autoApprovalSource',null)||private.workspace_repair_owner_snapshot(prop);
     notify_users:=private.workspace_repair_team(prop,d.data,false);
     insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(auth.uid(),prop,target,'operations.updateOperation.estimateToReview') returning id into event_id;
     insert into private.workspace_notification_outbox(user_id,work_id,event_id) select m,target,event_id from unnest(private.workspace_repair_managers()) m where m is distinct from auth.uid() on conflict do nothing;
    else data:=data||jsonb_build_object('teamReview',false);end if;$r$,
   $s$data:=data||jsonb_build_object('phase','team_review',$s$],
  ['private.workspace_operations_action(jsonb)',
   $a$coalesce(d.data->>'phase','') not in ('triage','referred','booked','owner_declined','management_declined')$a$,
   $r$coalesce(d.data->>'phase','') not in ('triage','referred','booked','team_review','owner_declined','management_declined')$r$,
   $s$('triage','referred','booked','team_review','owner_declined'$s$],
  -- 6. A visit window, with the stays it clashes with.
  ['private.workspace_operations_action(jsonb)',
   $a$perform private.workspace_json_keys(data,array['repairOn','contractor','guestUpdate']);$a$,
   $r$perform private.workspace_json_keys(data,array['repairOn','contractor','guestUpdate','visitFrom','visitTo']);data:=data||private.workspace_repair_visit(prop,d.data,data);$r$,
   $s$data:=data||private.workspace_repair_visit(prop,d.data,data);$s$],
  ['private.workspace_operations_action(jsonb)',
   $a$update public.workspace_work_items set due_on=(data->>'repairOn')::date where id=target;$a$,
   $r$update public.workspace_work_items set due_on=(data->>'repairOn')::date,due_time=(data->>'visitFrom')::time,due_end_time=(data->>'visitTo')::time where id=target;$r$,
   $s$due_time=(data->>'visitFrom')::time,due_end_time=(data->>'visitTo')::time$s$],
  ['private.workspace_operations_action(jsonb)',
   $a$result:=private.workspace_operation_view(target);$a$,
   $r$result:=private.workspace_operation_view(target);if a='updateOperation' and step='bookRepair' then result:=result||jsonb_build_object('clashes',coalesce(result->'data'->'clashes','[]'::jsonb));end if;$r$,
   $s$result:=result||jsonb_build_object('clashes',$s$],
  -- 7. The contractor's invoice on completion.
  ['private.workspace_operations_action(jsonb)',
   $a$perform private.workspace_json_keys(data,array['report','actualCostMinor','guestUpdate','photoIds']);$a$,
   $r$perform private.workspace_json_keys(data,array['report','actualCostMinor','guestUpdate','photoIds','invoiceFileIds']);perform private.workspace_repair_files(target,data->'invoiceFileIds');$r$,
   $s$perform private.workspace_repair_files(target,data->'invoiceFileIds');$s$],
  -- 8. Approved to book: stamped, and the contractor is told.
  ['private.workspace_operations_action(jsonb)',
   $a$update private.workspace_domain_details set data=d.data||operation.data||jsonb_build_object('workStatus',next_status),updated_at=now() where work_id=target;$a$,
   $r$if kind='maintenance' then entry:=private.workspace_repair_after_step(step,d.data,data);data:=data||(entry->'data');
    if coalesce((entry->>'approved')::boolean,false) then
     notify_users:=array_remove(notify_users,(entry->>'readyId')::uuid);
     if coalesce((entry->>'alex')::boolean,false) then notify_users:=notify_users||private.workspace_repair_managers();end if;
     insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(auth.uid(),prop,target,'operations.updateOperation.approvedToBook') returning id into event_id;
     insert into private.workspace_notification_outbox(user_id,work_id,event_id) select (entry->>'readyId')::uuid,target,event_id where (entry->>'readyId')::uuid is distinct from auth.uid() on conflict do nothing;
    end if;
   end if;
   update private.workspace_domain_details set data=d.data||operation.data||jsonb_build_object('workStatus',next_status),updated_at=now() where work_id=target;$r$,
   $s$entry:=private.workspace_repair_after_step(step,d.data,data);$s$],
  -- 9. A re-quote on a repair with a contractor resumes to referred.
  ['private.workspace_repair_requote(uuid,bigint,jsonb,jsonb)',
   $a$else coalesce(repair->>'phase','triage') end;$a$,
   $r$else coalesce(repair->>'phase','triage') end;if resume='triage' and repair->>'assignedReadyId' is not null then resume:='referred';end if;$r$,
   $s$if resume='triage' and repair->>'assignedReadyId' is not null then$s$],
  ['private.workspace_repair_requote(uuid,bigint,jsonb,jsonb)',
   $a$resume:=case when repair->>'phase' in ('owner_approval','management_approval','owner_declined','management_declined') then$a$,
   $r$resume:=case when repair->>'phase' in ('owner_approval','management_approval','team_review','owner_declined','management_declined') then$r$,
   $s$('owner_approval','management_approval','team_review',$s$],
  -- A contractor's estimate is reviewed by the team, not approved by management.
  ['private.workspace_repair_needs_management(bigint,jsonb)',
   $a$select (coalesce(repair->>'quoteSource','')='contractor'$a$,
   $r$select not coalesce((repair->>'teamReview')::boolean,false) and (coalesce(repair->>'quoteSource','')='contractor'$r$,
   $s$select not coalesce((repair->>'teamReview')::boolean,false) and$s$],
  -- The owner's pre-authorisation is the effective limit (Limit Changer, else the set-up form).
  ['private.workspace_repair_needs_owner(uuid,bigint,jsonb)',
   $a$not coalesce((select coalesce((j.form->>'fullRepairPermission')::boolean,false) or amount<=coalesce((j.form->>'repairLimitMinor')::bigint,0) from private.workspace_journeys j where j.property_id=prop),false)$a$,
   $r$not private.workspace_repair_owner_allows(prop,amount)$r$,
   $s$not private.workspace_repair_owner_allows(prop,amount)$s$],
  -- 10. One contractor per job, everywhere a repair is read; the contractor never sees the owner's limit.
  ['private.workspace_operation_view(uuid)',
   $a$else d.data end)$a$,
   $r$when private.workspace_actor_role()='ready' and d.kind='maintenance' then d.data-'ownerLimitMinor'-'ownerFullPermission'-'ownerLimitSource'-'autoApprovalLimitMinor'-'autoApprovalSource' else d.data end)$r$,
   $s$d.data-'ownerLimitMinor'-'ownerFullPermission'$s$],
  ['private.workspace_can_work(uuid)',
   $a$select exists(select 1 from public.workspace_work_items w join public.workspace_features f using(module_id) where w.id=target and ($a$,
   $r$select (private.workspace_actor_role() is distinct from 'ready' or private.workspace_repair_ready_sees(target,auth.uid())) and exists(select 1 from public.workspace_work_items w join public.workspace_features f using(module_id) where w.id=target and ($r$,
   $s$private.workspace_repair_ready_sees(target,auth.uid())) and exists($s$],
  ['private.workspace_operation_access(uuid)',
   $a$d.kind='maintenance' and d.data->>'referredAt' is not null and private.workspace_can_property(w.property_id,'maintenance-reporting')$a$,
   $r$d.kind='maintenance' and d.data->>'referredAt' is not null and private.workspace_can_property(w.property_id,'maintenance-reporting') and private.workspace_repair_ready_sees(w.id,auth.uid())$r$,
   $s$and private.workspace_repair_ready_sees(w.id,auth.uid())$s$],
  ['private.integration_can_work(uuid,uuid)',
   $a$where p.user_id=subject and p.status='active' and ($a$,
   $r$where p.user_id=subject and p.status='active' and (p.role<>'ready' or private.workspace_repair_ready_sees(target,subject)) and ($r$,
   $s$(p.role<>'ready' or private.workspace_repair_ready_sees(target,subject))$s$],
  ['private.chat_can(uuid,uuid)',
   $a$where c.id=target and ($a$,
   $r$where c.id=target and (c.work_id is null or p.role<>'ready' or private.workspace_repair_ready_sees(c.work_id,subject)) and ($r$,
   $s$private.workspace_repair_ready_sees(c.work_id,subject)$s$],
  ['private.chat_start_property(jsonb)',
   $a$where a.property_id=prop and ((a.assignment='staff' and p.role in ('stays','ready'))$a$,
   $r$where a.property_id=prop and ((a.assignment='staff' and p.role in ('stays','ready') and (wid is null or p.role<>'ready' or private.workspace_repair_ready_sees(wid,a.user_id)))$r$,
   $s$private.workspace_repair_ready_sees(wid,a.user_id)$s$],
  ['private.workspace_notice_route_activity()',
   $a$join public.workspace_profiles p on p.user_id=a.user_id and p.role=r.role and p.status='active'$a$,
   $r$join public.workspace_profiles p on p.user_id=a.user_id and p.role=r.role and p.status='active' and (p.role<>'ready' or private.workspace_repair_ready_sees(new.work_id,p.user_id))$r$,
   $s$(p.role<>'ready' or private.workspace_repair_ready_sees(new.work_id,p.user_id))$s$],
  ['private.workspace_ready_home()',
   $a$and (private.workspace_can_property(w.property_id,'maintenance-reporting') or private.workspace_can_property(w.property_id,'stays-maintenance-reporting'))$a$,
   $r$and (private.workspace_can_property(w.property_id,'maintenance-reporting') or private.workspace_can_property(w.property_id,'stays-maintenance-reporting')) and (actor<>'ready' or private.workspace_repair_ready_sees(w.id,auth.uid()))$r$,
   $s$(actor<>'ready' or private.workspace_repair_ready_sees(w.id,auth.uid()))$s$],
  -- 11. Files are not photos: not after photos, and not before or after photos on the draft expense,
  --     where the invoice and the estimate are their own evidence.
  ['private.workspace_check_repair_photos(uuid,jsonb)',
   $a$m.work_id=repair and m.purpose='maintenance' and m.id::text in$a$,
   $r$m.work_id=repair and m.purpose='maintenance' and m.asset_format is distinct from 'pdf' and m.id::text in$r$,
   $s$m.asset_format is distinct from 'pdf'$s$],
  ['private.workspace_repair_draft_expense(uuid,bigint,jsonb)',
   $a$from (select x.id from private.workspace_media_evidence x where x.work_id=repair and x.purpose='maintenance' order by$a$,
   $r$from (select x.id from private.workspace_media_evidence x where x.work_id=repair and x.purpose='maintenance' and x.asset_format is distinct from 'pdf' and not coalesce(report->'invoiceFileIds','[]'::jsonb) ? x.id::text and not coalesce(d.data->'quoteFileIds','[]'::jsonb) ? x.id::text order by$r$,
   $s$and not coalesce(report->'invoiceFileIds','[]'::jsonb) ? x.id::text$s$],
  ['private.workspace_repair_draft_expense(uuid,bigint,jsonb)',
   $a$insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(auth.uid(),w.property_id,repair,'finance.expense_drafted');$a$,
   $r$insert into private.workspace_expense_evidence(expense_id,kind,label,media_id,added_by)
  select e.id,'invoice','Contractor invoice',m.id,auth.uid() from private.workspace_media_evidence m where m.work_id=repair and m.purpose='maintenance' and jsonb_typeof(report->'invoiceFileIds')='array' and report->'invoiceFileIds' ? m.id::text order by m.verified_at,m.id;
 insert into private.workspace_expense_evidence(expense_id,kind,label,media_id,added_by)
  select e.id,'quote','Contractor estimate',m.id,auth.uid() from private.workspace_media_evidence m where m.work_id=repair and m.purpose='maintenance' and jsonb_typeof(d.data->'quoteFileIds')='array' and d.data->'quoteFileIds' ? m.id::text order by m.verified_at,m.id;
 insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(auth.uid(),w.property_id,repair,'finance.expense_drafted');$r$,
   $s$'invoice','Contractor invoice',m.id$s$],
  -- 12. A repair's own files may be PDFs.
  ['private.integration_commit_upload(uuid,jsonb)',
   $a$coalesce(asset->>'format','') not in ('jpg','png','webp')$a$,
   $r$coalesce(asset->>'format','') not in ('jpg','png','webp','pdf') or (asset->>'format'='pdf' and not (i.purpose='maintenance' and kind='maintenance'))$r$,
   $s$(asset->>'format'='pdf' and not (i.purpose='maintenance' and kind='maintenance'))$s$],
  -- 13. Owners see the job, never which staff account does it, why it moved, management's review note or the guest conversation.
  ['private.workspace_owner_work_data(jsonb)',
   $a$-'managementNote'-'managementDeclinedReason')$a$,
   $r$-'managementNote'-'managementDeclinedReason'-'assignedReadyId'-'assignedReadyName'-'previousReadyId'-'previousReadyName'-'reassignReason'-'reviewNote'-'guestConversationId')$r$,
   $s$-'assignedReadyId'-'assignedReadyName'$s$],
  -- 14. Ready lockdown: no guest names...
  ['private.workspace_guest_name_visible(text)',
   $a$'admin','super_admin','stays','ready','accounts'$a$,
   $r$'admin','super_admin','stays','accounts'$r$,
   $s$'admin','super_admin','stays','accounts'$s$],
  -- ...and only the inspection part of an onboarding journey.
  ['private.workspace_journey_view(private.workspace_journeys)',
   $a$safe_form:=j.form-'bankAccountName'-'bankAccountNumber'-'bankSortCode'-'accessInfo';$a$,
   $r$safe_form:=j.form-'bankAccountName'-'bankAccountNumber'-'bankSortCode'-'accessInfo';
 if private.workspace_actor_role()='ready' then
  return jsonb_build_object('propertyId',j.property_id,'workId',j.work_id,'stage',j.stage,'propertyType',j.property_type,'bathrooms',j.bathrooms,
   'inspectionOn',j.inspection_on,'inspectionCompletedAt',j.inspection_completed_at,'inspectionReport',j.inspection_report,'inspectionChecks',j.inspection_checks,'version',j.version);
 end if;$r$,
   $s$if private.workspace_actor_role()='ready' then$s$]
 ];
 definition text;hits integer;
begin
 for i in 1..array_length(fixes,1) loop
  -- The guest name rule comes from the team calendar migration; a database built without it (its own test) has no rule to change.
  if fixes[i][1]='private.workspace_guest_name_visible(text)' and to_regprocedure(fixes[i][1]) is null then continue;end if;
  definition:=pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in definition)=0 then
   hits:=(length(definition)-length(replace(definition,fixes[i][2],'')))/length(fixes[i][2]);
   if hits<>1 then raise exception 'Patch anchor found % times in % (patch %)',hits,fixes[i][1],i;end if;
   execute replace(definition,fixes[i][2],fixes[i][3]);
   if position(fixes[i][4] in pg_get_functiondef(fixes[i][1]::regprocedure))=0 then raise exception 'Patch did not take in % (patch %)',fixes[i][1],i;end if;
  end if;
 end loop;
end $patch$;

revoke all on function private.workspace_repair_ready_sees(uuid,uuid),private.workspace_repair_assign(uuid,text),private.workspace_repair_chat_join(uuid,uuid),
 private.workspace_repair_guest_thread(uuid,jsonb),private.workspace_repair_files(uuid,jsonb),private.workspace_repair_clashes(uuid,date,time,time),
 private.workspace_repair_visit(uuid,jsonb,jsonb),private.workspace_repair_after_step(text,jsonb,jsonb),private.workspace_repair_contractors(uuid),
 private.workspace_repair_owner_limit(uuid),private.workspace_repair_owner_allows(uuid,bigint),private.workspace_repair_owner_snapshot(uuid),private.workspace_repair_owner_needed(uuid,bigint,jsonb),
 private.workspace_repair_limit_row(uuid),private.workspace_repair_limits_read(),private.workspace_repair_limits_action(jsonb) from public,anon,authenticated;
-- integration_can_work runs as the backend (service_role), not as a definer.
grant execute on function private.workspace_repair_ready_sees(uuid,uuid) to service_role;
revoke all on function public.workspace_repair_contractors(uuid) from public,anon;
revoke all on function public.workspace_repair_limits_read(),public.workspace_repair_limits_action(jsonb) from public,anon;
grant execute on function private.workspace_repair_contractors(uuid),public.workspace_repair_contractors(uuid),
 private.workspace_repair_limits_read(),public.workspace_repair_limits_read(),private.workspace_repair_limits_action(jsonb),public.workspace_repair_limits_action(jsonb) to authenticated;
