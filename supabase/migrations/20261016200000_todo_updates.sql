-- Round 6, from Alex's video: each to-do keeps a log of updates (what, who, when).
--   * Anyone who can see the to-do can add an update (private.workspace_hub_can_see, the to-do's own rule).
--   * Owners never see staff to-dos: the hub read and this action refuse the client role.
--   * Ticking a to-do done logs "Marked done"; reopening it logs "Reopened".
--   * The hub view returns, for a to-do, the running total and the history newest first (up to 100).
-- Run-twice safe: the table and index are "if not exists", the functions are replaced, and each patch of a
-- shared function has a sentinel and a single-line anchor that must occur exactly once.

create table if not exists private.workspace_hub_item_updates (
 id bigint generated always as identity primary key,
 item_id uuid not null references private.workspace_hub_items(id) on delete cascade,
 body text not null check(length(trim(body)) between 1 and 2000),
 kind text not null default 'note' check(kind in ('note','done','reopened')),
 created_by uuid not null references public.workspace_profiles(user_id),
 created_at timestamptz not null default now()
);
create index if not exists workspace_hub_item_updates_item_idx on private.workspace_hub_item_updates(item_id,id desc);
create index if not exists workspace_hub_item_updates_creator_idx on private.workspace_hub_item_updates(created_by);
alter table private.workspace_hub_item_updates enable row level security;
revoke all on private.workspace_hub_item_updates from public,anon,authenticated;
drop trigger if exists business_write_limit on private.workspace_hub_item_updates;
create trigger business_write_limit before insert on private.workspace_hub_item_updates for each row execute function private.workspace_enforce_write_limit();

-- A to-do's updates, newest first, for the hub view.
create or replace function private.workspace_todo_updates_view(target uuid) returns jsonb language sql stable security definer set search_path='' as $fn$
 select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'text',u.body,'kind',u.kind,'byId',u.created_by,'byName',a.full_name,'at',u.created_at) order by u.id desc),'[]')
 from (select * from private.workspace_hub_item_updates x where x.item_id=target order by x.id desc limit 100) u
 left join public.workspace_profiles a on a.user_id=u.created_by
$fn$;

-- Add an update: { action: 'addTodoUpdate', requestId, id, text }. Returns the to-do's view with its history.
create or replace function private.workspace_todo_update_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();req uuid;prior private.workspace_action_receipts;result jsonb;item private.workspace_hub_items;txt text;event_id bigint;
begin
 if actor is null or actor='client' then raise exception 'Team access required' using errcode='42501';end if;
 if input->>'action' is distinct from 'addTodoUpdate' then raise exception 'Unknown to-do action' using errcode='22023';end if;
 perform private.workspace_json_keys(input,array['action','requestId','id','text']);
 req:=(input->>'requestId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 prior:=(select r from private.workspace_action_receipts r where r.actor_id=auth.uid() and r.request_id=req);
 if prior.actor_id is not null then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;
 select * into item from private.workspace_hub_items i where i.id=(input->>'id')::uuid for update;
 if item.id is null or item.kind<>'todo' or not private.workspace_hub_can_see(item) then raise exception 'To-do not found' using errcode='P0002';end if;
 txt:=private.workspace_required_text(input,'text',1,2000);
 insert into private.workspace_hub_item_updates(item_id,body,kind,created_by) values(item.id,txt,'note',auth.uid());
 update private.workspace_hub_items set updated_at=now() where id=item.id returning * into item;
 result:=private.workspace_hub_view(item);
 -- Whoever it is for, and whoever set it, hear about it (not the person writing).
 insert into public.workspace_activity(actor_id,property_id,event_type) values(auth.uid(),item.property_id,'hub.todo_updated') returning id into event_id;
 insert into private.workspace_notification_outbox(user_id,event_id) select distinct u,event_id from unnest(array[item.assignee_id,item.created_by]) u
  where u is not null and u is distinct from auth.uid() on conflict do nothing;
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $fn$;

revoke all on function private.workspace_todo_updates_view(uuid),private.workspace_todo_update_action(jsonb) from public,anon,authenticated;

do $$
declare
 -- function, anchor (single line, must occur exactly once), replacement, sentinel (present once patched)
 fixes constant text[][] := array[
  ['private.workspace_hub_view(private.workspace_hub_items)',
   $q$'templateId',item.template_id,$q$,
   $q$'templateId',item.template_id,'updateCount',case when item.kind='todo' then (select count(*) from private.workspace_hub_item_updates u where u.item_id=item.id) else 0 end,'updates',case when item.kind='todo' then private.workspace_todo_updates_view(item.id) else '[]'::jsonb end,$q$,
   $q$private.workspace_todo_updates_view(item.id)$q$],
  ['private.workspace_hub_action(jsonb)',
   $q$event:='hub.'||item.kind||'_'||st;$q$,
   $q$event:='hub.'||item.kind||'_'||st; if item.kind='todo' then insert into private.workspace_hub_item_updates(item_id,body,kind,created_by) values(item.id,case when st='done' then 'Marked done' else 'Reopened' end,case when st='done' then 'done' else 'reopened' end,auth.uid()); end if;$q$,
   $q$'Marked done'$q$],
  ['private.workspace_teams_action(jsonb)',
   $q$if a in ('saveHubItem','moveHubItem') then return private.workspace_hub_action(input);end if;$q$,
   $q$if a in ('saveHubItem','moveHubItem') then return private.workspace_hub_action(input);end if; if a='addTodoUpdate' then return private.workspace_todo_update_action(input);end if;$q$,
   $q$private.workspace_todo_update_action(input)$q$]
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
