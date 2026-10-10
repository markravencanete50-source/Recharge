import { MODULES, type ModuleId, type WorkspaceRole } from "./modules";

export type WorkspaceSection = "home" | "work" | "properties" | "inbox" | "more" | "workspace" | "analytics" | "calendar" | "approvals" | "help" | "activity" | "training" | "statements" | "favorites" | "enquiries";
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
