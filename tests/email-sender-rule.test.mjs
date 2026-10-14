import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// Lee's rule: two addresses, never mixed. Guests are written to as guestrelations@rechargegroup.co.uk; owners and clients (the client
// enquiry form included) as ownerrelations@rechargegroup.co.uk. Every send path is checked here: guest replies, the owner outbox, the
// enquiry form and its resend. Nothing else may send from either address.
const root = fileURLToPath(new URL('..', import.meta.url));
const state = { env: {}, sent: [], security: [] };
globalThis.__senderRule = state;
const mocks = {
  'cloudflare:workers': `export const env=globalThis.__senderRule.env;`,
  'auth-security': `const s=globalThis.__senderRule;export const authSecurityConfiguration=()=>({url:'https://db.test',key:'sb_secret_x',origin:'https://app.test'});
    export const requestQuota=async()=>({allowed:true});export const securityHash=async(a,b)=>'h'.repeat(10)+Buffer.from(b).toString('hex').slice(0,54);
    export const securityRpc=async(name,args)=>{s.security.push({name,args});if(name==='workspace_email_outbox_claim')return [{id:'11111111-1111-4111-8111-111111111111',to:'owner@example.com',subject:'Re: Boiler',body:'On it',inReplyTo:null,references:[]}];return {recorded:true};};`,
  'business-server': `export const businessResponse=(body,status=200)=>Response.json(body,{status});export const businessContext=async()=>null;
    export const databaseFailure=error=>Response.json({error:error.message},{status:400});export const viewAsFailure=()=>null;`,
  'native-request-policy': `export const isNativeRequest=()=>true;`,
  'bounded-form': `export const boundedFormData=async()=>null;`,
  'integration-server': `export const integrationSettings=()=>globalThis.__senderRule.env;`,
  hostaway: `export const hostawayReplyErrorMessage=()=>'x';export const sendHostawayConversationMessage=async()=>'1';`,
  'hostaway-sync': `export const hostawaySyncConfigured=()=>false;`,
  '@supabase/supabase-js': `export const createClient=()=>({storage:{from:()=>({})}});`,
};
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false }, plugins: [{
  name: 'isolated-sender-rule', enforce: 'pre',
  transform(code, id) {
    if (!/\/(client-enquiry-server|integration-providers|email-inbound-server|guest-reply-server|resend-email|client-email-server|workspace-rpc-route)\.ts$/.test(id.replaceAll('\\', '/'))) return;
    for (const name of Object.keys(mocks)) code = code.replaceAll(`from '${name === '@supabase/supabase-js' || name === 'cloudflare:workers' ? name : './' + name}'`, `from 'sender-test:${name}'`);
    return { code, map: null };
  },
  resolveId: id => id === 'cloudflare:workers' ? '\0sender-test:cloudflare:workers' : id.startsWith('sender-test:') ? '\0' + id : null,
  load: id => id.startsWith('\0sender-test:') ? mocks[id.slice(13)] : null,
}] });
const policy = await vite.ssrLoadModule('/lib/integration-policy.ts');
const enquiry = await vite.ssrLoadModule('/lib/client-enquiry-server.ts');
const outbox = await vite.ssrLoadModule('/lib/email-inbound-server.ts');
const replies = await vite.ssrLoadModule('/lib/guest-reply-server.ts');
const providers = await vite.ssrLoadModule('/lib/integration-providers.ts');
const clientEmail = await vite.ssrLoadModule('/lib/client-email-server.ts');
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  if (String(url) === 'https://api.resend.com/emails' && init.method === 'POST') { state.sent.push(JSON.parse(String(init.body))); return Response.json({ id: 'r_' + state.sent.length }); }
  throw new Error('Unexpected fetch ' + url);
};
after(async () => { globalThis.fetch = realFetch; delete globalThis.__senderRule; await vite.close(); });

const GUEST = 'guestrelations@rechargegroup.co.uk', OWNER = 'ownerrelations@rechargegroup.co.uk';
const reset = (env = { RESEND_API_KEY: 're_test', EMAIL_REPLIES_ENABLED: 'true' }) => { for (const k of Object.keys(state.env)) delete state.env[k]; Object.assign(state.env, env); state.sent = []; state.security = []; };
const address = v => (String(v).match(/<([^>]+)>/)?.[1] ?? String(v)).toLowerCase();

