import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { ActivityIndicator, Animated, KeyboardAvoidingView, Platform, ScrollView, Switch, View, useWindowDimensions } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import Feather from "@expo/vector-icons/Feather";
import { router, useLocalSearchParams } from "expo-router";
import { z } from "zod";
import { Text } from "./Typography";
import { CompanyLogo } from "./CompanyLogo";
import { Avatar, type Profile } from "./AccountSetup";
import { FeatureTile } from "./Artwork";
import { DesktopNavigation } from "./DesktopNavigation";
import { NavigationBar, type NavigationItem } from "./NavigationBar";
import { FaqShortcut, useFaqShortcut } from "./FaqShortcut";
import { FilterBar } from "./FilterBar";
import { RechargeSplash } from "./RechargeSplash";
import { GreetingCard } from "./WelcomeMoment";
import { Reports } from "./Reports";
import { Sheet } from "./TeamFlows";
import { MotionPress, MotionProvider, Stagger, SwapIn, useMotionPreference, useReducedMotion } from "./motion";
import { headerPalette, themes, ui, type Palette } from "./theme";
import { useThemePreference } from "./usePreviewPreferences";
import { exportReport } from "./exportReport";
import { LiveSignIn } from "./LiveSignIn";
import { LiveHome } from "./LiveHome";
import { LiveWorkRow, isDone, isWaitingWork, workDate } from "./LiveRows";
import { DateRangeSheet, EmptyState, LiveActivity, LiveHelp, LiveProperties, PageHeading, SoftButton, WorkflowSheet, liveApi, message } from "./LivePages";
import { LiveCleans } from "./LiveCleans";
import { LiveRepairs } from "./LiveRepairs";
import { LiveAccounts } from "./LiveAccounts";
import { LiveManagement } from "./LiveManagement";
import { LiveStays } from "./LiveStays";
import { LiveOwner } from "./LiveOwner";
import { OnboardingGate } from "./LiveOnboarding";
import { FurnishingCard, MailboxSection } from "./LiveTools";
import { workViewsFor, type WorkView } from "../../lib/tool-directory";
import { formatBps, formatMoney } from "../../lib/format";
import { liveApiOrigin, restoreAccount, signOut, workspaceRequest, WorkspaceApiError } from "./backend/client";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import type { WorkspaceSection } from "../../lib/workspace-map";
import { isWorkspaceAdmin } from "../../lib/modules";
import { periodError, presetPeriod, type AnalyticsPeriod, type AnalyticsSnapshot } from "../../lib/analytics";
import { invoiceViewSchema, journeyViewSchema, noticeViewSchema, operationViewSchema, propertyViewSchema, readableStage, reportViewSchema, type InvoiceView, type NoticeView, type PropertyView } from "../../lib/workspace-view";
import { workDetails } from "../../lib/work-details";
import { workItemForms, type JourneyView, type OperationView, type WorkflowForm } from "../../lib/workflow-forms";

type Role = WorkspaceAccount["role"];
type IconName = ComponentProps<typeof Feather>["name"];
const WORK_VIEW_LABEL: Record<WorkView, string> = { management: "Management", stays: "Stays", owner: "Stays and statements", cleans: "Cleans", repairs: "Repairs", accounts: "Accounts", all: "All work" };
const SECTIONS: WorkspaceSection[] = ["home", "work", "properties", "analytics", "activity", "help"];
const bookingPolicySchema = z.object({ confirmed: z.boolean(), minimum_nights: z.number(), discount_bps: z.number(), discount_cap_minor: z.number(), version: z.number() });
type BookingPolicy = z.infer<typeof bookingPolicySchema>;
// Direct-booking offers use this discount policy; only a super admin can set and confirm it.
function bookingPolicyForm(policy: BookingPolicy): WorkflowForm {
  return {
    key: "booking-policy-" + policy.version, title: "Direct-booking discount policy", endpoint: "operations",
    description: "Offers to returning guests use these limits. Direct-booking offers stay switched off until the policy is confirmed.",
    fields: [
      { name: "minimumNights", label: "Minimum nights for an offer", type: "number", required: true, defaultValue: String(policy.minimum_nights) },
      { name: "discountPercent", label: "Discount, per cent", type: "number", required: true, defaultValue: String(Math.round(policy.discount_bps / 100)) },
      { name: "discountCapMinor", label: "Largest discount, GBP", type: "money", required: true, defaultValue: (policy.discount_cap_minor / 100).toFixed(2) },
      { name: "confirmed", label: "I confirm this policy for direct-booking offers", type: "checkbox", required: true },
    ],
    build: (values, requestId) => ({ action: "configureBookingPolicy", requestId, version: policy.version, minimumNights: values.minimumNights, discountBps: Number(values.discountPercent) * 100, discountCapMinor: values.discountCapMinor, confirmed: values.confirmed === true }),
  };
}

