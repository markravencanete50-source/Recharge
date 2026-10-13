import { z } from 'zod';
import { FLAG_MIN_CHARS } from './feedback-defaults';
import { formatDay, formatMoney } from './format';
import { flagAction, flagSchema, mergeApprovals, type ApprovalEntry } from './management-flags';
import type { Decision, Management, RepairApproval } from './management-live';
import { waitedLabel } from './oversight-policy';
import { addressOf, progressOf, type TrackerItem, type TrackerStep, type TrackerTone } from './tracker';
import type { Expense, Statement } from './accounts-live';
import type { CleanerMonth } from './cleans-live';
import type { Detail } from './work-details';
import type { HubItem, TeamsAction } from './workspace-teams-policy';

// The one Management approvals list as tracker items. It merges three things: the open management
// flags (anything staff flagged, plus free-standing requests), the pending approval tickets from the
// hub, and the management queue (repair quotes over the limit, clean decisions, costs over the limit,
// owner approvals that stalled, unusual payouts, owner balances, cleaner warnings, missed checks).
// Every row has steps Raised and Decided, a source badge as its status while it is open, and the age
// it has waited. Only management decides: other staff see just the flags and tickets they raised,
// waiting for management. Owners never see any of it (the adapter returns nothing for them).
export const APPROVALS_SECTION: TrackerItem['section'] = 'approvals';

// What a person can do from a row. 'decide' opens the decision sheet for that kind of item.
export const APPROVAL_DECIDE = 'decide';
export const APPROVAL_REMIND = 'remind';
export const APPROVAL_SEEN = 'seen';
export const APPROVAL_VIEW = 'view';

// A flag as the `flags` read sends it. The pinned flagSchema keeps only the common fields; the read also
// carries the property address, the flagged item's own title and whether the flag is the viewer's.
export const approvalFlagSchema = flagSchema.extend({
  propertyAddress: z.string().nullable().optional(), workTitle: z.string().nullable().optional(), workKind: z.string().nullable().optional(),
  hubTitle: z.string().nullable().optional(), mine: z.boolean().optional(),
});
export type ApprovalFlag = z.infer<typeof approvalFlagSchema>;

// The flags read answers { canDecide, flags: [...] } or a bare list. Rows that do not parse are dropped.
export function parseApprovalFlags(raw: unknown): { canDecide: boolean | null; flags: ApprovalFlag[] } {
  const object = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as { canDecide?: unknown; flags?: unknown } : null;
  const list = Array.isArray(raw) ? raw : Array.isArray(object?.flags) ? object.flags : [];
  return {
    canDecide: typeof object?.canDecide === 'boolean' ? object.canDecide : null,
    flags: list.flatMap(row => { const r = approvalFlagSchema.safeParse(row); return r.success ? [r.data] : []; }),
  };
}

type Stalled = Management['stalledOwnerApprovals'][number];
type Unusual = Management['unusualPayouts'][number];
type Missed = Management['missedYesterday'][number];

export type ApprovalSource =
  | { kind: 'flag'; flag: ApprovalFlag }
  | { kind: 'hub'; item: HubItem }
  | { kind: 'decision'; decision: Decision }
  | { kind: 'expense'; expense: Expense }
  | { kind: 'repair'; repair: RepairApproval }
  | { kind: 'stalled'; stalled: Stalled }
  | { kind: 'payout'; payout: Unusual }
  | { kind: 'balance'; statement: Statement }
  | { kind: 'warning'; warning: CleanerMonth }
  | { kind: 'missed'; missed: Missed };

export type ApprovalInputs = { flags?: readonly ApprovalFlag[]; hub?: readonly HubItem[]; queue?: Management | null };
export type ApprovalContext = {
  now: Date;
  // True for owners (client role): they never see this list.
  owner?: boolean;
  // True for admins, who decide. Everyone else sees only what they raised.
  canDecide: boolean;
  // The signed-in person, to pick out their own flags and tickets.
  userId?: string | null;
  // The address of a property id, when the screen holds the property list.
  property?: (propertyId: string) => { name?: string | null; address?: string | null } | null | undefined;
};

