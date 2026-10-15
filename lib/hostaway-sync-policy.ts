import { z } from 'zod';

// How Hostaway's records map onto Recharge for the sync (lib/hostaway-sync.ts) and the
// database function workspace_hostaway_sync. Pure, so it is unit-tested against sample payloads.

type Raw = Record<string, unknown>;
const text = (value: unknown) => typeof value === 'string' ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
const first = (...values: unknown[]) => values.map(text).find(Boolean) ?? '';
const number = (value: unknown) => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
};
const object = (value: unknown): Raw => value && typeof value === 'object' && !Array.isArray(value) ? value as Raw : {};
const date = /^\d{4}-\d{2}-\d{2}$/;

export type SyncListing = { id: string; name: string; address: string; bedrooms: number; accessInfo: string };
export type SyncChannel = 'airbnb' | 'booking_com' | 'vrbo' | 'direct' | 'other';
export type SyncReservation = {
  id: string; listingId: string; checkIn: string; checkOut: string; status: 'confirmed' | 'enquiry' | 'cancelled';
  channel: SyncChannel; channelReference: string | null; guests: number | null; payoutMinor: number | null;
  // What the expected payout was worked out from (null when the stay is not in pounds, or is an owner stay).
  payoutBreakdown: PayoutBreakdown | null;
  // The stay's check-in and checkout times ("15:00"), when Hostaway gives them; only present then (migration 20261021500000).
  checkInTime?: string; checkOutTime?: string;
  // Booking detail for Reports > Guests & stays (20261021600000). Null for an owner stay; each field null when Hostaway did not say.
  stayDetails: StayDetails | null;
};

export function syncListing(raw: unknown): SyncListing | null {
  const l = object(raw);
  const id = first(l.id, l.listingMapId);
  if (!id) return null;
  const address = [first(l.address, l.street), first(l.city), first(l.zipcode, l.zipCode, l.postcode)].filter(Boolean)
    .filter((part, i, all) => !all.slice(0, i).some(prev => prev.toLowerCase().includes(part.toLowerCase()))).join(', ');
  const code = first(l.doorSecurityCode, l.keyCode, l.accessCode);
  const instructions = first(l.checkInInstructions, l.checkinInstructions, l.accessInstructions, l.keyPickup);
  return {
    id,
    name: first(l.internalListingName, l.name, l.externalListingName).slice(0, 200),
    address: address.slice(0, 1000),
    bedrooms: Math.min(100, Math.max(0, Math.round(number(l.bedroomsNumber ?? l.bedrooms) ?? 0))),
    accessInfo: [code && `Door code: ${code}`, instructions].filter(Boolean).join('\n').slice(0, 5000),
  };
}

// Hostaway channel names, e.g. airbnbOfficial, bookingcom, homeaway, vrboical, direct, bookingengine.
export function syncChannel(name: string): SyncChannel {
  const n = name.toLowerCase().replace(/[^a-z]/g, '');
  if (n.includes('airbnb')) return 'airbnb';
  if (n.includes('bookingcom')) return 'booking_com';
  if (n.includes('vrbo') || n.includes('homeaway')) return 'vrbo';
  if (!n || ['direct', 'website', 'bookingengine', 'manual', 'hostaway'].some(d => n.includes(d))) return 'direct';
  return 'other';
}

const CONFIRMED = ['new', 'modified', 'confirmed', 'ownerstay'];
const CANCELLED = ['cancelled', 'canceled', 'declined', 'expired', 'inquirydenied', 'inquirytimedout', 'inquirynotpossible'];
const ENQUIRY = ['inquiry', 'enquiry', 'inquirypreapproved', 'pending', 'awaitingpayment', 'unconfirmed'];

