import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// The email screens, read as source (the app needs a login to run): Send says which address the email comes from, attachments open
// only through the signed-link route, the unknown-sender list is mounted for the Client relations roles only and uses theme tokens.
const read = async path => (await fs.readFile(path, 'utf8')).replace(/\r\n/g, '\n');
const inbox = await read('mobile/src/LiveGuestInbox.tsx');
const unknown = await read('mobile/src/EmailUnknownSenders.tsx');
const chat = await read('mobile/src/LiveChat.tsx');
const client = await read('mobile/src/backend/client.ts');

test('Send in an email conversation names guestrelations@ and works only while email replies are switched on', () => {
  assert.match(inbox, /const viaEmail = !!data\?\.canSendEmail && t\?\.source === "email"/);
  assert.match(inbox, /Send emails your reply to .* from guestrelations@rechargegroup\.co\.uk/);
  assert.match(inbox, /Emailed to the guest from guestrelations@rechargegroup\.co\.uk/);
  // Switched off: a clear line, and the reply can still be recorded.
  assert.match(inbox, /Emailing from here is switched off\. Reply from your mail app/);
  // A Hostaway conversation is not affected.
  assert.match(inbox, /\(!!data\?\.canSend && t\?\.source === "hostaway"\) \|\| viaEmail/);
});

test('attachments open through a fresh signed link each time and are never kept in the page', () => {
  assert.match(inbox, /Linking\.openURL\(\(await emailFileLink\(id\)\)\.url\)/);
  assert.match(client, /email-files\?' \+ new URLSearchParams\(\{ ids: id \}\)/);
  assert.doesNotMatch(client.slice(client.indexOf('export const emailFileLink'), client.indexOf('export const readEmailInbox')), /new Map|fileLinks|localStorage|AsyncStorage/);
  assert.doesNotMatch(inbox, /m\.files.*(uri|src)=/s);
});

test('unknown senders are mounted in the Clients tab for admins and Stays only, and the list hides itself when empty', () => {
  assert.match(chat, /clients && !mode\.readOnly && \["admin", "super_admin", "stays"\]\.includes\(account\.role\) && <EmailUnknownSenders/);
  assert.equal((chat.match(/<EmailUnknownSenders/g) ?? []).length, 1);
  assert.match(unknown, /if \(!rows\.length\) return null;/);
  assert.match(unknown, /Assign to owner/);
  assert.match(unknown, /Dismiss/);
});

test('the new screen uses theme tokens only', () => {
  assert.doesNotMatch(unknown, /#[0-9a-fA-F]{3,8}\b|rgba?\(|"(white|black|red|green|blue)"/);
  for (const token of ['p.text', 'p.muted', 'p.border', 'p.wash']) assert.ok(unknown.includes(token), token);
});
