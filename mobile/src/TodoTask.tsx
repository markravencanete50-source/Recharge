import { useEffect, useMemo, useRef, useState } from "react";
import { Platform, TextInput, View, useWindowDimensions, type NativeSyntheticEvent, type TextInputSelectionChangeEventData } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Crypto from "expo-crypto";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { Button, message, Notice, Tag, useRequestId } from "./LiveKit";
import { Sheet } from "./TeamFlows";
import { DateField } from "./CalendarPicker";
import { MentionPicker, PersonAvatar, ReactionChips, ReactionPicker } from "./ChatParts";
import { writeTeams } from "./backend/client";
import { ui, type Palette } from "./theme";
import { insertMention, mentionOptions, mentionParts, mentionQuery, mentionsIn, type MentionOption, type MentionPerson } from "../../lib/chat-mentions";
import { TODO_PRIORITIES, TODO_PRIORITY_LABEL } from "../../lib/workspace-teams-policy";
import { changeWords, todoCells, todoFeed, type TodoPriority, type TodoRow, type TodoUpdate } from "../../lib/todo";
import { timeAgo } from "../../lib/tracker";
import { formatDay } from "../../lib/format";

// A to-do opened like a ClickUp task (Alex's video, 19 October 2026). On a computer: the to-do's fields on the left (status,
// who it is for, start and due dates, priority, property, description) and its Activity on the right; on a phone the two stack.
// Activity is oldest first with the comment box at the bottom: comments with their replies and reactions, and one-line entries
// for what changed and who changed it. Typing "@" in a comment offers the team; whoever is mentioned is told and can see the to-do.
// Opening it marks its comments read. Migration 20261025100000 keeps all of it.

export const TASK_PAGE_WIDTH = 1080;
// The two panes side by side from this window width; stacked below it.
export const TASK_TWO_PANES_FROM = 900;
const PRIORITY_INK = (p: Palette, priority: TodoPriority | null | undefined) =>
  priority === "urgent" ? p.danger : priority === "high" ? p.waiting : priority === "normal" ? p.primary : p.muted;

type Person = { userId: string; fullName: string };

function FieldRow({ p, icon, label, children }: { p: Palette; icon: React.ComponentProps<typeof Feather>["name"]; label: string; children: React.ReactNode }) {
  return (
    <View style={[ui.row, { gap: 12, alignItems: "flex-start", minHeight: 44, paddingVertical: 6 }]}>
      <View style={[ui.row, { gap: 8, width: 116, paddingTop: 10 }]}>
        <Feather name={icon} size={15} color={p.muted} />
        <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>{label}</Text>
      </View>
      <View style={{ flex: 1, minWidth: 0, justifyContent: "center" }}>{children}</View>
    </View>
  );
}

// The words of a comment, with the people it mentions in bold (yours on a wash).
function CommentText({ p, u }: { p: Palette; u: TodoUpdate }) {
  const parts = mentionParts(u.text, u.mentions.map(m => ({ name: m.name, you: m.you })), false);
  return (
    <Text selectable style={{ color: p.text, fontSize: 14, lineHeight: 20 }}>
      {parts.map((part, i) => part.mention
        ? <Text key={i} style={{ fontWeight: "700", color: p.primary, ...(part.mention === "you" ? { backgroundColor: p.wash, borderRadius: 4 } : {}) }}>{part.text}</Text>
        : <Text key={i}>{part.text}</Text>)}
    </Text>
  );
}

