import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// The estimate emailed with a private link (Lee, 14 October): after a publish the server emails it from ownerrelations@
// (replies to ownerrelations@) once per publish; the team can email it again or copy a link; the client's answer goes to
// the database with the service key. "Estimate sent" only once the email went; "Estimate ready" otherwise.
const root = fileURLToPath(new URL('..', import.meta.url));
const state = { settings: {}, rpc: [], publicRpc: [], resend: [], resendStatus: 200, session: null, publicAnswer: null };
globalThis.__estimateEmail = state;
const mocks = {
  'auth-security': `const s=globalThis.__estimateEmail;export const authSecurityConfiguration=()=>({url:'https://db.test',key:'sb_secret_x',origin:'https://app.test'});
    export const requestQuota=async()=>({allowed:true});
    export const securityHash=async(scope,value)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(scope+':'+value)))].map(b=>b.toString(16).padStart(2,'0')).join('');`,
  'business-server': `export const businessResponse=(body,status=200)=>Response.json(body,{status});export const businessContext=async()=>globalThis.__estimateEmail.session;
    export const databaseFailure=error=>Response.json({error:error.message},{status:400});export const viewAsFailure=()=>null;`,
  'native-request-policy': `export const isNativeRequest=()=>true;`,
  'integration-server': `export const integrationSettings=()=>globalThis.__estimateEmail.settings;`,
  '@supabase/supabase-js': `export const createClient=()=>({rpc:async(name,args)=>{const s=globalThis.__estimateEmail;s.publicRpc.push({name,args});return s.publicAnswer(args.input);}});`,
};
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false }, plugins: [{
  name: 'isolated-estimate-email', enforce: 'pre',
  transform(code, id) {
    if (!/\/(estimate-link-server|integration-providers|journey-server)\.ts$/.test(id.replaceAll('\\', '/'))) return;
    for (const name of Object.keys(mocks)) code = code.replaceAll(`from '${name === '@supabase/supabase-js' ? name : './' + name}'`, `from 'estimate-test:${name}'`);
    return { code, map: null };
  },
  resolveId: id => id.startsWith('estimate-test:') ? '\0' + id : null,
  load: id => id.startsWith('\0estimate-test:') ? mocks[id.slice(15)] : null,
}] });
const server = await vite.ssrLoadModule('/lib/estimate-link-server.ts');
const journeys = await vite.ssrLoadModule('/lib/journey-server.ts');
const policy = await vite.ssrLoadModule('/lib/estimate-link.ts');
const enquiry = await vite.ssrLoadModule('/lib/client-enquiry.ts');
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  state.resend.push({ url: String(url), headers: Object.fromEntries(new Headers(init.headers)), body: JSON.parse(String(init.body)) });
  return state.resendStatus === 200 ? Response.json({ id: 'resend_' + state.resend.length }) : new Response('{}', { status: state.resendStatus });
};
after(async () => { globalThis.fetch = realFetch; delete globalThis.__estimateEmail; await vite.close(); });

const USER = '11111111-1111-4111-8111-111111111111', PROPERTY = '33333333-3333-4333-8333-333333333333', WORK = '44444444-4444-4444-8444-444444444444';
const ESTIMATE = { lowRateMinor: 9000, mediumRateMinor: 11000, highRateMinor: 14000, comments: 'Busy in August.', comparables: [{ name: 'Flat nearby', url: 'https://www.airbnb.co.uk/rooms/1', adrMinor: 10500 }, { name: 'Bad', url: 'javascript:alert(1)', adrMinor: 1 }] };
const delivery = status => ({ status, emailFailed: status === 'failed', sentAt: status === 'sent' ? '2026-10-14T10:00:00Z' : null, openedAt: null, decidedAt: null, to: 'morag@example.com' });
const journey = (extra = {}) => ({ propertyId: PROPERTY, workId: WORK, clientId: null, stage: 'estimate', version: 3, estimate: ESTIMATE, estimateDelivery: delivery('ready'), ...extra });
function session() {
  return { account: { userId: USER, role: 'admin', status: 'active' }, client: { rpc: async (name, args) => {
    state.rpc.push({ name, input: args.input });
    if (name === 'workspace_journey_action') return { data: journey(), error: null };
    const issued = state.rpc.filter(r => r.input?.action === 'issue');
    if (args.input.action === 'issue') return { data: { id: 'l1', send: args.input.delivery === 'email' && issued.filter(r => r.input.requestId === args.input.requestId).length === 1, delivery: args.input.delivery, emailStatus: args.input.delivery === 'email' ? 'pending' : 'manual', to: args.input.delivery === 'email' ? 'morag@example.com' : null, name: 'Morag Example', propertyName: 'Holmhead flat', estimate: ESTIMATE, estimateDelivery: delivery('sending') }, error: null };
    if (args.input.action === 'markEmail') return { data: { estimateDelivery: delivery(args.input.emailStatus === 'sent' ? 'sent' : 'ready') }, error: null };
    return { data: null, error: { message: 'unexpected' } };
  } } };
}
const reset = settings => Object.assign(state, { settings, rpc: [], publicRpc: [], resend: [], resendStatus: 200, session: session() });
const post = (path, body) => new Request('https://app.test' + path, { method: 'POST', headers: { origin: 'https://app.test', 'content-type': 'application/json' }, body: JSON.stringify(body) });
const KEY = { RESEND_API_KEY: 're_test' };
const publish = requestId => post('/api/workspace/journeys', { action: 'publishEstimate', requestId, propertyId: PROPERTY, version: 2, lowRateMinor: 9000, mediumRateMinor: 11000, highRateMinor: 14000, comparables: [], comments: '' });

