import { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, ScrollView, View, useWindowDimensions } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { z } from "zod";
import { Text } from "./Typography";
import { DimensionalIcon, type DimensionalName } from "./DimensionalIcon";
import { Entrance, GrowBar, MotionPress, TweenNumber } from "./motion";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { ChartTip, useChartFocus } from "./ChartTip";
import { addDays, Anchor, Loading, london, message, Notice, Section } from "./LiveKit";
import { sectionAnchor } from "../../lib/home-tools";
import { StatementCard } from "./LiveOwner";
import { readFinance, readOwner } from "./backend/client";
import { formatCount, formatMoney, formatMoneyShort } from "../../lib/format";
import { statementSchema, type Statement } from "../../lib/accounts-live";
import { ownerBookingsSchema, type OwnerBookings, type OwnerStay } from "../../lib/owner-policy";
import { compare, type Delta } from "../../lib/report-analytics";
import { DeltaLine } from "./AnalyticsKit";
import { addMonths, CHANNEL_LABEL, monthEnd, monthlyEarnings, monthName, monthStart, monthStats, propertyMonth } from "../../lib/owner-reports";

// An owner's Reports, from their live bookings: earnings, occupancy and nightly rate for a month,
// a month calendar of every stay, who is staying now and next, earnings by property and over the
// last twelve months, their statements (the Mailbox is a page of its own). Nothing here is sample data.
const COLOURS = [
  { light: "#1F5F55", dark: "#8FD3C2" }, { light: "#B4512F", dark: "#F2AE8C" }, { light: "#3B5866", dark: "#A9C6D2" },
  { light: "#6B4768", dark: "#D9B5D5" }, { light: "#7A6A1F", dark: "#E3D38C" }, { light: "#2D4F8B", dark: "#A8C0EE" },
];
const longDate = (value: string) => new Date(value + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const shortDate = (value: string) => new Date(value + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const daysFrom = (from: string, to: string) => Math.round((Date.parse(to + "T12:00:00Z") - Date.parse(from + "T12:00:00Z")) / 86400000);
const percent = (share: number | null) => share === null ? "–" : Math.round(share * 100) + "%";
// The six weeks shown for a month, Monday first.
function monthGrid(month: string) {
  const first = monthStart(month), lead = (new Date(first + "T12:00:00Z").getUTCDay() + 6) % 7, start = addDays(first, -lead);
  return Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)));
}
const read = async (from: string, to: string) => ownerBookingsSchema.parse((await readOwner({ section: "bookings", from, to })).data);

