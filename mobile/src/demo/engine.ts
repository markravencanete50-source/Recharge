// The interactive demo, seen from the app: starts the demo backend (scripts/demo/browser/engine.mjs,
// built into /workspace/demo/ by scripts/demo/build-browser-demo.mjs) in a Web Worker and talks to it.
// The worker runs the repo's own routes and database functions against a private copy of the sample
// business kept in this browser. Nothing here is loaded until a super admin switches Demo on, and
// nothing it does reaches the live backend.
import { Platform } from "react-native";
import { emitDemoNotes } from "./notes";

export type DemoPersona = { personId: string; account: unknown };
export type DemoOpened = {
  first: boolean; restarted: boolean; shifted: number; seededOn: string; createdAt: string;
  timings: Record<string, number>; personas: Record<string, DemoPersona>;
};
export type DemoReply = { status: number; headers: Record<string, string>; body: ArrayBuffer; notes: string[] };
export type DemoJobs = { results: { job: string; ok: boolean; error: string | null; delivered?: unknown }[]; notes: string[] };
type Body = { json: unknown } | { form: [string, string | Blob][] } | undefined;

export const DEMO_ASSETS = "/workspace/demo/";
// The sample people's ids (scripts/demo/db-core.mjs): never a real account's.
export const isDemoPerson = (userId: string) => userId.startsWith("d0000000-0000-4000-8000-");
// Whether this device can run the demo backend: the browser app with WebAssembly, workers and IndexedDB.
export function demoEngineSupported() {
  return Platform.OS === "web" && typeof WebAssembly === "object" && typeof Worker === "function" && typeof indexedDB === "object" && !!globalThis.location;
}

export class DemoEngine {
  private worker: Worker;
  private next = 1;
  private waiting = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error & { status?: number }) => void }>();
  private constructor(worker: Worker) {
    this.worker = worker;
    worker.onmessage = event => {
      const { id, ok, value, error } = event.data ?? {};
      const pending = this.waiting.get(id);
      if (!pending) return;
      this.waiting.delete(id);
      if (ok) pending.resolve(value);
      else pending.reject(Object.assign(new Error(error?.message ?? "The demo couldn't answer."), { status: error?.status ?? 500 }));
    };
    worker.onerror = event => { for (const pending of this.waiting.values()) pending.reject(new Error(event.message || "The demo stopped.")); this.waiting.clear(); };
  }
  private send<T>(type: string, input: Record<string, unknown> = {}): Promise<T> {
    const id = this.next++;
    return new Promise<T>((resolve, reject) => { this.waiting.set(id, { resolve: resolve as (value: unknown) => void, reject }); this.worker.postMessage({ id, type, ...input }); });
  }
  // Starts the worker (its file name comes from the build's manifest) and opens the private copy.
  static async start(): Promise<{ engine: DemoEngine; opened: DemoOpened }> {
    const manifest = await fetch(DEMO_ASSETS + "manifest.json", { credentials: "omit", cache: "no-cache" });
    if (!manifest.ok) throw new Error("The demo isn't part of this build.");
    const { files } = await manifest.json() as { files: { engine: string } };
    const engine = new DemoEngine(new Worker(DEMO_ASSETS + files.engine, { type: "module", name: "recharge-demo" }));
    // A first open downloads about 8 MB; a browser that can't finish in two minutes gets the recording.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("The demo took too long to open.")), 120_000); });
    try { return { engine, opened: await Promise.race([engine.send<DemoOpened>("open", { assets: DEMO_ASSETS }), late]) }; }
    catch (error) { engine.stop(); throw error; }
    finally { clearTimeout(timer); }
  }
  // One request to a /api/workspace route, answered as the sample person.
  async request(personId: string, method: "GET" | "POST", path: string, body?: unknown): Promise<Response> {
    let wire: Body;
    if (typeof FormData !== "undefined" && body instanceof FormData) {
      const form: [string, string | Blob][] = [];
      body.forEach((value, key) => form.push([key, value]));
      wire = { form };
    } else if (body !== undefined) wire = { json: body };
    const reply = await this.send<DemoReply>("request", { personId, method, path, body: wire });
    if (reply.notes.length) emitDemoNotes(reply.notes);
    // A redirect (a profile photo) is answered with where it points, as fetch's "manual" mode would not.
    return new Response(reply.status === 204 || reply.status === 304 || (reply.status >= 300 && reply.status < 400) ? null : reply.body, { status: reply.status >= 300 && reply.status < 400 ? 200 : reply.status, headers: { ...reply.headers, ...(reply.status >= 300 && reply.status < 400 ? { "x-demo-location": reply.headers.location ?? "" } : {}) } });
  }
  async jobs() { const done = await this.send<DemoJobs>("jobs"); if (done.notes.length) emitDemoNotes(done.notes); return done; }
  // "Reset demo": stops the worker (closing its databases) and deletes this browser's copy and files.
  // The next open starts again from the snapshot. The names are the worker's (IDB_DATA, META_DB).
  async reset() {
    this.stop();
    const remove = (name: string) => new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error ?? new Error("The demo copy could not be removed."));
      request.onblocked = () => setTimeout(() => resolve(), 2000);
    });
    await Promise.all([remove("/pglite/recharge-demo"), remove("recharge-demo-meta")]);
  }
  put(url: string, blob: Blob) { return this.send<{ ok: true }>("put", { url, blob }); }
  stop() { this.worker.terminate(); for (const pending of this.waiting.values()) pending.reject(new Error("The demo was closed.")); this.waiting.clear(); }
}
