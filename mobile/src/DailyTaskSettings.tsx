import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { Chip } from "./SheetTable";
import { Button, Field, Loading, message, Notice, Tag, useRequestId } from "./LiveKit";
import { useSaved } from "./Celebrate";
import { Sheet } from "./TeamFlows";
import { readTeams, writeTeams } from "./backend/client";
import { ui, type Palette } from "./theme";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import { DEPARTMENTS } from "../../lib/workspace-teams-policy";
import { DEPARTMENT_LABEL } from "../../lib/hub";
import { ALL_WEEKDAYS, WEEKDAYS_ONLY, WEEKDAY_LONG, WEEKDAY_SHORT, dailyTasksSchema, normaliseWeekdays, toggleWeekday, validWeekdays, weekdaysSummary, type DailyTask } from "../../lib/todo";

// Admins keep the list of daily tasks here: what each department does on which days. The database adds
// each one to the department's to-do list on those days. Mounted in Management.
type Department = (typeof DEPARTMENTS)[number];

export function DailyTaskSettings({ p, account }: { p: Palette; account: WorkspaceAccount }) {
  const saved = useSaved();
  const admin = account.role === "admin" || account.role === "super_admin";
  const [templates, setTemplates] = useState<DailyTask[] | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<{ task?: DailyTask } | null>(null);
  const load = useCallback(async () => {
    try { setTemplates(dailyTasksSchema.parse((await readTeams({ section: "dailyTasks" })).data).templates); setError(""); } catch (e) { setError(message(e)); }
  }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active && admin) void load(); }); return () => { active = false; }; }, [load, admin]);
  const byDepartment = useMemo(() => DEPARTMENTS.map(d => ({ department: d, tasks: (templates ?? []).filter(t => t.department === d) })).filter(g => g.tasks.length), [templates]);

  if (!admin) return <Notice text="Only admins can change the daily tasks." p={p} />;
  return (
    <View style={{ gap: 12 }}>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Daily tasks</Text>
        <Text style={[ui.small, { color: p.muted }]}>Tasks added to a department’s to-do list on the days you choose. Each appears once a day, due that day.</Text>
      </View>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {!templates && !error && <Loading p={p} />}
      {templates && <>
        <Button label="Add a daily task" icon="plus" primary p={p} onPress={() => setEditing({})} />
        {!templates.length && <Notice text="No daily tasks yet. Add the jobs each department does regularly and they will turn up on its list." p={p} />}
        {byDepartment.map(g => (
          <View key={g.department} style={{ gap: 6 }}>
            <Text accessibilityRole="header" style={{ color: p.muted, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 1 }}>{DEPARTMENT_LABEL[g.department]}</Text>
            <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, paddingVertical: 4, paddingHorizontal: 8, gap: 0 }]}>
              {g.tasks.map((t, n) => (
                <MotionPress key={t.id} accessibilityRole="button" accessibilityLabel={`${t.title}, ${weekdaysSummary(t.weekdays)}, ${t.active ? "on" : "off"}`} onPress={() => setEditing({ task: t })}
                  style={[ui.row, { gap: 10, alignItems: "flex-start", paddingVertical: 12, paddingHorizontal: 4, borderTopWidth: n ? 1 : 0, borderTopColor: p.border }]}>
                  <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                    <Text numberOfLines={2} style={{ color: t.active ? p.text : p.muted, fontSize: 15, lineHeight: 21, fontWeight: "600" }}>{t.title}</Text>
                    <Text style={[ui.small, { color: p.muted }]}>{weekdaysSummary(t.weekdays)}</Text>
                  </View>
                  <Tag label={t.active ? "On" : "Off"} tone={t.active ? "good" : "plain"} p={p} />
                </MotionPress>
              ))}
            </View>
          </View>
        ))}
      </>}
      <DailyTaskSheet p={p} target={editing} onClose={() => setEditing(null)} onSaved={saved(async () => { setEditing(null); await load(); })} />
    </View>
  );
}

