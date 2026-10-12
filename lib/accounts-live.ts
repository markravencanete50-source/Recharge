import { formatDay, formatMoney } from "./format";
import { normalise } from "./search-options";
import { z } from "zod";
import { CLEAN_CHARGE_MODES, STATEMENT_METHODS } from "./workspace-finance-policy";

// Response shapes and rules the live Accounts screens rely on, shared with the
// tests that check them against the real database functions.
const minor = z.number().int();
const nullableMinor = minor.nullable();

// A draft comes from a completed repair: Accounts add the supplier's invoice details, then send it for approval.
export const EXPENSE_STATUSES = ["draft", "to_approve", "queried", "approved", "rejected"] as const;
export const EXPENSE_CATEGORIES = ["maintenance", "property_setup", "cleaning_supplies", "utilities", "furnishing", "other"] as const;
export const EVIDENCE_KINDS = ["invoice", "photo", "quote", "report"] as const;

export const overviewSchema = z.object({
  toApproveCount: z.number(), toApproveMinor: minor, queriedCount: z.number(), queuedForXero: z.number(), overLimitCount: z.number(), draftCount: z.number().default(0),
  statements: z.object({ draft: z.number(), issued: z.number(), paid: z.number() }), unsettledPayouts: z.number(), missingDetails: z.number(),
});

const evidenceSchema = z.object({
  id: z.string().uuid(), kind: z.enum(EVIDENCE_KINDS), label: z.string(), mediaId: z.string().nullable(), workId: z.string().nullable(), note: z.string().nullable(), createdAt: z.string(),
});
export const expenseSchema = z.object({
  id: z.string().uuid(), propertyId: z.string().uuid(), propertyName: z.string(), workId: z.string().nullable(), supplier: z.string(), reference: z.string(),
  category: z.enum(EXPENSE_CATEGORIES), description: z.string(), amountMinor: minor, currency: z.string(), receivedOn: z.string(), source: z.string(),
  sender: z.string().nullable(), status: z.enum(EXPENSE_STATUSES), queryNote: z.string().nullable(), decisionNote: z.string().nullable(),
  decidedAt: z.string().nullable(), xeroStatus: z.string().nullable(), version: z.number(), evidenceCount: z.number(), hasInvoice: z.boolean(), hasProof: z.boolean(),
  evidence: z.array(evidenceSchema).nullable(),
});
export const expensesSchema = z.array(expenseSchema);
export type Expense = z.infer<typeof expenseSchema>;
// Finished jobs an expense can be linked to (the "jobs" read): completed repairs and delivered purchases.
export const jobsSchema = z.array(z.object({
  workId: z.string().uuid(), kind: z.enum(["maintenance", "purchase"]), title: z.string(), detail: z.string(), phase: z.string().nullable(),
  supplier: z.string().nullable(), costMinor: nullableMinor, doneOn: z.string(), photoCount: z.number(),
}));
export type Job = z.infer<typeof jobsSchema>[number];

