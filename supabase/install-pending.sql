-- Paste this whole file into Supabase > SQL Editor > New query, then Run.
-- Installs three migrations in order and records them so future tooling stays in sync.
begin;

-- ===== 20261006022727_verified_phone_sessions =====
-- Verified phone identities use the same durable password lockout and approved-session boundary.
-- to_jsonb also permits existing local auth fixtures without phone columns.
create or replace function private.auth_server_finish_password(subject_hash text, attempt_id uuid, outcome text, user_id uuid default null, session_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare state private.auth_login_state; valid_attempt boolean;
begin
  if auth.uid() is not null then raise exception 'Stateless server context required' using errcode='42501'; end if;
  if outcome is null or outcome not in ('success','failure','unavailable') then raise exception 'Invalid outcome'; end if;
  select * into state from private.auth_login_state s where s.subject_hash=auth_server_finish_password.subject_hash for update;
  delete from private.auth_login_attempts a where a.attempt_id=auth_server_finish_password.attempt_id and a.subject_hash=state.subject_hash and a.expires_at>now() returning true into valid_attempt;
  if not coalesce(valid_attempt,false) then raise exception 'Attempt expired or already completed'; end if;
  if state.locked_until > now() then return jsonb_build_object('allowed',false,'locked',true,'retryAfter',ceil(extract(epoch from state.locked_until-now()))::integer); end if;
  if outcome='unavailable' then return jsonb_build_object('allowed',false,'locked',false,'retryAfter',0); end if;
  if outcome='failure' then
    state.failures:=least(5,state.failures+1);
    update private.auth_login_state s set failures=state.failures,updated_at=now(),locked_until=case when state.failures=5 then now()+interval '24 hours' else null end where s.subject_hash=state.subject_hash;
    insert into private.authentication_events(event_type,subject_hash) values('password_failed',state.subject_hash);
    if state.failures=5 then insert into private.authentication_events(event_type,subject_hash) values('password_locked',state.subject_hash); end if;
    return jsonb_build_object('allowed',false,'locked',state.failures=5,'retryAfter',case when state.failures=5 then 86400 else 0 end);
  end if;
  if not exists (select 1 from auth.sessions s join auth.users u on u.id=s.user_id
    where s.id=auth_server_finish_password.session_id and s.user_id=auth_server_finish_password.user_id and ((nullif(u.email,'') is not null and u.email_confirmed_at is not null) or (nullif(to_jsonb(u)->>'phone','') is not null and nullif(to_jsonb(u)->>'phone_confirmed_at','') is not null)) and (s.not_after is null or s.not_after>now())) then raise exception 'Verified session required'; end if;
  update private.auth_login_state s set failures=0,locked_until=null,window_started_at=now(),updated_at=now() where s.subject_hash=state.subject_hash;
  insert into private.workspace_approved_sessions(session_id,user_id) values(session_id,user_id) on conflict on constraint workspace_approved_sessions_pkey do nothing;
  insert into private.authentication_events(event_type,subject_hash,user_id) values('password_login',state.subject_hash,user_id);
  return jsonb_build_object('allowed',true,'locked',false,'retryAfter',0);
end;
$$;

create or replace function private.auth_server_recovery(proof_hash text, user_id uuid, session_id uuid, phase text, subject_hash text default null, lease_id uuid default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare proof private.auth_recovery_proofs;
begin
  if auth.uid() is not null then raise exception 'Stateless server context required' using errcode='42501'; end if;
  if proof_hash is null or proof_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid recovery proof'; end if;
  if not exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id where s.id=auth_server_recovery.session_id and s.user_id=auth_server_recovery.user_id and ((nullif(u.email,'') is not null and u.email_confirmed_at is not null) or (nullif(to_jsonb(u)->>'phone','') is not null and nullif(to_jsonb(u)->>'phone_confirmed_at','') is not null)) and (s.not_after is null or s.not_after>now())) then return false; end if;
  if phase='create' then
    insert into private.auth_recovery_proofs(proof_hash,user_id,session_id) values(proof_hash,user_id,session_id);
    return true;
  end if;
  select * into proof from private.auth_recovery_proofs p where p.proof_hash=auth_server_recovery.proof_hash and p.user_id=auth_server_recovery.user_id and p.session_id=auth_server_recovery.session_id and p.expires_at>now() for update;
  if not found then return false; end if;
  if phase='begin' then
    if lease_id is null or proof.busy_until>now() then return false; end if;
    update private.auth_recovery_proofs p set lease_id=auth_server_recovery.lease_id,busy_until=now()+interval '60 seconds' where p.proof_hash=proof.proof_hash;
    return true;
  end if;
  if proof.lease_id is distinct from lease_id or proof.busy_until<=now() or lease_id is null then return false; end if;
  if phase='release' then update private.auth_recovery_proofs p set lease_id=null,busy_until=null where p.proof_hash=proof.proof_hash; return true; end if;
  if phase<>'complete' or phase is null or subject_hash is null or subject_hash !~ '^[a-f0-9]{64}$' then return false; end if;
  -- Verified password recovery unlocks new login, but never restores revoked roles.
  update private.auth_login_state s set failures=0,locked_until=null,window_started_at=now(),updated_at=now() where s.subject_hash=auth_server_recovery.subject_hash;
  delete from private.auth_login_attempts a where a.subject_hash=auth_server_recovery.subject_hash;
  delete from private.workspace_approved_sessions s where s.user_id=auth_server_recovery.user_id;
  delete from private.auth_recovery_proofs p where p.user_id=auth_server_recovery.user_id;
  insert into private.authentication_events(event_type,subject_hash,user_id) values('password_reset',subject_hash,user_id);
  return true;
end;
$$;

create or replace function private.has_workspace_session()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and exists (
    select 1 from auth.sessions s join auth.users u on u.id=s.user_id
    join private.workspace_approved_sessions a on a.session_id=s.id and a.user_id=s.user_id
    where s.user_id=auth.uid() and s.id::text=auth.jwt()->>'session_id'
      and ((nullif(u.email,'') is not null and u.email_confirmed_at is not null) or (nullif(to_jsonb(u)->>'phone','') is not null and nullif(to_jsonb(u)->>'phone_confirmed_at','') is not null)) and a.expires_at>now() and (s.not_after is null or s.not_after>now())
  );
$$;

-- ===== 20261007090000_accounts_finance =====
-- Accounts team, supplier expenses with evidence, payout report reconciliation and
-- owner statements. No provider credentials: Xero and Stripe are recorded as
-- queued intents only, and nothing here claims an external posting or payment.

-- Accounts is a finance role. It is assigned by administrators only.
alter table public.workspace_profiles drop constraint workspace_profiles_role_check;
alter table public.workspace_profiles add constraint workspace_profiles_role_check
  check (role in ('super_admin','admin','stays','cleans','cleaning_manager','ready','accounts','client'));

-- Finance tools apply across the portfolio for the accounts team. Entry and OTA
-- details are not finance tools, so they stay limited to assigned property staff.
create function private.workspace_finance_feature(feature text) returns boolean language sql immutable set search_path='' as $$
  select feature in ('cleans-invoices','maintenance-reconciliation','onboarding-invoices','purchase-order-invoices','purchase-order-accounts','owner-statements');
$$;
create or replace function private.workspace_can_property(target uuid, feature text) returns boolean language sql stable security definer set search_path='' as $$
  select private.has_workspace_module(feature) and (
    private.workspace_actor_role() in ('admin','super_admin') or
    (private.workspace_actor_role()='accounts' and private.workspace_finance_feature(feature) and exists(select 1 from public.workspace_properties p where p.id=target)) or
    exists (
      select 1 from public.workspace_property_assignments a where a.property_id=target and a.user_id=auth.uid()
        and a.assignment=case private.workspace_actor_role() when 'client' then 'client' when 'cleans' then 'cleaner' when 'cleaning_manager' then 'cleaning_manager' else 'staff' end
    )
  );
$$;
drop policy properties_assigned on public.workspace_properties;
create policy properties_assigned on public.workspace_properties for select to authenticated using (
 (select private.workspace_actor_role()) is not null and ((select private.workspace_actor_role()) in ('admin','super_admin','accounts') or exists(select 1 from public.workspace_property_assignments a where a.property_id=id and a.user_id=(select auth.uid())))
);
-- Finance handovers also reach the accounts team, who are not assigned per property.
create or replace function private.workspace_handover(target_property uuid,feature text,title text,kind text,payload jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare target uuid;event_id bigint;begin
 insert into public.workspace_work_items(request_id,property_id,module_id,title,created_by,client_visible) values(gen_random_uuid(),target_property,feature,title,auth.uid(),false) returning id into target;
 insert into private.workspace_domain_details(work_id,kind,data) values(target,kind,payload);
 insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(auth.uid(),target_property,target,'handover.created') returning id into event_id;
 insert into private.workspace_notification_outbox(user_id,work_id,event_id)
 select p.user_id,target,event_id from public.workspace_profiles p where p.status='active' and p.role not in ('client','cleans') and
 (p.role in ('admin','super_admin') or
  (p.role='accounts' and private.workspace_finance_feature(feature) and exists(select 1 from public.workspace_module_grants g where g.user_id=p.user_id and g.module_id=feature)) or
  exists(select 1 from public.workspace_module_grants g join public.workspace_property_assignments a on a.user_id=g.user_id where g.user_id=p.user_id and g.module_id=feature and a.property_id=target_property)) on conflict do nothing;
 return target;
end $$;
revoke all on function private.workspace_finance_feature(text),private.workspace_handover(uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function private.workspace_finance_feature(text) to authenticated;
update public.workspace_features set client_module='owner-statements' where module_id='owner-statements';

-- Reservation values needed for statements. Hostaway imports fill these later.
alter table private.workspace_reservations
  add column channel text not null default 'direct' check(channel in ('airbnb','booking_com','vrbo','direct','other')),
  add column channel_reference text check(length(trim(channel_reference)) between 1 and 120),
  add column guests integer check(guests between 1 and 50),
  add column payout_minor bigint check(payout_minor between 0 and 100000000);
create unique index workspace_reservations_channel_ref_idx on private.workspace_reservations(channel,upper(channel_reference)) where channel_reference is not null;
-- Agreed terms per property. Values come from each management agreement; none are assumed.
alter table private.workspace_property_financials add column cleaning_cost_minor bigint check(cleaning_cost_minor between 0 and 1000000);

create table private.workspace_finance_policy (
  singleton boolean primary key default true check(singleton),
  expense_approval_limit_minor bigint check(expense_approval_limit_minor between 0 and 100000000),
  version integer not null default 1 check(version>0), updated_by uuid references public.workspace_profiles(user_id), updated_at timestamptz not null default now()
);
insert into private.workspace_finance_policy(singleton) values(true);

create table private.workspace_expenses (
  id uuid primary key default gen_random_uuid(), property_id uuid not null references public.workspace_properties(id),
  work_id uuid references public.workspace_work_items(id),
  supplier text not null check(length(trim(supplier)) between 2 and 200), reference text not null check(length(trim(reference)) between 1 and 120),
  category text not null check(category in ('maintenance','property_setup','cleaning_supplies','utilities','furnishing','other')),
  description text not null check(length(trim(description)) between 5 and 3000),
  amount_minor bigint not null check(amount_minor between 1 and 100000000), currency text not null default 'GBP' check(currency='GBP'),
  received_on date not null, source text not null check(source in ('manual','email')), sender text check(length(sender)<=320),
  status text not null default 'to_approve' check(status in ('to_approve','queried','approved','rejected')),
  query_note text check(length(query_note)<=2000), decision_note text check(length(decision_note)<=2000),
  decided_by uuid references public.workspace_profiles(user_id), decided_at timestamptz,
  xero_status text not null default 'not_queued' check(xero_status in ('not_queued','queued','posted','failed')),
  xero_bill_id text check(length(xero_bill_id)<=100), xero_updated_at timestamptz,
  created_by uuid not null references public.workspace_profiles(user_id), request_id uuid not null,
  version integer not null default 1 check(version>0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(created_by,request_id)
);
create unique index workspace_expenses_supplier_ref_idx on private.workspace_expenses(lower(supplier),lower(reference)) where status<>'rejected';
create index workspace_expenses_property_idx on private.workspace_expenses(property_id,received_on);
create index workspace_expenses_status_idx on private.workspace_expenses(status,received_on);
create index workspace_expenses_work_idx on private.workspace_expenses(work_id);
create table private.workspace_expense_evidence (
  id uuid primary key default gen_random_uuid(), expense_id uuid not null references private.workspace_expenses(id),
  kind text not null check(kind in ('invoice','photo','quote','report')), label text not null check(length(trim(label)) between 2 and 200),
  media_id uuid references private.workspace_media_evidence(id), work_id uuid references public.workspace_work_items(id),
  note text check(length(note)<=2000), added_by uuid not null references public.workspace_profiles(user_id), created_at timestamptz not null default now(),
  -- Evidence is a verified upload, a linked job record, or a written check of at least ten characters.
  check(media_id is not null or work_id is not null or length(trim(coalesce(note,'')))>=10)
);
create index workspace_expense_evidence_idx on private.workspace_expense_evidence(expense_id);

create table private.workspace_payout_reports (
  id uuid primary key default gen_random_uuid(), channel text not null check(channel in ('airbnb','booking_com')),
  file_name text not null check(length(trim(file_name)) between 1 and 200), content_hash text not null,
  line_count integer not null check(line_count between 1 and 2000), total_minor bigint not null,
  uploaded_by uuid not null references public.workspace_profiles(user_id), request_id uuid not null, created_at timestamptz not null default now(),
  unique(uploaded_by,request_id), unique(channel,content_hash)
);
create table private.workspace_payout_lines (
  id uuid primary key default gen_random_uuid(), report_id uuid not null references private.workspace_payout_reports(id),
  reference text not null check(length(trim(reference)) between 1 and 120), amount_minor bigint not null check(amount_minor between -100000000 and 100000000),
  set_aside_note text check(length(set_aside_note)<=2000), set_aside_by uuid references public.workspace_profiles(user_id), set_aside_at timestamptz
);
create unique index workspace_payout_lines_ref_idx on private.workspace_payout_lines(report_id,upper(reference));
create index workspace_payout_lines_lookup_idx on private.workspace_payout_lines(upper(reference));
-- An agreement is valid only while the payout total it was agreed against is unchanged.
create table private.workspace_payout_agreements (
  reservation_id uuid primary key references private.workspace_reservations(id), received_snapshot_minor bigint,
  agreed_minor bigint not null check(agreed_minor between 0 and 100000000), note text not null check(length(trim(note)) between 5 and 2000),
  agreed_by uuid not null references public.workspace_profiles(user_id), agreed_at timestamptz not null default now()
);

create table private.workspace_owner_statements (
  id uuid primary key default gen_random_uuid(), property_id uuid not null references public.workspace_properties(id),
  period_start date not null check(extract(day from period_start)=1),
  status text not null default 'draft' check(status in ('draft','issued','paid','void')),
  revenue_minor bigint not null, cleaning_count integer not null, cleaning_minor bigint not null, expenses_minor bigint not null,
  fee_bps integer not null check(fee_bps between 0 and 10000), fee_minor bigint not null, payout_minor bigint not null, detail jsonb not null,
  payout_method text check(payout_method in ('bank_transfer','stripe')), payout_reference text check(length(payout_reference)<=120),
  paid_at timestamptz, paid_by uuid references public.workspace_profiles(user_id),
  issued_at timestamptz, issued_by uuid references public.workspace_profiles(user_id), void_reason text check(length(void_reason)<=2000),
  prepared_by uuid not null references public.workspace_profiles(user_id), version integer not null default 1 check(version>0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index workspace_owner_statements_period_idx on private.workspace_owner_statements(property_id,period_start) where status<>'void';

do $$ declare t text; begin
 foreach t in array array['workspace_finance_policy','workspace_expenses','workspace_expense_evidence','workspace_payout_reports','workspace_payout_lines','workspace_payout_agreements','workspace_owner_statements'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated',t);
 end loop;
 -- Payout lines are bounded per report instead, so one upload is one counted change.
 foreach t in array array['workspace_finance_policy','workspace_expenses','workspace_expense_evidence','workspace_payout_reports','workspace_payout_agreements','workspace_owner_statements'] loop
  execute format('create trigger business_write_limit before insert or update on private.%I for each row execute function private.workspace_enforce_write_limit()',t);
 end loop;
end $$;

create function private.workspace_period(value text) returns date language plpgsql immutable set search_path='' as $$
begin
 if coalesce(value,'')!~'^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Choose a month' using errcode='22023';end if;
 return (value||'-01')::date;
end $$;
create function private.workspace_finance_role() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(private.workspace_actor_role() in ('accounts','admin','super_admin'),false);
$$;
-- Received payout total for a reservation across uploaded reports. Null when no line exists.
create function private.workspace_payout_received(target private.workspace_reservations) returns bigint language sql stable security definer set search_path='' as $$
 select sum(l.amount_minor) from private.workspace_payout_lines l join private.workspace_payout_reports r on r.id=l.report_id
 where target.channel_reference is not null and r.channel=target.channel and upper(l.reference)=upper(target.channel_reference) and l.set_aside_at is null;
$$;
create function private.workspace_payout_row(target private.workspace_reservations) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare received bigint:=private.workspace_payout_received(target);agreement private.workspace_payout_agreements;state text;begin
 select * into agreement from private.workspace_payout_agreements where reservation_id=target.id;
 state:=case
  when found and agreement.received_snapshot_minor is not distinct from received then 'agreed'
  when target.channel_reference is null then 'no_reference'
  when received is null then 'missing'
  when target.payout_minor is null then 'no_expected_amount'
  when received=target.payout_minor then 'matched'
  else 'different' end;
 return jsonb_build_object('reservationId',target.id,'propertyId',target.property_id,'reference',target.reference,'channel',target.channel,
  'channelReference',target.channel_reference,'checkIn',target.check_in,'checkOut',target.check_out,'guests',target.guests,
  'expectedMinor',target.payout_minor,'receivedMinor',received,'agreedMinor',case when state='agreed' then agreement.agreed_minor end,
  'agreementNote',case when state='agreed' then agreement.note end,'state',state,'version',target.version,
  'settledMinor',case state when 'matched' then received when 'agreed' then agreement.agreed_minor end);
end $$;
create function private.workspace_expense_view(e private.workspace_expenses,with_evidence boolean) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',e.id,'propertyId',e.property_id,'propertyName',p.name,'workId',e.work_id,'supplier',e.supplier,'reference',e.reference,
  'category',e.category,'description',e.description,'amountMinor',e.amount_minor,'currency',e.currency,'receivedOn',e.received_on,'source',e.source,
  'sender',e.sender,'status',e.status,'queryNote',e.query_note,'decisionNote',e.decision_note,'decidedBy',e.decided_by,'decidedAt',e.decided_at,
  'xeroStatus',e.xero_status,'version',e.version,'createdAt',e.created_at,
  'evidenceCount',(select count(*) from private.workspace_expense_evidence v where v.expense_id=e.id),
  'hasInvoice',exists(select 1 from private.workspace_expense_evidence v where v.expense_id=e.id and v.kind='invoice'),
  'hasProof',exists(select 1 from private.workspace_expense_evidence v where v.expense_id=e.id and v.kind<>'invoice'),
  'evidence',case when with_evidence then (select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'kind',v.kind,'label',v.label,'mediaId',v.media_id,'workId',v.work_id,'note',v.note,'createdAt',v.created_at) order by v.created_at,v.id),'[]') from private.workspace_expense_evidence v where v.expense_id=e.id) end)
 from public.workspace_properties p where p.id=e.property_id;
$$;
create function private.workspace_statement_view(s private.workspace_owner_statements) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',s.id,'propertyId',s.property_id,'propertyName',p.name,'period',to_char(s.period_start,'YYYY-MM'),'status',s.status,
  'revenueMinor',s.revenue_minor,'cleaningCount',s.cleaning_count,'cleaningMinor',s.cleaning_minor,'expensesMinor',s.expenses_minor,
  'feeBps',s.fee_bps,'feeMinor',s.fee_minor,'payoutMinor',s.payout_minor,'detail',s.detail,'payoutMethod',s.payout_method,
  'payoutReference',s.payout_reference,'paidAt',s.paid_at,'issuedAt',s.issued_at,'version',s.version,'updatedAt',s.updated_at)
 from public.workspace_properties p where p.id=s.property_id;
$$;

create function private.workspace_finance_read(section text,target_property uuid default null,period text default null,target_id uuid default null,status_filter text default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();start_on date;end_on date;result jsonb;e private.workspace_expenses;policy private.workspace_finance_policy;begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 if section='statements' and actor='client' then
  -- Owners see issued and paid statements for their own properties only.
  select coalesce(jsonb_agg(private.workspace_statement_view(s) order by s.period_start desc,s.id),'[]') into result from
   (select * from private.workspace_owner_statements s where s.status in ('issued','paid') and (target_property is null or s.property_id=target_property)
    and private.workspace_can_property(s.property_id,'owner-statements') order by s.period_start desc limit 60) s;
  return result;
 end if;
 if not private.workspace_finance_role() then raise exception 'Accounts access required' using errcode='42501';end if;
 if target_property is not null and not private.workspace_can_property(target_property,'owner-statements') then raise exception 'Property finance access denied' using errcode='42501';end if;
 if section in ('overview','reconciliation','statements') then start_on:=private.workspace_period(period);end_on:=(start_on+interval '1 month')::date;end if;
 if section='overview' then
  if not private.has_workspace_module('owner-statements') then raise exception 'Accounts access required' using errcode='42501';end if;
  select jsonb_build_object(
   'toApproveCount',count(*) filter(where status='to_approve'),'toApproveMinor',coalesce(sum(amount_minor) filter(where status='to_approve'),0),
   'queriedCount',count(*) filter(where status='queried'),'queuedForXero',count(*) filter(where xero_status='queued'),
   'overLimitCount',(select count(*) from private.workspace_expenses x,private.workspace_finance_policy f where x.status='to_approve' and f.expense_approval_limit_minor is not null and x.amount_minor>f.expense_approval_limit_minor),
   'statements',(select jsonb_build_object('draft',count(*) filter(where status='draft'),'issued',count(*) filter(where status='issued'),'paid',count(*) filter(where status='paid')) from private.workspace_owner_statements where period_start=start_on),
   'unsettledPayouts',(select count(*) from private.workspace_reservations r where r.status='confirmed' and r.channel in ('airbnb','booking_com') and r.check_in>=start_on and r.check_in<end_on and private.workspace_payout_row(r)->>'settledMinor' is null))
   into result from private.workspace_expenses where private.workspace_can_property(property_id,'maintenance-reconciliation');
 elsif section='expenses' then
  if status_filter is not null and status_filter not in ('to_approve','queried','approved','rejected') then raise exception 'Invalid status' using errcode='22023';end if;
  select coalesce(jsonb_agg(private.workspace_expense_view(x,false) order by x.received_on desc,x.created_at desc,x.id),'[]') into result from
   (select * from private.workspace_expenses x where (target_property is null or x.property_id=target_property) and (status_filter is null or x.status=status_filter)
    and private.workspace_can_property(x.property_id,'maintenance-reconciliation') order by x.received_on desc,x.created_at desc limit 200) x;
 elsif section='expense' then
  select * into e from private.workspace_expenses where id=target_id;
  if not found or not private.workspace_can_property(e.property_id,'maintenance-reconciliation') then raise exception 'Expense not found' using errcode='P0002';end if;
  result:=private.workspace_expense_view(e,true);
 elsif section='reconciliation' then
  select jsonb_build_object(
   'period',period,
   'rows',(select coalesce(jsonb_agg(private.workspace_payout_row(r) order by r.check_in,r.id),'[]') from private.workspace_reservations r
     where r.status='confirmed' and r.channel in ('airbnb','booking_com') and r.check_in>=start_on and r.check_in<end_on and (target_property is null or r.property_id=target_property)
     and private.workspace_can_property(r.property_id,'owner-statements')),
   'unexpected',(select coalesce(jsonb_agg(jsonb_build_object('lineId',l.id,'channel',rp.channel,'reference',l.reference,'amountMinor',l.amount_minor,'fileName',rp.file_name,'uploadedAt',rp.created_at) order by rp.created_at,l.reference),'[]')
     from private.workspace_payout_lines l join private.workspace_payout_reports rp on rp.id=l.report_id where l.set_aside_at is null and target_property is null
     and not exists(select 1 from private.workspace_reservations r where r.channel=rp.channel and upper(r.channel_reference)=upper(l.reference))),
   'reports',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'channel',channel,'fileName',file_name,'lineCount',line_count,'totalMinor',total_minor,'uploadedAt',created_at) order by created_at desc),'[]')
     from (select * from private.workspace_payout_reports order by created_at desc limit 24) rp)) into result;
 elsif section='statements' then
  select coalesce(jsonb_agg(jsonb_build_object('propertyId',p.id,'propertyName',p.name,
    'terms',(select jsonb_build_object('managementFeeBps',f.management_fee_bps,'cleaningCostMinor',f.cleaning_cost_minor) from private.workspace_property_financials f where f.property_id=p.id),
    'statement',(select private.workspace_statement_view(s) from private.workspace_owner_statements s where s.property_id=p.id and s.period_start=start_on and s.status<>'void'),
    'unsettledPayouts',(select count(*) from private.workspace_reservations r where r.property_id=p.id and r.status='confirmed' and r.channel in ('airbnb','booking_com') and r.check_in>=start_on and r.check_in<end_on and private.workspace_payout_row(r)->>'settledMinor' is null))
   order by p.name,p.id),'[]') into result
  from public.workspace_properties p where p.status<>'archived' and (target_property is null or p.id=target_property) and private.workspace_can_property(p.id,'owner-statements');
 elsif section='policy' then
  select * into policy from private.workspace_finance_policy where singleton;
  result:=jsonb_build_object('expenseApprovalLimitMinor',policy.expense_approval_limit_minor,'version',policy.version,'updatedAt',policy.updated_at);
 else raise exception 'Unknown finance section' using errcode='22023';end if;
 return result;
