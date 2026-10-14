import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// Proceed makes the owner's app account (migration 20261020880000): after the client's Proceed the server makes the
// sign-in when there is none (no password is ever sent), links it, and emails a one-time "choose your password" link, or
// a "your new property is in your account" email, from ownerrelations@. A failure never fails the client's answer; the
// team sees it and sends it again.
const root = fileURLToPath(new URL('..', import.meta.url));
const state = {};
globalThis.__ownerAccount = state;
const mocks = {
  'auth-security': `export const authSecurityConfiguration=()=>({url:'https://db.test',key:'sb_secret_x',origin:'https://app.test'});
    export const requestQuota=async()=>({allowed:true});
    export const securityHash=async(scope,value)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(scope+':'+value)))].map(b=>b.toString(16).padStart(2,'0')).join('');`,
  'business-server': `export const businessResponse=(body,status=200)=>Response.json(body,{status});export const businessContext=async()=>globalThis.__ownerAccount.session;
    export const databaseFailure=error=>Response.json({error:error.message},{status:400});export const viewAsFailure=()=>null;`,
  'native-request-policy': `export const isNativeRequest=()=>true;`,
  'integration-server': `export const integrationSettings=()=>globalThis.__ownerAccount.settings;`,
  '@supabase/supabase-js': `const s=()=>globalThis.__ownerAccount;export const createClient=()=>({
    rpc:async(name,args)=>{s().serviceRpc.push({name,input:args.input});return name==='workspace_owner_account'?s().database(args.input):s().publicAnswer(args.input);},
    auth:{admin:{
      createUser:async options=>{s().created.push(options);return s().createUser(options);},
      generateLink:async options=>{s().links.push(options);return {data:{properties:{hashed_token:'hashedTokenValue1234'}},error:null};},
    }}});`,
};
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false }, plugins: [{
  name: 'isolated-owner-account', enforce: 'pre',
  transform(code, id) {
    if (!/\/(estimate-link-server|owner-account-server|account-invite-server|integration-providers)\.ts$/.test(id.replaceAll('\\', '/'))) return;
    for (const name of Object.keys(mocks)) code = code.replaceAll(`from '${name === '@supabase/supabase-js' ? name : './' + name}'`, `from 'owner-test:${name}'`);
    return { code, map: null };
  },
  resolveId: id => id.startsWith('owner-test:') ? '\0' + id : null,
  load: id => id.startsWith('\0owner-test:') ? mocks[id.slice(12)] : null,
}] });
const estimate = await vite.ssrLoadModule('/lib/estimate-link-server.ts');
const owner = await vite.ssrLoadModule('/lib/owner-account-server.ts');
const copy = await vite.ssrLoadModule('/lib/owner-account.ts');
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  state.resend.push({ url: String(url), headers: Object.fromEntries(new Headers(init.headers)), body: JSON.parse(String(init.body)) });
  return state.resendStatus === 200 ? Response.json({ id: 'resend_' + state.resend.length }) : new Response('{}', { status: state.resendStatus });
};
after(async () => { globalThis.fetch = realFetch; delete globalThis.__ownerAccount; await vite.close(); });

const PROPERTY = '33333333-3333-4333-8333-333333333333', USER = '11111111-1111-4111-8111-111111111111', NEW_USER = '55555555-5555-4555-8555-555555555555';
const TOKEN = 'a'.repeat(64);
// A small stand-in for the database's steps: who (prepare), link (claims the email once), markEmail.
function database({ existing = null, kind = null, failWith = null } = {}) {
  let userId = existing, status = 'pending', attempts = 0;
  return input => {
    state.steps.push(input);
    if (failWith) return { data: null, error: { message: failWith } };
    if (input.action === 'prepare') return { data: status === 'sent' && !input.propertyId ? { state: 'done' } : { state: 'ready', propertyId: PROPERTY, propertyName: 'Holmhead <flat>', email: 'morag@example.com', name: 'Morag Example', userId }, error: null };
    if (input.action === 'link') {
      userId = input.userId;
      if (status === 'sending') return { data: { send: false, emailStatus: status }, error: null };
      status = 'sending'; attempts += 1;
      return { data: { send: true, kind: kind ?? (input.created ? 'welcome' : 'added'), email: 'morag@example.com', name: 'Morag Example', propertyName: 'Holmhead <flat>', propertyId: PROPERTY, attempt: attempts }, error: null };
    }
    if (input.action === 'markEmail') { status = input.emailStatus; return { data: { emailStatus: status }, error: null }; }
    return { data: null, error: { message: 'unexpected' } };
  };
}
function reset(settings = { RESEND_API_KEY: 're_test' }, db = database()) {
  Object.assign(state, { settings, serviceRpc: [], created: [], links: [], resend: [], steps: [], resendStatus: 200, database: db,
    createUser: async () => ({ data: { user: { id: NEW_USER } }, error: null }),
    publicAnswer: input => ({ data: { state: input.decision === 'proceed' ? 'proceeding' : 'open', propertyName: 'Holmhead flat', name: 'Morag Example', estimate: {}, stage: 'agreement', followUpOn: null, feedback: '' }, error: null }),
    session: { account: { userId: USER, role: 'stays', status: 'active' }, client: { rpc: async (name, args) => { state.serviceRpc.push({ name, input: args.input, asTeam: true }); return state.database(args.input); } } } });
}
const post = (path, body) => new Request('https://app.test' + path, { method: 'POST', headers: { origin: 'https://app.test', 'content-type': 'application/json' }, body: JSON.stringify(body) });
const decide = decision => estimate.estimateDecideRoute(post('/api/estimate/decide', { token: 'b'.repeat(64), decision, feedback: '', ...(decision === 'review' ? { followUpOn: '2030-01-01' } : {}) }));

