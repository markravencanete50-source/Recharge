import { homeToolsFor, panelToolsFor, startActionsFor, type HomeTool, type HomeToolTarget, type ToolArt } from './home-tools';
import { WORK_VIEW_LABEL, workViewsFor, type WorkView } from './tool-directory';
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
export type PanelGroup = { title: string; links: PanelLink[] };
export type RolePanel = { title: string; tagline: string; icon: PanelIcon; groups: PanelGroup[] };

type Page = 'home' | 'todo' | 'calendar' | 'decisions' | 'favorites' | 'properties' | 'analytics' | 'inbox' | 'help' | 'approvals' | 'statements' | 'enquiries' | 'feedback' | 'moderation';
const PAGE: Record<Page, [string, PanelIcon]> = {
  home: ['Home', 'home'], todo: ['To-do', 'clipboard'], calendar: ['Calendar', 'calendar'], decisions: ['My requests', 'check-circle'],
  favorites: ['Favorites', 'star'], properties: ['Properties', 'key'], analytics: ['Reports', 'bar-chart-2'],
  inbox: ['Messages', 'message-circle'], help: ['Help & training', 'help-circle'],
  approvals: ['Approvals', 'check-circle'], statements: ['Owner statements', 'pie-chart'], enquiries: ['Client enquiries', 'mail'],
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
const TOOL_ICON: Record<string, PanelIcon> = { productivity: 'activity', performance: 'award', month: 'trending-up' };

// The colour of each link's icon tile: departments in their own colours, everything else in one of
// the panel hues (lib/design-tokens.ts navHueTokens), so similar places look alike across roles.
export type PanelHue = 'forest' | 'ocean' | 'plum' | 'amber' | 'rose' | 'sky' | 'sage' | 'slate' | 'stays' | 'cleans' | 'ready' | 'accounts' | 'clients';
const AREA_HUE: Record<WorkView, PanelHue> = { management: 'forest', hub: 'sky', calendar: 'ocean', stays: 'stays', clients: 'clients', cleans: 'cleans', repairs: 'ready', accounts: 'accounts', all: 'slate' };
const KEY_HUE: Record<string, PanelHue> = {
  'page:home': 'forest', 'page:todo': 'sage', 'page:calendar': 'ocean', 'page:decisions': 'rose', 'page:favorites': 'amber', 'page:inbox': 'ocean', 'page:analytics': 'plum', 'page:help': 'slate',
  'page:properties': 'forest', 'page:approvals': 'rose', 'page:statements': 'accounts', 'page:enquiries': 'sky', 'page:feedback': 'plum', 'page:moderation': 'rose',
  'tool:queue': 'rose', 'tool:people': 'ocean', 'tool:productivity': 'sage', 'tool:performance': 'amber', 'tool:access': 'rose', 'tool:training': 'plum',
  'tool:inbox': 'ocean', 'tool:checks': 'sage', 'tool:pricing': 'amber', 'tool:signoff': 'plum', 'tool:bookings': 'ocean', 'tool:aircover': 'rose',
  'tool:today': 'forest', 'tool:respond': 'rose', 'tool:month': 'plum', 'tool:restock': 'amber', 'tool:schedule': 'ocean', 'tool:review': 'sage',
  'tool:disputes': 'rose', 'tool:unassigned': 'amber', 'tool:cleaners': 'plum', 'tool:setups': 'sky', 'tool:invoices': 'accounts', 'tool:pipeline': 'ocean',
  'tool:visits': 'sage', 'tool:inspections': 'sky', 'tool:purchases': 'amber', 'tool:furnishing': 'plum', 'tool:expenses': 'rose', 'tool:payouts': 'sage',
  'tool:budget': 'amber', 'tool:cleaner-invoices': 'cleans', 'tool:mailbox': 'ocean',
};
export const linkHue = (link: PanelLink): PanelHue =>
  link.kind === 'area' ? AREA_HUE[link.view] : link.kind === 'start' ? 'forest' : KEY_HUE[link.key] ?? 'slate';

// page:<page>[=label], area:<view>[=label], tool:<home tool key>[=label], start (the role's "start something" forms),
// same:<home tool key> (a tool another link in the panel already opens).
type Layout = { title: string; tagline: string; icon: PanelIcon; groups: [string, string[]][] };
const MANAGEMENT_GROUPS: [string, string[]][] = [
  ['Overview', ['page:home', 'page:todo']],
  ['Departments', ['area:management=Management centre', 'area:stays', 'area:clients', 'area:cleans', 'area:repairs', 'area:accounts', 'area:all']],
  ['Calendar & messages', ['page:calendar', 'page:inbox', 'page:decisions', 'same:queue']],
  ['Management', ['tool:people', 'tool:productivity', 'tool:performance', 'tool:access', 'page:moderation', 'tool:training']],
  ['More', ['tool:enquiries', 'page:analytics', 'page:favorites', 'page:properties', 'page:statements', 'page:feedback']],
  ['Start something', ['start']],
];
const LAYOUTS: Record<string, Layout> = {
  super_admin: { title: 'Super admin', tagline: 'The whole business, its people and access', icon: 'shield', groups: MANAGEMENT_GROUPS },
  admin: { title: 'Management', tagline: 'Every team, property and decision', icon: 'briefcase', groups: MANAGEMENT_GROUPS },
  stays: {
    title: 'Guest relations', tagline: 'Guests, listings and bookings', icon: 'moon', groups: [
      ['Today', ['page:home', 'page:todo']],
      ['Work', ['area:stays', 'area:clients', 'area:cleans', 'area:repairs=Reactive maintenance', 'area:all']],
      ['Calendar & messages', ['page:calendar', 'page:inbox']],
      ['Guests & listings', ['tool:enquiries', 'tool:bookings', 'tool:aircover', 'tool:licensing', 'tool:checks', 'tool:pricing', 'page:properties']],
      ['More', ['page:analytics', 'page:decisions', 'page:favorites', 'tool:training', 'page:feedback=Send feedback']],
      ['Start something', ['start']],
    ],
  },
  cleans: {
    title: 'Cleaning', tagline: 'Your cleans, checklists and pay', icon: 'check-square', groups: [
      ['My day', ['page:home', 'page:todo']],
      ['My work', ['area:cleans=All my cleans', 'area:all']],
      ['Calendar & messages', ['page:calendar=My calendar', 'page:inbox']],
      ['Me', ['tool:today', 'tool:respond', 'tool:month', 'page:analytics', 'tool:restock']],
      ['More', ['page:properties', 'page:decisions', 'page:favorites', 'tool:training', 'page:help=Help']],
    ],
  },
  cleaning_manager: {
    title: 'Cleaning team', tagline: 'Schedule, reviews and cleaners', icon: 'users', groups: [
      ['Today', ['page:home', 'page:todo']],
      ['Cleaning team', ['area:cleans=Cleans', 'area:all']],
      ['Calendar & messages', ['page:calendar', 'page:inbox']],
      ['Cleaning desk', ['tool:schedule', 'tool:review', 'tool:disputes', 'tool:unassigned', 'tool:cleaners', 'tool:setups', 'tool:invoices', 'tool:restock']],
      ['More', ['page:analytics', 'page:properties', 'page:decisions', 'page:favorites', 'tool:training', 'page:help=Help']],
      ['Start something', ['start']],
    ],
  },
  ready: {
    title: 'Ready', tagline: 'Repairs, visits and purchases', icon: 'tool', groups: [
      ['Today', ['page:home', 'page:todo']],
      ['Jobs', ['area:repairs=All maintenance', 'area:all']],
      ['Calendar & messages', ['page:calendar', 'page:inbox']],
      ['Ready desk', ['tool:pipeline', 'tool:visits', 'tool:inspections', 'tool:purchases', 'tool:furnishing']],
      ['More', ['page:analytics', 'page:properties', 'page:decisions', 'page:favorites', 'tool:training', 'page:help=Help']],
      ['Start something', ['start']],
    ],
  },
  accounts: {
    title: 'Accounts', tagline: 'Invoices, payouts and statements', icon: 'pie-chart', groups: [
      ['Overview', ['page:home', 'page:todo']],
      ['Accounts', ['area:accounts=Accounts desk', 'area:all']],
      ['Calendar & messages', ['page:calendar', 'page:inbox']],
      ['Money', ['tool:expenses', 'tool:payouts', 'page:statements', 'same:statements', 'tool:invoices']],
      ['Costs', ['tool:purchases', 'tool:cleaner-invoices', 'tool:budget', 'tool:restock']],
      ['More', ['page:analytics', 'page:decisions', 'page:favorites', 'tool:training', 'page:help=Tools & help']],
      ['Start something', ['start']],
    ],
  },
  client: {
    title: 'Owner', tagline: 'Your properties, stays and earnings', icon: 'home', groups: [
      ['Your properties', ['page:home', 'page:properties=My properties', 'page:approvals', 'page:analytics=Stays & statements', 'page:inbox']],
      ['Requests', ['area:repairs=Repairs', 'area:all=All requests', 'tool:mailbox', 'tool:furnishing']],
      ['More', ['page:help=Tools & help']],
      ['Start something', ['start']],
    ],
  },
};
// Pages only some roles have (the workspace refuses the others).
const TEAM = ['super_admin', 'admin', 'stays', 'cleans', 'cleaning_manager', 'ready', 'accounts'];
const PAGE_ROLES: Partial<Record<Page, string[]>> = {
  favorites: TEAM, todo: TEAM, calendar: TEAM, decisions: TEAM,
  approvals: ['client'], statements: ['accounts', 'admin', 'super_admin'], enquiries: ['admin', 'super_admin', 'stays'],
  feedback: ['admin', 'super_admin', 'stays'], moderation: ['admin', 'super_admin'],
};

// A Home tool that opens a Work area at its top is that area. (Tools kept in All work, such as
// Inspections or Purchases, stay tools of their own.)
const plainArea = (target: HomeToolTarget): WorkView | null =>
  target.kind === 'work' && target.view !== 'all' && !target.sub && !target.anchor && !target.open && !target.workId ? target.view : null;

export function rolePanel(role: string, modules: readonly string[]): RolePanel {
  const layout = LAYOUTS[role];
  if (!layout) return { title: role, tagline: '', icon: 'user', groups: [] };
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
  const groups: PanelGroup[] = layout.groups.map(([title, specs]) => ({
    title, links: specs.flatMap(resolve).filter(link => !used.has(link.key) && !!used.add(link.key)),
  }));
  // Anything the role has that the layout does not place yet still gets a place, under More.
  const rest = [...views.map(v => area(v)), ...tools.map(t => fromTool(t))].filter((l): l is PanelLink => !!l && !used.has(l.key) && !!used.add(l.key));
  if (rest.length) {
    const more = groups.find(g => g.title === 'More');
    if (more) more.links.push(...rest); else groups.push({ title: 'More', links: rest });
  }
  return { title: layout.title, tagline: layout.tagline, icon: layout.icon, groups: groups.filter(g => g.links.length) };
}
