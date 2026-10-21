import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Guest messages from the company website (migration 20261026200000), over the real route and the real database: the shared key,
// the body checks, the quotas, one Website conversation per guest and home in the Guest inbox (with its notices), the team's reply
// emailed to the guest with the home and dates in the subject, and the guest's emailed answer joining the same conversation.
// The Worker environment, the rate-limit store and Resend itself (fetch) are mocked; the service-role calls run in PGlite.
const root = fileURLToPath(new URL('..', import.meta.url));
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));

const roles = ['admin', 'stays', 'cleans'];
const users = roles.map((_, i) => `99600000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('9960', '9970');
const [ADMIN, ANNA, CLEANER] = [0, 1, 2];
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `web${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], ['Admin', 'Anna', 'Cleo'][i]]);
}
const HARBOUR = (await db.query("insert into public.workspace_properties(name,created_by,request_id,hostaway_listing_id) values('Harbour Flat',$1,gen_random_uuid(),'601876') returning id", [users[ADMIN]])).rows[0].id;
await db.query("insert into public.workspace_module_grants(user_id,module_id) values($1,'guest-communication')", [users[ANNA]]);
await db.query("insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values($1,$2,'staff',$3)", [HARBOUR, users[ANNA], users[ADMIN]]);
await db.query("insert into public.workspace_module_grants(user_id,module_id) values($1,'cleaning-schedule')", [users[CLEANER]]);

async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
async function asBackend() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); await db.exec('set role service_role'); }

// ---------------------------------------------------------------- the route, with its server-side helpers mocked
const KEY = 'website-shared-key-0123456789abcdef-xyz';
const state = { env: {}, quotas: [], counts: {}, deny: new Set(), rpc: [], resend: [] };
globalThis.__websiteMessages = state;
globalThis.__websiteDb = { db, asBackend, as };
const mocks = {
  'cloudflare:workers': `export const env=globalThis.__websiteMessages.env;`,
  'auth-security': `import crypto from 'node:crypto';const s=globalThis.__websiteMessages,d=globalThis.__websiteDb;
    export const securityHash=async(scope,value)=>crypto.createHmac('sha256','test-salt-test-salt-test-salt-test-salt').update(scope+'\\0'+value).digest('hex');
    export const requestQuota=async(request,scope,maximum,seconds,identity)=>{if(!(maximum>=1&&maximum<=1000&&seconds>=1&&seconds<=86400))throw new Error('Invalid limit');const who=identity||request.headers.get('cf-connecting-ip');s.quotas.push({scope,maximum,seconds,who});
      const k=scope+'|'+who;s.counts[k]=(s.counts[k]||0)+1;return s.deny.has(scope)||s.counts[k]>maximum?{allowed:false,retryAfter:120}:{allowed:true,retryAfter:0};};
    export const securityRpc=async(name,args)=>{s.rpc.push({name,args});await d.asBackend();try{const r=await d.db.query('select public.'+name+'($1) result',[args.input]);return r.rows[0].result;}catch(e){throw new Error('Security database unavailable');}finally{await d.db.exec('reset role');}};`,
  'business-server': `export const businessResponse=(body,status=200)=>Response.json(body,{status});export const databaseFailure=error=>Response.json({error:error.message},{status:400});`,
  hostaway: `export const hostawayReplyErrorMessage=()=>'Hostaway failed';export const sendHostawayConversationMessage=async()=>{throw new Error('not here');};`,
  'hostaway-sync': `export const hostawaySyncConfigured=()=>false;`,
};
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false }, plugins: [{
  name: 'isolated-website-messages', enforce: 'pre',
  transform(code, id) {
    if (!/\/(website-guest-messages-server|guest-reply-server|resend-email)\.ts$/.test(id.replaceAll('\\', '/'))) return;
    for (const name of Object.keys(mocks)) code = code.replaceAll(`from '${name === 'cloudflare:workers' ? name : './' + name}'`, `from 'website-test:${name}'`);
    return { code, map: null };
  },
  resolveId: id => id === 'cloudflare:workers' ? '\0website-test:cloudflare:workers' : id.startsWith('website-test:') ? '\0' + id : null,
  load: id => id.startsWith('\0website-test:') ? mocks[id.slice(14)] : null,
}] });
const server = await vite.ssrLoadModule('/lib/website-guest-messages-server.ts');
const replies = await vite.ssrLoadModule('/lib/guest-reply-server.ts');
const { inboxListSchema, inboxThreadSchema } = await vite.ssrLoadModule('/lib/guest-inbox-policy.ts');
const routeFile = await fs.readFile('app/api/website/guest-messages/route.ts', 'utf8');
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  state.resend.push({ url: u, method: init.method, headers: Object.fromEntries(new Headers(init.headers)), body: init.body ? JSON.parse(init.body) : null });
  if (u === 'https://api.resend.com/emails' && init.method === 'POST') return Response.json({ id: 'resend_web_' + state.resend.length });
  throw new Error('Unexpected fetch ' + u);
};
after(async () => { globalThis.fetch = realFetch; delete globalThis.__websiteMessages; delete globalThis.__websiteDb; await vite.close(); await db.close(); });

