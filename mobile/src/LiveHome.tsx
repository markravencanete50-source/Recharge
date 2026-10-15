import { useMemo, useState } from "react";
import { Platform, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { JumpBackIn, QuickOverview, WelcomeHeader, type OverviewItem } from "./HomeOverview";
import { HeroGlow, OpenTasksTrend, TodayRing, TodayTiles } from "./TodayAnalytics";
import { CountUp, Entrance, MotionPress } from "./motion";
import { StateGraphic } from "./StateGraphic";
import { followUpsDue, portfolioSummary } from "../../lib/portfolio-overview";
import { EndOfDayCard } from "./EndOfDayCard";
import { CleanerMonthCard } from "./CleanerPay";
import { OwnerHome } from "./LiveOwnerHome";
import { HomeFavorites, HomeTools } from "./HomeTools";
import { ReadyHome } from "./ReadyHome";
import { TodayBoard } from "./TodayBoard";
import { boardRole } from "../../lib/today-board";
import { AdminHome } from "./LiveOversight";
import { AskBox, HomeGreeting, NeedsList, ShiftButton } from "./HomeFocus";
import { SearchPanel } from "./WorkspaceSearch";
import { teamNeeds, type NeedLine, type NeedOpen } from "../../lib/home-needs";
import type { HomeToolTarget } from "../../lib/home-tools";
import type { SearchEntry } from "../../lib/workspace-search";
import { ui, type Palette } from "./theme";
import { LiveNoticeRow, LiveWorkRow, isDone, isWaitingWork, workDate } from "./LiveRows";
import { todayColors, todayPresentation } from "../../lib/today-presentation";
import { periodLabel, type AnalyticsPeriod, type AnalyticsSnapshot } from "../../lib/analytics";
import type { WorkspaceSection } from "../../lib/workspace-map";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import { unreadNotices, type NoticeView, type PropertyView } from "../../lib/workspace-view";
import type { JourneyView, OperationView } from "../../lib/workflow-forms";

const OWNER_SUBTITLE = "Here is how your properties are doing today.";
// London time, like every other date in the app, so the greeting is right wherever the phone is set.
const greeting = () => { const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hourCycle: "h23" }).format(new Date())); return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"; };
const londonToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
const todayLabel = () => new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" });
const longToday = () => new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London" });

type HomeProps = {
  palette: Palette; desktop: boolean; account: WorkspaceAccount; snapshot: AnalyticsSnapshot | null; period: AnalyticsPeriod;
  properties: PropertyView[]; journeys?: JourneyView[]; work: OperationView[]; notices: NoticeView[]; loading: boolean; onNavigate: (section: WorkspaceSection) => void; onTool: (target: HomeToolTarget) => void;
  favoriteEntries?: SearchEntry[]; onOpenEntry?: (entry: SearchEntry) => void;
};

// Home. The team's is calm (Alex's feedback, approved by Lee): a short greeting with the shift button,
// "What do you need?", what needs them now and their own few shortcuts. Recent activity is under the
// bell, the To-do list on its tab, My performance, Favorites and Help in the menu. Owners keep the
// home they had. `favoriteEntries` is the workspace search index and `onOpenEntry` opens one of its
// entries, both from the host and both optional.
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
      {/* Admins: the business at a glance (This month), then what needs their attention across it. Cleaners, cleaning
          managers and Ready: their day (Today, Tomorrow and Overdue). Everyone else: their own open work. */}
      {admin ? <AdminHome palette={p} desktop={desktop} onTool={onTool} onOpen={openLine} onPlace={openPlace} portfolio={portfolio && { live: portfolio.live, onboarding: portfolio.onboarding }} followUps={followUps} />
        : board ? <TodayBoard palette={p} account={account} properties={properties} work={work} desktop={desktop} onTool={onTool} />
        : <NeedsList palette={p} lines={lines} loading={loading} onOpen={openLine} />}
      {account.role === "ready" && <ReadyHome palette={p} desktop={desktop} onTool={onTool} userId={account.userId} properties={properties} />}
      {account.role === "cleans" && <CleanerMonthCard palette={p} onOpen={() => onTool({ kind: "work", view: "cleans" })} />}
      {/* The places the person starred themselves; the suggestions are in the menu under Favorites. */}
      <HomeFavorites palette={p} account={account} properties={properties} entries={favoriteEntries} onOpenEntry={onOpenEntry} onTool={onTool} onSection={onNavigate} savedOnly />
      {canSearch && <SearchPanel visible={searching} onClose={() => setSearching(false)} palette={p} entries={favoriteEntries} onOpen={onOpenEntry} />}
    </View>
  );
}

