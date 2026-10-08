import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, Platform, ScrollView, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { z } from "zod";
import { Text } from "./Typography";
import { MotionPress, TweenNumber } from "./motion";
import { addDays, Button, dayLabel, Field, london, message, Notice, Section, Tag, useRequestId, Loading } from "./LiveKit";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { readControls, readOperations, readTeams, uploadWorkPhoto, writeOperation, writeTeams, writeWorkspace, WorkspaceApiError } from "./backend/client";
import { operationViewSchema, readableStage, type PropertyView } from "../../lib/workspace-view";
import { candidatesSchema, performanceSchema, scheduleSchema } from "../../lib/cleans-live";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";

// Live Cleans: the cleaner's own jobs and the cleaning team's schedule, reviews and
// assignments, read from and written to the backend. Nothing here uses sample data.
type Schedule = z.infer<typeof scheduleSchema>;
type Operation = z.infer<typeof operationViewSchema>;
type Performance = z.infer<typeof performanceSchema>;
type Photo = { key: string; uri: string; status: "uploading" | "verified" | "failed"; id?: string; error?: string; requestId: string; name: string; type: "image/jpeg" | "image/png" | "image/webp" };

const checklistOf = (op?: Operation) => Array.isArray(op?.data.checklist) ? (op!.data.checklist as unknown[]).filter((v): v is string => typeof v === "string") : [];
const phaseLabel: Record<string, string> = { assigned: "To do", review: "Waiting for review", accepted: "Accepted" };

