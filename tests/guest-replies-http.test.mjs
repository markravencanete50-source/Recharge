import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// Sending a reply from the Guest inbox through Hostaway, over the real route, with the database,
// the backend's service role and Hostaway (fetch) mocked.
const root = fileURLToPath(new URL('..', import.meta.url));
const state = { env: {}, rpcCalls: [], securityCalls: [], hostaway: [], rpc: {}, securityFails: false, answer: () => Response.json({ status: 'success', result: { id: 777 } }) };
globalThis.__guestReplies = state;
const mocks = {
  'cloudflare:workers': `export const env=globalThis.__guestReplies.env;`,
  'auth-security': `const s=globalThis.__guestReplies;export const authSecurityConfiguration=()=>({origin:'https://app.test'});export const requestQuota=async()=>({allowed:true});
    export const securityRpc=async(name,args)=>{s.securityCalls.push({name,args});if(s.securityFails)throw new Error('Security database unavailable');return {recorded:true};};`,
  'business-server': `const s=globalThis.__guestReplies;export const businessResponse=(body,status=200)=>Response.json(body,{status});
    export const businessContext=async()=>({client:{rpc:async(name,args)=>{s.rpcCalls.push({name,args});return s.rpc[name]?s.rpc[name](args):{data:null,error:null};}},account:{userId:'u1',role:'stays',status:'active'}});
    export const databaseFailure=error=>Response.json({error:error.message},{status:error.code==='42501'?403:error.code==='22023'?400:503});
    export const viewAsFailure=()=>null;`,
};
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false }, plugins: [{
  name: 'isolated-guest-replies', enforce: 'pre',
  transform(code, id) {
    if (!/\/(guest-reply-server|hostaway-sync|workspace-rpc-route)\.ts$/.test(id.replaceAll('\\', '/'))) return;
    for (const name of Object.keys(mocks)) code = code.replaceAll(`from '${name === 'cloudflare:workers' ? name : './' + name}'`, `from 'replies-test:${name}'`);
    return { code, map: null };
  },
  resolveId: id => id === 'cloudflare:workers' ? '\0replies-test:cloudflare:workers' : id.startsWith('replies-test:') ? '\0' + id : null,
  load: id => id.startsWith('\0replies-test:') ? mocks[id.slice(14)] : null,
}] });
const { workspaceGuestInbox } = await vite.ssrLoadModule('/lib/guest-inbox-server.ts');
const { inboxActionSchema, inboxListSchema, inboxThreadSchema } = await vite.ssrLoadModule('/lib/guest-inbox-policy.ts');
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  if (String(url).endsWith('/accessTokens')) return Response.json({ access_token: 'token', expires_in: 3600 });
  state.hostaway.push({ url: String(url), method: init.method ?? 'GET', headers: Object.fromEntries(new Headers(init.headers)), body: init.body });
  return state.answer();
};
after(async () => { globalThis.fetch = realFetch; delete globalThis.__guestReplies; await vite.close(); });

const ON = { HOSTAWAY_ACCOUNT_ID: '1', HOSTAWAY_API_KEY: 'k', HOSTAWAY_SYNC_ENABLED: 'true', HOSTAWAY_REPLIES_ENABLED: 'true' };
const THREAD = '11111111-1111-4111-8111-111111111111', REQUEST = '22222222-2222-4222-8222-222222222222';
const thread = { id: THREAD, source: 'hostaway', channel: 'airbnb', guestName: 'Alex Kim', propertyId: null, propertyName: null, reservationRef: 'HMFMWDE8AH', checkIn: null, checkOut: null,
  status: 'open', lastMessageAt: null, preview: null, lastFrom: 'guest', waitingSince: null, messages: 1 };
