import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { Text } from "./Typography";
import { Button, Field, Loading, Notice, Tag, message, useRequestId } from "./LiveKit";
import { readTeams, writeTeams } from "./backend/client";
import { ui, type Palette } from "./theme";
import {
  afterUse, changeoverReadSchema, changeoverSettingsSchema, lateLine, lowLines, stockResultSchema,
  type ChangeoverRead, type ChangeoverSettings, type OpenRepair, type StockLine,
} from "../../lib/changeover";
import { formatDay } from "../../lib/format";

// Changeovers (Business Plan, updated 17/10/26; migration 20261031200000). On the housekeeper's clean form: the time the
// form is late after, the replenishable stock (count it, and record what this changeover used) and the open repairs at
// the property, to add to instead of reporting twice. On a property, for the team: its stock, counted, and for admins
// the stock list and the late time.

const whole = (v: string) => { const n = Number(v.trim()); return v.trim() === "" ? null : Number.isInteger(n) && n >= 0 ? n : NaN; };
// The amounts typed, as { key: n }; an error when one is not a whole number.
function amountsOf(values: Record<string, string>): Record<string, number> | string {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(values)) { const n = whole(v); if (n === null) continue; if (Number.isNaN(n)) return "Give each amount as a whole number"; out[k] = n; }
  return out;
}

function useChangeover(input: { workId?: string; propertyId?: string }) {
  const [read, setRead] = useState<ChangeoverRead | null>(null), [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setRead(changeoverReadSchema.parse((await readTeams({ section: "changeover", ...input } as never)).data)); setError(""); } catch (e) { setError(message(e)); }
  }, [input.workId, input.propertyId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  return { read, setRead, error, setError, load };
}

function StockRows({ p, stock, values, onValue, mode, used }: { p: Palette; stock: StockLine[]; values: Record<string, string>; onValue: (key: string, v: string) => void; mode: "use" | "count" | null; used?: Record<string, number> | null }) {
  return <View style={{ gap: 6 }}>
    {stock.map(s => {
      const typed = whole(values[s.key] ?? ""), left = mode === "use" && typeof typed === "number" ? afterUse(s, typed) : null;
      return (
        <View key={s.key} style={[ui.row, { gap: 10, alignItems: "center", paddingVertical: 4, borderTopWidth: 1, borderColor: p.border }]}>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text style={{ color: p.text, fontWeight: "600" }}>{s.label}</Text>
            <Text style={[ui.small, { color: p.muted }]}>{s.onHand === null ? `Not counted yet · minimum ${s.minimum}` : `${s.onHand} here · minimum ${s.minimum}${left !== null ? ` · ${left} after this clean` : ""}`}{used?.[s.key] ? ` · this clean used ${used[s.key]}` : ""}</Text>
          </View>
          {s.low && <Tag label={s.restockOpen ? "Low, restock asked" : "Low"} tone="bad" p={p} />}
          {mode && <View style={{ width: 96 }}><Field label={mode === "use" ? "Used" : "Here now"} value={values[s.key] ?? ""} onChange={v => onValue(s.key, v.replace(/[^0-9]/g, "").slice(0, 6))} p={p} placeholder="0" /></View>}
        </View>
      );
    })}
  </View>;
}

