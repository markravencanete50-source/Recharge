import { lastUpdateOf, type TrackerUpdate } from './tracker';
import { normaliseRegion } from './regions';
import { normalise } from './search-options';
import { journeyPhase, ONBOARDING_PHASES, onboardingProgress, readableStage, type PropertyView } from './workspace-view';
import type { JourneyView, OperationView } from './workflow-forms';

// The Properties database as a table for staff: one row per property with its full address, Scotland
// region, status (and onboarding stage), and the last change made to it. Everything here is pure; the
// screen (mobile/src/PropertiesTable.tsx) only draws it. Owners keep the card grid and never come here.

// Shown for a property whose region is blank and cannot be worked out from its address.
export const REGION_NOT_SET = 'Region not set';

// The region a property is filed under: what was typed, tidied to Recharge's Scotland areas, else the
// area its address points to, else "Region not set". The same rule the portfolio summary uses.
export function regionOf(property: { region?: string | null; address?: string | null }): string {
  return normaliseRegion(String(property.region ?? ''), String(property.address ?? '')).trim() || REGION_NOT_SET;
}

// Status, in the order the table and its filter list them: onboarding needs the most attention.
const STATUS: Record<string, { label: string; order: number }> = {
  onboarding: { label: 'Onboarding', order: 0 }, active: { label: 'Active', order: 1 }, archived: { label: 'Archived', order: 2 },
};
export const statusLabelOf = (status: string) => STATUS[status]?.label ?? (readableStage(status) || 'Unknown');
const statusOrderOf = (status: string) => STATUS[status]?.order ?? 3;

// Which onboarding step an onboarding property has reached (Enquiry ... Live), when its journey is known.
// Active and archived properties are past it, so they have none.
export function stageLabel(status: string, journey?: Pick<JourneyView, 'stage'> | null): string | null {
  if (status !== 'onboarding' || !journey) return null;
  if (journey.stage === 'declined' || journey.stage === 'archived') return 'Declined';
  return journeyPhase(journey.stage);
}

// The last change to a property: the newest update to any work at it (with who made it, when staff
// are looking), or the property record's own change when that is later. Missing or unreadable times are
// ignored. Owners never get a name.
export type PropertyUpdate = TrackerUpdate & { source: 'work' | 'record' };
const time = (iso: string | null | undefined) => { const t = iso ? Date.parse(iso) : NaN; return Number.isNaN(t) ? null : t; };
export function propertyUpdate(property: { updatedAt?: string | null }, work: readonly OperationView[], owner = false): PropertyUpdate | null {
  let best: PropertyUpdate | null = null, bestAt = -Infinity;
  for (const w of work) {
    const u = lastUpdateOf(w), t = u ? time(u.at) : null;
    if (u && t !== null && t > bestAt) { best = { ...u, source: 'work' }; bestAt = t; }
  }
  const record = time(property.updatedAt);
  if (record !== null && record > bestAt) best = { at: property.updatedAt as string, by: null, what: null, source: 'record' };
  return best && owner ? { ...best, by: null } : best;
}

export type PropertyRow = {
  id: string; property: PropertyView; name: string; address: string; region: string;
  status: string; statusLabel: string; statusOrder: number; stage: string | null; nextStep: string | null;
  lastUpdate: PropertyUpdate | null;
  // Lower-cased words the search looks through: name, address, region, status and onboarding stage.
  search: string;
};

export function buildPropertyRows(properties: readonly PropertyView[], journeys: readonly JourneyView[], work: readonly OperationView[], options: { owner?: boolean } = {}): PropertyRow[] {
  const journeyOf = new Map(journeys.map(j => [j.propertyId, j]));
  const workOf = new Map<string, OperationView[]>();
  for (const w of work) workOf.set(w.propertyId, [...(workOf.get(w.propertyId) ?? []), w]);
  return properties.map(property => {
    const journey = journeyOf.get(property.id), address = property.address.trim() || property.name.trim();
    const region = regionOf(property), stage = stageLabel(property.status, journey), statusLabel = statusLabelOf(property.status);
    return {
      id: property.id, property, name: property.name, address, region, status: property.status, statusLabel, statusOrder: statusOrderOf(property.status),
      stage, nextStep: stage && journey ? onboardingProgress(journey.stage).next : null,
      lastUpdate: propertyUpdate(property, workOf.get(property.id) ?? [], options.owner),
      search: normalise([property.name, property.address, region, statusLabel, stage ?? ''].join(' ')),
    };
  });
}

