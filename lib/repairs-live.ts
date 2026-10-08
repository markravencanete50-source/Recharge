import { z } from "zod";

// Repair stages and who acts at each one. Mirrors the database checks in
// workspace_operations_action so the app only offers actions that can succeed.
export const REPAIR_STAGES = [
  { phase: "owner_approval", label: "Owner approval", detail: "Waiting for the owner to approve the cost" },
  { phase: "triage", label: "Reported", detail: "Stays checks the issue and refers it" },
  { phase: "referred", label: "With Ready", detail: "Ready books the repair" },
  { phase: "booked", label: "Booked", detail: "Repair date and contractor set" },
  { phase: "completed", label: "Completed", detail: "Report filed, invoice raised for Accounts" },
] as const;
export type RepairPhase = (typeof REPAIR_STAGES)[number]["phase"];
export type RepairStep = "approveBudget" | "referReady" | "bookRepair" | "completeRepair";

const STAFF = ["stays", "admin", "super_admin"];
export function repairStep(role: string, phase: string): RepairStep | null {
  if (phase === "owner_approval") return role === "client" ? "approveBudget" : null;
  if (phase === "triage") return STAFF.includes(role) ? "referReady" : null;
  if (phase === "referred") return role === "ready" || STAFF.includes(role) ? "bookRepair" : null;
  if (phase === "booked") return role === "ready" || STAFF.includes(role) ? "completeRepair" : null;
  return null;
}
export const canReportRepair = (role: string) => role === "client" || STAFF.includes(role);
// While a repair is open, Ready or Stays can update its quote. A higher quote above the owner's
// approval limit goes back to the owner; once approved the repair carries on where it was.
export const canReviseQuote = (role: string, phase: string) => (role === "ready" || STAFF.includes(role)) && ["triage", "referred", "booked"].includes(phase);

// Routine visit sign-off follows the generic work graph: Ready starts and submits,
// Stays or management approve and close.
export type VisitMove = { status: "in_progress" | "in_review" | "approved" | "completed"; label: string };
export function visitMoves(role: string, status: string): VisitMove[] {
  if (status === "waiting" && ["ready", ...STAFF].includes(role)) return [{ status: "in_progress", label: "Start visit" }];
  if (status === "in_progress" && ["ready", ...STAFF].includes(role)) return [{ status: "in_review", label: "Visit done" }];
  if (status === "in_review" && STAFF.includes(role)) return [{ status: "approved", label: "Sign off" }];
  if (status === "approved" && STAFF.includes(role)) return [{ status: "completed", label: "Close" }];
  return [];
}

// Pounds typed by a person, converted to whole pence. Rejects anything ambiguous.
export function poundsToMinor(input: string): number | null {
  const value = input.trim().replace(/^£/, "").replace(/,/g, "");
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
}

export const routinePlanSchema = z.array(z.object({
  id: z.string().uuid(), propertyId: z.string().uuid(), propertyName: z.string(), moduleId: z.string(), title: z.string(),
  checklist: z.array(z.string()), frequency: z.string(), dayOfMonth: z.number(), assigneeId: z.string().nullable(), active: z.boolean(),
  version: z.number(), lastVisit: z.object({ period: z.string(), workId: z.string() }).nullable(),
}));
