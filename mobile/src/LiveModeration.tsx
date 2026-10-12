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
  REMOVED_LABEL, REPORT_REASON_ICON, REPORT_REASON_LABEL, REPORT_STATUS_LABEL, attachmentSummary, chatReportsSchema, reportCounts,
  type ChatReport, type ReportStatus,
} from "../../lib/chat-moderation";

// Reported messages. Admins and super admins see every message people have reported (what it said,
// who wrote it, who reported it and why) and either remove it (hidden for everyone, replaced by
// "Removed by an admin", with its photos and videos deleted) or dismiss the report.
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

export function LiveModeration({ palette: p }: { palette: Palette }) {
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
        subtitle="Messages people have reported, newest first. Remove a message to hide it for everyone, or dismiss the report if it is fine." />
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {!data && !error && <Loading p={p} />}
      {data && <>
        <StatGrid>
          <StatTile p={p} icon="flag" tone="clients" label="Open" value={counts.open} attention={counts.open > 0} detail="Waiting for a decision" />
          <StatTile p={p} icon="slash" tone="stays" label="Removed" value={counts.actioned} detail="Hidden for everyone" />
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
      {open && <ReportSheet key={open.id} p={p} item={open} onClose={() => setOpenId(null)} onChanged={load} />}
    </View>
  );
}

function ReportRow({ p, item: r, onPress }: { p: Palette; item: ChatReport; onPress: () => void }) {
  const name = r.authorName || "Team member", files = attachmentSummary(r.attachments, r.attachmentCount);
  return (
    <MotionPress {...(Platform.OS === "web" ? { dataSet: { hover: "lift" } } : {})} accessibilityRole="button"
      accessibilityLabel={`${REPORT_REASON_LABEL[r.reason]} report on a message from ${name}, ${REPORT_STATUS_LABEL[r.status]}`} onPress={onPress}
      style={[ui.row, { gap: 14, padding: 16, borderRadius: 20, borderWidth: 1, borderColor: r.status === "open" ? p.waiting : p.border, backgroundColor: p.surface, ...depth.card }]}>
      <Initials p={p} name={name} size={44} />
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text numberOfLines={1} style={{ color: p.text, fontSize: 15, fontWeight: "800" }}>{name} {!!r.authorRole && <Text style={{ color: p.muted, fontSize: 13, fontWeight: "500" }}>· {roleName(r.authorRole)}</Text>}</Text>
        {r.removed ? <Text numberOfLines={1} style={{ color: p.muted, fontSize: 13, fontStyle: "italic" }}>{REMOVED_LABEL}</Text>
          : !!r.body.trim() && <Text numberOfLines={2} style={{ color: p.text, fontSize: 13, lineHeight: 19 }}>{r.body}</Text>}
        {!!files && <View style={[ui.row, { gap: 6 }]}><Feather name="image" size={12} color={p.muted} /><Text style={{ color: p.muted, fontSize: 12 }}>{files}</Text></View>}
        <View style={[ui.row, { gap: 6, marginTop: 2, flexWrap: "wrap" }]}>
          <Feather name={REPORT_REASON_ICON[r.reason] as never} size={12} color={p.muted} />
          <Text style={{ color: p.muted, fontSize: 12 }}>{REPORT_REASON_LABEL[r.reason]} · reported by {r.reporterName || "someone"} · {when(r.createdAt)}{r.sameMessageReports > 1 ? ` · ${r.sameMessageReports} reports` : ""}</Text>
        </View>
      </View>
      <Tag label={REPORT_STATUS_LABEL[r.status]} tone={STATUS_TONE[r.status]} p={p} />
      <Feather name="chevron-right" size={18} color={p.muted} />
    </MotionPress>
  );
}

function ReportSheet({ p, item: r, onClose, onChanged }: { p: Palette; item: ChatReport; onClose: () => void; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState<"remove" | "dismiss" | null>(null), [error, setError] = useState(""), [confirm, setConfirm] = useState(false);
  const request = useRequestId(["report", r.id, r.version].join(":"));
  // Each decision saves and closes the sheet; the list then shows the new status.
  async function decide(decision: "remove" | "dismiss") {
    if (busy) return;
    setBusy(decision); setError("");
    try {
      await writeTeams({ action: "decideChatReport", requestId: request.get(), reportId: r.id, version: r.version, decision });
      request.done(); onClose(); await onChanged();
    } catch (e) { setError(message(e)); setBusy(null); }
  }
  const name = r.authorName || "Team member", files = attachmentSummary(r.attachments, r.attachmentCount), isOpen = r.status === "open";
  return (
    <Sheet palette={p} visible onClose={onClose} title={`${REPORT_REASON_LABEL[r.reason]}: message from ${name}`}
      subtitle={`${r.conversation ?? "Conversation"} · ${new Date(r.sentAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })}`} icon="chat">
      <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
        <Tag label={REPORT_STATUS_LABEL[r.status]} tone={STATUS_TONE[r.status]} p={p} />
        {!isOpen && !!r.handledByName && <Text style={[ui.small, { color: p.muted }]}>by {r.handledByName}{r.handledAt ? ` · ${when(r.handledAt)}` : ""}</Text>}
      </View>
      <View style={{ gap: 8, padding: 14, borderRadius: 16, backgroundColor: p.wash }}>
        {r.removed && <Text style={[ui.small, { color: p.muted, fontWeight: "700" }]}>{REMOVED_LABEL}. This is what it said.</Text>}
        {r.body.trim() ? <Text selectable style={[ui.body, { color: p.text, lineHeight: 22 }]}>{r.body}</Text> : !files && <Text style={[ui.small, { color: p.muted }]}>No words in this message.</Text>}
        {!!r.attachments.length && <Attachments p={p} items={r.attachments} mine={false} />}
        {!r.attachments.length && !!files && <View style={[ui.row, { gap: 6 }]}><Feather name="image" size={14} color={p.muted} /><Text style={[ui.small, { color: p.muted }]}>{files}{r.removed ? " (deleted)" : " (no longer shown)"}</Text></View>}
      </View>
      <View style={{ gap: 4 }}>
        <Text style={[ui.body, { color: p.text }]}>Reported by <Text style={{ fontWeight: "700" }}>{r.reporterName || "someone"}</Text> · {when(r.createdAt)}</Text>
        {!!r.note && <Text selectable style={[ui.body, { color: p.text }]}>“{r.note}”</Text>}
        <Text style={[ui.small, { color: p.muted }]}>
          {r.sameMessageReports > 1 ? `${r.sameMessageReports} people have reported this message. ` : ""}{name} has been reported {r.authorReports === 1 ? "once" : `${r.authorReports} times`} in all.
          {" "}To stop someone using Recharge, block their account in Access control.
        </Text>
      </View>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {isOpen && (confirm
        ? <View style={{ gap: 8 }}>
            <Notice text="This hides the message for everyone, replaced by “Removed by an admin”, and deletes any photos or videos in it." p={p} />
            <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
              <Button label={busy === "remove" ? "Removing…" : "Yes, remove it"} icon="trash-2" primary p={p} disabled={!!busy} onPress={() => void decide("remove")} />
              <Button label="Keep it" p={p} disabled={!!busy} onPress={() => setConfirm(false)} />
            </View>
          </View>
        : <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
            <Button label="Remove message" icon="trash-2" primary p={p} disabled={!!busy} onPress={() => setConfirm(true)} />
            <Button label={busy === "dismiss" ? "Dismissing…" : "Dismiss report"} icon="x" p={p} disabled={!!busy} onPress={() => void decide("dismiss")} />
          </View>)}
    </Sheet>
  );
}
