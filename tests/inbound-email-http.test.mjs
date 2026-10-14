import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// Email through Resend, over the real route: the signed webhook, what is stored and what is dropped, attachments checked from their
// bytes, and replies sent as guestrelations@ / ownerrelations@ with the right headers and idempotency keys. The database, storage and
// Resend itself (fetch) are mocked.
const root = fileURLToPath(new URL('..', import.meta.url));
const state = { env: {}, security: [], resend: [], uploads: [], received: {}, attachments: {}, rpc: {}, hostaway: [], rpcCalls: [] };
globalThis.__inboundEmail = state;
const mocks = {
  'cloudflare:workers': `export const env=globalThis.__inboundEmail.env;`,
  'auth-security': `const s=globalThis.__inboundEmail;export const authSecurityConfiguration=()=>({url:'https://db.test',key:'sb_secret_x',origin:'https://app.test'});export const requestQuota=async()=>({allowed:true});
    export const securityRpc=async(name,args)=>{s.security.push({name,args});return s.rpc[name]?s.rpc[name](args):{stored:true};};`,
  'business-server': `const s=globalThis.__inboundEmail;export const businessResponse=(body,status=200)=>Response.json(body,{status});
    export const businessContext=async()=>({client:{rpc:async(name,args)=>{s.rpcCalls.push({name,args});return s.rpc[name]?s.rpc[name](args):{data:null,error:null};}},account:{userId:'u1',role:'stays',status:'active'}});
    export const databaseFailure=error=>Response.json({error:error.message},{status:403});export const viewAsFailure=()=>null;`,
  'native-request-policy': `export const isNativeRequest=()=>true;`,
  '@supabase/supabase-js': `const s=globalThis.__inboundEmail;export const createClient=()=>({storage:{from:bucket=>({
    upload:async(path,bytes,options)=>{s.uploads.push({bucket,path,length:bytes.length,options});return {error:null};},
    createSignedUrls:async paths=>({data:paths.map(path=>({path,signedUrl:'https://signed.test/'+path,error:null})),error:null})})}});`,
  hostaway: `export const hostawayReplyErrorMessage=()=>'Hostaway failed';export const sendHostawayConversationMessage=async(id,body)=>{globalThis.__inboundEmail.hostaway.push({id,body});return '777';};`,
  'hostaway-sync': `export const hostawaySyncConfigured=()=>false;`,
};
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false }, plugins: [{
  name: 'isolated-inbound-email', enforce: 'pre',
  transform(code, id) {
    if (!/\/(email-inbound-server|resend-email|guest-reply-server|email-inbox-server)\.ts$/.test(id.replaceAll('\\', '/'))) return;
    for (const name of Object.keys(mocks)) {
      const specifier = name === 'cloudflare:workers' || name === '@supabase/supabase-js' ? name : './' + name;
      code = code.replaceAll(`from '${specifier}'`, `from 'inbound-test:${name}'`);
    }
    return { code, map: null };
  },
  resolveId: id => id === 'cloudflare:workers' ? '\0inbound-test:cloudflare:workers' : id.startsWith('inbound-test:') ? '\0' + id : null,
  load: id => id.startsWith('\0inbound-test:') ? mocks[id.slice(14)] : null,
}] });
const server = await vite.ssrLoadModule('/lib/email-inbound-server.ts');
const policy = await vite.ssrLoadModule('/lib/email-inbound-policy.ts');
const replies = await vite.ssrLoadModule('/lib/guest-reply-server.ts');
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url), headers = Object.fromEntries(new Headers(init.headers));
  state.resend.push({ url: u, method: init.method ?? 'GET', headers, body: init.body });
  if (u === 'https://api.resend.com/emails' && init.method === 'POST') return Response.json({ id: 'resend_out_1' });
  const attachment = u.match(/\/emails\/receiving\/([^/]+)\/attachments\/([^/]+)$/);
  if (attachment) { const a = state.attachments[attachment[2]]; return a ? Response.json({ download_url: 'https://files.test/' + attachment[2], size: a.length }) : new Response('no', { status: 404 }); }
  if (u.startsWith('https://files.test/')) return new Response(state.attachments[u.split('/').pop()]);
  const received = u.match(/\/emails\/receiving\/([^/]+)$/);
  if (received) { const r = state.received[decodeURIComponent(received[1])]; return r ? Response.json(r) : new Response('{"message":"not found"}', { status: 404 }); }
  throw new Error('Unexpected fetch ' + u);
};
after(async () => { globalThis.fetch = realFetch; delete globalThis.__inboundEmail; await vite.close(); });

