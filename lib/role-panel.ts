import { homeToolsFor, panelToolsFor, startActionsFor, type HomeTool, type HomeToolTarget, type ToolArt } from './home-tools';
import { WORK_VIEW_LABEL, workViewsFor, type WorkView } from './tool-directory';
import { applyMenuLayout, type MenuLayout } from './menu-layout';
import type { WorkspaceSection } from './workspace-map';

// The desktop left panel for each role. Every role gets its own point of view: its own heading,
// its own groups in its own words, and its everyday tools one click away, so a cleaner's panel
// looks nothing like Accounts' or a super admin's. View as uses the same panel for the role being
// viewed, so the super admin sees exactly that role's panel and none of their own tools.
//
// Order for the team (Alex, 20 October 2026): My Recharge, Maintenance, Management, Safety & Compliance,
// Property Onboarding, Listing Management, Property Database, Stock, Housekeeping, Finance, then Start
// something. Every team role has the same sections in the same order and sees only the links it can open.
//
// Each link opens a page (Home, Messages…), a Work area (Cleans, Maintenance…), one of the role's
// Home tools (Guest inbox, Payouts…; only the ones the person holds), or starts a form.
export type PanelIcon = string; // a Feather icon name
export type PanelLink =
  | { key: string; kind: 'page'; label: string; icon: PanelIcon; section: WorkspaceSection }
  | { key: string; kind: 'area'; label: string; icon: PanelIcon; view: WorkView }
  | { key: string; kind: 'tool'; label: string; icon: PanelIcon; target: HomeToolTarget }
  | { key: string; kind: 'start'; label: string; icon: PanelIcon; target: HomeToolTarget };
// `key` is the section's stable name (the saved menu order uses it, never the title).
export type PanelGroup = { key: string; title: string; links: PanelLink[] };
// `work` is the Work area the phone bar's Work button opens (the role's first Work view), so the bar and the phone
// menu know which panel link that button stands for wherever the menu puts it.
export type RolePanel = { title: string; tagline: string; icon: PanelIcon; groups: PanelGroup[]; work?: WorkView };

type Page = 'home' | 'todo' | 'calendar' | 'decisions' | 'favorites' | 'properties' | 'analytics' | 'inbox' | 'help' | 'approvals' | 'statements' | 'enquiries' | 'feedback' | 'moderation' | 'mailbox';
const PAGE: Record<Page, [string, PanelIcon]> = {
  home: ['Home', 'home'], todo: ['To-do', 'clipboard'], calendar: ['Calendar', 'calendar'], decisions: ['My requests', 'check-circle'],
  favorites: ['Favourites', 'star'], properties: ['Properties', 'key'], analytics: ['Reports', 'bar-chart-2'],
  inbox: ['Messages', 'message-circle'], help: ['Help & training', 'help-circle'],
  approvals: ['Approvals', 'check-circle'], mailbox: ['Mailbox', 'mail'], statements: ['Owner statements', 'pie-chart'], enquiries: ['Leads', 'mail'],
  feedback: ['Feedback', 'message-square'], moderation: ['Reported messages', 'flag'],
};
const AREA_ICON: Record<WorkView, PanelIcon> = {
  management: 'briefcase', hub: 'layers', calendar: 'calendar', stays: 'moon', clients: 'users', cleans: 'check-square', repairs: 'tool', accounts: 'pie-chart', all: 'list',
};
const ART_ICON: Record<ToolArt, PanelIcon> = {
  house: 'home', building: 'briefcase', hardhat: 'tool', spray: 'droplet', people: 'users', coins: 'dollar-sign', clipboard: 'clipboard',
  hourglass: 'clock', medal: 'award', key: 'key', chart: 'file-text', toolbox: 'tool', calendar: 'calendar', chat: 'message-square',
  compass: 'compass', sun: 'sun', tag: 'tag', relist: 'refresh-cw', signature: 'edit-3', shield: 'shield', box: 'package', bell: 'bell',
  receipt: 'file-text', wallet: 'credit-card', pie: 'pie-chart', cart: 'shopping-cart', sofa: 'grid', search: 'search', mail: 'mail', star: 'book-open',
};