// The amounts itemised on one payout line (fees are positive), when the report had them.
const payoutLineDetail = z.object({
  grossMinor: nullableMinor.optional(), commissionMinor: nullableMinor.optional(), hostFeeMinor: nullableMinor.optional(), paymentFeeMinor: nullableMinor.optional(),
  cleaningFeeMinor: nullableMinor.optional(), paidOn: z.string().nullable().optional(), lineType: z.string().nullable().optional(),
});
export const PAYOUT_STATES = ["matched", "agreed", "different", "missing", "no_reference", "no_expected_amount"] as const;
export const payoutRowSchema = z.object({
  reservationId: z.string().uuid(), propertyId: z.string().uuid(), reference: z.string(), channel: z.string(), channelReference: z.string().nullable(),
  checkIn: z.string(), checkOut: z.string(), guests: z.number().nullable(), expectedMinor: nullableMinor, receivedMinor: nullableMinor, agreedMinor: nullableMinor,
  agreementNote: z.string().nullable(), state: z.enum(PAYOUT_STATES), version: z.number(), settledMinor: nullableMinor,
  // Added by the payout-lines migration (20261012080000); optional so the screens work before and after it.
  // lineCount: payout lines held for the stay. fundsReceived false on an agreed stay means approved, not received.
  // agreedBeforeFunds: approved before any money arrived. repeatedAmount: on a different stay, an amount paid more
  // than once (often an overlapping report). grossMinor and otaFeesMinor: the stay's gross and platform fees from its lines.
  lineCount: z.number().optional(), fundsReceived: z.boolean().optional(), agreedBeforeFunds: z.boolean().optional(),
  repeatedAmount: nullableMinor.optional(), grossMinor: nullableMinor.optional(), otaFeesMinor: nullableMinor.optional(),
});
export type PayoutRow = z.infer<typeof payoutRowSchema>;
export const reconciliationSchema = z.object({
  period: z.string(),
  rows: z.array(payoutRowSchema),
  needsDetails: z.array(z.object({ reservationId: z.string().uuid(), propertyId: z.string().uuid(), propertyName: z.string(), reference: z.string(), channel: z.string(),
    checkIn: z.string(), checkOut: z.string(), guests: z.number().nullable(), version: z.number() })),
  // Lines with no confirmed stay. stayStatus says why when a stay has the code (for example cancelled or enquiry).
  unexpected: z.array(z.object({ lineId: z.string().uuid(), channel: z.string(), reference: z.string(), amountMinor: minor, fileName: z.string(), uploadedAt: z.string(),
    stayStatus: z.string().nullable().optional(), reservationId: z.string().uuid().nullable().optional() }).merge(payoutLineDetail)),
  reports: z.array(z.object({ id: z.string().uuid(), channel: z.string(), fileName: z.string(), lineCount: z.number(), totalMinor: minor, uploadedAt: z.string(),
    newLineCount: z.number().optional(), newMinor: minor.optional() })),
});

// What an upload answers. newLines, alreadyHeld and cancelledStay come with the payout-lines migration;
// the skipped rows are counted on the screen with readPayoutLines (lib/payout-reconciliation.ts).
export const payoutImportSchema = z.object({
  reportId: z.string().uuid(), lineCount: z.number(), totalMinor: minor,
  newLines: z.number().optional(), alreadyHeld: z.number().optional(), cancelledStay: z.number().optional(), newMinor: minor.optional(),
  matchedReservations: z.number().optional(), unexpectedLines: z.number().optional(),
}).passthrough();
export type PayoutImport = z.infer<typeof payoutImportSchema>;

// Every payout line (the 'payoutLines' report): what the platform paid for each stay, line by line.
export const payoutLineSchema = z.object({
  lineId: z.string().uuid(), channel: z.string(), reference: z.string(), amountMinor: minor,
  reportId: z.string().uuid().optional(), fileName: z.string().optional(), uploadedAt: z.string().optional(),
  reservationId: z.string().uuid().nullable().optional(), propertyId: z.string().uuid().nullable().optional(), propertyName: z.string().nullable().optional(),
  stayReference: z.string().nullable().optional(), stayStatus: z.string().nullable().optional(), checkIn: z.string().nullable().optional(), checkOut: z.string().nullable().optional(),
  // keyed: the file let this line be told apart from the same line in another upload. locked: its stay is in an issued statement.
  keyed: z.boolean().optional(), active: z.boolean().optional(), locked: z.boolean().optional(), canSetAside: z.boolean().optional(),
  setAsideAt: z.string().nullable().optional(), setAsideNote: z.string().nullable().optional(), setAsideBy: z.string().nullable().optional(),
}).merge(payoutLineDetail).passthrough();
export type PayoutLineRow = z.infer<typeof payoutLineSchema>;
// The 'payoutLines' report: up to 500 lines, newest first; count and activeMinor cover every line that matched.
export const payoutLinesReportSchema = z.object({ count: z.number(), activeMinor: minor, more: z.boolean(), lines: z.array(payoutLineSchema) }).passthrough();
export type PayoutLinesReport = z.infer<typeof payoutLinesReportSchema>;
export const PAYOUT_LINE_STATES = ["active", "setAside", "noConfirmedStay"] as const;

