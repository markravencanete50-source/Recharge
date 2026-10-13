-- Mid-stay cleans get one on/off switch, OFF (client answer 5, 13 October 2026: "Forget this for now"; Lee's decision).
--
-- private.workspace_mid_stay_cleans_enabled() is the switch, mirrored by MID_STAY_CLEANS_ENABLED in
-- lib/feedback-defaults.ts. While it is OFF, private.workspace_mid_stay_cleans does nothing at all: it creates no new
-- mid-stay clean, by the 15-minute run in worker/index.ts or at the end of a Hostaway sync, and it leaves every
-- mid-stay clean that already exists exactly as it is (none is cancelled, moved or changed). Its answer keeps the same
-- keys, all zero, plus switchedOff true. Turning it back ON is a one-line migration (`select true`): the run then
-- behaves as before, including cancelling an unstarted automatic clean whose stay no longer needs it.
--
-- The worker keeps calling the run: the switch lives in the database so the cron and the Hostaway sync obey it alike.
--
-- The patch reads the LATEST definition of private.workspace_mid_stay_cleans, needs its anchor exactly once and is
-- skipped once its sentinel is present, so the migration is safe to run twice.

create or replace function private.workspace_mid_stay_cleans_enabled() returns boolean language sql immutable set search_path='' as $$ select false $$;

do $patch$
declare
 definition text;found_count integer;
 anchor constant text:=$q$perform pg_advisory_xact_lock(hashtextextended('workspace_mid_stay_cleans',0));$q$;
 replacement constant text:=$q$perform pg_advisory_xact_lock(hashtextextended('workspace_mid_stay_cleans',0)); if not private.workspace_mid_stay_cleans_enabled() then return jsonb_build_object('created',0,'cancelled',0,'leftAlone',0,'remaining',0,'switchedOff',true);end if;$q$;
 sentinel constant text:=$q$if not private.workspace_mid_stay_cleans_enabled() then return$q$;
begin
 definition:=pg_get_functiondef('private.workspace_mid_stay_cleans(timestamptz)'::regprocedure);
 if position(sentinel in definition)=0 then
  found_count:=(length(definition)-length(replace(definition,anchor,'')))/length(anchor);
  if found_count<>1 then raise exception 'Patch anchor found % times in private.workspace_mid_stay_cleans(timestamptz), expected once',found_count;end if;
  execute replace(definition,anchor,replacement);
  if position(sentinel in pg_get_functiondef('private.workspace_mid_stay_cleans(timestamptz)'::regprocedure))=0 then raise exception 'Patch did not take in private.workspace_mid_stay_cleans(timestamptz)';end if;
 end if;
end $patch$;

revoke all on function private.workspace_mid_stay_cleans_enabled() from public,anon,authenticated;
