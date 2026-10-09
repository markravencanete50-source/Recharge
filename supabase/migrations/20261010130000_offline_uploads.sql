-- Offline photo capture. The phone keeps a photo and retries its upload with the same request
-- identifier (the upload's idempotency key) until it is saved, possibly hours later. The same key,
-- target, kind and bytes already return the saved photo; an attempt that started but never
-- finished (the connection dropped mid-upload) used to expire after 15 minutes, so a later retry
-- was refused. Now a retry of the same unfinished upload gets a fresh 15 minutes instead.
-- Nothing else changes: permission is checked again on every attempt and when it is committed.
do $$
declare
 fixes constant text[][] := array[
  ['private.workspace_prepare_upload(jsonb)',
   $q$if intent.evidence_id is null and intent.expires_at<now() then raise exception 'Upload request expired' using errcode='22023';end if;$q$,
   $q$if intent.evidence_id is null and intent.expires_at<now() then update private.workspace_upload_intents set expires_at=now()+interval '15 minutes' where id=intent.id returning * into intent;end if;$q$,
   $q$set expires_at=now()+interval '15 minutes' where id=intent.id$q$],
  ['private.workspace_prepare_expense_upload(jsonb)',
   $q$if intent.evidence_id is null and intent.expires_at<now() then raise exception 'Upload request expired' using errcode='22023';end if;$q$,
   $q$if intent.evidence_id is null and intent.expires_at<now() then update private.workspace_upload_intents set expires_at=now()+interval '15 minutes' where id=intent.id returning * into intent;end if;$q$,
   $q$set expires_at=now()+interval '15 minutes' where id=intent.id$q$]
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
