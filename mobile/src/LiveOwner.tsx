import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { z } from "zod";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { ui, type Palette } from "./theme";
import { addDays, dayLabel, london, Notice, Section, Tag, Loading, StatGrid, StatTile } from "./LiveKit";
import { formatDay, formatMoneyShort } from "../../lib/format";
import { List, Pills, Row } from "./LiveAccounts";
import { readFinance, readTeams, WorkspaceApiError } from "./backend/client";
import { StatementFiles } from "./AccountsFiles";
import { scheduleSchema } from "../../lib/cleans-live";
import { monthLabel, pounds, statementSchema, type Statement } from "../../lib/accounts-live";
import type { PropertyView } from "../../lib/workspace-view";

// Live owner view: the owner's confirmed stays and their issued and paid
// statements, straight from the backend. Owners only see their own properties.
type Schedule = z.infer<typeof scheduleSchema>;
const nights = (from: string, to: string) => Math.round((Date.parse(to + "T12:00:00Z") - Date.parse(from + "T12:00:00Z")) / 86400000);

function StatementCard({ p, s }: { p: Palette; s: Statement }) {
  const [open, setOpen] = useState(false);
  const line = (label: string, value: string, strong = false) => (
    <View style={[ui.between, { gap: 12 }]}><Text style={[ui.small, { color: strong ? p.text : p.muted, flex: 1, fontWeight: strong ? "700" : "400" }]}>{label}</Text><Text style={{ color: p.text, fontWeight: strong ? "700" : "600" }}>{value}</Text></View>
  );
  return (
    <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 10 }]}>
      <View style={[ui.between, { gap: 10 }]}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: p.text, fontSize: 16, fontWeight: "700" }}>{monthLabel(s.period)}</Text>
          <Text style={[ui.small, { color: p.muted }]}>{s.propertyName}</Text>
        </View>
        <Tag label={s.status === "paid" ? "Paid" : s.payoutMinor < 0 ? "Balance due" : "Issued"} tone={s.status === "paid" ? "good" : s.payoutMinor < 0 ? "bad" : "plain"} p={p} />
      </View>
      {line("Booking income", pounds(s.revenueMinor))}
      {line(`Cleaning (${s.cleaningCount})`, "−" + pounds(s.cleaningMinor))}
      {line("Repairs and supplies", "−" + pounds(s.expensesMinor))}
      {line(`Management fee (${s.feeBps / 100}%)`, "−" + pounds(s.feeMinor))}
      <View style={{ height: 1, backgroundColor: p.border }} />
      {line(s.payoutMinor < 0 ? "You owe" : "Your payout", pounds(Math.abs(s.payoutMinor)), true)}
      {s.status === "paid" && <Text style={[ui.small, { color: p.muted }]}>Paid by bank transfer{s.paidAt ? ` on ${new Date(s.paidAt).toLocaleDateString("en-GB")}` : ""}, reference {s.payoutReference}.</Text>}
      {s.status === "issued" && s.payoutMinor >= 0 && <Text style={[ui.small, { color: p.muted }]}>Your payout is being prepared.</Text>}
      <MotionPress accessibilityRole="button" onPress={() => setOpen(v => !v)} style={[ui.row, { gap: 6 }]}>
        <Feather name={open ? "chevron-up" : "chevron-down"} size={16} color={p.primary} /><Text style={{ color: p.primary, fontWeight: "600" }}>{open ? "Hide the detail" : "See every stay and cost"}</Text>
      </MotionPress>
      {open && <View style={{ gap: 6 }}>
        {s.detail.stays.map(x => line(`${dayLabel(x.checkIn)} to ${dayLabel(x.checkOut)}`, pounds(x.amountMinor)))}
        {s.detail.expenses.map(x => line(`${x.supplier} (${x.reference})`, "−" + pounds(x.amountMinor)))}
        {!s.detail.stays.length && !s.detail.expenses.length && <Text style={[ui.small, { color: p.muted }]}>No stays or costs this month.</Text>}
      </View>}
      <StatementFiles p={p} statement={s} audience="owner" />
    </View>
  );
}