test('Proceed makes the account, links it and emails a one-time "choose your password" link, once', async () => {
  reset();
  const response = await decide('proceed');
  if (response.status !== 200) assert.fail(JSON.stringify(await response.json()));
  const body = await response.json();
  assert.equal(body.data.state, 'proceeding');
  assert.deepEqual(state.steps.map(s => s.action), ['prepare', 'link', 'markEmail']);
  assert.ok(state.steps.every(s => /^[0-9a-f]{64}$/.test(s.tokenHash) && !('propertyId' in s)), 'the server asks with the link’s token hash');
  assert.deepEqual(state.created, [{ email: 'morag@example.com', email_confirm: true, user_metadata: { full_name: 'Morag Example' } }], 'no password is set or sent');
  assert.deepEqual([state.steps[1].userId, state.steps[1].created], [NEW_USER, true]);
  assert.deepEqual(state.links, [{ type: 'recovery', email: 'morag@example.com' }]);
  assert.equal(state.resend.length, 1);
  const [mail] = state.resend;
  assert.equal(mail.body.from, 'Recharge Group <ownerrelations@rechargegroup.co.uk>');
  assert.equal(mail.body.reply_to, 'ownerrelations@rechargegroup.co.uk');
  assert.deepEqual(mail.body.to, ['morag@example.com']);
  assert.equal(mail.body.subject, 'Your Recharge account for Holmhead <flat>');
  assert.equal(mail.headers['idempotency-key'], `recharge-owner-account/${PROPERTY}/1`);
  assert.match(mail.body.text, /Choose your password: https:\/\/app\.test\/auth\/set-password\?token=hashedTokenValue1234/);
  assert.match(mail.body.text, /works once, for 1 hour/);
  assert.match(mail.body.text, /https:\/\/app\.test\/reset-password/);
  assert.match(mail.body.html, /Holmhead &lt;flat&gt;/);
  assert.doesNotMatch(mail.body.html, /<flat>/);
  assert.deepEqual(state.steps[2], { action: 'markEmail', tokenHash: state.steps[0].tokenHash, emailStatus: 'sent' });
});

test('only Proceed makes an account', async () => {
  reset();
  assert.equal((await decide('review')).status, 200);
  assert.equal(state.steps.length, 0);
  assert.equal(state.created.length, 0);
});

test('made a moment ago by another try: the account is found, not made twice', async () => {
  let prepared = 0;
  reset(undefined, input => {
    if (input.action === 'prepare') { prepared += 1; return { data: { state: 'ready', propertyId: PROPERTY, propertyName: 'Holmhead flat', email: 'morag@example.com', name: 'Morag Example', userId: prepared > 1 ? NEW_USER : null }, error: null }; }
    return database()(input);
  });
  state.createUser = async () => ({ data: { user: null }, error: { status: 422, message: 'A user with this email address has already been registered' } });
  assert.equal((await decide('proceed')).status, 200);
  assert.equal(prepared, 2);
  assert.equal(state.serviceRpc.find(r => r.input.action === 'link').input.created, false);
});

test('an email that fails, or email not set up, is recorded as failed; the client’s answer still counts', async () => {
  reset();
  state.resendStatus = 500;
  assert.equal((await decide('proceed')).status, 200);
  assert.equal(state.steps.at(-1).emailStatus, 'failed');

  reset({});
  assert.equal((await decide('proceed')).status, 200);
  assert.equal(state.resend.length, 0);
  assert.deepEqual(state.steps.map(s => s.action), ['prepare', 'link', 'markEmail'], 'the account is still made and linked');
  assert.equal(state.steps.at(-1).emailStatus, 'failed');

  reset(undefined, database({ failWith: 'database down' }));
  const r = await decide('proceed');
  assert.equal(r.status, 200);
  assert.equal((await r.json()).data.state, 'proceeding');
});