function reset(env = { WEBSITE_MESSAGES_KEY: KEY, RESEND_API_KEY: 're_test', EMAIL_REPLIES_ENABLED: 'true' }) {
  for (const k of Object.keys(state.env)) delete state.env[k];
  Object.assign(state.env, env);
  Object.assign(state, { quotas: [], counts: {}, deny: new Set(), rpc: [], resend: [] });
}
beforeEach(async () => { reset(); await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });

const message = (extra = {}) => ({
  source: 'website', home: { slug: '4-bedroom-home-in-boness', hostawayListingId: 601876, town: "Bo'ness" },
  name: 'Gina Guest', email: 'Gina.Guest@example.org', phone: '07700 900123',
  body: 'Hi, I would like to book from 10 Nov to 16 Nov for 2 guests.',
  booking: { checkin: '2026-11-10', checkout: '2026-11-16', guests: 2, total: 1073, currency: 'GBP' },
  sentAt: new Date().toISOString(), ...extra,
});
const post = (body, { key = KEY, raw = false, method = 'POST', ip = '76.76.21.21' } = {}) => server.websiteGuestMessageRoute(new Request('https://app.test/api/website/guest-messages', {
  method, headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...(key === null ? {} : { 'x-recharge-website-key': key }) }, ...(method === 'POST' ? { body: raw ? body : JSON.stringify(body) } : {}),
}));
const websiteThreads = async () => (await db.query("select * from private.workspace_guest_threads where source='website' order by created_at,thread_ref")).rows;
const messagesOf = async t => (await db.query('select * from private.workspace_guest_messages where source=$1 and thread_ref=$2 order by sent_at,id', [t.source, t.thread_ref])).rows;
// The Guest inbox's own database calls, made as one of the team.
const inboxClient = i => ({ rpc: async (name, args) => {
  await as(i);
  try {
    const sql = name === 'workspace_guest_inbox_read' ? 'select public.workspace_guest_inbox_read($1,$2,$3) r' : `select public.${name}($1) r`;
    const values = name === 'workspace_guest_inbox_read' ? [args.section, args.target, args.status_filter] : [args.input];
    return { data: (await db.query(sql, values)).rows[0].r, error: null };
  } catch (error) { return { data: null, error }; } finally { await db.exec('reset role'); }
} });

