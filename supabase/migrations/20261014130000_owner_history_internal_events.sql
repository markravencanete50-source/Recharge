-- Owner privacy, the remaining place: a work item's history (private.workspace_work_history) reads the activity table
-- with the function's own rights, so 20261013090000's activity_scoped policy did not reach it. An owner reading the
-- timeline of their own work still received internal events by name: a management flag, an AirCover flag, a
-- reflection, a routine visit form, a direct-booking follow-up and the clean form reminder and warning.
--
-- For the client role the history now leaves those entries out. Everything else is unchanged:
--   * a repair resolved without a visit stays on the owner's timeline (Lee's decision: owners read how a repair was
--     resolved; who resolved it is already stripped by 20261013090000);
--   * staff and admins see every entry as before.
-- The internal event names are the same list the activity_scoped policy hides from owners, less the repair one.
--
-- The patch reads the LATEST definition, needs its anchor exactly once and is skipped once its sentinel is present,
-- so the migration is safe to run twice.

do $patch$
declare
 definition text;found_count integer;
 anchor constant text:=$q$where a.work_id=target and a.event_type not in ('workspace_work_items.update','operations.updateOperation.reviewCleaning')$q$;
 replacement constant text:=$q$where a.work_id=target and a.event_type not in ('workspace_work_items.update','operations.updateOperation.reviewCleaning') and (actor<>'client' or a.event_type !~ '^(management\.|aircover\.|reflection\.|routine\.|stays\.|cleaning\.form_(missing|reminder)$)')$q$;
 sentinel constant text:=$q$and (actor<>'client' or a.event_type !~ '^(management\.|aircover\.$q$;
begin
 definition:=pg_get_functiondef('private.workspace_work_history(uuid)'::regprocedure);
 if position(sentinel in definition)=0 then
  found_count:=(length(definition)-length(replace(definition,anchor,'')))/length(anchor);
  if found_count<>1 then raise exception 'Patch anchor found % times in private.workspace_work_history(uuid), expected once',found_count;end if;
  execute replace(definition,anchor,replacement);
  if position(sentinel in pg_get_functiondef('private.workspace_work_history(uuid)'::regprocedure))=0 then raise exception 'Patch did not take in private.workspace_work_history(uuid)';end if;
 end if;
end $patch$;