// --- The expected payout and its fees --------------------------------------------------------------------
// Every Hostaway field name the payout is worked out from. All but two are in Hostaway's public API reference
// (github.com/Hostaway/api: the reservation object, the finance field object and the finance standard fields):
// - On the reservation: currency, totalPrice, airbnbExpectedPayoutAmount, channelCommissionAmount and financeField
//   (the itemised lines). hostChannelFee is read on the reservation as before, though the reference lists it only as a
//   finance field.
// - On each financeField line: name, title, total (value when total is missing), isIncludedInTotalPrice, isDeleted.
// - Line names: hostChannelFee (the channel's commission, not in the total), guestChannelFee (the guest's fee to the
//   channel, which the channel keeps when it is in the total), otaPaymentProcessingFee and
//   paymentServiceProcessingFee(s) (payment charges), cleaningFee or cleaningFeeValue, and cityTax.
// - VAT on the commission has no standard name. It is taken from a line whose name or title says both "VAT" and
//   "commission" (an assumption: check a real Booking.com response).
// The list fetch asks for includeResources=1 so the lines come with each reservation.
export const HOSTAWAY_PAYOUT_FIELDS = {
  currency: 'currency', total: 'totalPrice', airbnbPayout: 'airbnbExpectedPayoutAmount',
  commission: 'channelCommissionAmount', hostFee: 'hostChannelFee', lines: 'financeField',
} as const;
export const HOSTAWAY_LINE_FIELDS = { name: 'name', title: 'title', total: 'total', value: 'value', included: 'isIncludedInTotalPrice', deleted: 'isDeleted' } as const;
export const HOSTAWAY_LINE_NAMES = {
  commission: ['hostChannelFee'],
  guestFee: ['guestChannelFee'],
  paymentCharge: ['otaPaymentProcessingFee', 'paymentServiceProcessingFee', 'paymentServiceProcessingFees'],
  cleaningFee: ['cleaningFee', 'cleaningFeeValue'],
  cityTax: ['cityTax'],
} as const;

// Pence, each a positive amount; null when Hostaway did not say. `source`: Airbnb's own expected payout, the itemised
// lines, or the totals alone (today's sum: the total less channelCommissionAmount and hostChannelFee).
export type PayoutBreakdown = {
  source: 'airbnb' | 'itemised' | 'totals';
  grossMinor: number | null; commissionMinor: number | null; guestFeeMinor: number | null; paymentChargeMinor: number | null;
  commissionVatMinor: number | null; cleaningFeeMinor: number | null; cityTaxMinor: number | null;
};
const pence = (pounds: number) => Math.round(pounds * 100);
type Line = { name: string; title: string; minor: number; included: boolean };
function financeLines(r: Raw): Line[] {
  const raw = r[HOSTAWAY_PAYOUT_FIELDS.lines];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap(item => {
    const l = object(item);
    if (number(l[HOSTAWAY_LINE_FIELDS.deleted]) === 1 || l[HOSTAWAY_LINE_FIELDS.deleted] === true) return [];
    const amount = number(l[HOSTAWAY_LINE_FIELDS.total]) ?? number(l[HOSTAWAY_LINE_FIELDS.value]);
    const name = text(l[HOSTAWAY_LINE_FIELDS.name]);
    if (amount === null || !name) return [];
    const included = l[HOSTAWAY_LINE_FIELDS.included];
    return [{ name: name.toLowerCase(), title: text(l[HOSTAWAY_LINE_FIELDS.title]).toLowerCase(), minor: Math.abs(pence(amount)), included: included === 1 || included === true || included === '1' }];
  });
}
// The sum of the lines with one of these names, or null when there is none.
function sumOf(lines: Line[], names: readonly string[], test?: (l: Line) => boolean): number | null {
  const wanted = names.map(n => n.toLowerCase());
  const found = lines.filter(l => test ? test(l) : wanted.includes(l.name));
  return found.length ? found.reduce((sum, l) => sum + l.minor, 0) : null;
}
// "VAT on commission", "vatOnCommission", "commissionVat": both words, VAT as a word or joined to "commission".
const isCommissionVat = (l: Line) => {
  const s = l.name + ' ' + l.title;
  return s.includes('commission') && /(^|[^a-z])vat([^a-z]|on|of|$)|commissionvat/.test(s);
};

