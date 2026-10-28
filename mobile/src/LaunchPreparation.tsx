import { useCallback, useEffect, useState } from "react";
import { Linking, Switch, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { Button, Field, Loading, Notice, Tag, message, useRequestId } from "./LiveKit";
import { Sheet } from "./TeamFlows";
import { DateField } from "./CalendarPicker";
import { liveApi } from "./LivePages";
import { ui, type Palette } from "./theme";
import { launchFileLink, uploadLaunchFile } from "./backend/client";
import { MODULES } from "../../lib/modules";
import {
  DEFAULT_LAUNCH_SETTINGS, LAUNCH_FILE_MIMES, LAUNCH_SECTIONS, TICKET_SECTIONS, LAUNCH_SECTION_TITLE, launchActionSchema, launchProgress, launchReadSchema, launchSettingsSchema, sectionMark, statementKey,
  type LaunchRead, type LaunchSettings, type LaunchStep, type LaunchView,
} from "../../lib/launch-preparation";

// Launch Preparation (Business Plan v1.0, migration 20261029100000): the checklist from the onboarding package to going
// live. On the lead the team ticks Recharge's parts, allocates the housekeeper and books the readiness inspection; in the
// owner's app the owner sees every part (Recharge's marked with a bolt, theirs with a person) and ticks their own; the
// housekeeper fills in the readiness inspection form, which makes the property guest ready. Admins edit the condition
// statements, notes, reminders and boards from the Leads page. Safety documents carry their certificate (20261029200000)
// and each of Recharge's parts is mirrored as a ticket on its board.
const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(iso + "T12:00:00Z"));
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());

const boardName = (id: string) => MODULES.find(m => m.id === id)?.name ?? id;

export async function readLaunch(propertyId?: string) {
  return launchReadSchema.parse((await liveApi("/launch" + (propertyId ? "?propertyId=" + encodeURIComponent(propertyId) : ""))).data);
}

function Mark({ p, state }: { p: Palette; state: LaunchStep["state"] }) {
  const [icon, color] = ({ done: ["check-circle", p.success], todo: ["clock", p.waiting], locked: ["lock", p.muted], na: ["minus-circle", p.muted] } as const)[state];
  return <Feather name={icon} size={18} color={color} accessibilityLabel={{ done: "Done", todo: "In progress", locked: "Not open yet", na: "Not needed" }[state]} />;
}
function Who({ p, who }: { p: Palette; who: LaunchStep["who"] }) {
  return <View style={[ui.row, { gap: 4 }]}>
    <Feather name={who === "recharge" ? "zap" : "user"} size={12} color={who === "recharge" ? p.primary : p.muted} />
    <Text style={[ui.small, { color: who === "recharge" ? p.primary : p.muted }]}>{who === "recharge" ? "Recharge" : "Owner"}</Text>
  </View>;
}
function Choice({ p, on, label, onPress }: { p: Palette; on: boolean; label: string; onPress: () => void }) {
  return <MotionPress accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={onPress}
    style={[ui.row, { gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: on ? p.primary : p.border, backgroundColor: on ? p.wash : p.surface }]}>
    <Text style={{ color: on ? p.primary : p.text, fontSize: 14, fontWeight: on ? "600" : "400" }}>{label}</Text>
  </MotionPress>;
}
function Check({ p, on, label, detail, onPress }: { p: Palette; on: boolean; label: string; detail?: string; onPress: () => void }) {
  return <MotionPress accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={onPress} style={[ui.row, { gap: 10, alignItems: "flex-start", paddingVertical: 6 }]}>
    <Feather name={on ? "check-square" : "square"} size={18} color={on ? p.success : p.muted} />
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={{ color: p.text, fontSize: 14, fontWeight: "600" }}>{label}</Text>
      {!!detail && <Text style={[ui.small, { color: p.muted }]}>{detail}</Text>}
    </View>
  </MotionPress>;
}

