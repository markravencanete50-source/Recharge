-- The management fee can be charged on the payout after platform fees AND changeovers (client answer 1, 13 October
-- 2026: "Management fee is charged after Airbnb fees and the cleaning fees"). Prepared, not switched on: until the
-- client confirms that "the cleaning fees" are the changeover charges on the statement, the switch stays as it is.
--
-- private.workspace_statement_fee_base() (20261012100000) is the switch. Its values:
--   'payout_after_ota_fees'                  gross less OTA fees (today's value, unchanged here)
--   'gross'                                  gross
--   'payout_after_ota_fees_and_changeovers'  gross less OTA fees less the period's changeover charges (new)
-- Switching is a later one-line migration replacing the switch's value. The fee base is plain subtraction, like the
-- other two values, so a period with changeovers and little revenue can have a negative fee; decide on a floor before
-- switching. The same rule is in lib/statement-maths.ts (feeBaseMinor), kept in step by the 200-scenario test.
--
-- The patch reads the LATEST definition of private.workspace_statement_compute, needs its anchor exactly once and is
-- skipped once its sentinel is present, so the migration is safe to run twice.

do $patch$
declare
 definition text;found_count integer;
 anchor constant text:=$q$base:=case private.workspace_statement_fee_base() when 'gross' then gross_total else gross_total-ota_total end;$q$;
 replacement constant text:=$q$base:=case private.workspace_statement_fee_base() when 'gross' then gross_total when 'payout_after_ota_fees_and_changeovers' then gross_total-ota_total-clean_total else gross_total-ota_total end;$q$;
 sentinel constant text:=$q$when 'payout_after_ota_fees_and_changeovers' then gross_total-ota_total-clean_total$q$;
begin
 definition:=pg_get_functiondef('private.workspace_statement_compute(uuid,date,date,text,uuid)'::regprocedure);
 if position(sentinel in definition)=0 then
  found_count:=(length(definition)-length(replace(definition,anchor,'')))/length(anchor);
  if found_count<>1 then raise exception 'Patch anchor found % times in private.workspace_statement_compute, expected once',found_count;end if;
  execute replace(definition,anchor,replacement);
  if position(sentinel in pg_get_functiondef('private.workspace_statement_compute(uuid,date,date,text,uuid)'::regprocedure))=0 then raise exception 'Patch did not take in private.workspace_statement_compute';end if;
 end if;
end $patch$;
