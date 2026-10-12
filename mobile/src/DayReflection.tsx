import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { useCelebrate } from "./Celebrate";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { Button, Field, Loading, message, Notice, useRequestId } from "./LiveKit";
import { readTeams, writeTeams } from "./backend/client";
import { buildSaveReflection, REFLECTION_COPY, REFLECTION_NOTE_MAX, shapeOwnReflection, summaryFigures, validateReflection, type OwnReflection } from "../../lib/reflection";
import { formatDay } from "../../lib/format";

// The end-of-day reflection (ask A7). It shows what the person got done today, asks what went well and
// what did not, and takes optional feedback. People in some roles must save one before clocking out:
// "Save and clock out" saves it and then runs the clock-out the caller passes in.
const SHOWN_DONE = 8;
const keyOf = (d: { wentWell: string; notWell: string; feedback: string }) => [d.wentWell.trim(), d.notWell.trim(), d.feedback.trim()].join("\u0001");

export function DayReflection({ palette: p, visible, onClose, onSaved, onClockOut }: {
  palette: Palette; visible: boolean; onClose: () => void;
  // Called after a plain save.
  onSaved?: () => void | Promise<void>;
  // When given, the sheet offers "Save and clock out" and runs this once the reflection is saved.
  onClockOut?: () => Promise<void>;
}) {
  const celebrate = useCelebrate();
  const [data, setData] = useState<OwnReflection | null>(null);
  const [wentWell, setWentWell] = useState(""), [notWell, setNotWell] = useState(""), [feedback, setFeedback] = useState("");
  const [savedKey, setSavedKey] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [note, setNote] = useState("");
  const draft = { wentWell, notWell, feedback };
  const request = useRequestId(visible && data ? ["reflection", data.shift?.id ?? data.day ?? "today", keyOf(draft)].join(":") : null);
  const load = useCallback(async () => {
    setData(null); setError(""); setNote("");
    let next: OwnReflection;
    try { next = shapeOwnReflection((await readTeams({ section: "reflection" })).data); }
    catch { next = shapeOwnReflection({}); setNote("Today’s figures could not be loaded. You can still write your reflection."); }
    setData(next);
    const saved = next.reflection;
    setWentWell(saved?.wentWell ?? ""); setNotWell(saved?.notWell ?? ""); setFeedback(saved?.feedback ?? "");
    setSavedKey(saved ? keyOf(saved) : "");
  }, []);
  useEffect(() => { if (!visible) return; let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [visible, load]);

  async function save(thenClockOut: boolean) {
    if (busy || !data) return;
    const check = validateReflection(draft);
    if (!check.ok) { setError(check.error); return; }
    setBusy(true); setError("");
    // Unchanged since it was saved: clocking out needs no second save.
    if (!(thenClockOut && savedKey === keyOf(draft))) {
      try {
        await writeTeams(buildSaveReflection({ requestId: request.get(), shiftId: data.shift?.id, ...draft, completed: data.summary.items }));
        request.done(); setSavedKey(keyOf(draft));
      } catch (e) { setError(message(e)); setBusy(false); return; }
    }
    try {
      if (thenClockOut && onClockOut) { await onClockOut(); onClose(); }
      else { celebrate(REFLECTION_COPY.saved); await onSaved?.(); onClose(); }
    } catch (e) { setError(message(e)); }
    setBusy(false);
  }

  const figures = data ? summaryFigures(data.summary) : [];
  const items = data?.summary.items ?? [];
  const wide = (value: string) => value.length > REFLECTION_NOTE_MAX * 0.9;
  return (
    <Sheet palette={p} visible={visible} onClose={() => { if (!busy) onClose(); }} title={REFLECTION_COPY.title} subtitle={data?.day ? formatDay(data.day) : REFLECTION_COPY.subtitle} icon="clipboard">
      {!data ? <Loading p={p} /> : <>
        <Text style={[ui.body, { color: p.text }]}>{REFLECTION_COPY.intro}</Text>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {figures.map(f => (
            <View key={f.label} accessibilityLabel={`${f.label}: ${f.value}`} style={{ flexGrow: 1, flexBasis: "45%", gap: 2, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: p.border, backgroundColor: p.background }}>
              <Text style={{ color: p.text, fontSize: 22, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{f.value}</Text>
              <Text style={[ui.small, { color: p.muted }]}>{f.label}</Text>
            </View>
          ))}
        </View>
        <View style={{ gap: 6 }}>
          <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>{REFLECTION_COPY.doneTitle}</Text>
          {!items.length && <Text style={[ui.small, { color: p.muted }]}>{REFLECTION_COPY.doneNone}</Text>}
          {items.slice(0, SHOWN_DONE).map((item, i) => (
            <View key={`${item.kind}:${item.ref ?? item.label}:${i}`} style={[ui.row, { gap: 8, alignItems: "flex-start" }]}>
              <Feather name="check" size={14} color={p.success} style={{ marginTop: 3 }} />
              <Text style={[ui.small, { flex: 1, color: p.text }]}>{item.label}</Text>
            </View>
          ))}
          {items.length > SHOWN_DONE && <Text style={[ui.small, { color: p.muted }]}>and {items.length - SHOWN_DONE} more</Text>}
        </View>
        {!!data.reflection && <Notice text={REFLECTION_COPY.alreadySaved} p={p} />}
        <Field label={REFLECTION_COPY.wentWell} value={wentWell} onChange={v => setWentWell(v.slice(0, REFLECTION_NOTE_MAX))} p={p} multiline placeholder={REFLECTION_COPY.wentWellHint} />
        <Field label={REFLECTION_COPY.notWell} value={notWell} onChange={v => setNotWell(v.slice(0, REFLECTION_NOTE_MAX))} p={p} multiline placeholder={REFLECTION_COPY.notWellHint} />
        <Field label={REFLECTION_COPY.feedback} value={feedback} onChange={v => setFeedback(v.slice(0, REFLECTION_NOTE_MAX))} p={p} multiline placeholder={REFLECTION_COPY.feedbackHint} />
        {(wide(wentWell) || wide(notWell) || wide(feedback)) && <Text style={[ui.small, { color: p.muted }]}>{REFLECTION_COPY.tooLong}</Text>}
        {!!note && <Notice text={note} p={p} />}
        {!!error && <Notice text={error} p={p} tone="bad" />}
        {onClockOut
          ? <Button label={busy ? "Saving…" : REFLECTION_COPY.saveAndClockOut} icon="log-out" primary p={p} disabled={busy} onPress={() => void save(true)} />
          : <Button label={busy ? "Saving…" : REFLECTION_COPY.save} icon="check" primary p={p} disabled={busy} onPress={() => void save(false)} />}
        {!!onClockOut && <Button label={REFLECTION_COPY.save} icon="check" p={p} disabled={busy} onPress={() => void save(false)} />}
      </>}
    </Sheet>
  );
}
