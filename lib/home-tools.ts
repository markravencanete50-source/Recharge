import { workViewsFor, type WorkView } from './tool-directory';
import type { ModuleId } from './modules';

// The tools each role sees first on Home: one tap opens the exact place the work happens
// (a Work view, a tab inside it, or a section further down), so nobody has to hunt for them.
export type ToolArt =
  | 'house' | 'building' | 'hardhat' | 'spray' | 'people' | 'coins' | 'clipboard' | 'hourglass' | 'medal' | 'key'
  | 'chart' | 'toolbox' | 'calendar' | 'chat' | 'compass' | 'sun'
  | 'tag' | 'relist' | 'signature' | 'shield' | 'box' | 'bell' | 'receipt' | 'wallet' | 'pie' | 'cart' | 'sofa' | 'search' | 'mail' | 'star';
export type HomeToolTarget =
  | { kind: 'work'; view: WorkView; sub?: string; anchor?: string }
  | { kind: 'tab'; tab: 'properties' | 'analytics' | 'activity' | 'help'; anchor?: string }
  | { kind: 'tracker'; module: ModuleId }
  | { kind: 'calculator' };
export type HomeTool = { key: string; label: string; detail: string; art: ToolArt; target: HomeToolTarget };
type Candidate = HomeTool & { needs?: ModuleId[] };

// Sections are found by their heading: "Daily checks" is section-daily-checks.
export const sectionAnchor = (title: string) => 'section-' + title.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const work = (view: WorkView, extra: { sub?: string; section?: string; anchor?: string } = {}): HomeToolTarget =>
  ({ kind: 'work', view, ...(extra.sub ? { sub: extra.sub } : {}), ...(extra.section ? { anchor: sectionAnchor(extra.section) } : extra.anchor ? { anchor: extra.anchor } : {}) });
const tab = (name: 'properties' | 'analytics' | 'activity' | 'help'): HomeToolTarget => ({ kind: 'tab', tab: name });
const tool = (key: string, label: string, detail: string, art: ToolArt, target: HomeToolTarget, needs?: ModuleId[]): Candidate => ({ key, label, detail, art, target, ...(needs ? { needs } : {}) });

const PROPERTIES = tool('properties', 'Properties', 'Every property and its details', 'house', tab('properties'));
const HELP = tool('help', 'Help & training', 'Guides for your role', 'compass', tab('help'));
const UPDATES = tool('updates', 'Updates', 'What changed recently', 'bell', tab('activity'));
const RESTOCK = tool('restock', 'Restock requests', 'Ask for supplies', 'box', { kind: 'tracker', module: 'replenishment-requests' }, ['replenishment-requests']);