// The live workspace's destinations for each role. Five items, so the middle one
// is the raised action on phones, as in the redesign.
function liveNavigation(role: Role): NavigationItem[] {
  const item = (value: WorkspaceSection, label: string, icon: NavigationItem["icon"]): NavigationItem => ({ value, label, icon });
  const home = item("home", "Home", "home"), properties = item("properties", "Properties", "key"), reports = item("analytics", "Reports", "bar-chart-2"), activity = item("activity", "Activity", "activity"), help = item("help", "Help", "help-circle");
  if (role === "cleans" || role === "cleaning_manager") return [home, item("work", "Cleans", "check-square"), properties, activity, help];
  if (role === "ready") return [home, item("work", "Repairs", "tool"), properties, activity, help];
  if (role === "accounts") return [home, item("work", "Accounts", "file-text"), properties, reports, activity];
  if (role === "client") return [home, item("work", "Stays", "calendar"), properties, reports, activity];
  return [home, item("work", "Work", "check-square"), properties, reports, activity];
}
const WORK_TITLE: Record<Role, [string, string]> = {
  super_admin: ["Work", "Management, repairs and accounts in one place."], admin: ["Work", "Management, repairs and accounts in one place."],
  stays: ["Your work", "Stays, guests and repairs for your properties."], client: ["Stays and repairs", "Upcoming stays, statements and repairs at your properties."],
  cleans: ["Your cleans", "Today's cleans, checklists and photos."], cleaning_manager: ["Cleans", "Your team's cleans, reviews and schedule."],
  ready: ["Repairs", "Reports, quotes, bookings and routine visits."], accounts: ["Accounts", "Expenses, payouts and owner statements."],
};

function IconButton({ label, icon, onPress, palette: p }: { label: string; icon: IconName; onPress: () => void; palette: Palette }) {
  return (
    <MotionPress accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [ui.iconButton, { borderColor: p.border, backgroundColor: p.surface, opacity: pressed ? 0.65 : 1 }]}>
      <Feather name={icon} size={19} color={p.text} />
    </MotionPress>
  );
}

