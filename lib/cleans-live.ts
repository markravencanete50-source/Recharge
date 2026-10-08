import { z } from "zod";
import { formatDay, formatMoney, plural } from "./format";
import type { RepairType } from "./repair-guides";

// Response shapes the live Cleans screens rely on, shared with the tests that
// check them against the real database functions.
const guestsSchema = z.object({ workId: z.string().uuid(), guestsLeaving: z.number().nullable(), nextArrivalOn: z.string().nullable(), nextArrivalGuests: z.number().nullable() });
export const scheduleSchema = z.object({
  work: z.array(z.object({ workId: z.string().uuid(), propertyId: z.string().uuid(), propertyName: z.string(), title: z.string(), status: z.string(), dueOn: z.string().nullable(), assigneeId: z.string().nullable(), assigneeName: z.string().nullable(), kind: z.string().nullable(), version: z.number() })),
  stays: z.array(z.object({ reservationId: z.string(), propertyId: z.string(), propertyName: z.string(), checkIn: z.string(), checkOut: z.string(), guests: z.number().nullable() })),
  // Guests on the stay each clean follows and at the next arrival: counts and dates only, for cleaners too.
  cleanGuests: z.array(guestsSchema).optional(),
});
export type CleanGuests = z.infer<typeof guestsSchema>;
export const performanceSchema = z.array(z.object({
  cleanerId: z.string().uuid(), fullName: z.string(), accepted: z.number(), rejected: z.number(), overturned: z.number(), warning: z.boolean(),
  // Pay: the rate per clean (shown to the cleaner, admins and cleaning managers) and the cleans it pays for this month.
  rateMinor: z.number().nullable().optional(), rateVersion: z.number().nullable().optional(), paidCleans: z.number().default(0),
  decidedComplaints: z.array(z.object({ workId: z.string().uuid(), propertyId: z.string(), sourceWorkId: z.string().nullable(), decision: z.string().nullable(), decisionNote: z.string().nullable(), decidedAt: z.string().nullable() })).default([]),
  openComplaints: z.array(z.object({ workId: z.string().uuid(), propertyId: z.string(), sourceWorkId: z.string().nullable().optional(), cleanerStatement: z.string().nullable(), createdAt: z.string() })),
}));
export type CleanerMonth = z.infer<typeof performanceSchema>[number];
export const candidatesSchema = z.array(z.object({ userId: z.string().uuid(), fullName: z.string(), role: z.string() }));
export const cleanerRatesSchema = z.array(z.object({ cleanerId: z.string().uuid(), fullName: z.string(), rateMinor: z.number(), version: z.number(), updatedAt: z.string() }));

// "4 guests leaving · next arrival Fri 10 Oct, 2 guests"; null when no stay is known.
export function guestLine(g: CleanGuests | undefined, today = new Date()): string | null {
  if (!g) return null;
  const parts = [
    g.guestsLeaving ? `${plural(g.guestsLeaving, "guest")} leaving` : "",
    g.nextArrivalOn ? `next arrival ${formatDay(g.nextArrivalOn, today)}${g.nextArrivalGuests ? `, ${plural(g.nextArrivalGuests, "guest")}` : ""}` : "",
  ].filter(Boolean);
  return parts.length ? parts.join(" · ").replace(/^./, c => c.toUpperCase()) : null;
}

// The month's pay: the cleans paid for this month at the cleaner's rate, or null while no rate is set.
export function monthPay(row: Pick<CleanerMonth, "rateMinor" | "paidCleans"> | undefined) {
  const rate = typeof row?.rateMinor === "number" ? row.rateMinor : null, cleans = row?.paidCleans ?? 0;
  return { rateMinor: rate, cleans, amountMinor: rate === null ? null : rate * cleans, label: rate === null ? "Rate not set yet" : formatMoney(rate * cleans), detail: rate === null ? "Your cleaning manager sets your rate per clean" : `${plural(cleans, "clean")} at ${formatMoney(rate)}` };
}

// Where a rejected clean's dispute is up to, from the clean itself and the cleaner's month.
export type Dispute = { status: "open" | "upheld" | "overturned"; complaintWorkId: string | null; note: string | null; statement: string | null; responded: boolean };
export function disputeFor(clean: { workId: string; data: Record<string, unknown> } | undefined, month?: Pick<CleanerMonth, "openComplaints" | "decidedComplaints">): Dispute | null {
  if (!clean) return null;
  const text = (v: unknown) => typeof v === "string" && v ? v : null;
  const open = month?.openComplaints.find(c => c.sourceWorkId === clean.workId);
  const decision = text(clean.data.disputeDecision);
  if (decision === "upheld" || decision === "overturned") return { status: decision, complaintWorkId: text(clean.data.complaintWorkId), note: text(clean.data.disputeNote), statement: null, responded: true };
  if (open) return { status: "open", complaintWorkId: open.workId, note: null, statement: open.cleanerStatement, responded: !!open.cleanerStatement };
  const decided = month?.decidedComplaints.find(c => c.sourceWorkId === clean.workId);
  if (decided && (decided.decision === "upheld" || decided.decision === "overturned")) return { status: decided.decision, complaintWorkId: decided.workId, note: decided.decisionNote, statement: null, responded: true };
  return clean.data.complaintWorkId ? { status: "open", complaintWorkId: text(clean.data.complaintWorkId), note: null, statement: null, responded: false } : null;
}

// Problems a cleaner reported from a clean; each became a repair for the Stays team.
export type CleanProblem = { repairWorkId: string; issue: string; repairType: string; urgent: boolean; photos: number; reportedAt: string };
export const problemsOf = (data: Record<string, unknown>): CleanProblem[] => Array.isArray(data.problems)
  ? data.problems.filter((x): x is CleanProblem => !!x && typeof x === "object" && typeof (x as CleanProblem).issue === "string") : [];

// The exact requests the screens send, built in one place so the tests check the same payloads.
export const cleanProblemAction = (input: { requestId: string; workId: string; version: number; issue: string; urgent: boolean; repairType: RepairType; photoIds: string[] }) => ({
  action: "updateOperation" as const, requestId: input.requestId, workId: input.workId, version: input.version, step: "reportCleanProblem" as const,
  data: { issue: input.issue.trim(), urgent: input.urgent, repairType: input.repairType, ...(input.photoIds.length ? { photoIds: input.photoIds } : {}) },
});
export const cleanerRateAction = (input: { requestId: string; cleanerId: string; rateMinor: number; version: number }) =>
  ({ action: "setCleanerRate" as const, requestId: input.requestId, cleanerId: input.cleanerId, rateMinor: input.rateMinor, version: input.version });
export const disputeAction = (input: { requestId: string; workId: string; version: number; outcome: "upheld" | "overturned"; note: string }) =>
  ({ action: "decideComplaint" as const, requestId: input.requestId, workId: input.workId, version: input.version, outcome: input.outcome, note: input.note.trim() });