// --- Owner statements with a period, VAT and ordered lines (migration 20261012100000). Every new field is optional so older answers still parse.
// The lines are deductions from gross in this order, each category in date order.
export const STATEMENT_LINE_KINDS = ["ota_fee", "changeover", "management_fee", "vat", "payable"] as const;
export const STATEMENT_LINE_LABEL: Record<(typeof STATEMENT_LINE_KINDS)[number], string> = {
  ota_fee: "Platform fees", changeover: "Changeover clean", management_fee: "Management fee", vat: "VAT on the fee", payable: "Other costs",
};
export const statementLineSchema = z.object({
  kind: z.enum(STATEMENT_LINE_KINDS), label: z.string(), date: z.string().nullable().optional(), amountMinor: minor, refId: z.string().nullable().optional(),
});
export type StatementLineView = z.infer<typeof statementLineSchema>;
// What the statement row adds. periodEnd is the first day not included; the occupancy is nightsBooked of nightsAvailable.
export const statementPeriodSchema = z.object({
  periodEnd: z.string().nullable().optional(), method: z.enum(STATEMENT_METHODS).nullable().optional(),
  grossMinor: nullableMinor.optional(), otaFeesMinor: nullableMinor.optional(), vatRateBps: z.number().nullable().optional(), vatMinor: nullableMinor.optional(),
  nightsBooked: z.number().nullable().optional(), nightsAvailable: z.number().nullable().optional(), cleanChargeMode: z.enum(CLEAN_CHARGE_MODES).nullable().optional(),
});
// Added to the statement's detail: the ordered lines, and (staff only, never sent to owners) the flags that explain the figures.
export const statementDetailExtraSchema = z.object({ lines: z.array(statementLineSchema).optional(), internal: z.array(z.string()).optional() });

export const statementSchema = z.object({
  id: z.string().uuid(), propertyId: z.string().uuid(), propertyName: z.string(), period: z.string(), status: z.enum(["draft", "issued", "paid", "void"]),
  revenueMinor: minor, cleaningCount: z.number(), cleaningMinor: minor, expensesMinor: minor, feeBps: z.number(), feeMinor: minor, payoutMinor: minor,
  payoutMethod: z.string().nullable(), payoutReference: z.string().nullable(), paidAt: z.string().nullable(), issuedAt: z.string().nullable(), version: z.number(),
  detail: z.object({
    stays: z.array(z.object({ reference: z.string(), channel: z.string(), checkIn: z.string(), checkOut: z.string(), amountMinor: minor })),
    expenses: z.array(z.object({ supplier: z.string(), reference: z.string(), amountMinor: minor })),
    cleaningCostMinor: minor,
  }).merge(statementDetailExtraSchema).passthrough(),
}).merge(statementPeriodSchema);
export type Statement = z.infer<typeof statementSchema>;
export const statementsSchema = z.array(z.object({
  propertyId: z.string().uuid(), propertyName: z.string(),
  terms: z.object({ managementFeeBps: z.number().nullable(), cleaningCostMinor: nullableMinor, vatOnFee: z.boolean().nullable().optional(), cleanChargeMode: z.enum(CLEAN_CHARGE_MODES).nullable().optional() }).nullable(),
  statement: statementSchema.nullable(), unsettledPayouts: z.number(), missingDetails: z.number(),
}));
// --- Payables (migration 20261012090000): what each clean cost against what the owner is charged, and cleaner invoices.
// A clean is flagged when its actual cost is above the agreed value; reviewing it picks which one the owner pays.
// stale: the review no longer holds because the clean's actual cost changed since.
export const CLEAN_REVIEW_STATES = ["flagged", "reviewed", "stale"] as const;
export const cleanCostReviewSchema = z.object({
  workId: z.string().uuid(), propertyId: z.string().uuid().nullable().optional(), propertyName: z.string(), cleanDate: z.string(),
  agreedMinor: nullableMinor, actualMinor: nullableMinor, state: z.enum(CLEAN_REVIEW_STATES), decision: z.enum(CLEAN_CHARGE_MODES).nullable(),
  cleanerName: z.string().nullable().optional(), note: z.string().nullable().optional(), reviewedAt: z.string().nullable().optional(),
});
export type CleanCostReview = z.infer<typeof cleanCostReviewSchema>;
export const cleansToReviewReportSchema = z.object({ count: z.number().optional(), more: z.boolean().optional(), cleans: z.array(cleanCostReviewSchema) }).passthrough();
export type CleansToReviewReport = z.infer<typeof cleansToReviewReportSchema>;

