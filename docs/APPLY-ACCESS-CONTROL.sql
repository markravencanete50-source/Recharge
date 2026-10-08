-- Run this once in the Supabase SQL editor (project brixfalrrmzqoioggvfx) to switch on Access control.
-- It is the migration supabase/migrations/20261008280000_access_control.sql, then the line that
-- records it as applied. Safe to run more than once. Paste all of it and press Run; if Supabase
-- offers to add Row Level Security lines, choose to run the query without them.
begin;
-- Access control for super admins: every account in one place, with its role and tools, and the
-- security actions: sign out everywhere, revoke the password (the person must set a new one through
-- "Forgot password"), block and unblock, and delete. An account with no history in the workspace is
-- removed completely; one with history is closed instead (name removed, all access taken away,
-- blocked from signing in), so the records of who did what stay intact. Every change is recorded
-- in workspace_access_events. Safe to run more than once.

create table if not exists private.workspace_password_revocations (
 user_id uuid primary key references auth.users(id) on delete cascade,
 revoked_by uuid, revoked_at timestamptz not null default now()
);
create table if not exists private.workspace_closed_accounts (
 user_id uuid primary key references public.workspace_profiles(user_id) on delete cascade,
 closed_by uuid, closed_at timestamptz not null default now()
);
alter table private.workspace_password_revocations enable row level security;
alter table private.workspace_closed_accounts enable row level security;
revoke all on private.workspace_password_revocations,private.workspace_closed_accounts from public,anon,authenticated;

-- Ends every session the person has: the app's approved sessions and the sign-in sessions behind them.
create or replace function private.workspace_end_sessions(target uuid) returns integer language plpgsql security definer set search_path='' as $$
declare ended integer;begin
 delete from private.workspace_approved_sessions where user_id=target;
 delete from auth.sessions where user_id=target;
 get diagnostics ended=row_count;
 return ended;
end $$;
-- Blocks (or allows) sign-in at the sign-in service itself, where it supports it.
create or replace function private.workspace_set_sign_in_blocked(target uuid, blocked boolean) returns void language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from information_schema.columns where table_schema='auth' and table_name='users' and column_name='banned_until') then
  execute 'update auth.users set banned_until=$1 where id=$2' using case when blocked then 'infinity'::timestamptz else null end, target;
 end if;
end $$;

create or replace function private.workspace_access_person(target uuid) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('userId',p.user_id,'fullName',p.full_name,'email',u.email,'phone',nullif(to_jsonb(u)->>'phone',''),'role',p.role,'status',p.status,
  'emailVerified',u.email_confirmed_at is not null,'joinedAt',p.created_at,'lastSignInAt',to_jsonb(u)->>'last_sign_in_at',
  'modules',coalesce((select jsonb_agg(g.module_id order by g.module_id) from public.workspace_module_grants g where g.user_id=p.user_id),'[]'),
  'properties',(select count(*) from public.workspace_property_assignments a where a.user_id=p.user_id),
  'activeSessions',(select count(*) from private.workspace_approved_sessions s join auth.sessions x on x.id=s.session_id where s.user_id=p.user_id and (x.not_after is null or x.not_after>now())),
  'passwordRevoked',exists(select 1 from private.workspace_password_revocations r where r.user_id=p.user_id),
  'closed',exists(select 1 from private.workspace_closed_accounts c where c.user_id=p.user_id))
 from public.workspace_profiles p join auth.users u on u.id=p.user_id where p.user_id=target;
$$;

create or replace function private.workspace_access_control_read(section text) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(private.workspace_actor_role(),'')<>'super_admin' then raise exception 'Super admin access required' using errcode='42501';end if;
 if section='accessControl' then
  return coalesce((select jsonb_agg(private.workspace_access_person(p.user_id) order by case p.status when 'pending' then 0 when 'active' then 1 else 2 end,p.full_name,p.user_id) from public.workspace_profiles p),'[]');
 elsif section='accessHistory' then
  return coalesce((select jsonb_agg(e order by (e->>'at') desc) from (
   select jsonb_build_object('id',a.id,'event',a.event_type,'at',a.occurred_at,'target',coalesce(t.full_name,'Removed account'),'actor',coalesce(x.full_name,'System'),'detail',coalesce(a.new_access,'{}')) e
   from public.workspace_access_events a left join public.workspace_profiles t on t.user_id=a.user_id left join public.workspace_profiles x on x.user_id=a.actor_id
   order by a.occurred_at desc,a.id desc limit 60) h),'[]');
 end if;
 raise exception 'Unknown admin section' using errcode='22023';
