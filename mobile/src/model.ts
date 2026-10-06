import {
  MODULES,
  defaultModulesForRole,
  type ModuleId,
  type WorkspaceRole,
} from "../../lib/modules";
import {
  buildAnalytics,
  scopeAnalytics,
  presetPeriod,
  periodError,
  periodLabel,
  parseAnalyticsDate,
  dateKey,
  type AnalyticsPeriod,
} from "../../lib/analytics";
import {
  workflows,
  maintenance,
  cleans,
  onboarding,
  properties,
  operations,
  communications,
} from "../../preview/fixtures";
import { searchFeatureTitles, WORKSPACE_MAP } from "../../lib/workspace-map";

export {
  buildAnalytics,
  presetPeriod,
  periodError,
  periodLabel,
  parseAnalyticsDate,
  dateKey,
};
export type { WorkspaceRole, ModuleId, AnalyticsPeriod };
export type Tool = (typeof MODULES)[number];
export const roles: { value: WorkspaceRole; label: string }[] = [
  { value: "super_admin", label: "Super admin" },
  { value: "admin", label: "Management" },
  { value: "stays", label: "Stays team" },
  { value: "cleans", label: "Cleaner" },
  { value: "cleaning_manager", label: "Cleaning manager" },
  { value: "ready", label: "Ready team" },
  { value: "accounts", label: "Accounts team" },
  { value: "client", label: "Client" },
];
export function toolsFor(role: WorkspaceRole) {
  const allowed = new Set(defaultModulesForRole(role));
  return MODULES.filter((tool) => allowed.has(tool.id));
}
export function snapshotFor(role: WorkspaceRole) {
  return scopeAnalytics(
    {
      role,
      email: role === "cleans" ? "cleaner@example.com" : "preview@example.com",
      modules: defaultModulesForRole(role),
    },
    { workflows, maintenance, cleans, onboarding, properties },
  );
}
export type PreviewRecord = {
  id: string;
  title: string;
  subtitle: string;
  status: string;
  date: string;
  propertyName?: string;
  details?: string;
};
const boards: Partial<Record<ModuleId, string>> = {
  "maintenance-reporting": "spot_maintenance",
  "cleaner-performance": "clean_issues",
  "new-property-inspection-board": "new_property_inspection",
  "property-furnishing-board": "property_furnishing",
  "routine-bin-garden-board": "routine_bin_garden",
  "aircover-reporting": "aircover_reporting",
  "clean-property-onboarding": "clean_property_onboarding",
  "onboarding-invoices": "onboarding_invoices",
  "purchase-order-invoices": "purchase_order_invoices",
  "purchase-order-accounts": "purchase_order_accounts",
};
export function recordsFor(role: WorkspaceRole, id: ModuleId): PreviewRecord[] {
  if (!defaultModulesForRole(role).includes(id)) return [];
  if (id === "client-mailbox")
    return cleans.mail
      .filter((mail) => mail.clientEmail === "preview@example.com")
      .map((mail) => ({
        id: mail.id,
        title: mail.propertyName,
        subtitle: mail.note,
        date: new Date(mail.createdAt * 1000).toISOString().slice(0, 10),
        status: mail.status,
      }));
  if (
    ["property-database", "client-dashboard", "clean-client-database"].includes(
      id,
    )
  )
    return propertiesFor(role).map((property) => ({
      id: property.id,
      title: property.propertyName,
      subtitle: property.region,
      status: property.status,
      date: "",
      propertyName: property.propertyName,
    }));
  if (
    [
      "cleaning-schedule",
      "cleaner-performance",
      "cleans-invoices",
      "clean-reporting",
    ].includes(id)
  )
    return cleans.tickets
      .filter(
        (ticket) =>
          (role !== "cleans" || ticket.assignedCleanerId === "demo-cleaner") &&
          (id !== "cleans-invoices" || ["approved", "invoiced"].includes(ticket.status)),
      )
      .map((ticket) => ({
        id: ticket.id,
        title: ticket.propertyName,
        subtitle: ticket.assignedCleanerName || "Unassigned",
        status: ticket.status,
        date: ticket.cleanDate,
        propertyName: ticket.propertyName,
        details: ticket.maintenanceNotes || "No maintenance notes recorded for this sample clean.",
      }));
  if (id === "cleaner-database")
    return cleans.cleaners.map((cleaner) => ({
      id: cleaner.id,
      title: cleaner.fullName,
      subtitle: `${cleaner.assignedProperties} assigned properties`,
      status: cleaner.status,
      date: "",
    }));
  if (id === "ready-schedule") return operations.readyEvents.map(event => ({
    id: event.id, title: event.title, subtitle: event.propertyName,
    status: event.status, date: event.date, propertyName: event.propertyName,
  }));
  if (id === "guest-communication") return communications.threads.map(thread => ({
    id: thread.id, title: thread.subject, subtitle: thread.propertyName,
    status: thread.unread ? "unread" : "open", date: thread.lastInboundAt ? new Date(thread.lastInboundAt * 1000).toISOString().slice(0, 10) : "",
    propertyName: thread.propertyName, details: thread.messages.map(message => message.body).join("\n\n"),
  }));
  if (["property-onboarding", "client-purchase-order-quotes"].includes(id)) return onboarding.cases
    .filter(item => role !== "client" || item.clientEmail.trim().toLowerCase() === "preview@example.com")
    .filter(item => id !== "client-purchase-order-quotes" || item.status === "purchase_order_review")
    .map(item => ({ id: item.id, title: item.propertyName, subtitle: item.reference,
      status: item.status, date: new Date(item.createdAt * 1000).toISOString().slice(0, 10), propertyName: item.propertyName }));
  if (["client-property-maintenance", "stays-maintenance-reporting", "maintenance-reconciliation"].includes(id)) return maintenance.tickets
    .filter(item => role !== "client" || item.clientEmail.trim().toLowerCase() === "preview@example.com")
    .filter(item => id !== "maintenance-reconciliation" || item.accountsStatus !== "not_created")
    .map(item => ({ id: item.id, title: item.summary, subtitle: item.propertyName,
      status: item.status, date: item.scheduledDate || "", propertyName: item.propertyName, details: item.details }));
  if (boards[id])
    return workflows.tickets
      .filter((ticket) => ticket.board === boards[id])
      .map((ticket) => ({
        id: ticket.id,
        title: ticket.title,
        subtitle: ticket.propertyName,
        status: ticket.status,
        date: ticket.dueDate || "",
        propertyName: ticket.propertyName,
        details: ticket.details,
      }));
  return [];
}

