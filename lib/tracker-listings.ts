import { formatDay, formatMoney, plural } from './format';
import { addressOf, lastUpdateOf, nextActionOf, progressOf, type TrackerItem, type TrackerStep, type TrackerTone, type TrackerUpdate } from './tracker';
import type { TrackerContext } from './tracker-sections';
import type { Detail } from './work-details';
import type { OperationView } from './workflow-forms';

// Listing health, pricing, reviews and re-listing as tracker rows (client ask C7). The first three are
// ONE ROW PER LIVE PROPERTY, built from the records the team logs with the existing sheets
// (kinds listing_health, daily_pricing, guest_review, plus the system's pricing_gap tickets). Re-listing
// is one row per re-listing work item, because each one is a piece of work with its own steps.
//
// The rules below are the ones the app already uses, each behind one constant:
//   listing health: a check every day (dailyChecks in lib/management-live.ts); a hidden or suspended
//     listing, a bad review or a ticked box opens a re-listing automatically.
//   pricing: the next seven nights, each priced (hold or change) or booked (20261008260000_pricing_gap_tickets.sql);
//     a decision stays "proposed" until the applied price is recorded (recordApplied).
//   reviews: the last 30 days; a bad review should have a note of how it was handled (the daily sign-off).
export const LISTING_CHECK_EVERY_DAYS = 1;
export const PRICING_HORIZON_DAYS = 7;
export const REVIEW_PERIOD_DAYS = 30;
// A bad review with no handling note counts as "reply due" for this many days. There is no step to add
// the note later (it is written when the review is logged), so an older one would never clear.
export const REPLY_DUE_DAYS = 7;
// The same cut-offs the review sheet uses to suggest good / mixed / bad from a score.
export const GOOD_SHARE = 0.8;
export const MIXED_SHARE = 0.6;

export type ListingKind = 'listing_health' | 'pricing' | 'reviews' | 'relisting';
// The three existing sheets that log a record (the keys createOperationForms uses).
export type LogKey = 'listing_health' | 'daily_pricing' | 'guest_review';
export type ListingProperty = { id: string; name?: string | null; address?: string | null; status?: string };
export type StayDates = { propertyId: string; checkIn: string; checkOut: string };

export type ListingsContext = {
  // The properties to draw. Only live ones (status 'active', or no status held) get a row.
  properties: readonly ListingProperty[];
  // Today in UK time, YYYY-MM-DD, and the clock for dates and stamps. Use the same values for every call in one render.
  today: string; now: Date;
  // True for owners: no staff names. (These sections are staff only; this is the belt to the braces.)
  owner: boolean;
  // The property with this id (for the address of a re-listing), as in TrackerContext.
  property: TrackerContext['property'];
  // The steps this person may take on a work item (for re-listing and applying a price).
  forms: TrackerContext['forms'];
  // May this person log this kind of record for this property? (createOperationForms)
  can: (propertyId: string, key: LogKey) => boolean;
  // Confirmed stays, when they are loaded, so empty nights can be found without waiting for the system's ticket.
  stays?: readonly StayDates[];
};

// What a property row keeps for its screen: the sheet it opens and its sorting key.
export type ListingSource = {
  kind: ListingKind; propertyId: string;
  // The newest record behind the row, if any.
  latest: OperationView | null;
  // Pricing: the empty nights still to price, and a decision waiting to be applied.
  nights: string[]; pending: OperationView | null;
  // Listing health: days past due. Pricing: 1 when tonight is unpriced. Reviews: replies due. Used to sort.
  overdueDays: number;
};

