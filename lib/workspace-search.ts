import { normalise } from './search-options';
import { homeActionsFor, homeToolsFor, MODULE_ART, panelToolsFor, type HomeToolTarget, type ToolArt } from './home-tools';
import { toolsFor, workViewsFor, WORK_VIEW_LABEL, type ToolPlace, type WorkView } from './tool-directory';
import { formatMoney } from './format';
import type { WorkspaceSection } from './workspace-map';
import type { FavoriteItem } from './workspace-teams-policy';

// One search for the whole workspace: pages, tools, quick actions, properties, work and invoices,
// all from what the app has already loaded for this person (so it only ever finds what they can
// open). Anything found can be saved to Favorites by its key.
export type SearchTarget =
  | { kind: 'section'; section: WorkspaceSection }
  | { kind: 'tool'; target: HomeToolTarget }
  | { kind: 'property'; propertyId: string }
  | { kind: 'work'; workId: string }
  | { kind: 'invoice'; invoiceId: string };
export const SEARCH_GROUPS = ['Pages', 'Tools', 'Quick actions', 'Properties', 'Work', 'Invoices'] as const;
export type SearchGroup = typeof SEARCH_GROUPS[number];
export type SearchEntry = { key: string; label: string; detail: string; group: SearchGroup; art: ToolArt; keywords?: string; target: SearchTarget };

type Source = {
  role: string; modules: readonly string[];
  properties: readonly { id: string; name: string; address?: string | null; region?: string | null; status?: string }[];
  work?: readonly { workId: string; title: string; propertyId: string; status: string; kind?: string }[];
  invoices?: readonly { id: string; property_id: string; reference: string; amount_minor: number; currency: string; status: string }[];
};

const readable = (s: string) => s.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const closed = (status: string) => ['completed', 'cancelled', 'paid', 'done', 'closed', 'resolved', 'archived'].includes(status);

// Other words people use for the same place, so "chat", "money" or "fix" still find it.
const ALSO: Record<string, string> = {
  'section:home': 'dashboard start today overview',
  'section:inbox': 'messages chat conversations whatsapp departments channels',
  'section:analytics': 'reports analytics numbers occupancy revenue trends',
  'section:activity': 'updates notifications activity history',
  'section:help': 'help training guides faq all tools directory',
  'section:favorites': 'favourites favorites saved starred pinned shortcuts',
  'section:feedback': 'feedback suggestions ideas problems complaints praise tell super admin',
  'section:moderation': 'reported messages reports moderation abuse abusive offensive harassment spam remove block flag chat',
  'section:properties': 'properties listings houses flats portfolio map',
  'section:statements': 'owner statements payouts money',
  'view:management': 'approvals decisions people performance queue',
  'view:hub': 'to do todo tasks trackers approvals aircover invoices onboarding rota responsibilities timesheets',
  'view:calendar': 'calendar schedule dates diary bookings',
  'view:stays': 'stays guests bookings listings pricing',
  'view:cleans': 'cleans cleaning cleaners housekeeping turnover',
  'view:repairs': 'maintenance repairs fix broken ready preventative',
  'view:accounts': 'accounts money finance expenses payouts statements invoices',
  'view:all': 'all work tasks everything',
};

