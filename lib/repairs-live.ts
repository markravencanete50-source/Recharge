import { z } from "zod";

// Repair stages and who acts at each one. Mirrors the database checks in
// workspace_operations_action so the app only offers actions that can succeed.
export const REPAIR_STAGES = [
  { phase: "team_review", label: "Team review", detail: "A contractor's estimate: the team checks it, then it is approved or goes to the owner" },
  { phase: "owner_approval", label: "Owner approval", detail: "Waiting for the owner to approve the cost" },
  { phase: "management_approval", label: "Management approval", detail: "At or over the repair limit, or a contractor estimate: an admin approves the cost first" },
  { phase: "owner_declined", label: "Owner declined", detail: "The owner said no to the cost: re-quote or close it" },
  { phase: "management_declined", label: "Management declined", detail: "Management said no to the cost: re-quote or close it" },
  { phase: "triage", label: "Reported", detail: "Stays checks the issue and refers it" },
  { phase: "referred", label: "With Ready", detail: "Ready books the repair" },
  { phase: "booked", label: "Booked", detail: "Repair date and contractor set" },
  { phase: "completed", label: "Completed", detail: "Report filed; Accounts check the cost" },
  { phase: "paid", label: "Paid", detail: "Paid by Accounts" },
  { phase: "resolved", label: "Resolved", detail: "Fixed by troubleshooting, no visit needed" },
  { phase: "closed", label: "Closed", detail: "Closed after the cost was declined" },
] as const;
export type RepairPhase = (typeof REPAIR_STAGES)[number]["phase"];
// The stages Ready can open: repairs reach them once Stays refer them, so approvals, declines and
// new reports are not counted on Ready's Home (their Repairs list would be empty).
export const READY_STAGES = REPAIR_STAGES.filter(s => ["referred", "booked", "completed", "paid"].includes(s.phase));
// Where a repair is: its workflow phase, or "paid" once Accounts have paid or charged the cost
// (its expense approved, its invoice paid or its invoice task closed).
export const repairStage = (data: Record<string, unknown>): string => data.phase === "completed" && typeof data.paidAt === "string" ? "paid" : String(data.phase ?? "triage");

// Ready Home: repairs at each stage and this month's routine visits, from the "readyHome" read.
export const readyHomeSchema = z.object({
  month: z.string(), today: z.string(),
  stages: z.record(z.number()),
  visits: z.array(z.object({
    propertyId: z.string().uuid(), propertyName: z.string(),
    items: z.array(z.object({ workId: z.string().uuid(), title: z.string(), dueOn: z.string().nullable(), status: z.string(), assigneeName: z.string().nullable(), mine: z.boolean().nullable() })),
  })),
});
export type ReadyHome = z.infer<typeof readyHomeSchema>;
// A visit is done once Ready have marked it done (Stays then sign it off).
export const visitDone = (status: string) => ["in_review", "approved", "completed"].includes(status);
export function visitSummary(items: { dueOn: string | null; status: string }[], today: string) {
  const done = items.filter(i => visitDone(i.status)).length;
  const overdue = items.filter(i => !visitDone(i.status) && !!i.dueOn && i.dueOn < today).length;
  return { done, due: items.length - done, overdue };
}
export type RepairStep = "approveBudget" | "approveManagement" | "reviewDone" | "referReady" | "bookRepair" | "completeRepair";

const STAFF = ["stays", "admin", "super_admin"];
const DECLINED = ["owner_declined", "management_declined"];
// Finished repairs: done, resolved by troubleshooting, or closed without the work going ahead.
export const repairClosed = (phase: string) => phase === "completed" || phase === "resolved" || phase === "closed";
// While a repair is still in triage, Stays or management can close it without a visit by writing down what fixed it
// (the resolveRepair step; the database refuses any other phase or role).
export const canResolveRepair = (role: string, phase: string) => STAFF.includes(role) && phase === "triage";
export const RESOLUTION_MIN = 5, RESOLUTION_MAX = 2000;
// ownerByTeam: in the team beta, Stays and admins record the owner's answer on the cost.
export function repairStep(role: string, phase: string, ownerByTeam = false): RepairStep | null {
  if (phase === "owner_approval") return role === "client" || (ownerByTeam && STAFF.includes(role)) ? "approveBudget" : null;
  if (phase === "management_approval") return role === "admin" || role === "super_admin" ? "approveManagement" : null;
  // A contractor's estimate: management (admins and super admins) review it and press Review done (migration 20261021200000).
  // Stays see it waiting for management.
  if (phase === "team_review") return role === "admin" || role === "super_admin" ? "reviewDone" : null;
  if (phase === "triage") return STAFF.includes(role) ? "referReady" : null;
  if (phase === "referred") return role === "ready" || STAFF.includes(role) ? "bookRepair" : null;
  if (phase === "booked") return role === "ready" || STAFF.includes(role) ? "completeRepair" : null;
  return null;
}
export const canReportRepair = (role: string) => role === "client" || STAFF.includes(role);
// While a repair is open, Ready or Stays can update its quote. A higher quote (or a contractor estimate) goes
// through the approvals again: under the repair limit it is approved automatically; at or over it management
// approve first, then the owner. Once approved the repair carries on where it was.
export const canReviseQuote = (role: string, phase: string) => (role === "ready" || STAFF.includes(role)) && ["triage", "referred", "booked"].includes(phase) || STAFF.includes(role) && DECLINED.includes(phase);
// After the owner (or management) declines the cost, Stays or an admin re-quote it or close it.
export const canCloseRepair = (role: string, phase: string) => STAFF.includes(role) && DECLINED.includes(phase);
// Why a repair is waiting, in the words shown on it: "Owner declined: <their reason>".
export function declineNote(data: Record<string, unknown>): string | null {
  if (data.phase === "owner_declined") return "Owner declined: " + (typeof data.ownerDeclinedReason === "string" ? data.ownerDeclinedReason : "no reason given");
  // Owners do not receive management's reason (it is for the team), so they read what happens next instead.
  if (data.phase === "management_declined") return typeof data.managementDeclinedReason === "string" ? "Management declined: " + data.managementDeclinedReason : "Management declined the cost. Recharge will get a new quote or close the repair.";
  return null;
}