export function LiveCleans({ palette: p, account, properties }: { palette: Palette; account: WorkspaceAccount; properties: PropertyView[] }) {
  const manager = account.role !== "cleans";
  const today = london(new Date());
  const [schedule, setSchedule] = useState<Schedule>({ work: [], stays: [] });
  const [operations, setOperations] = useState<Operation[]>([]);
  const [performance, setPerformance] = useState<Performance>([]);
  const [day, setDay] = useState(today);
  const [cleaner, setCleaner] = useState("everyone");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [openJob, setOpenJob] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [statementFor, setStatementFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const from = addDays(today, -7), to = addDays(today, 28);
    const query: Record<string, string> = { section: "schedule", from, to };
    if (!manager) query.userId = account.userId;
    const [s, o, perf] = await Promise.allSettled([readTeams(query), readOperations(), readTeams({ section: "performance" })]);
    try {
      if (s.status === "fulfilled") setSchedule(scheduleSchema.parse(s.value.data)); else throw s.reason;
      if (o.status === "fulfilled") setOperations(z.array(operationViewSchema).parse(o.value.data).filter(op => op.kind === "cleaning")); else throw o.reason;
      if (perf.status === "fulfilled") setPerformance(performanceSchema.parse(perf.value.data));
    } catch (e) { setError(e instanceof WorkspaceApiError ? e.message : "Your cleans could not be loaded. Pull to refresh."); }
    setLoading(false);
  }, [account.userId, manager, today]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);

  const byId = useMemo(() => new Map(operations.map(op => [op.workId, op])), [operations]);
  const cleans = schedule.work.filter(w => w.kind === "cleaning" && (cleaner === "everyone" || w.assigneeId === cleaner));
  const dayCleans = cleans.filter(w => w.dueOn === day);
  const dayStays = schedule.stays.filter(s => s.checkIn === day || s.checkOut === day);
  const toReview = operations.filter(op => op.data.phase === "review");
  // A clean cancelled with its stay keeps its phase, so the status decides what is still open.
  const unassigned = operations.filter(op => op.data.phase === "assigned" && !op.assigneeId && !["completed", "cancelled"].includes(op.status));
  const cleaners = Array.from(new Map(schedule.work.filter(w => w.kind === "cleaning" && w.assigneeId).map(w => [w.assigneeId!, w.assigneeName || "Cleaner"])).entries());
  const mine = performance.find(row => row.cleanerId === account.userId);
  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i - 2));
  const job = openJob ? byId.get(openJob) : undefined;
  const jobRow = openJob ? schedule.work.find(w => w.workId === openJob) : undefined;

  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[ui.title, { color: p.text }]}>{manager ? "Cleaning team" : "Your cleans"}</Text>
        <Text style={[ui.body, { color: p.muted }]}>{manager ? "Schedule, review and assign every clean you look after." : "Your jobs, checklists and results, straight from the office."}</Text>
      </View>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {loading && <Loading p={p} />}

      <View style={{ flexDirection: "row", gap: 10 }}>
        {[
          { label: "Today", value: cleans.filter(w => w.dueOn === today).length },
          { label: manager ? "To review" : "This week", value: manager ? toReview.length : cleans.filter(w => w.dueOn && w.dueOn >= today && w.dueOn <= addDays(today, 6)).length },
          { label: manager ? "Unassigned" : "Accepted this month", value: manager ? unassigned.length : mine?.accepted ?? 0 },
        ].map(tile => (
          <View key={tile.label} style={[ui.card, { flex: 1, padding: 14, gap: 4, backgroundColor: p.surface, borderColor: p.border }]}>
            <TweenNumber value={tile.value} style={{ color: p.text, fontSize: 24, fontWeight: "700", fontVariant: ["tabular-nums"] }} />
            <Text numberOfLines={2} style={[ui.small, { color: p.muted }]}>{tile.label}</Text>
          </View>
        ))}
      </View>

      {!manager && mine && (mine.warning || mine.openComplaints.length > 0) && (
        <Section title="Needs your response" count={mine.openComplaints.filter(c => !c.cleanerStatement).length} p={p}>
          {mine.warning && <Notice text={`You have ${mine.rejected} rejected cleans this month. Management will review your work.`} p={p} tone="bad" />}
          {mine.openComplaints.map(c => (
            <View key={c.workId} style={[ui.card, { gap: 8, backgroundColor: p.surface, borderColor: p.border }]}>
              <Text style={{ color: p.text, fontWeight: "700" }}>Guest complaint about a clean</Text>
              <Text style={[ui.small, { color: p.muted }]}>Raised {new Date(c.createdAt).toLocaleDateString("en-GB")}. Management decides after hearing from you.</Text>
              {c.cleanerStatement ? <Notice text={`Your response: ${c.cleanerStatement}`} p={p} /> : <Button label="Give your side" icon="message-square" p={p} onPress={() => setStatementFor(c.workId)} />}
            </View>
          ))}
        </Section>
      )}

      {manager && (
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Button label="New clean" icon="plus" primary p={p} onPress={() => setCreating(true)} />
          <Button label={loading ? "Refreshing…" : "Refresh"} icon="refresh-cw" p={p} disabled={loading} onPress={() => void load()} />
        </View>
      )}

      <Section title="Schedule" p={p}>
        {manager && cleaners.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {[["everyone", "All cleaners"] as const, ...cleaners].map(([id, name]) => (
              <MotionPress key={id} accessibilityRole="button" accessibilityState={{ selected: cleaner === id }} onPress={() => setCleaner(id)} style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 999, justifyContent: "center", backgroundColor: cleaner === id ? p.primary : p.surface, borderWidth: 1, borderColor: cleaner === id ? p.primary : p.border }}>
                <Text style={{ color: cleaner === id ? p.onPrimary : p.text, fontSize: 13, fontWeight: "600" }}>{name}</Text>
              </MotionPress>
            ))}
          </ScrollView>
        )}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {days.map(d => {
            const on = d === day, count = cleans.filter(w => w.dueOn === d).length;
            return (
              <MotionPress key={d} accessibilityRole="button" accessibilityLabel={`${dayLabel(d)}, ${count} cleans`} accessibilityState={{ selected: on }} onPress={() => setDay(d)} style={{ width: 58, paddingVertical: 10, borderRadius: 16, alignItems: "center", gap: 4, backgroundColor: on ? p.primary : p.surface, borderWidth: 1, borderColor: on ? p.primary : p.border }}>
                <Text style={{ fontSize: 11, color: on ? p.onPrimary : p.muted }}>{dayLabel(d).split(" ")[0]}</Text>
                <Text style={{ fontSize: 17, fontWeight: "700", color: on ? p.onPrimary : p.text }}>{dayLabel(d).split(" ")[1]}</Text>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: count ? (on ? p.onPrimary : p.primary) : "transparent" }} />
              </MotionPress>
            );
          })}
        </ScrollView>
        <Text style={[ui.small, { color: p.muted }]}>{dayLabel(day)} · {dayCleans.length} {dayCleans.length === 1 ? "clean" : "cleans"}</Text>
        {dayStays.map(stay => (
          <View key={stay.reservationId + day} style={[ui.row, { gap: 10, paddingHorizontal: 4 }]}>
            <Feather name={stay.checkOut === day ? "log-out" : "log-in"} size={16} color={p.muted} />
            <Text style={[ui.small, { color: p.muted, flex: 1 }]}>{stay.propertyName} · {stay.checkOut === day ? "Guests leave" : "Guests arrive"}{stay.guests ? ` · ${stay.guests} guests` : ""}</Text>
          </View>
        ))}
        {dayCleans.length ? dayCleans.map(w => {
          const op = byId.get(w.workId), phase = String(op?.data.phase ?? "");
          return (
            <MotionPress key={w.workId} accessibilityRole="button" accessibilityLabel={`${w.propertyName}, ${phaseLabel[phase] ?? readableStage(w.status)}`} onPress={() => setOpenJob(w.workId)} style={[ui.card, { gap: 8, backgroundColor: p.surface, borderColor: p.border }]}>
              <View style={ui.between}>
                <Text numberOfLines={1} style={{ color: p.text, fontSize: 15, fontWeight: "700", flex: 1 }}>{w.propertyName}</Text>
                <Feather name="chevron-right" size={18} color={p.muted} />
              </View>
              <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
                <Tag label={phaseLabel[phase] ?? readableStage(w.status)} tone={phase === "accepted" ? "good" : phase === "review" ? "wait" : "plain"} p={p} />
                {manager && <Tag label={w.assigneeName ?? "Unassigned"} tone={w.assigneeName ? "plain" : "bad"} p={p} />}
                <Text style={[ui.small, { color: p.muted }]}>{checklistOf(op).length} checks</Text>
              </View>
            </MotionPress>
          );
        }) : !loading && <Notice text={manager ? "No cleans scheduled for this day." : "Nothing booked for you on this day."} p={p} />}
      </Section>

      {manager && (
        <>
          <Section title="Waiting for your review" count={toReview.length} p={p}>
            {toReview.length ? toReview.map(op => (
              <MotionPress key={op.workId} accessibilityRole="button" onPress={() => setOpenJob(op.workId)} style={[ui.card, { gap: 6, backgroundColor: p.surface, borderColor: p.border }]}>
                <Text style={{ color: p.text, fontWeight: "700" }}>{properties.find(x => x.id === op.propertyId)?.name ?? op.title}</Text>
                <Text numberOfLines={2} style={[ui.small, { color: p.muted }]}>{typeof op.data.report === "string" ? op.data.report : "Report submitted"}</Text>
              </MotionPress>
            )) : <Notice text="Every submitted clean has been reviewed." p={p} />}
          </Section>
          <Section title="Not yet assigned" count={unassigned.length} p={p}>
            {unassigned.length ? unassigned.map(op => (
              <MotionPress key={op.workId} accessibilityRole="button" onPress={() => setOpenJob(op.workId)} style={[ui.card, { gap: 6, backgroundColor: p.surface, borderColor: p.border }]}>
                <Text style={{ color: p.text, fontWeight: "700" }}>{properties.find(x => x.id === op.propertyId)?.name ?? op.title}</Text>
                <Text style={[ui.small, { color: p.muted }]}>{typeof op.data.dueOn === "string" ? dayLabel(op.data.dueOn) : "No date"} · tap to assign a cleaner</Text>
              </MotionPress>
            )) : <Notice text="Every clean has a cleaner." p={p} />}
          </Section>
          <Section title="Cleaner performance this month" p={p}>
            {performance.length ? performance.map(row => (
              <View key={row.cleanerId} style={[ui.card, ui.between, { gap: 10, backgroundColor: p.surface, borderColor: p.border }]}>
                <View style={{ flex: 1, gap: 2 }}><Text style={{ color: p.text, fontWeight: "700" }}>{row.fullName}</Text><Text style={[ui.small, { color: p.muted }]}>{row.accepted} accepted · {row.rejected} rejected{row.overturned ? ` · ${row.overturned} overturned` : ""}</Text></View>
                <Tag label={row.warning ? "Warning" : "Good standing"} tone={row.warning ? "bad" : "good"} p={p} />
              </View>
            )) : <Notice text="Cleaner results appear after the first reviewed clean." p={p} />}
          </Section>
        </>
      )}
      {!manager && mine && (
        <Section title="Your month" p={p}>
          <View style={[ui.card, ui.between, { backgroundColor: p.surface, borderColor: p.border }]}>
            <Text style={{ color: p.text }}>{mine.accepted} accepted · {mine.rejected} rejected{mine.overturned ? ` · ${mine.overturned} overturned` : ""}</Text>
            <Tag label={mine.warning ? "Warning" : "Good standing"} tone={mine.warning ? "bad" : "good"} p={p} />
          </View>
        </Section>
      )}
      {!manager && <Button label={loading ? "Refreshing…" : "Refresh"} icon="refresh-cw" p={p} disabled={loading} onPress={() => void load()} />}

      <JobSheet p={p} account={account} manager={manager} op={job} propertyName={jobRow?.propertyName ?? properties.find(x => x.id === job?.propertyId)?.name ?? "Clean"} onClose={() => setOpenJob(null)} onDone={async () => { setOpenJob(null); await load(); }} />
      <CreateSheet p={p} visible={creating} properties={properties} onClose={() => setCreating(false)} onDone={async () => { setCreating(false); await load(); }} today={today} />
      <StatementSheet p={p} workId={statementFor} onClose={() => setStatementFor(null)} onDone={async () => { setStatementFor(null); await load(); }} />
    </View>
  );
}

