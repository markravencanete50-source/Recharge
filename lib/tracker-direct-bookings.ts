import { formatDay, formatMoney } from './format';
import { addressOf, lastUpdateOf, nextActionOf, progressOf, sortTracker, type TrackerItem, type TrackerStep, type TrackerTone } from './tracker';
import type { TrackerContext } from './tracker-sections';
import type { Detail } from './work-details';
import type { OperationView } from './workflow-forms';

// A direct-booking follow-up as tracker steps (client ask B3). Any confirmed stay of the policy's
// minimum nights or more that came through a booking site gets one `direct_booking` work item: made
// by recordReservation for a stay entered by hand, and by the daily sweep for an imported one
// (supabase/migrations/20261012180000_direct_booking_followups.sql). `data.phase` then runs
//   follow_up  -> quoted (offer prepared)  -> accepted (guest agreed, invoice raised)  -> confirmed (paid, booking made)
// or ends in `declined` (the guest said no) from follow_up or quoted. A follow-up cancelled because the
// stay itself changed carries status `cancelled` and no phase change.
// (supabase/migrations/20261010180000_team_beta_owner_steps.sql holds the step rules.)
export const DIRECT_BOOKING_KIND = 'direct_booking';

// The steps the team follows: raised, contacted with an offer, the guest's answer, the booking made.
const STEPS = [
  { key: 'raised', label: 'Follow-up raised', actionKey: undefined },
  { key: 'contacted', label: 'Contacted', actionKey: 'prepareQuote' },
  { key: 'decision', label: 'Agreed or declined', actionKey: 'recordGuestAcceptance' },
  { key: 'done', label: 'Done', actionKey: 'confirmBooking' },
] as const;
const LAST_DONE: Record<string, number> = { follow_up: 0, quoted: 1, accepted: 2, confirmed: 3 };
// What is needed after each phase, the form that moves it on, and which team it waits on. Only that form is
// the next action: "The guest said no" (recordGuestDecline) is offered beside it in the detail sheet, never
// as what to do next, so a follow-up whose offer form is unavailable (the discount policy is not confirmed
// yet) says why rather than suggesting the guest refused.
const NEXT: Record<string, { step: string; actionKey: string; waitingOn: string }> = {
  follow_up: { step: 'Contact the guest with the direct-booking offer', actionKey: 'prepareQuote', waitingOn: 'Guest relations' },
  quoted: { step: "Record the guest's answer", actionKey: 'recordGuestAcceptance', waitingOn: 'Guest relations' },
  accepted: { step: 'Confirm the booking once the invoice is paid', actionKey: 'confirmBooking', waitingOn: 'Accounts' },
};
const STATUS: Record<string, { label: string; tone: TrackerTone }> = {
  follow_up: { label: 'Follow up', tone: 'wait' }, quoted: { label: 'Offer sent', tone: 'wait' }, accepted: { label: 'Agreed', tone: 'wait' },
  confirmed: { label: 'Booked', tone: 'good' }, declined: { label: 'Declined', tone: 'plain' },
};
const CHANNEL: Record<string, string> = { airbnb: 'Airbnb', booking_com: 'Booking.com', vrbo: 'Vrbo', direct: 'Direct', other: 'Other' };
const text = (v: unknown) => typeof v === 'string' ? v.trim() : '';
const money = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? formatMoney(v) : '';

// A stay as the schedule read lists it. The guest's name is only there for staff who may see it.
export type StayInfo = { reservationId: string; checkIn: string; checkOut: string; channel: string | null; guestName: string | null };
export type DirectBookingContext = TrackerContext & { stays?: ReadonlyMap<string, StayInfo> };

// The schedule read answers up to 62 days at a time (lib/workspace-teams-policy.ts and the SQL both cap it), so
// a long look-ahead is asked for in consecutive windows. Direct-booking stays are long and booked well ahead.
export const SCHEDULE_WINDOW_DAYS = 62;
export function scheduleWindows(today: string, daysBack = 14, daysAhead = 400): { from: string; to: string }[] {
  const shift = (iso: string, days: number) => { const d = new Date(iso.slice(0, 10) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
  const out: { from: string; to: string }[] = [], last = shift(today, daysAhead);
  for (let from = shift(today, -daysBack); from <= last; from = shift(from, SCHEDULE_WINDOW_DAYS + 1)) {
    const end = shift(from, SCHEDULE_WINDOW_DAYS);
    out.push({ from, to: end > last ? last : end });
  }
  return out;
}

// Reads the stays out of a schedule answer ({ stays: [...] }) or a bare list. Anything unreadable is left out.
export function parseStays(raw: unknown): Map<string, StayInfo> {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { stays?: unknown }).stays) ? (raw as { stays: unknown[] }).stays : [];
  const out = new Map<string, StayInfo>();
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const r = row as Record<string, unknown>;
    const id = text(r.reservationId), checkIn = text(r.checkIn), checkOut = text(r.checkOut);
    if (!id || !isDay(checkIn) || !isDay(checkOut)) continue;
    out.set(id, { reservationId: id, checkIn, checkOut, channel: text(r.channel) || null, guestName: text(r.guestName) || null });
  }
  return out;
}

