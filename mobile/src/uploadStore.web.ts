// Browser: a photo waiting to upload is kept in this browser's IndexedDB, under its upload key,
// until it has uploaded. If IndexedDB is unavailable (some private windows), the photo is kept
// for this visit only.
const DB = "recharge-uploads", STORE = "photos";
const memory = new Map<string, Blob>();
const urls = new Map<string, string>();
let opening: Promise<IDBDatabase | null> | null = null;

function database() {
  opening ??= new Promise<IDBDatabase | null>(resolve => {
    try {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return opening;
}
async function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  const db = await database();
  if (!db) throw new Error("IndexedDB unavailable");
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode), request = action(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
function urlFor(file: string, blob: Blob) {
  let url = urls.get(file);
  if (!url) { url = URL.createObjectURL(blob); urls.set(file, url); }
  return url;
}

export async function savePhoto(id: string, source: { uri: string; type: string; file?: Blob }) {
  const blob = source.file ?? await (await fetch(source.uri)).blob();
  const typed = blob.type ? blob : new Blob([blob], { type: source.type });
  try {
    await run("readwrite", store => store.put(typed, id));
    urlFor(id, typed);
    return id;
  } catch {
    const key = "memory:" + id;
    memory.set(key, typed); urlFor(key, typed);
    return key;
  }
}

export async function photoUri(file: string) {
  const known = urls.get(file);
  if (known) return known;
  try {
    const blob = memory.get(file) ?? await run<Blob | undefined>("readonly", store => store.get(file) as IDBRequest<Blob | undefined>);
    return blob ? urlFor(file, blob) : null;
  } catch { return null; }
}

export async function deletePhoto(file: string) {
  const url = urls.get(file);
  if (url) { URL.revokeObjectURL(url); urls.delete(file); }
  memory.delete(file);
  if (!file.startsWith("memory:")) await run("readwrite", store => store.delete(file)).catch(() => undefined);
}
