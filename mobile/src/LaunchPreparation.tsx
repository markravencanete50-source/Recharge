import { useCallback, useEffect, useState } from "react";
import { Linking, Platform, Switch, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { Button, Field, Loading, Notice, Tag, message, useRequestId } from "./LiveKit";
import { Sheet } from "./TeamFlows";
import { DateField } from "./CalendarPicker";
import { liveApi } from "./LivePages";
import { ui, type Palette } from "./theme";
import { launchFileLink, liveApiOrigin, uploadLaunchFile } from "./backend/client";
import { PropertyDetails } from "./FurnishingStudio";
import { RequestRoleSheet, readRecruitment } from "./LiveRecruitment";
import type { RecruitmentRead } from "../../lib/recruitment";
import { categoryName, normaliseInputs, type StudioInputs } from "../../lib/furnishing-studio";
import { MODULES } from "../../lib/modules";
import {
  BOARD_TITLE, DEFAULT_LAUNCH_SETTINGS, GARDEN_FREQUENCIES, GARDEN_FREQUENCY_LABEL, LAUNCH_FILE_MIMES, LAUNCH_SECTIONS, TICKET_SECTIONS, LAUNCH_SECTION_TITLE, launchActionSchema, launchProgress, launchReadSchema, launchSettingsSchema, sectionMark, statementKey,
  type LaunchFurnishing, type LaunchRead, type LaunchSettings, type LaunchStep, type LaunchView,
} from "../../lib/launch-preparation";

// Launch Preparation (Business Plan v1.0, migration 20261029100000): the checklist from the onboarding package to going
// live. On the lead the team ticks Recharge's parts, allocates the housekeeper and books the readiness inspection; in the
// owner's app the owner sees every part (Recharge's marked with a bolt, theirs with a person) and ticks their own; the
// housekeeper fills in the readiness inspection form, which makes the property guest ready. Admins edit the condition
// statements, notes, reminders and boards from the Leads page. Safety documents carry their certificate (20261029200000)
// and each of Recharge's parts is mirrored as a ticket on its board. The inventory (20261029400000) is calculated from the
// property's details with the Furnishing Studio presets, agreed by the owner when Recharge sets up, then ticked off. The
// guest guidebook (20261029500000) is filled in by the booked technician and shared with guests by a private link.
const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(new Date(iso + "T12:00:00Z"));
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());

const boardName = (id: string) => MODULES.find(m => m.id === id)?.name ?? id;

