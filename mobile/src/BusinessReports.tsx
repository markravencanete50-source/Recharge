import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Text } from "./Typography";
import { ui, type Palette } from "./theme";
import { Button, Loading, london, message, Notice, Section, StatGrid, StatTile } from "./LiveKit";
import { List, Row } from "./AccountsPayable";
import { Pills } from "./Pills";
import { DateField } from "./CalendarPicker";
import { readTeams } from "./backend/client";
import { exportReport } from "./exportReport";
import { formatDuration, formatMoney, plural } from "../../lib/format";
import { isWorkspaceAdmin } from "../../lib/modules";
import {
  channelName, channelOrder, defaultReportRange, departmentName, funnelSteps, monthName, PRIORITY_LABEL, receivedByMonth, repairStageName, REPORT_CSV,
  REPORT_INTRO, REPORT_KINDS, REPORT_LABEL, REPORT_NOTES, REPORT_SCHEMA, REPORT_SECTION, reportFilename, reportRangeError, SOURCE_LABEL, startWhenName,
  waitLabel, weekName, weekTotals,
  type AnyReport, type EnquiriesReport, type MessagesReport, type RepairsReport, type ReportKind, type TimeReport, type TodosReport,
} from "../../lib/business-reports-view";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";

// Business reports (Alex's meeting): client enquiries, repairs and spend, to-dos, messages and time worked, each for a
// date range (the last 30 days to start, up to 366 days) with a CSV download. Admins only: the database refuses everyone
// else (workspace_business_report), and this section is not drawn for them. Every figure comes from the database.
type Loaded = { [K in ReportKind]: { key: string; kind: K; report: AnyReport[K] } }[ReportKind];

function csvOf(loaded: Loaded) {
  switch (loaded.kind) {
    case "enquiries": return REPORT_CSV.enquiries(loaded.report);
    case "repairs": return REPORT_CSV.repairs(loaded.report);
    case "todos": return REPORT_CSV.todos(loaded.report);
    case "messages": return REPORT_CSV.messages(loaded.report);
    case "time": return REPORT_CSV.time(loaded.report);
  }
}

export function BusinessReports({ p, account }: { p: Palette; account: WorkspaceAccount }) {
  const allowed = isWorkspaceAdmin(account.role);
  const today = london(new Date());
  const [kind, setKind] = useState<ReportKind>("enquiries");
  const [range, setRange] = useState(() => defaultReportRange(today));
  const [dateError, setDateError] = useState("");
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [exportNote, setExportNote] = useState("");
  const latest = useRef(0);
  const key = `${kind}:${range.from}:${range.to}`;
  // A report is kept with the question it answers, so changing the dates never shows the previous answer.
  const shown = loaded?.key === key ? loaded : null;

  const load = useCallback(async () => {
    const mine = ++latest.current;
    setLoading(true); setError(""); setExportNote("");
    try {
      const data = (await readTeams({ section: REPORT_SECTION[kind], from: range.from, to: range.to })).data;
      const next = { key, kind, report: REPORT_SCHEMA[kind].parse(data) } as Loaded;
      if (mine === latest.current) setLoaded(next);
    } catch (e) { if (mine === latest.current) { setLoaded(null); setError(message(e)); } }
    finally { if (mine === latest.current) setLoading(false); }
  }, [key, kind, range.from, range.to]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active && allowed) void load(); }); return () => { active = false; }; }, [load, allowed]);

  function chooseDates(next: { from: string; to: string }) {
    const problem = reportRangeError(next.from, next.to);
    if (problem) { setDateError(problem); return; }
    setDateError(""); setRange(next);
  }
  async function download() {
    if (!shown) return;
    setExportNote("");
    try { await exportReport(csvOf(shown), reportFilename(shown.kind, shown.report)); }
    catch (e) { setExportNote(message(e)); }
  }

  if (!allowed) return null;
  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Business reports</Text>
        <Text style={[ui.small, { color: p.muted }]}>For management only. Choose a report and the dates, then download it as a spreadsheet (CSV).</Text>
      </View>
      <Pills p={p} title="Report" values={REPORT_KINDS} value={kind} onChange={setKind} label={k => REPORT_LABEL[k]} />
      <Text style={[ui.small, { color: p.muted }]}>{REPORT_INTRO[kind]}</Text>
      <View style={{ gap: 10 }}>
        <DateField p={p} label="Dates" value={range} onChange={chooseDates} today={today} />
        {!!dateError && <Notice text={dateError} p={p} tone="bad" />}
      </View>
      <Button p={p} icon="download" label="Download CSV" disabled={!shown} onPress={() => void download()} />
      {!!exportNote && <Notice text={exportNote} p={p} tone="bad" />}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {loading && !shown && <Loading p={p} />}
      {shown?.kind === "enquiries" && <EnquiriesView p={p} r={shown.report} />}
      {shown?.kind === "repairs" && <RepairsView p={p} r={shown.report} />}
      {shown?.kind === "todos" && <TodosView p={p} r={shown.report} />}
      {shown?.kind === "messages" && <MessagesView p={p} r={shown.report} />}
      {shown?.kind === "time" && <TimeView p={p} r={shown.report} />}
      {!!shown && <View style={{ gap: 6 }}>
        <Text style={[ui.small, { color: p.text, fontWeight: "600" }]}>What this report cannot show</Text>
        {REPORT_NOTES[shown.kind].map(note => <Text key={note} style={[ui.small, { color: p.muted }]}>{note}</Text>)}
      </View>}
    </View>
  );
}

