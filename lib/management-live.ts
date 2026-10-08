import { z } from "zod";
import { formatDuration } from "./format";
import { expenseSchema, statementSchema } from "./accounts-live";
import { performanceSchema } from "./cleans-live";

// Response shapes and rules for the live Management, Stays and Training
// screens, shared with the tests that check them against the database.
export const decisionSchema = z.object({
  workId: z.string().uuid(), version: z.number(), kind: z.enum(["cleaning_complaint", "cleaner_management_review"]), title: z.string(),
  propertyId: z.string().uuid(), propertyName: z.string(), cleanerId: z.string().nullable(), cleanerName: z.string().nullable(),
  cleanerStatement: z.string().nullable(), sourceWorkId: z.string().nullable(), createdAt: z.string(),
});
export type Decision = z.infer<typeof decisionSchema>;
export const managementSchema = z.object({
  cleaningDecisions: z.array(decisionSchema),
  expensesOverLimit: z.array(expenseSchema),
  stalledOwnerApprovals: z.array(z.object({ workId: z.string().uuid(), title: z.string(), propertyId: z.string().uuid(), propertyName: z.string(), estimatedCostMinor: z.number().nullable(), waitingSince: z.string() })),
  cleanerWarnings: performanceSchema,
  ownerBalancesDue: z.array(statementSchema),
});
export type Management = z.infer<typeof managementSchema>;

export const DECISION_OUTCOMES = {
  cleaning_complaint: [["upheld", "Uphold the rejection"], ["overturned", "Overturn: the clean was fine"]],
  cleaner_management_review: [["no_action", "No action"], ["supervised", "Supervise the next cleans"], ["removed_from_rota", "Remove from the rota"]],
} as const;
export const decisionAction = (d: Pick<Decision, "kind">) => d.kind === "cleaning_complaint" ? "decideComplaint" as const : "decideCleanerReview" as const;
export const queueCount = (m: Management) => m.cleaningDecisions.length + m.expensesOverLimit.length + m.stalledOwnerApprovals.length + m.ownerBalancesDue.length;

export const AUDIENCES = ["all", "stays", "cleans", "cleaning_manager", "ready", "accounts", "admin", "client"] as const;
export const courseSchema = z.object({
  id: z.string().uuid(), title: z.string(), audience: z.array(z.string()), summary: z.string().nullable(), body: z.string(), videoUrl: z.string().nullable(),
  minutes: z.number(), published: z.boolean(), required: z.boolean().default(false), version: z.number(), completedAt: z.string().nullable(), completions: z.number().nullable(),
});
export const coursesSchema = z.array(courseSchema);
export type Course = z.infer<typeof courseSchema>;

// Staff onboarding: the contract each team member signs and the training they finish first.
const onboardingCounts = { required: z.boolean(), complete: z.boolean(), contractsSigned: z.number(), contractsNeeded: z.number(), coursesDone: z.number(), coursesNeeded: z.number() };
export const onboardingSchema = z.object({
  ...onboardingCounts,
  contracts: z.array(z.object({ id: z.string().uuid(), title: z.string(), version: z.number(), body: z.string(), resignRequired: z.boolean(), signedVersion: z.number().nullable(), signedAt: z.string().nullable(), current: z.boolean().nullable() })),
  courses: z.array(z.object({ id: z.string().uuid(), title: z.string(), completedAt: z.string().nullable() })),
});
export type Onboarding = z.infer<typeof onboardingSchema>;
export const contractSchema = z.object({
  id: z.string().uuid(), title: z.string(), audience: z.array(z.string()), active: z.boolean(), version: z.number(), body: z.string(), resignRequired: z.boolean(), publishedAt: z.string(),
  signatures: z.array(z.object({ userId: z.string().uuid(), fullName: z.string(), signedName: z.string(), version: z.number(), signedAt: z.string() })).nullable(),
});
export type Contract = z.infer<typeof contractSchema>;
export const staffOnboardingSchema = z.object({ userId: z.string().uuid(), fullName: z.string(), role: z.string(), ...onboardingCounts });
export type StaffOnboarding = z.infer<typeof staffOnboardingSchema>;
export const contractsSchema = z.object({ contracts: z.array(contractSchema), people: z.array(staffOnboardingSchema) });
// Who still has something to do, in plain words.
export const onboardingProgress = (s: Pick<Onboarding, "required" | "complete" | "contractsSigned" | "contractsNeeded" | "coursesDone" | "coursesNeeded">) =>
  !s.required ? "Nothing to complete" : s.complete ? "Onboarding complete" :
  [s.contractsNeeded ? `Contract ${s.contractsSigned}/${s.contractsNeeded}` : "", s.coursesNeeded ? `Training ${s.coursesDone}/${s.coursesNeeded}` : ""].filter(Boolean).join(" · ");

