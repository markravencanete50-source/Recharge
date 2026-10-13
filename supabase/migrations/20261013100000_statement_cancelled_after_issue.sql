-- A stay cancelled after its first statement was issued pays no further share (client feedback audit, 13 October 2026).
--
-- Owner statements keep a copy of a stay's money from the first issued statement and take every later period's share
-- from that copy, so the shares add up to the copy. That is right when a stay is moved or paid a different amount,
-- but not when it is cancelled: the guest stayed away, so a later period must not pay the owner a share of money for
-- nights that did not happen. A stay that is no longer confirmed (or has moved to another property) now takes no share
-- in a later period. It is still flagged stay_changed_after_statement, and its money still appears under
-- lateMoneyAfterStatement so a person decides what to do about what the first statement already paid out.
-- The same one-word rule is in lib/statement-maths.ts (the TypeScript twin), kept in step by the equivalence test.
--
-- The patch reads the LATEST definition, needs its anchor exactly once, and is skipped once its sentinel is present,
-- so the migration is safe to run twice.

do $patch$
declare
 definition text;found_count integer;
 anchor constant text:=$q$if b_here and in_money then$q$;
 replacement constant text:=$q$if b_here and in_money and live then$q$;
begin
 definition:=pg_get_functiondef('private.workspace_statement_compute(uuid,date,date,text,uuid)'::regprocedure);
 if position(replacement in definition)=0 then
  found_count:=(length(definition)-length(replace(definition,anchor,'')))/length(anchor);
  if found_count<>1 then raise exception 'Patch anchor found % times in private.workspace_statement_compute, expected once',found_count;end if;
  execute replace(definition,anchor,replacement);
  if position(replacement in pg_get_functiondef('private.workspace_statement_compute(uuid,date,date,text,uuid)'::regprocedure))=0 then raise exception 'Patch did not take in private.workspace_statement_compute';end if;
 end if;
end $patch$;
