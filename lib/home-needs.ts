import { sectionAnchor, type HomeToolTarget } from './home-tools';
import { formatCount } from './format';
import type { Overview } from './oversight-policy';

// Home's "Needs you now" and the departments row (mobile/src/HomeFocus.tsx). Home shows at most
// five lines, only things that need someone to act, most urgent first, and never a zero. Each line
// opens the place the work is done. The numbers come from the reads Home already makes.
export const NEEDS_SHOWN = 5;
export type NeedOpen = HomeToolTarget | { kind: 'page'; section: 'work' | 'properties' };
export type NeedLine = { key: string; count: number; label: string; urgent: boolean; open: NeedOpen };
export type DepartmentTile = { key: 'stays' | 'cleans' | 'ready' | 'accounts'; title: string; value: string; label: string; target: HomeToolTarget };

const work = (view: 'stays' | 'clients' | 'cleans' | 'repairs' | 'accounts' | 'management', extra: { sub?: string; section?: string } = {}): HomeToolTarget =>
  ({ kind: 'work', view, ...(extra.sub ? { sub: extra.sub } : {}), ...(extra.section ? { anchor: sectionAnchor(extra.section) } : {}) });
// Everything waiting on management: Management → Waiting on you.
export const MANAGEMENT_QUEUE = work('management', { sub: 'queue' });
const LISTINGS = work('clients', { sub: 'listings' });
const say = (n: number, one: string, many: string) => n === 1 ? one : many;
const line = (key: string, count: number, label: string, open: NeedOpen, urgent = false): NeedLine => ({ key, count, label, urgent, open });
const top = (lines: NeedLine[]) => lines.filter(l => Number.isFinite(l.count) && l.count > 0).slice(0, NEEDS_SHOWN);

// Admins: decisions waiting for management first, then guests and today's cleans, then the rest of the business.
// `decisions` is the same total as Management → Waiting on you; `followUps` is client check-ins due (onboarding).
export function adminNeeds(o: Overview | null, decisions: number | null, followUps = 0): NeedLine[] {
  const d = decisions ?? 0;
  return top([
    line('decisions', d, say(d, 'decision waiting for management', 'decisions waiting for management'), MANAGEMENT_QUEUE, true),
    ...(o ? [
      line('guests', o.stays.guestsWaiting ?? 0, say(o.stays.guestsWaiting ?? 0, 'guest waiting for a reply', 'guests waiting for a reply'), work('stays', { sub: 'inbox' }), true),
      line('unassigned', o.cleans.unassignedToday, say(o.cleans.unassignedToday, 'clean not assigned today', 'cleans not assigned today'), work('cleans', { section: 'Not yet assigned' }), true),
      line('review', o.cleans.toReview, say(o.cleans.toReview, 'clean waiting for review', 'cleans waiting for review'), work('cleans', { section: 'Waiting for your review' })),
      line('refer', o.ready.toRefer, say(o.ready.toRefer, 'repair to refer to Ready', 'repairs to refer to Ready'), work('repairs', { section: 'Reactive maintenance' })),
      line('expenses', o.accounts.expensesToApprove, say(o.accounts.expensesToApprove, 'expense to approve', 'expenses to approve'), work('accounts', { sub: 'expenses' })),
    ] : []),
    line('followUps', followUps, say(followUps, 'client check-in due', 'client check-ins due'), { kind: 'page', section: 'properties' }),
    ...(o ? [
      line('listings', o.stays.listingsToCheck, say(o.stays.listingsToCheck, 'listing to check today', 'listings to check today'), LISTINGS),
      line('payouts', o.accounts.payoutsToReconcile, say(o.accounts.payoutsToReconcile, 'payout to reconcile', 'payouts to reconcile'), work('accounts', { sub: 'payouts' })),
      line('statements', o.accounts.statementsToIssue, say(o.accounts.statementsToIssue, 'statement to issue', 'statements to issue'), work('accounts', { sub: 'statements' })),
      line('relistings', o.stays.relistingsOpen, say(o.stays.relistingsOpen, 're-listing open', 're-listings open'), { kind: 'work', view: 'clients', sub: 'relisting' }),
      line('emptyNights', o.stays.emptyNights, say(o.stays.emptyNights, 'empty night to price this week', 'empty nights to price this week'), LISTINGS),
    ] : []),
  ]);
}

// The rest of the team: their own open work, overdue first, then today's, then client check-ins and the rest.
export function teamNeeds(counts: { overdue: number; dueToday: number; otherOpen: number; followUps: number }): NeedLine[] {
  const { overdue, dueToday, otherOpen, followUps } = counts;
  const all: NeedOpen = { kind: 'page', section: 'work' };
  return top([
    line('overdue', overdue, say(overdue, 'task overdue', 'tasks overdue'), all, true),
    line('today', dueToday, say(dueToday, 'task due today', 'tasks due today'), all),
    line('followUps', followUps, say(followUps, 'client check-in due', 'client check-ins due'), { kind: 'page', section: 'properties' }),
    line('open', otherOpen, say(otherOpen, 'other open task', 'other open tasks'), all),
  ]);
}

// One number per department: tap to open it. Never a list of zeros.
export function departmentTiles(o: Overview): DepartmentTile[] {
  const guests = o.stays.guestsWaiting;
  const repairs = o.ready.ownerApproval + o.ready.toRefer + o.ready.referred + o.ready.booked;
  return [
    guests != null
      ? { key: 'stays', title: 'Stays', value: formatCount(guests), label: say(guests, 'guest waiting', 'guests waiting'), target: work('stays') }
      : { key: 'stays', title: 'Stays', value: formatCount(o.stays.listingsToCheck), label: say(o.stays.listingsToCheck, 'listing to check', 'listings to check'), target: work('stays') },
    { key: 'cleans', title: 'Cleans', value: `${formatCount(o.cleans.doneToday)}/${formatCount(o.cleans.today)}`, label: 'done today', target: work('cleans') },
    { key: 'ready', title: 'Ready', value: formatCount(repairs), label: say(repairs, 'repair open', 'repairs open'), target: work('repairs') },
    { key: 'accounts', title: 'Accounts', value: formatCount(o.accounts.expensesToApprove), label: say(o.accounts.expensesToApprove, 'expense to approve', 'expenses to approve'), target: work('accounts') },
  ];
}

// The words for one line, for screen readers and tests: "10 guests waiting for a reply".
export const needText = (l: NeedLine) => `${formatCount(l.count)} ${l.label}`;
