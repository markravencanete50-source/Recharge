import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// How Hostaway's conversations, messages and message webhook map onto the Guest inbox (pure).
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const policy = await vite.ssrLoadModule('/lib/hostaway-messages-policy.ts');
after(async () => { await vite.close(); });

test('times without a zone are UTC; zones are honoured', () => {
  assert.equal(policy.hostawayTime('2026-10-12 09:30:00'), '2026-10-12T09:30:00.000Z');
  assert.equal(policy.hostawayTime('2026-10-12T09:30:00Z'), '2026-10-12T09:30:00.000Z');
  assert.equal(policy.hostawayTime('2026-10-12T10:30:00+01:00'), '2026-10-12T09:30:00.000Z');
  assert.equal(policy.hostawayTime('2026-10-12 10:30:00 +0100'), '2026-10-12T09:30:00.000Z');
  assert.equal(policy.hostawayTime('2026-10-12 09:30'), '2026-10-12T09:30:00.000Z');
  assert.equal(policy.hostawayTime('2026-10-12 09:30:00.250'), '2026-10-12T09:30:00.250Z');
  assert.equal(policy.hostawayTime('2026-10-12'), '2026-10-12T00:00:00.000Z');
  for (const bad of ['', null, undefined, 'yesterday', '2026-13-45 10:00:00', 1760000000, {}]) assert.equal(policy.hostawayTime(bad), null, String(bad));
});

test('a message maps to who sent it, its text and when', () => {
  const guest = { id: 5001, conversationId: 41, body: ' Hi, is early check-in possible? ', isIncoming: 1, status: 'sent', date: '2026-10-12 09:30:00' };
  assert.deepEqual(policy.syncMessage(guest), { id: '5001', incoming: true, body: 'Hi, is early check-in possible?', sentAt: '2026-10-12T09:30:00.000Z' });
  for (const incoming of [true, '1', 'true', 'TRUE']) assert.equal(policy.syncMessage({ ...guest, isIncoming: incoming }).incoming, true, String(incoming));
  for (const incoming of [0, false, '0', 'false', null, undefined, 2]) assert.equal(policy.syncMessage({ ...guest, isIncoming: incoming }).incoming, false, String(incoming));
  // The team's reply, including Hostaway's own automated messages, is a team message.
  assert.equal(policy.syncMessage({ ...guest, isIncoming: 0, body: 'Sent by Hostaway automated', status: 'delivered' }).incoming, false);
  assert.equal(policy.syncMessage({ ...guest, status: 'received' }).incoming, true);
  assert.equal(policy.syncMessage({ ...guest, status: '' }).sentAt, '2026-10-12T09:30:00.000Z');
  assert.equal(policy.syncMessage({ ...guest, status: undefined }).id, '5001');
  // The send time falls back to when Hostaway stored it.
  assert.equal(policy.syncMessage({ ...guest, date: null, insertedOn: '2026-10-12 11:00:00' }).sentAt, '2026-10-12T11:00:00.000Z');
  assert.equal(policy.syncMessage({ ...guest, date: null }), null, 'no time at all: skipped');
  assert.equal(policy.syncMessage({ ...guest, id: null }), null);
  assert.equal(policy.syncMessage({ ...guest, body: 'x'.repeat(6000) }).body.length, 5000);
});

test('messages that were never sent are skipped; a photo alone reads as (Photo)', () => {
  const base = { id: 1, body: 'Hello', isIncoming: 0, date: '2026-10-12 09:30:00' };
  for (const status of ['scheduled', 'failed', 'cancelled', 'canceled', 'Scheduled', ' FAILED ']) assert.equal(policy.syncMessage({ ...base, status }), null, status);
  for (const status of ['sent', 'delivered', 'received', '']) assert.ok(policy.syncMessage({ ...base, status }), status);
  assert.equal(policy.syncMessage({ ...base, body: '', imagesUrls: ['https://example.com/a.jpg'] }).body, '(Photo)');
  assert.equal(policy.syncMessage({ ...base, body: '  ', imagesUrls: 'https://example.com/a.jpg' }).body, '(Photo)');
  assert.equal(policy.syncMessage({ ...base, body: 'Look at this', imagesUrls: ['https://example.com/a.jpg'] }).body, 'Look at this');
  assert.equal(policy.syncMessage({ ...base, body: '', imagesUrls: [] }), null, 'nothing to show');
  assert.equal(policy.syncMessage({ ...base, body: null }), null);
});

