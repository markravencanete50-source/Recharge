import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Switch, View } from "react-native";
import { Text } from "./Typography";
import { ui, type Palette } from "./theme";
import { Anchor, Loading, london, message, Notice, Section, StatGrid, StatTile } from "./LiveKit";
import { List, Row } from "./AccountsPayable";
import { Pills } from "./Pills";
import { useToolTitled } from "./ToolPage";
import { AnalyticsPanel, PeriodBar, usePeriod } from "./AnalyticsKit";
import { staysModel } from "../../lib/report-analytics-models";
import { readTeams, writeTeams } from "./backend/client";
import { plural } from "../../lib/format";
import { isWorkspaceAdmin } from "../../lib/modules";
import {
  arrivalDayName, compareLine, comparisonLabel, comparisonRange, countryName, guestMix, LEAD_LABEL, LENGTH_LABEL, notKnownLine, oneDecimal, percent, plainDays,
  ratingLine, reasonRows, surveyReplyLine, STAY_CHANNELS, STAYS_INTRO, STAYS_MAX_DAYS, STAYS_NOTES, STAYS_SECTION, stayAnalyticsSchema, stayChannelName, stayMonthName,
  type StayAnalytics, type StayChannel, type StayRange,
} from "../../lib/stay-analytics-view";
import { STAY_SWITCHES, STAY_SWITCH_HELP, STAY_SWITCHES_SECTION, staySwitchesSchema, type StaySwitches } from "../../lib/stay-reason";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";

// Reports > Guests & stays (Alex: "analytics on each stay, average number of guests etc"). Admins and super admins only:
// the database refuses everyone else (workspace_stay_analytics) and this section is not drawn for them. This month to
// start, compared with last month; any dates up to 366 days, one property and one channel. Totals and averages only.
type Loaded = { key: string; now: StayAnalytics; before: StayAnalytics | null };
const ALL = "all";

async function readStays(range: StayRange, property: string, channel: string) {
  const query: Record<string, string> = { section: STAYS_SECTION, from: range.from, to: range.to };
  if (property !== ALL) query.propertyId = property;
  if (channel !== ALL) query.channel = channel;
  return stayAnalyticsSchema.parse((await readTeams(query)).data);
}

export function StayReports({ p, account, properties }: { p: Palette; account: WorkspaceAccount; properties: readonly { id: string; name: string }[] }) {
  const allowed = isWorkspaceAdmin(account.role), titled = useToolTitled();
  const today = london(new Date());
  // This month to start, compared with last month (whole months compare with as many whole months before); the period
  // drives the analytics and the figures below alike.
  const period = usePeriod(["month", "30d", "90d", "12m", "custom"], "month", today, { maxDays: STAYS_MAX_DAYS });
  const range: StayRange = period.range;
  const [property, setProperty] = useState<string>(ALL);
  const [channel, setChannel] = useState<StayChannel | typeof ALL>(ALL);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const latest = useRef(0);
  const key = `${range.from}:${range.to}:${property}:${channel}`;
  // Kept with the question it answers, so changing a filter never shows the previous answer.
  const shown = loaded?.key === key ? loaded : null;
  const model = useMemo(() => (shown ? staysModel(shown.now, shown.before, range, `vs ${comparisonLabel(range, today)}`) : null), [shown, range, today]);

  const load = useCallback(async () => {
    const mine = ++latest.current;
    setLoading(true); setError("");
    try {
      const [now, before] = await Promise.all([readStays(range, property, channel), readStays(comparisonRange(range), property, channel).catch(() => null)]);
      if (mine === latest.current) setLoaded({ key, now, before });
    } catch (e) { if (mine === latest.current) { setLoaded(null); setError(message(e)); } }
    finally { if (mine === latest.current) setLoading(false); }
  }, [key, range, property, channel]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active && allowed) void load(); }); return () => { active = false; }; }, [load, allowed]);

  if (!allowed) return null;
  const homes = [ALL, ...properties.map(x => x.id)];
  const homeName = (id: string) => id === ALL ? "All homes" : properties.find(x => x.id === id)?.name ?? "Home";
  return (
    <Anchor id="section-guests-and-stays"><View style={{ gap: 20 }}>
      <View style={{ gap: 4 }}>
        {/* On its own page in the Reports hub the page heading already names it (ToolPage.tsx). */}
        {!titled && <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Guests & stays</Text>}
        <Text style={[ui.small, { color: p.muted }]}>{STAYS_INTRO}</Text>
      </View>
      <View style={{ gap: 10 }}>
        <PeriodBar p={p} period={period} />
        <Pills p={p} title="Home" values={homes} value={property} onChange={setProperty} label={homeName} />
        <Pills p={p} title="Channel" values={[ALL, ...STAY_CHANNELS] as const} value={channel} onChange={setChannel} label={c => c === ALL ? "All channels" : stayChannelName(c)} />
      </View>
      <AnalyticsPanel p={p} model={model} loading={loading} error={error} caption={`${period.label}, compared with ${comparisonLabel(range, today)}.`} />
      {shown && <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>The figures</Text>}
      {shown && <StaysView p={p} r={shown.now} before={shown.before} against={comparisonLabel(range, today)} />}
      {!!shown && <View style={{ gap: 6 }}>
        <Text style={[ui.small, { color: p.text, fontWeight: "600" }]}>What this report cannot show</Text>
        {STAYS_NOTES.map(note => <Text key={note} style={[ui.small, { color: p.muted }]}>{note}</Text>)}
      </View>}
      <StaySwitchesCard p={p} />
    </View></Anchor>
  );
}

