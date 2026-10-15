import { sectionAnchor, type HomeToolTarget } from './home-tools';
import { formatCount } from './format';
import type { Overview } from './oversight-policy';
import type { RoleHome } from './role-home';

// Home's "Needs you now" and the departments row (mobile/src/HomeFocus.tsx). The team's Home shows at
// most five lines; admins' "Needs your attention" shows six and "See all" for the rest (lib/home-overview.ts).
// Only things that need someone to act, most urgent first, and never a zero. Each line opens the place
// the work is done. The numbers come from the reads Home already makes.
export const NEEDS_SHOWN = 5;
export type NeedOpen = HomeToolTarget | { kind: 'page'; section: 'work' | 'properties' | 'calendar' | 'inbox' };
export type NeedLine = { key: string; count: number; label: string; urgent: boolean; open: NeedOpen };
export type DepartmentTile = { key: 'stays' | 'cleans' | 'ready' | 'accounts'; title: string; value: string; label: string; target: HomeToolTarget };

const work = (view: 'stays' | 'clients' | 'cleans' | 'repairs' | 'accounts' | 'management', extra: { sub?: string; section?: string } = {}): HomeToolTarget =>
  ({ kind: 'work', view, ...(extra.sub ? { sub: extra.sub } : {}), ...(extra.section ? { anchor: sectionAnchor(extra.section) } : {}) });
// Everything waiting on management: Management → Waiting on you.
export const MANAGEMENT_QUEUE = work('management', { sub: 'queue' });
const LISTINGS = work('clients', { sub: 'listings' });
const say = (n: number, one: string, many: string) => n === 1 ? one : many;
const line = (key: string, count: number, label: string, open: NeedOpen, urgent = false): NeedLine => ({ key, count, label, urgent, open });
const waiting = (lines: NeedLine[]) => lines.filter(l => Number.isFinite(l.count) && l.count > 0);
const top = (lines: NeedLine[]) => waiting(lines).slice(0, NEEDS_SHOWN);

