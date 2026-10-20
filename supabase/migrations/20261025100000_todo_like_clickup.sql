-- To-dos that work like ClickUp (Alex's video, 19 October 2026: a to-do should open like a ClickUp task, with its fields on one
-- side and the activity on the other).
--   * Priority (Urgent, High, Normal, Low, or none) and a start date beside the due date. Anyone who can see a to-do can set them
--     from the to-do itself (setTodoFields); the start date is never after the due date.
--   * Comments with replies: a reply belongs to one comment (a reply to a reply joins the same thread, as in ClickUp).
--   * @mentions: the people a comment mentions are kept with it (checked: active people on the team). A mentioned person is told,
--     and can see the to-do from then on, like a watcher in ClickUp.
--   * Reactions on comments: one per person (the chat's set of eight); choosing none takes yours off.
--   * Unread: each person's last look at a to-do (readTodo). The count is of other people's comments since then; comments written
--     before this was installed never count.
--   * Activity: what changed and who changed it ("set the due date to 24 Oct 2026", "gave it to Erika Smith"), written by a trigger
--     whenever a to-do changes, so every way of changing one is logged. "Marked done" and "Reopened" stay with the updates.
--   * Whoever wrote on a to-do hears about new comments on it, with its assignee and the person who set it.
-- Run-twice safe: tables, columns and indexes are "if not exists", constraints are checked by name, functions are replaced,
-- the trigger is replaced, and each patch of a shared function has a sentinel and an anchor that must occur exactly once.

alter table private.workspace_hub_items add column if not exists priority text;
alter table private.workspace_hub_items add column if not exists begins_on date;
do $c$ begin
 if not exists(select 1 from pg_constraint where conname='workspace_hub_items_priority' and conrelid='private.workspace_hub_items'::regclass) then
  alter table private.workspace_hub_items add constraint workspace_hub_items_priority check(priority is null or (kind='todo' and priority in ('urgent','high','normal','low')));
 end if;
 if not exists(select 1 from pg_constraint where conname='workspace_hub_items_start_on' and conrelid='private.workspace_hub_items'::regclass) then
  alter table private.workspace_hub_items add constraint workspace_hub_items_start_on check(begins_on is null or kind='todo');
 end if;
end $c$;

alter table private.workspace_hub_item_updates add column if not exists parent_id bigint references private.workspace_hub_item_updates(id) on delete cascade;
alter table private.workspace_hub_item_updates add column if not exists mentions uuid[] not null default '{}';
create index if not exists workspace_hub_item_updates_parent_idx on private.workspace_hub_item_updates(parent_id) where parent_id is not null;
create index if not exists workspace_hub_item_updates_mentions_idx on private.workspace_hub_item_updates using gin(mentions);

create table if not exists private.workspace_hub_item_reactions (
 update_id bigint not null references private.workspace_hub_item_updates(id) on delete cascade,
 user_id uuid not null references public.workspace_profiles(user_id),
 emoji text check(emoji is null or emoji in ('👍','❤️','😂','😮','😢','🙏','🎉','✅')),
 at timestamptz not null default now(),
 primary key(update_id,user_id)
);
create index if not exists workspace_hub_item_reactions_user_idx on private.workspace_hub_item_reactions(user_id);

create table if not exists private.workspace_hub_item_reads (
 item_id uuid not null references private.workspace_hub_items(id) on delete cascade,
 user_id uuid not null references public.workspace_profiles(user_id),
 read_at timestamptz not null default now(),
 primary key(item_id,user_id)
);
create index if not exists workspace_hub_item_reads_user_idx on private.workspace_hub_item_reads(user_id);

create table if not exists private.workspace_hub_item_events (
 id bigint generated always as identity primary key,
 item_id uuid not null references private.workspace_hub_items(id) on delete cascade,
 body text not null check(length(body) between 1 and 400),
 created_by uuid references public.workspace_profiles(user_id),
 created_at timestamptz not null default now()
);
create index if not exists workspace_hub_item_events_item_idx on private.workspace_hub_item_events(item_id,id desc);
create index if not exists workspace_hub_item_events_creator_idx on private.workspace_hub_item_events(created_by);

alter table private.workspace_hub_item_reactions enable row level security;
alter table private.workspace_hub_item_reads enable row level security;
alter table private.workspace_hub_item_events enable row level security;
revoke all on private.workspace_hub_item_reactions,private.workspace_hub_item_reads,private.workspace_hub_item_events from public,anon,authenticated;

-- What changed on a to-do, in words, by whoever changed it (no one, for the daily tasks the app adds itself).
create or replace function private.workspace_todo_log() returns trigger language plpgsql security definer set search_path='' as $fn$
declare lines text[]:='{}';
 dept constant jsonb:='{"guest_relations":"Guest relations","client_relations":"Client relations","cleaning":"Cleaning","ready":"Ready","accounts":"Accounts","management":"Management"}';
 prio constant jsonb:='{"urgent":"Urgent","high":"High","normal":"Normal","low":"Low"}';
begin
 if new.kind<>'todo' then return new;end if;
 if tg_op='INSERT' then
  if new.template_id is null then lines:=array['created this to-do'];end if;
 else
  if new.title is distinct from old.title then lines:=lines||('renamed it to “'||left(new.title,200)||'”');end if;
  if new.details is distinct from old.details then lines:=lines||case when btrim(new.details)='' then 'removed the description' else 'changed the description' end;end if;
  if new.assignee_id is distinct from old.assignee_id then
   lines:=lines||case when new.assignee_id is null then 'took it off '||coalesce((select p.full_name from public.workspace_profiles p where p.user_id=old.assignee_id),'the person')
    else 'gave it to '||coalesce((select p.full_name from public.workspace_profiles p where p.user_id=new.assignee_id),'someone on the team') end;
  end if;
  if new.department is distinct from old.department then
   lines:=lines||case when new.department is null then 'took it off '||coalesce(dept->>old.department,'the department') else 'moved it to '||coalesce(dept->>new.department,new.department) end;
  end if;
  if new.property_id is distinct from old.property_id then
   lines:=lines||case when new.property_id is null then 'took the property off' else 'linked it to '||coalesce((select p.name from public.workspace_properties p where p.id=new.property_id),'a property') end;
  end if;
  if new.begins_on is distinct from old.begins_on then lines:=lines||case when new.begins_on is null then 'removed the start date' else 'set the start date to '||to_char(new.begins_on,'FMDD Mon YYYY') end;end if;
  if new.due_on is distinct from old.due_on then lines:=lines||case when new.due_on is null then 'removed the due date' else 'set the due date to '||to_char(new.due_on,'FMDD Mon YYYY') end;end if;
  if new.priority is distinct from old.priority then lines:=lines||case when new.priority is null then 'cleared the priority' else 'set the priority to '||(prio->>new.priority) end;end if;
 end if;
 insert into private.workspace_hub_item_events(item_id,body,created_by)
  select new.id,x,case when auth.uid() is not null and exists(select 1 from public.workspace_profiles p where p.user_id=auth.uid()) then auth.uid() end from unnest(lines) x;
 return new;
end $fn$;
drop trigger if exists workspace_todo_log on private.workspace_hub_items;
create trigger workspace_todo_log after insert or update on private.workspace_hub_items for each row execute function private.workspace_todo_log();

-- A to-do's comments and logged updates, newest first (replies too: the app puts each under its comment), with who they
-- mention and the reactions on them.
create or replace function private.workspace_todo_updates_view(target uuid) returns jsonb language sql stable security definer set search_path='' as $fn$
 select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'text',u.body,'kind',u.kind,'byId',u.created_by,'byName',a.full_name,'at',u.created_at,'parentId',u.parent_id,
  'mentions',(select coalesce(jsonb_agg(jsonb_build_object('userId',m.user_id,'name',m.full_name,'you',m.user_id=auth.uid()) order by m.full_name),'[]'::jsonb)
    from public.workspace_profiles m where m.user_id=any(u.mentions)),
  'reactions',(select coalesce(jsonb_agg(jsonb_build_object('emoji',r.emoji,'count',r.n,'mine',r.mine,'names',r.names) order by r.first_at),'[]'::jsonb) from (
    select x.emoji,count(*) n,bool_or(x.user_id=auth.uid()) mine,min(x.at) first_at,jsonb_agg(p.full_name order by x.at) names
    from private.workspace_hub_item_reactions x join public.workspace_profiles p on p.user_id=x.user_id where x.update_id=u.id and x.emoji is not null group by x.emoji) r)
  ) order by u.id desc),'[]')
 from (select * from private.workspace_hub_item_updates x where x.item_id=target order by x.id desc limit 100) u
 left join public.workspace_profiles a on a.user_id=u.created_by
