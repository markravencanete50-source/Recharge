import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Text-level wiring of the Reconciliation screens: three platforms everywhere, the new title, the payout lines sheet,
// and the local read of an uploaded file before anything is sent.
const DASH = String.fromCharCode(0x2014);
const read = name => readFileSync(new URL(`../mobile/src/${name}.tsx`, import.meta.url), 'utf8');
const files = Object.fromEntries(['LiveAccounts', 'PayoutStays', 'PayoutLinesSheet', 'StaySheet', 'AccountsFlows'].map(name => [name, read(name)]));
const { LiveAccounts, PayoutStays, PayoutLinesSheet, StaySheet, AccountsFlows } = files;

test('every platform has its own upload button, driven by the shared list', () => {
  assert.match(LiveAccounts, /RECONCILED_CHANNELS\.map\(channel => <Button key=\{channel\}/);
  assert.match(LiveAccounts, /PAYOUT_CHANNEL_LABEL\[channel\]/);
  assert.match(LiveAccounts, /upload\(channel\)/);
  assert.match(AccountsFlows, /RECONCILED_CHANNELS\.map\(channel =>/);
});

test('the tab and its heading say Reconciliation, and the tab key stays payouts', () => {
  assert.match(LiveAccounts, /payouts: "Reconciliation"/);
  assert.match(LiveAccounts, />Reconciliation<\/Text>/);
  assert.match(LiveAccounts, /type Tab = "expenses" \| "payouts" \| "statements"/);
  assert.doesNotMatch(LiveAccounts, /payouts: "Payouts"/);
});

test('no two-platform leftovers remain', () => {
  for (const [name, text] of Object.entries(files)) {
    assert.doesNotMatch(text, /Airbnb or Booking\.com/, `${name} still names two platforms`);
    assert.doesNotMatch(text, /channel === "airbnb" \|\| channel === "booking_com"/, `${name} still checks two platforms`);
    assert.doesNotMatch(text, /\["airbnb", "booking_com"\] as const/, `${name} still lists two platforms`);
    assert.doesNotMatch(text, /"Airbnb" \| "Booking\.com"/, `${name} still types two platforms`);
  }
  assert.doesNotMatch(LiveAccounts, /"airbnb" \| "booking_com">\("airbnb"\)/);
});

test('a stay on any reconciled platform needs the platform reservation code', () => {
  assert.match(LiveAccounts, /const platform = isPayoutChannel\(channel\)/);
  assert.match(StaySheet, /const platform = isPayoutChannel\(channel\)/);
  assert.match(LiveAccounts, /Vrbo reservation ID/);
  assert.match(StaySheet, /platformCode\(channel\)\.label/);
});

test('an uploaded file is read on the screen first, then sent, then summarised', () => {
  const upload = LiveAccounts.slice(LiveAccounts.indexOf('async function upload('));
  assert.ok(upload.indexOf('readPayoutLines(file.text, channel)') > 0);
  assert.ok(upload.indexOf('readPayoutLines(file.text, channel)') < upload.indexOf('importPayoutReport'));
  assert.match(upload, /if \(read\.error\) \{ setUploadNote\(read\.error\); return; \}/);
  assert.match(LiveAccounts, /already uploaded/);
  assert.match(LiveAccounts, /for cancelled stays/);
  assert.match(LiveAccounts, /skipped\.noCode \+ skipped\.noAmount/);
  assert.match(LiveAccounts, /How this file was read/);
  assert.match(LiveAccounts, /used: read\.used/);
});

test('stay rows show the platform, the new states and a way into the payout lines', () => {
  assert.match(PayoutStays, /function ChannelChip/);
  assert.match(PayoutStays, /<ChannelChip p=\{p\} channel=\{row\.channel\} \/>/);
  assert.match(PayoutStays, /payoutStateLabel/);
  assert.match(PayoutStays, /"Missing"/);
  assert.match(PayoutStays, /Looks like the same payment twice/);
  assert.match(PayoutStays, /perPlatform/);
  assert.match(PayoutStays, /onLines\?: \(row: PayoutRow\) => void/);
  assert.match(LiveAccounts, /tags=\{\[unmatchedTag\(u\.stayStatus\)\]\}/);
  for (const words of ['Stay cancelled', 'Enquiry only', 'No stay found']) assert.ok(LiveAccounts.includes(words), words);
});

test('the payout lines sheet reads the stay, sets lines aside with a reason, and uses no browser dialogs', () => {
  assert.match(LiveAccounts, /import \{ PayoutLinesSheet/);
  assert.match(LiveAccounts, /<PayoutLinesSheet p=\{p\} stay=\{linesFor\}/);
  assert.match(PayoutLinesSheet, /section: "payoutLines", id: reservationId/);
  assert.match(PayoutLinesSheet, /action: "setAsidePayoutLine", requestId: request\.get\(\)/);
  assert.match(PayoutLinesSheet, /useRequestId/);
  assert.match(PayoutLinesSheet, /REASON_MIN = 5, REASON_MAX = 2000/);
  assert.match(PayoutLinesSheet, /label="Set aside"/);
  assert.match(PayoutLinesSheet, /label="Set aside"|tone="plain"/);
  assert.match(PayoutLinesSheet, /setAsideNote/);
  assert.match(PayoutLinesSheet, /line\.locked/);
  assert.match(PayoutLinesSheet, /setError\(message\(e\)\)/);
  for (const [name, text] of Object.entries(files)) assert.doesNotMatch(text, /\b(?:Alert\.alert|window\.(?:confirm|alert|prompt)|confirm\()/, `${name} uses a browser dialog`);
});

test('no em dashes in the reconciliation screens', () => {
  for (const [name, text] of Object.entries(files)) assert.ok(!text.includes(DASH), `${name} has an em dash`);
  assert.ok(!readFileSync(new URL(import.meta.url), 'utf8').includes(DASH));
});
