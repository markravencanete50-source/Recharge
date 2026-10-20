import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// Deleting a lead removes its stored files, best effort (lib/enquiry-storage-cleanup.ts, migration 20261025500000): the
// client's photos from enquiry-files and the lead's PriceLabs reports from lead-files, with a fake storage client.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { deletedEnquiryFiles, removeStoredCopies, REMOVAL_CHUNK } = await vite.ssrLoadModule('/lib/enquiry-storage-cleanup.ts');
const BUCKETS = { enquiry: 'enquiry-files', lead: 'lead-files' };

function fakeStorage(fail = {}) {
  const removed = [], marked = [], logs = [];
  const bucket = name => fail[name] === 'missing' ? null : {
    remove: async paths => {
      if (fail[name] === 'throw') throw new Error('down');
      if (fail[name] === 'error') return { error: { message: 'nope' } };
      removed.push([name, ...paths]); return { error: null };
    },
  };
  const markRemoved = async (b, paths) => { if (fail.mark) throw new Error('mark failed'); marked.push([b, ...paths]); };
  return { removed, marked, logs, deps: { bucket, markRemoved, log: m => logs.push(m) } };
}

test('the delete result names the photos and the lead files, per bucket', () => {
  assert.deepEqual(deletedEnquiryFiles({ deleted: true, paths: ['enquiries/a/1.jpg', 'enquiries/a/1.jpg', 7, ''], leadPaths: ['leads/a/r.pdf'] }, BUCKETS),
    [{ bucket: 'enquiry-files', paths: ['enquiries/a/1.jpg'] }, { bucket: 'lead-files', paths: ['leads/a/r.pdf'] }]);
  assert.deepEqual(deletedEnquiryFiles({ deleted: true, paths: [] }, BUCKETS), [], 'an older result without leadPaths');
  assert.deepEqual(deletedEnquiryFiles(null, BUCKETS), []);
  assert.deepEqual(deletedEnquiryFiles({ leadPaths: 'leads/a/r.pdf' }, BUCKETS), []);
});

test('the stored copies are removed and marked removed, in chunks of 100', async () => {
  const f = fakeStorage();
  const many = Array.from({ length: REMOVAL_CHUNK + 5 }, (_, i) => `leads/a/${i}.pdf`);
  const n = await removeStoredCopies([{ bucket: 'enquiry-files', paths: ['enquiries/a/1.jpg'] }, { bucket: 'lead-files', paths: many }], f.deps);
  assert.equal(n, REMOVAL_CHUNK + 6);
  assert.deepEqual(f.removed.map(r => [r[0], r.length - 1]), [['enquiry-files', 1], ['lead-files', REMOVAL_CHUNK], ['lead-files', 5]]);
  assert.deepEqual(f.marked.map(r => [r[0], r.length - 1]), [['enquiry-files', 1], ['lead-files', REMOVAL_CHUNK], ['lead-files', 5]]);
  assert.deepEqual(f.logs, []);
});

test('a failed removal never fails the delete: it is logged, left queued, and the other bucket still goes', async () => {
  for (const mode of ['throw', 'error', 'missing']) {
    const f = fakeStorage({ 'lead-files': mode });
    const n = await removeStoredCopies([{ bucket: 'lead-files', paths: ['leads/a/r.pdf'] }, { bucket: 'enquiry-files', paths: ['enquiries/a/1.jpg'] }], f.deps);
    assert.equal(n, 1, mode);
    assert.deepEqual(f.marked, [['enquiry-files', 'enquiries/a/1.jpg']], mode + ': only what went is marked');
    assert.equal(f.logs.length, 1, mode);
    assert.match(f.logs[0], /lead-files/);
    assert.doesNotMatch(f.logs[0], /leads\/a/, 'no paths in the log');
  }
  const marking = fakeStorage({ mark: true });
  assert.equal(await removeStoredCopies([{ bucket: 'lead-files', paths: ['leads/a/r.pdf'] }], marking.deps), 1);
  assert.match(marking.logs[0], /not marked removed/);
});
