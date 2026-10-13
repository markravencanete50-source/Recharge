-- Menu order per role (Lee's request, round 5). A super admin rearranges the left panel for each role in
-- Access control → Menu order: the order of the sections, and the order of the links inside each section.
-- The same order drives the desktop panel and the phone (lib/menu-layout.ts merges it). It only REORDERS:
-- what a role may see still comes from its role and tools, never from this table.
--  * private.workspace_menu_layouts: one small row per role (section keys in order, and per section the link
--    keys in order), with version, updated_by and updated_at. Empty arrays mean the default order.
--  * Team read section menuLayout: anyone signed in gets their OWN role's layout, order data only. While a
--    super admin views as someone, the reads run as that person, so they get that person's role.
--  * Team read section menuLayouts: super admins get every role's layout with who changed it last.
--  * Team actions saveMenuLayout and resetMenuLayout: super admins only, with an optimistic version check.
--    Every change is written to workspace_access_events (menu_order_saved, menu_order_reset), with the role,
--    the old and the new order.
-- Routes are appended after the hub anchors in workspace_teams_read and workspace_teams_action (anchor kept
-- word for word, own sentinel, a missing or repeated anchor raises). Safe to run twice.

create table if not exists private.workspace_menu_layouts (
 role text primary key check(role in ('super_admin','admin','stays','cleaning_manager','cleans','ready','accounts','client')),
 sections jsonb not null default '[]' check(jsonb_typeof(sections)='array'),
 items jsonb not null default '{}' check(jsonb_typeof(items)='object'),
 version integer not null default 1 check(version>0),
 updated_by uuid references public.workspace_profiles(user_id),
 updated_at timestamptz not null default now()
);
create index if not exists workspace_menu_layouts_updated_by_idx on private.workspace_menu_layouts(updated_by);
alter table private.workspace_menu_layouts enable row level security;
revoke all on private.workspace_menu_layouts from public,anon,authenticated;

-- A layout as the app reads it. Only order data, unless the caller is a super admin (who also sees who changed it).
create or replace function private.workspace_menu_layout_view(target_role text,full_view boolean) returns jsonb language sql stable security definer set search_path='' as $fn$
 select jsonb_build_object('role',target_role,'sections',coalesce(m.sections,'[]'::jsonb),'items',coalesce(m.items,'{}'::jsonb),'version',coalesce(m.version,0))
  ||case when full_view then jsonb_build_object('updatedAt',m.updated_at,'updatedByName',(select nullif(btrim(p.full_name),'') from public.workspace_profiles p where p.user_id=m.updated_by)) else '{}'::jsonb end
 from (select 1) one left join private.workspace_menu_layouts m on m.role=target_role
$fn$;

-- Your own role's menu order.
create or replace function private.workspace_menu_layout_read() returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();
begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 return private.workspace_menu_layout_view(actor,false);
end $fn$;

-- Every role's menu order, for the editor.
create or replace function private.workspace_menu_layouts_read() returns jsonb language plpgsql stable security definer set search_path='' as $fn$
begin
 if private.workspace_actor_role() is distinct from 'super_admin' then raise exception 'Only super admins can change the menu order' using errcode='42501';end if;
 return (select jsonb_agg(private.workspace_menu_layout_view(r,true) order by n) from unnest(array['super_admin','admin','stays','cleaning_manager','cleans','ready','accounts','client']) with ordinality as x(r,n));
end $fn$;

-- A list of stable keys: strings of lower-case letters, digits and : _ = -, each once, at most `most`.
create or replace function private.workspace_menu_keys(list jsonb,most integer) returns jsonb language plpgsql immutable set search_path='' as $fn$
begin
 if jsonb_typeof(list) is distinct from 'array' or jsonb_array_length(list)>most
  or exists(select 1 from jsonb_array_elements(list) k where jsonb_typeof(k)<>'string' or (k#>>'{}')!~'^[a-z0-9:_=-]{1,80}$')
  or (select count(distinct k) from jsonb_array_elements_text(list) k)<>jsonb_array_length(list) then
  raise exception 'Invalid menu order' using errcode='22023';
 end if;
 return list;
end $fn$;

create or replace function private.workspace_menu_layout_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();a text:=input->>'action';req uuid;prior private.workspace_action_receipts;result jsonb;
 target text;m private.workspace_menu_layouts;sections jsonb:='[]';items jsonb:='{}';k text;v jsonb;before jsonb;
begin
 if actor is distinct from 'super_admin' then raise exception 'Only super admins can change the menu order' using errcode='42501';end if;
 req:=(input->>'requestId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 prior:=(select x from private.workspace_action_receipts x where x.actor_id=auth.uid() and x.request_id=req);
 if prior.actor_id is not null then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;
 if a='saveMenuLayout' then perform private.workspace_json_keys(input,array['action','requestId','role','version','sections','items']);
 else perform private.workspace_json_keys(input,array['action','requestId','role','version']);end if;
 target:=input->>'role';
 if target is null or target not in ('super_admin','admin','stays','cleaning_manager','cleans','ready','accounts','client') then raise exception 'Choose a role' using errcode='22023';end if;
 if jsonb_typeof(input->'version') is distinct from 'number' then raise exception 'Version required' using errcode='22023';end if;
 select * into m from private.workspace_menu_layouts x where x.role=target for update;
 if coalesce(m.version,0)<>(input->>'version')::int then raise exception 'Changed by someone else. Refresh and try again' using errcode='40001';end if;
 before:=jsonb_build_object('role',target,'sections',coalesce(m.sections,'[]'::jsonb),'items',coalesce(m.items,'{}'::jsonb));
 if a='saveMenuLayout' then
  sections:=private.workspace_menu_keys(input->'sections',40);
  if jsonb_typeof(input->'items') is distinct from 'object' or (select count(*) from jsonb_object_keys(input->'items'))>40 then raise exception 'Invalid menu order' using errcode='22023';end if;
  for k,v in select x.key,x.value from jsonb_each(input->'items') x loop
   if k!~'^[a-z0-9:_=-]{1,80}$' then raise exception 'Invalid menu order' using errcode='22023';end if;
   items:=items||jsonb_build_object(k,private.workspace_menu_keys(v,80));
  end loop;
 elsif a<>'resetMenuLayout' then raise exception 'Unknown team action' using errcode='22023';
 end if;
 insert into private.workspace_menu_layouts(role,sections,items,version,updated_by,updated_at) values(target,sections,items,coalesce(m.version,0)+1,auth.uid(),now())
  on conflict(role) do update set sections=excluded.sections,items=excluded.items,version=private.workspace_menu_layouts.version+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at;
 -- The access history names the super admin who changed it; the role is in the detail.
 insert into public.workspace_access_events(user_id,actor_id,event_type,old_access,new_access)
  values(auth.uid(),auth.uid(),case when a='saveMenuLayout' then 'menu_order_saved' else 'menu_order_reset' end,before,jsonb_build_object('role',target,'sections',sections,'items',items));
 result:=private.workspace_menu_layout_view(target,true);
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $fn$;

revoke all on function private.workspace_menu_layout_view(text,boolean),private.workspace_menu_layout_read(),private.workspace_menu_layouts_read(),
 private.workspace_menu_keys(jsonb,integer),private.workspace_menu_layout_action(jsonb) from public,anon,authenticated;

do $$
declare
 fixes constant text[][] := array[
  ['private.workspace_teams_read(text,date,date,uuid,uuid)',
   $q$elsif section='hub' then result:=private.workspace_hub_read();$q$,
   $q$elsif section='hub' then result:=private.workspace_hub_read();
 elsif section='menuLayout' then result:=private.workspace_menu_layout_read();
 elsif section='menuLayouts' then result:=private.workspace_menu_layouts_read();$q$,
   $q$result:=private.workspace_menu_layout_read();$q$],
  ['private.workspace_teams_action(jsonb)',
   $q$if a in ('saveHubItem','moveHubItem') then return private.workspace_hub_action(input);end if;$q$,
   $q$if a in ('saveHubItem','moveHubItem') then return private.workspace_hub_action(input);end if;
 if a in ('saveMenuLayout','resetMenuLayout') then return private.workspace_menu_layout_action(input);end if;$q$,
   $q$return private.workspace_menu_layout_action(input);$q$]
 ];
 definition text;found_count integer;
begin
 for i in 1..array_length(fixes, 1) loop
  definition := pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in definition) = 0 then
   found_count := (length(definition) - length(replace(definition, fixes[i][2], ''))) / length(fixes[i][2]);
   if found_count <> 1 then raise exception 'Patch anchor found % times in % (%), expected once', found_count, fixes[i][1], i; end if;
   execute replace(definition, fixes[i][2], fixes[i][3]);
   if position(fixes[i][4] in pg_get_functiondef(fixes[i][1]::regprocedure)) = 0 then raise exception 'Patch did not take in % (%)', fixes[i][1], i; end if;
  end if;
 end loop;
end $$;
