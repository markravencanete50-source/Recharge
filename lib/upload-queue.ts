import { z } from 'zod';

// Photos waiting to upload. A photo is kept on the device the moment it is taken and sent in the
// background, oldest first, until the server has it. Each photo has its own idempotency key (the
// upload's requestId): the server answers a repeat of the same key, work item and bytes with the
// photo it already saved, so a retry after a lost answer never makes a second photo.
// This file has no React Native imports so it can be tested on its own; mobile/src/uploadQueue.ts
// connects it to the device's storage, the app's state and the upload request.

export const UPLOAD_QUEUE_KEY = 'recharge.uploads.v1';
export const RETRY_BASE_MS = 5_000;
export const RETRY_CAP_MS = 5 * 60_000;
export const RATE_LIMIT_WAIT_MS = 60_000;
// An uploaded photo stays listed (for the screen it was taken on) for a day, then is forgotten.
export const DONE_KEEP_MS = 24 * 60 * 60_000;

const itemSchema = z.object({
  id: z.string().uuid(),
  ownerId: z.string().min(1).max(64),
  workId: z.string().uuid().optional(),
  expenseId: z.string().uuid().optional(),
  purpose: z.string().min(1).max(40),
  label: z.string().max(120),
  // The check on a clean's checklist the photo was taken for, sent with it.
  checklistItem: z.string().min(1).max(200).optional(),
  name: z.string().min(1).max(200),
  type: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  file: z.string().min(1).max(500),
  createdAt: z.number(),
  attempts: z.number().int().min(0),
  nextAttemptAt: z.number(),
  status: z.enum(['waiting', 'uploading', 'failed', 'done']),
  waitReason: z.enum(['connection', 'busy']).optional(),
  error: z.string().max(300).optional(),
  evidenceId: z.string().uuid().optional(),
  finishedAt: z.number().optional(),
});
export type QueuedUpload = z.infer<typeof itemSchema>;
export type UploadStatus = QueuedUpload['status'];
export type NewUpload = Pick<QueuedUpload, 'id' | 'ownerId' | 'workId' | 'expenseId' | 'purpose' | 'label' | 'checklistItem' | 'name' | 'type' | 'file'>;
export type KeyValueStorage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };

// An error that retrying cannot fix, such as the photo file having gone from the device.
export class PermanentUploadError extends Error {
  constructor(message: string) { super(message); this.name = 'PermanentUploadError'; }
}

// 5s, 10s, 20s … doubling up to 5 minutes. The random part (up to a fifth shorter) spreads out
// phones that all come back online together; it never goes above the cap.
export function retryDelay(attempts: number, random: () => number = Math.random) {
  const step = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** Math.max(0, Math.min(attempts, 30) - 1));
  return Math.round(step * (0.8 + 0.2 * Math.min(1, Math.max(0, random()))));
}

export type UploadOutcome = { kind: 'retry'; reason: 'connection' | 'busy'; waitMs?: number } | { kind: 'permanent'; message: string };
const statusOf = (error: unknown) => typeof (error as { status?: unknown })?.status === 'number' ? (error as { status: number }).status : undefined;
// Lost connections, timeouts, sign-in refreshes, conflicts and server trouble are tried again;
// a refusal (no permission, gone, too large, not a photo) is not.
export function classifyUploadError(error: unknown): UploadOutcome {
  if (error instanceof PermanentUploadError) return { kind: 'permanent', message: error.message };
  const status = statusOf(error);
  if (status === 429) {
    const after = Number((error as { retryAfter?: unknown }).retryAfter);
    return { kind: 'retry', reason: 'busy', waitMs: Number.isFinite(after) && after > 0 ? Math.min(after, 3600) * 1000 : RATE_LIMIT_WAIT_MS };
  }
  if (status === undefined || status === 0 || status === 401 || status === 408 || status === 409 || status === 423 || status === 425 || status >= 500) return { kind: 'retry', reason: 'connection' };
  if (status === 413) return { kind: 'permanent', message: 'This photo is larger than 8 MB.' };
  if (status === 403) return { kind: 'permanent', message: "You can't add photos to this any more. It may be finished, or no longer yours." };
  if (status === 404 || status === 410) return { kind: 'permanent', message: 'This item no longer exists.' };
  return { kind: 'permanent', message: "This photo couldn't be accepted. Choose a JPEG, PNG or WebP photo up to 8 MB." };
}