end $$;

create function private.workspace_finance_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();a text;req uuid;prop uuid;prior private.workspace_action_receipts;result jsonb;
 e private.workspace_expenses;r private.workspace_reservations;s private.workspace_owner_statements;policy private.workspace_finance_policy;
 rep private.workspace_payout_reports;f private.workspace_property_financials;expense_lines jsonb;start_on date;end_on date;amount bigint;
 revenue bigint;cleans integer;costs bigint;fee bigint;lines jsonb;line jsonb;hash text;total bigint;blocked jsonb;event_id bigint;evidence_media uuid;evidence_work uuid;
begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 a:=private.workspace_required_text(input,'action',1,50);req:=(input->>'requestId')::uuid;prop:=(input->>'propertyId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 -- Authority is checked before any receipt is replayed, so revoked access cannot reuse one.
 if a in ('setFinancePolicy') then
  if actor<>'super_admin' then raise exception 'Super admin approval required' using errcode='42501';end if;
 elsif a='setStatementTerms' then
  if actor not in ('admin','super_admin') or prop is null or not private.workspace_can_property(prop,'owner-statements') then raise exception 'Management access required' using errcode='42501';end if;
 elsif a='setReservationFinancials' then
  if prop is null or not ((actor in ('stays','admin','super_admin') and private.workspace_can_property(prop,'direct-bookings')) or (actor='accounts' and private.workspace_can_property(prop,'owner-statements'))) then raise exception 'Reservation finance access denied' using errcode='42501';end if;
 elsif a in ('createExpense','addExpenseEvidence') then
  if a='addExpenseEvidence' then select property_id into prop from private.workspace_expenses where id=(input->>'expenseId')::uuid;end if;
  if prop is null or actor in ('client','cleans') or not private.workspace_can_property(prop,'maintenance-reconciliation') then raise exception 'Expense access denied' using errcode='42501';end if;
 elsif a in ('approveExpense','queryExpense','resolveExpenseQuery','rejectExpense') then
  select property_id into prop from private.workspace_expenses where id=(input->>'expenseId')::uuid;
  if prop is null or not private.workspace_finance_role() or not private.workspace_can_property(prop,'maintenance-reconciliation') then raise exception 'Accounts approval access required' using errcode='42501';end if;
 elsif a in ('importPayoutReport','agreePayout','setAsidePayoutLine','prepareStatement','issueStatement','recordOwnerPayout','voidStatement') then
  if not private.workspace_finance_role() or not private.has_workspace_module('owner-statements') then raise exception 'Accounts access required' using errcode='42501';end if;
  if a in ('issueStatement','recordOwnerPayout','voidStatement') then select property_id into prop from private.workspace_owner_statements where id=(input->>'statementId')::uuid;end if;
  if a='agreePayout' then select property_id into prop from private.workspace_reservations where id=(input->>'reservationId')::uuid;end if;
  if a in ('agreePayout','prepareStatement','issueStatement','recordOwnerPayout','voidStatement') and (prop is null or not private.workspace_can_property(prop,'owner-statements')) then raise exception 'Property finance access denied' using errcode='42501';end if;
 else raise exception 'Unknown finance action' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 select * into prior from private.workspace_action_receipts where actor_id=auth.uid() and request_id=req;
 if found then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;

 if a='setFinancePolicy' then
  perform private.workspace_json_keys(input,array['action','requestId','version','expenseApprovalLimitMinor']);
  select * into policy from private.workspace_finance_policy where singleton for update;
  if policy.version is distinct from (input->>'version')::integer then raise exception 'Policy changed' using errcode='40001';end if;
  if input->'expenseApprovalLimitMinor' is not null and jsonb_typeof(input->'expenseApprovalLimitMinor')<>'null' then amount:=private.workspace_money(input,'expenseApprovalLimitMinor');else amount:=null;end if;
  update private.workspace_finance_policy set expense_approval_limit_minor=amount,version=version+1,updated_by=auth.uid(),updated_at=now() returning * into policy;
  result:=jsonb_build_object('expenseApprovalLimitMinor',policy.expense_approval_limit_minor,'version',policy.version);
  insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'finance.policy_updated');

 elsif a='setStatementTerms' then
  perform private.workspace_json_keys(input,array['action','requestId','propertyId','managementFeeBps','cleaningCostMinor']);
  if jsonb_typeof(input->'managementFeeBps') is distinct from 'number' or coalesce(input->>'managementFeeBps','')!~'^\d+$' or (input->>'managementFeeBps')::int>10000 then raise exception 'Invalid management fee' using errcode='22023';end if;
  amount:=private.workspace_money(input,'cleaningCostMinor');
  if amount>1000000 then raise exception 'Invalid cleaning cost' using errcode='22023';end if;
  insert into private.workspace_property_financials(property_id,management_fee_bps,cleaning_cost_minor) values(prop,(input->>'managementFeeBps')::int,amount)
   on conflict(property_id) do update set management_fee_bps=excluded.management_fee_bps,cleaning_cost_minor=excluded.cleaning_cost_minor,updated_at=now() returning * into f;
  result:=jsonb_build_object('propertyId',prop,'managementFeeBps',f.management_fee_bps,'cleaningCostMinor',f.cleaning_cost_minor);
  insert into public.workspace_activity(actor_id,property_id,event_type) values(auth.uid(),prop,'finance.terms_updated');

 elsif a='setReservationFinancials' then
  perform private.workspace_json_keys(input,array['action','requestId','propertyId','reservationId','version','channel','channelReference','guests','payoutMinor']);
  select * into r from private.workspace_reservations where id=(input->>'reservationId')::uuid and property_id=prop for update;
  if not found then raise exception 'Reservation not found' using errcode='P0002';end if;
  if r.version is distinct from (input->>'version')::integer then raise exception 'Reservation changed' using errcode='40001';end if;
  if coalesce(input->>'channel','') not in ('airbnb','booking_com','vrbo','direct','other') then raise exception 'Choose a booking channel' using errcode='22023';end if;
  if input->>'channel' in ('airbnb','booking_com') and jsonb_typeof(input->'channelReference') is distinct from 'string' then raise exception 'Platform reservation code required' using errcode='22023';end if;
  if input->'guests' is not null and jsonb_typeof(input->'guests')<>'null' and (jsonb_typeof(input->'guests')<>'number' or input->>'guests'!~'^\d+$' or (input->>'guests')::int not between 1 and 50) then raise exception 'Invalid guest count' using errcode='22023';end if;
  if input->'channelReference' is not null and jsonb_typeof(input->'channelReference')='string' then perform private.workspace_required_text(input,'channelReference',1,120);end if;
  if exists(select 1 from private.workspace_owner_statements where property_id=prop and status in ('issued','paid') and period_start=date_trunc('month',r.check_in)::date) then raise exception 'Void the issued statement before changing this reservation' using errcode='42501';end if;
  update private.workspace_reservations set channel=input->>'channel',channel_reference=nullif(trim(input->>'channelReference'),''),
   guests=(input->>'guests')::int,payout_minor=case when input->'payoutMinor' is null or jsonb_typeof(input->'payoutMinor')='null' then null else private.workspace_money(input,'payoutMinor') end,
   version=version+1,updated_at=now() where id=r.id returning * into r;
  result:=private.workspace_payout_row(r);
  insert into public.workspace_activity(actor_id,property_id,event_type) values(auth.uid(),prop,'finance.reservation_values_updated');

 elsif a='createExpense' then
  perform private.workspace_json_keys(input,array['action','requestId','propertyId','workId','supplier','reference','category','description','amountMinor','receivedOn','source','sender']);
  if coalesce(input->>'category','') not in ('maintenance','property_setup','cleaning_supplies','utilities','furnishing','other') or coalesce(input->>'source','') not in ('manual','email') or (input->>'receivedOn')::date is null or (input->>'receivedOn')::date>current_date then raise exception 'Invalid expense details' using errcode='22023';end if;
  if input->>'workId' is not null and not exists(select 1 from public.workspace_work_items where id=(input->>'workId')::uuid and property_id=prop) then raise exception 'Linked job belongs to another property' using errcode='42501';end if;
  amount:=private.workspace_money(input,'amountMinor');
  if amount<1 then raise exception 'Invalid amount' using errcode='22023';end if;
  insert into private.workspace_expenses(property_id,work_id,supplier,reference,category,description,amount_minor,received_on,source,sender,created_by,request_id)
   values(prop,(input->>'workId')::uuid,private.workspace_required_text(input,'supplier',2,200),private.workspace_required_text(input,'reference',1,120),input->>'category',
   private.workspace_required_text(input,'description',5,3000),amount,(input->>'receivedOn')::date,input->>'source',
   case when input->'sender' is null then null else private.workspace_required_text(input,'sender',3,320) end,auth.uid(),req) returning * into e;
  result:=private.workspace_expense_view(e,true);
  insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(auth.uid(),prop,e.work_id,'finance.expense_received');

 elsif a='addExpenseEvidence' then
  perform private.workspace_json_keys(input,array['action','requestId','expenseId','kind','label','mediaId','workId','note']);
  select * into e from private.workspace_expenses where id=(input->>'expenseId')::uuid for update;
  if e.status not in ('to_approve','queried') then raise exception 'Evidence can only be added before a decision' using errcode='42501';end if;
  if coalesce(input->>'kind','') not in ('invoice','photo','quote','report') then raise exception 'Choose an evidence type' using errcode='22023';end if;
  evidence_media:=(input->>'mediaId')::uuid;evidence_work:=(input->>'workId')::uuid;
  if evidence_media is not null and not exists(select 1 from private.workspace_media_evidence m where m.id=evidence_media and m.property_id=e.property_id) then raise exception 'Verified upload belongs to another property' using errcode='42501';end if;
  if evidence_work is not null and not exists(select 1 from public.workspace_work_items w where w.id=evidence_work and w.property_id=e.property_id and w.status in ('approved','completed')) then raise exception 'Linked job must be completed for this property' using errcode='42501';end if;
  if evidence_media is null and evidence_work is null and length(trim(coalesce(input->>'note','')))<10 then raise exception 'Describe the evidence checked' using errcode='22023';end if;
  insert into private.workspace_expense_evidence(expense_id,kind,label,media_id,work_id,note,added_by)
   values(e.id,input->>'kind',private.workspace_required_text(input,'label',2,200),evidence_media,evidence_work,nullif(trim(coalesce(input->>'note','')),''),auth.uid());
  update private.workspace_expenses set version=version+1,updated_at=now() where id=e.id returning * into e;
  result:=private.workspace_expense_view(e,true);

 elsif a in ('approveExpense','queryExpense','resolveExpenseQuery','rejectExpense') then
  perform private.workspace_json_keys(input,array['action','requestId','expenseId','version','note']);
  select * into e from private.workspace_expenses where id=(input->>'expenseId')::uuid for update;
  if e.version is distinct from (input->>'version')::integer then raise exception 'Expense changed' using errcode='40001';end if;
  if a='approveExpense' then
   if e.status<>'to_approve' then raise exception 'Expense is not awaiting approval' using errcode='42501';end if;
   if not exists(select 1 from private.workspace_expense_evidence where expense_id=e.id and kind='invoice') or not exists(select 1 from private.workspace_expense_evidence where expense_id=e.id and kind<>'invoice') then raise exception 'Attach the invoice and proof of the work before approving' using errcode='42501';end if;
   select * into policy from private.workspace_finance_policy where singleton;
   if actor='accounts' and policy.expense_approval_limit_minor is not null and e.amount_minor>policy.expense_approval_limit_minor then raise exception 'Management approval required above the approval limit' using errcode='42501';end if;
   update private.workspace_expenses set status='approved',decision_note=nullif(trim(coalesce(input->>'note','')),''),decided_by=auth.uid(),decided_at=now(),xero_status='queued',xero_updated_at=now(),version=version+1,updated_at=now() where id=e.id returning * into e;
  elsif a='queryExpense' then
   if e.status<>'to_approve' then raise exception 'Expense is not awaiting approval' using errcode='42501';end if;
   update private.workspace_expenses set status='queried',query_note=private.workspace_required_text(input,'note',5,2000),version=version+1,updated_at=now() where id=e.id returning * into e;
  elsif a='resolveExpenseQuery' then
   if e.status<>'queried' then raise exception 'Expense is not queried' using errcode='42501';end if;
   update private.workspace_expenses set status='to_approve',query_note=left(coalesce(query_note,'')||' | Resolved: '||private.workspace_required_text(input,'note',5,1000),2000),version=version+1,updated_at=now() where id=e.id returning * into e;
  else
   if e.status not in ('to_approve','queried') then raise exception 'Expense already decided' using errcode='42501';end if;
   update private.workspace_expenses set status='rejected',decision_note=private.workspace_required_text(input,'note',5,2000),decided_by=auth.uid(),decided_at=now(),version=version+1,updated_at=now() where id=e.id returning * into e;
  end if;
  result:=private.workspace_expense_view(e,false);
  insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(auth.uid(),e.property_id,e.work_id,'finance.expense_'||e.status);

 elsif a='importPayoutReport' then
  -- Lines are validated here, not by the generic 16 KiB workflow helper.
  perform private.workspace_json_keys(input-'lines',array['action','requestId','channel','fileName']);
  lines:=input->'lines';
  if coalesce(input->>'channel','') not in ('airbnb','booking_com') or jsonb_typeof(lines) is distinct from 'array' or jsonb_array_length(lines) not between 1 and 2000 or octet_length(lines::text)>262144 then raise exception 'Upload between 1 and 2,000 payout lines' using errcode='22023';end if;
  for line in select value from jsonb_array_elements(lines) loop
   if jsonb_typeof(line)<>'object' or exists(select 1 from jsonb_object_keys(line) k where k not in ('reference','amountMinor')) or jsonb_typeof(line->'reference') is distinct from 'string' or length(trim(line->>'reference')) not between 1 and 120
    or jsonb_typeof(line->'amountMinor') is distinct from 'number' or line->>'amountMinor'!~'^-?\d+$' or abs((line->>'amountMinor')::numeric)>100000000 then raise exception 'Invalid payout line' using errcode='22023';end if;
  end loop;
  if (select count(distinct upper(trim(value->>'reference'))) from jsonb_array_elements(lines))<>jsonb_array_length(lines) then raise exception 'Combine repeated reservation codes before upload' using errcode='22023';end if;
  select md5(string_agg(upper(trim(value->>'reference'))||':'||(value->>'amountMinor'),',' order by upper(trim(value->>'reference')))),sum((value->>'amountMinor')::bigint) into hash,total from jsonb_array_elements(lines);
  if exists(select 1 from private.workspace_payout_reports where channel=input->>'channel' and content_hash=hash) then raise exception 'This payout report has already been uploaded' using errcode='23505';end if;
  insert into private.workspace_payout_reports(channel,file_name,content_hash,line_count,total_minor,uploaded_by,request_id)
   values(input->>'channel',private.workspace_required_text(input,'fileName',1,200),hash,jsonb_array_length(lines),total,auth.uid(),req) returning * into rep;
  insert into private.workspace_payout_lines(report_id,reference,amount_minor) select rep.id,trim(value->>'reference'),(value->>'amountMinor')::bigint from jsonb_array_elements(lines);
  select jsonb_build_object('reportId',rep.id,'lineCount',rep.line_count,'totalMinor',rep.total_minor,
   'matchedReservations',(select count(*) from private.workspace_payout_lines l join private.workspace_reservations x on x.channel=rep.channel and upper(x.channel_reference)=upper(l.reference) where l.report_id=rep.id),
   'unexpectedLines',(select count(*) from private.workspace_payout_lines l where l.report_id=rep.id and not exists(select 1 from private.workspace_reservations x where x.channel=rep.channel and upper(x.channel_reference)=upper(l.reference)))) into result;
  insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'finance.payout_report_uploaded');

 elsif a='agreePayout' then
  perform private.workspace_json_keys(input,array['action','requestId','reservationId','version','agreedMinor','note']);
  select * into r from private.workspace_reservations where id=(input->>'reservationId')::uuid for update;
  if r.version is distinct from (input->>'version')::integer then raise exception 'Reservation changed' using errcode='40001';end if;
  if r.channel not in ('airbnb','booking_com') or r.status<>'confirmed' then raise exception 'Only confirmed platform reservations are reconciled' using errcode='22023';end if;
  if exists(select 1 from private.workspace_owner_statements where property_id=r.property_id and status in ('issued','paid') and period_start=date_trunc('month',r.check_in)::date) then raise exception 'Void the issued statement before changing this reservation' using errcode='42501';end if;
  insert into private.workspace_payout_agreements(reservation_id,received_snapshot_minor,agreed_minor,note,agreed_by)
   values(r.id,private.workspace_payout_received(r),private.workspace_money(input,'agreedMinor'),private.workspace_required_text(input,'note',5,2000),auth.uid())
   on conflict(reservation_id) do update set received_snapshot_minor=excluded.received_snapshot_minor,agreed_minor=excluded.agreed_minor,note=excluded.note,agreed_by=excluded.agreed_by,agreed_at=now();
  result:=private.workspace_payout_row(r);
  insert into public.workspace_activity(actor_id,property_id,event_type) values(auth.uid(),r.property_id,'finance.payout_agreed');

 elsif a='setAsidePayoutLine' then
  perform private.workspace_json_keys(input,array['action','requestId','lineId','note']);
  update private.workspace_payout_lines l set set_aside_note=private.workspace_required_text(input,'note',5,2000),set_aside_by=auth.uid(),set_aside_at=now()
   where l.id=(input->>'lineId')::uuid and l.set_aside_at is null
   and not exists(select 1 from private.workspace_payout_reports rp join private.workspace_reservations x on x.channel=rp.channel and upper(x.channel_reference)=upper(l.reference) where rp.id=l.report_id)
   returning jsonb_build_object('lineId',l.id,'setAsideAt',l.set_aside_at) into result;
  if result is null then raise exception 'Only unmatched payout lines can be set aside' using errcode='P0002';end if;

 elsif a='prepareStatement' then
  perform private.workspace_json_keys(input,array['action','requestId','propertyId','period']);
  start_on:=private.workspace_period(input->>'period');end_on:=(start_on+interval '1 month')::date;
  if start_on>date_trunc('month',current_date)::date then raise exception 'Statements cover a month that has started' using errcode='22023';end if;
  perform pg_advisory_xact_lock(hashtextextended(prop::text||start_on::text,77));
  select * into f from private.workspace_property_financials where property_id=prop;
  if f.management_fee_bps is null or f.cleaning_cost_minor is null then raise exception 'Set the management fee and cleaning cost from the agreement first' using errcode='22023';end if;
  select * into s from private.workspace_owner_statements where property_id=prop and period_start=start_on and status<>'void' for update;
  if found and s.status<>'draft' then raise exception 'This statement has been issued. Void it before preparing again' using errcode='42501';end if;
  -- Every stay in the month must have an agreed amount before a statement is produced.
  select coalesce(jsonb_agg(jsonb_build_object('reservationId',x.id,'reference',x.reference,'reason',case when x.channel in ('airbnb','booking_com') then private.workspace_payout_row(x)->>'state' else 'no_payout_amount' end)),'[]') into blocked
   from private.workspace_reservations x where x.property_id=prop and x.status='confirmed' and x.check_in>=start_on and x.check_in<end_on and
   (case when x.channel in ('airbnb','booking_com') then private.workspace_payout_row(x)->>'settledMinor' is null else x.payout_minor is null end);
  if jsonb_array_length(blocked)>0 then raise exception 'Reconcile every stay in the month first' using errcode='22023';end if;
  select coalesce(sum(case when x.channel in ('airbnb','booking_com') then (private.workspace_payout_row(x)->>'settledMinor')::bigint else x.payout_minor end),0),
   coalesce(jsonb_agg(jsonb_build_object('reservationId',x.id,'reference',x.reference,'channel',x.channel,'channelReference',x.channel_reference,'checkIn',x.check_in,'checkOut',x.check_out,'guests',x.guests,
    'amountMinor',case when x.channel in ('airbnb','booking_com') then (private.workspace_payout_row(x)->>'settledMinor')::bigint else x.payout_minor end) order by x.check_in,x.id),'[]')
   into revenue,lines from private.workspace_reservations x where x.property_id=prop and x.status='confirmed' and x.check_in>=start_on and x.check_in<end_on;
  select count(*) into cleans from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
   where w.property_id=prop and d.kind='cleaning' and d.data->>'phase'='accepted' and w.status='completed' and w.due_on>=start_on and w.due_on<end_on;
  select coalesce(sum(amount_minor),0),coalesce(jsonb_agg(jsonb_build_object('expenseId',id,'supplier',supplier,'reference',reference,'category',category,'amountMinor',amount_minor,'receivedOn',received_on) order by received_on,id),'[]')
   into costs,expense_lines from private.workspace_expenses where property_id=prop and status='approved' and received_on>=start_on and received_on<end_on;
  fee:=round(revenue*f.management_fee_bps/10000.0);
  if s.id is null then
   insert into private.workspace_owner_statements(property_id,period_start,revenue_minor,cleaning_count,cleaning_minor,expenses_minor,fee_bps,fee_minor,payout_minor,detail,prepared_by)
    values(prop,start_on,revenue,cleans,cleans*f.cleaning_cost_minor,costs,f.management_fee_bps,fee,revenue-cleans*f.cleaning_cost_minor-costs-fee,
    jsonb_build_object('stays',lines,'expenses',expense_lines,'cleaningCostMinor',f.cleaning_cost_minor),auth.uid()) returning * into s;
  else
   update private.workspace_owner_statements set revenue_minor=revenue,cleaning_count=cleans,cleaning_minor=cleans*f.cleaning_cost_minor,expenses_minor=costs,fee_bps=f.management_fee_bps,
    fee_minor=fee,payout_minor=revenue-cleans*f.cleaning_cost_minor-costs-fee,detail=jsonb_build_object('stays',lines,'expenses',expense_lines,'cleaningCostMinor',f.cleaning_cost_minor),
    prepared_by=auth.uid(),version=version+1,updated_at=now() where id=s.id returning * into s;
  end if;
  result:=private.workspace_statement_view(s);
  insert into public.workspace_activity(actor_id,property_id,event_type) values(auth.uid(),prop,'finance.statement_prepared');

 elsif a in ('issueStatement','recordOwnerPayout','voidStatement') then
  perform private.workspace_json_keys(input,array['action','requestId','statementId','version','method','reference','reason']);
  select * into s from private.workspace_owner_statements where id=(input->>'statementId')::uuid for update;
  if s.version is distinct from (input->>'version')::integer then raise exception 'Statement changed' using errcode='40001';end if;
  if a='issueStatement' then
   perform private.workspace_json_keys(input,array['action','requestId','statementId','version']);
   if s.status<>'draft' then raise exception 'Only a draft statement can be issued' using errcode='42501';end if;
   update private.workspace_owner_statements set status='issued',issued_at=now(),issued_by=auth.uid(),version=version+1,updated_at=now() where id=s.id returning * into s;
   insert into public.workspace_activity(actor_id,property_id,event_type) values(auth.uid(),s.property_id,'finance.statement_issued') returning id into event_id;
   -- In-app notice for the property's owners; delivery channels follow the existing outbox.
   insert into private.workspace_notification_outbox(user_id,event_id) select a2.user_id,event_id from public.workspace_property_assignments a2 join public.workspace_profiles p on p.user_id=a2.user_id
    where a2.property_id=s.property_id and a2.assignment='client' and p.status='active' and exists(select 1 from public.workspace_module_grants g where g.user_id=a2.user_id and g.module_id='owner-statements') on conflict do nothing;
  elsif a='recordOwnerPayout' then
   perform private.workspace_json_keys(input,array['action','requestId','statementId','version','method','reference']);
   if s.status<>'issued' then raise exception 'Issue the statement before recording the payout' using errcode='42501';end if;
   if coalesce(input->>'method','')='stripe' then raise exception 'Stripe payouts are not connected yet. Record the bank transfer instead' using errcode='22023';end if;
   if input->>'method' is distinct from 'bank_transfer' then raise exception 'Choose a payout method' using errcode='22023';end if;
   if s.payout_minor<0 then raise exception 'The owner owes this balance. Invoice it instead of recording a payout' using errcode='22023';end if;
   update private.workspace_owner_statements set status='paid',payout_method='bank_transfer',payout_reference=private.workspace_required_text(input,'reference',3,120),paid_at=now(),paid_by=auth.uid(),version=version+1,updated_at=now() where id=s.id returning * into s;
   insert into public.workspace_activity(actor_id,property_id,event_type) values(auth.uid(),s.property_id,'finance.owner_paid');
  else
   perform private.workspace_json_keys(input,array['action','requestId','statementId','version','reason']);
   if s.status='paid' or s.status='void' then raise exception 'Paid statements cannot be voided' using errcode='42501';end if;
   if s.status='issued' and actor not in ('admin','super_admin') then raise exception 'Management must void an issued statement' using errcode='42501';end if;
   update private.workspace_owner_statements set status='void',void_reason=private.workspace_required_text(input,'reason',5,2000),version=version+1,updated_at=now() where id=s.id returning * into s;
   insert into public.workspace_activity(actor_id,property_id,event_type) values(auth.uid(),s.property_id,'finance.statement_voided');
  end if;
  result:=private.workspace_statement_view(s);
 end if;
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $$;

