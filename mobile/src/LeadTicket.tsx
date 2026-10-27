import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Linking, Platform, TextInput, View, useWindowDimensions } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as DocumentPicker from "expo-document-picker";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { Button, Field, Loading, Notice, Tag, message, useRequestId } from "./LiveKit";
import { Sheet } from "./TeamFlows";
import { PersonAvatar } from "./ChatParts";
import { TASK_PAGE_WIDTH, TASK_TWO_PANES_FROM } from "./TodoTask";
import { leadFileLink, readTeams, removeLeadFile, uploadLeadFile, writeTeams } from "./backend/client";
import { liveApi } from "./LivePages";
import { TrackerProgress } from "./Tracker";
import { ui, type Palette } from "./theme";
import type { ClientEnquiry } from "../../lib/client-enquiry";
import {
  LEAD_FILE_RULE, LEAD_RADIUS_MILES, LEAD_STEP_HELP, LEAD_STEP_LABEL, LEAD_STEPS, MAX_LEAD_COMPARABLES, TBC, canOpenStep, estimateFromSteps, factText, feedWords, internalRows, isTicked,
  leadChecklist, leadFacts, leadFeed, leadReadSchema, leadStateSchema, leadStepIssue, localItems, milesText, missingFacts, placeOf, stepData, stepsOpen, withState,
  type LeadCheck, type LeadRead, type LeadStep, type SavableStep, type StepData,
} from "../../lib/lead-estimate";
import { workflowValues, type WorkflowField } from "../../lib/workflow-forms";
import { ownCostCategories, ownCostFields, ownCostsFrom } from "../../lib/own-costs";
import { formatBps, formatDay, formatMoney } from "../../lib/format";
import { timeAgo } from "../../lib/tracker";
import { journeyProgress } from "../../lib/tracker-onboarding";
import { FollowUpPanel } from "./AgreementFollowUps";

// A lead opened as a ticket (Alex's Estimate Delivery, migration 20261025300000), laid out like a to-do's task page: on a
// computer, what the landlord has told us on the left (TBC beside anything not collected yet) and, on the right, the
// onboarding checklist and the activity thread; on a phone the two stack. A step on the checklist opens its task: Estimate
// Delivery's five tasks here, the rest on the property's onboarding.

type Props = {
  p: Palette; enquiry: ClientEnquiry; subtitle: string; header: ReactNode; onClose: () => void; onChanged: () => Promise<void>;
  onOpenProperty: (propertyId: string) => void; onValue?: () => void;
};
const STATE_ICON = { done: "check-circle", current: "arrow-right-circle", todo: "circle" } as const;

