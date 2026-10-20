import { z } from 'zod';
import type { PanelGroup, PanelLink, RolePanel } from './role-panel';

// The menu order a super admin sets per role in Access control → Menu order (migration
// 20261015210000_menu_layouts.sql). It only ARRANGES: the sections and links a person gets still come
// from their role and tools (lib/role-panel.ts). The saved layout is applied on top:
//   * sections: the saved ones the role has, in the saved order; any other section goes straight after the section
//     before it in the default order (so a layout saved before a section existed, such as one saved for the menu
//     before Alex's sections of 20 October 2026, keeps the new sections in their default places);
//   * links: each section lists its links in order, and a link belongs to the section it is listed under, so
//     links can move between sections (Lee, round 5). A link listed under two sections stays in the first
//     (sections in the saved order, then any other listed sections);
//   * a link the layout does not list goes back to its default section, after the listed ones, in its
//     default order (a tool added later, for example);
//   * keys the role does not have, sections it does not have, and keys that no longer exist are ignored;
//   * a section left with no links is hidden in the app (the editor keeps it, so links can move back).
// The desktop left panel, the phone bar and the phone's More list are all built from the merged panel,
// so they always agree.

export const MENU_ROLES = ['super_admin', 'admin', 'stays', 'cleaning_manager', 'cleans', 'ready', 'accounts', 'client'] as const;
export type MenuRole = (typeof MENU_ROLES)[number];
export const MENU_ROLE_LABEL: Record<MenuRole, string> = {
  super_admin: 'Super admin', admin: 'Admin', stays: 'Guest relations', cleaning_manager: 'Cleaning manager', cleans: 'Cleaner',
  ready: 'Ready', accounts: 'Accounts', client: 'Owner',
};

// Stable keys only: lower-case letters, digits, ":", "-", "_" and "=" (a link key such as "tool:cleaner-invoices").
const key = z.string().min(1).max(80).regex(/^[a-z0-9:_=-]+$/);
export const menuLayoutSchema = z.object({
  sections: z.array(key).max(40),
  items: z.record(key, z.array(key).max(80)),
}).strict();
export type MenuLayout = z.infer<typeof menuLayoutSchema>;

// A stored layout as the database returns it, with who changed it last.
export const storedMenuLayoutSchema = z.object({
  role: z.enum(MENU_ROLES), sections: z.array(z.string()), items: z.record(z.string(), z.array(z.string())),
  version: z.number().int().min(0), updatedAt: z.string().nullable(), updatedByName: z.string().nullable(),
});
export type StoredMenuLayout = z.infer<typeof storedMenuLayoutSchema>;

// Reads a layout from anywhere (a read, an old save); anything unreadable is no layout.
export function parseMenuLayout(raw: unknown): MenuLayout | null {
  const parsed = menuLayoutSchema.safeParse(raw && typeof raw === 'object' ? { sections: (raw as MenuLayout).sections ?? [], items: (raw as MenuLayout).items ?? {} } : null);
  return parsed.success ? parsed.data : null;
}

// `wanted` first (only the ones present, each once), then everything else in its default order.
function ordered<T>(list: readonly T[], keyOf: (x: T) => string, wanted: readonly string[] | undefined): T[] {
  if (!wanted?.length) return [...list];
  const byKey = new Map(list.map(x => [keyOf(x), x] as const));
  const first: T[] = [], seen = new Set<string>();
  for (const k of wanted) { const x = byKey.get(k); if (x && !seen.has(k)) { first.push(x); seen.add(k); } }
  return [...first, ...list.filter(x => !seen.has(keyOf(x)))];
}

// The sections in the saved order, each section the layout does not list placed straight after its default
// neighbour above (the first, when it has none).
function orderedSections(groups: readonly PanelGroup[], wanted: readonly string[]): PanelGroup[] {
  const out = ordered(groups, g => g.key, wanted).filter(g => wanted.includes(g.key));
  groups.forEach((g, i) => { if (!out.includes(g)) out.splice(i === 0 ? 0 : out.indexOf(groups[i - 1]) + 1, 0, g); });
  return out;
}

// Links a saved layout cannot move out of their own section. Favorites stays in every role's first section,
// straight after Home by default (Lee, round 6); it can still move up and down within that section.
export const LOCKED_LINKS: readonly string[] = ['page:favorites'];
export const isLocked = (linkKey: string) => LOCKED_LINKS.includes(linkKey);

