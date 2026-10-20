import { workViewsFor, type WorkView } from './tool-directory';
import type { ModuleId } from './modules';

// The tools each role sees first on Home: one tap opens the exact place the work happens
// (a Work view, a tab inside it, or a section further down), so nobody has to hunt for them.
export type ToolArt =
  | 'house' | 'building' | 'hardhat' | 'spray' | 'people' | 'coins' | 'clipboard' | 'hourglass' | 'medal' | 'key'
  | 'chart' | 'toolbox' | 'calendar' | 'chat' | 'compass' | 'sun'
  | 'tag' | 'relist' | 'signature' | 'shield' | 'box' | 'bell' | 'receipt' | 'wallet' | 'pie' | 'cart' | 'sofa' | 'search' | 'mail' | 'star';
export type HomeToolTarget =
  | { kind: 'work'; view: WorkView; sub?: string; anchor?: string; open?: HomeForm; workId?: string }
  // 'activity' stays a valid deep-link target so old links work; it opens Messages → Updates now.
  | { kind: 'tab'; tab: 'properties' | 'analytics' | 'activity' | 'help' | 'approvals' | 'enquiries' | 'mailbox'; anchor?: string }
  | { kind: 'tracker'; module: ModuleId }
  | { kind: 'calculator' };
// Forms a Home shortcut can open straight away, inside their Work view.
export type HomeForm = 'record-stay' | 'report-repair' | 'new-clean' | 'new-expense' | 'new-routine';
export type HomeTool = { key: string; label: string; detail: string; art: ToolArt; target: HomeToolTarget };
type Candidate = HomeTool & { needs?: ModuleId[] };

// Sections are found by their heading: "Daily checks" is section-daily-checks.
export const sectionAnchor = (title: string) => 'section-' + title.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const work = (view: WorkView, extra: { sub?: string; section?: string; anchor?: string } = {}): HomeToolTarget =>
  ({ kind: 'work', view, ...(extra.sub ? { sub: extra.sub } : {}), ...(extra.section ? { anchor: sectionAnchor(extra.section) } : extra.anchor ? { anchor: extra.anchor } : {}) });
const tab = (name: 'properties' | 'analytics' | 'help' | 'approvals'): HomeToolTarget => ({ kind: 'tab', tab: name });
const tool = (key: string, label: string, detail: string, art: ToolArt, target: HomeToolTarget, needs?: ModuleId[]): Candidate => ({ key, label, detail, art, target, ...(needs ? { needs } : {}) });

const PROPERTIES = tool('properties', 'Properties', 'Every property and its details', 'house', tab('properties'));
const HELP = tool('help', 'Help & training', 'Guides for your role', 'compass', tab('help'));
const RESTOCK = tool('restock', 'Restock requests', 'Ask for supplies', 'box', { kind: 'tracker', module: 'replenishment-requests' }, ['replenishment-requests']);
// Training for every team role; admins land where courses and their files are added.
const TRAINING = tool('training', 'Training', 'Courses for your role', 'star', { kind: 'tab', tab: 'help', anchor: sectionAnchor('Training') });
const TRAINING_ADMIN = tool('training', 'Training', 'Courses and course files', 'star', work('management', { sub: 'training' }));
// The Calendar page opened on one team's work (the sub names the team: lib/workspace-map.ts deepLinkFor and
// mobile/src/LiveCalendar.tsx). Each role gets the calendars of the teams it can filter by (calendarTeamsFor).
const calendar = (team: 'stays' | 'ready' | 'cleans'): HomeToolTarget => ({ kind: 'work', view: 'calendar', sub: team });
const CALENDAR_READY = tool('calendar-ready', 'Maintenance calendar', 'Repairs, visits and inspections by day', 'calendar', calendar('ready'));
const CALENDAR_STAYS = tool('calendar-stays', 'Booking calendar', 'Stays, arrivals and departures by day', 'calendar', calendar('stays'));
const CALENDAR_CLEANS = tool('calendar-cleans', 'Housekeeping calendar', 'Cleans and changeovers by day', 'calendar', calendar('cleans'));

