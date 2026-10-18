import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View } from "react-native";
import { Text } from "./Typography";
import { ui, type Palette } from "./theme";
import { useToolTitled } from "./ToolPage";
import { london, message, Notice, Section, StatGrid, StatTile } from "./LiveKit";
import { PropertySelect } from "./SearchPicker";
import { List, Row } from "./AccountsPayable";
import { Pills } from "./Pills";
import { readFinance } from "./backend/client";
import { DateField } from "./CalendarPicker";
import { Dropdown } from "./Dropdown";
import { formatMoney, plural } from "../../lib/format";
import { CHANNEL_LABEL, isFinanceRole } from "../../lib/accounts-live";
import {
  CHANNEL_FILTER_OPTIONS, customRange, formatOccupancy, hasActivity, lastDayOfRange, PERFORMANCE_HELP, performanceMonthLabel, performanceQuery,
  performanceReportSchema, periodRange, regionFilterOptions, regionOptions,
  type PerformanceChannel, type PerformanceFigures, type PerformanceRange, type PerformanceReport,
} from "../../lib/performance";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import { AnalyticsPanel } from "./AnalyticsKit";
import { previousRange, rangeLabel, shiftDay } from "../../lib/report-analytics";
import { performanceModel } from "../../lib/report-analytics-models";
import type { PropertyView } from "../../lib/workspace-view";

// The Performance tab of Live Accounts: what the business earned from management fees and cleaning, and how
// full the properties were and at what nightly rate, for a period and filtered by property, region and channel.
// Every figure is worked out by the database ('performance' finance report); this screen only shows it.
// Finance roles and admins only; owners never reach it.
const ALL = "all";
const rate = (minor: number | null) => minor === null ? "No priced nights" : `${formatMoney(minor)} a night`;
const marginLine = (f: PerformanceFigures) => `Charged ${formatMoney(f.cleaningChargedMinor)} · cost ${formatMoney(f.cleaningCostMinor)}`;
// Profit per clean (client answer 4): the agreed fee charged less the cleaner's invoice, over the cleans that have an invoice.
const profitLine = (f: PerformanceFigures) => f.invoicedCleanCount
  ? `${plural(f.invoicedCleanCount, "invoiced clean")} · charged ${formatMoney(f.invoicedChargedMinor ?? 0)} · invoices ${formatMoney(f.invoicedCostMinor ?? 0)}`
  : "No invoiced cleans in these dates";
// "Occupancy 22.1% · £102.77 a night · fees £375.00": the line under a property or a month.
const summary = (f: PerformanceFigures) => [`Occupancy ${formatOccupancy(f.occupancyBps)}`, rate(f.averageNightlyRateMinor), `cleaning margin ${formatMoney(f.cleaningMarginMinor)}`].join(" · ");