test('publishing emails the estimate once per publish, from ownerrelations@ with replies to ownerrelations@, and says "sent"', async () => {
  reset(KEY);
  const requestId = crypto.randomUUID();
  const body = await (await journeys.journeyRoute(publish(requestId))).json();
  assert.equal(body.ok, true);
  assert.equal(body.data.estimateDelivery.status, 'sent');
  assert.equal(state.resend.length, 1);
  const [mail] = state.resend;
  assert.equal(mail.body.from, 'Recharge Group <ownerrelations@rechargegroup.co.uk>');
  assert.equal(mail.body.reply_to, 'ownerrelations@rechargegroup.co.uk');
  assert.deepEqual(mail.body.to, ['morag@example.com']);
  assert.equal(mail.body.subject, 'Your free performance estimate for Holmhead flat');
  const auto = await policy.autoRequestId(requestId);
  assert.match(auto, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(auto, await policy.autoRequestId(requestId), 'the same publish, the same email');
  assert.equal(mail.headers['idempotency-key'], `recharge-estimate/${USER}/${auto}`);
  const link = mail.body.text.match(/https:\/\/app\.test\/estimate\?t=([0-9a-f]{64})/);
  assert.ok(link, 'the email holds the private link');
  const issue = state.rpc.find(r => r.input.action === 'issue');
  assert.equal(issue.input.tokenHash, await enquiry.tokenHash(link[1]), 'only the hash goes to the database');
  assert.ok(!JSON.stringify(state.rpc).includes(link[1]), 'never the token itself');
  assert.match(mail.body.html, /View your estimate/);
  assert.ok(mail.body.html.indexOf('recharge-email-logo.png') > mail.body.html.lastIndexOf('</p>'), 'the Recharge logo is a signature at the bottom');
  assert.match(mail.body.html, /<strong>Recharge Group<\/strong><br><a href="mailto:ownerrelations@rechargegroup\.co\.uk"/);
  assert.doesNotMatch(mail.body.text, /recharge-email-logo/);
  assert.match(mail.body.text, /Expected: £110\.00/);
  assert.match(mail.body.text, /Flat nearby, £105\.00 a night: https:\/\/www\.airbnb\.co\.uk\/rooms\/1/);
  assert.doesNotMatch(mail.body.text + mail.body.html, /javascript:|—/, 'only https comparables; no em dashes');
  // A retried publish (the database replays its receipt) never sends a second email.
  await journeys.journeyRoute(publish(requestId));
  assert.equal(state.resend.length, 1);
});

test('email not set up, no address, or another journey action: publishing works and nothing is emailed ("Estimate ready")', async () => {
  reset({});
  let body = await (await journeys.journeyRoute(publish(crypto.randomUUID()))).json();
  assert.equal(body.data.estimateDelivery.status, 'ready');
  assert.equal(state.resend.length, 0);
  assert.equal(state.rpc.filter(r => r.name === 'workspace_estimate_link_action').length, 0);
  reset({ ...KEY, ENQUIRY_EMAIL_ENABLED: 'false' });
  body = await (await journeys.journeyRoute(publish(crypto.randomUUID()))).json();
  assert.equal(state.resend.length, 0);
  reset(KEY);
  state.session.client.rpc = async (name, args) => { state.rpc.push({ name, input: args.input }); return { data: journey({ estimateDelivery: { ...delivery('ready'), to: null } }), error: null }; };
  body = await (await journeys.journeyRoute(publish(crypto.randomUUID()))).json();
  assert.equal(body.data.estimateDelivery.status, 'ready');
  assert.equal(state.resend.length, 0, 'a phone-only enquiry is not emailed');
});

test('a failed email leaves it "ready" and the publish still succeeds; Resend tries again', async () => {
  reset(KEY); state.resendStatus = 500;
  const body = await (await journeys.journeyRoute(publish(crypto.randomUUID()))).json();
  assert.equal(body.ok, true);
  assert.equal(body.data.estimateDelivery.status, 'ready');
  assert.equal(state.rpc.find(r => r.input.action === 'markEmail').input.emailStatus, 'failed');
  state.resendStatus = 200;
  const again = await server.estimateLinkRoute(post('/api/workspace/estimate-link', { action: 'email', requestId: crypto.randomUUID(), propertyId: PROPERTY }));
  assert.equal(again.status, 200);
  assert.equal((await again.json()).data.estimateDelivery.status, 'sent');
});

test('Copy link: a link to send by hand, no email, also when email is not set up; Resend needs email set up', async () => {
  reset({});
  const r = await server.estimateLinkRoute(post('/api/workspace/estimate-link', { action: 'link', requestId: crypto.randomUUID(), propertyId: PROPERTY }));
  const body = await r.json();
  assert.equal(r.status, 200);
  assert.match(body.data.link, /^https:\/\/app\.test\/estimate\?t=[0-9a-f]{64}$/);
  assert.equal(state.rpc[0].input.delivery, 'link');
  assert.equal(state.resend.length, 0);
  const off = await server.estimateLinkRoute(post('/api/workspace/estimate-link', { action: 'email', requestId: crypto.randomUUID(), propertyId: PROPERTY }));
  assert.equal(off.status, 400);
  assert.match((await off.json()).error, /Email isn’t set up yet/);
  assert.equal((await server.estimateLinkRoute(post('/api/workspace/estimate-link', { action: 'email', requestId: 'x', propertyId: PROPERTY }))).status, 400);
  state.session = null;
  assert.equal((await server.estimateLinkRoute(post('/api/workspace/estimate-link', { action: 'link', requestId: crypto.randomUUID(), propertyId: PROPERTY }))).status, 401);
});

test('the client page: a bad link never reaches the database; the answer goes with the token hash and comes back', async () => {
  reset(KEY);
  assert.deepEqual(await server.openEstimatePage(undefined), { state: 'invalid' });
  assert.deepEqual(await server.openEstimatePage('nope'), { state: 'invalid' });
  assert.equal(state.publicRpc.length, 0);
  const token = 'a'.repeat(64);
  state.publicAnswer = () => ({ data: null, error: { code: 'P0002', message: 'This link is not valid' } });
  assert.deepEqual(await server.openEstimatePage(token), { state: 'invalid' });
  state.publicAnswer = () => ({ data: null, error: { code: 'XX000', message: 'boom' } });
  assert.deepEqual(await server.openEstimatePage(token), { state: 'unavailable' });
  state.publicAnswer = input => ({ data: { state: input.decision === 'proceed' ? 'proceeding' : 'open', followUpOn: input.followUpOn ?? null }, error: null });
  const decide = body => server.estimateDecideRoute(post('/api/estimate', { token, ...body }));
  let r = await decide({ decision: 'review' });
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { error: 'Choose a follow-up date', field: 'followUpOn' });
  r = await decide({ decision: 'review', followUpOn: '2026-11-01', feedback: '  Thinking.  ' });
  assert.equal(r.status, 200);
  const sent = state.publicRpc.at(-1).args.input;
  assert.deepEqual(sent, { action: 'decide', tokenHash: await enquiry.tokenHash(token), decision: 'review', feedback: 'Thinking.', followUpOn: '2026-11-01' });
  r = await decide({ decision: 'proceed', followUpOn: '2026-11-01' });
  assert.equal(state.publicRpc.at(-1).args.input.followUpOn, null, 'a date only goes with "Thank you, I’ll be in touch"');
  assert.equal((await r.json()).data.state, 'proceeding');
  assert.equal((await decide({ decision: 'maybe' })).status, 400);
  assert.equal((await decide({ decision: 'proceed', extra: 1 })).status, 400);
  state.publicAnswer = () => ({ data: null, error: { code: '22023', message: 'This estimate can no longer be answered here. Reply to the email from Recharge.' } });
  r = await decide({ decision: 'decline' });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /can no longer be answered/);
  const foreign = new Request('https://app.test/api/estimate', { method: 'POST', headers: { origin: 'https://evil.test', 'content-type': 'application/json' }, body: JSON.stringify({ token, decision: 'proceed' }) });
  assert.equal((await server.estimateDecideRoute(foreign)).status, 403);
});