// What the platform pays out (the client's choice). Airbnb: Airbnb's own expected payout when Hostaway has it. Otherwise
// the guest total less what the channel keeps: its commission, a guest fee it keeps, payment charges and VAT on the
// commission, from the itemised lines where Hostaway gives them. With no lines it is today's sum exactly, so nothing gets
// worse when a field is missing. Only in pounds; anything else is left for Accounts to fill in.
export function syncPayout(r: Raw, channel: SyncChannel): { payoutMinor: number | null; breakdown: PayoutBreakdown | null } {
  const currency = text(r[HOSTAWAY_PAYOUT_FIELDS.currency]).toUpperCase();
  if (currency && currency !== 'GBP') return { payoutMinor: null, breakdown: null };
  const lines = financeLines(r);
  const total = number(r[HOSTAWAY_PAYOUT_FIELDS.total]);
  const itemisedCommission = sumOf(lines, HOSTAWAY_LINE_NAMES.commission);
  const guestFeeLines = lines.filter(l => (HOSTAWAY_LINE_NAMES.guestFee as readonly string[]).map(n => n.toLowerCase()).includes(l.name) && l.included);
  const guestFee = guestFeeLines.length ? guestFeeLines.reduce((sum, l) => sum + l.minor, 0) : null;
  const paymentCharge = sumOf(lines, HOSTAWAY_LINE_NAMES.paymentCharge);
  const commissionVat = sumOf(lines, [], isCommissionVat);
  const topCommission = number(r[HOSTAWAY_PAYOUT_FIELDS.commission]), topHostFee = number(r[HOSTAWAY_PAYOUT_FIELDS.hostFee]);
  const totalsCommission = topCommission === null && topHostFee === null ? null : Math.max(0, pence((topCommission ?? 0) + (topHostFee ?? 0)));
  const itemised = [itemisedCommission, guestFee, paymentCharge, commissionVat].some(v => v !== null);
  const commission = itemisedCommission ?? totalsCommission;
  const airbnb = number(r[HOSTAWAY_PAYOUT_FIELDS.airbnbPayout]);
  const useAirbnb = channel === 'airbnb' && airbnb !== null && airbnb > 0;
  const breakdown: PayoutBreakdown = {
    source: useAirbnb ? 'airbnb' : itemised ? 'itemised' : 'totals',
    grossMinor: total !== null && total > 0 ? pence(total) : null,
    commissionMinor: commission, guestFeeMinor: guestFee, paymentChargeMinor: paymentCharge, commissionVatMinor: commissionVat,
    cleaningFeeMinor: sumOf(lines, HOSTAWAY_LINE_NAMES.cleaningFee), cityTaxMinor: sumOf(lines, HOSTAWAY_LINE_NAMES.cityTax),
  };
  if (useAirbnb) return { payoutMinor: pence(airbnb), breakdown };
  if (total === null || total <= 0) return { payoutMinor: null, breakdown };
  const payout = pence(total) - (commission ?? 0) - (guestFee ?? 0) - (paymentCharge ?? 0) - (commissionVat ?? 0);
  return { payoutMinor: payout >= 0 ? payout : null, breakdown };
}
export const syncPayoutMinor = (r: Raw, channel: SyncChannel): number | null => syncPayout(r, channel).payoutMinor;

