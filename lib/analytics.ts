import type { AccessProfile } from "./access";
import type { WorkflowData, WorkflowBoard } from "./workflow-types";
import type { MaintenanceData } from "./maintenance-types";
import type { CleansData } from "./cleans-types";
import type { OnboardingData } from "./onboarding-types";
import type { PropertyDatabaseData } from "./property-database-types";
import { isWorkspaceAdmin, type ModuleId } from "./modules";

export type AnalyticsInput = { workflows?: WorkflowData; maintenance?: MaintenanceData; cleans?: CleansData; onboarding?: OnboardingData; properties?: PropertyDatabaseData };
export type AnalyticsViewer = Pick<AccessProfile, "email" | "role" | "modules"> & { status?: AccessProfile["status"] };
export type AnalyticsPeriod = { from: string; to: string };
type SourceKey = "workflows" | "repairs" | "cleans" | "onboarding" | "mail";
type AnalyticsRecord = { date: string; status: "waiting" | "progress" | "complete"; count?: number };
export type AnalyticsSnapshot = {
  title: string; description: string; propertyLabel: string; propertyCount: number; propertyAvailable?: boolean;
  sources: { key: SourceKey; name: string; available: boolean; records: AnalyticsRecord[] }[];
};

export function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
const workspaceDate = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });
export function workspaceDateKey(milliseconds: number) {
  if (!Number.isFinite(milliseconds)) return "";
  const parts = workspaceDate.formatToParts(new Date(milliseconds));
  const part = (name: string) => parts.find(p => p.type === name)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
export function parseAnalyticsDate(value: string): Date | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return;
  const result = new Date(`${value}T12:00:00`);
  return Number.isFinite(result.getTime()) && dateKey(result) === value ? result : undefined;
}
export function presetPeriod(days: number, now = Date.now()): AnalyticsPeriod {
  if (!Number.isInteger(days) || days < 1 || days > 366) throw new Error("Choose between 1 and 366 days.");
  const end = parseAnalyticsDate(workspaceDateKey(now))!, start = new Date(end);
  start.setDate(start.getDate() - days + 1);
  return { from: dateKey(start), to: dateKey(end) };
}
export function periodError(period: AnalyticsPeriod) {
  if (!parseAnalyticsDate(period.from) || !parseAnalyticsDate(period.to)) return "Choose a valid start and end date.";
  if (period.from > period.to) return "The end date must be on or after the start date.";
  const count = (Date.parse(`${period.to}T00:00:00Z`) - Date.parse(`${period.from}T00:00:00Z`)) / 86400000 + 1;
  return count > 366 ? "Choose a range of up to 366 days." : "";
}
export function periodLabel(period: AnalyticsPeriod) {
  const format = (value: string) => parseAnalyticsDate(value)?.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) || value;
  return period.from === period.to ? format(period.from) : `${format(period.from)} to ${format(period.to)}`;
}

const boardModules: Record<WorkflowBoard, ModuleId> = {
  spot_maintenance: "maintenance-reporting", property_furnishing: "property-furnishing-board",
  new_property_inspection: "new-property-inspection-board", routine_bin_garden: "routine-bin-garden-board",
  clean_property_onboarding: "clean-property-onboarding", clean_issues: "cleaner-performance",
  aircover_reporting: "aircover-reporting", onboarding_invoices: "onboarding-invoices",
  purchase_order_invoices: "purchase-order-invoices", purchase_order_accounts: "purchase-order-accounts",
};
const cleanModules: ModuleId[] = ["clean-client-database", "cleaner-database", "cleaning-schedule", "cleaner-performance", "clean-property-onboarding", "cleans-invoices", "clean-reporting"];
function record(date: string, status: string, complete: string[], waiting: string[]): AnalyticsRecord {
  return { date, status: complete.includes(status) ? "complete" : waiting.includes(status) ? "waiting" : "progress" };
}
function timestampDate(seconds: number) { return workspaceDateKey(seconds * 1000); }

