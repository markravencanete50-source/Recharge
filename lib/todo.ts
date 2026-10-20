import { z } from 'zod';
import type { HomeToolTarget } from './home-tools';
import { DEPARTMENT_LABEL, onboardingRows } from './hub';
import { LISTING_HEALTH_VIEW } from './feedback-defaults';
import { addressOf, EMPTY_CELL, timeAgo } from './tracker';
import type { ThinColumnSize } from './thin-table';
import { DEPARTMENTS, TODO_PRIORITIES, TODO_PRIORITY_LABEL, hubItemSchema, hubSchema } from './workspace-teams-policy';
export type TodoPriority = (typeof TODO_PRIORITIES)[number];
import type { JourneyView, OperationView } from './workflow-forms';
import type { PropertyView } from './workspace-view';

// The To-do list: one page that replaces "Daily checks". Every row sits under one of four headings.
// Rows come from two places: the hub's to-dos (the ones a person adds, plus the daily and department
// ones the database makes from the admins' templates) and a few DERIVED tasks worked out here from the
// work the app already holds (repairs needing an update, listing checks due, pricing gaps, guests
// waiting, onboarding and licensing next steps). Derived tasks are marked Automatic, cannot be ticked
// and disappear on their own when the thing they point at is done.

export const TODO_HEADINGS = ['guest_relations', 'client_relations', 'team', 'personal'] as const;
export type TodoHeading = (typeof TODO_HEADINGS)[number];
export const TODO_HEADING_LABEL: Record<TodoHeading, string> = {
  guest_relations: 'Guest relations', client_relations: 'Client relations', team: 'Your team', personal: 'Personal',
};
// The department a listing health check belongs to, and the department pricing gaps belong to.
export const LISTING_CHECKS_DEPARTMENT = 'client_relations' as const;
export const PRICING_DEPARTMENT = 'client_relations' as const;
// A repair with no update for this many days is put on the list.
export const REPAIR_UPDATE_AFTER_DAYS = 3;
// Each heading shows this many open rows before "Show all N" (round 6: ten thin rows, so the 180 automatic
// pricing rows do not bury the rest).
export const ROWS_PER_HEADING = 10;
// The summary card lists this many next items.
export const SUMMARY_ROWS = 3;

// Where an Automatic task opens when its work cannot be found in the list (the work itself opens by id).
export const TODO_TARGETS = {
  listingChecks: { kind: 'work', view: LISTING_HEALTH_VIEW, sub: 'listings' },
  pricing: { kind: 'work', view: LISTING_HEALTH_VIEW, sub: 'pricing' },
  guestInbox: { kind: 'work', view: 'stays', sub: 'inbox' },
  onboarding: { kind: 'work', view: LISTING_HEALTH_VIEW, sub: 'onboarding' },
  licensing: { kind: 'work', view: LISTING_HEALTH_VIEW, sub: 'licensing' },
  repairs: { kind: 'work', view: 'repairs' },
  approvals: { kind: 'work', view: 'hub', sub: 'approvals' },
} as const satisfies Record<string, HomeToolTarget>;

// One update on a to-do (round 6): what was said, who said it and when. "Marked done" and "Reopened" are
// logged by the database when the to-do is ticked or unticked.
// Like ClickUp (migration 20261025100000): a comment can be a reply (parentId, the comment it answers), names the people it
// @mentions, and carries reactions.
export const todoUpdateSchema = z.object({
  id: z.number(), text: z.string(), kind: z.enum(['note', 'done', 'reopened']).catch('note'),
  byId: z.string().uuid().nullable(), byName: z.string().nullable(), at: z.string(),
  parentId: z.number().nullable().default(null),
  mentions: z.array(z.object({ userId: z.string().uuid(), name: z.string().nullable().transform(v => v ?? ''), you: z.boolean() })).default([]),
  reactions: z.array(z.object({ emoji: z.string(), count: z.number(), mine: z.boolean(), names: z.array(z.string().nullable().transform(v => v ?? '')) })).default([]),
});
export type TodoUpdate = z.infer<typeof todoUpdateSchema>;
// What changed on a to-do and who changed it ("set the due date to 24 Oct 2026"), written by the database.
export const todoActivitySchema = z.object({ id: z.number(), text: z.string(), byId: z.string().uuid().nullable(), byName: z.string().nullable(), at: z.string() });
export type TodoActivity = z.infer<typeof todoActivitySchema>;