export function LeadTicket({ p, enquiry: e, subtitle, header, onClose, onChanged, onOpenProperty, onValue }: Props) {
  const [read, setRead] = useState<LeadRead | null>(null);
  const [error, setError] = useState("");
  const [task, setTask] = useState<LeadStep | null>(null);
  const { width } = useWindowDimensions();
  const twoPanes = width >= TASK_TWO_PANES_FROM;
  const load = useCallback(async () => {
    try { setRead(leadReadSchema.parse((await readTeams({ section: "lead", enquiryId: e.id })).data)); setError(""); } catch (err) { setError(message(err)); }
  }, [e.id]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  // An action answers with the lead's state; the list behind is refreshed too (its step may have moved on).
  const changed = useCallback(async (state?: unknown) => {
    const parsed = leadStateSchema.safeParse(state);
    if (parsed.success) setRead(r => r ? withState(r, parsed.data) : r); else await load();
    await onChanged();
  }, [load, onChanged]);

  if (task && read) return <StepTask p={p} read={read} step={task} onBack={() => { setTask(null); void load(); }} onChanged={changed} reload={load} />;

  const facts = leadFacts(e), missing = missingFacts(facts);
  const left = (
    <View style={{ gap: 14, flex: twoPanes ? 1 : undefined, minWidth: 0 }}>
      {header}
      {missing > 0 && <Text style={[ui.small, { color: p.muted }]}>{`${missing} detail${missing === 1 ? "" : "s"} still to collect, marked ${TBC}.`}</Text>}
      {facts.map(g => (
        <View key={g.key} style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, paddingVertical: 6, paddingHorizontal: 12, gap: 0 }]}>
          <Text accessibilityRole="header" style={[ui.label, { color: p.muted, paddingVertical: 6 }]}>{g.title}</Text>
          {g.facts.map(f => (
            <View key={f.label} style={[ui.row, { gap: 12, alignItems: "flex-start", paddingVertical: 8, borderTopWidth: 1, borderColor: p.border }]}>
              <Text style={{ width: 140, color: p.muted, fontSize: 12, fontWeight: "600" }}>{f.label}</Text>
              {f.value === null ? <Tag label={TBC} tone="wait" p={p} /> : <Text selectable style={{ flex: 1, color: p.text, fontSize: 13, lineHeight: 19 }}>{factText(f)}</Text>}
            </View>
          ))}
        </View>
      ))}
    </View>
  );

  const openCheck = (c: LeadCheck) => {
    if (c.key === "estimate") { const next = c.subSteps?.find(s => s.state === "current") ?? c.subSteps?.find(s => s.state !== "done"); if (next && read) setTask(next.step); return; }
    if (c.key === "enquiry" && !read?.journey) { onValue?.(); return; }
    if (read?.journey) onOpenProperty(read.journey.propertyId);
  };
  const right = (
    <View style={[{ gap: 16, minWidth: 0 }, twoPanes ? { width: 430, borderLeftWidth: 1, borderLeftColor: p.border, paddingLeft: 20 } : { borderTopWidth: 1, borderTopColor: p.border, paddingTop: 16 }]}>
      <Text accessibilityRole="header" style={{ color: p.text, fontSize: 16, fontWeight: "700" }}>Onboarding checklist</Text>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {!read && !error && <Loading p={p} rows={4} />}
      {/* How far this lead has come, counted exactly as its row on the onboarding tracker (a lead with no property yet is at the start). */}
      {read && <TrackerProgress p={p} progress={journeyProgress(read.journey?.stage ?? "enquiry")} percent />}
      {read && <View style={{ gap: 2 }}>
        {leadChecklist(read).map(c => (
          <View key={c.key}>
            <CheckRow p={p} label={c.label} state={c.state} onPress={() => openCheck(c)} hint={c.key === "estimate" ? undefined : c.state === "done" ? "Done" : read.journey ? "Opens the property's onboarding" : undefined} />
            {c.subSteps && <View style={{ paddingLeft: 28, gap: 2 }}>
              {c.subSteps.map(s => {
                const open = s.state === "done" || canOpenStep(read.steps, s.step);
                return <CheckRow key={s.step} p={p} small label={s.label} state={s.state} disabled={!open}
                  hint={s.state === "done" ? (s.by ? `${s.by}, ${formatDay(s.at?.slice(0, 10))}` : "Done") : !open ? "After the step before" : s.saved ? "Draft saved" : undefined}
                  onPress={() => setTask(s.step)} />;
              })}
            </View>}
          </View>
        ))}
      </View>}
      {/* From the agreement on: the follow-up sequence (20261027200000), when one has started for the property. */}
      {read?.journey && ["agreement", "archived", "form", "invoice"].includes(read.journey.stage) && <FollowUpPanel key={read.journey.propertyId + read.journey.stage} p={p} propertyId={read.journey.propertyId} onChanged={load} />}
      {read && <Thread p={p} read={read} onChanged={changed} />}
    </View>
  );
  return (
    <Sheet palette={p} visible onClose={onClose} title={e.answers?.fullName ?? e.recipientName} subtitle={subtitle} icon="building" width={TASK_PAGE_WIDTH}>
      {twoPanes ? <View style={[ui.row, { gap: 20, alignItems: "flex-start" }]}>{left}{right}</View> : <View style={{ gap: 20 }}>{left}{right}</View>}
    </Sheet>
  );
}

function CheckRow({ p, label, state, hint, small, disabled, onPress }: { p: Palette; label: string; state: "done" | "current" | "todo"; hint?: string; small?: boolean; disabled?: boolean; onPress: () => void }) {
  const ink = state === "done" ? p.success : state === "current" ? p.primary : p.muted;
  return (
    <MotionPress accessibilityRole="button" accessibilityLabel={`${label}, ${state === "done" ? "done" : state === "current" ? "next" : "to do"}`} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}
      style={[ui.row, { gap: 10, minHeight: small ? 38 : 44, paddingHorizontal: 8, borderRadius: 10, backgroundColor: state === "current" ? p.wash : "transparent", opacity: disabled ? 0.55 : 1 }]}>
      <Feather name={STATE_ICON[state]} size={small ? 16 : 18} color={ink} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ color: p.text, fontSize: small ? 13 : 14, fontWeight: state === "current" ? "700" : "600" }}>{label}</Text>
        {!!hint && <Text style={[ui.small, { color: p.muted }]}>{hint}</Text>}
      </View>
      {!disabled && <Feather name="chevron-right" size={16} color={p.muted} />}
    </MotionPress>
  );
}

