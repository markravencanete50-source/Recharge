import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { Text } from "./Typography";
import { useCelebrate } from "./Celebrate";
import { ui, type Palette } from "./theme";
import { Button, london, Loading, message, Notice, Section, Tag, useRequestId } from "./LiveKit";
import { Pills } from "./AccountsPayable";
import { readTeams, writeTeams } from "./backend/client";
import { buildMarkReviewed, REFLECTION_COPY, reflectionWindow, shapeReflections, summaryLine, type ReflectionList, type ReflectionView } from "../../lib/reflection";
import { formatDay } from "../../lib/format";
import { DEPARTMENT_LABEL } from "../../lib/management-live";

// Management: what the team wrote at the end of their day. Newest day first, with the day's figures,
// what went well, what did not and any feedback. A reflection can be marked as read; a changed
// reflection becomes unread again. Mount <ReflectionReview palette={p} /> in the management area.
const RANGES = { week: 7, fortnight: 14, month: 31 } as const;
type Range = keyof typeof RANGES;
const RANGE_LABEL: Record<Range, string> = { week: "Last 7 days", fortnight: "Last 14 days", month: "Last 31 days" };
const SHOWN_DONE = 4;
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });

function Paragraph({ p, title, body }: { p: Palette; title: string; body: string }) {
  if (!body.trim()) return null;
  return (
    <View style={{ gap: 2 }}>
      <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>{title}</Text>
      <Text style={[ui.body, { color: p.text }]}>{body}</Text>
    </View>
  );
}

function ReflectionCard({ p, item, first, onChanged }: { p: Palette; item: ReflectionView; first: boolean; onChanged: () => Promise<void> }) {
  const celebrate = useCelebrate();
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useRequestId(item.reviewedAt ? null : ["read", item.id, item.version].join(":"));
  async function markRead() {
    if (busy) return;
    setBusy(true); setError("");
    try { await writeTeams(buildMarkReviewed(request.get(), [item.id])); request.done(); celebrate("Marked as read"); await onChanged(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const who = item.fullName || "Team member";
  const done = item.completed.slice(0, SHOWN_DONE).map(c => c.label), more = item.completed.length - done.length;
  const meta = [formatDay(item.day), item.department ? DEPARTMENT_LABEL[item.department] ?? item.department : "", item.updatedAt ? `saved at ${time(item.updatedAt)}` : ""].filter(Boolean).join(" · ");
  return (
    <View style={{ gap: 10, paddingVertical: 14, borderTopWidth: first ? 0 : 1, borderColor: p.border }}>
      <View style={[ui.between, { gap: 12, alignItems: "flex-start" }]}>
        <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
          <Text style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>{who}</Text>
          <Text style={[ui.small, { color: p.muted }]}>{meta}</Text>
        </View>
        <Tag label={item.reviewedAt ? REFLECTION_COPY.read : REFLECTION_COPY.unread} tone={item.reviewedAt ? "good" : "wait"} p={p} />
      </View>
      <Text style={[ui.small, { color: p.text }]}>{summaryLine(item.summary)}</Text>
      <Paragraph p={p} title="Went well" body={item.wentWell} />
      <Paragraph p={p} title="Did not go so well" body={item.notWell} />
      <Paragraph p={p} title="Feedback" body={item.feedback} />
      {!!done.length && <Text style={[ui.small, { color: p.muted }]}>Finished: {done.join(", ")}{more > 0 ? ` and ${more} more` : ""}</Text>}
      {!!item.reviewedAt && !!item.reviewedByName && <Text style={[ui.small, { color: p.muted }]}>Read by {item.reviewedByName}</Text>}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {!item.reviewedAt && <Button label={busy ? "Saving…" : REFLECTION_COPY.markRead} icon="check" p={p} disabled={busy} onPress={() => void markRead()} />}
    </View>
  );
}

export function ReflectionReview({ palette: p }: { palette: Palette }) {
  const celebrate = useCelebrate();
  const [range, setRange] = useState<Range>("week");
  const [unreadOnly, setUnreadOnly] = useState(true);
  const [data, setData] = useState<ReflectionList | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [busy, setBusy] = useState(false), [markError, setMarkError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    const { from, to } = reflectionWindow(london(new Date()), RANGES[range]);
    try { setData(shapeReflections((await readTeams({ section: "reflections", from, to })).data)); }
    catch (e) { setError(message(e)); }
    setLoading(false);
  }, [range]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  const unread = useMemo(() => (data?.items ?? []).filter(i => !i.reviewedAt), [data]);
  const shown = unreadOnly ? unread : data?.items ?? [];
  const request = useRequestId(unread.length ? ["read-all", ...unread.map(i => `${i.id}.${i.version}`)].join(":") : null);
  async function markAll() {
    if (busy || !unread.length) return;
    setBusy(true); setMarkError("");
    try { await writeTeams(buildMarkReviewed(request.get(), unread.map(i => i.id))); request.done(); celebrate("Marked as read"); await load(); }
    catch (e) { setMarkError(message(e)); } finally { setBusy(false); }
  }
  return (
    <Section title={REFLECTION_COPY.reviewTitle} count={data ? data.unreviewed : undefined} p={p}>
      <Text style={[ui.small, { color: p.muted }]}>{REFLECTION_COPY.reviewIntro}</Text>
      <Pills p={p} values={["week", "fortnight", "month"] as const} value={range} onChange={setRange} label={v => RANGE_LABEL[v]} />
      <Pills p={p} values={["unread", "all"] as const} value={unreadOnly ? "unread" : "all"} onChange={v => setUnreadOnly(v === "unread")} label={v => v === "unread" ? "Not read yet" : "All"} />
      {loading && <Loading p={p} />}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {!loading && !error && data && <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, paddingVertical: 4, gap: 0 }]}>
        {shown.length
          ? shown.map((item, i) => <ReflectionCard key={`${item.id}:${item.version}`} p={p} item={item} first={i === 0} onChanged={load} />)
          : <Text style={[ui.small, { color: p.muted, paddingVertical: 16 }]}>{unreadOnly && data.items.length ? "Everything in this period has been read." : REFLECTION_COPY.reviewEmpty}</Text>}
      </View>}
      {!!markError && <Notice text={markError} p={p} tone="bad" />}
      {unread.length > 1 && <Button label={busy ? "Saving…" : REFLECTION_COPY.markAllRead} icon="check" p={p} disabled={busy} onPress={() => void markAll()} />}
    </Section>
  );
}