// The hub read, keeping the template link the database adds to a to-do made from a daily task, and the
// to-do's updates (newest first) with their running total. Older answers without them still parse.
export const todoHubItemSchema = hubItemSchema.extend({
  templateId: z.string().uuid().nullable().optional(),
  updateCount: z.number().int().min(0).default(0), updates: z.array(todoUpdateSchema).default([]),
  activity: z.array(todoActivitySchema).default([]), unread: z.number().int().min(0).default(0),
});
export const todoHubSchema = hubSchema.extend({ items: z.array(todoHubItemSchema) });
export type TodoHubItem = z.infer<typeof todoHubItemSchema>;
export type TodoHub = z.infer<typeof todoHubSchema>;

// 'approval' rows come from Management approvals, on the super admins' list only (lib/owner-todo.ts).
export type DerivedKind = 'repair_update' | 'listing_check' | 'pricing_gap' | 'guest_reply' | 'onboarding' | 'licensing' | 'approval';
export type TodoOpen = { workId?: string; target?: HomeToolTarget };
export type TodoLatest = { text: string; by: string | null; at: string };
export type TodoRow = {
  id: string; source: 'hub' | 'derived'; heading: TodoHeading; title: string; details: string;
  propertyId: string | null; address: string | null; dueOn: string | null; who: string | null;
  done: boolean; automatic: boolean;
  // When it was added (for "oldest first") and when it last changed (for the done list). ISO text, '' when unknown.
  since: string; touched: string;
  // The newest update and how many there are (hub to-dos only; Automatic tasks have none).
  latest: TodoLatest | null; updateCount: number;
  // Like ClickUp: the priority, the start date and other people's comments you have not read yet (hub to-dos only).
  priority?: TodoPriority | null; startOn?: string | null; unread?: number;
  derived?: DerivedKind; open?: TodoOpen; item?: TodoHubItem;
  // Which Client relations filter an Automatic task sits under (see clientAreaOf).
  area?: ClientArea;
};

// --- Headings ------------------------------------------------------------------------------------

type Placement = { department: string | null; assigneeId: string | null; createdBy?: string | null };
// Guest relations (or Stays) department: Guest relations. Client relations: Client relations. No
// department and the person's own: Personal. Any other department, or something for someone else: Your team.
export function headingOf(item: Placement, me: string): TodoHeading {
  const department = item.department;
  if (department === 'guest_relations' || department === 'stays') return 'guest_relations';
  if (department === 'client_relations') return 'client_relations';
  if (department) return 'team';
  if (item.assigneeId === me) return 'personal';
  if (!item.assigneeId && item.createdBy === me) return 'personal';
  return 'team';
}

type PropertyLike = Pick<PropertyView, 'id' | 'name' | 'address'>;
const propertyOf = (properties: readonly PropertyLike[], id: string | null | undefined) => (id ? properties.find(p => p.id === id) : undefined);

// Who a to-do is for, in the words a person uses.
export function whoFor(item: Pick<TodoHubItem, 'assigneeId' | 'assigneeName' | 'department'>, me: string): string | null {
  if (item.assigneeId === me) return 'Me';
  if (item.assigneeName) return item.assigneeName;
  return item.department ? DEPARTMENT_LABEL[item.department] ?? null : null;
}

const latestOf = (updates: readonly TodoUpdate[] | undefined): TodoLatest | null => {
  const u = updates?.[0];
  return u ? { text: u.text, by: u.byName, at: u.at } : null;
};

// The hub's to-dos as rows. A to-do the database made from a daily task has a template and reads Automatic.
export function hubRows(items: readonly TodoHubItem[], me: string, properties: readonly PropertyLike[]): TodoRow[] {
  return items.filter(i => i.kind === 'todo').map(i => {
    const property = propertyOf(properties, i.propertyId);
    return {
      id: i.id, source: 'hub' as const, heading: headingOf(i, me), title: i.title, details: i.details, propertyId: i.propertyId,
      address: (property ? addressOf(property) : '') || i.propertyName || null, dueOn: i.dueOn, who: whoFor(i, me),
      done: i.status === 'done', automatic: !!i.templateId, since: i.createdAt, touched: i.updatedAt || i.createdAt, item: i,
      latest: latestOf(i.updates), updateCount: i.updateCount, priority: i.priority ?? null, startOn: i.startOn ?? null, unread: i.unread,
    };
  });
}

// --- Derived tasks -------------------------------------------------------------------------------