// The activity thread, oldest first, with the comment box at the bottom: the lead's history, the steps done and the comments.
function Thread({ p, read, onChanged }: { p: Palette; read: LeadRead; onChanged: (state?: unknown) => Promise<void> }) {
  const [text, setText] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useRequestId("lead-comment:" + read.enquiry.id + ":" + text.trim());
  const now = new Date();
  const feed = useMemo(() => leadFeed(read), [read]);
  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true); setError("");
    try { const r = await writeTeams({ action: "addLeadComment", requestId: request.get(), enquiryId: read.enquiry.id, text: body }) as { data?: unknown }; request.done(); setText(""); await onChanged(r.data); }
    catch (err) { setError(message(err)); } finally { setBusy(false); }
  }
  return (
    <View style={{ gap: 12 }}>
      <View style={[ui.between, { gap: 8 }]}>
        <Text accessibilityRole="header" style={{ color: p.text, fontSize: 16, fontWeight: "700" }}>Activity</Text>
        <Tag label={`${read.activity.filter(a => a.kind === "comment").length} comments`} tone="plain" p={p} />
      </View>
      {feed.map(x => x.kind === "event"
        ? <View key={x.key} style={[ui.row, { gap: 8, paddingLeft: 4 }]}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: p.controlBorder }} />
            <Text style={[ui.small, { flex: 1, color: p.muted }]}>{feedWords(x)}<Text style={{ color: p.muted }}>{" · " + timeAgo(x.at, now)}</Text></Text>
          </View>
        : <View key={x.key} style={[ui.card, ui.row, { backgroundColor: p.surface, borderColor: p.border, padding: 12, gap: 10, alignItems: "flex-start" }]}>
            <PersonAvatar p={p} name={x.byName ?? "Recharge"} userId={x.byId} size={30} />
            <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
              <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
                <Text style={{ color: p.text, fontSize: 13, fontWeight: "700" }}>{x.byName ?? "Recharge"}</Text>
                <Text style={[ui.small, { color: p.muted }]}>{timeAgo(x.at, now)}</Text>
              </View>
              <Text selectable style={{ color: p.text, fontSize: 14, lineHeight: 20 }}>{x.text}</Text>
            </View>
          </View>)}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <View style={[ui.row, { gap: 8, alignItems: "flex-end", borderWidth: 1, borderColor: p.controlBorder, borderRadius: 16, backgroundColor: p.background, paddingLeft: 12, paddingRight: 6, paddingVertical: 6 }]}>
        <TextInput accessibilityLabel="Write a comment" value={text} onChangeText={setText} multiline maxLength={2000} placeholder="Write a comment for the team" placeholderTextColor={p.muted}
          onKeyPress={k => { const n = k.nativeEvent as { key: string; shiftKey?: boolean }; if (Platform.OS === "web" && n.key === "Enter" && !n.shiftKey) { k.preventDefault?.(); void send(); } }}
          style={{ flex: 1, minHeight: 36, maxHeight: 160, paddingVertical: 8, fontSize: 14, fontFamily: "Montserrat_500Medium", color: p.text }} />
        <MotionPress accessibilityRole="button" accessibilityLabel="Send" disabled={busy || !text.trim()} onPress={() => void send()}
          style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: text.trim() ? p.primary : p.elevated, opacity: busy ? 0.6 : 1 }}>
          <Feather name="send" size={16} color={text.trim() ? p.onPrimary : p.muted} />
        </MotionPress>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------- the five tasks
const poundsText = (minor: number | null | undefined) => typeof minor === "number" ? (minor / 100).toFixed(minor % 100 ? 2 : 0) : "";
const percentText = (bps: number | null | undefined) => typeof bps === "number" ? String(bps / 100) : "";
const money = (name: string, label: string): WorkflowField => ({ name, label, type: "money", required: false });
const percent = (name: string, label: string): WorkflowField => ({ name, label, type: "percent", required: false });

