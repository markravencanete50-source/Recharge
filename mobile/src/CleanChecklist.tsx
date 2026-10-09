import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as ImagePicker from "expo-image-picker";
import { z } from "zod";
import { Text } from "./Typography";
import { GrowBar, MotionPress } from "./motion";
import { message, Notice, Tag } from "./LiveKit";
import { PhotoStrip } from "./Photos";
import { QueuedPhoto } from "./UploadStatus";
import { ui, type Palette } from "./theme";
import { readChecklists, readWorkMedia } from "./backend/client";
import { isOffline, queuePhoto, uploads, useUploads } from "./uploadQueue";
import { checklistProgress, cleanRulesSchema, progressCounter, type ChecklistProgress, type PhotoRule } from "../../lib/clean-checklist-policy";
import { plural } from "../../lib/format";

// The checklist on an open clean. Checks that need photos carry a camera button; the photos taken
// there belong to that check, and a sticky counter says how much is left. The database refuses
// the clean while any check is short of photos, so this only helps the cleaner get there first.
// Photos are kept on the device and upload in the background with their check (uploadQueue.ts).
const mediaSchema = z.array(z.object({ id: z.string().uuid(), purpose: z.string(), checklistItem: z.string().nullable().optional() }));
const SLOT = "Checklist";
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
  const { owner, items } = useUploads();
  // This clean's checklist photos in the upload line, including any still waiting from earlier.
  const pending = useMemo(() => owner ? items.filter(x => x.ownerId === owner && x.workId === workId && x.purpose === "cleaning" && x.label === SLOT && x.checklistItem) : [], [items, owner, workId]);
  const [error, setError] = useState("");
  const uploaded = useMemo(() => pending.filter(x => x.status === "done" && x.evidenceId && !saved.some(s => s.id === x.evidenceId)).map(x => ({ id: x.evidenceId!, label: x.checklistItem! })), [pending, saved]);
  const counts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const x of [...saved, ...uploaded]) out[x.label] = (out[x.label] ?? 0) + 1;
    return out;
  }, [saved, uploaded]);
  const progress = useMemo(() => checklistProgress(checklist, ticked, rules, counts), [checklist, ticked, rules, counts]);
  const photoIds = useMemo(() => [...new Set([...saved, ...uploaded].map(x => x.id))], [saved, uploaded]);
  const uploading = pending.some(x => x.status === "waiting" || x.status === "uploading");
  // The latest callback is kept aside, so a parent re-rendering never triggers another report.
  const report = useRef(onState);
  useEffect(() => { report.current = onState; }, [onState]);
  useEffect(() => { report.current({ progress, photoIds, uploading }); }, [progress, photoIds, uploading]);
  // Uploaded photos shown here are let go when the clean closes; photos still waiting carry on.
  const shown = useRef(new Set<string>());
  useEffect(() => { for (const x of pending) if (x.status === "done") shown.current.add(x.id); }, [pending]);
  useEffect(() => { const held = shown.current; return () => { void uploads.release([...held]); }; }, []);

  async function add(label: string, camera: boolean) {
    setError("");
    const permission = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError(camera ? "Allow camera access to take photos of the clean." : "Allow photo access to choose photos of the clean."); return; }
    const options = { mediaTypes: ["images"] as ImagePicker.MediaType[], quality: 0.6 };
    const result = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync({ ...options, allowsMultipleSelection: true, selectionLimit: 5 });
    if (result.canceled) return;
    for (const asset of result.assets.slice(0, 5)) {
      const type = asset.mimeType === "image/png" || asset.mimeType === "image/webp" ? asset.mimeType : "image/jpeg";
      try { await queuePhoto({ workId, purpose: "cleaning", label: SLOT, checklistItem: label, uri: asset.uri, name: asset.fileName || `check.${type === "image/jpeg" ? "jpg" : type.slice(6)}`, type, file: asset.file }); }
      catch (e) { setError(message(e)); }
    }
    // Taking the photo is doing the check, so it is ticked too.
    if (!ticked.includes(label)) onToggle(label);
  }

  const rule = new Map(rules.map(r => [r.label, r.minPhotos]));
  const failed = pending.find(x => x.status === "failed");
  // Taken with no signal: say where the photos are, never an error.
  const waiting = pending.some(x => x.status === "waiting" && (x.waitReason === "connection" || isOffline()));
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
        const mine = pending.filter(x => x.checklistItem === item && !(x.status === "done" && saved.some(s => s.id === x.evidenceId))), stored = saved.filter(x => x.label === item).map(x => x.id);
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
              {mine.map(photo => <QueuedPhoto key={photo.id} p={p} item={photo} size={56} />)}
            </View>}
          </View>
        );
      })}
      {waiting && <Notice text="Saved on this device. It will upload when you're back online." p={p} />}
      {!!(error || failed?.error) && <Notice text={error || failed?.error || ""} p={p} tone="bad" />}
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
