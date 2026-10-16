import { MODULES, type ModuleId, type WorkspaceRole } from "./modules";
import type { WorkView } from "./tool-directory";
import type { HomeToolTarget } from "./home-tools";

export type WorkspaceSection = "home" | "work" | "properties" | "inbox" | "more" | "workspace" | "analytics" | "calendar" | "approvals" | "help" | "activity" | "training" | "statements" | "favorites" | "enquiries" | "feedback" | "moderation" | "todo" | "decisions";
export type DepartmentTone = "cleans" | "ready" | "stays" | "clients" | "accounts";
type Destination = { area: string; tone: DepartmentTone; icon: string; service: string };

// Navigation describes workflows; it never supplies an authorization grant.
export const WORKSPACE_MAP: Record<ModuleId, Destination> = {
  "daily-pricing": { area: "Stays reporting", tone: "stays", icon: "trending-up", service: "operations" },
  "listing-health": { area: "Stays reporting", tone: "stays", icon: "check-square", service: "operations" },
  "client-furnishing": { area: "Property setup", tone: "clients", icon: "layout", service: "calculator" },
  "safety-maintenance": { area: "Ready operations", tone: "ready", icon: "shield", service: "operations" },
  "purchase-order": { area: "Ready operations", tone: "ready", icon: "shopping-bag", service: "purchase-order" },
  "purchase-order-requests": { area: "Stays operations", tone: "stays", icon: "send", service: "purchase-order" },
  "client-purchase-order-quotes": { area: "Client approvals", tone: "clients", icon: "file-text", service: "onboarding" },
  "property-database": { area: "Properties", tone: "stays", icon: "home", service: "properties" },
  "property-onboarding": { area: "Property setup", tone: "clients", icon: "key", service: "onboarding" },
  "client-dashboard": { area: "Properties", tone: "clients", icon: "home", service: "properties" },
  "client-property-maintenance": { area: "Client properties", tone: "clients", icon: "tool", service: "maintenance" },
  "weekly-performance": { area: "Stays reporting", tone: "stays", icon: "bar-chart-2", service: "operations" },
  "maintenance-reporting": { area: "Ready operations", tone: "ready", icon: "tool", service: "maintenance" },
  "stays-maintenance-reporting": { area: "Stays reporting", tone: "stays", icon: "activity", service: "maintenance" },
  "clean-reporting": { area: "Stays reporting", tone: "stays", icon: "clipboard", service: "cleans" },
  "aircover-reporting": { area: "Stays operations", tone: "stays", icon: "shield", service: "workflows" },
  "cleaning-schedule": { area: "Cleaning operations", tone: "cleans", icon: "calendar", service: "cleans" },
  "cleaner-performance": { area: "Cleaning reporting", tone: "cleans", icon: "award", service: "cleans" },
  "clean-client-database": { area: "Cleaning workspace", tone: "cleans", icon: "users", service: "cleans" },
  "cleaner-database": { area: "Cleaning workspace", tone: "cleans", icon: "user-check", service: "cleans" },
  "cleans-invoices": { area: "Cleaning finance", tone: "accounts", icon: "file-text", service: "cleans" },
  "client-mailbox": { area: "Client inbox", tone: "clients", icon: "mail", service: "cleans" },
  "replenishment-requests": { area: "Finance workspace", tone: "accounts", icon: "package", service: "cleans" },
  "ready-schedule": { area: "Ready operations", tone: "ready", icon: "calendar", service: "operations" },
  "licensing": { area: "Properties", tone: "stays", icon: "file", service: "licensing" },
  "direct-bookings": { area: "Stays reporting", tone: "stays", icon: "bookmark", service: "operations" },
  "ota-logins": { area: "Properties", tone: "stays", icon: "lock", service: "properties" },
  "guest-communication": { area: "Stays inbox", tone: "stays", icon: "message-circle", service: "communications" },
  "property-furnishing-board": { area: "Ready operations", tone: "ready", icon: "layout", service: "workflows" },
  "new-property-inspection-board": { area: "Ready operations", tone: "ready", icon: "search", service: "workflows" },
  "routine-bin-garden-board": { area: "Ready operations", tone: "ready", icon: "sun", service: "workflows" },
  "clean-property-onboarding": { area: "Cleaning workspace", tone: "cleans", icon: "check-square", service: "workflows" },
  "owner-statements": { area: "Finance workspace", tone: "accounts", icon: "pie-chart", service: "owner-statements" },
  "maintenance-reconciliation": { area: "Finance workspace", tone: "accounts", icon: "check-circle", service: "maintenance" },
  "onboarding-invoices": { area: "Finance workspace", tone: "accounts", icon: "file-plus", service: "workflows" },
  "purchase-order-invoices": { area: "Finance workspace", tone: "accounts", icon: "file-text", service: "workflows" },
  "purchase-order-accounts": { area: "Finance workspace", tone: "accounts", icon: "credit-card", service: "workflows" },
};