function StepTask({ p, read, step, onBack, onChanged, reload }: { p: Palette; read: LeadRead; step: LeadStep; onBack: () => void; onChanged: (state?: unknown) => Promise<void>; reload: () => Promise<void> }) {
  const ticked = isTicked(read.steps, step), open = stepsOpen(read);
  const row = read.steps.find(s => s.step === step);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const save = useRequestId("lead-step:" + read.enquiry.id + ":" + step);
  async function run(input: Record<string, unknown>, after?: () => void) {
    if (busy) return;
    setBusy(true); setError("");
    try { const r = await writeTeams({ requestId: save.get(JSON.stringify(input)), enquiryId: read.enquiry.id, ...input } as never) as { data?: unknown }; save.done(JSON.stringify(input)); await onChanged(r.data); after?.(); }
    catch (err) { setError(message(err)); } finally { setBusy(false); }
  }
  const saveStep = (data: Record<string, unknown>, done: boolean) => {
    const issue = leadStepIssue(step as SavableStep, data, done);
    if (issue) { setError(issue); return; }
    void run({ action: "saveLeadStep", step, data, done }, done ? onBack : undefined);
  };
  const index = LEAD_STEPS.indexOf(step);
  const doneLine = ticked && row?.tickedAt ? `Ticked by ${row.tickedByName ?? "the team"} on ${formatDay(row.tickedAt.slice(0, 10))}.` : "";
  const footer = <>
    {!!error && <Notice text={error} p={p} tone="bad" />}
    {ticked && open && step !== "submit" && <Button label={busy ? "Reopening…" : "Reopen this step"} icon="rotate-ccw" p={p} disabled={busy} onPress={() => void run({ action: "reopenLeadStep", step })} />}
    <Button label="Back to the lead" icon="arrow-left" quiet p={p} onPress={onBack} />
  </>;
  return (
    <Sheet palette={p} visible onClose={onBack} title={LEAD_STEP_LABEL[step]} subtitle={`Estimate Delivery, step ${index + 1} of ${LEAD_STEPS.length}`} icon="clipboard" width={780}>
      <View style={{ gap: 14 }}>
        <Text style={[ui.body, { color: p.muted }]}>{LEAD_STEP_HELP[step]}</Text>
        {!!doneLine && <Notice text={doneLine} p={p} />}
        {!open && <Notice text="The owner has moved on from the estimate, so these steps can no longer change." p={p} />}
        {step === "internal" && <InternalTask p={p} read={read} locked={ticked || !open} busy={busy} onSave={saveStep} />}
        {step === "external" && <ExternalTask p={p} read={read} locked={ticked || !open} busy={busy} onSave={saveStep} reload={reload} setError={setError} />}
        {step === "local" && <LocalTask p={p} read={read} locked={ticked || !open} busy={busy} onSave={saveStep} />}
        {step === "revenue" && <RevenueTask p={p} read={read} locked={ticked || !open} busy={busy} onSave={saveStep} setError={setError} />}
        {step === "submit" && <SubmitTask p={p} read={read} locked={ticked || !open} onDone={async () => { await reload(); onBack(); }} setError={setError} />}
        {footer}
      </View>
    </Sheet>
  );
}
type TaskProps = { p: Palette; read: LeadRead; locked: boolean; busy: boolean; onSave: (data: Record<string, unknown>, done: boolean) => void };

function Actions({ p, locked, busy, done, onSave }: { p: Palette; locked: boolean; busy: boolean; done: string; onSave: (done: boolean) => void }) {
  if (locked) return null;
  return (
    <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
      <Button label={busy ? "Saving…" : done} icon="check" primary p={p} disabled={busy} onPress={() => onSave(true)} />
      <Button label="Save draft" icon="save" p={p} disabled={busy} onPress={() => onSave(false)} />
    </View>
  );
}
const leadPlace = (read: LeadRead) => placeOf(read.property ?? { address: read.enquiry.answers?.propertyAddress ?? "" });
function PlaceNote({ p, read }: { p: Palette; read: LeadRead }) {
  const at = leadPlace(read);
  if (!at) return <Notice text={`This lead has no map position yet (no latitude and longitude, and no postcode we know), so nothing within ${LEAD_RADIUS_MILES} miles can be listed. Add notes on what the analysis is based on, then go on.`} p={p} tone="bad" />;
  return at.precision === "district" ? <Notice text="Placed by its postcode district, so the distances are approximate." p={p} /> : null;
}
function RemoveButton({ p, label, onPress }: { p: Palette; label: string; onPress: () => void }) {
  return <MotionPress accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" }}><Feather name="x" size={16} color={p.muted} /></MotionPress>;
}

