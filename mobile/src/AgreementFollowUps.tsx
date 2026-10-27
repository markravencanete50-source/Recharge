import { useCallback, useEffect, useState } from "react";
import { TextInput, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { Button, Field, Loading, Notice, Tag, message, useRequestId } from "./LiveKit";
import { Sheet } from "./TeamFlows";
import { liveApi } from "./LivePages";
import { ui, type Palette } from "./theme";
import {
  DEFAULT_ARCHIVE_AFTER_HOURS, DEFAULT_FOLLOW_UP_STEPS, FOLLOW_UP_CHANNEL_LABELS, FOLLOW_UP_CHANNELS, FOLLOW_UP_LIMITS, followUpSettingsActionSchema, followUpViewSchema,
  stepLabel, waitLabel, type FollowUpAction, type FollowUpStep, type FollowUpView,
} from "../../lib/agreement-follow-ups";

// Agreement follow-ups (Business Plan v1.0, migration 20261027200000). On a lead's ticket: where the owner is in the
// sequence, the personal follow-up's four ticks, and stopping or starting the automatic messages. On the Leads page, for
// admins: the steps themselves (wording, waits, how many, and when to archive).
const STATUS: Record<string, { label: string; tone: "good" | "wait" | "bad" | "plain" }> = {
  running: { label: "Running", tone: "plain" }, stopped: { label: "Stopped", tone: "wait" }, signed: { label: "Signed", tone: "good" },
  archived: { label: "Archived", tone: "bad" }, ended: { label: "Ended", tone: "plain" },
};
const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

async function readFollowUps(propertyId?: string) {
  return followUpViewSchema.parse((await liveApi("/agreement-follow-ups" + (propertyId ? "?propertyId=" + encodeURIComponent(propertyId) : ""))).data);
}
async function sendFollowUp(action: FollowUpAction) {
  return followUpViewSchema.parse((await liveApi("/agreement-follow-ups", action)).data);
}

export function FollowUpPanel({ p, propertyId, onChanged }: { p: Palette; propertyId: string; onChanged?: () => Promise<void> | void }) {
  const [view, setView] = useState<FollowUpView | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [note, setNote] = useState(""), [stopping, setStopping] = useState(false);
  const request = useRequestId("follow-up:" + propertyId + ":" + (view?.followUp?.updatedAt ?? ""));
  const load = useCallback(async () => {
    try { setView(await readFollowUps(propertyId)); setError(""); } catch (err) { setError(message(err)); }
  }, [propertyId]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  const f = view?.followUp;
  if (!f) return error ? <Notice text={error} p={p} tone="bad" /> : null;

  async function act(input: Record<string, unknown>, key: string) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      setView(await sendFollowUp({ ...input, requestId: request.get(key) } as FollowUpAction)); request.done(key);
      setStopping(false); setNote(""); await onChanged?.();
    } catch (err) { setError(message(err)); } finally { setBusy(false); }
  }
  const status = STATUS[f.status] ?? STATUS.ended;
  const live = f.status === "running" || f.status === "stopped";
  const current = f.plan[f.step];
  const personal = live && current?.kind === "personal";
  return (
    <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, padding: 14, gap: 12 }]}>
      <View style={[ui.between, { gap: 8 }]}>
        <Text accessibilityRole="header" style={{ color: p.text, fontSize: 16, fontWeight: "700" }}>Agreement follow-ups</Text>
        <Tag label={status.label} tone={status.tone} p={p} />
      </View>
      {f.status === "running" && <Text style={[ui.small, { color: p.muted }]}>{`Next: ${stepLabel(f.plan, f.step)}, ${Date.parse(f.dueAt) <= Date.now() ? "due now" : when(f.dueAt)}.`}</Text>}
      {f.status === "stopped" && <Text style={[ui.small, { color: p.muted }]}>{`${f.reason ?? "Stopped"}. The automatic messages are paused; follow up personally.`}</Text>}
      {f.status === "archived" && <Text style={[ui.small, { color: p.muted }]}>No answer after the last follow-up, so the onboarding was archived.</Text>}
      <View style={{ gap: 4 }}>
        {f.plan.map((s, i) => {
          const state = i < f.step || !live && f.status !== "archived" ? "done" : i === f.step && live ? "current" : "todo";
          return (
            <View key={i} style={[ui.row, { gap: 8 }]}>
              <Feather name={state === "done" ? "check-circle" : state === "current" ? "arrow-right-circle" : "circle"} size={15} color={state === "done" ? p.success : state === "current" ? p.primary : p.muted} />
              <Text style={{ flex: 1, color: p.text, fontSize: 13, fontWeight: state === "current" ? "700" : "500" }}>{stepLabel(f.plan, i)}</Text>
              <Text style={[ui.small, { color: p.muted }]}>{`after ${waitLabel(s.afterHours)}`}</Text>
            </View>
          );
        })}
      </View>
      {personal && <View style={{ gap: 4 }}>
        <Text style={[ui.label, { color: p.muted }]}>Tick each one once done</Text>
        {FOLLOW_UP_CHANNELS.map(ch => {
          const done = !!f.checks[ch];
          return (
            <MotionPress key={ch} accessibilityRole="checkbox" accessibilityState={{ checked: done, disabled: done || busy }} disabled={done || busy} onPress={() => void act({ action: "confirm", propertyId, channel: ch }, "confirm:" + ch)}
              style={[ui.row, { gap: 10, minHeight: 40, paddingHorizontal: 8, borderRadius: 10, backgroundColor: done ? "transparent" : p.wash }]}>
              <Feather name={done ? "check-square" : "square"} size={17} color={done ? p.success : p.primary} />
              <Text style={{ flex: 1, color: p.text, fontSize: 14, fontWeight: "600" }}>{FOLLOW_UP_CHANNEL_LABELS[ch]}</Text>
              {done && <Text style={[ui.small, { color: p.muted }]}>{when(f.checks[ch].at)}</Text>}
            </MotionPress>
          );
        })}
      </View>}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {f.status === "running" && !stopping && <Button p={p} quiet icon="pause" label="Stop the automatic messages" onPress={() => setStopping(true)} />}
      {f.status === "running" && stopping && <View style={{ gap: 8 }}>
        <Field p={p} label="Why (optional)" value={note} onChange={v => setNote(v.slice(0, FOLLOW_UP_LIMITS.note))} placeholder="For example: the owner asked us to wait until Friday" />
        <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
          <Button p={p} primary label="Stop" disabled={busy} onPress={() => void act({ action: "stop", propertyId, ...(note.trim() ? { note: note.trim() } : {}) }, "stop")} />
          <Button p={p} quiet label="Cancel" onPress={() => setStopping(false)} />
        </View>
      </View>}
      {f.status === "stopped" && <Button p={p} icon="play" label="Start the automatic messages again" disabled={busy} onPress={() => void act({ action: "resume", propertyId }, "resume")} />}
    </View>
  );
}

