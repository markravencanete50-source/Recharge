import { useCallback, useEffect, useState } from "react";
import { Platform, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { Entrance, MotionPress, motionTokens } from "./motion";
import { Button, Field, Loading, Notice, StatGrid, StatTile, Tag, message, useRequestId } from "./LiveKit";
import { Initials } from "./LiveAccounts";
import { PageHeading } from "./LivePages";
import { Segmented } from "./Segmented";
import { Sheet } from "./TeamFlows";
import { Chip } from "./SheetTable";
import { depth, ui, type Palette } from "./theme";
import { readTeams, writeTeams } from "./backend/client";
import { ROLE_LABEL } from "../../lib/admin-live";
import type { WorkspaceRole } from "../../lib/modules";
import {
  CATEGORY_ICON, CATEGORY_LABEL, FEEDBACK_CATEGORIES, STATUS_LABEL, feedbackCounts, feedbackSchema,
  type Feedback, type FeedbackCategory, type FeedbackItem, type FeedbackStatus,
} from "../../lib/team-feedback";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";

// Team feedback. Admins and the Stays team send ideas, problems and praise to the super admins,
// under their own name, and see what they sent with any reply. Super admins get every piece in
// one inbox, mark it seen or done, and reply.
type Filter = FeedbackStatus | "all";
const STATUS_TONE: Record<FeedbackStatus, "good" | "wait" | "plain"> = { new: "wait", seen: "plain", done: "good" };
const when = (iso: string) => {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: minutes > 300 * 1440 ? "numeric" : undefined, timeZone: "Europe/London" });
};
const roleName = (role: string) => ROLE_LABEL[role as WorkspaceRole] ?? role;

export function LiveFeedback({ palette: p, account }: { palette: Palette; account: WorkspaceAccount }) {
  const [data, setData] = useState<Feedback | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    try { setData(feedbackSchema.parse((await readTeams({ section: "feedback" })).data)); setError(""); } catch (e) { setError(message(e)); }
  }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  const inbox = data ? data.inbox : account.role === "super_admin";
  return (
    <View style={{ gap: 18 }}>
      <PageHeading palette={p} title={inbox ? "Feedback" : "Send feedback"}
        subtitle={inbox ? "Everything the team has sent you, newest first. Mark each one seen or done, and reply if you like." : "Ideas, problems or praise. It goes straight to the super admin, with your name on it."} />
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {!data && !error && <Loading p={p} />}
      {data && (data.inbox ? <Inbox p={p} items={data.items} onChanged={load} /> : <Sender p={p} items={data.items} onSent={load} />)}
    </View>
  );
}