$fn$;

-- What changed on a to-do, newest first.
create or replace function private.workspace_todo_activity_view(target uuid) returns jsonb language sql stable security definer set search_path='' as $fn$
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'text',e.body,'byId',e.created_by,'byName',a.full_name,'at',e.created_at) order by e.id desc),'[]')
 from (select * from private.workspace_hub_item_events x where x.item_id=target order by x.id desc limit 50) e
 left join public.workspace_profiles a on a.user_id=e.created_by
$fn$;

-- Other people's comments since you last opened the to-do (none from before this was installed).
create or replace function private.workspace_todo_unread(target uuid) returns integer language sql stable security definer set search_path='' as $fn$
 select count(*)::integer from private.workspace_hub_item_updates u
 where u.item_id=target and u.kind='note' and u.created_by is distinct from auth.uid()
  and u.created_at>greatest(timestamptz '2026-10-19 00:00:00+01',coalesce((select r.read_at from private.workspace_hub_item_reads r where r.item_id=target and r.user_id=auth.uid()),'-infinity'::timestamptz))
$fn$;

-- Priority, start date and due date from an input, checked; only the keys present change.
create or replace function private.workspace_todo_fields(item private.workspace_hub_items,input jsonb) returns private.workspace_hub_items
language plpgsql security definer set search_path='' as $fn$
declare st date;du date;changed private.workspace_hub_items;
begin
 if item.kind<>'todo' or not (input ? 'priority' or input ? 'startOn' or input ? 'dueOn') then return item;end if;
 if input ? 'priority' and input->>'priority' is not null and input->>'priority' not in ('urgent','high','normal','low') then raise exception 'Choose a priority' using errcode='22023';end if;
 if input ? 'startOn' and input->>'startOn' is not null and (input->>'startOn')!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Choose a valid start date' using errcode='22023';end if;
 if input ? 'dueOn' and input->>'dueOn' is not null and (input->>'dueOn')!~'^\d{4}-\d{2}-\d{2}$' then raise exception 'Choose a valid date' using errcode='22023';end if;
 st:=case when input ? 'startOn' then (input->>'startOn')::date else item.begins_on end;
 du:=case when input ? 'dueOn' then (input->>'dueOn')::date else item.due_on end;
 if st is not null and du is not null and st>du then raise exception 'The start date must be on or before the due date' using errcode='22023';end if;
 update private.workspace_hub_items set priority=case when input ? 'priority' then input->>'priority' else priority end,begins_on=st,due_on=du
  where id=item.id returning * into changed;
 return changed;
