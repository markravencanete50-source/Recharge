-- Deleting a lead (a client enquiry) left its PriceLabs reports in the private 'lead-files' bucket: the rows in
-- private.workspace_lead_files go with the enquiry (on delete cascade), but nothing removed the stored copies.
--  * The delete now reads the lead's files first, queues them in private.workspace_storage_removals (bucket 'lead-files',
--    reason 'client_enquiry.deleted', as the enquiry's own photos already are) and hands their paths back as leadPaths.
--    The site's server removes the stored copies straight away with the service client and marks them removed, best
--    effort (lib/enquiry-storage-cleanup.ts): a failed removal never fails the delete and stays queued on record.
--  * private.workspace_storage_removals accepts the 'lead-files' bucket.
-- Unchanged: who may delete, at which stages, what stops it, and everything else it deletes.
-- Patched by anchor (sentinel, an anchor that must occur once): private.workspace_client_enquiry_delete(jsonb).
-- The bucket check is replaced by name with the wider one. No DROP of a table, no DELETE. Safe to run twice.

alter table private.workspace_storage_removals drop constraint if exists workspace_storage_removals_bucket_check;
alter table private.workspace_storage_removals add constraint workspace_storage_removals_bucket_check check(bucket in ('enquiry-files','lead-files'));

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
   $q$/* lead files returned: 20261025500000 */$q$]
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

revoke all on function private.workspace_client_enquiry_delete(jsonb) from public,anon,authenticated,service_role;