const SECRET = 'whsec_' + Buffer.from('a-very-long-test-signing-secret-1234').toString('base64');
const ON = { RESEND_API_KEY: 're_test', RESEND_WEBHOOK_SECRET: SECRET, EMAIL_REPLIES_ENABLED: 'true' };
function reset(env = ON) {
  for (const k of Object.keys(state.env)) delete state.env[k];
  Object.assign(state.env, env);
  Object.assign(state, { security: [], resend: [], uploads: [], received: {}, attachments: {}, rpc: {}, hostaway: [], rpcCalls: [] });
}
const sign = (body, { id = 'msg_1', timestamp = String(Math.floor(Date.now() / 1000)), secret = SECRET } = {}) =>
  ({ 'svix-id': id, 'svix-timestamp': timestamp, 'svix-signature': 'v1,' + crypto.createHmac('sha256', Buffer.from(secret.slice(6), 'base64')).update(`${id}.${timestamp}.${body}`).digest('base64') });
const webhook = (event, headers) => { const body = JSON.stringify(event); return server.resendWebhookRoute(new Request('https://app.test/api/resend/webhook', { method: 'POST', headers: headers ?? sign(body), body })); };
const event = (id = 'em_1', type = 'email.received') => ({ type, created_at: new Date().toISOString(), data: { email_id: id, from: 'x', to: ['y'] } });
const good = { 'Authentication-Results': 'mx.example; dkim=pass header.d=example.org; spf=fail smtp.mailfrom=fasthosts.example; dmarc=pass header.from=example.org' };
const email = (extra = {}) => ({ id: 'em_1', from: 'Gus One <guest.one@example.org>', to: ['guestrelations@in.rechargegroup.co.uk'], subject: 'Question about check in', text: 'What time can we check in?\n\nOn Mon, 5 Oct 2026, Recharge wrote:\n> Welcome', headers: { ...good, 'Message-ID': '<abc@mail.example.org>', 'In-Reply-To': '<prev@rechargegroup.co.uk>', References: '<first@x> <prev@rechargegroup.co.uk>' }, attachments: [], ...extra });
const PDF = new TextEncoder().encode('%PDF-1.4 test document body');
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82]);

test('the signature check: unsigned, wrongly signed, old, replayed on another body, or unset are all refused, and nothing is fetched or stored', async () => {
  reset(); state.received.em_1 = email();
  const body = JSON.stringify(event());
  const fresh = sign(body);
  const cases = [
    ['unsigned', {}],
    ['wrong secret', sign(body, { secret: 'whsec_' + Buffer.from('another-signing-secret-not-ours-123').toString('base64') })],
    ['stale', sign(body, { timestamp: String(Math.floor(Date.now() / 1000) - 3600) })],
    ['future', sign(body, { timestamp: String(Math.floor(Date.now() / 1000) + 3600) })],
    ['signature of another body', sign(JSON.stringify(event('em_2')))],
    ['not v1', { ...fresh, 'svix-signature': fresh['svix-signature'].replace('v1,', 'v2,') }],
    ['garbage', { ...fresh, 'svix-signature': 'v1,!!!!' }],
    ['no id', { 'svix-timestamp': fresh['svix-timestamp'], 'svix-signature': fresh['svix-signature'] }],
  ];
  for (const [name, headers] of cases) {
    const response = await server.resendWebhookRoute(new Request('https://app.test/api/resend/webhook', { method: 'POST', headers, body }));
    assert.equal(response.status, 401, name);
  }
  assert.deepEqual([state.resend, state.security, state.uploads], [[], [], []]);
  // Not set up yet: refused as unavailable, even with a valid signature.
  for (const env of [{ ...ON, RESEND_WEBHOOK_SECRET: undefined }, { ...ON, RESEND_API_KEY: undefined }]) {
    reset(env);
    assert.equal((await server.resendWebhookRoute(new Request('https://app.test/api/resend/webhook', { method: 'POST', headers: sign(body), body }))).status, 503);
  }
  // A GET is refused.
  reset();
  assert.equal((await server.resendWebhookRoute(new Request('https://app.test/api/resend/webhook'))).status, 405);
  assert.deepEqual([state.resend, state.security], [[], []]);
});

