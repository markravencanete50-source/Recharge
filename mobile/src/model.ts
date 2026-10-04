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
} from "../../preview/fixtures";

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
  { value: "admin", label: "Admin" },
  { value: "stays", label: "Stays team" },
  { value: "cleans", label: "Cleaner" },
  { value: "ready", label: "Ready team" },
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
};
const boards: Partial<Record<ModuleId, string>> = {
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
    return properties.properties.map((property) => ({
      id: property.id,
      title: property.propertyName,
      subtitle: property.region,
      status: property.status,
      date: "",
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
          role !== "cleans" || ticket.assignedCleanerId === "demo-cleaner",
      )
      .map((ticket) => ({
        id: ticket.id,
        title: ticket.propertyName,
        subtitle: ticket.assignedCleanerName || "Unassigned",
        status: ticket.status,
        date: ticket.cleanDate,
      }));
  if (id === "cleaner-database")
    return cleans.cleaners.map((cleaner) => ({
      id: cleaner.id,
      title: cleaner.fullName,
      subtitle: `${cleaner.assignedProperties} assigned properties`,
      status: cleaner.status,
      date: "",
    }));
  if (boards[id])
    return workflows.tickets
      .filter((ticket) => ticket.board === boards[id])
      .map((ticket) => ({
        id: ticket.id,
        title: ticket.title,
        subtitle: ticket.propertyName,
        status: ticket.status,
        date: ticket.dueDate || "",
      }));
  return [];
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
