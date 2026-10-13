import { normalise } from './search-options';
import { homeToolsFor, MODULE_ART, panelToolsFor, startActionsFor, type HomeToolTarget, type ToolArt } from './home-tools';
import { toolsFor, workViewsFor, WORK_VIEW_LABEL, type ToolPlace, type WorkView } from './tool-directory';
import { formatMoney } from './format';
import { WORK_SUBS, type WorkspaceSection } from './workspace-map';
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

// Other words people use for the same place, so "chat", "money" or "fix" still find it. (No WhatsApp:
// all communication is in Messages. Old links to Updates open Messages.)
const ALSO: Record<string, string> = {
  'section:home': 'dashboard start today overview clock in clock out reflection schedule',
  'section:todo': 'todo to-do to do tasks daily checks reminders personal list team tasks reflection',
  'section:calendar': 'calendar schedule dates diary bookings team calendar rota changeovers absence meetings away',
  'section:decisions': 'approvals decisions flags flagged requests management attention ask management my requests',
  'section:inbox': 'messages chat conversations departments channels updates notifications activity guest inbox guests email',
  'section:analytics': 'reports analytics numbers occupancy revenue trends my performance bonus tier score replies',
  'section:help': 'help training guides faq all tools directory',
  'section:favorites': 'favourites favorites saved starred pinned shortcuts',
  'section:feedback': 'feedback suggestions ideas problems complaints praise tell super admin',
  'section:moderation': 'reported messages reports moderation abuse abusive offensive harassment spam remove block flag chat',
  'section:properties': 'properties listings houses flats portfolio map',
  'section:statements': 'owner statements payouts money',
  'view:management': 'approvals decisions people performance queue management centre',
  'view:stays': 'guest relations guests bookings direct bookings aircover reactive preventative changeovers',
  'view:clients': 'client relations onboarding enquiries licensing listing health pricing reviews relisting purchase orders owners',
  'view:cleans': 'cleans cleaning cleaners housekeeping turnover',
  'view:repairs': 'maintenance repairs fix broken ready preventative',
  'view:accounts': 'accounts money finance expenses payouts statements invoices',
  'view:all': 'all work tasks everything',
  'tool:queue': 'approvals flags decisions waiting',
  'tool:performance': 'reflection end of day shifts replies sign-offs rota',
  'tool:productivity': 'timesheets rota hours clock in clock out',
};
const SUB_ART: Record<string, ToolArt> = {
  cleans: 'spray', bookings: 'calendar', aircover: 'shield', reactive: 'toolbox', preventative: 'sun', onboarding: 'key', enquiries: 'mail',
  licensing: 'signature', listings: 'clipboard', pricing: 'tag', reviews: 'star', relisting: 'relist', purchases: 'cart',
};

function pages(role: string): SearchEntry[] {
  const page = (section: WorkspaceSection, label: string, detail: string, art: ToolArt): SearchEntry => ({ key: 'section:' + section, label, detail, group: 'Pages', art, target: { kind: 'section', section } });
  const team = role !== 'client', admin = role === 'admin' || role === 'super_admin';
  const work = role === 'cleans' || role === 'cleaning_manager' ? 'Cleans' : role === 'ready' ? 'Maintenance' : role === 'accounts' ? 'Invoices' : role === 'client' ? 'Repairs and requests' : 'Work';
  return [
    page('home', 'Home', 'Your day at a glance', 'house'),
    ...(team ? [page('todo', 'To-do', 'Daily tasks and your own list', 'clipboard')] : []),
    page('work', work, 'Everything to do', 'clipboard'),
    ...(team ? [page('calendar', 'Calendar', 'Team calendar, changeovers and rota', 'calendar')] : []),
    ...(role !== 'accounts' ? [page('properties', role === 'client' ? 'My properties' : 'Properties', 'Every property and the map', 'building')] : []),
    page('analytics', admin || role === 'client' ? 'Reports' : 'My performance', role === 'client' ? 'Stays, earnings and statements' : admin ? 'Trends and exports' : 'Your replies, tasks, time and bonus tier', 'chart'),
    ...(['admin', 'super_admin', 'accounts'].includes(role) ? [page('statements', 'Owner statements', 'Draft, issue and settle', 'pie')] : []),
    ...(role === 'client' ? [page('approvals', 'Approvals', 'Costs and steps to decide', 'hourglass')] : []),
    page('inbox', 'Messages', team ? 'Guests, owners, team and updates' : 'Your property team', 'chat'),
    ...(team ? [page('decisions', admin ? 'Management approvals' : 'My requests', admin ? 'Flags and requests waiting for a decision' : 'Ask management and see what you flagged', 'hourglass')] : []),
    ...(role === 'super_admin' ? [page('feedback', 'Feedback', 'What the team has told you', 'chat')] : ['admin', 'stays'].includes(role) ? [page('feedback', 'Send feedback', 'Ideas, problems and praise for the super admin', 'chat')] : []),
    ...(admin ? [page('moderation', 'Reported messages', 'Messages people have reported: remove or dismiss', 'chat')] : []),
    page('favorites', 'Favorites', 'Your saved places', 'star'),
    page('help', 'Help and all tools', 'Guides, training and every tool', 'compass'),
  ];
}
function placeTarget(place: ToolPlace, module: string): HomeToolTarget | null {
  if (place.kind === 'work') return { kind: 'work', view: place.view, ...(place.sub ? { sub: place.sub } : {}) };
  if (place.kind === 'tracker') return { kind: 'tracker', module: module as never };
  if (place.kind === 'calculator') return { kind: 'calculator' };
  return place.tab === 'home' ? null : { kind: 'tab', tab: place.tab };
}