// The reservation as returned by recordReservation (a database row).
export const recordedReservationSchema = z.object({
  reservation: z.object({ id: z.string().uuid(), property_id: z.string().uuid(), reference: z.string(), check_in: z.string(), check_out: z.string(), status: z.string(), version: z.number() }).passthrough(),
  followUpWorkId: z.string().nullable(),
});

// Stays' daily checks per property: a listing health check today, and pricing
// decisions covering the next seven nights.
export type DailyCheck = { propertyId: string; listingCheckedToday: boolean; pricedNights: number; suspended: boolean; negativeReview: boolean };
export function dailyChecks(propertyIds: string[], operations: { propertyId: string; kind: string; data: Record<string, unknown> }[], today: string, weekEnd: string): DailyCheck[] {
  return propertyIds.map(propertyId => {
    const mine = operations.filter(op => op.propertyId === propertyId);
    const listing = mine.filter(op => op.kind === "listing_health" && op.data.checkedOn === today);
    const nights = new Set(mine.filter(op => op.kind === "daily_pricing" && typeof op.data.night === "string" && op.data.night >= today && op.data.night <= weekEnd).map(op => op.data.night));
    return {
      propertyId, listingCheckedToday: listing.length > 0, pricedNights: nights.size,
      suspended: listing.some(op => op.data.suspended === true), negativeReview: listing.some(op => op.data.reviewSentiment === "negative"),
    };
  });
}
// Nights in the coming week with no confirmed stay, per property.
export function vacantNights(propertyId: string, stays: { propertyId: string; checkIn: string; checkOut: string }[], days: string[]) {
  return days.filter(day => !stays.some(s => s.propertyId === propertyId && s.checkIn <= day && s.checkOut > day));
}

// Shifts and team performance: clock in/out, and how fast guests get a reply.
export const DEPARTMENT_LABEL: Record<string, string> = { guest_relations: "Guest relations", client_relations: "Client relations", cleaning: "Cleaning", ready: "Ready", accounts: "Accounts", management: "Management" };
// The department a role usually clocks in to.
export const departmentFor = (role: string) => ({ stays: "guest_relations", cleans: "cleaning", cleaning_manager: "cleaning", ready: "ready", accounts: "accounts" } as Record<string, string>)[role] ?? "management";
export const shiftSchema = z.object({ id: z.string().uuid(), userId: z.string().uuid(), fullName: z.string().nullable(), department: z.string(), clockedInAt: z.string(), clockedOutAt: z.string().nullable() });
export type Shift = z.infer<typeof shiftSchema>;
export const myShiftSchema = z.object({ open: shiftSchema.nullable(), today: z.array(shiftSchema), green: z.number(), responses: z.number(), passPercent: z.number() });
export const teamPerformanceSchema = z.object({
  targets: z.object({ greenMinutes: z.number(), amberMinutes: z.number(), passPercent: z.number(), bonusPercents: z.array(z.number()), version: z.number() }),
  onShift: z.array(shiftSchema), messages: z.number(),
  unassigned: z.object({ green: z.number(), amber: z.number(), red: z.number() }),
  people: z.array(z.object({ userId: z.string().uuid(), fullName: z.string(), role: z.string(), shifts: z.number(), minutes: z.number(), green: z.number(), amber: z.number(), red: z.number(),
    percentGreen: z.number().nullable(), onTrack: z.boolean().nullable(), bonusTier: z.number().nullable(), listingChecks: z.number(), pricingDecisions: z.number() })),
});
export type TeamPerformance = z.infer<typeof teamPerformanceSchema>;
// The shift a clock-in falls in: early 08:00-15:00/16:00, late from 15:00 (London time).
export const shiftName = (iso: string) => { const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }).format(new Date(iso))); return hour < 7 || hour >= 23 ? "Out of hours" : hour < 13 ? "Early shift" : "Late shift"; };
export const hoursLabel = (minutes: number) => formatDuration(minutes);
