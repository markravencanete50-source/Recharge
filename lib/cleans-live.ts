import { z } from "zod";
import { formatDay, formatMoney, plural } from "./format";
import type { RepairType } from "./repair-guides";

// Response shapes the live Cleans screens rely on, shared with the tests that
// check them against the real database functions.
// checkoutTime and nextArrivalTime ("10:00") come from the stays' Hostaway times (migration 20261021500000); null or missing when unknown.
const guestsSchema = z.object({ workId: z.string().uuid(), guestsLeaving: z.number().nullable(), nextArrivalOn: z.string().nullable(), nextArrivalGuests: z.number().nullable(),
  checkoutTime: z.string().nullable().optional(), nextArrivalTime: z.string().nullable().optional() });
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
  return { rateMinor: rate, cleans, amountMinor: rate === null ? null : rate * cleans, label: rate === null ? "Rate not set yet" : formatMoney(rate * cleans), detail: rate === null ? "The office sets your rate per clean" : `${plural(cleans, "clean")} at ${formatMoney(rate)}` };
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

// --- The cleaner flow (migration 20261021500000) ----------------------------------------------------------------
// "Checkout 10:00 · next guests 15:00" for a clean on `day`; "next guests Sun 19 Oct" when they arrive later; null when
// nothing is known. Times and days only: cleaners never see who the guests are.
export function cleanTimesLine(g: Pick<CleanGuests, "nextArrivalOn" | "checkoutTime" | "nextArrivalTime"> | undefined, day: string | null | undefined, today = new Date()): string | null {
  if (!g) return null;
  const next = g.nextArrivalOn ? (g.nextArrivalOn.slice(0, 10) === day ? `next guests ${g.nextArrivalTime || "today"}` : `next guests ${formatDay(g.nextArrivalOn, today)}`) : "";
  const parts = [g.checkoutTime ? `checkout ${g.checkoutTime}` : "", next].filter(Boolean);
  return parts.length ? parts.join(" · ").replace(/^./, c => c.toUpperCase()) : null;
}

// Start and finish times on the clean form: HH:MM, the finish after the start (the same day or overnight), at most 12 hours.
export const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
export function hoursProblem(start: string, finish: string): string | null {
  const s = start.trim(), f = finish.trim();
  if (s && !CLOCK.test(s)) return "Enter the start time as HH:MM, for example 10:30.";
  if (f && !CLOCK.test(f)) return "Enter the finish time as HH:MM, for example 13:15.";
  if (!s || !f) return null;
  const minutes = (m: string) => Number(m.slice(0, 2)) * 60 + Number(m.slice(3));
  let span = minutes(f) - minutes(s);
  if (span <= 0) span += 1440;
  return span >= 1440 || span > 720 ? "The finish time must be after the start time, at most 12 hours later." : null;
}
// "Cleaned 10:15–13:40" for the reviewer; null when the cleaner gave no times.
export const hoursLine = (data: Record<string, unknown>) => {
  const s = typeof data.startedAt === "string" ? data.startedAt : "", f = typeof data.finishedAt === "string" ? data.finishedAt : "";
  return s && f ? `Cleaned ${s}–${f}` : s ? `Started ${s}` : f ? `Finished ${f}` : null;
};

// London wall-clock parts of an instant, and the instant of a London wall-clock time (BST and GMT aware).
const londonParts = (at: Date) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(at).map(x => [x.type, x.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour), minute: Number(parts.minute) };
};
const pad = (n: number) => String(n).padStart(2, "0");
export function londonInstant(day: string, time: string): Date {
  const guess = Date.parse(`${day}T${time}:00Z`);
  const seen = londonParts(new Date(guess));
  const offset = Date.parse(`${seen.day}T${pad(seen.hour)}:${pad(seen.minute)}:00Z`) - guess;
  return new Date(guess - offset);
}
const nextDay = (day: string) => { const d = new Date(day + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
// The usual redo deadline: 18:00 today when it is before then, otherwise 12:00 tomorrow (London time). The reviewer can change it.
export function defaultRedoBy(now = new Date()): string {
  const here = londonParts(now);
  return (here.hour < 18 ? londonInstant(here.day, "18:00") : londonInstant(nextDay(here.day), "12:00")).toISOString();
}
// The London day and time of a redo deadline, for the reviewer's fields.
export const redoParts = (iso: string) => { const at = londonParts(new Date(iso)); return { day: at.day, time: `${pad(at.hour)}:${pad(at.minute)}` }; };
// "Redo by 18:00 today", "Redo by Fri 17 Oct, 12:00"; null without a deadline.
export function redoByLabel(iso: string | null | undefined, now = new Date()): string | null {
  if (!iso || Number.isNaN(Date.parse(iso))) return null;
  const at = redoParts(iso);
  return at.day === londonParts(now).day ? `Redo by ${at.time} today` : `Redo by ${formatDay(at.day, now)}, ${at.time}`;
}
// A redo deadline from the reviewer's day and time: an ISO time, or null unless it is a time in the next seven days.
export function redoByFrom(day: string, time: string, now = new Date()): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !CLOCK.test(time)) return null;
  const at = londonInstant(day, time);
  return at.getTime() > now.getTime() && at.getTime() <= now.getTime() + 7 * 86_400_000 ? at.toISOString() : null;
}
