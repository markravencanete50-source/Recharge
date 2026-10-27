import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// The email screens, read as source (the app needs a login to run): Send says which address the email comes from, attachments open
// only through the signed-link route, the unknown-sender list is mounted for the Client relations roles only and uses theme tokens.
const read = async path => (await fs.readFile(path, 'utf8')).replace(/\r\n/g, '\n');
const inbox = await read('mobile/src/LiveGuestInbox.tsx');
const unknown = await read('mobile/src/ClientEmailThread.tsx');
const chat = await read('mobile/src/LiveChat.tsx');
const client = await read('mobile/src/backend/client.ts');

test('Send in an email conversation names guestrelations@ and works only while email replies are switched on', () => {
  assert.match(inbox, /const viaEmail = !!data\?\.canSendEmail && !!t && repliesByEmail\(t\)/);
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

test('email to ownerrelations@ from someone who is not an owner yet is a conversation in Clients: the panel is gone, the rows and pane are mounted', () => {
  assert.doesNotMatch(chat, /EmailUnknownSenders/);
  assert.match(chat, /const emailTeam = !owner && !mode\.readOnly && \["admin", "super_admin", "stays"\]\.includes\(account\.role\);/);
  assert.match(chat, /r\.kind === "email"\s*\? <ClientEmailRow/);
  assert.match(chat, /id\.startsWith\("email:"\)\s*\? <ClientEmailThreadPane/);
  assert.match(chat, /counts=\{statusCounts\(found, statusOf\)\}/);
  assert.match(unknown, /Send emails your reply to \{t\.address\} from ownerrelations@rechargegroup\.co\.uk/);
  // Email tabs (Lee, 14 October): linking names the owner; the conversation stays in Client emails.
  assert.match(unknown, /label=\{t\.ownerId \? "Change owner" : "Link to owner"\}/);
  assert.doesNotMatch(unknown, /onAssigned|conversationId/);
  // On a phone the subject has its own line under the address, so a long address never hides it.
  assert.match(unknown, /\{!!t\?\.subject && <Text numberOfLines=\{2\} style=\{\[ui\.small, \{ color: p\.text \}\]\}>\{t\.subject\}<\/Text>\}/);
  assert.match(unknown, /Linking\.openURL\(\(await emailFileLink\(id\)\)\.url\)/);
});

test('the new screen uses theme tokens only', () => {
  assert.doesNotMatch(unknown, /#[0-9a-fA-F]{3,8}\b|rgba?\(|"(white|black|red|green|blue)"/);
  for (const token of ['p.text', 'p.muted', 'p.border', 'p.surface']) assert.ok(unknown.includes(token), token);
});

test('review fixes: the attachment chip fits a phone with a paperclip', () => {
  const chip = inbox.slice(inbox.indexOf('{m.files.map'), inbox.indexOf('</MotionPress>', inbox.indexOf('{m.files.map')));
  assert.match(chip, /maxWidth: "100%"/);
  assert.match(chip, /<Feather name="paperclip" size=\{14\}/);
  assert.match(chip, /flexShrink: 0/);
});

test('Send the form sheet: honest placeholders, the email preview behind a toggle, and the page action is a normal primary button, not a banner', async () => {
  const sheet = (await fs.readFile('mobile/src/LiveEnquiries.tsx', 'utf8')).replace(/\r\n/g, '\n');
  assert.match(sheet, /placeholder="Their name"/);
  assert.match(sheet, /placeholder="name@example\.com"/);
  assert.doesNotMatch(sheet, /Alex Morgan|alex@example\.com/);
  assert.match(sheet, /\[showPreview, setShowPreview\] = useState\(false\)/);
  assert.match(sheet, /accessibilityLabel="Preview the email"/);
  assert.match(sheet, /name=\{showPreview \? "chevron-up" : "chevron-down"\}/);
  assert.match(sheet, /\{showPreview && <View style=\{\{ borderRadius: 18,/);
  // The banner is gone: a primary SoftButton in the page heading opens the same sheet, and the hero tokens are no longer used here.
  assert.match(sheet, /<PageHeading[^]*action=\{<View[^]*<SoftButton palette=\{p\} primary icon="plus" label="Send the form to a landlord" onPress=\{\(\) => setSending\(true\)\} \/>\s*<\/View>\} \/>/);
  // Beside it, a plain button opens the agreement follow-up steps (20261027200000).
  assert.match(sheet, /<SoftButton palette=\{p\} icon="edit-3" label="Agreement follow-ups" onPress=\{\(\) => setFollowUps\(true\)\} \/>/);
  assert.doesNotMatch(sheet, /HeroWash|p\.hero\b|enquiries:hero/);
});