// Admins: decisions waiting for management first, then guests and today's cleans, then the rest of the business.
// Every line that has something waiting, in that order (Home shows the first six and "See all" for the rest).
// `decisions` is the same total as Management → Waiting on you; `followUps` is client check-ins due (onboarding).
export function adminNeeds(o: Overview | null, decisions: number | null, followUps = 0): NeedLine[] {
  const d = decisions ?? 0;
  return waiting([
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
      // Overdue only (20261020900000): past the expected payout date and still missing or different.
      line('payouts', o.accounts.payoutsToReconcile, say(o.accounts.payoutsToReconcile, 'payout overdue to reconcile', 'payouts overdue to reconcile'), work('accounts', { sub: 'payouts' })),
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

// Every other role (lib/role-home.ts, approved by Lee): the same calm list over the person's own work, from the
// workspace_role_home read, most urgent first and never a zero. Home shows six and "See all" for the rest, as for
// admins. A count the read leaves out (the person lacks that tool) leaves its line out.
const of = (v: number | null | undefined) => v ?? 0;
const clean = (section: string) => work('cleans', { section });
const reactive = (sub?: string) => work('repairs', { section: 'Reactive maintenance', ...(sub ? { sub } : {}) });
const PREVENTATIVE = work('repairs', { section: 'Preventative maintenance' });

// Guest relations: guests first, then repairs to troubleshoot, client enquiries, cleans to review, client check-ins,
// and the daily listing and pricing checks.
export function staysNeeds(h: RoleHome, followUps = 0): NeedLine[] {
  const g = of(h.guestsWaiting), r = of(h.repairsToRefer), e = of(h.enquiriesToValue), c = of(h.cleansToReview), l = of(h.listingsToCheck), rl = of(h.relistingsOpen), en = of(h.emptyNights);
  return waiting([
    line('guests', g, say(g, 'guest waiting for a reply', 'guests waiting for a reply'), work('stays', { sub: 'inbox' }), true),
    line('triage', r, say(r, 'repair to troubleshoot and refer', 'repairs to troubleshoot and refer'), reactive(), true),
    line('enquiries', e, say(e, 'client enquiry to value', 'client enquiries to value'), { kind: 'tab', tab: 'enquiries' }),
    line('review', c, say(c, 'clean waiting for your review', 'cleans waiting for your review'), clean('Waiting for your review')),
    line('followUps', followUps, say(followUps, 'client check-in due', 'client check-ins due'), { kind: 'page', section: 'properties' }),
    line('listings', l, say(l, 'listing to check today', 'listings to check today'), LISTINGS),
    line('relistings', rl, say(rl, 're-listing open', 're-listings open'), { kind: 'work', view: 'clients', sub: 'relisting' }),
    line('emptyNights', en, say(en, 'empty night to price this week', 'empty nights to price this week'), work('clients', { sub: 'pricing' })),
  ]);
}

// Cleaning managers: today's cleans without a cleaner first, then reviews, disputes, tomorrow and restock.
export function cleaningManagerNeeds(h: RoleHome): NeedLine[] {
  const u = of(h.unassignedToday), r = of(h.toReview), d = of(h.disputes), t = of(h.unassignedTomorrow), s = of(h.restockOpen);
  return waiting([
    line('unassigned', u, say(u, 'clean not assigned today', 'cleans not assigned today'), clean('Not yet assigned'), true),
    line('review', r, say(r, 'clean waiting for your review', 'cleans waiting for your review'), clean('Waiting for your review')),
    line('disputes', d, say(d, 'rejected clean to decide', 'rejected cleans to decide'), clean('Disputes to decide')),
    line('tomorrow', t, say(t, 'clean not assigned tomorrow', 'cleans not assigned tomorrow'), clean('Not yet assigned')),
    line('restock', s, say(s, 'restock request open', 'restock requests open'), { kind: 'tracker', module: 'replenishment-requests' }),
  ]);
}

// Cleaners: their own cleans only. Missed and sent-back cleans first, then today's, then rejected cleans to answer.
export function cleanerNeeds(h: RoleHome): NeedLine[] {
  const o = of(h.overdue), r = of(h.redo), t = of(h.cleansToday), a = of(h.toRespond);
  return waiting([
    line('overdue', o, say(o, 'clean overdue', 'cleans overdue'), clean('Schedule'), true),
    line('redo', r, say(r, 'clean sent back to redo', 'cleans sent back to redo'), clean('Schedule'), true),
    line('today', t, say(t, 'clean to do today', 'cleans to do today'), clean('Schedule')),
    line('respond', a, say(a, 'rejected clean to give your side on', 'rejected cleans to give your side on'), clean('Needs your response')),
  ]);
}

// Ready: visits that have passed and approved jobs first, then new jobs and today's visits. Only the jobs they can
// open (referred to Ready, theirs once a job names its contractor), never a guest's name or an owner's limit.
export function readyNeeds(h: RoleHome): NeedLine[] {
  const done = of(h.toMarkDone), book = of(h.approvedToBook), late = of(h.visitsOverdue), fresh = of(h.newJobs), today = of(h.repairsToday), visits = of(h.visitsToday);
  return waiting([
    line('markDone', done, say(done, 'repair visit passed: mark it done', 'repair visits passed: mark them done'), reactive('booked'), true),
    line('book', book, say(book, 'repair approved: book the visit', 'repairs approved: book the visits'), reactive('referred'), true),
    line('visitsOverdue', late, say(late, 'routine visit overdue', 'routine visits overdue'), PREVENTATIVE, true),
    line('new', fresh, say(fresh, 'new repair for you: estimate or book it', 'new repairs for you: estimate or book them'), reactive('referred')),
    line('repairsToday', today, say(today, 'repair visit today', 'repair visits today'), reactive('booked')),
    line('visitsToday', visits, say(visits, 'routine visit today', 'routine visits today'), PREVENTATIVE),
  ]);
}

// Accounts: overdue payouts first, then what waits for their approval, then what to record and issue.
export function accountsNeeds(h: RoleHome): NeedLine[] {
  const p = of(h.payoutsOverdue), e = of(h.expensesToApprove), pa = of(h.purchasesToApprove), pi = of(h.purchaseInvoicesToRecord), ci = of(h.cleanerInvoicesToApprove), s = of(h.statementsToIssue);
  return waiting([
    line('payouts', p, say(p, 'payout overdue to reconcile', 'payouts overdue to reconcile'), work('accounts', { sub: 'payouts' }), true),
    line('expenses', e, say(e, 'expense to approve', 'expenses to approve'), work('accounts', { sub: 'expenses' })),
    line('purchases', pa, say(pa, 'purchase to approve', 'purchases to approve'), work('accounts', { section: 'Purchases' })),
    line('purchaseInvoices', pi, say(pi, 'purchase invoice to record', 'purchase invoices to record'), work('accounts', { section: 'Purchases' })),
    line('cleanerInvoices', ci, say(ci, 'cleaner invoice to approve', 'cleaner invoices to approve'), work('accounts', { section: 'Cleaner invoices' })),
    line('statements', s, say(s, 'statement to issue', 'statements to issue'), work('accounts', { sub: 'statements' })),
  ]);
}

// Owners: their decisions first (repair costs, then onboarding steps), new messages, a statement to read, and repairs
// under way at their properties. Worked out from the reads their Home already makes.
export type OwnerCounts = { repairApprovals: number; onboardingSteps: number; unread: number; statements: number; statementMonth: string | null; repairsInProgress: number };
export function ownerNeeds(c: OwnerCounts): NeedLine[] {
  const statement = c.statementMonth ? `${c.statements === 1 ? 'statement' : 'statements'} for ${c.statementMonth} ready to read` : say(c.statements, 'statement ready to read', 'statements ready to read');
  return waiting([
    line('repairApprovals', c.repairApprovals, say(c.repairApprovals, 'repair cost waiting for your approval', 'repair costs waiting for your approval'), { kind: 'tab', tab: 'approvals' }, true),
    line('onboarding', c.onboardingSteps, say(c.onboardingSteps, 'onboarding step waiting for you', 'onboarding steps waiting for you'), { kind: 'tab', tab: 'approvals' }, true),
    line('messages', c.unread, say(c.unread, 'new message', 'new messages'), { kind: 'page', section: 'inbox' }),
    line('statements', c.statements, statement, { kind: 'tab', tab: 'analytics' }),
    line('repairs', c.repairsInProgress, say(c.repairsInProgress, 'repair in progress at your properties', 'repairs in progress at your properties'), work('repairs')),
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
