-- Mid-stay cleans get one on/off switch (client answer 5, 13 October 2026: "Forget this for now").
--
-- private.workspace_mid_stay_cleans_enabled() is the switch. It is ON here, so nothing changes until a later
-- one-line migration replaces it with `select false`. While it is OFF:
--   * no new mid-stay clean is made, by the 15-minute run or at the end of a Hostaway sync;
--   * an automatic mid-stay clean nobody has started (waiting or in progress, nothing submitted) is cancelled with
--     the reason "Mid-stay cleans are switched off", exactly as the run already cancels one whose stay changed;
--   * a started, submitted or completed one is left alone, and a clean someone made by hand is never touched.
-- Turning it back ON makes mid-stay cleans again for long stays whose middle day is still ahead.
--
-- private.workspace_mid_stay_wanted is replaced as a whole (it is only defined in 20261012130000). The reason in
-- private.workspace_mid_stay_cleans is a patch: it reads the LATEST definition, needs its anchor exactly once and is
-- skipped once its sentinel is present, so the migration is safe to run twice.

create or replace function private.workspace_mid_stay_cleans_enabled() returns boolean language sql immutable set search_path='' as $$ select true $$;

-- Whether a stay needs a mid-stay clean, dates aside: never while mid-stay cleans are switched off.
create or replace function private.workspace_mid_stay_wanted(r private.workspace_reservations) returns boolean language sql stable set search_path='' as $$
 select private.workspace_mid_stay_cleans_enabled() and r.status='confirmed' and r.check_out-r.check_in>private.workspace_mid_stay_nights()
  and (private.workspace_mid_stay_cleans_owner_stays() or not private.workspace_is_owner_stay(r));
$$;

do $patch$
declare
 definition text;found_count integer;
 anchor constant text:=$q$case when s.id is null or s.status<>'confirmed' then 'The stay was cancelled'$q$;
 replacement constant text:=$q$case when not private.workspace_mid_stay_cleans_enabled() then 'Mid-stay cleans are switched off' when s.id is null or s.status<>'confirmed' then 'The stay was cancelled'$q$;
 sentinel constant text:=$q$then 'Mid-stay cleans are switched off'$q$;
begin
 definition:=pg_get_functiondef('private.workspace_mid_stay_cleans(timestamptz)'::regprocedure);
 if position(sentinel in definition)=0 then
  found_count:=(length(definition)-length(replace(definition,anchor,'')))/length(anchor);
  if found_count<>1 then raise exception 'Patch anchor found % times in private.workspace_mid_stay_cleans(timestamptz), expected once',found_count;end if;
  execute replace(definition,anchor,replacement);
  if position(sentinel in pg_get_functiondef('private.workspace_mid_stay_cleans(timestamptz)'::regprocedure))=0 then raise exception 'Patch did not take in private.workspace_mid_stay_cleans(timestamptz)';end if;
 end if;
end $patch$;

revoke all on function private.workspace_mid_stay_cleans_enabled(),private.workspace_mid_stay_wanted(private.workspace_reservations) from public,anon,authenticated;
