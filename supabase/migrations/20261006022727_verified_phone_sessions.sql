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