// What a part asks for before it can be ticked.
function TickForm({ p, step, settings, busy, onTick }: { p: Palette; step: LaunchStep; settings: LaunchSettings; busy: boolean; onTick: (data?: Record<string, unknown>) => void }) {
  const [note, setNote] = useState(""), [on, setOn] = useState(""), [access, setAccess] = useState(""), [ticks, setTicks] = useState<string[]>([]);
  const [required, setRequired] = useState<boolean | null>(null), [number, setNumber] = useState("");
  if (step.kind === "date") return <View style={{ gap: 8 }}>
    <DateField p={p} label="Inspection date" mode="single" wholeMonthLink={false} empty="Choose a date" today={today()} value={{ from: on, to: on }} onChange={next => setOn(next.from)} />
    <Field p={p} multiline label="How to get into the property" value={access} onChange={v => setAccess(v.slice(0, 2000))} />
    <Button p={p} icon="calendar" label="Book it" disabled={busy || !on || access.trim().length < 3} onPress={() => onTick({ on, access })} />
  </View>;
  if (step.kind === "condition") return <View style={{ gap: 4 }}>
    {settings.condition.map(c => <Check key={c.key} p={p} on={ticks.includes(c.key)} label={c.title} detail={c.text} onPress={() => setTicks(t => t.includes(c.key) ? t.filter(x => x !== c.key) : [...t, c.key])} />)}
    <Text style={[ui.small, { color: p.muted }]}>{`${ticks.length} of ${settings.condition.length} ticked. Anything that cannot be ticked goes to property maintenance first.`}</Text>
    <Button p={p} icon="check" label="Every statement is ticked" disabled={busy || ticks.length < settings.condition.length} onPress={() => onTick({ ticks })} />
  </View>;
  if (step.kind === "expiry") {
    const needsFile = settings.requireComplianceFile && step.files.length === 0;
    return <View style={{ gap: 8 }}>
      <DateField p={p} label={step.state === "done" ? "New expiry date" : "Expiry date"} mode="single" wholeMonthLink={false} empty="Choose the expiry date" today={today()} value={{ from: on, to: on }} onChange={next => setOn(next.from)} />
      {needsFile && <Text style={[ui.small, { color: p.muted }]}>Upload the certificate above first.</Text>}
      <Button p={p} icon="check" label={step.state === "done" ? "Renewed" : "In place"} disabled={busy || !on || needsFile} onPress={() => onTick({ expiresOn: on })} />
    </View>;
  }
  if (step.kind === "licence") return <View style={{ gap: 8 }}>
    <Text style={{ color: p.text, fontSize: 14 }}>Does the property need a short-term let licence?</Text>
    <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}><Choice p={p} on={required === true} label="Yes" onPress={() => setRequired(true)} /><Choice p={p} on={required === false} label="No" onPress={() => setRequired(false)} /></View>
    {required && <Field p={p} label="Licence number" value={number} onChange={v => setNumber(v.slice(0, 120))} />}
    <Button p={p} icon="check" label="Save" disabled={busy || required === null || (required && number.trim().length < 2)} onPress={() => onTick(required ? { required, number } : { required: false })} />
  </View>;
  return <View style={{ gap: 8 }}>
    <Field p={p} label="Note (optional)" value={note} onChange={v => setNote(v.slice(0, 1000))} />
    <Button p={p} icon="check" label="Mark done" disabled={busy} onPress={() => onTick(note.trim() ? { note } : undefined)} />
  </View>;
}

