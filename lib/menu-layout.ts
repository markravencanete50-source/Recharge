import { z } from 'zod';
import type { PanelGroup, PanelLink, RolePanel } from './role-panel';

// The menu order a super admin sets per role in Access control → Menu order (migration
// 20261015210000_menu_layouts.sql). It only REORDERS: the sections and links a person gets still come
// from their role and tools (lib/role-panel.ts). The saved layout is applied on top:
//   * sections: the saved ones the role has, in the saved order, then any others in their default order;
//   * links inside each section: the same, by link key;
//   * keys the role does not have, or that no longer exist, are ignored;
//   * a link stays in its own section (moving links between sections is not offered).
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

// The role's panel in the saved order. Never adds or removes a section or a link.
export function applyMenuLayout(panel: RolePanel, layout: MenuLayout | null | undefined): RolePanel {
  if (!layout) return panel;
  const groups = ordered(panel.groups, g => g.key, layout.sections)
    .map((g): PanelGroup => ({ ...g, links: ordered(g.links, l => l.key, layout.items[g.key]) }));
  return { ...panel, groups };
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

// The panel link a phone bar destination stands for: Work is the first Work area, the others their page.
export function barLinkKey(value: string, panel: RolePanel): string | null {
  const links = panel.groups.flatMap(g => g.links);
  if (value === 'work') return links.find(l => l.kind === 'area')?.key ?? null;
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

// The phone's More list: every section in order with the links the bar does not already show.
export function phoneMoreGroups(panel: RolePanel, bar: readonly { value: string }[]): PanelGroup[] {
  const onBar = new Set(bar.map(b => barLinkKey(b.value, panel)).filter((k): k is string => !!k));
  return panel.groups.map(g => ({ ...g, links: g.links.filter((l: PanelLink) => !onBar.has(l.key)) })).filter(g => g.links.length);
}
