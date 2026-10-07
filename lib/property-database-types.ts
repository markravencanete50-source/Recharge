// Shapes of the retired property database, kept for the phone app's sample analytics.
export type PropertyStatus = "new_enquiry" | "sign_them_up" | "onboarding" | "live" | "archived";

export type PropertyListingLink = { label: string; url: string };

export type SourceAttachment = {
  id: string;
  title: string;
  extension: string;
  mimetype: string;
  size: number;
  date: string;
};

export type SourceChecklistItem = {
  id: string;
  name: string;
  resolved: boolean;
  children: SourceChecklistItem[];
};

export type SourceChecklist = {
  id: string;
  name: string;
  resolved: number;
  unresolved: number;
  items: SourceChecklistItem[];
};

export type SourceComment = {
  id: string;
  text: string;
  date: string;
  author: string;
  resolved: boolean;
  replyCount: number;
  replies: Array<{ id: string; text: string; date: string; author: string; resolved: boolean }>;
};

export type ManagementProperty = {
  id: string;
  hostawayListingId: string | null;
  hostawayListingIds: string[];
  clickupTaskId: string | null;
  clickupUrl: string;
  sourceStatus: string;
  sourcePriority: string;
  sourceDueAt: string;
  sourceCreatedAt: string;
  sourceUpdatedAt: string;
  propertyName: string;
  propertyAddress: string;
  region: string;
  propertyType: string;
  bedrooms: string;
  beds: string;
  bathrooms: string;
  wcCount: string;
  parking: string;
  garden: string;
  ownerName: string;
  ownerCompany: string;
  ownerEmail: string;
  ownerPhone: string;
  correspondenceAddress: string;
  existingClient: string;
  accessCode: string;
  accessInfo: string;
  guidebookUrl: string;
  listingLinks: PropertyListingLink[];
  payoutSchedule: string;
  managementFeePercent: number;
  cleaningCostPence: number;
  payoutNotes: string;
  currentlyOperating: string;
  furnishingPreference: string;
  licensingPreference: string;
  startPreference: string;
  enquiryReason: string;
  additionalNotes: string;
  sourceDescription: string;
  sourceCustomFields: Record<string, string>;
  sourceChecklists: SourceChecklist[];
  sourceComments: SourceComment[];
  sourceAttachments: SourceAttachment[];
  sourceLinkedTaskIds: string[];
  sourceRecords: ClickUpImportRecord[];
  clickupImportedAt: number | null;
  status: PropertyStatus;
  lastSyncedAt: number | null;
  updatedAt: number;
};

export type ClientPortfolio = {
  key: string;
  companyName: string;
  ownerName: string;
  directorNames: string[];
  ownerEmail: string;
  ownerPhone: string;
  properties: ManagementProperty[];
};

export type PropertyDatabaseData = {
  available: boolean;
  hostawayConnected: boolean;
  canEdit: boolean;
  properties: ManagementProperty[];
  clients: ClientPortfolio[];
  reporting: PropertyReporting;
};

export type PropertyReporting = {
  newEnquiries: { week: number; month: number; quarter: number; year: number };
  signedUp: Array<{ propertyName: string; signedAt: number }>;
  strikeRate: number;
};

export type ClickUpImportRecord = {
  clickupTaskId: string;
  parentTaskId?: string;
  parent?: string;
  clickupUrl: string;
  clickupStatus: string;
  status: PropertyStatus;
  region: string;
  propertyName: string;
  propertyAddress: string;
  propertyType: string;
  bedrooms: string;
  beds: string;
  bathrooms: string;
  wcCount: string;
  parking: string;
  garden: string;
  ownerName: string;
  ownerCompany: string;
  ownerEmail: string;
  ownerPhone: string;
  correspondenceAddress: string;
  existingClient: string;
  currentlyOperating: string;
  furnishingPreference: string;
  licensingPreference: string;
  startPreference: string;
  enquiryReason: string;
  additionalNotes: string;
  descriptionMarkdown: string;
  textContent: string;
  priority: string;
  dueAt: string;
  createdAt: string;
  updatedAt: string;
  customFields: Record<string, string>;
  checklists: SourceChecklist[];
  comments: SourceComment[];
  attachments: SourceAttachment[];
  linkedTaskIds: string[];
};
