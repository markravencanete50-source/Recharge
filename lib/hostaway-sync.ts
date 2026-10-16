import { env } from 'cloudflare:workers';
import { securityRpc } from './auth-security';
import { boundedJson } from './auth-security-policy';
import { businessResponse } from './business-server';
import {
  fetchHostawayConversation, fetchHostawayConversationMessages, fetchHostawayConversations, fetchHostawayListing, fetchHostawayListings, fetchHostawayReservation,
  fetchHostawayReservations, fetchHostawayReviews, hostawaySyncErrorMessage, isHostawayConfigured,
} from './hostaway';
import { syncConversation, syncMessage, webhookConversationId, type SyncConversation, type SyncMessage } from './hostaway-messages-policy';
import { syncListing, syncReservation, webhookReservationId, type SyncListing, type SyncReservation } from './hostaway-sync-policy';
import { REVIEW_PAGES, reviewBatches, syncReview } from './hostaway-reviews-policy';

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

// Guest reviews, for each property's ratings (20261022500000). Hourly from the Worker's cron, straight after that tick's
// sync (so the two never ask Hostaway at once), and after an admin's "Sync now". Every review Hostaway lists, up to
// REVIEW_PAGES pages of 100, mapped by lib/hostaway-reviews-policy.ts and stored in batches through the service-role-only
// workspace_hostaway_reviews_ingest, which only inserts or updates (never deletes) and links each review to the property
// with its listing. A review whose listing is not linked to a property is kept, unlinked. A failure is recorded on its own,
// so it never overwrites the reservation sync's last error, and the next run retries.
export type ReviewsSummary = { added: number; changed: number; unchanged: number; fetched: number; complete: boolean; paused: boolean };
type ReviewBatchResult = { added: number; changed: number; unchanged: number; paused: boolean };

export async function runHostawayReviews(trigger: 'schedule' | 'manual'): Promise<ReviewsSummary | null> {
  if (!hostawaySyncConfigured()) return null;
  try {
    const { rows, complete } = await fetchHostawayReviews(REVIEW_PAGES);
    const batches = reviewBatches(rows.map(syncReview).filter(present));
    const summary: ReviewsSummary = { added: 0, changed: 0, unchanged: 0, fetched: rows.length, complete, paused: false };
    for (let i = 0; i < batches.length; i++) {
      const done = i === batches.length - 1;
      const result = await securityRpc<ReviewBatchResult>('workspace_hostaway_reviews_ingest', { input: { trigger, reviews: batches[i], done, complete: done ? complete : true } });
      if (result.paused) return { ...summary, paused: true };
      summary.added += result.added; summary.changed += result.changed; summary.unchanged += result.unchanged;
    }
    return summary;
  } catch (error) {
    try { await securityRpc('workspace_hostaway_reviews_failed', { input: { trigger, error: hostawaySyncErrorMessage(error) } }); } catch { /* the next run retries */ }
    throw error;
  }
}

// Guest messages, read only. Every minute from the Worker's cron, and on each message webhook
// (one conversation). The newest 100 conversations come in one request; only those that changed since
// last time (the database compares each one's latest-activity marker) have their messages fetched, at
// most 25 a run so Hostaway's rate limit is respected. Everything goes through the service-role-only
// workspace_hostaway_messages_ingest, which keeps 14 days and refuses while the sync is paused.
// Message problems are logged and retried next run; they never overwrite the reservation sync's last error.
export type MessagesSummary = { added: number; conversations: number };
const MESSAGE_DAYS = 14, MAX_FETCHED = 25;
const messageWindow = () => new Date(Date.now() - MESSAGE_DAYS * 86_400_000).toISOString();
type ConversationWithMessages = SyncConversation & { messages: SyncMessage[] };

async function conversationMessages(conversation: SyncConversation): Promise<ConversationWithMessages> {
  const since = messageWindow();
  const messages = (await fetchHostawayConversationMessages(conversation.id)).map(syncMessage).filter((m): m is SyncMessage => m !== null && m.sentAt >= since)
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt)).slice(-300);
  return { ...conversation, messages };
}
function ingestMessages(conversations: ConversationWithMessages[]) {
  return securityRpc<MessagesSummary>('workspace_hostaway_messages_ingest', { input: { conversations: conversations.slice(0, 100).map(c => ({
    id: c.id, listingId: c.listingId, reservationId: c.reservationId, guestName: c.guestName, checkIn: c.checkIn, checkOut: c.checkOut, channel: c.channel, marker: c.marker, messages: c.messages,
  })) } });
}

export async function runHostawayMessages(trigger: SyncTrigger): Promise<MessagesSummary | null> {
  if (!hostawaySyncConfigured()) return null;
  const since = messageWindow();
  // Newest activity first, whatever order Hostaway gave them; conversations quiet for 14 days have nothing to bring in.
  const recent = (await fetchHostawayConversations(1)).map(syncConversation).filter(present)
    .filter(c => !c.activityAt || c.activityAt >= since).sort((a, b) => (b.activityAt ?? '').localeCompare(a.activityAt ?? '')).slice(0, 100);
  if (!recent.length) return { added: 0, conversations: 0 };
  const { due, paused } = await securityRpc<{ due: string[]; paused: boolean }>('workspace_hostaway_conversations_due', { input: { conversations: recent.map(c => ({ id: c.id, marker: c.marker })) } });
  if (paused || !due.length) return { added: 0, conversations: 0 };
  const wanted = new Set(due);
  const fetched: ConversationWithMessages[] = [];
  let failure: unknown = null;
  // One at a time (Hostaway limits requests). What was fetched before a failure is still kept.
  for (const conversation of recent.filter(c => wanted.has(c.id)).slice(0, MAX_FETCHED)) {
    try { fetched.push(await conversationMessages(conversation)); } catch (error) { failure = error; break; }
  }
  const summary = fetched.length ? await ingestMessages(fetched) : { added: 0, conversations: 0 };
  if (failure) { console.error(`Hostaway messages (${trigger}) stopped early: ${hostawaySyncErrorMessage(failure)}`); throw failure; }
  return summary;
}

// One conversation, fetched fresh from Hostaway (never trusting the webhook body).
export async function syncHostawayConversation(id: string): Promise<MessagesSummary | null> {
  if (!hostawaySyncConfigured()) return null;
  const conversation = syncConversation(await fetchHostawayConversation(id));
  if (!conversation) return null;
  return await ingestMessages([await conversationMessages(conversation)]);
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
  const body = await boundedJson(request, 262_144);
  const id = webhookReservationId(body);
  if (!id) {
    // A new guest message: that conversation's messages are fetched. Other events (listings) are
    // acknowledged so Hostaway doesn't retry them.
    const conversationId = webhookConversationId(body);
    if (!conversationId) return businessResponse({ ok: true, ignored: true });
    try {
      const summary = await syncHostawayConversation(conversationId);
      return businessResponse({ ok: true, synced: Boolean(summary) });
    } catch {
      // Hostaway retries; the next minute's run is the backstop either way.
      return businessResponse({ error: 'Message sync failed; it will be retried' }, 503);
    }
  }
  try {
    const summary = await syncHostawayReservation(id);
    return businessResponse({ ok: true, synced: Boolean(summary) });
  } catch {
    // Hostaway retries; the 15-minute sync is the backstop either way.
    return businessResponse({ error: 'Sync failed; it will be retried' }, 503);
  }
}
