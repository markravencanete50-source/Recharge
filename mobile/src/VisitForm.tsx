import { useEffect, useState } from "react";
import { View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { z } from "zod";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { Button, Field, message, Notice, useRequestId } from "./LiveKit";
import { writeTeams, writeWorkspace } from "./backend/client";
import { formatDay } from "../../lib/format";
import { daysFromNow, londonDayOf, VISIT_FORM_FIRST, VISIT_KIND_LABEL, visitChecklist, visitDates, visitFormAction, visitFormOf, visitMoves, visitType, type VisitAnswer } from "../../lib/repairs-live";
import { operationViewSchema } from "../../lib/workspace-view";

// The visit form (client ask B6): filled in when a routine, garden or bins visit is done. Every checklist
// item is ticked done or left as not done, with a note if wanted, then a general note. The database refuses
// to send a visit for review until a form exists, and the form can be corrected while the visit is open.
// Photos are not asked for here: there is no upload purpose for visit photos yet, so none are sent.
export type VisitFormTarget = { workId: string; version: number; title: string; propertyName: string; status: string; data: Record<string, unknown> };

const clean = (items: string[], form: ReturnType<typeof visitFormOf>): VisitAnswer[] =>
  items.map(item => { const old = form?.answers.find(a => a.item === item); return { done: old?.done ?? false, note: old?.note ?? "" }; });

// Shown after a form is saved: when the visit was last done and when the next one falls due.
export function VisitDates({ p, data, today }: { p: Palette; data: Record<string, unknown>; today: string }) {
  const { lastDoneAt, nextDueOn } = visitDates(data), last = londonDayOf(lastDoneAt);
  if (!last && !nextDueOn) return null;
  return (
    <View style={{ gap: 4 }}>
      {!!last && <Text style={[ui.small, { color: p.text }]}>Last done {formatDay(last, new Date(today + "T12:00:00Z"))}, {daysFromNow(last, today)}</Text>}
      {!!nextDueOn && <Text style={[ui.small, { color: p.muted }]}>Next due {formatDay(nextDueOn, new Date(today + "T12:00:00Z"))}</Text>}
    </View>
  );
}

export function VisitForm({ p, visit, today, onClose, onDone }: { p: Palette; visit: VisitFormTarget | null; today: string; onClose: () => void; onDone: (result: z.infer<typeof operationViewSchema> | null) => Promise<void> | void }) {
  const items = visit ? visitChecklist(visit) : [];
  const existing = visit ? visitFormOf(visit.data) : null;
  const key = visit ? visit.workId + ":" + visit.version : "";
  const [answers, setAnswers] = useState<VisitAnswer[]>([]);
  const [note, setNote] = useState("");
  const [saved, setSaved] = useState<z.infer<typeof operationViewSchema> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Start again (from the recorded form, when there is one) each time a visit opens. A newer version of the same visit,
  // which is what saving the form makes, must not wipe the "saved" panel.
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (!active) return; setAnswers(clean(items, existing)); setNote(existing?.note ?? ""); setSaved(null); setError(""); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visit?.workId]);
  const request = useRequestId(visit ? JSON.stringify([key, answers, note.trim()]) : null);
  const set = (i: number, change: Partial<VisitAnswer>) => setAnswers(a => a.map((x, n) => n === i ? { ...x, ...change } : x));
  const doneCount = answers.filter(a => a.done).length;

  async function save() {
    if (!visit || busy) return;
    const built = visitFormAction(visit, answers.length === items.length ? answers : clean(items, existing), note, request.get());
    if ("error" in built) { setError(built.error); return; }
    setBusy(true); setError("");
    try {
      const reply = await writeTeams(built.action);
      request.done();
      const parsed = operationViewSchema.safeParse(reply?.data ?? reply);
      setSaved(parsed.success ? parsed.data : null);
      await onDone(parsed.success ? parsed.data : null);
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }

  const kind = visit ? VISIT_KIND_LABEL[visitType(visit.title, visit.data)] : "";
  return (
    <Sheet palette={p} visible={!!visit} onClose={onClose} title={visit ? `Visit form: ${visit.title}` : ""} subtitle={visit ? `${visit.propertyName} · ${kind}` : ""} icon="toolbox">
      {!!visit && !saved && <>
        {!existing && <Text style={[ui.small, { color: p.muted }]}>The form is needed before the visit can be sent for review. Tick what you did; anything left unticked is recorded as not done.</Text>}
        {!!existing && <Text style={[ui.small, { color: p.muted }]}>A form is already recorded. You can correct it until the visit is closed.</Text>}
        <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "600" }}>Checklist · {doneCount} of {items.length} done</Text>
        {items.map((item, i) => {
          const a = answers[i] ?? { done: false, note: "" };
          return (
            <View key={item + i} style={{ gap: 6 }}>
              <MotionPress accessibilityRole="checkbox" accessibilityLabel={item} accessibilityState={{ checked: a.done }} onPress={() => set(i, { done: !a.done })} style={[ui.row, { gap: 12, minHeight: 46, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, backgroundColor: a.done ? p.successWash : p.elevated }]}>
                <Feather name={a.done ? "check-square" : "square"} size={19} color={a.done ? p.success : p.muted} />
                <Text style={{ color: p.text, flex: 1 }}>{item}</Text>
                <Text style={[ui.small, { color: a.done ? p.success : p.muted }]}>{a.done ? "Done" : "Not done"}</Text>
              </MotionPress>
              <Field label={`Note for "${item}" (optional)`} value={a.note} onChange={v => set(i, { note: v })} p={p} />
            </View>
          );
        })}
        <Field label="Note about the visit (optional)" value={note} onChange={setNote} p={p} multiline placeholder="Anything found on the visit" />
        {!!error && <Notice text={error} p={p} tone="bad" />}
        <Button label={busy ? "Saving…" : existing ? "Save the corrected form" : "Save the visit form"} icon="check" primary p={p} disabled={busy || !items.length} onPress={() => void save()} />
      </>}
      {!!visit && !!saved && <>
        <Notice text={`Visit form saved: ${visitFormOf(saved.data)?.doneCount ?? doneCount} of ${items.length} done.`} p={p} />
        <VisitDates p={p} data={saved.data} today={today} />
        <Text style={[ui.small, { color: p.muted }]}>The visit can now be sent for review.</Text>
        <Button label="Close" p={p} onPress={onClose} />
      </>}
    </Sheet>
  );
}

