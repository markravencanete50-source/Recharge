import { MODULES, type ModuleId } from './modules';

// Where each tool lives in the live app, so every tool a person holds opens somewhere real.
export type WorkView = 'management' | 'hub' | 'calendar' | 'stays' | 'clients' | 'cleans' | 'repairs' | 'accounts' | 'all';
export type ToolPlace =
  | { kind: 'work'; view: WorkView; where: string; sub?: string }
  | { kind: 'tab'; tab: 'home' | 'properties' | 'analytics'; where: string }
  | { kind: 'tracker'; where: string }
  | { kind: 'calculator'; where: string };

// 'hub' stays in the type only so the unrouted Hub screen still compiles; no role has it any more.
// Stays is Guest relations (the old name is gone from every menu).
export const WORK_VIEW_LABEL: Record<WorkView, string> = { management: 'Management', hub: 'Hub', calendar: 'Calendar', stays: 'Guest relations', clients: 'Client relations', cleans: 'Cleans', repairs: 'Maintenance', accounts: 'Accounts', all: 'All work' };

// The Work views each role can open, the first being the default. Guest relations and Client relations
// replace Stays and the Hub (to-dos, approvals and trackers now live in To-do, Management approvals and
// those two areas). Owners' stays, earnings, statements and mailbox are in Reports (one place), so their
// Work holds only repairs and their other requests.
export function workViewsFor(role: string): WorkView[] {
  if (role === 'admin' || role === 'super_admin') return ['management', 'stays', 'clients', 'calendar', 'cleans', 'repairs', 'accounts', 'all'];
  if (role === 'stays') return ['stays', 'clients', 'calendar', 'cleans', 'repairs', 'all'];
  if (role === 'client') return ['repairs', 'all'];
  if (role === 'cleans' || role === 'cleaning_manager') return ['cleans', 'calendar', 'all'];
  if (role === 'ready') return ['repairs', 'calendar', 'all'];
  if (role === 'accounts') return ['accounts', 'calendar', 'all'];
  return ['all'];
}

const work = (view: WorkView, where: string, sub?: string): ToolPlace => ({ kind: 'work', view, where, ...(sub ? { sub } : {}) });
const PLACES: Record<ModuleId, ToolPlace> = {
  'daily-pricing': work('clients', 'Work → Client relations → Pricing', 'pricing'),
  'listing-health': work('clients', 'Work → Client relations → Listing health', 'listings'),
  'direct-bookings': work('stays', 'Work → Guest relations → Direct bookings', 'bookings'),
  'guest-communication': work('stays', 'Work → Guest relations; guests reply in Messages; reply times in Management → Performance'),
  'weekly-performance': { kind: 'tab', tab: 'properties', where: 'Properties → a property → Download property report' },
  'property-database': { kind: 'tab', tab: 'properties', where: 'Properties' },
  'ota-logins': { kind: 'tab', tab: 'properties', where: 'Properties → a property → Access and logins' },
  'clean-client-database': { kind: 'tab', tab: 'properties', where: 'Properties' },
  'property-onboarding': { kind: 'tab', tab: 'properties', where: 'Properties → a property → onboarding journey' },
  'new-property-inspection-board': work('all', 'Work → All work (inspections)'),
  'cleaning-schedule': work('cleans', 'Work → Cleans'),
  'cleaner-performance': work('cleans', 'Work → Cleans → Performance'),
  'clean-reporting': work('cleans', 'Work → Cleans → Reviews'),
  'cleaner-database': work('cleans', 'Work → Cleans → Performance (your cleaners)'),
  'clean-property-onboarding': work('all', 'Work → All work (cleaning set-ups)'),
  'cleans-invoices': work('all', 'Work → All work (clean invoices)'),
  'maintenance-reporting': work('repairs', 'Work → Repairs'),
  'stays-maintenance-reporting': work('repairs', 'Work → Maintenance (reactive repairs)'),
  'client-property-maintenance': work('repairs', 'Work → Repairs'),
  'safety-maintenance': work('repairs', 'Work → Maintenance → Preventative maintenance'),
  'routine-bin-garden-board': work('repairs', 'Work → Maintenance → Preventative maintenance'),
  'ready-schedule': work('repairs', 'Work → Maintenance → Preventative maintenance'),
  'licensing': work('clients', 'Work → Client relations → Licensing', 'licensing'),
  'purchase-order': work('all', 'Work → All work (purchases)'),
  'purchase-order-requests': work('all', 'Properties → a property → Request a property purchase; progress in All work'),
  'client-purchase-order-quotes': work('all', 'Work → All work (purchase requests)'),
  'property-furnishing-board': work('all', 'Work → All work (furnishing quotes)'),
  'client-furnishing': { kind: 'calculator', where: 'Opens the furnishing calculator in the app' },
  'owner-statements': work('accounts', 'Work → Accounts → Statements'),
  'maintenance-reconciliation': work('accounts', 'Work → Accounts → Expenses'),
  'onboarding-invoices': work('all', 'Work → All work (onboarding invoices); payments in Reports'),
  'purchase-order-invoices': work('all', 'Work → All work (purchases); payments in Reports'),
  'purchase-order-accounts': work('all', 'Work → All work (purchases); payments in Reports'),
  'client-dashboard': { kind: 'tab', tab: 'analytics', where: 'Reports → stays, earnings and statements' },
  'client-mailbox': { kind: 'tab', tab: 'analytics', where: 'Reports → Mailbox' },
  'aircover-reporting': work('stays', 'Work → Guest relations → AirCover claims', 'aircover'),
  'replenishment-requests': { kind: 'tracker', where: 'A simple tracker: add and close restock requests' },
};

// A Work view the role cannot open falls back to All work, except AirCover, which the simple tracker
// still serves for a role without Guest relations (Accounts can hold the tool).
const FALLBACK: Partial<Record<ModuleId, ToolPlace>> = { 'aircover-reporting': { kind: 'tracker', where: 'A simple tracker: add and close AirCover claims' } };

export type Tool = { id: ModuleId; name: string; description: string; place: ToolPlace };
// The person's tools, each with where it lives for their role. A Work view the role cannot open
// falls back to All work. Accounts have no Properties tab (the portfolio read refuses them), so
// tools that live there are left out for them.
export function toolsFor(role: string, modules: readonly string[]): Tool[] {
  const views = workViewsFor(role);
  const onPropertiesTab = (place: ToolPlace) => place.kind === 'tab' && place.tab === 'properties';
  return MODULES.filter(m => modules.includes(m.id) && !(role === 'accounts' && onPropertiesTab(PLACES[m.id as ModuleId]))).map(m => {
    let place = PLACES[m.id as ModuleId];
    if (place.kind === 'work' && !views.includes(place.view)) place = FALLBACK[m.id as ModuleId] ?? work('all', 'Work → All work');
    return { id: m.id as ModuleId, name: m.name, description: m.description, place };
  });
}