const ADMIN_ROLES = ['admin', 'super_admin'];
const finished = (status: string) => status === 'completed' || status === 'cancelled';
const text = (v: unknown) => typeof v === 'string' ? v : '';
const daysBetween = (later: string, earlier: string) => Math.round((Date.parse(later.slice(0, 10) + 'T00:00:00Z') - Date.parse(earlier.slice(0, 10) + 'T00:00:00Z')) / 86_400_000);

// Which Automatic tasks a role is given: Stays and admins get all of them, Ready only the repairs it
// has been sent, everyone else none.
export function derivedKindsFor(role: string): DerivedKind[] {
  if (role === 'stays' || ADMIN_ROLES.includes(role)) return ['repair_update', 'listing_check', 'pricing_gap', 'guest_reply', 'onboarding', 'licensing'];
  if (role === 'ready') return ['repair_update'];
  return [];
}

const REPAIR_WATCHED = ['triage', 'referred', 'booked', 'owner_declined', 'management_declined'];

// Every Automatic task's title reads "<Area>: <what to do>", with the property or the person in it (Alex,
// client meeting: "Pricing: price 3 empty nights at Rose Cottage", "Onboarding: send the agreement to Sarah Jones").
const REPAIR_ACTION: Record<string, string> = {
  triage: 'check and refer the repair', referred: 'book the repair', booked: 'confirm the repair is done',
  owner_declined: 're-quote or close the repair', management_declined: 're-quote or close the repair',
};
const REPAIR_DECLINED: Record<string, string> = { owner_declined: 'The owner declined the cost.', management_declined: 'Management declined the cost.' };
const LICENCE_NEXT: Record<string, string> = { '': 'submit the licence application', to_apply: 'submit the licence application', applied: 'record the safety checks', checks_done: 'record the licence grant' };
// Onboarding stages before the owner says yes are still enquiries.
const ENQUIRY_STAGES = ['enquiry', 'estimate', 'reviewing'];
const at = (place: string | null) => (place ? ' at ' + place : '');
const forPlace = (place: string | null) => (place ? ' for ' + place : '');
// What to do next on an onboarding, with who it is for (the owner's name, else "the owner of" the property).
export function onboardingTitle(stage: string, who: string | null, place: string | null, j: Pick<JourneyView, 'agreementRevision' | 'invoiceId'>): string {
  const to = who ? ' to ' + who : '', them = who ?? 'the owner';
  switch (stage) {
    case 'enquiry': return 'Enquiry: send the estimate' + to;
    case 'estimate': case 'reviewing': return `Enquiry: get a decision on the estimate from ${them}`;
    case 'agreement': return j.agreementRevision > 0 ? `Onboarding: get the agreement signed by ${them}` : 'Onboarding: send the agreement' + to;
    case 'form': return `Onboarding: get the set-up form completed by ${them}`;
    case 'invoice': return j.invoiceId ? `Onboarding: get the onboarding invoice paid by ${them}` : 'Onboarding: send the onboarding invoice' + to;
    case 'inspection_to_book': return 'Onboarding: book the inspection' + at(place);
    case 'inspection_booked': return 'Onboarding: carry out the inspection' + at(place);
    case 'inspection_complete': return 'Onboarding: record the live listing' + forPlace(place);
    default: return 'Onboarding: check the next step' + forPlace(place ?? who);
  }
}

export type DeriveInput = {
  role: string; today: string; properties: readonly (PropertyLike & { status?: string })[];
  work: readonly OperationView[]; journeys: readonly JourneyView[];
  // Guest conversations waiting for a reply: how many, and since when the longest wait began.
  guestsWaiting?: { count: number; since: string | null } | null;
};