// Live callers run this on the server. Only dates and status categories leave
// this boundary, never client details, cleaner identities or private ticket text.
export function scopeAnalytics(viewer: AnalyticsViewer, input: AnalyticsInput): AnalyticsSnapshot {
  const admin = isWorkspaceAdmin(viewer.role);
  const active = viewer.status === undefined || viewer.status === "active";
  const can = (...modules: ModuleId[]) => active && (admin || modules.some(module => viewer.modules.includes(module)));
  const client = viewer.role === "client";
  const email = viewer.email.trim().toLowerCase();
  const owns = (value: string) => Boolean(email && value && value.trim().toLowerCase() === email);
  const cleanerIds = new Set((input.cleans?.cleaners || []).filter(cleaner => cleaner.status === "active" && owns(cleaner.email)).map(cleaner => cleaner.id));
  const personalCleans = viewer.role === "cleans";
  const title = admin ? "Workspace analytics" : client ? "My property analytics" : personalCleans ? "My cleaning analytics" : viewer.role === "cleaning_manager" ? "Cleaning team analytics" : viewer.role === "ready" ? "Ready analytics" : "Stays analytics";
  const description = admin ? "One clear picture across your workspace." : client ? "Your properties, requests and progress." : personalCleans ? "Your assigned cleans and progress." : "A clear picture of the work you can access.";
  const sources: AnalyticsSnapshot["sources"] = [];
  const add = (key: SourceKey, name: string, available: boolean | undefined, records: AnalyticsRecord[]) => sources.push({ key, name, available: available === true, records: available ? records : [] });
  const staysWorkflow = can("property-onboarding", "stays-maintenance-reporting", "property-database");
  if (!client && !personalCleans && can(...Object.values(boardModules), "property-onboarding", "stays-maintenance-reporting", "property-database")) {
    const tickets = (input.workflows?.tickets || []).filter(ticket => can(boardModules[ticket.board]) || (staysWorkflow && ticket.sourceBusiness === "Stays"));
    add("workflows", "Workflows", input.workflows?.available, tickets.map(t => record(timestampDate(t.createdAt), t.status, ["complete"], ["new"])));
  }
  if (can("stays-maintenance-reporting", "maintenance-reporting", "maintenance-reconciliation", "client-property-maintenance")) {
    const tickets = (input.maintenance?.tickets || []).filter(t => client ? owns(t.clientEmail) : admin || can("stays-maintenance-reporting") || (can("maintenance-reporting") && Boolean(t.readyReference)) || (can("maintenance-reconciliation") && t.accountsStatus !== "not_created"));
    add("repairs", "Maintenance", input.maintenance?.available, tickets.map(t => record(timestampDate(t.createdAt), t.status, ["closed", "reconciled"], ["new", "quote_required", "approval_pending"])));
  }
  if (!client && can(...cleanModules)) {
    const tickets = (input.cleans?.tickets || []).filter(t => !personalCleans || Boolean(t.assignedCleanerId && cleanerIds.has(t.assignedCleanerId)));
    add("cleans", personalCleans ? "My cleans" : "Cleans", input.cleans?.available, tickets.map(t => record(t.cleanDate, t.status, ["approved", "invoiced"], ["new", "scheduled", "unassigned"])));
  }
  if (client && can("property-onboarding")) {
    const cases = (input.onboarding?.cases || []).filter(t => owns(t.clientEmail));
    add("onboarding", "Onboarding", input.onboarding?.available, cases.map(t => record(timestampDate(t.createdAt), t.status, ["live", "not_proceeding"], ["enquiry_received", "agreement_pending", "onboarding_form", "purchase_order_review", "invoices_pending"])));
  }
  if (client && can("client-mailbox")) {
    const mail = (input.cleans?.mail || []).filter(t => owns(t.clientEmail));
    add("mail", "Mailbox", input.cleans?.available, mail.map(t => record(timestampDate(t.createdAt), t.status, ["reviewed", "archived"], ["new"])));
  }
  let propertyCount = 0;
  if (personalCleans && can(...cleanModules) && input.cleans?.available) propertyCount = input.cleans.properties.filter(p => p.status === "active" && Boolean(p.cleanerId && cleanerIds.has(p.cleanerId))).length;
  else if (can("property-database", "client-dashboard") && input.properties?.available) propertyCount = input.properties.properties.filter(p => !client || owns(p.ownerEmail)).length;
  else if (!client && can(...cleanModules) && input.cleans?.available) propertyCount = input.cleans.properties.filter(p => p.status === "active" && (!personalCleans || Boolean(p.cleanerId && cleanerIds.has(p.cleanerId)))).length;
  else if (input.maintenance?.available && sources.some(s => s.key === "repairs")) propertyCount = input.maintenance.properties.filter(p => !client || owns(p.clientEmail)).length;
  const propertyAvailable = Boolean((personalCleans && can(...cleanModules) && input.cleans?.available) || (can("property-database", "client-dashboard") && input.properties?.available) || (!client && can(...cleanModules) && input.cleans?.available) || (input.maintenance?.available && sources.some(s => s.key === "repairs")));
  return { title, description, propertyCount, propertyAvailable, propertyLabel: personalCleans ? "Assigned properties" : client ? "My properties" : "Properties", sources };
}