const BY_ROLE: Record<string, Candidate[]> = {
  admin: [
    tool('queue', 'Waiting on you', 'Decisions and approvals', 'hourglass', work('management', { sub: 'queue' })),
    tool('people', 'People', 'Accounts, roles and tools', 'people', work('management', { sub: 'people' })),
    tool('performance', 'Performance', 'KPIs, shifts, replies and sign-offs', 'medal', work('management', { sub: 'performance' })),
    tool('stays', 'Guest relations', 'Bookings, AirCover and repairs', 'building', work('stays')),
    tool('clients', 'Client relations', 'Onboarding, licensing, listings', 'key', work('clients')),
    tool('cleans', 'Cleans', 'Schedule, reviews and cleaners', 'spray', work('cleans')),
    tool('repairs', 'Maintenance', 'Reactive and preventative', 'toolbox', work('repairs')),
    tool('accounts', 'Accounts', 'Expenses, payouts, statements', 'coins', work('accounts')),
    // Properties is always in the navigation, so its tile makes room for training.
    TRAINING_ADMIN,
    // Who can sign in and what they can use. Admins manage accounts below admin; super admins every account.
    tool('access', 'Access control', 'People, tools and security', 'shield', work('management', { sub: 'access', anchor: 'access-control' })),
  ],
  stays: [
    // Guests reply in Messages; the daily checks are listing health and pricing in Client relations,
    // and the end of the day is the reflection at clock-out.
    tool('checks', 'Listing health', 'Listings live and reviewed', 'clipboard', work('clients', { sub: 'listings' }), ['listing-health']),
    tool('pricing', 'Pricing', 'Empty nights this week', 'tag', work('clients', { sub: 'pricing' }), ['daily-pricing']),
    tool('repairs', 'Reactive maintenance', 'Report and chase repairs', 'toolbox', work('repairs'), ['stays-maintenance-reporting', 'maintenance-reporting']),
    tool('cleans', 'Cleans', 'Cleans at your properties', 'spray', work('cleans'), ['cleaning-schedule', 'clean-reporting']),
    tool('bookings', 'Direct bookings', 'Follow up long stays', 'calendar', work('stays', { sub: 'bookings' }), ['direct-bookings']),
    tool('licensing', 'Licensing', 'Licences and renewals', 'signature', work('clients', { sub: 'licensing' }), ['licensing']),
    tool('aircover', 'AirCover claims', 'Add and close claims', 'shield', work('stays', { sub: 'aircover' }), ['aircover-reporting']),
    // Properties is always in the navigation, so its tile makes room for training.
    TRAINING,
  ],
  cleans: [
    tool('today', 'My cleans', 'Schedule and checklists', 'spray', work('cleans', { section: 'Schedule' })),
    tool('respond', 'Needs a reply', 'Complaints to answer', 'chat', work('cleans', { section: 'Needs your response' })),
    tool('month', 'My month', 'Cleans done and pay', 'medal', work('cleans', { section: 'Your month' })),
    RESTOCK,
    TRAINING,
    HELP,
  ],
  cleaning_manager: [
    tool('schedule', 'Schedule', 'Every clean by day', 'calendar', work('cleans', { section: 'Schedule' })),
    tool('review', 'To review', 'Submitted cleans', 'star', work('cleans', { section: 'Waiting for your review' })),
    tool('disputes', 'Disputes', 'Rejected cleans to decide', 'hourglass', work('cleans', { section: 'Disputes to decide' })),
    tool('unassigned', 'Not assigned', 'Cleans without a cleaner', 'people', work('cleans', { section: 'Not yet assigned' })),
    tool('cleaners', 'Cleaners', 'Performance this month', 'medal', work('cleans', { section: 'Cleaner performance this month' })),
    tool('setups', 'Cleaning set-ups', 'New properties to prepare', 'clipboard', work('all'), ['clean-property-onboarding']),
    tool('invoices', 'Clean invoices', 'Cleans to invoice', 'receipt', work('all'), ['cleans-invoices']),
    RESTOCK,
    { ...PROPERTIES, needs: ['clean-client-database', 'property-database'] },
    TRAINING,
  ],
  ready: [
    tool('pipeline', 'Reactive maintenance', 'Reported, booked and done', 'toolbox', work('repairs', { section: 'Reactive maintenance' })),
    tool('visits', 'Preventative visits', 'Garden, bins and safety', 'sun', work('repairs', { section: 'Preventative maintenance' })),
    tool('inspections', 'Inspections', 'New properties to inspect', 'search', work('all'), ['new-property-inspection-board']),
    tool('purchases', 'Purchases', 'Orders and deliveries', 'cart', work('repairs', { section: 'Purchase orders' }), ['purchase-order']),
    tool('furnishing', 'Furnishing quotes', 'Rooms to furnish', 'sofa', work('all'), ['property-furnishing-board']),
    { ...PROPERTIES, detail: 'Access instructions and details', needs: ['property-database', 'clean-client-database', 'maintenance-reporting', 'new-property-inspection-board', 'ready-schedule'] },
    TRAINING,
    HELP,
  ],
  accounts: [
    tool('expenses', 'Expenses', 'Evidence to approve', 'receipt', work('accounts', { sub: 'expenses' })),
    tool('payouts', 'Reconciliation', 'Match platform payouts to stays', 'wallet', work('accounts', { sub: 'payouts' })),
    tool('statements', 'Owner statements', 'Draft, issue and settle', 'pie', work('accounts', { sub: 'statements' })),
    tool('purchases', 'Purchases', 'Approve and order', 'cart', work('accounts', { section: 'Purchases' })),
    tool('cleaner-invoices', 'Cleaner invoices', 'Accepted cleans by cleaner', 'spray', work('accounts', { section: 'Cleaner invoices' })),
    tool('budget', 'Budget chart', 'Most each item should cost', 'coins', work('accounts', { section: 'Budget chart' })),
    // Issued invoices sit at the foot of Work → Accounts (Accounts have no Reports tab).
    tool('invoices', 'Invoices', 'Payments and settled', 'chart', work('accounts', { section: 'Invoices' })),
    RESTOCK,
    TRAINING,
  ],
  client: [
    // Stays, earnings and statements live in Reports; decisions waiting for the owner in Approvals.
    tool('stays', 'Portfolio', 'Stays, earnings and statements', 'calendar', tab('analytics')),
    tool('approvals', 'Approvals', 'Costs and steps to decide', 'hourglass', tab('approvals')),
    tool('repairs', 'Reactive maintenance', 'Request and approve', 'toolbox', work('repairs')),
    // Mailbox is a page of its own: what Recharge sent (the agreement) for every owner, and the post with the mailbox service.
    tool('mailbox', 'Mailbox', 'Agreements and post', 'mail', { kind: 'tab', tab: 'mailbox' }),
    tool('furnishing', 'Furnishing calculator', 'What each room needs', 'sofa', { kind: 'calculator' }, ['client-furnishing']),
    { ...PROPERTIES, label: 'My properties', detail: 'Onboarding and details' },
    HELP,
  ],
};
BY_ROLE.super_admin = BY_ROLE.admin;