const targets = { greenMinutes: 5, amberMinutes: 15 };
function reset(env = ON) {
  for (const k of Object.keys(state.env)) delete state.env[k];
  Object.assign(state.env, env);
  Object.assign(state, { rpcCalls: [], securityCalls: [], hostaway: [], securityFails: false, answer: () => Response.json({ status: 'success', result: { id: 777 } }),
    rpc: {
      workspace_guest_inbox_action: ({ input }) => ({ data: { send: true, conversationId: '4101', requestId: input.requestId }, error: null }),
      workspace_guest_inbox_read: ({ section }) => ({ data: section === 'list' ? { threads: [thread], waiting: 0, targets, connected: true } : { thread, targets, messages: [] }, error: null }),
    } });
}
const post = body => workspaceGuestInbox(new Request('https://app.test/api/workspace/guest-inbox', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://app.test' }, body: JSON.stringify(body) }));
const get = query => workspaceGuestInbox(new Request('https://app.test/api/workspace/guest-inbox?' + new URLSearchParams(query)));
const reply = (body = 'Check in is from 3pm') => post({ action: 'sendReply', requestId: REQUEST, threadId: THREAD, body });
const noWrites = () => assert.deepEqual([state.hostaway, state.rpcCalls, state.securityCalls], [[], [], []]);

test('sendReply is a strict action with a trimmed reply of 1 to 5000 characters', () => {
  const parsed = inboxActionSchema.parse({ action: 'sendReply', requestId: REQUEST, threadId: THREAD, body: '  Hello  ' });
  assert.equal(parsed.body, 'Hello');
  for (const bad of [{ body: '   ' }, { body: 'x'.repeat(5001) }, { body: undefined }, { threadId: undefined }, { requestId: 'x' }, { sentAt: new Date().toISOString() }])
    assert.equal(inboxActionSchema.safeParse({ action: 'sendReply', requestId: REQUEST, threadId: THREAD, body: 'Hello', ...bad }).success, false, JSON.stringify(bad));
  assert.equal(inboxActionSchema.safeParse({ action: 'sendReply', requestId: REQUEST, threadId: THREAD, body: 'x'.repeat(5000) }).success, true);
});

test('with sending switched off, Send is refused with a clear message and Hostaway is never called', async () => {
  for (const env of [
    { ...ON, HOSTAWAY_REPLIES_ENABLED: undefined }, { ...ON, HOSTAWAY_REPLIES_ENABLED: 'false' }, { ...ON, HOSTAWAY_REPLIES_ENABLED: 'TRUE' },
    { ...ON, HOSTAWAY_SYNC_ENABLED: undefined }, { ...ON, HOSTAWAY_API_KEY: undefined }, {},
  ]) {
    reset(env);
    const response = await reply();
    assert.equal(response.status, 503, JSON.stringify(env));
    assert.match((await response.json()).error, /Sending replies from Recharge is switched off\. Reply in Hostaway/);
    // Only a read, to see whether the conversation is a website chat (answered in the chat whatever the switches); nothing written.
    assert.deepEqual(state.rpcCalls.map(c => c.name), ['workspace_guest_inbox_read']);
    assert.deepEqual([state.hostaway, state.securityCalls], [[], []]);
  }
});

test('reading the inbox says whether Send is available', async () => {
  reset();
  const list = await (await get({ section: 'list', status: 'all' })).json();
  assert.equal(list.data.canSend, true);
  assert.equal(inboxListSchema.parse(list.data).canSend, true);
  const one = await (await get({ section: 'thread', threadId: THREAD })).json();
  assert.equal(inboxThreadSchema.parse(one.data).canSend, true);
  assert.equal(one.data.thread.id, THREAD, 'the rest is passed on untouched');
  assert.deepEqual(state.rpcCalls[0], { name: 'workspace_guest_inbox_read', args: { section: 'list', target: null, status_filter: 'all' } });
  reset({ ...ON, HOSTAWAY_REPLIES_ENABLED: undefined });
  assert.equal((await (await get({ section: 'list', status: 'all' })).json()).data.canSend, false);
  assert.equal((await (await get({ section: 'thread', threadId: THREAD })).json()).data.canSend, false);
  assert.equal(inboxThreadSchema.parse({ thread, targets, messages: [] }).canSend, false, 'an older answer reads as off');
  // A database error comes through as before.
  state.rpc.workspace_guest_inbox_read = () => ({ data: null, error: { code: '42501', message: 'Guest inbox access required' } });
  const denied = await get({ section: 'list', status: 'all' });
  assert.deepEqual([denied.status, (await denied.json()).error], [403, 'Guest inbox access required']);
});

test('with sending on, the reply is recorded, posted to Hostaway once, and its outcome saved', async () => {
  reset();
  const response = await reply('  Check in is from 3pm  ');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, data: thread });
  // The database first (as the signed-in user), with the trimmed reply.
  assert.deepEqual(state.rpcCalls[0], { name: 'workspace_guest_inbox_action', args: { input: { action: 'sendReply', requestId: REQUEST, threadId: THREAD, body: 'Check in is from 3pm' } } });
  // Hostaway once, on that conversation, through the channel.
  assert.equal(state.hostaway.length, 1);
  const [call] = state.hostaway;
  assert.deepEqual([call.method, call.url, call.headers.authorization, call.headers['content-type']], ['POST', 'https://api.hostaway.com/v1/conversations/4101/messages', 'Bearer token', 'application/json']);
  assert.deepEqual(JSON.parse(call.body), { body: 'Check in is from 3pm', communicationType: 'channel' });
  // Then the outcome, through the backend's own connection, then the fresh thread.
  assert.deepEqual(state.securityCalls, [{ name: 'workspace_guest_reply_result', args: { input: { requestId: REQUEST, ok: true, hostawayMessageId: '777' } } }]);
  assert.deepEqual(state.rpcCalls.map(c => c.name), ['workspace_guest_inbox_action', 'workspace_guest_inbox_read']);
  assert.deepEqual(state.rpcCalls[1].args, { section: 'thread', target: THREAD, status_filter: null });
});