// Parses what was saved on the device, dropping anything unreadable. A photo that was mid-upload
// when the app closed waits to go again (its key makes that safe).
export function parseQueue(raw: string | null): QueuedUpload[] {
  if (!raw) return [];
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(value)) return [];
  return value.flatMap(entry => {
    const parsed = itemSchema.safeParse(entry);
    if (!parsed.success) return [];
    return [parsed.data.status === 'uploading' ? { ...parsed.data, status: 'waiting' as const } : parsed.data];
  });
}
export const serializeQueue = (items: readonly QueuedUpload[]) => JSON.stringify(items.map(x => x.status === 'uploading' ? { ...x, status: 'waiting' } : x));

// The photos one picker shows: the same person, target, kind and label.
export type UploadSlot = { ownerId: string; workId?: string; expenseId?: string; purpose: string; label: string };
export const inSlot = (item: QueuedUpload, slot: UploadSlot) => item.ownerId === slot.ownerId && item.workId === slot.workId && item.expenseId === slot.expenseId && item.purpose === slot.purpose && item.label === slot.label;
export function uploadSummary(items: readonly QueuedUpload[], ownerId: string | null) {
  const mine = items.filter(x => x.ownerId === ownerId);
  return { waiting: mine.filter(x => x.status === 'waiting').length, uploading: mine.filter(x => x.status === 'uploading').length, failed: mine.filter(x => x.status === 'failed').length };
}

export type UploadQueueDeps = {
  storage: KeyValueStorage;
  // Sends one photo with its key; resolves to the saved photo's id.
  send(item: QueuedUpload): Promise<string>;
  // Deletes the photo's bytes from the device.
  discard(item: QueuedUpload): Promise<void>;
  now?: () => number;
  random?: () => number;
  online?: () => boolean;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
};
export type QueueSnapshot = { owner: string | null; items: readonly QueuedUpload[] };

export class UploadQueue {
  private items: QueuedUpload[] = [];
  private snapshot: QueueSnapshot = { owner: null, items: [] };
  private loading: Promise<void> | null = null;
  private running: Promise<void> | null = null;
  private writing: Promise<void> = Promise.resolve();
  private listeners = new Set<() => void>();
  private owner: string | null = null;
  private pauseUntil = 0;
  private timer: unknown = null;
  private readonly now: () => number;
  private readonly random: () => number;
  constructor(private readonly deps: UploadQueueDeps) {
    this.now = deps.now ?? Date.now;
    this.random = deps.random ?? Math.random;
  }

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getSnapshot = () => this.snapshot;
  currentOwner() { return this.owner; }

  load() {
    this.loading ??= (async () => {
      let raw: string | null = null;
      try { raw = await this.deps.storage.getItem(UPLOAD_QUEUE_KEY); } catch { raw = null; }
      const cutoff = this.now() - DONE_KEEP_MS;
      const loaded = parseQueue(raw), keep = loaded.filter(x => !(x.status === 'done' && (x.finishedAt ?? 0) < cutoff));
      for (const old of loaded.filter(x => !keep.includes(x))) await this.deps.discard(old).catch(() => undefined);
      // Anything added before loading finished stays, after what was already saved.
      const known = new Set(keep.map(x => x.id));
      this.items = [...keep, ...this.items.filter(x => !known.has(x.id))];
      if (keep.length !== loaded.length) this.persist();
      this.emit();
    })();
    return this.loading;
  }

  // Whose photos to send. Signing out stops sending; another person's photos are never sent.
  setOwner(owner: string | null) {
    if (this.owner === owner) return;
    this.owner = owner;
    this.emit();
    if (owner) void this.drain(); else this.clearTimer();
  }

  // Keeps a photo whose bytes are already stored on the device, then starts sending it.
  async enqueue(input: NewUpload) {
    await this.load();
    const at = this.now();
    const item: QueuedUpload = { ...input, createdAt: at, attempts: 0, nextAttemptAt: at, status: 'waiting' };
    this.items = [...this.items.filter(x => x.id !== item.id), item];
    this.emit();
    await this.persist();
    void this.drain();
    return item;
  }

  // "Retry now", the app coming back to the front, or the browser coming back online.
  async retryNow() {
    await this.load();
    const at = this.now();
    this.pauseUntil = 0;
    this.items = this.items.map(x => x.status === 'waiting' && x.ownerId === this.owner && x.nextAttemptAt > at ? { ...x, nextAttemptAt: at } : x);
    this.emit();
    return this.drain();
  }