test('every quota the website routes ask for is one the real rate limiter accepts (1 to 1,000 per 1 second to 1 day)', async () => {
  // The limiter here is a stand-in, so read the real bounds from the migration and the asks from the source.
  const limiter = await fs.readFile('supabase/migrations/20261003162617_authentication_security.sql', 'utf8');
  assert.match(limiter, /maximum not between 1 and 1000 or window_seconds not between 1 and 86400/);
  const source = await fs.readFile('lib/website-guest-messages-server.ts', 'utf8');
  const asks = [...source.matchAll(/requestQuota\(request, '([a-z-]+)', ([^,]+), (\d+)/g)];
  assert.ok(asks.length >= 4);
  for (const [, scope, maximum, seconds] of asks)
    for (const n of maximum.match(/\d+/g).map(Number)) assert.ok(n >= 1 && n <= 1000 && Number(seconds) <= 86400, `${scope}: ${maximum} per ${seconds}s`);
});

test('the route is the POST handler, server to server, and the backend serves it', async () => {
  assert.match(routeFile, /export const POST = \(request: Request\) => websiteGuestMessageRoute\(request\)/);
  assert.match(await fs.readFile('worker/backend-route-policy.ts', 'utf8'), /"\/api\/website\/guest-messages"/);
  // No Origin header from the website's server: the proxy leaves the key check to the route.
  const proxyFile = await fs.readFile('proxy.ts', 'utf8');
  assert.match(proxyFile, /const websiteRoutes = \["\/api\/website\/guest-messages", "\/api\/website\/guest-chat"\];/);
  assert.match(proxyFile, /\.\.\.websiteRoutes\]\.includes\(request\.nextUrl\.pathname\)/);
  // Every guest reaches these routes from the website's few server addresses: they keep their own quotas, not the per-address one.
  assert.match(proxyFile, /startsWith\("\/api\/"\) && !websiteRoutes\.includes\(request\.nextUrl\.pathname\) \? requestQuota\(request, "api-ip"/);
});

test('a missing or wrong key is refused with 401 before anything is read or stored', async () => {
  for (const [name, key] of [['missing', null], ['empty', ''], ['wrong', KEY.slice(0, -1) + 'Q'], ['prefix', KEY.slice(0, 20)], ['longer', KEY + 'x'], ['case', KEY.toUpperCase()]]) {
    const response = await post(message(), { key });
    assert.equal(response.status, 401, name);
  }
  assert.deepEqual([state.quotas, state.rpc], [[], []]);
  // Not set up (no key, or one too short to be safe): unavailable, whatever is sent.
  for (const env of [{}, { WEBSITE_MESSAGES_KEY: 'short' }]) {
    reset(env);
    assert.equal((await post(message())).status, 503);
  }
  reset();
  assert.equal((await post(null, { method: 'GET' })).status, 405);
  assert.deepEqual([state.quotas, state.rpc, await websiteThreads()], [[], [], []]);
});

test('an invalid body is refused with 400 and stores nothing', async () => {
  const cases = [
    ['not JSON', '{nope', true],
    ['no email', message({ email: undefined })],
    ['bad email', message({ email: 'not-an-email' })],
    ['no name', message({ name: '  ' })],
    ['no message', message({ body: '' })],
    ['message too long', message({ body: 'x'.repeat(4001) })],
    ['name too long', message({ name: 'n'.repeat(121) })],
    ['bad date format', message({ booking: { checkin: '10/11/2026', checkout: '2026-11-16', guests: 2 } })],
    ['impossible date', message({ booking: { checkin: '2026-02-30', checkout: '2026-03-02', guests: 2 } })],
    ['check-out before check-in', message({ booking: { checkin: '2026-11-16', checkout: '2026-11-10', guests: 2 } })],
    ['no guests', message({ booking: { checkin: '2026-11-10', checkout: '2026-11-16', guests: 0 } })],
    ['bad slug', message({ home: { slug: '../etc', hostawayListingId: 601876 } })],
    ['bad phone', message({ phone: '<script>' })],
    ['too large', JSON.stringify(message({ extra: 'x'.repeat(40_000) })), true],
  ];
  for (const [name, body, raw] of cases) assert.equal((await post(body, { raw })).status, 400, name);
  assert.deepEqual([state.rpc, await websiteThreads()], [[], []]);
});

test('a new guest makes a Website conversation and message, on the home, open, and tells the team', async () => {
  const outboxBefore = Number((await db.query('select count(*) n from private.workspace_notification_outbox')).rows[0].n);
  const response = await post(message());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, duplicate: false });
  // Quotas: per address (the website's servers), then per guest email.
  assert.deepEqual(state.quotas.map(q => [q.scope, q.who]), [['website-message-ip', '76.76.21.21'], ['website-message-email', 'email:gina.guest@example.org']]);
  const [t] = await websiteThreads();
  assert.equal(t.source, 'website');
  assert.equal(t.channel, 'website');
  assert.equal(t.guest_name, 'Gina Guest');
  assert.equal(t.guest_email, 'gina.guest@example.org');
  assert.equal(t.property_id, HARBOUR);
  assert.equal(t.status, 'open');
  assert.deepEqual([t.check_in.toISOString().slice(0, 10), t.check_out.toISOString().slice(0, 10)], ['2026-11-10', '2026-11-16']);
  assert.ok(t.last_message_at);
  const [m] = await messagesOf(t);
  assert.deepEqual([m.direction, m.channel, m.property_id], ['guest', 'website', HARBOUR]);
  assert.equal(m.body, 'Booking request: 10 Nov to 16 Nov 2026 · 2 guests · quoted £1,073.00\nPhone: 07700 900123\n\nHi, I would like to book from 10 Nov to 16 Nov for 2 guests.');
  // The same notices as any guest message: the admin and Anna (on the home), never the cleaner.
  const told = (await db.query('select o.user_id from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where a.event_type=$1 and a.property_id=$2', ['guest.message', HARBOUR])).rows.map(r => r.user_id).sort();
  assert.deepEqual(told, [users[ADMIN], users[ANNA]].sort());
  assert.ok(Number((await db.query('select count(*) n from private.workspace_notification_outbox')).rows[0].n) > outboxBefore);
  // Anna sees it waiting in the Stays Communication Centre, under the Website channel; the cleaner cannot open the inbox at all.
  await as(ANNA);
  const list = inboxListSchema.parse((await db.query("select public.workspace_guest_inbox_read('list',null,'waiting') r")).rows[0].r);
  const row = list.threads.find(x => x.id === t.id);
  assert.deepEqual([row.source, row.channel, row.propertyName, row.guestName, row.lastFrom], ['website', 'website', 'Harbour Flat', 'Gina Guest', 'guest']);
  assert.ok(row.waitingSince);
  await as(CLEANER);
  await assert.rejects(db.query("select public.workspace_guest_inbox_read('list',null,'waiting')"));
  // Nobody signed in can call the ingest directly.
  await as(ANNA);
  await assert.rejects(db.query("select public.workspace_website_message_ingest('{}'::jsonb)"), /permission denied/);
  await db.exec('reset role');
});

