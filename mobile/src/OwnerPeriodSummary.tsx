import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { Text } from "./Typography";
import { Entrance } from "./motion";
import { ui, type Palette } from "./theme";
import { Loading, london, message, Notice, StatGrid, StatTile, Tag } from "./LiveKit";
import { Pills } from "./Pills";
import { SoftButton } from "./LivePages";
import { OwnerExpenses } from "./OwnerExpenses";
import { readOwner } from "./backend/client";
import { formatCount, formatMoney, formatMoneyShort } from "../../lib/format";
import { monthName } from "../../lib/owner-reports";
import { changeLabel, changeOf, coverNotes, OWNER_PERIOD_LABEL, OWNER_PERIODS, ownerPeriodsSchema, periodRange, readRange, summarisePeriod, type Change, type OwnerPeriod, type OwnerPeriods, type PeriodSummary } from "../../lib/owner-periods";

// The owner's figures for a period they choose, statement style: booking income, what came off it
// and their payout, each against the period before. Months with an issued statement show its
// figures exactly; the rest are marked as estimates until Accounts issue them.
const BASIS: Record<PeriodSummary["basis"], { label: string; tone: "good" | "wait" | "plain" }> = {
  issued: { label: "From issued statements", tone: "good" }, mixed: { label: "Part estimated", tone: "wait" }, estimated: { label: "Estimated", tone: "wait" }, empty: { label: "No figures yet", tone: "plain" },
};
const percent = (share: number | null) => share === null ? "–" : Math.round(share * 100) + "%";
const months = (list: string[]) => list.map(m => monthName(m, false)).join(", ");

export function OwnerPeriodSummary({ palette: p, onStatements }: { palette: Palette; onStatements: () => void }) {
  const [today] = useState(() => london(new Date()));
  const [period, setPeriod] = useState<OwnerPeriod>("thisMonth");
  const range = useMemo(() => periodRange(period, today), [period, today]);
  const key = period + ":" + today;
  const [loaded, setLoaded] = useState<{ key: string; data: OwnerPeriods | null; error: string } | null>(null);
  // Bumped after an expense is added or removed: the figures reload in place, without a loading flash.
  const [reloads, setReloads] = useState(0);
  useEffect(() => {
    let active = true;
    readOwner({ section: "periods", ...readRange(range) })
      .then(r => { if (active) setLoaded({ key, data: ownerPeriodsSchema.parse(r.data), error: "" }); })
      // A reload that fails keeps the last good figures for this period (and says so); a first load has none to keep.
      .catch(e => { if (active) setLoaded(prev => prev?.key === key && prev.data ? { key, data: prev.data, error: "Your figures could not be refreshed, so these may be out of date. " + message(e) } : { key, data: null, error: message(e) }); });
    return () => { active = false; };
  }, [range, key, reloads]);
  const current = loaded?.key === key ? loaded : null;
  const data = current?.data ?? null;
  const count = data?.properties.length ?? 0;
  const now = data ? summarisePeriod(data.months, range.months, count) : null, before = data ? summarisePeriod(data.months, range.previous, count) : null;
  const change = (pick: (s: PeriodSummary) => number | null) => now && before ? changeOf(pick(now), pick(before)) : null;
  const detail = (c: Change | null) => changeLabel(c) ? `${changeLabel(c)} ${range.versus}` : `Nothing to compare ${range.versus.replace(/^vs /, "with ")}`;
  const feeBps = data ? [...new Set(data.months.filter(c => range.months.includes(c.month) && c.feeBps !== null).map(c => c.feeBps))] : [];

  return (
    <Entrance sessionKey="live:owner-periods" style={{ gap: 14 }}>
      <View style={[ui.between, { gap: 10, flexWrap: "wrap" }]}>
        <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Your figures</Text>
        {now && <Tag label={BASIS[now.basis].label} tone={BASIS[now.basis].tone} p={p} />}
      </View>
      <Pills p={p} values={OWNER_PERIODS} value={period} onChange={setPeriod} label={v => OWNER_PERIOD_LABEL[v]} />
      {!current && <Loading p={p} rows={2} />}
      {!!current?.error && <Notice text={current.error} p={p} tone="bad" />}
      {now && before && <>
        <StatGrid>
          <StatTile p={p} icon="credit-card" tone="clients" label="Earnings" value={now.bookingIncomeMinor} format={formatMoneyShort} detail={detail(change(s => s.bookingIncomeMinor))} />
          <StatTile p={p} icon="pie-chart" tone="clients" label="Occupancy" value={percent(now.occupancy)} detail={detail(change(s => s.occupancy))} />
          <StatTile p={p} icon="moon" tone="clients" label="Average nightly rate" value={now.averageNightlyMinor === null ? "–" : formatMoneyShort(now.averageNightlyMinor)} detail={detail(change(s => s.averageNightlyMinor))} />
          <StatTile p={p} icon="calendar" tone="clients" label="Bookings" value={now.bookings} detail={detail(change(s => s.bookings))} />
        </StatGrid>
        <Statement p={p} now={now} before={before} title={OWNER_PERIOD_LABEL[period]} versus={range.versus} feeBps={feeBps.length === 1 ? feeBps[0] : null} months={range.months} cells={data?.months ?? []} />
        {!!data && <OwnerExpenses palette={p} properties={data.properties} cells={data.months} months={range.months} onChanged={() => setReloads(n => n + 1)} />}
        <SoftButton label="See your statements" icon="arrow-right" palette={p} onPress={onStatements} />
      </>}
    </Entrance>
  );
}