// The box a comment or a reply is written in. "@" opens the team list above it.
function Composer({ p, people, me, placeholder, busy, autoFocus, onSend, onCancel }: {
  p: Palette; people: Person[]; me: string; placeholder: string; busy: boolean; autoFocus?: boolean;
  onSend: (text: string, mentions: string[]) => Promise<boolean>; onCancel?: () => void;
}) {
  const [text, setText] = useState("");
  const [caret, setCaret] = useState(0);
  const [selection, setSelection] = useState<{ start: number; end: number } | undefined>();
  const team: MentionPerson[] = useMemo(() => people.map(x => ({ userId: x.userId, fullName: x.fullName, you: x.userId === me })), [people, me]);
  const query = mentionQuery(text, caret);
  const options = query ? mentionOptions(query.query, team).filter((o): o is Extract<MentionOption, { kind: "person" }> => o.kind === "person") : [];
  function pick(option: MentionOption) {
    if (!query) return;
    const next = insertMention(text, query.start, caret, option);
    setText(next.text); setCaret(next.caret); setSelection({ start: next.caret, end: next.caret });
  }
  async function send() {
    const body = text.trim();
    if (!body || busy) return;
    if (await onSend(body, mentionsIn(body, team).userIds)) { setText(""); setCaret(0); setSelection(undefined); }
  }
  return (
    <View style={{ gap: 6 }}>
      {options.length > 0 && <MentionPicker p={p} options={options} members={[]} onPick={pick} />}
      <View style={[ui.row, { gap: 8, alignItems: "flex-end", borderWidth: 1, borderColor: p.controlBorder, borderRadius: 16, backgroundColor: p.background, paddingLeft: 12, paddingRight: 6, paddingVertical: 6 }]}>
        <TextInput accessibilityLabel={placeholder} value={text} autoFocus={autoFocus} multiline maxLength={2000} placeholder={placeholder} placeholderTextColor={p.muted}
          selection={selection}
          onChangeText={v => { setText(v); setSelection(undefined); }}
          onSelectionChange={(e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => setCaret(e.nativeEvent.selection.end)}
          onKeyPress={e => { const k = e.nativeEvent as { key: string; shiftKey?: boolean }; if (Platform.OS === "web" && k.key === "Enter" && !k.shiftKey && !options.length) { e.preventDefault?.(); void send(); } }}
          style={{ flex: 1, minHeight: 36, maxHeight: 160, paddingVertical: 8, fontSize: 14, fontFamily: "Montserrat_500Medium", color: p.text }} />
        {!!onCancel && <MotionPress accessibilityRole="button" accessibilityLabel="Cancel the reply" onPress={onCancel} style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" }}>
          <Feather name="x" size={17} color={p.muted} />
        </MotionPress>}
        <MotionPress accessibilityRole="button" accessibilityLabel="Send" disabled={busy || !text.trim()} onPress={() => void send()}
          style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: text.trim() ? p.primary : p.elevated, opacity: busy ? 0.6 : 1 }}>
          <Feather name="send" size={16} color={text.trim() ? p.onPrimary : p.muted} />
        </MotionPress>
      </View>
    </View>
  );
}

function Comment({ p, u, now, reply, onReact, onReply }: { p: Palette; u: TodoUpdate; now: Date; reply?: boolean; onReact: (u: TodoUpdate, emoji: string | null) => void; onReply?: () => void }) {
  const [picking, setPicking] = useState(false);
  const mine = u.reactions.find(r => r.mine)?.emoji ?? null;
  return (
    <View style={[ui.row, { gap: 10, alignItems: "flex-start" }]}>
      <PersonAvatar p={p} name={u.byName ?? "Recharge"} userId={u.byId} size={reply ? 26 : 32} />
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
        <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
          <Text style={{ color: p.text, fontSize: 13, fontWeight: "700" }}>{u.byName ?? "Recharge"}</Text>
          <Text style={[ui.small, { color: p.muted, fontVariant: ["tabular-nums"] }]}>{timeAgo(u.at, now)}</Text>
        </View>
        <CommentText p={p} u={u} />
        <ReactionChips p={p} reactions={u.reactions} mine={false} onToggle={emoji => onReact(u, mine === emoji ? null : emoji)} />
        {picking && <ReactionPicker p={p} current={mine} onPick={emoji => { setPicking(false); onReact(u, mine === emoji ? null : emoji); }} />}
        <View style={[ui.row, { gap: 4 }]}>
          <MotionPress accessibilityRole="button" accessibilityLabel="React" onPress={() => setPicking(v => !v)} style={[ui.row, { gap: 4, minHeight: 32, paddingHorizontal: 6 }]}>
            <Feather name="smile" size={14} color={p.muted} /><Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>React</Text>
          </MotionPress>
          {!!onReply && <MotionPress accessibilityRole="button" accessibilityLabel={"Reply to " + (u.byName ?? "this comment")} onPress={onReply} style={[ui.row, { gap: 4, minHeight: 32, paddingHorizontal: 6 }]}>
            <Feather name="corner-down-right" size={14} color={p.muted} /><Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Reply</Text>
          </MotionPress>}
        </View>
      </View>
    </View>
  );
}

