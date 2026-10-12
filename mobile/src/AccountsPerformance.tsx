import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { Text } from "./Typography";
import { ui, type Palette } from "./theme";
import { Button, Field, Loading, london, message, Notice, Section, StatGrid, StatTile } from "./LiveKit";
import { PropertySelect } from "./SearchPicker";
import { List, Pills, Row } from "./AccountsPayable";
import { readFinance } from "./backend/client";
import { formatMoney, plural } from "../../lib/format";
import { CHANNEL_LABEL, isFinanceRole } from "../../lib/accounts-live";
import {
  customRange, formatOccupancy, hasActivity, PERFORMANCE_CHANNELS, PERFORMANCE_HELP, PERFORMANCE_PERIODS, performanceMonthLabel, performanceQuery,
  performanceReportSchema, PERIOD_LABEL, periodRange, rangeLabel, regionOptions,
  type PerformanceChannel, type PerformanceFigures, type PerformancePeriod, type PerformanceRange, type PerformanceReport,
} from "../../lib/performance";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import type { PropertyView } from "../../lib/workspace-view";

// The Performance tab of Live Accounts: what the business earned from management fees and cleaning, and how
// full the properties were and at what nightly rate, for a period and filtered by property, region and channel.
// Every figure is worked out by the database ('performance' finance report); this screen only shows it.
// Finance roles and admins only; owners never reach it.
const ALL = "all";
const rate = (minor: number | null) => minor === null ? "No priced nights" : `${formatMoney(minor)} a night`;
const marginLine = (f: PerformanceFigures) => `Charged ${formatMoney(f.cleaningChargedMinor)} · cost ${formatMoney(f.cleaningCostMinor)}`;
// "Occupancy 22.1% · £102.77 a night · fees £375.00": the line under a property or a month.
const summary = (f: PerformanceFigures) => [`Occupancy ${formatOccupancy(f.occupancyBps)}`, rate(f.averageNightlyRateMinor), `cleaning margin ${formatMoney(f.cleaningMarginMinor)}`].join(" · ");

