-- Recharge's server owns these records. A direct Supabase password token is
-- not a Recharge login until this guard approves its verified Auth session.
create table private.auth_login_state (
  subject_hash text primary key check (subject_hash ~ '^[a-f0-9]{64}$'),
  failures integer not null default 0 check (failures between 0 and 5),
  window_started_at timestamptz not null default now(),
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);
create table private.auth_login_attempts (
  attempt_id uuid primary key,
  subject_hash text not null references private.auth_login_state(subject_hash) on delete cascade,
  expires_at timestamptz not null default now() + interval '90 seconds'
);
create index auth_login_attempts_subject_idx on private.auth_login_attempts(subject_hash);
create table private.auth_request_limits (
  bucket_hash text primary key check (bucket_hash ~ '^[a-f0-9]{64}$'),
  requests integer not null default 0,
  window_started_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index auth_request_limits_expiry_idx on private.auth_request_limits(expires_at);
create table private.workspace_approved_sessions (
  session_id uuid primary key references auth.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '7 days'
);
create index workspace_approved_sessions_user_idx on private.workspace_approved_sessions(user_id);
create table private.auth_recovery_proofs (
  proof_hash text primary key check (proof_hash ~ '^[a-f0-9]{64}$'),
  session_id uuid not null references auth.sessions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '15 minutes',
  busy_until timestamptz,
  lease_id uuid
);
create table private.authentication_events (
  id bigint generated always as identity primary key,
  event_type text not null check (event_type in ('password_failed','password_locked','password_login','password_reset')),
  subject_hash text not null,
  user_id uuid,
  occurred_at timestamptz not null default now()
);
alter table private.auth_login_state enable row level security;
alter table private.auth_login_attempts enable row level security;
alter table private.auth_request_limits enable row level security;
alter table private.workspace_approved_sessions enable row level security;
alter table private.auth_recovery_proofs enable row level security;
alter table private.authentication_events enable row level security;
revoke all on private.auth_login_state, private.auth_login_attempts, private.auth_request_limits,
  private.workspace_approved_sessions, private.auth_recovery_proofs, private.authentication_events
  from public, anon, authenticated, service_role;

create function private.auth_server_rate_limit(bucket_hash text, maximum integer, window_seconds integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare current_bucket private.auth_request_limits; retry integer;
begin
  if auth.uid() is not null then raise exception 'Stateless server context required' using errcode='42501'; end if;
  if bucket_hash is null or bucket_hash !~ '^[a-f0-9]{64}$' or maximum not between 1 and 1000 or window_seconds not between 1 and 86400 then raise exception 'Invalid limit'; end if;
  delete from private.auth_request_limits old_bucket where old_bucket.bucket_hash in
    (select l.bucket_hash from private.auth_request_limits l where l.expires_at < now() - interval '1 day' limit 100);
  insert into private.auth_request_limits(bucket_hash,expires_at) values(bucket_hash,now()+make_interval(secs=>window_seconds)) on conflict do nothing;
  select * into current_bucket from private.auth_request_limits l where l.bucket_hash=auth_server_rate_limit.bucket_hash for update;
  if current_bucket.expires_at <= now() then
    current_bucket.requests:=0; current_bucket.window_started_at:=now(); current_bucket.expires_at:=now()+make_interval(secs=>window_seconds);
  end if;
  retry:=greatest(1,ceil(extract(epoch from current_bucket.expires_at-now()))::integer);
  if current_bucket.requests >= maximum then return jsonb_build_object('allowed',false,'retryAfter',retry); end if;
  update private.auth_request_limits l set requests=current_bucket.requests+1,window_started_at=current_bucket.window_started_at,expires_at=current_bucket.expires_at where l.bucket_hash=auth_server_rate_limit.bucket_hash;
  return jsonb_build_object('allowed',true,'retryAfter',0);
end;
$$;

create function private.auth_server_begin_password(subject_hash text, attempt_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare state private.auth_login_state; pending integer;
begin
  if auth.uid() is not null then raise exception 'Stateless server context required' using errcode='42501'; end if;
  if subject_hash is null or subject_hash !~ '^[a-f0-9]{64}$' or attempt_id is null then raise exception 'Invalid attempt'; end if;
  insert into private.auth_login_state(subject_hash) values(subject_hash) on conflict do nothing;
  select * into state from private.auth_login_state s where s.subject_hash=auth_server_begin_password.subject_hash for update;
  if state.locked_until > now() then return jsonb_build_object('allowed',false,'locked',true,'retryAfter',ceil(extract(epoch from state.locked_until-now()))::integer); end if;
  if state.window_started_at <= now()-interval '24 hours' or state.locked_until is not null then
    update private.auth_login_state s set failures=0,locked_until=null,window_started_at=now(),updated_at=now() where s.subject_hash=state.subject_hash;
    state.failures:=0;
  end if;
  delete from private.auth_login_attempts a where a.subject_hash=state.subject_hash and a.expires_at<=now();
  select count(*) into pending from private.auth_login_attempts a where a.subject_hash=state.subject_hash;
  if state.failures+pending >= 5 then return jsonb_build_object('allowed',false,'locked',false,'retryAfter',90); end if;
  insert into private.auth_login_attempts(attempt_id,subject_hash) values(attempt_id,state.subject_hash);
  return jsonb_build_object('allowed',true,'locked',false,'retryAfter',0);
end;
$$;

create function private.auth_server_finish_password(subject_hash text, attempt_id uuid, outcome text, user_id uuid default null, session_id uuid default null)
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
    where s.id=auth_server_finish_password.session_id and s.user_id=auth_server_finish_password.user_id and u.email_confirmed_at is not null and (s.not_after is null or s.not_after>now())) then raise exception 'Verified session required'; end if;
  update private.auth_login_state s set failures=0,locked_until=null,window_started_at=now(),updated_at=now() where s.subject_hash=state.subject_hash;
  insert into private.workspace_approved_sessions(session_id,user_id) values(session_id,user_id) on conflict on constraint workspace_approved_sessions_pkey do nothing;
  insert into private.authentication_events(event_type,subject_hash,user_id) values('password_login',state.subject_hash,user_id);
  return jsonb_build_object('allowed',true,'locked',false,'retryAfter',0);
end;
$$;

create function private.auth_server_recovery(proof_hash text, user_id uuid, session_id uuid, phase text, subject_hash text default null, lease_id uuid default null)
returns boolean language plpgsql security definer set search_path = '' as $$
declare proof private.auth_recovery_proofs;
begin
  if auth.uid() is not null then raise exception 'Stateless server context required' using errcode='42501'; end if;
  if proof_hash is null or proof_hash !~ '^[a-f0-9]{64}$' then raise exception 'Invalid recovery proof'; end if;
  if not exists(select 1 from auth.sessions s join auth.users u on u.id=s.user_id where s.id=auth_server_recovery.session_id and s.user_id=auth_server_recovery.user_id and u.email_confirmed_at is not null and (s.not_after is null or s.not_after>now())) then return false; end if;
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
      and u.email_confirmed_at is not null and a.expires_at>now() and (s.not_after is null or s.not_after>now())
  );
$$;
drop policy profiles_self_or_super_admin on public.workspace_profiles;
create policy profiles_self_or_super_admin on public.workspace_profiles for select to authenticated
  using ((select private.has_workspace_session()) and (user_id=(select auth.uid()) or (select private.is_workspace_super_admin())));

create function public.workspace_session_allowed() returns boolean language sql security invoker set search_path='' as $$ select private.has_workspace_session(); $$;
revoke all on function public.workspace_session_allowed() from public,anon,authenticated;
grant execute on function public.workspace_session_allowed() to authenticated;

-- This key stays on the server. No security-state RPC is callable by a user JWT.
grant usage on schema private to service_role;
revoke all on function private.auth_server_rate_limit(text,integer,integer),private.auth_server_begin_password(text,uuid),
  private.auth_server_finish_password(text,uuid,text,uuid,uuid),private.auth_server_recovery(text,uuid,uuid,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function private.auth_server_rate_limit(text,integer,integer),private.auth_server_begin_password(text,uuid),
  private.auth_server_finish_password(text,uuid,text,uuid,uuid),private.auth_server_recovery(text,uuid,uuid,text,text,uuid) to service_role;
create function public.auth_server_rate_limit(bucket_hash text,maximum integer,window_seconds integer) returns jsonb language sql security invoker set search_path='' as $$ select private.auth_server_rate_limit(bucket_hash,maximum,window_seconds); $$;
create function public.auth_server_begin_password(subject_hash text,attempt_id uuid) returns jsonb language sql security invoker set search_path='' as $$ select private.auth_server_begin_password(subject_hash,attempt_id); $$;
create function public.auth_server_finish_password(subject_hash text,attempt_id uuid,outcome text,user_id uuid default null,session_id uuid default null) returns jsonb language sql security invoker set search_path='' as $$ select private.auth_server_finish_password(subject_hash,attempt_id,outcome,user_id,session_id); $$;
create function public.auth_server_recovery(proof_hash text,user_id uuid,session_id uuid,phase text,subject_hash text default null,lease_id uuid default null) returns boolean language sql security invoker set search_path='' as $$ select private.auth_server_recovery(proof_hash,user_id,session_id,phase,subject_hash,lease_id); $$;
revoke all on function public.auth_server_rate_limit(text,integer,integer),public.auth_server_begin_password(text,uuid),
  public.auth_server_finish_password(text,uuid,text,uuid,uuid),public.auth_server_recovery(text,uuid,uuid,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.auth_server_rate_limit(text,integer,integer),public.auth_server_begin_password(text,uuid),
  public.auth_server_finish_password(text,uuid,text,uuid,uuid),public.auth_server_recovery(text,uuid,uuid,text,text,uuid) to service_role;