export const cleanerInvoiceLineSchema = z.object({
  workId: z.string().uuid(), amountMinor: minor, propertyName: z.string().nullable().optional(), cleanDate: z.string().nullable().optional(),
});
export const cleanerInvoiceSchema = z.object({
  id: z.string().uuid(), supplier: z.string(), reference: z.string(), invoiceDate: z.string(), totalMinor: minor, status: z.string(),
  lines: z.array(cleanerInvoiceLineSchema).optional(), lineCount: z.number().optional(), note: z.string().nullable().optional(), decisionNote: z.string().nullable().optional(),
  decidedAt: z.string().nullable().optional(), createdAt: z.string().optional(), version: z.number().optional(),
});
export type CleanerInvoice = z.infer<typeof cleanerInvoiceSchema>;
export const cleanerInvoicesReportSchema = z.object({ count: z.number().optional(), more: z.boolean().optional(), invoices: z.array(cleanerInvoiceSchema) }).passthrough();
export type CleanerInvoicesReport = z.infer<typeof cleanerInvoicesReportSchema>;

export const policySchema = z.object({ expenseApprovalLimitMinor: nullableMinor, version: z.number(), updatedAt: z.string().nullable(), managementRepairLimitMinor: nullableMinor.default(null) });

// --- Rules mirrored from workspace_finance_action, so the screens only offer what can succeed.
export const FINANCE_ROLES = ["accounts", "admin", "super_admin"];
export const isFinanceRole = (role: string) => FINANCE_ROLES.includes(role);
const management = (role: string) => role === "admin" || role === "super_admin";

export type ExpenseMove = "approve" | "query" | "resolve" | "reject" | "evidence" | "submit" | "link";
export function expenseMoves(role: string, expense: Pick<Expense, "status" | "amountMinor" | "hasInvoice" | "hasProof">, limitMinor: number | null): { moves: ExpenseMove[]; blocked?: string } {
  if (!isFinanceRole(role)) return { moves: [] };
  if (expense.status === "draft") return { moves: ["submit", "evidence", "link", "reject"], blocked: "A draft from a completed repair. Add the supplier’s invoice details, then send it for approval." };
  if (expense.status === "queried") return { moves: ["resolve", "reject", "evidence", "link"] };
  if (expense.status !== "to_approve") return { moves: [] };
  const moves: ExpenseMove[] = ["query", "reject", "evidence", "link"];
  if (!expense.hasInvoice || !expense.hasProof) return { moves, blocked: "Attach the invoice and proof of the work before approving." };
  if (role === "accounts" && limitMinor !== null && expense.amountMinor > limitMinor) return { moves, blocked: "Above the approval limit. Management approves this one." };
  return { moves: ["approve", ...moves] };
}

export type StatementMove = "prepare" | "issue" | "pay" | "void";
export function statementMoves(role: string, row: { statement: Pick<Statement, "status" | "payoutMinor"> | null; unsettledPayouts: number; missingDetails: number; terms: { managementFeeBps: number | null; cleaningCostMinor: number | null } | null }): { moves: StatementMove[]; blocked?: string } {
  if (!isFinanceRole(role)) return { moves: [] };
  const status = row.statement?.status;
  if (status === "paid") return { moves: [] };
  if (status === "issued") {
    const moves: StatementMove[] = row.statement!.payoutMinor >= 0 ? ["pay"] : [];
    if (management(role)) moves.push("void");
    return { moves, blocked: row.statement!.payoutMinor < 0 ? "The owner owes this balance. Invoice it instead of recording a payout." : undefined };
  }
  const ready = row.terms?.managementFeeBps != null && row.terms?.cleaningCostMinor != null;
  if (!ready) return { moves: status === "draft" ? ["void"] : [], blocked: "Management sets the fee and cleaning cost from the agreement first." };
  const open = row.unsettledPayouts + row.missingDetails;
  if (open > 0) return { moves: status === "draft" ? ["issue", "void"] : [], blocked: `Reconcile ${open} stay${open === 1 ? "" : "s"} before preparing.` };
  return { moves: status === "draft" ? ["prepare", "issue", "void"] : ["prepare"] };
}