const text = (v: unknown) => typeof v === 'string' ? v.trim() : '';

// What an entry needs to become a tracker row.
type Spec = {
  badge: string; tone?: TrackerTone; propertyId?: string | null; propertyName?: string; address?: string; title: string; amountMinor: number | null; since: string;
  by: string | null; automatic?: boolean; action: string; actionLabel: string; next: string; waitingOn?: string; details: Detail[]; workId?: string; version?: number; extraSearch?: string[];
  // No real date to age it by (an owner balance on a draft statement, a cleaner warning): no "waiting" wording.
  undated?: boolean;
};

function flagSpec(flag: ApprovalFlag, ctx: ApprovalContext): Spec {
  const request = flag.source === 'request';
  const known = flag.propertyId ? ctx.property?.(flag.propertyId) : null;
  const propertyName = text(known?.name) || text(flag.propertyName);
  const address = addressOf(known) || text(flag.propertyAddress) || propertyName || (request ? 'Not about a property' : 'No property');
  const details: Detail[] = [];
  const add = (label: string, value: string, tone?: Detail['tone']) => { if (value) details.push({ label, value, ...(tone ? { tone } : {}) }); };
  add('Why', text(flag.reason));
  add('About', text(flag.workTitle) || text(flag.hubTitle));
  if (flag.amountMinor != null) add('Amount', formatMoney(flag.amountMinor));
  return {
    badge: request ? 'Request' : flag.source === 'clean_form' ? 'Clean form' : 'Flag', propertyId: flag.propertyId ?? null, propertyName, address,
    title: text(flag.title) || 'Flagged for management', amountMinor: flag.amountMinor ?? null, since: flag.createdAt, by: text(flag.raisedByName) || null, automatic: flag.source === 'clean_form',
    action: APPROVAL_DECIDE, actionLabel: 'Decide', next: 'Resolve or decline', details, ...(flag.workId ? { workId: flag.workId } : {}), version: flag.version,
  };
}

function hubSpec(item: HubItem): Spec {
  const details: Detail[] = [];
  if (text(item.details)) details.push({ label: 'Details', value: text(item.details) });
  if (item.amountMinor != null) details.push({ label: 'Amount', value: formatMoney(item.amountMinor) });
  return {
    badge: 'Approval', propertyId: item.propertyId, propertyName: text(item.propertyName), address: text(item.propertyName) || 'No property', title: text(item.title) || 'Approval ticket',
    amountMinor: item.amountMinor, since: item.createdAt, by: text(item.createdByName) || null, action: APPROVAL_DECIDE, actionLabel: 'Decide', next: 'Approve or decline', details, version: item.version,
  };
}

