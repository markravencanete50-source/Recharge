import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Image, Modal, Platform, Pressable, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as ImagePicker from "expo-image-picker";
import { z } from "zod";
import { Text } from "./Typography";
import { Button, message, Notice } from "./LiveKit";
import { ui, type Palette } from "./theme";
import { photoSource, readWorkMedia, type PhotoPurpose } from "./backend/client";
import { inSlot } from "../../lib/upload-queue";
import { isOffline, queuePhoto, uploads, useUploads } from "./uploadQueue";
import { PURPOSE_LABEL, QueuedPhoto } from "./UploadStatus";

// Adding photos to a work item, and showing the photos already saved on it. Each photo is kept on
// this device the moment it is taken and uploads in the background (uploadQueue.ts), so no signal
// is no problem. Photos are checked and stored by the backend; this only queues them and shows them.
const mediaSchema = z.array(z.object({ id: z.string().uuid(), purpose: z.string(), verifiedAt: z.string().optional(), format: z.string().nullable().optional() }));
// A contractor's quote or invoice can be a PDF: it is shown as a file (RepairContractors RepairFileList), never in a photo strip.
const photosOnly = <T extends { format?: string | null }>(items: T[]) => items.filter(x => x.format !== "pdf");
const EXTENSION = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;

export function PhotoPicker({ p, workId, expenseId, purpose, label = "Photos", hint, onChange, max = 20 }: { p: Palette; workId?: string; expenseId?: string; purpose: PhotoPurpose; label?: string; hint?: string; onChange: (ids: string[], uploading: boolean) => void; max?: number }) {
  const { owner, items } = useUploads();
  const [error, setError] = useState("");
  // This picker's photos: the same person, item, kind and label, including any still waiting from earlier.
  const photos = useMemo(() => owner ? items.filter(x => inSlot(x, { ownerId: owner, workId, expenseId, purpose, label })) : [], [items, owner, workId, expenseId, purpose, label]);
  const ids = photos.filter(x => x.status === "done" && x.evidenceId).map(x => x.evidenceId!).join(), uploading = photos.some(x => x.status === "waiting" || x.status === "uploading");
  // The latest callback is kept aside, so a parent re-rendering never triggers another report.
  const report = useRef(onChange);
  useEffect(() => { report.current = onChange; }, [onChange]);
  useEffect(() => { report.current(ids ? ids.split(",") : [], uploading); }, [ids, uploading]);
  // Uploaded photos shown here are let go when the picker closes; photos still waiting carry on.
  const shown = useRef(new Set<string>());
  useEffect(() => { for (const x of photos) if (x.status === "done") shown.current.add(x.id); }, [photos]);
  useEffect(() => { const held = shown.current; return () => { void uploads.release([...held]); }; }, []);
  async function add(camera: boolean) {
    setError("");
    const permission = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError(camera ? "Allow camera access to take photos." : "Allow photo access to choose photos."); return; }
    const left = Math.max(0, max - photos.length);
    if (!left) { setError(`Up to ${max} photos.`); return; }
    // Photos are made smaller on the device before they are kept and sent.
    const options = { mediaTypes: ["images"] as ImagePicker.MediaType[], quality: 0.6 };
    const result = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync({ ...options, allowsMultipleSelection: true, selectionLimit: left });
    if (result.canceled) return;
    for (const asset of result.assets.slice(0, left)) {
      const type = asset.mimeType === "image/png" || asset.mimeType === "image/webp" ? asset.mimeType : "image/jpeg";
      try { await queuePhoto({ workId, expenseId, purpose, label, uri: asset.uri, name: asset.fileName || `${purpose}.${EXTENSION[type]}`, type, file: asset.file }); }
      catch (e) { setError(message(e)); }
    }
  }
  const failed = photos.find(x => x.status === "failed");
  const waiting = photos.filter(x => x.status === "waiting");
  // Taken with no signal: say where the photo is, never an error.
  const saved = !waiting.length ? "" : isOffline() || waiting.some(x => x.waitReason === "connection") ? "Saved on this device. It will upload when you're back online." : waiting.some(x => x.waitReason === "busy") ? "Saved on this device. It will upload in a minute." : "";
  return (
    <View style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>{label}</Text>
      {!!hint && <Text style={[ui.small, { color: p.muted }]}>{hint}</Text>}
      {!!photos.length && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {photos.map(photo => <QueuedPhoto key={photo.id} p={p} item={photo} size={88} />)}
      </View>}
      {!!saved && <Notice text={saved} p={p} />}
      {!!(error || failed?.error) && <Notice text={error || failed?.error || ""} p={p} tone="bad" />}
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {Platform.OS !== "web" && <Button label="Take photo" icon="camera" p={p} onPress={() => void add(true)} />}
        <Button label={photos.length ? "Add more" : "Choose photos"} icon="image" p={p} onPress={() => void add(false)} />
      </View>
    </View>
  );
}

