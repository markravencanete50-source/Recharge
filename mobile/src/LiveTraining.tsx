import { createElement, useCallback, useEffect, useState } from "react";
import { Platform, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Linking from "expo-linking";
import * as DocumentPicker from "expo-document-picker";
import { Text } from "./Typography";
import { useSaved } from "./Celebrate";
import { MotionPress } from "./motion";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { Button, Field, message, Notice, Section, Tag, useRequestId, Loading } from "./LiveKit";
import { List, Row } from "./LiveAccounts";
import { courseFileLink, readTeams, removeCourseFile, uploadCourseFile, writeTeams, WorkspaceApiError } from "./backend/client";
import { AUDIENCES, contractsSchema, coursesSchema, type Course, type StaffOnboarding } from "../../lib/management-live";
import { fileKind, fileSize, MAX_TRAINING_FILE_BYTES } from "../../lib/training-files";
import { readableStage } from "../../lib/workspace-view";
import { videoEmbed } from "../../lib/video-embed";
import { StaffContracts } from "./LiveOnboarding";

// Live Training: everyone sees the courses meant for their role and marks them
// done; management writes, edits and publishes courses and sees completions.
const AUDIENCE_LABEL: Record<string, string> = { all: "Everyone", stays: "Stays", cleans: "Cleaners", cleaning_manager: "Cleaning managers", ready: "Ready", accounts: "Accounts", admin: "Admins", client: "Owners" };

const FILE_ICON = { video: "film", picture: "image", PDF: "file-text", document: "file" } as const;
// A course's files. Everyone the course is for can open them; managers add and remove them.
function CourseFiles({ p, course, manage, onChanged }: { p: Palette; course: Course; manage?: boolean; onChanged?: () => Promise<void> | void }) {
  const [busy, setBusy] = useState(""), [error, setError] = useState(""), [playing, setPlaying] = useState<{ id: string; url: string } | null>(null);
  // Kept here so an upload or removal shows at once while the editor stays open.
  const [files, setFiles] = useState(course.files);
  async function open(file: Course["files"][number]) {
    setBusy(file.id); setError("");
    try {
      const link = await courseFileLink(file.id);
      // Videos play inside the app on the web; everything else opens in the browser or viewer.
      if (Platform.OS === "web" && link.mime.startsWith("video/")) setPlaying({ id: file.id, url: link.url });
      else await Linking.openURL(link.url);
    } catch (e) { setError(message(e)); } finally { setBusy(""); }
  }
  async function add() {
    setError("");
    const picked = await DocumentPicker.getDocumentAsync({ type: ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "image/*", "video/*"], copyToCacheDirectory: true, multiple: false });
    if (picked.canceled || !picked.assets?.length) return;
    const asset = picked.assets[0];
    if (asset.size && asset.size > MAX_TRAINING_FILE_BYTES) { setError("Files can be up to 25 MB. For a longer video, put it on YouTube, Vimeo or Loom and add the link instead."); return; }
    setBusy("upload");
    try {
      const result = await uploadCourseFile(course.id, { uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? undefined, file: (asset as { file?: File }).file });
      const added = (result as { data?: Course["files"][number] }).data;
      if (added?.id) setFiles(current => [...current, added]);
      await onChanged?.();
    }
    catch (e) { setError(message(e)); } finally { setBusy(""); }
  }
  async function remove(id: string) {
    setBusy(id); setError("");
    try { await removeCourseFile(id); setFiles(current => current.filter(f => f.id !== id)); await onChanged?.(); } catch (e) { setError(message(e)); } finally { setBusy(""); }
  }
  if (!manage && !files.length) return null;
  return (
    <View style={{ gap: 8 }}>
      <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>{manage ? "Files (documents, pictures, short videos)" : "Course files"}</Text>
      {files.map(f => (
        <View key={f.id} style={{ gap: 8 }}>
          <View style={[ui.row, { gap: 10, padding: 10, borderRadius: 14, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface }]}>
            <Feather name={FILE_ICON[fileKind(f.mime)]} size={18} color={p.primary} />
            <View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={2} style={{ color: p.text, fontWeight: "600" }}>{f.name}</Text><Text style={[ui.small, { color: p.muted }]}>{fileKind(f.mime)} · {fileSize(f.bytes)}</Text></View>
            <Button label={busy === f.id ? "Opening…" : fileKind(f.mime) === "video" ? "Play" : "Open"} p={p} disabled={!!busy} onPress={() => void open(f)} />
            {manage && <MotionPress accessibilityRole="button" accessibilityLabel={`Remove ${f.name}`} onPress={() => void remove(f.id)} style={{ padding: 8 }}><Feather name="trash-2" size={18} color={p.danger} /></MotionPress>}
          </View>
          {playing?.id === f.id && Platform.OS === "web" && createElement("video", { src: playing.url, controls: true, autoPlay: true, playsInline: true, style: { width: "100%", borderRadius: 14, background: "#000" } })}
        </View>
      ))}
      {manage && files.length < 10 && <Button label={busy === "upload" ? "Uploading…" : "Add a file"} icon="upload" p={p} disabled={!!busy} onPress={() => void add()} />}
      {!!error && <Notice text={error} p={p} tone="bad" />}
    </View>
  );
}

