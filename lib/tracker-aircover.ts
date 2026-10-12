import { z } from 'zod';
import { formatDay, formatMoney } from './format';
import { repairTypeLabel } from './repair-guides';
import { addressOf, progressOf, sortTracker, type TrackerItem, type TrackerStep, type TrackerTone } from './tracker';
import type { TrackerContext } from './tracker-sections';
import type { Detail } from './work-details';

// AirCover claims as tracker steps (client ask B4). A claim is a hub item of kind `aircover`; since
// migration 20261012190000_aircover_links it can be linked to the maintenance or routine-visit ticket it
// came from (`flagAirCover`), and the `aircover` read answers every claim with that issue beside it.
// The stage runs to_claim -> claimed -> paid, or ends declined (HUB_FLOW.aircover in lib/hub.ts), and
// moves with moveHubItem. Accounts and admins keep the claims; a claim waits on Accounts.
const id = z.string().uuid();
export const CLAIM_STATUSES = ['to_claim', 'claimed', 'paid', 'declined'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

// The linked issue as the read returns it. Everything but the work id is optional so older answers parse.
export const claimIssueSchema = z.object({
  workId: id, title: z.string().nullish(), kind: z.string().nullish(), status: z.string().nullish(), phase: z.string().nullish(),
  repairType: z.string().nullish(), urgent: z.boolean().nullish(), dueOn: z.string().nullish(), version: z.number().nullish(), updatedAt: z.string().nullish(),
});
export const claimSchema = z.object({
  itemId: id, version: z.number(), title: z.string(), details: z.string().nullish(), reference: z.string().nullish(),
  status: z.enum(CLAIM_STATUSES), amountMinor: z.number().nullish(), settledMinor: z.number().nullish(), outcomeNote: z.string().nullish(),
  decidedAt: z.string().nullish(), createdAt: z.string(), updatedAt: z.string().nullish(), mine: z.boolean().nullish(), flaggedBy: z.string().nullish(),
  propertyId: id.nullish(), propertyName: z.string().nullish(), address: z.string().nullish(), reservationId: id.nullish(), workId: id.nullish(),
  issue: claimIssueSchema.nullish(),
});
export type Claim = z.infer<typeof claimSchema>;
export type ClaimIssue = z.infer<typeof claimIssueSchema>;
export type AircoverRead = { canManage: boolean; claims: Claim[] };

// The answer is { canManage, claims: [...] } or a bare list; a claim that does not parse is left out.
export function parseAircover(raw: unknown): AircoverRead {
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as { canManage?: unknown; claims?: unknown } : null;
  const list = Array.isArray(raw) ? raw : obj && Array.isArray(obj.claims) ? obj.claims : [];
  return { canManage: obj?.canManage === true, claims: list.flatMap(row => { const r = claimSchema.safeParse(row); return r.success ? [r.data] : []; }) };
}

const STEPS = [{ key: 'to_claim', label: 'To claim' }, { key: 'claimed', label: 'Claimed' }, { key: 'settled', label: 'Paid or declined' }] as const;
// The last step behind the claim: none while it waits to be claimed (that is the step it is on), the first once it is claimed, all three once settled.
const REACHED: Record<ClaimStatus, number> = { to_claim: -1, claimed: 0, paid: 2, declined: 2 };
const STATUS: Record<ClaimStatus, { label: string; tone: TrackerTone }> = {
  to_claim: { label: 'To claim', tone: 'wait' }, claimed: { label: 'Claimed', tone: 'wait' }, paid: { label: 'Paid', tone: 'good' }, declined: { label: 'Declined', tone: 'bad' },
};
const NEXT: Record<ClaimStatus, string> = { to_claim: 'Put the claim in to AirCover', claimed: "Wait for AirCover's decision", paid: 'Nothing more to do', declined: 'Nothing more to do' };
const UPDATE_WHAT: Record<ClaimStatus, string> = { to_claim: 'Flagged as a claim', claimed: 'Marked as claimed', paid: 'Marked as paid', declined: 'Marked as declined' };
const REPAIR_PHASE: Record<string, string> = {
  triage: 'Being checked', owner_approval: 'Waiting for the owner to approve the cost', management_approval: 'Waiting for management to approve the cost',
  referred: 'With Ready to book', booked: 'Repair booked', completed: 'Repair complete', resolved: 'Resolved by troubleshooting',
  owner_declined: 'Cost declined by the owner', management_declined: 'Cost declined by management',
};
const WORK_STATUS: Record<string, string> = { waiting: 'Waiting', in_progress: 'In progress', in_review: 'In review', approved: 'Approved', completed: 'Completed', cancelled: 'Cancelled', declined: 'Declined' };
const words = (v: string) => (v.charAt(0).toUpperCase() + v.slice(1)).replaceAll('_', ' ');
const day = (iso: string | null | undefined, now: Date) => iso ? formatDay(iso.slice(0, 10), now) : '';

// The claim's story in a few plain sentences: when it was flagged, what happened since, and where the
// issue it came from stands. Staff names are left out for an owner viewer.
export function claimJourney(claim: Claim, ctx: Pick<TrackerContext, 'now' | 'owner'>): string {
  const { now, owner } = ctx;
  const parts = [`Flagged on ${day(claim.createdAt, now)}${claim.flaggedBy && !owner ? ' by ' + claim.flaggedBy : ''}.`];
  const when = day(claim.decidedAt, now);
  if (claim.status === 'to_claim') parts.push('Not put in to AirCover yet.');
  if (claim.status === 'claimed') parts.push(`Put in to AirCover${when ? ' (last moved ' + when + ')' : ''}.`);
  if (claim.status === 'paid') parts.push(`Paid${claim.settledMinor != null ? ' ' + formatMoney(claim.settledMinor) : ''}${when ? ' on ' + when : ''}.`);
  if (claim.status === 'declined') parts.push(`Declined${when ? ' on ' + when : ''}${claim.outcomeNote ? ': ' + claim.outcomeNote.trim() : ''}.`);
  const issue = claim.issue;
  if (issue?.title) {
    const where = issue.phase ? REPAIR_PHASE[issue.phase] ?? words(issue.phase) : issue.status ? WORK_STATUS[issue.status] ?? words(issue.status) : '';
    parts.push(`The issue, ${issue.title.trim()}, is now: ${where.toLowerCase() || 'open'}.`);
  } else parts.push('This claim is not linked to a maintenance issue.');
  return parts.join(' ');
}

export function aircoverTrackerItem(claim: Claim, ctx: TrackerContext, canManage = false): TrackerItem<Claim> {
  const property = claim.propertyId ? ctx.property(claim.propertyId) : null;
  const address = claim.address?.trim() || addressOf(property) || claim.propertyName?.trim() || 'Unknown property', propertyName = claim.propertyName?.trim() || property?.name?.trim() || address;
  const status = STATUS[claim.status], closed = claim.status === 'paid' || claim.status === 'declined', reached = REACHED[claim.status];
  const detailOf = (i: number) => {
    if (i === 0) return `Flagged ${day(claim.createdAt, ctx.now)}`;
    if (i === 1) return claim.amountMinor != null ? 'Claim for ' + formatMoney(claim.amountMinor) : undefined;
    return claim.status === 'paid' ? (claim.settledMinor != null ? 'Paid ' + formatMoney(claim.settledMinor) : 'Paid') : claim.status === 'declined' ? 'Declined' : undefined;
  };
  const steps: TrackerStep[] = STEPS.map((s, i) => {
    const state: TrackerStep['state'] = i <= reached ? 'done' : !closed && i === reached + 1 ? 'current' : 'todo';
    const label = i === 2 ? (claim.status === 'paid' ? 'Paid' : claim.status === 'declined' ? 'Declined' : s.label) : s.label;
    const detail = state === 'done' ? detailOf(i) : undefined;
    return { key: s.key, label, state, ...(detail ? { detail } : {}) };
  });
  const details: Detail[] = [];
  const add = (label: string, value: string, tone?: Detail['tone']) => { if (value) details.push({ label, value, ...(tone ? { tone } : {}) }); };
  add('Claim', claim.title);
  add('Amount claimed', claim.amountMinor != null ? formatMoney(claim.amountMinor) : '');
  add('Amount paid out', claim.settledMinor != null ? formatMoney(claim.settledMinor) : '', claim.status === 'paid' ? 'good' : undefined);
  add('Reservation code', claim.reference?.trim() ?? '');
  const issue = claim.issue;
  if (issue) {
    add('Issue', issue.title?.trim() ?? '');
    add('Repair type', issue.repairType ? repairTypeLabel(issue.repairType) : '');
    add('Priority', issue.urgent ? 'Urgent' : '', 'bad');
    add('Issue status', issue.status ? WORK_STATUS[issue.status] ?? words(issue.status) : '');
    add('Issue stage', issue.phase ? REPAIR_PHASE[issue.phase] ?? words(issue.phase) : '');
  }
  add('Notes', claim.details?.trim() ?? '');
  if (claim.outcomeNote?.trim() && claim.status !== 'declined') add('Note', claim.outcomeNote.trim());
  add('Journey', claimJourney(claim, ctx));
  const at = claim.updatedAt || claim.decidedAt || claim.createdAt;
  const waiting = canManage ? null : 'Accounts';
  return {
    id: claim.itemId, section: 'aircover', source: ctx.owner ? { ...claim, flaggedBy: null } : claim, propertyId: claim.propertyId ?? null, address, propertyName,
    title: claim.title, status, closed,
    nextStep: NEXT[claim.status],
    nextAction: closed ? null : waiting ? { label: `Waiting for ${waiting}` } : { label: claim.status === 'to_claim' ? 'Mark as claimed' : 'Record the outcome' },
    // The hub keeps no record of who moved a claim, so after the flag the stamp reads "The team"; owners see "Recharge".
    lastUpdate: { at, by: ctx.owner ? null : claim.status === 'to_claim' ? claim.flaggedBy ?? 'The team' : 'The team', what: UPDATE_WHAT[claim.status] },
    progress: progressOf(steps), steps, details, search: [address, propertyName, claim.title, status.label, closed ? '' : NEXT[claim.status], claim.reference, issue?.title, issue?.repairType].filter(Boolean).join(' '),
  };
}

// Every claim as a tracker item, open claims first.
export function aircoverTrackerItems(read: AircoverRead, ctx: TrackerContext): TrackerItem<Claim>[] {
  return sortTracker(read.claims.map(c => aircoverTrackerItem(c, ctx, read.canManage)));
}
