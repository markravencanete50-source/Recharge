import { Directory, File, Paths } from "expo-file-system";

// Phone app: a photo waiting to upload is copied into the app's own documents folder, which the
// system does not clear (the camera's copy sits in a cache that can be). Only the file name is
// kept, because the documents folder's full path can change when the app is updated.
const folder = () => new Directory(Paths.document, "pending-photos");
const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
const isPath = (file: string) => file.includes("://");

export async function savePhoto(id: string, source: { uri: string; type: keyof typeof extension; file?: Blob }) {
  try {
    const dir = folder();
    dir.create({ idempotent: true, intermediates: true });
    const name = `${id}.${extension[source.type]}`;
    await new File(source.uri).copy(new File(dir, name), { overwrite: true });
    return name;
  } catch {
    // Copying failed (for example the phone is full): fall back to the camera's own copy.
    return source.uri;
  }
}

export async function photoUri(file: string) {
  const target = isPath(file) ? new File(file) : new File(folder(), file);
  try { return target.exists ? target.uri : null; } catch { return null; }
}

export async function deletePhoto(file: string) {
  if (isPath(file)) return;
  try { const target = new File(folder(), file); if (target.exists) target.delete(); } catch { /* already gone */ }
}