function Workspace({ account, palette: p, theme, setTheme, onSignedOut, welcomeOnOpen }: { account: WorkspaceAccount; palette: Palette; theme: "light" | "dark"; setTheme: (theme: "light" | "dark", reduced?: boolean) => void; onSignedOut: () => void; welcomeOnOpen: boolean }) {
  const { width } = useWindowDimensions();
  const desktop = width >= 1024;
  const reduced = useReducedMotion(), motionPreference = useMotionPreference(), faqShortcut = useFaqShortcut();
  const { section } = useLocalSearchParams<{ section?: string }>();
  const tab: WorkspaceSection = SECTIONS.includes(section as WorkspaceSection) ? section as WorkspaceSection : "home";
  const setTab = (value: WorkspaceSection) => router.setParams({ section: value });
  const nav = useMemo(() => liveNavigation(account.role), [account.role]);
  const [sidebarHidden, setSidebarHidden] = useState(false), [scrolled, setScrolled] = useState(false), [offline, setOffline] = useState(false), [settings, setSettings] = useState(false);
  const [welcome, setWelcome] = useState<"splash" | "greeting" | null>(welcomeOnOpen ? "splash" : null);
  const [properties, setProperties] = useState<PropertyView[]>([]), [journeys, setJourneys] = useState<JourneyView[]>([]), [work, setWork] = useState<OperationView[]>([]);
  const [invoices, setInvoices] = useState<InvoiceView[]>([]), [notices, setNotices] = useState<NoticeView[]>([]), [policyConfirmed, setPolicyConfirmed] = useState(false), [policy, setPolicy] = useState<BookingPolicy | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [period, setPeriod] = useState<AnalyticsPeriod>(() => presetPeriod(30)), [snapshot, setSnapshot] = useState<AnalyticsSnapshot | null>(null), [reportError, setReportError] = useState(""), [dates, setDates] = useState(false);
  const [exporting, setExporting] = useState(false), [exportMessage, setExportMessage] = useState("");
  const [form, setForm] = useState<WorkflowForm | null>(null), [openWork, setOpenWork] = useState<OperationView | null>(null);
  const [workView, setWorkView] = useState<WorkView | "">(""), [workFilter, setWorkFilter] = useState("Active");
  const [fade] = useState(() => new Animated.Value(1));
  const scroll = useRef<ScrollView>(null);
  const profile: Profile = { displayName: account.fullName || account.email || "Your profile", avatar: "forest" };
  const roleLabel = readableStage(account.role);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const update = () => setOffline(!navigator.onLine); update();
    window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    // Properties and invoices come a page of 100 at a time; read every page.
    const readAll = async (entity: "properties" | "invoices") => {
      const rows: unknown[] = [];
      let cursor = "";
      for (let page = 0; page < 30; page++) {
        const result = await liveApi("/workspace?" + new URLSearchParams({ entity, limit: "100", ...(cursor ? { cursor } : {}) }));
        rows.push(...z.array(z.unknown()).parse(result.data));
        cursor = typeof result.nextCursor === "string" ? result.nextCursor : "";
        if (!cursor) break;
      }
      return { data: rows };
    };
    const jobs = [["properties", ""], ["journeys", "/journeys"], ["work", "/operations"], ["invoices", ""], ["notices", "/portfolio?section=notifications"]] as const;
    const results = await Promise.allSettled(jobs.map(async ([key, path]) => key === "properties" || key === "invoices" ? readAll(key) : liveApi(path)));
    results.forEach((result, i) => {
      const key = jobs[i][0];
      // A failed collection is cleared, including after an assignment is revoked.
      if (result.status === "rejected") {
        if (key === "properties") setProperties([]); if (key === "journeys") setJourneys([]); if (key === "work") setWork([]); if (key === "invoices") setInvoices([]); if (key === "notices") setNotices([]);
        if (result.reason instanceof WorkspaceApiError && result.reason.status === 401) onSignedOut();
        setError(message(result.reason)); return;
      }
      try {
        const data = result.value.data;
        if (key === "properties") setProperties(z.array(propertyViewSchema).parse(data).sort((x, y) => x.name.localeCompare(y.name)));
        if (key === "journeys") setJourneys(z.array(journeyViewSchema).parse(data));
        if (key === "work") setWork(z.array(operationViewSchema).parse(data));
        if (key === "invoices") setInvoices(z.array(invoiceViewSchema).parse(data));
        if (key === "notices") setNotices(z.array(noticeViewSchema).parse(data));
      } catch { setError("Unexpected response. Refresh to try again."); }
    });
    if (isWorkspaceAdmin(account.role) || account.role === "stays") {
      try {
        const value = bookingPolicySchema.parse((await liveApi("/portfolio?section=bookingPolicy")).data);
        setPolicy(value); setPolicyConfirmed(value.confirmed);
      } catch { setPolicy(null); setPolicyConfirmed(false); }
    }
    setLoading(false);
  }, [account.role, onSignedOut]);
  const loadReport = useCallback(async (range: AnalyticsPeriod) => {
    if (periodError(range)) return;
    setReportError("");
    try { setSnapshot(reportViewSchema.parse((await liveApi("/reports?" + new URLSearchParams(range))).data) as AnalyticsSnapshot); }
    catch (e) { setSnapshot(null); setReportError(message(e)); }
  }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void refresh(); }); return () => { active = false; }; }, [refresh]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void loadReport(period); }); return () => { active = false; }; }, [loadReport, period]);

  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
    queueMicrotask(() => setScrolled(false));
    if (reduced) { fade.setValue(1); return; }
    fade.setValue(0);
    const animation = Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: Platform.OS !== "web" });
    animation.start();
    return () => animation.stop();
  }, [tab, fade, reduced]);

  async function logout() {
    setBusy(true);
    try { await signOut(); } catch { /* signed out on this device either way */ }
    try { globalThis.sessionStorage?.removeItem("rc-welcomed"); } catch { /* storage unavailable */ }
    setBusy(false); setSettings(false); onSignedOut();
  }
  async function exportCsv() {
    if (!isWorkspaceAdmin(account.role) || exporting) return;
    setExporting(true); setExportMessage("");
    try {
      const csv = await (await workspaceRequest("/api/mobile/reports/export?" + new URLSearchParams(period))).text();
      await exportReport(csv, "Recharge-report-" + period.from + "-" + period.to + ".csv");
      setExportMessage(Platform.OS === "web" ? "Report download started." : "Report ready to save or share.");
    } catch (e) { setExportMessage(message(e)); } finally { setExporting(false); }
  }
  const finishWelcome = () => { setWelcome(null); try { globalThis.sessionStorage?.setItem("rc-welcomed", "1"); } catch { /* storage unavailable */ } };

  // Work: each role's views, the first opening by default.
  // Every team role also has All work, where each task's steps (onboarding, inspections, invoices, purchases) live.
  const workViews: WorkView[] = workViewsFor(account.role);
  const currentView: WorkView | "" = workViews.includes(workView as WorkView) ? workView as WorkView : (workViews[0] ?? "");
  const names = new Map(properties.map(property => [property.id, property.name]));
  const filtered = work.filter(item => workFilter === "All" || (workFilter === "Completed" ? isDone(item.status) : workFilter === "Waiting" ? isWaitingWork(item.status) : !isDone(item.status)));
  const todayKey = presetPeriod(1).to;
  const workPage = (
    <>
      {workViews.length > 1 && <FilterBar values={workViews.map(view => WORK_VIEW_LABEL[view])} selected={currentView ? WORK_VIEW_LABEL[currentView] : ""} onSelect={label => setWorkView((Object.keys(WORK_VIEW_LABEL) as WorkView[]).find(view => WORK_VIEW_LABEL[view] === label) ?? "")} palette={p} />}
      {currentView === "management" && <LiveManagement palette={p} account={account} />}
      {currentView === "stays" && <LiveStays palette={p} account={account} properties={properties} onOpenRepairs={() => setWorkView("repairs")} onOpenWork={setOpenWork} />}
      {currentView === "owner" && <LiveOwner palette={p} properties={properties} />}
      {currentView === "owner" && account.modules.includes("client-mailbox") && <MailboxSection palette={p} />}
      {currentView === "owner" && account.modules.includes("client-furnishing") && <FurnishingCard palette={p} />}
      {currentView === "cleans" && <LiveCleans palette={p} account={account} properties={properties} />}
      {currentView === "repairs" && <LiveRepairs palette={p} account={account} properties={properties} />}
      {currentView === "accounts" && <LiveAccounts palette={p} account={account} properties={properties} />}
      {currentView === "all" && <>
        <PageHeading palette={p} title="All work" subtitle={WORK_TITLE[account.role][1]} />
        {policy && <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, flexDirection: desktop ? "row" : "column", alignItems: desktop ? "center" : "stretch" }]}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>Direct-booking discount policy</Text>
            <Text style={[ui.small, { color: p.muted }]}>{policy.confirmed ? `Confirmed: ${formatBps(policy.discount_bps)} off, up to ${formatMoney(policy.discount_cap_minor)}, for stays of ${policy.minimum_nights} nights or more.` : "Not confirmed yet, so direct-booking offers can't be prepared."}</Text>
          </View>
          {account.role === "super_admin" && <SoftButton label={policy.confirmed ? "Change policy" : "Review and confirm"} icon="check" primary={!policy.confirmed} palette={p} onPress={() => setForm(bookingPolicyForm(policy))} />}
        </View>}
        <FilterBar values={["Active", "Waiting", "Completed", "All"]} selected={workFilter} onSelect={setWorkFilter} palette={p} />
        <Text accessibilityLiveRegion="polite" style={[ui.small, { color: p.muted }]}>{filtered.length} {filtered.length === 1 ? "item" : "items"} within your access</Text>
        {filtered.length ? (() => {
          const due = workFilter === "Active" ? filtered.filter(item => (workDate(item) || "9999") <= todayKey) : [], rest = workFilter === "Active" ? filtered.filter(item => (workDate(item) || "9999") > todayKey) : filtered;
          const list = (items: OperationView[]) => <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, paddingVertical: 6, gap: 0 }]}>{items.slice(0, 200).map((item, i) => <Stagger key={item.workId} index={i}><LiveWorkRow item={item} property={names.get(item.propertyId)} palette={p} onPress={() => setOpenWork(item)} /></Stagger>)}</View>;
          return <>
            {!!due.length && <View style={{ gap: 8 }}><Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>Due today or overdue · {due.length}</Text>{list(due)}</View>}
            {!!rest.length && <View style={{ gap: 8 }}>{workFilter === "Active" && <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>Ongoing · {rest.length}</Text>}{list(rest)}</View>}
          </>;
        })() : <EmptyState palette={p} title={loading ? "Loading your work…" : "No work in this view"} detail="Try another status, or create work from a property." />}
      </>}
    </>
  );
  const reportsPage = (
    <>
      {snapshot ? <Reports snapshot={snapshot} period={period} role={account.role} palette={p} onDates={() => setDates(true)} onExport={() => void exportCsv()} exporting={exporting} exportMessage={exportMessage} /> : (
        <><PageHeading palette={p} title="Reports" subtitle="Trends across the records within your access." />{reportError ? <View style={{ gap: 12 }}><EmptyState palette={p} icon="activity" title="Reports could not be loaded" detail={reportError} /><SoftButton label="Try again" icon="refresh-cw" palette={p} onPress={() => void loadReport(period)} /></View> : <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, alignItems: "center", paddingVertical: 30 }]}><ActivityIndicator color={p.primary} /><Text style={[ui.small, { color: p.muted }]}>Loading your reports…</Text></View>}</>
      )}
      {(isWorkspaceAdmin(account.role) || account.role === "accounts") && !!invoices.length && <View style={{ gap: 10 }}>
        <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Invoices</Text>
        <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, paddingVertical: 4, gap: 0 }]}>
          {invoices.map((invoice, i) => (
            <View key={invoice.id} style={[ui.between, { gap: 12, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderColor: p.border }]}>
              <View style={{ flex: 1, gap: 2 }}><Text style={{ color: p.text, fontWeight: "600" }}>{invoice.reference}</Text><Text style={[ui.small, { color: p.muted }]}>{names.get(invoice.property_id) ?? "Property"} · {invoice.currency === "GBP" ? formatMoney(invoice.amount_minor) : `${invoice.currency} ${(invoice.amount_minor / 100).toFixed(2)}`} · {readableStage(invoice.status)}</Text></View>
              {invoice.status === "issued" && <MotionPress accessibilityRole="button" onPress={() => setForm({ key: "settle-" + invoice.id, title: "Confirm verified invoice payment", description: "Only confirm after checking the payment has actually settled.", endpoint: "workspace", fields: [{ name: "verified", label: "I have verified this invoice payment has settled", type: "checkbox", required: true }], build: () => ({ action: "setInvoiceStatus", invoiceId: invoice.id, version: invoice.version, status: "paid" }) })} style={[ui.button, { backgroundColor: p.wash, minHeight: 40 }]}><Text style={[ui.small, { color: p.primary, fontWeight: "700" }]}>Record payment</Text></MotionPress>}
            </View>
          ))}
        </View>
      </View>}
    </>
  );
  const page = tab === "home"
    ? <LiveHome palette={p} desktop={desktop} account={account} snapshot={snapshot} period={period} properties={properties} journeys={journeys} work={work} notices={notices} loading={loading} onNavigate={setTab} />
    : tab === "work" ? workPage
    : tab === "properties" ? <LiveProperties palette={p} desktop={desktop} account={account} properties={properties} journeys={journeys} work={work} invoices={invoices} period={period} loading={loading} onForm={setForm} onOpenWork={setOpenWork} onRefresh={() => void refresh()} />
    : tab === "analytics" ? reportsPage
    : tab === "activity" ? <LiveActivity palette={p} notices={notices} loading={loading} />
    : <LiveHelp palette={p} account={account} properties={properties} busy={busy} onSignOut={() => void logout()} onOpen={(next, view) => { setTab(next); if (view) setWorkView(view); }} />;
  // Tabs already fade in; switching between Work views (Cleans, Repairs, All work…) slides the new view in too.
  const animatedPage = <SwapIn swapKey={tab === "work" ? "work:" + currentView : "page"} style={{ gap: 24 }}>{page}</SwapIn>;
  const header = headerPalette(p);
  const title = nav.find(item => item.value === tab)?.label ?? (tab === "help" ? "Help" : tab === "activity" ? "Activity" : "Home");
  return (
    <SafeAreaView style={[ui.fill, { backgroundColor: p.background }]} edges={["top", "bottom"]}>
      <StatusBar style={theme === "dark" ? "light" : "dark"} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[ui.fill, { flexDirection: "row" }]}>
        {desktop && !sidebarHidden && <DesktopNavigation role={account.role} items={nav} section={tab} palette={p} onNavigate={setTab} onProfile={() => setSettings(true)} onCollapse={() => setSidebarHidden(true)} profileDetail="Theme, motion and sign out" />}
        {desktop && sidebarHidden && <View style={{ width: 64, backgroundColor: p.isDark ? p.surface : p.background, borderRightWidth: 1, borderColor: p.border }}><View style={{ height: 81, alignItems: "center", justifyContent: "center", backgroundColor: p.header }}><IconButton label="Show left panel" icon="chevrons-right" palette={header} onPress={() => setSidebarHidden(false)} /></View></View>}
        <View style={[ui.fill, { minWidth: 0 }]}>
          {offline && <View accessibilityRole="alert" style={{ backgroundColor: p.cautionWash, padding: 12 }}><Text style={[ui.small, { color: p.text }]}>You are offline. Changes will fail until you reconnect.</Text></View>}
          <View testID="workspace-toolbar" style={{ backgroundColor: p.header, borderBottomWidth: 1, borderColor: scrolled ? p.headerBorder : p.isDark && desktop ? p.border : "transparent" }}>
            <View style={[ui.between, { width: "100%", maxWidth: desktop ? undefined : 760, alignSelf: "center", paddingHorizontal: 20, paddingVertical: 16, gap: 12 }]}>
              <View style={[ui.row, { flex: 1, minWidth: 0, gap: 16 }]}>
                {desktop && sidebarHidden && <CompanyLogo palette={header} width={144} />}
                {desktop ? <Text style={{ color: p.headerText, fontSize: 16, fontWeight: "600", flexShrink: 1 }}>{title}</Text> : <CompanyLogo palette={header} width={width < 360 ? 104 : 144} />}
              </View>
              <View style={[ui.row, { gap: 8 }]}>
                <IconButton label={loading ? "Refreshing" : "Refresh"} icon="refresh-cw" palette={header} onPress={() => { void refresh(); void loadReport(period); }} />
                <IconButton label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} icon={theme === "dark" ? "sun" : "moon"} palette={header} onPress={() => setTheme(theme === "dark" ? "light" : "dark", reduced)} />
                <MotionPress accessibilityRole="button" accessibilityLabel={`Open profile and preferences, ${roleLabel}`} onPress={() => setSettings(true)} style={{ minHeight: 48, minWidth: 44, flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: desktop ? 14 : 0, borderRadius: 999, backgroundColor: desktop ? p.headerControl : "transparent", borderWidth: desktop ? 1 : 0, borderColor: p.headerBorder }}>
                  {desktop && <View style={{ maxWidth: 180 }}><Text numberOfLines={1} style={{ color: p.headerText, fontSize: 14, fontWeight: "600" }}>{profile.displayName}</Text><Text numberOfLines={1} style={{ color: p.headerMuted, fontSize: 11 }}>{roleLabel}</Text></View>}
                  <Avatar profile={profile} backgroundColor={desktop ? undefined : p.headerControl} textColor={desktop ? "#FFFFFF" : p.headerControlText} />
                </MotionPress>
              </View>
            </View>
          </View>
          <ScrollView ref={scroll} testID="workspace-scroll" style={ui.fill} contentContainerStyle={[ui.page, { maxWidth: desktop ? 1400 : 760 }]} onScroll={event => setScrolled(event.nativeEvent.contentOffset.y > 12)} scrollEventThrottle={32} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={Platform.OS === "web"}>
            <Animated.View style={{ opacity: fade, gap: 24, transform: desktop ? [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] : [{ translateX: fade.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }}>
              {animatedPage}
              {!!error && <View accessibilityRole="alert" style={[ui.row, { gap: 10, padding: 12, borderRadius: 14, backgroundColor: p.cautionWash }]}><Feather name="alert-circle" size={16} color={p.waiting} /><Text style={[ui.small, { color: p.text, flex: 1 }]}>{error}</Text><MotionPress accessibilityRole="button" onPress={() => void refresh()} style={{ minHeight: 36, justifyContent: "center" }}><Text style={[ui.small, { color: p.primary, fontWeight: "700" }]}>Try again</Text></MotionPress></View>}
            </Animated.View>
          </ScrollView>
          {!faqShortcut.hidden && tab !== "help" && <FaqShortcut palette={p} onOpen={() => setTab("help")} onHide={() => faqShortcut.setHidden(true)} />}
          {!desktop && <NavigationBar role={account.role} items={nav} section={tab} onNavigate={setTab} palette={p} />}
        </View>
      </KeyboardAvoidingView>
      <Sheet palette={p} visible={settings} onClose={() => setSettings(false)} title="Profile & preferences" subtitle="Your account and comfort settings" icon="people">
        <View style={{ borderRadius: 22, padding: 18, gap: 6, backgroundColor: p.header, overflow: "hidden" }}>
          <View style={[ui.row, { gap: 14 }]}>
            <Avatar profile={profile} size={56} backgroundColor={p.headerControl} textColor={p.headerControlText} />
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
              <Text numberOfLines={1} style={{ color: p.headerText, fontSize: 18, fontWeight: "700", letterSpacing: -0.4 }}>{profile.displayName}</Text>
              <Text numberOfLines={1} style={{ color: p.headerMuted, fontSize: 13 }}>{roleLabel}{account.email ? " · " + account.email : ""}</Text>
            </View>
          </View>
        </View>
        <View style={{ gap: 8 }}>
          <Text style={{ color: p.muted, fontSize: 11, fontWeight: "600", letterSpacing: 1.4, textTransform: "uppercase" }}>Comfort</Text>
          <View style={{ borderRadius: 20, borderWidth: 1, borderColor: p.border, backgroundColor: p.background }}>
            <View style={[ui.between, { gap: 16, minHeight: 64, paddingHorizontal: 16, paddingVertical: 12 }]}>
              <FeatureTile icon={theme === "dark" ? "moon" : "sun"} size={36} palette={p} />
              <View style={{ flex: 1, gap: 2 }}><Text style={[ui.body, { color: p.text, fontWeight: "600" }]}>Dark mode</Text><Text style={[ui.small, { color: p.muted }]}>Easier on the eyes at night.</Text></View>
              <Switch accessibilityLabel="Dark mode" value={theme === "dark"} onValueChange={value => setTheme(value ? "dark" : "light", reduced)} trackColor={{ false: p.controlBorder, true: p.primary }} thumbColor={p.surface} />
            </View>
            <View style={{ height: 1, backgroundColor: p.border, marginLeft: 68 }} />
            <View style={[ui.between, { gap: 16, minHeight: 64, paddingHorizontal: 16, paddingVertical: 12 }]}>
              <FeatureTile icon="wind" size={36} palette={p} />
              <View style={{ flex: 1, gap: 2 }}><Text style={[ui.body, { color: p.text, fontWeight: "600" }]}>Reduce motion</Text><Text style={[ui.small, { color: p.muted }]}>{motionPreference.system ? "Your device setting is respected." : "Use instant changes instead of decorative animation."}</Text></View>
              <Switch accessibilityLabel="Reduce motion" value={reduced} disabled={motionPreference.system} onValueChange={motionPreference.setPreference} trackColor={{ false: p.controlBorder, true: p.primary }} thumbColor={p.surface} />
            </View>
            <View style={{ height: 1, backgroundColor: p.border, marginLeft: 68 }} />
            <View style={[ui.between, { gap: 16, minHeight: 64, paddingHorizontal: 16, paddingVertical: 12 }]}>
              <FeatureTile icon="help-circle" size={36} palette={p} />
              <View style={{ flex: 1, gap: 2 }}><Text style={[ui.body, { color: p.text, fontWeight: "600" }]}>Show FAQ shortcut</Text><Text style={[ui.small, { color: p.muted }]}>A Help button in the corner of every page.</Text></View>
              <Switch accessibilityLabel="Show FAQ shortcut" value={!faqShortcut.hidden} onValueChange={value => faqShortcut.setHidden(!value)} trackColor={{ false: p.controlBorder, true: p.primary }} thumbColor={p.surface} />
            </View>
          </View>
        </View>
        <SoftButton label="Your tools, help and training" icon="arrow-right" palette={p} onPress={() => { setSettings(false); setTab("help"); }} />
        <SoftButton label={busy ? "Signing out…" : "Sign out"} icon="log-out" palette={p} disabled={busy} onPress={() => void logout()} />
      </Sheet>
      <WorkflowSheet spec={form} invoices={invoices} palette={p} onClose={() => setForm(null)} onSaved={refresh} />
      <Sheet palette={p} visible={!!openWork} onClose={() => setOpenWork(null)} title={openWork?.title ?? ""} subtitle={openWork ? [names.get(openWork.propertyId), readableStage(openWork.status)].filter(Boolean).join(" · ") : undefined} icon="clipboard">
        {openWork && <>
          {workDetails(openWork).map(d => <View key={d.label} style={{ gap: 4 }}><Text style={{ color: p.muted, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 1 }}>{d.label}</Text><Text selectable style={[ui.body, { color: d.tone === "bad" ? p.danger : d.tone === "good" ? p.success : p.text, fontWeight: d.tone ? "700" : "400" }]}>{d.value}</Text></View>)}
          {openWork.kind === "direct_booking" && openWork.data.phase === "follow_up" && policy?.confirmed && <Text style={[ui.small, { color: p.muted }]}>Offer the guest {formatBps(policy.discount_bps).replace(".0%", "%")} off, up to {formatMoney(policy.discount_cap_minor)} off. The offer price is worked out when you prepare it.</Text>}
          {!!workDate(openWork) && <Text style={[ui.body, { color: p.text }]}>Due {new Date(workDate(openWork) + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}</Text>}
          {openWork.data.estimatedCostMinor !== undefined && <Text style={[ui.body, { color: p.text }]}>Estimated cost: {formatMoney(Number(openWork.data.estimatedCostMinor))}</Text>}
          {workItemForms(account, openWork, journeys, work).map(f => <SoftButton key={f.key} label={f.title} icon="arrow-right" palette={p} disabled={f.key === "prepareQuote" && !policyConfirmed} onPress={() => { setOpenWork(null); setForm(f); }} />)}
          {openWork.kind === "direct_booking" && !policyConfirmed && <Text style={[ui.small, { color: p.muted }]}>The discount policy awaits confirmation.</Text>}
          {!workItemForms(account, openWork, journeys, work).length && <Text style={[ui.small, { color: p.muted }]}>Nothing needs your action on this item.</Text>}
        </>}
      </Sheet>
      <DateRangeSheet key={period.from + period.to + String(dates)} palette={p} visible={dates} period={period} onClose={() => setDates(false)} onApply={range => { setDates(false); setPeriod(range); setSnapshot(null); }} />
      {welcome === "splash" && <RechargeSplash palette={p} onDone={() => setWelcome("greeting")} />}
      {welcome === "greeting" && <GreetingCard palette={p} profile={profile} openTasks={work.filter(item => !isDone(item.status)).length} waiting={work.filter(item => isWaitingWork(item.status)).length} onClose={finishWelcome} onWork={() => { finishWelcome(); setTab("work"); }} />}
    </SafeAreaView>
  );
}

function Screen() {
  const { theme, setTheme } = useThemePreference();
  const p = themes[theme];
  const [account, setAccount] = useState<WorkspaceAccount | null>(null), [checking, setChecking] = useState(true), [error, setError] = useState(""), [welcome, setWelcome] = useState(false);
  useEffect(() => {
    let active = true;
    if (!liveApiOrigin()) { queueMicrotask(() => { if (active) setChecking(false); }); return () => { active = false; }; }
    restoreAccount().then(value => {
      if (!active) return;
      let welcomed = false;
      try { welcomed = Boolean(globalThis.sessionStorage?.getItem("rc-welcomed")); } catch { welcomed = false; }
      setWelcome(!welcomed); setAccount(value);
    }).catch(e => { if (active && !(e instanceof WorkspaceApiError && e.status === 401)) setError(message(e)); }).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);
  const signedOut = useCallback(() => setAccount(null), []);
  if (checking) return <View style={[ui.fill, { backgroundColor: p.header, alignItems: "center", justifyContent: "center", gap: 20 }]}><CompanyLogo palette={headerPalette(p)} width={180} /><ActivityIndicator accessibilityLabel="Restoring your session" color={p.headerText} /></View>;
  if (!liveApiOrigin()) return <View style={[ui.fill, { backgroundColor: p.background, padding: 24, justifyContent: "center" }]}><EmptyState palette={p} icon="inbox" title="Live connection is awaiting configuration" detail="The backend address will be added to the app when deployment is ready." /></View>;
  if (!account) return <SafeAreaView style={[ui.fill, { backgroundColor: p.background }]} edges={["top", "bottom"]}><StatusBar style="light" /><LiveSignIn palette={p} onTheme={() => setTheme(theme === "dark" ? "light" : "dark")} onSignedIn={value => { setWelcome(true); setAccount(value); }} />{!!error && <Text accessibilityRole="alert" style={[ui.small, { color: p.danger, textAlign: "center", padding: 12 }]}>{error}</Text>}</SafeAreaView>;
  if (account.status !== "active") return <View style={[ui.fill, { backgroundColor: p.background, padding: 24, justifyContent: "center", gap: 16 }]}><EmptyState palette={p} icon="inbox" title={account.status === "pending" ? "Your access is being reviewed" : "Your access has been removed"} detail={account.status === "pending" ? "An administrator will approve your account and choose your tools. You'll then see your workspace here." : "Ask an administrator if you think this is a mistake."} /><SoftButton label="Sign out" icon="log-out" palette={p} onPress={() => { void signOut().finally(() => setAccount(null)); }} /></View>;
  // New team members sign their contract and finish required training first.
  return (
    <OnboardingGate key={account.userId} account={account} palette={p} onSignOut={() => { void signOut().finally(() => setAccount(null)); }}>
      <Workspace account={account} palette={p} theme={theme} setTheme={setTheme} onSignedOut={signedOut} welcomeOnOpen={welcome} />
    </OnboardingGate>
  );
}

export default function LiveWorkspace() {
  return <SafeAreaProvider><MotionProvider><Screen /></MotionProvider></SafeAreaProvider>;
}
