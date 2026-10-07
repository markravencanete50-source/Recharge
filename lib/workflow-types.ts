// Shapes of the retired workflow boards, kept for the phone app's sample analytics.
export const WORKFLOW_BOARDS = [
  "spot_maintenance",
  "property_furnishing",
  "new_property_inspection",
  "routine_bin_garden",
  "clean_property_onboarding",
  "clean_issues",
  "aircover_reporting",
  "onboarding_invoices",
  "purchase_order_invoices",
  "purchase_order_accounts",
] as const;

export type WorkflowBoard = (typeof WORKFLOW_BOARDS)[number];
export type WorkflowStatus = "new" | "in_progress" | "complete";
export type ReferralType = "maintenance" | "furnishing" | "inspection";

export type WorkflowTicket = {
  id: string;
  board: WorkflowBoard;
  lane: string;
  sourceBusiness: string;
  targetBusiness: string;
  propertyName: string;
  propertyAddress: string;
  title: string;
  details: string;
  priority: "normal" | "urgent";
  dueDate: string | null;
  status: WorkflowStatus;
  triggerType: "manual_referral" | "onboarding_complete";
  createdByName: string;
  createdAt: number;
};

export type PropertyOnboarding = {
  id: string;
  propertyName: string;
  propertyAddress: string;
  progress: number;
  status: "active" | "complete";
  createdByName: string;
  completedAt: number | null;
  createdAt: number;
};

export type WorkflowData = {
  available: boolean;
  onboardings: PropertyOnboarding[];
  tickets: WorkflowTicket[];
};