function SavedPhoto({ id, size, p, onOpen }: { id: string; size: number; p: Palette; onOpen?: () => void }) {
  const [source, setSource] = useState<{ uri: string; headers?: Record<string, string> } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { let active = true; photoSource(id).then(s => { if (active) setSource(s); }).catch(() => { if (active) setFailed(true); }); return () => { active = false; }; }, [id]);
  const box = { width: size, height: size, borderRadius: 12, backgroundColor: p.wash, alignItems: "center" as const, justifyContent: "center" as const, overflow: "hidden" as const };
  if (failed) return <View style={box}><Feather name="image" size={20} color={p.muted} /></View>;
  if (!source) return <View style={box}><ActivityIndicator size="small" color={p.primary} /></View>;
  const image = <Image source={source} onError={() => setFailed(true)} style={{ width: size, height: size }} resizeMode="cover" accessibilityLabel="Saved photo" />;
  return onOpen ? <Pressable accessibilityRole="imagebutton" accessibilityLabel="Open photo" onPress={onOpen} style={box}>{image}</Pressable> : <View style={box}>{image}</View>;
}

// A row of saved photos; tap one to see it large. `extra` adds photos still on this device to the row.
export function PhotoStrip({ p, ids, size = 72, extra }: { p: Palette; ids: string[]; size?: number; extra?: ReactNode }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!ids.length && !extra) return null;
  return (
    <>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, alignItems: "flex-start" }}>{ids.map(id => <SavedPhoto key={id} id={id} size={size} p={p} onOpen={() => setOpen(id)} />)}{extra}</View>
      <Modal visible={!!open} transparent animationType="fade" onRequestClose={() => setOpen(null)}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close photo" onPress={() => setOpen(null)} style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.88)", alignItems: "center", justifyContent: "center", padding: 16 }}>
          {open && <LargePhoto id={open} />}
          <Text style={{ color: "#FFFFFF", marginTop: 14, fontWeight: "600" }}>Tap to close</Text>
        </Pressable>
      </Modal>
    </>
  );
}
function LargePhoto({ id }: { id: string }) {
  const [source, setSource] = useState<{ uri: string; headers?: Record<string, string> } | null>(null);
  useEffect(() => { let active = true; photoSource(id).then(s => { if (active) setSource(s); }).catch(() => undefined); return () => { active = false; }; }, [id]);
  return source ? <Image source={source} style={{ width: "100%", maxWidth: 900, aspectRatio: 1 }} resizeMode="contain" accessibilityLabel="Photo" /> : <ActivityIndicator color="#FFFFFF" />;
}

// Every photo saved on a work item that this person may see, grouped by kind, followed by this
// person's photos for it that are still waiting on this device (`queued={false}` leaves those to a
// PhotoPicker on the same screen).
export function WorkPhotos({ p, workId, title = "Photos", refreshKey = 0, queued = true }: { p: Palette; workId: string; title?: string; refreshKey?: number; queued?: boolean }) {
  const [items, setItems] = useState<z.infer<typeof mediaSchema>>([]);
  const { owner, items: line } = useUploads();
  const mine = queued && owner ? line.filter(x => x.ownerId === owner && x.workId === workId) : [];
  const local = mine.filter(x => x.status !== "done");
  // Each photo that finishes uploading reloads the list, so it appears among the saved ones.
  const uploaded = mine.filter(x => x.status === "done").map(x => x.id).join();
  useEffect(() => {
    let active = true;
    readWorkMedia(workId).then(r => { const parsed = mediaSchema.safeParse(r.data); if (active && parsed.success) setItems(photosOnly(parsed.data)); }).catch(() => undefined);
    return () => { active = false; };
  }, [workId, refreshKey, uploaded]);
  if (!items.length && !local.length) return null;
  const groups = [...new Set([...items.map(x => x.purpose), ...local.map(x => x.purpose)])];
  return (
    <View style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>{title}</Text>
      {groups.map(g => {
        const waiting = local.filter(x => x.purpose === g);
        return (
          <View key={g} style={{ gap: 6 }}>
            {groups.length > 1 && <Text style={[ui.small, { color: p.muted, fontWeight: "700" }]}>{PURPOSE_LABEL[g] ?? g}</Text>}
            <PhotoStrip p={p} ids={items.filter(x => x.purpose === g).map(x => x.id)} extra={waiting.length ? waiting.map(x => <QueuedPhoto key={x.id} p={p} item={x} size={72} />) : undefined} />
          </View>
        );
      })}
      {local.some(x => x.status === "failed") && <Notice text={local.find(x => x.status === "failed")?.error ?? ""} p={p} tone="bad" />}
    </View>
  );
}