export function deriveTasks(input: DeriveInput): TodoRow[] {
  const { role, today, work, journeys } = input;
  const properties = input.properties;
  const kinds = new Set(derivedKindsFor(role));
  const out: TodoRow[] = [];
  const addressFor = (id: string | null) => { const p = propertyOf(properties, id); return p ? addressOf(p) : null; };
  // The property's name for a title ("Rose Cottage"), else its address, else nothing.
  const placeFor = (id: string | null) => { const p = propertyOf(properties, id); return p ? (p.name || addressOf(p) || null) : null; };
  const make = (kind: DerivedKind, key: string, heading: TodoHeading, row: Pick<TodoRow, 'title' | 'details' | 'propertyId' | 'dueOn' | 'since'> & { open: TodoOpen; address?: string | null; area?: ClientArea }) => {
    out.push({
      id: `auto:${kind}:${key}`, source: 'derived', heading, title: row.title, details: row.details, propertyId: row.propertyId,
      address: row.address === undefined ? addressFor(row.propertyId) : row.address, dueOn: row.dueOn, who: null,
      done: false, automatic: true, since: row.since, touched: row.since, derived: kind, open: row.open, latest: null, updateCount: 0,
      ...(row.area ? { area: row.area } : {}),
    });
  };
  const guestSide: TodoHeading = 'guest_relations';
  const clientSide: TodoHeading = 'client_relations';
  const listingSide = headingOf({ department: LISTING_CHECKS_DEPARTMENT, assigneeId: null }, '');
  const pricingSide = headingOf({ department: PRICING_DEPARTMENT, assigneeId: null }, '');

  if (kinds.has('repair_update')) {
    for (const w of work) {
      if (w.kind !== 'maintenance' || finished(w.status)) continue;
      const phase = text(w.data.phase) || 'triage';
      if (!REPAIR_WATCHED.includes(phase)) continue;
      // Ready only hears about repairs it has been sent.
      if (role === 'ready' && (phase === 'triage' || phase === 'owner_declined' || phase === 'management_declined')) continue;
      const last = w.lastActivityAt || w.updatedAt || w.createdAt || '';
      const days = last ? Math.max(0, daysBetween(today, last)) : 0;
      const declined = phase === 'owner_declined' || phase === 'management_declined';
      if (!declined && days < REPAIR_UPDATE_AFTER_DAYS) continue;
      // The issue as reported says which repair it is ("Boiler not firing"); the work title when there is none.
      const issue = oneLine(text(w.data.issue)) || oneLine(w.title);
      make('repair_update', w.workId, guestSide, {
        title: `Repair: ${REPAIR_ACTION[phase]}${at(placeFor(w.propertyId))}${issue ? ` (${issue})` : ''}`,
        details: declined ? REPAIR_DECLINED[phase] : days === 1 ? 'No update for 1 day.' : `No update for ${days} days.`,
        propertyId: w.propertyId, dueOn: null, since: last, open: { workId: w.workId, target: TODO_TARGETS.repairs },
      });
    }
  }

  if (kinds.has('listing_check')) {
    const checked = new Set(work.filter(w => w.kind === 'listing_health' && w.data.checkedOn === today).map(w => w.propertyId));
    for (const p of properties) {
      if (p.status !== undefined && p.status !== 'active') continue;
      if (checked.has(p.id)) continue;
      make('listing_check', p.id, listingSide, {
        title: 'Listing: check the listing' + forPlace(placeFor(p.id)), details: 'Is it live, any new review, anything suspended.', propertyId: p.id, dueOn: today, since: '',
        open: { target: TODO_TARGETS.listingChecks }, area: 'pricing',
      });
    }
  }

  if (kinds.has('pricing_gap')) {
    for (const w of work) {
      if (w.kind !== 'pricing_gap' || finished(w.status)) continue;
      const nights = Array.isArray(w.data.nights) ? w.data.nights.filter((n): n is string => typeof n === 'string').sort() : [];
      if (!nights.length) continue;
      make('pricing_gap', w.workId, pricingSide, {
        title: `Pricing: price ${nights.length === 1 ? '1 empty night' : `${nights.length} empty nights`}${at(placeFor(w.propertyId))}`, details: 'Hold or change the price for each night, with a reason.',
        propertyId: w.propertyId, dueOn: nights[0] ?? null, since: w.createdAt ?? '', open: { workId: w.workId, target: TODO_TARGETS.pricing }, area: 'pricing',
      });
    }
  }

  if (kinds.has('guest_reply') && input.guestsWaiting && input.guestsWaiting.count > 0) {
    const n = input.guestsWaiting.count;
    make('guest_reply', 'inbox', guestSide, {
      title: n === 1 ? 'Guest messages: reply to 1 waiting guest' : `Guest messages: reply to ${n} waiting guests`, details: 'Open the guest messages and answer them.',
      propertyId: null, address: null, dueOn: null, since: input.guestsWaiting.since ?? '', open: { target: TODO_TARGETS.guestInbox },
    });
  }

  if (kinds.has('onboarding')) {
    for (const r of onboardingRows(journeys)) {
      if (r.stage === 'live' || r.stage === 'archived') continue;
      const contact = r.contact && !addressFor(r.propertyId) ? r.contact : null;
      const name = oneLine(r.journey.enquiry?.contactName) || null, place = placeFor(r.propertyId);
      make('onboarding', r.propertyId, clientSide, {
        title: onboardingTitle(r.stage, name ?? (place ? 'the owner of ' + place : null), place ?? name, r.journey), details: [r.contact, r.phone, r.email].filter(Boolean).join(', ') || 'Onboarding next step.',
        propertyId: r.propertyId, address: addressFor(r.propertyId) ?? contact, dueOn: r.inspectionOn,
        since: '', open: { workId: r.journey.workId, target: TODO_TARGETS.onboarding }, area: ENQUIRY_STAGES.includes(r.stage) ? 'enquiries' : 'onboarding',
      });
    }
  }

  if (kinds.has('licensing')) {
    for (const w of work) {
      if (w.kind !== 'licensing' || finished(w.status)) continue;
      const phase = text(w.data.phase);
      if (phase === 'granted') continue;
      make('licensing', w.workId, clientSide, {
        title: 'Licensing: ' + (LICENCE_NEXT[phase] ?? 'check the next step') + forPlace(placeFor(w.propertyId)), details: text(w.data.authority) ? 'Licensing, ' + text(w.data.authority) + '.' : 'Licensing next step.',
        propertyId: w.propertyId, dueOn: null, since: w.createdAt ?? '', open: { workId: w.workId, target: TODO_TARGETS.licensing }, area: 'onboarding',
      });
    }
  }
  return out;
}