function InternalTask({ p, read, locked, busy, onSave }: TaskProps) {
  const saved = stepData(read.steps, "internal");
  const [rows, setRows] = useState<StepData<"internal">["rows"]>(() => saved?.rows ?? internalRows(read, leadPlace(read)));
  const [notes, setNotes] = useState(saved?.notes ?? "");
  return <>
    <PlaceNote p={p} read={read} />
    {!rows.length && <Text style={[ui.small, { color: p.muted }]}>{`None of our active properties is within ${LEAD_RADIUS_MILES} miles.`}</Text>}
    {rows.map((r, i) => (
      <View key={r.propertyId} style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, padding: 12, gap: 6 }]}>
        <View style={[ui.row, { gap: 8 }]}>
          <Text style={{ flex: 1, color: p.text, fontSize: 14, fontWeight: "700" }}>{r.name}</Text>
          <Tag label={milesText(r.miles)} tone="plain" p={p} />
          {!locked && <RemoveButton p={p} label={"Remove " + r.name} onPress={() => setRows(list => list.filter((_, j) => j !== i))} />}
        </View>
        <Text style={[ui.small, { color: p.text }]}>{`Occupancy, last 12 months: ${formatBps(r.occupancyBps)} · Trend: ${r.trend ?? "Not enough data"}`}</Text>
        <Text style={[ui.small, { color: p.text }]}>{`Average nightly rate: ${typeof r.adrMinor === "number" ? formatMoney(r.adrMinor) : "No payouts yet"} · Payouts, last 12 months: ${typeof r.revenueMinor === "number" ? formatMoney(r.revenueMinor) : "None"}`}</Text>
        {locked ? (!!r.note && <Text style={[ui.small, { color: p.muted }]}>{r.note}</Text>)
          : <Field label="Note on this property" value={r.note ?? ""} onChange={v => setRows(list => list.map((x, j) => j === i ? { ...x, note: v.slice(0, 500) } : x))} p={p} />}
      </View>
    ))}
    {locked ? (!!notes && <Text style={[ui.body, { color: p.text }]}>{notes}</Text>) : <Field label="Notes" value={notes} onChange={setNotes} p={p} multiline placeholder="What the nearby properties tell us about this one" />}
    <Actions p={p} locked={locked} busy={busy} done="Approve" onSave={done => onSave({ rows, notes, ...(leadPlace(read) ? {} : { noLocation: true }) }, done)} />
  </>;
}