test('a signed guest email is fetched from Resend and stored through the guest ingest, quoted text left out', async () => {
  reset(); state.received.em_1 = email();
  const response = await webhook(event());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, stored: true, duplicate: false, mailbox: 'guest' });
  assert.equal(state.resend[0].url, 'https://api.resend.com/emails/receiving/em_1');
  assert.equal(state.resend[0].headers.authorization, 'Bearer re_test');
  assert.deepEqual(state.security, [{ name: 'workspace_email_guest_ingest', args: { input: {
    emailId: 'em_1', from: 'guest.one@example.org', fromName: 'Gus One', subject: 'Question about check in', text: 'What time can we check in?',
    messageId: '<abc@mail.example.org>', inReplyTo: '<prev@rechargegroup.co.uk>', references: ['<first@x>', '<prev@rechargegroup.co.uk>'], attachments: [] } } }]);
});

test('an owner mailbox email goes to the owner ingest; other addresses are recorded as dropped', async () => {
  reset(); state.received.em_1 = email({ to: ['ownerrelations@in.rechargegroup.co.uk'] });
  assert.equal((await (await webhook(event())).json()).mailbox, 'owner');
  assert.equal(state.security[0].name, 'workspace_email_owner_ingest');
  reset(); state.received.em_1 = email({ to: ['someone@example.com'] });
  assert.equal((await webhook(event())).status, 200);
  assert.deepEqual(state.security.map(c => [c.name, c.args.input.reason]), [['workspace_email_drop', 'not addressed to a Recharge mailbox']]);
});

test('spam and failed DKIM or DMARC are dropped without content; a forward that only fails SPF is kept', async () => {
  const dropped = async headers => {
    reset(); state.received.em_1 = email({ headers });
    assert.equal((await webhook(event())).status, 200);
    return state.security.map(c => c.name + ':' + (c.args.input.reason ?? ''));
  };
  assert.deepEqual(await dropped({ ...good, 'X-Spam-Flag': 'YES' }), ['workspace_email_drop:marked as spam']);
  assert.deepEqual(await dropped({ ...good, 'X-Spam-Status': 'Yes, score=9' }), ['workspace_email_drop:marked as spam']);
  assert.deepEqual(await dropped({ 'Authentication-Results': 'x; dkim=pass; dmarc=fail' }), ['workspace_email_drop:dmarc fail']);
  assert.deepEqual(await dropped({ 'Authentication-Results': 'x; dkim=fail; spf=pass' }), ['workspace_email_drop:dkim fail']);
  assert.deepEqual(await dropped({}), ['workspace_email_drop:no authentication result']);
  assert.deepEqual(await dropped({ 'Authentication-Results': 'x; spf=pass' }), ['workspace_email_drop:sender not authenticated']);
  assert.deepEqual(await dropped(good), ['workspace_email_guest_ingest:']);
  // The drop never carries the subject or text.
  reset(); state.received.em_1 = email({ headers: { ...good, 'X-Spam-Flag': 'YES' } });
  await webhook(event());
  assert.deepEqual(Object.keys(state.security[0].args.input).sort(), ['emailId', 'from', 'mailbox', 'reason']);
  // Mail from our own domain (a loop) or a bounce is never stored.
  reset(); state.received.em_1 = email({ from: 'MAILER-DAEMON@example.org' });
  await webhook(event());
  assert.equal(state.security[0].name, 'workspace_email_drop');
  // The escape for a mail path with no authentication header keeps those, but never a failure or spam.
  reset({ ...ON, EMAIL_ALLOW_UNVERIFIED: 'true' }); state.received.em_1 = email({ headers: {} });
  await webhook(event());
  assert.equal(state.security[0].name, 'workspace_email_guest_ingest');
  reset({ ...ON, EMAIL_ALLOW_UNVERIFIED: 'true' }); state.received.em_1 = email({ headers: { 'Authentication-Results': 'x; dmarc=fail' } });
  await webhook(event());
  assert.equal(state.security[0].name, 'workspace_email_drop');
});