// --- Client relations filters ------------------------------------------------------------------------

// The chips under Client relations (Alex, client meeting): All, Pricing, Enquiries and Onboarding. Pricing gaps and
// listing checks are Pricing (both sit on the Listings and pricing screen); onboarding before the owner says yes is
// Enquiries, after it Onboarding, with licensing. A to-do a person added goes under an area when its title starts
// with that area ("Pricing: ...", "Enquiry: ...", "Onboarding: ..."); any other shows only under All.
export const CLIENT_FILTERS = ['all', 'pricing', 'enquiries', 'onboarding'] as const;
export type ClientFilter = (typeof CLIENT_FILTERS)[number];
export type ClientArea = Exclude<ClientFilter, 'all'>;
export const CLIENT_FILTER_LABEL: Record<ClientFilter, string> = { all: 'All', pricing: 'Pricing', enquiries: 'Enquiries', onboarding: 'Onboarding' };
const AREA_PREFIX: [RegExp, ClientArea][] = [[/^\s*pricing\s*:/i, 'pricing'], [/^\s*enquir(y|ies)\s*:/i, 'enquiries'], [/^\s*onboarding\s*:/i, 'onboarding']];
export function clientAreaOf(row: Pick<TodoRow, 'area' | 'source' | 'title'>): ClientArea | null {
  if (row.area) return row.area;
  if (row.source !== 'hub') return null;
  return AREA_PREFIX.find(([pattern]) => pattern.test(row.title))?.[1] ?? null;
}
export const matchesClientFilter = (row: Pick<TodoRow, 'area' | 'source' | 'title'>, filter: ClientFilter) => filter === 'all' || clientAreaOf(row) === filter;
// How many open rows each chip holds.
export function clientFilterCounts(rows: readonly TodoRow[]): Record<ClientFilter, number> {
  const counts: Record<ClientFilter, number> = { all: 0, pricing: 0, enquiries: 0, onboarding: 0 };
  for (const r of rows) {
    if (r.done) continue;
    counts.all++;
    const area = clientAreaOf(r);
    if (area) counts[area]++;
  }
  return counts;
}

// --- Ordering, groups and counts ---------------------------------------------------------------------

