-- Privacy and store compliance.
-- 1. Deleting your own account: the profile is anonymised ("Deleted user"), every way in is taken
--    away (sessions, property assignments, tools, devices, browser notifications), and business
--    records (work, money, statements, messages written in business conversations) stay on record
--    under "Deleted user", because UK law asks for financial records to be kept for six years.
--    The server then removes the sign-in itself through the sign-in service. Each deletion leaves
--    an audit row with no personal details: which account, its role, when.
-- 2. Owners' payout bank details move out of the onboarding form into their own private table.
--    Accounts and admins read them in full; the owner sees them masked (last four digits only).
-- 3. "Download my data": a person's own records as one JSON file.
-- 4. Retention: the scheduled job deletes read notifications after 12 months, sign-in security
--    records after 90 days, expired recovery proofs and anything left behind by deleted accounts.
-- Safe to run more than once.

create table if not exists private.workspace_bank_details (
 property_id uuid primary key references public.workspace_properties(id),
 -- The owner who gave the details. Cleared if that login is deleted; the details stay with the
 -- property so money already owed can still be paid.
 owner_id uuid,
 account_name text not null check (length(account_name) between 2 and 200),
 sort_code text not null check (sort_code ~ '^\d{6}$'),
 account_number text not null check (account_number ~ '^\d{8}$'),
 updated_by uuid,
 updated_at timestamptz not null default now()
);
create index if not exists workspace_bank_details_owner_idx on private.workspace_bank_details(owner_id);
create table if not exists private.workspace_account_deletions (
 id bigint generated always as identity primary key,
 user_id uuid not null,
 role text not null,
 deleted_at timestamptz not null default now(),
 properties_kept integer not null default 0,
 sign_in text not null default 'pending' check (sign_in in ('pending','deleted','closed','failed'))
);
create index if not exists workspace_account_deletions_user_idx on private.workspace_account_deletions(user_id);
create table if not exists private.workspace_privacy_runs (day date primary key, ran_at timestamptz not null default now(), result jsonb not null default '{}');
alter table private.workspace_bank_details enable row level security;
alter table private.workspace_account_deletions enable row level security;
alter table private.workspace_privacy_runs enable row level security;
revoke all on private.workspace_bank_details,private.workspace_account_deletions,private.workspace_privacy_runs from public,anon,authenticated;
create index if not exists workspace_notification_read_idx on private.workspace_notification_outbox(read_at) where read_at is not null;
create index if not exists authentication_events_occurred_idx on private.authentication_events(occurred_at);

