import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import { ActivityIndicator, Animated, AppState, KeyboardAvoidingView, Platform, ScrollView, Switch, View, useWindowDimensions } from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import Feather from "@expo/vector-icons/Feather";
import { router, useLocalSearchParams } from "expo-router";
import { z } from "zod";
import { Text } from "./Typography";
import { ListSearchBox, SearchBox, useListSearch } from "./SearchPicker";
import { normalise } from "../../lib/search-options";
import { CompanyLogo } from "./CompanyLogo";
import { Avatar, type Profile } from "./AccountSetup";
import { FeatureTile } from "./Artwork";
import { RoleNavigation } from "./RoleNavigation";
import { rolePanel, type PanelLink } from "../../lib/role-panel";
import { NavigationBar, type NavigationItem } from "./NavigationBar";
import { FaqShortcut, useFaqShortcut } from "./FaqShortcut";
import { FilterBar } from "./FilterBar";
import { RechargeSplash } from "./RechargeSplash";
import { GreetingCard } from "./WelcomeMoment";
import { Reports } from "./Reports";
import { Sheet } from "./TeamFlows";
import { MotionPress, MotionProvider, Stagger, SwapIn, useMotionPreference, useReducedMotion } from "./motion";
import { headerPalette, themes, ui, web, type Palette } from "./theme";
import { useThemePreference } from "./usePreviewPreferences";
import { exportReport } from "./exportReport";
import { LiveSignIn } from "./LiveSignIn";
import { LiveHome } from "./LiveHome";
import { LiveWorkRow, isDone, isWaitingWork, workDate } from "./LiveRows";
import { LiveHub } from "./LiveHub";
import { DateRangeSheet, EmptyState, LiveActivity, LiveHelp, LiveProperties, PageHeading, SoftButton, WorkflowSheet, liveApi, message } from "./LivePages";
import { LiveCleans } from "./LiveCleans";
import { LiveRepairs } from "./LiveRepairs";
import { LiveAccounts } from "./LiveAccounts";
import { LiveManagement } from "./LiveManagement";
import { LiveStays } from "./LiveStays";
import { OnboardingGate } from "./LiveOnboarding";
import { PropertyAccess } from "./LiveTools";
import { ROLE_LABEL } from "../../lib/admin-live";
import { WORK_VIEW_LABEL, workViewsFor, type WorkView } from "../../lib/tool-directory";
import { formatBps, formatMoney } from "../../lib/format";
import { liveApiOrigin, readChat, readTeams, restoreAccount, signOut, workspaceRequest, WorkspaceApiError } from "./backend/client";
import { workspaceAccountSchema, type WorkspaceAccount } from "../../lib/workspace-account-policy";
import { ownerNavigation, type WorkspaceSection } from "../../lib/workspace-map";
import { isWorkspaceAdmin } from "../../lib/modules";
import { periodError, presetPeriod, type AnalyticsPeriod, type AnalyticsSnapshot } from "../../lib/analytics";
import { invoiceViewSchema, journeyViewSchema, noticeViewSchema, operationViewSchema, propertyViewSchema, readableStage, reportViewSchema, type InvoiceView, type NoticeView, type PropertyView } from "../../lib/workspace-view";
import { workDetails } from "../../lib/work-details";
import { AccountsWork } from "./LiveAccountsWork";
import { CelebrateProvider } from "./Celebrate";
import { Anchor, AnchorRegistry, WorkFocusContext, dayLabel, type WorkFocus } from "./LiveKit";
import type { HomeToolTarget } from "../../lib/home-tools";
import { budgetChartSchema, type BudgetItem } from "../../lib/accounts-work";
import { inspectionReportFrom, workItemForms, type JourneyView, type OperationView, type WorkflowForm } from "../../lib/workflow-forms";
import { WorkPhotos } from "./Photos";
import { SignOutUploadsWarning, UploadBanner } from "./UploadStatus";
import { pendingUploadCount } from "./uploadQueue";
import { NotificationsSetting, refreshNotificationLink, unlinkNotifications } from "./Notifications";
import { LiveChat, useGuestWaiting } from "./LiveChat";
import { LiveCalendar } from "./LiveCalendar";
import { OpenMessagesContext } from "./PropertyTeamChat";
import { LiveApprovals } from "./LiveApprovals";
import { LiveClientReports } from "./LiveClientReports";
import { OwnerActions } from "./LiveOwnerHome";
import { DeleteAccountButton, DeleteAccountSheet, PrivacySection } from "./LivePrivacy";
import { ACCOUNT_DELETED } from "../../lib/privacy-policy";
import { PriceNightsLink, WorkHistory } from "./WorkHistory";
import { WorkJumpContext } from "./WorkJump";
import { FavoritesPage, FavoritesShortcut, HeaderSearch, SearchPanel } from "./WorkspaceSearch";
import { FavoriteButton, FavoritesContext, useFavoritesStore } from "./Favorites";
import { TrackerSheet } from "./LiveTools";
import { FurnishingSheet } from "./LiveFurnishing";
import { buildSearchIndex, type SearchEntry } from "../../lib/workspace-search";
import { toolsFor, type Tool } from "../../lib/tool-directory";
import { canViewAs, previewAccount, previewKeeps, readSavedView, viewAsKey, viewAsLabel, viewAsName, viewOnlyMessage, VIEW_AS_ENDED, type ViewAs } from "../../lib/view-as";
import { loadDemoData, setDemo, setViewOnly, startViewAs, stopViewAs } from "./backend/client";
import { ViewAsBanner, ViewAsSheet } from "./ViewAs";
import { DemoBanner, DemoSwitchRow, DemoSwitching, ModeSwitch } from "./DemoMode";
import { DEMO_SAVE_MESSAGE, type DemoData, type DemoRole } from "../../lib/demo-data";
import { STAFF_ROLES } from "./LiveOnboarding";
import { onboardingSchema } from "../../lib/management-live";

type Role = WorkspaceAccount["role"];
type IconName = ComponentProps<typeof Feather>["name"];
const SECTIONS: WorkspaceSection[] = ["home", "work", "properties", "analytics", "activity", "help", "inbox", "approvals", "statements", "favorites"];
// Pages only some roles have.
const ROLE_SECTIONS: Partial<Record<WorkspaceSection, Role[]>> = { approvals: ["client"], statements: ["accounts", "admin", "super_admin"], favorites: ["super_admin", "admin", "stays", "cleans", "cleaning_manager", "ready", "accounts"] };
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

// The live workspace's bottom bar on phones for each role: five items, the middle one the raised
// action. (Favorites is a floating button next to Help there; desktop has the role's left panel.)
function liveNavigation(role: Role): NavigationItem[] {
  const item = (value: WorkspaceSection, label: string, icon: NavigationItem["icon"]): NavigationItem => ({ value, label, icon });
  const home = item("home", "Home", "home"), properties = item("properties", "Properties", "key"), reports = item("analytics", "Reports", "bar-chart-2"), activity = item("activity", "Activity", "activity"), help = item("help", "Help", "help-circle");
  // Owners: messages in the centre; stays, earnings, statements and mailbox are in Reports (once).
  if (role === "client") return [...ownerNavigation()];
  const [work, ...rest]: NavigationItem[] =
    role === "cleans" || role === "cleaning_manager" ? [item("work", "Cleans", "check-square"), properties, activity, help]
    : role === "ready" ? [item("work", "Maintenance", "tool"), properties, activity, help]
    // Accounts: invoices and owner statements are the daily work (both in Work → Accounts).
    : role === "accounts" ? [item("work", "Invoices", "file-text"), item("statements", "Statements", "pie-chart"), item("inbox", "Inbox", "message-circle"), item("help", "Tools", "grid")]
    : [item("work", "Work", "check-square"), properties, reports, activity];
  return [home, work, ...rest];
}
const WORK_TITLE: Record<Role, [string, string]> = {
  super_admin: ["Work", "Management, repairs and accounts in one place."], admin: ["Work", "Management, repairs and accounts in one place."],
  stays: ["Your work", "Stays, guests and repairs for your properties."], client: ["Repairs and requests", "Repairs and other requests at your properties."],
  cleans: ["Your cleans", "Today's cleans, checklists and photos."], cleaning_manager: ["Cleans", "Your team's cleans, reviews and schedule."],
  ready: ["Maintenance", "Reactive repairs, quotes, bookings and preventative visits."], accounts: ["Accounts", "Expenses, payouts and owner statements."],
};