test('other events are acknowledged and ignored; a Resend failure asks for a retry; a repeat stores nothing more', async () => {
  reset();
  assert.deepEqual(await (await webhook(event('em_1', 'email.delivered'))).json(), { ok: true, ignored: true });
  assert.deepEqual([state.resend, state.security], [[], []]);
  // Resend cannot be read: not acknowledged, so Resend delivers it again.
  assert.equal((await webhook(event('missing'))).status, 503);
  // The database already has it.
  reset(); state.received.em_1 = email(); state.rpc.workspace_email_guest_ingest = () => ({ duplicate: true });
  assert.deepEqual(await (await webhook(event())).json(), { ok: true, stored: false, duplicate: true, mailbox: 'guest' });
  assert.equal((await server.resendWebhookRoute(new Request('https://app.test/x', { method: 'POST', headers: sign('{'), body: '{' }))).status, 400);
});

test('attachments are kept by what their bytes are, not what they are called, and only within the limits', async () => {
  reset();
  state.attachments = { a1: PDF, a2: PNG, a3: new TextEncoder().encode('MZ this is an executable pretending'), a4: new Uint8Array(10 * 1024 * 1024 + 1).fill(1) };
  state.received.em_1 = email({ attachments: [{ id: 'a1', filename: 'photo.png' }, { id: 'a2', filename: '../../etc/passwd' }, { id: 'a3', filename: 'invoice.pdf' }, { id: 'a4', filename: 'big.jpg' }, { id: 'a5', filename: 'gone.pdf' }] });
  assert.equal((await webhook(event())).status, 200);
  const input = state.security.at(-1).args.input;
  assert.deepEqual(input.attachments.map(a => [a.filename, a.mime, a.bytes]), [['photo.png', 'application/pdf', PDF.length], ['passwd', 'image/png', PNG.length]]);
  assert.match(input.attachments[0].path, /^guest\/\d{4}-\d{2}\/em_1\/a1\.pdf$/);
  assert.deepEqual(state.uploads.map(u => [u.bucket, u.options.contentType, u.options.upsert]), [['email-files', 'application/pdf', true], ['email-files', 'image/png', true]]);
  // At most 10 attachments are looked at.
  reset(); state.attachments = Object.fromEntries(Array.from({ length: 12 }, (_, i) => ['f' + i, PDF]));
  state.received.em_1 = email({ attachments: Object.keys(state.attachments).map(id => ({ id, filename: id + '.pdf' })) });
  await webhook(event());
  assert.equal(state.security.at(-1).args.input.attachments.length, 10);
});

