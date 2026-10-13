-- Guest messaging, who may use it (client answer 12): "landlords, cleaners and maintenance don't get access to guest messaging."
-- Until now the guest inbox refused owners (client) and cleaners (cleans) only; Ready (maintenance) could read and reply to guest
-- conversations once given the guest communication tool. From here the three roles are refused whatever tools they hold:
-- reading the list or a conversation, logging a message, replying, sending through Hostaway, closing and editing a conversation,
-- and the saved replies used to answer guests.
-- Everyone else still needs the guest communication tool, and the property, exactly as before.
-- guest_inbox_can is replaced whole (only 20261009140000 defines it; nothing patches it). The read and the action keep their own
-- gate and gain a second one right after it, by anchor and append (the anchor stays first, a sentinel stops a second run,
-- a missing or repeated anchor raises).

-- ---------------------------------------------------------------- assumption, one function
-- The roles that never use guest messaging. Mirrored by GUEST_MESSAGING_BLOCKED_ROLES in lib/workspace-chat-policy.ts.
create or replace function private.workspace_guest_messaging_role(actor_role text) returns boolean language sql immutable set search_path='' as $fn$
 select coalesce(actor_role not in ('client','cleans','ready'),false)
$fn$;

-- Which conversations a person may see: their role may use guest messaging, they hold the tool, and the conversation is for one
-- of their properties (or not yet matched to one).
create or replace function private.guest_inbox_can(prop uuid) returns boolean language sql stable security definer set search_path='' as $fn$
 select private.workspace_guest_messaging_role(private.workspace_actor_role()) and private.has_workspace_module('guest-communication')
  and (prop is null or private.workspace_can_property(prop,'guest-communication'));
$fn$;

-- Saved replies go with the guest inbox: admins, and anyone else whose role may use guest messaging and who holds the tool.
-- Replaced whole (only 20261009170000 defines it).
create or replace function private.saved_replies_can_read() returns boolean language sql stable security definer set search_path='' as $fn$
 select coalesce(private.workspace_actor_role() in ('admin','super_admin')
  or (private.workspace_guest_messaging_role(private.workspace_actor_role()) and private.has_workspace_module('guest-communication')),false);
$fn$;

revoke all on function private.workspace_guest_messaging_role(text),private.guest_inbox_can(uuid),private.saved_replies_can_read() from public,anon,authenticated;

do $patch$
declare
 fixes text[][]:=array[
  ['private.workspace_guest_inbox_read(text,uuid,text)',
   $q$raise exception 'Guest inbox access required' using errcode='42501';end if;$q$,
   $q$raise exception 'Guest inbox access required' using errcode='42501';end if;
 if not private.workspace_guest_messaging_role(private.workspace_actor_role()) then raise exception 'Guest inbox access required' using errcode='42501';end if;$q$,
   $q$if not private.workspace_guest_messaging_role(private.workspace_actor_role())$q$],
  ['private.workspace_guest_inbox_action(jsonb)',
   $q$raise exception 'Guest inbox access required' using errcode='42501';end if;$q$,
   $q$raise exception 'Guest inbox access required' using errcode='42501';end if;
 if not private.workspace_guest_messaging_role(private.workspace_actor_role()) then raise exception 'Guest inbox access required' using errcode='42501';end if;$q$,
   $q$if not private.workspace_guest_messaging_role(private.workspace_actor_role())$q$]
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