const isDay = (v: string) => /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v.slice(0, 10) + 'T00:00:00Z'));
// Whole nights from check-in to check-out, or null when either date is missing or the order is wrong.
export function nightsBetween(checkIn: string | null | undefined, checkOut: string | null | undefined): number | null {
  if (!checkIn || !checkOut || !isDay(checkIn) || !isDay(checkOut)) return null;
  const nights = Math.round((Date.parse(checkOut.slice(0, 10) + 'T00:00:00Z') - Date.parse(checkIn.slice(0, 10) + 'T00:00:00Z')) / 86_400_000);
  return nights > 0 ? nights : null;
}
const nightsWords = (n: number) => `${n} ${n === 1 ? 'night' : 'nights'}`;

export function directBookingTrackerItem(work: OperationView, ctx: DirectBookingContext): TrackerItem<OperationView> {
  const property = ctx.property(work.propertyId), address = addressOf(property) || 'Unknown property', propertyName = property?.name?.trim() || address;
  const phase = text(work.data.phase), declined = phase === 'declined';
  const done = phase === 'confirmed' || (work.status === 'completed' && phase !== 'declined');
  // Cancelled with no answer recorded: the stay changed, so the follow-up was closed for it.
  const cancelled = work.status === 'cancelled' && !declined, closed = done || declined || cancelled;
  const reached = done ? 3 : declined ? 2 : cancelled ? 0 : LAST_DONE[phase] ?? 0;

  // The stay: from the schedule when it is loaded, else from the offer's own dates once one is made.
  const stay = ctx.stays?.get(text(work.data.reservationId)) ?? null;
  const checkIn = stay?.checkIn ?? text(work.data.checkIn), checkOut = stay?.checkOut ?? text(work.data.checkOut);
  const nights = nightsBetween(checkIn, checkOut);
  const stayText = isDay(checkIn) && isDay(checkOut) ? `${formatDay(checkIn, ctx.now)} to ${formatDay(checkOut, ctx.now)}` : '';
  // Owners are never shown guest names or staff names (they do not use this section; this is the belt to the braces).
  const guest = ctx.owner ? '' : stay?.guestName ?? '';
  const title = [guest || (stayText ? 'Stay' : ''), stayText, nights ? nightsWords(nights) : ''].filter(Boolean).join(' · ') || work.title || 'Direct booking follow-up';
  const channel = stay?.channel ? CHANNEL[stay.channel] ?? '' : '';

  const quote = money(work.data.quoteAmountMinor);
  const detailOf = (i: number) => {
    if (i === 0) return work.createdAt ? 'Raised ' + formatDay(work.createdAt.slice(0, 10), ctx.now) : undefined;
    if (i === 1) return quote ? 'Offer ' + quote : undefined;
    if (i === 2) return declined ? 'The guest declined the offer' : quote ? 'Guest agreed at ' + quote : 'Guest agreed';
    if (i === 3) return 'Booking confirmed';
    return undefined;
  };
  const steps: TrackerStep[] = STEPS.map((s, i) => {
    const state: TrackerStep['state'] = i <= reached ? 'done' : closed ? 'skipped' : i === reached + 1 ? 'current' : 'todo';
    const label = i === 2 ? (declined ? 'Declined' : reached >= 2 ? 'Agreed' : s.label) : s.label;
    const detail = state === 'done' ? detailOf(i) : undefined;
    return { key: s.key, label, state, ...(detail ? { detail } : {}), ...(s.actionKey ? { actionKey: s.actionKey } : {}) };
  });

  const next = NEXT[phase] ?? NEXT.follow_up;
  const form = ctx.forms(work).find(f => f.key === next.actionKey);
  const status = cancelled ? { label: 'Cancelled', tone: 'bad' as TrackerTone } : done ? STATUS.confirmed : STATUS[phase] ?? STATUS.follow_up;
  const details: Detail[] = [];
  const add = (label: string, value: string, tone?: Detail['tone']) => { if (value) details.push({ label, value, ...(tone ? { tone } : {}) }); };
  add('Guest', guest);
  add('Stay', stayText);
  add('Nights', nights ? String(nights) : '');
  add('Booked through', channel);
  add('Original price', money(work.data.baseAmountMinor));
  add('Direct-booking offer', quote, 'good');
  if (declined) add('What the guest said', text(work.data.reason));
  if (cancelled) add('Outcome', 'Closed because the stay changed');
  const update = lastUpdateOf(work);
  return {
    id: work.workId, section: 'direct_bookings', source: ctx.owner ? { ...work, updatedBy: null } : work, propertyId: work.propertyId || null, address, propertyName, title,
    status, closed,
    nextStep: cancelled ? 'Cancelled, the stay changed' : declined ? 'Closed, the guest declined the offer' : done ? 'Nothing more to do' : next.step,
    nextAction: closed ? null : form?.unavailable ? { label: form.unavailable } : nextActionOf(form ? [form] : [], next.waitingOn),
    // Owners never see who made the change, even if the data carried a name.
    lastUpdate: update && ctx.owner ? { ...update, by: null } : update,
    progress: progressOf(steps), steps, details, workId: work.workId, version: work.version,
    search: [address, propertyName, title, status.label, closed ? '' : next.step, guest, channel].filter(Boolean).join(' '),
  };
}

// Every direct-booking follow-up in the list as tracker items, in tracker order.
export function directBookingTrackerItems(work: readonly OperationView[], ctx: DirectBookingContext): TrackerItem<OperationView>[] {
  return sortTracker(work.filter(w => w.kind === DIRECT_BOOKING_KIND).map(w => directBookingTrackerItem(w, ctx)));
}
