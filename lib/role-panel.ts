import { homeActionsFor, homeToolsFor, type HomeTool, type HomeToolTarget, type ToolArt } from './home-tools';
import { WORK_VIEW_LABEL, workViewsFor, type WorkView } from './tool-directory';
import type { WorkspaceSection } from './workspace-map';

// The desktop left panel for each role. Every role gets its own point of view: its own heading,
// its own groups in its own words, and its everyday tools one click away, so a cleaner's panel
// looks nothing like Accounts' or a super admin's. View as uses the same panel for the role being
// viewed, so the super admin sees exactly that role's panel and none of their own tools.
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

type Page = 'home' | 'favorites' | 'properties' | 'analytics' | 'activity' | 'inbox' | 'help' | 'approvals' | 'statements';
const PAGE: Record<Page, [string, PanelIcon]> = {
  home: ['Home', 'home'], favorites: ['Favorites', 'star'], properties: ['Properties', 'key'], analytics: ['Reports', 'bar-chart-2'],
  activity: ['Updates', 'bell'], inbox: ['Messages', 'message-circle'], help: ['Help & training', 'help-circle'],
  approvals: ['Approvals', 'check-circle'], statements: ['Owner statements', 'pie-chart'],
};
const AREA_ICON: Record<WorkView, PanelIcon> = {
  management: 'briefcase', hub: 'layers', calendar: 'calendar', stays: 'moon', cleans: 'check-square', repairs: 'tool', accounts: 'pie-chart', all: 'list',
};
const ART_ICON: Record<ToolArt, PanelIcon> = {
  house: 'home', building: 'briefcase', hardhat: 'tool', spray: 'droplet', people: 'users', coins: 'dollar-sign', clipboard: 'clipboard',
  hourglass: 'clock', medal: 'award', key: 'key', chart: 'file-text', toolbox: 'tool', calendar: 'calendar', chat: 'message-square',
  compass: 'compass', sun: 'sun', tag: 'tag', relist: 'refresh-cw', signature: 'edit-3', shield: 'shield', box: 'package', bell: 'bell',
  receipt: 'file-text', wallet: 'credit-card', pie: 'pie-chart', cart: 'shopping-cart', sofa: 'grid', search: 'search', mail: 'mail', star: 'book-open',
};

