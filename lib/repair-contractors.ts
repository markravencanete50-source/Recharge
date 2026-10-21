import { z } from 'zod';
import { poundsToMinor } from './repairs-live';
import { repliesByEmail, repliesInChat } from './guest-inbox-policy';

// Repairs with contractors (plan approved by Lee on 15 October 2026; database: migration 20261021200000).
// A guest reports a problem, Stays try to fix it over chat, and if they can't they send it to ONE named contractor (a
// Ready user) for an estimate. Management approve it (then the owner when it is over their limit), and the contractor
// books the visit and does the job. Every field and step name the screens use is here, so a rename is one line.
export const REPAIR_FIELDS = {
  guestConversation: 'guestConversationId', readyUser: 'readyUserId', assignedId: 'assignedReadyId', assignedName: 'assignedReadyName',
  quoteFiles: 'quoteFileIds', invoiceFiles: 'invoiceFileIds', visitFrom: 'visitFrom', visitTo: 'visitTo', clashes: 'clashes', bookingApproved: 'bookingApprovedAt',
  // While the team reviews a contractor's estimate (team_review): the owner's effective limit, for the Review done preview.
  // The database strips these from everything Ready reads; the screens never show them to a contractor either.
  ownerLimit: 'ownerLimitMinor', ownerFullPermission: 'ownerFullPermission', ownerLimitSource: 'ownerLimitSource',
} as const;
export const REASSIGN_STEP = 'reassignReady' as const;
// Management (admins and super admins) checked a contractor's estimate: approved within the owner's limit, else the owner
// is asked (the database decides). Stays see the estimate waiting for management.
export const REVIEW_STEP = 'reviewDone' as const;
export const REVIEW_PHASE = 'team_review' as const;
// GET /api/mobile/operations?section=repairContractors&propertyId=… reads rpc workspace_repair_contractors(property_id).
export const CONTRACTORS_READ = { section: 'repairContractors', rpc: 'workspace_repair_contractors', arg: 'property_id' } as const;
export const contractorsQuery = (propertyId: string) => '?' + new URLSearchParams({ section: CONTRACTORS_READ.section, propertyId }).toString();

const uuid = z.string().uuid();
export const contractorSchema = z.object({ id: uuid, name: z.string(), trade: z.string().nullable().optional() });
export const contractorsSchema = z.array(contractorSchema);
export type Contractor = z.infer<typeof contractorSchema>;
export const contractorLabel = (c: Contractor) => c.trade ? `${c.name} · ${c.trade}` : c.name;

// A guest stay on the visit day that overlaps the visit window, at the stay's own check-in and check-out times from
// Hostaway (14:00 in and 10:00 out when unknown; migration 20261021700000). The label is ready-made, with that time and
// no guest name ("Guest stay, check-in 15:00", "Guest stay, check-out 11:00"). A clash warns; it never stops the booking.
export const clashSchema = z.object({ checkIn: z.string().nullable().optional(), checkOut: z.string().nullable().optional(), label: z.string() });
export type Clash = z.infer<typeof clashSchema>;
// On the repair (data.clashes), or in the write's answer (the repair, or its data).
export function clashesOf(value: unknown): Clash[] {
  const at = (v: unknown) => v && typeof v === 'object' ? v as Record<string, unknown> : {};
  const outer = at(value), raw = outer[REPAIR_FIELDS.clashes] ?? at(outer.data)[REPAIR_FIELDS.clashes];
  const parsed = z.array(clashSchema).safeParse(raw);
  return parsed.success ? parsed.data : [];
}
// The contractor is told Stays will let the guest know; Stays are asked to.
export const clashWarning = (clashes: readonly Clash[], forContractor = true) => !clashes.length ? null
  : `${clashes.length === 1 ? 'A guest is' : 'Guests are'} staying around the visit. ${forContractor ? 'Stays will let the guest know you are coming.' : 'Let the guest know when the contractor is coming.'}`;