export function AccountsPerformance({ p, account, properties }: { p: Palette; account: WorkspaceAccount; properties: PropertyView[] }) {
  const allowed = isFinanceRole(account.role);
  const today = london(new Date());
  const [period, setPeriod] = useState<PerformancePeriod>("this_month");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [custom, setCustom] = useState<PerformanceRange | null>(null);
  const [dateError, setDateError] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [region, setRegion] = useState(ALL);
  const [channel, setChannel] = useState<PerformanceChannel | typeof ALL>(ALL);
  // The report is kept with the question it answers, so a changed filter or date never shows the previous answer.
  const [loaded, setLoaded] = useState<{ key: string; report: PerformanceReport } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const latest = useRef(0);

  const range = useMemo<PerformanceRange | null>(() => period === "custom" ? custom : periodRange(period, today), [period, custom, today]);
  const regions = useMemo(() => regionOptions(properties), [properties]);
  const query = useMemo(() => range ? performanceQuery(range, { propertyId: propertyId || null, region: region === ALL ? null : region, channel: channel === ALL ? null : channel }) : null,
    [range, propertyId, region, channel]);
  const queryKey = query ? JSON.stringify(query) : "";
  const report = loaded?.key === queryKey ? loaded.report : null;

  const load = useCallback(async () => {
    if (!queryKey) return;
    const mine = ++latest.current;
    setLoading(true); setError("");
    try {
      const next = performanceReportSchema.parse((await readFinance(JSON.parse(queryKey) as Record<string, string>)).data);
      if (mine === latest.current) setLoaded({ key: queryKey, report: next });
    } catch (e) { if (mine === latest.current) { setLoaded(null); setError(message(e)); } }
    finally { if (mine === latest.current) setLoading(false); }
  }, [queryKey]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active && allowed) void load(); }); return () => { active = false; }; }, [load, allowed]);

  function applyDates() {
    const chosen = customRange(first, last);
    if ("error" in chosen) { setDateError(chosen.error); return; }
    setDateError(""); setCustom(chosen);
  }

  if (!allowed) return <Notice text="Performance is for Accounts and management." p={p} />;
  const totals = report?.totals;
  const propertyName = (id: string) => properties.find(x => x.id === id)?.name ?? "Property";

  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Performance</Text>
        <Text style={[ui.small, { color: p.muted }]}>What management fees and cleaning earned, and how full the properties were, for the dates you choose.</Text>
      </View>

      <View style={{ gap: 10 }}>
        <Pills p={p} values={PERFORMANCE_PERIODS} value={period} onChange={setPeriod} label={v => PERIOD_LABEL[v]} />
        {period === "custom" && <View style={{ gap: 8 }}>
          <Field label="First day (YYYY-MM-DD)" value={first} onChange={setFirst} p={p} placeholder={today.slice(0, 8) + "01"} />
          <Field label="Last day, included (YYYY-MM-DD)" value={last} onChange={setLast} p={p} placeholder={today} />
          {!!dateError && <Notice text={dateError} p={p} tone="bad" />}
          <View style={{ flexDirection: "row" }}><Button label="Show these dates" icon="calendar" p={p} onPress={applyDates} /></View>
        </View>}
        {!!range && <Text style={[ui.small, { color: p.muted }]}>{rangeLabel(range)}</Text>}
      </View>

      <Section title="Filters" p={p}>
        <View style={{ gap: 10 }}>
          <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Property</Text>
          {properties.length <= 8
            ? <Pills p={p} values={[ALL, ...properties.map(x => x.id)]} value={propertyId || ALL} onChange={v => setPropertyId(v === ALL ? "" : v)} label={v => v === ALL ? "All properties" : propertyName(v)} />
            : <PropertySelect p={p} properties={properties} value={propertyId} onChange={setPropertyId} clearable />}
          {regions.length > 0 && <>
            <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Region</Text>
            <Pills p={p} values={[ALL, ...regions]} value={region} onChange={setRegion} label={v => v === ALL ? "All regions" : v} />
          </>}
          <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Channel</Text>
          <Pills p={p} values={[ALL, ...PERFORMANCE_CHANNELS] as const} value={channel} onChange={setChannel} label={v => v === ALL ? "All channels" : CHANNEL_LABEL[v] ?? v} />
        </View>
      </Section>

      {!!error && <Notice text={error} p={p} tone="bad" />}
      {period === "custom" && !range && <Notice text="Enter the first and last day, then choose Show these dates." p={p} />}
      {loading && !report && <Loading p={p} />}

      {!!report && !!totals && <>
        <StatGrid>
          <StatTile p={p} icon="briefcase" tone="accounts" label="Management fees" value={formatMoney(totals.managementFeeMinor)}
            detail={`${plural(totals.statementCount, "statement")} · VAT ${formatMoney(totals.vatMinor)} on its own`} />
          <StatTile p={p} icon="droplet" tone="accounts" label="Cleaning margin" value={formatMoney(totals.cleaningMarginMinor)} detail={marginLine(totals)} attention={totals.cleaningMarginMinor < 0} />
          <StatTile p={p} icon="moon" tone="accounts" label="Occupancy" value={formatOccupancy(totals.occupancyBps)}
            detail={`${rate(totals.averageNightlyRateMinor)} · ${plural(totals.nightsBooked, "night")} of ${plural(totals.nightsAvailable, "night")}`} />
        </StatGrid>
        {totals.cleansWithoutCost > 0 && <Notice text={`${plural(totals.cleansWithoutCost, "clean")} on these statements ${totals.cleansWithoutCost === 1 ? "has" : "have"} no cost recorded yet (no cleaner invoice or rate), so the margin may look higher than it is.`} p={p} />}

        <Section title="By property" count={report.byProperty.length} p={p}>
          <List p={p} empty="No properties match these filters.">
            {report.byProperty.map((row, i) => <Row key={row.propertyId} p={p} first={i === 0} title={row.propertyName}
              detail={[row.region, hasActivity(row) ? summary(row) : "Nothing in these dates"].filter(Boolean).join(" · ")}
              amount={formatMoney(row.managementFeeMinor)} tags={row.cleaningMarginMinor < 0 ? [["Cleaning cost more than charged", "wait"]] : undefined} />)}
          </List>
        </Section>

        <Section title="By month" count={report.byMonth.length} p={p}>
          <List p={p} empty="No months in these dates." search={false}>
            {report.byMonth.map((row, i) => <Row key={row.period} p={p} first={i === 0} title={performanceMonthLabel(row.period)}
              detail={hasActivity(row) ? summary(row) : "Nothing in this month"} amount={formatMoney(row.managementFeeMinor)} />)}
          </List>
        </Section>

        {report.byChannel.length > 0 && <Section title="By channel" count={report.byChannel.length} p={p}>
          <List p={p} empty="" search={false}>
            {report.byChannel.map((row, i) => <Row key={row.channel} p={p} first={i === 0} title={CHANNEL_LABEL[row.channel] ?? row.channel}
              detail={`${plural(row.nightsBooked, "night")} booked · occupancy ${formatOccupancy(row.occupancyBps)} · ${rate(row.averageNightlyRateMinor)}`}
              amount={formatMoney(row.grossRevenueMinor)} />)}
          </List>
        </Section>}

        <Text style={[ui.small, { color: p.muted }]}>{PERFORMANCE_HELP}</Text>
      </>}
    </View>
  );
}
