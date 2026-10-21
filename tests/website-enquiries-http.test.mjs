import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { NextRequest } from 'next/server.js';

// The company website posts the public enquiry form from its own pages (ENQUIRY_ALLOWED_ORIGINS): the listed origins get
// the same start and submit, quotas and record as /enquiry, with CORS headers for that exact origin; anything else is refused.
const root = fileURLToPath(new URL('..', import.meta.url));
const APP = 'https://app.test', WEBSITE = 'https://rechargestays.co.uk', PREVIEW = 'https://recharge-website-flax.vercel.app';
const state = {}; globalThis.__websiteEnquiry = state;
const mocks = {
  'auth-security': `const s=globalThis.__websiteEnquiry;export const authSecurityConfiguration=()=>({url:'https://db.test',key:'sb_secret_x',origin:'${APP}'});
    export const enquiryAllowedOrigins=()=>s.allowed;
    export const requestQuota=async(request,scope,max,seconds,id)=>{s.quota.push({scope,max,seconds,id});return s.quotaAnswer;};
    export const securityHash=async()=>'h'.repeat(64);`,
  'business-server': `export const businessResponse=(body,status=200)=>Response.json(body,{status,headers:{Vary:'Cookie, Authorization'}});export const businessContext=async()=>null;
    export const databaseFailure=error=>Response.json({error:error.message},{status:400});export const viewAsFailure=()=>null;`,
  'native-request-policy': `export const isNativeRequest=()=>false;`,
  'bounded-form': `export const boundedFormData=async()=>null;`,
  'integration-server': `export const integrationSettings=()=>({});`,
  '@supabase/supabase-js': `const s=globalThis.__websiteEnquiry;export const createClient=()=>({rpc:async(name,args)=>{s.rpc.push({name,input:args.input});return {data:{ok:true},error:null};}});`,
  '@/lib/auth-security': `const s=globalThis.__websiteEnquiry;export const authSecurityConfiguration=()=>({origin:'${APP}'});
    export const enquiryAllowedOrigins=()=>s.allowed;export const requestQuota=async()=>s.proxyQuota;`,
  '@/lib/supabase-server': `export const supabaseConfiguration=()=>null;`,
};
const vite = await createServer({ configFile: false, appType: 'custom', root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false }, plugins: [{
  name: 'isolated-website-enquiry', enforce: 'pre',
  transform(code, id) {
    const path = id.replaceAll('\\', '/');
    if (path.endsWith('/proxy.ts')) { for (const name of ['@/lib/auth-security', '@/lib/supabase-server']) code = code.replaceAll(`from "${name}"`, `from "website-test:${name}"`); return { code, map: null }; }
    if (!/\/client-enquiry-server\.ts$/.test(path)) return;
    for (const name of Object.keys(mocks).filter(n => !n.startsWith('@/'))) code = code.replaceAll(`from '${name === '@supabase/supabase-js' ? name : './' + name}'`, `from 'website-test:${name}'`);
    return { code, map: null };
  },
  resolveId: id => id.startsWith('website-test:') ? '\0' + id : null,
  load: id => id.startsWith('\0website-test:') ? mocks[id.slice(14)] : null,
}] });
after(async () => { delete globalThis.__websiteEnquiry; await vite.close(); });
const route = await vite.ssrLoadModule('/app/api/enquiry/route.ts');
const { proxy } = await vite.ssrLoadModule('/proxy.ts');
const { originList, listedOrigin, isSameOrigin } = await vite.ssrLoadModule('/lib/auth-security-policy.ts');

