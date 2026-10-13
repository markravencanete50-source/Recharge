-- The management fee is charged on the payout after platform fees AND the period's changeover charges (client answer
-- 1, 13 October 2026: "Management fee is charged after Airbnb fees and the cleaning fees"; Lee's decision: this is
-- the one base, no switch and no second option).
--
-- * private.workspace_statement_compute: base = gross less OTA fees less the statement's changeover charges. VAT stays
--   20% of the rounded fee. The base is plain subtraction, so a period with changeovers and little revenue can have a
--   negative fee, as gross less OTA fees could before.
-- * private.workspace_statement_fee_base() is no longer a switch: it only names the base, and statements carry that
--   name in terms.feeBase ('payout_after_ota_fees_and_changeovers') so the screen can say what the fee was charged on.
-- * Issued and paid statements are never recomputed (the stored-copy rule), so this only affects statements prepared
--   or issued from now on. An issued statement keeps the feeBase it was issued with.
-- The same rule is in lib/statement-maths.ts (feeBaseMinor), kept in step by the 200-scenario test.
--
-- The patch reads the LATEST definition of private.workspace_statement_compute, needs its anchor exactly once and is
-- skipped once its sentinel is present, so the migration is safe to run twice.

create or replace function private.workspace_statement_fee_base() returns text language sql immutable set search_path='' as $$ select 'payout_after_ota_fees_and_changeovers'::text $$;

do $patch$
declare
 definition text;found_count integer;
 anchor constant text:=$q$base:=case private.workspace_statement_fee_base() when 'gross' then gross_total else gross_total-ota_total end;$q$;
 replacement constant text:=$q$base:=gross_total-ota_total-clean_total;$q$;
begin
 definition:=pg_get_functiondef('private.workspace_statement_compute(uuid,date,date,text,uuid)'::regprocedure);
 if position(replacement in definition)=0 then
  found_count:=(length(definition)-length(replace(definition,anchor,'')))/length(anchor);
  if found_count<>1 then raise exception 'Patch anchor found % times in private.workspace_statement_compute, expected once',found_count;end if;
  execute replace(definition,anchor,replacement);
  if position(replacement in pg_get_functiondef('private.workspace_statement_compute(uuid,date,date,text,uuid)'::regprocedure))=0 then raise exception 'Patch did not take in private.workspace_statement_compute';end if;
 end if;
end $patch$;