const text = (v: unknown) => typeof v === 'string' ? v.trim() : '';
const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'));
const ukFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });
// The UK calendar day of a timestamp, or '' when it cannot be read.
export function ukDay(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(t) ? '' : ukFormat.format(new Date(t));
}
export const addDays = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a: string, b: string) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86_400_000);
const unique = <T,>(list: readonly T[]) => [...new Set(list)];
const finished = (w: Pick<OperationView, 'status'>) => w.status === 'completed' || w.status === 'cancelled';
const newest = (a: OperationView, b: OperationView) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '') || a.workId.localeCompare(b.workId);
const liveProperties = (ctx: ListingsContext) => ctx.properties.filter(p => p.status === undefined || p.status === 'active');
const where = (p: ListingProperty) => { const address = addressOf(p) || 'Unknown property'; return { address, propertyName: p.name?.trim() || address }; };
const shown = (u: TrackerUpdate | null, ctx: Pick<ListingsContext, 'owner'>) => u && ctx.owner ? { ...u, by: null } : u;
const logAction = (ctx: ListingsContext, propertyId: string, key: LogKey, title: string) =>
  nextActionOf(ctx.can(propertyId, key) ? [{ key, title }] : [], 'Guest relations');

// ---- Listing health -----------------------------------------------------------------------------

type Check = { work: OperationView; on: string; platform: string; visible: boolean; suspended: boolean; sentiment: string; relist: boolean; evidence: string };
function checksFor(work: readonly OperationView[], propertyId: string, today: string): Check[] {
  const out: Check[] = [];
  for (const w of work) {
    if (w.kind !== 'listing_health' || w.propertyId !== propertyId || w.status === 'cancelled') continue;
    const d = w.data, on = isDay(text(d.checkedOn)) ? text(d.checkedOn) : ukDay(w.createdAt);
    if (!on || on > today) continue;
    out.push({ work: w, on, platform: text(d.platform), visible: d.listingVisible !== false, suspended: d.suspended === true, sentiment: text(d.reviewSentiment), relist: d.relist === true, evidence: text(d.evidence) });
  }
  return out.sort((a, b) => b.on.localeCompare(a.on) || newest(a.work, b.work));
}
function issuesOf(c: Check): string[] {
  const on = c.platform ? ' on ' + c.platform : '';
  return [!c.visible && 'Listing not visible' + on, c.suspended && 'Listing suspended' + on, c.sentiment === 'negative' && 'Bad review' + on, c.relist && !c.suspended && c.visible && 'Re-listing asked for' + on].filter((x): x is string => !!x);
}
const openRelistings = (work: readonly OperationView[], propertyId: string) => work.filter(w => w.kind === 'relisting' && w.propertyId === propertyId && !finished(w) && text(w.data.phase) !== 'completed');