// Where the Work areas open inside (the sub-pages INT-B builds: Guest relations and Client relations),
// with the words people use for each so search finds them. Names are exact: they travel in deep links.
export const GUEST_RELATIONS_SUBS = ["cleans", "bookings", "aircover", "reactive", "preventative"] as const;
export const CLIENT_RELATIONS_SUBS = ["onboarding", "enquiries", "licensing", "listings", "pricing", "reviews", "relisting", "purchases"] as const;
// Management's own tabs and Accounts' tabs, as the screens know them today.
export const MANAGEMENT_SUBS = ["queue", "people", "properties", "productivity", "performance", "team", "training", "limits", "decisions", "reflections", "dailytasks", "rota", "responsibilities", "access"] as const;
export const ACCOUNTS_SUBS = ["expenses", "payouts", "statements", "receivable", "performance", "aircover"] as const;
export type WorkSub = { view: WorkView; sub: string; label: string; words: string };
export const WORK_SUBS: readonly WorkSub[] = [
  { view: "stays", sub: "cleans", label: "Changeover cleans", words: "cleans cleaning changeovers turnover guest relations" },
  { view: "stays", sub: "bookings", label: "Direct bookings", words: "direct bookings long stays offers follow up guest relations" },
  { view: "stays", sub: "aircover", label: "AirCover claims", words: "aircover air cover claims damage guests" },
  { view: "stays", sub: "reactive", label: "Reactive maintenance", words: "reactive maintenance repairs fix broken guest relations" },
  { view: "stays", sub: "preventative", label: "Preventative maintenance", words: "preventative maintenance routine garden bins safety visits" },
  { view: "clients", sub: "onboarding", label: "Property onboarding", words: "onboarding new properties stages progress client relations" },
  { view: "clients", sub: "enquiries", label: "New enquiries", words: "enquiries leads owners new clients estimate" },
  { view: "clients", sub: "licensing", label: "Licensing", words: "licensing licence license registration renewal" },
  { view: "clients", sub: "listings", label: "Listing health", words: "listing health listings live checks" },
  { view: "clients", sub: "pricing", label: "Pricing", words: "pricing prices rates empty nights" },
  { view: "clients", sub: "reviews", label: "Guest reviews", words: "reviews ratings guest feedback scores" },
  { view: "clients", sub: "relisting", label: "Re-listing", words: "relisting re-listing relist hidden listing" },
  { view: "clients", sub: "purchases", label: "Purchase orders", words: "purchase orders purchases furnishing supplies ordering" },
];
const SUBS_BY_VIEW: Partial<Record<WorkView, readonly string[]>> = {
  stays: GUEST_RELATIONS_SUBS, clients: CLIENT_RELATIONS_SUBS, management: MANAGEMENT_SUBS, accounts: ACCOUNTS_SUBS,
};
// Whether a Work area opens a sub-page by that name. Areas whose tabs are not listed here (Cleans,
// Maintenance, All work) take their tab names from their own screens, so any name passes.
export const isWorkSub = (view: WorkView, sub: string) => { const known = SUBS_BY_VIEW[view]; return !known || known.includes(sub); };

// Every top-level page a deep link can name. "activity" is no longer a menu entry; it stays here so old
// links resolve (they open Messages, Updates).
export const PAGE_SECTIONS: readonly WorkspaceSection[] = ["home", "todo", "work", "calendar", "inbox", "decisions", "properties", "analytics", "favorites", "approvals", "statements", "enquiries", "feedback", "moderation", "help", "activity"];
export type DeepLink = { section: WorkspaceSection; view?: WorkView; sub?: string; anchor?: string; open?: string; workId?: string; messagesTab?: "updates"; redirected?: boolean };
// Client enquiries has one home, the Enquiries chip in Client relations (Lee, 16 October 2026). "Client enquiries" in
// the menu, its old page links and the enquiry notices open it there; the page itself is no longer a page of its own.
export const CLIENT_ENQUIRIES_LINK: DeepLink = { section: "work", view: "clients", sub: "enquiries", redirected: true };
// Resolves a page by name to where it opens now, or null when there is no such page.
export function pageLink(section: string): DeepLink | null {
  if (!(PAGE_SECTIONS as readonly string[]).includes(section)) return null;
  if (section === "activity") return { section: "inbox", messagesTab: "updates", redirected: true };
  if (section === "enquiries") return CLIENT_ENQUIRIES_LINK;
  return { section: section as WorkspaceSection };
}
// Resolves a Home tool, search result or old link to where it opens now, or null when it names a
// Work sub-page that does not exist. The Hub and Updates are gone: their links land in To-do, Management
// approvals and Messages. Work → Calendar is the Calendar page; Guest relations → Guest inbox is Messages.
export function deepLinkFor(target: HomeToolTarget): DeepLink | null {
  if (target.kind === "tab") {
    const link = pageLink(target.tab);
    return link && target.anchor ? { ...link, anchor: target.anchor } : link;
  }
  if (target.kind !== "work") return null;
  const extra = { ...(target.anchor ? { anchor: target.anchor } : {}), ...(target.open ? { open: target.open } : {}), ...(target.workId ? { workId: target.workId } : {}) };
  if (target.view === "calendar") return { section: "calendar", ...extra };
  if (target.view === "hub") return { section: target.sub === "approvals" ? "decisions" : "todo", redirected: true, ...extra };
  if (target.view === "stays" && target.sub === "inbox") return { section: "inbox", redirected: true };
  if (target.sub && !isWorkSub(target.view, target.sub)) return null;
  return { section: "work", view: target.view, ...(target.sub ? { sub: target.sub } : {}), ...extra };
}