export function propertiesFor(role: WorkspaceRole) {
  if (role === "client") return properties.properties.filter(property => property.ownerEmail.trim().toLowerCase() === "preview@example.com");
  if (role === "cleans") {
    const assigned = new Set(cleans.properties.filter(property => property.cleanerId === "demo-cleaner").map(property => property.id));
    return properties.properties.filter(property => assigned.has(property.id));
  }
  return properties.properties;
}

export type WorkItem = { tool: Tool; record: PreviewRecord };
const actionable: ModuleId[] = ["cleaning-schedule", "property-furnishing-board", "new-property-inspection-board", "routine-bin-garden-board", "clean-property-onboarding", "aircover-reporting", "maintenance-reporting", "client-property-maintenance", "property-onboarding", "client-purchase-order-quotes"];
export function workFor(role: WorkspaceRole): WorkItem[] {
  // Reporting views reuse operational records; count each underlying item once.
  const seen = new Set<string>();
  return toolsFor(role).filter(tool => actionable.includes(tool.id)).flatMap(tool => recordsFor(role, tool.id).map(record => ({ tool, record })))
    .filter(item => { if (seen.has(item.record.id)) return false; seen.add(item.record.id); return true; })
    .sort((a, b) => Number(isComplete(a.record.status)) - Number(isComplete(b.record.status)) || (a.record.date || "9999").localeCompare(b.record.date || "9999") || a.record.title.localeCompare(b.record.title));
}
export const isComplete = (status: string) => ["complete", "approved", "invoiced", "closed", "reconciled", "live", "reviewed", "archived"].includes(status);
export const isWaiting = (status: string) => ["new", "scheduled", "unassigned", "approval_pending", "purchase_order_review", "enquiry_received", "agreement_pending", "invoices_pending"].includes(status);
export function inboxFor(role: WorkspaceRole) {
  return toolsFor(role).filter(tool => ["guest-communication", "client-mailbox"].includes(tool.id)).flatMap(tool => recordsFor(role, tool.id).map(record => ({tool, record})));
}
export function approvalItems(role: WorkspaceRole) {
  return workFor(role).filter(item => ["client-purchase-order-quotes", "property-onboarding", "client-property-maintenance"].includes(item.tool.id) && ["approval_pending", "purchase_order_review", "estimate_received", "agreement_pending"].includes(item.record.status));
}
export function filteredTools(role: WorkspaceRole, query: string, area = "All", saved?: string[]) {
  return searchFeatureTitles(toolsFor(role), query).filter(tool => (area === "All" || WORKSPACE_MAP[tool.id].area === area || WORKSPACE_MAP[tool.id].tone === area) && (!saved || saved.includes(tool.id)));
}
export function upcomingFor(role: WorkspaceRole) {
  const id: ModuleId =
    role === "cleans"
      ? "cleaning-schedule"
      : role === "client"
        ? "client-mailbox"
        : "new-property-inspection-board";
  return {
    tool: toolsFor(role).find((tool) => tool.id === id),
    records: recordsFor(role, id).slice(0, 3),
  };
}