test('the same guest and home join the same conversation; a retried delivery is stored once; another home is its own conversation', async () => {
  const [t] = await websiteThreads();
  await db.query("update private.workspace_guest_threads set status='done' where id=$1", [t.id]);
  const again = message({ email: 'GINA.guest@example.org', name: 'Gina G', body: 'Is there parking?', booking: null, phone: null, sentAt: new Date(Date.now() + 1000).toISOString() });
  assert.equal((await post(again)).status, 200);
  assert.equal((await websiteThreads()).length, 1);
  let msgs = await messagesOf(t);
  assert.deepEqual(msgs.map(m => m.body), [msgs[0].body, 'Is there parking?']);
  const reopened = (await websiteThreads())[0];
  assert.deepEqual([reopened.status, reopened.guest_name, reopened.guest_email], ['open', 'Gina G', 'gina.guest@example.org']);
  assert.ok(reopened.last_message_at >= t.last_message_at);
  // The website retries the same delivery: answered 200 (so it stops), stored once, nobody told twice.
  const notices = Number((await db.query('select count(*) n from private.workspace_notification_outbox')).rows[0].n);
  const retry = await post(again);
  assert.equal(retry.status, 200);
  assert.deepEqual(await retry.json(), { ok: true, duplicate: true });
  assert.equal((await messagesOf(t)).length, 2);
  assert.equal(Number((await db.query('select count(*) n from private.workspace_notification_outbox')).rows[0].n), notices);
  // A home whose listing matches no property: a separate, unmatched conversation that says which home it was about.
  assert.equal((await post(message({ home: { slug: 'cottage-in-crail', hostawayListingId: 999999, town: 'Crail' }, booking: null, phone: null, body: 'Dogs welcome?' }))).status, 200);
  // No home at all: one more.
  assert.equal((await post(message({ home: null, booking: null, phone: null, body: 'General question' }))).status, 200);
  const all = await websiteThreads();
  assert.equal(all.length, 3);
  assert.equal(all.filter(x => x.property_id === null).length, 2);
  const bodies = (await db.query("select body from private.workspace_guest_messages where source='website' and property_id is null order by sent_at")).rows.map(r => r.body);
  assert.deepEqual(bodies, ["Home: Crail · cottage-in-crail\nDogs welcome?", 'General question']);
});