const str = (v: unknown) => typeof v === 'string' && v ? v : null;
const ids = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
export const quoteFilesOf = (data: Record<string, unknown>) => ids(data[REPAIR_FIELDS.quoteFiles]);
export const invoiceFilesOf = (data: Record<string, unknown>) => ids(data[REPAIR_FIELDS.invoiceFiles]);
export const guestConversationOf = (data: Record<string, unknown>) => str(data[REPAIR_FIELDS.guestConversation]);
// The contractor on the job, or null before it is sent to one (and on repairs referred before contractors were named).
export function assignedContractor(data: Record<string, unknown>): { id: string; name: string } | null {
  const id = str(data[REPAIR_FIELDS.assignedId]);
  return id ? { id, name: str(data[REPAIR_FIELDS.assignedName]) ?? 'Contractor' } : null;
}
// The contractor's name alone. Staff read it with the id; owners get the name only, never the id or anything else about
// the contractor (migration 20261021700000). Null before the job goes to a contractor.
export const contractorNameOf = (data: Record<string, unknown>) => assignedContractor(data)?.name ?? str(data[REPAIR_FIELDS.assignedName]);
// Is this person the contractor on the job? Older repairs with nobody named stay open to Ready as before.
export const assignedTo = (data: Record<string, unknown>, userId: string) => { const a = assignedContractor(data); return !a || a.id === userId; };
// Approval is complete and the contractor can book: the database stamps bookingApprovedAt, and clears it on a new estimate.
export const bookingApproved = (data: Record<string, unknown>) => !!str(data[REPAIR_FIELDS.bookingApproved]);

// Where a job is for the contractor, in the words on their Home.
// A contractor never sees why an estimate goes to the owner (the owner's limit): only where it is.
export type ContractorStage = 'estimate' | 'review' | 'owner' | 'waiting' | 'book' | 'booked' | 'declined' | 'done';
export const CONTRACTOR_STAGES: { stage: ContractorStage; label: string; detail: string }[] = [
  { stage: 'estimate', label: 'Send an estimate', detail: 'Look at the job and send your price' },
  { stage: 'review', label: 'Being reviewed by management', detail: 'Recharge management are checking your estimate' },
  { stage: 'owner', label: 'Waiting for the owner', detail: 'The owner is approving your estimate' },
  { stage: 'waiting', label: 'Waiting for approval', detail: 'Recharge are checking your estimate' },
  { stage: 'book', label: 'Approved, please book', detail: 'Choose the day and time for the visit' },
  { stage: 'booked', label: 'Booked', detail: 'Do the job, then mark it done' },
  { stage: 'declined', label: 'Estimate declined', detail: 'Recharge will be in touch' },
  { stage: 'done', label: 'Done', detail: 'Finished jobs' },
];
export function contractorStage(data: Record<string, unknown>): ContractorStage | null {
  const phase = String(data.phase ?? '');
  if (phase === 'referred') return bookingApproved(data) ? 'book' : 'estimate';
  if (phase === REVIEW_PHASE) return 'review';
  if (phase === 'owner_approval') return 'owner';
  if (phase === 'management_approval') return 'waiting';
  if (phase === 'booked') return 'booked';
  if (phase === 'management_declined' || phase === 'owner_declined') return 'declined';
  if (phase === 'completed') return 'done';
  return null;
}
export const contractorStageLabel = (stage: ContractorStage) => CONTRACTOR_STAGES.find(s => s.stage === stage)!.label;
// What a Ready user does next on a job (the database checks it again): never on a job given to someone else.
export function contractorAction(role: string, userId: string, data: Record<string, unknown>): 'estimate' | 'book' | 'complete' | null {
  if (role !== 'ready' || !assignedTo(data, userId)) return null;
  const stage = contractorStage(data);
  return stage === 'estimate' ? 'estimate' : stage === 'book' ? 'book' : stage === 'booked' ? 'complete' : null;
}
// Stays and admins change the contractor while it is with them or waiting on approval.
export const canReassign = (role: string, data: Record<string, unknown>) => ['stays', 'admin', 'super_admin'].includes(role) && !!assignedContractor(data)
  && ['referred', 'booked', REVIEW_PHASE, 'management_approval', 'owner_approval'].includes(String(data.phase ?? ''));