-- Service-only result of a later Xero bill posting. Not callable by signed-in users.
create function private.workspace_finance_xero_result(target uuid,posted boolean,bill_id text) returns void language plpgsql security definer set search_path='' as $$
begin
 update private.workspace_expenses set xero_status=case when posted then 'posted' else 'failed' end,xero_bill_id=case when posted then left(bill_id,100) end,xero_updated_at=now()
  where id=target and status='approved' and xero_status in ('queued','failed');
 if not found then raise exception 'Expense is not queued for Xero' using errcode='P0002';end if;
end $$;

revoke all on function private.workspace_period(text),private.workspace_finance_role(),private.workspace_payout_received(private.workspace_reservations),
 private.workspace_payout_row(private.workspace_reservations),private.workspace_expense_view(private.workspace_expenses,boolean),
 private.workspace_statement_view(private.workspace_owner_statements),private.workspace_finance_read(text,uuid,text,uuid,text),
 private.workspace_finance_action(jsonb),private.workspace_finance_xero_result(uuid,boolean,text) from public,anon,authenticated;
grant execute on function private.workspace_finance_read(text,uuid,text,uuid,text),private.workspace_finance_action(jsonb) to authenticated;
grant execute on function private.workspace_finance_xero_result(uuid,boolean,text) to service_role;

