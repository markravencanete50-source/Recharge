-- Estimate comparables limit (up to 20): the 1 migrations not yet installed, in filename order, in ONE transaction.
-- Paste the whole file into the Supabase SQL editor for project brixfalrrmzqoioggvfx and run it once.
-- If any statement fails, nothing is applied. Each migration is recorded in supabase_migrations.schema_migrations
-- under its filename version. Generated from supabase/migrations; do not edit by hand.
-- Running it a second time stops at the first line below and changes nothing.

begin;
set local lock_timeout='20s';
do $guard$ begin if exists(select 1 from supabase_migrations.schema_migrations where version like '20261020400000%') then raise exception 'Estimate comparables limit (up to 20) is already installed (or partly): stop and check'; end if; end $guard$;

-- ===== 20261020400000_estimate_comparables_limit =====
-- As many comparables on an estimate as the team wants (Lee, 14 October: "we should have an option to add as many
-- comparable we want"). The estimate form opens the next comparable as soon as the one before has a name, up to a
-- generous ceiling of 20, the same number the app checks (MAX_COMPARABLES in lib/journey-policy.ts).
-- Anchor patch (one anchor, with a sentinel): private.workspace_journey_action(jsonb) allowed at most 3.
-- Safe to run twice.

do $$
declare
 fixes text[][] := array[
  ['private.workspace_journey_action(jsonb)',
   $q$jsonb_array_length(input->'comparables')>3 then raise exception 'Invalid estimate'$q$,
   $q$jsonb_array_length(input->'comparables')>20 then raise exception 'Invalid estimate'$q$,
   $q$jsonb_array_length(input->'comparables')>20$q$]
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

insert into supabase_migrations.schema_migrations(version,name) values ('20261020400000','estimate_comparables_limit');

commit;