// A safety document's certificates: open, add (PDF or photo) and remove.
function Certificates({ p, propertyId, step, editable, busy, onChange, onRemove }: {
  p: Palette; propertyId: string; step: LaunchStep; editable: boolean; busy: boolean; onChange: (r: LaunchRead) => void; onRemove: (fileId: string) => void;
}) {
  const [uploading, setUploading] = useState(false), [error, setError] = useState("");
  async function add() {
    setError("");
    const picked = await DocumentPicker.getDocumentAsync({ type: [...LAUNCH_FILE_MIMES], copyToCacheDirectory: true, multiple: false });
    const asset = picked.canceled ? null : picked.assets?.[0];
    if (!asset) return;
    setUploading(true);
    try { onChange(launchReadSchema.parse(await uploadLaunchFile(propertyId, step.key, { uri: asset.uri, name: asset.name, mimeType: asset.mimeType, file: (asset as { file?: File }).file }))); }
    catch (e) { setError(message(e)); } finally { setUploading(false); }
  }
  async function open(fileId: string) {
    try { await Linking.openURL((await launchFileLink(propertyId, fileId)).url); } catch (e) { setError(message(e)); }
  }
  if (!step.files.length && !editable) return null;
  return <View style={{ gap: 4 }}>
    {step.files.map(f => <View key={f.id} style={[ui.row, { gap: 6 }]}>
      <Feather name={f.mime === "application/pdf" ? "file-text" : "image"} size={14} color={p.muted} />
      <Text numberOfLines={1} style={[ui.small, { color: p.text, flex: 1 }]}>{`${f.name}, ${when(f.uploadedAt)}`}</Text>
      <Button p={p} quiet icon="external-link" label="Open" onPress={() => void open(f.id)} />
      {editable && <Button p={p} quiet icon="trash-2" label="Remove" disabled={busy} onPress={() => onRemove(f.id)} />}
    </View>)}
    {editable && step.files.length < 10 && <Button p={p} quiet icon="upload" label={uploading ? "Uploading" : step.files.length ? "Add another certificate" : "Upload the certificate"} disabled={uploading || busy} onPress={() => void add()} />}
    {!!error && <Notice p={p} tone="bad" text={error} />}
  </View>;
}

function Done({ p, step }: { p: Palette; step: LaunchStep }) {
  const d = step.data as Record<string, unknown>;
  const bits = [
    typeof d.on === "string" ? `Booked for ${day(d.on)}` : "",
    typeof d.expiresOn === "string" ? `Expires ${when(d.expiresOn + "T12:00:00Z")}` : "",
    d.required === false ? "No licence needed" : typeof d.number === "string" ? `Licence ${d.number}` : "",
    typeof d.note === "string" ? d.note : "",
    step.doneAt ? `${step.manual ? "Ticked" : "Done"} ${when(step.doneAt)}${step.doneByName ? ` by ${step.doneByName}` : ""}` : "",
  ].filter(Boolean);
  return bits.length ? <Text style={[ui.small, { color: p.muted }]}>{bits.join(". ") + "."}</Text> : null;
}