export function listingHealthTrackerItems(work: readonly OperationView[], ctx: ListingsContext): TrackerItem<ListingSource>[] {
  const items: TrackerItem<ListingSource>[] = [];
  for (const p of liveProperties(ctx)) {
    const { address, propertyName } = where(p);
    const mine = checksFor(work, p.id, ctx.today), last = mine[0] ?? null, todays = mine.filter(c => c.on === ctx.today);
    const done = todays.length > 0;
    const dueOn = last ? addDays(last.on, LISTING_CHECK_EVERY_DAYS) : ctx.today;
    const over = done ? 0 : Math.max(0, daysBetween(ctx.today, dueOn));
    const relistings = openRelistings(work, p.id);
    const issues = unique(todays.flatMap(issuesOf));
    const platforms = unique(todays.map(c => c.platform).filter(Boolean)).join(', ');
    const closed = done && relistings.length === 0;

    const steps: TrackerStep[] = [
      { key: 'due', label: 'Check due', state: done ? 'done' : 'current', detail: done ? 'Due ' + formatDay(ctx.today, ctx.now) : over > 0 ? `Overdue by ${plural(over, 'day')}, was due ${formatDay(dueOn, ctx.now)}` : 'Due today' },
      { key: 'checked', label: 'Checked', state: done ? 'done' : 'todo', ...(platforms ? { detail: 'Checked on ' + platforms } : {}) },
      { key: 'issues', label: 'Issues raised', state: done ? (issues.length ? 'done' : 'skipped') : 'todo', ...(issues.length ? { detail: issues.join(', ') } : done ? { detail: 'No issues found' } : {}) },
    ];
    const status: { label: string; tone: TrackerTone } = done ? { label: 'Done today', tone: issues.length ? 'wait' : 'good' } : over > 0 ? { label: 'Overdue', tone: 'bad' } : { label: 'Due', tone: 'wait' };
    const nextStep = done ? (relistings.length ? 'Follow the open re-listing' : `Next check ${formatDay(addDays(ctx.today, LISTING_CHECK_EVERY_DAYS), ctx.now)}`)
      : over > 0 ? `Check the listing now, it was due ${formatDay(dueOn, ctx.now)}` : last ? 'Check the listing today' : 'Do the first listing check';

    const details: Detail[] = [];
    const add = (label: string, value: string, tone?: Detail['tone']) => { if (value) details.push({ label, value, ...(tone ? { tone } : {}) }); };
    add('Last checked', last ? [formatDay(last.on, ctx.now), last.platform].filter(Boolean).join(' · ') : 'Never checked');
    add('Next due', formatDay(done ? addDays(ctx.today, LISTING_CHECK_EVERY_DAYS) : dueOn, ctx.now));
    add('Checked today on', platforms);
    add('Issues found today', issues.join('\n'), 'bad');
    add('Open re-listings', relistings.length ? String(relistings.length) : '');
    if (!ctx.owner) add('What was checked', last?.evidence ?? '');

    items.push({
      id: 'listing_health:' + p.id, section: 'listing_health', propertyId: p.id, address, propertyName, title: 'Listing health check',
      source: { kind: 'listing_health', propertyId: p.id, latest: last?.work ?? null, nights: [], pending: null, overdueDays: over },
      status, closed, nextStep,
      nextAction: closed ? null : done ? { label: 'See the Re-listing tab' } : logAction(ctx, p.id, 'listing_health', 'Record the listing check'),
      lastUpdate: shown(last ? lastUpdateOf(last.work) : null, ctx), progress: progressOf(steps), steps, details,
      ...(last ? { workId: last.work.workId, version: last.work.version } : {}),
      search: ['listing health check', address, propertyName, status.label, closed ? '' : nextStep, platforms, issues.join(' ')].filter(Boolean).join(' '),
    });
  }
  return sortListings(items);
}

// ---- Pricing ------------------------------------------------------------------------------------

