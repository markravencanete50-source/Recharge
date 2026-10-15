import { useContext, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { followUpsDue, portfolioSummary } from "../../lib/portfolio-overview";
import { EndOfDayCard } from "./EndOfDayCard";
import { OwnerActions, OwnerHome } from "./LiveOwnerHome";
import { RoleHome } from "./RoleHome";
import { HomeFavorites, HomeTools } from "./HomeTools";
import { ReadyHome } from "./ReadyHome";
import { TodayBoard } from "./TodayBoard";
import { boardRole, shiftDay } from "../../lib/today-board";
import { AdminHome } from "./LiveOversight";
import { AskBox, BusinessFigures, HomeGreeting, NeedsList, ShiftButton } from "./HomeFocus";
import { SearchPanel } from "./WorkspaceSearch";
import { london } from "./LiveKit";
import { readOwner } from "./backend/client";
import { ownerNeeds, teamNeeds, type NeedLine, type NeedOpen } from "../../lib/home-needs";
import { hasRoleHome, ownerFigures, ownerUpcoming, type OwnerUpcoming } from "../../lib/role-home";
import { ownerPeriodsSchema, periodRange, readRange, summarisePeriod, type PeriodSummary } from "../../lib/owner-periods";
import { ownerBookingsSchema } from "../../lib/owner-policy";
import { ownerApprovals } from "../../lib/owner-approvals";
import { repairClosed } from "../../lib/repairs-live";
import type { HomeToolTarget } from "../../lib/home-tools";
import type { SearchEntry } from "../../lib/workspace-search";
import { ui, type Palette } from "./theme";
import { isDone, workDate } from "./LiveRows";
import type { AnalyticsPeriod, AnalyticsSnapshot } from "../../lib/analytics";
import type { WorkspaceSection } from "../../lib/workspace-map";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import type { NoticeView, PropertyView } from "../../lib/workspace-view";
import type { JourneyView, OperationView } from "../../lib/workflow-forms";

// London time, like every other date in the app, so the greeting is right wherever the phone is set.
const greeting = () => { const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" }).format(new Date())); return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"; };
const londonToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
const longToday = () => new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London" });

type HomeProps = {
  palette: Palette; desktop: boolean; account: WorkspaceAccount; snapshot: AnalyticsSnapshot | null; period: AnalyticsPeriod;
  properties: PropertyView[]; journeys?: JourneyView[]; work: OperationView[]; notices: NoticeView[]; loading: boolean; onNavigate: (section: WorkspaceSection) => void; onTool: (target: HomeToolTarget) => void;
  favoriteEntries?: SearchEntry[]; onOpenEntry?: (entry: SearchEntry) => void;
};

// Home. Calm for everyone (Alex's feedback, approved by Lee; then, Lee: what we applied for the super admin, applied to
// every role): a short greeting, "What do you need?", the person's own figures at a glance, what needs them now and
// their own few shortcuts. Recent activity is under the bell, the To-do list on its tab, My performance, Favorites and
// Help in the menu. `favoriteEntries` is the workspace search index and `onOpenEntry` opens one of its entries, both
// from the host and both optional.
export function LiveHome(props: HomeProps) {
  return props.account.role === "client" ? <OwnerLiveHome {...props} /> : <TeamHome {...props} />;
}

function TeamHome({ palette: p, desktop, account, properties, journeys = [], work, loading, onNavigate, onTool, favoriteEntries, onOpenEntry }: HomeProps) {
  const [searching, setSearching] = useState(false);
  const admin = account.role === "admin" || account.role === "super_admin";
  const board = !!boardRole(account.role);
  const today = londonToday();
  // Clients who asked for more time, whose check-in date has arrived (onboarding team only).
  const followUps = account.modules.includes("property-onboarding") ? followUpsDue(journeys, properties, today).length : 0;
  const open = work.filter(item => !isDone(item.status));
  const overdue = open.filter(item => { const d = workDate(item); return !!d && d < today; }).length;
  const dueToday = open.filter(item => workDate(item) === today).length;
  const lines = teamNeeds({ overdue, dueToday, otherOpen: open.length - overdue - dueToday, followUps });
  const openPlace = (place: NeedOpen) => place.kind === "page" ? onNavigate(place.section) : onTool(place);
  const openLine = (line: NeedLine) => openPlace(line.open);
  // Properties live and onboarding, for the admins' "This month" (the same count as Properties shows).
  const portfolio = admin && !loading ? portfolioSummary(properties, journeys) : null;
  const firstName = account.fullName.trim().split(/\s+/)[0] || "there";
  const canSearch = !!favoriteEntries && !!onOpenEntry;
  return (
    <View style={{ gap: 24, width: "100%", maxWidth: desktop ? 960 : undefined, alignSelf: "center" }}>
      <HomeGreeting palette={p} title={`${greeting()}, ${firstName}`} detail={longToday()} action={<ShiftButton palette={p} account={account} />} />
      {canSearch && <AskBox palette={p} desktop={desktop} onPress={() => setSearching(true)} />}
      {/* Stays with nobody clocked in sign the day off here (a reflection needs an open shift). */}
      <EndOfDayCard palette={p} account={account} />
      {/* Admins: the business at a glance (This month), then what needs their attention across it. Every other role the
          same way over their own work (RoleHome): their figures at a glance, then what needs them now. Cleaners, cleaning
          managers and Ready then have their day (Today, Tomorrow and Overdue), and Ready their repairs by stage. */}
      {admin ? <AdminHome palette={p} desktop={desktop} onTool={onTool} onOpen={openLine} onPlace={openPlace} portfolio={portfolio && { live: portfolio.live, onboarding: portfolio.onboarding }} followUps={followUps} />
        : hasRoleHome(account.role) ? <RoleHome palette={p} desktop={desktop} role={account.role} followUps={followUps} onOpen={openLine} onPlace={openPlace} />
        : <NeedsList palette={p} lines={lines} loading={loading} onOpen={openLine} />}
      {board && <TodayBoard palette={p} account={account} properties={properties} work={work} desktop={desktop} onTool={onTool} />}
      {account.role === "ready" && <ReadyHome palette={p} desktop={desktop} onTool={onTool} />}
      {/* The places the person starred themselves; the suggestions are in the menu under Favorites. */}
      <HomeFavorites palette={p} account={account} properties={properties} entries={favoriteEntries} onOpenEntry={onOpenEntry} onTool={onTool} onSection={onNavigate} savedOnly />
      {canSearch && <SearchPanel visible={searching} onClose={() => setSearching(false)} palette={p} entries={favoriteEntries} onOpen={onOpenEntry} />}
    </View>
  );
}

// Owners, like management (Lee): their own figures this month first, then what needs them (their approvals, new
// messages, a statement to read, repairs under way; never a zero, and one calm line when nothing waits), then where
// each property is up to and their figures by period, and their tools after, with "All tools".
function OwnerLiveHome({ palette: p, desktop, account, properties, journeys = [], work, loading, onNavigate, onTool }: HomeProps) {
  const actions = useContext(OwnerActions);
  const glance = useOwnerGlance();
  const approvals = useMemo(() => ownerApprovals(account, work, journeys, properties), [account, work, journeys, properties]);
  const repairsInProgress = work.filter(w => w.kind === "maintenance" && !isDone(w.status) && w.data.phase !== "owner_approval" && !repairClosed(String(w.data.phase ?? "triage"))).length;
  const lines = ownerNeeds({
    repairApprovals: approvals.filter(a => a.kind === "repair").length, onboardingSteps: approvals.filter(a => a.kind === "onboarding").length,
    unread: actions?.unread ?? 0, statements: glance.statements, statementMonth: glance.statementMonth, repairsInProgress,
  });
  const openPlace = (place: NeedOpen) => place.kind === "page" ? onNavigate(place.section) : onTool(place);
  const firstName = account.fullName.trim().split(/\s+/)[0] || "there";
  return (
    <View style={{ gap: 24, width: "100%", maxWidth: desktop ? 960 : undefined, alignSelf: "center" }}>
      <HomeGreeting palette={p} title={`${greeting()}, ${firstName}`} detail={longToday()} />
      <BusinessFigures palette={p} figures={ownerFigures(glance.month, glance.upcoming)} desktop={desktop} loading={glance.loading} onOpen={f => openPlace(f.open)} />
      <NeedsList palette={p} lines={lines} loading={loading} onOpen={l => openPlace(l.open)} />
      <OwnerHome palette={p} desktop={desktop} account={account} properties={properties} journeys={journeys} work={work} loading={loading} onNavigate={onNavigate} />
      <HomeTools palette={p} account={account} properties={properties} desktop={desktop} onOpen={onTool} onAll={() => onNavigate("help")} />
      <MotionPress accessibilityRole="button" accessibilityLabel="Help and FAQs" onPress={() => onNavigate("help")} style={[ui.button, { backgroundColor: p.wash }]}>
        <Feather name="help-circle" size={20} color={p.primary} />
        <Text style={[ui.buttonText, { color: p.primary }]}>Help for your role</Text>
        <Feather name="arrow-right" size={18} color={p.primary} />
      </MotionPress>
    </View>
  );
}

// An owner's own figures for this month (from their statements, else an estimate, as their Reports work it out), the
// next 30 days of bookings, and last month's statements once issued. Each read may fail on its own; its tiles then
// show "–" and the rest of Home carries on.
type OwnerGlance = { month: PeriodSummary | null; upcoming: OwnerUpcoming | null; statements: number; statementMonth: string | null; loading: boolean };
const monthLong = (month: string) => new Date(month + "-01T12:00:00Z").toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" });
function useOwnerGlance(): OwnerGlance {
  const [glance, setGlance] = useState<OwnerGlance>({ month: null, upcoming: null, statements: 0, statementMonth: null, loading: true });
  useEffect(() => {
    let active = true;
    const today = london(new Date()), range = periodRange("thisMonth", today), last = range.previous[0];
    void Promise.allSettled([
      readOwner({ section: "periods", ...readRange(range) }).then(r => ownerPeriodsSchema.parse(r.data)),
      readOwner({ section: "bookings", from: today, to: shiftDay(today, 30) }).then(r => ownerBookingsSchema.parse(r.data)),
    ]).then(([periods, bookings]) => {
      if (!active) return;
      const data = periods.status === "fulfilled" ? periods.value : null;
      setGlance({
        month: data ? summarisePeriod(data.months, range.months, data.properties.length) : null,
        upcoming: bookings.status === "fulfilled" ? ownerUpcoming(bookings.value.stays, today) : null,
        // Issued (or paid) statements for last month, one per property.
        statements: data ? data.months.filter(c => c.month === last && c.source === "statement" && c.status !== null).length : 0,
        statementMonth: monthLong(last), loading: false,
      });
    });
    return () => { active = false; };
  }, []);
  return glance;
}
