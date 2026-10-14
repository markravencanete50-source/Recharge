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
  for (const token of ['p.text', 'p.muted', 'p.border', 'p.surface']) assert.ok(unknown.includes(token), token);
  assert.doesNotMatch(unknown, /p\.wash/, 'a quiet bordered panel like the other lists, not the loud wash');
});

test('review fixes: attachment chip fits a phone, a paperclip leads it, the panel is one collapsible line remembered per device, every row shows the subject on a second line', () => {
  const chip = inbox.slice(inbox.indexOf('{m.files.map'), inbox.indexOf('</MotionPress>', inbox.indexOf('{m.files.map')));
  assert.match(chip, /maxWidth: "100%"/);
  assert.match(chip, /<Feather name="paperclip" size=\{14\}/);
  assert.match(chip, /numberOfLines=\{1\}[^\n]*flexShrink: 1/);
  assert.match(chip, /flexShrink: 0/);
  assert.match(unknown, /Unknown senders \(\{rows\.length\}\)/);
  assert.match(unknown, /name=\{expanded \? "chevron-up" : "chevron-down"\}/);
  assert.match(unknown, /const OPEN_KEY = "rc-unknown-senders-open"/);
  assert.match(unknown, /AsyncStorage\.setItem\(OPEN_KEY/);
  assert.match(unknown, /\{expanded && <View/);
  assert.match(unknown, /borderWidth: 1, borderColor: p\.border, backgroundColor: p\.surface/);
  // Every row, named or not, is two lines: the name (or the address) and the subject below it.
  assert.match(unknown, /\{r\.name \?\? r\.from\}<\/Text>\s*\{!!r\.subject && <Text numberOfLines=\{1\}/);
  assert.doesNotMatch(unknown, /\{r\.name \? <View/);
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
  assert.match(sheet, /<PageHeading[^]*action=\{<SoftButton palette=\{p\} primary icon="plus" label="Send the form to a landlord" onPress=\{\(\) => setSending\(true\)\} \/>\} \/>/);
  assert.doesNotMatch(sheet, /HeroWash|p\.hero\b|enquiries:hero/);
});