test('quotas: ten messages an hour per guest email, and the website-wide ceiling, each answered 429 with Retry-After', async () => {
  for (let i = 0; i < 10; i++) assert.equal((await post(message({ email: 'busy@example.org', body: 'Message ' + i, booking: null }))).status, 200, 'message ' + i);
  const limited = await post(message({ email: 'busy@example.org', body: 'One too many', booking: null }));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('Retry-After'), '120');
  assert.equal(Number((await db.query("select count(*) n from private.workspace_guest_threads where guest_email='busy@example.org'")).rows[0].n), 1);
  assert.equal(Number((await db.query("select count(*) n from private.workspace_guest_messages g join private.workspace_guest_threads t on t.source=g.source and t.thread_ref=g.thread_ref where t.guest_email='busy@example.org'")).rows[0].n), 10);
  assert.ok(state.quotas.every(q => q.scope !== 'website-message-email' || (q.maximum === 10 && q.seconds === 3600)));
  // Another guest is unaffected; the address ceiling stops everyone before the body is even read.
  assert.equal((await post(message({ email: 'calm@example.org', booking: null }))).status, 200);
  state.deny.add('website-message-ip');
  const rpcBefore = state.rpc.length;
  assert.equal((await post(message({ email: 'calm2@example.org' }))).status, 429);
  assert.equal(state.rpc.length, rpcBefore);
  assert.ok(state.quotas.some(q => q.scope === 'website-message-ip' && q.maximum === 1000 && q.seconds === 3600));
});

test('a team reply is emailed to the guest with the home and dates in the subject, and the guest’s emailed answer joins the conversation', async () => {
  const t = (await websiteThreads()).find(x => x.property_id === HARBOUR);
  await as(ANNA);
  const thread = inboxThreadSchema.parse((await db.query("select public.workspace_guest_inbox_read('thread',$1,null) r", [t.id])).rows[0].r);
  assert.equal(thread.thread.channel, 'website');
  const client = { rpc: async (name, args) => {
    await as(ANNA);
    try {
      const sql = name === 'workspace_guest_inbox_read' ? 'select public.workspace_guest_inbox_read($1,$2,$3) r' : `select public.${name}($1) r`;
      const values = name === 'workspace_guest_inbox_read' ? [args.section, args.target, args.status_filter] : [args.input];
      return { data: (await db.query(sql, values)).rows[0].r, error: null };
    } catch (error) { return { data: null, error }; } finally { await db.exec('reset role'); }
  } };
  const requestId = crypto.randomUUID();
  const response = await replies.sendGuestReply({ client }, { action: 'sendReply', requestId, threadId: t.id, body: 'Yes, there is free parking outside.' });
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const sent = state.resend.filter(r => r.url === 'https://api.resend.com/emails');
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].body.to, ['gina.guest@example.org']);
  assert.equal(sent[0].body.subject, 'Your Recharge stay at Harbour Flat, 10 Nov to 16 Nov 2026');
  assert.match(sent[0].body.from, /guestrelations@rechargegroup\.co\.uk/);
  assert.equal(sent[0].body.text, 'Yes, there is free parking outside.');
  assert.equal(sent[0].headers['idempotency-key'], `recharge-guest-reply/${requestId}`);
  // Stored in the website conversation, delivered, and no longer waiting.
  let msgs = await messagesOf(t);
  const reply = msgs.at(-1);
  assert.deepEqual([reply.direction, reply.delivery, reply.author_user_id, reply.source], ['team', 'sent', users[ANNA], 'website']);
  await as(ANNA);
  assert.equal(inboxThreadSchema.parse((await db.query("select public.workspace_guest_inbox_read('thread',$1,null) r", [t.id])).rows[0].r).thread.waitingSince, null);
  // The guest answers that email: it comes back into the same Website conversation, not a new email one.
  const outId = sent[0].body.headers['Message-ID'];
  await asBackend();
  const stored = (await db.query('select public.workspace_email_guest_ingest($1) r', [{ emailId: 'em_web_1', from: 'gina.guest@example.org', fromName: 'Gina', subject: 'Re: ' + sent[0].body.subject, text: 'Great, thank you!', messageId: '<answer@example.org>', inReplyTo: outId, references: [outId] }])).rows[0].r;
  await db.exec('reset role');
  assert.deepEqual([stored.stored, stored.matched, stored.threadId], [true, 'reply', t.id]);
  msgs = await messagesOf(t);
  assert.deepEqual([msgs.at(-1).direction, msgs.at(-1).body, msgs.at(-1).channel], ['guest', 'Great, thank you!', 'email']);
  assert.equal(Number((await db.query("select count(*) n from private.workspace_guest_threads where source='email'")).rows[0].n), 0);
  // A second reply threads on the last email sent.
  const second = await replies.sendGuestReply({ client }, { action: 'sendReply', requestId: crypto.randomUUID(), threadId: t.id, body: 'See you soon.' });
  assert.equal(second.status, 200);
  const next = state.resend.filter(r => r.url === 'https://api.resend.com/emails')[1];
  assert.equal(next.body.subject, 'Your Recharge stay at Harbour Flat, 10 Nov to 16 Nov 2026');
  assert.equal(next.body.headers['In-Reply-To'], '<answer@example.org>');
});

