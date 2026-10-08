-- Changing someone's role in Access control: their properties follow the new role, and the change
-- is recorded as "Role changed" with the old and new role. Property access checks match the kind of
-- assignment to the role (owner, cleaner, cleaning manager or team member), so without this a
-- cleaner moved to Stays would keep "cleaner" assignments and lose access to every property.
-- Team roles move between team kinds; an owner becoming a team member (or the reverse) is unassigned,
-- because owning a property and working on it are different links. Safe to run more than once.

create or replace function private.workspace_move_assignments(target uuid, old_role text, new_role text) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 kind constant text := case new_role when 'client' then 'client' when 'cleans' then 'cleaner' when 'cleaning_manager' then 'cleaning_manager' else 'staff' end;
 changed integer;
begin
 if (old_role = 'client') <> (new_role = 'client') then
  delete from public.workspace_property_assignments where user_id = target;
  get diagnostics changed = row_count;
  return jsonb_build_object('unassigned', changed);
 end if;
 update public.workspace_property_assignments set assignment = kind where user_id = target and assignment <> kind;
 get diagnostics changed = row_count;
 return jsonb_build_object('moved', changed);
end $$;
revoke all on function private.workspace_move_assignments(uuid,text,text) from public,anon,authenticated;

do $$
declare
 anchor constant text := $q$  perform private.workspace_save_access(email,person.full_name,input->>'role',person.status,array(select jsonb_array_elements_text(input->'modules')),person.responsibilities);$q$;
 definition text;
begin
 definition := pg_get_functiondef('private.workspace_access_control_action(jsonb)'::regprocedure);
 if position('workspace_move_assignments' in definition) = 0 then
  if position(anchor in definition) = 0 then raise exception 'Patch anchor missing in workspace_access_control_action'; end if;
  execute replace(definition, anchor, anchor || $q$
  if person.role is distinct from input->>'role' then
   insert into public.workspace_access_events(user_id,actor_id,event_type,old_access,new_access) values(target,auth.uid(),'role_changed',jsonb_build_object('role',person.role),
    jsonb_build_object('from',person.role,'role',input->>'role','properties',private.workspace_move_assignments(target,person.role,input->>'role')));
  end if;$q$);
 end if;
end $$;