test('the pure checks: mailboxes, addresses, text, file types', () => {
  assert.equal(policy.mailboxFor(['GuestRelations@in.rechargegroup.co.uk']), 'guest');
  assert.equal(policy.mailboxFor('"Owners" <ownerrelations@rechargegroup.co.uk>'), 'owner');
  assert.equal(policy.mailboxFor(['guestrelations@evilrechargegroup.co.uk', 'guestrelations@rechargegroup.co.uk.evil.com', 'marketing@rechargegroup.co.uk']), null);
  assert.deepEqual(policy.parseAddress('Gus <G@Example.ORG>'), { address: 'g@example.org', name: 'Gus' });
  assert.equal(policy.parseAddress('nonsense'), null);
  assert.equal(policy.messageText('Hi\n> quoted\nBye', ''), 'Hi\nBye');
  assert.equal(policy.messageText('', '<p>Hello&nbsp;there</p><style>x{}</style>'), 'Hello there');
  assert.equal(policy.messageText('x'.repeat(9000), '').length, 5000);
  // Gmail wraps a long quote header over two lines: it is cut there too, and a line merely starting "On" is kept.
  assert.equal(policy.messageText('I want to inquire.\n\nOn Wed, Oct 14, 2026 at 11:00 AM Recharge Group <\nguestrelations@rechargegroup.co.uk> wrote:\n\n> Test Received.', ''), 'I want to inquire.');
  assert.equal(policy.messageText('Thanks.\nOn Wed, Oct 14, 2026 at 11:00 AM\nRecharge Group\n<guestrelations@rechargegroup.co.uk> wrote:', ''), 'Thanks.');
  assert.equal(policy.messageText('We arrive Friday.\nOn Saturday we leave early.\nThanks', ''), 'We arrive Friday.\nOn Saturday we leave early.\nThanks');
  assert.equal(policy.attachmentType(new Uint8Array(20).fill(0)), null);
  assert.equal(policy.attachmentType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]))?.mime, 'image/jpeg');
});

test('a reply by email goes out as guestrelations@ with In-Reply-To, References, a fixed Message-ID and an idempotency key, then is recorded', async () => {
  reset();
  const out = await server.runEmailOutbox.length >= 0 && await (async () => {
    state.rpc.workspace_email_outbox_claim = () => [{ id: '11111111-1111-4111-8111-111111111111', to: 'owner@example.com', subject: 'Re: Boiler', body: 'We will send an engineer.', inReplyTo: 'owner-1@mail.example.com', references: ['first@x', 'owner-1@mail.example.com'] }];
    return server.runEmailOutbox();
  })();
  assert.deepEqual(out, { sent: 1 });
  const [call] = state.resend;
  const sent = JSON.parse(call.body);
  assert.equal(call.headers['idempotency-key'], 'recharge-owner-email/11111111-1111-4111-8111-111111111111');
  assert.equal(sent.from, 'Recharge Group <ownerrelations@rechargegroup.co.uk>');
  assert.deepEqual([sent.to, sent.subject, sent.text], [['owner@example.com'], 'Re: Boiler', 'We will send an engineer.']);
  assert.deepEqual(sent.headers, { 'Message-ID': '<11111111-1111-4111-8111-111111111111@rechargegroup.co.uk>', 'In-Reply-To': '<owner-1@mail.example.com>', References: '<first@x> <owner-1@mail.example.com>' });
  assert.deepEqual(state.security.at(-1), { name: 'workspace_email_outbox_result', args: { input: { id: '11111111-1111-4111-8111-111111111111', ok: true, messageId: '11111111-1111-4111-8111-111111111111@rechargegroup.co.uk' } } });
  // Switched off, nothing is claimed or sent.
  reset({ ...ON, EMAIL_REPLIES_ENABLED: undefined });
  assert.deepEqual(await server.runEmailOutbox(), { sent: 0 });
  assert.deepEqual([state.resend, state.security], [[], []]);
});