// Tools that live in the desktop left panel and in search, not on Home's tiles (Home keeps to three
// rows). On a phone they open from their own tab inside the Work area.
const PANEL_ONLY: Record<string, Candidate[]> = {
  admin: [
    tool('productivity', 'Productivity', 'Clock in and out, hours by week and month', 'hourglass', work('management', { sub: 'productivity' })),
    // A shortcut: the page opens Client relations on its Enquiries chip (lib/workspace-map.ts CLIENT_ENQUIRIES_LINK).
    tool('enquiries', 'Leads', 'Send the property form, value replies', 'mail', { kind: 'tab', tab: 'enquiries' }),
    // Repair spending limits per owner and property (Limit Changer, Repairs with contractors).
    tool('limits', 'Limit Changer', 'Repair spending limits by owner', 'coins', work('management', { sub: 'limits' })),
    // Furnishing Studio: catalogue, client quotes and shopping lists (Client relations; Stays team and management only).
    tool('studio', 'Furnishing Studio', 'Catalogue, client quotes, shopping lists', 'sofa', work('clients', { sub: 'furnishing' })),
    // Alex's menu (20 October 2026): admins open everything the team's menus hold, each in its own place.
    tool('rota', 'Rota', 'Who works the early and late shift', 'calendar', work('management', { sub: 'rota' })),
    tool('dailytasks', 'Daily tasks', 'Tasks added to each department\'s to-do list', 'clipboard', work('management', { sub: 'dailytasks' })),
    tool('aircover', 'AirCover claims', 'Add and close claims', 'shield', work('stays', { sub: 'aircover' })),
    tool('licensing', 'Licensing', 'Licences and renewals', 'signature', work('clients', { sub: 'licensing' })),
    tool('inspections', 'Inspections', 'New properties to inspect', 'search', work('all')),
    tool('onboarding', 'Property onboarding', 'Where each new property stands', 'key', work('clients', { sub: 'onboarding' })),
    tool('bookings', 'Direct bookings', 'Follow up long stays', 'calendar', work('stays', { sub: 'bookings' })),
    tool('pricing', 'Pricing', 'Empty nights this week', 'tag', work('clients', { sub: 'pricing' })),
    // The Guests and stays report in Reports (mobile/src/LiveWorkspace.tsx adminReports).
    tool('booking-performance', 'Guests and stays', 'Who stays, for how long, how far ahead they book', 'chart', { kind: 'tab', tab: 'analytics', anchor: 'section-guests-and-stays' }),
    tool('reviews', 'Guest reviews', 'Reviews to log and answer', 'star', work('clients', { sub: 'reviews' })),
    tool('checks', 'Listing health', 'Listings live and reviewed', 'clipboard', work('clients', { sub: 'listings' })),
    tool('purchases', 'Purchase orders', 'Orders and deliveries', 'cart', work('clients', { sub: 'purchases' })),
    tool('order-fulfilment', 'Purchases to order', 'Approve and order', 'cart', work('accounts', { section: 'Purchases' })),
    tool('review', 'To review', 'Submitted cleans', 'star', work('cleans', { section: 'Waiting for your review' })),
    tool('cleaner-invoices', 'Cleaner invoices', 'Accepted cleans by cleaner', 'spray', work('accounts', { section: 'Cleaner invoices' })),
    tool('receivable', 'Receivable invoices', 'Invoices to send and settle', 'receipt', work('accounts', { sub: 'receivable' })),
    tool('expenses', 'Expenses', 'Evidence to approve', 'receipt', work('accounts', { sub: 'expenses' })),
    tool('profit-loss', 'Profit and loss', 'Fees, cleaning margin and occupancy', 'pie', work('accounts', { sub: 'performance' })),
    CALENDAR_READY, CALENDAR_STAYS, CALENDAR_CLEANS,
  ],
  stays: [
    tool('enquiries', 'Leads', 'Send the property form, value replies', 'mail', { kind: 'tab', tab: 'enquiries' }, ['property-onboarding']),
    tool('studio', 'Furnishing Studio', 'Catalogue, client quotes, shopping lists', 'sofa', work('clients', { sub: 'furnishing' })),
    // Client relations' own sections (lib/relations-subs.ts holds the same tools for each).
    tool('onboarding', 'Property onboarding', 'Where each new property stands', 'key', work('clients', { sub: 'onboarding' })),
    tool('reviews', 'Guest reviews', 'Reviews to log and answer', 'star', work('clients', { sub: 'reviews' }), ['listing-health']),
    tool('purchases', 'Purchase orders', 'Orders and deliveries', 'cart', work('clients', { sub: 'purchases' }), ['purchase-order', 'purchase-order-requests', 'purchase-order-accounts']),
    CALENDAR_READY, CALENDAR_STAYS, CALENDAR_CLEANS,
  ],
  cleans: [CALENDAR_CLEANS],
  cleaning_manager: [CALENDAR_CLEANS, CALENDAR_STAYS],
  ready: [CALENDAR_READY, CALENDAR_STAYS],
  accounts: [
    tool('receivable', 'Receivable invoices', 'Invoices to send and settle', 'receipt', work('accounts', { sub: 'receivable' })),
    tool('profit-loss', 'Profit and loss', 'Fees, cleaning margin and occupancy', 'pie', work('accounts', { sub: 'performance' })),
    tool('aircover', 'AirCover claims', 'Add and close claims', 'shield', work('accounts', { sub: 'aircover' }), ['aircover-reporting']),
    CALENDAR_READY, CALENDAR_STAYS, CALENDAR_CLEANS,
  ],
  // The Statements part of the owner's Portfolio page (mobile/src/LiveClientReports.tsx).
  client: [tool('statements', 'Statements', 'Your issued and paid statements', 'pie', { kind: 'tab', tab: 'analytics', anchor: sectionAnchor('Statements') })],
};
PANEL_ONLY.super_admin = PANEL_ONLY.admin;

