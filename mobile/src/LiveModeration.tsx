import { useCallback, useEffect, useState } from "react";
import { Platform, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { Entrance, MotionPress, motionTokens } from "./motion";
import { Button, Loading, Notice, RefreshButton, StatGrid, StatTile, Tag, message, useRequestId } from "./LiveKit";
import { Initials } from "./LiveAccounts";
import { PageHeading } from "./LivePages";
import { Segmented } from "./Segmented";
import { Sheet } from "./TeamFlows";
import { Attachments } from "./ChatParts";
import { depth, ui, type Palette } from "./theme";
import { readTeams, writeTeams } from "./backend/client";
import { ROLE_LABEL } from "../../lib/admin-live";
import type { WorkspaceRole } from "../../lib/modules";
import {
  HIDDEN_LABEL, HIDE_EXPLAINED, REMOVED_LABEL, REPORT_REASON_ICON, REPORT_REASON_LABEL, REPORT_SOURCE_LABEL, attachmentSummary, chatReportsSchema, isInboxReport, reportCounts,
  reportStatusLabel, type ChatReport, type ReportStatus,
} from "../../lib/chat-moderation";

// Reported messages. Admins and super admins see every message people have reported (what it said,
// who wrote it, who reported it and why) and either remove it (hidden for everyone, replaced by
// "Removed by an admin", with its photos and videos deleted) or dismiss the report.
// Messages from guests and from people emailing client relations can be reported too (Guest message, Guest email,
// Client email): those are hidden in the app instead ("Hidden by an admin"), since nothing here can delete them from
// Airbnb, Booking.com or the sender's mailbox, and their conversation opens in Messages.
type Filter = ReportStatus | "all";
const STATUS_TONE: Record<ReportStatus, "good" | "wait" | "plain"> = { open: "wait", actioned: "good", dismissed: "plain" };
const when = (iso: string) => {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: minutes > 300 * 1440 ? "numeric" : undefined, timeZone: "Europe/London" });
};
const roleName = (role: string | null) => role ? ROLE_LABEL[role as WorkspaceRole] ?? role : "";
// "2 photos" in Team chat; "1 attachment" on a guest or client email, whose files stay in the conversation.
const filesLine = (r: ChatReport) => !isInboxReport(r) ? attachmentSummary(r.attachments, r.attachmentCount)
  : r.attachmentCount ? `${r.attachmentCount} attachment${r.attachmentCount === 1 ? "" : "s"}` : "";

export function LiveModeration({ palette: p, onOpenConversation }: { palette: Palette; onOpenConversation?: (id: string) => void }) {
  const [data, setData] = useState<ReturnType<typeof chatReportsSchema.parse> | null>(null);
  const [error, setError] = useState(""), [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<Filter | null>(null), [openId, setOpenId] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try { setData(chatReportsSchema.parse((await readTeams({ section: "chatReports" })).data)); setError(""); } catch (e) { setError(message(e)); } finally { setLoading(false); }
  }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  const items = data?.items ?? [];
  const counts = reportCounts(items);
  // Opens on what needs a decision, or everything when nothing does.
  const shown: Filter = filter ?? (counts.open ? "open" : "all");
  const list = items.filter(r => shown === "all" || r.status === shown);
  const open = items.find(r => r.id === openId) ?? null;
  return (
    <View style={{ gap: 18 }}>
      <PageHeading palette={p} title="Reported messages" action={<RefreshButton p={p} loading={loading} onPress={() => void load()} />}
        subtitle="Messages people have reported in Team chat, from guests and from client emails, newest first. Remove or hide a message, or dismiss the report if it is fine." />
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {!data && !error && <Loading p={p} />}
      {data && <>
        <StatGrid>
          <StatTile p={p} icon="flag" tone="clients" label="Open" value={counts.open} attention={counts.open > 0} detail="Waiting for a decision" />
          <StatTile p={p} icon="slash" tone="stays" label="Removed" value={counts.actioned} detail="Removed or hidden" />
          <StatTile p={p} icon="check-circle" tone="cleans" label="Dismissed" value={counts.dismissed} detail="Fine to stay" />
          <StatTile p={p} icon="list" tone="accounts" label="All reports" value={counts.all} detail="Most recent 300" />
        </StatGrid>
        <Segmented p={p} label="Reports" value={shown} onChange={setFilter} items={[
          { key: "open", label: "Open", count: counts.open, alert: counts.open > 0 }, { key: "actioned", label: "Removed", count: counts.actioned },
          { key: "dismissed", label: "Dismissed", count: counts.dismissed }, { key: "all", label: "All" },
        ]} />
        {!list.length && <Notice text={shown === "open" ? "Nothing to review. You're all caught up." : items.length ? "Nothing here." : "No reports yet. When someone reports a message in Messages, it appears here and you are told."} p={p} />}
        <View style={{ gap: 10 }}>
          {list.map((r, i) => <Entrance key={r.id} delay={Math.min(i, 10) * motionTokens.stagger}><ReportRow p={p} item={r} onPress={() => setOpenId(r.id)} /></Entrance>)}
        </View>
      </>}
      {open && <ReportSheet key={open.id} p={p} item={open} onClose={() => setOpenId(null)} onChanged={load} onOpenConversation={onOpenConversation} />}
    </View>
  );
}