// The steps, for admins (everyone else who works with leads can read them).
export function FollowUpSettingsSheet({ p, visible, onClose }: { p: Palette; visible: boolean; onClose: () => void }) {
  const [view, setView] = useState<FollowUpView | null>(null);
  const [steps, setSteps] = useState<FollowUpStep[]>([]), [archive, setArchive] = useState(String(DEFAULT_ARCHIVE_AFTER_HOURS));
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
  const request = useRequestId("follow-up-settings:" + JSON.stringify(steps) + archive);
  const load = useCallback(async () => {
    try { const v = await readFollowUps(); setView(v); setSteps(v.settings.steps); setArchive(String(v.settings.archiveAfterHours)); setError(""); } catch (err) { setError(message(err)); }
  }, []);
  useEffect(() => { if (!visible) return; let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [visible, load]);
  const canEdit = !!view?.settings.canEdit;
  const change = (i: number, next: FollowUpStep) => { setSaved(false); setSteps(s => s.map((x, j) => j === i ? next : x)); };
  const move = (i: number, by: number) => { setSaved(false); setSteps(s => { const n = [...s]; const [x] = n.splice(i, 1); n.splice(i + by, 0, x); return n; }); };
  async function save() {
    const parsed = followUpSettingsActionSchema.safeParse({ action: "saveSettings", requestId: request.get(), steps, archiveAfterHours: Number(archive) });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check the steps"); return; }
    setBusy(true); setError("");
    try { const v = await sendFollowUp(parsed.data); request.done(); setView(v); setSteps(v.settings.steps); setSaved(true); } catch (err) { setError(message(err)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible={visible} onClose={onClose} title="Agreement follow-ups" subtitle="What Recharge sends while an agreement waits to be signed" icon="chat" width={640}>
      <View style={{ gap: 14 }}>
        <Text style={[ui.small, { color: p.muted }]}>Each wait counts from the step before (the first from when the agreement is sent). Automatic steps go to the owner in the app and by email; personal steps ask the team to follow up by app, email, WhatsApp and phone. A reply from the owner stops the automatic messages. Use {"{first_name}"} and {"{property}"} in a message. Changes apply to agreements sent from now on.</Text>
        {!view && !error && <Loading p={p} rows={4} />}
        {view && steps.map((s, i) => (
          <View key={i} style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, padding: 12, gap: 10 }]}>
            <View style={[ui.between, { gap: 8 }]}>
              <Text style={{ color: p.text, fontSize: 14, fontWeight: "700" }}>{`${i + 1}. ${stepLabel(steps, i)}`}</Text>
              {canEdit && <View style={[ui.row, { gap: 4 }]}>
                <Icon p={p} name="arrow-up" label="Move up" disabled={i === 0} onPress={() => move(i, -1)} />
                <Icon p={p} name="arrow-down" label="Move down" disabled={i === steps.length - 1} onPress={() => move(i, 1)} />
                <Icon p={p} name="trash-2" label="Remove this step" disabled={steps.length === 1} onPress={() => { setSaved(false); setSteps(x => x.filter((_, j) => j !== i)); }} />
              </View>}
            </View>
            <View style={[ui.row, { gap: 8, flexWrap: "wrap", alignItems: "center" }]}>
              {(["auto", "personal"] as const).map(k => (
                <MotionPress key={k} accessibilityRole="radio" accessibilityState={{ selected: s.kind === k, disabled: !canEdit }} disabled={!canEdit}
                  onPress={() => change(i, k === "auto" ? { kind: "auto", afterHours: s.afterHours, message: s.kind === "auto" ? s.message : "" } : { kind: "personal", afterHours: s.afterHours })}
                  style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: s.kind === k ? p.primary : p.wash }}>
                  <Text style={{ color: s.kind === k ? p.onPrimary : p.primary, fontSize: 13, fontWeight: "700" }}>{k === "auto" ? "Automatic" : "Personal"}</Text>
                </MotionPress>
              ))}
              <Text style={[ui.small, { color: p.muted }]}>after</Text>
              <Hours p={p} value={s.afterHours} disabled={!canEdit} onChange={h => change(i, { ...s, afterHours: h })} />
            </View>
            {s.kind === "auto" && (canEdit
              ? <Field p={p} multiline label="Message" value={s.message} onChange={v => change(i, { ...s, message: v.slice(0, FOLLOW_UP_LIMITS.message) })} />
              : <Text selectable style={{ color: p.text, fontSize: 13, lineHeight: 19 }}>{s.message}</Text>)}
          </View>
        ))}
        {view && <View style={[ui.row, { gap: 8, flexWrap: "wrap", alignItems: "center" }]}>
          <Text style={{ color: p.text, fontSize: 14, fontWeight: "600" }}>Archive the onboarding if there is still no answer</Text>
          <Hours p={p} value={Number(archive) || 0} disabled={!canEdit} onChange={h => { setSaved(false); setArchive(String(h)); }} />
          <Text style={[ui.small, { color: p.muted }]}>after the last step</Text>
        </View>}
        {!!error && <Notice text={error} p={p} tone="bad" />}
        {saved && <Notice text="Saved. Agreements sent from now on follow these steps." p={p} />}
        {view && !canEdit && <Notice text="Only admins can change the steps." p={p} />}
        {view?.settings.updatedByName && <Text style={[ui.small, { color: p.muted }]}>{`Last changed by ${view.settings.updatedByName}, ${when(view.settings.updatedAt)}.`}</Text>}
        {canEdit && <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
          <Button p={p} quiet icon="plus" label="Add a step" disabled={steps.length >= FOLLOW_UP_LIMITS.steps} onPress={() => { setSaved(false); setSteps(x => [...x, { kind: "personal", afterHours: 24 }]); }} />
          <Button p={p} quiet icon="rotate-ccw" label="Back to the plan's steps" onPress={() => { setSaved(false); setSteps([...DEFAULT_FOLLOW_UP_STEPS]); setArchive(String(DEFAULT_ARCHIVE_AFTER_HOURS)); }} />
          <Button p={p} primary icon="check" label="Save the steps" disabled={busy} onPress={() => void save()} />
        </View>}
      </View>
    </Sheet>
  );
}