// Routine visit sign-off follows the generic work graph: Ready starts and submits,
// Stays or management approve and close.
// `blocked` is set on a move the database would refuse: sending a visit for review needs its visit form first.
export type VisitMove = { status: "in_progress" | "in_review" | "approved" | "completed"; label: string; blocked?: string };
export const VISIT_FORM_FIRST = "Record the visit form first";
export function visitMoves(role: string, status: string, formRecorded = true): VisitMove[] {
  if (status === "waiting" && ["ready", ...STAFF].includes(role)) return [{ status: "in_progress", label: "Start visit" }];
  if (status === "in_progress" && ["ready", ...STAFF].includes(role)) return [{ status: "in_review", label: "Send for review", ...(formRecorded ? {} : { blocked: VISIT_FORM_FIRST }) }];
  if (status === "in_review" && STAFF.includes(role)) return [{ status: "approved", label: "Sign off" }];
  if (status === "approved" && STAFF.includes(role)) return [{ status: "completed", label: "Close" }];
  return [];
}

// Pounds typed by a person, converted to whole pence. Rejects anything ambiguous.
// A comma counts only as a thousands separator (groups of exactly three digits after it, like 1,234.50); "1,50" is refused, never read as 150.
export function poundsToMinor(input: string): number | null {
  let value = input.trim().replace(/^£/, "");
  if (value.includes(",")) {
    if (!/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(value)) return null;
    value = value.replace(/,/g, "");
  }
  if (!/^\d{1,6}(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number((fraction + "00").slice(0, 2));
}

export const routinePlanSchema = z.array(z.object({
  id: z.string().uuid(), propertyId: z.string().uuid(), propertyName: z.string(), moduleId: z.string(), title: z.string(),
  checklist: z.array(z.string()), frequency: z.string(), dayOfMonth: z.number(), assigneeId: z.string().nullable(), active: z.boolean(),
  version: z.number(), lastVisit: z.object({ period: z.string(), workId: z.string() }).nullable(),
}));

// --- Visit forms (client ask B6) ---------------------------------------------------------------------
// A routine, garden or bins visit is filled in when it is done: each checklist item done or not done,
// a note per item if wanted, a general note and optional photos. The database refuses to send a visit for
// review (or complete it) until a form exists, so the app asks for the form first. The lists below
// mirror private.workspace_visit_checklist for a visit whose plan gave no checklist.
export type VisitKind = "routine" | "garden" | "bins";
export const VISIT_KIND_LABEL: Record<VisitKind, string> = { routine: "Routine check", garden: "Garden", bins: "Bins" };
export const VISIT_FALLBACK_CHECKLIST: Record<VisitKind, readonly string[]> = {
  routine: ["Smoke and carbon monoxide alarms tested", "Heating and hot water working", "Taps, toilets and drains free of leaks", "Windows and doors secure", "No damp, mould or damage", "Appliances working"],
  garden: ["Lawn and hedges tidy", "Paths, patio and steps clear", "Gutters and drains clear", "Outdoor furniture and lights working"],
  bins: ["Bins out for collection", "Bins back in after collection", "Bin store clean and tidy", "Recycling sorted"],
};
// Which of the three a visit is: it says so itself, else its title does (private.workspace_visit_type).
export function visitType(title: string, data: Record<string, unknown> = {}): VisitKind {
  const said = data.visitType;
  if (said === "routine" || said === "garden" || said === "bins") return said;
  const lower = (title || "").toLowerCase();
  return lower.includes("garden") ? "garden" : lower.includes("bin") ? "bins" : "routine";
}
export const VISIT_KINDS: readonly VisitKind[] = ["routine", "garden", "bins"];
// The visit type a link presets on Preventative maintenance (Garden Maintenance opens "visits-garden"), or null.
export function visitKindOfSub(sub: string | null | undefined): VisitKind | null {
  const kind = sub?.startsWith("visits-") ? sub.slice(7) : "";
  return (VISIT_KINDS as readonly string[]).includes(kind) ? kind as VisitKind : null;
}
// The checklist the form must answer, in order: the visit's own (copied from its plan), else its type's list.
export function visitChecklist(visit: { title: string; data?: Record<string, unknown> }): string[] {
  const own = visit.data?.checklist;
  if (Array.isArray(own) && own.length) return own.map(x => String(x).trim());
  return [...VISIT_FALLBACK_CHECKLIST[visitType(visit.title, visit.data)]];
}
export type VisitFormRecord = { answers: { item: string; done: boolean; note?: string }[]; note: string; photoIds: string[]; doneCount: number; totalCount: number; recordedAt: string | null };
// The recorded form on a visit's data, or null when none has been recorded yet.
export function visitFormOf(data: Record<string, unknown> | undefined): VisitFormRecord | null {
  const raw = data?.visitForm;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const f = raw as Record<string, unknown>;
  const answers = (Array.isArray(f.answers) ? f.answers : []).flatMap(a => {
    const r = a as Record<string, unknown> | null;
    return r && typeof r.item === "string" ? [{ item: r.item, done: r.done === true, ...(typeof r.note === "string" && r.note ? { note: r.note } : {}) }] : [];
  });
  return {
    answers, note: typeof f.note === "string" ? f.note : "", photoIds: Array.isArray(f.photoIds) ? f.photoIds.filter((x): x is string => typeof x === "string") : [],
    doneCount: typeof f.doneCount === "number" ? f.doneCount : answers.filter(a => a.done).length, totalCount: typeof f.totalCount === "number" ? f.totalCount : answers.length,
    recordedAt: typeof f.recordedAt === "string" ? f.recordedAt : null,
  };
}
export const visitFormRecorded = (data: Record<string, unknown> | undefined) => visitFormOf(data) !== null;
// When the visit was last done and when the next one falls due, as the database stamped them with the form.
export function visitDates(data: Record<string, unknown> | undefined): { lastDoneAt: string | null; nextDueOn: string | null } {
  return { lastDoneAt: typeof data?.lastDoneAt === "string" ? data.lastDoneAt : null, nextDueOn: typeof data?.nextDueOn === "string" ? data.nextDueOn : null };
}

const LONDON_DAY = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });
// The UK calendar day (YYYY-MM-DD) of a timestamp, or null when it cannot be read.
export function londonDayOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? null : LONDON_DAY.format(at);
}
const dayNumber = (day: string) => Date.parse(day + "T00:00:00Z") / 86_400_000;
// "today", "yesterday", "12 days ago" for a day (YYYY-MM-DD) against today; "in 3 days" for a day to come.
export function daysFromNow(day: string, today: string): string {
  const n = Math.round(dayNumber(today) - dayNumber(day));
  if (n === 0) return "today";
  if (n === 1) return "yesterday";
  if (n === -1) return "tomorrow";
  return n > 0 ? `${n} days ago` : `in ${-n} days`;
}

