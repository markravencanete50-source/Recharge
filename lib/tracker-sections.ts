import { sortTracker, updateStamp, type TrackerItem } from './tracker';
import { licensingTrackerItem } from './tracker-licensing';
import { purchaseTrackerItem } from './tracker-purchases';
import type { OperationView } from './workflow-forms';

// Which work items the shared tracker draws, and how. `trackerItemFor` is the one door the screens
// use: it returns null for every kind of work that has no tracker adapter, so callers keep their
// own sheet for those.

// A step this person may take on an item. WorkflowForm (lib/workflow-forms.ts) fits as it is.
export type TrackerForm = { key: string; title: string; unavailable?: string };

// Everything an adapter needs, built once per screen from what LiveHub, LiveWorkspace and
// LiveAccountsWork already hold, for example:
//   { property: id => properties.find(x => x.id === id), forms: w => workItemForms(account, w, journeys, work),
//     now: new Date(), owner: account.role === 'client' }
export type TrackerContext = {
  // The property with this id, or nothing when it is not (or no longer) in the list. Gives the
  // address, with the property's name when no address is held.
  property: (propertyId: string) => { name?: string | null; address?: string | null } | null | undefined;
  // The steps the current person may take on this item (empty when they may take none).
  forms: (work: OperationView) => readonly TrackerForm[];
  // The clock for dates and update stamps. Pass the same Date to every call in one render.
  now: Date;
  // True for owners (client role). They never see staff names, only "Recharge".
  owner: boolean;
};

// The tracker row for one work item, or null when its kind has no adapter.
export function trackerItemFor(work: OperationView, ctx: TrackerContext): TrackerItem | null {
  if (work.kind === 'purchase') return purchaseTrackerItem(work, ctx);
  if (work.kind === 'licensing') return licensingTrackerItem(work, ctx);
  return null;
}

// Every work item that has an adapter (optionally only one section), in tracker order: open items
// first, earliest step first, longest without an update first.
export function trackerItemsFor(work: readonly OperationView[], ctx: TrackerContext, section?: TrackerItem['section']): TrackerItem[] {
  const items: TrackerItem[] = [];
  for (const w of work) {
    const item = trackerItemFor(w, ctx);
    if (item && (!section || item.section === section)) items.push(item);
  }
  return sortTracker(items);
}

// "Today 14:05 · Morag Reid" for this item, in the context's clock and for its viewer.
export const trackerStamp = (item: TrackerItem, ctx: Pick<TrackerContext, 'now' | 'owner'>) => updateStamp(item.lastUpdate, ctx.now, ctx.owner);
