import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { View, useWindowDimensions } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Crypto from "expo-crypto";
import { Text } from "./Typography";
import { ExpandChevron, MotionPress } from "./motion";
import { Button, Field, Loading, message, Notice, Tag, london, useRequestId } from "./LiveKit";
import { Sheet } from "./TeamFlows";
import { ThinTable, thinText, type ThinColumn } from "./Tracker";
import { useSaved } from "./Celebrate";
import { HubItemSheet } from "./HubItemSheet";
import { readInbox, readTeams, writeTeams } from "./backend/client";
import { ui, type Palette } from "./theme";
import type { SectionProps } from "./SectionProps";
import { formatDay } from "../../lib/format";
import { inboxListSchema } from "../../lib/guest-inbox-policy";
import type { HubItem } from "../../lib/workspace-teams-policy";
import {
  ROWS_PER_HEADING, SUMMARY_ROWS, TODO_COLUMNS, TODO_HEADINGS, TODO_HEADING_LABEL, deriveTasks, derivedKindsFor, dueState, ensureKey, groupTodo, hubRows, lastUpdateWords, needsEnsure, nextRows,
  showAllLabel, sortTodoRows, todoCardLines, todoCells, todoCounts, todoHubSchema, todoLayout, updateTotal,
  type TodoColumnKey, type TodoHeading, type TodoHub, type TodoRow,
} from "../../lib/todo";
import { timeAgo, updateStamp } from "../../lib/tracker";

// The To-do list: one page for everything a person has to do today. Guest relations and Client
// relations first (for the people who work them), then Your team and Personal. The database adds the
// daily and department tasks; a few more are worked out from the work already on screen and marked
// Automatic. TodoSummary is the small version for Home.

// Days the daily to-dos were already asked for on this device, so opening the page again changes nothing.
const ensured = new Set<string>();
const small = (p: Palette, extra = {}) => [ui.small, { color: p.muted }, extra];

type Waiting = { count: number; since: string | null } | null;

// Reads the hub and the guests waiting, and joins them to the Automatic tasks.
function useTodoRows({ account, properties, journeys, work }: Pick<SectionProps, "account" | "properties" | "journeys" | "work">) {
  const today = london(new Date());
  const [hub, setHub] = useState<TodoHub | null>(null);
  const [waiting, setWaiting] = useState<Waiting>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const { role, userId } = account;
  const wantsInbox = derivedKindsFor(role).includes("guest_reply");

  const load = useCallback(async (first: boolean) => {
    setError("");
    // Team roles ask the database for today's department to-dos once a day. It is idempotent, and
    // a database that does not have it yet just means there are none.
    if (first && needsEnsure(role, userId, today, ensured)) {
      const key = ensureKey(userId, today);
      ensured.add(key);
      try { await writeTeams({ action: "ensureDailyTodos", requestId: Crypto.randomUUID() }); } catch { ensured.delete(key); }
    }
    const [h, w] = await Promise.allSettled([readTeams({ section: "hub" }), wantsInbox ? readInbox({ section: "list", status: "waiting" }) : Promise.resolve(null)]);
    if (h.status === "fulfilled") { try { setHub(todoHubSchema.parse(h.value.data)); } catch { setError("The to-do list could not be read. Refresh to try again."); } } else setError(message(h.reason));
    if (w.status === "fulfilled" && w.value) {
      const parsed = inboxListSchema.safeParse((w.value as { data?: unknown }).data);
      if (parsed.success) {
        const since = parsed.data.threads.map(t => t.waitingSince).filter((s): s is string => !!s).sort()[0] ?? null;
        setWaiting({ count: parsed.data.waiting, since });
      }
    }
    setLoading(false);
  }, [role, userId, today, wantsInbox]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(true); }); return () => { active = false; }; }, [load]);

  const rows = useMemo(() => [
    ...hubRows(hub?.items ?? [], userId, properties),
    ...deriveTasks({ role, today, properties, work, journeys, guestsWaiting: waiting }),
  ], [hub, userId, properties, role, today, work, journeys, waiting]);
  const reload = useCallback(() => load(false), [load]);
  return { rows, hub, loading, error, today, reload };
}

