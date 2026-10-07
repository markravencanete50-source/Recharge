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

// What the platform pays out (the client's choice): Airbnb's own expected payout when Hostaway
// has it, otherwise the guest total less the platform's commission and host fee. Only in pounds;
// anything else is left for Accounts to fill in.
export function syncPayoutMinor(r: Raw, channel: SyncChannel): number | null {
  const currency = text(r.currency).toUpperCase();
  if (currency && currency !== 'GBP') return null;
  const airbnb = number(r.airbnbExpectedPayoutAmount);
  if (channel === 'airbnb' && airbnb !== null && airbnb > 0) return Math.round(airbnb * 100);
  const total = number(r.totalPrice);
  if (total === null || total <= 0) return null;
  const fees = (number(r.channelCommissionAmount) ?? 0) + (number(r.hostChannelFee) ?? 0);
  const payout = total - Math.max(0, fees);
  return payout >= 0 ? Math.round(payout * 100) : null;
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
  return {
    id, listingId, checkIn, checkOut, status, channel,
    channelReference: owner ? 'Owner stay' : first(r.channelReservationId, r.confirmationCode, r.reservationId).slice(0, 120) || null,
    guests: guests !== null && guests >= 1 && guests <= 50 ? Math.round(guests) : null,
    payoutMinor: owner ? 0 : syncPayoutMinor(r, channel),
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
});
export type HostawayStatus = z.infer<typeof hostawayStatusSchema>;