export function pricingTrackerItems(work: readonly OperationView[], ctx: ListingsContext): TrackerItem<ListingSource>[] {
  const items: TrackerItem<ListingSource>[] = [];
  const horizon = Array.from({ length: PRICING_HORIZON_DAYS }, (_, i) => addDays(ctx.today, i));
  for (const p of liveProperties(ctx)) {
    const { address, propertyName } = where(p);
    const records = work.filter(w => w.kind === 'daily_pricing' && w.propertyId === p.id && w.status !== 'cancelled').sort(newest);
    const last = records[0] ?? null;
    const priced = new Set(records.map(w => text(w.data.night)).filter(n => horizon.includes(n)));
    const gapItems = work.filter(w => w.kind === 'pricing_gap' && w.propertyId === p.id && !finished(w)).sort(newest);
    const booked = (n: string) => !!ctx.stays?.some(s => s.propertyId === p.id && s.checkIn <= n && s.checkOut > n);
    const flagged = gapItems.flatMap(w => Array.isArray(w.data.nights) ? w.data.nights.filter((n): n is string => typeof n === 'string') : []);
    // With the stays loaded, every unbooked night counts; without them, only the nights the system flagged.
    const candidates = ctx.stays ? [...horizon.filter(n => !booked(n)), ...flagged.filter(n => !booked(n))] : flagged;
    const gaps = unique(candidates).filter(n => horizon.includes(n) && !priced.has(n)).sort();
    const waiting = records.filter(w => text(w.data.phase) === 'proposed' && !finished(w)).sort((a, b) => text(a.data.night).localeCompare(text(b.data.night)));
    const pending = waiting[0] ?? null;
    const tonight = gaps.includes(ctx.today), closed = !gaps.length && !waiting.length;

    const steps: TrackerStep[] = [
      { key: 'found', label: 'Empty nights found', state: 'done', detail: gaps.length || priced.size ? `${plural(gaps.length + priced.size, 'empty night')} in the next ${PRICING_HORIZON_DAYS} days` : `No empty nights in the next ${PRICING_HORIZON_DAYS} days` },
      { key: 'priced', label: 'Nights priced', state: gaps.length ? 'current' : priced.size ? 'done' : 'skipped', ...(gaps.length || priced.size ? { detail: `${priced.size} of ${priced.size + gaps.length} priced` } : { detail: 'Nothing to price' }) },
      { key: 'applied', label: 'Price applied', state: waiting.length ? (gaps.length ? 'todo' : 'current') : gaps.length ? 'todo' : priced.size ? 'done' : 'skipped', ...(waiting.length ? { detail: `${waiting.length} waiting to be applied` } : {}) },
    ];
    const status: { label: string; tone: TrackerTone } = gaps.length ? { label: `${gaps.length} to price`, tone: tonight ? 'bad' : 'wait' } : waiting.length ? { label: 'To apply', tone: 'wait' } : { label: 'Up to date', tone: 'good' };
    const nextStep = gaps.length ? `Price ${plural(gaps.length, 'empty night')}, starting ${formatDay(gaps[0], ctx.now)}` : waiting.length ? 'Record that the new price is live' : 'Nothing to price this week';
    const nextAction = closed ? null : gaps.length ? logAction(ctx, p.id, 'daily_pricing', 'Price a night') : nextActionOf(ctx.forms(pending!), 'Guest relations');

    const details: Detail[] = [];
    const add = (label: string, value: string, tone?: Detail['tone']) => { if (value) details.push({ label, value, ...(tone ? { tone } : {}) }); };
    add('Last pricing review', last ? formatDay(ukDay(last.createdAt), ctx.now) : 'No pricing review yet');
    if (last) {
      const d = last.data, rate = typeof d.currentRateMinor === 'number' ? formatMoney(d.currentRateMinor) : '', next = typeof d.proposedRateMinor === 'number' ? formatMoney(d.proposedRateMinor) : '';
      add('Last decision', [d.decision === 'change' ? 'Changed' : 'Held', formatDay(text(d.night), ctx.now), rate && (d.decision === 'change' && next ? `${rate} to ${next}` : rate)].filter(Boolean).join(' · '));
      if (!ctx.owner) add('Why', text(d.reason));
    }
    add('Empty nights to price', gaps.map(n => formatDay(n, ctx.now)).join(', '), 'bad');
    add('Waiting to be applied', waiting.map(w => formatDay(text(w.data.night), ctx.now)).join(', '));

    const stable = gapItems[0] ?? last;
    items.push({
      id: 'pricing:' + p.id, section: 'pricing', propertyId: p.id, address, propertyName, title: 'Pricing',
      source: { kind: 'pricing', propertyId: p.id, latest: last, nights: gaps, pending, overdueDays: tonight ? 1 : 0 },
      status, closed, nextStep, nextAction,
      lastUpdate: shown(last ? lastUpdateOf(last) : gapItems[0] ? lastUpdateOf(gapItems[0]) : null, ctx), progress: progressOf(steps), steps, details,
      ...(stable ? { workId: stable.workId, version: stable.version } : {}),
      search: ['pricing', address, propertyName, status.label, closed ? '' : nextStep, gaps.join(' ')].filter(Boolean).join(' '),
    });
  }
  return sortListings(items);
}