// page:<page>[=label], area:<view>[=label], tool:<home tool key>[=label], start (the role's "start something" forms),
// same:<home tool key> (a tool another link in the panel already opens).
type Layout = { title: string; tagline: string; icon: PanelIcon; groups: [string, string[]][] };
const MANAGEMENT_GROUPS: [string, string[]][] = [
  ['Overview', ['page:home', 'page:favorites', 'tool:queue', 'page:inbox', 'page:analytics', 'page:activity']],
  ['Departments', ['area:stays', 'area:cleans', 'area:repairs', 'area:accounts']],
  ['Management', ['area:management=Management centre', 'tool:people', 'tool:performance', 'tool:access', 'tool:training']],
  ['Planning', ['area:hub', 'area:calendar', 'page:properties', 'page:statements', 'area:all']],
  ['Start something', ['start']],
];
const LAYOUTS: Record<string, Layout> = {
  super_admin: { title: 'Super admin', tagline: 'The whole business, its people and access', icon: 'shield', groups: MANAGEMENT_GROUPS },
  admin: { title: 'Management', tagline: 'Every team, property and decision', icon: 'briefcase', groups: MANAGEMENT_GROUPS },
  stays: {
    title: 'Stays', tagline: 'Guests, listings and bookings', icon: 'moon', groups: [
      ['Today', ['page:home', 'tool:inbox', 'tool:checks', 'tool:pricing', 'tool:signoff']],
      ['Guests & listings', ['area:stays=Stays', 'tool:bookings', 'tool:aircover', 'page:properties']],
      ['Operations', ['area:cleans', 'area:repairs=Reactive maintenance', 'area:hub', 'area:calendar', 'area:all']],
      ['Team', ['page:favorites', 'page:inbox', 'page:analytics', 'page:activity', 'tool:training']],
      ['Start something', ['start']],
    ],
  },
  cleans: {
    title: 'Cleaning', tagline: 'Your cleans, checklists and pay', icon: 'check-square', groups: [
      ['My day', ['page:home', 'tool:today', 'tool:respond', 'area:calendar=My calendar']],
      ['My work', ['area:cleans=All my cleans', 'page:properties', 'area:hub', 'area:all', 'page:favorites']],
      ['Me', ['tool:month', 'tool:restock', 'page:inbox', 'page:activity', 'tool:training', 'page:help=Help']],
    ],
  },
  cleaning_manager: {
    title: 'Cleaning team', tagline: 'Schedule, reviews and cleaners', icon: 'users', groups: [
      ['Today', ['page:home', 'tool:schedule', 'tool:review', 'tool:disputes', 'tool:unassigned']],
      ['Cleaning team', ['area:cleans=Cleans', 'tool:cleaners', 'tool:setups', 'tool:invoices', 'tool:restock']],
      ['Planning', ['area:hub', 'area:calendar', 'page:properties', 'area:all', 'page:favorites']],
      ['More', ['page:inbox', 'page:activity', 'tool:training', 'page:help=Help']],
      ['Start something', ['start']],
    ],
  },
  ready: {
    title: 'Ready', tagline: 'Repairs, visits and purchases', icon: 'tool', groups: [
      ['Today', ['page:home', 'tool:pipeline', 'tool:visits', 'area:calendar']],
      ['Jobs', ['area:repairs=All maintenance', 'tool:inspections', 'tool:purchases', 'tool:furnishing']],
      ['Planning', ['area:hub', 'area:all', 'page:properties', 'page:favorites']],
      ['More', ['page:inbox', 'page:activity', 'tool:training', 'page:help=Help']],
      ['Start something', ['start']],
    ],
  },
  accounts: {
    title: 'Accounts', tagline: 'Invoices, payouts and statements', icon: 'pie-chart', groups: [
      ['Overview', ['page:home', 'area:accounts=Accounts desk', 'page:favorites', 'page:inbox']],
      ['Money', ['tool:expenses', 'tool:payouts', 'page:statements', 'same:statements', 'tool:invoices']],
      ['Costs', ['tool:purchases', 'tool:cleaner-invoices', 'tool:budget', 'tool:restock']],
      ['Planning', ['area:hub', 'area:calendar', 'area:all']],
      ['More', ['page:activity', 'tool:training', 'page:help=Tools & help']],
      ['Start something', ['start']],
    ],
  },
  client: {
    title: 'Owner', tagline: 'Your properties, stays and earnings', icon: 'home', groups: [
      ['Your properties', ['page:home', 'page:properties=My properties', 'page:approvals', 'page:analytics=Stays & statements', 'page:inbox']],
      ['Requests', ['area:repairs=Repairs', 'area:all=All requests', 'tool:mailbox', 'tool:furnishing']],
      ['More', ['page:activity', 'page:help=Tools & help']],
      ['Start something', ['start']],
    ],
  },
};
// Pages only some roles have (the workspace refuses the others).
const PAGE_ROLES: Partial<Record<Page, string[]>> = {
  favorites: ['super_admin', 'admin', 'stays', 'cleans', 'cleaning_manager', 'ready', 'accounts'],
  approvals: ['client'], statements: ['accounts', 'admin', 'super_admin'],
};

// A Home tool that opens a Work area at its top is that area. (Tools kept in All work, such as
// Inspections or Purchases, stay tools of their own.)
const plainArea = (target: HomeToolTarget): WorkView | null =>
  target.kind === 'work' && target.view !== 'all' && !target.sub && !target.anchor && !target.open && !target.workId ? target.view : null;

export function rolePanel(role: string, modules: readonly string[]): RolePanel {
  const layout = LAYOUTS[role];
  if (!layout) return { title: role, tagline: '', icon: 'user', groups: [] };
  const views = workViewsFor(role), tools = homeToolsFor(role, modules), actions = homeActionsFor(role, modules);
  const used = new Set<string>();
  const area = (view: WorkView, label?: string): PanelLink | null =>
    views.includes(view) ? { key: 'area:' + view, kind: 'area', label: label ?? WORK_VIEW_LABEL[view], icon: AREA_ICON[view], view } : null;
  const fromTool = (t: HomeTool, label?: string): PanelLink | null => {
    const view = plainArea(t.target);
    if (view) return area(view, label ?? t.label);
    if (t.target.kind === 'tab' && !t.target.anchor) return page(t.target.tab, label ?? t.label);
    return { key: 'tool:' + t.key, kind: 'tool', label: label ?? t.label, icon: ART_ICON[t.art], target: t.target };
  };
  const page = (name: Page, label?: string): PanelLink | null =>
    PAGE_ROLES[name] && !PAGE_ROLES[name]!.includes(role) ? null : { key: 'page:' + name, kind: 'page', label: label ?? PAGE[name][0], icon: PAGE[name][1], section: name };
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