test('the team’s wording: "Estimate sent" only once emailed; enquiries say "Estimate ready" until then', () => {
  assert.equal(policy.ESTIMATE_DELIVERY_LABEL.sent, 'Estimate sent');
  assert.equal(policy.ESTIMATE_DELIVERY_LABEL.ready, 'Estimate ready');
  assert.match(policy.estimateDeliveryNote({ ...delivery('ready'), emailFailed: true }), /did not go/);
  assert.match(policy.estimateDeliveryNote({ ...delivery('ready'), to: null }), /no email address/);
  const e = { status: 'valuing', stage: 'estimate', expiresAt: '2030-01-01T00:00:00Z' };
  assert.equal(enquiry.enquiryStep({ ...e, estimateDelivery: delivery('ready') }), 'estimate_ready');
  assert.equal(enquiry.enquiryStep({ ...e, estimateDelivery: delivery('sending') }), 'estimate_ready');
  assert.equal(enquiry.enquiryStep({ ...e, estimateDelivery: delivery('sent') }), 'estimate');
  assert.equal(enquiry.enquiryStep(e), 'estimate', 'an older enquiry without the field keeps its label');
  assert.equal(enquiry.STEP_LABEL.estimate_ready, 'Estimate ready');
  assert.equal(enquiry.STEP_LABEL.estimate, 'Estimate sent');
});