function CourseEditor({ p, course, visible, onClose, onDone, onRequiredFailed }: { p: Palette; course: Course | null; visible: boolean; onClose: () => void; onDone: () => Promise<void>; onRequiredFailed?: (text: string) => void }) {
  const [title, setTitle] = useState("");
  const [audience, setAudience] = useState<string[]>(["all"]);
  const [summary, setSummary] = useState("");
  const [body, setBody] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [minutes, setMinutes] = useState("10");
  const [published, setPublished] = useState(false);
  const [required, setRequired] = useState(false);
  const [redo, setRedo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [people, setPeople] = useState<StaffOnboarding[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const deleteRequest = useRequestId(visible && course ? ["deleteCourse", course.id, course.version].join(":") : null);
  const request = useRequestId(visible ? ["course", course?.id ?? "new", course?.version ?? 0, title, audience.join(","), summary, body, videoUrl, minutes, published, redo].join(":") : null);
  // Who the course is for and who has done it (from each team member's training list).
  useEffect(() => {
    if (!visible || !course) return;
    let active = true;
    void readTeams({ section: "contracts" }).then(r => { if (active) setPeople(contractsSchema.parse(r.data).people); }).catch(() => undefined);
    return () => { active = false; };
  }, [visible, course]);
  const assigned = course ? people.flatMap(x => x.training.filter(t => t.id === course.id).map(t => ({ ...x, completedAt: t.completedAt }))) : [];
  const requiredRequest = useRequestId(visible ? ["required", course?.id ?? "new", required].join(":") : null);
  useEffect(() => {
    queueMicrotask(() => {
      if (!visible) return;
      setTitle(course?.title ?? ""); setAudience(course?.audience ?? ["all"]); setSummary(course?.summary ?? ""); setBody(course?.body ?? "");
      setVideoUrl(course?.videoUrl ?? ""); setMinutes(String(course?.minutes ?? 10)); setPublished(course?.published ?? false); setRequired(course?.required ?? false); setRedo(false); setError(""); setConfirmDelete(false);
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
        audience: audience as never, ...(summary.trim() ? { summary: summary.trim() } : {}), body: body.trim(), ...(videoUrl.trim() ? { videoUrl: videoUrl.trim() } : {}), minutes: mins, published, ...(course && redo ? { redoRequired: true } : {}),
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
  // Deleting takes the course, its completions and its files away for everyone.
  async function remove() {
    if (!course) return;
    setBusy(true); setError("");
    try { await writeTeams({ action: "deleteCourse", requestId: deleteRequest.get(), courseId: course.id, version: course.version }); deleteRequest.done(); onClose(); await onDone(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); setConfirmDelete(false); }
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
      {!!course && !!course.completions && <MotionPress accessibilityRole="checkbox" accessibilityState={{ checked: redo }} onPress={() => setRedo(v => !v)} style={[ui.row, { gap: 12, minHeight: 48 }]}>
        <Feather name={redo ? "check-square" : "square"} size={20} color={p.primary} /><Text style={{ color: p.text, flex: 1 }}>Ask everyone who completed it to do it again{required ? " (their tools close until they have)" : ""}</Text>
      </MotionPress>}
      {!required && <Text style={[ui.small, { color: p.muted }]}>Only published courses that are required close a new person’s tools. Other courses are optional training they can do any time in Help.</Text>}
      {course ? <CourseFiles key={course.id} p={p} course={course} manage onChanged={onDone} /> : <Text style={[ui.small, { color: p.muted }]}>Save the course first, then open it again to add documents, pictures or short videos.</Text>}
      {!!course && course.published && <Section title="Who has done it" count={assigned.filter(x => x.completedAt).length} p={p}>
        <List p={p} empty="Nobody in this course’s roles yet.">
          {assigned.map((x, i) => <Row key={x.userId} p={p} first={i === 0} icon={x.completedAt ? "check-circle" : "user"} title={x.fullName || "Team member"} detail={x.completedAt ? `Completed ${new Date(x.completedAt).toLocaleDateString("en-GB")}` : "Not done yet"} tags={[x.completedAt ? ["Done", "good"] : ["To do", "wait"]]} />)}
        </List>
      </Section>}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : "Save course"} primary p={p} disabled={busy} onPress={() => void save()} />
      {!!course && (confirmDelete
        ? <View style={{ gap: 8, padding: 14, borderRadius: 16, backgroundColor: p.dangerWash }}>
            <Text style={{ color: p.text, fontWeight: "700" }}>Delete “{course.title}”?</Text>
            <Text style={[ui.small, { color: p.text }]}>It disappears for everyone, with its files{course.completions ? ` and the record of the ${course.completions} ${course.completions === 1 ? "person" : "people"} who completed it` : ""}. This can’t be undone.{course.required ? " Anyone waiting on it to start no longer needs it." : ""}</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              <Button label={busy ? "Deleting…" : "Delete course"} icon="trash-2" primary p={p} disabled={busy} onPress={() => void remove()} />
              <Button label="Keep it" p={p} disabled={busy} onPress={() => setConfirmDelete(false)} />
            </View>
          </View>
        : <Button label="Delete course" icon="trash-2" p={p} disabled={busy} onPress={() => setConfirmDelete(true)} />)}
    </Sheet>
  );
}

// The course video plays inside the app on the web; the phone app opens it until an in-app
// player is added to the store build.
function CourseVideo({ p, url, onError }: { p: Palette; url: string; onError: (text: string) => void }) {
  const embed = videoEmbed(url);
  if (Platform.OS === "web" && embed) {
    const frame = { width: "100%", aspectRatio: "16 / 9", border: 0, borderRadius: 16, background: "#000", display: "block" } as const;
    return (
      <View style={{ borderRadius: 16, overflow: "hidden", backgroundColor: "#000" }}>
        {embed.kind === "frame"
          ? createElement("iframe", { src: embed.src, title: "Course video", style: frame, allow: "accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen", allowFullScreen: true, loading: "lazy", referrerPolicy: "strict-origin-when-cross-origin" })
          : createElement("video", { src: embed.src, controls: true, playsInline: true, preload: "metadata", style: frame })}
      </View>
    );
  }
  return <Button label="Watch the video" icon="play-circle" p={p} onPress={() => void Linking.openURL(url).catch(() => onError("The video link could not be opened."))} />;
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
        {!!course.videoUrl && <CourseVideo p={p} url={course.videoUrl} onError={setError} />}
        <CourseFiles key={course.id} p={p} course={course} />
        {course.completedAt ? <Tag label={`Completed ${new Date(course.completedAt).toLocaleDateString("en-GB")}`} tone="good" p={p} /> : <Button label={busy ? "Saving…" : "Mark as complete"} icon="check" primary p={p} disabled={busy} onPress={() => void complete()} />}
        {!!error && <Notice text={error} p={p} tone="bad" />}
      </>}
    </Sheet>
  );
}

export function LiveTraining({ palette: p, manage = false }: { palette: Palette; manage?: boolean }) {
  const saved = useSaved();
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
      {loading && <Loading p={p} />}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {manage && <Button label="New course" icon="plus" p={p} onPress={() => setEditing("new")} />}
      <List p={p} empty={manage ? "No courses yet. Add the first one." : "No training has been assigned to you yet."}>
        {/* Drafts are for the people writing them; everyone else sees published courses only. */}
        {courses.filter(c => manage || c.published).map((c, i) => (
          <Row key={c.id} p={p} first={i === 0} icon={c.completedAt ? "check-circle" : c.videoUrl ? "play-circle" : "book-open"} title={c.title} detail={`${c.minutes} min · ${c.audience.map(a => AUDIENCE_LABEL[a] ?? readableStage(a)).join(", ")}${c.files.length ? ` · ${c.files.length} file${c.files.length === 1 ? "" : "s"}` : ""}`}
            tags={[manage ? (c.published ? ["Published", "good"] : ["Draft", "plain"]) : c.completedAt ? ["Completed", "good"] : ["To do", "wait"], ...(c.required ? [["Required", "plain"] as [string, "plain"]] : []), ...(manage && c.completions != null ? [[`${c.completions} completed`, "plain"] as [string, "plain"]] : [])]}
            onPress={() => manage ? setEditing(c) : setOpen(c)} />
        ))}
      </List>
      <CourseSheet p={p} course={open} onClose={() => setOpen(null)} onCompleted={load} />
      {manage && <CourseEditor p={p} course={editing === "new" ? null : editing} visible={editing !== null} onClose={() => setEditing(null)} onDone={saved(load)} onRequiredFailed={setError} />}
    </Section>
  );
  // Management sees the staff contracts first: they and the required courses gate new staff.
  return manage ? <View style={{ gap: 28 }}><StaffContracts p={p} />{training}</View> : training;
}