// Why guests stay (20261021800000): the two switches, both off to start. Admins and super admins only (this section is
// drawn for them only, and the database refuses everyone else). Who turned each one on or off, and when, is shown.
function StaySwitchesCard({ p }: { p: Palette }) {
  const [switches, setSwitches] = useState<StaySwitches | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    readTeams({ section: STAY_SWITCHES_SECTION }).then(r => { if (active) setSwitches(staySwitchesSchema.parse(r.data)); }).catch(e => { if (active) setError(message(e)); });
    return () => { active = false; };
  }, []);
  async function turn(which: keyof typeof STAY_SWITCHES, on: boolean) {
    setBusy(true); setError("");
    try { setSwitches(staySwitchesSchema.parse((await writeTeams({ action: "setStayReasonSwitch", switch: which, on })).data)); }
    catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  const changed = (s: StaySwitches["ask"]) => s.changedAt ? `${s.on ? "Turned on" : "Turned off"}${s.changedBy ? ` by ${s.changedBy}` : ""} on ${new Date(s.changedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}` : "Off until an admin turns it on";
  return (
    <Section title="Asking guests" p={p}>
      <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 16 }]}>
        {!switches && !error && <Loading p={p} />}
        {switches && (Object.keys(STAY_SWITCHES) as (keyof typeof STAY_SWITCHES)[]).map(which => (
          <View key={which} style={[ui.between, { gap: 12, alignItems: "flex-start" }]}>
            <View style={{ flex: 1, gap: 4 }}>
              <Text style={{ color: p.text, fontSize: 14, fontWeight: "600" }}>{STAY_SWITCHES[which]}</Text>
              <Text style={[ui.small, { color: p.muted }]}>{STAY_SWITCH_HELP[which]}</Text>
              <Text style={[ui.small, { color: p.muted }]}>{changed(switches[which])}</Text>
            </View>
            <Switch accessibilityLabel={STAY_SWITCHES[which]} value={switches[which].on} disabled={busy} onValueChange={on => void turn(which, on)} trackColor={{ false: p.controlBorder, true: p.primary }} thumbColor={p.surface} />
          </View>
        ))}
        {!!error && <Notice text={error} p={p} tone="bad" />}
      </View>
    </Section>
  );
}

// One plain bar: its label, the count and share, and a line as long as the share of all stays.
function Bar({ p, label, stays, of }: { p: Palette; label: string; stays: number; of: number }) {
  const share = percent(stays, of) ?? 0;
  return (
    <View accessibilityLabel={`${label}, ${plural(stays, "stay")}, ${share}%`} style={{ gap: 4 }}>
      <View style={[ui.between, { gap: 8 }]}>
        <Text style={{ color: p.text, fontSize: 14, fontWeight: "600" }}>{label}</Text>
        <Text style={[ui.small, { color: p.muted, fontVariant: ["tabular-nums"] }]}>{`${stays} · ${share}%`}</Text>
      </View>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: p.wash, overflow: "hidden" }}>
        <View style={{ width: `${share}%`, height: 8, borderRadius: 4, backgroundColor: p.primary }} />
      </View>
    </View>
  );
}
function Bars({ p, rows, of, note }: { p: Palette; rows: { key: string; label: string; stays: number }[]; of: number; note?: string }) {
  return (
    <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 14 }]}>
      {rows.map(row => <Bar key={row.key} p={p} label={row.label} stays={row.stays} of={of} />)}
      {!!note && <Text style={[ui.small, { color: p.muted }]}>{note}</Text>}
    </View>
  );
}