test('with email replies switched off, a website conversation is not sent', async () => {
  reset({ WEBSITE_MESSAGES_KEY: KEY });
  const t = (await websiteThreads()).find(x => x.property_id === HARBOUR);
  const before = (await db.query('select count(*) n from private.workspace_guest_reply_requests')).rows[0].n;
  const response = await replies.sendGuestReply({ client: inboxClient(ANNA) }, { action: 'sendReply', requestId: crypto.randomUUID(), threadId: t.id, body: 'Hello' });
  assert.equal(response.status, 503);
  assert.deepEqual(state.resend, []);
  assert.equal((await db.query('select count(*) n from private.workspace_guest_reply_requests')).rows[0].n, before);
});

// ---------------------------------------------------------------- live chat (20261027100000)
const CHAT = 'chat_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
const OTHER_CHAT = 'chat_' + 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2';
const chatRoute = await vite.ssrLoadModule('/lib/website-guest-messages-server.ts');
const read = (chat, { key = KEY, method = 'POST', raw } = {}) => chatRoute.websiteGuestChatRoute(new Request('https://app.test/api/website/guest-chat', {
  method, headers: { 'content-type': 'application/json', 'cf-connecting-ip': '76.76.21.21', ...(key === null ? {} : { 'x-recharge-website-key': key }) }, ...(method === 'POST' ? { body: raw ?? JSON.stringify({ chat }) } : {}),
}));
const chatThread = async () => (await websiteThreads()).find(t => t.thread_ref.startsWith('website-chat:') && t.guest_email === 'chloe.chat@example.org');

