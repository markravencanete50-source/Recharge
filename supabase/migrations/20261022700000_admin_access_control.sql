-- Access control for admins (Lee, decided). Until now Access control (every account, the access history and the
-- actions on each account) was for super admins alone. Admins now open it too, with limits the database enforces:
--  * Admins see every account (super admins included) and the access history.
--  * Admins change role and tools, block and unblock, sign out everywhere, revoke the password and make a
--    set-password link, only for accounts whose role is below admin (team roles and owners).
--  * Admins never change, block, sign out or link an admin or super admin account (other admins included), never give
--    anyone the role admin or super admin, and never delete an account. Their own account is refused as before.
--  * Adding a person as an admin, and approving or editing someone in People, already go through
--    private.workspace_save_access, which refuses admins anything touching an admin or super admin account
--    ('Only a super admin can manage admin accounts'). That check is unchanged.
--  * The Menu order (private.workspace_menu_layouts_read and private.workspace_menu_layout_action) stays super admin only.
--  * Super admins keep everything exactly as before: the new check returns straight away for them.
-- New: private.workspace_access_check(uuid,text,text) (internal, no grants), and the admin action 'passwordLinkCheck',
-- which the server asks before it makes a set-password link, so the same rules decide who may get one.
-- Patches by anchor, each applied once (a sentinel shows it is in): private.workspace_access_control_read(text),
-- private.workspace_access_control_action(jsonb) and private.workspace_admin_action(jsonb). No DROP, no DELETE.
-- Safe to run more than once.

-- What an admin may do to an account. Super admins may do anything (the action's own checks still apply);
-- anyone else but an admin is refused. The target's current role is read here, and the new role when one is asked.
create or replace function private.workspace_access_check(target uuid, a text, next_role text default null) returns void
language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();target_role text;
begin
 if coalesce(actor,'') not in ('admin','super_admin') then raise exception 'Admin access required' using errcode='42501';end if;
 if actor='super_admin' then return;end if;
 if a='deleteAccount' then raise exception 'Only a super admin can delete accounts' using errcode='42501';end if;
 select p.role into target_role from public.workspace_profiles p where p.user_id=target;
 if target_role in ('admin','super_admin') then raise exception 'Only a super admin can change admin accounts' using errcode='42501';end if;
 if next_role in ('admin','super_admin') then raise exception 'Only a super admin can make someone an admin' using errcode='42501';end if;
end $fn$;
revoke all on function private.workspace_access_check(uuid,text,text) from public,anon,authenticated;

do $patch$
declare
 fixes constant text[][] := array[
  -- Admins read Access control and the access history too.
  ['private.workspace_access_control_read(text)',
   $q$ if coalesce(private.workspace_actor_role(),'')<>'super_admin' then raise exception 'Super admin access required' using errcode='42501';end if;$q$,
   $q$ /* admins too: 20261022700000 */ if coalesce(private.workspace_actor_role(),'') not in ('admin','super_admin') then raise exception 'Admin access required' using errcode='42501';end if;$q$,
   $q$/* admins too: 20261022700000 */$q$],
  -- Admins reach the actions; private.workspace_access_check below decides which accounts and which actions.
  ['private.workspace_access_control_action(jsonb)',
   $q$ if coalesce(private.workspace_actor_role(),'')<>'super_admin' then raise exception 'Super admin access required' using errcode='42501';end if;$q$,
   $q$ /* admins too: 20261022700000 */ if coalesce(private.workspace_actor_role(),'') not in ('admin','super_admin') then raise exception 'Admin access required' using errcode='42501';end if;$q$,
   $q$/* admins too: 20261022700000 */$q$],
  -- After the own-account check: an admin acts only on accounts below admin, never makes an admin and never deletes.
  ['private.workspace_access_control_action(jsonb)',
   $q$ if target=auth.uid() then raise exception 'You can’t change your own access here. Ask another super admin.' using errcode='42501';end if;$q$,
   $q$ if target=auth.uid() then raise exception 'You can’t change your own access here. Ask another super admin.' using errcode='42501';end if;
 perform private.workspace_access_check(target,a,case when a='setAccess' then input->>'role' end);$q$,
   $q$perform private.workspace_access_check(target,a,$q$],
  -- The server asks before it makes a set-password link: the same checks, and nothing changes.
  ['private.workspace_access_control_action(jsonb)',
   $q$ else raise exception 'Unknown access action' using errcode='22023';end if;$q$,
   $q$ elsif a='passwordLinkCheck' then
  perform private.workspace_json_keys(input,array['action','userId']);
 else raise exception 'Unknown access action' using errcode='22023';end if;$q$,
   $q$elsif a='passwordLinkCheck' then$q$],
  ['private.workspace_admin_action(jsonb)',
   $q$ in ('setAccess','block','unblock','signOut','revokePassword','deleteAccount') then return private.workspace_access_control_action(input);end if;$q$,
   $q$ in ('setAccess','block','unblock','signOut','revokePassword','deleteAccount','passwordLinkCheck') then return private.workspace_access_control_action(input);end if;$q$,
   $q$'deleteAccount','passwordLinkCheck')$q$]
 ];
 definition text;hits integer;
begin
 for i in 1..array_length(fixes,1) loop
  definition:=pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in definition)=0 then
   hits:=(length(definition)-length(replace(definition,fixes[i][2],'')))/length(fixes[i][2]);
   if hits<>1 then raise exception 'Patch anchor found % times in % (patch %)',hits,fixes[i][1],i;end if;
   execute replace(definition,fixes[i][2],fixes[i][3]);
   if position(fixes[i][4] in pg_get_functiondef(fixes[i][1]::regprocedure))=0 then raise exception 'Patch did not take in % (patch %)',fixes[i][1],i;end if;
  end if;
 end loop;
end $patch$;