// On the housekeeper's clean form.
export function ChangeoverPanel({ p, workId }: { p: Palette; workId: string }) {
  const { read, setRead, error, setError } = useChangeover({ workId });
  const [mode, setMode] = useState<"use" | "count">("use"), [values, setValues] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false), [saved, setSaved] = useState("");
  const request = useRequestId("changeover:" + workId);
  useEffect(() => { if (read?.used) queueMicrotask(() => setValues(Object.fromEntries(Object.entries(read.used ?? {}).map(([k, n]) => [k, String(n)])))); }, [read?.used]);
  if (error && !read) return <Notice text={error} p={p} tone="bad" />;
  if (!read) return <Loading p={p} rows={2} />;
  async function save() {
    const amounts = amountsOf(values);
    if (typeof amounts === "string") { setError(amounts); return; }
    if (mode === "count" && !Object.keys(amounts).length) { setError("Count at least one item"); return; }
    const input = mode === "use" ? { action: "recordStockUse", workId, used: amounts } : { action: "countStock", workId, counts: amounts };
    setBusy(true); setError(""); setSaved("");
    try {
      const r = stockResultSchema.parse((await writeTeams({ requestId: request.get(JSON.stringify(input)), ...input } as never) as { data?: unknown }).data);
      request.done(JSON.stringify(input));
      setRead(x => x ? { ...x, stock: r.stock, used: r.used } : x);
      if (mode === "count") { setValues(Object.fromEntries(Object.entries(r.used ?? {}).map(([k, n]) => [k, String(n)]))); setMode("use"); }
      setSaved(mode === "use" ? "Saved what this changeover used." : "Saved the count.");
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const low = lowLines(read.stock);
  return <View style={{ gap: 10 }}>
    <Notice text={lateLine(read.lateAfter)} p={p} />
    <View style={{ gap: 6 }}>
      <Text accessibilityRole="header" style={{ color: p.text, fontWeight: "700" }}>Replenishable stock</Text>
      <Text style={[ui.small, { color: p.muted }]}>{mode === "use" ? "Enter what you used this changeover. Anything below its minimum asks for a restock." : "Count what is in the property now."}</Text>
      {!!low.length && <Text style={[ui.small, { color: p.danger }]}>{`Low: ${low.map(s => s.label).join(", ")}`}</Text>}
      <StockRows p={p} stock={read.stock} values={values} onValue={(k, v) => setValues(x => ({ ...x, [k]: v }))} mode={mode} />
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {!!saved && <Text style={[ui.small, { color: p.success }]}>{saved}</Text>}
      <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
        <Button label={busy ? "Saving…" : mode === "use" ? "Save what was used" : "Save the count"} icon="check" p={p} disabled={busy} onPress={() => void save()} />
        <Button label={mode === "use" ? "Count what is here instead" : "Back to what was used"} icon="list" quiet p={p} onPress={() => { setMode(m => m === "use" ? "count" : "use"); setValues({}); setSaved(""); setError(""); }} />
      </View>
    </View>
    <OpenRepairs p={p} workId={workId} repairs={read.repairs} onAdded={(id, notes) => setRead(x => x ? { ...x, repairs: x.repairs.map(r => r.workId === id ? { ...r, notes } : r) } : x)} />
  </View>;
}

// Open repairs at the property: before reporting something missing or broken, add to the one already open.
function OpenRepairs({ p, workId, repairs, onAdded }: { p: Palette; workId: string; repairs: OpenRepair[]; onAdded: (id: string, notes: number) => void }) {
  const [open, setOpen] = useState<string | null>(null), [note, setNote] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState(""), [done, setDone] = useState("");
  const request = useRequestId("repair-note:" + workId);
  if (!repairs.length) return null;
  async function send(repairId: string) {
    if (note.trim().length < 3) { setError("Say what you found (at least 3 characters)"); return; }
    const input = { action: "addRepairNote", workId, repairId, note: note.trim() };
    setBusy(true); setError("");
    try {
      const r = (await writeTeams({ requestId: request.get(JSON.stringify(input)), ...input } as never) as { data?: { notes?: number } }).data;
      request.done(JSON.stringify(input)); onAdded(repairId, r?.notes ?? 0); setOpen(null); setNote(""); setDone("Added to the repair. The team has been told.");
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <View style={{ gap: 6 }}>
    <Text accessibilityRole="header" style={{ color: p.text, fontWeight: "700" }}>Already reported here</Text>
    <Text style={[ui.small, { color: p.muted }]}>If what you found is one of these, add to it rather than reporting it again.</Text>
    {repairs.map(r => <View key={r.workId} style={{ gap: 6, padding: 10, borderRadius: 12, backgroundColor: p.wash }}>
      <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
        {r.urgent && <Tag label="Urgent" tone="bad" p={p} />}
        <Text style={[ui.small, { color: p.muted }]}>{`Reported ${formatDay(r.reportedAt.slice(0, 10))}${r.notes ? ` · ${r.notes} update${r.notes === 1 ? "" : "s"} from housekeepers` : ""}`}</Text>
      </View>
      <Text style={{ color: p.text }}>{r.issue}</Text>
      {open === r.workId ? <>
        <Field label="What you found" value={note} onChange={v => setNote(v.slice(0, 1000))} p={p} multiline placeholder="Still an issue, or anything new" />
        <View style={[ui.row, { gap: 8 }]}>
          <Button label={busy ? "Sending…" : "Add to this repair"} icon="send" primary p={p} disabled={busy} onPress={() => void send(r.workId)} />
          <Button label="Cancel" quiet p={p} onPress={() => { setOpen(null); setError(""); }} />
        </View>
      </> : <Button label="Still an issue, or add to it" icon="plus" quiet p={p} onPress={() => { setOpen(r.workId); setNote(""); setDone(""); }} />}
    </View>)}
    {!!error && <Notice text={error} p={p} tone="bad" />}
    {!!done && <Text style={[ui.small, { color: p.success }]}>{done}</Text>}
  </View>;
}

// On a property, for the team: its stock, counted; admins also edit the stock list and the late time.
export function StockCard({ p, propertyId }: { p: Palette; propertyId: string }) {
  const { read, setRead, error, setError, load } = useChangeover({ propertyId });
  const [counting, setCounting] = useState(false), [values, setValues] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false), [editing, setEditing] = useState(false);
  const request = useRequestId("stock:" + propertyId);
  if (error && !read) return null;
  if (!read) return <Loading p={p} rows={2} />;
  async function count() {
    const amounts = amountsOf(values);
    if (typeof amounts === "string") { setError(amounts); return; }
    if (!Object.keys(amounts).length) { setError("Count at least one item"); return; }
    const input = { action: "countStock", propertyId, counts: amounts };
    setBusy(true); setError("");
    try {
      const r = stockResultSchema.parse((await writeTeams({ requestId: request.get(JSON.stringify(input)), ...input } as never) as { data?: unknown }).data);
      request.done(JSON.stringify(input)); setRead(x => x ? { ...x, stock: r.stock } : x); setCounting(false); setValues({});
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 8 }]}>
    <Text accessibilityRole="header" style={{ color: p.text, fontWeight: "700" }}>Replenishable stock</Text>
    <Text style={[ui.small, { color: p.muted }]}>{`Housekeepers record what each changeover uses. Below a minimum, a restock request opens. Forms are late after ${read.lateAfter}.`}</Text>
    <StockRows p={p} stock={read.stock} values={values} onValue={(k, v) => setValues(x => ({ ...x, [k]: v }))} mode={counting ? "count" : null} />
    {!!error && <Notice text={error} p={p} tone="bad" />}
    <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
      {counting ? <>
        <Button label={busy ? "Saving…" : "Save the count"} icon="check" primary p={p} disabled={busy} onPress={() => void count()} />
        <Button label="Cancel" quiet p={p} onPress={() => { setCounting(false); setValues({}); setError(""); }} />
      </> : <Button label="Count the stock" icon="list" p={p} onPress={() => setCounting(true)} />}
      {read.canEditSettings && !counting && <Button label={editing ? "Close the stock list" : "Stock list and late time"} icon="edit-3" quiet p={p} onPress={() => setEditing(v => !v)} />}
    </View>
    {editing && read.settings && <SettingsEditor p={p} settings={read.settings} onSaved={async () => { setEditing(false); await load(); }} />}
  </View>;
}

const keyFor = (label: string, taken: string[]) => {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 34) || "item";
  let key = base, n = 2;
  while (taken.includes(key)) key = `${base}_${n++}`;
  return key;
};
function SettingsEditor({ p, settings, onSaved }: { p: Palette; settings: ChangeoverSettings; onSaved: () => Promise<void> }) {
  const [late, setLate] = useState(settings.lateAfter);
  const [rows, setRows] = useState(settings.stock.map(s => ({ ...s, min: String(s.minimum) })));
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useRequestId("changeover-settings");
  async function save() {
    const parsed = changeoverSettingsSchema.safeParse({ lateAfter: late.trim(), stock: rows.map(r => ({ key: r.key, label: r.label.trim(), minimum: Number(r.min) })) });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check the settings"); return; }
    const input = { action: "saveChangeoverSettings", settings: parsed.data };
    setBusy(true); setError("");
    try { await writeTeams({ requestId: request.get(JSON.stringify(input)), ...input } as never); request.done(JSON.stringify(input)); await onSaved(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <View style={{ gap: 8, paddingTop: 8, borderTopWidth: 1, borderColor: p.border }}>
    <Field label="Forms are late after (HH:MM, UK time)" value={late} onChange={setLate} p={p} placeholder="14:45" />
    {rows.map((r, i) => <View key={r.key} style={[ui.row, { gap: 8, alignItems: "flex-end" }]}>
      <View style={{ flex: 1 }}><Field label="Stock item" value={r.label} onChange={v => setRows(x => x.map((y, j) => j === i ? { ...y, label: v.slice(0, 80) } : y))} p={p} /></View>
      <View style={{ width: 96 }}><Field label="Minimum" value={r.min} onChange={v => setRows(x => x.map((y, j) => j === i ? { ...y, min: v.replace(/[^0-9]/g, "").slice(0, 4) } : y))} p={p} /></View>
      <Button label="Remove" quiet p={p} onPress={() => setRows(x => x.filter((_, j) => j !== i))} />
    </View>)}
    <Button label="Add a stock item" icon="plus" quiet p={p} onPress={() => setRows(x => [...x, { key: keyFor("New item", x.map(y => y.key)), label: "", minimum: 1, min: "1" }])} />
    {!!error && <Notice text={error} p={p} tone="bad" />}
    <Button label={busy ? "Saving…" : "Save the stock list"} icon="check" primary p={p} disabled={busy} onPress={() => void save()} />
    <Text style={[ui.small, { color: p.muted }]}>Counts already taken are kept. A new item starts as not counted.</Text>
  </View>;
}