// Open first. Among open rows: due today first, then overdue, then due later, then no date; within
// each, the earlier due date, then the oldest. Done rows follow, the latest finished first.
const dueRank = (r: TodoRow, today: string) => !r.dueOn ? 3 : r.dueOn === today ? 0 : r.dueOn < today ? 1 : 2;
// The person can re-order the list: by due date (the default), priority (Urgent first, none last), newest first, oldest first or A to Z.
export const TODO_SORTS = ['due', 'priority', 'newest', 'oldest', 'title'] as const;
export type TodoSort = (typeof TODO_SORTS)[number];
export const TODO_SORT_LABEL: Record<TodoSort, string> = { due: 'Due date', priority: 'Priority', newest: 'Newest', oldest: 'Oldest', title: 'A to Z' };
const priorityRank = (r: TodoRow) => (r.priority ? TODO_PRIORITIES.indexOf(r.priority) : TODO_PRIORITIES.length);
export function sortTodoRows(rows: readonly TodoRow[], today: string, sort: TodoSort = 'due'): TodoRow[] {
  const age = (r: TodoRow) => r.since || '9999';
  const open = (a: TodoRow, b: TodoRow) => sort === 'newest' ? (b.since || '').localeCompare(a.since || '')
    : sort === 'oldest' ? age(a).localeCompare(age(b))
    : sort === 'title' ? 0
    : sort === 'priority' ? priorityRank(a) - priorityRank(b) || dueRank(a, today) - dueRank(b, today) || (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999')
    : dueRank(a, today) - dueRank(b, today) || (a.dueOn ?? '9999').localeCompare(b.dueOn ?? '9999') || age(a).localeCompare(age(b));
  return [...rows].sort((a, b) =>
    Number(a.done) - Number(b.done)
    || (a.done ? b.touched.localeCompare(a.touched) : open(a, b))
    || a.title.localeCompare(b.title) || a.id.localeCompare(b.id));
}

export type TodoGroup = { heading: TodoHeading; label: string; rows: TodoRow[]; open: number; always: boolean };
// Guest and client relations are always shown to the people who work them; the others always.
const WORKS_BOTH_SIDES = (role: string) => role === 'stays' || ADMIN_ROLES.includes(role);
export function groupTodo(rows: readonly TodoRow[], role: string, today: string, sort: TodoSort = 'due'): TodoGroup[] {
  const sorted = sortTodoRows(rows, today, sort);
  return TODO_HEADINGS.map(heading => {
    const mine = sorted.filter(r => r.heading === heading);
    return { heading, label: TODO_HEADING_LABEL[heading], rows: mine, open: mine.filter(r => !r.done).length, always: heading === 'team' || heading === 'personal' || WORKS_BOTH_SIDES(role) };
  });
}

export type TodoCounts = { open: number; done: number; dueToday: number; overdue: number; automatic: number; byHeading: Record<TodoHeading, number> };
export function todoCounts(rows: readonly TodoRow[], today: string): TodoCounts {
  const byHeading = { guest_relations: 0, client_relations: 0, team: 0, personal: 0 } as Record<TodoHeading, number>;
  let open = 0, done = 0, dueToday = 0, overdue = 0, automatic = 0;
  for (const r of rows) {
    if (r.done) { done++; continue; }
    open++; byHeading[r.heading]++;
    if (r.automatic) automatic++;
    if (r.dueOn === today) dueToday++; else if (r.dueOn && r.dueOn < today) overdue++;
  }
  return { open, done, dueToday, overdue, automatic, byHeading };
}

// The next few open rows across all headings, in the same order as the page.
export function nextRows(rows: readonly TodoRow[], today: string, count = SUMMARY_ROWS): TodoRow[] {
  return sortTodoRows(rows.filter(r => !r.done), today).slice(0, count);
}

// "Due today", "Overdue", "Due Fri 16 Oct" is drawn by the screen; this only says which it is.
export function dueState(row: Pick<TodoRow, 'dueOn' | 'done'>, today: string): 'today' | 'overdue' | 'later' | 'none' {
  if (!row.dueOn) return 'none';
  if (row.dueOn === today) return 'today';
  return row.dueOn < today && !row.done ? 'overdue' : 'later';
}

// --- Thin rows (round 6, from Alex's video) --------------------------------------------------------------

// One compact row per to-do, like a spreadsheet. On a computer the columns below, left to right, in rows about
// 40 px high (clicking a row opens the detail); on a phone a two-line card with a 44 px tick. The automatic
// sections use the same rows.
export type TodoColumnKey = 'tick' | 'property' | 'task' | 'update' | 'by' | 'when' | 'due' | 'priority' | 'status';
// The tick, When, Due and Status keep their width; the text columns shrink (with "…") so the table always fits
// its card (lib/thin-table.ts). Every column stays, even when its cells read "–".
export const TODO_COLUMNS: readonly ({ key: TodoColumnKey; label: string } & ThinColumnSize)[] = [
  { key: 'tick', label: '', width: 44, fixed: true },
  { key: 'property', label: 'Property', width: 220, min: 110 },
  { key: 'task', label: 'Task', width: 300, grow: true, min: 160 },
  { key: 'update', label: 'Latest update', width: 220, min: 110 },
  { key: 'by', label: 'Updated by', width: 120, min: 80 },
  { key: 'when', label: 'When', width: 96, fixed: true },
  { key: 'due', label: 'Due', width: 96, fixed: true },
  { key: 'priority', label: 'Priority', width: 96, fixed: true },
  { key: 'status', label: 'Status', width: 116, fixed: true },
];
// The table from this window width up (the same width the trackers switch at); cards below it.
export const TODO_TABLE_FROM = 1024;
export const THIN_ROW_HEIGHT = 40;
export const todoLayout = (width: number): 'table' | 'cards' => (width >= TODO_TABLE_FROM ? 'table' : 'cards');

const oneLine = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim();
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// "16 Oct", with the year when it is not this year's: "3 Jan 2027".
export function shortDay(day: string, today: string): string {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return EMPTY_CELL;
  return `${d} ${MONTHS[m - 1]}` + (day.slice(0, 4) === today.slice(0, 4) ? '' : ` ${y}`);
}

export type TodoCells = {
  property: string; task: string; detail: string; update: string; by: string; when: string;
  due: string; dueTone: 'overdue' | 'today' | 'plain'; priority: string; status: 'Done' | 'Automatic' | 'To do' | 'Approval'; statusTone: 'good' | 'plain' | 'wait';
};
// What each column shows for a row. Empty cells read "–". The person is the one who wrote the latest update.
export function todoCells(row: TodoRow, today: string, now: Date = new Date()): TodoCells {
  const state = dueState(row, today), latest = row.latest;
  return {
    property: oneLine(row.address) || EMPTY_CELL,
    task: oneLine(row.title), detail: oneLine(row.details),
    update: latest ? oneLine(latest.text) || EMPTY_CELL : EMPTY_CELL,
    by: latest ? oneLine(latest.by) || 'Automatic' : EMPTY_CELL,
    when: latest ? timeAgo(latest.at, now) || EMPTY_CELL : EMPTY_CELL,
    due: !row.dueOn ? EMPTY_CELL : state === 'today' ? 'Today' : shortDay(row.dueOn, today),
    dueTone: row.done ? 'plain' : state === 'overdue' ? 'overdue' : state === 'today' ? 'today' : 'plain',
    priority: row.priority ? TODO_PRIORITY_LABEL[row.priority] : EMPTY_CELL,
    status: row.done ? 'Done' : row.derived === 'approval' ? 'Approval' : row.automatic ? 'Automatic' : 'To do',
    statusTone: row.done ? 'good' : row.automatic ? 'plain' : 'wait',
  };
}

// The phone card: the task on the first line with the due day; the property and the latest update (or the
// description when there is none) on the second.
export function todoCardLines(row: TodoRow, today: string, now: Date = new Date()): { top: string; due: string; bottom: string } {
  const c = todoCells(row, today, now);
  const said = row.latest ? [c.update, c.by, c.when].filter(v => v !== EMPTY_CELL).join(' · ') : c.detail;
  return { top: c.task, due: c.due === EMPTY_CELL ? '' : c.due, bottom: [row.address ? c.property : '', said].filter(Boolean).join(' · ') };
}

// "Last update 2h ago by Dan", for the detail. Owners never see staff to-dos, so names are always shown here.
export function lastUpdateWords(latest: TodoLatest | null, now: Date = new Date()): string {
  if (!latest) return 'No updates yet';
  const when = timeAgo(latest.at, now), who = oneLine(latest.by) || 'Automatic';
  return `Last update ${when || 'at an unknown time'} by ${who}`;
}
// A to-do's Activity, as in ClickUp: oldest first, so the newest is at the bottom by the comment box. Each comment carries its
// replies (oldest first); what changed ("set the due date to 24 Oct 2026") and the ticks ("marked it done") sit between them as
// one-line entries. A reply whose comment is too old to have come back is shown as a comment of its own.
export type TodoFeedEntry =
  | { kind: 'comment'; key: string; at: string; comment: TodoUpdate; replies: TodoUpdate[] }
  | { kind: 'change'; key: string; at: string; text: string; byName: string | null };
export function todoFeed(item: Pick<TodoHubItem, 'updates' | 'activity'>): TodoFeedEntry[] {
  const updates = item.updates ?? [], notes = updates.filter(u => u.kind === 'note');
  const roots = new Set(notes.filter(u => u.parentId == null).map(u => u.id));
  const replies = (id: number) => notes.filter(u => u.parentId === id).sort((a, b) => a.id - b.id);
  const entries: TodoFeedEntry[] = [
    ...notes.filter(u => u.parentId == null || !roots.has(u.parentId)).map(u => ({ kind: 'comment' as const, key: 'u' + u.id, at: u.at, comment: u, replies: roots.has(u.id) ? replies(u.id) : [] })),
    ...updates.filter(u => u.kind !== 'note').map(u => ({ kind: 'change' as const, key: 'u' + u.id, at: u.at, text: u.kind === 'done' ? 'marked it done' : 'reopened it', byName: u.byName })),
    ...(item.activity ?? []).map(e => ({ kind: 'change' as const, key: 'e' + e.id, at: e.at, text: e.text, byName: e.byName })),
  ];
  return entries.sort((a, b) => Date.parse(a.at) - Date.parse(b.at) || a.key.localeCompare(b.key));
}
// "Alex set the due date to 24 Oct 2026"; the app's own changes read "Recharge".
export const changeWords = (e: { text: string; byName: string | null }) => `${oneLine(e.byName) || 'Recharge'} ${e.text}`;

// "1 update", "4 updates".
export const updateTotal = (n: number) => (n === 1 ? '1 update' : `${n} updates`);
// "Show all 180" under a heading with more open rows than it shows; "Show fewer" once open.
export const showAllLabel = (open: number, expanded: boolean) => (expanded ? 'Show fewer' : `Show all ${open}`);

// --- Once a day -------------------------------------------------------------------------------------------

// Every team role asks the database to make the day's department to-dos, once per day on this device.
// The call is idempotent in the database, so a second device or a repeat changes nothing.
export const wantsDailyTodos = (role: string) => role !== 'client';
export const ensureKey = (userId: string, day: string) => `${userId}:${day}`;
export const needsEnsure = (role: string, userId: string, day: string, done: ReadonlySet<string>) => wantsDailyTodos(role) && !done.has(ensureKey(userId, day));

// --- Daily task templates (admins) ---------------------------------------------------------------------

export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const WEEKDAY_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
export const ALL_WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5, 6, 7];
export const WEEKDAYS_ONLY: readonly number[] = [1, 2, 3, 4, 5];

