-- Paste into the Supabase SQL editor and run. Safe to run more than once.
-- Part 1: deleting your own account and the daily privacy clean-up.
-- Takes away everything that lets someone in or reaches them.
create or replace function private.workspace_remove_account_access(target uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.workspace_end_sessions(target);
 delete from private.auth_recovery_proofs where user_id=target;
 delete from public.workspace_module_grants where user_id=target;
 delete from public.workspace_property_assignments where user_id=target;
 delete from private.workspace_device_tokens where user_id=target;
 delete from private.workspace_web_push where user_id=target;
 delete from private.workspace_notification_deliveries where outbox_id in (select id from private.workspace_notification_outbox where user_id=target);
 delete from private.workspace_notification_outbox where user_id=target;
 delete from private.workspace_write_limits where user_id=target;
 delete from private.chat_members where user_id=target;
 delete from private.chat_reads where user_id=target;
 delete from private.workspace_staff_rota where user_id=target;
 delete from private.workspace_onboarding_done where user_id=target;
 -- Photos chosen but never saved belong to nobody else.
 delete from private.workspace_upload_intents where owner_id=target and evidence_id is null;
 -- Request receipts only stop a repeated tap doing something twice; they hold what was typed.
 delete from private.workspace_action_receipts where actor_id=target;
 update private.workspace_bank_details set owner_id=null where owner_id=target;
end $$;

create or replace function private.workspace_delete_own_account(target uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare person public.workspace_profiles; kept integer; admins uuid[]; ev bigint; referenced boolean; removable boolean:=true; r record;
begin
 if auth.uid() is not null then raise exception 'Stateless server context required' using errcode='42501';end if;
 person:=(select p from public.workspace_profiles p where p.user_id=target for update);
 if person.user_id is null then raise exception 'Account not found' using errcode='P0002';end if;
 if exists(select 1 from private.workspace_closed_accounts c where c.user_id=target) and person.full_name='Deleted user' then
  return jsonb_build_object('userId',target,'removable',false,'alreadyDeleted',true);
 end if;
 if person.role='super_admin' and person.status='active' and not exists(select 1 from public.workspace_profiles p where p.user_id<>target and p.role='super_admin' and p.status='active') then
  raise exception 'You are the only super admin. Make someone else a super admin first, then delete your account.' using errcode='42501';
 end if;
 kept:=(select count(*) from (select a.property_id from public.workspace_property_assignments a where a.user_id=target and a.assignment='client'
  union select j.property_id from private.workspace_journeys j where j.client_id=target) owned);
 insert into private.workspace_account_deletions(user_id,role,properties_kept) values(target,person.role,kept);
 insert into public.workspace_access_events(user_id,actor_id,event_type,old_access,new_access)
  values(target,target,'account_deleted',jsonb_build_object('role',person.role,'status',person.status),jsonb_build_object('self',true));
 -- Admins hear about it when an owner or a team member who had access leaves.
 if person.status='active' then
  admins:=array(select p.user_id from public.workspace_profiles p where p.role in ('admin','super_admin') and p.status='active' and p.user_id<>target);
  if cardinality(admins)>0 then
   insert into public.workspace_activity(actor_id,event_type) values(null,case when person.role='client' then 'account.owner_deleted' else 'account.staff_deleted' end) returning id into ev;
   insert into private.workspace_notification_outbox(user_id,event_id) select distinct u,ev from unnest(admins) u;
  end if;
 end if;
 perform private.workspace_remove_account_access(target);
 -- Personal details go; the role stays so old records still read sensibly.
 update public.workspace_profiles set full_name='Deleted user',responsibilities='',avatar_preset='ocean',status='revoked',updated_at=now() where user_id=target;
 update auth.users set email=null,raw_user_meta_data='{}'::jsonb where id=target;
 if exists(select 1 from information_schema.columns where table_schema='auth' and table_name='users' and column_name='phone') then
  execute 'update auth.users set phone=null where id=$1' using target;
 end if;
 insert into private.workspace_password_revocations(user_id,revoked_by) values(target,null) on conflict(user_id) do nothing;
 perform private.workspace_set_sign_in_blocked(target,true);
 -- The sign-in can be removed outright only when nothing in the workspace refers to the person;
 -- otherwise the anonymised profile stays so their records keep pointing at "Deleted user".
 for r in select c.conrelid::regclass::text as tbl,a.attname from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
  where c.contype='f' and c.confrelid='public.workspace_profiles'::regclass and c.conrelid<>'private.workspace_closed_accounts'::regclass loop
  execute format('select exists(select 1 from %s where %I=$1)',r.tbl,r.attname) into referenced using target;
  if referenced then removable:=false; exit; end if;
 end loop;
 if not removable then insert into private.workspace_closed_accounts(user_id,closed_by) values(target,null) on conflict do nothing; end if;
 return jsonb_build_object('userId',target,'removable',removable,'propertiesKept',kept);
end $$;

-- Records how the sign-in itself was removed (deleted outright, closed by the sign-in service, or failed).
create or replace function private.workspace_account_deletion_signin(target uuid, outcome text) returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is not null then raise exception 'Stateless server context required' using errcode='42501';end if;
 if outcome not in ('deleted','closed','failed') then raise exception 'Invalid outcome' using errcode='22023';end if;
 update private.workspace_account_deletions set sign_in=outcome where id=(select max(d.id) from private.workspace_account_deletions d where d.user_id=target);
end $$;

create or replace function public.workspace_delete_own_account(target uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.workspace_delete_own_account(target); $$;
create or replace function public.workspace_account_deletion_signin(target uuid, outcome text) returns void language sql security invoker set search_path='' as $$ select private.workspace_account_deletion_signin(target,outcome); $$;
revoke all on function private.workspace_remove_account_access(uuid),private.workspace_delete_own_account(uuid),private.workspace_account_deletion_signin(uuid,text),
 public.workspace_delete_own_account(uuid),public.workspace_account_deletion_signin(uuid,text) from public,anon,authenticated;
grant execute on function private.workspace_delete_own_account(uuid),private.workspace_account_deletion_signin(uuid,text),
 public.workspace_delete_own_account(uuid),public.workspace_account_deletion_signin(uuid,text) to service_role;

-- ---------------------------------------------------------------------------------------------
-- Retention (server only, run by the scheduled job; does its work once a day)
-- ---------------------------------------------------------------------------------------------
create or replace function private.workspace_privacy_retention(at_time timestamptz default now()) returns jsonb language plpgsql security definer set search_path='' as $$
declare today date:=(at_time at time zone 'Europe/London')::date; notices integer; logins integer; events integer; proofs integer; approvals integer; leftovers integer:=0; audits integer; summary jsonb; r record;
begin
 if auth.uid() is not null then raise exception 'Stateless server context required' using errcode='42501';end if;
 insert into private.workspace_privacy_runs(day) values(today) on conflict do nothing;
 if not found then return jsonb_build_object('skipped',true); end if;
 -- Notifications that have been read, once they are 12 months old.
 delete from private.workspace_notification_deliveries d using private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id
  where d.outbox_id=o.id and o.read_at is not null and a.created_at<at_time-interval '12 months';
 delete from private.workspace_notification_outbox o using public.workspace_activity a
  where a.id=o.event_id and o.read_at is not null and a.created_at<at_time-interval '12 months';
 get diagnostics notices=row_count;
 -- Sign-in security records: failed-password counters and lockouts, and sign-in events, after 90 days.
 delete from private.auth_login_state s where s.updated_at<at_time-interval '90 days' and (s.locked_until is null or s.locked_until<at_time);
 get diagnostics logins=row_count;
 delete from private.auth_login_attempts a where a.expires_at<at_time;
 delete from private.authentication_events e where e.occurred_at<at_time-interval '90 days';
 get diagnostics events=row_count;
 delete from private.auth_request_limits l where l.expires_at<at_time;
 -- Password reset proofs that have expired, and sign-in approvals that ended over a day ago.
 delete from private.auth_recovery_proofs p where p.expires_at<at_time;
 get diagnostics proofs=row_count;
 delete from private.workspace_approved_sessions s where s.expires_at<at_time-interval '1 day';
 get diagnostics approvals=row_count;
 -- Anything still attached to a deleted (anonymised) account.
 for r in select c.user_id from private.workspace_closed_accounts c join public.workspace_profiles p on p.user_id=c.user_id
  where p.full_name='Deleted user' and p.status='revoked'
   and (exists(select 1 from public.workspace_module_grants g where g.user_id=c.user_id) or exists(select 1 from public.workspace_property_assignments a where a.user_id=c.user_id)
    or exists(select 1 from private.workspace_approved_sessions s where s.user_id=c.user_id) or exists(select 1 from private.workspace_web_push w where w.user_id=c.user_id)
    or exists(select 1 from private.workspace_device_tokens t where t.user_id=c.user_id) or exists(select 1 from private.workspace_notification_outbox o where o.user_id=c.user_id)
    or exists(select 1 from private.chat_members m where m.user_id=c.user_id) or exists(select 1 from private.workspace_action_receipts x where x.actor_id=c.user_id)) loop
  perform private.workspace_remove_account_access(r.user_id);
  leftovers:=leftovers+1;
 end loop;
 -- The deletion audit itself is kept for six years.
 delete from private.workspace_account_deletions d where d.deleted_at<at_time-interval '6 years';
 get diagnostics audits=row_count;
 summary:=jsonb_build_object('notifications',notices,'loginRecords',logins,'signInEvents',events,'recoveryProofs',proofs,'sessionApprovals',approvals,'deletedAccounts',leftovers,'deletionAudits',audits);
 update private.workspace_privacy_runs set result=summary where day=today;
 return summary;
end $$;
create or replace function public.workspace_privacy_retention() returns jsonb language sql security invoker set search_path='' as $$ select private.workspace_privacy_retention(now()); $$;
revoke all on function private.workspace_privacy_retention(timestamptz),public.workspace_privacy_retention() from public,anon,authenticated;
grant execute on function private.workspace_privacy_retention(timestamptz),public.workspace_privacy_retention() to service_role;

-- Part 2: photo-required clean checklists.
-- Photo-required checklist items for cleans.
-- * Clean checklists: one for every property, and optionally one for a property, kept by admins and
--   cleaning managers. Each check can need photos, and how many (1 to 5). New Hostaway checkout
--   cleans use the property's checklist.
-- * A clean photo can belong to one check on the clean's checklist. A clean can only be submitted
--   once every check that needs photos has them, from the cleaner who submits it.
-- * Nothing changes for cleans at properties without a checklist, or for checks that are not on it.
-- The Today / Tomorrow / Overdue board on Home uses existing reads and needs no SQL.
-- Safe to run more than once.

-- 1. The checklists. One row per property, and one with no property for every property.
create table if not exists private.clean_checklist_templates(
 id uuid primary key default gen_random_uuid(),
 property_id uuid references public.workspace_properties(id) on delete cascade,
 items jsonb not null check(jsonb_typeof(items)='array' and jsonb_array_length(items) between 1 and 30),
 version integer not null default 1,
 updated_by uuid,
 updated_at timestamptz not null default now(),
 created_at timestamptz not null default now()
);
create unique index if not exists clean_checklist_templates_scope on private.clean_checklist_templates((coalesce(property_id,'00000000-0000-0000-0000-000000000000'::uuid)));
alter table private.clean_checklist_templates enable row level security;
revoke all on private.clean_checklist_templates from public,anon,authenticated;

-- 2. The check a photo was taken for (null for every other photo).
alter table private.workspace_upload_intents add column if not exists checklist_item text;
alter table private.workspace_media_evidence add column if not exists checklist_item text;
alter table private.workspace_upload_intents drop constraint if exists workspace_upload_intents_checklist_item_check;
alter table private.workspace_upload_intents add constraint workspace_upload_intents_checklist_item_check check(checklist_item is null or (purpose='cleaning' and length(checklist_item) between 1 and 200));
alter table private.workspace_media_evidence drop constraint if exists workspace_media_evidence_checklist_item_check;
alter table private.workspace_media_evidence add constraint workspace_media_evidence_checklist_item_check check(checklist_item is null or (purpose='cleaning' and length(checklist_item) between 1 and 200));
create index if not exists workspace_media_evidence_checklist_item on private.workspace_media_evidence(work_id,checklist_item) where checklist_item is not null;

-- 3. The checklist that applies at a property: its own, otherwise the one for every property.
create or replace function private.clean_template_for(target_property uuid) returns private.clean_checklist_templates
language sql stable security definer set search_path='' as $$
 select t.* from private.clean_checklist_templates t where t.property_id=target_property or t.property_id is null
 order by t.property_id is null limit 1
$$;

-- The check names, in order, for a new clean at a property; null when no checklist is set.
create or replace function private.clean_template_labels(target_property uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_agg(x.i->>'label' order by x.n) from private.clean_checklist_templates t cross join lateral jsonb_array_elements(t.items) with ordinality x(i,n)
 where t.id=(private.clean_template_for(target_property)).id
$$;

-- The checks on a clean's checklist that need photos, and how many: [{label, minPhotos}].
-- Empty when the property has no checklist, or none of the clean's checks need photos.
create or replace function private.clean_photo_rules(target_property uuid, checklist jsonb) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('label',x.i->>'label','minPhotos',greatest(coalesce((x.i->>'minPhotos')::int,1),1)) order by x.n),'[]')
 from private.clean_checklist_templates t cross join lateral jsonb_array_elements(t.items) with ordinality x(i,n)
 where t.id=(private.clean_template_for(target_property)).id and coalesce((x.i->>'photoRequired')::boolean,false)
  and jsonb_typeof(checklist)='array' and checklist ? (x.i->>'label')
$$;

-- Refuses a clean while a check still needs photos from the cleaner, naming the checks.
create or replace function private.clean_photo_check(target_work uuid, target_property uuid, checklist jsonb, cleaner uuid) returns void
language plpgsql stable security definer set search_path='' as $$
declare missing text[];
begin
 missing:=array(select left(r.v->>'label',40)||case when (r.v->>'minPhotos')::int-c.n>1 then ' ('||((r.v->>'minPhotos')::int-c.n)||' photos)' else '' end
  from jsonb_array_elements(private.clean_photo_rules(target_property,checklist)) with ordinality r(v,k)
  cross join lateral (select count(*)::int n from private.workspace_media_evidence e where e.work_id=target_work and e.owner_id=cleaner and e.purpose='cleaning' and e.checklist_item=r.v->>'label') c
  where c.n<(r.v->>'minPhotos')::int order by r.k);
 if cardinality(missing)>0 then
  raise exception '%',left('Add the photos these checks need before you submit: '||array_to_string(missing[1:3],', ')
   ||case when cardinality(missing)>3 then ' and '||(cardinality(missing)-3)||' more' else '' end,200) using errcode='22023';
 end if;
end $$;

-- 4. Reading checklists: the list to edit (teams who schedule cleans), and the photo rules on one
-- clean (anyone who can open the clean, including its cleaner).
create or replace function private.clean_checklists_read(section text, target uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();w public.workspace_work_items;d private.workspace_domain_details;
begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 if section='templates' then
  if actor not in ('cleaning_manager','stays','admin','super_admin') or not private.has_workspace_module('cleaning-schedule') then raise exception 'Cleaning schedule access required' using errcode='42501';end if;
  return jsonb_build_object('canEdit',actor in ('cleaning_manager','admin','super_admin'),
   'templates',(select coalesce(jsonb_agg(jsonb_build_object('propertyId',t.property_id,'propertyName',p.name,'items',t.items,'version',t.version,'updatedAt',t.updated_at)
     order by t.property_id is not null,p.name,t.property_id),'[]')
    from private.clean_checklist_templates t left join public.workspace_properties p on p.id=t.property_id
    where t.property_id is null or private.workspace_can_property(t.property_id,'cleaning-schedule')));
 elsif section='clean' then
  if target is null or not private.workspace_operation_access(target) then raise exception 'Work access denied' using errcode='42501';end if;
  w:=(select x from public.workspace_work_items x where x.id=target);
  d:=(select x from private.workspace_domain_details x where x.work_id=target);
  if d.kind is distinct from 'cleaning' then raise exception 'Choose a clean' using errcode='22023';end if;
  return jsonb_build_object('workId',target,'rules',private.clean_photo_rules(w.property_id,d.data->'checklist'));
 end if;
 raise exception 'Unknown checklist section' using errcode='22023';
end $$;

-- 5. Saving or removing a checklist. Admins edit any; cleaning managers the one for every property
-- and those for their own properties. Stays and cleaners only read.
create or replace function private.clean_checklists_action(input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();a text;req uuid;prop uuid;prior private.workspace_action_receipts;t private.clean_checklist_templates;new_items jsonb;result jsonb;
begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 a:=private.workspace_required_text(input,'action',1,60);req:=(input->>'requestId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 prior:=(select r from private.workspace_action_receipts r where r.actor_id=auth.uid() and r.request_id=req);
 if prior.request_id is not null then
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;
 if a not in ('saveTemplate','removeTemplate') then raise exception 'Unknown checklist action' using errcode='22023';end if;
 perform private.workspace_json_keys(input,case when a='saveTemplate' then array['action','requestId','propertyId','version','items'] else array['action','requestId','propertyId','version'] end);
 prop:=(input->>'propertyId')::uuid;
 if not (actor in ('admin','super_admin') or (actor='cleaning_manager' and private.has_workspace_module('cleaning-schedule') and (prop is null or private.workspace_can_property(prop,'cleaning-schedule')))) then
  raise exception 'Only admins and cleaning managers can change cleaning checklists' using errcode='42501';
 end if;
 if prop is not null and not exists(select 1 from public.workspace_properties p where p.id=prop) then raise exception 'Property not found' using errcode='P0002';end if;
 if coalesce(input->>'version','')!~'^\d{1,9}$' then raise exception 'Checklist version required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('clean-checklist:'||coalesce(prop::text,'all'),0));
 t:=(select x from private.clean_checklist_templates x where x.property_id is not distinct from prop);
 if a='removeTemplate' and t.id is null then raise exception 'There is no checklist to remove' using errcode='P0002';end if;
 if coalesce(t.version,0)<>(input->>'version')::int then raise exception 'Checklist changed' using errcode='40001';end if;
 if a='saveTemplate' then
  new_items:=input->'items';
  if jsonb_typeof(new_items) is distinct from 'array' or jsonb_array_length(new_items) not between 1 and 30
   or exists(select 1 from jsonb_array_elements(new_items) i where jsonb_typeof(i)<>'object'
    or exists(select 1 from jsonb_object_keys(i) k where k not in ('label','photoRequired','minPhotos'))
    or jsonb_typeof(i->'label') is distinct from 'string' or length(trim(i->>'label')) not between 1 and 200
    or jsonb_typeof(i->'photoRequired') is distinct from 'boolean'
    or (i ? 'minPhotos' and (jsonb_typeof(i->'minPhotos') is distinct from 'number' or (i->>'minPhotos')!~'^[1-5]$')))
   or (select count(distinct trim(i->>'label')) from jsonb_array_elements(new_items) i)<>jsonb_array_length(new_items)
  then raise exception 'Give each check a different name (up to 30 checks) and ask for 1 to 5 photos' using errcode='22023';end if;
  -- Stored tidy: trimmed names, and a number of photos only on checks that need them.
  new_items:=(select jsonb_agg(jsonb_build_object('label',trim(x.i->>'label'),'photoRequired',(x.i->>'photoRequired')::boolean)
    ||case when (x.i->>'photoRequired')::boolean then jsonb_build_object('minPhotos',coalesce((x.i->>'minPhotos')::int,1)) else '{}'::jsonb end order by x.n)
   from jsonb_array_elements(input->'items') with ordinality x(i,n));
  if t.id is null then
   insert into private.clean_checklist_templates(property_id,items,updated_by) values(prop,new_items,auth.uid()) returning * into t;
  else
   update private.clean_checklist_templates set items=new_items,version=version+1,updated_by=auth.uid(),updated_at=now() where id=t.id returning * into t;
  end if;
  result:=jsonb_build_object('propertyId',prop,'items',t.items,'version',t.version);
 else
  delete from private.clean_checklist_templates where id=t.id;
  result:=jsonb_build_object('propertyId',prop,'removed',true);
 end if;
 insert into public.workspace_activity(actor_id,property_id,event_type) values(auth.uid(),prop,case a when 'saveTemplate' then 'cleaning.checklist_saved' else 'cleaning.checklist_removed' end);
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $$;

create or replace function public.clean_checklists_read(section text, target uuid default null) returns jsonb language sql security invoker set search_path='' as $$select private.clean_checklists_read(section,target);$$;
create or replace function public.clean_checklists_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $$select private.clean_checklists_action(input);$$;
revoke all on function private.clean_template_for(uuid),private.clean_template_labels(uuid),private.clean_photo_rules(uuid,jsonb),private.clean_photo_check(uuid,uuid,jsonb,uuid) from public,anon,authenticated;
revoke all on function private.clean_checklists_read(text,uuid),private.clean_checklists_action(jsonb),public.clean_checklists_read(text,uuid),public.clean_checklists_action(jsonb) from public,anon;
grant execute on function private.clean_checklists_read(text,uuid),private.clean_checklists_action(jsonb),public.clean_checklists_read(text,uuid),public.clean_checklists_action(jsonb) to authenticated;

-- 6. Patches to existing functions, each only on lines that belong to this feature.
do $$
declare
 fixes constant text[][] := array[
  -- A cleaning photo can name the check it was taken for.
  ['private.workspace_prepare_upload(jsonb)',
   $q$perform private.workspace_json_keys(input,array['requestId','workId','purpose','contentHash']);$q$,
   $q$perform private.workspace_json_keys(input,array['requestId','workId','purpose','contentHash','checklistItem']);
 if input ? 'checklistItem' and (input->>'purpose' is distinct from 'cleaning' or jsonb_typeof(input->'checklistItem') is distinct from 'string' or length(input->>'checklistItem') not between 1 and 200) then raise exception 'A checklist photo must be a cleaning photo of one check' using errcode='22023';end if;$q$,
   $q$'contentHash','checklistItem'$q$],
  -- Retrying an upload must name the same check.
  ['private.workspace_prepare_upload(jsonb)',
   $q$intent.content_hash<>input->>'contentHash' then$q$,
   $q$intent.content_hash<>input->>'contentHash' or intent.checklist_item is distinct from input->>'checklistItem' then$q$,
   $q$intent.checklist_item is distinct from$q$],
  -- The check must be on this clean's checklist.
  ['private.workspace_prepare_upload(jsonb)',
   $q$,'recharge/'||nonce::text) returning * into intent;$q$,
   $q$,'recharge/'||nonce::text) returning * into intent;
  if input ? 'checklistItem' then
   if not coalesce(d.data->'checklist' ? (input->>'checklistItem'),false) then raise exception 'Choose a check from the checklist of this clean' using errcode='22023';end if;
   update private.workspace_upload_intents set checklist_item=input->>'checklistItem' where id=intent.id returning * into intent;
  end if;$q$,
   $q$set checklist_item=input->>'checklistItem'$q$],
  -- The saved photo keeps the check it was taken for.
  ['private.integration_commit_upload(uuid,jsonb)',
   $q$update private.workspace_upload_intents set evidence_id=e where id=i.id;$q$,
   $q$update private.workspace_upload_intents set evidence_id=e where id=i.id;
 if i.checklist_item is not null then update private.workspace_media_evidence set checklist_item=i.checklist_item where id=e;end if;$q$,
   $q$set checklist_item=i.checklist_item$q$],
  -- Photos on a work item say which check they belong to.
  ['private.workspace_media_read(uuid)',
   $q$'verifiedAt',e.verified_at) order by e.verified_at)$q$,
   $q$'verifiedAt',e.verified_at,'checklistItem',e.checklist_item) order by e.verified_at)$q$,
   $q$'checklistItem',e.checklist_item$q$],
  -- Submitting a clean: every check that needs photos has them.
  ['private.workspace_operations_action(jsonb)',
   $q$if data->'checks' is distinct from d.data->'checklist' then raise exception 'Complete every required checklist item' using errcode='22023';end if;$q$,
   $q$if data->'checks' is distinct from d.data->'checklist' then raise exception 'Complete every required checklist item' using errcode='22023';end if;
    perform private.clean_photo_check(target,prop,d.data->'checklist',auth.uid());$q$,
   $q$private.clean_photo_check($q$],
  -- New Hostaway checkout cleans use the property's checklist when one is set.
  ['private.workspace_hostaway_sync(jsonb)',
   $q$'checklist',checklist,'phase','assigned'$q$,
   $q$'checklist',coalesce(private.clean_template_labels(res.property_id),checklist),'phase','assigned'$q$,
   $q$private.clean_template_labels(res.property_id)$q$]
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