// A step of the funnel as a bar, its length the share of all enquiries.
function Bar({ p, label, count, share, detail }: { p: Palette; label: string; count: number; share: number | null; detail: string }) {
  return (
    <View accessibilityLabel={`${label}, ${count}${detail ? ", " + detail : ""}`} style={{ gap: 4 }}>
      <View style={[ui.between, { gap: 8 }]}>
        <Text style={{ color: p.text, fontSize: 14, fontWeight: "600" }}>{label}</Text>
        <Text style={[ui.small, { color: p.muted, fontVariant: ["tabular-nums"] }]}>{[String(count), detail].filter(Boolean).join(" · ")}</Text>
      </View>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: p.wash, overflow: "hidden" }}>
        <View style={{ width: `${Math.max(0, Math.min(100, share ?? 0))}%`, height: 8, borderRadius: 4, backgroundColor: p.primary }} />
      </View>
    </View>
  );
}

function EnquiriesView({ p, r }: { p: Palette; r: EnquiriesReport }) {
  const steps = funnelSteps(r.funnel);
  return <>
    <StatGrid showZeros>
      <StatTile p={p} icon="inbox" label="Enquiries received" value={r.received} detail={`${SOURCE_LABEL.form} ${r.bySource.form} · ${SOURCE_LABEL.app} ${r.bySource.app}`} />
      <StatTile p={p} icon="zap" label={PRIORITY_LABEL} value={r.priority} detail="Forms that said they want to start as soon as possible" />
      <StatTile p={p} icon="clock" label="First reply" value={waitLabel(r.reply.medianMinutes)} detail={`Median · slowest ${waitLabel(r.reply.slowestMinutes)} · ${r.reply.waiting} with no reply yet`} />
      <StatTile p={p} icon="file-text" label="Time to send the estimate" value={waitLabel(r.reply.estimateMedianMinutes)} detail={`Median · slowest ${waitLabel(r.reply.estimateSlowestMinutes)} · ${plural(r.reply.estimateSent, "estimate")} sent`} />
    </StatGrid>
    <Section title="From enquiry to live" p={p}>
      <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 14 }]}>
        {steps.map(s => <Bar key={s.key} p={p} label={s.label} count={s.count} share={s.ofReceived} detail={s.fromPrevious === null ? "" : `${s.fromPrevious}% of the stage before`} />)}
        <Text style={[ui.small, { color: p.muted }]}>{plural(r.funnel.declined, "enquiry", "enquiries")} closed or declined before going live.</Text>
      </View>
    </Section>
    {r.byStart.length > 0 && <Section title="When they want to start" count={r.byStart.length} p={p}>
      <List p={p} empty="" search={false}>
        {r.byStart.map((s, i) => <Row key={s.startWhen || "none"} p={p} first={i === 0} title={startWhenName(s.startWhen)} detail="Enquiry forms" amount={String(s.count)} />)}
      </List>
    </Section>}
    <Section title="Each enquiry" count={r.rows.length} p={p}>
      <List p={p} empty="No enquiries in these dates.">
        {r.rows.map((x, i) => <Row key={x.receivedAt + i} p={p} first={i === 0} title={x.propertyName ?? "No property yet"}
          detail={[x.receivedAt.slice(0, 10), SOURCE_LABEL[x.source], x.source === "form" ? startWhenName(x.startWhen) : "", x.replyMinutes === null ? "No reply yet" : `First reply ${waitLabel(x.replyMinutes)}`].filter(Boolean).join(" · ")}
          tags={[[steps.find(s => s.key === x.reached)?.label ?? x.reached, x.reached === "live" ? "good" : "plain"], ...(x.declined ? [["Closed", "bad"] as [string, "bad"]] : [])]} />)}
      </List>
    </Section>
  </>;
}