test('a message with a chat key is its own conversation: the key is stored only as a hash, and an email alone never joins it', async () => {
  const first = message({ email: 'Chloe.Chat@example.org', name: 'Chloe', chat: CHAT });
  assert.equal((await post(first)).status, 200);
  const t = await chatThread();
  assert.ok(t, 'a chat conversation');
  assert.match(t.thread_ref, /^website-chat:[0-9a-f]{64}$/);
  assert.ok(!t.thread_ref.includes(CHAT) && !JSON.stringify(state.rpc).includes(CHAT), 'the raw chat key never reaches the database');
  assert.deepEqual([t.property_id, t.status, t.channel], [HARBOUR, 'open', 'website']);
  // Quotas for a chat: more messages per guest email, and a limit per chat.
  assert.ok(state.quotas.some(q => q.scope === 'website-message-email' && q.maximum === 40));
  assert.ok(state.quotas.some(q => q.scope === 'website-chat-message' && q.maximum === 30 && q.who === t.thread_ref.replace('website-chat:', 'chat:')));
  // Same guest, same home, same chat: same conversation.
  assert.equal((await post(message({ email: 'chloe.chat@example.org', name: 'Chloe', chat: CHAT, body: 'Is there a cot?', booking: null, phone: null, sentAt: new Date(Date.now() + 1000).toISOString() }))).status, 200);
  assert.equal((await messagesOf(t)).length, 2);
  // Same guest and home without the chat key, or in another chat: other conversations, so nobody reads a chat by knowing an email.
  assert.equal((await post(message({ email: 'chloe.chat@example.org', name: 'Chloe', booking: null, phone: null, body: 'Plain message' }))).status, 200);
  assert.equal((await post(message({ email: 'chloe.chat@example.org', name: 'Chloe', chat: OTHER_CHAT, booking: null, phone: null, body: 'Another tab' }))).status, 200);
  const hers = (await websiteThreads()).filter(x => x.guest_email === 'chloe.chat@example.org');
  assert.equal(hers.length, 3);
  assert.equal(hers.filter(x => x.thread_ref.startsWith('website-chat:')).length, 2);
  // A malformed chat key is refused like any other bad field.
  for (const chat of ['short', 'x'.repeat(129), 'has spaces in it and is long enough to pass the length', '../../../../etc/passwd/../../../../etc/passwd'])
    assert.equal((await post(message({ chat }))).status, 400, chat);
});

test('reading a chat back: the key is checked first, an unknown chat is empty, and the guest sees only their own words', async () => {
  for (const key of [null, '', KEY.slice(0, -1) + 'Q']) assert.equal((await read(CHAT, { key })).status, 401);
  assert.equal((await read(CHAT, { method: 'GET' })).status, 405);
  for (const raw of ['{nope', JSON.stringify({ chat: 'short' }), JSON.stringify({ chat: CHAT, extra: 'x'.repeat(2000) })]) assert.equal((await read(null, { raw })).status, 400, raw);
  reset({});
  assert.equal((await read(CHAT)).status, 503);
  reset();
  assert.deepEqual(await (await read('chat_' + 'n'.repeat(40))).json(), { ok: true, found: false, messages: [] });
  const body = await (await read(CHAT)).json();
  assert.equal(body.found, true);
  assert.deepEqual(body.messages.map(m => [m.from, m.body]), [['guest', 'Hi, I would like to book from 10 Nov to 16 Nov for 2 guests.'], ['guest', 'Is there a cot?']]);
  assert.ok(body.messages.every(m => m.id && m.sentAt && !('name' in m)));
  assert.ok(state.quotas.some(q => q.scope === 'website-chat-read' && q.maximum === 30 && q.seconds === 60));
  // The other chat shows only its own message.
  assert.deepEqual((await (await read(OTHER_CHAT)).json()).messages.map(m => m.body), ['Another tab']);
  assert.equal(chatRoute.guestWords('Booking request: 1 Dec to 3 Dec 2026 · 2 guests\nPhone: 07700 900123\n\nHello'), 'Hello');
  assert.equal(chatRoute.guestWords('Home: Crail · cottage-in-crail\nDogs welcome?'), 'Dogs welcome?');
  assert.equal(chatRoute.guestWords('Phone: is the wifi fast?'), 'Phone: is the wifi fast?');
});

