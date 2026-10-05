import { z } from "zod";
import { MODULE_IDS } from "./modules";
import { parseAnalyticsDate, periodError } from "./analytics";
const uuid = z.string().uuid();
const version = z.number().int().positive();
const text = (maximum: number) => z.string().trim().max(maximum);
const date = z.string().refine(value => Boolean(parseAnalyticsDate(value)), "Choose a valid date");
const period = z.object({ from: date, to: date }).strict().refine(value => !periodError(value));
export const businessReadSchema = z.object({
  entity: z.enum(["properties", "work", "updates", "invoices", "threads", "messages", "activity"]).default("work"),
  moduleId: z.enum(MODULE_IDS).optional(), propertyId: uuid.optional(), workId: uuid.optional(), threadId: uuid.optional(),
  cursor: uuid.optional(), limit: z.coerce.number().int().min(1).max(100).default(50),
}).strict();
export const reportPeriodSchema = period;
export const businessWriteSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("saveProperty"), input: z.object({ id: uuid.optional(), version: version.optional(), requestId: uuid.optional(), name: text(200).min(2), address: text(1000).default(""), region: text(200).default(""), bedrooms: z.number().int().min(0).max(100).default(0), status: z.enum(["onboarding", "active", "archived"]).default("onboarding") }).strict().refine(input => input.id ? Boolean(input.version) : Boolean(input.requestId), "An existing record requires its version; a new record requires a request identifier") }).strict(),
  z.object({ action: z.literal("assignProperty"), propertyId: uuid, userId: uuid, assignment: z.enum(["client", "cleaner", "cleaning_manager", "staff"]) }).strict(),
  z.object({ action: z.literal("unassignProperty"), propertyId: uuid, userId: uuid }).strict(),
  z.object({ action: z.literal("createWork"), input: z.object({ requestId: uuid, propertyId: uuid, moduleId: z.enum(MODULE_IDS), title: text(200).min(2), description: text(10000).default(""), priority: z.enum(["normal", "high", "urgent"]).default("normal"), dueOn: date.optional(), assigneeId: uuid.optional(), clientVisible: z.boolean().default(false) }).strict() }).strict(),
  z.object({ action: z.literal("transitionWork"), workId: uuid, version, status: z.enum(["waiting", "in_progress", "in_review", "approved", "completed", "cancelled", "declined"]), note: text(5000).default(""), requestId: uuid }).strict(),
  z.object({ action: z.literal("assignWork"), workId: uuid, version, userId: uuid.nullable() }).strict(),
  z.object({ action: z.literal("requestClientApproval"), workId: uuid, version }).strict(),
  z.object({ action: z.literal("createInvoice"), input: z.object({ requestId: uuid, propertyId: uuid, moduleId: z.enum(["cleans-invoices", "onboarding-invoices", "purchase-order-invoices", "purchase-order-accounts", "maintenance-reconciliation", "owner-statements"]), workId: uuid.optional(), recipientId: uuid, reference: text(100).min(1), amountMinor: z.number().int().min(0).max(999999999999), currency: z.enum(["GBP", "USD", "EUR"]), issuedOn: date.optional() }).strict() }).strict(),
  z.object({ action: z.literal("setInvoiceStatus"), invoiceId: uuid, version, status: z.enum(["paid", "void"]) }).strict(),
  z.object({ action: z.literal("createThread"), propertyId: uuid, subject: text(200).min(2), clientVisible: z.boolean().default(false), requestId: uuid }).strict(),
  z.object({ action: z.literal("sendMessage"), threadId: uuid, body: text(5000).min(1), requestId: uuid }).strict(),
]);
export type BusinessAction = z.infer<typeof businessWriteSchema>;
export function businessRpc(input: BusinessAction): { name: string; args: Record<string, unknown> } {
  switch (input.action) {
    case "saveProperty": return { name: "workspace_save_property", args: { input: input.input } };
    case "assignProperty": return { name: "workspace_assign_property", args: { target_property: input.propertyId, target_user: input.userId, assignment_kind: input.assignment } };
    case "unassignProperty": return { name: "workspace_unassign_property", args: { target_property: input.propertyId, target_user: input.userId } };
    case "createWork": return { name: "workspace_create_work", args: { input: input.input } };
    case "transitionWork": return { name: "workspace_transition_work", args: { target_work: input.workId, expected_version: input.version, next_status: input.status, note: input.note, request_id: input.requestId } };
    case "assignWork": return { name: "workspace_assign_work", args: { target_work: input.workId, expected_version: input.version, target_user: input.userId } };
    case "requestClientApproval": return { name: "workspace_request_client_approval", args: { target_work: input.workId, expected_version: input.version } };
    case "createInvoice": return { name: "workspace_create_invoice", args: { input: input.input } };
    case "setInvoiceStatus": return { name: "workspace_set_invoice_status", args: { target_invoice: input.invoiceId, expected_version: input.version, next_status: input.status } };
    case "createThread": return { name: "workspace_create_thread", args: { target_property: input.propertyId, subject: input.subject, client_visible: input.clientVisible, request_id: input.requestId } };
    case "sendMessage": return { name: "workspace_send_message", args: { target_thread: input.threadId, message_body: input.body, request_id: input.requestId } };
  }
}
