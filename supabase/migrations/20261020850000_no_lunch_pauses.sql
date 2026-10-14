-- Lunch comes off the clock (Alex, client meeting): team members can no longer start a Lunch pause. Lunch is unpaid
-- anyway; Break and Emergency stay exactly as they are. Shifts from before keep their lunch pauses: the table still
-- allows them, they are still read and totalled by the stored pay rule, and the app shows them as "Lunch" in the history.
-- Starting a lunch pause is refused with a plain message. Someone already on a lunch pause when this is installed can
-- still go back to work or clock out as before.
-- Patched by anchor (sentinel, an anchor that must occur once): private.workspace_pause_action (defined in
-- 20261011010000; nothing later patches it).
-- Safe to run twice.

do $patch$
declare
 fixes text[][]:=array[
  -- Starting a pause: a break or an emergency only.
  ['private.workspace_pause_action(jsonb)',
   $q$if coalesce(input->>'kind','') not in ('lunch','break','emergency') then raise exception 'Choose lunch, a break or an emergency' using errcode='22023';end if;$q$,
   $q$if input->>'kind'='lunch' then raise exception 'Lunch is no longer recorded as a pause. Clock out for lunch, or choose a break.' using errcode='22023';end if;
  if coalesce(input->>'kind','') not in ('break','emergency') then raise exception 'Choose a break or an emergency' using errcode='22023';end if;$q$,
   $q$'Lunch is no longer recorded as a pause.$q$]
 ];
 definition text;hits integer;
begin
 for i in 1..array_length(fixes,1) loop
  definition:=pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in definition)=0 then
   hits:=(length(definition)-length(replace(definition,fixes[i][2],'')))/length(fixes[i][2]);
   if hits<>1 then raise exception 'Patch anchor found % times in % (patch %)',hits,fixes[i][1],i;end if;
   execute replace(definition,fixes[i][2],fixes[i][3]);
   if position(fixes[i][4] in pg_get_functiondef(fixes[i][1]::regprocedure))=0 then raise exception 'Patch did not take in % (patch %)',fixes[i][1],i;end if;
  end if;
 end loop;
end $patch$;

revoke all on function private.workspace_pause_action(jsonb) from public,anon,authenticated;