// No housekeeper free for the property: ask recruitment for one (Business Plan: "raise a ticket on the recruitment board
// with the role and area required"), with the property and its area filled in.
function AskHousekeeper({ p, propertyId, name, address }: { p: Palette; propertyId: string; name: string; address: string | null }) {
  const [rec, setRec] = useState<RecruitmentRead | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [sent, setSent] = useState(false);
  const area = (address ?? "").split(/\n|,/).map(x => x.trim()).filter(Boolean).slice(-2).join(", ");
  async function open() {
    setBusy(true); setError("");
    try { setRec(await readRecruitment()); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const job = rec?.settings.jobs.find(j => j.role === "cleans");
  return <View style={{ gap: 6 }}>
    {sent ? <Text style={[ui.small, { color: p.success }]}>Recruitment have the request. You can follow it on the Recruitment page.</Text>
      : <Button p={p} quiet icon="user-plus" label={busy ? "Opening…" : "Ask recruitment for a housekeeper"} disabled={busy} onPress={() => void open()} />}
    {!!error && <Notice text={error} p={p} tone="bad" />}
    {rec && <RequestRoleSheet p={p} read={rec} initial={{ jobKey: job?.key, area, propertyId, notes: `Housekeeper for ${name || "a new property"}${address ? ` (${address.replace(/\n/g, ", ")})` : ""}.` }}
      onClose={() => setRec(null)} onDone={() => { setRec(null); setSent(true); }} />}
  </View>;
}

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
  const [allPresent, setAllPresent] = useState<boolean | null>(null), [missing, setMissing] = useState(""), [picked, setPicked] = useState<string[]>([]);
  const listed = (launch.inventory?.items ?? []).filter(x => x.kept);
  const [marks, setMarks] = useState<Record<string, { ok: boolean | null; note: string }>>({});
  const [video, setVideo] = useState(""), [note, setNote] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const request = useRequestId("readiness:" + launch.propertyId);
  const answered = settings.condition.filter(c => marks[c.key]?.ok !== null && marks[c.key]?.ok !== undefined).length;
  async function submit() {
    const body = {
      action: "submitReadiness", requestId: request.get(), propertyId: launch.propertyId,
      inventory: { allPresent: allPresent === true, missing: allPresent ? [] : [...picked, ...missing.split(/\n|,/).map(x => x.trim()).filter(Boolean)].slice(0, 50) },
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
      {allPresent === false && listed.length > 0 && <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>
        {listed.map(x => { const name = `${x.quantity} x ${x.name}`; return <Choice key={x.itemId} p={p} on={picked.includes(name)} label={name} onPress={() => setPicked(all => all.includes(name) ? all.filter(y => y !== name) : [...all, name])} />; })}
      </View>}
      {allPresent === false && <Field p={p} multiline label={listed.length ? "Anything else missing (one per line)" : "What is missing (one per line)"} value={missing} onChange={v => setMissing(v.slice(0, 4000))} />}
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
            {s.kind.startsWith("guidebook") && s.state !== "locked" && <GuidebookStep p={p} propertyId={propertyId} step={s} launch={v} read={read} busy={busy}
              act={(body, done) => void act(body, done)} onRead={r => { setRead(r); setError(""); }} />}
            {s.kind === "gardenQuote" && s.state !== "locked" && <GardenStep p={p} launch={v} busy={busy} act={(body, done) => void act(body, done)} />}
            {s.kind === "inventory" && s.state !== "locked" && <InventoryStep p={p} launch={v} busy={busy} act={(body, done) => void act(body, done)} />}
            {(s.kind.startsWith("furnishing") || s.key === "setUp.invoice") && <FurnishingStep p={p} propertyId={propertyId} step={s} launch={v} read={read} busy={busy} act={(body, done) => void act(body, done)} onRead={r => { setRead(r); setError(""); }} />}
            {/* Recharge's safety documents are property maintenance jobs (20261029700000): quote, approval, visit and invoice there. */}
            {!!s.ticketId && s.section === "compliance" && s.state !== "done" && <Text style={[ui.small, { color: p.muted }]}>{owner
              ? "We are arranging this. You will be asked to approve the contractor's quote in Repairs."
              : "A property maintenance job: the contractor's quote, approvals, visit and invoice go through Maintenance. Upload the certificate here when it is done."}</Text>}
            {!!s.ticketId && !owner && s.section !== "compliance" && read.settings.boards[s.section === "setUp" ? "furnishing" : s.section] && <Text style={[ui.small, { color: p.muted }]}>{`Also on the ${boardName(read.settings.boards[s.section === "setUp" ? "furnishing" : s.section] ?? "")} board.`}</Text>}
            {openStep === s.key && <TickForm p={p} step={s} settings={settings} busy={busy} onTick={data => void act({ action: "tick", step: s.key, ...(data ? { data } : {}) }, "Ticked.")} />}
            {s.kind === "housekeeper" && v.canAllocate && <View style={{ gap: 6 }}>
              {read.housekeepers.length === 0 ? <Text style={[ui.small, { color: p.muted }]}>There are no active housekeepers yet. Ask recruitment for one, with the area.</Text>
                : <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>{read.housekeepers.map(h => <Choice key={h.id} p={p} on={(hk || v.housekeeper?.id) === h.id} label={h.name} onPress={() => setHk(h.id)} />)}</View>}
              {!!hk && hk !== v.housekeeper?.id && <Button p={p} icon="user-check" label="Allocate" disabled={busy} onPress={() => void act({ action: "allocate", housekeeperId: hk }, "Allocated. The property is on their calendar from the readiness inspection.")} />}
              {!v.housekeeper && <AskHousekeeper p={p} propertyId={propertyId} name={v.name} address={v.address} />}
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

// ---------------------------------------------------------------- the guest guidebook
// The team book the technician and the date; the technician (or the team) fills in each section of the template with
// words, a video link and photos, plus the Wi-Fi and both key box codes, then submits. Guests get a private link.
type GuideDraft = { content: Record<string, { text: string; videoUrl: string }>; wifiName: string; wifiPassword: string; guestCode: string; teamCode: string };
function GuidebookStep({ p, propertyId, step, launch, read, busy, act, onRead }: {
  p: Palette; propertyId: string; step: LaunchStep; launch: LaunchView; read: LaunchRead; busy: boolean;
  act: (body: Record<string, unknown>, done: string) => void; onRead: (r: LaunchRead) => void;
}) {
  const g = launch.guidebook;
  const [who, setWho] = useState(""), [on, setOn] = useState(""), [draft, setDraft] = useState<{ at: string | null; value: GuideDraft } | null>(null), [note, setNote] = useState("");
  if (!g) return null;
  if (step.kind === "guidebookBook") {
    const booked = g.technician ? `${g.technician.name}${g.bookOn ? `, ${day(g.bookOn)}` : ""}` : "";
    return <View style={{ gap: 6 }}>
      {!!booked && <Text style={[ui.small, { color: p.text }]}>{`Booked: ${booked}.`}</Text>}
      {g.canBook && <>
        <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>{read.installers.map(x => <Choice key={x.id} p={p} on={(who || g.technician?.id) === x.id} label={x.name} onPress={() => setWho(x.id)} />)}</View>
        <DateField p={p} label="Date" mode="single" wholeMonthLink={false} empty="Choose a date" today={today()} value={{ from: on || g.bookOn || "", to: on || g.bookOn || "" }} onChange={next => setOn(next.from)} />
        <Button p={p} icon="calendar" label={g.technician ? "Change the booking" : "Book the technician"} disabled={busy || !(who || g.technician?.id) || !(on || g.bookOn)}
          onPress={() => act({ action: "bookGuidebook", technicianId: who || g.technician?.id, date: on || g.bookOn }, "Booked. The technician has been told.")} />
      </>}
    </View>;
  }
  const fresh = (): GuideDraft => ({
    content: Object.fromEntries(g.sections.map(x => [x.key, { text: x.text, videoUrl: x.videoUrl }])),
    wifiName: g.wifiName ?? "", wifiPassword: g.wifiPassword ?? "", guestCode: g.guestCode ?? "", teamCode: g.teamCode ?? "",
  });
  // The form is kept against the last save; a newer save (by anyone) starts it again from what is stored.
  const form = draft && draft.at === (g.savedAt ?? g.submittedAt) ? draft.value : fresh();
  const change = (patch: Partial<GuideDraft>) => setDraft({ at: g.savedAt ?? g.submittedAt, value: { ...form, ...patch } });
  const section = (key: string, patch: Partial<{ text: string; videoUrl: string }>) => change({ content: { ...form.content, [key]: { ...(form.content[key] ?? { text: "", videoUrl: "" }), ...patch } } });
  const link = g.guestPath ? (liveApiOrigin() ?? "") + g.guestPath : "";
  async function copy() {
    try {
      if (Platform.OS === "web" && globalThis.navigator?.clipboard) { await globalThis.navigator.clipboard.writeText(link); setNote("Link copied. Share it with guests; anyone with it can read the guidebook."); }
      else await Linking.openURL(link);
    } catch (e) { setNote(message(e)); }
  }
  return <View style={{ gap: 8 }}>
    <Text style={[ui.small, { color: p.muted }]}>{g.submittedAt ? `Submitted ${when(g.submittedAt)}${g.submittedByName ? ` by ${g.submittedByName}` : ""}.`
      : g.savedAt ? `Draft saved ${when(g.savedAt)}${g.savedByName ? ` by ${g.savedByName}` : ""}.` : g.canEdit ? "Fill in each section. The address is added for you." : "The technician fills this in."}</Text>
    {g.sections.map(x => <View key={x.key} style={{ gap: 6, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: p.border }}>
      <Text style={{ color: p.text, fontWeight: "600" }}>{x.title}</Text>
      {g.canEdit ? <>
        {!!x.prompt && <Text style={[ui.small, { color: p.muted }]}>{x.prompt}</Text>}
        <Field p={p} multiline label="What guests need to know" value={form.content[x.key]?.text ?? ""} onChange={v => section(x.key, { text: v.slice(0, 5000) })} />
        <Field p={p} label="Video link (optional)" value={form.content[x.key]?.videoUrl ?? ""} placeholder="https://" onChange={v => section(x.key, { videoUrl: v.slice(0, 1000) })} />
        {x.key === "access" && <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
          <View style={{ flex: 1, minWidth: 160 }}><Field p={p} label="Guest key box code (shown to guests)" value={form.guestCode} onChange={v => change({ guestCode: v.slice(0, 60) })} /></View>
          <View style={{ flex: 1, minWidth: 160 }}><Field p={p} label="Team key box code (never shown to guests)" value={form.teamCode} onChange={v => change({ teamCode: v.slice(0, 60) })} /></View>
        </View>}
        {x.key === "wifi" && <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
          <View style={{ flex: 1, minWidth: 160 }}><Field p={p} label="Wi-Fi name" value={form.wifiName} onChange={v => change({ wifiName: v.slice(0, 120) })} /></View>
          <View style={{ flex: 1, minWidth: 160 }}><Field p={p} label="Wi-Fi password" value={form.wifiPassword} onChange={v => change({ wifiPassword: v.slice(0, 120) })} /></View>
        </View>}
      </> : <>
        {!!x.text && <Text style={[ui.small, { color: p.text }]}>{x.text}</Text>}
        {!!x.videoUrl && <Text selectable style={[ui.small, { color: p.primary }]}>{x.videoUrl}</Text>}
        {x.key === "access" && !!(g.guestCode || g.teamCode) && <Text style={[ui.small, { color: p.text }]}>{[g.guestCode ? `Guest code ${g.guestCode}` : "", g.teamCode ? `team code ${g.teamCode}` : ""].filter(Boolean).join(", ")}</Text>}
        {x.key === "wifi" && !!g.wifiName && <Text style={[ui.small, { color: p.text }]}>{`Wi-Fi ${g.wifiName}${g.wifiPassword ? `, password ${g.wifiPassword}` : ""}`}</Text>}
      </>}
      <Photos p={p} propertyId={propertyId} step={`guidebook:${x.key}`} photos={x.photos} editable={g.canEdit} busy={busy} onChange={onRead}
        onRemove={fileId => act({ action: "removeFile", step: `guidebook:${x.key}`, fileId }, "Photo removed.")} />
    </View>)}
    {g.canEdit && <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
      <Button p={p} quiet icon="download" label="Save the draft" disabled={busy} onPress={() => act({ action: "saveGuidebook", ...form }, "Draft saved.")} />
      <Button p={p} primary icon="check" label="Submit the guidebook" disabled={busy} onPress={() => act({ action: "submitGuidebook", ...form }, "Submitted. The owner and the team have been told.")} />
    </View>}
    {!!link && <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
      <Button p={p} quiet icon="external-link" label={Platform.OS === "web" ? "Copy the guest link" : "Open the guest version"} onPress={() => void copy()} />
      {g.canResetLink && <Button p={p} quiet icon="refresh-cw" label="Replace the link" disabled={busy} onPress={() => act({ action: "resetGuidebookLink" }, "A new guest link is ready. The old one no longer works.")} />}
      {g.canReopen && <Button p={p} quiet icon="edit-3" label="Reopen to change it" disabled={busy} onPress={() => act({ action: "reopenGuidebook" }, "Reopened. Submit it again once it is updated.")} />}
    </View>}
    {!!note && <Text style={[ui.small, { color: p.muted }]}>{note}</Text>}
  </View>;
}

// Guidebooks the signed-in technician is booked to fill in, on Home.
export function GuidebookWork({ p }: { p: Palette }) {
  const [read, setRead] = useState<LaunchRead | null>(null), [open, setOpen] = useState<string | null>(null), [error, setError] = useState("");
  const load = useCallback(async () => { try { setRead(await readLaunch()); setError(""); } catch (e) { setError(message(e)); } }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  if (!read || read.guidebookWork.length === 0) return null;
  return <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, padding: 14, gap: 10 }]}>
    <Text accessibilityRole="header" style={{ color: p.text, fontSize: 16, fontWeight: "700" }}>Guest guidebooks</Text>
    <Text style={[ui.small, { color: p.muted }]}>New properties you are booked to create the guidebook for. Fill in each section with photos and videos, then submit.</Text>
    {read.guidebookWork.map(x => <View key={x.propertyId} style={{ gap: 8 }}>
      <View style={[ui.between, { gap: 8 }]}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: p.text, fontWeight: "600" }}>{x.name}</Text>
          <Text style={[ui.small, { color: p.muted }]}>{[x.address, x.bookOn ? `booked for ${day(x.bookOn)}` : ""].filter(Boolean).join(", ")}</Text>
        </View>
        <Button p={p} quiet icon={open === x.propertyId ? "x" : "chevron-right"} label={open === x.propertyId ? "Close" : "Open"} onPress={() => setOpen(o => o === x.propertyId ? null : x.propertyId)} />
      </View>
      {open === x.propertyId && <LaunchPanel p={p} propertyId={x.propertyId} />}
    </View>)}
    {!!error && <Notice p={p} tone="bad" text={error} />}
  </View>;
}

// ---------------------------------------------------------------- the inventory
// Whoever sets the property up enters its details; the Furnishing Studio presets work out each item, required or
// additional. Additional items can be removed (when Recharge sets up, the owner accepts or rejects them and approves the
// list); then each item is ticked as in the property.
function InventoryStep({ p, launch, busy, act }: { p: Palette; launch: LaunchView; busy: boolean; act: (body: Record<string, unknown>, done: string) => void }) {
  const inv = launch.inventory;
  // The details being entered, for the calculation they were opened against (a new calculation closes them).
  const [draft, setDraft] = useState<{ at: string | null; inputs: StudioInputs } | null>(null), [open, setOpen] = useState(false);
  if (!inv) return null;
  const inputs = draft && draft.at === inv.calculatedAt ? draft.inputs : null;
  const rs = inv.rechargeSetsUp, calculated = !!inv.calculatedAt, waiting = inv.items.filter(x => x.kept === null).length;
  const status = !calculated ? (inv.canCalculate ? "Enter the property's details and the inventory is worked out from Recharge's presets." : "Recharge are preparing the inventory.")
    : !inv.approvedAt ? (inv.canApprove || inv.canDecide ? (waiting ? `Accept or reject the ${waiting} additional ${waiting === 1 ? "item" : "items"}, then approve the inventory.` : "Approve the inventory.") : `Waiting for the owner to approve${waiting ? ` (${waiting} additional ${waiting === 1 ? "item" : "items"} to decide)` : ""}.`)
    : `${inv.counts.checked} of ${inv.counts.total} items in the property.`;
  const groups = [...new Set(inv.items.map(x => x.category))];
  // Additional items: undecided ones can be accepted or rejected; decided ones changed back.
  const decide = (x: (typeof inv.items)[number]) => inv.canDecide && x.kind === "additional" ? (x.kept === null ? [true, false] : [!x.kept]) : [];
  return <View style={{ gap: 8 }}>
    <Text style={[ui.small, { color: p.text }]}>{status}</Text>
    {calculated && <Text style={[ui.small, { color: p.muted }]}>{[inv.calculatedByName ? `Calculated by ${inv.calculatedByName} ${when(inv.calculatedAt!)}` : "", rs && inv.approvedAt ? `Approved by ${inv.approvedByName ?? "the owner"} ${when(inv.approvedAt)}` : ""].filter(Boolean).join(". ")}</Text>}
    <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
      {inv.canCalculate && !inputs && <Button p={p} quiet icon={calculated ? "refresh-cw" : "edit-3"} label={calculated ? "Change the details" : "Enter the property details"} onPress={() => setDraft({ at: inv.calculatedAt, inputs: normaliseInputs((inv.inputs ?? {}) as Partial<StudioInputs>) })} />}
      {calculated && <Button p={p} quiet icon={open ? "chevron-up" : "list"} label={open ? "Hide the inventory" : `Show the inventory (${inv.items.length})`} onPress={() => setOpen(o => !o)} />}
      {inv.canApprove && <Button p={p} primary icon="check" label="Approve the inventory" disabled={busy} onPress={() => act({ action: "approveInventory" }, "Approved. Recharge will make sure everything is in the property.")} />}
    </View>
    {!!inputs && <View style={{ gap: 8, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: p.border }}>
      <PropertyDetails p={p} inputs={inputs} onChange={next => setDraft({ at: inv.calculatedAt, inputs: next })} />
      {calculated && rs && <Notice p={p} text="Recalculating asks the owner to approve the inventory again. Their decisions on additional items are kept." />}
      <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
        <Button p={p} primary icon="check" label={calculated ? "Recalculate the inventory" : "Calculate the inventory"} disabled={busy}
          onPress={() => { act({ action: "calculateInventory", inputs }, rs ? "Calculated. The owner has been asked to approve it." : "Calculated. Tick each item as it is in the property."); setOpen(true); }} />
        <Button p={p} quiet icon="x" label="Cancel" onPress={() => setDraft(null)} />
      </View>
    </View>}
    {open && groups.map(g => <View key={g} style={{ gap: 4 }}>
      <Text style={[ui.small, { color: p.muted, fontWeight: "700" }]}>{categoryName(g)}</Text>
      {inv.items.filter(x => x.category === g).map(x => {
        const label = `${x.quantity} x ${x.name}`, detail = [x.unit !== "each" ? x.unit : "", x.kind === "additional" ? "Additional" : "", x.kept === false ? "Removed" : "",
          x.checkedAt ? `In the property${x.checkedByName ? `, ticked by ${x.checkedByName}` : ""}` : ""].filter(Boolean).join(". ");
        return <View key={x.itemId} style={[ui.row, { gap: 8, opacity: x.kept === false ? 0.55 : 1 }]}>
          <View style={{ flex: 1 }}>
            {inv.canCheck && x.kept ? <Check p={p} on={!!x.checkedAt} label={label} detail={detail} onPress={() => act({ action: "checkInventory", itemId: x.itemId, present: !x.checkedAt }, x.checkedAt ? "Unticked." : "Ticked.")} />
              : <View style={{ gap: 2, paddingVertical: 4 }}><Text style={{ color: p.text, fontSize: 14 }}>{label}</Text>{!!detail && <Text style={[ui.small, { color: p.muted }]}>{detail}</Text>}</View>}
          </View>
          {decide(x).map(keep => <Button key={String(keep)} p={p} quiet icon={keep ? "check" : "x"} label={keep ? (rs ? "Accept" : "Add back") : rs ? "Reject" : "Remove"} disabled={busy}
            onPress={() => act({ action: "decideInventory", itemId: x.itemId, keep }, keep ? "Kept on the inventory." : "Removed from the inventory.")} />)}
        </View>;
      })}
    </View>)}
  </View>;
}

// ---------------------------------------------------------------- the furnishing (Recharge sets up)
// ---------------------------------------------------------------- garden maintenance (20261029800000)
// The team add the contractor's quote (who, the price a month or a visit, how often, what it covers); the owner accepts it
// or rejects it and says why. A rejected quote leaves room for a new one.
function GardenStep({ p, launch, busy, act }: { p: Palette; launch: LaunchView; busy: boolean; act: (body: Record<string, unknown>, done: string) => void }) {
  const g = launch.garden;
  const [contractor, setContractor] = useState(""), [price, setPrice] = useState(""), [basis, setBasis] = useState<"month" | "visit">("month");
  const [frequency, setFrequency] = useState<(typeof GARDEN_FREQUENCIES)[number]>("weekly"), [details, setDetails] = useState(""), [reason, setReason] = useState(""), [adding, setAdding] = useState(false);
  if (!g) return null;
  const waiting = g.quotes.some(q => q.status === "sent");
  const pence = Math.round(Number(price.replace(/[£,\s]/g, "")) * 100);
  const STATUS = { sent: "Waiting for the owner", accepted: "Accepted", rejected: "Rejected", withdrawn: "Replaced" } as const;
  return <View style={{ gap: 6 }}>
    {!g.quotes.length && <Text style={[ui.small, { color: p.muted }]}>{launch.isTeam ? "Get a quote for regular garden maintenance from a contractor and add it here for the owner." : "We are getting a quote for regular garden maintenance. You will be able to accept it here."}</Text>}
    {g.quotes.map(q => <View key={q.id} style={{ gap: 4, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: p.border, opacity: q.status === "withdrawn" ? 0.6 : 1 }}>
      <View style={[ui.between, { gap: 8 }]}>
        <Text style={{ color: p.text, fontWeight: "600", flex: 1 }}>{`${pounds(q.pricePence)} a ${q.basis}, ${GARDEN_FREQUENCY_LABEL[q.frequency].toLowerCase()} visits`}</Text>
        <Tag p={p} label={STATUS[q.status]} tone={q.status === "accepted" ? "good" : q.status === "sent" ? "wait" : "plain"} />
      </View>
      <Text style={[ui.small, { color: p.muted }]}>{`${q.contractor}. Sent ${when(q.sentAt)}${q.sentByName ? ` by ${q.sentByName}` : ""}.`}</Text>
      {!!q.details && <Text style={[ui.small, { color: p.text }]}>{q.details}</Text>}
      {!!q.decidedAt && <Text style={[ui.small, { color: p.muted }]}>{`${q.status === "accepted" ? "Accepted" : "Rejected"} ${when(q.decidedAt)}${q.decidedByName ? ` by ${q.decidedByName}` : ""}${q.reason ? `: ${q.reason}` : "."}`}</Text>}
      {g.canDecide && q.status === "sent" && <View style={{ gap: 6 }}>
        <Field p={p} label="Note (needed if you reject it: say why)" value={reason} multiline onChange={t => setReason(t.slice(0, 1000))} />
        <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
          <Button p={p} primary icon="check" label="Accept this quote" disabled={busy} onPress={() => act({ action: "decideGardenQuote", quoteId: q.id, decision: "accept", ...(reason.trim() ? { reason } : {}) }, "Accepted. We will arrange the garden maintenance.")} />
          <Button p={p} quiet icon="x" label="Reject" disabled={busy || reason.trim().length < 3} onPress={() => act({ action: "decideGardenQuote", quoteId: q.id, decision: "reject", reason }, "Rejected. We will come back with another quote.")} />
        </View>
      </View>}
    </View>)}
    {g.canQuote && (adding ? <View style={{ gap: 6 }}>
      <Field p={p} label="Contractor" value={contractor} onChange={t => setContractor(t.slice(0, 200))} />
      <Field p={p} label="Price (£)" value={price} placeholder="120.00" onChange={t => setPrice(t.replace(/[^0-9.,£]/g, "").slice(0, 12))} />
      <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>
        <Choice p={p} on={basis === "month"} label="A month" onPress={() => setBasis("month")} />
        <Choice p={p} on={basis === "visit"} label="A visit" onPress={() => setBasis("visit")} />
      </View>
      <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>{GARDEN_FREQUENCIES.map(f => <Choice key={f} p={p} on={frequency === f} label={GARDEN_FREQUENCY_LABEL[f]} onPress={() => setFrequency(f)} />)}</View>
      <Field p={p} label="What it covers" value={details} multiline placeholder="Grass cut and edged, beds weeded, clippings taken away" onChange={t => setDetails(t.slice(0, 2000))} />
      <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
        <Button p={p} primary icon="send" label={waiting ? "Replace the quote" : "Send to the owner"} disabled={busy || !contractor.trim() || !(pence > 0)}
          onPress={() => { act({ action: "addGardenQuote", contractor, pricePence: pence, basis, frequency, details }, "Sent. The owner has been told in the property chat."); setAdding(false); }} />
        <Button p={p} quiet icon="x" label="Cancel" onPress={() => setAdding(false)} />
      </View>
    </View> : <Button p={p} quiet icon="plus" label={waiting ? "Replace the quote" : g.quotes.length ? "Add a new quote" : "Add the quote"} onPress={() => setAdding(true)} />)}
  </View>;
}

const pounds = (pence: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(pence / 100);

// Photos of furnishing (one item as it arrives, or the finished install): open, add and remove.
function Photos({ p, propertyId, step, lineId, photos, editable, busy, onChange, onRemove }: {
  p: Palette; propertyId: string; step: string; lineId?: string; photos: LaunchFurnishing["installPhotos"]; editable: boolean; busy: boolean;
  onChange: (r: LaunchRead) => void; onRemove: (fileId: string) => void;
}) {
  const [uploading, setUploading] = useState(false), [error, setError] = useState("");
  async function add() {
    setError("");
    const picked = await DocumentPicker.getDocumentAsync({ type: ["image/jpeg", "image/png", "image/webp"], copyToCacheDirectory: true, multiple: true });
    if (picked.canceled) return;
    setUploading(true);
    try {
      for (const asset of picked.assets ?? []) onChange(launchReadSchema.parse(await uploadLaunchFile(propertyId, step, { uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? "image/jpeg", file: (asset as { file?: File }).file }, lineId)));
    } catch (e) { setError(message(e)); } finally { setUploading(false); }
  }
  async function open(fileId: string) { try { await Linking.openURL((await launchFileLink(propertyId, fileId)).url); } catch (e) { setError(message(e)); } }
  return <View style={{ gap: 4 }}>
    {photos.map(f => <View key={f.id} style={[ui.row, { gap: 6 }]}>
      <Feather name="image" size={14} color={p.muted} />
      <Text numberOfLines={1} style={[ui.small, { color: p.text, flex: 1 }]}>{`${f.name}, ${when(f.uploadedAt)}`}</Text>
      <Button p={p} quiet icon="external-link" label="Open" onPress={() => void open(f.id)} />
      {editable && <Button p={p} quiet icon="trash-2" label="Remove" disabled={busy} onPress={() => onRemove(f.id)} />}
    </View>)}
    {editable && <Button p={p} quiet icon="camera" label={uploading ? "Uploading" : photos.length ? "Add more photos" : "Add a photo"} disabled={uploading || busy} onPress={() => void add()} />}
    {!!error && <Notice p={p} tone="bad" text={error} />}
  </View>;
}

function FurnishingStep({ p, propertyId, step, launch, read, busy, act, onRead }: {
  p: Palette; propertyId: string; step: LaunchStep; launch: LaunchView; read: LaunchRead; busy: boolean;
  act: (body: Record<string, unknown>, done: string) => void; onRead: (r: LaunchRead) => void;
}) {
  const f = launch.furnishing;
  const [openQuote, setOpenQuote] = useState<string | null>(null), [note, setNote] = useState(""), [installer, setInstaller] = useState(""), [address, setAddress] = useState("");
  const [eta, setEta] = useState(""), [picked, setPicked] = useState<string[]>([]), [installOn, setInstallOn] = useState("");
  if (!f) return null;
  const removePhoto = (stepKey: string, lineId?: string) => (fileId: string) => act({ action: "removeFile", step: stepKey, fileId, ...(lineId ? { lineId } : {}) }, "Photo removed.");
  if (step.kind === "furnishingQuote") {
    if (!f.quotes.length) return launch.isTeam && step.state !== "done" ? <Text style={[ui.small, { color: p.muted }]}>Send the quote from the Furnishing Studio, with this property chosen. You can send more than one package for the owner to choose from.</Text> : null;
    return <View style={{ gap: 6 }}>
      {f.quotes.map(q => <View key={q.id} style={{ gap: 6, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: p.border }}>
        <View style={[ui.between, { gap: 8 }]}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: p.text, fontWeight: "600" }}>{`${q.number}: ${pounds(q.quotePence)}`}</Text>
            <Text style={[ui.small, { color: p.muted }]}>{q.status === "sent" ? "Waiting for the owner" : q.status === "declined" ? "Declined" : "Approved"}{q.vatPence ? `, including VAT of ${pounds(q.vatPence)}` : ""}</Text>
          </View>
          <Button p={p} quiet icon={openQuote === q.id ? "chevron-up" : "list"} label={openQuote === q.id ? "Hide" : "Items"} onPress={() => setOpenQuote(o => o === q.id ? null : q.id)} />
        </View>
        {!!q.notes && <Text style={[ui.small, { color: p.text }]}>{q.notes}</Text>}
        {openQuote === q.id && <View style={{ gap: 2 }}>{q.lines.map((l, i) => <View key={i} style={[ui.between, { gap: 8 }]}>
          <Text style={[ui.small, { color: p.text, flex: 1 }]}>{`${l.units} x ${l.name}`}</Text>
          <Text style={[ui.small, { color: p.muted }]}>{pounds(l.pricePence)}</Text>
        </View>)}</View>}
        {f.canDecide && q.status === "sent" && <View style={{ gap: 6 }}>
          <Field p={p} label="Note (optional, for example what to change)" value={note} onChange={v => setNote(v.slice(0, 1000))} />
          <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
            <Button p={p} primary icon="check" label="Approve this quote" disabled={busy} onPress={() => act({ action: "decideQuote", projectId: q.id, decision: "accept", ...(note.trim() ? { note } : {}) }, "Approved. Accounts will send the invoice.")} />
            <Button p={p} quiet icon="x" label="Decline" disabled={busy} onPress={() => act({ action: "decideQuote", projectId: q.id, decision: "decline", ...(note.trim() ? { note } : {}) }, "Declined. Recharge will be in touch.")} />
          </View>
        </View>}
      </View>)}
    </View>;
  }
  if (step.kind === "auto" && step.key === "setUp.invoice") {
    if (!f.projectId) return null;
    return <Text style={[ui.small, { color: p.muted }]}>{f.settledAt ? `Settled ${when(f.settledAt)}.` : f.invoiceStatus === "sent" ? `Invoice sent for ${pounds(f.quotePence ?? 0)}.` : `The invoice for ${pounds(f.quotePence ?? 0)} is being prepared.`}</Text>;
  }
  const inside = launch.isTeam || launch.isInstaller || launch.isAccounts;
  const line = (l: LaunchFurnishing["lines"][number]) => <View style={{ flex: 1, gap: 2 }}>
    <Text style={{ color: p.text, fontSize: 14 }}>{`${l.units} x ${l.name}`}</Text>
    <Text style={[ui.small, { color: p.muted }]}>{[l.supplier, l.receivedAt ? `Received ${when(l.receivedAt)}${l.receivedByName ? ` by ${l.receivedByName}` : ""}` : l.eta ? `Due ${day(l.eta)}` : "Not ordered yet"].filter(Boolean).join(". ")}</Text>
  </View>;
  if (step.kind === "furnishingOrder") {
    const open = f.lines.filter(l => !l.receivedAt);
    return <View style={{ gap: 8 }}>
      {!!f.installer && <Text style={[ui.small, { color: p.text }]}>{`Installer: ${f.installer.name}.${f.deliveryAddress ? ` Delivery to ${f.deliveryAddress.replace(/\s*\n\s*/g, ", ")}.` : ""}`}</Text>}
      {f.canAssign && <View style={{ gap: 6 }}>
        <Text style={{ color: p.text, fontSize: 14 }}>{f.installer ? "Change the installer or the delivery address" : "Assign the installer and the delivery address"}</Text>
        <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>{read.installers.map(h => <Choice key={h.id} p={p} on={(installer || f.installer?.id) === h.id} label={h.name} onPress={() => setInstaller(h.id)} />)}</View>
        <Field p={p} multiline label="Delivery address" value={address || f.deliveryAddress || launch.address || ""} onChange={v => setAddress(v.slice(0, 500))} />
        <Button p={p} icon="user-check" label="Save" disabled={busy || !(installer || f.installer?.id)}
          onPress={() => act({ action: "assignInstaller", installerId: installer || f.installer?.id, deliveryAddress: address || f.deliveryAddress || launch.address || "" }, "Saved. The installer has been told.")} />
      </View>}
      {inside && f.lines.length > 0 && <Text style={[ui.small, { color: p.muted }]}>{`${f.counts.ordered} of ${f.counts.total} ordered.`}</Text>}
      {inside && f.lines.map(l => <View key={l.id} style={[ui.row, { gap: 8, alignItems: "flex-start" }]}>
        {f.canOrder && !l.receivedAt ? <MotionPress accessibilityRole="checkbox" accessibilityState={{ checked: picked.includes(l.id) }} onPress={() => setPicked(x => x.includes(l.id) ? x.filter(y => y !== l.id) : [...x, l.id])}>
          <Feather name={picked.includes(l.id) ? "check-square" : "square"} size={18} color={picked.includes(l.id) ? p.success : p.muted} />
        </MotionPress> : <Feather name={l.orderedAt ? "check-circle" : "circle"} size={16} color={l.orderedAt ? p.success : p.muted} />}
        {line(l)}
        {!!l.productUrl && <Button p={p} quiet icon="external-link" label="Product" onPress={() => void Linking.openURL(l.productUrl ?? "")} />}
      </View>)}
      {f.canOrder && open.length > 0 && <View style={{ gap: 6 }}>
        <Button p={p} quiet icon="check-square" label={picked.length === open.length ? "Clear the selection" : "Select everything not yet received"} onPress={() => setPicked(picked.length === open.length ? [] : open.map(l => l.id))} />
        <DateField p={p} label="Expected delivery date" mode="single" wholeMonthLink={false} empty="Choose a date" today={today()} value={{ from: eta, to: eta }} onChange={next => setEta(next.from)} />
        <Button p={p} icon="truck" label={`Mark ${picked.length || "the selected"} as ordered`} disabled={busy || !eta || !picked.length}
          onPress={() => { act({ action: "orderLines", lines: picked.map(lineId => ({ lineId, eta })) }, "Ordered. The owner is told once everything is ordered."); setPicked([]); }} />
      </View>}
    </View>;
  }
  if (step.kind === "furnishingReceived") {
    if (!inside) return f.counts.total ? <Text style={[ui.small, { color: p.muted }]}>{`${f.counts.received} of ${f.counts.total} items received.`}</Text> : null;
    return <View style={{ gap: 8 }}>
      <Text style={[ui.small, { color: p.muted }]}>{`${f.counts.received} of ${f.counts.total} received.${read.settings.requireReceivedPhotos ? " Photograph each item as it arrives, then mark it received." : ""}`}</Text>
      {f.lines.filter(l => l.orderedAt).map(l => <View key={l.id} style={{ gap: 4, paddingVertical: 4 }}>
        <View style={[ui.row, { gap: 8, alignItems: "flex-start" }]}>
          <Feather name={l.receivedAt ? "check-circle" : "package"} size={16} color={l.receivedAt ? p.success : p.waiting} />
          {line(l)}
          {f.canReceive && !l.receivedAt && <Button p={p} quiet icon="check" label="Received" disabled={busy || (read.settings.requireReceivedPhotos && !l.photos.length)}
            onPress={() => act({ action: "receiveLine", lineId: l.id }, "Marked received.")} />}
        </View>
        <Photos p={p} propertyId={propertyId} step="setUp.received" lineId={l.id} photos={l.photos} editable={f.canReceive && !l.receivedAt} busy={busy} onChange={onRead} onRemove={removePhoto("setUp.received", l.id)} />
      </View>)}
    </View>;
  }
  if (step.kind === "furnishingInstall") {
    return <View style={{ gap: 8 }}>
      {!!f.installOn && <Text style={[ui.small, { color: p.text }]}>{f.installedAt ? `Installed ${when(f.installedAt)}${f.installedByName ? ` by ${f.installedByName}` : ""}.`
        : f.installApprovedAt ? `Install booked to be completed by ${day(f.installOn)}.` : `${f.installProposedByName ?? "The installer"} proposed ${day(f.installOn)}; waiting for the team to approve it.`}</Text>}
      {f.canApproveInstall && <Button p={p} primary icon="check" label="Approve the install date" disabled={busy} onPress={() => act({ action: "approveInstall" }, "Approved. The owner has been told.")} />}
      {f.canProposeInstall && <View style={{ gap: 6 }}>
        <DateField p={p} label={launch.isTeam ? "Install completed by" : "Install completed by (the team approve it)"} mode="single" wholeMonthLink={false} empty="Choose a date" today={today()} value={{ from: installOn, to: installOn }} onChange={next => setInstallOn(next.from)} />
        <Button p={p} icon="calendar" label={f.installOn ? "Change the install date" : "Set the install date"} disabled={busy || !installOn} onPress={() => act({ action: "proposeInstall", date: installOn }, launch.isTeam ? "Booked. The owner has been told." : "Sent to the team to approve.")} />
      </View>}
      {(f.installPhotos.length > 0 || f.canCompleteInstall) && <Photos p={p} propertyId={propertyId} step="setUp.install" photos={f.installPhotos} editable={f.canCompleteInstall} busy={busy} onChange={onRead} onRemove={removePhoto("setUp.install")} />}
      {f.canCompleteInstall && <Button p={p} primary icon="check" label="Install complete" disabled={busy || !f.installPhotos.length} onPress={() => act({ action: "completeInstall" }, "Done. The owner has been told.")} />}
    </View>;
  }
  return null;
}