function managementSpec(source: Exclude<ApprovalSource, { kind: 'flag' | 'hub' }>, ctx: ApprovalContext): Spec {
  const now = ctx.now.toISOString();
  switch (source.kind) {
    case 'decision': {
      const d = source.decision, complaint = d.kind === 'cleaning_complaint', cleaner = text(d.cleanerName) || 'Cleaner';
      return { badge: complaint ? 'Clean decision' : 'Cleaner review', tone: 'wait', propertyId: d.propertyId, propertyName: d.propertyName, address: text(d.propertyName) || 'No property',
        title: complaint ? `Contested clean · ${cleaner}` : `Second quality warning · ${cleaner}`, amountMinor: null, since: d.createdAt, by: null, automatic: true,
        action: APPROVAL_DECIDE, actionLabel: 'Decide', next: complaint ? 'Uphold or overturn the rejection' : 'Decide what happens next', workId: d.workId, version: d.version,
        details: [{ label: 'Cleaner', value: cleaner }, { label: 'Cleaner response', value: text(d.cleanerStatement) || 'Not responded yet' }] };
    }
    case 'expense': {
      const e = source.expense, evidence = e.hasInvoice && e.hasProof;
      return { badge: 'Cost over limit', propertyId: e.propertyId, propertyName: e.propertyName, address: text(e.propertyName) || 'No property', title: [text(e.supplier), text(e.reference)].filter(Boolean).join(' · ') || 'Cost over the limit',
        amountMinor: e.amountMinor, since: /^\d{4}-\d{2}-\d{2}/.test(e.receivedOn) ? e.receivedOn : now, by: null, automatic: true, action: APPROVAL_DECIDE, actionLabel: 'Decide', next: 'Approve or decline the cost', version: e.version,
        details: [{ label: 'Evidence', value: evidence ? 'Invoice and proof attached' : 'Invoice or proof missing', ...(evidence ? { tone: 'good' as const } : {}) }, ...(text(e.description) ? [{ label: 'For', value: text(e.description) }] : [])] };
    }
    case 'repair': {
      const r = source.repair;
      return { badge: 'Repair quote', tone: r.urgent || r.hazard ? 'bad' : 'wait', propertyId: r.propertyId, propertyName: r.propertyName, address: text(r.propertyName) || 'No property', title: text(r.issue) || text(r.title) || 'Repair over the limit',
        amountMinor: r.estimatedCostMinor, since: r.waitingSince, by: null, automatic: true, action: APPROVAL_DECIDE, actionLabel: 'Decide', next: 'Approve or decline the repair cost', workId: r.workId, version: r.version,
        details: [{ label: 'Owner', value: r.ownerApprovedAt ? 'Owner approved it' : 'Within the owner’s own limit' }, ...(r.urgent ? [{ label: 'Urgent', value: 'Yes', tone: 'bad' as const }] : []), ...(r.hazard ? [{ label: 'Safety hazard', value: 'Yes', tone: 'bad' as const }] : []),
          ...(r.limitMinor != null ? [{ label: 'Management limit', value: formatMoney(r.limitMinor) }] : [])] };
    }
    case 'stalled': {
      const s = source.stalled, ready = !s.canRemindAt || Date.parse(s.canRemindAt) <= ctx.now.getTime();
      return { badge: 'Owner reply', propertyId: s.propertyId, propertyName: s.propertyName, address: text(s.propertyName) || 'No property', title: s.kind === 'estimate' ? 'Estimate waiting for the owner' : text(s.title) || 'Waiting for the owner',
        amountMinor: s.estimatedCostMinor, since: s.waitingSince, by: null, automatic: true, action: APPROVAL_REMIND, actionLabel: ready ? 'Remind the owner' : 'Reminded in the last day', next: 'Remind the owner', workId: s.workId,
        details: [{ label: 'Reminded', value: s.remindedAt ? formatDay(s.remindedAt, ctx.now) : 'Not yet' }, ...(s.escalatedAt ? [{ label: 'Client relations', value: 'Told', tone: 'bad' as const }] : [])] };
    }
    case 'payout': {
      const s = source.payout, why = s.reason === 'negative' ? 'The owner owes money' : s.reason === 'low' ? 'Much lower than usual' : 'Much higher than usual';
      return { badge: 'Unusual payout', tone: s.reason === 'negative' ? 'bad' : 'wait', propertyId: s.propertyId, propertyName: s.propertyName, address: text(s.propertyName) || 'No property', title: `${s.period} owner statement`,
        amountMinor: s.payoutMinor, since: s.issuedAt ?? now, undated: !s.issuedAt, by: null, automatic: true, action: APPROVAL_DECIDE, actionLabel: 'Decide', next: 'Approve the payout or hold it', version: s.version,
        details: [{ label: 'Why it was caught', value: why, ...(s.reason === 'negative' ? { tone: 'bad' as const } : {}) }, ...(s.averageMinor != null && s.previousStatements ? [{ label: 'Usually', value: formatMoney(s.averageMinor) }] : []),
          { label: 'Statement', value: s.status === 'draft' ? 'Not issued yet' : 'Issued' }] };
    }
    case 'balance': {
      const s = source.statement;
      return { badge: 'Owner balance', tone: 'bad', propertyId: s.propertyId, propertyName: s.propertyName, address: text(s.propertyName) || 'No property', title: `${s.period} statement, owner owes`,
        amountMinor: -s.payoutMinor, since: s.issuedAt ?? now, undated: !s.issuedAt, by: null, automatic: true, action: APPROVAL_VIEW, actionLabel: 'Invoice the owner', next: 'Invoice the owner', version: s.version,
        details: [{ label: 'Statement', value: s.status === 'draft' ? 'Not issued yet' : 'Issued' }] };
    }
    case 'warning': {
      const w = source.warning;
      return { badge: 'Cleaner warning', tone: 'bad', address: 'Cleaning team', title: `${text(w.fullName) || 'Cleaner'}: ${w.rejected} rejected`, amountMinor: null, since: now, undated: true, by: null, automatic: true,
        action: APPROVAL_VIEW, actionLabel: 'Review', next: 'Review this month’s cleans',
        details: [{ label: 'This month', value: `${w.accepted} accepted, ${w.rejected} rejected, ${w.overturned} overturned` }, ...(w.openComplaints.length ? [{ label: 'Open complaints', value: String(w.openComplaints.length) }] : [])] };
    }
    case 'missed': {
      const m = source.missed;
      return { badge: 'Missed checks', address: 'Guest relations team', title: `${text(m.fullName) || 'Team member'} · ${formatDay(m.day, ctx.now)}`, amountMinor: null, since: m.createdAt, by: null, automatic: true,
        action: APPROVAL_SEEN, actionLabel: 'Mark as seen', next: 'Mark as seen',
        details: [...(!m.signedOff ? [{ label: 'Sign-off', value: 'Not done', tone: 'bad' as const }] : []), ...(m.missedListings.length ? [{ label: 'Listing checks missed', value: `${m.missedListings.length} of ${m.listingsDue}: ${m.missedListings.map(x => x.propertyName).join(', ')}` }] : [])] };
    }
  }
}

