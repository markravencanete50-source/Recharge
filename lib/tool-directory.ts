import { MODULES, type ModuleId } from './modules';

// Where each tool lives in the live app, so every tool a person holds opens somewhere real.
export type WorkView = 'management' | 'calendar' | 'stays' | 'cleans' | 'repairs' | 'accounts' | 'all';
export type ToolPlace =
  | { kind: 'work'; view: WorkView; where: string }
  | { kind: 'tab'; tab: 'home' | 'properties' | 'analytics'; where: string }
  | { kind: 'tracker'; where: string }
  | { kind: 'calculator'; where: string };

export const WORK_VIEW_LABEL: Record<WorkView, string> = { management: 'Management', calendar: 'Calendar', stays: 'Stays', cleans: 'Cleans', repairs: 'Repairs', accounts: 'Accounts', all: 'All work' };

// The Work views each role can open, the first being the default. Team roles have the Calendar
// second, after their main view. Owners' stays, earnings, statements and mailbox are in Reports
// (one place), so their Work holds only repairs and their other requests.
export function workViewsFor(role: string): WorkView[] {
  if (role === 'admin' || role === 'super_admin') return ['management', 'calendar', 'stays', 'cleans', 'repairs', 'accounts', 'all'];
  if (role === 'stays') return ['stays', 'calendar', 'cleans', 'repairs', 'all'];
  if (role === 'client') return ['repairs', 'all'];
  if (role === 'cleans' || role === 'cleaning_manager') return ['cleans', 'calendar', 'all'];
  if (role === 'ready') return ['repairs', 'calendar', 'all'];
  if (role === 'accounts') return ['accounts', 'calendar', 'all'];
  return ['all'];
}

const work = (view: WorkView, where: string): ToolPlace => ({ kind: 'work', view, where });
const PLACES: Record<ModuleId, ToolPlace> = {
  'daily-pricing': work('stays', 'Work → Stays → Daily checks'),
  'listing-health': work('stays', 'Work → Stays → Daily checks'),
  'direct-bookings': work('stays', 'Work → Stays, then All work for offers'),
  'guest-communication': work('stays', 'Work → Stays → Guest inbox; reply times in Management → Team performance'),
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
  'stays-maintenance-reporting': work('repairs', 'Work → Repairs'),
  'client-property-maintenance': work('repairs', 'Work → Repairs'),
  'safety-maintenance': work('repairs', 'Work → Repairs → Routine visits'),
  'routine-bin-garden-board': work('repairs', 'Work → Repairs → Routine visits'),
  'ready-schedule': work('repairs', 'Work → Repairs → Routine visits'),
  'licensing': work('all', 'Work → All work (licensing)'),
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
  'aircover-reporting': { kind: 'tracker', where: 'A simple tracker: add and close AirCover claims' },
  'replenishment-requests': { kind: 'tracker', where: 'A simple tracker: add and close restock requests' },
};

export type Tool = { id: ModuleId; name: string; description: string; place: ToolPlace };
// The person's tools, each with where it lives for their role. A Work view the role cannot open
// falls back to All work. Accounts have no Properties tab (the portfolio read refuses them), so
// tools that live there are left out for them.
export function toolsFor(role: string, modules: readonly string[]): Tool[] {
  const views = workViewsFor(role);
  const onPropertiesTab = (place: ToolPlace) => place.kind === 'tab' && place.tab === 'properties';
  return MODULES.filter(m => modules.includes(m.id) && !(role === 'accounts' && onPropertiesTab(PLACES[m.id as ModuleId]))).map(m => {
    let place = PLACES[m.id as ModuleId];
    if (place.kind === 'work' && !views.includes(place.view)) place = work('all', 'Work → All work');
    return { id: m.id as ModuleId, name: m.name, description: m.description, place };
  });
}
