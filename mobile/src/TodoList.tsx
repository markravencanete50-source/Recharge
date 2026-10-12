import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Crypto from "expo-crypto";
import { Text } from "./Typography";
import { ExpandChevron, MotionPress } from "./motion";
import { Button, Loading, message, Notice, Tag, london } from "./LiveKit";
import { useSaved } from "./Celebrate";
import { HubItemSheet } from "./HubItemSheet";
import { readInbox, readTeams, writeTeams } from "./backend/client";
import { ui, type Palette } from "./theme";
import type { SectionProps } from "./SectionProps";
import { formatDay } from "../../lib/format";
import { inboxListSchema } from "../../lib/guest-inbox-policy";
import type { HubItem } from "../../lib/workspace-teams-policy";
import {
  ROWS_PER_HEADING, SUMMARY_ROWS, TODO_HEADINGS, TODO_HEADING_LABEL, deriveTasks, derivedKindsFor, dueState, ensureKey, groupTodo, hubRows, needsEnsure, nextRows, sortTodoRows, todoCounts, todoHubSchema,
  type TodoHeading, type TodoHub, type TodoRow,
} from "../../lib/todo";

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

// One to-do in the shared row style: where, what, when, who and how it stands.
function TodoRowView({ p, row, today, first, compact = false, busy = false, onTick, onOpen }: {
  p: Palette; row: TodoRow; today: string; first: boolean; compact?: boolean; busy?: boolean; onTick: (row: TodoRow) => void; onOpen: (row: TodoRow) => void;
}) {
  const state = dueState(row, today), due = dueWords(row, today);
  const meta = [due, row.who, compact && row.automatic ? "Automatic" : ""].filter(Boolean).join(" · ");
  const label = [row.address, row.title, row.done ? "Done" : "To do", row.automatic ? "Automatic" : "", due, row.who ? "For " + row.who : ""].filter(Boolean).join(", ");
  const dueInk = state === "overdue" ? p.danger : state === "today" ? p.waiting : p.muted;
  return (
    <View style={[ui.row, { alignItems: "flex-start", gap: 4, borderTopWidth: first ? 0 : 1, borderTopColor: p.border }]}>
      {row.source === "hub"
        ? <MotionPress accessibilityRole="checkbox" accessibilityState={{ checked: row.done, disabled: busy }} accessibilityLabel={(row.done ? "Reopen " : "Mark done: ") + row.title} disabled={busy} onPress={() => onTick(row)}
          style={{ width: 44, minHeight: 44, alignItems: "center", justifyContent: "center", alignSelf: "flex-start", opacity: busy ? 0.5 : 1 }}>
          <Feather name={row.done ? "check-square" : "square"} size={22} color={row.done ? p.success : p.muted} />
        </MotionPress>
        : <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 44, minHeight: 44, alignItems: "center", justifyContent: "center", alignSelf: "flex-start" }}>
          <Feather name="arrow-right-circle" size={20} color={p.primary} />
        </View>}
      <MotionPress accessibilityRole="button" accessibilityLabel={label} onPress={() => onOpen(row)}
        style={[ui.row, { flex: 1, minWidth: 0, gap: 10, alignItems: "flex-start", paddingVertical: compact ? 10 : 12, paddingRight: 4 }]}>
        <View style={{ flex: 1, minWidth: 0, gap: compact ? 3 : 5 }}>
          {!!row.address && <Text numberOfLines={compact ? 1 : 2} style={{ color: row.done ? p.muted : p.text, fontSize: 15, lineHeight: 21, fontWeight: "600" }}>{row.address}</Text>}
          <Text numberOfLines={2} style={{ color: row.done ? p.muted : p.text, fontSize: row.address ? 14 : 15, lineHeight: row.address ? 20 : 21, fontWeight: row.address ? "400" : "600", textDecorationLine: row.done ? "line-through" : "none" }}>{row.title}</Text>
          {!!meta && <Text numberOfLines={1} style={[ui.small, { color: due && !row.done ? dueInk : p.muted, fontVariant: ["tabular-nums"] }]}>{meta}</Text>}
          {!compact && !!row.details && row.source === "derived" && <Text numberOfLines={2} style={small(p)}>{row.details}</Text>}
          {!compact && (
            <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
              <Tag label={row.done ? "Done" : "To do"} tone={row.done ? "good" : "wait"} p={p} />
              {row.automatic && <Tag label="Automatic" tone="plain" p={p} />}
            </View>
          )}
        </View>
        <Feather name="chevron-right" size={18} color={p.muted} style={{ alignSelf: "center" }} />
      </MotionPress>
    </View>
  );
}

const headingStyle = (p: Palette) => ({ color: p.muted, fontSize: 12, fontWeight: "600" as const, textTransform: "uppercase" as const, letterSpacing: 1 });

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

  const groups = useMemo(() => groupTodo(rows, account.role, today), [rows, account.role, today]);
  const counts = useMemo(() => todoCounts(rows, today), [rows, today]);
  const done = useMemo(() => sortTodoRows(rows.filter(r => r.done), today), [rows, today]);

  function add(heading?: TodoHeading) {
    setDefaults(heading === "guest_relations" ? { department: "guest_relations" } : heading === "client_relations" ? { department: "client_relations" }
      : heading === "team" ? { assign: "department", department: hub?.department ?? "" } : { assign: "me" });
    setEditing({ kind: "todo" });
  }
  const open = (row: TodoRow) => { if (row.item) { setDefaults(undefined); setEditing({ kind: "todo", item: row.item }); } else openAutomatic(row); };
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
            <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, paddingVertical: 4, paddingHorizontal: 8, gap: 0 }]}>
              {!openRows.length && <Text style={[ui.small, { color: p.muted, paddingVertical: 14, paddingHorizontal: 8 }]}>{g.heading === "personal" ? "Nothing on your own list. Add something you want to remember." : "Nothing to do here."}</Text>}
              {shown.map((r, n) => <TodoRowView key={r.id} p={p} row={r} today={today} first={!n} busy={!!r.item && busy.has(r.item.id)} onTick={t => void tick(t)} onOpen={open} />)}
            </View>
            {openRows.length > ROWS_PER_HEADING && (
              <MotionPress accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setMore(prev => { const next = new Set(prev); if (next.has(g.heading)) next.delete(g.heading); else next.add(g.heading); return next; })} style={[ui.row, { gap: 6, minHeight: 44, alignSelf: "flex-start" }]}>
                <Text style={{ color: p.primary, fontSize: 13, fontWeight: "600" }}>{expanded ? "Show fewer" : `Show ${openRows.length - ROWS_PER_HEADING} more`}</Text>
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
            <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, paddingVertical: 4, paddingHorizontal: 8, gap: 0 }]}>
              {done.slice(0, 30).map((r, n) => <TodoRowView key={r.id} p={p} row={{ ...r, who: [TODO_HEADING_LABEL[r.heading], r.who].filter(Boolean).join(" · ") }} today={today} first={!n} busy={!!r.item && busy.has(r.item.id)} onTick={t => void tick(t)} onOpen={open} />)}
            </View>
          )}
        </View>
      )}

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
          {next.map((r, n) => <TodoRowView key={r.id} p={p} row={r} today={today} first={!n} compact busy={!!r.item && busy.has(r.item.id)} onTick={t => void tick(t)} onOpen={row => { if (row.item) onOpenAll?.(); else openAutomatic(row); }} />)}
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
