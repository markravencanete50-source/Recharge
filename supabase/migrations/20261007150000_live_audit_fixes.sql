-- Fixes from the end-to-end check of every role against live data (7 October 2026).

-- 1. Speed. Every row a screen lists re-checked the sign-in session, joining the auth
--    tables each time: about 8 ms a row, so 3-4 seconds for 415 cleans. A positive check
--    is now remembered for the rest of the request (transaction), keyed by the user and
--    their session id, so the same request never repeats it. A failed check is never
--    remembered. This trusts the same request settings as the signed-in token itself.
create or replace function private.has_workspace_session() returns boolean language plpgsql stable security definer set search_path='' as $$
declare uid uuid := auth.uid(); key text; ok boolean;
begin
 if uid is null then return false; end if;
 key := uid::text||':'||coalesce(auth.jwt()->>'session_id','');
 if current_setting('recharge.workspace_session', true) = key then return true; end if;
 select exists (
   select 1 from auth.sessions s join auth.users u on u.id=s.user_id
   join private.workspace_approved_sessions a on a.session_id=s.id and a.user_id=s.user_id
   where s.user_id=uid and s.id::text=auth.jwt()->>'session_id'
     and ((nullif(u.email,'') is not null and u.email_confirmed_at is not null) or (nullif(to_jsonb(u)->>'phone','') is not null and nullif(to_jsonb(u)->>'phone_confirmed_at','') is not null))
     and a.expires_at>now() and (s.not_after is null or s.not_after>now())
 ) into ok;
 if ok then perform set_config('recharge.workspace_session', key, true); end if;
 return ok;
end $$;

create or replace function private.workspace_actor_role() returns text language plpgsql stable security definer set search_path='' as $$
declare key text; cached text; actor text;
begin
 if auth.uid() is null then return null; end if;
 key := auth.uid()::text||':'||coalesce(auth.jwt()->>'session_id','');
 cached := current_setting('recharge.workspace_actor', true);
 if cached is not null and split_part(cached,'|',1)=key then return split_part(cached,'|',2); end if;
 select role into actor from public.workspace_profiles where user_id=auth.uid() and status='active' and private.has_workspace_session();
 if actor is not null then perform set_config('recharge.workspace_actor', key||'|'||actor, true); end if;
 return actor;
end $$;

-- 2. The work list returned only the 100 most recently changed items, so with 415 Hostaway
--    cleans everything else (repairs, pricing, reviews) dropped out of the app. It now returns
--    every open item and the 200 most recently closed.
create or replace function private.workspace_operations_read(target_property uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare items jsonb;begin
 if private.workspace_actor_role() is null then raise exception 'Active access required' using errcode='42501';end if;
 select coalesce(jsonb_agg(private.workspace_operation_view(w.id) order by w.updated_at desc),'[]') into items from (
  (select w.* from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
    where (target_property is null or w.property_id=target_property) and w.status not in ('completed','cancelled') and private.workspace_operation_access(w.id)
    order by w.updated_at desc limit 5000)
  union all
  (select w.* from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
    where (target_property is null or w.property_id=target_property) and w.status in ('completed','cancelled') and private.workspace_operation_access(w.id)
    order by w.updated_at desc limit 200)
 ) w;
 return items;
end $$;

-- 3. Admins can give a team member every property in one step (Hostaway imports properties
--    with nobody assigned, and staff only see assigned properties).
create or replace function private.workspace_admin_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare target uuid;target_email text;target_role text;kind text;added integer:=0;prop uuid;begin
 if coalesce(private.workspace_actor_role(),'') not in ('admin','super_admin') then raise exception 'Admin access required' using errcode='42501';end if;
 if coalesce(input->>'action','')='assignAllProperties' then
  perform private.workspace_json_keys(input,array['action','userId']);
  target:=(input->>'userId')::uuid;
  select role into target_role from public.workspace_profiles where user_id=target and status='active';
  if target_role is null then raise exception 'Approve this account before giving it properties' using errcode='22023';end if;
  if target_role in ('admin','super_admin') then raise exception 'Admins already see every property' using errcode='22023';end if;
  if target_role='client' then raise exception 'Owners are given their own properties one at a time' using errcode='22023';end if;
  kind:=case target_role when 'cleans' then 'cleaner' when 'cleaning_manager' then 'cleaning_manager' else 'staff' end;
  for prop in select p.id from public.workspace_properties p where p.status<>'archived' and not exists(select 1 from public.workspace_property_assignments a where a.property_id=p.id and a.user_id=target) loop
   perform private.workspace_assign_property(prop,target,kind);added:=added+1;
  end loop;
  return jsonb_build_object('added',added);
 end if;
 if coalesce(input->>'action','')<>'saveAccess' then raise exception 'Unknown admin action' using errcode='22023';end if;
 perform private.workspace_json_keys(input,array['action','userId','fullName','role','status','modules','responsibilities']);
 if jsonb_typeof(input->'modules') is distinct from 'array' or jsonb_array_length(input->'modules')>60 then raise exception 'Choose the tools for this account' using errcode='22023';end if;
 target:=(input->>'userId')::uuid;
 select email into target_email from auth.users where id=target;
 if target_email is null then raise exception 'This account signed up by phone and has no email yet, so it cannot be approved here' using errcode='22023';end if;
 perform private.workspace_save_access(target_email,coalesce(input->>'fullName',''),input->>'role',input->>'status',
  array(select jsonb_array_elements_text(input->'modules')),coalesce(input->>'responsibilities',''));
 return private.workspace_account_json(target);
end $$;

-- 4. Patches to longer functions, applied in place: onboarding journeys are no longer cut at
--    100, and the invoice handovers Accounts receives (onboarding, direct booking, repair and
--    clean invoices) can be marked complete with evidence, like the other handovers. On a
--    fresh database these run after the original definitions and change the same text.
do $$
declare
 fixes constant text[][] := array[
  ['private.workspace_journey_read(uuid)', $q$order by j.updated_at desc limit 100$q$, $q$order by j.updated_at desc limit 1000$q$],
  ['private.workspace_operations_action(jsonb)', $q$elsif kind in ('cleaning_setup','garden_setup','furnishing_quote','relisting') and step='completeHandover' then$q$, $q$elsif kind in ('cleaning_setup','garden_setup','furnishing_quote','relisting','onboarding_invoice','direct_booking_invoice','maintenance_invoice','cleaning_invoice') and step='completeHandover' then$q$]
 ];
 definition text;
begin
 for i in 1..array_length(fixes, 1) loop
  definition := pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][2] in definition) > 0 then execute replace(definition, fixes[i][2], fixes[i][3]); end if;
 end loop;
end $$;