// The statement for the period: one line per figure, the payout below a rule, and a legend that
// says which months come from issued statements.
function Statement({ p, now, before, title, versus, feeBps, months: shown, cells }: { p: Palette; now: PeriodSummary; before: PeriodSummary; title: string; versus: string; feeBps: number | null; months: string[]; cells: OwnerPeriods["months"] }) {
  const line = (label: string, value: string, change: Change | null, options: { strong?: boolean; muted?: boolean; good?: boolean } = {}) => {
    const text = changeLabel(change);
    // Income and payout going up is good news; costs are shown without a judgement.
    const tone = !change || change.direction === "flat" || !options.good ? p.muted : change.direction === "up" ? p.success : p.danger;
    return (
      <View key={label} accessibilityLabel={[label, value, text ? `${text} ${versus}` : null].filter(Boolean).join(", ")} style={[ui.row, { gap: 12, minHeight: 28 }]}>
        <Text style={[ui.small, { flex: 1, color: options.strong ? p.text : p.muted, fontWeight: options.strong ? "700" : "500" }]}>{label}</Text>
        <Text style={{ color: options.muted ? p.muted : p.text, fontSize: options.strong ? 16 : 14, fontWeight: options.strong ? "700" : "600", fontVariant: ["tabular-nums"], textAlign: "right" }}>{value}</Text>
        <Text style={{ width: 64, textAlign: "right", color: tone, fontSize: 12, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{text ?? ""}</Text>
      </View>
    );
  };
  const cost = (minor: number | null) => minor === null ? "Not set yet" : minor ? "−" + formatMoney(minor) : formatMoney(0);
  const ch = (pick: (s: PeriodSummary) => number | null) => changeOf(pick(now), pick(before));
  const owed = now.payoutMinor !== null && now.payoutMinor < 0;
  const status = (m: string) => {
    const here = cells.filter(c => c.month === m);
    return !here.length ? null : here.every(c => c.source === "statement") ? "issued" : "estimated";
  };
  return (
    <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 14 }]}>
      <View style={{ gap: 3 }}>
        <Text accessibilityRole="header" style={{ color: p.text, fontSize: 16, fontWeight: "700" }}>Statement · {title}</Text>
        <Text style={[ui.small, { color: p.muted }]}>Stays starting in the period, as on your monthly statements. Changes are {versus}.</Text>
      </View>
      <View style={{ gap: 6 }}>
        {line("Booking income", formatMoney(now.bookingIncomeMinor), ch(s => s.bookingIncomeMinor), { good: true })}
        {line("Platform fees", "Taken before payout", null, { muted: true })}
        {line(`Cleaning (${formatCount(now.cleaningCount)} ${now.cleaningCount === 1 ? "clean" : "cleans"})`, cost(now.cleaningMinor), ch(s => s.cleaningMinor))}
        {line("Repairs and expenses", cost(now.expensesMinor), ch(s => s.expensesMinor))}
        {line(`Management fee${feeBps !== null ? ` (${feeBps / 100}%)` : ""}`, cost(now.feeMinor), ch(s => s.feeMinor))}
        {!!now.vatMinor && line("VAT on the management fee", cost(now.vatMinor), ch(s => s.vatMinor))}
        <View style={{ height: 1, backgroundColor: p.border, marginVertical: 4 }} />
        {line(owed ? "You owe" : "Your payout", now.payoutMinor === null ? "Not set yet" : formatMoney(Math.abs(now.payoutMinor)), ch(s => s.payoutMinor), { strong: true, good: true })}
        {now.netMinor !== null && <>
          {line("Your expenses", cost(now.ownerExpensesMinor), null, { muted: true })}
          {line("Net after your expenses", formatMoney(now.netMinor), ch(s => s.netMinor), { strong: true, good: true })}
          <Text style={[ui.small, { color: p.muted }]}>The expenses you entered come off this figure only. They do not change what Recharge pays you.</Text>
        </>}
      </View>
      {/* Legend: which months are from issued statements and which are estimates. */}
      <View style={{ gap: 8 }}>
        <View style={[ui.row, { gap: 14, flexWrap: "wrap" }]}>
          <Legend p={p} colour={p.success} label="Issued statement" />
          <Legend p={p} colour={p.waiting} label="Estimated, not issued yet" />
        </View>
        {shown.length > 1 && <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>
          {shown.map(m => {
            const s = status(m);
            return (
              <View key={m} accessibilityLabel={`${monthName(m)}: ${s === "issued" ? "issued statement" : s ? "estimated" : "no figures"}`} style={[ui.row, { gap: 6, minHeight: 28, paddingHorizontal: 10, borderRadius: 999, backgroundColor: p.background }]}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: s === "issued" ? p.success : s ? p.waiting : p.border }} />
                <Text style={{ color: p.text, fontSize: 12, fontWeight: "600" }}>{monthName(m, false)}</Text>
              </View>
            );
          })}
        </View>}
      </View>
      {now.basis !== "issued" && now.basis !== "empty" && <Text style={[ui.small, { color: p.muted }]}>
        {months(now.estimatedMonths)} {now.estimatedMonths.length === 1 ? "is" : "are"} estimated from the stays, cleans and costs recorded so far; the figures can change until the statement is issued.
        {now.preparingMonths.length ? ` Accounts are preparing the statement for ${months(now.preparingMonths)}.` : ""}
        {now.missingAmounts ? ` ${formatCount(now.missingAmounts)} ${now.missingAmounts === 1 ? "stay has" : "stays have"} no payout recorded yet.` : ""}
        {now.payoutMinor === null ? " The management fee or cleaning cost from your agreement is not set up yet, so there is no payout estimate." : ""}
      </Text>}
      {/* Statements of other dates: where their figures are shown, and months only partly on one. */}
      {coverNotes(cells, shown).map(note => <Text key={note} style={[ui.small, { color: p.muted }]}>{note}</Text>)}
      {now.basis === "empty" && <Text style={[ui.small, { color: p.muted }]}>Your figures appear here once your properties take bookings.</Text>}
    </View>
  );
}

function Legend({ p, colour, label }: { p: Palette; colour: string; label: string }) {
  return (
    <View style={[ui.row, { gap: 6 }]}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colour }} />
      <Text style={{ color: p.muted, fontSize: 12, fontWeight: "600" }}>{label}</Text>
    </View>
  );
}