// --- Visit window ------------------------------------------------------------------------------------
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;
// Half-hour times from 07:00 to 21:00, for the From and To choices.
export const VISIT_TIMES = Array.from({ length: 29 }, (_, i) => `${String(7 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
export function visitWindowProblem(from: string, to: string): string | null {
  if (!CLOCK.test(from) || !CLOCK.test(to)) return 'Choose the time the visit starts and ends.';
  return from < to ? null : 'The visit must end after it starts.';
}
export const visitWindowLabel = (from: unknown, to: unknown) => typeof from === 'string' && typeof to === 'string' && CLOCK.test(from) && CLOCK.test(to) ? `${from} to ${to}` : null;
const DAY = new Intl.DateTimeFormat('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/London' });
const dayText = (day: string) => DAY.format(new Date(day + 'T12:00:00Z'));
// What the guest is told when a contractor books (Stays see it and tell the guest).
export const visitGuestUpdate = (day: string, from: string, to: string) => `A repair visit is booked for ${dayText(day)} between ${from} and ${to}.`;

// --- Requests ----------------------------------------------------------------------------------------
type Built<T> = { error: string } | { data: T };
export function referData(input: { troubleshooting: string; guestUpdate: string; urgent: boolean; warranty: string; warrantyNeeded: boolean; readyUserId: string }): Built<Record<string, unknown>> {
  if (!input.readyUserId) return { error: 'Choose the contractor to send it to.' };
  if (input.troubleshooting.trim().length < 5 || input.guestUpdate.trim().length < 5) return { error: 'Tick the checks you went through (or describe them) and add what the guest was told.' };
  if (input.warrantyNeeded && input.warranty.trim().length < 10) return { error: 'This property needs the warranty provider contacted first. Add who you contacted.' };
  return { data: { troubleshooting: input.troubleshooting.trim(), guestUpdate: input.guestUpdate.trim(), urgent: input.urgent, [REPAIR_FIELDS.readyUser]: input.readyUserId, ...(input.warranty.trim() ? { warrantyContactEvidence: input.warranty.trim() } : {}) } };
}
export function reassignData(readyUserId: string, currentId: string | null, reason: string): Built<Record<string, unknown>> {
  if (!readyUserId) return { error: 'Choose the new contractor.' };
  if (readyUserId === currentId) return { error: 'That contractor already has the job. Choose someone else.' };
  if (reason.trim().length < 5) return { error: 'Say why it is moving to someone else (at least 5 characters).' };
  return { data: { [REPAIR_FIELDS.readyUser]: readyUserId, reason: reason.trim() } };
}
export function estimateData(amount: string, reason: string, fileIds: readonly string[]): Built<Record<string, unknown>> {
  const minor = poundsToMinor(amount);
  if (minor === null || minor <= 0) return { error: 'Add your price for the job, like 180 or 180.50.' };
  if (reason.trim().length < 5) return { error: 'Say what the work is (at least 5 characters).' };
  return { data: { quoteMinor: minor, reason: reason.trim(), quoteSource: 'contractor', ...(fileIds.length ? { [REPAIR_FIELDS.quoteFiles]: [...fileIds] } : {}) } };
}
export function bookingData(input: { day: string; from: string; to: string; contractor: string; guestUpdate: string }): Built<Record<string, unknown>> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.day)) return { error: 'Choose the day of the visit.' };
  const window = visitWindowProblem(input.from, input.to);
  if (window) return { error: window };
  if (input.contractor.trim().length < 2) return { error: 'Add who is doing the repair.' };
  if (input.guestUpdate.trim().length < 5) return { error: 'Add the update for the guest.' };
  return { data: { repairOn: input.day, [REPAIR_FIELDS.visitFrom]: input.from, [REPAIR_FIELDS.visitTo]: input.to, contractor: input.contractor.trim(), guestUpdate: input.guestUpdate.trim() } };
}
export function completeData(input: { report: string; cost: string; guestUpdate: string; estimateMinor: unknown; photoIds: readonly string[]; invoiceIds: readonly string[] }): Built<Record<string, unknown>> {
  const cost = poundsToMinor(input.cost);
  if (input.report.trim().length < 10 || input.guestUpdate.trim().length < 5 || cost === null) return { error: 'Add the repair report, the actual cost and the guest update.' };
  if (typeof input.estimateMinor === 'number' && cost > input.estimateMinor) return { error: 'The cost is above the approved estimate. Send a new estimate first; it goes for approval, then you can mark the job done.' };
  return { data: { report: input.report.trim(), actualCostMinor: cost, guestUpdate: input.guestUpdate.trim(), ...(input.photoIds.length ? { photoIds: [...input.photoIds] } : {}), ...(input.invoiceIds.length ? { [REPAIR_FIELDS.invoiceFiles]: [...input.invoiceIds] } : {}) } };
}

// --- From the guest chat -----------------------------------------------------------------------------
export type ChatPrefill = { propertyId: string | null; guestConversationId: string; guestName: string | null; reservationRef: string | null; checkIn: string | null };
// The stay the conversation is about, among the property's stays: by booking reference, else by check-in day.
export function matchStay<T extends { id: string; reference: string; checkIn: string }>(stays: readonly T[], prefill: Pick<ChatPrefill, 'reservationRef' | 'checkIn'>): string {
  const ref = prefill.reservationRef?.trim().toLowerCase(), checkIn = prefill.checkIn?.slice(0, 10);
  return (ref ? stays.find(s => s.reference.trim().toLowerCase() === ref) : undefined)?.id
    ?? (checkIn ? stays.find(s => s.checkIn === checkIn) : undefined)?.id ?? '';
}
// How a reply reaches the guest from Recharge: through Hostaway, by email, or not at all (logged by hand).
export function guestSendRoute(view: { canSend: boolean; canSendEmail: boolean; thread: { source: string; websiteChat?: boolean } }): 'send' | 'none' {
  return (view.canSend && view.thread.source === 'hostaway') || (view.canSendEmail && repliesByEmail(view.thread)) || repliesInChat(view.thread) ? 'send' : 'none';
}
// The guest chat is for the team who talk to guests: never a contractor (Ready never sees guest contact details).
export const seesGuestChat = (role: string) => ['stays', 'admin', 'super_admin'].includes(role);
// "Fixed in chat": the words sent to the guest, from what fixed it.
export const fixedInChatMessage = (resolution: string) => `Thanks for your patience. ${resolution.trim().replace(/\.?$/, '.')} Let us know if anything else needs a look.`;

// --- Review done: the owner's limit, as a preview for the team ------------------------------------------
// The decision is the database's (reviewDone, with the limit as it is then). Never shown to a contractor (role 'ready').
const poundsText = (minor: number) => '£' + (minor % 100 ? (minor / 100).toFixed(2) : String(minor / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
export function ownerLimitLine(role: string, data: Record<string, unknown>): string | null {
  if (role === 'ready' || role === 'client') return null;
  const estimate = typeof data.estimatedCostMinor === 'number' ? data.estimatedCostMinor : null;
  const limit = data[REPAIR_FIELDS.ownerLimit], full = data[REPAIR_FIELDS.ownerFullPermission], source = data[REPAIR_FIELDS.ownerLimitSource];
  if (full === true) return "The owner gave full permission: this will be approved straight away.";
  if (typeof limit === 'number' && estimate !== null) return estimate <= limit
    ? `Within the owner's limit (${poundsText(limit)}): this will be approved straight away.`
    : `Above the owner's limit (${poundsText(limit)}): the owner will be asked.`;
  if (source === 'none' || (source !== undefined && limit === null)) return "The owner has no repair limit set: the owner will be asked.";
  return null;
}
export const reviewData = (note: string): Record<string, unknown> => note.trim() ? { note: note.trim().slice(0, 2000) } : {};