const reset = () => Object.assign(state, { allowed: originList(`${WEBSITE}, https://www.rechargestays.co.uk,${PREVIEW}`), quota: [], rpc: [], quotaAnswer: { allowed: true, retryAfter: 0 }, proxyQuota: { allowed: true, retryAfter: 0 } });
const headersFor = origin => ({ 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.9', ...(origin ? { origin } : {}) });
const post = (body, origin) => new Request(APP + '/api/enquiry', { method: 'POST', headers: headersFor(origin), body: JSON.stringify(body) });
const preflight = origin => new Request(APP + '/api/enquiry', { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
const answers = {
  fullName: 'Alex Morgan', email: 'Alex@Example.com', phone: '07700 900123', propertyAddress: '12 Shore Road, Leith, Edinburgh EH6 6RG',
  propertyType: 'Flat', bedrooms: 2, wcs: 1, bathrooms: 1, mediaLink: 'https://photos.example.com/album', enquiryType: "I'd like a free performance estimate",
  startWhen: 'Within a month', heardFrom: 'Google', referral: '', notes: 'Available from November',
};
const cors = response => ({ origin: response.headers.get('access-control-allow-origin'), vary: response.headers.get('vary') });
const seen = [];
const watch = response => { seen.push(response); return response; };

test('the allow list keeps exact https origins only, never a wildcard', () => {
  assert.deepEqual(originList(' https://rechargestays.co.uk/,https://www.rechargestays.co.uk  https://RECHARGE-website-flax.vercel.app '), [WEBSITE, 'https://www.rechargestays.co.uk', PREVIEW]);
  assert.deepEqual(originList('*, null, http://rechargestays.co.uk, https://rechargestays.co.uk/form, https://user:pw@rechargestays.co.uk, https://x.test?a=1, not a url'), []);
  assert.deepEqual(originList(undefined), []);
  assert.deepEqual(originList('http://localhost:3000'), ['http://localhost:3000']);
  const from = (origin, url = APP + '/api/enquiry') => new Request(url, { headers: origin ? { origin } : {} });
  assert.equal(listedOrigin(from(WEBSITE), [WEBSITE], APP), WEBSITE);
  assert.equal(listedOrigin(from('https://evil.rechargestays.co.uk'), [WEBSITE], APP), null, 'subdomains are not included');
  assert.equal(listedOrigin(from(WEBSITE + '.evil.test'), [WEBSITE], APP), null);
  assert.equal(listedOrigin(from(null), [WEBSITE], APP), null);
  assert.equal(listedOrigin(from(WEBSITE, 'https://other-host.test/api/enquiry'), [WEBSITE], APP), null, 'only requests to the app itself');
  // isSameOrigin is unchanged: the website is never same-origin for any other route.
  assert.equal(isSameOrigin(from(WEBSITE), APP), false);
});

test('a listed website starts and submits the form exactly like /enquiry, with CORS for that origin', async () => {
  for (const origin of [WEBSITE, PREVIEW]) {
    reset();
    const started = watch(await route.POST(post({ action: 'start' }, origin)));
    assert.equal(started.status, 200);
    assert.deepEqual(cors(started), { origin, vary: 'Cookie, Authorization, Origin' });
    const { data: { token } } = await started.json();
    assert.match(token, /^[0-9a-f]{64}$/);
    const sent = watch(await route.POST(post({ token, answers }, origin)));
    assert.equal(sent.status, 200, await sent.clone().text());
    assert.equal(cors(sent).origin, origin);
    assert.deepEqual(await sent.json(), { ok: true });
    // The same quotas as the app's own form, and the same records: a started form, then the submitted answers.
    assert.deepEqual(state.quota.map(q => [q.scope, q.max, q.seconds, q.id]), [['enquiry-submit', 20, 3600, undefined], ['enquiry-start', 10, 3600, undefined], ['enquiry-submit', 20, 3600, undefined], ['enquiry-email', 5, 86400, 'email:alex@example.com']]);
    assert.deepEqual(state.rpc.map(c => [c.name, c.input.action]), [['workspace_enquiry_public', 'start'], ['workspace_enquiry_public', 'submit']]);
    assert.equal(state.rpc[1].input.answers.referral, undefined, 'blank answers are left out, as from /enquiry');
    assert.equal(state.rpc[1].input.answers.mediaLink, answers.mediaLink);
  }
});

test('the website can read the error text: validation, quota and refusal answers carry CORS too', async () => {
  reset();
  const invalid = watch(await route.POST(post({ token: 'a'.repeat(64), answers: { ...answers, email: 'nope' } }, WEBSITE)));
  assert.equal(invalid.status, 400);
  assert.equal(cors(invalid).origin, WEBSITE);
  assert.equal((await invalid.json()).field, 'email');
  state.quotaAnswer = { allowed: false, retryAfter: 120 };
  const limited = watch(await route.POST(post({ action: 'start' }, WEBSITE)));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '120');
  assert.equal(cors(limited).origin, WEBSITE);
  assert.equal(state.rpc.length, 0);
});

test('an unknown origin is refused with 403 and no CORS headers, before any quota or record', async () => {
  for (const origin of ['https://attacker.example', 'https://rechargestays.co.uk.attacker.example', 'null', null]) {
    reset();
    for (const body of [{ action: 'start' }, { token: 'a'.repeat(64), answers }]) {
      const refused = watch(await route.POST(post(body, origin)));
      assert.equal(refused.status, 403, String(origin));
      assert.equal(refused.headers.get('access-control-allow-origin'), null);
    }
    const pre = watch(await route.OPTIONS(preflight(origin ?? 'https://attacker.example')));
    assert.equal(pre.status, 403);
    assert.equal(pre.headers.get('access-control-allow-origin'), null);
    assert.equal(pre.headers.get('access-control-allow-methods'), null);
    assert.deepEqual([state.quota, state.rpc], [[], []]);
  }
  // With nothing configured, the website is refused like any other site.
  reset(); state.allowed = originList(undefined);
  assert.equal(watch(await route.POST(post({ action: 'start' }, WEBSITE))).status, 403);
});

test('a preflight from a listed website gets exactly the CORS answer the browser needs', async () => {
  reset();
  const pre = watch(await route.OPTIONS(preflight(WEBSITE)));
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), WEBSITE);
  assert.equal(pre.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
  assert.equal(pre.headers.get('access-control-allow-headers'), 'content-type');
  assert.equal(pre.headers.get('access-control-max-age'), '600');
  assert.equal(pre.headers.get('vary'), 'Origin');
  assert.equal(pre.headers.get('access-control-allow-credentials'), null, 'no cookies are ever shared');
});

test('same-origin requests from /enquiry behave as before, with no CORS headers', async () => {
  reset();
  const started = watch(await route.POST(post({ action: 'start' }, APP)));
  assert.equal(started.status, 200);
  assert.deepEqual(cors(started), { origin: null, vary: 'Cookie, Authorization' });
  const { data: { token } } = await started.json();
  const sent = watch(await route.POST(post({ token, answers }, APP)));
  assert.equal(sent.status, 200);
  assert.equal(sent.headers.get('access-control-allow-origin'), null);
  assert.deepEqual(state.rpc.map(c => c.input.action), ['start', 'submit']);
});

test('the proxy lets a listed website reach /api/enquiry only, and its own refusals carry CORS', async () => {
  reset();
  const req = (path, origin, method = 'POST') => new NextRequest(APP + path, { method, headers: headersFor(origin) });
  assert.notEqual(watch(await proxy(req('/api/enquiry', WEBSITE))).status, 403);
  assert.equal(watch(await proxy(req('/api/enquiry', 'https://attacker.example'))).status, 403);
  for (const path of ['/api/enquiry/upload', '/api/workspace/teams', '/api/session']) {
    const refused = watch(await proxy(req(path, WEBSITE)));
    assert.equal(refused.status, 403, path);
    assert.equal(refused.headers.get('access-control-allow-origin'), null);
  }
  assert.notEqual(watch(await proxy(req('/api/enquiry', WEBSITE, 'OPTIONS'))).status, 403);
  state.proxyQuota = { allowed: false, retryAfter: 30 };
  const limited = watch(await proxy(req('/api/enquiry', WEBSITE)));
  assert.equal(limited.status, 429);
  assert.equal(cors(limited).origin, WEBSITE);
  const other = watch(await proxy(req('/api/enquiry', APP)));
  assert.equal(other.status, 429);
  assert.equal(other.headers.get('access-control-allow-origin'), null);
});

test('no answer ever carries a wildcard origin', () => {
  assert.ok(seen.length > 20);
  for (const response of seen) assert.notEqual(response.headers.get('access-control-allow-origin'), '*');
});
