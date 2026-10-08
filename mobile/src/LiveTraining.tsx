import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Linking from "expo-linking";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { Button, Field, message, Notice, Section, Tag, useRequestId } from "./LiveKit";
import { List, Row } from "./LiveAccounts";
import { readTeams, writeTeams, WorkspaceApiError } from "./backend/client";
import { AUDIENCES, coursesSchema, type Course } from "../../lib/management-live";
import { readableStage } from "../../lib/workspace-view";
import { StaffContracts } from "./LiveOnboarding";

// Live Training: everyone sees the courses meant for their role and marks them
// done; management writes, edits and publishes courses and sees completions.
const AUDIENCE_LABEL: Record<string, string> = { all: "Everyone", stays: "Stays", cleans: "Cleaners", cleaning_manager: "Cleaning managers", ready: "Ready", accounts: "Accounts", admin: "Admins", client: "Owners" };

function CourseEditor({ p, course, visible, onClose, onDone, onRequiredFailed }: { p: Palette; course: Course | null; visible: boolean; onClose: () => void; onDone: () => Promise<void>; onRequiredFailed?: (text: string) => void }) {
  const [title, setTitle] = useState("");
  const [audience, setAudience] = useState<string[]>(["all"]);
  const [summary, setSummary] = useState("");
  const [body, setBody] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [minutes, setMinutes] = useState("10");
  const [published, setPublished] = useState(false);
  const [required, setRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRequestId(visible ? ["course", course?.id ?? "new", course?.version ?? 0, title, audience.join(","), summary, body, videoUrl, minutes, published].join(":") : null);
  const requiredRequest = useRequestId(visible ? ["required", course?.id ?? "new", required].join(":") : null);
  useEffect(() => {
    queueMicrotask(() => {
      if (!visible) return;
      setTitle(course?.title ?? ""); setAudience(course?.audience ?? ["all"]); setSummary(course?.summary ?? ""); setBody(course?.body ?? "");
      setVideoUrl(course?.videoUrl ?? ""); setMinutes(String(course?.minutes ?? 10)); setPublished(course?.published ?? false); setRequired(course?.required ?? false); setError("");
    });
  }, [course, visible]);
  const toggle = (value: string) => setAudience(current => {
    if (value === "all") return ["all"];
    const next = current.filter(x => x !== "all");
    return next.includes(value) ? next.filter(x => x !== value) : [...next, value];
  });
  async function save() {
    const mins = Number(minutes);
    if (title.trim().length < 2 || body.trim().length < 10 || !audience.length || !Number.isInteger(mins) || mins < 1 || mins > 600) { setError("Add a title, who it is for, the course text (at least 10 characters) and the minutes it takes."); return; }
    if (videoUrl.trim() && !/^https:\/\//.test(videoUrl.trim())) { setError("Video links must start with https://"); return; }
    setBusy(true); setError("");
    let saved: unknown;
    try {
      saved = await writeTeams({
        action: "saveCourse", requestId: request.get(), ...(course ? { courseId: course.id, version: course.version } : {}), title: title.trim(),
        audience: audience as never, ...(summary.trim() ? { summary: summary.trim() } : {}), body: body.trim(), ...(videoUrl.trim() ? { videoUrl: videoUrl.trim() } : {}), minutes: mins, published,
      });
      request.done();
    } catch (e) { setError(message(e)); setBusy(false); return; }
    // Required courses must be finished before a team member's tools open. The course is saved
    // by now, so a failure here closes the editor and reloads rather than saving it twice.
    let requiredError = "";
    if (required !== (course?.required ?? false)) {
      try {
        const courseId = course?.id ?? (saved as { data: { id: string } }).data.id;
        await writeTeams({ action: "setCourseRequired", requestId: requiredRequest.get(), courseId, required });
        requiredRequest.done();
      } catch (e) { requiredError = message(e); }
    }
    setBusy(false); onClose(); await onDone();
    if (requiredError) onRequiredFailed?.("The course was saved, but “Required” could not be changed: " + requiredError);
  }
  return (
    <Sheet palette={p} visible={visible} onClose={onClose} title={course ? "Edit course" : "New course"} subtitle="Staff see published courses for their role" icon="medal">
      <Field label="Title" value={title} onChange={setTitle} p={p} />
      <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Who it is for</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {AUDIENCES.map(value => {
          const on = audience.includes(value);
          return <MotionPress key={value} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => toggle(value)} style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 999, justifyContent: "center", backgroundColor: on ? p.primary : p.surface, borderWidth: 1, borderColor: on ? p.primary : p.border }}><Text style={{ color: on ? p.onPrimary : p.text, fontSize: 13, fontWeight: "600" }}>{AUDIENCE_LABEL[value]}</Text></MotionPress>;
        })}
      </View>
      <Field label="Summary (optional)" value={summary} onChange={setSummary} p={p} />
      <Field label="Course text" value={body} onChange={setBody} p={p} multiline placeholder="The steps, rules and examples staff need" />
      <Field label="Video link (optional)" value={videoUrl} onChange={setVideoUrl} p={p} placeholder="https://" />
      <Field label="Minutes to complete" value={minutes} onChange={setMinutes} p={p} />
      <MotionPress accessibilityRole="checkbox" accessibilityState={{ checked: published }} onPress={() => setPublished(v => !v)} style={[ui.row, { gap: 12, minHeight: 48 }]}>
        <Feather name={published ? "check-square" : "square"} size={20} color={p.primary} /><Text style={{ color: p.text, flex: 1 }}>Published: staff can see and complete it</Text>
      </MotionPress>
      <MotionPress accessibilityRole="checkbox" accessibilityState={{ checked: required }} onPress={() => setRequired(v => !v)} style={[ui.row, { gap: 12, minHeight: 48 }]}>
        <Feather name={required ? "check-square" : "square"} size={20} color={p.primary} /><Text style={{ color: p.text, flex: 1 }}>Required before they start: new team members finish it before their tools open</Text>
      </MotionPress>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : "Save course"} primary p={p} disabled={busy} onPress={() => void save()} />
    </Sheet>
  );
}

