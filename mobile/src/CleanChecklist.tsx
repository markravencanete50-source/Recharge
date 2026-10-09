import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Platform, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { z } from "zod";
import { Text } from "./Typography";
import { GrowBar, MotionPress } from "./motion";
import { message, Notice, Tag } from "./LiveKit";
import { PhotoStrip } from "./Photos";
import { ui, type Palette } from "./theme";
import { readChecklists, readWorkMedia, uploadWorkPhoto, WorkspaceApiError } from "./backend/client";
import { checklistProgress, cleanRulesSchema, progressCounter, type ChecklistProgress, type PhotoRule } from "../../lib/clean-checklist-policy";
import { plural } from "../../lib/format";

// The checklist on an open clean. Checks that need photos carry a camera button; the photos taken
// there belong to that check, and a sticky counter says how much is left. The database refuses
// the clean while any check is short of photos, so this only helps the cleaner get there first.
type Pending = { key: string; label: string; uri: string; status: "uploading" | "verified" | "failed"; id?: string; error?: string; requestId: string; name: string; type: "image/jpeg" | "image/png" | "image/webp" };
const mediaSchema = z.array(z.object({ id: z.string().uuid(), purpose: z.string(), checklistItem: z.string().nullable().optional() }));
export type ChecklistState = { progress: ChecklistProgress; photoIds: string[]; uploading: boolean };

// The photo rules on a clean and the photos already saved for each check (after reopening it).
function useItemPhotos(workId: string) {
  const [rules, setRules] = useState<PhotoRule[]>([]);
  const [saved, setSaved] = useState<{ id: string; label: string }[]>([]);
  useEffect(() => {
    let active = true;
    readChecklists({ section: "clean", workId }).then(r => { const parsed = cleanRulesSchema.safeParse(r.data); if (active && parsed.success) setRules(parsed.data.rules); }).catch(() => undefined);
    readWorkMedia(workId).then(r => {
      const parsed = mediaSchema.safeParse(r.data);
      if (active && parsed.success) setSaved(parsed.data.filter(x => x.purpose === "cleaning" && x.checklistItem).map(x => ({ id: x.id, label: x.checklistItem! })));
    }).catch(() => undefined);
    return () => { active = false; };
  }, [workId]);
  return { rules, saved };
}