export function LiveOwner({ palette: p, properties }: { palette: Palette; properties: PropertyView[] }) {
  const [today] = useState(() => london(new Date()));
  const [schedule, setSchedule] = useState<Schedule>({ work: [], stays: [] });
  const [statements, setStatements] = useState<Statement[]>([]);
  const [propertyId, setPropertyId] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    const [s, st] = await Promise.allSettled([readTeams({ section: "schedule", from: addDays(today, -14), to: addDays(today, 45) }), readFinance({ section: "statements" })]);
    try {
      if (s.status === "fulfilled") setSchedule(scheduleSchema.parse(s.value.data)); else throw s.reason;
      if (st.status === "fulfilled") setStatements(z.array(statementSchema).parse(st.value.data)); else throw st.reason;
    } catch (e) { setError(e instanceof WorkspaceApiError ? e.message : "Your stays and statements could not be loaded."); }
    setLoading(false);
  }, [today]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);

  const mine = (id: string) => propertyId === "all" || id === propertyId;
  const stays = schedule.stays.filter(s => mine(s.propertyId));
  const upcoming = stays.filter(s => s.checkOut >= today), recent = stays.filter(s => s.checkOut < today).reverse();
  const shown = statements.filter(s => mine(s.propertyId));
  const nextArrival = upcoming.find(s => s.checkIn >= today);
  const bookedNights = upcoming.reduce((n, s) => n + nights(s.checkIn > today ? s.checkIn : today, s.checkOut), 0);

  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[ui.title, { color: p.text }]}>Stays and statements</Text>
        <Text style={[ui.body, { color: p.muted }]}>Who is staying, and what each month paid you.</Text>
      </View>
      {properties.length > 1 && <Pills p={p} values={["all", ...properties.map(x => x.id)]} value={propertyId} onChange={setPropertyId} label={v => v === "all" ? "All properties" : properties.find(x => x.id === v)?.name ?? "Property"} />}
      <StatGrid>
        <StatTile p={p} icon="calendar" tone="clients" label="Next arrival" value={nextArrival ? formatDay(nextArrival.checkIn) : "None booked"} />
        <StatTile p={p} icon="moon" tone="clients" label="Nights booked ahead" value={bookedNights} />
        <StatTile p={p} icon="credit-card" tone="clients" label="Latest payout" value={shown[0] ? formatMoneyShort(shown[0].payoutMinor) : "–"} />
      </StatGrid>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {loading && <Loading p={p} />}
      <Section title="Upcoming stays" count={upcoming.length} p={p}>
        <List p={p} empty="No stays booked in the next six weeks.">
          {upcoming.map((s, i) => <Row key={s.reservationId} p={p} first={i === 0} icon="calendar" tone="clients" title={`${dayLabel(s.checkIn)} to ${dayLabel(s.checkOut)}`} detail={`${s.propertyName} · ${nights(s.checkIn, s.checkOut)} nights${s.guests ? ` · ${s.guests} guests` : ""}`} tags={[s.checkIn <= today ? ["Staying now", "good"] : ["Booked", "plain"]]} />)}
        </List>
      </Section>
      {recent.length > 0 && <Section title="Recent stays" p={p}>
        <List p={p} empty="">{recent.map((s, i) => <Row key={s.reservationId} p={p} first={i === 0} icon="check-circle" tone="clients" title={`${dayLabel(s.checkIn)} to ${dayLabel(s.checkOut)}`} detail={`${s.propertyName} · ${nights(s.checkIn, s.checkOut)} nights`} />)}</List>
      </Section>}
      <Section title="Statements" count={shown.length} p={p}>
        {shown.map(s => <StatementCard key={s.id} p={p} s={s} />)}
        {!shown.length && !loading && <Notice text="Your first statement appears here once the month is reconciled and issued." p={p} />}
      </Section>
    </View>
  );
}