test('the client\'s three answers read Proceed, No, thank you, and Thank you, I\'ll be in touch (Alex), in that order', async () => {
  assert.deepEqual(Object.entries(policy.DECISION_LABEL), [['proceed', 'Proceed'], ['decline', 'No, thank you'], ['review', 'Thank you, I’ll be in touch']]);
  const view = await fs.readFile('app/estimate/estimate-view.tsx', 'utf8');
  assert.match(view, /Object\.keys\(DECISION_LABEL\)/, 'the page shows the labels from lib/estimate-link.ts');
  assert.doesNotMatch(view + await fs.readFile('lib/estimate-link.ts', 'utf8'), /Review later|'Decline'/);
  // A choice the page does not offer is refused in plain words.
  assert.equal(policy.estimateDecisionSchema.safeParse({ token: 'a'.repeat(64), decision: 'maybe' }).error.issues[0].message, 'Choose how you would like to go ahead');
});

test('the page says what the platform fee and the management fee are, beside those lines', async () => {
  const view = (await fs.readFile('app/estimate/estimate-view.tsx', 'utf8')).replace(/\r/g, '');
  const lines = view.indexOf('<dl className="estimate-lines">'), note = view.indexOf('Airbnb and Booking.com keep a share of each booking');
  assert.ok(lines > 0 && note > lines && note - view.indexOf('</dl>}', lines) < 200, 'just under the fee lines');
  assert.match(view, /Guests who book with us directly pay no platform fee\. The management fee is what Recharge charges for running your let, as a share of the booking income\./);
  assert.match(view, /\{fees && <p className="enquiry-help">Airbnb/, 'only when the estimate has fees');
});

test('wiring: routes allowed, the app calls the mobile route, the team card and the page use theme tokens and no em dashes', async () => {
  const policyFile = await fs.readFile('worker/backend-route-policy.ts', 'utf8');
  for (const path of ['/estimate', '/api/estimate', '/api/workspace/estimate-link', '/api/mobile/estimate-link']) assert.ok(policyFile.includes(`"${path}"`), path);
  assert.match(await fs.readFile('mobile/src/backend/client.ts', 'utf8'), /\|estimate-link\|/);
  const card = await fs.readFile('mobile/src/EstimateDelivery.tsx', 'utf8');
  assert.doesNotMatch(card, /#[0-9a-fA-F]{3,8}\b|rgba?\(|—/);
  assert.match(await fs.readFile('mobile/src/LivePages.tsx', 'utf8'), /<EstimateDeliveryCard key=\{j\.version\}/);
  const page = await fs.readFile('app/estimate/estimate-view.tsx', 'utf8') + await fs.readFile('app/estimate/page.tsx', 'utf8');
  assert.doesNotMatch(page, /#[0-9a-fA-F]{3,8}\b|rgba?\(|—/);
  const css = await fs.readFile('app/globals.css', 'utf8');
  const estimateCss = css.split('\n').filter(l => l.startsWith('.estimate-')).join('\n');
  assert.ok(estimateCss.length > 0);
  assert.doesNotMatch(estimateCss, /#[0-9a-fA-F]{3,8}\b|rgba?\(/, 'theme tokens only, so dark mode follows');
});