// Weekdays are numbered the way the database counts them: 1 is Monday and 7 is Sunday.
export function validWeekdays(days: readonly unknown[]): days is number[] {
  return days.length >= 1 && days.length <= 7 && days.every(d => Number.isInteger(d) && (d as number) >= 1 && (d as number) <= 7) && new Set(days).size === days.length;
}
export const normaliseWeekdays = (days: readonly number[]): number[] => [...new Set(days)].filter(d => Number.isInteger(d) && d >= 1 && d <= 7).sort((a, b) => a - b);
export const toggleWeekday = (days: readonly number[], day: number): number[] => normaliseWeekdays(days.includes(day) ? days.filter(d => d !== day) : [...days, day]);
export function weekdaysSummary(days: readonly number[]): string {
  const d = normaliseWeekdays(days);
  if (d.length === 7) return 'Every day';
  if (d.join() === WEEKDAYS_ONLY.join()) return 'Weekdays';
  if (d.join() === '6,7') return 'Weekends';
  return d.map(n => WEEKDAY_SHORT[n - 1]).join(', ') || 'No days';
}
// 1 (Monday) to 7 (Sunday) for a YYYY-MM-DD date.
export function isoWeekday(day: string): number {
  const n = new Date(day.slice(0, 10) + 'T12:00:00Z').getUTCDay();
  return n === 0 ? 7 : n;
}
export const templateRunsOn = (t: { weekdays: readonly number[]; active: boolean }, day: string) => t.active && t.weekdays.includes(isoWeekday(day));

export const dailyTaskSchema = z.object({
  id: z.string().uuid(), department: z.enum(DEPARTMENTS), title: z.string(), details: z.string(), weekdays: z.array(z.number().int().min(1).max(7)), active: z.boolean(),
  createdByName: z.string().nullable().optional(), createdAt: z.string().optional(), updatedAt: z.string().optional(), version: z.number().optional(), lastMadeOn: z.string().nullable().optional(),
});
export const dailyTasksSchema = z.object({ today: z.string().optional(), templates: z.array(dailyTaskSchema) });
export type DailyTask = z.infer<typeof dailyTaskSchema>;