test('the inbox marks a chat, and Send puts the reply in the chat (never an email), even with email replies switched off', async () => {
  reset({ WEBSITE_MESSAGES_KEY: KEY });
  const t = await chatThread();
  await as(ANNA);
  const view = inboxThreadSchema.parse((await db.query("select public.workspace_guest_inbox_read('thread',$1,null) r", [t.id])).rows[0].r);
  await db.exec('reset role');
  assert.equal(view.thread.websiteChat, true);
  const { guestSendRoute } = await vite.ssrLoadModule('/lib/repair-contractors.ts');
  const { repliesByEmail, repliesInChat } = await vite.ssrLoadModule('/lib/guest-inbox-policy.ts');
  assert.equal(guestSendRoute({ ...view, canSend: false, canSendEmail: false }), 'send');
  assert.deepEqual([repliesInChat(view.thread), repliesByEmail(view.thread)], [true, false]);
  const plain = (await websiteThreads()).find(x => x.guest_email === 'chloe.chat@example.org' && !x.thread_ref.startsWith('website-chat:'));
  await as(ANNA);
  const plainView = inboxThreadSchema.parse((await db.query("select public.workspace_guest_inbox_read('thread',$1,null) r", [plain.id])).rows[0].r);
  await db.exec('reset role');
  assert.deepEqual([plainView.thread.websiteChat, guestSendRoute({ ...plainView, canSend: false, canSendEmail: false })], [false, 'none']);

  const requestId = crypto.randomUUID();
  const response = await replies.sendGuestReply({ client: inboxClient(ANNA) }, { action: 'sendReply', requestId, threadId: t.id, body: 'Yes, we can add a cot.' });
  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  assert.deepEqual(state.resend, []);
  const reply = (await messagesOf(t)).at(-1);
  assert.deepEqual([reply.direction, reply.delivery, reply.channel, reply.author_user_id, reply.body], ['team', 'sent', 'website', users[ANNA], 'Yes, we can add a cot.']);
  // Pressing Send again with the same request: stored once.
  assert.equal((await replies.sendGuestReply({ client: inboxClient(ANNA) }, { action: 'sendReply', requestId, threadId: t.id, body: 'Yes, we can add a cot.' })).status, 200);
  assert.equal((await messagesOf(t)).filter(m => m.direction === 'team').length, 1);
  await as(ANNA);
  assert.equal(inboxThreadSchema.parse((await db.query("select public.workspace_guest_inbox_read('thread',$1,null) r", [t.id])).rows[0].r).thread.waitingSince, null);
  await db.exec('reset role');
  // The guest's chat window shows it, with the team member's first name.
  const shown = (await (await read(CHAT)).json()).messages.at(-1);
  assert.deepEqual([shown.from, shown.body, shown.name], ['team', 'Yes, we can add a cot.', 'Anna']);
  // A non-chat website conversation with email switched off is still refused, and nothing is written.
  const before = (await db.query('select count(*) n from private.workspace_guest_reply_requests')).rows[0].n;
  assert.equal((await replies.sendGuestReply({ client: inboxClient(ANNA) }, { action: 'sendReply', requestId: crypto.randomUUID(), threadId: plain.id, body: 'Hello' })).status, 503);
  assert.equal((await db.query('select count(*) n from private.workspace_guest_reply_requests')).rows[0].n, before);
});

test('a chat leaves out hidden messages and replies that did not go out; the chat functions are for the service role only', async () => {
  const t = await chatThread();
  const [firstGuest] = await messagesOf(t);
  await db.query("update private.workspace_guest_messages set hidden_at=now() where id=$1", [firstGuest.id]);
  await db.query("insert into private.workspace_guest_messages(source,external_id,thread_ref,property_id,channel,direction,sent_at,author_user_id,body,delivery) values('website','chat-out:failed-one',$1,$2,'website','team',now(),$3,'Not delivered','failed')", [t.thread_ref, HARBOUR, users[ANNA]]);
  const bodies = (await (await read(CHAT)).json()).messages.map(m => m.body);
  assert.deepEqual(bodies, ['Is there a cot?', 'Yes, we can add a cot.']);
  await as(ANNA);
  for (const fn of ['workspace_website_chat_read', 'workspace_website_reply_result'])
    await assert.rejects(db.query(`select public.${fn}('{}'::jsonb)`), /permission denied/, fn);
  await db.exec('reset role');
  // The reply result refuses a conversation that is not a chat.
  const plain = (await websiteThreads()).find(x => x.guest_email === 'chloe.chat@example.org' && !x.thread_ref.startsWith('website-chat:'));
  const requestId = crypto.randomUUID();
  await db.query('insert into private.workspace_guest_reply_requests(request_id,thread_id,user_id,body) values($1,$2,$3,$4)', [requestId, plain.id, users[ANNA], 'x']);
  await asBackend();
  await assert.rejects(db.query('select public.workspace_website_reply_result($1)', [{ requestId }]), /Not a website chat/);
  await db.exec('reset role');
});
