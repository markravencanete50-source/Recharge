import { useCallback, useState } from "react";
import { View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { Button, Field, message, Notice, useRequestId } from "./LiveKit";
import { PhotoPicker } from "./Photos";
import { ui, type Palette } from "./theme";
import { writeOperation } from "./backend/client";
import { cleanProblemAction } from "../../lib/cleans-live";
import { REPAIR_GUIDES, SAFETY_STOP, type RepairType } from "../../lib/repair-guides";

// A cleaner reports something broken or not working, from the clean they are on, without leaving it:
// it goes to the property's Stays team as a repair to sort out, with any photos taken.
export function ProblemForm({ p, clean, onCancel, onSent }: { p: Palette; clean: { workId: string; version: number }; onCancel: () => void; onSent: () => Promise<void> }) {
  const [issue, setIssue] = useState("");
  const [type, setType] = useState<RepairType>("other");
  const [urgent, setUrgent] = useState(false);
  const [photos, setPhotos] = useState<{ ids: string[]; uploading: boolean }>({ ids: [], uploading: false });
  const onPhotos = useCallback((ids: string[], uploading: boolean) => setPhotos({ ids, uploading }), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRequestId(["problem", clean.workId, clean.version, issue.trim(), type, urgent, photos.ids.join(",")].join(":"));
  async function send() {
    if (busy) return;
    if (issue.trim().length < 5) { setError("Say what is wrong (at least 5 characters)."); return; }
    setBusy(true); setError("");
    try {
      await writeOperation(cleanProblemAction({ requestId: request.get(), workId: clean.workId, version: clean.version, issue, urgent, repairType: type, photoIds: photos.ids }));
      request.done(); await onSent();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <View style={{ gap: 10, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: p.border, backgroundColor: p.background }}>
      <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>Report a problem</Text>
      <Text style={[ui.small, { color: p.muted }]}>It goes to the Stays team for this property as a repair. {SAFETY_STOP}</Text>
      <Field label="What is wrong" value={issue} onChange={setIssue} p={p} multiline placeholder="For example: shower drains slowly, bedroom lamp not working" />
      <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>What kind of problem</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {(Object.keys(REPAIR_GUIDES) as RepairType[]).map(t => (
          <MotionPress key={t} accessibilityRole="radio" accessibilityState={{ selected: type === t }} onPress={() => setType(t)} style={[ui.row, { gap: 6, minHeight: 40, paddingHorizontal: 12, borderRadius: 999, backgroundColor: type === t ? p.primary : p.surface, borderWidth: 1, borderColor: type === t ? p.primary : p.border }]}>
            <Feather name={REPAIR_GUIDES[t].icon as "tool"} size={14} color={type === t ? p.onPrimary : p.muted} />
            <Text style={{ color: type === t ? p.onPrimary : p.text, fontSize: 13, fontWeight: "600" }}>{REPAIR_GUIDES[t].label}</Text>
          </MotionPress>
        ))}
      </View>
      <MotionPress accessibilityRole="checkbox" accessibilityState={{ checked: urgent }} onPress={() => setUrgent(u => !u)} style={[ui.row, { gap: 12, minHeight: 48, paddingHorizontal: 12, borderRadius: 14, backgroundColor: urgent ? p.cautionWash : p.elevated }]}>
        <Feather name={urgent ? "check-square" : "square"} size={20} color={urgent ? p.danger : p.muted} />
        <Text style={{ color: p.text, flex: 1 }}>Urgent: the next guests can’t use the property properly until it’s fixed</Text>
      </MotionPress>
      <PhotoPicker key={clean.workId} p={p} workId={clean.workId} purpose="maintenance" label="Photos (optional)" hint="Photos help the team see the problem straight away." max={10} onChange={onPhotos} />
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <Button label={busy ? "Sending…" : "Send to the Stays team"} icon="send" primary p={p} disabled={busy || photos.uploading || issue.trim().length < 5} onPress={() => void send()} />
        <Button label="Cancel" p={p} disabled={busy} onPress={onCancel} />
      </View>
    </View>
  );
}