// --- Booking detail for Guests & stays ---------------------------------------------------------------------
// Every Hostaway field name read for the report, first match wins. Taken from Hostaway's reservation object as other code
// here already reads it (lib/hostaway.ts reads adults/numberOfAdults, children/numberOfChildren, infants/numberOfInfants)
// and from Hostaway's public API reference. Assumptions to check against a real response:
// - pets is a count, like adults. numberOfPets is read as well in case it is named like the others.
// - guestCountry is the guest's country as Hostaway gives it: a two-letter code (kept in capitals) or a country name.
//   Only the country is read; never the guest's address, city, postcode, phone or email.
// - reservationDate is when the guest booked ("YYYY-MM-DD HH:MM:SS", UTC like Hostaway's other times). insertedOn, when
//   Hostaway recorded the booking, is the fallback; for a booking imported into Hostaway later it can be later than the real
//   booking, so the lead time can read short.
// Planned check-in and checkout times are not here: the cleaner flow (20261021500000, syncClock below) already keeps
// Hostaway's checkInTime and checkOutTime on the stay (check_in_time, check_out_time).
export const HOSTAWAY_STAY_FIELDS = {
  adults: ['adults', 'numberOfAdults'], children: ['children', 'numberOfChildren'], infants: ['infants', 'numberOfInfants'], pets: ['pets', 'numberOfPets'],
  guestCountry: ['guestCountry'], bookedAt: ['reservationDate', 'insertedOn'],
} as const;
export type StayDetails = {
  adults: number | null; children: number | null; infants: number | null; pets: number | null;
  guestCountry: string | null; bookedAt: string | null;
};
const pick = (r: Raw, keys: readonly string[]) => keys.map(k => r[k]).find(v => v !== undefined && v !== null && v !== '');
// A head count from 0 to 50, else unknown.
function headCount(value: unknown): number | null {
  const n = number(value);
  return n !== null && n >= 0 && n <= 50 && Number.isInteger(n) ? n : null;
}
// A country code or name only: letters, spaces and a few marks, 2 to 60 characters. Anything else is not stored.
function country(value: unknown): string | null {
  const t = text(value).replace(/\s+/g, ' ');
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  return /^\p{L}[\p{L} .'()-]{2,59}$/u.test(t) ? t : null;
}
// "2026-10-12 09:30:00" (UTC), an ISO time with a zone, or a bare day -> ISO UTC; null when it cannot be read.
function bookedTime(value: unknown): string | null {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2})(?::(\d{2}))?(?:\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?)?$/i.exec(text(value));
  if (!m) return null;
  const zone = !m[4] || m[4].toUpperCase() === 'Z' ? 'Z' : m[4].replace(/^([+-]\d{2})(\d{2})$/, '$1:$2');
  const at = new Date(`${m[1]}T${m[2] ?? '00:00'}:${m[3] ?? '00'}${zone}`);
  return Number.isNaN(at.getTime()) ? null : at.toISOString().replace(/\.\d{3}Z$/, 'Z');
}
export function syncStayDetails(r: Raw): StayDetails {
  const f = HOSTAWAY_STAY_FIELDS;
  return {
    adults: headCount(pick(r, f.adults)), children: headCount(pick(r, f.children)), infants: headCount(pick(r, f.infants)), pets: headCount(pick(r, f.pets)),
    guestCountry: country(pick(r, f.guestCountry)), bookedAt: bookedTime(pick(r, f.bookedAt)),
  };
}

// Hostaway's checkInTime and checkOutTime: an hour (15) or a clock ("15:30"), as "HH:MM"; null for anything else.
export function syncClock(value: unknown): string | null {
  const t = text(value);
  const m = /^(\d{1,2})(?::(\d{2}))?(?::\d{2})?$/.exec(t);
  if (!m) return null;
  const hour = Number(m[1]), minute = Number(m[2] ?? 0);
  return hour <= 23 && minute <= 59 ? `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` : null;
}

export function syncReservation(raw: unknown): SyncReservation | null {
  const r = object(raw);
  const id = first(r.id, r.hostawayReservationId);
  const listingId = first(r.listingMapId, r.listingId);
  const checkIn = first(r.arrivalDate).slice(0, 10), checkOut = first(r.departureDate).slice(0, 10);
  const state = first(r.status).toLowerCase().replace(/[^a-z]/g, '');
  const status = CONFIRMED.includes(state) ? 'confirmed' : CANCELLED.includes(state) ? 'cancelled' : ENQUIRY.includes(state) ? 'enquiry' : null;
  // Unknown states never block or free a property's calendar.
  if (!id || !listingId || !status || !date.test(checkIn) || !date.test(checkOut) || checkOut <= checkIn) return null;
  const owner = state === 'ownerstay';
  const channel = owner ? 'other' : syncChannel(first(r.channelName, r.source));
  const guests = number(r.numberOfGuests) ?? ((number(r.adults) ?? 0) + (number(r.children) ?? 0) || null);
  const payout = owner ? { payoutMinor: 0, breakdown: null } : syncPayout(r, channel);
  const checkInTime = syncClock(r.checkInTime), checkOutTime = syncClock(r.checkOutTime);
  return {
    id, listingId, checkIn, checkOut, status, channel,
    channelReference: owner ? 'Owner stay' : first(r.channelReservationId, r.confirmationCode, r.reservationId).slice(0, 120) || null,
    guests: guests !== null && guests >= 1 && guests <= 50 ? Math.round(guests) : null,
    payoutMinor: payout.payoutMinor, payoutBreakdown: payout.breakdown,
    ...(checkInTime ? { checkInTime } : {}), ...(checkOutTime ? { checkOutTime } : {}),
    stayDetails: owner ? null : syncStayDetails(r),
  };
}