function StaysView({ p, r, before, against }: { p: Palette; r: StayAnalytics; before: StayAnalytics | null; against: string }) {
  if (r.stays === 0) return <Notice p={p} text={`No confirmed stays in these dates${before?.stays ? `. ${plural(before.stays, "stay")} in ${against}` : ""}.`} />;
  const mix = guestMix(r);
  const countries = r.countries.top;
  return <>
    <StatGrid showZeros>
      <StatTile p={p} icon="calendar" label="Stays" value={r.stays} detail={[`${plural(r.nights, "night")} booked`, compareLine(r.stays, before?.stays ?? null, "stays", against)].filter(Boolean).join(" · ")} />
      <StatTile p={p} icon="users" label="Guests per stay" value={oneDecimal(r.guests.average)} detail={[notKnownLine(r.guests.known, r.stays), compareLine(r.guests.average, before?.guests.average ?? null, "guests", against, 1)].filter(Boolean).join(" · ") || "On average"} />
      <StatTile p={p} icon="moon" label="Nights per stay" value={oneDecimal(r.averageNights)} detail={compareLine(r.averageNights, before?.averageNights ?? null, "nights", against, 1) || "On average"} />
      <StatTile p={p} icon="clock" label="Booked ahead" value={plainDays(r.leadTime.averageDays)} detail={[notKnownLine(r.leadTime.known, r.stays), compareLine(r.leadTime.averageDays, before?.leadTime.averageDays ?? null, "days", against)].filter(Boolean).join(" · ") || "On average, from booking to arrival"} />
    </StatGrid>
    {!!r.reasons && <Section title="Why they stay" p={p}>
      {r.reasons.known
        ? <Bars p={p} of={r.reasons.known} rows={reasonRows(r)} note={notKnownLine(r.reasons.known, r.stays)} />
        : <Notice p={p} text="Not known for any of these stays. Guests are asked before they arrive once the question is switched on." />}
    </Section>}
    {(!!r.rating || !!r.survey) && <StatGrid showZeros>
      {!!r.rating && <StatTile p={p} icon="star" label="Average rating" value={r.rating.average === null ? "Not known" : `${oneDecimal(r.rating.average)} of 5`} detail={ratingLine(r)} />}
      {!!r.survey && <StatTile p={p} icon="mail" label="Survey replies" value={r.survey.sent ? `${percent(r.survey.answered, r.survey.sent)}%` : "None sent"} detail={surveyReplyLine(r)} />}
    </StatGrid>}
    <Section title="Who stays" p={p}>
      <List p={p} empty="" search={false}>
        {mix.map((m, i) => <Row key={m.label} p={p} first={i === 0} title={m.label} detail={m.detail || (m.known ? "" : "Not known")} amount={m.known ? String(m.total) : "–"} />)}
      </List>
    </Section>
    <Section title="How long they stay" p={p}>
      <Bars p={p} of={r.stays} rows={r.lengths.map(b => ({ key: b.bucket, label: LENGTH_LABEL[b.bucket] ?? b.bucket, stays: b.stays }))} />
    </Section>
    <Section title="Day they arrive" p={p}>
      <Bars p={p} of={r.stays} rows={r.arrivalDays.map(d => ({ key: String(d.day), label: arrivalDayName(d.day), stays: d.stays }))} />
    </Section>
    <Section title="How far ahead they book" p={p}>
      {r.leadTime.known
        ? <Bars p={p} of={r.leadTime.known} rows={r.leadTime.buckets.map(b => ({ key: b.bucket, label: LEAD_LABEL[b.bucket] ?? b.bucket, stays: b.stays }))} note={notKnownLine(r.leadTime.known, r.stays)} />
        : <Notice p={p} text="Not known for any of these stays. Hostaway has not sent when they booked." />}
    </Section>
    <Section title="Channels" count={r.channels.length} p={p}>
      <Bars p={p} of={r.stays} rows={r.channels.map(c => ({ key: c.channel, label: stayChannelName(c.channel), stays: c.stays }))} />
    </Section>
    <Section title="Where guests come from" count={countries.length} p={p}>
      {r.countries.known
        ? <Bars p={p} of={r.countries.known} rows={[...countries.map(c => ({ key: c.country, label: countryName(c.country), stays: c.stays })), ...(r.countries.others ? [{ key: "others", label: "Other countries", stays: r.countries.others }] : [])]}
            note={notKnownLine(r.countries.known, r.stays)} />
        : <Notice p={p} text="Not known for any of these stays. Hostaway has not sent the guests' countries." />}
    </Section>
    {r.byMonth.length > 1 && <Section title="By month" count={r.byMonth.length} p={p}>
      <List p={p} empty="" search={false}>
        {r.byMonth.map((m, i) => <Row key={m.month} p={p} first={i === 0} title={stayMonthName(m.month)}
          detail={m.stays ? [`${oneDecimal(m.averageGuests)} guests per stay`, `${oneDecimal(m.averageNights)} nights`, m.leadKnown ? `booked ${plainDays(m.averageLeadDays)} ahead` : ""].filter(Boolean).join(" · ") : "No stays"}
          amount={String(m.stays)} />)}
      </List>
    </Section>}
    <Section title="By home" count={r.byProperty.length} p={p}>
      <List p={p} empty="No stays in these dates.">
        {r.byProperty.map((x, i) => <Row key={x.propertyId} p={p} first={i === 0} title={x.propertyName}
          detail={[`${oneDecimal(x.averageGuests)} guests per stay`, `${oneDecimal(x.averageNights)} nights`, x.leadKnown ? `booked ${plainDays(x.averageLeadDays)} ahead` : "",
            x.childrenKnown ? `children on ${percent(x.childrenStays, x.childrenKnown)}%` : "", x.petsKnown ? `pets on ${percent(x.petsStays, x.petsKnown)}%` : ""].filter(Boolean).join(" · ")}
          amount={plural(x.stays, "stay")} />)}
      </List>
    </Section>
  </>;
}