// Ticking a to-do moves it to Done (or back to To do). A repeat after a lost reply replays the same request.
function useTick(reload: () => Promise<void>) {
  const ids = useRef(new Map<string, string>());
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [error, setError] = useState("");
  const tick = useCallback(async (row: TodoRow) => {
    const item = row.item;
    if (!item || busy.has(item.id)) return;
    const key = item.id + ":" + item.version + ":" + (row.done ? "open" : "done");
    if (!ids.current.has(key)) ids.current.set(key, Crypto.randomUUID());
    setBusy(prev => new Set(prev).add(item.id)); setError("");
    try {
      await writeTeams({ action: "moveHubItem", requestId: ids.current.get(key)!, id: item.id, version: item.version, status: row.done ? "open" : "done" });
      ids.current.delete(key);
      await reload();
    } catch (e) { setError(message(e)); }
    finally { setBusy(prev => { const next = new Set(prev); next.delete(item.id); return next; }); }
  }, [busy, reload]);
  return { tick, busy, error };
}

// Opens the work behind an Automatic task, or the screen that holds it.
function useOpenAutomatic({ work, onOpenWork, onTool }: Pick<SectionProps, "work" | "onOpenWork" | "onTool">) {
  return useCallback((row: TodoRow) => {
    const w = row.open?.workId ? work.find(x => x.workId === row.open?.workId) : undefined;
    if (w) onOpenWork(w);
    else if (row.open?.target) onTool(row.open.target);
  }, [work, onOpenWork, onTool]);
}

function dueWords(row: TodoRow, today: string): string {
  const state = dueState(row, today);
  if (state === "today") return "Due today";
  if (state === "overdue") return "Overdue, due " + formatDay(row.dueOn);
  return row.dueOn ? "Due " + formatDay(row.dueOn) : "";
}

const headingStyle = (p: Palette) => ({ color: p.muted, fontSize: 12, fontWeight: "600" as const, textTransform: "uppercase" as const, letterSpacing: 1 });

const rowLabel = (row: TodoRow, today: string) => {
  const c = todoCells(row, today);
  return [row.address, row.title, c.status, dueWords(row, today), row.who ? "For " + row.who : "", row.latest ? `Latest update: ${row.latest.text}, ${c.by}, ${c.when}` : ""].filter(Boolean).join(", ");
};

// The tick box: a to-do of the hub's ticks done (or back); an Automatic task shows where it leads instead.
function Tick({ p, row, busy, size, onTick }: { p: Palette; row: TodoRow; busy: boolean; size: number; onTick: (row: TodoRow) => void }) {
  if (row.source !== "hub") return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      <Feather name="arrow-right-circle" size={18} color={p.primary} />
    </View>
  );
  return (
    <MotionPress accessibilityRole="checkbox" accessibilityState={{ checked: row.done, disabled: busy }} accessibilityLabel={(row.done ? "Reopen " : "Mark done: ") + row.title} disabled={busy} onPress={() => onTick(row)}
      style={{ width: size, height: size, alignItems: "center", justifyContent: "center", opacity: busy ? 0.5 : 1 }}>
      <Feather name={row.done ? "check-square" : "square"} size={20} color={row.done ? p.success : p.muted} />
    </MotionPress>
  );
}

