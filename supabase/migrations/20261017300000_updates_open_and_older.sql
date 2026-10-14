-- Updates feed, round 7 (follow-up to round 6, 20261016300000).
-- 1. Open any update. Tapping an update whose work item is not in the loaded work list did nothing. A single-item read,
--    private.workspace_operation_read(target), returns that one item with exactly the rules of the work list
--    (private.workspace_operations_read): a work item with its details, that private.workspace_operation_access lets the
--    person see, shaped by private.workspace_operation_view (owners get the owner view, never staff fields). Anything
--    else, whether it does not exist or the person may not see it, is the same "Work item not found", so nothing leaks.
-- 2. Older updates. The feed read returns the newest 50. private.workspace_notifications_read(before_id) returns the 50
--    before a given update (by time, then id, as the feed is ordered), so the app can page back 50 at a time. The cursor
--    must be one of the person's own updates. The query is the round 6 one, unchanged: the same rows, fields, owner rule
--    and checks. The notifications branch of private.workspace_controls_read is replaced whole by a call to it (with no
--    cursor), so there is one copy of the query.
-- Safe to run twice: functions are replaced whole, and the branch is replaced only while it still holds the old query.
-- Note for later migrations: the notifications query now lives in private.workspace_notifications_read, not in
-- private.workspace_controls_read; anchor patches for the feed belong there.

create or replace function private.workspace_operation_read(target uuid) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
begin
 if private.workspace_actor_role() is null then raise exception 'Active access required' using errcode='42501';end if;
 if target is null or not exists(select 1 from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where w.id=target)
  or not private.workspace_operation_access(target) then
  raise exception 'Work item not found' using errcode='P0002';
 end if;
 return private.workspace_operation_view(target);
end $fn$;

create or replace function public.workspace_operation_read(target uuid) returns jsonb language sql set search_path='' as $fn$
 select private.workspace_operation_read(target);
$fn$;

create or replace function private.workspace_notifications_read(before_id bigint) returns jsonb language plpgsql stable security definer set search_path='' as $fn$
declare actor text:=private.workspace_actor_role();cursor_at timestamptz;result jsonb;
begin
 if actor is null then raise exception 'Active access required' using errcode='42501';end if;
 if before_id is not null then
  cursor_at:=(select a.created_at from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.user_id=auth.uid() and a.id=before_id);
  if cursor_at is null then raise exception 'Choose one of your updates' using errcode='22023';end if;
 end if;
 select coalesce(jsonb_agg(n),'[]') into result from(select a.id,a.event_type,a.property_id,a.work_id,a.created_at,o.read_at,
  w.title as work_title,dd.kind as work_kind,w.module_id as work_module,pr.name as property_name,pr.address as property_address,
  (a.actor_id is null and actor<>'client') as automatic,
  case when a.actor_id=auth.uid() then 'You' when actor='client' then 'Recharge' when a.actor_id is null then null else ap.full_name end as actor_name,
  'available_in_app' as status from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id
  left join public.workspace_work_items w on w.id=a.work_id left join private.workspace_domain_details dd on dd.work_id=a.work_id
  left join public.workspace_properties pr on pr.id=coalesce(a.property_id,w.property_id) left join public.workspace_profiles ap on ap.user_id=a.actor_id
  where o.user_id=auth.uid() and (a.work_id is null or private.workspace_can_work(a.work_id)) and
   (a.property_id is null or actor in ('admin','super_admin') or exists(select 1 from public.workspace_property_assignments where property_id=a.property_id and user_id=auth.uid()))
   and (before_id is null or (a.created_at,a.id)<(cursor_at,before_id))
  order by a.created_at desc,a.id desc limit 50) n;
 return result;
end $fn$;

create or replace function public.workspace_notifications_read(before_id bigint) returns jsonb language sql set search_path='' as $fn$
 select private.workspace_notifications_read(before_id);
$fn$;

-- As the work list and the feed read: signed-in people only (each function checks who is asking itself).
revoke all on function private.workspace_operation_read(uuid),private.workspace_notifications_read(bigint),
 public.workspace_operation_read(uuid),public.workspace_notifications_read(bigint) from public,anon,authenticated;
grant execute on function private.workspace_operation_read(uuid),private.workspace_notifications_read(bigint),
 public.workspace_operation_read(uuid),public.workspace_notifications_read(bigint) to authenticated;

-- The notifications branch, from "if section='notifications' then" to its "end if;", becomes a call to the function above.
-- Only while it still holds the old query (the outbox join and the limit of 50); after that the sentinel stops a second run.
do $patch$
declare definition text;branch text;
begin
 definition:=pg_get_functiondef('private.workspace_controls_read(text,uuid,uuid)'::regprocedure);
 if position('return private.workspace_notifications_read(null);' in definition)>0 then return;end if;
 branch:=substring(definition from '(if section=''notifications'' then.*?\n *end if;)');
 if branch is null or (length(definition)-length(replace(definition,'if section=''notifications'' then','')))/length('if section=''notifications'' then')<>1 then
  raise exception 'The notifications branch of workspace_controls_read was not found once';
 end if;
 if position('from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id' in branch)=0 or position('limit 50) n;' in branch)=0
  or position('w.title as work_title,dd.kind as work_kind' in branch)=0 then
  raise exception 'The notifications branch of workspace_controls_read is not the expected query; check before replacing it';
 end if;
 execute replace(definition,branch,'if section=''notifications'' then'||chr(10)||'  return private.workspace_notifications_read(null);'||chr(10)||' end if;');
 if position('return private.workspace_notifications_read(null);' in pg_get_functiondef('private.workspace_controls_read(text,uuid,uuid)'::regprocedure))=0 then
  raise exception 'Patch did not take in workspace_controls_read';
 end if;
end $patch$;
