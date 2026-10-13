import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { GUEST_CHANNELS, OFFERED_CHANNELS, CHANNEL_LABEL, inboxActionSchema, guestThreadSchema } = await vite.ssrLoadModule('/lib/guest-inbox-policy.ts');
const inbox = readFileSync('mobile/src/LiveGuestInbox.tsx', 'utf8');
const chat = readFileSync('mobile/src/LiveChat.tsx', 'utf8');
const policy = readFileSync('lib/guest-inbox-policy.ts', 'utf8');

test('WhatsApp is not offered, but stored WhatsApp threads still work', () => {
  assert.ok(!OFFERED_CHANNELS.includes('whatsapp'));
  assert.ok(GUEST_CHANNELS.includes('whatsapp'));
  assert.equal(CHANNEL_LABEL.whatsapp, 'WhatsApp');
  assert.deepEqual(OFFERED_CHANNELS, GUEST_CHANNELS.filter(c => c !== 'whatsapp'));
  for (const c of ['airbnb', 'booking_com', 'vrbo', 'direct', 'email', 'other']) assert.ok(OFFERED_CHANNELS.includes(c), c);
  const id = '11111111-1111-4111-8111-111111111111';
  assert.ok(inboxActionSchema.safeParse({ action: 'logMessage', requestId: id, channel: 'whatsapp', guestName: 'Old guest', body: 'Hi' }).success);
  assert.ok(guestThreadSchema.safeParse({ id, source: 'manual', channel: 'whatsapp', guestName: null, propertyId: null, propertyName: null, reservationRef: null, checkIn: null, checkOut: null, status: 'open', lastMessageAt: null, preview: null, lastFrom: null, waitingSince: null, messages: 0 }).success);
});

test('the guest inbox builds its channel choices from OFFERED_CHANNELS', () => {
  assert.match(inbox, /values=\{OFFERED_CHANNELS\}/);
  assert.doesNotMatch(inbox, /values=\{GUEST_CHANNELS\}/);
  assert.doesNotMatch(inbox, /connect(ing)? (to )?WhatsApp|WhatsApp (is )?(not )?connected/i);
});

// Round 5: Updates is no longer a tab; a link to it opens the feed in place (tests/messages-redesign.test.mjs).
test('Messages takes the Updates feed for its links, with no Updates tab, and no looping motion', () => {
  assert.match(chat, /updates\?: ReactNode/);
  assert.doesNotMatch(chat, /"updates" as const/);
  assert.doesNotMatch(chat, /\b(Entrance|SwapIn|Pop|Shimmer|Float|Stagger)\b/);
  assert.doesNotMatch(chat, /WhatsApp/i);
});

test('no em dashes in the files of this package', () => {
  for (const text of [inbox, chat, policy]) assert.ok(!text.includes('—'));
});