const MAIL_DONE = { photograph: "photographed it", open_and_photograph: "opened and photographed it", leave_safely: "left it somewhere safe" } as const;

function JobSheet({ p, account, manager, op, propertyName, onClose, onDone }: { p: Palette; account: WorkspaceAccount; manager: boolean; op?: Operation; propertyName: string; onClose: () => void; onDone: () => Promise<void> }) {
  const checklist = checklistOf(op), phase = String(op?.data.phase ?? "");
  const [ticked, setTicked] = useState<string[]>([]);
  const [report, setReport] = useState("");
  const [mailDone, setMailDone] = useState(false);
  const [mailNote, setMailNote] = useState("");
  const mailPreference = typeof op?.data.mailPreference === "string" && op.data.mailPreference in MAIL_DONE ? op.data.mailPreference as keyof typeof MAIL_DONE : null;
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [accepted, setAccepted] = useState<boolean | null>(null);
  const [guestFeedback, setGuestFeedback] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [candidates, setCandidates] = useState<z.infer<typeof candidatesSchema>>([]);
  const request = useRequestId(op ? op.workId + ":" + op.version : null);
  const canSubmit = !manager && op?.assigneeId === account.userId && phase === "assigned";
  const canReview = manager && phase === "review" && op?.assigneeId !== account.userId;
  const canAssign = manager && phase === "assigned" && !!op && !["completed", "cancelled"].includes(op.status);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (!active) return; setTicked([]); setReport(""); setPhotos([]); setError(""); setAccepted(null); setGuestFeedback(""); setReviewNote(""); setCandidates([]); });
    if (op && canAssign) readControls({ section: "resources", propertyId: op.propertyId, workId: op.workId }).then(r => { if (active) setCandidates(candidatesSchema.parse(r.data).filter(c => c.role === "cleans")); }).catch(e => { if (active) setError(message(e)); });
    return () => { active = false; };
  }, [op, canAssign]);

  async function addPhoto(camera: boolean) {
    if (!op) return;
    setError("");
    const permission = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { setError(camera ? "Allow camera access to take photos of the clean." : "Allow photo access to choose photos of the clean."); return; }
    const result = camera ? await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 0.7 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7, allowsMultipleSelection: true, selectionLimit: 10 });
    if (result.canceled) return;
    for (const asset of result.assets) {
      const type = asset.mimeType === "image/png" || asset.mimeType === "image/webp" ? asset.mimeType : "image/jpeg";
      const requestId = Crypto.randomUUID();
      const photo: Photo = { key: requestId, uri: asset.uri, status: "uploading", requestId, name: asset.fileName || `clean-${requestId.slice(0, 8)}.jpg`, type };
      setPhotos(current => [...current, photo]);
      void upload(photo);
    }
  }
  async function upload(photo: Photo) {
    if (!op) return;
    setPhotos(current => current.map(x => x.key === photo.key ? { ...x, status: "uploading", error: undefined } : x));
    try {
      const response = z.object({ id: z.string().uuid() }).parse(await uploadWorkPhoto({ requestId: photo.requestId, workId: op.workId, purpose: "cleaning" }, { uri: photo.uri, name: photo.name, type: photo.type }));
      setPhotos(current => current.map(x => x.key === photo.key ? { ...x, status: "verified", id: response.id } : x));
    } catch (e) {
      const text = e instanceof WorkspaceApiError && e.status === 503 ? "Photo uploads are not switched on yet. Ask the office to connect the photo service." : message(e);
      setPhotos(current => current.map(x => x.key === photo.key ? { ...x, status: "failed", error: text } : x));
    }
  }
  async function run(action: () => Promise<unknown>) {
    if (busy) return; setBusy(true); setError("");
    try { await action(); request.done(); await onDone(); } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const verified = photos.filter(x => x.status === "verified" && x.id).map(x => x.id!);
  const ready = ticked.length === checklist.length && checklist.length > 0 && report.trim().length >= 5 && verified.length > 0 && !photos.some(x => x.status === "uploading");

  return (
    <Sheet palette={p} visible={!!op} onClose={onClose} title={propertyName} subtitle={op ? `${typeof op.data.dueOn === "string" ? dayLabel(op.data.dueOn) : ""} · ${phaseLabel[phase] ?? readableStage(op.status)}` : ""} icon="spray">
      {op && <>
        {canSubmit && <>
          <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>Checklist</Text>
          {checklist.map(item => {
            const on = ticked.includes(item);
            return (
              <MotionPress key={item} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => setTicked(current => on ? current.filter(x => x !== item) : [...current, item])} style={[ui.row, { gap: 12, minHeight: 48, paddingHorizontal: 12, borderRadius: 14, backgroundColor: on ? p.successWash : p.elevated }]}>
                <Feather name={on ? "check-square" : "square"} size={20} color={on ? p.success : p.muted} />
                <Text style={{ color: p.text, flex: 1 }}>{item}</Text>
              </MotionPress>
            );
          })}
          <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>Photos</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {photos.map(photo => (
              <View key={photo.key} style={{ width: 96, gap: 4 }}>
                <Image source={{ uri: photo.uri }} style={{ width: 96, height: 96, borderRadius: 12, opacity: photo.status === "verified" ? 1 : 0.5 }} accessibilityLabel="Clean photo" />
                {photo.status === "uploading" && <ActivityIndicator size="small" color={p.primary} />}
                {photo.status === "verified" && <Tag label="Saved" tone="good" p={p} />}
                {photo.status === "failed" && <MotionPress accessibilityRole="button" onPress={() => void upload(photo)}><Tag label="Retry" tone="bad" p={p} /></MotionPress>}
              </View>
            ))}
          </View>
          {photos.find(x => x.status === "failed")?.error && <Notice text={photos.find(x => x.status === "failed")!.error!} p={p} tone="bad" />}
          <View style={{ flexDirection: "row", gap: 8 }}>
            {Platform.OS !== "web" && <Button label="Take photo" icon="camera" p={p} onPress={() => void addPhoto(true)} />}
            <Button label="Choose photos" icon="image" p={p} onPress={() => void addPhoto(false)} />
          </View>
          <Field label="Report" value={report} onChange={setReport} p={p} multiline placeholder="What you cleaned, anything broken or missing, Wi-Fi checked" />
          {/* The owner's mailbox permission from onboarding: the cleaner records doing exactly that. */}
          {mailPreference && <View style={{ gap: 8 }}>
            <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>Post</Text>
            <MotionPress accessibilityRole="checkbox" accessibilityState={{ checked: mailDone }} onPress={() => setMailDone(v => !v)} style={[ui.row, { gap: 12, minHeight: 48, paddingHorizontal: 12, borderRadius: 14, backgroundColor: mailDone ? p.successWash : p.elevated }]}>
              <Feather name={mailDone ? "check-square" : "square"} size={20} color={mailDone ? p.success : p.muted} />
              <Text style={{ color: p.text, flex: 1 }}>There was post, and I {MAIL_DONE[mailPreference]} as the owner asked</Text>
            </MotionPress>
            {mailDone && <Field label="Note for the owner (optional)" value={mailNote} onChange={setMailNote} p={p} placeholder="For example, two letters left on the kitchen table" />}
          </View>}
          <Button label={busy ? "Sending…" : "Submit clean"} icon="send" primary p={p} disabled={!ready || busy}
            onPress={() => void run(() => writeOperation({ action: "updateOperation", requestId: request.get(), workId: op.workId, version: op.version, step: "submitCleaning", data: { checks: checklist, report: report.trim(), photoIds: verified, mailAction: mailPreference && mailDone ? mailPreference : "none", ...(mailPreference && mailDone && mailNote.trim() ? { mailNote: mailNote.trim().slice(0, 500) } : {}) } }))} />
          {!ready && <Text style={[ui.small, { color: p.muted }]}>Tick every check, add at least one saved photo and a short report to submit.</Text>}
        </>}

        {canReview && <>
          <Notice text={typeof op.data.report === "string" ? `Cleaner's report: ${op.data.report}` : "The cleaner has submitted this clean."} p={p} />
          <Text style={[ui.small, { color: p.muted }]}>{Array.isArray(op.data.photoIds) ? `${op.data.photoIds.length} verified photos attached` : ""}</Text>
          <View style={{ flexDirection: "row", gap: 8 }}>
            <MotionPress accessibilityRole="radio" accessibilityState={{ selected: accepted === true }} onPress={() => setAccepted(true)} style={[ui.button, { flex: 1, backgroundColor: accepted === true ? p.success : p.wash }]}><Text style={[ui.buttonText, { color: accepted === true ? "#FFFFFF" : p.primary }]}>Accept</Text></MotionPress>
            <MotionPress accessibilityRole="radio" accessibilityState={{ selected: accepted === false }} onPress={() => setAccepted(false)} style={[ui.button, { flex: 1, backgroundColor: accepted === false ? "#A63A32" : p.wash }]}><Text style={[ui.buttonText, { color: accepted === false ? "#FFFFFF" : p.primary }]}>Reject</Text></MotionPress>
          </View>
          <Field label="Guest feedback" value={guestFeedback} onChange={setGuestFeedback} p={p} multiline placeholder="What guests said, or 'No comments'" />
          <Field label="Your review" value={reviewNote} onChange={setReviewNote} p={p} multiline placeholder={accepted === false ? "What was not up to standard" : "What you checked"} />
          {accepted === false && <Text style={[ui.small, { color: p.muted }]}>A rejection is shared with the cleaner, who can respond before management decides.</Text>}
          <Button label={busy ? "Saving…" : "Save review"} primary p={p} disabled={busy || accepted === null || guestFeedback.trim().length < 5 || reviewNote.trim().length < 5}
            onPress={() => void run(() => writeOperation({ action: "updateOperation", requestId: request.get(), workId: op.workId, version: op.version, step: "reviewCleaning", data: { accepted: accepted === true, guestFeedback: guestFeedback.trim(), reviewNote: reviewNote.trim() } }))} />
        </>}

        {canAssign && <>
          <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>{op.assigneeId ? "Reassign this clean" : "Assign a cleaner"}</Text>
          {candidates.length ? candidates.map(c => (
            <Button key={c.userId} label={c.fullName + (c.userId === op.assigneeId ? " · assigned" : "")} icon="user" p={p} disabled={busy || c.userId === op.assigneeId}
              onPress={() => void run(() => writeWorkspace({ action: "assignWork", workId: op.workId, version: op.version, userId: c.userId }))} />
          )) : <Notice text="No cleaner can take this clean yet. In Work, Management, People, open a cleaner and give them this property, or every property." p={p} />}
        </>}

        {!canSubmit && !canReview && !canAssign && <Notice text={phase === "accepted" ? "This clean has been accepted." : phase === "review" ? "Submitted. Waiting for the cleaning manager's review." : "Nothing to do on this clean right now."} p={p} />}
        {checklist.length > 0 && !canSubmit && <Text style={[ui.small, { color: p.muted }]}>Checklist: {checklist.join(" · ")}</Text>}
        {!!error && <Notice text={error} p={p} tone="bad" />}
      </>}
    </Sheet>
  );
}