create function public.workspace_finance_read(section text,target_property uuid default null,period text default null,target_id uuid default null,status_filter text default null) returns jsonb
 language sql security invoker set search_path='' as $$ select private.workspace_finance_read(section,target_property,period,target_id,status_filter); $$;
create function public.workspace_finance_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.workspace_finance_action(input); $$;
create function public.workspace_finance_xero_result(target uuid,posted boolean,bill_id text) returns void language sql security invoker set search_path='' as $$ select private.workspace_finance_xero_result(target,posted,bill_id); $$;
revoke all on function public.workspace_finance_read(text,uuid,text,uuid,text),public.workspace_finance_action(jsonb),public.workspace_finance_xero_result(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.workspace_finance_read(text,uuid,text,uuid,text),public.workspace_finance_action(jsonb) to authenticated;
grant execute on function public.workspace_finance_xero_result(uuid,boolean,text) to service_role;

-- ===== 20261007091000_team_operations =====
-- Team operations: management decisions on cleaning complaints, the cleaner's own
-- statement, monthly cleaner performance, one shared schedule, routine visit plans
-- and the training centre. Uploaded training media waits for the storage provider.

alter table private.workspace_cleaning_reviews add column overturned_at timestamptz,
  add column overturned_by uuid references public.workspace_profiles(user_id), add column overturn_note text check(length(overturn_note)<=2000);

create table private.workspace_routine_plans (
  id uuid primary key default gen_random_uuid(), property_id uuid not null references public.workspace_properties(id),
  module_id text not null references public.workspace_features(module_id) check(module_id in ('routine-bin-garden-board','safety-maintenance','ready-schedule')),
  title text not null check(length(trim(title)) between 2 and 200), checklist jsonb not null check(jsonb_typeof(checklist)='array'),
  frequency text not null check(frequency in ('monthly','quarterly')), day_of_month integer not null check(day_of_month between 1 and 28),
  assignee_id uuid references public.workspace_profiles(user_id), active boolean not null default true, starts_on date not null,
  created_by uuid not null references public.workspace_profiles(user_id), request_id uuid not null,
  version integer not null default 1 check(version>0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(created_by,request_id)
);
create index workspace_routine_plans_property_idx on private.workspace_routine_plans(property_id,active);
create table private.workspace_routine_visits (
  plan_id uuid not null references private.workspace_routine_plans(id), period_start date not null,
  work_id uuid not null unique references public.workspace_work_items(id), created_at timestamptz not null default now(), primary key(plan_id,period_start)
);
create table private.workspace_training_courses (
  id uuid primary key default gen_random_uuid(), title text not null check(length(trim(title)) between 2 and 200),
  audience text[] not null check(cardinality(audience) between 1 and 9 and audience <@ array['all','super_admin','admin','stays','cleans','cleaning_manager','ready','accounts','client']),
  summary text not null default '' check(length(summary)<=1000), body text not null check(length(trim(body)) between 10 and 50000),
  video_url text check(video_url ~ '^https://[^\s@/]+(/[^\s]*)?$' and length(video_url)<=1000), minutes integer not null check(minutes between 1 and 600),
  published boolean not null default false, created_by uuid not null references public.workspace_profiles(user_id), request_id uuid not null,
  version integer not null default 1 check(version>0), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(created_by,request_id)
);
create table private.workspace_training_progress (
  course_id uuid not null references private.workspace_training_courses(id), user_id uuid not null references public.workspace_profiles(user_id),
  completed_at timestamptz not null default now(), primary key(course_id,user_id)
);
create index workspace_training_progress_user_idx on private.workspace_training_progress(user_id);
do $$ declare t text; begin
 foreach t in array array['workspace_routine_plans','workspace_routine_visits','workspace_training_courses','workspace_training_progress'] loop
  execute format('alter table private.%I enable row level security',t);
  execute format('revoke all on private.%I from public,anon,authenticated',t);
  execute format('create trigger business_write_limit before insert or update on private.%I for each row execute function private.workspace_enforce_write_limit()',t);
 end loop;
end $$;

-- Upheld rejections in a calendar month. Two or more is a warning.
create function private.workspace_cleaner_month(cleaner uuid,start_on date) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('cleanerId',p.user_id,'fullName',p.full_name,
  'accepted',(select count(*) from private.workspace_cleaning_reviews r where r.cleaner_id=cleaner and r.accepted and r.created_at>=start_on and r.created_at<(start_on+interval '1 month')),
  'rejected',(select count(*) from private.workspace_cleaning_reviews r where r.cleaner_id=cleaner and not r.accepted and r.overturned_at is null and r.created_at>=start_on and r.created_at<(start_on+interval '1 month')),
  'overturned',(select count(*) from private.workspace_cleaning_reviews r where r.cleaner_id=cleaner and not r.accepted and r.overturned_at is not null and r.created_at>=start_on and r.created_at<(start_on+interval '1 month')),
  'warning',(select count(*) from private.workspace_cleaning_reviews r where r.cleaner_id=cleaner and not r.accepted and r.overturned_at is null and r.created_at>=start_on and r.created_at<(start_on+interval '1 month'))>=2,
  'openComplaints',(select coalesce(jsonb_agg(jsonb_build_object('workId',w.id,'version',w.version,'propertyId',w.property_id,'sourceWorkId',d.data->>'sourceWorkId','cleanerStatement',d.data->>'cleanerStatement','createdAt',w.created_at) order by w.created_at),'[]')
    from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where d.kind='cleaning_complaint' and d.data->>'cleanerId'=cleaner::text and w.status not in ('completed','cancelled')))
 from public.workspace_profiles p where p.user_id=cleaner;
$$;

create function private.workspace_teams_read(section text,start_on date default null,end_on date default null,target_property uuid default null,target_user uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();result jsonb;month_start date;begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 if section='schedule' then
  if start_on is null or end_on is null or end_on<start_on or end_on-start_on>62 then raise exception 'Choose up to 62 days' using errcode='22023';end if;
  if target_user is not null and actor in ('client','cleans') and target_user<>auth.uid() then raise exception 'Schedule access denied' using errcode='42501';end if;
  select jsonb_build_object('from',start_on,'to',end_on,
   'work',(select coalesce(jsonb_agg(jsonb_build_object('workId',w.id,'propertyId',w.property_id,'propertyName',p.name,'moduleId',w.module_id,'title',w.title,'status',w.status,
     'dueOn',w.due_on,'assigneeId',w.assignee_id,'assigneeName',a.full_name,'kind',d.kind,'version',w.version) order by w.due_on,w.id),'[]')
     from (select * from public.workspace_work_items w where w.due_on between start_on and end_on and w.status not in ('cancelled','declined')
       and (target_property is null or w.property_id=target_property) and (target_user is null or w.assignee_id=target_user) and private.workspace_can_work(w.id) order by w.due_on,w.id limit 500) w
     join public.workspace_properties p on p.id=w.property_id left join public.workspace_profiles a on a.user_id=w.assignee_id left join private.workspace_domain_details d on d.work_id=w.id),
   'stays',case when actor='cleans' then '[]'::jsonb else (select coalesce(jsonb_agg(jsonb_build_object('reservationId',r.id,'propertyId',r.property_id,'propertyName',p.name,
     'checkIn',r.check_in,'checkOut',r.check_out,'guests',r.guests,'channel',case when actor='client' then null else r.channel end) order by r.check_in,r.id),'[]')
     from (select * from private.workspace_reservations r where r.status='confirmed' and r.check_in<=end_on and r.check_out>=start_on and (target_property is null or r.property_id=target_property)
       and (case actor when 'client' then private.workspace_can_property(r.property_id,'client-dashboard') when 'accounts' then private.workspace_can_property(r.property_id,'owner-statements')
         else private.workspace_can_property(r.property_id,'cleaning-schedule') or private.workspace_can_property(r.property_id,'direct-bookings') or private.workspace_can_property(r.property_id,'ready-schedule') end)
       order by r.check_in,r.id limit 500) r join public.workspace_properties p on p.id=r.property_id) end) into result;
 elsif section='performance' then
  month_start:=date_trunc('month',coalesce(start_on,current_date))::date;
  if actor='cleans' then return jsonb_build_array(private.workspace_cleaner_month(auth.uid(),month_start));end if;
  if actor not in ('cleaning_manager','stays','admin','super_admin') or not private.has_workspace_module('cleaner-performance') then raise exception 'Cleaner performance access required' using errcode='42501';end if;
  select coalesce(jsonb_agg(private.workspace_cleaner_month(c.user_id,month_start) order by c.full_name,c.user_id),'[]') into result from public.workspace_profiles c
   where c.role='cleans' and c.status='active' and (target_user is null or c.user_id=target_user) and (actor in ('admin','super_admin') or exists(select 1 from public.workspace_property_assignments a
    where a.user_id=c.user_id and a.assignment='cleaner' and private.workspace_can_property(a.property_id,'cleaner-performance')));
 elsif section='management' then
  if actor not in ('admin','super_admin') then raise exception 'Management access required' using errcode='42501';end if;
  month_start:=date_trunc('month',current_date)::date;
  select jsonb_build_object(
   'cleaningDecisions',(select coalesce(jsonb_agg(jsonb_build_object('workId',w.id,'version',w.version,'kind',d.kind,'title',w.title,'propertyId',w.property_id,'propertyName',p.name,
     'cleanerId',d.data->>'cleanerId','cleanerName',c.full_name,'cleanerStatement',d.data->>'cleanerStatement','sourceWorkId',d.data->>'sourceWorkId','createdAt',w.created_at) order by w.created_at),'[]')
     from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id join public.workspace_properties p on p.id=w.property_id
     left join public.workspace_profiles c on c.user_id::text=d.data->>'cleanerId' where d.kind in ('cleaning_complaint','cleaner_management_review') and w.status not in ('completed','cancelled')),
   'expensesOverLimit',(select coalesce(jsonb_agg(private.workspace_expense_view(x,false) order by x.received_on),'[]') from private.workspace_expenses x,private.workspace_finance_policy f
     where x.status='to_approve' and f.expense_approval_limit_minor is not null and x.amount_minor>f.expense_approval_limit_minor),
   'stalledOwnerApprovals',(select coalesce(jsonb_agg(jsonb_build_object('workId',w.id,'title',w.title,'propertyId',w.property_id,'propertyName',p.name,'estimatedCostMinor',(d.data->>'estimatedCostMinor')::bigint,'waitingSince',w.created_at) order by w.created_at),'[]')
     from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id join public.workspace_properties p on p.id=w.property_id
     where d.kind='maintenance' and d.data->>'phase'='owner_approval' and w.status not in ('completed','cancelled') and w.created_at<now()-interval '48 hours'),
   'cleanerWarnings',(select coalesce(jsonb_agg(m.v order by m.v->>'fullName'),'[]') from (select private.workspace_cleaner_month(c.user_id,month_start) v from public.workspace_profiles c where c.role='cleans' and c.status='active') m where (m.v->>'warning')::boolean),
   'ownerBalancesDue',(select coalesce(jsonb_agg(private.workspace_statement_view(s) order by s.period_start),'[]') from private.workspace_owner_statements s where s.status in ('draft','issued') and s.payout_minor<0)
  ) into result;
 elsif section='routines' then
  if actor not in ('ready','stays','admin','super_admin') then raise exception 'Routine maintenance access required' using errcode='42501';end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'propertyId',r.property_id,'propertyName',p.name,'moduleId',r.module_id,'title',r.title,'checklist',r.checklist,'frequency',r.frequency,
   'dayOfMonth',r.day_of_month,'assigneeId',r.assignee_id,'active',r.active,'startsOn',r.starts_on,'version',r.version,
   'lastVisit',(select jsonb_build_object('period',to_char(v.period_start,'YYYY-MM'),'workId',v.work_id) from private.workspace_routine_visits v where v.plan_id=r.id order by v.period_start desc limit 1)) order by p.name,r.title,r.id),'[]') into result
   from private.workspace_routine_plans r join public.workspace_properties p on p.id=r.property_id where (target_property is null or r.property_id=target_property) and private.workspace_can_property(r.property_id,r.module_id);
 elsif section='training' then
  select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'title',c.title,'audience',c.audience,'summary',c.summary,'body',c.body,'videoUrl',c.video_url,'minutes',c.minutes,'published',c.published,'version',c.version,
   'completedAt',(select t.completed_at from private.workspace_training_progress t where t.course_id=c.id and t.user_id=auth.uid()),
   'completions',case when actor in ('admin','super_admin') then (select count(*) from private.workspace_training_progress t where t.course_id=c.id) end) order by c.title,c.id),'[]') into result
   from private.workspace_training_courses c where (actor in ('admin','super_admin') or (c.published and ('all'=any(c.audience) or actor=any(c.audience))));
 else raise exception 'Unknown team section' using errcode='22023';end if;
 return result;