end $$;

create or replace function private.workspace_access_control_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a text:=input->>'action';target uuid;person public.workspace_profiles;email text;ended integer;other_super boolean;begin
 if coalesce(private.workspace_actor_role(),'')<>'super_admin' then raise exception 'Super admin access required' using errcode='42501';end if;
 target:=(input->>'userId')::uuid;
 person:=(select p from public.workspace_profiles p where p.user_id=target for update);
 if person.user_id is null then raise exception 'Account not found' using errcode='P0002';end if;
 if target=auth.uid() then raise exception 'You can’t change your own access here. Ask another super admin.' using errcode='42501';end if;
 other_super:=exists(select 1 from public.workspace_profiles where user_id<>target and role='super_admin' and status='active');
 if exists(select 1 from private.workspace_closed_accounts where user_id=target) and a<>'deleteAccount' then raise exception 'This account has been deleted' using errcode='22023';end if;
 if a='setAccess' then
  perform private.workspace_json_keys(input,array['action','userId','role','modules']);
  if jsonb_typeof(input->'modules') is distinct from 'array' or jsonb_array_length(input->'modules')>60 then raise exception 'Choose the tools for this account' using errcode='22023';end if;
  email:=(select u.email from auth.users u where u.id=target);
  if email is null then raise exception 'This account signed up by phone and has no email yet, so its access cannot be changed here' using errcode='22023';end if;
  perform private.workspace_save_access(email,person.full_name,input->>'role',person.status,array(select jsonb_array_elements_text(input->'modules')),person.responsibilities);
 elsif a in ('block','deleteAccount') or (a='revokePassword') or (a='signOut') or (a='unblock') then
  perform private.workspace_json_keys(input,array['action','userId','confirm']);
  if a in ('block','deleteAccount') and person.role='super_admin' and person.status='active' and not other_super then raise exception 'Keep at least one active super admin' using errcode='42501';end if;
  if a in ('deleteAccount') and input->'confirm' is distinct from 'true'::jsonb then raise exception 'Confirm the deletion' using errcode='22023';end if;
  if a='signOut' then
   ended:=private.workspace_end_sessions(target);
   insert into public.workspace_access_events(user_id,actor_id,event_type,new_access) values(target,auth.uid(),'signed_out_everywhere',jsonb_build_object('sessions',ended));
  elsif a='revokePassword' then
   insert into private.workspace_password_revocations(user_id,revoked_by) values(target,auth.uid()) on conflict(user_id) do update set revoked_by=excluded.revoked_by,revoked_at=now();
   ended:=private.workspace_end_sessions(target);
   insert into public.workspace_access_events(user_id,actor_id,event_type,new_access) values(target,auth.uid(),'password_revoked',jsonb_build_object('sessions',ended));
  elsif a='block' then
   if person.status='revoked' then raise exception 'This account is already blocked' using errcode='22023';end if;
   update public.workspace_profiles set status='revoked',updated_at=now() where user_id=target;
   perform private.workspace_end_sessions(target);perform private.workspace_set_sign_in_blocked(target,true);
   insert into public.workspace_access_events(user_id,actor_id,event_type,old_access,new_access) values(target,auth.uid(),'account_blocked',jsonb_build_object('status',person.status),jsonb_build_object('status','revoked'));
  elsif a='unblock' then
   if person.status<>'revoked' then raise exception 'This account is not blocked' using errcode='22023';end if;
   if person.role not in ('admin','super_admin') and not exists(select 1 from public.workspace_module_grants where user_id=target) then raise exception 'Give this account at least one tool before unblocking it' using errcode='22023';end if;
   update public.workspace_profiles set status='active',updated_at=now() where user_id=target;
   perform private.workspace_set_sign_in_blocked(target,false);
   insert into public.workspace_access_events(user_id,actor_id,event_type,old_access,new_access) values(target,auth.uid(),'account_unblocked',jsonb_build_object('status','revoked'),jsonb_build_object('status','active'));
  else
   -- Delete: take away all access first, then remove the account if nothing else refers to it.
   insert into public.workspace_access_events(user_id,actor_id,event_type,old_access) values(target,auth.uid(),'account_deleted',jsonb_build_object('role',person.role,'status',person.status));
   perform private.workspace_end_sessions(target);
   delete from public.workspace_module_grants where user_id=target;
   delete from public.workspace_property_assignments where user_id=target;
   delete from private.workspace_device_tokens where user_id=target;
   delete from private.workspace_notification_outbox where user_id=target;
   delete from private.workspace_write_limits where user_id=target;
   begin
    delete from auth.users where id=target;
    return jsonb_build_object('userId',target,'outcome','deleted');
   exception when foreign_key_violation then
    -- Their work stays on record, under "Deleted account".
    update public.workspace_profiles set full_name='Deleted account',responsibilities='',status='revoked',updated_at=now() where user_id=target;
    insert into private.workspace_closed_accounts(user_id,closed_by) values(target,auth.uid()) on conflict do nothing;
    insert into private.workspace_password_revocations(user_id,revoked_by) values(target,auth.uid()) on conflict(user_id) do nothing;
    perform private.workspace_set_sign_in_blocked(target,true);
    return jsonb_build_object('userId',target,'outcome','closed');
   end;
  end if;
 else raise exception 'Unknown access action' using errcode='22023';end if;
 return private.workspace_access_person(target);