export function buildAnalytics(input: AnalyticsSnapshot, selected: AnalyticsPeriod | number, now = Date.now()) {
  const period = typeof selected === "number" ? presetPeriod(selected, now) : selected;
  const error = periodError(period);
  if (error) throw new Error(error);
  const sources = input.sources.map(source => ({ ...source, records: source.available ? source.records.filter(t => parseAnalyticsDate(t.date) && t.date >= period.from && t.date <= period.to) : [] }));
  const records = sources.flatMap(s => s.records);
  const sum = (items: AnalyticsRecord[]) => items.reduce((n, item) => n + (item.count ?? 1), 0);
  const total = sum(records), complete = sum(records.filter(t => t.status === "complete")), waiting = sum(records.filter(t => t.status === "waiting"));
  const progress = sum(records.filter(t => t.status === "progress"));
  const other = total - waiting - complete - progress;
  const status = [{ name: "Completed", value: complete, kind: "complete" }, { name: "Waiting", value: waiting, kind: "waiting" }, { name: "In progress", value: progress, kind: "progress" }, ...(other ? [{ name: "Other", value: other, kind: "other" }] : [])];
  const trend: ({ key: string; date: string; recorded: number; completed: number; waiting: number } & Partial<Record<SourceKey, number>>)[] = [];
  const day = parseAnalyticsDate(period.from)!;
  while (dateKey(day) <= period.to) {
    const key = dateKey(day);
    const daily = records.filter(t => t.date === key);
    trend.push({ key, date: day.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }), recorded: sum(daily), completed: sum(daily.filter(t => t.status === "complete")), waiting: sum(daily.filter(t => t.status === "waiting")), ...Object.fromEntries(sources.map(s => [s.key, sum(s.records.filter(t => t.date === key))])) });
    // Calendar arithmetic preserves local days through daylight-saving changes.
    day.setDate(day.getDate() + 1);
  }
  return { total, complete, waiting, properties: (input.propertyAvailable ?? sources.some(s => s.available)) ? input.propertyCount : null, status, trend, queues: sources.map(s => ({ name: s.name, value: sum(s.records) })), sources: sources.map(({ key, name, available }) => ({ key, name, available })) };
}

// Kept for existing callers; role-aware boards use server-scoped snapshots.
export function buildWorkspaceAnalytics(input: AnalyticsInput, period: AnalyticsPeriod | number, now = Date.now()) {
  return buildAnalytics({ title: "", description: "", propertyLabel: "", propertyCount: 0, sources: [
    {key: "workflows", name: "Workflows", available: input.workflows?.available === true, records: (input.workflows?.tickets || []).map(t => record(timestampDate(t.createdAt), t.status, ["complete"], ["new"]))},
    {key: "repairs", name: "Maintenance", available: input.maintenance?.available === true, records: (input.maintenance?.tickets || []).map(t => record(timestampDate(t.createdAt), t.status, ["closed", "reconciled"], ["new", "quote_required", "approval_pending"]))},
    {key: "cleans", name: "Cleans", available: input.cleans?.available === true, records: (input.cleans?.tickets || []).map(t => record(t.cleanDate, t.status, ["approved", "invoiced"], ["new", "scheduled", "unassigned"]))},
  ] }, period, now);
}
