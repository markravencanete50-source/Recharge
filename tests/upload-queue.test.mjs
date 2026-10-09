import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";

// The offline photo line (lib/upload-queue.ts): photos kept on the device, sent oldest first with
// their own idempotency key, retried with backoff, and stopped on a refusal.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { UploadQueue, PermanentUploadError, UPLOAD_QUEUE_KEY, RETRY_CAP_MS, DONE_KEEP_MS, retryDelay, classifyUploadError, parseQueue, uploadSummary } = await vite.ssrLoadModule("/lib/upload-queue.ts");

const ME = "11111111-1111-4111-8111-111111111111", YOU = "22222222-2222-4222-8222-222222222222";
const WORK = "33333333-3333-4333-8333-333333333333";
const key = n => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
const photo = (n, owner = ME) => ({ id: key(n), ownerId: owner, workId: WORK, purpose: "cleaning", label: "Photos", name: "clean.jpg", type: "image/jpeg", file: `${key(n)}.jpg` });
const httpError = (status, retryAfter = 0) => Object.assign(new Error("HTTP " + status), { status, retryAfter });

// A fake device: storage, a clock, timers that only run when the test says, and a server whose
// answers the test scripts. Every send records the key it used.
function harness({ answers = [], online = () => true, storage = new Map() } = {}) {
  let now = 1_000_000;
  const timers = [], sent = [], discarded = [];
  const queue = new UploadQueue({
    storage: { getItem: async k => storage.get(k) ?? null, setItem: async (k, v) => { storage.set(k, v); } },
    send: async item => { sent.push(item.id); const next = answers.shift() ?? "ok"; if (next instanceof Error) throw next; return next === "ok" ? "99999999-9999-4999-8999-" + item.id.slice(-12) : next; },
    discard: async item => { discarded.push(item.id); },
    now: () => now, random: () => 1, online,
    setTimer: (run, ms) => { const t = { run, ms, at: now + ms }; timers.push(t); return t; },
    clearTimer: t => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
  });
  return {
    queue, storage, sent, discarded, timers,
    advance: ms => { now += ms; }, get now() { return now; },
    // Runs the next timer, as if that much time had passed.
    async tick() { const t = timers.shift(); assert.ok(t, "a retry is scheduled"); now = Math.max(now, t.at); t.run(); await queue.drain(); return t.ms; },
    items: () => queue.getSnapshot().items,
  };
}

test("a photo is kept, persisted and sent straight away with its own key", async () => {
  const h = harness();
  h.queue.setOwner(ME);
  const item = await h.queue.enqueue(photo(1));
  assert.equal(item.status, "waiting");
  assert.equal(parseQueue(h.storage.get(UPLOAD_QUEUE_KEY)).length, 1, "saved on the device before it is sent");
  await h.queue.drain();
  assert.deepEqual(h.sent, [key(1)]);
  const [done] = h.items();
  assert.equal(done.status, "done");
  assert.match(done.evidenceId, /^99999999-/);
  assert.equal(parseQueue(h.storage.get(UPLOAD_QUEUE_KEY))[0].status, "done");
  assert.equal(h.queue.pendingCount(), 0);
});

test("the line survives the app closing: a fresh queue reads it back, mid-upload photos wait again", async () => {
  const storage = new Map();
  const first = harness({ storage });
  await first.queue.enqueue(photo(1)); await first.queue.enqueue({ ...photo(2), checklistItem: "Hot tub" }); // nobody signed in yet: nothing sent
  assert.deepEqual(first.sent, []);
  const saved = JSON.parse(storage.get(UPLOAD_QUEUE_KEY));
  saved[0].status = "uploading";
  storage.set(UPLOAD_QUEUE_KEY, JSON.stringify(saved));
  const second = harness({ storage });
  await second.queue.load();
  assert.deepEqual(second.items().map(x => [x.id, x.status]), [[key(1), "waiting"], [key(2), "waiting"]]);
  assert.equal(second.items()[1].checklistItem, "Hot tub", "the checklist item goes with the photo");
  second.queue.setOwner(ME);
  await second.queue.drain();
  assert.deepEqual(second.sent, [key(1), key(2)], "oldest first, with the keys they were given");
  assert.deepEqual(parseQueue("not json"), []);
  assert.deepEqual(parseQueue(JSON.stringify([{ id: "nope" }, ...saved])).length, 2, "unreadable entries are dropped");
});

test("uploaded photos are forgotten (and their bytes deleted) after a day", async () => {
  const storage = new Map();
  const h = harness({ storage });
  h.queue.setOwner(ME); await h.queue.enqueue(photo(1)); await h.queue.drain();
  const old = JSON.parse(storage.get(UPLOAD_QUEUE_KEY)); old[0].finishedAt -= DONE_KEEP_MS + 1;
  storage.set(UPLOAD_QUEUE_KEY, JSON.stringify(old));
  const later = harness({ storage });
  await later.queue.load();
  assert.equal(later.items().length, 0);
  assert.deepEqual(later.discarded, [key(1)]);
});

test("retry delays double from 5 seconds and never pass 5 minutes", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 50].map(n => retryDelay(n, () => 1)), [5000, 10000, 20000, 40000, 80000, 160000, 300000, 300000, 300000]);
  assert.equal(retryDelay(1, () => 0), 4000, "jitter only ever shortens the wait");
  for (let n = 1; n < 40; n++) assert.ok(retryDelay(n) <= RETRY_CAP_MS);
});