function ReportRow({ p, item: r, onPress }: { p: Palette; item: ChatReport; onPress: () => void }) {
  const inbox = isInboxReport(r), name = r.authorName || (inbox ? "Guest" : "Team member"), files = filesLine(r);
  // Team chat: the sender's role. A guest or client message: where it came from, and the property.
  const about = inbox ? [REPORT_SOURCE_LABEL[r.source], r.propertyName].filter(Boolean).join(" · ") : roleName(r.authorRole);
  return (
    <MotionPress {...(Platform.OS === "web" ? { dataSet: { hover: "lift" } } : {})} accessibilityRole="button"
      accessibilityLabel={`${REPORT_REASON_LABEL[r.reason]} report on a ${inbox ? REPORT_SOURCE_LABEL[r.source].toLowerCase() : "message"} from ${name}, ${reportStatusLabel(r)}`} onPress={onPress}
      style={[ui.row, { gap: 14, padding: 16, borderRadius: 20, borderWidth: 1, borderColor: r.status === "open" ? p.waiting : p.border, backgroundColor: p.surface, ...depth.card }]}>
      <Initials p={p} name={name} size={44} />
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text numberOfLines={1} style={{ color: p.text, fontSize: 15, fontWeight: "800" }}>{name} {!!about && <Text style={{ color: p.muted, fontSize: 13, fontWeight: "500" }}>· {about}</Text>}</Text>
        {r.removed ? <Text numberOfLines={1} style={{ color: p.muted, fontSize: 13, fontStyle: "italic" }}>{inbox ? HIDDEN_LABEL : REMOVED_LABEL}</Text>
          : !!r.body.trim() && <Text numberOfLines={2} style={{ color: p.text, fontSize: 13, lineHeight: 19 }}>{r.body}</Text>}
        {!!files && <View style={[ui.row, { gap: 6 }]}><Feather name={inbox ? "paperclip" : "image"} size={12} color={p.muted} /><Text style={{ color: p.muted, fontSize: 12 }}>{files}</Text></View>}
        <View style={[ui.row, { gap: 6, marginTop: 2, flexWrap: "wrap" }]}>
          <Feather name={REPORT_REASON_ICON[r.reason] as never} size={12} color={p.muted} />
          <Text style={{ color: p.muted, fontSize: 12 }}>{REPORT_REASON_LABEL[r.reason]} · reported by {r.reporterName || "someone"} · {when(r.createdAt)}{r.sameMessageReports > 1 ? ` · ${r.sameMessageReports} reports` : ""}</Text>
        </View>
      </View>
      <Tag label={reportStatusLabel(r)} tone={STATUS_TONE[r.status]} p={p} />
      <Feather name="chevron-right" size={18} color={p.muted} />
    </MotionPress>
  );
}