export function CleanChecklist({ p, workId, checklist, ticked, onToggle, onState }: { p: Palette; workId: string; checklist: string[]; ticked: string[]; onToggle: (item: string) => void; onState: (state: ChecklistState) => void }) {
  const { rules, saved } = useItemPhotos(workId);
  const [pending, setPending] = useState<Pending[]>([]);
  const [error, setError] = useState("");
  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const x of [...saved, ...pending.filter(x => x.status === "verified" && x.id && !saved.some(s => s.id === x.id))]) out[x.label] = (out[x.label] ?? 0) + 1;
    return out;
  }, [saved, pending]);
  const progress = useMemo(() => checklistProgress(checklist, ticked, rules, counts), [checklist, ticked, rules, counts]);
  const photoIds = useMemo(() => [...new Set([...saved.map(x => x.id), ...pending.filter(x => x.status === "verified" && x.id).map(x => x.id!)])], [saved, pending]);
  const uploading = pending.some(x => x.status === "uploading");
  // The latest callback is kept aside, so a parent re-rendering never triggers another report.
  const report = useRef(onState);
  useEffect(() => { report.current = onState; }, [onState]);
  useEffect(() => { report.current({ progress, photoIds, uploading }); }, [progress, photoIds, uploading]);

  const upload = useCallback(async (photo: Pending) => {
    setPending(current => current.map(x => x.key === photo.key ? { ...x, status: "uploading", error: undefined } : x));
    try {
      const response = z.object({ id: z.string().uuid() }).parse(await uploadWorkPhoto({ requestId: photo.requestId, workId, purpose: "cleaning", checklistItem: photo.label }, { uri: photo.uri, name: photo.name, type: photo.type }));
      setPending(current => current.map(x => x.key === photo.key ? { ...x, status: "verified", id: response.id } : x));
    } catch (e) {
      const text = e instanceof WorkspaceApiError && e.status === 503 ? "Photos can't be saved just now. Try again in a moment." : message(e);
      setPending(current => current.map(x => x.key === photo.key ? { ...x, status: "failed", error: text } : x));
    }
  }, [workId]);
  async function add(label: string, camera: boolean) {
    setError("");
    const permission = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError(camera ? "Allow camera access to take photos of the clean." : "Allow photo access to choose photos of the clean."); return; }
    const options = { mediaTypes: ["images"] as ImagePicker.MediaType[], quality: 0.6 };
    const result = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync({ ...options, allowsMultipleSelection: true, selectionLimit: 5 });
    if (result.canceled) return;
    for (const asset of result.assets.slice(0, 5)) {
      const type = asset.mimeType === "image/png" || asset.mimeType === "image/webp" ? asset.mimeType : "image/jpeg";
      const requestId = Crypto.randomUUID();
      const photo: Pending = { key: requestId, label, uri: asset.uri, status: "uploading", requestId, name: asset.fileName || `check-${requestId.slice(0, 8)}.jpg`, type };
      setPending(current => [...current, photo]);
      void upload(photo);
    }
    // Taking the photo is doing the check, so it is ticked too.
    if (!ticked.includes(label)) onToggle(label);
  }

  const rule = new Map(rules.map(r => [r.label, r.minPhotos]));
  const failed = pending.find(x => x.status === "failed");
  const share = progress.total ? progress.done / progress.total : 0;
  return (
    <View style={{ gap: 8 }}>
      {/* The counter stays at the top of the sheet while the list scrolls under it (web). */}
      <View style={[{ gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border, zIndex: 1 }, Platform.OS === "web" ? ({ position: "sticky", top: 0 } as object) : null]}>
        <View style={[ui.between, { gap: 8 }]}>
          <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>Checklist</Text>
          <Text accessibilityLiveRegion="polite" style={[ui.small, { color: progress.photosNeeded ? p.waiting : p.muted, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{progressCounter(progress)}</Text>
        </View>
        <GrowBar share={share} color={progress.done === progress.total && !progress.photosNeeded ? p.success : p.primary} track={p.wash} height={6} />
      </View>
      {checklist.map(item => {
        const on = ticked.includes(item), need = rule.get(item) ?? 0, have = counts[item] ?? 0, short = need > 0 && have < need;
        const mine = pending.filter(x => x.label === item), stored = saved.filter(x => x.label === item).map(x => x.id);
        return (
          <View key={item} style={{ gap: 8, padding: 6, borderRadius: 14, borderWidth: 1, borderColor: short ? p.waiting : "transparent", backgroundColor: short ? p.cautionWash : on ? p.successWash : p.elevated }}>
            <View style={[ui.row, { gap: 8 }]}>
              <MotionPress accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={item + (need ? `, ${plural(need, "photo")} needed, ${have} taken` : "")} onPress={() => onToggle(item)} style={[ui.row, { gap: 12, minHeight: 44, paddingHorizontal: 6, flex: 1, minWidth: 0 }]}>
                <Feather name={on ? "check-square" : "square"} size={20} color={on ? p.success : p.muted} />
                <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                  <Text style={{ color: p.text }}>{item}</Text>
                  {need > 0 && <Text style={[ui.small, { color: short ? p.waiting : p.success, fontWeight: "600" }]}>{short ? `Photo needed · ${have} of ${need}` : `${plural(have, "photo")} added`}</Text>}
                </View>
              </MotionPress>
              {need > 0 && <>
                {Platform.OS !== "web" && <MotionPress accessibilityRole="button" accessibilityLabel={`Take a photo for ${item}`} onPress={() => void add(item, true)} style={{ width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: short ? p.primary : p.wash }}>
                  <Feather name="camera" size={18} color={short ? p.onPrimary : p.primary} />
                </MotionPress>}
                <MotionPress accessibilityRole="button" accessibilityLabel={`Choose a photo for ${item}`} onPress={() => void add(item, false)} style={{ width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: short && Platform.OS === "web" ? p.primary : p.wash }}>
                  <Feather name={Platform.OS === "web" ? "camera" : "image"} size={18} color={short && Platform.OS === "web" ? p.onPrimary : p.primary} />
                </MotionPress>
              </>}
            </View>
            {(!!stored.length || !!mine.length) && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 6, paddingBottom: 4 }}>
              <PhotoStrip p={p} ids={stored} size={56} />
              {mine.map(photo => (
                <View key={photo.key} style={{ width: 56, gap: 4 }}>
                  <Image source={{ uri: photo.uri }} style={{ width: 56, height: 56, borderRadius: 10, opacity: photo.status === "verified" ? 1 : 0.5 }} accessibilityLabel={`Photo for ${item}`} />
                  {photo.status === "uploading" && <ActivityIndicator size="small" color={p.primary} />}
                  {photo.status === "failed" && <MotionPress accessibilityRole="button" accessibilityLabel="Retry this photo" onPress={() => void upload(photo)}><Tag label="Retry" tone="bad" p={p} /></MotionPress>}
                </View>
              ))}
            </View>}
          </View>
        );
      })}
      {!!(failed?.error || error) && <Notice text={failed?.error || error} p={p} tone="bad" />}
    </View>
  );
}

// For the cleaning manager reviewing a clean: each check with the photos taken for it, then the
// other photos from the clean.
export function ChecklistReview({ p, workId, checklist }: { p: Palette; workId: string; checklist: string[] }) {
  const [items, setItems] = useState<z.infer<typeof mediaSchema>>([]);
  const [rules, setRules] = useState<PhotoRule[]>([]);
  useEffect(() => {
    let active = true;
    readWorkMedia(workId).then(r => { const parsed = mediaSchema.safeParse(r.data); if (active && parsed.success) setItems(parsed.data); }).catch(() => undefined);
    readChecklists({ section: "clean", workId }).then(r => { const parsed = cleanRulesSchema.safeParse(r.data); if (active && parsed.success) setRules(parsed.data.rules); }).catch(() => undefined);
    return () => { active = false; };
  }, [workId]);
  const rule = new Map(rules.map(r => [r.label, r.minPhotos]));
  const other = items.filter(x => !x.checklistItem || !checklist.includes(x.checklistItem));
  return (
    <View style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>Checklist and photos</Text>
      {checklist.map(item => {
        const ids = items.filter(x => x.checklistItem === item).map(x => x.id), need = rule.get(item) ?? 0;
        return (
          <View key={item} style={{ gap: 6, padding: 10, borderRadius: 14, backgroundColor: p.elevated }}>
            <View style={[ui.row, { gap: 8 }]}>
              <Feather name="check-square" size={16} color={p.success} />
              <Text style={{ color: p.text, flex: 1, minWidth: 0 }}>{item}</Text>
              {need > 0 && <Tag label={ids.length >= need ? plural(ids.length, "photo") : `${ids.length} of ${need} photos`} tone={ids.length >= need ? "good" : "bad"} p={p} />}
            </View>
            <PhotoStrip p={p} ids={ids} size={64} />
          </View>
        );
      })}
      {!!other.length && <>
        <Text style={[ui.small, { color: p.muted, fontWeight: "700" }]}>Other photos from the clean</Text>
        <PhotoStrip p={p} ids={other.map(x => x.id)} />
      </>}
    </View>
  );
}