const allowed = (role: string, modules: readonly string[], list: Candidate[]): HomeTool[] => {
  const views = workViewsFor(role);
  return list.filter(t =>
    (!t.needs || t.needs.some(m => modules.includes(m))) &&
    (t.target.kind !== 'work' || views.includes(t.target.view)),
  ).map(({ needs, ...t }) => { void needs; return t; });
};
export const panelToolsFor = (role: string, modules: readonly string[]): HomeTool[] => allowed(role, modules, PANEL_ONLY[role] ?? []);

export function homeToolsFor(role: string, modules: readonly string[]): HomeTool[] {
  return allowed(role, modules, BY_ROLE[role] ?? []);
}

// Forms each role starts most (Record a stay, Report a repair…). Home no longer shows them as pills for
// the team (their Home is their own area), but the left panel's "Start something", search and each Work
// view's own button still use them.
export type HomeAction = { key: HomeForm; label: string; icon: 'plus' | 'alert-triangle' | 'repeat'; target: HomeToolTarget };
const ACTIONS: Record<HomeForm, Omit<HomeAction, 'key'>> = {
  'record-stay': { label: 'Record a stay', icon: 'plus', target: { kind: 'work', view: 'stays', open: 'record-stay' } },
  'report-repair': { label: 'Report a repair', icon: 'alert-triangle', target: { kind: 'work', view: 'repairs', open: 'report-repair' } },
  'new-clean': { label: 'New clean', icon: 'plus', target: { kind: 'work', view: 'cleans', open: 'new-clean' } },
  'new-expense': { label: 'New expense', icon: 'plus', target: { kind: 'work', view: 'accounts', sub: 'expenses', open: 'new-expense' } },
  'new-routine': { label: 'New routine visit', icon: 'repeat', target: { kind: 'work', view: 'repairs', open: 'new-routine' } },
};
// The tools each form needs are the ones the database checks: recording a stay needs Direct
// bookings, a repair report Stays repairs (owners: their repairs tool), a clean the Cleaning
// schedule, an expense Maintenance reconciliation. Admins hold every tool.
const ACTIONS_BY_ROLE: Record<string, [HomeForm, ModuleId[]?][]> = {
  admin: [['record-stay'], ['report-repair'], ['new-clean'], ['new-expense']],
  stays: [['record-stay', ['direct-bookings']], ['report-repair', ['stays-maintenance-reporting']], ['new-clean', ['cleaning-schedule']], ['new-routine', ['routine-bin-garden-board', 'safety-maintenance', 'ready-schedule']]],
  ready: [['new-routine', ['routine-bin-garden-board', 'safety-maintenance', 'ready-schedule']]],
  cleaning_manager: [['new-clean', ['cleaning-schedule']]],
  accounts: [['new-expense', ['maintenance-reconciliation']]],
  client: [['report-repair', ['client-property-maintenance']]],
};
ACTIONS_BY_ROLE.super_admin = ACTIONS_BY_ROLE.admin;
export function startActionsFor(role: string, modules: readonly string[]): HomeAction[] {
  const views = workViewsFor(role);
  return (ACTIONS_BY_ROLE[role] ?? []).filter(([key, needs]) => (!needs || needs.some(m => modules.includes(m))) && views.includes((ACTIONS[key].target as { view: WorkView }).view))
    .map(([key]) => ({ key, ...ACTIONS[key] }));
}
// Home's quick-action pills: owners only (to report a repair). Team roles have none.
export const homeActionsFor = (role: string, modules: readonly string[]): HomeAction[] => role === 'client' ? startActionsFor(role, modules) : [];

