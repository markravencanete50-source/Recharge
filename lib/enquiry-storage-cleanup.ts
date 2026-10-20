// The stored copies of a deleted enquiry's files (lib/client-enquiry-server.ts deleteEnquiry, migration 20261025500000):
// the database deletes the rows, queues the paths in private.workspace_storage_removals and hands them back, per bucket
// (the client's photos in 'enquiry-files', the lead's PriceLabs reports in 'lead-files'). The server removes them
// straight away with the service client and marks them removed. Best effort: a removal that fails never fails the
// delete; it is logged (the bucket and how many, never the paths) and stays queued on record.

// The lead's PriceLabs reports (lib/lead-files-server.ts). Kept here, with no server imports, so the delete can name it.
export const LEAD_FILES_BUCKET = 'lead-files';

export type StorageBucket = { remove(paths: string[]): Promise<{ error: unknown }> };
export type RemovalBatch = { bucket: string; paths: readonly string[] };
// workspace_storage_removed takes up to 100 paths at a time.
export const REMOVAL_CHUNK = 100;

// The batches a delete's result asks for: its photos (`paths`) and its lead files (`leadPaths`). Anything else is ignored.
export function deletedEnquiryFiles(result: unknown, buckets: { enquiry: string; lead: string }): RemovalBatch[] {
  const list = (v: unknown) => Array.isArray(v) ? [...new Set(v.filter((p): p is string => typeof p === 'string' && p.length > 0 && p.length <= 500))] : [];
  const r = result && typeof result === 'object' ? result as { paths?: unknown; leadPaths?: unknown } : {};
  return [{ bucket: buckets.enquiry, paths: list(r.paths) }, { bucket: buckets.lead, paths: list(r.leadPaths) }].filter(b => b.paths.length);
}

// Removes each batch from its bucket, then marks what was removed. Returns how many stored copies went.
export async function removeStoredCopies(batches: readonly RemovalBatch[], deps: {
  bucket: (name: string) => StorageBucket | null | undefined;
  markRemoved: (bucket: string, paths: string[]) => Promise<unknown>;
  log?: (message: string) => void;
}): Promise<number> {
  const log = deps.log ?? ((message: string) => console.error(message));
  let removed = 0;
  for (const batch of batches) {
    const storage = deps.bucket(batch.bucket);
    if (!storage) { log(`Enquiry delete: ${batch.paths.length} file(s) left queued in ${batch.bucket} (storage not configured)`); continue; }
    for (let i = 0; i < batch.paths.length; i += REMOVAL_CHUNK) {
      const chunk = batch.paths.slice(i, i + REMOVAL_CHUNK);
      const ok = await storage.remove(chunk).then(r => !r?.error, () => false);
      if (!ok) { log(`Enquiry delete: ${chunk.length} file(s) could not be removed from ${batch.bucket}; left queued`); continue; }
      removed += chunk.length;
      await deps.markRemoved(batch.bucket, chunk).catch(() => log(`Enquiry delete: ${chunk.length} file(s) removed from ${batch.bucket} but not marked removed`));
    }
  }
  return removed;
}
