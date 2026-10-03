import type { WorkspaceRole } from "@/lib/modules";

export type PurchaseOrderWorkspace =
  | "stays"
  | "ready"
  | "management"
  | "client"
  | "accounts";

export type PurchaseOrderStatus =
  | "new"
  | "ready_draft"
  | "management_review"
  | "revision_requested"
  | "client_review"
  | "client_rejected"
  | "client_accepted"
  | "purchasing"
  | "reconciliation"
  | "complete";

export type PurchaseOrderFile = {
  id: string;
  orderId: string;
  itemId: string;
  kind: "receipt" | "photo";
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedByName: string;
  createdAt: number;
};

export type PurchaseOrderItem = {
  id: string;
  orderId: string;
  area: string;
  name: string;
  requiredQty: number;
  inPropertyQty: number;
  estimateUnitCostPence: number;
  actualUnitCostPence: number;
  note: string;
  position: number;
  files: PurchaseOrderFile[];
};

export type PurchaseOrderCase = {
  id: string;
  reference: string;
  propertyName: string;
  clientName: string;
  clientEmail: string;
  propertyType: string;
  bedrooms: number;
  beds: number;
  sofaBeds: number;
  bathrooms: number;
  livingRooms: number;
  guests: number;
  notes: string;
  status: PurchaseOrderStatus;
  labourEstimatePence: number;
  rechargeFeePence: number;
  readyInvoicePence: number;
  managementNotes: string;
  clientDecisionNotes: string;
  clientInvoiceStatus: "not_created" | "to_send" | "sent" | "paid";
  readyInvoiceStatus: "not_requested" | "requested" | "received" | "settled";
  reconciliationStatus:
    | "not_started"
    | "balanced"
    | "ready_refund_due"
    | "ready_extra_due"
    | "settled";
  createdByEmail: string;
  createdByName: string;
  createdAt: number;
  updatedAt: number;
  items: PurchaseOrderItem[];
  estimatedItemsTotalPence: number;
  approvedClientTotalPence: number;
  actualItemsTotalPence: number;
  actualTotalPence: number;
  balancePence: number;
};

export type PurchaseOrderData = {
  available: boolean;
  role: WorkspaceRole;
  orders: PurchaseOrderCase[];
};
