import { homeToolsFor, panelToolsFor, startActionsFor, type HomeTool, type HomeToolTarget, type ToolArt } from './home-tools';
import { WORK_VIEW_LABEL, workViewsFor, type WorkView } from './tool-directory';
import { applyMenuLayout, type MenuLayout } from './menu-layout';
import type { WorkspaceSection } from './workspace-map';

// The desktop left panel for each role. Every role gets its own point of view: its own heading,
// its own groups in its own words, and its everyday tools one click away, so a cleaner's panel
// looks nothing like Accounts' or a super admin's. View as uses the same panel for the role being
// viewed, so the super admin sees exactly that role's panel and none of their own tools.
//
// Order for the team: Home, To-do, the Work areas, then Calendar and Messages, then everything else.
// The Hub, Updates and Stays are gone (Updates is a tab inside Messages; Stays is Guest relations).
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
export type RolePanel = { title: string; tagline: string; icon: PanelIcon; groups: PanelGroup[] };

type Page = 'home' | 'todo' | 'calendar' | 'decisions' | 'favorites' | 'properties' | 'analytics' | 'inbox' | 'help' | 'approvals' | 'statements' | 'enquiries' | 'feedback' | 'moderation' | 'mailbox';
const PAGE: Record<Page, [string, PanelIcon]> = {
  home: ['Home', 'home'], todo: ['To-do', 'clipboard'], calendar: ['Calendar', 'calendar'], decisions: ['My requests', 'check-circle'],
  favorites: ['Favorites', 'star'], properties: ['Properties', 'key'], analytics: ['Reports', 'bar-chart-2'],
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
const TOOL_ICON: Record<string, PanelIcon> = { productivity: 'activity', performance: 'award', month: 'trending-up', limits: 'sliders' };

// The colour of each link's icon tile: departments in their own colours, everything else in one of
// the panel hues (lib/design-tokens.ts navHueTokens), so similar places look alike across roles.
export type PanelHue = 'forest' | 'ocean' | 'plum' | 'amber' | 'rose' | 'sky' | 'sage' | 'slate' | 'stays' | 'cleans' | 'ready' | 'accounts' | 'clients';
const AREA_HUE: Record<WorkView, PanelHue> = { management: 'forest', hub: 'sky', calendar: 'ocean', stays: 'stays', clients: 'clients', cleans: 'cleans', repairs: 'ready', accounts: 'accounts', all: 'slate' };
const KEY_HUE: Record<string, PanelHue> = {
  'page:home': 'forest', 'page:todo': 'sage', 'page:calendar': 'ocean', 'page:decisions': 'rose', 'page:favorites': 'amber', 'page:inbox': 'ocean', 'page:analytics': 'plum', 'page:help': 'slate',
  'page:properties': 'forest', 'page:approvals': 'rose', 'page:mailbox': 'ocean', 'page:statements': 'accounts', 'page:enquiries': 'sky', 'page:feedback': 'plum', 'page:moderation': 'rose',
  'tool:queue': 'rose', 'tool:people': 'ocean', 'tool:productivity': 'sage', 'tool:performance': 'amber', 'tool:access': 'rose', 'tool:training': 'plum',
  'tool:inbox': 'ocean', 'tool:checks': 'sage', 'tool:pricing': 'amber', 'tool:signoff': 'plum', 'tool:bookings': 'ocean', 'tool:aircover': 'rose',
  'tool:today': 'forest', 'tool:respond': 'rose', 'tool:month': 'plum', 'tool:restock': 'amber', 'tool:schedule': 'ocean', 'tool:review': 'sage',
  'tool:disputes': 'rose', 'tool:unassigned': 'amber', 'tool:cleaners': 'plum', 'tool:setups': 'sky', 'tool:invoices': 'accounts', 'tool:pipeline': 'ocean',
  'tool:visits': 'sage', 'tool:inspections': 'sky', 'tool:purchases': 'amber', 'tool:furnishing': 'plum', 'tool:expenses': 'rose', 'tool:payouts': 'sage',
  'tool:budget': 'amber', 'tool:limits': 'amber', 'tool:studio': 'plum', 'tool:cleaner-invoices': 'cleans', 'tool:mailbox': 'ocean',
};
export const linkHue = (link: PanelLink): PanelHue =>
  link.kind === 'area' ? AREA_HUE[link.view] : link.kind === 'start' ? 'forest' : KEY_HUE[link.key] ?? 'slate';

// Favorites is in every role's first section, straight after Home (Lee, round 6: "always in the overview for
// easy access regardless of which role"), and the menu order cannot move it out (lib/menu-layout.ts).
// Each group is [key, title, links]. The key is the section's stable name for the saved menu order
// (lib/menu-layout.ts); keep it when renaming a title. Links:
// page:<page>[=label], area:<view>[=label], tool:<home tool key>[=label], start (the role's "start something" forms),
// same:<home tool key> (a tool another link in the panel already opens).
type Layout = { title: string; tagline: string; icon: PanelIcon; groups: [string, string, string[]][] };
const MANAGEMENT_GROUPS: [string, string, string[]][] = [
  ['overview', 'Overview', ['page:home', 'page:favorites', 'page:todo']],
  ['departments', 'Departments', ['area:management=Management centre', 'area:stays', 'area:clients', 'area:cleans', 'area:repairs', 'area:accounts', 'area:all']],
  ['calendar-messages', 'Calendar & messages', ['page:calendar', 'page:inbox', 'page:decisions', 'same:queue']],
  ['management', 'Management', ['tool:people', 'tool:productivity', 'tool:performance', 'tool:access', 'tool:limits', 'page:moderation', 'tool:training']],
  ['more', 'More', ['tool:enquiries', 'tool:studio', 'page:analytics', 'page:properties', 'page:statements', 'page:feedback']],
  ['start', 'Start something', ['start']],
];
const LAYOUTS: Record<string, Layout> = {
  super_admin: { title: 'Super admin', tagline: 'The whole business, its people and access', icon: 'shield', groups: MANAGEMENT_GROUPS },
  admin: { title: 'Management', tagline: 'Every team, property and decision', icon: 'briefcase', groups: MANAGEMENT_GROUPS },
  stays: {
    title: 'Guest relations', tagline: 'Guests, listings and bookings', icon: 'moon', groups: [
      ['today', 'Today', ['page:home', 'page:favorites', 'page:todo']],
      ['work', 'Work', ['area:stays', 'area:clients', 'area:cleans', 'area:repairs=Reactive maintenance', 'area:all']],
      ['calendar-messages', 'Calendar & messages', ['page:calendar', 'page:inbox']],
      ['guests-listings', 'Guests & listings', ['tool:enquiries', 'tool:bookings', 'tool:aircover', 'tool:licensing', 'tool:checks', 'tool:pricing', 'tool:studio', 'page:properties']],
      ['more', 'More', ['page:analytics', 'page:decisions', 'tool:training', 'page:feedback=Send feedback']],
      ['start', 'Start something', ['start']],
    ],
  },
  cleans: {
    title: 'Cleaning', tagline: 'Your cleans, checklists and pay', icon: 'check-square', groups: [
      ['my-day', 'My day', ['page:home', 'page:favorites', 'page:todo']],
      ['my-work', 'My work', ['area:cleans=All my cleans', 'area:all']],
      ['calendar-messages', 'Calendar & messages', ['page:calendar=My calendar', 'page:inbox']],
      ['me', 'Me', ['tool:today', 'tool:respond', 'tool:month', 'page:analytics', 'tool:restock']],
      ['more', 'More', ['page:properties', 'page:decisions', 'tool:training', 'page:help=Help']],
    ],
  },
  cleaning_manager: {
    title: 'Cleaning team', tagline: 'Schedule, reviews and cleaners', icon: 'users', groups: [
      ['today', 'Today', ['page:home', 'page:favorites', 'page:todo']],
      ['cleaning-team', 'Cleaning team', ['area:cleans=Cleans', 'area:all']],
      ['calendar-messages', 'Calendar & messages', ['page:calendar', 'page:inbox']],
      ['cleaning-desk', 'Cleaning desk', ['tool:schedule', 'tool:review', 'tool:disputes', 'tool:unassigned', 'tool:cleaners', 'tool:setups', 'tool:invoices', 'tool:restock']],
      ['more', 'More', ['page:analytics', 'page:properties', 'page:decisions', 'tool:training', 'page:help=Help']],
      ['start', 'Start something', ['start']],
    ],
  },
  ready: {
    title: 'Ready', tagline: 'Repairs, visits and purchases', icon: 'tool', groups: [
      ['today', 'Today', ['page:home', 'page:favorites', 'page:todo']],
      ['jobs', 'Jobs', ['area:repairs=All maintenance', 'area:all']],
      ['calendar-messages', 'Calendar & messages', ['page:calendar', 'page:inbox']],
      ['ready-desk', 'Ready desk', ['tool:pipeline', 'tool:visits', 'tool:inspections', 'tool:purchases', 'tool:furnishing']],
      ['more', 'More', ['page:analytics', 'page:properties', 'page:decisions', 'tool:training', 'page:help=Help']],
      ['start', 'Start something', ['start']],
    ],
  },
  accounts: {
    title: 'Accounts', tagline: 'Invoices, payouts and statements', icon: 'pie-chart', groups: [
      ['overview', 'Overview', ['page:home', 'page:favorites', 'page:todo']],
      ['accounts', 'Accounts', ['area:accounts=Accounts desk', 'area:all']],
      ['calendar-messages', 'Calendar & messages', ['page:calendar', 'page:inbox']],
      ['money', 'Money', ['tool:expenses', 'tool:payouts', 'page:statements', 'same:statements', 'tool:invoices']],
      ['costs', 'Costs', ['tool:purchases', 'tool:cleaner-invoices', 'tool:budget', 'tool:restock']],
      ['more', 'More', ['page:analytics', 'page:decisions', 'tool:training', 'page:help=Tools & help']],
      ['start', 'Start something', ['start']],
    ],
  },
  client: {
    title: 'Owner', tagline: 'Your properties, stays and earnings', icon: 'home', groups: [
      ['your-properties', 'Your properties', ['page:home', 'page:favorites', 'page:properties=My properties', 'page:approvals', 'page:analytics=Portfolio', 'page:inbox']],
      ['requests', 'Requests', ['area:repairs=Repairs', 'area:all=All requests', 'tool:mailbox', 'tool:furnishing']],
      ['more', 'More', ['page:help=Tools & help']],
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
    const [ref, label] = spec.split('=');
    const [kind, name] = ref.split(':');
    const link = kind === 'page' ? page(name as Page, label) : kind === 'area' ? area(name as WorkView, label)
      : (() => { const t = tools.find(x => x.key === name); return t ? fromTool(t, label) : null; })();
    return link ? [link] : [];
  };
  const groups: PanelGroup[] = spec.groups.map(([key, title, specs]) => ({
    key, title, links: specs.flatMap(resolve).filter(link => !used.has(link.key) && !!used.add(link.key)),
  }));
  // Anything the role has that the layout does not place yet still gets a place, under More.
  const rest = [...views.map(v => area(v)), ...tools.map(t => fromTool(t))].filter((l): l is PanelLink => !!l && !used.has(l.key) && !!used.add(l.key));
  if (rest.length) {
    const more = groups.find(g => g.key === 'more');
    if (more) more.links.push(...rest); else groups.push({ key: 'more', title: 'More', links: rest });
  }
  return applyMenuLayout({ title: spec.title, tagline: spec.tagline, icon: spec.icon, groups: groups.filter(g => g.links.length) }, layout, keepEmpty);
}
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