function ExternalTask({ p, read, locked, busy, onSave, reload, setError }: TaskProps & { reload: () => Promise<void>; setError: (s: string) => void }) {
  const saved = stepData(read.steps, "external");
  const [reportUrl, setReportUrl] = useState(saved?.reportUrl ?? "");
  const [fileId, setFileId] = useState<string | undefined>(saved?.reportFileId ?? read.files.at(-1)?.id);
  const [comps, setComps] = useState(() => Array.from({ length: MAX_LEAD_COMPARABLES }, (_, i) => {
    const c = saved?.comparables[i];
    return { name: c?.name ?? "", url: c?.url ?? "", rate: poundsText(c?.adrMinor) };
  }));
  const [average, setAverage] = useState(poundsText(saved?.averageRateMinor));
  const [notes, setNotes] = useState(saved?.notes ?? "");
  const [uploading, setUploading] = useState(false);
  async function upload() {
    const picked = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "image/jpeg", "image/png", "image/webp"], copyToCacheDirectory: true, multiple: false });
    if (picked.canceled || !picked.assets?.length) return;
    const asset = picked.assets[0];
    setUploading(true); setError("");
    try {
      const state = leadStateSchema.parse(await uploadLeadFile(read.enquiry.id, { uri: asset.uri, name: asset.name, mimeType: asset.mimeType, file: (asset as { file?: File }).file }));
      setFileId(state.files.at(-1)?.id); await reload();
    } catch (err) { setError(message(err)); } finally { setUploading(false); }
  }
  async function openFile(id: string) { try { await Linking.openURL((await leadFileLink(read.enquiry.id, id)).url); } catch (err) { setError(message(err)); } }
  async function remove(id: string) { try { await removeLeadFile(read.enquiry.id, id); if (fileId === id) setFileId(undefined); await reload(); } catch (err) { setError(message(err)); } }
  function build(): Record<string, unknown> | null {
    try {
      const fields = [money("average", "Average nightly rate"), ...comps.map((_, i) => money("rate" + i, `Comparable ${i + 1} nightly rate`))];
      const v = workflowValues(fields, { average, ...Object.fromEntries(comps.map((c, i) => ["rate" + i, c.rate])) });
      const comparables = comps.flatMap((c, i) => c.name.trim() || c.url.trim() || c.rate.trim() ? [{ name: c.name.trim(), url: c.url.trim(), adrMinor: v["rate" + i] as number }] : []);
      return { reportUrl: reportUrl.trim(), ...(fileId ? { reportFileId: fileId } : {}), comparables, averageRateMinor: typeof v.average === "number" ? v.average : null, notes };
    } catch (err) { setError(message(err)); return null; }
  }
  return <>
    {locked ? <>
      {!!reportUrl && <Button label="Open the PriceLabs report link" icon="external-link" p={p} onPress={() => void Linking.openURL(reportUrl)} />}
      {!!fileId && <Button label="Open the PriceLabs report file" icon="file-text" p={p} onPress={() => void openFile(fileId)} />}
      <Text style={[ui.body, { color: p.text }]}>{`Average nightly rate: ${typeof saved?.averageRateMinor === "number" ? formatMoney(saved.averageRateMinor) : TBC}`}</Text>
      {(saved?.comparables ?? []).map(c => <Text key={c.url} style={[ui.small, { color: p.text }]}>{`${c.name}: ${formatMoney(c.adrMinor)} a night`}</Text>)}
      {!!notes && <Text style={[ui.small, { color: p.muted }]}>{notes}</Text>}
    </> : <>
      <Field label="PriceLabs report link (https://)" value={reportUrl} onChange={setReportUrl} p={p} placeholder="https://" />
      <Text style={[ui.small, { color: p.muted }]}>{"Or upload the report. " + LEAD_FILE_RULE}</Text>
      {read.files.map(f => (
        <View key={f.id} style={[ui.row, { gap: 8, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: fileId === f.id ? p.primary : p.border, backgroundColor: p.surface }]}>
          <MotionPress accessibilityRole="radio" accessibilityState={{ selected: fileId === f.id }} accessibilityLabel={"Use " + f.name} onPress={() => setFileId(f.id)} style={[ui.row, { flex: 1, gap: 8, minHeight: 36 }]}>
            <Feather name={fileId === f.id ? "check-circle" : "circle"} size={16} color={fileId === f.id ? p.primary : p.muted} />
            <Text numberOfLines={1} style={{ flex: 1, color: p.text, fontSize: 13, fontWeight: "600" }}>{f.name}</Text>
          </MotionPress>
          <MotionPress accessibilityRole="link" accessibilityLabel={"Open " + f.name} onPress={() => void openFile(f.id)} style={{ paddingHorizontal: 6, minHeight: 36, justifyContent: "center" }}><Text style={{ color: p.primary, fontSize: 13, fontWeight: "700" }}>Open</Text></MotionPress>
          <RemoveButton p={p} label={"Remove " + f.name} onPress={() => void remove(f.id)} />
        </View>
      ))}
      <Button label={uploading ? "Uploading…" : "Upload the report"} icon="upload" p={p} disabled={uploading} onPress={() => void upload()} />
      {comps.map((c, i) => (
        <View key={i} style={{ gap: 8 }}>
          <Text style={[ui.label, { color: p.muted }]}>{`Comparable ${i + 1} (optional)`}</Text>
          <Field label="Name" value={c.name} onChange={v => setComps(list => list.map((x, j) => j === i ? { ...x, name: v } : x))} p={p} />
          <Field label="Link (https://)" value={c.url} onChange={v => setComps(list => list.map((x, j) => j === i ? { ...x, url: v } : x))} p={p} />
          <Field label="Nightly rate, GBP" value={c.rate} onChange={v => setComps(list => list.map((x, j) => j === i ? { ...x, rate: v } : x))} p={p} />
        </View>
      ))}
      <Field label="Average nightly rate from the report, GBP" value={average} onChange={setAverage} p={p} />
      <Field label="Notes" value={notes} onChange={setNotes} p={p} multiline />
    </>}
    <Actions p={p} locked={locked} busy={busy || uploading} done="Submit" onSave={done => { const d = build(); if (d) onSave(d, done); }} />
  </>;
}