function pages(role: string): SearchEntry[] {
  const page = (section: WorkspaceSection, label: string, detail: string, art: ToolArt): SearchEntry => ({ key: 'section:' + section, label, detail, group: 'Pages', art, target: { kind: 'section', section } });
  const team = role !== 'client';
  const work = role === 'cleans' || role === 'cleaning_manager' ? 'Cleans' : role === 'ready' ? 'Maintenance' : role === 'accounts' ? 'Invoices' : role === 'client' ? 'Repairs and requests' : 'Work';
  return [
    page('home', 'Home', 'Your day at a glance', 'house'),
    page('work', work, 'Everything to do', 'clipboard'),
    ...(role !== 'accounts' ? [page('properties', role === 'client' ? 'My properties' : 'Properties', 'Every property and the map', 'building')] : []),
    ...(['admin', 'super_admin', 'stays', 'client'].includes(role) ? [page('analytics', 'Reports', role === 'client' ? 'Stays, earnings and statements' : 'Trends and exports', 'chart')] : []),
    ...(['admin', 'super_admin', 'accounts'].includes(role) ? [page('statements', 'Owner statements', 'Draft, issue and settle', 'pie')] : []),
    ...(role === 'client' ? [page('approvals', 'Approvals', 'Costs and steps to decide', 'hourglass')] : []),
    page('inbox', 'Messages', team ? 'Departments, owners and guests' : 'Your property team', 'chat'),
    page('activity', 'Activity', 'Recent updates', 'bell'),
    ...(role === 'super_admin' ? [page('feedback', 'Feedback', 'What the team has told you', 'chat')] : ['admin', 'stays'].includes(role) ? [page('feedback', 'Send feedback', 'Ideas, problems and praise for the super admin', 'chat')] : []),
    ...(['admin', 'super_admin'].includes(role) ? [page('moderation', 'Reported messages', 'Messages people have reported: remove or dismiss', 'chat')] : []),
    ...(team ? [page('favorites', 'Favorites', 'Your saved places', 'star')] : []),
    page('help', 'Help and all tools', 'Guides, training and every tool', 'compass'),
  ];
}
function placeTarget(place: ToolPlace, module: string): HomeToolTarget | null {
  if (place.kind === 'work') return { kind: 'work', view: place.view };
  if (place.kind === 'tracker') return { kind: 'tracker', module: module as never };
  if (place.kind === 'calculator') return { kind: 'calculator' };
  return place.tab === 'home' ? null : { kind: 'tab', tab: place.tab };
}

export function buildSearchIndex({ role, modules, properties, work = [], invoices = [] }: Source): SearchEntry[] {
  const names = new Map(properties.map(p => [p.id, p.name]));
  const views: SearchEntry[] = workViewsFor(role).map((view: WorkView) => ({
    key: 'view:' + view, label: WORK_VIEW_LABEL[view], detail: 'Work → ' + WORK_VIEW_LABEL[view], group: 'Pages',
    art: view === 'cleans' ? 'spray' : view === 'repairs' ? 'toolbox' : view === 'accounts' ? 'coins' : view === 'calendar' ? 'calendar' : view === 'stays' ? 'building' : view === 'management' ? 'hourglass' : 'clipboard',
    target: { kind: 'tool', target: { kind: 'work', view } },
  }));
  const tools: SearchEntry[] = [...homeToolsFor(role, modules), ...panelToolsFor(role, modules)].map(t => ({ key: 'tool:' + t.key, label: t.label, detail: t.detail, group: 'Tools', art: t.art, target: { kind: 'tool', target: t.target } }));
  const moduleTools: SearchEntry[] = toolsFor(role, modules).flatMap(t => {
    const target = placeTarget(t.place, t.id);
    return target ? [{ key: 'module:' + t.id, label: t.name, detail: t.place.where, group: 'Tools' as const, art: MODULE_ART[t.id], keywords: t.description, target: { kind: 'tool' as const, target } }] : [];
  });
  const actions: SearchEntry[] = homeActionsFor(role, modules).map(a => ({ key: 'action:' + a.key, label: a.label, detail: 'Opens the form straight away', group: 'Quick actions', art: a.icon === 'repeat' ? 'sun' : a.icon === 'alert-triangle' ? 'toolbox' : 'clipboard', target: { kind: 'tool', target: a.target } }));
  const places: SearchEntry[] = role === 'accounts' ? [] : properties.map(p => ({
    key: 'property:' + p.id, label: p.name, detail: [p.address, p.region].filter(Boolean).join(' · ') || 'Property', group: 'Properties', art: 'house',
    keywords: p.status ? readable(p.status) : undefined, target: { kind: 'property', propertyId: p.id },
  }));
  // Open work first, then the most recently closed.
  const tasks: SearchEntry[] = [...work].sort((a, b) => Number(closed(a.status)) - Number(closed(b.status))).map(w => ({
    key: 'work:' + w.workId, label: w.title, detail: [names.get(w.propertyId), readable(w.status)].filter(Boolean).join(' · '), group: 'Work', art: 'clipboard',
    keywords: w.kind ? readable(w.kind) : undefined, target: { kind: 'work', workId: w.workId },
  }));
  const bills: SearchEntry[] = ['admin', 'super_admin', 'accounts'].includes(role) ? invoices.map(i => ({
    key: 'invoice:' + i.id, label: i.reference, detail: [names.get(i.property_id), i.currency === 'GBP' ? formatMoney(i.amount_minor) : `${i.currency} ${(i.amount_minor / 100).toFixed(2)}`, readable(i.status)].filter(Boolean).join(' · '),
    group: 'Invoices', art: 'receipt', target: { kind: 'invoice', invoiceId: i.id },
  })) : [];
  // One entry per key: a Home tool and the same place under another name both stay findable.
  const seen = new Set<string>();
  return [...pages(role), ...views, ...tools, ...moduleTools, ...actions, ...places, ...tasks, ...bills]
    .filter(e => (seen.has(e.key) ? false : (seen.add(e.key), true)))
    .map(e => ALSO[e.key] ? { ...e, keywords: [e.keywords, ALSO[e.key]].filter(Boolean).join(' ') } : e);
}