// ---------------------------------------------------------------- the readiness inspection form (the housekeeper, or the team)
export function ReadinessForm({ p, launch, settings, onSubmitted }: { p: Palette; launch: LaunchView; settings: LaunchSettings; onSubmitted: (r: LaunchRead) => void }) {
  const [allPresent, setAllPresent] = useState<boolean | null>(null), [missing, setMissing] = useState("");
  const [marks, setMarks] = useState<Record<string, { ok: boolean | null; note: string }>>({});
  const [video, setVideo] = useState(""), [note, setNote] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const request = useRequestId("readiness:" + launch.propertyId);
  const answered = settings.condition.filter(c => marks[c.key]?.ok !== null && marks[c.key]?.ok !== undefined).length;
  async function submit() {
    const body = {
      action: "submitReadiness", requestId: request.get(), propertyId: launch.propertyId,
      inventory: { allPresent: allPresent === true, missing: allPresent ? [] : missing.split(/\n|,/).map(x => x.trim()).filter(Boolean).slice(0, 50) },
      condition: settings.condition.map(c => ({ key: c.key, ok: marks[c.key]?.ok === true, note: marks[c.key]?.note ?? "" })),
      evidence: { video: video.trim(), note },
    };
    const parsed = launchActionSchema.safeParse(body);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check the form"); return; }
    setBusy(true); setError("");
    try { const r = launchReadSchema.parse((await liveApi("/launch", parsed.data)).data); request.done(); onSubmitted(r); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <View style={{ gap: 14 }}>
    {!!launch.access && <Notice p={p} text={"Access: " + launch.access} />}
    <View style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={{ color: p.text, fontWeight: "700" }}>1. Inventory</Text>
      <Text style={[ui.small, { color: p.muted }]}>Is every item from the inventory in the property?</Text>
      <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}><Choice p={p} on={allPresent === true} label="Everything is here" onPress={() => setAllPresent(true)} /><Choice p={p} on={allPresent === false} label="Something is missing" onPress={() => setAllPresent(false)} /></View>
      {allPresent === false && <Field p={p} multiline label="What is missing (one per line)" value={missing} onChange={v => setMissing(v.slice(0, 4000))} />}
    </View>
    <View style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={{ color: p.text, fontWeight: "700" }}>{`2. Condition (${answered} of ${settings.condition.length})`}</Text>
      <Text style={[ui.small, { color: p.muted }]}>Tick each statement, or cross it and say what is wrong. Each cross goes to property maintenance.</Text>
      {settings.condition.map(c => {
        const m = marks[c.key] ?? { ok: null, note: "" };
        const set = (patch: Partial<typeof m>) => setMarks(all => ({ ...all, [c.key]: { ...m, ...patch } }));
        return <View key={c.key} style={{ gap: 6, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: m.ok === false ? p.danger : p.border }}>
          <Text style={{ color: p.text, fontSize: 14, fontWeight: "600" }}>{c.title}</Text>
          <Text style={[ui.small, { color: p.muted }]}>{c.text}</Text>
          <View style={[ui.row, { gap: 8 }]}><Choice p={p} on={m.ok === true} label="Tick" onPress={() => set({ ok: true })} /><Choice p={p} on={m.ok === false} label="Cross" onPress={() => set({ ok: false })} /></View>
          {m.ok === false && <Field p={p} multiline label="What is wrong" value={m.note} onChange={v => set({ note: v.slice(0, 1000) })} />}
        </View>;
      })}
    </View>
    <View style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={{ color: p.text, fontWeight: "700" }}>3. Evidence</Text>
      <Field p={p} label={settings.requireVideo ? "Link to the changeover video" : "Link to the changeover video (optional)"} value={video} onChange={v => setVideo(v.slice(0, 1000))} placeholder="https://" />
      <Field p={p} multiline label="Anything else (optional)" value={note} onChange={v => setNote(v.slice(0, 2000))} />
    </View>
    {!!error && <Notice p={p} tone="bad" text={error} />}
    <Button p={p} primary icon="send" label="Submit the readiness inspection" disabled={busy || allPresent === null || answered < settings.condition.length || (settings.requireVideo && !video.trim())} onPress={() => void submit()} />
  </View>;
}

// ---------------------------------------------------------------- the checklist (the team on a lead, the owner in their app)
export function LaunchPanel({ p, propertyId, owner = false }: { p: Palette; propertyId: string; owner?: boolean }) {
  const [read, setRead] = useState<LaunchRead | null>(null), [error, setError] = useState(""), [note, setNote] = useState(""), [busy, setBusy] = useState(false);
  const [openStep, setOpenStep] = useState<string | null>(null), [section, setSection] = useState<string | null>(null), [hk, setHk] = useState(""), [readinessOn, setReadinessOn] = useState(""), [form, setForm] = useState(false);
  const request = useRequestId("launch:" + propertyId);
  const load = useCallback(async () => { try { setRead(await readLaunch(propertyId)); setError(""); } catch (e) { setError(message(e)); } }, [propertyId]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  const v = read?.launch;
  if (!read || !v?.steps) return error ? <Notice p={p} tone="bad" text={error} /> : null;
  const steps = v.steps, progress = launchProgress(steps);
  async function act(body: Record<string, unknown>, done: string) {
    if (busy) return;
    const key = JSON.stringify(body);
    const parsed = launchActionSchema.safeParse({ ...body, requestId: request.get(key), propertyId });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check the details"); return; }
    setBusy(true); setError(""); setNote("");
    try { setRead(launchReadSchema.parse((await liveApi("/launch", parsed.data)).data)); request.done(key); setNote(done); setOpenStep(null); }
    catch (e) { setError(message(e)); await load().catch(() => undefined); } finally { setBusy(false); }
  }
  const settings = read.settings;
  return <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, padding: 14, gap: 10 }]}>
    <View style={[ui.between, { gap: 8 }]}>
      <Text accessibilityRole="header" style={{ color: p.text, fontSize: 16, fontWeight: "700" }}>Launch preparation</Text>
      <Tag p={p} label={`${progress.done} of ${progress.total} done`} tone={progress.done === progress.total ? "good" : "wait"} />
    </View>
    <Text style={[ui.small, { color: p.muted }]}>{owner ? "Everything to get your property live. Parts marked Recharge are ours; parts marked Owner are yours to tick." : "From the onboarding package to going live. Recharge's parts are ticked here; the owner ticks theirs in the app."}</Text>
    {LAUNCH_SECTIONS.map(sec => {
      const list = steps.filter(s => s.section === sec);
      if (!list.length) return null;
      const mark = sectionMark(list), expanded = section === sec, sectionNote = settings.notes[sec];
      return <View key={sec} style={{ borderTopWidth: 1, borderColor: p.border, paddingTop: 8, gap: 6, opacity: mark === "na" ? 0.6 : 1 }}>
        <MotionPress accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setSection(s => s === sec ? null : sec)} style={[ui.between, { gap: 8, minHeight: 40 }]}>
          <View style={[ui.row, { gap: 8, flex: 1 }]}><Mark p={p} state={mark} /><Text style={{ color: p.text, fontWeight: "600", flex: 1 }}>{LAUNCH_SECTION_TITLE[sec]}</Text></View>
          <Feather name={expanded ? "chevron-up" : "chevron-down"} size={16} color={p.muted} />
        </MotionPress>
        {expanded && <View style={{ gap: 10, paddingLeft: 26 }}>
          {!!sectionNote && <Text style={[ui.small, { color: p.muted }]}>{sectionNote}</Text>}
          {list.map(s => <View key={s.key} style={{ gap: 6 }}>
            <View style={[ui.row, { gap: 8, alignItems: "flex-start" }]}>
              <Mark p={p} state={s.state} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: p.text, fontSize: 14 }}>{s.title}</Text>
                <Who p={p} who={s.who} />
                {s.state === "locked" && !!s.lockedBecause && <Text style={[ui.small, { color: p.muted }]}>{s.lockedBecause}</Text>}
                {s.state === "na" && <Text style={[ui.small, { color: p.muted }]}>Not needed for this property.</Text>}
                {s.state === "done" && <Done p={p} step={s} />}
              </View>
              {s.canTick && <Button p={p} quiet icon={openStep === s.key ? "x" : s.state === "done" ? "refresh-cw" : "edit-3"} label={openStep === s.key ? "Close" : s.state === "done" ? "Renew" : "Tick"} onPress={() => setOpenStep(o => o === s.key ? null : s.key)} />}
              {s.canReopen && <Button p={p} quiet icon="rotate-ccw" label="Reopen" disabled={busy} onPress={() => void act({ action: "reopen", step: s.key }, "Reopened.")} />}
            </View>
            {s.kind === "expiry" && <Certificates p={p} propertyId={propertyId} step={s} editable={s.canTick || s.canReopen} busy={busy}
              onChange={r => { setRead(r); setError(""); }} onRemove={fileId => void act({ action: "removeFile", step: s.key, fileId }, "Certificate removed.")} />}
            {!!s.ticketId && !owner && read.settings.boards[s.section] && <Text style={[ui.small, { color: p.muted }]}>{`Also on the ${boardName(read.settings.boards[s.section] ?? "")} board.`}</Text>}
            {openStep === s.key && <TickForm p={p} step={s} settings={settings} busy={busy} onTick={data => void act({ action: "tick", step: s.key, ...(data ? { data } : {}) }, "Ticked.")} />}
            {s.kind === "housekeeper" && v.canAllocate && <View style={{ gap: 6 }}>
              {read.housekeepers.length === 0 ? <Text style={[ui.small, { color: p.muted }]}>There are no active housekeepers yet. Raise a recruitment to-do with the role and area.</Text>
                : <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>{read.housekeepers.map(h => <Choice key={h.id} p={p} on={(hk || v.housekeeper?.id) === h.id} label={h.name} onPress={() => setHk(h.id)} />)}</View>}
              {!!hk && hk !== v.housekeeper?.id && <Button p={p} icon="user-check" label="Allocate" disabled={busy} onPress={() => void act({ action: "allocate", housekeeperId: hk }, "Allocated. The property is on their calendar from the readiness inspection.")} />}
            </View>}
            {s.kind === "readiness" && <View style={{ gap: 6 }}>
              {v.readiness && <Text style={[ui.small, { color: p.text }]}>{v.readiness.submittedAt
                ? `Submitted ${when(v.readiness.submittedAt)}${v.readiness.submittedByName ? ` by ${v.readiness.submittedByName}` : ""}. ${v.readiness.issues ? `${v.readiness.issues} sent to property maintenance.` : "No issues."}`
                : `Booked for ${day(v.readiness.bookedOn)} with ${v.readiness.housekeeperName ?? "the housekeeper"}.`}</Text>}
              {v.readiness?.evidence?.video && <Text selectable style={[ui.small, { color: p.primary }]}>{v.readiness.evidence.video}</Text>}
              {v.canBookReadiness && <>
                <DateField p={p} label="Readiness inspection date" mode="single" wholeMonthLink={false} empty="Choose a date" today={today()} value={{ from: readinessOn, to: readinessOn }} onChange={next => setReadinessOn(next.from)} />
                <Button p={p} icon="calendar" label={v.readiness ? "Change the date" : "Book the readiness inspection"} disabled={busy || !readinessOn}
                  onPress={() => void act({ action: "bookReadiness", date: readinessOn }, "Booked. The housekeeper and the owner have been told.")} />
              </>}
              {v.canSubmitReadiness && <Button p={p} icon="clipboard" label={form ? "Close the form" : "Fill in the readiness inspection"} onPress={() => setForm(f => !f)} />}
              {form && v.canSubmitReadiness && <ReadinessForm p={p} launch={v} settings={settings} onSubmitted={r => { setRead(r); setForm(false); setNote("Submitted. The property is guest ready."); }} />}
            </View>}
          </View>)}
        </View>}
      </View>;
    })}
    {!!error && <Notice p={p} tone="bad" text={error} />}
    {!!note && <Notice p={p} text={note} />}
  </View>;
}