// --- Limit Changer -------------------------------------------------------------------------------------
// GET /api/mobile/operations?section=repairLimits → rpc workspace_repair_limits_read() (admins and super admins).
// POST /api/mobile/operations {action:'setRepairLimit',…} → rpc workspace_repair_limits_action(input) (super admins only).
export const LIMITS_READ = { section: 'repairLimits', rpc: 'workspace_repair_limits_read' } as const;
export const LIMITS_ACTION = { action: 'setRepairLimit', rpc: 'workspace_repair_limits_action', arg: 'input' } as const;
export const limitsQuery = () => '?' + new URLSearchParams({ section: LIMITS_READ.section }).toString();
export const repairLimitActionSchema = z.object({
  requestId: uuid, action: z.literal(LIMITS_ACTION.action), propertyIds: z.array(uuid).min(1).max(200),
  limitMinor: z.number().int().min(0).max(10000000).nullable(), fullPermission: z.boolean(),
}).strict().refine(v => !(v.fullPermission && v.limitMinor !== null), { message: 'Full permission has no amount' });
export type RepairLimitAction = z.infer<typeof repairLimitActionSchema>;
export const limitRowSchema = z.object({
  propertyId: uuid, propertyName: z.string(), limitMinor: z.number().nullable(), fullPermission: z.boolean(),
  source: z.enum(['form', 'set', 'none']), updatedBy: z.string().nullable().optional(), updatedByName: z.string().nullable().optional(), updatedAt: z.string().nullable().optional(),
});
export type LimitRow = z.infer<typeof limitRowSchema>;
export const limitsSchema = z.object({
  companyLimitMinor: z.number().nullable(), canEdit: z.boolean().default(false),
  owners: z.array(z.object({ ownerKey: z.string(), ownerName: z.string().nullable(), properties: z.array(limitRowSchema) })),
});
export type Limits = z.infer<typeof limitsSchema>;
export const limitResultSchema = z.object({ properties: z.array(limitRowSchema).default([]), autoApproved: z.array(uuid).default([]) });
export const ownerTitle = (owner: { ownerName: string | null }) => owner.ownerName?.trim() || 'Owner not recorded';
export const limitText = (row: Pick<LimitRow, 'limitMinor' | 'fullPermission'>) => row.fullPermission ? 'Full permission' : row.limitMinor === null ? 'Always ask' : `Up to ${poundsText(row.limitMinor)}`;
export const SOURCE_TEXT: Record<LimitRow['source'], string> = { form: 'From the set-up form', set: 'Set in Limit Changer', none: 'Not set' };
// "Changed by Alex on 15 Oct": a name, never a raw id.
export function changedText(row: Pick<LimitRow, 'updatedBy' | 'updatedByName' | 'updatedAt'>): string | null {
  const who = row.updatedByName?.trim() || (row.updatedBy && !uuid.safeParse(row.updatedBy).success ? row.updatedBy : null);
  const when = row.updatedAt ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' }).format(new Date(row.updatedAt)) : null;
  return who || when ? ['Changed', who ? 'by ' + who : null, when ? 'on ' + when : null].filter(Boolean).join(' ') : null;
}
export type LimitChoice = 'amount' | 'full' | 'ask';
export const LIMIT_CHOICES: { value: LimitChoice; label: string }[] = [{ value: 'amount', label: 'Up to an amount' }, { value: 'full', label: 'Full permission' }, { value: 'ask', label: 'Always ask' }];
export const choiceOf = (row: Pick<LimitRow, 'limitMinor' | 'fullPermission'>): LimitChoice => row.fullPermission ? 'full' : row.limitMinor === null ? 'ask' : 'amount';
export function limitAction(requestId: string, propertyIds: readonly string[], choice: LimitChoice, amount: string): Built<RepairLimitAction> {
  if (!propertyIds.length) return { error: 'Choose at least one property.' };
  const minor = choice === 'amount' ? poundsToMinor(amount) : null;
  if (choice === 'amount' && minor === null) return { error: 'Add the limit in pounds, like 250.' };
  const parsed = repairLimitActionSchema.safeParse({ requestId, action: LIMITS_ACTION.action, propertyIds: [...propertyIds], limitMinor: minor, fullPermission: choice === 'full' });
  return parsed.success ? { data: parsed.data } : { error: 'Check the limit and try again.' };
}
export const autoApprovedText = (n: number) => n ? `${n} waiting estimate${n === 1 ? ' was' : 's were'} approved automatically.` : 'No waiting estimates were within the new limit.';