// On a phone: a compact two-line card. The task and its due day, then the property and the latest update.
function TodoCard({ p, row, today, first, busy = false, onTick, onOpen }: {
  p: Palette; row: TodoRow; today: string; first: boolean; busy?: boolean; onTick: (row: TodoRow) => void; onOpen: (row: TodoRow) => void;
}) {
  const lines = todoCardLines(row, today), state = dueState(row, today);
  const dueInk = row.done ? p.muted : state === "overdue" ? p.danger : state === "today" ? p.waiting : p.muted;
  return (
    <View style={[ui.row, { alignItems: "center", gap: 2, borderTopWidth: first ? 0 : 1, borderTopColor: p.border }]}>
      <Tick p={p} row={row} busy={busy} size={44} onTick={onTick} />
      <MotionPress accessibilityRole="button" accessibilityLabel={rowLabel(row, today)} onPress={() => onOpen(row)} style={{ flex: 1, minWidth: 0, minHeight: 44, justifyContent: "center", paddingVertical: 6, paddingRight: 6, gap: 2 }}>
        <View style={[ui.row, { gap: 8 }]}>
          <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, color: row.done ? p.muted : p.text, fontSize: 14, lineHeight: 20, fontWeight: "600", textDecorationLine: row.done ? "line-through" : "none" }}>{lines.top}</Text>
          {!!lines.due && <Text style={{ color: dueInk, fontSize: 12, lineHeight: 16, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{lines.due}</Text>}
        </View>
        {!!lines.bottom && <Text numberOfLines={1} style={{ color: p.muted, fontSize: 12, lineHeight: 17 }}>{lines.bottom}</Text>}
      </MotionPress>
    </View>
  );
}

// On a computer: one thin row per to-do with the columns in TODO_COLUMNS. Clicking a row opens the detail.
function todoColumns(p: Palette, today: string, busy: ReadonlySet<string>, onTick: (row: TodoRow) => void): ThinColumn<TodoRow>[] {
  const now = new Date();
  const cell: Record<TodoColumnKey, (row: TodoRow) => ReactNode> = {
    tick: row => <Tick p={p} row={row} busy={!!row.item && busy.has(row.item.id)} size={36} onTick={onTick} />,
    property: row => thinText(p, todoCells(row, today, now).property),
    task: row => {
      const c = todoCells(row, today, now);
      return <Text numberOfLines={1} style={{ fontSize: 13, lineHeight: 18, color: row.done ? p.muted : p.text }}>
        <Text style={{ fontWeight: "600", textDecorationLine: row.done ? "line-through" : "none" }}>{c.task}</Text>{!!c.detail && <Text style={{ color: p.muted }}>{"  " + c.detail}</Text>}
      </Text>;
    },
    update: row => thinText(p, todoCells(row, today, now).update),
    by: row => thinText(p, todoCells(row, today, now).by),
    when: row => thinText(p, todoCells(row, today, now).when),
    due: row => { const c = todoCells(row, today, now); return thinText(p, c.due, { strong: c.dueTone !== "plain", color: c.dueTone === "overdue" ? p.danger : c.dueTone === "today" ? p.waiting : undefined }); },
    status: row => { const c = todoCells(row, today, now); return <Tag label={c.status} tone={c.statusTone} p={p} />; },
  };
  // The tick column's cell holds its own button, so the column is fixed and narrow.
  return TODO_COLUMNS.map(c => ({ ...c, cell: cell[c.key] }));
}

// The rows of one section, as thin table rows on a computer or two-line cards on a phone.
function TodoRows({ p, rows, today, table, busy, onTick, onOpen }: { p: Palette; rows: TodoRow[]; today: string; table: boolean; busy: ReadonlySet<string>; onTick: (row: TodoRow) => void; onOpen: (row: TodoRow) => void }) {
  if (table) return <ThinTable p={p} columns={todoColumns(p, today, busy, onTick)} rows={rows} keyOf={r => r.id} onRow={onOpen} labelOf={r => rowLabel(r, today)} />;
  return (
    <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, paddingVertical: 2, paddingHorizontal: 4, gap: 0 }]}>
      {rows.map((r, n) => <TodoCard key={r.id} p={p} row={r} today={today} first={!n} busy={!!r.item && busy.has(r.item.id)} onTick={onTick} onOpen={onOpen} />)}
    </View>
  );
}

