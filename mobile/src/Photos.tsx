import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Image, Modal, Platform, Pressable, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { z } from "zod";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { Button, message, Notice, Tag } from "./LiveKit";
import { ui, type Palette } from "./theme";
import { photoSource, readWorkMedia, uploadWorkPhoto, WorkspaceApiError, type PhotoPurpose } from "./backend/client";

// Adding photos to a work item, and showing the photos already saved on it. Photos are checked and
// stored by the backend; this only sends them and shows what was saved.
type Pending = { key: string; uri: string; status: "uploading" | "verified" | "failed"; id?: string; error?: string; requestId: string; name: string; type: "image/jpeg" | "image/png" | "image/webp" };
const mediaSchema = z.array(z.object({ id: z.string().uuid(), purpose: z.string(), verifiedAt: z.string().optional() }));

export function PhotoPicker({ p, workId, expenseId, purpose, label = "Photos", hint, onChange, max = 20 }: { p: Palette; workId?: string; expenseId?: string; purpose: PhotoPurpose; label?: string; hint?: string; onChange: (ids: string[], uploading: boolean) => void; max?: number }) {
  const [photos, setPhotos] = useState<Pending[]>([]);
  const [error, setError] = useState("");
  // The latest callback is kept aside, so a parent re-rendering never triggers another report.
  const report = useRef(onChange);
  useEffect(() => { report.current = onChange; }, [onChange]);
  useEffect(() => { report.current(photos.filter(x => x.status === "verified" && x.id).map(x => x.id!), photos.some(x => x.status === "uploading")); }, [photos]);
  async function upload(photo: Pending) {
    setPhotos(current => current.map(x => x.key === photo.key ? { ...x, status: "uploading", error: undefined } : x));
    try {
      const response = z.object({ id: z.string().uuid() }).parse(await uploadWorkPhoto({ requestId: photo.requestId, workId, expenseId, purpose }, { uri: photo.uri, name: photo.name, type: photo.type }));
      setPhotos(current => current.map(x => x.key === photo.key ? { ...x, status: "verified", id: response.id } : x));
    } catch (e) {
      const text = e instanceof WorkspaceApiError && e.status === 503 ? "Photos can't be saved just now. Try again in a moment." : message(e);
      setPhotos(current => current.map(x => x.key === photo.key ? { ...x, status: "failed", error: text } : x));
    }
  }
  async function add(camera: boolean) {
    setError("");
    const permission = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError(camera ? "Allow camera access to take photos." : "Allow photo access to choose photos."); return; }
    const left = Math.max(0, max - photos.length);
    if (!left) { setError(`Up to ${max} photos.`); return; }
    // Photos are made smaller on the device before they are sent.
    const options = { mediaTypes: ["images"] as ImagePicker.MediaType[], quality: 0.6 };
    const result = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync({ ...options, allowsMultipleSelection: true, selectionLimit: left });
    if (result.canceled) return;
    for (const asset of result.assets.slice(0, left)) {
      const type = asset.mimeType === "image/png" || asset.mimeType === "image/webp" ? asset.mimeType : "image/jpeg";
      const requestId = Crypto.randomUUID();
      const photo: Pending = { key: requestId, uri: asset.uri, status: "uploading", requestId, name: asset.fileName || `${purpose}-${requestId.slice(0, 8)}.jpg`, type };
      setPhotos(current => [...current, photo]);
      void upload(photo);
    }
  }
  const failed = photos.find(x => x.status === "failed");
  return (
    <View style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>{label}</Text>
      {!!hint && <Text style={[ui.small, { color: p.muted }]}>{hint}</Text>}
      {!!photos.length && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {photos.map(photo => (
          <View key={photo.key} style={{ width: 88, gap: 4 }}>
            <Image source={{ uri: photo.uri }} style={{ width: 88, height: 88, borderRadius: 12, opacity: photo.status === "verified" ? 1 : 0.5 }} accessibilityLabel="Photo" />
            {photo.status === "uploading" && <ActivityIndicator size="small" color={p.primary} />}
            {photo.status === "verified" && <Tag label="Saved" tone="good" p={p} />}
            {photo.status === "failed" && <MotionPress accessibilityRole="button" accessibilityLabel="Retry this photo" onPress={() => void upload(photo)}><Tag label="Retry" tone="bad" p={p} /></MotionPress>}
          </View>
        ))}
      </View>}
      {!!(failed?.error || error) && <Notice text={failed?.error || error} p={p} tone="bad" />}
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

// A row of saved photos; tap one to see it large.
export function PhotoStrip({ p, ids, size = 72 }: { p: Palette; ids: string[]; size?: number }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!ids.length) return null;
  return (
    <>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{ids.map(id => <SavedPhoto key={id} id={id} size={size} p={p} onOpen={() => setOpen(id)} />)}</View>
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

const PURPOSE_LABEL: Record<string, string> = { cleaning: "Clean", mailbox: "Post", delivery: "Delivery", licence: "Licensing", maintenance: "Repair", inspection: "Inspection", setup: "From the owner", expense: "Invoice" };
// Every photo saved on a work item that this person may see, grouped by kind.
export function WorkPhotos({ p, workId, title = "Photos", refreshKey = 0 }: { p: Palette; workId: string; title?: string; refreshKey?: number }) {
  const [items, setItems] = useState<z.infer<typeof mediaSchema>>([]);
  useEffect(() => {
    let active = true;
    readWorkMedia(workId).then(r => { const parsed = mediaSchema.safeParse(r.data); if (active && parsed.success) setItems(parsed.data); }).catch(() => undefined);
    return () => { active = false; };
  }, [workId, refreshKey]);
  if (!items.length) return null;
  const groups = [...new Set(items.map(x => x.purpose))];
  return (
    <View style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>{title}</Text>
      {groups.map(g => (
        <View key={g} style={{ gap: 6 }}>
          {groups.length > 1 && <Text style={[ui.small, { color: p.muted, fontWeight: "700" }]}>{PURPOSE_LABEL[g] ?? g}</Text>}
          <PhotoStrip p={p} ids={items.filter(x => x.purpose === g).map(x => x.id)} />
        </View>
      ))}
    </View>
  );
}
