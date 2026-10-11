import { env } from 'cloudflare:workers';
import { securityRpc } from './auth-security';
import { boundedJson } from './auth-security-policy';
import { businessResponse } from './business-server';
import {
  fetchHostawayListing, fetchHostawayListings, fetchHostawayReservation, fetchHostawayReservations, hostawaySyncErrorMessage, isHostawayConfigured,
} from './hostaway';
import { syncListing, syncReservation, webhookReservationId, type SyncListing, type SyncReservation } from './hostaway-sync-policy';

// Hostaway -> Recharge. Runs every 15 minutes from the Worker's cron, on each Hostaway
// webhook (one reservation), and when an admin presses "Sync now". Writes go through the
// service-role-only database function workspace_hostaway_sync, which does all the checks.
export type SyncTrigger = 'schedule' | 'webhook' | 'manual';
export type SyncSummary = {
  createdProperties: number; linkedProperties: number; newReservations: number; changedReservations: number;
  newCleans: number; movedCleans: number; cancelledCleans: number; problems: Array<{ problem: string; listingId?: string; reservationId?: string }>;
};

const londonDay = (offsetDays: number) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date(Date.now() + offsetDays * 86_400_000));
const present = <T,>(value: T | null): value is T => value !== null;

// The sync runs only when its keys are set and it is switched on (HOSTAWAY_SYNC_ENABLED=true).
export const hostawaySyncConfigured = () => isHostawayConfigured() && String((env as unknown as Record<string, string | undefined>).HOSTAWAY_SYNC_ENABLED || '') === 'true';

async function recordFailure(trigger: SyncTrigger, error: unknown) {
  try { await securityRpc('workspace_hostaway_sync_failed', { input: { trigger, error: hostawaySyncErrorMessage(error) } }); } catch { /* the next run retries */ }
}

function sync(trigger: SyncTrigger, listings: SyncListing[], reservations: SyncReservation[]) {
  return securityRpc<SyncSummary>('workspace_hostaway_sync', { input: { trigger, listings: listings.slice(0, 1000), reservations: reservations.slice(0, 5000) } });
}

// Everything: all listings, and every stay checking out from 30 days ago onwards.
export async function runHostawaySync(trigger: SyncTrigger): Promise<SyncSummary> {
  try {
    const [listings, reservations] = await Promise.all([fetchHostawayListings(), fetchHostawayReservations(londonDay(-30))]);
    return await sync(trigger, listings.map(syncListing).filter(present), reservations.map(syncReservation).filter(present));
  } catch (error) {
    await recordFailure(trigger, error);
    throw error;
  }
}

// One reservation, fetched fresh from Hostaway (never trusting the webhook body), with its listing.
export async function syncHostawayReservation(id: string): Promise<SyncSummary | null> {
  try {
    const reservation = syncReservation(await fetchHostawayReservation(id));
    if (!reservation) return null;
    const listing = syncListing(await fetchHostawayListing(reservation.listingId));
    return await sync('webhook', listing ? [listing] : [], [reservation]);
  } catch (error) {
    await recordFailure('webhook', error);
    throw error;
  }
}

// Hostaway's unified webhook. It proves itself with the HOSTAWAY_WEBHOOK_SECRET Worker secret:
// either as HTTP Basic authentication (login "recharge"), or, where Hostaway's webhook form has
// no login and password, as the key in the webhook address (…/api/hostaway/webhook?key=<secret>).
// The body is never trusted either way: the reservation is fetched fresh from Hostaway.
async function sameSecret(a: string, b: string) {
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  const [x, y] = await Promise.all([digest(a), digest(b)]);
  return x.every((byte, i) => byte === y[i]);
}
export async function hostawayWebhookRoute(request: Request) {
  const secret = String((env as unknown as Record<string, string | undefined>).HOSTAWAY_WEBHOOK_SECRET || '');
  // Switched off: acknowledge so Hostaway stops retrying, and change nothing.
  if (!hostawaySyncConfigured()) return businessResponse({ ok: true, ignored: true });
  if (secret.length < 24) return businessResponse({ error: 'The Hostaway webhook is not set up yet' }, 503);
  const header = request.headers.get('authorization') || '';
  let credentials = '';
  try { credentials = header.startsWith('Basic ') ? atob(header.slice(6).trim()) : ''; } catch { credentials = ''; }
  const key = new URL(request.url).searchParams.get('key');
  const authorised = key !== null ? await sameSecret(key, secret) : await sameSecret(credentials, `recharge:${secret}`);
  if (!authorised) return businessResponse({ error: 'Not authorised' }, 401);
  const id = webhookReservationId(await boundedJson(request, 262_144));
  // Other events (messages, listings) are acknowledged so Hostaway doesn't retry them.
  if (!id) return businessResponse({ ok: true, ignored: true });
  try {
    const summary = await syncHostawayReservation(id);
    return businessResponse({ ok: true, synced: Boolean(summary) });
  } catch {
    // Hostaway retries; the 15-minute sync is the backstop either way.
    return businessResponse({ error: 'Sync failed; it will be retried' }, 503);
  }
}