const BY_ROLE: Record<string, Candidate[]> = {
  admin: [
    tool('queue', 'Waiting on you', 'Decisions and approvals', 'hourglass', work('management', { sub: 'queue' })),
    tool('people', 'People', 'Accounts, roles and tools', 'people', work('management', { sub: 'people' })),
    tool('performance', 'Performance', 'Shifts, replies and sign-offs', 'medal', work('management', { sub: 'performance' })),
    tool('stays', 'Stays', 'Checks, pricing and re-listings', 'building', work('stays')),
    tool('cleans', 'Cleans', 'Schedule, reviews and cleaners', 'spray', work('cleans')),
    tool('repairs', 'Repairs', 'Reports, bookings and visits', 'toolbox', work('repairs')),
    tool('accounts', 'Accounts', 'Expenses, payouts, statements', 'coins', work('accounts')),
    PROPERTIES,
  ],
  stays: [
    tool('checks', 'Daily checks', 'Listings live and reviewed', 'clipboard', work('stays', { section: 'Daily checks' }), ['listing-health']),
    tool('pricing', 'Pricing', 'Empty nights this week', 'tag', work('stays', { section: 'Day by day' }), ['daily-pricing']),
    tool('relistings', 'Re-listings', 'To start and under way', 'relist', work('stays', { section: 'Re-listings' }), ['listing-health']),
    tool('signoff', 'Today’s sign-off', 'Close the day', 'signature', work('stays', { anchor: 'stays-signoff' }), ['listing-health']),
    tool('repairs', 'Repairs', 'Report and chase repairs', 'toolbox', work('repairs'), ['stays-maintenance-reporting', 'maintenance-reporting']),
    tool('cleans', 'Cleans', 'Cleans at your properties', 'spray', work('cleans'), ['cleaning-schedule', 'clean-reporting']),
    tool('bookings', 'Bookings & licences', 'Direct offers and licensing', 'calendar', work('all'), ['direct-bookings', 'licensing']),
    tool('aircover', 'AirCover claims', 'Add and close claims', 'shield', { kind: 'tracker', module: 'aircover-reporting' }, ['aircover-reporting']),
    { ...PROPERTIES, needs: ['property-database', 'ota-logins', 'property-onboarding'] },
  ],
  cleans: [
    tool('today', 'My cleans', 'Schedule and checklists', 'spray', work('cleans', { section: 'Schedule' })),
    tool('respond', 'Needs a reply', 'Complaints to answer', 'chat', work('cleans', { section: 'Needs your response' })),
    tool('month', 'My month', 'Cleans done and pay', 'medal', work('cleans', { section: 'Your month' })),
    RESTOCK,
    UPDATES,
    HELP,
  ],
  cleaning_manager: [
    tool('schedule', 'Schedule', 'Every clean by day', 'calendar', work('cleans', { section: 'Schedule' })),
    tool('review', 'To review', 'Submitted cleans', 'star', work('cleans', { section: 'Waiting for your review' })),
    tool('unassigned', 'Not assigned', 'Cleans without a cleaner', 'people', work('cleans', { section: 'Not yet assigned' })),
    tool('cleaners', 'Cleaners', 'Performance this month', 'medal', work('cleans', { section: 'Cleaner performance this month' })),
    tool('setups', 'Cleaning set-ups', 'New properties to prepare', 'clipboard', work('all'), ['clean-property-onboarding']),
    tool('invoices', 'Clean invoices', 'Cleans to invoice', 'receipt', work('all'), ['cleans-invoices']),
    RESTOCK,
    { ...PROPERTIES, needs: ['clean-client-database', 'property-database'] },
  ],
  ready: [
    tool('pipeline', 'Repairs', 'Reported, booked and done', 'toolbox', work('repairs', { section: 'Pipeline' })),
    tool('visits', 'Routine visits', 'Garden, bins and safety', 'sun', work('repairs', { section: 'Routine visits' })),
    tool('inspections', 'Inspections', 'New properties to inspect', 'search', work('all'), ['new-property-inspection-board']),
    tool('purchases', 'Purchases', 'Orders and deliveries', 'cart', work('all'), ['purchase-order']),
    tool('furnishing', 'Furnishing quotes', 'Rooms to furnish', 'sofa', work('all'), ['property-furnishing-board']),
    { ...PROPERTIES, needs: ['property-database', 'clean-client-database'] },
    HELP,
  ],
  accounts: [
    tool('expenses', 'Expenses', 'Evidence to approve', 'receipt', work('accounts', { sub: 'expenses' })),
    tool('payouts', 'Payouts', 'Platform payouts to match', 'wallet', work('accounts', { sub: 'payouts' })),
    tool('statements', 'Owner statements', 'Draft, issue and settle', 'pie', work('accounts', { sub: 'statements' })),
    tool('purchases', 'Purchases', 'Approve and order', 'cart', work('accounts', { section: 'Purchases' })),
    tool('cleaner-invoices', 'Cleaner invoices', 'Accepted cleans by cleaner', 'spray', work('accounts', { section: 'Cleaner invoices' })),
    tool('budget', 'Budget chart', 'Most each item should cost', 'coins', work('accounts', { section: 'Budget chart' })),
    tool('invoices', 'Invoices', 'Payments and settled', 'chart', tab('analytics')),
    RESTOCK,
  ],
  client: [
    tool('stays', 'Stays & statements', 'Bookings and money', 'calendar', work('owner')),
    tool('repairs', 'Repairs', 'Request and approve', 'toolbox', work('repairs')),
    tool('mailbox', 'Mailbox', 'Post at your properties', 'mail', work('owner', { section: 'Mailbox' }), ['client-mailbox']),
    tool('furnishing', 'Furnishing calculator', 'What each room needs', 'sofa', { kind: 'calculator' }, ['client-furnishing']),
    { ...PROPERTIES, label: 'My properties', detail: 'Onboarding and details' },
    tool('reports', 'Reports', 'How your properties do', 'chart', tab('analytics')),
    UPDATES,
    HELP,
  ],
};
BY_ROLE.super_admin = BY_ROLE.admin;

export function homeToolsFor(role: string, modules: readonly string[]): HomeTool[] {
  const views = workViewsFor(role);
  return (BY_ROLE[role] ?? []).filter(t =>
    (!t.needs || t.needs.some(m => modules.includes(m))) &&
    (t.target.kind !== 'work' || views.includes(t.target.view)),
  ).map(({ needs, ...t }) => { void needs; return t; });
}

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
