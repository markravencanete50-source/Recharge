-- View as co super admins: a super admin can now view the app as any other active super admin,
-- as well as everyone else, with the same guarantees as before:
--  * read-only: public.workspace_request_check() switches the whole request to a read-only
--    transaction whenever the View as header is accepted, whatever the person's role, so nothing
--    can be saved while viewing;
--  * private chats stay hidden and personal data downloads stay off (both key on the viewer, not
--    on a role);
--  * every start is recorded in Access history ('viewed_as');
--  * never yourself, never someone who is not active.
-- Changes, each patched by anchor (an anchor that must occur once, and a sentinel so a second run
-- changes nothing):
--  1. private.workspace_view_as_people(): super admins other than you are listed too.
--  2. private.workspace_view_as_start(jsonb): an active super admin other than you can be chosen.
--  3. private.workspace_view_as_target(text): a view of an active super admin is honoured, and a
--     request that is already viewing as someone can never start a further view. Before, a target
--     could not be a super admin, so running the request check again inside a viewed request was
--     refused by the super admin check; it is now refused outright, whoever is being viewed.
-- Safe to run twice.

do $patch$
declare
 fixes constant text[][] := array[
  ['private.workspace_view_as_people()',
   $q$p.status='active' and p.role<>'super_admin' and p.user_id<>auth.uid()$q$,
   $q$p.status='active' /* co super admins listed */ and p.user_id<>auth.uid()$q$,
   $q$/* co super admins listed */$q$],
  ['private.workspace_view_as_start(jsonb)',
   $q$if target=me or person.user_id is null or person.status<>'active' or person.role='super_admin' then raise exception 'Choose an active person who is not a super admin' using errcode='22023'; end if;$q$,
   $q$if target=me or person.user_id is null or person.status<>'active' /* co super admins allowed */ then raise exception 'Choose an active person other than yourself' using errcode='22023'; end if;$q$,
   $q$/* co super admins allowed */$q$],
  ['private.workspace_view_as_target(text)',
   $q$or not exists(select 1 from public.workspace_profiles p where p.user_id=target and p.status='active' and p.role<>'super_admin') then$q$,
   $q$or not exists(select 1 from public.workspace_profiles p where p.user_id=target and p.status='active' /* co super admins honoured */) then$q$,
   $q$/* co super admins honoured */$q$],
  ['private.workspace_view_as_target(text)',
   $q$if viewer is null or wanted is null or wanted !~$q$,
   $q$if private.workspace_viewer() is not null /* no view inside a view */ or viewer is null or wanted is null or wanted !~$q$,
   $q$/* no view inside a view */$q$]
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

-- The patched functions keep their grants; restated so they are certain. The Data API's public
-- wrappers run as the caller, so signed-in people keep execute; each function checks for itself.
revoke all on function private.workspace_view_as_people(), private.workspace_view_as_start(jsonb), private.workspace_view_as_target(text) from public, anon, service_role;
grant execute on function private.workspace_view_as_people(), private.workspace_view_as_start(jsonb), private.workspace_view_as_target(text) to authenticated;