-- ---------------------------------------------------------------------------------------------
-- Bank details
-- ---------------------------------------------------------------------------------------------
-- Saves the payout details from a submitted set-up form. Called only from the journey function,
-- which has already checked the owner and the values.
create or replace function private.workspace_store_bank_details(prop uuid, owner uuid, fields jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 insert into private.workspace_bank_details(property_id,owner_id,account_name,sort_code,account_number,updated_by,updated_at)
 values(prop,owner,left(trim(fields->>'bankAccountName'),200),regexp_replace(fields->>'bankSortCode','\D','','g'),fields->>'bankAccountNumber',auth.uid(),now())
 on conflict(property_id) do update set owner_id=excluded.owner_id,account_name=excluded.account_name,sort_code=excluded.sort_code,
  account_number=excluded.account_number,updated_by=excluded.updated_by,updated_at=now();
end $$;

-- Accounts, admins and super admins with owner statements see the details in full; the owner of
-- the property sees them masked. Everyone else is refused.
create or replace function private.workspace_bank_details_read(prop uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role(); b private.workspace_bank_details; full_access boolean; own boolean;
begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 full_access:=actor in ('accounts','admin','super_admin') and private.workspace_can_property(prop,'owner-statements');
 own:=actor='client' and private.workspace_can_property(prop,'client-dashboard');
 if not (full_access or own) then raise exception 'Payout details access denied' using errcode='42501';end if;
 b:=(select x from private.workspace_bank_details x where x.property_id=prop);
 if b.property_id is null then return jsonb_build_object('bankAccountName',null,'bankAccountNumber',null,'bankSortCode',null,'masked',not full_access);end if;
 if full_access then
  return jsonb_build_object('bankAccountName',b.account_name,'bankAccountNumber',b.account_number,
   'bankSortCode',substr(b.sort_code,1,2)||'-'||substr(b.sort_code,3,2)||'-'||substr(b.sort_code,5,2),'masked',false);
 end if;
 return jsonb_build_object('bankAccountName',b.account_name,'bankAccountNumber','•••• '||right(b.account_number,4),'bankSortCode','••-••-'||right(b.sort_code,2),'masked',true);
end $$;
revoke all on function private.workspace_store_bank_details(uuid,uuid,jsonb),private.workspace_bank_details_read(uuid) from public,anon,authenticated;

-- Existing forms: move the details across, then blank them in the form and in the stored
-- request receipts.
insert into private.workspace_bank_details(property_id,owner_id,account_name,sort_code,account_number,updated_at)
select j.property_id,j.client_id,left(trim(j.form->>'bankAccountName'),200),regexp_replace(j.form->>'bankSortCode','\D','','g'),j.form->>'bankAccountNumber',coalesce(j.submitted_at,now())
from private.workspace_journeys j
where coalesce(j.form->>'bankAccountNumber','') ~ '^\d{8}$' and regexp_replace(coalesce(j.form->>'bankSortCode',''),'\D','','g') ~ '^\d{6}$'
 and length(trim(coalesce(j.form->>'bankAccountName',''))) between 2 and 200
on conflict(property_id) do nothing;
update private.workspace_journeys set form=form-'bankAccountName'-'bankAccountNumber'-'bankSortCode'
 where jsonb_typeof(form)='object' and form ?| array['bankAccountName','bankAccountNumber','bankSortCode'];
update private.workspace_action_receipts set input=input#-'{form,bankAccountName}'#-'{form,bankAccountNumber}'#-'{form,bankSortCode}'
 where jsonb_typeof(input->'form')='object' and input->'form' ?| array['bankAccountName','bankAccountNumber','bankSortCode'];

-- New forms: the details go straight to the private table and never into the form or receipt.
-- Readers of payout details read the private table.
do $$
declare
 fixes constant text[][] := array[
  ['private.workspace_journey_action(jsonb)',
   $q$perform private.workspace_required_text(fields,'accessInfo',2,10000);$q$,
   $q$perform private.workspace_required_text(fields,'accessInfo',2,10000);
   perform private.workspace_store_bank_details(target,j.client_id,fields);
   fields:=fields-'bankAccountName'-'bankAccountNumber'-'bankSortCode';
   input:=input#-'{form,bankAccountName}'#-'{form,bankAccountNumber}'#-'{form,bankSortCode}';$q$,
   $q$workspace_store_bank_details$q$],
  ['private.workspace_journey_action(jsonb)',
   $q$if previous.input<>input then raise exception 'Request identifier reused'$q$,
   $q$if previous.input<>(input#-'{form,bankAccountName}'#-'{form,bankAccountNumber}'#-'{form,bankSortCode}') then raise exception 'Request identifier reused'$q$,
   $q$previous.input<>(input#-'{form,bankAccountName}'$q$],
  ['private.workspace_portfolio_read(text,uuid,date,date)',
   $q$select jsonb_build_object('bankAccountName',form->>'bankAccountName','bankAccountNumber',form->>'bankAccountNumber','bankSortCode',form->>'bankSortCode') into result from private.workspace_journeys where property_id=target_property;$q$,
   $q$result:=private.workspace_bank_details_read(target_property);$q$,
   $q$workspace_bank_details_read$q$],
  ['private.workspace_portfolio_read(text,uuid,date,date)',
   $q$if not (actor='client' and private.workspace_can_property(target_property,'client-dashboard') or actor in ('admin','super_admin') and private.workspace_can_property(target_property,'owner-statements')) then raise exception 'Payout details access denied' using errcode='42501';end if;$q$,
   $q$-- Access to payout details is checked by private.workspace_bank_details_read.$q$,
   $q$checked by private.workspace_bank_details_read$q$]
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

-- ---------------------------------------------------------------------------------------------
-- Your own data: what deleting would mean, and a copy of everything about you
-- ---------------------------------------------------------------------------------------------
create or replace function private.workspace_privacy_read(section text) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid:=auth.uid(); person public.workspace_profiles; owned uuid[];
begin
 -- Any signed-in person may read their own data, including accounts still waiting for approval.
 if me is null or not private.has_workspace_session() then raise exception 'Verified sign-in required' using errcode='42501';end if;
 person:=(select p from public.workspace_profiles p where p.user_id=me);
 if person.user_id is null then raise exception 'Account not found' using errcode='P0002';end if;
 owned:=array(select a.property_id from public.workspace_property_assignments a where a.user_id=me and a.assignment='client'
  union select j.property_id from private.workspace_journeys j where j.client_id=me);
 if section='deletion' then
  return jsonb_build_object('role',person.role,'status',person.status,
   'lastSuperAdmin',person.role='super_admin' and person.status='active' and not exists(select 1 from public.workspace_profiles p where p.user_id<>me and p.role='super_admin' and p.status='active'),
   'properties',cardinality(owned),
   'liveProperties',(select count(*) from public.workspace_properties p where p.id=any(owned) and p.status='active'));
 elsif section='export' then
  return jsonb_build_object(
   'exportedAt',now(),
   'about','Your data held by Recharge. Business records you worked on are included where they are about you; other people''s personal details are left out.',
   'profile',jsonb_build_object('userId',person.user_id,'fullName',person.full_name,'email',(select u.email from auth.users u where u.id=me),
    'phone',(select nullif(to_jsonb(u)->>'phone','') from auth.users u where u.id=me),'role',person.role,'status',person.status,
    'responsibilities',person.responsibilities,'avatar',person.avatar_preset,'createdAt',person.created_at,'updatedAt',person.updated_at),
   'tools',coalesce((select jsonb_agg(g.module_id order by g.module_id) from public.workspace_module_grants g where g.user_id=me),'[]'),
   'propertyAssignments',coalesce((select jsonb_agg(jsonb_build_object('propertyId',a.property_id,'property',p.name,'assignment',a.assignment,'since',a.created_at) order by a.created_at)
    from public.workspace_property_assignments a join public.workspace_properties p on p.id=a.property_id where a.user_id=me),'[]'),
   'notifications',coalesce((select jsonb_agg(jsonb_build_object('type',n.event_type,'createdAt',n.created_at,'readAt',o.read_at) order by n.created_at desc)
    from private.workspace_notification_outbox o join public.workspace_activity n on n.id=o.event_id where o.user_id=me),'[]'),
   'messages',coalesce((select jsonb_agg(jsonb_build_object('conversationId',m.conversation_id,'sentAt',m.created_at,'body',m.body) order by m.created_at)
    from private.chat_messages m where m.author_id=me),'[]'),
   'propertyThreadMessages',coalesce((select jsonb_agg(jsonb_build_object('threadId',m.thread_id,'sentAt',m.created_at,'body',m.body) order by m.created_at)
    from public.workspace_messages m where m.author_id=me),'[]'),
   'workItems',coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'propertyId',w.property_id,'tool',w.module_id,'title',w.title,'description',w.description,'status',w.status,
     'priority',w.priority,'dueOn',w.due_on,'createdAt',w.created_at,'completedAt',w.completed_at,'createdByYou',w.created_by=me,'assignedToYou',w.assignee_id=me) order by w.created_at)
    from public.workspace_work_items w where w.created_by=me or w.assignee_id=me),'[]'),
   'shifts',coalesce((select jsonb_agg(jsonb_build_object('department',s.department,'clockedInAt',s.clocked_in_at,'clockedOutAt',s.clocked_out_at) order by s.clocked_in_at)
    from private.workspace_shifts s where s.user_id=me),'[]'),
   'training',coalesce((select jsonb_agg(jsonb_build_object('course',c.title,'completedAt',t.completed_at) order by t.completed_at)
    from private.workspace_training_progress t join private.workspace_training_courses c on c.id=t.course_id where t.user_id=me),'[]'),
   'contractsSigned',coalesce((select jsonb_agg(jsonb_build_object('contract',v.title,'version',s.version,'signedName',s.signed_name,'signedAt',s.signed_at) order by s.signed_at)
    from private.workspace_contract_signatures s join private.workspace_contract_versions v on v.contract_id=s.contract_id and v.version=s.version where s.user_id=me),'[]'),
   'propertyOnboarding',coalesce((select jsonb_agg(jsonb_build_object('propertyId',j.property_id,'property',p.name,'address',p.address,'stage',j.stage,'propertyType',j.property_type,
     'bathrooms',j.bathrooms,'estimate',j.estimate,'feedback',j.feedback,'signedName',j.signed_name,'signedAt',j.signed_at,'setUpForm',j.form,'submittedAt',j.submitted_at,
     'payoutDetails',(select jsonb_build_object('accountName',b.account_name,'accountNumber','•••• '||right(b.account_number,4),'sortCode','••-••-'||right(b.sort_code,2))
       from private.workspace_bank_details b where b.property_id=j.property_id),
     'questions',coalesce((select jsonb_agg(jsonb_build_object('question',q.question,'askedAt',q.asked_at,'answer',q.answer,'answeredAt',q.answered_at) order by q.asked_at)
       from private.workspace_journey_questions q where q.property_id=j.property_id and q.asked_by=me),'[]')) order by j.created_at)
    from private.workspace_journeys j join public.workspace_properties p on p.id=j.property_id where j.client_id=me),'[]'),
   'ownerStatements',coalesce((select jsonb_agg(jsonb_build_object('propertyId',s.property_id,'periodStart',s.period_start,'status',s.status,'revenueMinor',s.revenue_minor,
     'cleaningMinor',s.cleaning_minor,'expensesMinor',s.expenses_minor,'feeMinor',s.fee_minor,'payoutMinor',s.payout_minor,'issuedAt',s.issued_at,'paidAt',s.paid_at,'payoutReference',s.payout_reference) order by s.period_start)
    from private.workspace_owner_statements s where s.property_id=any(owned) and s.status in ('issued','paid')),'[]'));
 end if;
 raise exception 'Unknown privacy section' using errcode='22023';
end $$;
create or replace function public.workspace_privacy_read(section text) returns jsonb language sql security invoker set search_path='' as $$ select private.workspace_privacy_read(section); $$;
revoke all on function private.workspace_privacy_read(text),public.workspace_privacy_read(text) from public,anon;
grant execute on function private.workspace_privacy_read(text),public.workspace_privacy_read(text) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- Deleting your own account (server only: the route has already checked the session, the typed
-- DELETE and the password)
-- ---------------------------------------------------------------------------------------------
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
