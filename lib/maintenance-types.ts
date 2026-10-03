export const MAINTENANCE_CATEGORIES = [
  "Plumbing",
  "Heating & hot water",
  "Electrical",
  "Access & locks",
  "Appliances",
  "Furniture & fittings",
  "Decorating",
  "Pest control",
  "Safety",
  "General repair",
] as const;

export type MaintenanceCategory = (typeof MAINTENANCE_CATEGORIES)[number];
export type MaintenanceStatus =
  | "new"
  | "quote_required"
  | "approval_pending"
  | "ready_to_schedule"
  | "scheduled"
  | "in_progress"
  | "management_review"
  | "accounts_pending"
  | "accounts_paid"
  | "reconciled"
  | "closed";
export type ApprovalState = "not_required" | "pending" | "approved" | "rejected";
export type EvidenceKind = "issue" | "completion" | "invoice";

export type MaintenanceUpdate = {
  id: string;
  eventType: string;
  note: string;
  actorName: string;
  createdAt: number;
};

export type MaintenanceEvidence = {
  id: string;
  kind: EvidenceKind;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedByName: string;
  createdAt: number;
};

export type MaintenanceTicket = {
  id: string;
  reference: string;
  source: "manual" | "guest_communication" | "clean";
  propertyName: string;
  propertyAddress: string;
  clientName: string;
  clientEmail: string;
  guestName: string;
  bookingReference: string;
  hostawayListingId: string | null;
  hostawayReservationId: string | null;
  reservationArrivalDate: string | null;
  reservationDepartureDate: string | null;
  reservationChannel: string;
  category: MaintenanceCategory;
  priority: "normal" | "urgent" | "emergency";
  summary: string;
  details: string;
  troubleshootingCompletedItems: string[];
  troubleshootingNotes: string;
  troubleshootingOutcome: "pending" | "resolved" | "ready_required";
  physicalRepair: boolean;
  status: MaintenanceStatus;
  readyReference: string | null;
  quoteAmountPence: number | null;
  workRequired: string;
  proposedRepairDate: string | null;
  approvalRoute: "unassessed" | "none" | "management" | "client";
  managementApproval: ApprovalState;
  clientApproval: ApprovalState;
  scheduledDate: string | null;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  assignedReadyEmail: string | null;
  assignedReadyName: string | null;
  finalApproval: ApprovalState;
  accountsStatus: "not_created" | "pending" | "paid" | "reconciled";
  paymentReference: string;
  paidAt: number | null;
  paidByName: string | null;
  invoiceReference: string;
  closedReason: string;
  closedAt: number | null;
  closedByName: string | null;
  raisedByName: string;
  completedAt: number | null;
  managementApprovedAt: number | null;
  reconciledAt: number | null;
  createdAt: number;
  updatedAt: number;
  updates: MaintenanceUpdate[];
  evidence: MaintenanceEvidence[];
};

export type MaintenanceThreshold = {
  category: MaintenanceCategory;
  managementLimitPence: number;
  clientLimitPence: number;
  configured: boolean;
};

export type MaintenancePermissions = {
  stays: boolean;
  ready: boolean;
  approvals: boolean;
  accounts: boolean;
  thresholds: boolean;
  client: boolean;
};

export type MaintenancePropertyOption = {
  id: string;
  propertyName: string;
  propertyAddress: string;
  clientName: string;
  clientEmail: string;
  hostawayListingIds: string[];
};

export type MaintenanceData = {
  available: boolean;
  permissions: MaintenancePermissions;
  tickets: MaintenanceTicket[];
  thresholds: MaintenanceThreshold[];
  properties: MaintenancePropertyOption[];
};