test('a conversation maps to its listing, stay, guest, dates and platform', () => {
  const raw = { id: 41, listingMapId: 501, reservationId: 7001, recipientName: 'Alex Kim', arrivalDate: '2026-11-02', departureDate: '2026-11-05',
    messageReceivedOn: '2026-10-12 09:30:00', messageSentOn: '2026-10-12 09:45:00', Reservation: { id: 7001, channelName: 'airbnbOfficial', guestName: 'Someone Else' } };
  assert.deepEqual(policy.syncConversation(raw), { id: '41', listingId: '501', reservationId: '7001', guestName: 'Alex Kim', checkIn: '2026-11-02', checkOut: '2026-11-05',
    channel: 'airbnb', marker: '2026-10-12 09:30:00|2026-10-12 09:45:00', activityAt: '2026-10-12T09:45:00.000Z' });
  // Fall back through the embedded reservation for the guest and the dates.
  const embedded = policy.syncConversation({ id: 42, listingMapId: 502, Reservation: { id: 8, guestFirstName: 'Sam', guestLastName: 'Lee', arrivalDate: '2026-12-01 15:00:00', departureDate: '2026-12-03', channelName: 'bookingcom' } });
  assert.deepEqual([embedded.guestName, embedded.checkIn, embedded.checkOut, embedded.channel, embedded.reservationId], ['Sam Lee', '2026-12-01', '2026-12-03', 'booking_com', '8']);
  assert.equal(policy.syncConversation({ id: 43, Reservation: { guestName: 'Pat' } }).guestName, 'Pat');
  assert.equal(policy.syncConversation({ id: 43, guestName: 'Kim' }).guestName, 'Kim');
  // Nothing known: empty, not invented. The marker stays text so the database can compare it.
  const bare = policy.syncConversation({ id: 44, arrivalDate: 'soon' });
  assert.deepEqual(bare, { id: '44', listingId: '', reservationId: '', guestName: '', checkIn: null, checkOut: null, channel: 'other', marker: '', activityAt: null });
  assert.equal(policy.syncConversation({ listingMapId: 1 }), null);
  assert.equal(policy.syncConversation('nope'), null);
  assert.equal(policy.syncConversation({ id: 45, recipientName: 'x'.repeat(300) }).guestName.length, 120);
  // A zone in the activity time is honoured for ordering, while the marker is left exactly as given.
  const zoned = policy.syncConversation({ id: 46, messageReceivedOn: '2026-10-12T10:30:00+01:00' });
  assert.deepEqual([zoned.marker, zoned.activityAt], ['2026-10-12T10:30:00+01:00|', '2026-10-12T09:30:00.000Z']);
});

test('only a message or conversation webhook names a conversation; the rest of the body is ignored', () => {
  const event = { object: 'conversationMessage', event: 'message.received', data: { id: 5001, conversationId: 41, body: 'forged', listingMapId: 999 } };
  assert.equal(policy.webhookConversationId(event), '41');
  assert.equal(policy.webhookConversationId({ ...event, data: { ...event.data, conversationId: '41' } }), '41');
  assert.equal(policy.webhookConversationId({ event: 'message.received', data: { conversationId: 41 } }), '41');
  assert.equal(policy.webhookConversationId({ object: 'conversationMessage', data: { conversationId: 41 } }), '41');
  assert.equal(policy.webhookConversationId({ event: 'conversation.created', data: { id: 41 } }), '41');
  // A message event without its conversation never treats the message id as one.
  assert.equal(policy.webhookConversationId({ ...event, data: { id: 5001 } }), null);
  assert.equal(policy.webhookConversationId({ object: 'reservation', event: 'reservation.updated', data: { id: 7001 } }), null);
  assert.equal(policy.webhookConversationId({ object: 'listing', event: 'listing.updated', data: { id: 501 } }), null);
  for (const bad of [null, 'text', [], {}, { event: 'message.received' }, { event: 'message.received', data: { conversationId: '' } }, { event: 'message.received', data: { conversationId: -3 } }, { event: 'message.received', data: { conversationId: {} } }]) assert.equal(policy.webhookConversationId(bad), null, JSON.stringify(bad));
});