const OUTCOME: Record<string, { label: string; tone: TrackerTone }> = { resolved: { label: 'Resolved', tone: 'good' }, declined: { label: 'Declined', tone: 'bad' }, withdrawn: { label: 'Withdrawn', tone: 'plain' } };

function itemFor(entry: ApprovalEntry<unknown>, ctx: ApprovalContext): TrackerItem<ApprovalSource> {
  const flagged = entry.kind === 'flag';
  const source: ApprovalSource = flagged ? { kind: 'flag', flag: entry.source as ApprovalFlag } : entry.source as ApprovalSource;
  const flag = source.kind === 'flag' ? source.flag : null;
  const spec = source.kind === 'flag' ? flagSpec(source.flag, ctx) : source.kind === 'hub' ? hubSpec(source.item) : managementSpec(source, ctx);
  const closed = !entry.open;
  const outcome = flag ? OUTCOME[flag.status] : undefined;
  const deciders = ctx.canDecide;
  const waitingOn = !deciders && (source.kind === 'flag' || source.kind === 'hub');
  const age = spec.undated ? '' : waitedLabel(entry.since, ctx.now.getTime());
  const wait = age ? ` · waiting ${age}` : '';
  const raisedBy = spec.by ? ` by ${spec.by}` : spec.automatic ? ' automatically' : '';

  const steps: TrackerStep[] = [
    { key: 'raised', label: 'Raised', state: 'done', detail: `Raised ${formatDay(entry.since, ctx.now)}${raisedBy}` },
    closed
      ? { key: 'decided', label: 'Decided', state: 'done', detail: [outcome?.label ?? 'Decided', flag?.decidedAt ? formatDay(flag.decidedAt, ctx.now) : '', flag?.decidedByName ? `by ${flag.decidedByName}` : ''].filter(Boolean).join(' ') }
      : { key: 'decided', label: 'Decided', state: 'current', detail: waitingOn ? `Waiting for management${age ? ', ' + age : ''}` : age ? `Waiting ${age}` : 'Waiting for a decision', ...(deciders ? { actionKey: spec.action } : {}) },
  ];
  const amount = spec.amountMinor != null ? formatMoney(spec.amountMinor) : '';
  const title = amount ? `${spec.title} · ${amount}` : spec.title;
  const status: { label: string; tone: TrackerTone } = closed ? outcome ?? { label: 'Closed', tone: 'plain' } : { label: spec.badge, tone: spec.tone ?? 'wait' };

  const details: Detail[] = [{ label: 'Type', value: spec.badge }, ...(spec.by ? [{ label: 'Raised by', value: spec.by }] : spec.automatic ? [{ label: 'Raised by', value: 'Raised automatically' }] : []), ...spec.details];
  if (amount && !details.some(d => d.label === 'Amount')) details.push({ label: 'Amount', value: amount });
  if (closed || age) details.push({ label: closed ? 'Raised' : 'Waiting', value: closed ? formatDay(entry.since, ctx.now) : age });
  if (flag && closed && text(flag.outcomeNote)) details.push({ label: 'Outcome', value: text(flag.outcomeNote) });

  const stampAt = closed ? flag?.decidedAt ?? flag?.updatedAt ?? entry.since : entry.since;
  const stampBy = closed ? text(flag?.decidedByName) || null : spec.by;
  return {
    id: entry.key, section: APPROVALS_SECTION, source, propertyId: spec.propertyId ?? null, address: spec.address ?? 'No property', propertyName: spec.propertyName || spec.address || '', title, status, closed,
    nextStep: closed ? `${outcome?.label ?? 'Closed'}${flag?.decidedByName ? ' by ' + flag.decidedByName : ''}` : waitingOn ? `Management to decide${wait}` : `${spec.next}${wait}`,
    nextAction: closed ? null : waitingOn ? { label: 'Waiting for management' } : { label: spec.actionLabel, actionKey: spec.action },
    lastUpdate: { at: stampAt, by: stampBy, what: null }, progress: progressOf(steps), steps, details,
    ...(spec.workId ? { workId: spec.workId } : {}), ...(spec.version != null ? { version: spec.version } : {}),
    search: [spec.address, spec.propertyName, title, spec.badge, spec.by ?? '', status.label, flag ? text(flag.reason) : '', ...(spec.extraSearch ?? [])].filter(Boolean).join(' '),
  };
}