// The welcome intro plays once a day on each device (and after signing in), not on every visit.
const welcomeDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());

function IconButton({ label, icon, onPress, palette: p }: { label: string; icon: IconName; onPress: () => void; palette: Palette }) {
  return (
    <MotionPress {...(Platform.OS === "web" ? { dataSet: { hover: "tint" } } : {})} accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={({ pressed }) => [ui.iconButton, { width: 46, height: 46, borderRadius: 15, borderColor: p.border, backgroundColor: p.surface, opacity: pressed ? 0.7 : 1 }]}>
      <Feather name={icon} size={19} color={p.text} />
    </MotionPress>
  );
}

function Workspace({ account, realAccount, viewAs, onViewAs, notice, palette: p, theme, setTheme, onSignedOut, onDeleted, onAccount, welcomeOnOpen, demo, demoBusy, demoNote, onDemo }: { account: WorkspaceAccount; realAccount: WorkspaceAccount; viewAs: ViewAs | null; onViewAs: (view: ViewAs | null) => Promise<void>; notice: string; palette: Palette; theme: "light" | "dark"; setTheme: (theme: "light" | "dark", reduced?: boolean) => void; onSignedOut: () => void; onDeleted: () => void; onAccount: (account: WorkspaceAccount) => void; welcomeOnOpen: boolean; demo: boolean; demoBusy: boolean; demoNote: string; onDemo: (on: boolean) => void }) {
  const { width } = useWindowDimensions();
  const desktop = width >= 1024;
  // On narrow phones Refresh moves into Profile to make room: under 360px wide, and under 400px for a super admin, whose
  // header has the View as button too (under 360px that one is in Profile only). The logo takes the room the buttons
  // leave: 48px each and 8px apart, the profile picture 44px, inside 20px sides and a 12px gap.
  const narrowHeader = !desktop && (width < 360 || (width < 400 && canViewAs(realAccount)));
  const headerEye = canViewAs(realAccount) && (desktop || width >= 360);
  const headerButtons = [account.role !== "client", headerEye, true, !narrowHeader, width >= 440].filter(Boolean).length;
  const logoWidth = Math.max(88, Math.min(144, width - 52 - headerButtons * 56 - 44));
  const reduced = useReducedMotion(), motionPreference = useMotionPreference(), faqShortcut = useFaqShortcut();
  const { section } = useLocalSearchParams<{ section?: string }>();
  const tab: WorkspaceSection = SECTIONS.includes(section as WorkspaceSection) && (ROLE_SECTIONS[section as WorkspaceSection]?.includes(account.role) ?? true) ? section as WorkspaceSection : "home";
  const setTab = (value: WorkspaceSection) => router.setParams({ section: value });
  const nav = useMemo(() => liveNavigation(account.role), [account.role]);
  // On desktop the left panel is the role's own (lib/role-panel.ts): its heading, groups and everyday
  // tools. It follows the account shown, so View as shows the viewed person's or role's panel.
  const panel = useMemo(() => rolePanel(account.role, account.modules), [account.role, account.modules]);
  const [focus, setFocus] = useState<WorkFocus | null>(null);
  const [sidebarHidden, setSidebarHidden] = useState(false), [scrolled, setScrolled] = useState(false), [offline, setOffline] = useState(false), [settings, setSettings] = useState(false), [deleting, setDeleting] = useState(false);
  const [welcome, setWelcome] = useState<"splash" | "greeting" | null>(welcomeOnOpen ? "splash" : null);
  const [properties, setProperties] = useState<PropertyView[]>([]), [journeys, setJourneys] = useState<JourneyView[]>([]), [work, setWork] = useState<OperationView[]>([]);
  const [budget, setBudget] = useState<BudgetItem[]>([]);
  const [invoices, setInvoices] = useState<InvoiceView[]>([]), [notices, setNotices] = useState<NoticeView[]>([]), [policyConfirmed, setPolicyConfirmed] = useState(false), [policy, setPolicy] = useState<BookingPolicy | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [period, setPeriod] = useState<AnalyticsPeriod>(() => presetPeriod(30)), [snapshot, setSnapshot] = useState<AnalyticsSnapshot | null>(null), [reportError, setReportError] = useState(""), [dates, setDates] = useState(false);
  const [exporting, setExporting] = useState(false), [exportMessage, setExportMessage] = useState("");
  const [form, setForm] = useState<WorkflowForm | null>(null), [openWork, setOpenWork] = useState<OperationView | null>(null);
  const [workView, setWorkView] = useState<WorkView | "">(""), [workFilter, setWorkFilter] = useState("Active"), [workQuery, setWorkQuery] = useState("");
  // The bottom bar and sidebar open each page at its start, not where a Home tool last pointed.
  // Accounts' Invoices opens Work → Accounts on its expenses.
  const navigate = (value: WorkspaceSection) => {
    if (account.role === "accounts" && value === "work") { setWorkView("accounts"); setFocus(f => ({ sub: "expenses", nonce: (f?.nonce ?? 0) + 1 })); } else setFocus(null);
    setTab(value);
  };
  const [fade] = useState(() => new Animated.Value(1));
  const scroll = useRef<ScrollView>(null), content = useRef<View>(null);
  const [anchors] = useState(() => new Map<string, View>());
  // The Help button slides out of the way while the page scrolls, and back once it settles.
  const [tucked, setTucked] = useState(false), untuck = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onScrolling = (y: number) => {
    setScrolled(y > 12);
    if (!tucked) setTucked(true);
    if (untuck.current) clearTimeout(untuck.current);
    untuck.current = setTimeout(() => setTucked(false), 900);
  };
  useEffect(() => () => { if (untuck.current) clearTimeout(untuck.current); }, []);
  const profile: Profile = { displayName: account.fullName || account.email || "Your profile", avatar: "forest" };
  const roleLabel = readableStage(account.role);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const update = () => setOffline(!navigator.onLine); update();
    window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);

  useEffect(() => { void refreshNotificationLink(); }, [account.userId]);
  // A role preview (View as a role, no person) reads the super admin's records; keep only what that role could be shown.
  const rolePreview = viewAs && !viewAs.person ? viewAs.role : null;
  // Unread messages for the badge on the Messages button, checked every 30 seconds while open.
  // (Not in a role preview: the count would be the super admin's own.)
  const [chatUnread, setChatUnread] = useState(0);
  const loadUnread = useCallback(async () => {
    if (rolePreview) return;
    try { setChatUnread(z.number().int().min(0).parse((await readChat({ section: "unread" })).data)); } catch { /* the badge simply stays as it was */ }
  }, [rolePreview]);
  useEffect(() => {
    queueMicrotask(() => void loadUnread());
    const timer = setInterval(() => { if (AppState.currentState === "active") void loadUnread(); }, 30_000);
    return () => clearInterval(timer);
  }, [loadUnread]);
  // Guests waiting for a reply join the badge for people with the guest inbox (read once a minute).
  const { waiting: guestWaiting, reload: loadWaiting } = useGuestWaiting(account);
  const messagesBadge = chatUnread + (guestWaiting ?? 0);
  // "Message the property team" (and similar) opens Messages on one conversation.
  const [chatTarget, setChatTarget] = useState<{ id: string; nonce: number } | null>(null);
  const openMessages = (id: string) => { setOpenWork(null); setChatTarget({ id, nonce: Date.now() }); setFocus(null); router.setParams({ section: "inbox" }); };
  const lastRefresh = useRef(0), editing = useRef(false);
  // A super admin can change someone's role or tools while they are signed in. Every read carries
  // the current account, so the app switches to the new role's Home, Work and tools on the next refresh.
  const accountKey = (a: WorkspaceAccount) => [a.role, a.status, a.fullName, [...a.modules].sort().join()].join("|");
  // (While a super admin views as another role, this follows their own account, not the preview.)
  const shownAccount = useRef(realAccount);
  const [accessNote, setAccessNote] = useState(notice);
  useEffect(() => {
    const before = shownAccount.current;
    shownAccount.current = realAccount;
    if (accountKey(before) === accountKey(realAccount)) return;
    queueMicrotask(() => setAccessNote(before.role !== realAccount.role
      ? `Your role has changed to ${ROLE_LABEL[realAccount.role]}. Your Home, Work and tools now match.`
      : "Your tools have been updated."));
  }, [realAccount]);
  // A quiet refresh (every minute, and when someone comes back to the app) keeps what is on screen
  // and its messages; only a failed sign-in is acted on.
  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) { setLoading(true); setError(""); }
    const keep = rolePreview ? previewKeeps(rolePreview, account.modules) : null;
    // Properties and invoices come a page of 100 at a time; read every page.
    const readAll = async (entity: "properties" | "invoices") => {
      const rows: unknown[] = [];
      let cursor = "";
      for (let page = 0; page < 30; page++) {
        const result = await liveApi("/workspace?" + new URLSearchParams({ entity, limit: "100", ...(cursor ? { cursor } : {}) }));
        if (entity === "properties" && page === 0) {
          const latest = workspaceAccountSchema.safeParse(result.account);
          if (latest.success && latest.data.userId === shownAccount.current.userId && accountKey(latest.data) !== accountKey(shownAccount.current)) onAccount(latest.data);
        }
        rows.push(...z.array(z.unknown()).parse(result.data));
        cursor = typeof result.nextCursor === "string" ? result.nextCursor : "";
        if (!cursor) break;
      }
      return { data: rows };
    };
    const jobs = [["properties", ""], ["journeys", "/journeys"], ["work", "/operations"], ["invoices", ""], ["notices", "/portfolio?section=notifications"]] as const;
    const extras = Promise.allSettled([
      isWorkspaceAdmin(account.role) || account.role === "accounts" ? readTeams({ section: "budgetChart" }).then(r => budgetChartSchema.parse(r.data)) : Promise.resolve(null),
      isWorkspaceAdmin(account.role) || account.role === "stays" ? liveApi("/portfolio?section=bookingPolicy").then(r => bookingPolicySchema.parse(r.data)) : Promise.resolve(null),
    ]);
    const results = await Promise.allSettled(jobs.map(async ([key, path]) => key === "properties" || key === "invoices" ? readAll(key) : liveApi(path)));
    results.forEach((result, i) => {
      const key = jobs[i][0];
      // A failed collection is cleared, including after an assignment is revoked.
      if (result.status === "rejected") {
        if (quiet) { if (result.reason instanceof WorkspaceApiError && result.reason.status === 401) onSignedOut(); return; }
        if (key === "properties") setProperties([]); if (key === "journeys") setJourneys([]); if (key === "work") setWork([]); if (key === "invoices") setInvoices([]); if (key === "notices") setNotices([]);
        if (result.reason instanceof WorkspaceApiError && result.reason.status === 401) onSignedOut();
        setError(message(result.reason)); return;
      }
      try {
        const data = result.value.data;
        if (key === "properties") setProperties(z.array(propertyViewSchema).parse(data).sort((x, y) => x.name.localeCompare(y.name)));
        if (key === "journeys") setJourneys(keep && !keep.journeys ? [] : z.array(journeyViewSchema).parse(data));
        if (key === "work") setWork(z.array(operationViewSchema).parse(data).filter(item => !keep || keep.work(item.moduleId)));
        if (key === "invoices") setInvoices(keep && !keep.invoices ? [] : z.array(invoiceViewSchema).parse(data));
        if (key === "notices") setNotices(keep && !keep.notices ? [] : z.array(noticeViewSchema).parse(data));
      } catch { if (!quiet) setError("Unexpected response. Refresh to try again."); }
    });
    // The budget chart (for approving purchases) and the direct-booking policy, read alongside the rest.
    const [budgetResult, policyResult] = await extras;
    if (!quiet || budgetResult.status === "fulfilled") setBudget(budgetResult.status === "fulfilled" && budgetResult.value ? budgetResult.value : []);
    if (!quiet || policyResult.status === "fulfilled") {
      const value = policyResult.status === "fulfilled" ? policyResult.value : null;
      setPolicy(value); setPolicyConfirmed(value?.confirmed ?? false);
    }
    lastRefresh.current = Date.now();
    if (!quiet) setLoading(false);
  }, [account.role, account.modules, rolePreview, onSignedOut, onAccount]);
  const loadReport = useCallback(async (range: AnalyticsPeriod) => {
    if (periodError(range)) return;
    setReportError("");
    try { setSnapshot(reportViewSchema.parse((await liveApi("/reports?" + new URLSearchParams(range))).data) as AnalyticsSnapshot); }
    catch (e) { setSnapshot(null); setReportError(message(e)); }
  }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void refresh(); }); return () => { active = false; }; }, [refresh]);
  // Stay up to date without tapping refresh: every minute while the app is open and in view, and
  // straight away when someone comes back to it. Paused while a form or sheet is open.
  useEffect(() => { editing.current = !!form || !!openWork || settings || dates || busy; }, [form, openWork, settings, dates, busy]);
  useEffect(() => {
    const tick = () => { if (AppState.currentState === "active" && !editing.current && Date.now() - lastRefresh.current > 50_000) void refresh(true); };
    const timer = setInterval(tick, 60_000);
    const sub = AppState.addEventListener("change", state => { if (state === "active" && !editing.current && Date.now() - lastRefresh.current > 20_000) void refresh(true); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [refresh]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void loadReport(period); }); return () => { active = false; }; }, [loadReport, period]);
  const refreshAll = () => { void refresh(); void loadReport(period); void loadUnread(); void loadWaiting(); };

  useEffect(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
    queueMicrotask(() => setScrolled(false));
    if (reduced) { fade.setValue(1); return; }
    fade.setValue(0);
    const animation = Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: Platform.OS !== "web" });
    animation.start();
    return () => animation.stop();
  }, [tab, fade, reduced]);

  const [searchOpen, setSearchOpen] = useState(false), [propertyFocus, setPropertyFocus] = useState<{ id: string; nonce: number } | null>(null);
  const [tracker, setTracker] = useState<Tool | null>(null), [calculator, setCalculator] = useState(false), [viewAsOpen, setViewAsOpen] = useState(false);
  // A Home tool opens its place: the Work view (and tab inside it), or another page, then the section.
  const openTool = (target: HomeToolTarget) => {
    if (target.kind === "work") { setWorkView(target.view); setFocus({ sub: target.sub, anchor: target.anchor, open: target.open, workId: target.workId, nonce: Date.now() }); setTab("work"); }
    else if (target.kind === "tab") { setFocus(target.anchor ? { anchor: target.anchor, nonce: Date.now() } : null); setTab(target.tab); }
    else if (target.kind === "tracker") setTracker(toolsFor(account.role, account.modules).find(t => t.id === target.module) ?? null);
    else if (target.kind === "calculator") setCalculator(true);
  };
  // Search and Favorites: one list of everything this person can open, from what is already loaded.
  const team = account.role !== "client";
  // A role preview has nobody's favorites (not the super admin's own); a person view shows theirs.
  const favorites = useFavoritesStore(team && !(viewAs && !viewAs.person), demo ? DEMO_SAVE_MESSAGE : viewAs ? viewOnlyMessage(viewAs) : "", !!viewAs && !viewAs.person);
  // Viewing as a team member who hasn't finished their start-up checklist: say why their tools are empty.
  const [viewNote, setViewNote] = useState("");
  useEffect(() => {
    if (!viewAs?.person || !STAFF_ROLES.includes(account.role)) return;
    let active = true;
    readTeams({ section: "onboarding" }).then(result => {
      const status = onboardingSchema.safeParse(result.data);
      if (active && status.success && status.data.required && !status.data.complete) setViewNote("They haven't finished their start-up checklist, so until they do they see that instead of these tools.");
    }).catch(() => undefined);
    return () => { active = false; };
  }, [viewAs, account.role]);
  const entries = useMemo(() => buildSearchIndex({ role: account.role, modules: account.modules, properties, work, invoices }), [account.role, account.modules, properties, work, invoices]);
  const openEntry = (entry: SearchEntry) => {
    const t = entry.target;
    if (t.kind === "section") navigate(t.section);
    else if (t.kind === "tool") openTool(t.target);
    else if (t.kind === "property") { setPropertyFocus({ id: t.propertyId, nonce: Date.now() }); setFocus(null); setTab("properties"); }
    else if (t.kind === "work") { const item = work.find(w => w.workId === t.workId); if (item) setOpenWork(item); }
    else openTool(account.role === "accounts" ? { kind: "work", view: "accounts", anchor: "section-invoices" } : { kind: "tab", tab: "analytics", anchor: "section-invoices" });
  };
  // Ctrl+K (⌘K on a Mac), or "/" when not typing, opens search from anywhere on the web.
  useEffect(() => {
    if (Platform.OS !== "web" || typeof document === "undefined") return;
    const keydown = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && (event.target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(event.target.tagName));
      if (((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") || (event.key === "/" && !typing)) { event.preventDefault(); setSearchOpen(true); }
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, []);
  useEffect(() => {
    if (!focus?.anchor) return;
    // Sections appear once their data has loaded, so look for a few seconds, then bring it into view
    // (with a brief glow on the web, so the eye lands on it).
    let tries = 0;
    if (Platform.OS !== "web") {
      const timer = setInterval(() => {
        const node = anchors.get(focus.anchor!);
        if (node && content.current) { clearInterval(timer); node.measureLayout(content.current, (_x, y) => scroll.current?.scrollTo({ y: Math.max(0, y - 8), animated: !reduced }), () => undefined); }
        else if (++tries > 30) clearInterval(timer);
      }, 150);
      return () => clearInterval(timer);
    }
    if (typeof document === "undefined") return;
    const timer = setInterval(() => {
      const el = document.getElementById(focus.anchor!);
      if (el) {
        clearInterval(timer);
        el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
        if (!reduced && typeof el.animate === "function") el.animate([{ boxShadow: "0 0 0 0 rgba(47,107,90,0)" }, { boxShadow: "0 0 0 6px rgba(47,107,90,0.28)" }, { boxShadow: "0 0 0 0 rgba(47,107,90,0)" }], { duration: 1200, delay: 350, easing: "ease-out" });
      } else if (++tries > 30) clearInterval(timer);
    }, 150);
    return () => clearInterval(timer);
  }, [focus, reduced, anchors]);

  // Photos still waiting to upload: say so (in the profile sheet) before signing out.
  const [confirmOut, setConfirmOut] = useState(false);
  async function logout(anyway = false) {
    if (!anyway && pendingUploadCount() > 0) { setConfirmOut(true); setSettings(true); return; }
    setConfirmOut(false); setBusy(true);
    await unlinkNotifications();
    try { await signOut(); } catch { /* signed out on this device either way */ }
    try { globalThis.localStorage?.removeItem("rc-welcomed"); } catch { /* storage unavailable */ }
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
  // Updates marked read on Activity stop counting on Home straight away.
  const markRead = useCallback((ids: number[]) => { const at = new Date().toISOString(); setNotices(list => list.map(n => ids.includes(n.id) ? { ...n, read_at: n.read_at ?? at } : n)); }, []);
  const finishWelcome = () => { setWelcome(null); try { globalThis.localStorage?.setItem("rc-welcomed", welcomeDay()); } catch { /* storage unavailable */ } };

  // Work: each role's views, the first opening by default.
  // Every team role also has All work, where each task's steps (onboarding, inspections, invoices, purchases) live.
  const workViews: WorkView[] = workViewsFor(account.role);
  const currentView: WorkView | "" = workViews.includes(workView as WorkView) ? workView as WorkView : (workViews[0] ?? "");
  // The panel link last used stays highlighted while its place is open; otherwise the page or Work area open now is.
  const [panelPick, setPanelPick] = useState<{ key: string; tab: WorkspaceSection; view: WorkView | "" } | null>(null);
  const openPanel = (link: PanelLink) => {
    if (link.kind === "page") { navigate(link.section); setPanelPick({ key: link.key, tab: link.section, view: "" }); return; }
    if (link.kind === "area") { setFocus(null); setWorkView(link.view); setTab("work"); setPanelPick({ key: link.key, tab: "work", view: link.view }); return; }
    openTool(link.target);
    const t = link.target;
    if (t.kind === "work") setPanelPick({ key: link.key, tab: "work", view: t.view });
    else if (t.kind === "tab") setPanelPick({ key: link.key, tab: t.tab, view: "" });
  };
  const panelSelected = panelPick && panelPick.tab === tab && (tab !== "work" || panelPick.view === currentView) ? panelPick.key : tab === "work" ? "area:" + currentView : "page:" + tab;
  const panelViewing = demo ? { name: viewAs?.person ? `Demo · ${viewAs.person.fullName}` : "Demo mode", detail: "A sample business. Nothing you do here is saved." } : viewAs ? viewAs.person
    ? { name: `Viewing as ${viewAs.person.fullName}`, detail: `Exactly what this ${viewAsLabel(viewAs.role).toLowerCase()} sees. Nothing can be changed.` }
    : { name: `${viewAsLabel(viewAs.role)} preview`, detail: `The ${viewAsLabel(viewAs.role)} menus and tools only. Nothing can be changed.` } : null;
  // Cards inside a page (Stays' routine) open another place, or scroll to a section on the same page.
  const jump = (target: HomeToolTarget) => {
    const here = target.kind === "work" && tab === "work" && target.view === currentView && !target.sub && !target.open ? target.anchor : undefined;
    if (!here) return openTool(target);
    if (Platform.OS === "web") { if (typeof document !== "undefined") document.getElementById(here)?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" }); return; }
    const node = anchors.get(here);
    if (node && content.current) node.measureLayout(content.current, (_x, y) => scroll.current?.scrollTo({ y: Math.max(0, y - 8), animated: !reduced }), () => undefined);
  };
  const names = new Map(properties.map(property => [property.id, property.name]));
  // An inspection booked for a later day: say when the report can be filed instead of offering it.
  const openJourney = openWork && !isDone(openWork.status) ? journeys.find(j => j.propertyId === openWork.propertyId && (j.workId === openWork.workId || openWork.kind === "inspection")) : undefined;
  const reportFrom = openJourney ? inspectionReportFrom(account, openJourney) : null;
  // Every word typed must appear in the title, the property (name or street) or the stage.
  const workWords = normalise(workQuery).split(" ").filter(Boolean);
  const places = new Map(properties.map(property => [property.id, `${property.name} ${property.address ?? ""} ${property.region ?? ""}`]));
  const filtered = work.filter(item => workFilter === "All" || (workFilter === "Completed" ? isDone(item.status) : workFilter === "Waiting" ? isWaitingWork(item.status) : !isDone(item.status)))
    .filter(item => { if (!workWords.length) return true; const text = normalise(`${item.title} ${places.get(item.propertyId) ?? ""} ${readableStage(item.status)}`); return workWords.every(w => text.includes(w)); });
  const todayKey = presetPeriod(1).to;
  // Issued invoices and their payments: on Reports for admins, inside Work → Accounts for Accounts
  // (their navigation has no Reports tab).
  const invoiceSearch = useListSearch(invoices, invoice => [invoice.reference, names.get(invoice.property_id), readableStage(invoice.status), formatMoney(invoice.amount_minor)]);
  const invoiceList = (
    <Anchor id="section-invoices"><View style={{ gap: 10 }}>
      <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Invoices</Text>
      <ListSearchBox p={p} search={invoiceSearch} nouns="invoices" />
      {!invoiceSearch.missed && <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, paddingVertical: 4, gap: 0 }]}>
        {invoiceSearch.shown.map((invoice, i) => (
          <View key={invoice.id} style={[ui.between, { gap: 12, paddingVertical: 12, borderTopWidth: i ? 1 : 0, borderColor: p.border }]}>
            <View style={{ flex: 1, gap: 2 }}><Text style={{ color: p.text, fontWeight: "600" }}>{invoice.reference}</Text><Text style={[ui.small, { color: p.muted }]}>{names.get(invoice.property_id) ?? "Property"} · {invoice.currency === "GBP" ? formatMoney(invoice.amount_minor) : `${invoice.currency} ${(invoice.amount_minor / 100).toFixed(2)}`} · {readableStage(invoice.status)}</Text></View>
            {invoice.status === "issued" && <MotionPress accessibilityRole="button" onPress={() => setForm({ key: "settle-" + invoice.id, title: "Confirm verified invoice payment", description: "Only confirm after checking the payment has actually settled.", endpoint: "workspace", fields: [{ name: "verified", label: "I have verified this invoice payment has settled", type: "checkbox", required: true }], build: () => ({ action: "setInvoiceStatus", invoiceId: invoice.id, version: invoice.version, status: "paid" }) })} style={[ui.button, { backgroundColor: p.wash, minHeight: 40 }]}><Text style={[ui.small, { color: p.primary, fontWeight: "700" }]}>Record payment</Text></MotionPress>}
          </View>
        ))}
      </View>}
    </View></Anchor>
  );
  const workPage = (
    <>
      {/* The Work areas are listed in the left panel on desktop, so the row of tabs shows only without it (phones, or the panel hidden). */}
      {workViews.length > 1 && !(desktop && !sidebarHidden) && <FilterBar values={workViews.map(view => WORK_VIEW_LABEL[view])} selected={currentView ? WORK_VIEW_LABEL[currentView] : ""} onSelect={label => setWorkView((Object.keys(WORK_VIEW_LABEL) as WorkView[]).find(view => WORK_VIEW_LABEL[view] === label) ?? "")} palette={p} />}
      {currentView === "hub" && <LiveHub palette={p} account={account} properties={properties} journeys={journeys} work={work} onForm={setForm} onOpenWork={setOpenWork} />}
      {currentView === "calendar" && <LiveCalendar palette={p} account={account} work={work} desktop={desktop} onOpenWork={setOpenWork} onOpenView={(view, sub) => { setFocus(sub ? { sub, nonce: Date.now() } : null); setWorkView(view); }} />}
      {currentView === "management" && <LiveManagement key={"management:" + (focus?.sub ?? "") + (focus?.nonce ?? "")} palette={p} account={account} />}
      {currentView === "stays" && <LiveStays key={"stays:" + (focus?.nonce ?? "")} palette={p} account={account} properties={properties} onOpenRepairs={() => setWorkView("repairs")} onOpenWork={setOpenWork} />}
      {currentView === "cleans" && <LiveCleans key={"cleans:" + (focus?.nonce ?? "")} palette={p} account={account} properties={properties} onForm={setForm} />}
      {currentView === "repairs" && <LiveRepairs key={"repairs:" + (focus?.nonce ?? "")} palette={p} account={account} properties={properties} />}
      {currentView === "accounts" && <><LiveAccounts key={"accounts:" + (focus?.sub ?? "") + (focus?.nonce ?? "")} palette={p} account={account} properties={properties} /><AccountsWork palette={p} account={account} properties={properties} onOpenWork={setOpenWork} />{account.role === "accounts" && !!invoices.length && invoiceList}</>}
      {currentView === "all" && <>
        <PageHeading palette={p} title="All work" subtitle={WORK_TITLE[account.role][1]} />
        {policy && <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, flexDirection: desktop ? "row" : "column", alignItems: desktop ? "center" : "stretch", gap: 12 }]}>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>Direct-booking discount policy</Text>
            <Text style={[ui.small, { color: p.muted }]}>{policy.confirmed ? `Confirmed: ${formatBps(policy.discount_bps)} off, up to ${formatMoney(policy.discount_cap_minor)}, for stays of ${policy.minimum_nights} nights or more.` : "Not confirmed yet, so direct-booking offers can't be prepared."}</Text>
          </View>
          {account.role === "super_admin" && <SoftButton label={policy.confirmed ? "Change policy" : "Review and confirm"} icon="check" primary={!policy.confirmed} palette={p} onPress={() => setForm(bookingPolicyForm(policy))} />}
        </View>}
        <FilterBar values={["Active", "Waiting", "Completed", "All"]} selected={workFilter} onSelect={setWorkFilter} palette={p} />
        <SearchBox p={p} value={workQuery} onChange={setWorkQuery} placeholder="Search work by title, property or street" />
        <Text accessibilityLiveRegion="polite" style={[ui.small, { color: p.muted }]}>{filtered.length} {filtered.length === 1 ? "item" : "items"} within your access</Text>
        {filtered.length ? (() => {
          const due = workFilter === "Active" ? filtered.filter(item => (workDate(item) || "9999") <= todayKey) : [], rest = workFilter === "Active" ? filtered.filter(item => (workDate(item) || "9999") > todayKey) : filtered;
          const list = (items: OperationView[]) => <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, paddingVertical: 6, gap: 0 }]}>{items.slice(0, 200).map((item, i) => <Stagger key={item.workId} index={i}><LiveWorkRow item={item} property={names.get(item.propertyId)} palette={p} onPress={() => setOpenWork(item)} /></Stagger>)}</View>;
          return <>
            {!!due.length && <View style={{ gap: 8 }}><Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>Due today or overdue · {due.length}</Text>{list(due)}</View>}
            {!!rest.length && <View style={{ gap: 8 }}>{workFilter === "Active" && <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>Ongoing · {rest.length}</Text>}{list(rest)}</View>}
          </>;
        })() : <EmptyState palette={p} title={loading ? "Loading your work…" : "No work in this view"} detail={workQuery.trim() ? "Nothing matches that search. Try part of the title or the property name." : "Try another status, or create work from a property."} />}
      </>}
    </>
  );
  const reportsPage = (
    <>
      {snapshot ? <Reports snapshot={snapshot} period={period} role={account.role} palette={p} onDates={() => setDates(true)} onExport={() => void exportCsv()} exporting={exporting} exportMessage={exportMessage} /> : (
        <><PageHeading palette={p} title="Reports" subtitle="Trends across the records within your access." />{reportError ? <View style={{ gap: 12 }}><EmptyState palette={p} icon="activity" title="Reports could not be loaded" detail={reportError} /><SoftButton label="Try again" icon="refresh-cw" palette={p} onPress={() => void loadReport(period)} /></View> : <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, alignItems: "center", paddingVertical: 30 }]}><ActivityIndicator color={p.primary} /><Text style={[ui.small, { color: p.muted }]}>Loading your reports…</Text></View>}</>
      )}
      {(isWorkspaceAdmin(account.role) || account.role === "accounts") && !!invoices.length && invoiceList}
    </>
  );
  const page = tab === "home"
    ? <LiveHome palette={p} desktop={desktop} account={account} snapshot={snapshot} period={period} properties={properties} journeys={journeys} work={work} notices={notices} loading={loading} onNavigate={setTab} onTool={openTool} />
    : tab === "favorites" ? <FavoritesPage palette={p} desktop={desktop} entries={entries} onOpen={openEntry} onSearch={() => setSearchOpen(true)} />
    : tab === "work" ? workPage
    : tab === "properties" ? <LiveProperties palette={p} desktop={desktop} account={account} properties={properties} journeys={journeys} work={work} invoices={invoices} period={period} loading={loading} onForm={setForm} onOpenWork={setOpenWork} onRefresh={() => void refresh()} focusProperty={propertyFocus} />
    : tab === "analytics" ? (account.role === "client" ? <LiveClientReports palette={p} mailbox={account.modules.includes("client-mailbox")} /> : reportsPage)
    : tab === "approvals" ? <LiveApprovals palette={p} account={account} properties={properties} journeys={journeys} work={work} loading={loading} onForm={setForm} onRefresh={() => refresh()} onInbox={() => navigate("inbox")} onProperties={() => navigate("properties")} />
    : tab === "statements" ? <WorkFocusContext.Provider value={{ ...focus, sub: "statements", nonce: focus?.nonce ?? 0 }}><LiveAccounts key={"statements:" + (focus?.nonce ?? "")} palette={p} account={account} properties={properties} /></WorkFocusContext.Provider>
    : tab === "activity" ? <LiveActivity palette={p} notices={notices} loading={loading} onRead={markRead} />
    : tab === "inbox" ? <LiveChat key={chatTarget?.nonce ?? 0} palette={p} account={account} desktop={desktop} properties={properties} onUnread={() => { void loadUnread(); void loadWaiting(); }} guestWaiting={guestWaiting} openConversation={chatTarget?.id} />
    : <LiveHelp palette={p} account={account} properties={properties} busy={busy} onSignOut={() => void logout()} onOpen={(next, view) => { setTab(next); if (view) setWorkView(view); }} />;
  // Tabs already fade in; switching between Work views (Cleans, Repairs, All work…) slides the new view in too.
  const animatedPage = <SwapIn swapKey={tab === "work" ? "work:" + currentView : tab} style={{ gap: 24 }}>{page}</SwapIn>;
  const header = headerPalette(p);
  const ownerActions = { unread: chatUnread, openForm: setForm };
  const title = tab === "work" && currentView ? WORK_VIEW_LABEL[currentView] : panel.groups.flatMap(g => g.links).find(l => l.kind === "page" && l.section === tab)?.label ?? nav.find(item => item.value === tab)?.label ?? (tab === "help" ? "Help" : tab === "activity" ? "Activity" : tab === "inbox" ? "Messages" : "Home");
  // The floating Help button; the page leaves room under its last item while it shows.
  const showFaq = !faqShortcut.hidden && tab !== "help" && (desktop || (tab !== "home" && !nav.some(item => item.value === "help")));
  // On phones the team's Favorites button floats just above Help (or where Help would be).
  const showFavorites = !desktop && team && tab !== "favorites";
  return (
    <SafeAreaView style={[ui.fill, { backgroundColor: p.background }]} edges={["top", "bottom"]}>
      <FavoritesContext.Provider value={team ? favorites : null}><CelebrateProvider palette={p} bottom={desktop ? 40 : 112}><OpenMessagesContext.Provider value={openMessages}>
      <StatusBar style={theme === "dark" ? "light" : "dark"} />
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={[ui.fill, { flexDirection: "row" }]}>
        {desktop && !sidebarHidden && <RoleNavigation panel={panel} selected={panelSelected} palette={p} onOpen={openPanel} badges={{ "page:inbox": messagesBadge }} viewing={panelViewing} onBack={demo ? () => (viewAs ? void onViewAs(null) : onDemo(false)) : viewAs ? () => void onViewAs(null) : undefined} backLabel={demo && !viewAs ? "Switch to Live" : undefined} onProfile={() => setSettings(true)} onCollapse={() => setSidebarHidden(true)} />}
        {desktop && sidebarHidden && <View style={{ width: 64, backgroundColor: p.isDark ? p.surface : p.background, borderRightWidth: 1, borderColor: p.border }}><View style={{ height: 81, alignItems: "center", justifyContent: "center", backgroundColor: p.header }}><IconButton label="Show left panel" icon="chevrons-right" palette={header} onPress={() => setSidebarHidden(false)} /></View></View>}
        <View {...(Platform.OS === "web" ? { dataSet: { canvas: "" } } : {})} style={[ui.fill, { minWidth: 0 }]}>
          {offline && <View accessibilityRole="alert" style={{ backgroundColor: p.cautionWash, padding: 12 }}><Text style={[ui.small, { color: p.text }]}>You are offline. Photos are saved on this device; other changes will fail until you reconnect.</Text></View>}
          <UploadBanner p={p} userId={account.userId} />
          <View testID="workspace-toolbar" style={{ backgroundColor: p.header, borderBottomWidth: 1, borderColor: scrolled ? p.headerBorder : p.isDark && desktop ? p.border : "transparent", zIndex: 2, ...web({ transition: "box-shadow 320ms ease", boxShadow: scrolled ? "0 14px 30px -20px rgba(8,22,18,.55)" : "none" }) }}>
            <View style={[ui.between, { width: "100%", maxWidth: desktop ? undefined : 760, alignSelf: "center", paddingHorizontal: 20, paddingVertical: 16, gap: 12 }]}>
              <View style={[ui.row, { flex: 1, minWidth: 0, gap: 16 }]}>
                {desktop && sidebarHidden && <CompanyLogo palette={header} width={144} />}
                {desktop ? <Text numberOfLines={1} style={{ color: p.headerText, fontSize: 16, fontWeight: "600", flexShrink: 1, minWidth: 80 }}>{title}</Text> : <CompanyLogo palette={header} width={logoWidth} />}
                {desktop && team && <HeaderSearch palette={p} onOpen={() => setSearchOpen(true)} />}
              </View>
              <View style={[ui.row, { gap: 8 }]}>
                {!desktop && team && <IconButton label="Search" icon="search" palette={header} onPress={() => setSearchOpen(true)} />}
                {canViewAs(realAccount) && width >= 900 && <ModeSwitch palette={p} demo={demo} busy={demoBusy} onChange={onDemo} />}
                {headerEye && <IconButton label={viewAs ? `Viewing as ${viewAsName(viewAs)}. Change view` : "View as someone else"} icon="eye" palette={header} onPress={() => setViewAsOpen(true)} />}
                <View>
                  <IconButton label={messagesBadge ? `Messages, ${[chatUnread ? `${chatUnread} unread` : "", guestWaiting ? `${guestWaiting} ${guestWaiting === 1 ? "guest" : "guests"} waiting` : ""].filter(Boolean).join(", ")}` : "Messages"} icon="message-circle" palette={header} onPress={() => { setChatTarget(null); navigate("inbox"); }} />
                  {messagesBadge > 0 && <View pointerEvents="none" style={{ position: "absolute", top: -4, right: -4, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5, backgroundColor: p.badge, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: p.header }}><Text style={{ color: p.onBadge, fontSize: 11, fontWeight: "800" }}>{messagesBadge > 99 ? "99+" : messagesBadge}</Text></View>}
                </View>
                {!narrowHeader && <IconButton label={loading ? "Refreshing" : "Refresh"} icon="refresh-cw" palette={header} onPress={refreshAll} />}
                {(desktop || width >= 440) && <IconButton label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} icon={theme === "dark" ? "sun" : "moon"} palette={header} onPress={() => setTheme(theme === "dark" ? "light" : "dark", reduced)} />}
                <MotionPress accessibilityRole="button" accessibilityLabel={`Open profile and preferences, ${roleLabel}`} onPress={() => setSettings(true)} style={{ minHeight: 48, minWidth: 44, flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: desktop ? 14 : 0, borderRadius: 999, backgroundColor: desktop ? p.headerControl : "transparent", borderWidth: desktop ? 1 : 0, borderColor: p.headerBorder }}>
                  {desktop && <View style={{ maxWidth: 180 }}><Text numberOfLines={1} style={{ color: p.headerText, fontSize: 14, fontWeight: "600" }}>{profile.displayName}</Text><Text numberOfLines={1} style={{ color: p.headerMuted, fontSize: 11 }}>{roleLabel}</Text></View>}
                  <Avatar profile={profile} backgroundColor={desktop ? undefined : p.headerControl} textColor={desktop ? "#FFFFFF" : p.headerControlText} />
                </MotionPress>
              </View>
            </View>
          </View>
          <ScrollView ref={scroll} testID="workspace-scroll" style={ui.fill} contentContainerStyle={[ui.page, { maxWidth: desktop ? 1400 : 760 }, (showFaq || showFavorites) && !desktop && { paddingBottom: 184 }]} onScroll={event => onScrolling(event.nativeEvent.contentOffset.y)} scrollEventThrottle={32} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" showsVerticalScrollIndicator={Platform.OS === "web"}>
            <View ref={content} collapsable={false}><Animated.View style={{ opacity: fade, gap: 24, transform: desktop ? [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] : [{ translateX: fade.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] }}>
              {demo ? <DemoBanner palette={p} viewing={viewAs?.person ? `${viewAs.person.fullName} (${viewAsLabel(viewAs.role)})` : null} onViewAs={() => setViewAsOpen(true)} onLive={() => onDemo(false)} />
                : !!viewAs && <ViewAsBanner palette={p} view={viewAs} note={viewNote} onChange={() => setViewAsOpen(true)} onBack={() => void onViewAs(null)} />}
              {!!accessNote && <View accessibilityRole="alert" style={[ui.row, { gap: 10, padding: 12, borderRadius: 14, backgroundColor: p.wash }]}><Feather name="shield" size={16} color={p.primary} /><Text style={[ui.small, { color: p.text, flex: 1 }]}>{accessNote}</Text><MotionPress accessibilityRole="button" accessibilityLabel="Dismiss" onPress={() => setAccessNote("")} style={{ minHeight: 36, minWidth: 36, alignItems: "center", justifyContent: "center" }}><Feather name="x" size={16} color={p.muted} /></MotionPress></View>}
              <AnchorRegistry.Provider value={anchors}><WorkFocusContext.Provider value={focus}><WorkJumpContext.Provider value={jump}><OwnerActions.Provider value={ownerActions}>{animatedPage}</OwnerActions.Provider></WorkJumpContext.Provider></WorkFocusContext.Provider></AnchorRegistry.Provider>
              {!!error && <View accessibilityRole="alert" style={[ui.row, { gap: 10, padding: 12, borderRadius: 14, backgroundColor: p.cautionWash }]}><Feather name="alert-circle" size={16} color={p.waiting} /><Text style={[ui.small, { color: p.text, flex: 1 }]}>{error}</Text><MotionPress accessibilityRole="button" onPress={() => void refresh()} style={{ minHeight: 36, justifyContent: "center" }}><Text style={[ui.small, { color: p.primary, fontWeight: "700" }]}>Try again</Text></MotionPress></View>}
            </Animated.View></View>
          </ScrollView>
          {/* On phones Home has its own help links and some bottom bars include Help, so the floating button stays out of the way there. */}
          {showFaq && <FaqShortcut palette={p} tucked={tucked} onOpen={() => navigate("help")} onHide={() => faqShortcut.setHidden(true)} />}
          {showFavorites && <FavoritesShortcut palette={p} tucked={tucked} lifted={showFaq} count={favorites.items.length} onOpen={() => navigate("favorites")} />}
          {!desktop && <NavigationBar role={account.role} items={nav} section={tab} onNavigate={navigate} palette={p} />}
        </View>
      </KeyboardAvoidingView>
      <Sheet palette={p} visible={settings} onClose={() => { setSettings(false); setConfirmOut(false); }} title="Profile & preferences" subtitle="Your account and comfort settings" icon="people">
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
          {Platform.OS === "web" && <>
            <Text style={{ color: p.muted, fontSize: 11, fontWeight: "600", letterSpacing: 1.4, textTransform: "uppercase" }}>Notifications</Text>
            <View style={{ borderRadius: 20, borderWidth: 1, borderColor: p.border, backgroundColor: p.background }}><NotificationsSetting p={p} /></View>
          </>}
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
        {canViewAs(realAccount) && <DemoSwitchRow palette={p} demo={demo} busy={demoBusy} note={demoNote} onChange={on => { setSettings(false); onDemo(on); }} />}
        {canViewAs(realAccount) && <SoftButton label={viewAs ? `Viewing as ${viewAsName(viewAs)}: change` : "View the app as someone else"} icon="arrow-right" palette={p} onPress={() => { setSettings(false); setViewAsOpen(true); }} />}
        {narrowHeader && <SoftButton label={loading ? "Refreshing…" : "Refresh"} icon="refresh-cw" palette={p} onPress={() => { setSettings(false); refreshAll(); }} />}
        <PrivacySection p={p} onDelete={() => { setSettings(false); setDeleting(true); }} />
        <SoftButton label="Your tools, help and training" icon="arrow-right" palette={p} onPress={() => { setSettings(false); setTab("help"); }} />
        {confirmOut ? <SignOutUploadsWarning p={p} busy={busy} onCancel={() => setConfirmOut(false)} onConfirm={() => void logout(true)} /> : <SoftButton label={busy ? "Signing out…" : "Sign out"} icon="log-out" palette={p} disabled={busy} onPress={() => void logout()} />}
      </Sheet>
      <DeleteAccountSheet p={p} visible={deleting} onClose={() => setDeleting(false)} onDeleted={() => { setDeleting(false); onDeleted(); }} />
      <WorkflowSheet spec={form} invoices={invoices} budget={budget} palette={p} onClose={() => setForm(null)} onSaved={refresh} />
      <Sheet palette={p} visible={!!openWork} onClose={() => setOpenWork(null)} title={openWork?.title ?? ""} subtitle={openWork ? [names.get(openWork.propertyId), readableStage(openWork.status)].filter(Boolean).join(" · ") : undefined} icon="clipboard">
        {openWork && <>
          {workDetails(openWork).map(d => <View key={d.label} style={{ gap: 4 }}><Text style={{ color: p.muted, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 1 }}>{d.label}</Text><Text selectable style={[ui.body, { color: d.tone === "bad" ? p.danger : d.tone === "good" ? p.success : p.text, fontWeight: d.tone ? "700" : "400" }]}>{d.value}</Text></View>)}
          {openWork.kind === "direct_booking" && openWork.data.phase === "follow_up" && policy?.confirmed && <Text style={[ui.small, { color: p.muted }]}>Offer the guest {formatBps(policy.discount_bps).replace(".0%", "%")} off, up to {formatMoney(policy.discount_cap_minor)} off. The offer price is worked out when you prepare it.</Text>}
          {!!workDate(openWork) && <Text style={[ui.body, { color: p.text }]}>Due {new Date(workDate(openWork) + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}</Text>}
          {openWork.data.estimatedCostMinor !== undefined && <Text style={[ui.body, { color: p.text }]}>Estimated cost: {formatMoney(Number(openWork.data.estimatedCostMinor))}</Text>}
          {team && <FavoriteButton entryKey={"work:" + openWork.workId} label={openWork.title} palette={p} />}
          <WorkPhotos key={openWork.workId + openWork.version} p={p} workId={openWork.workId} />
          {account.role === "ready" && <PropertyAccess key={openWork.propertyId} palette={p} account={account} propertyId={openWork.propertyId} />}
          <PriceNightsLink p={p} account={account} item={openWork} onOpen={target => { setOpenWork(null); openTool(target); }} />
          {workItemForms(account, openWork, journeys, work).map(f => <SoftButton key={f.key} label={f.title} icon="arrow-right" palette={p} disabled={f.key === "prepareQuote" && !policyConfirmed} onPress={() => { setOpenWork(null); setForm(f); }} />)}
          {openWork.kind === "direct_booking" && !policyConfirmed && <Text style={[ui.small, { color: p.muted }]}>The discount policy awaits confirmation.</Text>}
          {!!reportFrom && <Text style={[ui.small, { color: p.muted }]}>Report from {dayLabel(reportFrom)}</Text>}
          {!workItemForms(account, openWork, journeys, work).length && openWork.kind !== "pricing_gap" && !reportFrom && <Text style={[ui.small, { color: p.muted }]}>Nothing needs your action on this item.</Text>}
          <WorkHistory key={openWork.workId} p={p} workId={openWork.workId} version={openWork.version} />
        </>}
      </Sheet>
      <SearchPanel visible={searchOpen} onClose={() => setSearchOpen(false)} palette={p} entries={entries} onOpen={openEntry} />
      <TrackerSheet palette={p} tool={tracker} properties={properties} onClose={() => setTracker(null)} />
      <FurnishingSheet palette={p} visible={calculator} onClose={() => setCalculator(false)} />
      {canViewAs(realAccount) && <ViewAsSheet palette={p} visible={viewAsOpen} current={viewAs} onClose={() => setViewAsOpen(false)} onChoose={onViewAs} />}
      <DateRangeSheet key={period.from + period.to + String(dates)} palette={p} visible={dates} period={period} onClose={() => setDates(false)} onApply={range => { setDates(false); setPeriod(range); setSnapshot(null); }} />
      {welcome === "splash" && <RechargeSplash palette={p} onDone={() => setWelcome("greeting")} />}
      </OpenMessagesContext.Provider></CelebrateProvider></FavoritesContext.Provider>
      {welcome === "greeting" && <GreetingCard palette={p} profile={profile} openTasks={work.filter(item => !isDone(item.status)).length} waiting={work.filter(item => isWaitingWork(item.status)).length} onClose={finishWelcome} onWork={() => { finishWelcome(); setTab("work"); }} />}
    </SafeAreaView>
  );
}