function LocalTask({ p, read, locked, busy, onSave }: TaskProps) {
  const saved = stepData(read.steps, "local");
  const [items, setItems] = useState<StepData<"local">["items"]>(() => saved?.items ?? localItems(read, leadPlace(read)));
  const [notes, setNotes] = useState(saved?.notes ?? "");
  return <>
    <PlaceNote p={p} read={read} />
    {!items.length && <Text style={[ui.small, { color: p.muted }]}>{`No saved local events or repair work within ${LEAD_RADIUS_MILES} miles in the next 12 months.`}</Text>}
    {items.map((x, i) => (
      <View key={(x.id ?? "") + i} style={[ui.card, ui.row, { backgroundColor: p.surface, borderColor: p.border, padding: 12, gap: 10, alignItems: "flex-start" }]}>
        <Tag label={x.kind === "event" ? "Event" : x.kind === "repair" ? "Repair work" : "Note"} tone={x.kind === "event" ? "good" : "plain"} p={p} />
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <Text style={{ color: p.text, fontSize: 14, fontWeight: "700" }}>{x.name}</Text>
          <Text style={[ui.small, { color: p.muted }]}>{[x.on ? formatDay(x.on) : "No date", x.place, milesText(x.miles)].filter(Boolean).join(" · ")}</Text>
          {!!x.note && <Text style={[ui.small, { color: p.text }]}>{x.note}</Text>}
        </View>
        {!locked && <RemoveButton p={p} label={"Remove " + x.name} onPress={() => setItems(list => list.filter((_, j) => j !== i))} />}
      </View>
    ))}
    {locked ? (!!notes && <Text style={[ui.body, { color: p.text }]}>{notes}</Text>) : <Field label="Notes" value={notes} onChange={setNotes} p={p} multiline placeholder="Busy dates, works nearby, anything that changes the estimate" />}
    <Actions p={p} locked={locked} busy={busy} done="Approve" onSave={done => onSave({ items, notes }, done)} />
  </>;
}

function RevenueTask({ p, read, locked, busy, onSave, setError }: TaskProps & { setError: (s: string) => void }) {
  const saved = stepData(read.steps, "revenue"), external = stepData(read.steps, "external");
  const costs = ownCostFields(read), categories = ownCostCategories(read);
  const fields: WorkflowField[] = [money("lowRateMinor", "Low nightly rate, GBP"), money("mediumRateMinor", "Medium (expected) nightly rate, GBP"), money("highRateMinor", "High nightly rate, GBP"),
    percent("occupancyBps", "Expected occupancy, %"), percent("directBookingBps", "Expected direct bookings, %"), percent("otaFeeBps", "Platform fee, %"), percent("managementFeeBps", "Recharge management fee, %"), ...costs];
  const [values, setValues] = useState<Record<string, string>>(() => ({
    lowRateMinor: poundsText(saved?.lowRateMinor), mediumRateMinor: poundsText(saved?.mediumRateMinor), highRateMinor: poundsText(saved?.highRateMinor),
    occupancyBps: percentText(saved?.occupancyBps), directBookingBps: percentText(saved?.directBookingBps), otaFeeBps: percentText(saved?.otaFeeBps), managementFeeBps: percentText(saved?.managementFeeBps),
    ...Object.fromEntries(categories.map((c, i) => [`ownCost${i}`, poundsText(saved?.ownCosts?.find(x => x.category === c)?.monthlyMinor)])),
  }));
  const [comments, setComments] = useState(saved?.comments ?? "");
  function build(): Record<string, unknown> | null {
    try {
      const v = workflowValues(fields, values);
      const data: Record<string, unknown> = { comments, ...ownCostsFrom(read, v) };
      for (const k of ["lowRateMinor", "mediumRateMinor", "highRateMinor", "occupancyBps", "directBookingBps", "otaFeeBps", "managementFeeBps"]) if (typeof v[k] === "number") data[k] = v[k];
      return data;
    } catch (err) { setError(message(err)); return null; }
  }
  return <>
    {typeof external?.averageRateMinor === "number" && <Notice text={`External Analysis: the PriceLabs average is ${formatMoney(external.averageRateMinor)} a night.`} p={p} />}
    {fields.map(f => locked
      ? (values[f.name] ? <Text key={f.name} style={[ui.small, { color: p.text }]}>{`${f.label.replace(/, (GBP|%)$/, "")}: ${f.type === "percent" ? values[f.name] + "%" : "£" + values[f.name]}`}</Text> : null)
      : <Field key={f.name} label={f.label} value={values[f.name] ?? ""} onChange={v => setValues(x => ({ ...x, [f.name]: v }))} p={p} />)}
    {locked ? (!!comments && <Text style={[ui.body, { color: p.text }]}>{comments}</Text>) : <Field label="Estimate notes for the client" value={comments} onChange={setComments} p={p} multiline />}
    <Actions p={p} locked={locked} busy={busy} done="Submit" onSave={done => { const d = build(); if (d) onSave(d, done); }} />
  </>;
}