// Owners keep the Home they had: their tools, their properties and how they are doing, what needs them,
// and recent activity.
function OwnerLiveHome({ palette: p, desktop, account, snapshot, period, properties, journeys = [], work, notices, loading, onNavigate, onTool }: HomeProps) {
  const tone = todayColors[p.isDark ? "dark" : "light"];
  const today = useMemo(() => snapshot ? todayPresentation(snapshot, period) : null, [snapshot, period]);
  const open = work.filter(item => !isDone(item.status));
  // Waiting first, then the soonest due.
  const attention = [...open].sort((a, b) => Number(isWaitingWork(b.status)) - Number(isWaitingWork(a.status)) || (workDate(a) || "9999").localeCompare(workDate(b) || "9999")).slice(0, 4);
  const names = new Map(properties.map(property => [property.id, property.name]));
  const firstName = account.fullName.trim().split(/\s+/)[0] || "there";
  const items: OverviewItem[] = [
    { key: "properties", icon: "house", value: loading ? null : properties.length, label: "Your properties", hint: "Open properties", onPress: () => onNavigate("properties") },
    { key: "work", icon: "clipboard", value: loading ? null : open.length, label: "Open requests", hint: "Open your work", onPress: () => onNavigate("work") },
    { key: "waiting", icon: "hourglass", value: today ? today.waiting : null, label: "Waiting", hint: "Open your work", onPress: () => onNavigate("work") },
    { key: "updates", icon: "chat", value: loading ? null : unreadNotices(notices).length, label: "Updates", hint: "Open recent activity", onPress: () => onNavigate("activity") },
  ];
  const hero = (
    <Entrance sessionKey={"live:home:hero"} style={desktop ? { flex: 2, minWidth: 0 } : undefined}>
      <View style={{ borderRadius: 30, padding: desktop ? 28 : 20, gap: desktop ? 22 : 18, overflow: "hidden", ...(Platform.OS === "web" ? { boxShadow: "0 30px 60px -32px rgba(16, 39, 31, 0.6)" } : { elevation: 6 }) }}>
        <HeroGlow palette={p} />
        {desktop && <>
          <View style={[ui.between, { gap: 12 }]}>
            <Text style={{ color: tone.heroMuted, fontSize: 12, fontWeight: "700", letterSpacing: 1.2, textTransform: "uppercase", flex: 1 }}>Today at a glance</Text>
            <MotionPress accessibilityRole="button" accessibilityLabel="Open your work" onPress={() => onNavigate("work")} style={[ui.row, { minHeight: 40, gap: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: tone.chipBg, borderWidth: 1, borderColor: tone.heroBorder }]}>
              <Feather name="calendar" size={14} color={tone.heroText} />
              <Text style={{ color: tone.heroText, fontSize: 13, fontWeight: "600" }}>{todayLabel()}</Text>
            </MotionPress>
          </View>
          <View style={{ gap: 6, marginTop: -6 }}>
            <Text accessibilityRole="header" style={[ui.title, { color: tone.heroText, fontSize: 38, lineHeight: 44 }]}>Let&apos;s make progress.</Text>
            <Text style={[ui.body, { color: tone.heroMuted }]}>{OWNER_SUBTITLE}</Text>
          </View>
          <View style={[ui.row, { gap: 18, paddingTop: 4 }]}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: tone.heroMuted, fontSize: 12, fontWeight: "600", letterSpacing: 1.2, textTransform: "uppercase" }}>Open tasks</Text>
              <View style={[ui.row, { gap: 10, alignItems: "flex-end" }]}>
                {today ? <CountUp value={today.open} sessionKey={"live:open:" + period.from + ":" + period.to} style={{ color: tone.heroText, fontSize: 60, lineHeight: 66, fontWeight: "700", letterSpacing: -2.4 }} /> : <Text style={{ color: tone.heroText, fontSize: 60, lineHeight: 66, fontWeight: "700" }} accessibilityLabel="Loading">…</Text>}
                <Text style={{ color: tone.heroMuted, fontSize: 14, lineHeight: 21, paddingBottom: 10 }}>tasks open</Text>
              </View>
              <Text style={{ color: tone.heroMuted, fontSize: 12, lineHeight: 18 }}>{periodLabel(period)}</Text>
            </View>
            {today && <TodayRing palette={p} size={116} motionKey={"live:ring:" + period.from + ":" + period.to} completed={today.current.complete} total={today.current.total} />}
          </View>
        </>}
        {today ? <OpenTasksTrend palette={p} wide={desktop} data={today} motionKey={"live:trend:" + period.to} /> : (
          <View style={{ minHeight: 120, borderRadius: 22, backgroundColor: tone.trendBg, alignItems: "center", justifyContent: "center", padding: 16 }}>
            <Text style={{ color: tone.heroMuted, fontSize: 13 }}>{loading ? "Loading your numbers…" : "Your numbers will appear here."}</Text>
          </View>
        )}
        <MotionPress accessibilityRole="button" accessibilityLabel="Open your work" onPress={() => onNavigate("work")} style={[ui.between, { minHeight: 52, paddingHorizontal: 18, borderRadius: 18, backgroundColor: tone.heroText }]}>
          <Text style={{ color: tone.heroStart, fontSize: 14, fontWeight: "700" }}>View all tasks</Text>
          <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: tone.heroStart }}><Feather name="arrow-right" size={17} color={tone.heroText} /></View>
        </MotionPress>
      </View>
    </Entrance>
  );
  return (
    <>
      {!desktop && <WelcomeHeader palette={p} name={account.fullName || "there"} dateLabel={todayLabel()} subtitle={OWNER_SUBTITLE} onCalendar={() => onNavigate("work")} />}
      {/* Desktop opens on a greeting: the day, the person, and what this page is for. */}
      {desktop && <Entrance sessionKey="live:home:greeting" style={{ gap: 6 }}>
        <Text style={[ui.label, { color: p.primary }]}>{longToday()}</Text>
        <Text accessibilityRole="header" style={[ui.title, { color: p.text, fontSize: 34, lineHeight: 42 }]}>{greeting()}, {firstName}</Text>
        <Text style={[ui.body, { color: p.muted }]}>{OWNER_SUBTITLE}</Text>
      </Entrance>}
      <HomeTools palette={p} account={account} properties={properties} desktop={desktop} onOpen={onTool} onAll={() => onNavigate("help")} />
      <OwnerHome palette={p} desktop={desktop} account={account} properties={properties} journeys={journeys} work={work} loading={loading} onNavigate={onNavigate} />
      <QuickOverview palette={p} items={items} columns={desktop ? 4 : 2} sessionKey={"live:home:overview"} onReports={() => onNavigate("analytics")} />
      {/* The big numbers and the property tile are the owners' picture. */}
      <View style={{ flexDirection: desktop ? "row" : "column", gap: 20, alignItems: "stretch" }}>
        {hero}
        {desktop && today && (
          <TodayTiles vertical data={today} palette={p} onWaiting={() => onNavigate("work")} onProperties={() => onNavigate("properties")}>
            <JumpBackIn palette={p} links={[
              { key: "reports", icon: "chart", title: "Reports", detail: "Trends across your records", onPress: () => onNavigate("analytics") },
              { key: "activity", icon: "chat", title: "Recent activity", detail: "Updates within your access", onPress: () => onNavigate("activity") },
              { key: "help", icon: "compass", title: "Help and training", detail: "Guides for your role", onPress: () => onNavigate("help") },
            ]} />
          </TodayTiles>
        )}
      </View>
      <View style={{ flexDirection: desktop ? "row" : "column", gap: 20, alignItems: "flex-start" }}>
        <Entrance sessionKey={"live:home:attention"} delay={55} style={{ gap: 8, flex: desktop ? 3 : undefined, alignSelf: "stretch", minWidth: 0 }}>
          <View style={ui.between}>
            <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Needs attention</Text>
            <MotionPress accessibilityRole="button" accessibilityLabel="See all work" onPress={() => onNavigate("work")} style={{ minHeight: 44, justifyContent: "center", paddingLeft: 12 }}><Text style={[ui.small, { color: p.primary, fontWeight: "600" }]}>View all</Text></MotionPress>
          </View>
          {attention.length ? (
            <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, paddingVertical: 6, gap: 0 }]}>
              {attention.map(item => <LiveWorkRow key={item.workId} item={item} property={names.get(item.propertyId)} palette={p} onPress={() => onNavigate("work")} />)}
            </View>
          ) : (
            <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, alignItems: "center", paddingVertical: 26 }]}>
              <StateGraphic palette={p} success icon="check-circle" />
              <Text style={[ui.sectionTitle, { color: p.text, textAlign: "center" }]}>{loading ? "Loading your work…" : "You're up to date"}</Text>
              {!loading && <Text style={[ui.body, { color: p.muted, textAlign: "center" }]}>Nothing is waiting on you right now.</Text>}
            </View>
          )}
        </Entrance>
        <Entrance sessionKey={"live:home:activity"} delay={110} style={{ gap: 8, flex: desktop ? 2 : undefined, alignSelf: "stretch", minWidth: 0 }}>
          <View style={ui.between}>
            <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Recent activity</Text>
            <MotionPress accessibilityRole="button" accessibilityLabel="View all recent activity" onPress={() => onNavigate("activity")} style={{ minHeight: 44, justifyContent: "center", paddingLeft: 12 }}><Text style={[ui.small, { color: p.primary, fontWeight: "600" }]}>View all</Text></MotionPress>
          </View>
          <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, paddingVertical: 6, gap: 0 }]}>
            {notices.length ? notices.slice(0, 4).map(notice => <LiveNoticeRow key={notice.id} notice={notice} palette={p} />) : <Text style={[ui.small, { color: p.muted, paddingVertical: 14 }]}>{loading ? "Loading…" : "No updates yet."}</Text>}
          </View>
        </Entrance>
      </View>
      <MotionPress accessibilityRole="button" accessibilityLabel="Help and FAQs" onPress={() => onNavigate("help")} style={[ui.button, { backgroundColor: p.wash }]}>
        <Feather name="help-circle" size={20} color={p.primary} />
        <Text style={[ui.buttonText, { color: p.primary }]}>Help for your role</Text>
        <Feather name="arrow-right" size={18} color={p.primary} />
      </MotionPress>
    </>
  );
}