test('an existing owner gets the "added" email with a sign-in link, not a password link', async () => {
  reset(undefined, database({ existing: USER }));
  await decide('proceed');
  assert.equal(state.created.length, 0);
  assert.equal(state.links.length, 0);
  const [mail] = state.resend;
  assert.equal(mail.body.subject, 'Holmhead <flat> is now in your Recharge account');
  assert.match(mail.body.text, /Sign in to Recharge: https:\/\/app\.test\/sign-in/);
});

test('the team sends it again: their own access, one request at a time, and failures shown', async () => {
  reset(undefined, database({ existing: NEW_USER, kind: 'welcome' }));
  const requestId = crypto.randomUUID();
  const r = await owner.ownerAccountRoute(post('/api/workspace/owner-account', { action: 'resend', propertyId: PROPERTY, requestId }));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).data.state, 'sent');
  assert.ok(state.serviceRpc.every(c => c.asTeam), 'asked as the signed-in team member, so their access is checked');
  assert.deepEqual(state.steps.map(s => [s.action, s.propertyId, s.requestId]), [['prepare', PROPERTY, requestId], ['link', PROPERTY, requestId], ['markEmail', PROPERTY, requestId]]);
  assert.match(state.resend[0].body.text, /set-password\?token=/);

  reset(undefined, database({ existing: NEW_USER }));
  state.resendStatus = 500;
  assert.equal((await owner.ownerAccountRoute(post('/api/workspace/owner-account', { action: 'resend', propertyId: PROPERTY, requestId }))).status, 502);

  reset();
  state.session.account.role = 'cleans';
  assert.equal((await owner.ownerAccountRoute(post('/api/workspace/owner-account', { action: 'resend', propertyId: PROPERTY, requestId }))).status, 403);
  reset();
  assert.equal((await owner.ownerAccountRoute(post('/api/workspace/owner-account', { action: 'resend', propertyId: 'x', requestId }))).status, 400);
  reset({});
  assert.equal((await owner.ownerAccountRoute(post('/api/workspace/owner-account', { action: 'resend', propertyId: PROPERTY, requestId }))).status, 400);
  reset();
  state.session = null;
  assert.equal((await owner.ownerAccountRoute(post('/api/workspace/owner-account', { action: 'resend', propertyId: PROPERTY, requestId }))).status, 401);
});

test('what the team reads, in plain words', () => {
  const base = { kind: 'welcome', reason: '', email: 'morag@example.com', createdAccount: true, attempts: 1, sentAt: null, lastAttemptAt: null };
  assert.equal(copy.ownerAccountState(null, true), null);
  assert.equal(copy.ownerAccountState(null, false).action, 'Make the owner’s account');
  assert.deepEqual(Object.values(copy.ownerAccountState({ ...base, status: 'sent' }, true)), ['Email sent', 'good', 'morag@example.com was sent the email to choose their password.', 'Send it again']);
  assert.equal(copy.ownerAccountState({ ...base, status: 'failed' }, true).label, 'Email not sent');
  assert.equal(copy.ownerAccountState({ ...base, status: 'sending', lastAttemptAt: new Date().toISOString() }, true).action, null);
  assert.equal(copy.ownerAccountState({ ...base, status: 'sending', lastAttemptAt: new Date(Date.now() - 5 * 60_000).toISOString() }, true).action, 'Send it now');
  assert.match(copy.ownerAccountState({ ...base, status: 'skipped', reason: 'owner_accounts_off' }, false).note, /team beta/);
  for (const text of [...Object.values(copy.OWNER_ACCOUNT_SKIPPED), ...['welcome', 'added'].flatMap(kind => Object.values(copy.ownerAccountEmail({ kind, name: 'Morag', propertyName: 'Flat', email: 'm@example.com', link: 'https://app.test/x', reset: 'https://app.test/reset-password', minutes: 60 })))]) {
    assert.doesNotMatch(text, /—/, 'no em dashes');
  }
});

test('wiring: the Worker serves the routes, the app may call them, and the team card is on the property', async () => {
  const fs = await import('node:fs/promises');
  const policy = await fs.readFile('worker/backend-route-policy.ts', 'utf8');
  for (const path of ['/api/workspace/owner-account', '/api/mobile/owner-account', '/api/workspace/onboarding-settings', '/api/mobile/onboarding-settings']) assert.ok(policy.includes(`"${path}"`), path);
  assert.match(await fs.readFile('mobile/src/backend/client.ts', 'utf8'), /\|onboarding-settings\|owner-account\|/);
  assert.match(await fs.readFile('mobile/src/LivePages.tsx', 'utf8'), /<OwnerAccountCard key=/);
  assert.doesNotMatch(await fs.readFile('mobile/src/OwnerAccountCard.tsx', 'utf8'), /#[0-9a-fA-F]{3,8}\b|rgba?\(|—/);
  assert.match(await fs.readFile('lib/estimate-link-server.ts', 'utf8'), /import\('\.\/owner-account-server'\)\.then\(m => m\.ownerAccountAfterProceed\(hash\)\)\.catch\(\(\) => undefined\)/);
});
