-- Owner privacy, round 3 (client feedback audit, 13 October 2026).
--
-- A. workspace_work_history returned the full name of everyone who touched a piece of work, to owners as well
--    as staff. Owners still see the whole timeline (what happened, when, the notes they were meant to read,
--    including a repair's resolution note), but each entry no longer carries a "by" name. Staff are unchanged.
--    The patch changes one place: the final aggregate drops the key for the client role.
-- B. Owners could read the internal names of every event on their work through the activity table
--    (management.flag_raised, aircover.flagged, reflection.*, routine.*, stays.*, a missing clean form, a repair
--    resolved without a visit). The activity_scoped policy now hides those event types from the client role.
--    Staff and admins are unchanged, and owners keep the events the owner pages use. History (A) reads the
--    table with the function's own rights, so an owner's timeline is not affected.
--
-- The patch reads the LATEST definition, needs its anchor exactly once, and is skipped once its sentinel
-- is present, so the migration is safe to run twice. The policy is dropped and created again.

do $patch$
declare
 definition text;found_count integer;
 anchor constant text:=$q$jsonb_agg(h.e order by h.happened,h.n)$q$;
 replacement constant text:=$q$jsonb_agg(case when actor='client' then h.e-'by' else h.e end order by h.happened,h.n)$q$;
 sentinel constant text:=$q$case when actor='client' then h.e-'by' else h.e end$q$;
begin
 definition:=pg_get_functiondef('private.workspace_work_history(uuid)'::regprocedure);
 if position(sentinel in definition)=0 then
  found_count:=(length(definition)-length(replace(definition,anchor,'')))/length(anchor);
  if found_count<>1 then raise exception 'Patch anchor found % times in private.workspace_work_history(uuid), expected once',found_count;end if;
  execute replace(definition,anchor,replacement);
  if position(sentinel in pg_get_functiondef('private.workspace_work_history(uuid)'::regprocedure))=0 then raise exception 'Patch did not take in private.workspace_work_history(uuid)';end if;
 end if;
end $patch$;

drop policy if exists activity_scoped on public.workspace_activity;
create policy activity_scoped on public.workspace_activity for select to authenticated using (
  (select private.workspace_actor_role()) in ('admin','super_admin') or (
    (select private.workspace_actor_role()) is not null and (
      actor_id=(select auth.uid()) or (work_id is not null and private.workspace_can_work(work_id) and (
        (select private.workspace_actor_role())<>'client'
        or event_type !~ $re$^(management\.|aircover\.|reflection\.|routine\.|stays\.|cleaning\.form_missing$|operations\.updateOperation\.resolveRepair$)$re$
      ))
    )
  )
);