// "Approved" is what the screens call a payout somebody has agreed (the database calls it agreed).
export const PAYOUT_LABEL: Record<PayoutRow["state"], [string, "good" | "wait" | "bad"]> = {
  matched: ["Matched", "good"], agreed: ["Approved", "good"], different: ["Different amount", "bad"], missing: ["Not received", "wait"],
  no_reference: ["Needs platform code", "wait"], no_expected_amount: ["Needs expected payout", "wait"],
};
// An approved stay whose money has not arrived yet reads "Approved, not received".
export function payoutStateLabel(row: Pick<PayoutRow, "state" | "fundsReceived">): [string, "good" | "wait" | "bad"] {
  return row.state === "agreed" && row.fundsReceived === false ? ["Approved, not received", "wait"] : PAYOUT_LABEL[row.state];
}
export const CHANNEL_LABEL: Record<string, string> = { airbnb: "Airbnb", booking_com: "Booking.com", vrbo: "Vrbo", direct: "Direct", other: "Other" };

// --- Platform stays on the Payouts screen: what each row can do, the numbers it shows, and approving many at once.
// The rules below mirror workspace_agree_payouts in the database, which makes the same choices again when the request arrives.
const MAX_AGREED_MINOR = 100_000_000;
type PayoutAmounts = Pick<PayoutRow, "state" | "expectedMinor" | "receivedMinor">;
const agreeable = (value: number | null): value is number => value !== null && value >= 0 && value <= MAX_AGREED_MINOR;

// The amount an approval agrees. A stay not paid yet is agreed at what was expected; a stay paid a different
// amount is agreed at what arrived. Anything else has nothing to approve, or needs a person to look first.
export function payoutApproval(row: PayoutAmounts): { agreedMinor: number; basis: "expected" | "received" } | null {
  if (row.state === "missing" && agreeable(row.expectedMinor)) return { agreedMinor: row.expectedMinor, basis: "expected" };
  if (row.state === "different" && agreeable(row.receivedMinor)) return { agreedMinor: row.receivedMinor, basis: "received" };
  return null;
}
// What a row offers beside its figures: approve it in place, add what it is missing, or nothing (already settled).
export type PayoutMove = "approve" | "details" | "none";
export function payoutMove(row: PayoutAmounts): PayoutMove {
  if (row.state === "matched" || row.state === "agreed") return "none";
  return payoutApproval(row) ? "approve" : "details";
}
// Received minus expected, once both are known. Negative means the platform paid less than expected.
export const payoutDifference = (row: Pick<PayoutRow, "expectedMinor" | "receivedMinor">) => row.expectedMinor !== null && row.receivedMinor !== null ? row.receivedMinor - row.expectedMinor : null;

// "open" is a stay nobody has settled yet (not matched, not approved); "settled" is the opposite.
export type PayoutStatusFilter = "open" | "settled" | "all";
export const isOpenPayout = (row: Pick<PayoutRow, "settledMinor">) => row.settledMinor === null;
// Stays of the chosen kind, narrowed to the chosen check-in dates. No dates chosen means every date.
export function filterPayouts<T extends Pick<PayoutRow, "settledMinor" | "checkIn">>(rows: T[], status: PayoutStatusFilter, dates: readonly string[] = []): T[] {
  return rows.filter(row => (status === "all" || (status === "open") === isOpenPayout(row)) && (!dates.length || dates.includes(row.checkIn)));
}
// What a stay row shows, as one piece of text for the search box: its reference, property, platform, platform code, check-in
// date, status and amounts. It is already normalised, so match it with matchesSearch (lib/search-options.ts).
export function payoutSearchText(row: PayoutRow, propertyName?: string): string {
  return normalise([row.reference, propertyName, CHANNEL_LABEL[row.channel] ?? row.channel, row.channelReference, row.checkIn, formatDay(row.checkIn), payoutStateLabel(row)[0],
    pounds(row.expectedMinor), pounds(row.receivedMinor), row.agreedMinor === null ? "" : pounds(row.agreedMinor)].filter(Boolean).join(" "));
}
// The check-in dates present, earliest first, with how many stays each has.
export function payoutDates(rows: Pick<PayoutRow, "checkIn">[]): { date: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.checkIn, (counts.get(row.checkIn) ?? 0) + 1);
  return [...counts].sort((a, b) => a[0].localeCompare(b[0])).map(([date, count]) => ({ date, count }));
}
// Totals for the rows in view. Only amounts that are known are added, so a stay not paid yet adds to expected and not to received.
export function payoutTotals(rows: Pick<PayoutRow, "expectedMinor" | "receivedMinor">[]) {
  let expectedMinor = 0, receivedMinor = 0;
  for (const row of rows) { expectedMinor += row.expectedMinor ?? 0; receivedMinor += row.receivedMinor ?? 0; }
  return { count: rows.length, expectedMinor, receivedMinor };
}