function SubmitTask({ p, read, locked, onDone, setError }: { p: Palette; read: LeadRead; locked: boolean; onDone: () => Promise<void>; setError: (s: string) => void }) {
  const [busy, setBusy] = useState(false);
  const request = useRequestId("lead-submit:" + read.enquiry.id + ":" + (read.journey?.version ?? 0));
  const internal = stepData(read.steps, "internal"), external = stepData(read.steps, "external"), local = stepData(read.steps, "local"), revenue = stepData(read.steps, "revenue");
  const body = estimateFromSteps(read);
  async function submit() {
    if (busy) return;
    if ("error" in body) { setError(String(body.error)); return; }
    setBusy(true); setError("");
    // The existing publish: the client is emailed the estimate and told in the app, and Submit Estimate is ticked.
    try { await liveApi("/journeys", { ...body, requestId: request.get() }); request.done(); await onDone(); }
    catch (err) { setError(message(err)); } finally { setBusy(false); }
  }
  const line = (label: string, value: string) => <View key={label} style={[ui.row, { gap: 12, paddingVertical: 8, borderTopWidth: 1, borderColor: p.border }]}>
    <Text style={{ width: 170, color: p.muted, fontSize: 12, fontWeight: "600" }}>{label}</Text><Text style={{ flex: 1, color: p.text, fontSize: 13 }}>{value}</Text>
  </View>;
  return <>
    <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, paddingVertical: 4, paddingHorizontal: 12, gap: 0 }]}>
      {line(LEAD_STEP_LABEL.internal, internal ? `${internal.rows.length} of our properties compared${internal.notes ? `. ${internal.notes}` : ""}` : TBC)}
      {line(LEAD_STEP_LABEL.external, external ? `Average ${typeof external.averageRateMinor === "number" ? formatMoney(external.averageRateMinor) : TBC} a night, ${external.comparables.length} comparable${external.comparables.length === 1 ? "" : "s"}` : TBC)}
      {line(LEAD_STEP_LABEL.local, local ? `${local.items.length} events and repair work reviewed${local.notes ? `. ${local.notes}` : ""}` : TBC)}
      {line("Nightly rates", revenue && typeof revenue.lowRateMinor === "number" ? `Low ${formatMoney(revenue.lowRateMinor)}, medium ${formatMoney(revenue.mediumRateMinor)}, high ${formatMoney(revenue.highRateMinor)}` : TBC)}
      {line("Occupancy and fees", revenue ? [typeof revenue.occupancyBps === "number" ? `Occupancy ${formatBps(revenue.occupancyBps)}` : "", typeof revenue.managementFeeBps === "number" ? `management fee ${formatBps(revenue.managementFeeBps)}` : "", typeof revenue.otaFeeBps === "number" ? `platform fee ${formatBps(revenue.otaFeeBps)}` : ""].filter(Boolean).join(", ") || TBC : TBC)}
    </View>
    {locked ? (read.enquiry.estimateDelivery ? <Notice text={`Submitted. ${read.enquiry.estimateDelivery.status === "sent" ? `Emailed to ${read.enquiry.estimateDelivery.to ?? "the client"}.` : "The email is on its way."}`} p={p} /> : null)
      : <>
        {"error" in body && <Notice text={String(body.error)} p={p} tone="bad" />}
        <Button label={busy ? "Submitting…" : "Submit the estimate"} icon="send" primary p={p} disabled={busy || "error" in body} onPress={() => void submit()} />
        <Text style={[ui.small, { color: p.muted }]}>The client is emailed the estimate and told in the app, as for any published estimate.</Text>
      </>}
  </>;
}