// The steps of a visit after the form: start, send for review (blocked until a form exists), sign off, close.
// Where the form is missing it offers "Record the visit form" in place of the blocked move.
export function VisitMoves({ p, role, visit, onRecord, onDone }: { p: Palette; role: string; visit: VisitFormTarget; onRecord: () => void; onDone: () => Promise<void> | void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRequestId(visit.workId + ":" + visit.version);
  const recorded = visitFormOf(visit.data) !== null;
  const moves = visitMoves(role, visit.status, recorded);
  const open = !["completed", "cancelled", "declined"].includes(visit.status), canRecord = open && ["ready", "stays", "admin", "super_admin"].includes(role);
  async function move(status: "in_progress" | "in_review" | "approved" | "completed") {
    if (busy) return;
    setBusy(true); setError("");
    try { await writeWorkspace({ action: "transitionWork", workId: visit.workId, version: visit.version, status, note: note.trim(), requestId: request.get(status) }); request.done(status); setNote(""); await onDone(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <View style={{ gap: 10 }}>
      {canRecord && <Button label={recorded ? "View or correct the visit form" : "Record the visit form"} icon="clipboard" primary={!recorded} p={p} onPress={onRecord} />}
      {moves.some(m => !m.blocked) && <Field label="Note (optional)" value={note} onChange={setNote} p={p} multiline placeholder="Anything found on the visit" />}
      {moves.map(m => m.blocked
        ? <Text key={m.status} style={[ui.small, { color: p.muted }]}>{m.label}: {VISIT_FORM_FIRST.toLowerCase()}.</Text>
        : <Button key={m.status} label={busy ? "Saving…" : m.label} primary={recorded} p={p} disabled={busy} onPress={() => void move(m.status)} />)}
      {!moves.length && <Notice text={visit.status === "in_review" ? "Waiting for Stays to sign off this visit." : "Nothing for you to do on this visit."} p={p} />}
      {!!error && <Notice text={error} p={p} tone="bad" />}
    </View>
  );
}