test('a guest reply goes out from guestrelations@ with reply-to guestrelations@, and only to the guest', async () => {
  reset();
  const REQUEST = '22222222-2222-4222-8222-222222222222';
  const context = { request: new Request('https://app.test'), account: { userId: 'u', role: 'stays' }, client: { rpc: async name => name === 'workspace_guest_inbox_action'
    ? { data: { send: true, conversationId: 'email:1', requestId: REQUEST, source: 'email', email: { to: 'guest@example.org', subject: 'Re: Hi', inReplyTo: 'a@b', references: [] } }, error: null } : { data: { thread: {} }, error: null } } };
  await replies.sendGuestReply(context, { action: 'sendReply', requestId: REQUEST, threadId: '33333333-3333-4333-8333-333333333333', body: 'Hello' });
  assert.equal(state.sent.length, 1);
  assert.deepEqual([address(state.sent[0].from), address(state.sent[0].reply_to), state.sent[0].to], [GUEST, GUEST, ['guest@example.org']]);
});

test('the owner outbox, the enquiry form and a resent form all go out from ownerrelations@ with reply-to ownerrelations@', async () => {
  reset();
  assert.deepEqual(await outbox.runEmailOutbox(), { sent: 1 });
  const context = () => ({ request: new Request('https://app.test'), account: { userId: '11111111-1111-4111-8111-111111111111', role: 'admin' }, client: { rpc: async (name, args) =>
    ({ data: { id: 'e1', recipientEmail: 'alex@example.com', emailStatus: args.input.action === 'markEnquiryEmail' ? args.input.emailStatus : 'pending' }, error: null }) } });
  await enquiry.sendEnquiryForm(context(), { action: 'inviteEnquiry', requestId: '22222222-2222-4222-8222-222222222222', name: 'Alex', email: 'alex@example.com', subject: 'Form', body: 'Hi\n\n{link}', delivery: 'email' });
  await enquiry.sendEnquiryForm(context(), { action: 'resendEnquiry', requestId: '44444444-4444-4444-8444-444444444444', enquiryId: '33333333-3333-4333-8333-333333333333', version: 1, subject: 'Again', body: 'Hi\n\n{link}', delivery: 'email' });
  assert.equal(state.sent.length, 3);
  for (const mail of state.sent) assert.deepEqual([address(mail.from), address(mail.reply_to)], [OWNER, OWNER], mail.subject);
});

test('a reply to a client email conversation goes out from ownerrelations@, threaded, once per request; switched off or refused, nothing is stored', async () => {
  const REQUEST = '55555555-5555-4555-8555-555555555555', THREAD = '66666666-6666-4666-8666-666666666666';
  const input = { action: 'reply', requestId: REQUEST, threadId: THREAD, body: 'Yes, we can help.' };
  const context = { request: new Request('https://app.test'), account: { userId: 'u', role: 'admin' }, client: { rpc: async name => name === 'workspace_client_email_action'
    ? { data: { send: true, requestId: REQUEST, email: { to: 'new.landlord@example.org', subject: 'Re: Managing my property', inReplyTo: 'ce-1@mail.example.org', references: ['ce-1@mail.example.org'] } }, error: null } : { data: null, error: null } } };
  reset();
  assert.equal((await clientEmail.sendClientEmailReply(context, input)).status, 200);
  assert.equal(state.sent.length, 1);
  const [mail] = state.sent;
  assert.deepEqual([address(mail.from), address(mail.reply_to), mail.to, mail.subject], [OWNER, OWNER, ['new.landlord@example.org'], 'Re: Managing my property']);
  assert.deepEqual(mail.headers, { 'Message-ID': `<${REQUEST}@rechargegroup.co.uk>`, 'In-Reply-To': '<ce-1@mail.example.org>', References: '<ce-1@mail.example.org>' });
  assert.deepEqual(state.security.at(-1), { name: 'workspace_client_email_result', args: { input: { requestId: REQUEST, ok: true, messageId: `${REQUEST}@rechargegroup.co.uk` } } });
  // Already sent or still going out: nothing is posted again.
  reset();
  const again = { ...context, client: { rpc: async () => ({ data: { send: false, thread: { id: THREAD } }, error: null }) } };
  assert.equal((await clientEmail.sendClientEmailReply(again, input)).status, 200);
  assert.deepEqual([state.sent, state.security], [[], []]);
  // Switched off: refused before anything is recorded.
  reset({ RESEND_API_KEY: 're_test' });
  let asked = false;
  const off = await clientEmail.sendClientEmailReply({ ...context, client: { rpc: async () => { asked = true; return { data: null, error: null }; } } }, input);
  assert.equal(off.status, 503);
  assert.equal(asked, false);
});