// ---- Reviews ------------------------------------------------------------------------------------

type Review = { work: OperationView; on: string; platform: string; rating: number | null; outOf: number | null; ratio: number | null; sentiment: string; response: string; relist: boolean; summary: string };
function reviewsFor(work: readonly OperationView[], propertyId: string, today: string): Review[] {
  const out: Review[] = [];
  for (const w of work) {
    if (w.kind !== 'guest_review' || w.propertyId !== propertyId || w.status === 'cancelled') continue;
    const d = w.data, on = isDay(text(d.reviewedOn)) ? text(d.reviewedOn) : ukDay(w.createdAt);
    if (!on || on > today) continue;
    const rating = typeof d.rating === 'number' ? d.rating : null, outOf = typeof d.outOf === 'number' && d.outOf > 0 ? d.outOf : null;
    out.push({ work: w, on, platform: text(d.platform), rating, outOf, ratio: rating !== null && outOf !== null ? Math.min(1, rating / outOf) : null, sentiment: text(d.sentiment), response: text(d.response), relist: d.relist === true, summary: text(d.summary) });
  }
  return out.sort((a, b) => b.on.localeCompare(a.on) || newest(a.work, b.work));
}
const SENTIMENT_WORDS: Record<string, string> = { positive: 'good', neutral: 'mixed', negative: 'bad' };

export function reviewTrackerItems(work: readonly OperationView[], ctx: ListingsContext): TrackerItem<ListingSource>[] {
  const items: TrackerItem<ListingSource>[] = [];
  const since = addDays(ctx.today, -(REVIEW_PERIOD_DAYS - 1)), replySince = addDays(ctx.today, -(REPLY_DUE_DAYS - 1));
  for (const p of liveProperties(ctx)) {
    const { address, propertyName } = where(p);
    const all = reviewsFor(work, p.id, ctx.today), period = all.filter(r => r.on >= since), last = all[0] ?? null;
    const recentBad = period.filter(r => r.sentiment === 'negative' && r.on >= replySince), due = recentBad.filter(r => !r.response);
    const relisted = period.filter(r => r.relist);
    const rated = period.filter(r => r.ratio !== null), mean = rated.length ? rated.reduce((n, r) => n + (r.ratio ?? 0), 0) / rated.length : null;
    const average = mean === null ? null : Math.round(mean * 50) / 10;
    const tally = (s: string) => period.filter(r => r.sentiment === s).length;
    const verdict: { label: string; tone: TrackerTone } | null = mean === null ? null : mean >= GOOD_SHARE ? { label: 'Good', tone: 'good' } : mean >= MIXED_SHARE ? { label: 'Mixed', tone: 'wait' } : { label: 'Poor', tone: 'bad' };

    const steps: TrackerStep[] = [
      { key: 'logged', label: 'Review logged', state: period.length ? 'done' : 'current', detail: period.length ? `${plural(period.length, 'review')} in the last ${REVIEW_PERIOD_DAYS} days` : `None in the last ${REVIEW_PERIOD_DAYS} days` },
      { key: 'replied', label: 'Bad reviews replied to', state: recentBad.length ? (due.length ? 'current' : 'done') : 'skipped', ...(recentBad.length ? { detail: due.length ? `${plural(due.length, 'reply', 'replies')} due` : 'All handled' } : { detail: 'No bad reviews to reply to' }) },
      { key: 'relisting', label: 'Re-listing raised', state: relisted.length ? 'done' : 'skipped', ...(relisted.length ? { detail: `${plural(relisted.length, 'review')} sent for re-listing` } : {}) },
    ];
    const status: { label: string; tone: TrackerTone } = due.length ? { label: due.length === 1 ? '1 reply due' : `${due.length} replies due`, tone: 'bad' } : verdict ?? { label: 'None this period', tone: 'plain' };
    const closed = due.length === 0;
    const nextStep = due.length ? `Reply to the bad review${due[0].platform ? ' on ' + due[0].platform : ''}${due.length > 1 ? ` and ${due.length - 1} more` : ''}`
      : period.length ? 'Log new reviews as they arrive' : 'Log the next guest review when one arrives';

    const details: Detail[] = [];
    const add = (label: string, value: string, tone?: Detail['tone']) => { if (value) details.push({ label, value, ...(tone ? { tone } : {}) }); };
    add(`Reviews in the last ${REVIEW_PERIOD_DAYS} days`, period.length ? String(period.length) : 'None');
    add('Average', average === null ? '' : `${average} out of 5 · ${verdict?.label.toLowerCase()}`);
    add('Good, mixed and bad', period.length ? ['positive', 'neutral', 'negative'].map(s => `${tally(s)} ${SENTIMENT_WORDS[s]}`).join(', ') : '');
    add('Replies due', due.length ? String(due.length) : '', 'bad');
    if (last) add('Latest review', [formatDay(last.on, ctx.now), last.platform, last.rating !== null && last.outOf !== null ? `${last.rating} out of ${last.outOf}` : '', last.summary && '"' + (last.summary.length > 140 ? last.summary.slice(0, 137) + '...' : last.summary) + '"'].filter(Boolean).join(' · '));

    items.push({
      id: 'reviews:' + p.id, section: 'reviews', propertyId: p.id, address, propertyName, title: 'Guest reviews',
      source: { kind: 'reviews', propertyId: p.id, latest: last?.work ?? null, nights: [], pending: null, overdueDays: due.length },
      status, closed, nextStep, nextAction: logAction(ctx, p.id, 'guest_review', 'Log a review'),
      lastUpdate: shown(last ? lastUpdateOf(last.work) : null, ctx), progress: progressOf(steps), steps, details,
      ...(last ? { workId: last.work.workId, version: last.work.version } : {}),
      search: ['guest reviews', address, propertyName, status.label, nextStep, unique(period.map(r => r.platform).filter(Boolean)).join(' ')].filter(Boolean).join(' '),
    });
  }
  return sortListings(items);
}