function ReportSheet({ p, item: r, onClose, onChanged, onOpenConversation }: { p: Palette; item: ChatReport; onClose: () => void; onChanged: () => Promise<void>; onOpenConversation?: (id: string) => void }) {
  const [busy, setBusy] = useState<"remove" | "dismiss" | null>(null), [error, setError] = useState(""), [confirm, setConfirm] = useState(false);
  const request = useRequestId(["report", r.id, r.version].join(":"));
  const inbox = isInboxReport(r);
  // Each decision saves and closes the sheet; the list then shows the new status. A guest or client message is hidden in
  // the app rather than removed.
  async function decide(decision: "remove" | "dismiss") {
    if (busy) return;
    setBusy(decision); setError("");
    try {
      await writeTeams(inbox ? { action: "decideMessageReport", requestId: request.get(), reportId: r.id, version: r.version, decision: decision === "remove" ? "hide" : "dismiss" }
        : { action: "decideChatReport", requestId: request.get(), reportId: r.id, version: r.version, decision });
      request.done(); onClose(); await onChanged();
    } catch (e) { setError(message(e)); setBusy(null); }
  }
  const name = r.authorName || (inbox ? "Guest" : "Team member"), files = filesLine(r), isOpen = r.status === "open";
  const sent = new Date(r.sentAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
  const openId = inbox ? r.openId : null;
  return (
    <Sheet palette={p} visible onClose={onClose} title={`${REPORT_REASON_LABEL[r.reason]}: message from ${name}`}
      subtitle={`${inbox ? REPORT_SOURCE_LABEL[r.source] + " · " : ""}${r.conversation ?? "Conversation"} · ${sent}`} icon={r.source === "chat" || r.source === "guest_message" ? "chat" : "mail"}>
      <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
        <Tag label={reportStatusLabel(r)} tone={STATUS_TONE[r.status]} p={p} />
        {!isOpen && !!r.handledByName && <Text style={[ui.small, { color: p.muted }]}>by {r.handledByName}{r.handledAt ? ` · ${when(r.handledAt)}` : ""}</Text>}
        {!!openId && !!onOpenConversation && <MotionPress accessibilityRole="link" accessibilityLabel={`Open the conversation with ${name} in Messages`} onPress={() => { onClose(); onOpenConversation(openId); }}
          style={[ui.row, { gap: 4, minHeight: 32, marginLeft: "auto" }]}>
          <Text style={[ui.small, { color: p.primary, fontWeight: "600" }]}>Open the conversation</Text><Feather name="arrow-up-right" size={14} color={p.primary} />
        </MotionPress>}
      </View>
      <View style={{ gap: 8, padding: 14, borderRadius: 16, backgroundColor: p.wash }}>
        {r.removed && <Text style={[ui.small, { color: p.muted, fontWeight: "700" }]}>{inbox ? HIDDEN_LABEL : REMOVED_LABEL}. This is what it said.</Text>}
        {r.body.trim() ? <Text selectable style={[ui.body, { color: p.text, lineHeight: 22 }]}>{r.body}</Text> : !files && <Text style={[ui.small, { color: p.muted }]}>No words in this message.</Text>}
        {!!r.attachments.length && <Attachments p={p} items={r.attachments} mine={false} />}
        {!r.attachments.length && !!files && <View style={[ui.row, { gap: 6 }]}><Feather name={inbox ? "paperclip" : "image"} size={14} color={p.muted} /><Text style={[ui.small, { color: p.muted }]}>{files}{inbox ? (r.removed ? " (hidden)" : " (in the conversation)") : r.removed ? " (deleted)" : " (no longer shown)"}</Text></View>}
      </View>
      <View style={{ gap: 4 }}>
        <Text style={[ui.body, { color: p.text }]}>Reported by <Text style={{ fontWeight: "700" }}>{r.reporterName || "someone"}</Text> · {when(r.createdAt)}</Text>
        {!!r.note && <Text selectable style={[ui.body, { color: p.text }]}>“{r.note}”</Text>}
        <Text style={[ui.small, { color: p.muted }]}>
          {r.sameMessageReports > 1 ? `${r.sameMessageReports} people have reported this message. ` : ""}{name} has been reported {r.authorReports === 1 ? "once" : `${r.authorReports} times`} in all.
          {" "}{inbox ? "Guests and email senders cannot be blocked from Recharge." : "To stop someone using Recharge, block their account in Access control."}
        </Text>
      </View>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {isOpen && (confirm
        ? <View style={{ gap: 8 }}>
            <Notice text={inbox ? HIDE_EXPLAINED : "This hides the message for everyone, replaced by “Removed by an admin”, and deletes any photos or videos in it."} p={p} />
            <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
              <Button label={busy === "remove" ? (inbox ? "Hiding…" : "Removing…") : inbox ? "Yes, hide it" : "Yes, remove it"} icon={inbox ? "eye-off" : "trash-2"} primary p={p} disabled={!!busy} onPress={() => void decide("remove")} />
              <Button label="Keep it" p={p} disabled={!!busy} onPress={() => setConfirm(false)} />
            </View>
          </View>
        : <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
            <Button label={inbox ? "Hide in the app" : "Remove message"} icon={inbox ? "eye-off" : "trash-2"} primary p={p} disabled={!!busy} onPress={() => setConfirm(true)} />
            <Button label={busy === "dismiss" ? "Dismissing…" : "Dismiss report"} icon="x" p={p} disabled={!!busy} onPress={() => void decide("dismiss")} />
          </View>)}
    </Sheet>
  );
}