function RepairsView({ p, r }: { p: Palette; r: RepairsReport }) {
  return <>
    <StatGrid showZeros>
      <StatTile p={p} icon="tool" label="Repairs raised" value={r.raised} detail={`${r.completed} finished in these dates`} />
      <StatTile p={p} icon="file-text" label="Quoted" value={formatMoney(r.quotedMinor)} detail={`On ${plural(r.quotedRepairs, "repair")} · final cost ${formatMoney(r.finalMinor)} on ${r.finalRepairs}`} />
      <StatTile p={p} icon="check-circle" label="Spend approved" value={formatMoney(r.spend.approvedMinor)} detail={`${formatMoney(r.spend.waitingMinor)} waiting · ${formatMoney(r.spend.rejectedMinor)} rejected`} />
    </StatGrid>
    <Section title="By stage" count={r.byStage.length} p={p}>
      <List p={p} empty="No repairs in these dates." search={false}>
        {r.byStage.map((s, i) => <Row key={s.stage} p={p} first={i === 0} title={repairStageName(s.stage)} detail="Repairs at this stage now" amount={String(s.count)} />)}
      </List>
    </Section>
    <Section title="By property" count={r.byProperty.length} p={p}>
      <List p={p} empty="No repairs or maintenance spend in these dates.">
        {r.byProperty.map((x, i) => <Row key={x.propertyId} p={p} first={i === 0} title={x.propertyName}
          detail={`${plural(x.raised, "repair")} · ${x.completed} finished · quoted ${formatMoney(x.quotedMinor)} · waiting ${formatMoney(x.waitingMinor)}`} amount={formatMoney(x.approvedMinor)} />)}
      </List>
    </Section>
  </>;
}

function TodosView({ p, r }: { p: Palette; r: TodosReport }) {
  return <>
    <StatGrid showZeros>
      <StatTile p={p} icon="check-square" label="Done" value={r.done} detail={`Of ${plural(r.total, "to-do")} · ${r.doneLate} done late`} />
      <StatTile p={p} icon="alert-circle" label="Overdue" value={r.overdue} attention={r.overdue > 0} detail={`${r.open} still open`} />
    </StatGrid>
    <Section title="By department" count={r.byDepartment.length} p={p}>
      <List p={p} empty="No to-dos in these dates." search={false}>
        {r.byDepartment.map((d, i) => <Row key={d.department || "person"} p={p} first={i === 0} title={departmentName(d.department)}
          detail={`${d.done} done of ${d.total} · ${d.doneLate} late · ${d.overdue} overdue`} amount={String(d.total)} />)}
      </List>
    </Section>
    <Section title="By person" count={r.byPerson.length} p={p}>
      <List p={p} empty="Nobody has to-dos in these dates.">
        {r.byPerson.map((x, i) => <Row key={x.userId} p={p} first={i === 0} title={x.fullName ?? "Team member"} avatar={x.fullName ?? ""}
          detail={`${x.assigned} given to them · ${x.done} ticked off · ${x.doneLate} late · ${x.overdue} overdue`} />)}
      </List>
    </Section>
  </>;
}