// The role's panel arranged as saved. Never adds a link the role lacks or loses one it has. `keepEmpty` keeps
// sections the layout emptied (the editor); the app hides them.
export function applyMenuLayout(panel: RolePanel, layout: MenuLayout | null | undefined, keepEmpty = false): RolePanel {
  if (!layout) return panel;
  const sections = new Set(panel.groups.map(g => g.key));
  const links = new Map(panel.groups.flatMap(g => g.links.map(l => [l.key, l] as const)));
  // Where the layout puts each link: the first of the role's sections that lists it.
  const listed = [...layout.sections, ...Object.keys(layout.items).filter(k => !layout.sections.includes(k))];
  const home = new Map<string, string>();
  // A locked link only takes its place from its own section; listed anywhere else it goes back there.
  const ownSection = new Map(panel.groups.flatMap(g => g.links.map(l => [l.key, g.key] as const)));
  for (const s of listed) if (sections.has(s)) for (const k of layout.items[s] ?? []) if (links.has(k) && !home.has(k) && (!isLocked(k) || ownSection.get(k) === s)) home.set(k, s);
  const groups = orderedSections(panel.groups, layout.sections).map((g): PanelGroup => {
    const placed = [...new Set((layout.items[g.key] ?? []).filter(k => home.get(k) === g.key))].map(k => links.get(k)!);
    return { ...g, links: [...placed, ...g.links.filter(l => !home.has(l.key))] };
  });
  return { ...panel, groups: keepEmpty ? groups : groups.filter(g => g.links.length) };
}

// The layout that reproduces a panel exactly (what the editor saves).
export function layoutOfPanel(panel: RolePanel): MenuLayout {
  return { sections: panel.groups.map(g => g.key), items: Object.fromEntries(panel.groups.map(g => [g.key, g.links.map(l => l.key)])) };
}

// Editor moves: one step up or down. Out of range is a no-op.
const swap = <T>(list: readonly T[], i: number, by: -1 | 1): T[] => {
  const j = i + by;
  if (i < 0 || i >= list.length || j < 0 || j >= list.length) return [...list];
  const next = [...list]; [next[i], next[j]] = [next[j], next[i]]; return next;
};
export function moveSection(panel: RolePanel, sectionKey: string, by: -1 | 1): RolePanel {
  return { ...panel, groups: swap(panel.groups, panel.groups.findIndex(g => g.key === sectionKey), by) };
}
export function moveItem(panel: RolePanel, sectionKey: string, linkKey: string, by: -1 | 1): RolePanel {
  return { ...panel, groups: panel.groups.map(g => g.key !== sectionKey ? g : { ...g, links: swap(g.links, g.links.findIndex(l => l.key === linkKey), by) }) };
}
// "Move to section": the link leaves its section and goes to the end of the chosen one. Locked links stay.
export function moveItemTo(panel: RolePanel, linkKey: string, toSection: string): RolePanel {
  if (isLocked(linkKey)) return panel;
  const link = panel.groups.flatMap(g => g.links).find(l => l.key === linkKey);
  if (!link || !panel.groups.some(g => g.key === toSection)) return panel;
  return { ...panel, groups: panel.groups.map(g => ({ ...g, links: [...g.links.filter(l => l.key !== linkKey), ...(g.key === toSection ? [link] : [])] })) };
}

// The panel link a phone bar destination stands for: Work is the Work area the button opens (the first area
// listed, for a panel that does not say), the others their page.
export function barLinkKey(value: string, panel: RolePanel): string | null {
  const links = panel.groups.flatMap(g => g.links);
  if (value === 'work') return (links.find(l => l.kind === 'area' && l.view === panel.work) ?? links.find(l => l.kind === 'area'))?.key ?? null;
  return links.some(l => l.key === 'page:' + value) ? 'page:' + value : null;
}

// The phone bar: the same destinations as today, in the order they come in the merged panel (sections in
// order, links in order). A destination the panel does not list keeps its place after the others.
export function orderPhoneBar<T extends { value: string }>(items: readonly T[], panel: RolePanel): T[] {
  const order = panel.groups.flatMap(g => g.links.map(l => l.key));
  const rank = (item: T) => { const k = barLinkKey(item.value, panel); const i = k ? order.indexOf(k) : -1; return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
  return items.map((item, i) => ({ item, i, r: rank(item) })).sort((a, b) => a.r - b.r || a.i - b.i).map(x => x.item);
}

// The phone's row of Work area tabs, in the order the areas come in the merged panel. (Which area opens
// first is not changed by the menu order.)
export function orderWorkViews<T extends string>(views: readonly T[], panel: RolePanel): T[] {
  const order = panel.groups.flatMap(g => g.links.map(l => l.key));
  const rank = (v: T) => { const i = order.indexOf('area:' + v); return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
  return views.map((v, i) => ({ v, i, r: rank(v) })).sort((a, b) => a.r - b.r || a.i - b.i).map(x => x.v);
}

// The phone's More list: every section in order with the links the bar does not already show. Management centre
// stays listed with the other departments, in the desktop sidebar's order, even when the bar's Work button opens
// it (Lee approved: it was missing from the admins' phone menu).
export const MENU_KEEPS = 'area:management';
export function phoneMoreGroups(panel: RolePanel, bar: readonly { value: string }[]): PanelGroup[] {
  const onBar = new Set(bar.map(b => barLinkKey(b.value, panel)).filter((k): k is string => !!k && k !== MENU_KEEPS));
  return panel.groups.map(g => ({ ...g, links: g.links.filter((l: PanelLink) => !onBar.has(l.key)) })).filter(g => g.links.length);
}