// Every word typed must appear in the name, the detail or the other words for it. Names that
// start with what was typed come first, then names with a word starting with it.
export function searchWorkspace(entries: readonly SearchEntry[], query: string, perGroup = 6) {
  const words = normalise(query).split(' ').filter(Boolean);
  if (!words.length) return { groups: [] as { group: SearchGroup; entries: SearchEntry[]; total: number }[], total: 0 };
  const phrase = words.join(' ');
  const scored = entries.flatMap((entry, index) => {
    const name = normalise(entry.label), all = name + ' ' + normalise(entry.detail) + ' ' + normalise(entry.keywords ?? '');
    if (!words.every(w => all.includes(w))) return [];
    const score = name === phrase ? 0 : name.startsWith(phrase) ? 1 : (' ' + name).includes(' ' + words[0]) ? 2 : words.every(w => name.includes(w)) ? 3 : 4;
    return [{ entry, score, index }];
  }).sort((a, b) => a.score - b.score || a.index - b.index);
  const groups = SEARCH_GROUPS.map(group => {
    const all = scored.filter(s => s.entry.group === group);
    return { group, entries: all.slice(0, perGroup).map(s => s.entry), total: all.length };
  }).filter(g => g.total);
  // The group holding the best match is shown first.
  const best = new Map(groups.map(g => [g.group, Math.min(...scored.filter(s => s.entry.group === g.group).map(s => s.score))]));
  groups.sort((a, b) => best.get(a.group)! - best.get(b.group)! || SEARCH_GROUPS.indexOf(a.group) - SEARCH_GROUPS.indexOf(b.group));
  return { groups, total: scored.length };
}

// Favorites: kept in the person's order, matched to what they can open now. Something that is no
// longer there (a closed job, a tool taken away) keeps its label so it can be removed.
export const MAX_FAVORITES = 40;
export function resolveFavorites(items: readonly FavoriteItem[], entries: readonly SearchEntry[]) {
  const byKey = new Map(entries.map(e => [e.key, e]));
  return items.map(item => ({ item, entry: byKey.get(item.key) ?? null }));
}
export function toggleFavorite(items: readonly FavoriteItem[], entry: { key: string; label: string }): FavoriteItem[] {
  if (items.some(i => i.key === entry.key)) return items.filter(i => i.key !== entry.key);
  return [...items, { key: entry.key, label: entry.label.trim().slice(0, 120) || 'Saved' }].slice(-MAX_FAVORITES);
}
export function moveFavorite(items: readonly FavoriteItem[], key: string, to: number): FavoriteItem[] {
  const from = items.findIndex(i => i.key === key);
  if (from < 0) return [...items];
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, Math.round(to))), 0, moved);
  return next;
}
// Places worth saving first, before someone has saved anything: their role's Home tools.
export function suggestedFavorites(entries: readonly SearchEntry[], items: readonly FavoriteItem[], limit = 6) {
  const saved = new Set(items.map(i => i.key));
  return entries.filter(e => e.key.startsWith('tool:') && !saved.has(e.key)).slice(0, limit);
}
