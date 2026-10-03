export type CleanStatus =
  | "scheduled"
  | "in_progress"
  | "submitted"
  | "approved"
  | "unsuccessful"
  | "invoiced";

export type CleanFileKind = "property_video" | "mail_photo" | "guest_evidence";

export type Cleaner = {
  id: string;
  fullName: string;
  email: string;
  phone: string;
  notes: string;
  status: "active" | "inactive";
  assignedProperties: number;
  approvedCleans: number;
  unsuccessfulCleans: number;
  successRate: number | null;
};

export type CleanProperty = {
  id: string;
  hostawayListingId: string | null;
  propertyName: string;
  propertyAddress: string;
  accessInstructions: string;
  clientName: string;
  clientEmail: string;
  cleanerId: string | null;
  cleanerName: string;
  cleanPricePence: number;
  status: "active" | "inactive";
};

export type CleanFile = {
  id: string;
  cleanTicketId: string;
  kind: CleanFileKind;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedByName: string;
  createdAt: number;
};

export type CleanTicket = {
  id: string;
  hostawayReservationId: string | null;
  hostawayListingId: string | null;
  propertyId: string | null;
  propertyName: string;
  propertyAddress: string;
  guestName: string;
  guestCount: number;
  bookingReference: string;
  arrivalDate: string | null;
  cleanDate: string;
  channelName: string;
  assignedCleanerId: string | null;
  assignedCleanerName: string;
  status: CleanStatus;
  broadbandWorking: boolean | null;
  heatingWorking: boolean | null;
  hotWaterWorking: boolean | null;
  maintenanceNotes: string;
  replenishmentNotes: string;
  mailPresent: boolean;
  mailNotes: string;
  guestConfirmationNotes: string;
  complaintNotes: string;
  refundOrCancellation: boolean;
  invoiceWeek: string | null;
  submittedAt: number | null;
  approvedAt: number | null;
  unsuccessfulAt: number | null;
  invoicedAt: number | null;
  files: CleanFile[];
};

export type ClientMailItem = {
  id: string;
  cleanTicketId: string;
  propertyName: string;
  propertyAddress: string;
  clientEmail: string;
  note: string;
  photoFileId: string | null;
  status: "new" | "reviewed" | "archived";
  createdAt: number;
};

export type ReplenishmentRequest = {
  id: string;
  cleanTicketId: string;
  propertyName: string;
  items: string;
  status: "new" | "ordered" | "complete";
  createdAt: number;
};

export type CleanerReview = {
  id: string;
  cleanerId: string;
  cleanerName: string;
  successRate: number;
  reason: string;
  status: "open" | "closed";
  createdAt: number;
};

export type CleanOnboardingTicket = {
  id: string;
  propertyName: string;
  propertyAddress: string;
  details: string;
  status: "new" | "in_progress" | "complete";
  createdAt: number;
};

export type CleansData = {
  available: boolean;
  hostawayConnected: boolean;
  properties: CleanProperty[];
  cleaners: Cleaner[];
  tickets: CleanTicket[];
  mail: ClientMailItem[];
  replenishments: ReplenishmentRequest[];
  reviews: CleanerReview[];
  onboarding: CleanOnboardingTicket[];
};