// ---- Re-listing ---------------------------------------------------------------------------------

// A re-listing work item. `data.phase` runs to_relist (or none), relisting (started), then the item
// completes (supabase/migrations/20261008210000_stays_workflows.sql: startRelisting, completeHandover).
const RELIST_REASON: Record<string, string> = { suspended: 'Listing suspended', hidden: 'Listing not visible', review: 'Bad review' };
const RELIST_STEPS = [
  { key: 'flagged', label: 'Needs re-listing', actionKey: undefined },
  { key: 'started', label: 'Re-listing started', actionKey: 'startRelisting' },
  { key: 'relisted', label: 'Re-listed', actionKey: 'completeHandover' },
];

export function relistingTrackerItem(work: OperationView, ctx: Pick<TrackerContext, 'property' | 'forms' | 'now' | 'owner'>): TrackerItem<OperationView> {
  const property = ctx.property(work.propertyId), address = addressOf(property) || 'Unknown property', propertyName = property?.name?.trim() || address;
  const phase = text(work.data.phase), cancelled = work.status === 'cancelled', done = work.status === 'completed' || phase === 'completed', closed = done || cancelled;
  const reached = done ? 2 : phase === 'relisting' ? 1 : 0;
  const reason = RELIST_REASON[text(work.data.reason)] ?? '', platform = text(work.data.platform), note = text(work.data.note);
  const raised = work.createdAt ? formatDay(ukDay(work.createdAt), ctx.now) : '';
  const finishedOn = done ? formatDay(ukDay(work.updatedAt ?? work.lastActivityAt), ctx.now) : '';
  const detailOf = (i: number) => i === 0 ? [raised && 'Flagged ' + raised, reason].filter(Boolean).join(' · ') || undefined : i === 1 ? note || undefined : finishedOn !== '–' && finishedOn ? 'Re-listed ' + finishedOn : undefined;
  const steps: TrackerStep[] = RELIST_STEPS.map((s, i) => {
    const state: TrackerStep['state'] = i <= reached ? 'done' : closed ? 'skipped' : i === reached + 1 ? 'current' : 'todo';
    const detail = state === 'done' ? detailOf(i) : undefined;
    return { key: s.key, label: s.label, state, ...(detail ? { detail } : {}), ...(s.actionKey ? { actionKey: s.actionKey } : {}) };
  });
  const status: { label: string; tone: TrackerTone } = cancelled ? { label: 'Cancelled', tone: 'bad' } : done ? { label: 'Re-listed', tone: 'good' } : phase === 'relisting' ? { label: 'Under way', tone: 'plain' } : { label: 'To re-list', tone: 'wait' };
  const nextStep = cancelled ? 'Cancelled' : done ? 'Nothing more to do' : phase === 'relisting' ? 'Finish and mark the property re-listed' : 'Start re-listing: new listing, photos, title';
  const details: Detail[] = [];
  const add = (label: string, value: string) => { if (value) details.push({ label, value }); };
  add('Why', reason);
  add('Platform', platform);
  add('Needs re-listing since', raised);
  add('Re-listed on', finishedOn === '–' ? '' : finishedOn);
  add('What is being done', note);
  const update = lastUpdateOf(work);
  return {
    id: work.workId, section: 'relisting', source: work, propertyId: work.propertyId || null, address, propertyName,
    title: ['Re-list' + (platform ? ' on ' + platform : ''), reason].filter(Boolean).join(' · '),
    status, closed, nextStep, nextAction: closed ? null : nextActionOf(ctx.forms(work), 'Guest relations'),
    lastUpdate: shown(update, ctx), progress: progressOf(steps), steps, details, workId: work.workId, version: work.version,
    search: ['re-listing relisting', address, propertyName, platform, reason, status.label, closed ? '' : nextStep, note].filter(Boolean).join(' '),
  };
}