end $fn$;

-- The to-do actions:
--   addTodoUpdate   { requestId, id, text, replyTo?, mentions? }  a comment, or a reply to one
--   reactTodoUpdate { requestId, updateId, emoji }                 your reaction on a comment (null takes it off)
--   setTodoFields   { requestId, id, priority?, startOn?, dueOn? } set from the to-do itself
--   readTodo        { requestId, id }                              you have seen it (no receipt: it can be sent any time)
-- Each returns the to-do's view.
create or replace function private.workspace_todo_update_action(input jsonb) returns jsonb language plpgsql security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();a text:=input->>'action';req uuid;prior private.workspace_action_receipts;result jsonb;
 item private.workspace_hub_items;txt text;event_id bigint;parent private.workspace_hub_item_updates;note private.workspace_hub_item_updates;
 root bigint;mentioned uuid[]:='{}';hearers uuid[];
begin
 if actor is null or actor='client' then raise exception 'Team access required' using errcode='42501';end if;
 if a is null or a not in ('addTodoUpdate','reactTodoUpdate','setTodoFields','readTodo') then raise exception 'Unknown to-do action' using errcode='22023';end if;
 if a='readTodo' then
  perform private.workspace_json_keys(input,array['action','requestId','id']);
  select * into item from private.workspace_hub_items i where i.id=(input->>'id')::uuid;
  if item.id is null or item.kind<>'todo' or not private.workspace_hub_can_see(item) then raise exception 'To-do not found' using errcode='P0002';end if;
  insert into private.workspace_hub_item_reads(item_id,user_id,read_at) values(item.id,auth.uid(),now())
   on conflict(item_id,user_id) do update set read_at=excluded.read_at;
  return private.workspace_hub_view(item);
 end if;
 req:=(input->>'requestId')::uuid;
 if req is null then raise exception 'Request identifier required' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||req::text,0));
 prior:=(select r from private.workspace_action_receipts r where r.actor_id=auth.uid() and r.request_id=req);
 if prior.actor_id is not null then
  if prior.actor_role<>actor then raise exception 'Workflow access changed' using errcode='42501';end if;
  if prior.input<>input then raise exception 'Request identifier reused' using errcode='23505';end if;
  return prior.result;
 end if;

 if a='reactTodoUpdate' then
  perform private.workspace_json_keys(input,array['action','requestId','updateId','emoji']);
  if jsonb_typeof(input->'updateId') is distinct from 'number' then raise exception 'Comment not found' using errcode='P0002';end if;
  select * into note from private.workspace_hub_item_updates u where u.id=(input->>'updateId')::bigint;
  select * into item from private.workspace_hub_items i where i.id=note.item_id;
  if note.id is null or note.kind<>'note' or item.id is null or not private.workspace_hub_can_see(item) then raise exception 'Comment not found' using errcode='P0002';end if;
  if input->>'emoji' is not null and input->>'emoji' not in ('👍','❤️','😂','😮','😢','🙏','🎉','✅') then raise exception 'Choose a reaction' using errcode='22023';end if;
  insert into private.workspace_hub_item_reactions(update_id,user_id,emoji,at) values(note.id,auth.uid(),input->>'emoji',now())
   on conflict(update_id,user_id) do update set emoji=excluded.emoji,at=excluded.at;

 elsif a='setTodoFields' then
  perform private.workspace_json_keys(input,array['action','requestId','id','priority','startOn','dueOn']);
  select * into item from private.workspace_hub_items i where i.id=(input->>'id')::uuid for update;
  if item.id is null or item.kind<>'todo' or not private.workspace_hub_can_see(item) then raise exception 'To-do not found' using errcode='P0002';end if;
  if not (input ? 'priority' or input ? 'startOn' or input ? 'dueOn') then raise exception 'Nothing to change' using errcode='22023';end if;
  item:=private.workspace_todo_fields(item,input);
  update private.workspace_hub_items set version=version+1,updated_at=now() where id=item.id returning * into item;
  if item.assignee_id is not null and item.assignee_id is distinct from auth.uid() then
   insert into public.workspace_activity(actor_id,property_id,event_type) values(auth.uid(),item.property_id,'hub.todo_changed') returning id into event_id;
   insert into private.workspace_notification_outbox(user_id,event_id) values(item.assignee_id,event_id) on conflict do nothing;
  end if;

 else
  perform private.workspace_json_keys(input,array['action','requestId','id','text','replyTo','mentions']);
  select * into item from private.workspace_hub_items i where i.id=(input->>'id')::uuid for update;
  if item.id is null or item.kind<>'todo' or not private.workspace_hub_can_see(item) then raise exception 'To-do not found' using errcode='P0002';end if;
  txt:=private.workspace_required_text(input,'text',1,2000);
  if input ? 'replyTo' and jsonb_typeof(input->'replyTo')<>'null' then
   if jsonb_typeof(input->'replyTo')<>'number' then raise exception 'Reply to a comment on this to-do' using errcode='22023';end if;
   select * into parent from private.workspace_hub_item_updates u where u.id=(input->>'replyTo')::bigint;
   if parent.id is null or parent.item_id<>item.id or parent.kind<>'note' then raise exception 'Reply to a comment on this to-do' using errcode='22023';end if;
   root:=coalesce(parent.parent_id,parent.id);
  end if;
  if input ? 'mentions' and jsonb_typeof(input->'mentions')<>'null' then
   if jsonb_typeof(input->'mentions')<>'array' or jsonb_array_length(input->'mentions')>20
    or exists(select 1 from jsonb_array_elements(input->'mentions') x where jsonb_typeof(x)<>'string' or x#>>'{}'!~'^[0-9a-fA-F-]{36}$') then
    raise exception 'Mention up to 20 people on the team' using errcode='22023';end if;
   mentioned:=array(select distinct (x#>>'{}')::uuid from jsonb_array_elements(input->'mentions') x);
   if exists(select 1 from unnest(mentioned) m where not exists(select 1 from public.workspace_profiles p where p.user_id=m and p.status='active' and p.role<>'client')) then
    raise exception 'You can mention people on the team only' using errcode='22023';end if;
  end if;
  -- Who hears about it, worked out before the comment is added: the assignee, whoever set it, and everyone who wrote on it.
  hearers:=array(select item.assignee_id union select item.created_by union select u.created_by from private.workspace_hub_item_updates u where u.item_id=item.id and u.kind='note');
  insert into private.workspace_hub_item_updates(item_id,body,kind,created_by,parent_id,mentions) values(item.id,txt,'note',auth.uid(),root,mentioned);
  update private.workspace_hub_items set updated_at=now() where id=item.id returning * into item;
  insert into private.workspace_hub_item_reads(item_id,user_id,read_at) values(item.id,auth.uid(),now())
   on conflict(item_id,user_id) do update set read_at=excluded.read_at;
  insert into public.workspace_activity(actor_id,property_id,event_type) values(auth.uid(),item.property_id,'hub.todo_updated') returning id into event_id;
  insert into private.workspace_notification_outbox(user_id,event_id) select distinct u,event_id from unnest(hearers) u
   where u is not null and u is distinct from auth.uid() and not u=any(mentioned) on conflict do nothing;
  if cardinality(mentioned)>0 then
   insert into public.workspace_activity(actor_id,property_id,event_type) values(auth.uid(),item.property_id,'hub.todo_mentioned') returning id into event_id;
   insert into private.workspace_notification_outbox(user_id,event_id) select distinct u,event_id from unnest(mentioned) u where u is distinct from auth.uid() on conflict do nothing;
  end if;
 end if;

 result:=private.workspace_hub_view(item);
 insert into private.workspace_action_receipts(actor_id,request_id,input,result) values(auth.uid(),req,input,result);
 return result;
end $fn$;

revoke all on function private.workspace_todo_log(),private.workspace_todo_updates_view(uuid),private.workspace_todo_activity_view(uuid),private.workspace_todo_unread(uuid),
 private.workspace_todo_fields(private.workspace_hub_items,jsonb),private.workspace_todo_update_action(jsonb) from public,anon,authenticated,service_role;

do $patch$
declare
 -- function, anchor (must occur exactly once), replacement, sentinel (present once patched)
 fixes constant text[][] := array[
  -- The to-do's new fields, its activity and your unread count.
  ['private.workspace_hub_view(private.workspace_hub_items)',
   $q$'updates',case when item.kind='todo' then private.workspace_todo_updates_view(item.id) else '[]'::jsonb end,$q$,
   $q$'updates',case when item.kind='todo' then private.workspace_todo_updates_view(item.id) else '[]'::jsonb end,
  'priority',item.priority,'startOn',item.begins_on,'activity',case when item.kind='todo' then private.workspace_todo_activity_view(item.id) else '[]'::jsonb end,
  'unread',case when item.kind='todo' then private.workspace_todo_unread(item.id) else 0 end,$q$,
   $q$private.workspace_todo_activity_view(item.id)$q$],
  -- Someone mentioned on a to-do can see it.
  ['private.workspace_hub_can_see(private.workspace_hub_items)',
   $q$when 'todo' then item.assignee_id=auth.uid() or item.created_by=auth.uid()$q$,
   $q$when 'todo' then item.assignee_id=auth.uid() or item.created_by=auth.uid()
   or exists(select 1 from private.workspace_hub_item_updates m where m.item_id=item.id and m.mentions @> array[auth.uid()])/* todo mentions: 20261025100000 */$q$,
   $q$/* todo mentions: 20261025100000 */$q$],
  -- A new or edited to-do takes a priority and a start date.
  ['private.workspace_hub_action(jsonb)',
   $q$'dueOn','amountMinor','link','reference','reservationId','clientId']);$q$,
   $q$'dueOn','amountMinor','link','reference','reservationId','clientId']||array['priority','startOn']/* todo fields keys: 20261025100000 */);$q$,
   $q$/* todo fields keys: 20261025100000 */$q$],
  ['private.workspace_hub_action(jsonb)',
   $q$event:='hub.'||k||'_added';$q$,
   $q$if k='todo' then item:=private.workspace_todo_fields(item,input);end if;/* todo fields added: 20261025100000 */
   event:='hub.'||k||'_added';$q$,
   $q$/* todo fields added: 20261025100000 */$q$],
  ['private.workspace_hub_action(jsonb)',
   $q$event:='hub.'||k||'_changed';$q$,
   $q$if k='todo' then item:=private.workspace_todo_fields(item,input);end if;/* todo fields changed: 20261025100000 */
   event:='hub.'||k||'_changed';$q$,
   $q$/* todo fields changed: 20261025100000 */$q$],
  -- The new to-do actions go where the comments go.
  ['private.workspace_teams_action(jsonb)',
   $q$if a='addTodoUpdate' then return private.workspace_todo_update_action(input);end if;$q$,
   $q$if a in ('addTodoUpdate','reactTodoUpdate','setTodoFields','readTodo')/* todo actions: 20261025100000 */ then return private.workspace_todo_update_action(input);end if;$q$,
   $q$/* todo actions: 20261025100000 */$q$]
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
