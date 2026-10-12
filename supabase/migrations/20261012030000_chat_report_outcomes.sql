-- Closing the loop on chat reports. When an admin decides a report:
--   * every person whose open report was closed by that decision is told it was reviewed
--     (`chat.report_removed` when the message was removed, `chat.report_reviewed` when it was left
--     in place);
--   * on removal, the person who wrote the message is told (`chat.message_removed`).
-- The notices carry no actor, so nobody learns which admin decided, and the sender is never told
-- who reported. The decision is patched in by anchor and runs once per request: a replayed request
-- returns the saved answer before reaching this code. Safe to run twice.

do $$
declare
 fixes constant text[][] := array[
  ['private.chat_report_decide(jsonb)',
   $q$update private.chat_reports x set status=case when decision='remove' then 'actioned' else 'dismissed' end,handled_by=auth.uid(),handled_at=now(),version=x.version+1
  where x.message_id=rep.message_id and x.status='open'$q$,
   $q$with ev as (insert into public.workspace_activity(actor_id,event_type) values(null,case when decision='remove' then 'chat.report_removed' else 'chat.report_reviewed' end) returning id)
  insert into private.workspace_notification_outbox(user_id,event_id)
   select r.reporter_id,ev.id from ev,(select distinct x.reporter_id from private.chat_reports x where x.message_id=rep.message_id and x.status='open') r
   join public.workspace_profiles p on p.user_id=r.reporter_id and p.status='active' on conflict do nothing;
 if decision='remove' then
  with ev as (insert into public.workspace_activity(actor_id,event_type) values(null,'chat.message_removed') returning id)
  insert into private.workspace_notification_outbox(user_id,event_id)
   select p.user_id,ev.id from ev,public.workspace_profiles p where p.user_id=rep.author_id and p.status='active' on conflict do nothing;
 end if;
 update private.chat_reports x set status=case when decision='remove' then 'actioned' else 'dismissed' end,handled_by=auth.uid(),handled_at=now(),version=x.version+1
  where x.message_id=rep.message_id and x.status='open'$q$,
   $q$chat.message_removed$q$]
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
