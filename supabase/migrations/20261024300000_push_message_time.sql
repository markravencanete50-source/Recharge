-- Pop-ups like a phone messenger (WhatsApp style): a pop-up shows the time the message was written, not the time the
-- minute run happened to send it, so a conversation's pop-up keeps its messages in order and reads "2 min ago" correctly.
--  * private.integration_claim_web_push() hands each pop-up the time of its notice ('createdAt'). Nothing else changes:
--    who is sent what, how often and for how long is as before.
-- Patched by anchor (sentinel, an anchor that must occur once). Safe to run twice.

do $patch$
declare
 fixes constant text[][] := array[
  ['private.integration_claim_web_push()',
   $q$'details',private.integration_push_details(c.outbox_id),$q$,
   $q$'details',private.integration_push_details(c.outbox_id),'createdAt',c.created_at,$q$,
   $q$'createdAt',c.created_at$q$]
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