// ---- Admins and Stays: write it, and see what you sent.
function Sender({ p, items, onSent }: { p: Palette; items: FeedbackItem[]; onSent: () => Promise<void> }) {
  const [category, setCategory] = useState<FeedbackCategory | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [sent, setSent] = useState(false);
  const request = useRequestId(["feedback", category ?? "", text.trim()].join(":"));
  async function send() {
    if (busy) return;
    if (!category) { setError("Choose what kind of feedback it is."); return; }
    if (text.trim().length < 5) { setError("Write a little more, so the super admin knows what you mean."); return; }
    setBusy(true); setError("");
    try {
      await writeTeams({ action: "sendFeedback", requestId: request.get(), category, message: text.trim() });
      request.done(); setText(""); setCategory(null); setSent(true); await onSent();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <>
      <View style={[ui.card, { gap: 14, backgroundColor: p.surface, borderColor: p.border, ...depth.card }]}>
        <Text style={{ color: p.text, fontSize: 15, fontWeight: "800" }}>What kind of feedback?</Text>
        <View accessibilityRole="radiogroup" style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
          {FEEDBACK_CATEGORIES.map(c => <Chip key={c} p={p} label={CATEGORY_LABEL[c]} on={category === c} onPress={() => { setCategory(c); setSent(false); }} />)}
        </View>
        <Field label="Your feedback" value={text} onChange={v => { setText(v.slice(0, 2000)); setSent(false); }} p={p} multiline
          placeholder={category === "problem" ? "What happened, and where in the app?" : category === "praise" ? "What's working well?" : "What would make work easier?"} />
        <Text style={[ui.small, { color: p.muted, alignSelf: "flex-end" }]}>{text.length} / 2000</Text>
        {!!error && <Notice text={error} p={p} tone="bad" />}
        {sent && <Notice text="Sent. The super admin has been told, and any reply will appear below." p={p} />}
        <Button label={busy ? "Sending…" : "Send to the super admin"} icon="send" primary p={p} disabled={busy} onPress={() => void send()} />
      </View>
      <Text style={{ color: p.muted, fontSize: 11, fontWeight: "700", letterSpacing: 1.4, textTransform: "uppercase" }}>What you&apos;ve sent</Text>
      {!items.length && <Notice text="Nothing yet. Your feedback, its status and any reply will show here." p={p} />}
      <View style={{ gap: 10 }}>
        {items.map((f, i) => <Entrance key={f.id} delay={Math.min(i, 10) * motionTokens.stagger}><SentRow p={p} item={f} /></Entrance>)}
      </View>
    </>
  );
}

function SentRow({ p, item: f }: { p: Palette; item: FeedbackItem }) {
  return (
    <View style={{ gap: 10, padding: 16, borderRadius: 20, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface, ...depth.card }}>
      <View style={[ui.row, { gap: 10 }]}>
        <Feather name={CATEGORY_ICON[f.category] as never} size={16} color={p.primary} />
        <Text style={{ color: p.text, fontWeight: "700", flex: 1 }}>{CATEGORY_LABEL[f.category]} · <Text style={{ color: p.muted, fontWeight: "400" }}>{when(f.createdAt)}</Text></Text>
        <Tag label={f.status === "new" ? "Sent" : STATUS_LABEL[f.status]} tone={STATUS_TONE[f.status]} p={p} />
      </View>
      <Text selectable style={[ui.body, { color: p.text }]}>{f.message}</Text>
      {!!f.reply && (
        <View style={{ gap: 4, padding: 12, borderRadius: 14, backgroundColor: p.wash }}>
          <Text style={[ui.small, { color: p.primary, fontWeight: "700" }]}>Reply from {f.repliedByName ?? "the super admin"}{f.repliedAt ? ` · ${when(f.repliedAt)}` : ""}</Text>
          <Text selectable style={[ui.body, { color: p.text }]}>{f.reply}</Text>
        </View>
      )}
    </View>
  );
}

// ---- Super admins: the inbox.
function Inbox({ p, items, onChanged }: { p: Palette; items: FeedbackItem[]; onChanged: () => Promise<void> }) {
  const counts = feedbackCounts(items);
  const [filter, setFilter] = useState<Filter | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  // Opens on what's new, or everything when nothing is.
  const shown: Filter = filter ?? (counts.new ? "new" : "all");
  const list = items.filter(f => shown === "all" || f.status === shown);
  const open = items.find(f => f.id === openId) ?? null;
  return (
    <>
      <StatGrid>
        <StatTile p={p} icon="inbox" tone="clients" label="New" value={counts.new} attention={counts.new > 0} detail="Not read yet" />
        <StatTile p={p} icon="eye" tone="stays" label="Seen" value={counts.seen} detail="Read, still open" />
        <StatTile p={p} icon="check-circle" tone="cleans" label="Done" value={counts.done} detail="Dealt with" />
        <StatTile p={p} icon="zap" tone="accounts" label="Ideas" value={items.filter(f => f.category === "idea").length} detail="Suggestions so far" />
      </StatGrid>
      <Segmented p={p} label="Feedback" value={shown} onChange={setFilter} items={[
        { key: "new", label: "New", count: counts.new, alert: counts.new > 0 }, { key: "seen", label: "Seen", count: counts.seen },
        { key: "done", label: "Done", count: counts.done }, { key: "all", label: "All" },
      ]} />
      {!list.length && <Notice text={shown === "new" ? "Nothing new. You're all caught up." : items.length ? "Nothing here." : "No feedback yet. Admins and the Stays team can send it from Send feedback."} p={p} />}
      <View style={{ gap: 10 }}>
        {list.map((f, i) => <Entrance key={f.id} delay={Math.min(i, 10) * motionTokens.stagger}><InboxRow p={p} item={f} onPress={() => setOpenId(f.id)} /></Entrance>)}
      </View>
      {open && <FeedbackSheet key={open.id} p={p} item={open} onClose={() => setOpenId(null)} onChanged={onChanged} />}
    </>
  );
}

function InboxRow({ p, item: f, onPress }: { p: Palette; item: FeedbackItem; onPress: () => void }) {
  const name = f.senderName || "Team member";
  return (
    <MotionPress {...(Platform.OS === "web" ? { dataSet: { hover: "lift" } } : {})} accessibilityRole="button" accessibilityLabel={`${CATEGORY_LABEL[f.category]} from ${name}, ${STATUS_LABEL[f.status]}`} onPress={onPress}
      style={[ui.row, { gap: 14, padding: 16, borderRadius: 20, borderWidth: 1, borderColor: f.status === "new" ? p.waiting : p.border, backgroundColor: p.surface, ...depth.card }]}>
      <Initials p={p} name={name} tone={f.senderRole === "stays" ? "stays" : undefined} size={44} />
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text numberOfLines={1} style={{ color: p.text, fontSize: 15, fontWeight: "800" }}>{name} <Text style={{ color: p.muted, fontSize: 13, fontWeight: "500" }}>· {roleName(f.senderRole)}</Text></Text>
        <Text numberOfLines={2} style={{ color: p.text, fontSize: 13, lineHeight: 19 }}>{f.message}</Text>
        <View style={[ui.row, { gap: 6, marginTop: 2 }]}>
          <Feather name={CATEGORY_ICON[f.category] as never} size={12} color={p.muted} />
          <Text style={{ color: p.muted, fontSize: 12 }}>{CATEGORY_LABEL[f.category]} · {when(f.createdAt)}{f.reply ? " · replied" : ""}</Text>
        </View>
      </View>
      <Tag label={STATUS_LABEL[f.status]} tone={STATUS_TONE[f.status]} p={p} />
      <Feather name="chevron-right" size={18} color={p.muted} />
    </MotionPress>
  );
}

function FeedbackSheet({ p, item: f, onClose, onChanged }: { p: Palette; item: FeedbackItem; onClose: () => void; onChanged: () => Promise<void> }) {
  const [reply, setReply] = useState(f.reply);
  const [busy, setBusy] = useState<FeedbackStatus | "reply" | null>(null), [error, setError] = useState("");
  const request = useRequestId(["feedback", f.id, f.version].join(":"));
  // Each change saves and closes the sheet; the list then shows the new status.
  async function save(status: FeedbackStatus, withReply: boolean) {
    if (busy) return;
    if (withReply && reply.trim().length < 2) { setError("Write the reply first."); return; }
    setBusy(withReply ? "reply" : status); setError("");
    try {
      await writeTeams({ action: "updateFeedback", requestId: request.get(), feedbackId: f.id, version: f.version, status, ...(withReply ? { reply: reply.trim() } : {}) });
      request.done(); onClose(); await onChanged();
    } catch (e) { setError(message(e)); setBusy(null); }
  }
  const name = f.senderName || "Team member";
  return (
    <Sheet palette={p} visible onClose={onClose} title={`${CATEGORY_LABEL[f.category]} from ${name}`} subtitle={`${roleName(f.senderRole)} · ${new Date(f.createdAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })}`} icon="chat">
      <View style={[ui.row, { gap: 8 }]}><Tag label={STATUS_LABEL[f.status]} tone={STATUS_TONE[f.status]} p={p} />{f.handledByName && f.status !== "new" && <Text style={[ui.small, { color: p.muted }]}>by {f.handledByName}</Text>}</View>
      <Text selectable style={[ui.body, { color: p.text, lineHeight: 22 }]}>{f.message}</Text>
      {f.reply && f.repliedAt ? <Text style={[ui.small, { color: p.muted }]}>Replied {when(f.repliedAt)}{f.repliedByName ? ` by ${f.repliedByName}` : ""}. Changing it tells {name.split(" ")[0]} again.</Text> : null}
      <Field label={`Reply to ${name.split(" ")[0]} (optional)`} value={reply} onChange={v => setReply(v.slice(0, 1000))} p={p} multiline placeholder="Thanks, we'll look at this." />
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy === "reply" ? "Sending…" : "Send reply and mark done"} icon="send" primary p={p} disabled={!!busy || reply.trim() === f.reply} onPress={() => void save("done", true)} />
      <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
        {f.status !== "seen" && <Button label="Mark as seen" icon="eye" p={p} disabled={!!busy} onPress={() => void save("seen", false)} />}
        {f.status !== "done" && <Button label="Mark as done" icon="check" p={p} disabled={!!busy} onPress={() => void save("done", false)} />}
        {f.status !== "new" && <Button label="Back to new" icon="rotate-ccw" p={p} disabled={!!busy} onPress={() => void save("new", false)} />}
      </View>
    </Sheet>
  );
}