  // "Try again" on a photo that failed: it goes back in the line with a fresh count.
  async retry(id: string) {
    await this.load();
    this.update(id, x => x.status === 'failed' ? { ...x, status: 'waiting', attempts: 0, nextAttemptAt: this.now(), error: undefined, waitReason: undefined } : x);
    await this.persist();
    return this.drain();
  }

  // "Remove": the photo is deleted from the device and never sent. A photo mid-upload can't be removed.
  async remove(id: string) {
    await this.load();
    const item = this.items.find(x => x.id === id);
    if (!item || item.status === 'uploading') return false;
    this.items = this.items.filter(x => x.id !== id);
    this.emit();
    await this.deps.discard(item).catch(() => undefined);
    await this.persist();
    return true;
  }

  // A screen that has used its uploaded photos lets them go.
  async release(ids: readonly string[]) {
    await this.load();
    const gone = this.items.filter(x => x.status === 'done' && ids.includes(x.id));
    if (!gone.length) return;
    this.items = this.items.filter(x => !gone.includes(x));
    this.emit();
    for (const item of gone) await this.deps.discard(item).catch(() => undefined);
    await this.persist();
  }

  pendingCount(owner = this.owner) { return this.items.filter(x => x.ownerId === owner && x.status !== 'done').length; }

  // Sends every photo that is due, one at a time, then sets a timer for the next one.
  drain(): Promise<void> {
    if (this.running) return this.running;
    this.clearTimer();
    this.running = (async () => {
      await this.load();
      for (let next = this.nextDue(); next; next = this.nextDue()) await this.attempt(next);
    })().finally(() => { this.running = null; this.schedule(); });
    return this.running;
  }

  private nextDue() {
    const at = this.now();
    if (!this.owner || at < this.pauseUntil || !(this.deps.online?.() ?? true)) return undefined;
    return this.items.filter(x => x.ownerId === this.owner && x.status === 'waiting' && x.nextAttemptAt <= at).sort((a, b) => a.createdAt - b.createdAt)[0];
  }

  private async attempt(item: QueuedUpload) {
    this.update(item.id, x => ({ ...x, status: 'uploading' }));
    let result: Partial<QueuedUpload>;
    try {
      const evidenceId = await this.deps.send(item);
      result = { status: 'done', evidenceId, finishedAt: this.now(), error: undefined, waitReason: undefined, attempts: item.attempts + 1 };
    } catch (error) {
      const outcome = classifyUploadError(error), at = this.now();
      if (outcome.kind === 'permanent') result = { status: 'failed', error: outcome.message, waitReason: undefined, attempts: item.attempts + 1 };
      else if (outcome.waitMs !== undefined) {
        // Too many uploads: the whole line waits as long as the server asked (the limit is per person).
        this.pauseUntil = at + outcome.waitMs;
        result = { status: 'waiting', waitReason: outcome.reason, nextAttemptAt: this.pauseUntil };
      } else {
        const attempts = item.attempts + 1;
        result = { status: 'waiting', waitReason: outcome.reason, attempts, nextAttemptAt: at + retryDelay(attempts, this.random) };
      }
    }
    this.update(item.id, x => ({ ...x, ...result }));
    await this.persist();
  }

  private schedule() {
    this.clearTimer();
    const set = this.deps.setTimer ?? ((run: () => void, ms: number) => setTimeout(run, ms));
    // Offline in the browser: the 'online' event wakes the line instead of a timer.
    if (!this.owner || !(this.deps.online?.() ?? true)) return;
    const waiting = this.items.filter(x => x.ownerId === this.owner && x.status === 'waiting');
    if (!waiting.length) return;
    const due = Math.max(this.pauseUntil, Math.min(...waiting.map(x => x.nextAttemptAt)));
    this.timer = set(() => { this.timer = null; void this.drain(); }, Math.max(250, due - this.now()));
  }
  private clearTimer() {
    if (this.timer === null) return;
    (this.deps.clearTimer ?? (t => clearTimeout(t as ReturnType<typeof setTimeout>)))(this.timer);
    this.timer = null;
  }
  private update(id: string, change: (item: QueuedUpload) => QueuedUpload) {
    this.items = this.items.map(x => x.id === id ? change(x) : x);
    this.emit();
  }
  private persist() {
    const value = serializeQueue(this.items);
    this.writing = this.writing.then(() => this.deps.storage.setItem(UPLOAD_QUEUE_KEY, value)).catch(() => undefined);
    return this.writing;
  }
  private emit() {
    this.snapshot = { owner: this.owner, items: this.items };
    for (const listener of this.listeners) listener();
  }
}