// Tools whose picture would repeat another's in the panel (Waiting on you is the clock).
const TOOL_ICON: Record<string, PanelIcon> = { productivity: 'activity', performance: 'award', month: 'trending-up', limits: 'sliders', bins: 'trash-2', compliance: 'file-text' };
const FORM_ICON: Partial<Record<string, PanelIcon>> = { 'new-expense': 'file-plus' };


// Favorites is in every role's first section, straight after Home (Lee, round 6: "always in the overview for
// easy access regardless of which role"), and the menu order cannot move it out (lib/menu-layout.ts).
// Each group is [key, title, links]. The key is the section's stable name for the saved menu order
// (lib/menu-layout.ts); keep it when renaming a title. Links:
// page:<page>[=label], area:<view>[=label], tool:<home tool key>[=label], start (the role's "start something" forms),
// form:<form>[=label] (one of those forms, for roles that can start it),
// same:<home tool key> (a tool another link in the panel already opens).
type Layout = { title: string; tagline: string; icon: PanelIcon; groups: [string, string, string[]][] };
// Alex's menu (20 October 2026). The team's sections, in this order, the same for every team role; each role
// gets only the links it can open (links it lacks drop out, and an empty section is not shown), so admins
// and super admins, who can open everything, see the same menu. Section keys are the stable names saved menu
// orders use: the first section keeps each role's old key, Management keeps "management" and Finance keeps
// "money"; the rest are new, so an order saved for the old sections leaves their links in these defaults.
// Calendars open the Calendar page on one team, or on one kind of work (safety, onboarding) (tool:calendar-*, lib/home-tools.ts).
const FIRST_KEY: Record<string, string> = { super_admin: 'overview', admin: 'overview', stays: 'today', cleans: 'my-day', cleaning_manager: 'today', ready: 'today', accounts: 'overview' };
const VISIT_KINDS = ['tool:garden=Garden Maintenance', 'tool:bins=Waste Collection'];
function teamGroups(role: string): [string, string, string[]][] {
  const admin = role === 'admin' || role === 'super_admin', cleaning = role === 'cleans' || role === 'cleaning_manager';
  const only = (yes: boolean, specs: string[]) => yes ? specs : [];
  return [
    // Admins' Reports is the whole business, not their own performance, so it comes last here as Reports.
    [FIRST_KEY[role], 'My Recharge', ['page:home', 'page:favorites', 'page:inbox=Inbox', 'page:todo=To-do',
      ...only(!admin, ['page:analytics=My Performance', 'tool:month']),
      'tool:schedule=Schedule', 'tool:today=Schedule', 'tool:rota=Schedule',
      ...only(!admin, ['tool:training', 'page:feedback=Send feedback', 'page:help=Help']),
      ...only(admin, ['page:analytics=Reports'])]],
    // Garden Maintenance and Waste Collection open the preventative visits filtered to garden or bins visits.
    ['maintenance', 'Maintenance', [...(role === 'ready' ? ['tool:pipeline=Reactive Jobs', ...VISIT_KINDS, 'area:repairs=All maintenance'] : ['area:repairs=Reactive Jobs', ...VISIT_KINDS]),
      'tool:visits', 'tool:aircover=AirCover Claims', 'tool:calendar-ready=Maintenance Calendar']],
    ['management', 'Management', ['page:decisions=Approval Requests', 'same:queue', 'tool:dailytasks=Daily Checklist',
      'tool:people', 'tool:productivity', 'tool:performance', 'tool:access', 'tool:limits', 'page:moderation', ...only(admin, ['tool:training', 'page:feedback']),
      'area:management=Management centre', 'area:all']],
    // Compliance Certs opens the licensing tracker too (its certificates are steps there); the calendar is preset to safety work.
    ['safety', 'Safety & Compliance', ['tool:licensing=Licensing', 'tool:compliance=Compliance Certs', 'tool:calendar-safety=Safety & Compliance Calendar']],
    ['onboarding', 'Property Onboarding', ['tool:inspections=New Property Inspections', 'page:enquiries=Leads', 'tool:onboarding=Property Status',
      'tool:calendar-onboarding=Calendar', 'tool:furnishing',
      'area:clients=Client relations']],
    ['listings', 'Listing Management', ['tool:bookings=Direct Bookings', 'tool:calendar-stays=Booking Calendar', 'tool:pricing=Pricing',
      'tool:booking-performance=Booking Performance', 'tool:reviews=Reviews', 'tool:checks=Listing Maintenance', 'area:stays=Guest relations']],
    // Accounts have never had the property pages (lib/tool-directory.ts).
    ['property-database', 'Property Database', only(role !== 'accounts', ['page:properties=Property Database'])],
    // Accounts' Purchases is their order fulfilment, under Finance. Reimbursement Request starts the New expense form.
    ['stock', 'Stock', [...only(role !== 'accounts', ['tool:purchases=Place Order']), 'tool:studio=Item Catalogue', 'form:new-expense=Reimbursement Request', 'tool:restock']],
    ['housekeeping', 'Housekeeping', [cleaning ? 'area:cleans=My Jobs' : 'area:cleans=Cleans', 'tool:calendar-cleans=Calendar', 'tool:review=Form Submissions',
      'tool:respond', 'tool:disputes', 'tool:unassigned', 'tool:cleaners', 'tool:setups', ...only(role === 'cleaning_manager', ['tool:invoices'])]],
    ['money', 'Finance', [...only(role === 'accounts', ['tool:purchases=Order Fulfilment']), 'tool:order-fulfilment=Order Fulfilment',
      'tool:cleaner-invoices=Payable Invoices', 'tool:receivable=Receivable Invoices', 'tool:invoices', 'tool:expenses=Client Funds & Expenses',
      'page:statements=Owner Statements', 'same:statements', 'tool:profit-loss=Profit/Loss Reporting', 'tool:payouts', 'tool:budget', 'area:accounts=Accounts desk']],
    ['start', 'Start something', ['start']],
  ];
}
const LAYOUTS: Record<string, Layout> = {
  super_admin: { title: 'Super admin', tagline: 'The whole business, its people and access', icon: 'shield', groups: teamGroups('super_admin') },
  admin: { title: 'Management', tagline: 'Every team, property and decision', icon: 'briefcase', groups: teamGroups('admin') },
  stays: { title: 'Guest relations', tagline: 'Guests, listings and bookings', icon: 'moon', groups: teamGroups('stays') },
  cleans: { title: 'Cleaning', tagline: 'Your cleans, checklists and pay', icon: 'check-square', groups: teamGroups('cleans') },
  cleaning_manager: { title: 'Cleaning team', tagline: 'Schedule, reviews and cleaners', icon: 'users', groups: teamGroups('cleaning_manager') },
  ready: { title: 'Ready', tagline: 'Repairs, visits and purchases', icon: 'tool', groups: teamGroups('ready') },
  accounts: { title: 'Accounts', tagline: 'Invoices, payouts and statements', icon: 'pie-chart', groups: teamGroups('accounts') },
  // Owners (Alex): their own places first, then their requests. Statements and Calendar open the Statements and
  // Booking calendar parts of the Portfolio page.
  client: {
    title: 'Owner', tagline: 'Your properties, stays and earnings', icon: 'home', groups: [
      ['your-properties', 'My Recharge', ['page:home', 'page:favorites', 'page:inbox=Inbox', 'page:properties=My Portfolio', 'tool:statements=My Statements',
        'tool:booking-calendar=Calendar', 'page:analytics=Property Performance', 'page:approvals', 'page:mailbox']],
      ['requests', 'Requests', ['area:repairs=Repairs', 'area:all=All requests', 'tool:furnishing', 'page:help=Tools & help']],
      ['start', 'Start something', ['start']],
    ],
  },
};
// Pages only some roles have (the workspace refuses the others).
const TEAM = ['super_admin', 'admin', 'stays', 'cleans', 'cleaning_manager', 'ready', 'accounts'];
const PAGE_ROLES: Partial<Record<Page, string[]>> = {
  todo: TEAM, calendar: TEAM, decisions: TEAM,
  approvals: ['client'], mailbox: ['client'], statements: ['accounts', 'admin', 'super_admin'], enquiries: ['admin', 'super_admin', 'stays'],
  feedback: ['admin', 'super_admin', 'stays'], moderation: ['admin', 'super_admin'],
};

