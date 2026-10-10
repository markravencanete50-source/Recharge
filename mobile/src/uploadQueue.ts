import { useEffect, useState, useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import { z } from "zod";
import { PermanentUploadError, UploadQueue, type QueuedUpload } from "../../lib/upload-queue";
import { uploadWorkPhoto, viewMode, type PhotoPurpose } from "./backend/client";
import { VIEW_ONLY_ERROR } from "../../lib/view-as";
import { deletePhoto, photoUri, savePhoto } from "./uploadStore";

// The app's one line of photos waiting to upload (see lib/upload-queue.ts). Photos are saved on
// the device first and sent in the background, so nobody has to wait on the screen they took them on.
// It runs while the app is open: on start, every time the app comes back to the front, when the
// browser comes back online, on "Retry now", and on a timer that backs off to every 5 minutes.
const browserOnline = () => Platform.OS !== "web" || typeof navigator === "undefined" || navigator.onLine !== false;

export const uploads = new UploadQueue({
  storage: { getItem: key => AsyncStorage.getItem(key), setItem: (key, value) => AsyncStorage.setItem(key, value) },
  async send(item) {
    const uri = await photoUri(item.file);
    if (!uri) throw new PermanentUploadError("This photo is no longer on this device.");
    const response = await uploadWorkPhoto({ requestId: item.id, workId: item.workId, expenseId: item.expenseId, purpose: item.purpose as PhotoPurpose, checklistItem: item.checklistItem }, { uri, name: item.name, type: item.type });
    return z.object({ id: z.string().uuid() }).parse(response).id;
  },
  discard: item => deletePhoto(item.file),
  online: browserOnline,
});

export const isOffline = () => !browserOnline();
export const pendingUploadCount = () => uploads.pendingCount();

// Keeps a picked or taken photo on the device and puts it in the line. Never fails because of the
// connection; it only fails if nobody is signed in.
export async function queuePhoto(input: { workId?: string; expenseId?: string; purpose: PhotoPurpose; label: string; checklistItem?: string; uri: string; name: string; type: QueuedUpload["type"]; file?: Blob }) {
  const ownerId = uploads.currentOwner();
  if (!ownerId) throw new Error("Sign in again to add photos.");
  // While a super admin views as someone nothing is saved; a photo kept now would upload as them once the view ends.
  if (viewMode().readOnly) throw new Error(VIEW_ONLY_ERROR);
  const id = Crypto.randomUUID();
  const file = await savePhoto(id, { uri: input.uri, type: input.type, file: input.file });
  return uploads.enqueue({ id, ownerId, workId: input.workId, expenseId: input.expenseId, purpose: input.purpose, label: input.label, checklistItem: input.checklistItem, name: input.name, type: input.type, file });
}

export function useUploads() {
  return useSyncExternalStore(uploads.subscribe, uploads.getSnapshot, uploads.getSnapshot);
}

// Started by the workspace shell for the signed-in person, and stopped when they sign out.
export function useUploadRunner(userId: string) {
  useEffect(() => {
    uploads.setOwner(userId);
    void uploads.retryNow();
    const appState = AppState.addEventListener("change", state => { if (state === "active") void uploads.retryNow(); });
    const online = () => void uploads.retryNow();
    if (Platform.OS === "web" && typeof window !== "undefined") window.addEventListener("online", online);
    return () => {
      appState.remove();
      if (Platform.OS === "web" && typeof window !== "undefined") window.removeEventListener("online", online);
      uploads.setOwner(null);
    };
  }, [userId]);
}

// Where to show a photo that is still on the device.
export function useLocalPhoto(file: string) {
  const [uri, setUri] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    photoUri(file).then(value => { if (active) setUri(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [file]);
  return uri;
}
