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
--    Who is told, and when, is unchanged. A team chat message's pop-up also gets what it carries ('attachmentKind': image,
--    video or audio) and its first photo's private path ('attachmentPath'), which the server signs for an hour for the
--    pop-up's picture (lib/web-push.ts); the path never reaches a device.
-- 3. Lee: "if it's already done with the agreement we cannot delete it, make sure we always have the way to delete it."
--    Admins and super admins can now delete an enquiry and its property at ANY onboarding stage before it goes live
--    (enquiry, estimate, reviewing, agreement, form, invoice, inspection_to_book, inspection_booked, inspection_complete,
--    or archived), including a signed agreement, a submitted set-up form and an onboarding invoice. Everything onboarding
--    made goes with it: the journey (agreement, signature, set-up form, inspection report), the onboarding invoice
--    (module onboarding-invoices), the payout details from the set-up form (private.workspace_bank_details), the garden
--    and bins routine and its scheduled visits, every work item with its details, the lead's steps, comments and files,
--    the enquiry's files, access and notices, as before.
--    Still refused ("Archive it instead"): a live property (status not onboarding or archived, or stage live), and real
--    business: another invoice, bookings, owner statements, guest messages, messages, photos on work, clean reviews, a
--    furnishing quote, or completed work that is not part of onboarding (a clean, a repair, a routine visit done).
--    Past the agreement (signed, a set-up form, an invoice, or an inspection stage) the request must carry
--    confirm: 'DELETE' (the person types it in the app). The access history records whether it was signed and invoiced.
-- Patched by anchor (sentinel, an anchor that must occur once): private.workspace_client_enquiry_delete(jsonb),
-- private.workspace_enquiry_blocker(uuid,uuid[],uuid), private.workspace_guest_message_notices() and
-- private.integration_push_details(bigint). The bucket check is replaced by name with the wider one; one nullable column
-- is added. No DROP of a table; the only rows deleted are the deleted property's own, inside the admin's delete. Safe to
-- run twice.

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
  'guestThreadId',case when a.event_type='guest.message' then d.guest_thread_id end,
  'attachmentKind',case when d.message_id is not null then (select case when count(*)=0 then null when bool_or(x.kind='audio') then 'audio'
   when bool_or(x.kind='image') then 'image' else 'video' end from private.chat_attachments x where x.message_id=d.message_id) end,
  'attachmentPath',case when d.message_id is not null then (select x.path from private.chat_attachments x where x.message_id=d.message_id and x.kind='image'
   order by x.position,x.created_at limit 1) end/* guest push details: 20261025500000 */$q$,
   $q$/* guest push details: 20261025500000 */$q$],
  -- 3. Any onboarding stage before live. The request may carry confirm.
  ['private.workspace_client_enquiry_delete(jsonb)',
   $q$perform private.workspace_json_keys(input,array['action','requestId','enquiryId','version']);$q$,
   $q$perform private.workspace_json_keys(input,array['action','requestId','enquiryId','version','confirm']);/* onboarding delete confirm key: 20261025500000 */$q$,
   $q$/* onboarding delete confirm key: 20261025500000 */$q$],
  ['private.workspace_client_enquiry_delete(jsonb)',
   $q$ or (j.property_id is not null and (j.stage not in ('enquiry','estimate','reviewing','agreement','archived') or j.signed_at is not null or j.signed_name is not null or j.invoice_id is not null)) then$q$,
   $q$ or (j.property_id is not null and j.stage not in ('enquiry','estimate','reviewing','agreement','form','invoice','inspection_to_book','inspection_booked','inspection_complete','archived'))/* onboarding delete any stage: 20261025500000 */ then$q$,
   $q$/* onboarding delete any stage: 20261025500000 */$q$],
  ['private.workspace_client_enquiry_delete(jsonb)',
   $q$raise exception 'The agreement is signed or the property is live, so this enquiry can no longer be deleted. Archive it instead.' using errcode='22023';$q$,
   $q$raise exception 'The property is live, so this enquiry can no longer be deleted. Archive it instead.' using errcode='22023';/* onboarding delete live words: 20261025500000 */$q$,
   $q$/* onboarding delete live words: 20261025500000 */$q$],
  ['private.workspace_client_enquiry_delete(jsonb)',
   $q$blocker:=private.workspace_enquiry_blocker(prop,tasks,e.id);$q$,
   $q$/* onboarding delete work done: 20261025500000 */
 -- Work done on the property that is not onboarding (a clean, a repair, a routine visit) means it has been in use.
 if prop is not null and exists(select 1 from public.workspace_work_items w where w.id=any(tasks) and w.status='completed'
  and (w.module_id not in ('property-onboarding','onboarding-invoices','licensing','new-property-inspection-board','property-furnishing-board','clean-property-onboarding','routine-bin-garden-board')
   or exists(select 1 from private.workspace_routine_visits v where v.work_id=w.id))) then
  raise exception 'This property has completed work recorded, so this enquiry can no longer be deleted. Archive it instead.' using errcode='22023';
 end if;
 blocker:=private.workspace_enquiry_blocker(prop,tasks,e.id);
 -- Past the agreement more goes with it, so the person confirms by typing DELETE.
 if j.property_id is not null and (j.signed_at is not null or j.signed_name is not null or j.invoice_id is not null or j.invoice_outside_at is not null or j.submitted_at is not null
   or j.stage in ('form','invoice','inspection_to_book','inspection_booked','inspection_complete'))
  and blocker is null and input->>'confirm' is distinct from 'DELETE' then
  raise exception 'Type DELETE to confirm. This removes the signed agreement, the set-up form, the onboarding invoice and the inspection too.' using errcode='22023';
 end if;$q$,
   $q$/* onboarding delete work done: 20261025500000 */$q$],
  ['private.workspace_client_enquiry_delete(jsonb)',
   $q$'status',e.status,'stage',j.stage,$q$,
   $q$'status',e.status,'stage',j.stage,'signed',(j.signed_at is not null),'invoiced',(j.invoice_id is not null or j.invoice_outside_at is not null),/* onboarding delete audit: 20261025500000 */$q$,
   $q$/* onboarding delete audit: 20261025500000 */$q$],
  -- The onboarding invoice goes once the journey that points at it has gone.
  ['private.workspace_client_enquiry_delete(jsonb)',
   $q$delete from private.workspace_journeys x where x.property_id=prop;$q$,
   $q$delete from private.workspace_journeys x where x.property_id=prop;
  /* onboarding delete invoice: 20261025500000 */ delete from public.workspace_invoices i where i.property_id=prop and i.module_id='onboarding-invoices';
  delete from private.workspace_bank_details b where b.property_id=prop;$q$,
   $q$/* onboarding delete invoice: 20261025500000 */$q$],
  -- The garden and bins routine and its scheduled visits, before the work items.
  ['private.workspace_client_enquiry_delete(jsonb)',
   $q$delete from public.workspace_work_updates u where u.work_id=any(tasks);$q$,
   $q$/* onboarding delete routine: 20261025500000 */ delete from private.workspace_routine_visits v where v.work_id=any(tasks) or v.plan_id in (select r.id from private.workspace_routine_plans r where r.property_id=prop);
  delete from private.workspace_routine_plans r where r.property_id=prop;
  delete from public.workspace_work_updates u where u.work_id=any(tasks);$q$,
   $q$/* onboarding delete routine: 20261025500000 */$q$],
  -- What the delete now clears is not a blocker; an onboarding invoice is not either (any other invoice still is).
  ['private.workspace_enquiry_blocker(uuid,uuid[],uuid)',
   $q$continue when r.conrelid=any(cleared);$q$,
   $q$continue when r.conrelid=any(cleared);
  /* onboarding delete blockers: 20261025500000 */
  continue when r.conrelid=any(array['private.workspace_bank_details','private.workspace_routine_plans','private.workspace_routine_visits']::regclass[]);
  continue when r.conrelid='public.workspace_invoices'::regclass and r.confrelid='public.workspace_properties'::regclass
   and not exists(select 1 from public.workspace_invoices i where i.property_id=prop and i.module_id<>'onboarding-invoices');$q$,
   $q$/* onboarding delete blockers: 20261025500000 */$q$]
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