export function relistingTrackerItems(work: readonly OperationView[], ctx: Pick<TrackerContext, 'property' | 'forms' | 'now' | 'owner'>): TrackerItem<OperationView>[] {
  return sortListings(work.filter(w => w.kind === 'relisting').map(w => relistingTrackerItem(w, ctx)));
}

// ---- Ordering and reading -----------------------------------------------------------------------

const RANK: Record<TrackerTone, number> = { bad: 0, wait: 1, plain: 2, good: 3 };
// Open rows first; among them the most urgent (overdue, then due), the most days late first, then the
// longest without an update, then the address. Finished rows follow in the same order. Returns a new list.
export function sortListings<T extends TrackerItem>(items: readonly T[]): T[] {
  const late = (i: T) => (i.source as { overdueDays?: number } | null)?.overdueDays ?? 0;
  const touched = (i: T) => { const t = i.lastUpdate ? Date.parse(i.lastUpdate.at) : NaN; return Number.isNaN(t) ? 0 : t; };
  return [...items].sort((a, b) => Number(a.closed) - Number(b.closed) || RANK[a.status.tone] - RANK[b.status.tone] || late(b) - late(a) || touched(a) - touched(b) || a.address.localeCompare(b.address) || a.id.localeCompare(b.id));
}

// Stays out of a schedule answer ({ stays: [...] }) or a bare list; anything unreadable is left out.
export function parseStayDates(raw: unknown): StayDates[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { stays?: unknown }).stays) ? (raw as { stays: unknown[] }).stays : [];
  const out: StayDates[] = [];
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>, propertyId = text(r.propertyId), checkIn = text(r.checkIn).slice(0, 10), checkOut = text(r.checkOut).slice(0, 10);
    if (propertyId && isDay(checkIn) && isDay(checkOut)) out.push({ propertyId, checkIn, checkOut });
  }
  return out;
}