export type VisitFormRequest = { action: "recordVisitForm"; requestId: string; workId: string; version: number; answers: { item: string; done: boolean; note?: string }[]; note: string; photoIds?: string[] };
export type VisitAnswer = { done: boolean; note: string };
export const VISIT_ITEM_NOTE_MAX = 300, VISIT_NOTE_MAX = 2000, VISIT_PHOTOS_MAX = 10;
// The recordVisitForm request for these answers, or the reason it cannot be sent. One answer per checklist item, in order.
export function visitFormAction(visit: { workId: string; version: number; title: string; data?: Record<string, unknown> }, answers: readonly VisitAnswer[], note: string, requestId: string, photoIds: readonly string[] = []): { error: string } | { action: VisitFormRequest } {
  const items = visitChecklist(visit);
  if (answers.length !== items.length) return { error: "Answer every item on the checklist." };
  if (answers.some(a => a.note.trim().length > VISIT_ITEM_NOTE_MAX)) return { error: `Keep each item note under ${VISIT_ITEM_NOTE_MAX} characters.` };
  if (note.trim().length > VISIT_NOTE_MAX) return { error: `Keep the visit note under ${VISIT_NOTE_MAX} characters.` };
  if (photoIds.length > VISIT_PHOTOS_MAX) return { error: `Add up to ${VISIT_PHOTOS_MAX} photos.` };
  return {
    action: {
      action: "recordVisitForm", requestId, workId: visit.workId, version: visit.version,
      answers: items.map((item, i) => ({ item, done: answers[i].done, ...(answers[i].note.trim() ? { note: answers[i].note.trim() } : {}) })),
      note: note.trim(), ...(photoIds.length ? { photoIds: [...photoIds] } : {}),
    },
  };
}
