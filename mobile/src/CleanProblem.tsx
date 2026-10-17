import { useCallback, useState } from "react";
import { View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { ChoiceField } from "./ChoiceField";
import { MotionPress } from "./motion";
import { Button, Field, message, Notice, useRequestId } from "./LiveKit";
import { PhotoPicker } from "./Photos";
import { ui, type Palette } from "./theme";
import { writeOperation } from "./backend/client";
import { cleanProblemAction, type CleanProblem } from "../../lib/cleans-live";
import { repairPrompts, type CleanCondition } from "../../lib/clean-report";
import { REPAIR_GUIDES, SAFETY_STOP, type RepairType } from "../../lib/repair-guides";

// A cleaner reports something broken or not working, from the clean they are on, without leaving it:
// it goes to the property's Stays team as a repair, the same repair the team would make and in the same
// approvals (migration 20261023100000), with any photos taken. The cleaner follows it in "Repairs you reported".
// `initial` starts the form from the property check (for example "The heating or hot water is not working").
export type ProblemStart = { issue?: string; type?: RepairType; urgent?: boolean };
export function ProblemForm({ p, clean, initial, onCancel, onSent }: { p: Palette; clean: { workId: string; version: number }; initial?: ProblemStart; onCancel: () => void; onSent: () => Promise<void> }) {
  const [issue, setIssue] = useState(initial?.issue ?? "");
  const [type, setType] = useState<RepairType>(initial?.type ?? "other");
  const [urgent, setUrgent] = useState(initial?.urgent ?? false);
  const [hazard, setHazard] = useState(false);
  const [photos, setPhotos] = useState<{ ids: string[]; uploading: boolean }>({ ids: [], uploading: false });
  const onPhotos = useCallback((ids: string[], uploading: boolean) => setPhotos({ ids, uploading }), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRequestId(["problem", clean.workId, clean.version, issue.trim(), type, urgent, hazard, photos.ids.join(",")].join(":"));
  async function send() {
    if (busy) return;
    if (issue.trim().length < 5) { setError("Say what is wrong (at least 5 characters)."); return; }
    setBusy(true); setError("");
    try {
      await writeOperation(cleanProblemAction({ requestId: request.get(), workId: clean.workId, version: clean.version, issue, urgent, hazard, repairType: type, photoIds: photos.ids }));
      request.done(); await onSent();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <View style={{ gap: 10, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: p.border, backgroundColor: p.background }}>
      <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>Report a problem</Text>
      <Text style={[ui.small, { color: p.muted }]}>It goes straight to the Stays team for this property as a repair, the same as one the office reports. You can follow it under Repairs you reported. {SAFETY_STOP}</Text>
      <Field label="What is wrong" value={issue} onChange={setIssue} p={p} multiline placeholder="For example: shower drains slowly, bedroom lamp not working" />
      <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>What kind of problem</Text>
      <ChoiceField p={p} label="What kind of problem" value={type} onChange={setType} options={(Object.keys(REPAIR_GUIDES) as RepairType[]).map(t => ({ value: t, label: REPAIR_GUIDES[t].label }))} />
      <MotionPress accessibilityRole="checkbox" accessibilityState={{ checked: hazard }} onPress={() => setHazard(h => !h)} style={[ui.row, { gap: 12, minHeight: 48, paddingHorizontal: 12, borderRadius: 14, backgroundColor: hazard ? p.dangerWash : p.elevated }]}>
        <Feather name={hazard ? "check-square" : "square"} size={20} color={hazard ? p.danger : p.muted} />
        <Text style={{ color: p.text, flex: 1 }}>This is a safety hazard</Text>
      </MotionPress>
      {/* A hazard is always urgent, as on the team's own repair form. */}
      <MotionPress accessibilityRole="checkbox" accessibilityState={{ checked: urgent || hazard }} onPress={() => setUrgent(u => !u)} style={[ui.row, { gap: 12, minHeight: 48, paddingHorizontal: 12, borderRadius: 14, backgroundColor: urgent || hazard ? p.cautionWash : p.elevated }]}>
        <Feather name={urgent || hazard ? "check-square" : "square"} size={20} color={urgent || hazard ? p.danger : p.muted} />
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

// Where the cleaner reports repairs on a clean: in the clean form (in place of the old "Repairs or replacements needed"
// box, which the team then had to raise as a repair) and on a clean waiting for review. A property check answer that
// needs a repair (heating or broadband not working) offers to report it straight away, unless one of that kind is
// already reported from this clean.
export function CleanRepairs({ p, clean, answers, reported, onSent }: { p: Palette; clean: { workId: string; version: number }; answers?: Partial<CleanCondition>; reported: CleanProblem[]; onSent: () => Promise<void> }) {
  const [open, setOpen] = useState<(ProblemStart & { key: string }) | null>(null);
  const prompts = repairPrompts(answers ?? {}, reported.map(x => x.repairType));
  return (
    <View style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>Anything broken or not working?</Text>
      <Text style={[ui.small, { color: p.muted }]}>Report it here as a repair, with photos if you can. It goes straight to the team, so nobody has to raise it for you.</Text>
      {open
        ? <ProblemForm key={open.key} p={p} clean={clean} initial={open} onCancel={() => setOpen(null)} onSent={async () => { setOpen(null); await onSent(); }} />
        : <>
          {prompts.map(x => <Button key={x.key} label={`Report it: ${x.label}`} icon="alert-triangle" p={p} onPress={() => setOpen({ key: x.key, issue: x.issue, type: x.type, urgent: x.urgent })} />)}
          <Button label="Report a repair" icon="alert-triangle" p={p} onPress={() => setOpen({ key: "new" })} />
        </>}
    </View>
  );
}