// A to-do's detail: where, what, when and who; its updates (the running total, "Last update 2h ago by Dan",
// an Add update box and the full history, newest first); and ticking it off or changing it.
function TodoDetailSheet({ p, row, today, busy, onClose, onTick, onEdit, onUpdated }: {
  p: Palette; row: TodoRow | null; today: string; busy: boolean; onClose: () => void; onTick: (row: TodoRow) => void; onEdit: (row: TodoRow) => void; onUpdated: () => Promise<void>;
}) {
  const item = row?.item;
  const [draft, setDraft] = useState({ id: "", text: "" });
  const text = draft.id === item?.id ? draft.text : "";
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const request = useRequestId(item ? "update:" + item.id + ":" + text.trim() : null);
  async function add() {
    if (!item || saving || !text.trim()) return;
    setSaving(true); setError("");
    try {
      await writeTeams({ action: "addTodoUpdate", requestId: request.get(), id: item.id, text: text.trim() });
      request.done(); setDraft({ id: item.id, text: "" }); await onUpdated();
    } catch (e) { setError(message(e)); } finally { setSaving(false); }
  }
  const now = new Date(), c = row ? todoCells(row, today, now) : null;
  const facts = row ? [row.address, dueWords(row, today), row.who ? "For " + row.who : ""].filter(Boolean) : [];
  return (
    <Sheet palette={p} visible={!!row} onClose={onClose} title={row?.title ?? ""} subtitle={c ? `To-do · ${c.status}` : undefined} icon="clipboard">
      {row && item && c && <View style={{ gap: 16 }}>
        <View style={{ gap: 6 }}>
          {facts.map(f => <Text key={f} style={small(p)}>{f}</Text>)}
          {!!row.details && <Text selectable style={[ui.body, { color: p.text }]}>{row.details}</Text>}
        </View>
        <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
          <Button label={row.done ? "Reopen" : "Mark done"} icon={row.done ? "rotate-ccw" : "check"} primary={!row.done} p={p} disabled={busy} onPress={() => onTick(row)} />
          <Button label="Edit" icon="edit-2" p={p} onPress={() => onEdit(row)} />
        </View>
        <View style={{ gap: 10 }}>
          <Text accessibilityRole="header" style={headingStyle(p)}>Updates</Text>
          <Text accessibilityLiveRegion="polite" style={small(p, { fontVariant: ["tabular-nums"] })}>{row.updateCount ? `${updateTotal(row.updateCount)} · ${lastUpdateWords(row.latest, now)}` : lastUpdateWords(row.latest, now)}</Text>
          <Field label="Add update" value={text} onChange={v => setDraft({ id: item.id, text: v })} p={p} multiline placeholder="What happened, what is next" />
          <Button label={saving ? "Adding…" : "Add update"} icon="plus" p={p} disabled={saving || !text.trim()} onPress={() => void add()} />
          {!!error && <Notice text={error} p={p} tone="bad" />}
          {!!item.updates?.length && <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, paddingVertical: 4, gap: 0 }]}>
            {item.updates.map((u, n) => (
              <View key={u.id} accessible accessibilityLabel={`${u.text}, ${u.byName ?? "Automatic"}, ${timeAgo(u.at, now)}`} style={{ paddingVertical: 10, gap: 2, borderTopWidth: n ? 1 : 0, borderTopColor: p.border }}>
                <Text selectable style={{ color: u.kind === "note" ? p.text : p.muted, fontSize: 14, lineHeight: 20, fontWeight: u.kind === "note" ? "400" : "600" }}>{u.text}</Text>
                <Text style={small(p, { fontVariant: ["tabular-nums"] })}>{updateStamp({ at: u.at, by: u.byName, what: null }, now)} · {timeAgo(u.at, now)}</Text>
              </View>
            ))}
          </View>}
        </View>
      </View>}
    </Sheet>
  );
}

