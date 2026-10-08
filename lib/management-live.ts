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
  files: z.array(z.object({ id: z.string().uuid(), name: z.string(), mime: z.string(), bytes: z.number() })).default([]),
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
export const staffOnboardingSchema = z.object({
  userId: z.string().uuid(), fullName: z.string(), role: z.string(), ...onboardingCounts,
  contracts: z.array(z.object({ id: z.string().uuid(), title: z.string(), version: z.number(), signedVersion: z.number().nullable(), signedAt: z.string().nullable(), current: z.boolean().nullable() })).default([]),
  courses: z.array(z.object({ id: z.string().uuid(), title: z.string(), completedAt: z.string().nullable() })).default([]),
  // Every published course for their role (required or not), and when they finished onboarding.
  training: z.array(z.object({ id: z.string().uuid(), title: z.string(), required: z.boolean(), completedAt: z.string().nullable() })).default([]),
  onboardedAt: z.string().nullable().default(null),
});
export type StaffOnboarding = z.infer<typeof staffOnboardingSchema>;
export const contractsSchema = z.object({ contracts: z.array(contractSchema), people: z.array(staffOnboardingSchema) });
// The contracts a team member has signed, with the exact wording they signed.
export const myContractsSchema = z.array(z.object({ contractId: z.string().uuid(), title: z.string(), version: z.number(), signedName: z.string(), signedAt: z.string(), body: z.string(), latest: z.boolean() }));
export type MyContract = z.infer<typeof myContractsSchema>[number];
// Who still has something to do, in plain words.
export const onboardingProgress = (s: Pick<Onboarding, "required" | "complete" | "contractsSigned" | "contractsNeeded" | "coursesDone" | "coursesNeeded">) =>
  !s.required ? "Nothing to complete" : s.complete ? "Onboarding complete" :
  [s.contractsNeeded ? `Contract ${s.contractsSigned}/${s.contractsNeeded}` : "", s.coursesNeeded ? `Training ${s.coursesDone}/${s.coursesNeeded}` : ""].filter(Boolean).join(" · ");

// What a new team member in a role must do before their tools open: the contracts in use for
// their role and the published courses marked required. Admins and owners are never asked.
export const ONBOARDED_ROLES = ["stays", "cleans", "cleaning_manager", "ready", "accounts"] as const;
export function onboardingFor<K extends Pick<Contract, "title" | "audience" | "active">, C extends Pick<Course, "id" | "title" | "audience" | "published" | "required" | "minutes">>(role: string, contracts: K[], courses: C[]) {
  if (!(ONBOARDED_ROLES as readonly string[]).includes(role)) return null;
  const forRole = (audience: string[]) => audience.includes("all") || audience.includes(role);
  const sign = contracts.filter(c => c.active && forRole(c.audience));
  const train = courses.filter(c => c.published && c.required && forRole(c.audience));
  return { contracts: sign, courses: train, minutes: train.reduce((n, c) => n + c.minutes, 0), nothing: !sign.length && !train.length };
}

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
export const SHIFTS = { early: "Early, 8am–4pm", late: "Late, 3pm–11pm", both: "Early and late" } as const;
export const rotaSchema = z.object({ department: z.string(), usualShift: z.enum(["early", "late", "both"]) });
export const rotaListSchema = z.array(z.object({ userId: z.string().uuid(), fullName: z.string(), role: z.string(), department: z.string().nullable(), usualShift: z.enum(["early", "late", "both"]).nullable() }));
export const myShiftSchema = z.object({ open: shiftSchema.nullable(), today: z.array(shiftSchema), green: z.number(), responses: z.number(), passPercent: z.number(), rota: rotaSchema.nullable().optional() });
export const teamPerformanceSchema = z.object({
  targets: z.object({ greenMinutes: z.number(), amberMinutes: z.number(), passPercent: z.number(), bonusPercents: z.array(z.number()), version: z.number(),
    workWeight: z.number().default(0), dailyTargets: z.object({ signOffs: z.number(), listingChecks: z.number(), pricingDecisions: z.number(), reviewsLogged: z.number() }).default({ signOffs: 1, listingChecks: 1, pricingDecisions: 1, reviewsLogged: 0 }) }),
  onShift: z.array(shiftSchema), messages: z.number(),
  unassigned: z.object({ green: z.number(), amber: z.number(), red: z.number() }),
  people: z.array(z.object({ userId: z.string().uuid(), fullName: z.string(), role: z.string(), shifts: z.number(), minutes: z.number(), green: z.number(), amber: z.number(), red: z.number(),
    percentGreen: z.number().nullable(), onTrack: z.boolean().nullable(), bonusTier: z.number().nullable(), listingChecks: z.number(), pricingDecisions: z.number(), signOffs: z.number().default(0), reviewsLogged: z.number().default(0),
    daysWorked: z.number().nullable().default(null), workPercent: z.number().nullable().default(null), score: z.number().nullable().default(null), department: z.string().nullable().optional(), usualShift: z.enum(["early", "late", "both"]).nullable().optional() })),
});
export type TeamPerformance = z.infer<typeof teamPerformanceSchema>;
// The Stays end-of-day sign-off: today's picture, the person's own sign-off, and (for admins) the
// last fortnight's sign-offs.
const signoffSnapshotSchema = z.object({ openRelistings: z.number(), listingChecksToday: z.number(), reviewsToday: z.number(), flaggedToday: z.number() });
export const signoffSchema = z.object({
  today: z.string(), snapshot: signoffSnapshotSchema,
  mine: z.object({ createdAt: z.string(), note: z.string() }).nullable(),
  recent: z.array(z.object({ day: z.string(), fullName: z.string(), createdAt: z.string(), note: z.string(), snapshot: signoffSnapshotSchema })),
});
export type Signoff = z.infer<typeof signoffSchema>;
// The shift a clock-in falls in: early 08:00-15:00/16:00, late from 15:00 (London time).
export const shiftName = (iso: string) => { const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }).format(new Date(iso))); return hour < 7 || hour >= 23 ? "Out of hours" : hour < 13 ? "Early shift" : "Late shift"; };
export const hoursLabel = (minutes: number) => formatDuration(minutes);