function Screen() {
  const { theme, setTheme } = useThemePreference();
  const p = themes[theme];
  const [account, setAccount] = useState<WorkspaceAccount | null>(null), [checking, setChecking] = useState(true), [error, setError] = useState(""), [welcome, setWelcome] = useState(false), [notice, setNotice] = useState("");
  useEffect(() => {
    let active = true;
    if (!liveApiOrigin()) { queueMicrotask(() => { if (active) setChecking(false); }); return () => { active = false; }; }
    restoreAccount().then(value => {
      if (!active) return;
      let welcomed = false;
      try { welcomed = globalThis.localStorage?.getItem("rc-welcomed") === welcomeDay(); } catch { welcomed = false; }
      // A view saved in this tab is read-only from the first screen, before it is picked up again below.
      let saved: ViewAs | null = null;
      try { saved = readSavedView(globalThis.sessionStorage?.getItem("rc-view-as")); } catch { saved = null; }
      if (saved && value && canViewAs(value)) setViewOnly(viewOnlyMessage(saved));
      setWelcome(!welcomed); setAccount(value);
    }).catch(e => { if (active && !(e instanceof WorkspaceApiError && e.status === 401)) setError(message(e)); }).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, []);
  // A super admin's "View as" (lib/view-as.ts), kept for this browser tab only. Viewing a person
  // starts a recorded view on the server, which answers with the account the app then shows.
  const [viewAs, setViewAsState] = useState<ViewAs | null>(() => { try { return readSavedView(globalThis.sessionStorage?.getItem("rc-view-as")); } catch { return null; } });
  const [person, setPerson] = useState<WorkspaceAccount | null>(null), [viewNotice, setViewNotice] = useState("");
  // Demo mode (lib/demo-data.ts), super admins only: the recorded sample business in place of the
  // real records, as its super admin or, through View as, as one of its people. Kept for this tab.
  const [demo, setDemoState] = useState<{ data: DemoData; role: DemoRole } | null>(null);
  const [demoBusy, setDemoBusy] = useState<"on" | "off" | null>(null), [demoNote, setDemoNote] = useState("");
  const demoAccount = demo ? demo.data.personas[demo.role]?.account ?? null : null;
  const viewing = account && canViewAs(account) ? viewAs : null;
  const shown = useMemo(() => demoAccount ?? (!account || !viewing ? account : viewing.person ? (person?.userId === viewing.person.userId ? person : null) : previewAccount(account, viewing.role)), [demoAccount, account, viewing, person]);
  const switchDemo = useCallback(async (on: boolean) => {
    setDemoNote("");
    setDemoBusy(on ? "on" : "off");
    // A moment for the switch to show, so the change of data reads as one deliberate step.
    const pause = new Promise(resolve => setTimeout(resolve, 650));
    try {
      if (!on) {
        await pause;
        setDemo(null); setDemoState(null); setViewAsState(null); setPerson(null); setViewOnly("");
        try { globalThis.sessionStorage?.removeItem("rc-demo"); globalThis.sessionStorage?.removeItem("rc-view-as"); } catch { /* storage unavailable */ }
        router.setParams({ section: "home" });
        return;
      }
      // A view of a real person ends first: the demo has its own people.
      if (viewAs?.person) void stopViewAs().catch(() => undefined);
      const [data] = await Promise.all([loadDemoData(), pause]);
      const next = { data, role: "super_admin" as const };
      setViewOnly(""); setViewAsState(null); setPerson(null); setWelcome(false);
      setDemo(next); setDemoState(next);
      try { globalThis.sessionStorage?.setItem("rc-demo", "on"); globalThis.sessionStorage?.removeItem("rc-view-as"); } catch { /* storage unavailable */ }
      router.setParams({ section: "home" });
    } catch (e) { setDemoNote(message(e)); } finally { setDemoBusy(null); }
  }, [viewAs]);
  // After a refresh, a tab that was in demo mode opens the demo again.
  const demoResumed = useRef(false);
  useEffect(() => {
    if (demoResumed.current || !account || !canViewAs(account)) return;
    demoResumed.current = true;
    let saved = false;
    try { saved = globalThis.sessionStorage?.getItem("rc-demo") === "on"; } catch { saved = false; }
    if (saved) queueMicrotask(() => void switchDemo(true));
  }, [account, switchDemo]);
  const changeView = useCallback(async (next: ViewAs | null, quiet = false) => {
    // In the demo, viewing as someone shows that sample person's recorded screens; nothing is sent.
    if (demo) {
      const role = (next?.role ?? "super_admin") as DemoRole;
      if (!demo.data.personas[role]) throw new WorkspaceApiError("That person isn't in the demo business.", 404);
      const moved = { ...demo, role };
      setDemo(moved); setDemoState(moved); setViewAsState(next);
      if (!quiet) { setWelcome(false); router.setParams({ section: "home" }); }
      return;
    }
    // Nothing may be saved from the moment a view starts; the start itself is sent as the super admin.
    const shownNext = next?.person ? await startViewAs(next.person.userId) : null;
    if (viewAs?.person && !next?.person) void stopViewAs().catch(() => undefined);
    try { if (next) globalThis.sessionStorage?.setItem("rc-view-as", JSON.stringify(next)); else globalThis.sessionStorage?.removeItem("rc-view-as"); } catch { /* storage unavailable */ }
    const ended = () => { setViewOnly(""); setViewAsState(null); setPerson(null); setViewNotice(VIEW_AS_ENDED.replace("Choose them again to carry on.", "You're back in your own view.")); try { globalThis.sessionStorage?.removeItem("rc-view-as"); } catch { /* storage unavailable */ } };
    setViewOnly(next ? viewOnlyMessage(next) : "", next?.person ? { userId: next.person.userId, onEnded: ended } : null);
    setPerson(shownNext); setViewNotice("");
    if (!quiet) { setWelcome(false); router.setParams({ section: "home" }); }
    setViewAsState(next);
  }, [viewAs, demo]);
  // After a refresh, a person view picks up again (and is recorded again); if it can't, back to your own view.
  const resumed = useRef(false);
  useEffect(() => {
    if (resumed.current || !account || !canViewAs(account) || !viewAs) return;
    resumed.current = true;
    changeView(viewAs, true).catch(() => { setViewOnly(""); setViewAsState(null); try { globalThis.sessionStorage?.removeItem("rc-view-as"); } catch { /* storage unavailable */ } });
  }, [account, viewAs, changeView]);
  const signedOut = useCallback(() => { setViewOnly(""); setDemo(null); setDemoState(null); try { globalThis.sessionStorage?.removeItem("rc-demo"); } catch { /* storage unavailable */ } setAccount(null); }, []);
  // After deleting their account the person lands on sign-in with a confirmation.
  const deleted = useCallback(() => { setNotice(ACCOUNT_DELETED); setAccount(null); }, []);
  if (checking) return <View style={[ui.fill, { backgroundColor: p.header, alignItems: "center", justifyContent: "center", gap: 20 }]}><CompanyLogo palette={headerPalette(p)} width={180} /><ActivityIndicator accessibilityLabel="Restoring your session" color={p.headerText} /></View>;
  if (!liveApiOrigin()) return <View style={[ui.fill, { backgroundColor: p.background, padding: 24, justifyContent: "center" }]}><EmptyState palette={p} icon="inbox" title="Live connection is awaiting configuration" detail="The backend address will be added to the app when deployment is ready." /></View>;
  if (!account) return <SafeAreaView style={[ui.fill, { backgroundColor: p.background }]} edges={["top", "bottom"]}><StatusBar style="light" /><LiveSignIn palette={p} notice={notice} onTheme={() => setTheme(theme === "dark" ? "light" : "dark")} onSignedIn={value => { setNotice(""); setWelcome(true); setAccount(value); }} />{!!error && <Text accessibilityRole="alert" style={[ui.small, { color: p.danger, textAlign: "center", padding: 12 }]}>{error}</Text>}</SafeAreaView>;
  if (account.status !== "active") return <View style={[ui.fill, { backgroundColor: p.background, padding: 24, justifyContent: "center", gap: 16 }]}><EmptyState palette={p} icon="inbox" title={account.status === "pending" ? "Your access is being reviewed" : "Your access has been removed"} detail={account.status === "pending" ? "An administrator will approve your account and choose your tools. You'll then see your workspace here." : "Ask an administrator if you think this is a mistake."} /><SoftButton label="Sign out" icon="log-out" palette={p} onPress={() => { void signOut().finally(() => setAccount(null)); }} /><DeleteAccountButton p={p} onDeleted={deleted} /></View>;
  // New team members sign their contract and finish required training first.
  return (
    <OnboardingGate key={account.userId} account={account} palette={p} onSignOut={() => { void unlinkNotifications().then(() => signOut()).catch(() => undefined).finally(() => setAccount(null)); }}>
      {shown ? <Workspace key={(demo ? "demo:" + demo.role + ":" : "") + viewAsKey(viewing)} account={shown} realAccount={account} viewAs={viewing} onViewAs={changeView} notice={viewNotice} palette={p} theme={theme} setTheme={setTheme} onSignedOut={signedOut} onDeleted={deleted} onAccount={setAccount} welcomeOnOpen={welcome}
          demo={!!demo} demoBusy={!!demoBusy} demoNote={demoNote} onDemo={on => void switchDemo(on)} />
        : <View style={[ui.fill, { backgroundColor: p.background, alignItems: "center", justifyContent: "center" }]}><ActivityIndicator accessibilityLabel="Opening the view" color={p.primary} /></View>}
      <DemoSwitching palette={p} visible={!!demoBusy} toDemo={demoBusy === "on"} />
    </OnboardingGate>
  );
}

export default function LiveWorkspace() {
  return <SafeAreaProvider><MotionProvider><Screen /></MotionProvider></SafeAreaProvider>;
}
