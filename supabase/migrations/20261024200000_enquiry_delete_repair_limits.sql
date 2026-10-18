-- Client enquiries can be deleted while onboarding is still going (Lee: "even though it's already ongoing we should be
-- able to delete it"). An enquiry at "Estimate sent" was refused with "This property has other records recorded": the
-- property had its repair spending limit and its history (Limit Changer, 20261021200000), which every property can
-- have and which the delete did not know about.
--  * The repair limit and its history now go with the property, like the rest of its set-up.
--  * A furnishing quote for the property still stops a delete, and now says so ("a furnishing quote") instead of
--    "other records".
--  * Unchanged: admins and super admins only; up to and including the agreement while unsigned and never live; an
--    invoice, bookings, money or messages still stop it ("Archive it instead").
-- Patched by anchor (sentinel, an anchor that must occur once): private.workspace_enquiry_blocker(uuid,uuid[],uuid) and
-- private.workspace_client_enquiry_delete(jsonb). The new lines remove the deleted property's repair limit rows, in the
-- same transaction as the rest of the enquiry, only when an admin deletes the enquiry. Safe to run twice.

do $patch$
declare
 fixes constant text[][] := array[
  -- The tables the delete clears are not blockers.
  ['private.workspace_enquiry_blocker(uuid,uuid[],uuid)',
   $q$'private.workspace_notification_outbox','public.workspace_work_updates','private.workspace_domain_details','private.workspace_upload_intents']::regclass[];$q$,
   $q$'private.workspace_notification_outbox','public.workspace_work_updates','private.workspace_domain_details','private.workspace_upload_intents',
  'private.workspace_repair_limits','private.workspace_repair_limit_history']::regclass[];/* enquiry delete repair limits: 20261024200000 */$q$,
   $q$/* enquiry delete repair limits: 20261024200000 */$q$],
  ['private.workspace_enquiry_blocker(uuid,uuid[],uuid)',
   $q$when 'private.workspace_cleaning_reviews'::regclass then 'clean reviews'$q$,
   $q$when 'private.workspace_cleaning_reviews'::regclass then 'clean reviews'
    when 'private.workspace_furnishing_projects'::regclass then 'a furnishing quote'/* enquiry delete names: 20261024200000 */$q$,
   $q$/* enquiry delete names: 20261024200000 */$q$],
  -- They go with the property.
  ['private.workspace_client_enquiry_delete(jsonb)',
   $q$delete from private.workspace_default_cleaners c where c.property_id=prop;$q$,
   $q$delete from private.workspace_default_cleaners c where c.property_id=prop;
  /* enquiry delete repair limits: 20261024200000 */ delete from private.workspace_repair_limit_history h where h.property_id=prop;
  delete from private.workspace_repair_limits l where l.property_id=prop;$q$,
   $q$/* enquiry delete repair limits: 20261024200000 */$q$]
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
