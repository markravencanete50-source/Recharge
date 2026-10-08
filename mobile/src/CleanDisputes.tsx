import { useEffect, useState, type ReactNode } from "react";
import { View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { z } from "zod";
import { Text } from "./Typography";
import { Button, Field, Loading, message, Notice, useRequestId } from "./LiveKit";
import { Sheet } from "./TeamFlows";
import { PhotoStrip, WorkPhotos } from "./Photos";
import { ui, type Palette } from "./theme";
import { readOperations, writeTeams } from "./backend/client";
import { operationViewSchema } from "../../lib/workspace-view";
import { disputeAction } from "../../lib/cleans-live";
import { DECISION_OUTCOMES } from "../../lib/management-live";
import { formatDay } from "../../lib/format";

// Deciding a disputed clean: what the cleaner submitted (report, checklist, photos), why it was
// rejected and the cleaner's side, then uphold or overturn. Used by cleaning managers in Cleans and by
// admins in Management.
type Operation = z.infer<typeof operationViewSchema>;
export type DisputeTarget = { workId: string; propertyId: string; version: number; cleanerName: string | null; propertyName: string };
const str = (v: unknown) => typeof v === "string" && v.trim() ? v : null;
const strings = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

export function DisputeSheet({ p, target, onClose, onDone }: { p: Palette; target: DisputeTarget | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [complaint, setComplaint] = useState<Operation | null>(null);
  const [clean, setClean] = useState<Operation | null>(null);
  const [loading, setLoading] = useState(false);
  const [outcome, setOutcome] = useState<"upheld" | "overturned" | "">("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const version = complaint?.version ?? target?.version ?? 0;
  const request = useRequestId(target ? ["dispute", target.workId, version, outcome, note.trim()].join(":") : null);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (!active) return; setComplaint(null); setClean(null); setOutcome(""); setNote(""); setError(""); setLoading(!!target); });
    // The dispute keeps what was submitted when the clean was rejected; the clean itself is read too.
    if (target) readOperations(target.propertyId).then(r => {
      const ops = z.array(operationViewSchema).parse(r.data);
      const found = ops.find(o => o.workId === target.workId) ?? null;
      if (!active) return;
      setComplaint(found); setClean(ops.find(o => o.workId === str(found?.data.sourceWorkId)) ?? null);
    }).catch(e => { if (active) setError(message(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [target]);
  async function save() {
    if (!target || busy) return;
    if (!outcome || note.trim().length < 5) { setError("Choose an outcome and explain the decision (at least 5 characters)."); return; }
    setBusy(true); setError("");
    try { await writeTeams(disputeAction({ requestId: request.get(), workId: target.workId, version, outcome, note })); request.done(); onClose(); await onDone(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const data = complaint?.data ?? {};
  // Disputes raised before these details were kept fall back to the clean as it is now.
  const report = str(data.report) ?? str(clean?.data.report);
  const checklist = strings(data.checklist).length ? strings(data.checklist) : strings(clean?.data.checklist);
  const photoIds = strings(data.photoIds);
  const reason = str(data.reviewNote) ?? str(clean?.data.reviewNote);
  const feedback = str(data.guestFeedback) ?? str(clean?.data.guestFeedback);
  const cleanedOn = str(data.cleanedOn) ?? clean?.dueOn ?? null;
  const sourceWorkId = str(data.sourceWorkId);
  return (
    <Sheet palette={p} visible={!!target} onClose={onClose} title="Rejected clean" subtitle={target ? `${target.cleanerName ?? "Cleaner"} · ${target.propertyName}` : undefined} icon="spray">
      {target && <>
        <Text style={[ui.body, { color: p.text }]}>The clean was rejected. Look at what the cleaner submitted and their side, then decide whether the rejection stands.</Text>
        {loading && <Loading p={p} rows={2} />}
        <Block p={p} icon="x-circle" title="Why it was rejected">
          <Text style={{ color: p.text }}>{reason ?? "No reason was recorded."}</Text>
          {!!feedback && <Text style={[ui.small, { color: p.muted }]}>Guest feedback: {feedback}</Text>}
        </Block>
        <Block p={p} icon="message-square" title="The cleaner's side">
          <Text style={{ color: str(data.cleanerStatement) ? p.text : p.muted }}>{str(data.cleanerStatement) ?? "The cleaner has not responded yet. They can respond until you decide."}</Text>
        </Block>
        <Block p={p} icon="clipboard" title={`What the cleaner submitted${cleanedOn ? ` · ${formatDay(cleanedOn)}` : ""}`}>
          <Text style={{ color: report ? p.text : p.muted }}>{report ?? "No report was found."}</Text>
          {!!checklist.length && <View style={{ gap: 4 }}>
            {checklist.map(item => <View key={item} style={[ui.row, { gap: 8 }]}><Feather name="check-square" size={15} color={p.success} /><Text style={[ui.small, { color: p.text, flex: 1 }]}>{item}</Text></View>)}
          </View>}
        </Block>
        {photoIds.length ? <View style={{ gap: 8 }}>
          <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>Photos from the clean</Text>
          <PhotoStrip p={p} ids={photoIds} size={84} />
        </View> : sourceWorkId ? <WorkPhotos p={p} workId={sourceWorkId} title="Photos from the clean" /> : null}
        <View style={{ gap: 8 }}>
          {DECISION_OUTCOMES.cleaning_complaint.map(([value, label]) => <Button key={value} label={label} primary={outcome === value} p={p} onPress={() => setOutcome(value)} />)}
        </View>
        {outcome === "overturned" && <Text style={[ui.small, { color: p.muted }]}>{"Overturning removes the rejection from the cleaner’s record. If the clean was not redone, it is accepted and sent for invoicing."}</Text>}
        <Field label="Decision note" value={note} onChange={setNote} p={p} multiline placeholder="What you checked and why. The cleaner sees this." />
        {!!error && <Notice text={error} p={p} tone="bad" />}
        <Button label={busy ? "Saving…" : "Record decision"} primary p={p} disabled={busy || loading} onPress={() => void save()} />
      </>}
    </Sheet>
  );
}

function Block({ p, icon, title, children }: { p: Palette; icon: "x-circle" | "message-square" | "clipboard"; title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 6, padding: 14, borderRadius: 16, backgroundColor: p.wash }}>
      <View style={[ui.row, { gap: 8 }]}><Feather name={icon} size={16} color={p.primary} /><Text accessibilityRole="header" style={{ color: p.text, fontWeight: "700", flex: 1 }}>{title}</Text></View>
      {children}
    </View>
  );
}