// Every entry for this person, before it becomes a row. Management sees all of it; anyone else only
// the flags and tickets they raised; owners nothing.
export function approvalEntries(input: ApprovalInputs, ctx: ApprovalContext): ApprovalEntry<unknown>[] {
  if (ctx.owner) return [];
  const mine = (flag: ApprovalFlag) => flag.mine ?? (!!ctx.userId && flag.raisedBy === ctx.userId);
  const flags = (input.flags ?? []).filter(f => ctx.canDecide || mine(f));
  const others: ApprovalEntry<ApprovalSource>[] = [];
  const add = (key: string, kind: 'approval' | 'management', since: string, title: string, amountMinor: number | null, source: ApprovalSource) => {
    others.push({ key, kind, open: true, since: since || ctx.now.toISOString(), title, amountMinor, source });
  };
  for (const item of input.hub ?? []) {
    if (item.kind !== 'approval' || item.status !== 'pending') continue;
    if (!ctx.canDecide && item.createdBy !== ctx.userId) continue;
    add('hub:' + item.id, 'approval', item.createdAt, item.title, item.amountMinor, { kind: 'hub', item });
  }
  const q = ctx.canDecide ? input.queue : null;
  if (q) {
    const now = ctx.now.toISOString();
    for (const d of q.cleaningDecisions) add('decision:' + d.workId, 'management', d.createdAt, d.title, null, { kind: 'decision', decision: d });
    for (const e of q.expensesOverLimit) add('expense:' + e.id, 'management', e.receivedOn, e.supplier, e.amountMinor, { kind: 'expense', expense: e });
    for (const r of q.repairApprovals) add('repair:' + r.workId, 'management', r.waitingSince, r.title, r.estimatedCostMinor, { kind: 'repair', repair: r });
    for (const s of q.stalledOwnerApprovals) add('stalled:' + s.workId, 'management', s.waitingSince, s.title, s.estimatedCostMinor, { kind: 'stalled', stalled: s });
    for (const s of q.unusualPayouts) add('payout:' + s.id, 'management', s.issuedAt ?? now, s.propertyName, s.payoutMinor, { kind: 'payout', payout: s });
    for (const s of q.ownerBalancesDue) add('balance:' + s.id, 'management', s.issuedAt ?? now, s.propertyName, -s.payoutMinor, { kind: 'balance', statement: s });
    for (const w of q.cleanerWarnings.filter(x => x.warning)) add('warning:' + w.cleanerId, 'management', now, w.fullName, null, { kind: 'warning', warning: w });
    for (const m of q.missedYesterday) add('missed:' + m.userId + ':' + m.day, 'management', m.createdAt, m.fullName, null, { kind: 'missed', missed: m });
  }
  return mergeApprovals<ApprovalEntry<ApprovalSource>>(flags, others) as ApprovalEntry<unknown>[];
}