test('Send in an email conversation: recorded once, sent through Resend as guestrelations@, outcome saved; a refusal stores nothing', async () => {
  const REQUEST = '22222222-2222-4222-8222-222222222222', THREAD = '33333333-3333-4333-8333-333333333333';
  const input = { action: 'sendReply', requestId: REQUEST, threadId: THREAD, body: 'Check in is from 3pm.' };
  const context = { request: new Request('https://app.test'), account: { userId: 'u1', role: 'stays' }, client: { rpc: async (name, args) => {
    state.rpcCalls.push({ name, args });
    if (name === 'workspace_guest_inbox_action') return { data: { send: true, conversationId: 'email:1', requestId: REQUEST, source: 'email', email: { to: 'guest.one@example.org', subject: 'Re: Question about check in', inReplyTo: 'abc@mail.example.org', references: ['first@x', 'abc@mail.example.org'] } }, error: null };
    return { data: { thread: { id: THREAD } }, error: null };
  } } };
  reset();
  const response = await replies.sendGuestReply(context, input);
  assert.equal(response.status, 200);
  const [call] = state.resend;
  assert.equal(call.headers['idempotency-key'], 'recharge-guest-reply/' + REQUEST);
  const sent = JSON.parse(call.body);
  assert.equal(sent.from, 'Recharge Group <guestrelations@rechargegroup.co.uk>');
  assert.deepEqual([sent.to, sent.subject, sent.text], [['guest.one@example.org'], 'Re: Question about check in', 'Check in is from 3pm.']);
  assert.deepEqual(sent.headers, { 'Message-ID': `<${REQUEST}@rechargegroup.co.uk>`, 'In-Reply-To': '<abc@mail.example.org>', References: '<first@x> <abc@mail.example.org>' });
  assert.deepEqual(state.security, [{ name: 'workspace_email_reply_result', args: { input: { requestId: REQUEST, ok: true, messageId: `${REQUEST}@rechargegroup.co.uk` } } }]);
  assert.equal(state.hostaway.length, 0, 'never Hostaway for an email conversation');
  // Email replies switched off: refused, recorded as failed, nothing sent.
  reset({ ...ON, EMAIL_REPLIES_ENABLED: undefined });
  assert.equal((await replies.sendGuestReply(context, input)).status, 503);
  assert.deepEqual(state.resend, []);
  // Resend refuses: a 502 with a friendly message, recorded as failed, nothing stored.
  reset(); const earlier = globalThis.fetch;
  globalThis.fetch = async (url, init) => String(url) === 'https://api.resend.com/emails' ? new Response('{"message":"domain not verified"}', { status: 403 }) : earlier(url, init);
  const refused = await replies.sendGuestReply(context, input);
  globalThis.fetch = earlier;
  assert.equal(refused.status, 502);
  assert.match((await refused.json()).error, /rejected the saved key/);
  assert.deepEqual(state.security.map(c => [c.name, c.args.input.ok]), [['workspace_email_reply_result', false]]);
});

test('attachment links are only as open as the database says: for an owner, a cleaner or Ready nothing is signed', async () => {
  const ID = '44444444-4444-4444-8444-444444444444';
  reset();
  // A person the database allows: a short signed link for exactly their file.
  state.rpc.workspace_email_files = () => ({ data: [{ id: ID, path: 'guest/2026-10/em_1/a1.pdf', filename: 'booking.pdf', mime: 'application/pdf', bytes: 5 }], error: null });
  const ok = await server.emailFilesRoute(new Request('https://app.test/api/workspace/email-files?ids=' + ID));
  assert.deepEqual(await ok.json(), { data: { [ID]: { url: 'https://signed.test/guest/2026-10/em_1/a1.pdf', mime: 'application/pdf', name: 'booking.pdf', bytes: 5 } } });
  // An owner, a cleaner or Ready: the database returns nothing for them, so nothing is signed.
  state.rpc.workspace_email_files = () => ({ data: [], error: null });
  assert.deepEqual(await (await server.emailFilesRoute(new Request('https://app.test/api/workspace/email-files?ids=' + ID))).json(), { data: {} });
  // Bad input never reaches the database.
  reset();
  for (const query of ['', '?ids=not-a-uuid', '?ids=' + Array(61).fill(ID).join(',')]) assert.equal((await server.emailFilesRoute(new Request('https://app.test/api/workspace/email-files' + query))).status, 400, query);
  assert.deepEqual(state.rpcCalls, []);
});