export function TodoList(props: SectionProps) {
  const { palette: p, account, properties } = props;
  const saved = useSaved();
  const { rows, hub, loading, error, today, reload } = useTodoRows(props);
  const { tick, busy, error: tickError } = useTick(reload);
  const openAutomatic = useOpenAutomatic(props);
  const [editing, setEditing] = useState<{ kind: HubItem["kind"]; item?: HubItem } | null>(null);
  const [defaults, setDefaults] = useState<{ assign?: "me" | "person" | "department"; department?: string } | undefined>();
  const [more, setMore] = useState<ReadonlySet<TodoHeading>>(new Set());
  const [doneOpen, setDoneOpen] = useState(false);
  // The open detail, by id, so it shows the fresh row (and its updates) after every reload.
  const [detailId, setDetailId] = useState<string | null>(null);
  const detail = useMemo(() => rows.find(r => r.id === detailId) ?? null, [rows, detailId]);
  const table = todoLayout(useWindowDimensions().width) === "table";
  const onTick = (row: TodoRow) => void tick(row);

  const groups = useMemo(() => groupTodo(rows, account.role, today), [rows, account.role, today]);
  const counts = useMemo(() => todoCounts(rows, today), [rows, today]);
  const done = useMemo(() => sortTodoRows(rows.filter(r => r.done), today), [rows, today]);

  function add(heading?: TodoHeading) {
    setDefaults(heading === "guest_relations" ? { department: "guest_relations" } : heading === "client_relations" ? { department: "client_relations" }
      : heading === "team" ? { assign: "department", department: hub?.department ?? "" } : { assign: "me" });
    setEditing({ kind: "todo" });
  }
  const open = (row: TodoRow) => { if (row.item) setDetailId(row.id); else openAutomatic(row); };
  const edit = (row: TodoRow) => { if (!row.item) return; setDetailId(null); setDefaults(undefined); setEditing({ kind: "todo", item: row.item }); };
  const summary = counts.open ? [`${counts.open} to do`, counts.dueToday ? `${counts.dueToday} due today` : "", counts.overdue ? `${counts.overdue} overdue` : ""].filter(Boolean).join(" · ") : "Nothing to do right now.";

  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[ui.title, { color: p.text }]}>To-do list</Text>
        <Text style={[ui.body, { color: p.muted }]}>Daily and department tasks are added for you. Add your own too.</Text>
      </View>
      <Button label="Add a to-do" icon="plus" primary p={p} onPress={() => add()} />
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {!!tickError && <Notice text={tickError} p={p} tone="bad" />}
      {loading && !rows.length && <Loading p={p} />}
      {(!loading || !!rows.length) && <Text accessibilityLiveRegion="polite" style={small(p, { fontVariant: ["tabular-nums"] })}>{summary}</Text>}

      {(!loading || !!rows.length) && groups.filter(g => g.rows.some(r => !r.done) || g.always).map(g => {
        const openRows = g.rows.filter(r => !r.done), expanded = more.has(g.heading), shown = expanded ? openRows : openRows.slice(0, ROWS_PER_HEADING);
        return (
          <View key={g.heading} style={{ gap: 8 }}>
            <View style={[ui.between, { gap: 12 }]}>
              <Text accessibilityRole="header" style={headingStyle(p)}>{g.label}{g.open ? ` · ${g.open}` : ""}</Text>
              <MotionPress accessibilityRole="button" accessibilityLabel={"Add a to-do under " + g.label} onPress={() => add(g.heading)} style={[ui.row, { gap: 4, minHeight: 44, paddingHorizontal: 6 }]}>
                <Feather name="plus" size={16} color={p.primary} /><Text style={[ui.small, { color: p.primary, fontWeight: "600" }]}>Add</Text>
              </MotionPress>
            </View>
            {!openRows.length
              ? <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, paddingVertical: 4, paddingHorizontal: 8 }]}><Text style={[ui.small, { color: p.muted, paddingVertical: 10, paddingHorizontal: 8 }]}>{g.heading === "personal" ? "Nothing on your own list. Add something you want to remember." : "Nothing to do here."}</Text></View>
              : <TodoRows p={p} rows={shown} today={today} table={table} busy={busy} onTick={onTick} onOpen={open} />}
            {openRows.length > ROWS_PER_HEADING && (
              <MotionPress accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setMore(prev => { const next = new Set(prev); if (next.has(g.heading)) next.delete(g.heading); else next.add(g.heading); return next; })} style={[ui.row, { gap: 6, minHeight: 44, alignSelf: "flex-start" }]}>
                <Text style={{ color: p.primary, fontSize: 13, fontWeight: "600" }}>{showAllLabel(openRows.length, expanded)}</Text>
              </MotionPress>
            )}
          </View>
        );
      })}

      {!!done.length && (
        <View style={{ gap: 10 }}>
          <MotionPress accessibilityRole="button" accessibilityState={{ expanded: doneOpen }} accessibilityLabel={`Done, ${done.length}`} onPress={() => setDoneOpen(v => !v)} style={[ui.row, { gap: 6, minHeight: 44, alignSelf: "flex-start" }]}>
            <Text style={{ color: p.muted, fontSize: 13, fontWeight: "600" }}>Done · {done.length}</Text>
            <ExpandChevron open={doneOpen} size={16} color={p.muted} />
          </MotionPress>
          {doneOpen && (
            <TodoRows p={p} rows={done.slice(0, 30).map(r => ({ ...r, who: [TODO_HEADING_LABEL[r.heading], r.who].filter(Boolean).join(" · ") }))} today={today} table={table} busy={busy} onTick={onTick} onOpen={open} />
          )}
        </View>
      )}

      <TodoDetailSheet p={p} row={detail} today={today} busy={!!detail?.item && busy.has(detail.item.id)} onClose={() => setDetailId(null)} onTick={onTick} onEdit={edit} onUpdated={reload} />
      <HubItemSheet p={p} hub={hub} account={account} properties={properties} target={editing} defaults={defaults} onClose={() => setEditing(null)} onSaved={saved(async () => { setEditing(null); await reload(); })} />
    </View>
  );
}