test("refusals are permanent; lost connections, sign-in and server trouble are temporary", () => {
  for (const status of [400, 403, 404, 410, 413, 415]) assert.equal(classifyUploadError(httpError(status)).kind, "permanent", String(status));
  assert.match(classifyUploadError(httpError(413)).message, /8 MB/);
  assert.equal(classifyUploadError(new PermanentUploadError("This photo is no longer on this device.")).message, "This photo is no longer on this device.");
  for (const status of [0, 401, 408, 409, 500, 502, 503]) assert.equal(classifyUploadError(httpError(status)).kind, "retry", String(status));
  assert.equal(classifyUploadError(new TypeError("Network request failed")).kind, "retry");
  assert.deepEqual(classifyUploadError(httpError(429, 30)), { kind: "retry", reason: "busy", waitMs: 30000 });
  assert.equal(classifyUploadError(httpError(429)).waitMs, 60000);
});

test("no signal: the photo waits, backs off, and goes with the same key when the connection returns", async () => {
  const h = harness({ answers: [httpError(503), httpError(503), "ok"] });
  h.queue.setOwner(ME);
  await h.queue.enqueue(photo(1)); await h.queue.drain();
  let [item] = h.items();
  assert.deepEqual([item.status, item.attempts, item.waitReason, item.nextAttemptAt - h.now], ["waiting", 1, "connection", 5000]);
  assert.equal(h.timers.at(-1).ms, 5000, "a retry is set for 5 seconds");
  assert.equal(await h.tick(), 5000);
  [item] = h.items();
  assert.deepEqual([item.status, item.attempts, item.nextAttemptAt - h.now], ["waiting", 2, 10000]);
  // The app comes back to the front (or "Retry now"): it goes at once.
  await h.queue.retryNow();
  assert.equal(h.items()[0].status, "done");
  assert.deepEqual(h.sent, [key(1), key(1), key(1)], "every attempt reuses the photo's idempotency key");
  assert.equal(h.timers.length, 0, "nothing left to retry");
});

test("a refusal stops retrying: the photo shows as failed until Try again or Remove", async () => {
  const h = harness({ answers: [httpError(403), "ok"] });
  h.queue.setOwner(ME);
  await h.queue.enqueue(photo(1)); await h.queue.drain();
  let [item] = h.items();
  assert.equal(item.status, "failed");
  assert.match(item.error, /can't add photos/);
  assert.equal(h.timers.length, 0, "no retry is scheduled");
  await h.queue.retryNow();
  assert.deepEqual(h.sent, [key(1)], "Retry now leaves failed photos alone");
  await h.queue.retry(key(1));
  [item] = h.items();
  assert.deepEqual([item.status, item.attempts], ["done", 1]);
  assert.deepEqual(h.sent, [key(1), key(1)]);
  await h.queue.enqueue(photo(2));
  const g = harness({ answers: [httpError(413)] });
  g.queue.setOwner(ME); await g.queue.enqueue(photo(3)); await g.queue.drain();
  assert.equal(await g.queue.remove(key(3)), true);
  assert.deepEqual([g.items().length, g.discarded], [0, [key(3)]], "removed from the line and from the device");
});

test("too many uploads: the whole line waits as long as the server asks, without counting it as a failure", async () => {
  const h = harness({ answers: [httpError(429, 45), "ok", "ok"] });
  h.queue.setOwner(ME);
  await h.queue.enqueue(photo(1)); await h.queue.enqueue(photo(2)); await h.queue.drain();
  assert.deepEqual(h.sent, [key(1)], "the second photo is not tried during the pause");
  const [item] = h.items();
  assert.deepEqual([item.status, item.attempts, item.waitReason, item.nextAttemptAt - h.now], ["waiting", 0, "busy", 45000]);
  assert.equal(h.timers.at(-1).ms, 45000);
  await h.tick();
  assert.deepEqual(h.sent, [key(1), key(1), key(2)]);
  assert.deepEqual(uploadSummary(h.items(), ME), { waiting: 0, uploading: 0, failed: 0 });
});

test("only the signed-in person's photos are sent; signing out stops the line", async () => {
  const h = harness();
  h.queue.setOwner(ME);
  await h.queue.enqueue(photo(1, YOU)); await h.queue.drain();
  assert.deepEqual(h.sent, []);
  assert.equal(h.queue.pendingCount(), 0); assert.equal(h.queue.pendingCount(YOU), 1);
  h.queue.setOwner(null);
  await h.queue.enqueue(photo(2)); await h.queue.drain();
  assert.deepEqual(h.sent, []);
  h.queue.setOwner(ME); await h.queue.drain();
  assert.deepEqual(h.sent, [key(2)]);
});

test("offline in the browser: nothing is tried and no timer spins until the connection is back", async () => {
  let online = false;
  const h = harness({ online: () => online });
  h.queue.setOwner(ME);
  await h.queue.enqueue(photo(1)); await h.queue.drain();
  assert.deepEqual([h.sent.length, h.timers.length, h.items()[0].attempts], [0, 0, 0]);
  online = true;
  await h.queue.retryNow();
  assert.equal(h.items()[0].status, "done");
});

test("a screen lets go of photos it has used; photos still waiting stay", async () => {
  const h = harness({ answers: ["ok", httpError(503)] });
  h.queue.setOwner(ME);
  await h.queue.enqueue(photo(1)); await h.queue.drain();
  await h.queue.enqueue(photo(2)); await h.queue.drain();
  await h.queue.release([key(1), key(2)]);
  assert.deepEqual(h.items().map(x => x.id), [key(2)]);
  assert.deepEqual(h.discarded, [key(1)]);
  assert.equal(await h.queue.remove(key(2)), true);
});