function MessagesView({ p, r }: { p: Palette; r: MessagesReport }) {
  const months = receivedByMonth(r), weeks = weekTotals(r);
  const channels = [...r.byChannel].sort((a, b) => channelOrder(a.channel, b.channel));
  const received = channels.reduce((n, c) => n + c.received, 0), sent = channels.reduce((n, c) => n + c.sent, 0);
  return <>
    <StatGrid showZeros>
      <StatTile p={p} icon="inbox" label="Received" value={received} detail={`On ${plural(channels.length, "channel")}`} />
      <StatTile p={p} icon="send" label="Sent" value={sent} detail="Replies and messages from the team" />
    </StatGrid>
    <Section title="Messages received per month" count={months.length} p={p}>
      <List p={p} empty="No messages in these dates." search={false}>
        {months.map((m, i) => <Row key={m.month} p={p} first={i === 0} title={monthName(m.month)}
          detail={m.channels.filter(c => c.received).map(c => `${channelName(c.channel)} ${c.received}`).join(" · ") || "None received"} amount={String(m.received)} />)}
      </List>
    </Section>
    <Section title="By channel" count={channels.length} p={p}>
      <List p={p} empty="No messages in these dates." search={false}>
        {channels.map((c, i) => <Row key={c.channel} p={p} first={i === 0} title={channelName(c.channel)} detail={`${c.received} received · ${c.sent} sent`} amount={String(c.received + c.sent)} />)}
      </List>
    </Section>
    <Section title="Reply times" count={r.replyTimes.length} p={p}>
      <List p={p} empty="No messages to reply to in these dates." search={false}>
        {[...r.replyTimes].sort((a, b) => channelOrder(a.channel, b.channel)).map((t, i) => <Row key={t.channel} p={p} first={i === 0} title={channelName(t.channel)}
          detail={`${plural(t.count, "message")} · slowest ${waitLabel(t.slowestMinutes)}`} amount={waitLabel(t.medianMinutes)} />)}
      </List>
    </Section>
    <Section title="By week" count={weeks.length} p={p}>
      <List p={p} empty="No messages in these dates." search={false}>
        {weeks.map((w, i) => <Row key={w.week} p={p} first={i === 0} title={weekName(w.week)} detail={`${w.received} received · ${w.sent} sent`} amount={String(w.received + w.sent)} />)}
      </List>
    </Section>
  </>;
}

function TimeView({ p, r }: { p: Palette; r: TimeReport }) {
  return <>
    <StatGrid showZeros>
      <StatTile p={p} icon="clock" label="Hours worked" value={formatDuration(r.minutes)} detail={`${plural(r.shifts, "shift")}${r.running ? ` · ${r.running} still running` : ""}`} />
      <StatTile p={p} icon="pause-circle" label="Unpaid pauses" value={formatDuration(r.unpaidMinutes)} detail="Taken off the hours" />
      <StatTile p={p} icon="trending-up" label="Overtime" value={formatDuration(r.overtimeMinutes)} detail="From when overtime was started" />
    </StatGrid>
    <Section title="By department" count={r.byDepartment.length} p={p}>
      <List p={p} empty="No shifts in these dates." search={false}>
        {r.byDepartment.map((d, i) => <Row key={d.department} p={p} first={i === 0} title={departmentName(d.department)}
          detail={`${plural(d.people, "person", "people")} · ${plural(d.shifts, "shift")} · unpaid ${formatDuration(d.unpaidMinutes)}`} amount={formatDuration(d.minutes)} />)}
      </List>
    </Section>
    <Section title="By person" count={r.byPerson.length} p={p}>
      <List p={p} empty="No shifts in these dates.">
        {r.byPerson.map((x, i) => <Row key={x.userId} p={p} first={i === 0} title={x.fullName ?? "Team member"} avatar={x.fullName ?? ""}
          detail={[x.department ? departmentName(x.department) : "", plural(x.days, "day"), `unpaid ${formatDuration(x.unpaidMinutes)}`, x.overtimeMinutes ? `overtime ${formatDuration(x.overtimeMinutes)}` : ""].filter(Boolean).join(" · ")}
          amount={formatDuration(x.minutes)} />)}
      </List>
    </Section>
  </>;
}
