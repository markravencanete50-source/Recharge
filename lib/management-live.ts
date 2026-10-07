import { z } from "zod";
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
  minutes: z.number(), published: z.boolean(), version: z.number(), completedAt: z.string().nullable(), completions: z.number().nullable(),
});
export const coursesSchema = z.array(courseSchema);
export type Course = z.infer<typeof courseSchema>;

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
