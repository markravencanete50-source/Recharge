import type { ManagementProperty, PropertyDatabaseData } from "@/lib/property-database";
import type { WorkflowData } from "@/lib/workflows";
import type { CommunicationCentreData } from "@/lib/communications";
import { MAINTENANCE_CATEGORIES, type MaintenanceData } from "@/lib/maintenance-types";
import type { OnboardingData } from "@/lib/onboarding-types";
import type { CleansData } from "@/lib/cleans-types";
import type { OperationsData } from "@/lib/operations";
import type { OwnerStatementsData } from "@/lib/owner-statements";
import type { TeamStructureData } from "@/lib/team";
import { defaultModulesForRole, type WorkspaceRole } from "@/lib/modules";

// Fictional fixtures only. No exported client records, credentials or integrations.
const now = 1791028800;
const date = "2026-10-03";
function property(id: string, name: string, region: string): ManagementProperty {
  return {
    id, propertyName: name, propertyAddress: "Example address, Scotland", region,
    hostawayListingId: null, hostawayListingIds: [], clickupTaskId: null, clickupUrl: "",
    sourceStatus: "", sourcePriority: "", sourceDueAt: "", sourceCreatedAt: "", sourceUpdatedAt: "",
    propertyType: "Apartment", bedrooms: "2", beds: "2", bathrooms: "1", wcCount: "1", parking: "", garden: "",
    ownerName: "Example owner", ownerCompany: "Example Property Company", ownerEmail: "preview@example.com", ownerPhone: "",
    correspondenceAddress: "", existingClient: "", accessCode: "", accessInfo: "", guidebookUrl: "", listingLinks: [],
    payoutSchedule: "Monthly", managementFeePercent: 15, cleaningCostPence: 6500, payoutNotes: "Sample data",
    currentlyOperating: "", furnishingPreference: "", licensingPreference: "", startPreference: "", enquiryReason: "", additionalNotes: "Fictional preview property",
    sourceDescription: "", sourceCustomFields: {}, sourceChecklists: [], sourceComments: [], sourceAttachments: [], sourceLinkedTaskIds: [], sourceRecords: [],
    clickupImportedAt: null, status: "live", lastSyncedAt: null, updatedAt: now,
  };
}
const demoProperties = [property("demo-edinburgh", "Example Edinburgh Apartment", "Edinburgh & Lothians"), property("demo-glasgow", "Example Glasgow Apartment", "Glasgow & Clyde")];