function DailyTaskSheet({ p, target, onClose, onSaved }: { p: Palette; target: { task?: DailyTask } | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const task = target?.task;
  const [department, setDepartment] = useState<Department>("guest_relations");
  const [title, setTitle] = useState(""), [details, setDetails] = useState("");
  const [days, setDays] = useState<number[]>([...WEEKDAYS_ONLY]);
  const [active, setActive] = useState(true);
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useRequestId(target ? [task?.id ?? "new", title, details, department, normaliseWeekdays(days).join(""), active].join(":") : null);
  const remove = useRequestId(task ? "remove:" + task.id : null);
  useEffect(() => {
    let live = true;
    queueMicrotask(() => {
      if (!live) return;
      setDepartment(task?.department ?? "guest_relations"); setTitle(task?.title ?? ""); setDetails(task?.details ?? "");
      setDays(task ? normaliseWeekdays(task.weekdays) : [...WEEKDAYS_ONLY]); setActive(task?.active ?? true); setConfirm(false); setError("");
    });
    return () => { live = false; };
  }, [task, target]);

  async function save() {
    if (busy) return;
    if (title.trim().length < 2) { setError("Say what the task is."); return; }
    const weekdays = normaliseWeekdays(days);
    if (!validWeekdays(weekdays)) { setError("Choose at least one day."); return; }
    setBusy(true); setError("");
    try {
      await writeTeams({ action: "saveDailyTask", requestId: request.get(), ...(task ? { id: task.id } : {}), department, title: title.trim(), details: details.trim(), weekdays, active });
      request.done(); await onSaved();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function drop() {
    if (!task || busy) return;
    setBusy(true); setError("");
    try { await writeTeams({ action: "removeDailyTask", requestId: remove.get(), id: task.id }); remove.done(); await onSaved(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }

  return (
    <Sheet palette={p} visible={!!target} onClose={onClose} title={task ? task.title : "New daily task"} subtitle={task ? `${DEPARTMENT_LABEL[task.department]} · ${weekdaysSummary(task.weekdays)}` : "Added to the department’s list on the days you choose"} icon="clipboard">
      <Field label="Task" value={title} onChange={setTitle} p={p} placeholder="Check the guest messages" />
      <Field label="Details (optional)" value={details} onChange={setDetails} p={p} multiline />
      <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Department</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>{DEPARTMENTS.map(d => <Chip key={d} p={p} label={DEPARTMENT_LABEL[d]} on={department === d} onPress={() => setDepartment(d)} />)}</View>
      <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Days</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel="Days of the week" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {WEEKDAY_SHORT.map((label, i) => <Chip key={label} p={p} label={label} on={days.includes(i + 1)} onPress={() => setDays(d => toggleWeekday(d, i + 1))} />)}
      </View>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Chip p={p} label="Weekdays" on={weekdaysSummary(days) === "Weekdays"} onPress={() => setDays([...WEEKDAYS_ONLY])} />
        <Chip p={p} label="Every day" on={days.length === ALL_WEEKDAYS.length} onPress={() => setDays([...ALL_WEEKDAYS])} />
      </View>
      {days.length > 0 && days.length < 7 && <Text style={[ui.small, { color: p.muted }]}>{normaliseWeekdays(days).map(d => WEEKDAY_LONG[d - 1]).join(", ")}</Text>}
      <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Switched</Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Chip p={p} label="On" on={active} onPress={() => setActive(true)} />
        <Chip p={p} label="Off" on={!active} onPress={() => setActive(false)} />
      </View>
      <Button label={busy ? "Saving…" : task ? "Save changes" : "Add"} primary p={p} disabled={busy} onPress={() => void save()} />
      {task && !confirm && <Button label="Remove this daily task" icon="trash-2" p={p} disabled={busy} onPress={() => setConfirm(true)} />}
      {task && confirm && <View style={{ gap: 8 }}>
        <Text style={[ui.small, { color: p.muted }]}>It stops being added from tomorrow. To-dos already made stay on the lists.</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Button label="Yes, remove it" primary p={p} disabled={busy} onPress={() => void drop()} />
          <Button label="Keep it" p={p} disabled={busy} onPress={() => setConfirm(false)} />
        </View>
      </View>}
      {!!error && <Notice text={error} p={p} tone="bad" />}
    </Sheet>
  );
}