// ---------------------------------------------------------------- a housekeeper's readiness inspections
export function HousekeeperInspections({ p }: { p: Palette }) {
  const [read, setRead] = useState<LaunchRead | null>(null), [open, setOpen] = useState<LaunchRead | null>(null), [error, setError] = useState(""), [done, setDone] = useState("");
  const load = useCallback(async () => { try { setRead(await readLaunch()); setError(""); } catch (e) { setError(message(e)); } }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  if (!read || (read.inspections.length === 0 && !done)) return error ? <Notice p={p} tone="bad" text={error} /> : null;
  return <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, padding: 14, gap: 10 }]}>
    <Text accessibilityRole="header" style={{ color: p.text, fontSize: 16, fontWeight: "700" }}>Readiness inspections</Text>
    <Text style={[ui.small, { color: p.muted }]}>The first changeover at a new property: check the inventory and every condition statement, and record the video.</Text>
    {read.inspections.map(x => <View key={x.propertyId} style={{ gap: 8 }}>
      <View style={[ui.between, { gap: 8 }]}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: p.text, fontWeight: "600" }}>{x.name}</Text>
          <Text style={[ui.small, { color: p.muted }]}>{`${day(x.bookedOn)}${x.address ? `. ${x.address.replace(/\s*\n\s*/g, ", ")}` : ""}`}</Text>
        </View>
        {x.bookedOn <= today() ? <Button p={p} icon={open?.launch?.propertyId === x.propertyId ? "x" : "clipboard"} label={open?.launch?.propertyId === x.propertyId ? "Close" : "Start"}
          onPress={() => { if (open?.launch?.propertyId === x.propertyId) setOpen(null); else readLaunch(x.propertyId).then(setOpen, e => setError(message(e))); }} />
          : <Tag p={p} label="Opens on the day" tone="plain" />}
      </View>
      {open?.launch?.propertyId === x.propertyId && open.launch.canSubmitReadiness && <ReadinessForm p={p} launch={open.launch} settings={open.settings}
        onSubmitted={() => { setOpen(null); setDone("Submitted. Thank you, the property is guest ready."); void load(); }} />}
    </View>)}
    {!!done && <Notice p={p} text={done} />}
    {!!error && <Notice p={p} tone="bad" text={error} />}
  </View>;
}

