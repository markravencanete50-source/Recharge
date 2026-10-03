export const ONBOARDING_STATUSES = [
  "enquiry_received",
  "estimate_drafting",
  "estimate_received",
  "reviewing",
  "not_proceeding",
  "agreement_pending",
  "onboarding_form",
  "inspection_to_book",
  "inspection_booked",
  "reports_received",
  "purchase_order_review",
  "purchase_order_approved",
  "purchase_order_rejected",
  "invoices_pending",
  "furnishing",
  "guest_ready_scheduled",
  "guest_ready",
  "listings_in_progress",
  "live",
] as const;

export type OnboardingStatus = (typeof ONBOARDING_STATUSES)[number];
export type ClientDecision = "pending" | "proceed" | "reviewing" | "not_proceeding";
export type InvoiceStatus = "not_created" | "pending" | "settled";
export type OnboardingFileKind =
  | "enquiry_media"
  | "performance_estimate"
  | "management_agreement"
  | "purchase_order"
  | "health_safety_report"
  | "room_photo"
  | "supplier_invoice"
  | "listing_photo";

export type Comparable = {
  name: string;
  url: string;
  adrPence: number;
};

export type RepairPermission = {
  category: string;
  amountPence: number;
  fullPermission: boolean;
};

export type ListingLink = {
  platform: "Airbnb" | "Booking.com" | "Comfy Workers" | "Direct";
  url: string;
};

export type OnboardingFile = {
  id: string;
  kind: OnboardingFileKind;
  roomLabel: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedByName: string;
  createdAt: number;
};

export type OnboardingUpdate = {
  id: string;
  eventType: string;
  note: string;
  actorName: string;
  createdAt: number;
};

export type OnboardingNotification = {
  id: string;
  kind: string;
  recipientEmail: string;
  subject: string;
  dueAt: number;
  status: string;
};

export type OnboardingCase = {
  id: string;
  reference: string;
  clientEmail: string;
  clientName: string;
  propertyName: string;
  propertyAddress: string;
  propertyType: string;
  bedrooms: number;
  bathrooms: number;
  status: OnboardingStatus;
  lowNightlyRatePence: number | null;
  mediumNightlyRatePence: number | null;
  highNightlyRatePence: number | null;
  comparables: Comparable[];
  estimateComments: string;
  estimatePublishedAt: number | null;
  estimateViewedAt: number | null;
  clientDecision: ClientDecision;
  decisionFeedback: string;
  reviewFollowUpDate: string | null;
  agreementSignedAt: number | null;
  agreementSignedName: string;
  businessName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  bankSortCode: string;
  accessDate: string | null;
  accessInfo: string;
  utilitiesConnected: boolean;
  utilityInstallDate: string | null;
  prepaymentMeters: boolean;
  creditSwitchDate: string | null;
  broadbandConnected: boolean;
  broadbandInstallDate: string | null;
  hasGarden: boolean;
  mailPreference: string;
  warrantyDetails: string;
  repairPermissions: RepairPermission[];
  furnishingChoice: "pending" | "self" | "recharge";
  selfFurnishInspectionDate: string | null;
  formSubmittedAt: number | null;
  inspectionDate: string | null;
  inspectionBookedAt: number | null;
  healthSafetyPercent: number;
  purchaseOrderDecision: "pending" | "approved" | "rejected";
  purchaseOrderRejectionReason: string;
  reportsPublishedAt: number | null;
  onboardingInvoiceStatus: InvoiceStatus;
  purchaseOrderInvoiceStatus: InvoiceStatus;
  supplierInvoiceStatus: "not_created" | "requested" | "pending" | "settled";
  estimatedGuestReadyDate: string | null;
  listingLinks: ListingLink[];
  automatedMessagesReady: boolean;
  socialPostReady: boolean;
  guidebookUrl: string;
  liveAt: number | null;
  createdAt: number;
  updatedAt: number;
  files: OnboardingFile[];
  updates: OnboardingUpdate[];
  notifications: OnboardingNotification[];
};

export type OnboardingData = {
  available: boolean;
  mode: "client" | "staff";
  emailConnected: boolean;
  cases: OnboardingCase[];
};