test('nothing mixes: the enquiry sender cannot be set to the guest mailbox, the one-off sender refuses it, and no email is sent to our own mailboxes', async () => {
  reset({ RESEND_API_KEY: 're_test', EMAIL_REPLIES_ENABLED: 'true', ENQUIRY_FROM_EMAIL: `Recharge <${GUEST}>` });
  assert.equal(address(policy.enquirySender(state.env)), OWNER);
  await assert.rejects(providers.sendEmail(state.env, { to: 'a@b.co', subject: 's', text: 't', html: 'h', idempotencyKey: 'k', from: `Recharge <${GUEST}>`, replyTo: OWNER }));
  await assert.rejects(providers.sendEmail(state.env, { to: 'a@b.co', subject: 's', text: 't', html: 'h', idempotencyKey: 'k', from: OWNER, replyTo: GUEST }));
  await assert.rejects(providers.sendEmail(state.env, { to: GUEST, subject: 's', text: 't', html: 'h', idempotencyKey: 'k', from: OWNER }));
  const resendEmail = await vite.ssrLoadModule('/lib/resend-email.ts');
  await assert.rejects(resendEmail.sendMailboxEmail('guest', { to: OWNER, subject: 's', text: 't', idempotencyKey: 'k/1' }));
  await assert.rejects(resendEmail.sendMailboxEmail('owner', { to: 'Someone <GuestRelations@rechargegroup.co.uk>', subject: 's', text: 't', idempotencyKey: 'k/2' }));
  assert.deepEqual(state.sent, []);
});

test('staff notice emails may not use either mailbox as their sender', () => {
  const on = from => policy.integrationConfiguration({ NOTIFICATION_EMAIL_ENABLED: 'true', RESEND_API_KEY: 're_test', NOTIFICATION_FROM_EMAIL: from }).email;
  assert.equal(on('notices@rechargegroup.co.uk'), true);
  assert.equal(on(GUEST), false);
  assert.equal(on(OWNER), false);
  assert.equal(on('GuestRelations@RechargeGroup.co.uk'), false);
});