// ---------------------------------------------------------------- admins: the condition statements and notes
export function LaunchSettingsSheet({ p, visible, onClose }: { p: Palette; visible: boolean; onClose: () => void }) {
  const [read, setRead] = useState<LaunchRead | null>(null), [draft, setDraft] = useState<LaunchSettings | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false), [boardFor, setBoardFor] = useState<string | null>(null);
  const request = useRequestId("launch-settings:" + JSON.stringify(draft));
  const load = useCallback(async () => { try { const r = await readLaunch(); setRead(r); setDraft(r.settings); setError(""); } catch (e) { setError(message(e)); } }, []);
  useEffect(() => { if (!visible) return; let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [visible, load]);
  const canEdit = !!read?.canEditSettings;
  const set = (patch: Partial<LaunchSettings>) => { setSaved(false); setDraft(d => d ? { ...d, ...patch } : d); };
  const setStatement = (i: number, patch: Partial<LaunchSettings["condition"][number]>) => draft && set({ condition: draft.condition.map((c, j) => j === i ? { ...c, ...patch } : c) });
  const move = (i: number, by: -1 | 1) => { if (!draft) return; const next = [...draft.condition]; const [x] = next.splice(i, 1); next.splice(i + by, 0, x); set({ condition: next }); };
  async function save() {
    if (!draft) return;
    const parsed = launchSettingsSchema.safeParse(draft);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check the settings"); return; }
    setBusy(true); setError("");
    try { const r = launchReadSchema.parse((await liveApi("/launch", { action: "saveSettings", requestId: request.get(), settings: parsed.data })).data); setRead(r); setDraft(r.settings); request.done(); setSaved(true); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible={visible} onClose={onClose} title="Launch preparation" subtitle="The condition checklist, notes, safety reminders and task boards" icon="check-square" width={720}>
      <View style={{ gap: 14 }}>
        {!draft && !error && <Loading p={p} rows={4} />}
        {draft && <>
          <Text accessibilityRole="header" style={{ color: p.text, fontWeight: "700" }}>{`Condition statements (${draft.condition.length})`}</Text>
          <Text style={[ui.small, { color: p.muted }]}>Checked at set-up and again by the housekeeper at the readiness inspection.</Text>
          {draft.condition.map((c, i) => <View key={c.key} style={{ gap: 6, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: p.border }}>
            {canEdit ? <>
              <Field p={p} label={`${i + 1}. Title`} value={c.title} onChange={v => setStatement(i, { title: v.slice(0, 120) })} />
              <Field p={p} multiline label="Statement" value={c.text} onChange={v => setStatement(i, { text: v.slice(0, 1000) })} />
              <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>
                <Button p={p} quiet icon="arrow-up" label="Earlier" disabled={i === 0} onPress={() => move(i, -1)} />
                <Button p={p} quiet icon="arrow-down" label="Later" disabled={i === draft.condition.length - 1} onPress={() => move(i, 1)} />
                <Button p={p} quiet icon="trash-2" label="Remove" disabled={draft.condition.length <= 1} onPress={() => set({ condition: draft.condition.filter((_, j) => j !== i) })} />
              </View>
            </> : <><Text style={{ color: p.text, fontWeight: "600" }}>{`${i + 1}. ${c.title}`}</Text><Text style={[ui.small, { color: p.muted }]}>{c.text}</Text></>}
          </View>)}
          {canEdit && draft.condition.length < 30 && <Button p={p} icon="plus" label="Add a statement" onPress={() => set({ condition: [...draft.condition, { key: statementKey("statement", draft.condition.map(c => c.key)), title: "New statement", text: "Describe what must be true." }] })} />}
          <Text accessibilityRole="header" style={{ color: p.text, fontWeight: "700" }}>Notes under each part</Text>
          {LAUNCH_SECTIONS.map(sec => canEdit
            ? <Field key={sec} p={p} multiline label={LAUNCH_SECTION_TITLE[sec]} value={draft.notes[sec] ?? ""} onChange={v => set({ notes: { ...draft.notes, [sec]: v.slice(0, 1000) } })} />
            : draft.notes[sec] ? <Text key={sec} style={[ui.small, { color: p.text }]}>{`${LAUNCH_SECTION_TITLE[sec]}: ${draft.notes[sec]}`}</Text> : null)}
          <View style={[ui.between, { gap: 8 }]}>
            <Text style={{ color: p.text, fontSize: 14, flex: 1 }}>The readiness inspection needs the changeover video</Text>
            <Switch accessibilityLabel="The readiness inspection needs the changeover video" value={draft.requireVideo} disabled={!canEdit} onValueChange={v => set({ requireVideo: v })} />
          </View>
          <Text accessibilityRole="header" style={{ color: p.text, fontWeight: "700" }}>Safety compliance</Text>
          <View style={[ui.between, { gap: 8 }]}>
            <Text style={{ color: p.text, fontSize: 14, flex: 1 }}>Each document needs its certificate uploaded</Text>
            <Switch accessibilityLabel="Each document needs its certificate uploaded" value={draft.requireComplianceFile} disabled={!canEdit} onValueChange={v => set({ requireComplianceFile: v })} />
          </View>
          <Text style={{ color: p.text, fontSize: 14 }}>Remind the owner, and raise a renewal ticket, this many months before a certificate expires</Text>
          <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>{[1, 2, 3, 4, 5, 6].map(m => <Choice key={m} p={p} on={draft.reminderMonths === m} label={`${m} month${m === 1 ? "" : "s"}`} onPress={() => canEdit && set({ reminderMonths: m })} />)}</View>
          <Text accessibilityRole="header" style={{ color: p.text, fontWeight: "700" }}>Task boards</Text>
          <Text style={[ui.small, { color: p.muted }]}>Each of Recharge's parts also goes on this board as a ticket. Ticking either one completes both. Set-up, garden, the housekeeper and licensing have their own onboarding tickets.</Text>
          {TICKET_SECTIONS.map(sec => <View key={sec} style={{ gap: 6 }}>
            <View style={[ui.between, { gap: 8 }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: p.text, fontSize: 14, fontWeight: "600" }}>{LAUNCH_SECTION_TITLE[sec]}</Text>
                <Text style={[ui.small, { color: p.muted }]}>{draft.boards[sec] ? boardName(draft.boards[sec] ?? "") : "No ticket"}</Text>
              </View>
              {canEdit && <Button p={p} quiet icon={boardFor === sec ? "x" : "edit-3"} label={boardFor === sec ? "Close" : "Change"} onPress={() => setBoardFor(b => b === sec ? null : sec)} />}
            </View>
            {canEdit && boardFor === sec && <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>
              {[...(read?.boardIds ?? []).filter(b => MODULES.some(m => m.id === b)), ""].map(b => <Choice key={b || "none"} p={p} on={(draft.boards[sec] ?? "") === b} label={b ? boardName(b) : "No ticket"}
                onPress={() => { set({ boards: { ...draft.boards, [sec]: b } }); setBoardFor(null); }} />)}
            </View>}
          </View>)}
        </>}
        {!!error && <Notice p={p} tone="bad" text={error} />}
        {saved && <Notice p={p} text="Saved. New checks use these from now on." />}
        {read && !canEdit && <Notice p={p} text="Only admins can change Launch Preparation." />}
        {read?.settingsUpdatedByName && read.settingsUpdatedAt && <Text style={[ui.small, { color: p.muted }]}>{`Last changed by ${read.settingsUpdatedByName}, ${when(read.settingsUpdatedAt)}.`}</Text>}
        {canEdit && draft && <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
          <Button p={p} quiet icon="rotate-ccw" label="Back to the starting wording" onPress={() => { setSaved(false); setDraft(DEFAULT_LAUNCH_SETTINGS); }} />
          <Button p={p} primary icon="check" label="Save" disabled={busy} onPress={() => void save()} />
        </View>}
      </View>
    </Sheet>
  );
}
