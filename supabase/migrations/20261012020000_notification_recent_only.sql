-- Email and push are only queued for recent notices. When the channels are first switched on, the
-- outbox holds a long backlog of old updates; only notices from the last 24 hours get a delivery
-- row. Older ones are never sent by email or push and stay readable in the app.

do $$
declare
 fixes constant text[][] := array[
  ['private.integration_claim_notifications(boolean,boolean)',
   $q$select o.id,'email',u.email from private.workspace_notification_outbox o join auth.users u on u.id=o.user_id$q$,
   $q$select o.id,'email',u.email from private.workspace_notification_outbox o join public.workspace_activity ra on ra.id=o.event_id and ra.created_at>now()-interval '24 hours' join auth.users u on u.id=o.user_id$q$,
   $q$ra.created_at>now()-interval '24 hours'$q$],
  ['private.integration_claim_notifications(boolean,boolean)',
   $q$select o.id,'push',d.push_token from private.workspace_notification_outbox o join private.workspace_device_tokens d on d.user_id=o.user_id$q$,
   $q$select o.id,'push',d.push_token from private.workspace_notification_outbox o join public.workspace_activity rp on rp.id=o.event_id and rp.created_at>now()-interval '24 hours' join private.workspace_device_tokens d on d.user_id=o.user_id$q$,
   $q$rp.created_at>now()-interval '24 hours'$q$]
 ];
 definition text;
begin
 for i in 1..array_length(fixes, 1) loop
  definition := pg_get_functiondef(fixes[i][1]::regprocedure);
  if position(fixes[i][4] in definition) = 0 then
   if position(fixes[i][2] in definition) = 0 then raise exception 'Patch anchor missing in % (%)', fixes[i][1], i; end if;
   execute replace(definition, fixes[i][2], fixes[i][3]);
  end if;
 end loop;
end $$;