// The small version for Home: how many are waiting under each heading and the next few. `onOpenAll`
// opens the full page.
export function TodoSummary(props: SectionProps & { onOpenAll?: () => void }) {
  const { palette: p, account, onOpenAll } = props;
  const { rows, loading, error, today, reload } = useTodoRows(props);
  const { tick, busy } = useTick(reload);
  const openAutomatic = useOpenAutomatic(props);
  const counts = useMemo(() => todoCounts(rows, today), [rows, today]);
  const next = useMemo(() => nextRows(rows, today, SUMMARY_ROWS), [rows, today]);
  const both = account.role === "stays" || account.role === "admin" || account.role === "super_admin";
  const headings = TODO_HEADINGS.filter(h => h === "team" || h === "personal" ? counts.byHeading[h] > 0 : both || counts.byHeading[h] > 0);

  if (loading && !rows.length) return <Loading p={p} rows={2} />;
  return (
    <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 10 }]}>
      <View style={[ui.between, { gap: 12 }]}>
        <Text accessibilityRole="header" style={{ color: p.text, fontSize: 16, fontWeight: "600", flex: 1 }}>To-do list</Text>
        <Text accessibilityLiveRegion="polite" style={small(p, { fontVariant: ["tabular-nums"] })}>{counts.open ? `${counts.open} to do` : "All clear"}</Text>
      </View>
      {!!error && !rows.length && <Text style={small(p)}>The to-do list could not be read just now.</Text>}
      {!!counts.open && (
        <View style={[ui.row, { flexWrap: "wrap", columnGap: 16, rowGap: 4 }]}>
          {headings.map(h => <Text key={h} style={small(p, { fontVariant: ["tabular-nums"] })}>{TODO_HEADING_LABEL[h]} <Text style={{ color: p.text, fontWeight: "600" }}>{counts.byHeading[h]}</Text></Text>)}
        </View>
      )}
      {!counts.open && !error && <Text style={small(p)}>Nothing to do right now.</Text>}
      {!!next.length && (
        <View>
          {next.map((r, n) => <TodoCard key={r.id} p={p} row={r} today={today} first={!n} busy={!!r.item && busy.has(r.item.id)} onTick={t => void tick(t)} onOpen={row => { if (row.item) onOpenAll?.(); else openAutomatic(row); }} />)}
        </View>
      )}
      {!!onOpenAll && (
        <MotionPress accessibilityRole="link" accessibilityLabel="Open the full to-do list" onPress={onOpenAll} style={[ui.row, { gap: 6, minHeight: 44, alignSelf: "flex-start" }]}>
          <Text style={{ color: p.primary, fontSize: 14, fontWeight: "600" }}>{counts.open > next.length ? `See all ${counts.open}` : "Open the to-do list"}</Text>
          <Feather name="arrow-right" size={16} color={p.primary} />
        </MotionPress>
      )}
    </View>
  );
}