const withWords = (e: SearchEntry, extra: Map<string, string>): SearchEntry => extra.has(e.key) ? { ...e, keywords: [e.keywords, extra.get(e.key)].filter(Boolean).join(' ') } : e;

export function buildSearchIndex({ role, modules, properties, work = [], invoices = [] }: Source): SearchEntry[] {
  const names = new Map(properties.map(p => [p.id, p.name]));
  // Calendar is a page of its own now, so it is not listed again as a Work area.
  const views: SearchEntry[] = workViewsFor(role).filter(view => view !== 'calendar').map((view: WorkView) => ({
    key: 'view:' + view, label: WORK_VIEW_LABEL[view], detail: 'Work → ' + WORK_VIEW_LABEL[view], group: 'Pages',
    art: view === 'cleans' ? 'spray' : view === 'repairs' ? 'toolbox' : view === 'accounts' ? 'coins' : view === 'stays' ? 'building' : view === 'clients' ? 'key' : view === 'management' ? 'hourglass' : 'clipboard',
    target: { kind: 'tool', target: { kind: 'work', view } },
  }));
  const tools: SearchEntry[] = [...homeToolsFor(role, modules), ...panelToolsFor(role, modules)].map(t => ({ key: 'tool:' + t.key, label: t.label, detail: t.detail, group: 'Tools', art: t.art, target: { kind: 'tool', target: t.target } }));
  const moduleTools: SearchEntry[] = toolsFor(role, modules).flatMap(t => {
    const target = placeTarget(t.place, t.id);
    return target ? [{ key: 'module:' + t.id, label: t.name, detail: t.place.where, group: 'Tools' as const, art: MODULE_ART[t.id], keywords: t.description, target: { kind: 'tool' as const, target } }] : [];
  });
  const actions: SearchEntry[] = startActionsFor(role, modules).map(a => ({ key: 'action:' + a.key, label: a.label, detail: 'Opens the form straight away', group: 'Quick actions', art: a.icon === 'repeat' ? 'sun' : a.icon === 'alert-triangle' ? 'toolbox' : 'clipboard', target: { kind: 'tool', target: a.target } }));
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
  // The sub-pages of Guest relations and Client relations. One that a Home tool or a tool already opens
  // gives that entry its words instead of appearing twice.
  const opened = new Map<string, string[]>();
  for (const e of [...tools, ...moduleTools]) opened.set(JSON.stringify(e.target), [...(opened.get(JSON.stringify(e.target)) ?? []), e.key]);
  const roleViews = workViewsFor(role);
  const subWords = new Map<string, string>();
  const subs: SearchEntry[] = WORK_SUBS.filter(x => roleViews.includes(x.view)).flatMap(x => {
    const target: SearchTarget = { kind: 'tool', target: { kind: 'work', view: x.view, sub: x.sub } };
    const owners = opened.get(JSON.stringify(target));
    if (owners) { for (const owner of owners) subWords.set(owner, [subWords.get(owner), x.words].filter(Boolean).join(' ')); return []; }
    return [{ key: `sub:${x.view}:${x.sub}`, label: x.label, detail: `Work → ${WORK_VIEW_LABEL[x.view]} → ${x.label}`, group: 'Pages' as const, art: SUB_ART[x.sub] ?? 'clipboard', keywords: x.words, target }];
  });
  // One entry per key: a Home tool and the same place under another name both stay findable.
  const seen = new Set<string>();
  return [...pages(role), ...views, ...subs, ...tools.map(e => withWords(e, subWords)), ...moduleTools.map(e => withWords(e, subWords)), ...actions, ...places, ...tasks, ...bills]
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