// What "Approve all" would do to the rows in view. Stays paid a different amount are left for a person to look at
// unless they are included on purpose.
export type BulkPayoutPlan = {
  items: { reservationId: string; version: number }[];
  atExpected: { count: number; minor: number }; atReceived: { count: number; minor: number };
  heldBack: number; needDetails: number; settled: number;
};
export function bulkPayoutPlan(rows: Pick<PayoutRow, "reservationId" | "version" | "state" | "expectedMinor" | "receivedMinor">[], includeDifferent: boolean): BulkPayoutPlan {
  const plan: BulkPayoutPlan = { items: [], atExpected: { count: 0, minor: 0 }, atReceived: { count: 0, minor: 0 }, heldBack: 0, needDetails: 0, settled: 0 };
  for (const row of rows) {
    const move = payoutMove(row);
    if (move === "none") { plan.settled++; continue; }
    const approval = payoutApproval(row);
    if (!approval) { plan.needDetails++; continue; }
    if (approval.basis === "received" && !includeDifferent) { plan.heldBack++; continue; }
    const bucket = approval.basis === "received" ? plan.atReceived : plan.atExpected;
    bucket.count++; bucket.minor += approval.agreedMinor;
    plan.items.push({ reservationId: row.reservationId, version: row.version });
  }
  return plan;
}
// The screen sends long lists in several requests; the server accepts up to BULK_PAYOUT_LIMIT in one.
export const BULK_PAYOUT_CHUNK = 250;
export function chunk<T>(items: T[], size: number): T[][] {
  const parts: T[][] = [];
  for (let i = 0; i < items.length; i += size) parts.push(items.slice(i, i + size));
  return parts;
}
export const bulkApprovalSchema = z.object({
  approved: z.number(), approvedMinor: minor, atExpected: z.number(), atReceived: z.number(),
  skipped: z.object({ changed: z.number(), settled: z.number(), needsDetails: z.number(), different: z.number(), locked: z.number(), notFound: z.number() }),
});
export type BulkApproval = z.infer<typeof bulkApprovalSchema>;
export const sumBulkApprovals = (parts: BulkApproval[]): BulkApproval => parts.reduce<BulkApproval>((all, part) => ({
  approved: all.approved + part.approved, approvedMinor: all.approvedMinor + part.approvedMinor, atExpected: all.atExpected + part.atExpected, atReceived: all.atReceived + part.atReceived,
  skipped: { changed: all.skipped.changed + part.skipped.changed, settled: all.skipped.settled + part.skipped.settled, needsDetails: all.skipped.needsDetails + part.skipped.needsDetails,
    different: all.skipped.different + part.skipped.different, locked: all.skipped.locked + part.skipped.locked, notFound: all.skipped.notFound + part.skipped.notFound },
}), { approved: 0, approvedMinor: 0, atExpected: 0, atReceived: 0, skipped: { changed: 0, settled: 0, needsDetails: 0, different: 0, locked: 0, notFound: 0 } });

// Money is written one way across the app (lib/format).
export const pounds = (value: number | null | undefined) => formatMoney(value);
export const shiftMonth = (period: string, by: number) => { const [y, m] = period.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + by, 1)); return d.toISOString().slice(0, 7); };
export const monthLabel = (period: string) => new Date(period + "-01T12:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