// Reading a course and marking it done; also used by the onboarding checklist.
export function CourseSheet({ p, course, onClose, onCompleted }: { p: Palette; course: Course | null; onClose: () => void; onCompleted: () => Promise<void> | void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRequestId(course ? "complete:" + course.id : null);
  async function complete() {
    if (!course || busy) return;
    setBusy(true); setError("");
    try { await writeTeams({ action: "completeCourse", requestId: request.get(), courseId: course.id }); request.done(); onClose(); await onCompleted(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible={!!course} onClose={onClose} title={course?.title ?? ""} subtitle={course ? `${course.minutes} minutes` : undefined} icon="medal">
      {course && <>
        {!!course.summary && <Text style={[ui.body, { color: p.muted }]}>{course.summary}</Text>}
        <Text selectable style={[ui.body, { color: p.text }]}>{course.body}</Text>
        {!!course.videoUrl && <Button label="Watch the video" icon="play-circle" p={p} onPress={() => void Linking.openURL(course.videoUrl!).catch(() => setError("The video link could not be opened."))} />}
        {course.completedAt ? <Tag label={`Completed ${new Date(course.completedAt).toLocaleDateString("en-GB")}`} tone="good" p={p} /> : <Button label={busy ? "Saving…" : "Mark as complete"} icon="check" primary p={p} disabled={busy} onPress={() => void complete()} />}
        {!!error && <Notice text={error} p={p} tone="bad" />}
      </>}
    </Sheet>
  );
}

export function LiveTraining({ palette: p, manage = false }: { palette: Palette; manage?: boolean }) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Course | null>(null);
  const [editing, setEditing] = useState<Course | null | "new">(null);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { setCourses(coursesSchema.parse((await readTeams({ section: "training" })).data)); }
    catch (e) { setError(e instanceof WorkspaceApiError ? e.message : "Training could not be loaded."); }
    setLoading(false);
  }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  const todo = courses.filter(c => c.published && !c.completedAt).length;
  const training = (
    <Section title="Training" count={manage ? undefined : todo} p={p}>
      {loading && <ActivityIndicator color={p.primary} accessibilityLabel="Loading training" />}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {manage && <Button label="New course" icon="plus" p={p} onPress={() => setEditing("new")} />}
      <List p={p} empty={manage ? "No courses yet. Add the first one." : "No training has been assigned to you yet."}>
        {/* Drafts are for the people writing them; everyone else sees published courses only. */}
        {courses.filter(c => manage || c.published).map((c, i) => (
          <Row key={c.id} p={p} first={i === 0} title={c.title} detail={`${c.minutes} min · ${c.audience.map(a => AUDIENCE_LABEL[a] ?? readableStage(a)).join(", ")}`}
            tags={[c.completedAt ? ["Completed", "good"] : manage && !c.published ? ["Draft", "plain"] : ["To do", "wait"], ...(c.required ? [["Required", "plain"] as [string, "plain"]] : []), ...(manage && c.completions != null ? [[`${c.completions} completed`, "plain"] as [string, "plain"]] : [])]}
            onPress={() => manage ? setEditing(c) : setOpen(c)} />
        ))}
      </List>
      <CourseSheet p={p} course={open} onClose={() => setOpen(null)} onCompleted={load} />
      {manage && <CourseEditor p={p} course={editing === "new" ? null : editing} visible={editing !== null} onClose={() => setEditing(null)} onDone={load} onRequiredFailed={setError} />}
    </Section>
  );
  // Management sees the staff contracts first: they and the required courses gate new staff.
  return manage ? <View style={{ gap: 28 }}><StaffContracts p={p} />{training}</View> : training;
}
