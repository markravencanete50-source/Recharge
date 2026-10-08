import { formatMoney } from "./format";
import { z } from "zod";

// Response shapes and rules the live Accounts screens rely on, shared with the
// tests that check them against the real database functions.
const minor = z.number().int();
const nullableMinor = minor.nullable();

export const EXPENSE_STATUSES = ["to_approve", "queried", "approved", "rejected"] as const;
export const EXPENSE_CATEGORIES = ["maintenance", "property_setup", "cleaning_supplies", "utilities", "furnishing", "other"] as const;
export const EVIDENCE_KINDS = ["invoice", "photo", "quote", "report"] as const;

export const overviewSchema = z.object({
  toApproveCount: z.number(), toApproveMinor: minor, queriedCount: z.number(), queuedForXero: z.number(), overLimitCount: z.number(),
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

export const PAYOUT_STATES = ["matched", "agreed", "different", "missing", "no_reference", "no_expected_amount"] as const;
export const payoutRowSchema = z.object({
  reservationId: z.string().uuid(), propertyId: z.string().uuid(), reference: z.string(), channel: z.string(), channelReference: z.string().nullable(),
  checkIn: z.string(), checkOut: z.string(), guests: z.number().nullable(), expectedMinor: nullableMinor, receivedMinor: nullableMinor, agreedMinor: nullableMinor,
  agreementNote: z.string().nullable(), state: z.enum(PAYOUT_STATES), version: z.number(), settledMinor: nullableMinor,
});
export type PayoutRow = z.infer<typeof payoutRowSchema>;
export const reconciliationSchema = z.object({
  period: z.string(),
  rows: z.array(payoutRowSchema),
  needsDetails: z.array(z.object({ reservationId: z.string().uuid(), propertyId: z.string().uuid(), propertyName: z.string(), reference: z.string(), channel: z.string(),
    checkIn: z.string(), checkOut: z.string(), guests: z.number().nullable(), version: z.number() })),
  unexpected: z.array(z.object({ lineId: z.string().uuid(), channel: z.string(), reference: z.string(), amountMinor: minor, fileName: z.string(), uploadedAt: z.string() })),
  reports: z.array(z.object({ id: z.string().uuid(), channel: z.string(), fileName: z.string(), lineCount: z.number(), totalMinor: minor, uploadedAt: z.string() })),
});

export const statementSchema = z.object({
  id: z.string().uuid(), propertyId: z.string().uuid(), propertyName: z.string(), period: z.string(), status: z.enum(["draft", "issued", "paid", "void"]),
  revenueMinor: minor, cleaningCount: z.number(), cleaningMinor: minor, expensesMinor: minor, feeBps: z.number(), feeMinor: minor, payoutMinor: minor,
  payoutMethod: z.string().nullable(), payoutReference: z.string().nullable(), paidAt: z.string().nullable(), issuedAt: z.string().nullable(), version: z.number(),
  detail: z.object({
    stays: z.array(z.object({ reference: z.string(), channel: z.string(), checkIn: z.string(), checkOut: z.string(), amountMinor: minor })),
    expenses: z.array(z.object({ supplier: z.string(), reference: z.string(), amountMinor: minor })),
    cleaningCostMinor: minor,
  }).passthrough(),
});
export type Statement = z.infer<typeof statementSchema>;
export const statementsSchema = z.array(z.object({
  propertyId: z.string().uuid(), propertyName: z.string(),
  terms: z.object({ managementFeeBps: z.number().nullable(), cleaningCostMinor: nullableMinor }).nullable(),
  statement: statementSchema.nullable(), unsettledPayouts: z.number(), missingDetails: z.number(),
}));
export const policySchema = z.object({ expenseApprovalLimitMinor: nullableMinor, version: z.number(), updatedAt: z.string().nullable(), managementRepairLimitMinor: nullableMinor.default(null) });

// --- Rules mirrored from workspace_finance_action, so the screens only offer what can succeed.
export const FINANCE_ROLES = ["accounts", "admin", "super_admin"];
export const isFinanceRole = (role: string) => FINANCE_ROLES.includes(role);
const management = (role: string) => role === "admin" || role === "super_admin";

export type ExpenseMove = "approve" | "query" | "resolve" | "reject" | "evidence";
export function expenseMoves(role: string, expense: Pick<Expense, "status" | "amountMinor" | "hasInvoice" | "hasProof">, limitMinor: number | null): { moves: ExpenseMove[]; blocked?: string } {
  if (!isFinanceRole(role)) return { moves: [] };
  if (expense.status === "queried") return { moves: ["resolve", "reject", "evidence"] };
  if (expense.status !== "to_approve") return { moves: [] };
  const moves: ExpenseMove[] = ["query", "reject", "evidence"];
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

export const PAYOUT_LABEL: Record<PayoutRow["state"], [string, "good" | "wait" | "bad"]> = {
  matched: ["Matched", "good"], agreed: ["Agreed", "good"], different: ["Different amount", "bad"], missing: ["Not received", "wait"],
  no_reference: ["Needs platform code", "wait"], no_expected_amount: ["Needs expected payout", "wait"],
};

// Money is written one way across the app (lib/format).
export const pounds = (value: number | null | undefined) => formatMoney(value);
export const shiftMonth = (period: string, by: number) => { const [y, m] = period.split("-").map(Number); const d = new Date(Date.UTC(y, m - 1 + by, 1)); return d.toISOString().slice(0, 7); };
export const monthLabel = (period: string) => new Date(period + "-01T12:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