export function LiveClientReports({ palette: p }: { palette: Palette }) {
  const { width } = useWindowDimensions();
  const desktop = width >= 1024;
  const [today] = useState(() => london(new Date()));
  const thisMonth = today.slice(0, 7);
  const [month, setMonth] = useState(thisMonth);
  const [year, setYear] = useState<OwnerBookings | null>(null);
  const [ahead, setAhead] = useState<OwnerBookings | null>(null);
  const [shown, setShown] = useState<OwnerBookings | null>(null);
  const [statements, setStatements] = useState<Statement[]>([]);
  const [hidden, setHidden] = useState<string[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [open, setOpen] = useState<OwnerStay | null>(null);

  // The last twelve months and next month (for earnings), the next four months (who is coming),
  // and the owner's issued and paid statements.
  const load = useCallback(async () => {
    setLoading(true); setError("");
    const [y, a, s] = await Promise.allSettled([read(monthStart(addMonths(thisMonth, -11)), monthEnd(addMonths(thisMonth, 1))), read(today, addDays(today, 120)), readFinance({ section: "statements" })]);
    if (y.status === "fulfilled") setYear(y.value); if (a.status === "fulfilled") setAhead(a.value);
    if (s.status === "fulfilled") { const parsed = z.array(statementSchema).safeParse(s.value.data); setStatements(parsed.success ? parsed.data : []); }
    const failed = [y, a].find(r => r.status === "rejected");
    if (failed && failed.status === "rejected") setError(message(failed.reason));
    setLoading(false);
  }, [thisMonth, today]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  // The calendar month: every stay touching the six weeks on screen.
  useEffect(() => {
    let active = true;
    const grid = monthGrid(month);
    read(grid[0][0], grid[5][6]).then(data => { if (active) setShown(data); }).catch(e => { if (active) { setShown(null); setError(message(e)); } });
    return () => { active = false; };
  }, [month]);

  const properties = useMemo(() => year?.properties ?? shown?.properties ?? [], [year, shown]);
  const colourOf = useCallback((id: string) => COLOURS[Math.max(0, properties.findIndex(x => x.propertyId === id)) % COLOURS.length][p.isDark ? "dark" : "light"], [properties, p.isDark]);
  const visible = (list: readonly OwnerStay[] | undefined) => (list ?? []).filter(s => !hidden.includes(s.propertyId));
  const included = properties.filter(x => !hidden.includes(x.propertyId));
  const monthStays = visible(shown?.stays);
  const stats = monthStats(monthStays, month, included.length);
  const upcoming = visible(ahead?.stays).filter(s => s.checkIn > today);
  const inHouse = visible(ahead?.stays).filter(s => s.checkIn <= today && s.checkOut > today);
  const twelve = monthlyEarnings(visible(year?.stays), thisMonth, 12);
  const byProperty = propertyMonth(monthStays, included, month);
  const card = { ...ui.card, backgroundColor: p.surface, borderColor: p.border };
  const heading = (title: string, detail?: string) => (
    <View style={{ gap: 3 }}>
      <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>{title}</Text>
      {!!detail && <Text style={[ui.small, { color: p.muted }]}>{detail}</Text>}
    </View>
  );
  // Each month's figures against the month before (from the last twelve months already read), so an owner sees which way
  // things moved: earnings, occupancy and the nightly rate are better up. Upcoming bookings are a count from today, with
  // nothing to compare.
  const before = year && month > addMonths(thisMonth, -11) ? monthStats(visible(year.stays), addMonths(month, -1), included.length) : null;
  const against = `vs ${monthName(addMonths(month, -1), false)}`;
  const occupancyOf = (x: { occupancy: number | null } | null) => (x && x.occupancy !== null ? Math.round(x.occupancy * 100) : null);
  const kpis: { key: string; icon: DimensionalName; value: number | null; format: (n: number) => string; label: string; delta?: Delta }[] = [
    { key: "earnings", icon: "coins", value: stats.earningsMinor, format: formatMoneyShort, label: "Earnings in " + monthName(month, false), delta: before ? compare(stats.earningsMinor, before.earningsMinor, { better: "up", format: n => formatMoneyShort(n), against }) : undefined },
    { key: "occupancy", icon: "chart", value: occupancyOf(stats), format: n => n + "%", label: "Occupancy", delta: before ? compare(occupancyOf(stats), occupancyOf(before), { better: "up", kind: "percent", against }) : undefined },
    { key: "rate", icon: "key", value: stats.averageNightlyMinor, format: formatMoneyShort, label: "Average nightly rate", delta: before ? compare(stats.averageNightlyMinor, before.averageNightlyMinor, { better: "up", format: n => formatMoneyShort(n), against }) : undefined },
    { key: "upcoming", icon: "calendar", value: upcoming.length, format: formatCount, label: "Upcoming bookings" },
  ];
  const stayRow = (s: OwnerStay, now: boolean) => (
    <MotionPress key={s.reservationId + (now ? ":now" : "")} {...(Platform.OS === "web" ? { dataSet: { hover: "tint" } } : {})} accessibilityRole="button" accessibilityLabel={`${s.propertyName}, ${shortDate(s.checkIn)} to ${shortDate(s.checkOut)}, ${formatMoney(s.payoutMinor)}`} onPress={() => setOpen(s)}
      style={[ui.row, { gap: 12, paddingVertical: 12, paddingHorizontal: 10, marginHorizontal: -10, borderRadius: 16 }]}>
      <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: p.wash, alignItems: "center", justifyContent: "center" }}><Text style={{ color: p.text, fontSize: 14, fontWeight: "700" }}>{s.nights}n</Text></View>
      <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: p.text, fontSize: 15, fontWeight: "600" }}>{shortDate(s.checkIn)} to {shortDate(s.checkOut)}</Text>
        <Text numberOfLines={1} style={[ui.small, { color: p.muted }]}>{s.propertyName} · {s.nights} {s.nights === 1 ? "night" : "nights"}</Text>
        <View style={[ui.row, { gap: 6, marginTop: 4, flexWrap: "wrap" }]}>
          <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colourOf(s.propertyId) }} />
          <Text style={{ color: p.muted, fontSize: 12 }}>{CHANNEL_LABEL[s.channel] ?? s.channel}{s.guests ? ` · ${s.guests} ${s.guests === 1 ? "guest" : "guests"}` : ""}</Text>
          {now && <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: p.successWash }}><Text style={{ color: p.text, fontSize: 11, fontWeight: "700" }}>Staying now</Text></View>}
        </View>
      </View>
      <Text style={{ color: p.text, fontSize: 15, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{formatMoney(s.payoutMinor)}</Text>
    </MotionPress>
  );
  const maxProperty = Math.max(1, ...byProperty.map(x => x.earningsMinor)), maxMonth = Math.max(1, ...twelve.map(x => x.earningsMinor));
  const yearTotal = twelve.reduce((n, x) => n + x.earningsMinor, 0);
  const propertyFocus = useChartFocus(), monthFocus = useChartFocus();
  const [propertyWidth, setPropertyWidth] = useState(0), [monthsWidth, setMonthsWidth] = useState(0);
  const propertyTotal = byProperty.reduce((t, x) => t + x.earningsMinor, 0);
  const myStatements = statements.filter(s => !hidden.includes(s.propertyId));

  return (
    <View style={{ gap: 24 }}>
      <Entrance sessionKey="owner-reports:heading" style={{ gap: 6 }}>
        <Text style={{ color: p.muted, fontSize: 12, fontWeight: "600", letterSpacing: 1.4, textTransform: "uppercase" }}>{monthName(month)}</Text>
        <Text accessibilityRole="header" style={[ui.title, { color: p.text }]}>Your portfolio</Text>
        <Text style={[ui.body, { color: p.muted }]}>How your properties are doing, who is staying and what is booked next.</Text>
      </Entrance>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {loading && !year && <Loading p={p} />}

      {properties.length > 1 && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        {properties.map(x => {
          const on = !hidden.includes(x.propertyId);
          return (
            <MotionPress key={x.propertyId} accessibilityRole="checkbox" accessibilityState={{ checked: on }} accessibilityLabel={`Show ${x.propertyName}`} onPress={() => setHidden(on ? [...hidden, x.propertyId] : hidden.filter(id => id !== x.propertyId))}
              style={[ui.row, { gap: 6, minHeight: 38, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: p.border, backgroundColor: on ? p.surface : "transparent", opacity: on ? 1 : 0.55 }]}>
              <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: colourOf(x.propertyId) }} />
              <Text numberOfLines={1} style={{ color: p.text, fontSize: 12, fontWeight: "600", maxWidth: 180 }}>{x.propertyName}</Text>
            </MotionPress>
          );
        })}
      </ScrollView>}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {kpis.map(kpi => (
          <View key={kpi.key} accessibilityLabel={`${kpi.label}: ${kpi.value === null ? "not available" : kpi.format(kpi.value)}${kpi.delta ? ". " + kpi.delta.text : ""}`} style={[card, { flexBasis: desktop ? "23%" : "46%", flexGrow: 1, minWidth: 0, gap: 12, padding: 16 }]}>
            <View style={{ width: 50, height: 50, borderRadius: 16, backgroundColor: p.wash, alignItems: "center", justifyContent: "center" }}><DimensionalIcon name={kpi.icon} size={38} color={p.primary} /></View>
            {kpi.value === null ? <Text style={{ color: p.text, fontSize: 28, lineHeight: 34, fontWeight: "700" }}>–</Text>
              : <TweenNumber value={kpi.value} format={kpi.format} numberOfLines={1} adjustsFontSizeToFit style={{ color: p.text, fontSize: 28, lineHeight: 34, fontWeight: "700", letterSpacing: -1, fontVariant: ["tabular-nums"] }} />}
            <Text numberOfLines={2} style={[ui.small, { color: p.muted }]}>{kpi.label}</Text>
            {!!kpi.delta && <DeltaLine p={p} delta={kpi.delta} />}
          </View>
        ))}
      </View>
      <Text style={[ui.small, { color: p.muted, marginTop: -12 }]}>Earnings count when a stay checks out. Occupancy is nights booked out of {formatCount(stats.available)} available in {monthName(month, false)}{stats.averageNightlyMinor !== null ? "; the nightly rate is your payout per night booked." : "."}</Text>

      {/* The owner menu's Calendar opens here (lib/home-tools.ts client "booking-calendar"). */}
      <Anchor id={sectionAnchor("Booking calendar")}><View style={[card, { gap: 14 }]}>
        {heading("Booking calendar", "Every stay across your properties. Tap a stay or a day for details.")}
        <BookingCalendar p={p} month={month} today={today} stays={monthStays} colourOf={colourOf} onMonth={setMonth} onStay={setOpen} />
      </View></Anchor>

      <View style={{ flexDirection: desktop ? "row" : "column", gap: 16, alignItems: "flex-start" }}>
        <View style={[card, { flex: desktop ? 1 : undefined, alignSelf: "stretch", gap: 4 }]}>
          {heading("Guests staying now", inHouse.length ? `${inHouse.length} ${inHouse.length === 1 ? "stay" : "stays"} in progress` : "No guests in residence today")}
          {inHouse.map(s => stayRow(s, true))}
          <View style={{ height: 1, backgroundColor: p.border, marginVertical: 8 }} />
          {heading("Upcoming bookings", upcoming.length ? "Confirmed stays in the next four months" : "No confirmed stays in the next four months yet")}
          {upcoming.slice(0, 12).map(s => stayRow(s, false))}
          {upcoming.length > 12 && <Text style={[ui.small, { color: p.muted }]}>And {upcoming.length - 12} more in the calendar.</Text>}
        </View>
        <View style={[card, { flex: desktop ? 1 : undefined, alignSelf: "stretch", gap: 14 }]}>
          {heading("Earnings by property", `${monthName(month)}, by stays checking out`)}
          {byProperty.map((x, i) => (
            <MotionPress key={x.propertyId} accessibilityRole="button" accessibilityLabel={`${x.name}: ${formatMoney(x.earningsMinor)}`} {...propertyFocus.press(i)} onLayout={i === 0 ? (e: { nativeEvent: { layout: { width: number } } }) => setPropertyWidth(e.nativeEvent.layout.width) : undefined} style={{ gap: 8, position: "relative", zIndex: propertyFocus.focus === i ? 5 : 0 }}>
              <View style={ui.between}>
                <Text numberOfLines={1} style={{ flex: 1, color: p.text, fontSize: 14, fontWeight: "600" }}>{x.name}</Text>
                <Text style={{ color: p.text, fontSize: 14, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{formatMoney(x.earningsMinor)}</Text>
              </View>
              <GrowBar share={x.earningsMinor / maxProperty} color={colourOf(x.propertyId)} track={p.background} />
              <Text style={[ui.small, { color: p.muted }]}>{percent(x.occupancy)} occupied · {x.nights} {x.nights === 1 ? "night" : "nights"} · {x.bookings} {x.bookings === 1 ? "booking" : "bookings"}</Text>
              {propertyFocus.focus === i && <ChartTip p={p} x={Math.max(80, x.earningsMinor / maxProperty * propertyWidth)} width={propertyWidth} top={-62} tipWidth={210} title={x.name} rows={[{ label: "Earnings", value: formatMoney(x.earningsMinor), color: colourOf(x.propertyId) }, { label: "Share of month", value: propertyTotal ? Math.round(x.earningsMinor / propertyTotal * 100) + "%" : "0%" }]} />}
            </MotionPress>
          ))}
          {!byProperty.length && !loading && <Text style={[ui.small, { color: p.muted }]}>Your properties appear here once they are live.</Text>}
        </View>
      </View>

      <View style={[card, { gap: 14 }]}>
        {heading("Earnings, last 12 months", `${formatMoney(yearTotal)} from stays checking out since ${monthName(twelve[0].month)}. Tap a month to see it.`)}
        <View onLayout={e => setMonthsWidth(e.nativeEvent.layout.width)} style={{ flexDirection: "row", alignItems: "flex-end", gap: desktop ? 10 : 4, height: 150, position: "relative" }}>
          {twelve.map((x, i) => {
            const selected = x.month === month;
            return (
              <MotionPress key={x.month} accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={`${monthName(x.month)}: ${formatMoney(x.earningsMinor)}`} onPress={() => setMonth(x.month)} onHoverIn={() => monthFocus.setFocus(i)} onHoverOut={() => monthFocus.setFocus(f => (f === i ? null : f))} style={{ flex: 1, height: "100%", justifyContent: "flex-end", alignItems: "center", gap: 6 }}>
                <View style={{ width: "100%", maxWidth: 44, height: Math.max(4, (x.earningsMinor / maxMonth) * 112), borderRadius: 8, backgroundColor: selected ? p.primary : p.wash, borderWidth: selected ? 0 : 1, borderColor: p.border }} />
                <Text numberOfLines={1} style={{ color: selected ? p.text : p.muted, fontSize: 11, fontWeight: selected ? "700" : "500" }}>{desktop ? monthName(x.month, false) : monthName(x.month, false).slice(0, 1)}</Text>
              </MotionPress>
            );
          })}
          {(() => { const i = monthFocus.focus ?? (desktop ? null : twelve.findIndex(x => x.month === month)); const x = i === null || i < 0 ? null : twelve[i]; return x && <ChartTip p={p} x={(i! + 0.5) / twelve.length * monthsWidth} width={monthsWidth} top={-10} tipWidth={190} title={monthName(x.month)} rows={[{ label: "Earnings", value: formatMoney(x.earningsMinor), color: p.primary }, { label: "Share of year", value: yearTotal ? Math.round(x.earningsMinor / yearTotal * 100) + "%" : "0%" }]} />; })()}
        </View>
      </View>

      <Section title="Statements" count={myStatements.length} p={p}>
        {myStatements.map(s => <StatementCard key={s.id} p={p} s={s} />)}
        {!myStatements.length && !loading && <Notice text="Your first statement appears here once the month is reconciled and issued." p={p} />}
      </Section>

      <Sheet palette={p} visible={!!open} onClose={() => setOpen(null)} title={open?.propertyName ?? ""} subtitle={open ? `${shortDate(open.checkIn)} to ${shortDate(open.checkOut)}` : ""} icon="calendar">
        {open && ([
          ["log-in", "Check-in", longDate(open.checkIn)],
          ["log-out", "Check-out", longDate(open.checkOut)],
          ["moon", "Nights", String(open.nights)],
          ["users", "Guests", open.guests ? String(open.guests) : "Not recorded"],
          ["globe", "Booked on", CHANNEL_LABEL[open.channel] ?? open.channel],
          ["hash", "Reservation code", open.channelReference ?? open.reference],
          ["credit-card", "Payout", open.payoutMinor === null ? "Not recorded yet" : formatMoney(open.payoutMinor)],
        ] as const).map(([icon, title, value]) => (
          <View key={title} style={[ui.row, { gap: 12, paddingVertical: 4 }]}>
            <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: p.wash, alignItems: "center", justifyContent: "center" }}><Feather name={icon} size={16} color={p.text} /></View>
            <View style={{ flex: 1 }}><Text style={[ui.small, { color: p.muted }]}>{title}</Text><Text selectable style={{ color: p.text, fontSize: 15, fontWeight: "600" }}>{value}</Text></View>
          </View>
        ))}
      </Sheet>
    </View>
  );
}

