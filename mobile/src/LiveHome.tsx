import { useMemo } from "react";
import { Platform, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { JumpBackIn, QuickOverview, WelcomeHeader, type OverviewItem } from "./HomeOverview";
import { HeroGlow, OpenTasksTrend, TodayRing, TodayTiles } from "./TodayAnalytics";
import { CountUp, Entrance, MotionPress } from "./motion";
import { StateGraphic } from "./StateGraphic";
import { followUpsDue } from "../../lib/portfolio-overview";
import { ShiftCard } from "./LiveShifts";
import { CleanerMonthCard } from "./CleanerPay";
import { HomeTools } from "./HomeTools";
import { ReadyHome } from "./ReadyHome";
import type { HomeToolTarget } from "../../lib/home-tools";
import { ui, type Palette } from "./theme";
import { LiveNoticeRow, LiveWorkRow, isDone, isWaitingWork, workDate } from "./LiveRows";
import { todayColors, todayPresentation } from "../../lib/today-presentation";
import { periodLabel, type AnalyticsPeriod, type AnalyticsSnapshot } from "../../lib/analytics";
import type { WorkspaceSection } from "../../lib/workspace-map";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import type { NoticeView, PropertyView } from "../../lib/workspace-view";
import type { JourneyView, OperationView } from "../../lib/workflow-forms";

const SUBTITLE: Record<WorkspaceAccount["role"], string> = {
  super_admin: "Here is what needs you across the business today.",
  admin: "Here is what needs you across the business today.",
  stays: "Your guests, listings and bookings at a glance.",
  ready: "Your inspections, repairs and orders for today.",
  cleans: "Your cleans, schedule and updates in one place.",
  cleaning_manager: "Your team's cleans and quality checks today.",
  client: "Here is how your properties are doing today.",
  accounts: "Invoices to approve and owner statements to send.",
};
const WORK_LABEL: Partial<Record<WorkspaceAccount["role"], string>> = { cleans: "Cleans to do", cleaning_manager: "Cleans to do", ready: "Repairs open", accounts: "Open items", client: "Open requests" };
const greeting = () => { const hour = new Date().getHours(); return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"; };
const londonToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
const todayLabel = () => new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" });

export function LiveHome({ palette: p, desktop, account, snapshot, period, properties, journeys = [], work, notices, loading, onNavigate, onTool }: {
  palette: Palette; desktop: boolean; account: WorkspaceAccount; snapshot: AnalyticsSnapshot | null; period: AnalyticsPeriod;
  properties: PropertyView[]; journeys?: JourneyView[]; work: OperationView[]; notices: NoticeView[]; loading: boolean; onNavigate: (section: WorkspaceSection) => void; onTool: (target: HomeToolTarget) => void;
}) {
  // Clients who asked for more time, whose check-in date has arrived (onboarding team only).
  const followUps = account.role !== "client" && account.modules.includes("property-onboarding") ? followUpsDue(journeys, properties, londonToday()) : [];
  const tone = todayColors[p.isDark ? "dark" : "light"];
  const today = useMemo(() => snapshot ? todayPresentation(snapshot, period) : null, [snapshot, period]);
  const open = work.filter(item => !isDone(item.status));
  // Waiting first, then the soonest due.
  const attention = [...open].sort((a, b) => Number(isWaitingWork(b.status)) - Number(isWaitingWork(a.status)) || (workDate(a) || "9999").localeCompare(workDate(b) || "9999")).slice(0, 4);
  const names = new Map(properties.map(property => [property.id, property.name]));
  const firstName = account.fullName.trim().split(/\s+/)[0] || "there";
  const items: OverviewItem[] = [
    { key: "properties", icon: "house", value: loading ? null : properties.length, label: account.role === "client" ? "Your properties" : "Properties", hint: "Open properties", onPress: () => onNavigate("properties") },
    { key: "work", icon: "clipboard", value: loading ? null : open.length, label: WORK_LABEL[account.role] ?? "Open work", hint: "Open your work", onPress: () => onNavigate("work") },
    { key: "waiting", icon: "hourglass", value: today ? today.waiting : null, label: "Waiting", hint: "Open your work", onPress: () => onNavigate("work") },
    { key: "updates", icon: "chat", value: loading ? null : notices.length, label: "Updates", hint: "Open recent activity", onPress: () => onNavigate("activity") },
  ];
  const hero = (
    <Entrance sessionKey={"live:home:hero"} style={desktop ? { flex: 2, minWidth: 0 } : undefined}>
      <View style={{ borderRadius: 30, padding: desktop ? 28 : 20, gap: desktop ? 22 : 18, overflow: "hidden", ...(Platform.OS === "web" ? { boxShadow: "0 30px 60px -32px rgba(16, 39, 31, 0.6)" } : { elevation: 6 }) }}>
        <HeroGlow palette={p} />
        {desktop && <>
          <View style={[ui.between, { gap: 12 }]}>
            <Text style={{ color: tone.heroMuted, fontSize: 13, fontWeight: "500", flex: 1 }}>{greeting()}, {firstName}</Text>
            <MotionPress accessibilityRole="button" accessibilityLabel="Open your work" onPress={() => onNavigate("work")} style={[ui.row, { minHeight: 40, gap: 7, paddingHorizontal: 12, borderRadius: 999, backgroundColor: tone.chipBg, borderWidth: 1, borderColor: tone.heroBorder }]}>
              <Feather name="calendar" size={14} color={tone.heroText} />
              <Text style={{ color: tone.heroText, fontSize: 13, fontWeight: "600" }}>{todayLabel()}</Text>
            </MotionPress>
          </View>
          <View style={{ gap: 6, marginTop: -6 }}>
            <Text accessibilityRole="header" style={[ui.title, { color: tone.heroText, fontSize: 38, lineHeight: 44 }]}>Let&apos;s make progress.</Text>
            <Text style={[ui.body, { color: tone.heroMuted }]}>{SUBTITLE[account.role]}</Text>
          </View>
          <View style={[ui.row, { gap: 18, paddingTop: 4 }]}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={{ color: tone.heroMuted, fontSize: 12, fontWeight: "600", letterSpacing: 1.2, textTransform: "uppercase" }}>Open tasks</Text>
              <View style={[ui.row, { gap: 10, alignItems: "flex-end" }]}>
                {today ? <CountUp value={today.open} sessionKey={"live:open:" + period.from + ":" + period.to} style={{ color: tone.heroText, fontSize: 60, lineHeight: 66, fontWeight: "700", letterSpacing: -2.4 }} /> : <Text style={{ color: tone.heroText, fontSize: 60, lineHeight: 66, fontWeight: "700" }}>—</Text>}
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
      {!desktop && <WelcomeHeader palette={p} name={account.fullName || "there"} dateLabel={todayLabel()} subtitle={SUBTITLE[account.role]} onCalendar={() => onNavigate("work")} />}
      {/* The tools for this person's role come first, so nobody has to look for them. */}
      <HomeTools palette={p} account={account} properties={properties} desktop={desktop} onOpen={onTool} onAll={() => onNavigate("help")} />
      {account.role === "cleans" && <CleanerMonthCard palette={p} onOpen={() => onTool({ kind: "work", view: "cleans" })} />}
      {account.role === "ready" && <ReadyHome palette={p} desktop={desktop} onTool={onTool} />}
      {account.role !== "client" && <ShiftCard palette={p} account={account} />}
      {!!followUps.length && <Entrance sessionKey={"live:home:followups"} style={{ gap: 8 }}>
        <View style={ui.between}>
          <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Client check-ins due</Text>
          <Text style={[ui.small, { color: p.muted }]}>{followUps.length} waiting</Text>
        </View>
        <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, paddingVertical: 6, gap: 0 }]}>
          {followUps.slice(0, 5).map((f, i) => (
            <MotionPress key={f.propertyId} accessibilityRole="button" accessibilityLabel={`Check in on ${f.propertyName}`} onPress={() => onNavigate("properties")}
              style={[ui.row, { gap: 12, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderColor: p.border }]}>
              <View style={{ width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: p.cautionWash }}><Feather name="phone-call" size={18} color={p.waiting} /></View>
              <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
                <Text numberOfLines={1} style={{ color: p.text, fontSize: 15, fontWeight: "600" }}>{f.propertyName}</Text>
                <Text numberOfLines={2} style={[ui.small, { color: p.muted }]}>{f.overdueDays ? `Check-in was due ${f.overdueDays} day${f.overdueDays === 1 ? "" : "s"} ago` : "Check in today"}: the client asked for more time on their estimate{f.feedback ? ` (“${f.feedback}”)` : ""}.</Text>
              </View>
              <Feather name="chevron-right" size={18} color={p.muted} />
            </MotionPress>
          ))}
        </View>
      </Entrance>}
      <QuickOverview palette={p} items={items} columns={desktop ? 4 : 2} sessionKey={"live:home:overview"} onReports={() => onNavigate("analytics")} />
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
