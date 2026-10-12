-- Last update on every piece of work: who made the latest change and what it was, so a row can
-- read "Updated 12 Oct, 14:05 · Morag Reid". All three come from the item's newest activity row.
-- updatedBy is the person's name, or null when the change was automatic (no signed-in actor,
-- for example the Hostaway sync). Owners (client role) never see staff names or the staff step
-- that was taken, so updatedBy and updatedEvent are null for them.
-- lastActivityAt is when that activity row was written. Some steps (an invoice recorded against a
-- purchase) log activity without touching the item's updated_at, so the time shown with the person
-- is the later of updatedAt and lastActivityAt. It names nobody, so every role gets it.
-- One step writes a workspace_* trigger row and a named event (operations.updateOperation.approvePurchase)
-- at the same instant; the named event is preferred. Safe to run twice; grants survive create or replace.

create index if not exists workspace_activity_work_latest_idx on public.workspace_activity(work_id,created_at desc,id desc) where work_id is not null;

-- Each piece of work with its times, when it was raised and last changed, and who changed it last.
CREATE OR REPLACE FUNCTION private.workspace_operation_view(target uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 select jsonb_build_object('workId',w.id,'propertyId',w.property_id,'moduleId',w.module_id,'title',w.title,'status',w.status,'version',w.version,'assigneeId',w.assignee_id,'dueOn',w.due_on,'dueTime',to_char(w.due_time,'HH24:MI'),'endTime',to_char(w.due_end_time,'HH24:MI'),'kind',d.kind,'createdAt',w.created_at,'updatedAt',w.updated_at,
 'updatedBy',case when private.workspace_actor_role()='client' then null else nullif(trim(p.full_name),'') end,
 'updatedEvent',case when private.workspace_actor_role()='client' then null else a.event_type end,'lastActivityAt',a.created_at,
 'data',case when private.workspace_actor_role()='client' then d.data-'guestEvidence'-'reservationId'-'troubleshooting'-'warrantyContactEvidence' else d.data end)
 from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id
 left join lateral (select x.actor_id,x.event_type,x.created_at from public.workspace_activity x where x.work_id=w.id
  order by x.created_at desc,(x.event_type like 'workspace\_%'),x.id desc limit 1) a on true
 left join public.workspace_profiles p on p.user_id=a.actor_id
 where w.id=target;
$function$;