export const properties: PropertyDatabaseData = {
  available: true, hostawayConnected: false, canEdit: false, properties: demoProperties,
  clients: [{key: "example-company", companyName: "Example Property Company", ownerName: "Example owner", directorNames: [], ownerEmail: "preview@example.com", ownerPhone: "", properties: demoProperties}],
  reporting: {newEnquiries: {week: 0, month: 0, quarter: 0, year: 0}, signedUp: [], strikeRate: 0},
};
export const accessUsers = (["super_admin", "admin", "stays", "cleans", "ready", "client"] as WorkspaceRole[]).map(role => ({
  email: `${role}@example.com`, fullName: `Example ${role} user`, responsibilities: "Fictional preview team member", role,
  modules: defaultModulesForRole(role), status: "active" as const,
}));
export const workflows: WorkflowData = {
  available: true,
  onboardings: [{id: "demo-onboarding", propertyName: "Example Glasgow Apartment", propertyAddress: "Example address, Scotland", progress: 60, status: "active", createdByName: "Preview user", completedAt: null, createdAt: now}],
  tickets: [{id: "demo-inspection", board: "new_property_inspection", lane: "New", sourceBusiness: "Stays", targetBusiness: "Ready", propertyName: "Example Glasgow Apartment", propertyAddress: "Example address, Scotland", title: "Sample property inspection", details: "Fictional task for reviewing the workflow layout.", priority: "normal", dueDate: date, status: "new", triggerType: "manual_referral", createdByName: "Preview user", createdAt: now}],
};
// A dated, fictional workload makes the chart layout and period filter reviewable.
workflows.tickets.push(...Array.from({ length: 24 }, (_, i) => ({
  ...workflows.tickets[0], id: `demo-workload-${i}`, title: `Sample workflow ${i + 1}`,
  board: (["property_furnishing", "routine_bin_garden", "aircover_reporting"] as const)[i % 3],
  status: (["new", "in_progress", "complete"] as const)[i % 3],
  createdAt: now - ((i * 7) % 29) * 86400,
})));
export const communications: CommunicationCentreData = {
  available: true, integrations: {hostaway: false, email: false, whatsapp: false, bonline: false}, workflows: [], calls: [], schedule: [],
  threads: [{id: "demo-conversation", source: "guests", propertyName: "Example Edinburgh Apartment", guestName: "Example guest", senderAddress: "guest@example.com", subject: "Sample check-in question", hostawayListingId: "", hostawayReservationId: "", openedAt: null, unread: true, unreadCount: 1, status: "open", assignedToEmail: null, assignedToName: null, lastInboundAt: now, lastOutboundAt: null,
    messages: [{id: "demo-message", source: "guests", direction: "inbound", body: "Hello, what time can we check in? This is a sample message.", attachments: [], sentAt: now, respondedAt: null, respondedByEmail: null, respondedByName: null, isAutomated: false}]}],
};
export const maintenance: MaintenanceData = {
  available: true, permissions: {stays: false, ready: false, approvals: false, accounts: false, thresholds: false, client: false}, tickets: [],
  thresholds: MAINTENANCE_CATEGORIES.map(category => ({category, managementLimitPence: 0, clientLimitPence: 0, configured: false})),
  properties: demoProperties.map(p => ({id: p.id, propertyName: p.propertyName, propertyAddress: p.propertyAddress, clientName: p.ownerName, clientEmail: p.ownerEmail, hostawayListingIds: []})),
};
export const onboarding: OnboardingData = {available: true, mode: "staff", emailConnected: false, cases: []};
export const cleans: CleansData = {
  available: true, hostawayConnected: false, tickets: [], mail: [], replenishments: [], reviews: [], onboarding: [],
  cleaners: [{id: "demo-cleaner", fullName: "Example cleaner", email: "cleaner@example.com", phone: "", notes: "Fictional preview team member", status: "active", assignedProperties: 2, approvedCleans: 0, unsuccessfulCleans: 0, successRate: null}],
  properties: demoProperties.map(p => ({id: p.id, hostawayListingId: null, propertyName: p.propertyName, propertyAddress: p.propertyAddress, accessInstructions: "No real access details in preview", clientName: p.ownerName, clientEmail: p.ownerEmail, cleanerId: "demo-cleaner", cleanerName: "Example cleaner", cleanPricePence: 6500, status: "active"})),
};
export const operations: OperationsData = {
  available: true, properties: demoProperties.map(p => ({id: p.id, name: p.propertyName, address: p.propertyAddress, region: p.region, status: p.status, clientEmail: p.ownerEmail})),
  routineMaintenanceBookings: [], routineInspectionSubmissions: [],
  readyEvents: [{id: "demo-ready-event", date, endDate: date, type: "inspection", title: "Sample property inspection", propertyName: "Example Glasgow Apartment", status: "new", valuePence: 0}],
  listingTickets: [], listingDailyReport: null, listingChecksToday: 0, listingReporting: {airbnb: {}, booking: {}, suspensions: 0, relistings: 0}, pricingGaps: [], opportunities: [], weeklyScanCompletedPropertyIds: [], directBookingLeads: [], directBookingTickets: [], directBookingTouches: [], reports: [], lastSyncedAt: null,
};
export const ownerStatements: OwnerStatementsData = {
  available: true, connections: {hostaway: false, xero: false, airbnb: false, booking: false, vrbo: false, direct: false},
  properties: demoProperties.map(p => ({id: p.id, name: p.propertyName, ownerName: p.ownerName, ownerEmail: p.ownerEmail})), bookings: [], receipts: [], statements: [], lastSyncedAt: null,
};
export const team: TeamStructureData = {
  roles: [], coverage: [], regions: ["General", "Edinburgh & Lothians", "Glasgow & Clyde"], schedules: [],
  people: accessUsers.filter(user => user.role !== "client").map(user => ({id: user.role, fullName: user.fullName, email: user.email, department: user.role === "admin" || user.role === "super_admin" ? "leadership" : user.role, responsibilities: user.responsibilities, status: "active", roleIds: [], regions: ["General"]})),
};