export function AccountsPerformance({ p, account, properties }: { p: Palette; account: WorkspaceAccount; properties: PropertyView[] }) {
  const allowed = isFinanceRole(account.role), titled = useToolTitled();
  const today = london(new Date());
  // One date field opens the calendar (Lee: no row of period buttons); this month until another range is chosen.
  const [range, setRange] = useState<PerformanceRange>(() => periodRange("this_month", today));
  const [dateError, setDateError] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [region, setRegion] = useState(ALL);
  const [channel, setChannel] = useState<PerformanceChannel | typeof ALL>(ALL);
  // The report is kept with the question it answers, so a changed filter or date never shows the previous answer.
  const [loaded, setLoaded] = useState<{ key: string; report: PerformanceReport; before: PerformanceReport | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const latest = useRef(0);

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
      // The same filters for the period just before (whole months against as many months before, other dates against as
      // many days before), for the analytics' comparison only; the figures still show without it.
      const asked = JSON.parse(queryKey) as Record<string, string>;
      const prior = previousRange({ from: asked.from, to: shiftDay(asked.to, -1) });
      const [next, before] = await Promise.all([
        readFinance(asked).then(r => performanceReportSchema.parse(r.data)),
        readFinance({ ...asked, from: prior.from, to: shiftDay(prior.to, 1) }).then(r => performanceReportSchema.parse(r.data)).catch(() => null),
      ]);
      if (mine === latest.current) setLoaded({ key: queryKey, report: next, before });
    } catch (e) { if (mine === latest.current) { setLoaded(null); setError(message(e)); } }
    finally { if (mine === latest.current) setLoading(false); }
  }, [queryKey]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active && allowed) void load(); }); return () => { active = false; }; }, [load, allowed]);

  // The calendar gives the first and last day (both included); customRange turns that into the same from and to as before.
  function chooseDates(next: { from: string; to: string }) {
    const chosen = customRange(next.from, next.to);
    if ("error" in chosen) { setDateError(chosen.error); return; }
    setDateError(""); setRange(chosen);
  }

  if (!allowed) return <Notice text="Performance is for Accounts and management." p={p} />;
  const totals = report?.totals;
  const shownRange = { from: range.from, to: lastDayOfRange(range) };
  const model = report && loaded ? performanceModel(report, loaded.before, `vs ${rangeLabel(previousRange(shownRange))}`, performanceMonthLabel, c => CHANNEL_LABEL[c] ?? c) : null;
  const propertyName = (id: string) => properties.find(x => x.id === id)?.name ?? "Property";

  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 4 }}>
        {!titled && <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Performance</Text>}
        <Text style={[ui.small, { color: p.muted }]}>What management fees and cleaning earned, and how full the properties were, for the dates you choose.</Text>
      </View>

      <View style={{ gap: 10 }}>
        <DateField p={p} label="Dates" value={{ from: range.from, to: lastDayOfRange(range) }} onChange={chooseDates} today={today} />
        {!!dateError && <Notice text={dateError} p={p} tone="bad" />}
      </View>

      <Section title="Filters" p={p}>
        <View style={{ gap: 10 }}>
          <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Property</Text>
          {properties.length <= 8
            ? <Pills p={p} values={[ALL, ...properties.map(x => x.id)]} value={propertyId || ALL} onChange={v => setPropertyId(v === ALL ? "" : v)} label={v => v === ALL ? "All properties" : propertyName(v)} />
            : <PropertySelect p={p} properties={properties} value={propertyId} onChange={setPropertyId} clearable />}
          {regions.length > 0 && <Dropdown p={p} label="Region" value={region} onChange={setRegion} options={regionFilterOptions(regions)} />}
          <Dropdown p={p} label="Channel" value={channel} onChange={setChannel} options={CHANNEL_FILTER_OPTIONS} />
        </View>
      </Section>

      <AnalyticsPanel p={p} model={model} loading={loading} error={error} caption={`${rangeLabel(shownRange)}, compared with ${rangeLabel(previousRange(shownRange))}. The filters above apply to both.`} />

      {!!report && !!totals && <>
        <StatGrid showZeros>
          <StatTile p={p} icon="briefcase" tone="accounts" label="Management fees" value={formatMoney(totals.managementFeeMinor)}
            detail={`${plural(totals.statementCount, "statement")} · VAT ${formatMoney(totals.vatMinor)} on its own`} />
          {totals.invoicedCleanCount !== undefined
            ? <StatTile p={p} icon="droplet" tone="accounts" label="Profit per clean" value={totals.profitPerCleanMinor == null ? "–" : formatMoney(totals.profitPerCleanMinor)} detail={profitLine(totals)} attention={(totals.cleanProfitMinor ?? 0) < 0} />
            : <StatTile p={p} icon="droplet" tone="accounts" label="Cleaning margin" value={formatMoney(totals.cleaningMarginMinor)} detail={marginLine(totals)} attention={totals.cleaningMarginMinor < 0} />}
          <StatTile p={p} icon="moon" tone="accounts" label="Occupancy" value={formatOccupancy(totals.occupancyBps)}
            detail={`${rate(totals.averageNightlyRateMinor)} · ${plural(totals.nightsBooked, "night")} of ${plural(totals.nightsAvailable, "night")}`} />
        </StatGrid>
        {totals.cleansWithoutCost > 0 && <Notice text={`${plural(totals.cleansWithoutCost, "clean")} on these statements ${totals.cleansWithoutCost === 1 ? "has" : "have"} no cost recorded yet (no cleaner invoice yet), so ${totals.cleansWithoutCost === 1 ? "it is" : "they are"} left out of profit per clean.`} p={p} />}

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