end $$;
revoke all on function private.workspace_end_sessions(uuid),private.workspace_set_sign_in_blocked(uuid,boolean),private.workspace_access_person(uuid),
 private.workspace_access_control_read(text),private.workspace_access_control_action(jsonb) from public,anon,authenticated;

-- Route through the existing admin endpoints, and make sign-in respect a revoked password until
-- the person sets a new one (by email or phone recovery).
do $$
declare
 fixes constant text[][] := array[
  ['private.workspace_admin_read(text)',
   $q$ elsif section='properties' then$q$,
   $q$ elsif section in ('accessControl','accessHistory') then return private.workspace_access_control_read(section);
 elsif section='properties' then$q$,
   'workspace_access_control_read'],
  ['private.workspace_admin_action(jsonb)',
   $q$ if coalesce(input->>'action','')='assignAllProperties' then$q$,
   $q$ if coalesce(input->>'action','') in ('setAccess','block','unblock','signOut','revokePassword','deleteAccount') then return private.workspace_access_control_action(input);end if;
 if coalesce(input->>'action','')='assignAllProperties' then$q$,
   'workspace_access_control_action'],
  ['private.auth_server_finish_password(text,uuid,text,uuid,uuid)',
   $q$insert into private.workspace_approved_sessions(session_id,user_id) values(session_id,user_id) on conflict on constraint workspace_approved_sessions_pkey do nothing;$q$,
   $q$if exists(select 1 from private.workspace_password_revocations r where r.user_id=auth_server_finish_password.user_id) then return jsonb_build_object('allowed',false,'locked',false,'retryAfter',0,'passwordReset',true); end if;
  insert into private.workspace_approved_sessions(session_id,user_id) values(session_id,user_id) on conflict on constraint workspace_approved_sessions_pkey do nothing;$q$,
   'workspace_password_revocations'],
  ['private.auth_server_recovery(text,uuid,uuid,text,text,uuid)',
   $q$delete from private.auth_recovery_proofs p where p.user_id=auth_server_recovery.user_id;$q$,
   $q$delete from private.auth_recovery_proofs p where p.user_id=auth_server_recovery.user_id;
  delete from private.workspace_password_revocations r where r.user_id=auth_server_recovery.user_id and not exists(select 1 from private.workspace_closed_accounts c where c.user_id=r.user_id);$q$,
   'workspace_password_revocations']
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

insert into supabase_migrations.schema_migrations(version,name) values('20261008280000','access_control') on conflict do nothing;
commit;