function CreateSheet({ p, visible, properties, onClose, onDone, today }: { p: Palette; visible: boolean; properties: PropertyView[]; onClose: () => void; onDone: () => Promise<void>; today: string }) {
  const [propertyId, setPropertyId] = useState("");
  const [date, setDate] = useState(today);
  const [checks, setChecks] = useState("Kitchen\nBathrooms\nBedrooms and fresh linen\nWi-Fi and broadband working");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRequestId(visible ? "create:" + propertyId + ":" + date : null);
  const checklist = checks.split("\n").map(x => x.trim()).filter(Boolean);
  const valid = !!propertyId && /^\d{4}-\d{2}-\d{2}$/.test(date) && checklist.length >= 1 && checklist.length <= 30;
  async function save() {
    if (!valid || busy) return; setBusy(true); setError("");
    try { await writeOperation({ action: "createOperation", requestId: request.get(), propertyId, kind: "cleaning", data: { dueOn: date, checklist } }); request.done(); await onDone(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible={visible} onClose={onClose} title="New clean" subtitle="The cleaner sees it as soon as you assign them" icon="calendar">
      <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Property</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {properties.map(x => (
          <MotionPress key={x.id} accessibilityRole="radio" accessibilityState={{ selected: propertyId === x.id }} onPress={() => setPropertyId(x.id)} style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 999, justifyContent: "center", backgroundColor: propertyId === x.id ? p.primary : p.surface, borderWidth: 1, borderColor: propertyId === x.id ? p.primary : p.border }}>
            <Text style={{ color: propertyId === x.id ? p.onPrimary : p.text, fontSize: 13, fontWeight: "600" }}>{x.name}</Text>
          </MotionPress>
        ))}
        {!properties.length && <Notice text="No properties are assigned to you yet." p={p} />}
      </View>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button label="Today" p={p} onPress={() => setDate(today)} />
        <Button label="Tomorrow" p={p} onPress={() => setDate(addDays(today, 1))} />
      </View>
      <Field label="Date (YYYY-MM-DD)" value={date} onChange={setDate} p={p} />
      <Field label="Checks, one per line" value={checks} onChange={setChecks} p={p} multiline />
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Creating…" : "Create clean"} icon="plus" primary p={p} disabled={!valid || busy} onPress={() => void save()} />
    </Sheet>
  );
}

function StatementSheet({ p, workId, onClose, onDone }: { p: Palette; workId: string | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [statement, setStatement] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRequestId(workId);
  async function send() {
    if (!workId || busy) return; setBusy(true); setError("");
    try { await writeTeams({ action: "addCleanerStatement", requestId: request.get(), workId, statement: statement.trim() }); request.done(); setStatement(""); await onDone(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible={!!workId} onClose={onClose} title="Your side" subtitle="Management reads this before deciding" icon="chat">
      <Field label="What happened" value={statement} onChange={setStatement} p={p} multiline placeholder="Explain the clean and point to your photos" />
      <Text style={[ui.small, { color: p.muted }]}>You can respond once, so include everything that matters.</Text>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Sending…" : "Send"} icon="send" primary p={p} disabled={busy || statement.trim().length < 10} onPress={() => void send()} />
    </Sheet>
  );
}