// Whether someone can start one of these forms. The Work views' own buttons (Record a stay,
// Report a repair, New clean, New expense) follow the same grants as Home, so nobody fills in a
// form the database will refuse.
export const canStart = (account: { role: string; modules: readonly string[] }, form: HomeForm) =>
  startActionsFor(account.role, account.modules).some(a => a.key === form);

// The illustrated icon for each tool in the full tools list.
export const MODULE_ART: Record<ModuleId, ToolArt> = {
  'daily-pricing': 'tag', 'listing-health': 'clipboard', 'direct-bookings': 'calendar', 'guest-communication': 'chat',
  'weekly-performance': 'chart', 'property-database': 'house', 'ota-logins': 'key', 'clean-client-database': 'people',
  'property-onboarding': 'key', 'new-property-inspection-board': 'search', 'cleaning-schedule': 'calendar', 'cleaner-performance': 'medal',
  'clean-reporting': 'star', 'cleaner-database': 'people', 'clean-property-onboarding': 'spray', 'cleans-invoices': 'receipt',
  'maintenance-reporting': 'toolbox', 'stays-maintenance-reporting': 'toolbox', 'client-property-maintenance': 'toolbox', 'safety-maintenance': 'shield',
  'routine-bin-garden-board': 'sun', 'ready-schedule': 'calendar', 'licensing': 'signature', 'purchase-order': 'cart',
  'purchase-order-requests': 'cart', 'client-purchase-order-quotes': 'receipt', 'property-furnishing-board': 'sofa', 'client-furnishing': 'sofa',
  'owner-statements': 'pie', 'maintenance-reconciliation': 'receipt', 'onboarding-invoices': 'receipt', 'purchase-order-invoices': 'receipt',
  'purchase-order-accounts': 'wallet', 'client-dashboard': 'building', 'client-mailbox': 'mail', 'aircover-reporting': 'shield',
  'replenishment-requests': 'box',
};