// Hostaway's unified webhook. Only the reservation id is used: the record itself is always
// fetched fresh from the Hostaway API, so a forged body can't write anything.
export const hostawayWebhookSchema = z.object({
  object: z.string().optional(),
  event: z.string().max(100).optional(),
  data: z.object({ id: z.union([z.string().min(1).max(100), z.number().int().positive()]) }).passthrough(),
}).passthrough();
export function webhookReservationId(body: unknown) {
  const parsed = hostawayWebhookSchema.safeParse(body);
  if (!parsed.success) return null;
  const { object: kind, event } = parsed.data;
  if (!(kind === 'reservation' || (event ?? '').startsWith('reservation'))) return null;
  return String(parsed.data.data.id);
}

export const hostawayStatusSchema = z.object({
  lastRunAt: z.string().nullable(), lastSuccessAt: z.string().nullable(),
  lastTrigger: z.enum(['schedule', 'webhook', 'manual']).nullable(), lastError: z.string().nullable(),
  problems: z.array(z.object({ listingId: z.string().optional(), reservationId: z.string().optional(), problem: z.string() })),
  lastSummary: z.record(z.string(), z.number()).or(z.object({})),
  canSync: z.boolean(), linkedProperties: z.number(), upcomingStays: z.number(), unassignedCleans: z.number(),
  // Paused while no channel manager is connected: the database refuses a sync.
  paused: z.boolean().default(false),
});
export type HostawayStatus = z.infer<typeof hostawayStatusSchema>;

// Double bookings: confirmed Hostaway stays that overlap another at the same property. Admins can
// cancel one from Recharge when Hostaway can (direct and Vrbo bookings); Airbnb and Booking.com
// bookings are cancelled on the channel, and the sync then brings the change in.
export const doubleBookingSchema = z.object({
  reservationId: z.string().uuid(), reference: z.string(), channel: z.enum(['airbnb', 'booking_com', 'vrbo', 'direct', 'other']).nullable(),
  checkIn: z.string(), checkOut: z.string(), guests: z.number().nullable(), payoutMinor: z.number().nullable(),
  propertyId: z.string().uuid(), propertyName: z.string(), canCancelInHostaway: z.boolean(), overlaps: z.array(z.string()).nullable(),
});
export type DoubleBooking = z.infer<typeof doubleBookingSchema>;
export const CHANNEL_NAMES: Record<string, string> = { airbnb: 'Airbnb', booking_com: 'Booking.com', vrbo: 'Vrbo', direct: 'Direct', other: 'Other channel' };
// Where to cancel a booking Hostaway cannot cancel.
export const CANCEL_ON_CHANNEL: Record<string, { label: string; url: string }> = {
  airbnb: { label: 'Airbnb reservations', url: 'https://www.airbnb.co.uk/hosting/reservations' },
  booking_com: { label: 'the Booking.com extranet', url: 'https://admin.booking.com' },
  other: { label: 'the Hostaway dashboard', url: 'https://dashboard.hostaway.com' },
};
export function cancelElsewhereMessage(channel: string | null) {
  const where = CANCEL_ON_CHANNEL[channel ?? 'other'] ?? CANCEL_ON_CHANNEL.other;
  return `${CHANNEL_NAMES[channel ?? 'other'] ?? 'This'} bookings can only be cancelled on the channel itself. Cancel it in ${where.label}; Recharge picks up the change at the next sync (within 15 minutes).`;
}