// The live workspace's bottom bar on phones, at most five items. Calendar, Messages and To-do sit near
// the top for the team; Hub and Updates are gone (Updates is a tab inside Messages). Owners keep theirs.
export type BarItem = { value: WorkspaceSection; label: string; icon: string };
export const PHONE_BAR_MAX = 5;
export function phoneBarFor(role: string): readonly BarItem[] {
  if (role === "client") return ownerNavigation();
  const item = (value: WorkspaceSection, label: string, icon: string): BarItem => ({ value, label, icon });
  const home = item("home", "Home", "home"), todo = item("todo", "To-do", "check-circle"), calendar = item("calendar", "Calendar", "calendar"), messages = item("inbox", "Messages", "message-circle");
  // Cleaners: Calendar replaces Properties (now in the Menu), so their week with checkout and arrival times is one tap away.
  if (role === "cleans") return [home, todo, item("work", "Cleans", "check-square"), calendar, messages];
  if (role === "cleaning_manager") return [home, todo, item("work", "Cleans", "check-square"), item("properties", "Properties", "key"), messages];
  if (role === "ready") return [home, item("work", "Maintenance", "tool"), calendar, todo, messages];
  // Accounts: invoices and owner statements stay the daily work.
  if (role === "accounts") return [home, todo, item("work", "Invoices", "file-text"), item("statements", "Statements", "pie-chart"), messages];
  return [home, todo, item("work", "Work", "check-square"), calendar, messages];
}

export function navigationFor(role: WorkspaceRole) {
  if (role === "cleans") return [
    { value: "home", label: "Home", icon: "home" },
    { value: "work", label: "Jobs", icon: "check-square" },
    { value: "calendar", label: "Calendar", icon: "calendar" },
    { value: "inbox", label: "Inbox", icon: "message-circle" },
    { value: "more", label: "Tools", icon: "grid" },
  ] as const;
  // Clients: messages sit in the centre; tools stay reachable from Home and each property.
  if (role === "client") return [
    { value: "home", label: "Home", icon: "home" },
    { value: "properties", label: "Properties", icon: "key" },
    { value: "inbox", label: "Inbox", icon: "message-circle" },
    { value: "approvals", label: "Approvals", icon: "check-circle" },
    { value: "analytics", label: "Reports", icon: "bar-chart-2" },
  ] as const;
  // Accounts: invoices to approve and owner statements are the daily work.
  if (role === "accounts") return [
    { value: "home", label: "Home", icon: "home" },
    { value: "work", label: "Invoices", icon: "file-text" },
    { value: "analytics", label: "Statements", icon: "bar-chart-2" },
    { value: "inbox", label: "Inbox", icon: "message-circle" },
    { value: "more", label: "Tools", icon: "grid" },
  ] as const;
  if (role === "admin" || role === "super_admin") return [
    { value: "home", label: "Home", icon: "home" },
    { value: "work", label: "Work", icon: "check-square" },
    { value: "properties", label: "Properties", icon: "key" },
    { value: "analytics", label: "Reports", icon: "bar-chart-2" },
    { value: "more", label: "Tools", icon: "grid" },
  ] as const;
  return [
    { value: "home", label: "Home", icon: "home" },
    { value: "work", label: "Work", icon: "check-square" },
    { value: "properties", label: "Properties", icon: "key" },
    { value: "inbox", label: "Inbox", icon: "message-circle" },
    { value: "more", label: "Tools", icon: "grid" },
  ] as const;
}

// The owner's destinations, each once: Home, Properties, Inbox, Approvals and Reports (stays,
// earnings, statements and mailbox), plus Tools in the sidebar on wide screens. Repairs and other
// requests open from Home's tiles.
export function ownerNavigation(wide = false) {
  return [...navigationFor("client"), ...(wide ? [{ value: "help", label: "Tools", icon: "grid" }] as const : [])];
}

export function searchFeatureTitles<T extends Pick<(typeof MODULES)[number], "name">>(tools: T[], query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  return tools.filter(tool => tool.name.toLocaleLowerCase().includes(normalized));
}

export function calendarCells(month: string): (string | null)[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("Invalid calendar month");
  const [year, number] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, number - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const cells: (string | null)[] = Array(offset).fill(null);
  for (let day = 1; day <= days; day++) cells.push(`${month}-${String(day).padStart(2, "0")}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}
