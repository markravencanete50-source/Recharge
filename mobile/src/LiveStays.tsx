import { useCallback, useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { z } from "zod";
import { Text } from "./Typography";
import { useSaved } from "./Celebrate";
import { MotionPress } from "./motion";
import { ui, type Palette } from "./theme";
import { addDays, Button, dayLabel, london, Notice, Section, Tag, useWorkFocus, Loading, RefreshButton, StatGrid, StatTile } from "./LiveKit";
import { List, Row } from "./LiveAccounts";
import { Pills, pillBox, pillInk } from "./Pills";
import { readOperations, readTeams, WorkspaceApiError } from "./backend/client";
import { workDetails } from "../../lib/work-details";
import { scheduleSchema } from "../../lib/cleans-live";
import { dailyChecks, vacantNights } from "../../lib/management-live";
import { canStart } from "../../lib/home-tools";
import { operationViewSchema, type PropertyView } from "../../lib/workspace-view";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import { GuestInbox } from "./LiveGuestInbox";
import { TodaysRoutine } from "./StaysRoutine";
import { StaySheet } from "./StaySheet";
import { ListingSheet, PricingSheet, ReviewSheet } from "./ListingSheets";
import { SignOffCard } from "./SignOffCard";
export { SignOffCard };

// Live Stays: arrivals, departures and cleans by day, recording stays with their
// platform details, and the daily listing and pricing checks. Backend data only.
type Schedule = z.infer<typeof scheduleSchema>;
type Operation = z.infer<typeof operationViewSchema>;
// The end-of-day sign-off card lives in SignOffCard.tsx (Home offers it to Stays when nobody is clocked in).

export function LiveStays({ palette: p, account, properties, onOpenRepairs, onOpenWork }: { palette: Palette; account: WorkspaceAccount; properties: PropertyView[]; onOpenRepairs: () => void; onOpenWork?: (item: Operation) => void }) {
  const saved = useSaved();
  const [today] = useState(() => london(new Date()));
  const weekEnd = addDays(today, 6);
  const [schedule, setSchedule] = useState<Schedule>({ work: [], stays: [] });
  const [operations, setOperations] = useState<Operation[]>([]);
  const [day, setDay] = useState(today);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const focus = useWorkFocus();
  const [recording, setRecording] = useState(() => focus?.open === "record-stay");
  const [listingFor, setListingFor] = useState<PropertyView | null>(null);
  const [pricingFor, setPricingFor] = useState<{ property: PropertyView; nights: string[] } | null>(null);
  const [reviewFor, setReviewFor] = useState<PropertyView | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  // Stays has two tabs for people with the guest communication tool: the day, and the guest inbox.
  const hasInbox = account.modules.includes("guest-communication");
  const [tab, setTab] = useState<"today" | "inbox">(() => hasInbox && focus?.sub === "inbox" ? "inbox" : "today");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const [s, o] = await Promise.allSettled([readTeams({ section: "schedule", from: addDays(today, -1), to: addDays(today, 30) }), readOperations()]);
    try {
      if (s.status === "fulfilled") setSchedule(scheduleSchema.parse(s.value.data)); else throw s.reason;
      if (o.status === "fulfilled") setOperations(z.array(operationViewSchema).parse(o.value.data)); else throw o.reason;
    } catch (e) { setError(e instanceof WorkspaceApiError ? e.message : "Stays could not be loaded. Refresh to try again."); }
    setRefreshKey(k => k + 1);
    setLoading(false);
  }, [today]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);

  const days = Array.from({ length: 14 }, (_, i) => addDays(today, i));
  const week = days.slice(0, 7);
  const arrivals = schedule.stays.filter(s => s.checkIn === day), departures = schedule.stays.filter(s => s.checkOut === day);
  const cleans = schedule.work.filter(w => w.kind === "cleaning" && w.dueOn === day);
  type DayRow = { key: string; title: string; detail: string; tag: [string, "good" | "wait" | "plain"] };
  const dayRows: DayRow[] = [
    ...arrivals.map(s => ({ key: "in" + s.reservationId, title: `Arrival · ${s.propertyName}`, detail: `Until ${dayLabel(s.checkOut)}${s.guests ? ` · ${s.guests} guests` : ""}`, tag: ["Check-in", "good"] as DayRow["tag"] })),
    ...departures.map(s => ({ key: "out" + s.reservationId, title: `Departure · ${s.propertyName}`, detail: `Arrived ${dayLabel(s.checkIn)}`, tag: ["Check-out", "plain"] as DayRow["tag"] })),
    ...cleans.map(w => ({ key: w.workId, title: `Clean · ${w.propertyName}`, detail: w.assigneeName ? `Assigned to ${w.assigneeName}` : "No cleaner assigned yet", tag: (w.assigneeId ? ["Assigned", "good"] : ["Unassigned", "wait"]) as DayRow["tag"] })),
  ];
  const toRefer = operations.filter(op => op.kind === "maintenance" && op.data.phase === "triage").length;
  const checks = dailyChecks(properties.map(x => x.id), operations, today, weekEnd);
  const listingsDue = checks.filter(c => !c.listingCheckedToday).length;
  const relistings = operations.filter(op => op.kind === "relisting" && !["completed", "cancelled"].includes(op.status));
  const nameOf = (id: string) => properties.find(x => x.id === id)?.name ?? "Property";

  const tabs = hasInbox && <Pills p={p} values={["today", "inbox"] as const} value={tab} onChange={setTab} label={v => v === "today" ? "Today" : "Guest inbox"} />;
  if (tab === "inbox") return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[ui.title, { color: p.text }]}>Guest inbox</Text>
        <Text style={[ui.body, { color: p.muted }]}>Messages from guests on every platform, the longest wait first.</Text>
      </View>
      {tabs}
      <GuestInbox palette={p} properties={properties} account={account} />
    </View>
  );
  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[ui.title, { color: p.text }]}>Stays</Text>
        <Text style={[ui.body, { color: p.muted }]}>Arrivals, departures, cleans and the daily listing and pricing checks.</Text>
      </View>
      {tabs}
      <TodaysRoutine p={p} account={account} properties={properties} operations={operations} schedule={schedule} today={today} loading={loading} />
      <StatGrid>
        <StatTile p={p} icon="log-in" tone="stays" label="Arrivals" value={schedule.stays.filter(s => s.checkIn === today).length} detail="Today" />
        <StatTile p={p} icon="log-out" tone="stays" label="Departures" value={schedule.stays.filter(s => s.checkOut === today).length} detail="Today" />
        <StatTile p={p} icon="check-square" tone="stays" label="Listings to check" value={listingsDue} detail="Daily listing check" attention={listingsDue > 0} />
      </StatGrid>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {loading && <Loading p={p} />}
      <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
        {canStart(account, "record-stay") && <Button label="Record a stay" icon="plus" primary p={p} onPress={() => setRecording(true)} />}
        <RefreshButton p={p} loading={loading} onPress={() => void load()} />
      </View>
      <SignOffCard p={p} refreshKey={refreshKey} />
      {toRefer > 0 && <MotionPress accessibilityRole="button" onPress={onOpenRepairs} style={[ui.row, { gap: 12, padding: 14, borderRadius: 18, backgroundColor: p.wash }]}>
        <Feather name="tool" size={18} color={p.primary} />
        <Text style={{ color: p.text, flex: 1, fontWeight: "600" }}>{toRefer} repair{toRefer === 1 ? "" : "s"} waiting for you to refer to Ready</Text>
        <Feather name="chevron-right" size={18} color={p.muted} />
      </MotionPress>}

      {!!relistings.length && <Section title="Re-listings" count={relistings.length} p={p}>
        <List p={p} empty="">
          {relistings.map((r, i) => {
            const why = workDetails(r).find(d => d.label === "Why")?.value ?? "To re-list";
            return <Row key={r.workId} p={p} first={i === 0} icon="refresh-cw" tone="stays" title={nameOf(r.propertyId)} detail={[why, typeof r.data.platform === "string" ? r.data.platform : ""].filter(Boolean).join(" · ")}
              tags={[[r.data.phase === "relisting" ? "Under way" : "To start", r.data.phase === "relisting" ? "plain" : "wait"]]} onPress={onOpenWork ? () => onOpenWork(r) : undefined} />;
          })}
        </List>
      </Section>}

      <Section title="Day by day" p={p}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {days.map(d => {
            const on = d === day, busy = schedule.stays.some(s => s.checkIn === d || s.checkOut === d);
            return (
              <MotionPress key={d} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setDay(d)} style={{ minWidth: 64, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 16, alignItems: "center", gap: 2, ...pillBox(p, on) }}>
                <Text style={{ color: pillInk(p, on, true), fontSize: 11, fontWeight: "600" }}>{d === today ? "Today" : dayLabel(d).split(" ")[0]}</Text>
                <Text style={{ color: pillInk(p, on), fontSize: 17, fontWeight: "600" }}>{Number(d.slice(8))}</Text>
                <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: busy ? (on ? p.onSelected : p.primary) : "transparent" }} />
              </MotionPress>
            );
          })}
        </ScrollView>
        <List p={p} empty={`No arrivals, departures or cleans on ${dayLabel(day)}.`}>
          {dayRows.map((r, i) => <Row key={r.key} p={p} first={i === 0} title={r.title} detail={r.detail} tags={[r.tag]} />)}
        </List>
      </Section>

      <Section title="Daily checks" count={listingsDue} p={p}>
        {properties.map(property => {
          const check = checks.find(c => c.propertyId === property.id)!;
          const vacant = vacantNights(property.id, schedule.stays, week);
          const unpriced = vacant.filter(n => !operations.some(op => op.propertyId === property.id && op.kind === "daily_pricing" && op.data.night === n));
          return (
            <View key={property.id} style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 10 }]}>
              <View style={[ui.between, { gap: 10 }]}>
                <Text style={{ color: p.text, fontSize: 15, fontWeight: "700", flex: 1 }}>{property.name}</Text>
                <Tag label={check.listingCheckedToday ? "Listing checked" : "Listing check due"} tone={check.listingCheckedToday ? "good" : "wait"} p={p} />
              </View>
              {check.suspended && <Notice text="A listing was reported suspended today. Contact the platform." p={p} tone="bad" />}
              {check.negativeReview && <Notice text="A negative review came in today. Make sure it has a reply." p={p} />}
              <Text style={[ui.small, { color: p.muted }]}>{vacant.length ? `${vacant.length} empty night${vacant.length === 1 ? "" : "s"} this week · ${check.pricedNights} priced` : "Fully booked for the next 7 nights"}</Text>
              <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
                <Button label="Listing check" icon="check-circle" p={p} onPress={() => setListingFor(property)} />
                <Button label="Log a review" icon="star" p={p} onPress={() => setReviewFor(property)} />
                {unpriced.length > 0 && <Button label="Price a night" icon="trending-down" p={p} onPress={() => setPricingFor({ property, nights: unpriced })} />}
              </View>
            </View>
          );
        })}
        {!properties.length && <Notice text="No properties are assigned to you yet." p={p} />}
      </Section>

      <StaySheet p={p} visible={recording} properties={properties} onClose={() => setRecording(false)} onDone={saved(load)} />
      <ListingSheet p={p} property={listingFor} onClose={() => setListingFor(null)} onDone={saved(load)} />
      <PricingSheet p={p} target={pricingFor} onClose={() => setPricingFor(null)} onDone={saved(load)} />
      <ReviewSheet p={p} property={reviewFor} onClose={() => setReviewFor(null)} onDone={saved(load)} />
    </View>
  );
}

export { ListingSheet, PricingSheet, ReviewSheet, StaySheet };