// A Home tool that opens a Work area at its top is that area. (Tools kept in All work, such as
// Inspections or Purchases, stay tools of their own.)
const plainArea = (target: HomeToolTarget): WorkView | null =>
  target.kind === 'work' && target.view !== 'all' && !target.sub && !target.anchor && !target.open && !target.workId ? target.view : null;

// `layout` is the menu order a super admin saved for the role (Access control → Menu order). It only
// reorders: the sections and links come from the role and its tools as above (lib/menu-layout.ts).
// `keepEmpty` keeps sections the layout emptied (only the Menu order editor wants them).
export function rolePanel(role: string, modules: readonly string[], layout?: MenuLayout | null, keepEmpty = false): RolePanel {
  const spec = LAYOUTS[role];
  if (!spec) return { title: role, tagline: '', icon: 'user', groups: [] };
  const views = workViewsFor(role), tools = [...homeToolsFor(role, modules), ...panelToolsFor(role, modules)], actions = startActionsFor(role, modules);
  const admin = role === 'admin' || role === 'super_admin';
  // Calendar is a page of its own for the team; the Work → Calendar view is the same place, so it is not listed twice.
  const used = new Set<string>(views.includes('calendar') ? ['area:calendar'] : []);
  const area = (view: WorkView, label?: string): PanelLink | null =>
    views.includes(view) ? { key: 'area:' + view, kind: 'area', label: label ?? WORK_VIEW_LABEL[view], icon: AREA_ICON[view], view } : null;
  const fromTool = (t: HomeTool, label?: string): PanelLink | null => {
    const view = plainArea(t.target);
    if (view) return area(view, label ?? t.label);
    // Updates is a tab inside Messages now, so a tool that pointed at it has no panel link of its own.
    if (t.target.kind === 'tab' && !t.target.anchor) return t.target.tab === 'activity' ? null : page(t.target.tab, label ?? t.label);
    return { key: 'tool:' + t.key, kind: 'tool', label: label ?? t.label, icon: TOOL_ICON[t.key] ?? ART_ICON[t.art], target: t.target };
  };
  const page = (name: Page, label?: string): PanelLink | null =>
    PAGE_ROLES[name] && !PAGE_ROLES[name]!.includes(role) ? null : { key: 'page:' + name, kind: 'page', label: label ?? pageLabel(name), icon: PAGE[name][1], section: name };
  // Reports is "My performance" for the team (their own numbers); admins keep Reports. Requests: admins decide, staff ask.
  const pageLabel = (name: Page) => name === 'analytics' && role !== 'client' && !admin ? 'My performance' : name === 'decisions' && admin ? 'Management approvals' : PAGE[name][0];
  const resolve = (spec: string): PanelLink[] => {
    if (spec.startsWith('same:')) { used.add('tool:' + spec.slice(5)); return []; }
    if (spec === 'start') return actions.map(a => ({ key: 'start:' + a.key, kind: 'start', label: a.label, icon: a.icon, target: a.target }));
    if (spec.startsWith('form:')) {
      // Its own key, so Start something keeps the same form too.
      const [ref, label] = spec.split('='), a = actions.find(x => x.key === ref.slice(5));
      return a ? [{ key: ref, kind: 'start', label: label ?? a.label, icon: FORM_ICON[a.key] ?? a.icon, target: a.target }] : [];
    }
    const [ref, label] = spec.split('=');
    const [kind, name] = ref.split(':');
    const link = kind === 'page' ? page(name as Page, label) : kind === 'area' ? area(name as WorkView, label)
      : (() => { const t = tools.find(x => x.key === name); return t ? fromTool(t, label) : null; })();
    return link ? [link] : [];
  };
  const groups: PanelGroup[] = spec.groups.map(([key, title, specs]) => ({
    key, title, links: specs.flatMap(resolve).filter(link => !used.has(link.key) && !!used.add(link.key)),
  }));
  // Anything the role has that the layout does not place yet still gets a place, under More. (Its key is not the
  // old "more", so an order saved for the old More section cannot pull links out of their sections into it.)
  const rest = [...views.map(v => area(v)), ...tools.map(t => fromTool(t))].filter((l): l is PanelLink => !!l && !used.has(l.key) && !!used.add(l.key));
  if (rest.length) groups.push({ key: UNPLACED, title: 'More', links: rest });
  const meta = { title: spec.title, tagline: spec.tagline, icon: spec.icon, ...(views[0] ? { work: views[0] } : {}) };
  // A section left holding only a team calendar is not shown for this role (accounts get no Maintenance section for
  // its calendar alone); a role left with no calendar link gets the plain Calendar in My Recharge instead. This is
  // judged on the menu as arranged, after the saved order: an order that moves Licensing and Compliance Certs out of
  // Safety & Compliance leaves that section only its calendar, so it goes too. First see where the saved order puts
  // every link, then drop the calendars that end up alone and arrange again (the plain Calendar then takes the place
  // the saved order gives it, if any).
  // A calendar alone in its default section stays out whatever the order (the saved order only arranges, never adds).
  const isCalendar = (l: PanelLink) => l.key.startsWith('tool:calendar-');
  const firstKey = groups[0]?.key;
  const aloneIn = (gs: readonly PanelGroup[]) => gs.filter(g => g.key !== firstKey && g.links.length && g.links.every(isCalendar)).flatMap(g => g.links.map(l => l.key));
  const alone = new Set(aloneIn(groups));
  const without = (gs: readonly PanelGroup[]) => gs.map(g => ({ ...g, links: g.links.filter(l => !alone.has(l.key)) }));
  const arranged = applyMenuLayout({ ...meta, groups: without(groups).filter(g => g.links.length) }, layout, true);
  for (const k of aloneIn(arranged.groups)) alone.add(k);
  const kept: PanelGroup[] = without(groups);
  if (views.includes('calendar') && kept[0] && !kept.some(g => g.links.some(isCalendar))) {
    const calendar = page('calendar');
    if (calendar) kept[0].links.push(calendar);
  }
  return applyMenuLayout({ ...meta, groups: kept.filter(g => g.links.length) }, layout, keepEmpty);
}
export const UNPLACED = 'unplaced';
// The desktop left panel (Lee, 15 October 2026): Messages is not listed, because the Messages button
// sits at the top of every desktop page already, and each section shows its first few links with
// "See more" for the rest. The phone menu and the Menu order editor keep every link.
export const PANEL_SHOWN = 3;
export function desktopPanel(panel: RolePanel): RolePanel {
  return { ...panel, groups: panel.groups.map(g => ({ ...g, links: g.links.filter(l => l.key !== 'page:inbox') })).filter(g => g.links.length) };
}
// The links a section shows: the first few, or all of them when opened or when the place open now is
// further down (so the highlighted link is never hidden).
export function shownLinks(links: readonly PanelLink[], selected: string, open: boolean): { links: PanelLink[]; hidden: number; forced: boolean } {
  if (links.length <= PANEL_SHOWN) return { links: [...links], hidden: 0, forced: false };
  const forced = links.slice(PANEL_SHOWN).some(l => l.key === selected);
  return open || forced ? { links: [...links], hidden: 0, forced } : { links: links.slice(0, PANEL_SHOWN), hidden: links.length - PANEL_SHOWN, forced };
}
