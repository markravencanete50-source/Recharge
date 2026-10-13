-- Owner privacy: no staff identities in a work item's data (lead developer's task 3, 13 October 2026).
--
-- An owner reading their own work (private.workspace_operation_view, through workspace_operations_read) received the
-- item's data with internal fields that name the staff member who did each step: reportedBy, referredBy,
-- submittedBy, reviewedBy, quoteRevisedBy, decidedBy, verifiedBy and so on, each holding a staff user id. Earlier
-- rounds removed resolvedBy, the troubleshooting notes and the guest evidence; this removes every field whose name
-- ends in "By" for the client role, so no staff identity reaches an owner, whatever field a later step adds.
-- What the owner is meant to read (the issue, the guest update, the quote, the resolution note, dates) is unchanged.
-- Staff and admins are unchanged.
--
-- private.workspace_owner_work_data(data) is the one owner filter. The patch on private.workspace_operation_view reads
-- the LATEST definition, needs its anchors exactly once and is skipped once applied, so the migration is safe to run
-- twice.

create or replace function private.workspace_owner_work_data(item jsonb) returns jsonb language sql immutable set search_path='' as $$
 select case when jsonb_typeof(item)='object' then
  coalesce((select jsonb_object_agg(e.k,e.v) from jsonb_each(item-'guestEvidence'-'reservationId'-'troubleshooting'-'warrantyContactEvidence'-'resolvedBy') e(k,v) where e.k !~ 'By$'),'{}'::jsonb)
  else item end;
$$;

-- The owner's branch is wrapped whole, so the earlier owner list inside it (and 20261012220000's patch of it, whichever
-- runs first) is left as it is.
do $patch$
declare
 definition text;n1 integer;n2 integer;
 head constant text:=$q$'data',case when private.workspace_actor_role()='client' then $q$;
 tail constant text:=$q$ else d.data end)$q$;
 sentinel constant text:=$q$then private.workspace_owner_work_data($q$;
begin
 definition:=pg_get_functiondef('private.workspace_operation_view(uuid)'::regprocedure);
 if position(sentinel in definition)=0 then
  n1:=(length(definition)-length(replace(definition,head,'')))/length(head);
  n2:=(length(definition)-length(replace(definition,tail,'')))/length(tail);
  if n1<>1 or n2<>1 then raise exception 'Patch anchors found % and % times in private.workspace_operation_view(uuid), expected once each',n1,n2;end if;
  execute replace(replace(definition,head,head||'private.workspace_owner_work_data('),tail,')'||tail);
  if position(sentinel in pg_get_functiondef('private.workspace_operation_view(uuid)'::regprocedure))=0 then raise exception 'Patch did not take in private.workspace_operation_view(uuid)';end if;
 end if;
end $patch$;

revoke all on function private.workspace_owner_work_data(jsonb) from public,anon,authenticated;