end $$;

create function private.workspace_teams_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor text:=private.workspace_actor_role();a text;req uuid;prop uuid;prior private.workspace_action_receipts;result jsonb;
 w public.workspace_work_items;d private.workspace_domain_details;src public.workspace_work_items;sd private.workspace_domain_details;
 plan private.workspace_routine_plans;course private.workspace_training_courses;start_on date;target uuid;created jsonb:='[]';remaining integer:=0;n integer:=0;assignee uuid;
begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 a:=private.workspace_required_text(input,'action',1,50);req:=(input->>'requestId')::uuid;prop:=(input->>'propertyId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 if a in ('decideComplaint','decideCleanerReview','saveCourse') then
  if actor not in ('admin','super_admin') then raise exception 'Management access required' using errcode='42501';end if;
 elsif a='addCleanerStatement' then
  if actor<>'cleans' or not exists(select 1 from private.workspace_domain_details x where x.work_id=(input->>'workId')::uuid and x.kind='cleaning_complaint' and x.data->>'cleanerId'=auth.uid()::text) then raise exception 'Only the cleaner concerned can respond' using errcode='42501';end if;
 elsif a='saveRoutinePlan' then
  if input->>'planId' is not null then select property_id into prop from private.workspace_routine_plans where id=(input->>'planId')::uuid;end if;
  if actor not in ('ready','stays','admin','super_admin') or prop is null or not private.workspace_can_property(prop,coalesce(input->>'moduleId','')) then raise exception 'Routine maintenance access required' using errcode='42501';end if;
 elsif a='generateRoutineVisits' then
  if actor not in ('ready','stays','admin','super_admin') then raise exception 'Routine maintenance access required' using errcode='42501';end if;
 elsif a='completeCourse' then
  if not exists(select 1 from private.workspace_training_courses c where c.id=(input->>'courseId')::uuid and c.published and ('all'=any(c.audience) or actor=any(c.audience) or actor in ('admin','super_admin'))) then raise exception 'Course not available' using errcode='P0002';end if;
 else raise exception 'Unknown team action' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 select * into prior from private.workspace_action_receipts where actor_id=auth.uid() and request_id=req;
 if found then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;

 if a in ('decideComplaint','decideCleanerReview') then
  perform private.workspace_json_keys(input,array['action','requestId','workId','version','outcome','note']);
  select * into w from public.workspace_work_items where id=(input->>'workId')::uuid for update;
  select * into d from private.workspace_domain_details where work_id=w.id for update;
  if not found or d.kind<>(case a when 'decideComplaint' then 'cleaning_complaint' else 'cleaner_management_review' end) then raise exception 'Decision not found' using errcode='P0002';end if;
  if w.version is distinct from (input->>'version')::integer then raise exception 'Decision changed' using errcode='40001';end if;
  if w.status in ('completed','cancelled') then raise exception 'Already decided' using errcode='42501';end if;
  if coalesce(input->>'outcome','')<>all(case a when 'decideComplaint' then array['upheld','overturned'] else array['no_action','supervised','removed_from_rota'] end) then raise exception 'Choose an outcome' using errcode='22023';end if;
  update private.workspace_domain_details set data=data||jsonb_build_object('decision',input->>'outcome','decisionNote',private.workspace_required_text(input,'note',5,2000),'decidedBy',auth.uid(),'decidedAt',now(),'workStatus','completed'),updated_at=now() where work_id=w.id;
  insert into public.workspace_work_updates(work_id,actor_id,request_id,previous_status,next_status,note,expected_version) values(w.id,auth.uid(),req,w.status,'completed',input->>'note',w.version);
  update public.workspace_work_items set status='completed',completed_at=now(),version=version+1,updated_at=now() where id=w.id returning * into w;
  if a='decideComplaint' and input->>'outcome'='overturned' then
   -- The rejection no longer counts against the cleaner.
   update private.workspace_cleaning_reviews set overturned_at=now(),overturned_by=auth.uid(),overturn_note=input->>'note'
    where id=(select r.id from private.workspace_cleaning_reviews r where r.work_id=(d.data->>'sourceWorkId')::uuid and r.cleaner_id::text=d.data->>'cleanerId' and not r.accepted and r.overturned_at is null order by r.created_at desc limit 1);
   -- If the clean has not been redone, it is accepted as originally submitted and can be invoiced.
   select * into src from public.workspace_work_items where id=(d.data->>'sourceWorkId')::uuid for update;
   select * into sd from private.workspace_domain_details where work_id=src.id for update;
   if src.id is not null and sd.kind='cleaning' and sd.data->>'phase'='assigned' and src.status='waiting' and src.assignee_id::text=d.data->>'cleanerId' and sd.data ? 'submittedBy' then
    update private.workspace_domain_details set data=data||jsonb_build_object('phase','accepted','workStatus','completed','overturnedBy',auth.uid()),updated_at=now() where work_id=src.id;
    insert into public.workspace_work_updates(work_id,actor_id,request_id,previous_status,next_status,note,expected_version) values(src.id,auth.uid(),gen_random_uuid(),src.status,'completed','Rejection overturned by management',src.version);
    update public.workspace_work_items set status='completed',completed_at=now(),version=version+1,updated_at=now() where id=src.id;
    perform private.workspace_handover(src.property_id,'cleans-invoices','Invoice accepted property clean','cleaning_invoice',jsonb_build_object('sourceWorkId',src.id,'cleanerId',src.assignee_id));
   end if;
  end if;
  result:=jsonb_build_object('workId',w.id,'version',w.version,'status',w.status,'outcome',input->>'outcome');
  insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(auth.uid(),w.property_id,w.id,'cleaning.decision_'||(input->>'outcome'));

 elsif a='addCleanerStatement' then
  perform private.workspace_json_keys(input,array['action','requestId','workId','statement']);
  select * into w from public.workspace_work_items where id=(input->>'workId')::uuid for update;
  select * into d from private.workspace_domain_details where work_id=w.id for update;
  if w.status in ('completed','cancelled') then raise exception 'This complaint has been decided' using errcode='42501';end if;
  if d.data ? 'cleanerStatement' then raise exception 'You have already responded' using errcode='23505';end if;
  update private.workspace_domain_details set data=data||jsonb_build_object('cleanerStatement',private.workspace_required_text(input,'statement',10,2000),'cleanerStatementAt',now()),updated_at=now() where work_id=w.id;
  result:=jsonb_build_object('workId',w.id,'responded',true);
  insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values(auth.uid(),w.property_id,w.id,'cleaning.cleaner_responded');

 elsif a='saveRoutinePlan' then
  perform private.workspace_json_keys(input,array['action','requestId','planId','version','propertyId','moduleId','title','checklist','frequency','dayOfMonth','assigneeId','active']);
  if coalesce(input->>'frequency','') not in ('monthly','quarterly') or jsonb_typeof(input->'dayOfMonth') is distinct from 'number' or input->>'dayOfMonth'!~'^\d+$' or (input->>'dayOfMonth')::int not between 1 and 28
   or jsonb_typeof(input->'active') is distinct from 'boolean' or jsonb_typeof(input->'checklist') is distinct from 'array' or jsonb_array_length(input->'checklist') not between 1 and 30
   or exists(select 1 from jsonb_array_elements(input->'checklist') e where jsonb_typeof(e)<>'string' or length(trim(e#>>'{}')) not between 1 and 200) then raise exception 'Invalid routine plan' using errcode='22023';end if;
  assignee:=(input->>'assigneeId')::uuid;
  if assignee is not null and not exists(select 1 from public.workspace_profiles p join public.workspace_property_assignments s on s.user_id=p.user_id and s.property_id=prop and s.assignment='staff'
   where p.user_id=assignee and p.status='active' and p.role in ('ready','stays','admin','super_admin')) then raise exception 'Assign someone on this property team' using errcode='42501';end if;
  if input->>'planId' is null then
   insert into private.workspace_routine_plans(property_id,module_id,title,checklist,frequency,day_of_month,assignee_id,active,starts_on,created_by,request_id)
    values(prop,input->>'moduleId',private.workspace_required_text(input,'title',2,200),input->'checklist',input->>'frequency',(input->>'dayOfMonth')::int,assignee,(input->>'active')::boolean,date_trunc('month',current_date)::date,auth.uid(),req) returning * into plan;
  else
   select * into plan from private.workspace_routine_plans where id=(input->>'planId')::uuid for update;
   if plan.version is distinct from (input->>'version')::integer then raise exception 'Routine plan changed' using errcode='40001';end if;
   if plan.property_id<>prop or plan.module_id<>input->>'moduleId' then raise exception 'Create a new plan for another property or board' using errcode='22023';end if;
   update private.workspace_routine_plans set title=private.workspace_required_text(input,'title',2,200),checklist=input->'checklist',frequency=input->>'frequency',day_of_month=(input->>'dayOfMonth')::int,
    assignee_id=assignee,active=(input->>'active')::boolean,version=version+1,updated_at=now() where id=plan.id returning * into plan;
  end if;
  result:=jsonb_build_object('id',plan.id,'version',plan.version,'active',plan.active);
  insert into public.workspace_activity(actor_id,property_id,event_type) values(auth.uid(),plan.property_id,'routine.plan_saved');

 elsif a='generateRoutineVisits' then
  perform private.workspace_json_keys(input,array['action','requestId','period']);
  start_on:=private.workspace_period(input->>'period');
  if start_on<date_trunc('month',current_date)::date or start_on>(date_trunc('month',current_date)+interval '2 months')::date then raise exception 'Generate visits for this month or the next two' using errcode='22023';end if;
  -- Bounded per call to stay inside the write quota; call again while remaining is above zero.
  for plan in select r.* from private.workspace_routine_plans r where r.active and r.starts_on<=start_on and private.workspace_can_property(r.property_id,r.module_id)
    and (r.frequency='monthly' or ((extract(year from start_on)-extract(year from r.starts_on))*12+extract(month from start_on)-extract(month from r.starts_on))::int%3=0)
    and not exists(select 1 from private.workspace_routine_visits v where v.plan_id=r.id and v.period_start=start_on) order by r.property_id,r.id loop
   if n>=10 then remaining:=remaining+1;continue;end if;
   target:=private.workspace_handover(plan.property_id,plan.module_id,plan.title,'routine_visit',jsonb_build_object('planId',plan.id,'period',to_char(start_on,'YYYY-MM'),'checklist',plan.checklist));
   -- A previous assignee who has left the property team is not carried over.
   update public.workspace_work_items set due_on=start_on+plan.day_of_month-1,assignee_id=case when exists(select 1 from public.workspace_property_assignments s join public.workspace_profiles p on p.user_id=s.user_id
     where s.property_id=plan.property_id and s.user_id=plan.assignee_id and s.assignment='staff' and p.status='active') then plan.assignee_id end where id=target;
   insert into private.workspace_routine_visits(plan_id,period_start,work_id) values(plan.id,start_on,target);
   created:=created||jsonb_build_array(target);n:=n+1;
  end loop;
  result:=jsonb_build_object('period',to_char(start_on,'YYYY-MM'),'created',created,'remaining',remaining);

 elsif a='saveCourse' then
  perform private.workspace_json_keys(input,array['action','requestId','courseId','version','title','audience','summary','body','videoUrl','minutes','published']);
  if jsonb_typeof(input->'audience') is distinct from 'array' or jsonb_typeof(input->'published') is distinct from 'boolean' or jsonb_typeof(input->'minutes') is distinct from 'number' or input->>'minutes'!~'^\d+$'
   or exists(select 1 from jsonb_array_elements(input->'audience') e where jsonb_typeof(e)<>'string') or (input->'videoUrl' is not null and jsonb_typeof(input->'videoUrl')<>'string')
   or (input->'summary' is not null and jsonb_typeof(input->'summary')<>'string') then raise exception 'Invalid course' using errcode='22023';end if;
  if input->>'courseId' is null then
   insert into private.workspace_training_courses(title,audience,summary,body,video_url,minutes,published,created_by,request_id)
    values(private.workspace_required_text(input,'title',2,200),array(select distinct value#>>'{}' from jsonb_array_elements(input->'audience')),coalesce(trim(input->>'summary'),''),
    private.workspace_required_text(input,'body',10,50000),nullif(trim(input->>'videoUrl'),''),(input->>'minutes')::int,(input->>'published')::boolean,auth.uid(),req) returning * into course;
  else
   select * into course from private.workspace_training_courses where id=(input->>'courseId')::uuid for update;
   if not found then raise exception 'Course not found' using errcode='P0002';end if;
   if course.version is distinct from (input->>'version')::integer then raise exception 'Course changed' using errcode='40001';end if;
   update private.workspace_training_courses set title=private.workspace_required_text(input,'title',2,200),audience=array(select distinct value#>>'{}' from jsonb_array_elements(input->'audience')),
    summary=coalesce(trim(input->>'summary'),''),body=private.workspace_required_text(input,'body',10,50000),video_url=nullif(trim(input->>'videoUrl'),''),minutes=(input->>'minutes')::int,
    published=(input->>'published')::boolean,version=version+1,updated_at=now() where id=course.id returning * into course;
  end if;
  result:=jsonb_build_object('id',course.id,'version',course.version,'published',course.published);
  insert into public.workspace_activity(actor_id,event_type) values(auth.uid(),'training.course_saved');

 elsif a='completeCourse' then
  perform private.workspace_json_keys(input,array['action','requestId','courseId']);
  insert into private.workspace_training_progress(course_id,user_id) values((input->>'courseId')::uuid,auth.uid()) on conflict do nothing;
  select jsonb_build_object('courseId',course_id,'completedAt',completed_at) into result from private.workspace_training_progress where course_id=(input->>'courseId')::uuid and user_id=auth.uid();
 end if;
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $$;

revoke all on function private.workspace_cleaner_month(uuid,date),private.workspace_teams_read(text,date,date,uuid,uuid),private.workspace_teams_action(jsonb) from public,anon,authenticated;
grant execute on function private.workspace_teams_read(text,date,date,uuid,uuid),private.workspace_teams_action(jsonb) to authenticated;
create function public.workspace_teams_read(section text,start_on date default null,end_on date default null,target_property uuid default null,target_user uuid default null) returns jsonb
 language sql security invoker set search_path='' as $$ select private.workspace_teams_read(section,start_on,end_on,target_property,target_user); $$;
create function public.workspace_teams_action(input jsonb) returns jsonb language sql security invoker set search_path='' as $$ select private.workspace_teams_action(input); $$;
revoke all on function public.workspace_teams_read(text,date,date,uuid,uuid),public.workspace_teams_action(jsonb) from public,anon,authenticated;
grant execute on function public.workspace_teams_read(text,date,date,uuid,uuid),public.workspace_teams_action(jsonb) to authenticated;

insert into supabase_migrations.schema_migrations(version,name) values ('20261006022727','verified_phone_sessions'),('20261007090000','accounts_finance'),('20261007091000','team_operations') on conflict do nothing;
commit;