test('only the known places send through Resend, and each names its own mailbox', async () => {
  const files = (await fs.readdir('lib')).filter(f => f.endsWith('.ts'));
  const senders = [];
  for (const file of files) if ((await fs.readFile('lib/' + file, 'utf8')).includes('api.resend.com')) senders.push(file);
  // The notification and one-off senders live in integration-providers.ts; the mailbox sender in resend-email.ts (which also reads received mail).
  assert.deepEqual(senders.sort(), ['integration-providers.ts', 'resend-email.ts']);
  // Callers: guests through the 'guest' mailbox, owners through 'owner'.
  const read = async f => (await fs.readFile(f, 'utf8')).replace(/\r\n/g, '\n');
  assert.match(await read('lib/guest-reply-server.ts'), /sendMailboxEmail\('guest',/);
  assert.doesNotMatch(await read('lib/guest-reply-server.ts'), /sendMailboxEmail\('owner'/);
  assert.match(await read('lib/email-inbound-server.ts'), /sendMailboxEmail\('owner',/);
  assert.doesNotMatch(await read('lib/email-inbound-server.ts'), /sendMailboxEmail\('guest'/);
  const server = await read('lib/client-enquiry-server.ts');
  assert.match(server, /from: enquirySender\(settings\), replyTo: ENQUIRY_REPLY_TO/);
  // Nothing else in the app or the worker names either address as a sender.
  for (const file of ['lib/account-invite-server.ts', 'lib/integration-server.ts', 'lib/registration-provider.ts', 'worker/index.ts']) {
    const text = await read(file).catch(() => '');
    assert.doesNotMatch(text, /guestrelations@|ownerrelations@/, file);
  }
});

// Lee, 14 October: "the logo of the email should use the logo of Recharge". Every HTML email carries it: the emails Recharge writes
// start with it; replies written in Messages end with a small signature (logo, "Recharge Group", the mailbox). Plain text unchanged.
test('every email carries the Recharge logo: a header on the enquiry form, a signature naming the right mailbox on replies', async () => {
  const LOGO = /<img src="https:\/\/app\.rechargegroup\.co\.uk\/recharge-email-logo\.png" alt="Recharge" width="(\d+)" height="(\d+)"/;
  reset();
  const REQUEST = '22222222-2222-4222-8222-222222222222';
  const guestContext = { request: new Request('https://app.test'), account: { userId: 'u', role: 'stays' }, client: { rpc: async name => name === 'workspace_guest_inbox_action'
    ? { data: { send: true, conversationId: 'email:1', requestId: REQUEST, source: 'email', email: { to: 'guest@example.org', subject: 'Re: Hi', inReplyTo: 'a@b', references: [] } }, error: null } : { data: { thread: {} }, error: null } } };
  await replies.sendGuestReply(guestContext, { action: 'sendReply', requestId: REQUEST, threadId: '33333333-3333-4333-8333-333333333333', body: 'Hello <Sam>\n\nSee you at 3.\nThanks' });
  await outbox.runEmailOutbox();
  const enquiryContext = { request: new Request('https://app.test'), account: { userId: '11111111-1111-4111-8111-111111111111', role: 'admin' }, client: { rpc: async (name, args) =>
    ({ data: { id: 'e1', recipientEmail: 'alex@example.com', emailStatus: args.input.action === 'markEnquiryEmail' ? args.input.emailStatus : 'pending' }, error: null }) } };
  await enquiry.sendEnquiryForm(enquiryContext, { action: 'inviteEnquiry', requestId: '77777777-7777-4777-8777-777777777777', name: 'Alex', email: 'alex@example.com', subject: 'Form', body: 'Hi\n\n{link}', delivery: 'email' });
  const [guest, owner, form] = state.sent;
  assert.equal(guest.text, 'Hello <Sam>\n\nSee you at 3.\nThanks', 'the plain text goes exactly as written');
  assert.match(guest.html, /<p style="margin:0 0 14px">Hello &lt;Sam&gt;<\/p><p style="margin:0 0 14px">See you at 3\.<br>Thanks<\/p>/, 'the HTML is the same text, escaped');
  for (const [mail, mailbox] of [[guest, GUEST], [owner, OWNER]]) {
    const signature = mail.html.slice(mail.html.indexOf('<table'));
    assert.deepEqual(signature.match(LOGO).slice(1), ['108', '30'], 'a small logo under the reply, not a header');
    assert.ok(mail.html.indexOf('<img') > mail.html.indexOf('</p>'), 'after the message');
    assert.match(signature, new RegExp(`<strong>Recharge Group</strong><br><a href="mailto:${mailbox}"`));
    assert.ok(!mail.html.includes(mailbox === GUEST ? OWNER : GUEST), 'never the other mailbox');
  }
  assert.deepEqual(form.html.match(LOGO).slice(1), ['180', '50']);
  assert.ok(form.html.indexOf('<img') < form.html.indexOf('<p'), 'the logo is at the top');
  assert.doesNotMatch(form.text, /<img|recharge-email-logo/);
  // The image is a small PNG (email apps block SVG) on its own solid background, and the Worker serves it.
  const png = await fs.readFile('public/recharge-email-logo.png');
  assert.deepEqual([...png.subarray(1, 4)].map(c => String.fromCharCode(c)).join(''), 'PNG');
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [480, 133]);
  assert.ok(png.length < 60_000, 'small enough for an email');
  assert.match(await fs.readFile('worker/backend-route-policy.ts', 'utf8'), /"\/recharge-email-logo\.png"/);
});