function Icon({ p, name, label, disabled, onPress }: { p: Palette; name: "arrow-up" | "arrow-down" | "trash-2"; label: string; disabled?: boolean; onPress: () => void }) {
  return (
    <MotionPress accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled }} disabled={disabled} onPress={onPress}
      style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", opacity: disabled ? 0.35 : 1 }}>
      <Feather name={name} size={16} color={p.muted} />
    </MotionPress>
  );
}

// A wait in hours, with the same wait in words beside it ("2 days").
function Hours({ p, value, disabled, onChange }: { p: Palette; value: number; disabled?: boolean; onChange: (hours: number) => void }) {
  return (
    <View style={[ui.row, { gap: 6, alignItems: "center" }]}>
      <TextInput accessibilityLabel="Hours" editable={!disabled} keyboardType="number-pad" value={value ? String(value) : ""} onChangeText={v => onChange(Number(v.replace(/\D/g, "").slice(0, 4)) || 0)}
        style={{ width: 64, minHeight: 36, paddingHorizontal: 10, borderWidth: 1, borderColor: p.controlBorder, borderRadius: 10, color: p.text, backgroundColor: p.background, fontSize: 14 }} />
      <Text style={[ui.small, { color: p.muted }]}>{value > 0 ? `hours (${waitLabel(value)})` : "hours"}</Text>
    </View>
  );
}