// ---------------------------------------------------------------- furnishing to order, receive and install, on Home
export function FurnishingWork({ p }: { p: Palette }) {
  const [read, setRead] = useState<LaunchRead | null>(null), [open, setOpen] = useState<string | null>(null), [error, setError] = useState("");
  const load = useCallback(async () => { try { setRead(await readLaunch()); setError(""); } catch (e) { setError(message(e)); } }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  if (!read || read.furnishingWork.length === 0) return null;
  return <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, padding: 14, gap: 10 }]}>
    <Text accessibilityRole="header" style={{ color: p.text, fontSize: 16, fontWeight: "700" }}>Furnishing</Text>
    <Text style={[ui.small, { color: p.muted }]}>New properties whose furnishing is paid for: order each item with its delivery date, check items in as they arrive, then install.</Text>
    {read.furnishingWork.map(x => <View key={x.propertyId} style={{ gap: 8 }}>
      <View style={[ui.between, { gap: 8 }]}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: p.text, fontWeight: "600" }}>{x.name}</Text>
          <Text style={[ui.small, { color: p.muted }]}>{[`${x.ordered} of ${x.total} ordered`, `${x.received} received`, x.installOn ? `install by ${day(x.installOn)}${x.installApproved ? "" : " (to approve)"}` : "", x.installer ? "you are the installer" : ""].filter(Boolean).join(", ")}</Text>
        </View>
        <Button p={p} quiet icon={open === x.propertyId ? "x" : "chevron-right"} label={open === x.propertyId ? "Close" : "Open"} onPress={() => setOpen(o => o === x.propertyId ? null : x.propertyId)} />
      </View>
      {open === x.propertyId && <LaunchPanel p={p} propertyId={x.propertyId} />}
    </View>)}
    {!!error && <Notice p={p} tone="bad" text={error} />}
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
    <Sheet palette={p} visible={visible} onClose={onClose} title="Launch preparation" subtitle="The condition checklist, guidebook template, notes, safety reminders and task boards" icon="clipboard" width={720}>
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
          <Text accessibilityRole="header" style={{ color: p.text, fontWeight: "700" }}>{`Guest guidebook sections (${draft.guidebook.length})`}</Text>
          <Text style={[ui.small, { color: p.muted }]}>The template the technician fills in. The address is added for you; Accessing the property and Wi-Fi also carry the key box codes and the Wi-Fi details.</Text>
          {draft.guidebook.map((g, i) => <View key={g.key} style={{ gap: 6, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: p.border }}>
            {canEdit ? <>
              <Field p={p} label={`${i + 1}. Section`} value={g.title} onChange={v => set({ guidebook: draft.guidebook.map((x, j) => j === i ? { ...x, title: v.slice(0, 80) } : x) })} />
              <Field p={p} multiline label="What to write" value={g.prompt} onChange={v => set({ guidebook: draft.guidebook.map((x, j) => j === i ? { ...x, prompt: v.slice(0, 1000) } : x) })} />
              <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>
                <Button p={p} quiet icon="arrow-up" label="Earlier" disabled={i === 0} onPress={() => { const next = [...draft.guidebook]; const [x] = next.splice(i, 1); next.splice(i - 1, 0, x); set({ guidebook: next }); }} />
                <Button p={p} quiet icon="arrow-down" label="Later" disabled={i === draft.guidebook.length - 1} onPress={() => { const next = [...draft.guidebook]; const [x] = next.splice(i, 1); next.splice(i + 1, 0, x); set({ guidebook: next }); }} />
                <Button p={p} quiet icon="trash-2" label="Remove" disabled={draft.guidebook.length <= 1} onPress={() => set({ guidebook: draft.guidebook.filter((_, j) => j !== i) })} />
              </View>
            </> : <><Text style={{ color: p.text, fontWeight: "600" }}>{`${i + 1}. ${g.title}`}</Text><Text style={[ui.small, { color: p.muted }]}>{g.prompt}</Text></>}
          </View>)}
          {canEdit && draft.guidebook.length < 20 && <Button p={p} icon="plus" label="Add a section" onPress={() => set({ guidebook: [...draft.guidebook, { key: statementKey("section", draft.guidebook.map(x => x.key)), title: "New section", prompt: "What the technician writes here." }] })} />}
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
          <View style={[ui.between, { gap: 8 }]}>
            <Text style={{ color: p.text, fontSize: 14, flex: 1 }}>The installer photographs each furnishing item as it arrives</Text>
            <Switch accessibilityLabel="The installer photographs each furnishing item as it arrives" value={draft.requireReceivedPhotos} disabled={!canEdit} onValueChange={v => set({ requireReceivedPhotos: v })} />
          </View>
          <Text style={{ color: p.text, fontSize: 14 }}>Remind the owner, and raise a renewal ticket, this many months before a certificate expires</Text>
          <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>{[1, 2, 3, 4, 5, 6].map(m => <Choice key={m} p={p} on={draft.reminderMonths === m} label={`${m} month${m === 1 ? "" : "s"}`} onPress={() => canEdit && set({ reminderMonths: m })} />)}</View>
          <Text accessibilityRole="header" style={{ color: p.text, fontWeight: "700" }}>Task boards</Text>
          <Text style={[ui.small, { color: p.muted }]}>Each of Recharge's parts also goes on this board as a ticket. Ticking either one completes both. Set-up, garden, the housekeeper and licensing have their own onboarding tickets.</Text>
          {TICKET_SECTIONS.map(sec => <View key={sec} style={{ gap: 6 }}>
            <View style={[ui.between, { gap: 8 }]}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: p.text, fontSize: 14, fontWeight: "600" }}>{BOARD_TITLE[sec]}</Text>
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
