-- Two fixes.
-- 1. Deleting a lead (a client enquiry) left its PriceLabs reports in the private 'lead-files' bucket: the rows in
-- private.workspace_lead_files go with the enquiry (on delete cascade), but nothing removed the stored copies.
--  * The delete now reads the lead's files first, queues them in private.workspace_storage_removals (bucket 'lead-files',
--    reason 'client_enquiry.deleted', as the enquiry's own photos already are) and hands their paths back as leadPaths.
--    The site's server removes the stored copies straight away with the service client and marks them removed, best
--    effort (lib/enquiry-storage-cleanup.ts): a failed removal never fails the delete and stays queued on record.
--  * private.workspace_storage_removals accepts the 'lead-files' bucket.
--    Unchanged: who may delete, at which stages, what stops it, and everything else it deletes.
-- 2. A guest message pop-up opened Messages instead of the guest's conversation. Its notice now keeps the guest conversation
--    (private.workspace_activity_details.guest_thread_id, set by private.workspace_guest_message_notices) and
--    private.integration_push_details hands it on as 'guestThreadId', so a tap and Reply open that conversation, Mark as read
--    marks it read on the device, and its pop-ups group per conversation (lib/push-copy.ts, mobile/web-static/sw.js).
--    Who is told, and when, is unchanged.
-- Patched by anchor (sentinel, an anchor that must occur once): private.workspace_client_enquiry_delete(jsonb),
-- private.workspace_guest_message_notices() and private.integration_push_details(bigint). The bucket check is replaced by
-- name with the wider one; one nullable column is added. No DROP of a table, no DELETE. Safe to run twice.

alter table private.workspace_storage_removals drop constraint if exists workspace_storage_removals_bucket_check;
alter table private.workspace_storage_removals add constraint workspace_storage_removals_bucket_check check(bucket in ('enquiry-files','lead-files'));

alter table private.workspace_activity_details add column if not exists guest_thread_id uuid references private.workspace_guest_threads(id) on delete set null;
create index if not exists workspace_activity_details_guest_thread_idx on private.workspace_activity_details(guest_thread_id);

do $patch$
declare
 -- function, anchor (must occur exactly once), replacement, sentinel (present once patched)
 fixes constant text[][] := array[
  ['private.workspace_client_enquiry_delete(jsonb)',
   $q$paths text[];events bigint[];$q$,
   $q$paths text[];/* lead files declared: 20261025500000 */lead_file_paths text[];events bigint[];$q$,
   $q$/* lead files declared: 20261025500000 */$q$],
  -- Read before the enquiry goes (its file rows go with it), queued like the enquiry's photos.
  ['private.workspace_client_enquiry_delete(jsonb)',
   $q$delete from private.workspace_client_enquiries where id=e.id;$q$,
   $q$/* lead files queued: 20261025500000 */ lead_file_paths:=array(select f.path from private.workspace_lead_files f where f.enquiry_id=e.id order by f.created_at,f.path);
 insert into private.workspace_storage_removals(bucket,path,reason,queued_by) select 'lead-files',x,'client_enquiry.deleted',auth.uid() from unnest(lead_file_paths) x;
 delete from private.workspace_client_enquiries where id=e.id;$q$,
   $q$/* lead files queued: 20261025500000 */$q$],
  ['private.workspace_client_enquiry_delete(jsonb)',
   $q$'paths',to_jsonb(paths));$q$,
   $q$'paths',to_jsonb(paths),'leadPaths',to_jsonb(coalesce(lead_file_paths,'{}'::text[]))/* lead files returned: 20261025500000 */);$q$,
   $q$/* lead files returned: 20261025500000 */$q$],
  -- The guest message notice keeps its conversation.
  ['private.workspace_guest_message_notices()',
   $q$insert into private.workspace_activity_details(event_id,who,preview,replied)$q$,
   $q$insert into private.workspace_activity_details(event_id,who,preview,replied,guest_thread_id)/* guest push columns: 20261025500000 */$q$,
   $q$/* guest push columns: 20261025500000 */$q$],
  ['private.workspace_guest_message_notices()',
   $q$x.id<>m.id and x.sent_at<=m.sent_at))$q$,
   $q$x.id<>m.id and x.sent_at<=m.sent_at),
     (select t.id from private.workspace_guest_threads t where t.source=m.source and t.thread_ref=m.thread_ref)/* guest push thread: 20261025500000 */)$q$,
   $q$/* guest push thread: 20261025500000 */$q$],
  -- The pop-up gets it (guest messages only).
  ['private.integration_push_details(bigint)',
   $q$'senderColour',case when d.message_id is not null and rp.role<>'client' then ap.avatar_preset end$q$,
   $q$'senderColour',case when d.message_id is not null and rp.role<>'client' then ap.avatar_preset end,
  'guestThreadId',case when a.event_type='guest.message' then d.guest_thread_id end/* guest push details: 20261025500000 */$q$,
   $q$/* guest push details: 20261025500000 */$q$]
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

revoke all on function private.workspace_client_enquiry_delete(jsonb),private.workspace_guest_message_notices(),private.integration_push_details(bigint)
 from public,anon,authenticated,service_role;