// --- Sorting. Click a column to sort by it, click again to turn it round.
export type SortKey = 'address' | 'status' | 'region' | 'updated';
export type Sort = { key: SortKey; dir: 'asc' | 'desc' };
export const DEFAULT_SORT: Sort = { key: 'address', dir: 'asc' };
export const SORT_LABEL: Record<SortKey, string> = { address: 'Address', status: 'Status', region: 'Scotland region', updated: 'Last update' };
export const SORT_KEYS: readonly SortKey[] = ['address', 'status', 'region', 'updated'];
// The newest change first is what people want from "Last update"; text columns start A to Z.
export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key === key) return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: key === 'updated' ? 'desc' : 'asc' };
}

const collator = new Intl.Collator('en-GB', { numeric: true, sensitivity: 'base' });
export function sortPropertyRows(rows: readonly PropertyRow[], sort: Sort = DEFAULT_SORT): PropertyRow[] {
  const sign = sort.dir === 'asc' ? 1 : -1;
  const byAddress = (a: PropertyRow, b: PropertyRow) => collator.compare(a.address, b.address) || a.id.localeCompare(b.id);
  return [...rows].sort((a, b) => {
    // A row with nothing to sort on (no region, no update) always goes to the end, whichever way round.
    if (sort.key === 'region') {
      const missing = Number(a.region === REGION_NOT_SET) - Number(b.region === REGION_NOT_SET);
      return missing || sign * collator.compare(a.region, b.region) || byAddress(a, b);
    }
    if (sort.key === 'updated') {
      const x = a.lastUpdate ? time(a.lastUpdate.at) : null, y = b.lastUpdate ? time(b.lastUpdate.at) : null;
      if (x === null || y === null) return Number(x === null) - Number(y === null) || byAddress(a, b);
      return sign * (x - y) || byAddress(a, b);
    }
    if (sort.key === 'status') {
      const stage = (r: PropertyRow) => r.stage ? ONBOARDING_PHASES.indexOf(r.stage) : -1;
      return sign * (a.statusOrder - b.statusOrder || stage(a) - stage(b)) || byAddress(a, b);
    }
    return sign * collator.compare(a.address, b.address) || a.id.localeCompare(b.id);
  });
}

// --- Filtering: every word typed must appear (name, address, region, status or stage, any order),
// then the chosen region and status.
export type PropertyFilter = { query: string; region: string | null; status: string | null };
export const NO_FILTER: PropertyFilter = { query: '', region: null, status: null };
export function filterPropertyRows(rows: readonly PropertyRow[], filter: Partial<PropertyFilter>): PropertyRow[] {
  const words = normalise(filter.query ?? '').split(' ').filter(Boolean);
  return rows.filter(r => (!filter.region || r.region === filter.region) && (!filter.status || r.status === filter.status) && words.every(w => r.search.includes(w)));
}

// The regions present in the data with how many properties each holds, A to Z, "Region not set" last.
// Derived from the rows, never from a fixed list, so a region someone typed in still shows up.
export function regionOptions(rows: readonly Pick<PropertyRow, 'region'>[]): { region: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.region, (counts.get(r.region) ?? 0) + 1);
  return [...counts].map(([region, count]) => ({ region, count }))
    .sort((a, b) => Number(a.region === REGION_NOT_SET) - Number(b.region === REGION_NOT_SET) || collator.compare(a.region, b.region));
}

// The statuses present, in the table's order (onboarding, active, archived, anything else).
export function statusOptions(rows: readonly Pick<PropertyRow, 'status' | 'statusLabel' | 'statusOrder'>[]): { status: string; label: string; count: number }[] {
  const found = new Map<string, { status: string; label: string; order: number; count: number }>();
  for (const r of rows) { const have = found.get(r.status); found.set(r.status, have ? { ...have, count: have.count + 1 } : { status: r.status, label: r.statusLabel, order: r.statusOrder, count: 1 }); }
  return [...found.values()].sort((a, b) => a.order - b.order || a.label.localeCompare(b.label)).map(({ status, label, count }) => ({ status, label, count }));
}

// Who gets the table: the team, not owners and not cleaners (they keep the cards of the properties they may see).
export const usesPropertyTable = (role: string) => role !== 'client' && role !== 'cleans';
// Who may read the default-cleaner data the cleaner row is built from (the database refuses everyone else).
export const seesCleaners = (role: string, modules: readonly string[]) => ['admin', 'super_admin', 'cleaning_manager', 'stays'].includes(role) && modules.includes('cleaning-schedule');