export function TodoTaskPage({ p, row, today, busy, me, people, onClose, onTick, onEdit, onUpdated }: {
  p: Palette; row: TodoRow | null; today: string; busy: boolean; me: string; people: Person[];
  onClose: () => void; onTick: (row: TodoRow) => void; onEdit: (row: TodoRow) => void; onUpdated: () => Promise<void>;
}) {
  const item = row?.item;
  const { width } = useWindowDimensions();
  const twoPanes = width >= TASK_TWO_PANES_FROM;
  const [saving, setSaving] = useState(false);
  // The reply box and the last problem belong to the to-do they were for, so opening another starts clean.
  const [errorFor, setErrorFor] = useState({ id: "", text: "" });
  const error = errorFor.id === item?.id ? errorFor.text : "";
  const setError = (text: string) => setErrorFor({ id: item?.id ?? "", text });
  const [replyFor, setReplyFor] = useState<{ id: string; comment: number } | null>(null);
  const replyTo = replyFor && replyFor.id === item?.id ? replyFor.comment : null;
  const setReplyTo = (comment: number | null) => setReplyFor(comment === null ? null : { id: item?.id ?? "", comment });
  const [open, setOpen] = useState<ReadonlySet<number>>(new Set());
  const comment = useRequestId(item ? "comment:" + item.id : null);
  // Opening it marks its comments read (no receipt: it is sent again on the next opening).
  const read = useRef("");
  useEffect(() => {
    if (!item || read.current === item.id) return;
    read.current = item.id;
    if (item.unread > 0) void writeTeams({ action: "readTodo", requestId: Crypto.randomUUID(), id: item.id }).then(onUpdated, () => undefined);
  }, [item, onUpdated]);
  useEffect(() => { if (!row) read.current = ""; }, [row]);

  async function run(action: Parameters<typeof writeTeams>[0]) {
    setSaving(true); setError("");
    try { await writeTeams(action); await onUpdated(); return true; }
    catch (e) { setError(message(e)); return false; }
    finally { setSaving(false); }
  }
  const setFields = (fields: { priority?: TodoPriority | null; startOn?: string | null; dueOn?: string | null }) =>
    item && run({ action: "setTodoFields", requestId: Crypto.randomUUID(), id: item.id, ...fields });
  const react = (u: TodoUpdate, emoji: string | null) => void run({ action: "reactTodoUpdate", requestId: Crypto.randomUUID(), updateId: u.id, emoji: emoji as never });
  async function send(text: string, mentions: string[], parent: number | null) {
    if (!item) return false;
    const ok = await run({ action: "addTodoUpdate", requestId: comment.get(String(parent ?? "") + text), id: item.id, text, ...(parent ? { replyTo: parent } : {}), ...(mentions.length ? { mentions } : {}) });
    if (ok) { comment.done(String(parent ?? "") + text); if (parent) { setReplyTo(null); setOpen(prev => new Set(prev).add(parent)); } }
    return ok;
  }

  const now = new Date();
  const feed = useMemo(() => (item ? todoFeed(item) : []), [item]);
  const c = row ? todoCells(row, today, now) : null;
  const assigned = row?.who ?? "No one yet";

  const details = row && item && c && (
    <View style={{ gap: 14, flex: twoPanes ? 1 : undefined, minWidth: 0 }}>
      <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
        <MotionPress accessibilityRole="button" accessibilityLabel={row.done ? "Status: done. Reopen it" : "Status: to do. Mark it done"} disabled={busy} onPress={() => onTick(row)}
          style={[ui.row, { gap: 8, minHeight: 40, paddingHorizontal: 14, borderRadius: 10, backgroundColor: row.done ? p.success : p.waiting, opacity: busy ? 0.6 : 1 }]}>
          <Text style={{ color: "#ffffff", fontWeight: "700", fontSize: 13, letterSpacing: 0.6 }}>{row.done ? "DONE" : "TO DO"}</Text>
          <Feather name={row.done ? "rotate-ccw" : "check"} size={15} color="#ffffff" />
        </MotionPress>
        <Button label="Edit" icon="edit-2" p={p} onPress={() => onEdit(row)} />
      </View>
      <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, paddingVertical: 4, paddingHorizontal: 12, gap: 0 }]}>
        <FieldRow p={p} icon="user" label="Assignee"><Text style={{ color: p.text, fontSize: 14, fontWeight: "600" }}>{assigned}</Text></FieldRow>
        <FieldRow p={p} icon="calendar" label="Dates">
          <View style={{ gap: 6 }}>
            <DateField p={p} label="Start date" mode="single" wholeMonthLink={false} today={today} empty="No start date" clearable
              value={{ from: row.startOn ?? "", to: row.startOn ?? "" }} onChange={r => void setFields({ startOn: r.from || null })} />
            <DateField p={p} label="Due date" mode="single" wholeMonthLink={false} today={today} empty="No due date" clearable
              value={{ from: row.dueOn ?? "", to: row.dueOn ?? "" }} onChange={r => void setFields({ dueOn: r.from || null })} />
          </View>
        </FieldRow>
        <FieldRow p={p} icon="flag" label="Priority">
          <View accessibilityRole="radiogroup" accessibilityLabel="Priority" style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>
            {[...TODO_PRIORITIES, null].map(level => {
              const on = (row.priority ?? null) === level, ink = PRIORITY_INK(p, level);
              return (
                <MotionPress key={level ?? "none"} accessibilityRole="radio" accessibilityState={{ selected: on }} disabled={saving} onPress={() => { if (!on) void setFields({ priority: level }); }}
                  style={[ui.row, { gap: 6, minHeight: 36, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1, borderColor: on ? ink : p.border, backgroundColor: on ? p.wash : p.surface }]}>
                  <Feather name="flag" size={13} color={level ? ink : p.muted} />
                  <Text style={{ color: on ? p.text : p.muted, fontSize: 13, fontWeight: on ? "700" : "600" }}>{level ? TODO_PRIORITY_LABEL[level] : "None"}</Text>
                </MotionPress>
              );
            })}
          </View>
        </FieldRow>
        {!!row.address && <FieldRow p={p} icon="home" label="Property"><Text style={{ color: p.text, fontSize: 14 }}>{row.address}</Text></FieldRow>}
        <FieldRow p={p} icon="clock" label="Created">
          <Text style={[ui.small, { color: p.muted }]}>{`${item.createdByName ?? "Recharge"} · ${formatDay(item.createdAt.slice(0, 10))}`}</Text>
        </FieldRow>
      </View>
      <View style={{ gap: 6 }}>
        <Text accessibilityRole="header" style={{ color: p.muted, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 1 }}>Description</Text>
        {row.details ? <Text selectable style={[ui.body, { color: p.text }]}>{row.details}</Text> : <Text style={[ui.small, { color: p.muted }]}>No description. Use Edit to add one.</Text>}
      </View>
      {row.automatic && <Notice text="Added automatically from a daily task. Tick it off when it is done." p={p} />}
    </View>
  );

  const activity = row && item && (
    <View style={[{ gap: 12, minWidth: 0 }, twoPanes ? { width: 420, borderLeftWidth: 1, borderLeftColor: p.border, paddingLeft: 20 } : { borderTopWidth: 1, borderTopColor: p.border, paddingTop: 16 }]}>
      <View style={[ui.between, { gap: 8 }]}>
        <Text accessibilityRole="header" style={{ color: p.text, fontSize: 16, fontWeight: "700" }}>Activity</Text>
        {item.updateCount > 0 && <Tag label={`${item.updates.filter(u => u.kind === "note").length} comments`} tone="plain" p={p} />}
      </View>
      {!feed.length && <Text style={[ui.small, { color: p.muted }]}>Nothing yet. Write a comment below; type @ to bring someone in.</Text>}
      {feed.map(e => e.kind === "change"
        ? <View key={e.key} style={[ui.row, { gap: 8, paddingLeft: 4 }]}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: p.controlBorder }} />
            <Text style={[ui.small, { flex: 1, color: p.muted }]}>{changeWords(e)}<Text style={{ color: p.muted }}>{" · " + timeAgo(e.at, now)}</Text></Text>
          </View>
        : <View key={e.key} style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, padding: 12, gap: 10 }]}>
            <Comment p={p} u={e.comment} now={now} onReact={react} onReply={() => setReplyTo(e.comment.id)} />
            {e.replies.length > 0 && (open.has(e.comment.id) || e.replies.length <= 2
              ? <View style={{ gap: 10, paddingLeft: 24, borderLeftWidth: 2, borderLeftColor: p.border, marginLeft: 14 }}>
                  {e.replies.map(r => <Comment key={r.id} p={p} u={r} now={now} reply onReact={react} onReply={() => setReplyTo(e.comment.id)} />)}
                </View>
              : <MotionPress accessibilityRole="button" onPress={() => setOpen(prev => new Set(prev).add(e.comment.id))} style={[ui.row, { gap: 6, minHeight: 32, paddingLeft: 40 }]}>
                  <Feather name="message-circle" size={14} color={p.primary} /><Text style={[ui.small, { color: p.primary, fontWeight: "700" }]}>{`${e.replies.length} replies`}</Text>
                </MotionPress>)}
            {replyTo === e.comment.id && <View style={{ paddingLeft: 40 }}>
              <Composer p={p} people={people} me={me} placeholder={"Reply to " + (e.comment.byName ?? "this comment")} busy={saving} autoFocus onCancel={() => setReplyTo(null)} onSend={(t, m) => send(t, m, e.comment.id)} />
            </View>}
          </View>)}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Composer p={p} people={people} me={me} placeholder="Write a comment. Type @ to mention someone" busy={saving} onSend={(t, m) => send(t, m, null)} />
    </View>
  );

  return (
    <Sheet palette={p} visible={!!row} onClose={onClose} title={row?.title ?? ""} width={TASK_PAGE_WIDTH}
      subtitle={c ? ["To-do", c.status, row?.dueOn ? "Due " + formatDay(row.dueOn) : ""].filter(Boolean).join(" · ") : undefined} icon="clipboard">
      {row && item && (twoPanes
        ? <View style={[ui.row, { gap: 20, alignItems: "flex-start" }]}>{details}{activity}</View>
        : <View style={{ gap: 20 }}>{details}{activity}</View>)}
    </Sheet>
  );
}