// A month in the style of Google Calendar: stays drawn as bars across the nights they cover,
// coloured by property, with Today and month arrows. Tap a stay for its details, or a day for its
// arrivals and departures.
function BookingCalendar({ p, month, today, stays, colourOf, onMonth, onStay }: { p: Palette; month: string; today: string; stays: OwnerStay[]; colourOf: (id: string) => string; onMonth: (month: string) => void; onStay: (stay: OwnerStay) => void }) {
  const { width } = useWindowDimensions();
  const compact = width < 700;
  const [selected, setSelected] = useState(today);
  const weeks = monthGrid(month);
  const barHeight = compact ? 16 : 20;
  const arriving = stays.filter(s => s.checkIn === selected), leaving = stays.filter(s => s.checkOut === selected), staying = stays.filter(s => s.checkIn < selected && s.checkOut > selected);
  const dayRow = (s: OwnerStay, what: string) => (
    <MotionPress key={what + s.reservationId} accessibilityRole="button" onPress={() => onStay(s)} style={[ui.row, { gap: 12, padding: 12, borderRadius: 16, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border }]}>
      <View style={{ width: 6, alignSelf: "stretch", borderRadius: 3, backgroundColor: colourOf(s.propertyId) }} />
      <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
        <Text style={{ color: p.text, fontSize: 14, fontWeight: "600" }}>{what} · {s.propertyName}</Text>
        <Text style={[ui.small, { color: p.muted }]}>{shortDate(s.checkIn)} to {shortDate(s.checkOut)}{s.guests ? ` · ${s.guests} ${s.guests === 1 ? "guest" : "guests"}` : ""} · {CHANNEL_LABEL[s.channel] ?? s.channel}</Text>
      </View>
      <Text style={{ color: p.text, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{formatMoney(s.payoutMinor)}</Text>
    </MotionPress>
  );
  return (
    <View style={{ gap: 14 }}>
      <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
        <MotionPress accessibilityRole="button" onPress={() => { onMonth(today.slice(0, 7)); setSelected(today); }} style={{ minHeight: 38, paddingHorizontal: 14, justifyContent: "center", borderRadius: 999, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface }}>
          <Text style={{ color: p.text, fontSize: 13, fontWeight: "700" }}>Today</Text>
        </MotionPress>
        <MotionPress accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => onMonth(addMonths(month, -1))} style={{ width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: p.elevated }}><Feather name="chevron-left" size={18} color={p.text} /></MotionPress>
        <MotionPress accessibilityRole="button" accessibilityLabel="Next month" onPress={() => onMonth(addMonths(month, 1))} style={{ width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: p.elevated }}><Feather name="chevron-right" size={18} color={p.text} /></MotionPress>
        <Text accessibilityRole="header" style={{ color: p.text, fontSize: 18, fontWeight: "700", marginLeft: 4 }}>{monthName(month)}</Text>
      </View>
      <View style={{ borderRadius: 18, borderWidth: 1, borderColor: p.border, overflow: "hidden", backgroundColor: p.surface }}>
        <View style={{ flexDirection: "row", borderBottomWidth: 1, borderColor: p.border }}>
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(name => <Text key={name} style={{ flex: 1, textAlign: "center", paddingVertical: 8, color: p.muted, fontSize: 11, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" }}>{compact ? name.slice(0, 1) : name}</Text>)}
        </View>
        {weeks.map((days, row) => {
          const weekEnd = addDays(days[0], 7);
          // Each stay in the week is a bar from its first night to its last; overlapping stays take the next lane.
          const lanes: number[] = [];
          const placed = stays.filter(s => s.checkIn < weekEnd && s.checkOut > days[0]).sort((a, b) => a.checkIn.localeCompare(b.checkIn)).map(s => {
            const start = s.checkIn < days[0] ? 0 : daysFrom(days[0], s.checkIn);
            const end = s.checkOut > weekEnd ? 7 : daysFrom(days[0], s.checkOut);
            const span = Math.max(1, end - start);
            let lane = lanes.findIndex(endCol => endCol <= start);
            if (lane < 0) { lane = lanes.length; lanes.push(0); }
            lanes[lane] = start + span;
            return { s, start, span, lane, began: s.checkIn < days[0], continues: s.checkOut > weekEnd };
          });
          const height = Math.max(compact ? 64 : 92, 28 + lanes.length * (barHeight + 4) + 6);
          return (
            <View key={row} style={{ height, borderTopWidth: row ? 1 : 0, borderColor: p.border }}>
              <View style={{ flexDirection: "row", flex: 1 }}>
                {days.map((date, col) => {
                  const inMonth = date.startsWith(month), isToday = date === today, isSelected = date === selected;
                  return (
                    <MotionPress key={date} accessibilityRole="button" accessibilityState={{ selected: isSelected }} accessibilityLabel={longDate(date)} onPress={() => setSelected(date)} style={{ flex: 1, borderLeftWidth: col ? 1 : 0, borderColor: p.border, backgroundColor: isSelected ? p.wash : "transparent", paddingTop: 4, alignItems: "center" }}>
                      <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: isToday ? p.primary : "transparent" }}>
                        <Text style={{ color: isToday ? p.onPrimary : inMonth ? p.text : p.disabled, fontSize: 12, fontWeight: isToday ? "700" : "500" }}>{Number(date.slice(8))}</Text>
                      </View>
                    </MotionPress>
                  );
                })}
              </View>
              {placed.map(({ s, start, span, lane, began, continues }) => (
                <MotionPress key={s.reservationId + row} accessibilityRole="button" accessibilityLabel={`${s.propertyName}, ${shortDate(s.checkIn)} to ${shortDate(s.checkOut)}`} onPress={() => onStay(s)}
                  style={{ position: "absolute", top: 30 + lane * (barHeight + 4), left: `${(start / 7) * 100}%`, width: `${(span / 7) * 100}%`, height: barHeight, paddingHorizontal: 3 }}>
                  <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 6, backgroundColor: colourOf(s.propertyId), borderTopLeftRadius: began ? 0 : 6, borderBottomLeftRadius: began ? 0 : 6, borderTopRightRadius: continues ? 0 : 6, borderBottomRightRadius: continues ? 0 : 6 }}>
                    <Text numberOfLines={1} style={{ color: p.isDark ? "#0F1E1A" : "#FFFFFF", fontSize: compact ? 10 : 12, fontWeight: "700" }}>{compact ? s.nights + "n" : `${s.propertyName} · ${s.nights}n`}</Text>
                  </View>
                </MotionPress>
              ))}
            </View>
          );
        })}
      </View>
      <View style={{ gap: 10 }}>
        <Text accessibilityRole="header" style={{ color: p.text, fontSize: 16, fontWeight: "700" }}>{longDate(selected)}</Text>
        {arriving.map(s => dayRow(s, "Arriving"))}
        {leaving.map(s => dayRow(s, "Leaving"))}
        {staying.map(s => dayRow(s, "Staying"))}
        {!arriving.length && !leaving.length && !staying.length && <Text style={[ui.small, { color: p.muted }]}>No guests arriving, leaving or staying on this day.</Text>}
      </View>
    </View>
  );
}