// The merged list as rows: open ones first with the longest-waiting at the top, decided flags after.
export function approvalItems(input: ApprovalInputs, ctx: ApprovalContext): TrackerItem<ApprovalSource>[] {
  return approvalEntries(input, ctx).map(entry => itemFor(entry, ctx));
}

export const openApprovalCount = (items: readonly Pick<TrackerItem, 'closed'>[]) => items.filter(i => !i.closed).length;

// ----- What the sheets send -----

type DecideFlagAction = Extract<TeamsAction, { action: 'decideFlag' }>;
type WithdrawFlagAction = Extract<TeamsAction, { action: 'withdrawFlag' }>;

// Resolve (a note is optional) or decline (a reason of at least FLAG_MIN_CHARS characters is needed).
export function decideFlagAction(flag: Pick<ApprovalFlag, 'id' | 'version'>, decision: 'resolved' | 'declined', note: string, requestId: string): { action: DecideFlagAction } | { error: string } {
  const why = note.trim();
  if (decision === 'declined' && why.length < FLAG_MIN_CHARS) return { error: 'Say why you are declining (at least 5 characters). The person who raised it will see it.' };
  if (why.length > 2000) return { error: 'Keep it under 2,000 characters.' };
  return { action: { action: 'decideFlag', requestId, flagId: flag.id, version: flag.version, decision, note: why } };
}

export function withdrawFlagAction(flag: Pick<ApprovalFlag, 'id' | 'version'>, requestId: string): WithdrawFlagAction {
  return { action: 'withdrawFlag', requestId, flagId: flag.id, version: flag.version };
}

// Only the person who raised an open flag can withdraw it.
export const canWithdraw = (flag: Pick<ApprovalFlag, 'status' | 'raisedBy' | 'mine'>, userId: string | null | undefined) =>
  flag.status === 'open' && (flag.mine ?? (!!userId && flag.raisedBy === userId));

// "Ask management": a free-standing request with a title, a reason of at least FLAG_MIN_CHARS characters and an optional amount in pounds.
export function requestAction(title: string, reason: string, amount: string, requestId: string) {
  const name = title.trim();
  if (name.length < 2) return { error: 'Give the request a short title.' } as const;
  return flagAction({ title: name }, reason, amount, requestId);
}