test('when Hostaway gives no message id the result goes without one', async () => {
  reset(); state.answer = () => Response.json({ status: 'success', result: {} });
  assert.equal((await reply()).status, 200);
  assert.deepEqual(state.securityCalls[0].args.input, { requestId: REQUEST, ok: true });
  reset(); state.answer = () => Response.json({ status: 'success', result: null });
  assert.equal((await reply()).status, 200);
  assert.deepEqual(state.securityCalls[0].args.input, { requestId: REQUEST, ok: true });
});

test('a request already sent, or still going out, is not posted again', async () => {
  reset(); state.rpc.workspace_guest_inbox_action = () => ({ data: { send: false, thread }, error: null });
  const response = await reply();
  assert.deepEqual([response.status, await response.json()], [200, { ok: true, data: thread }]);
  assert.deepEqual([state.hostaway, state.securityCalls], [[], []]);
});

test('the database refusing the reply stops everything before Hostaway', async () => {
  reset(); state.rpc.workspace_guest_inbox_action = () => ({ data: null, error: { code: '22023', message: 'Only Hostaway conversations can be replied to from here' } });
  const response = await reply();
  assert.deepEqual([response.status, (await response.json()).error], [400, 'Only Hostaway conversations can be replied to from here']);
  assert.deepEqual([state.hostaway, state.securityCalls], [[], []]);
  reset(); state.rpc.workspace_guest_inbox_action = () => ({ data: null, error: { code: 'P0002', message: 'Conversation not found' } });
  assert.equal((await reply()).status, 503, 'any other database answer is a plain failure');
  assert.deepEqual(state.hostaway, []);
  // A reply that fails the checks never reaches the database.
  reset();
  for (const body of ['', '   ', 'x'.repeat(5001)]) assert.equal((await reply(body)).status, 400);
  assert.equal((await post({ action: 'sendReply', requestId: REQUEST, threadId: THREAD, body: 'Hi', extra: 1 })).status, 400);
  noWrites();
});

test('a Hostaway error is a 502 with a friendly message, recorded as failed, and nothing else is stored', async () => {
  const cases = [
    [() => Response.json({ status: 'fail', message: 'Message too long for Airbnb' }, { status: 400 }), /^Hostaway refused the message \(HTTP 400: Message too long for Airbnb\)\. Nothing was sent; reply in Hostaway instead\.$/],
    [() => Response.json({ status: 'fail', message: 'Slow down' }, { status: 429 }), /^Hostaway is limiting requests\. Wait a minute and try again\.$/],
    [() => Response.json({ status: 'fail', message: 'Unauthorized' }, { status: 401 }), /^Hostaway did not accept the saved API key/],
    [() => Response.json({ status: 'fail', message: 'Boom' }, { status: 500 }), /^Hostaway refused the message \(HTTP 500: Boom\)/],
    [() => { throw new TypeError('fetch failed'); }, /^Hostaway could not be reached\. Nothing was sent; try again in a minute\.$/],
    [() => { throw new DOMException('timed out', 'TimeoutError'); }, /^Hostaway took too long to answer\. The message may have been sent/],
  ];
  for (const [answer, expected] of cases) {
    reset(); state.answer = answer;
    const response = await reply();
    const { error } = await response.json();
    assert.equal(response.status, 502, error);
    assert.match(error, expected);
    assert.ok(!error.includes('Bearer') && !error.includes('token'), 'no credentials in the message');
    assert.deepEqual(state.securityCalls, [{ name: 'workspace_guest_reply_result', args: { input: { requestId: REQUEST, ok: false, error } } }]);
    assert.deepEqual(state.rpcCalls.map(c => c.name), ['workspace_guest_inbox_action'], 'the thread is not re-read');
  }
});

test('if the outcome cannot be saved, the person is still told what happened', async () => {
  reset(); state.securityFails = true;
  const sent = await reply();
  assert.deepEqual([sent.status, (await sent.json())], [200, { ok: true, data: null, note: 'Sent to the guest. It will show here within a minute.' }]);
  assert.equal(state.hostaway.length, 1);
  reset(); state.securityFails = true; state.answer = () => Response.json({ status: 'fail', message: 'No' }, { status: 400 });
  const failed = await reply();
  assert.equal(failed.status, 502);
  assert.match((await failed.json()).error, /^Hostaway refused the message/);
});

test('only a Hostaway conversation number is posted to', async () => {
  reset(); state.rpc.workspace_guest_inbox_action = ({ input }) => ({ data: { send: true, conversationId: '../reservations/9', requestId: input.requestId }, error: null });
  const response = await reply();
  assert.equal(response.status, 502);
  assert.deepEqual(state.hostaway, [], 'nothing was posted');
  assert.equal(state.securityCalls[0].args.input.ok, false);
});
