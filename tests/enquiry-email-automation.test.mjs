import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// The enquiry form is emailed by the server, by its own switch: ready with RESEND_API_KEY alone (never needing the staff-notice switch),
// sent as ownerrelations@ with a reply-to, once per request, the link kept for a fallback only when the email is not ready or fails.
const root = fileURLToPath(new URL('..', import.meta.url));
const state = { settings: {}, rpc: [], quota: [], resend: [], saved: null, resendStatus: 200 };
globalThis.__enquiryEmail = state;
const mocks = {
  'auth-security': `const s=globalThis.__enquiryEmail;export const authSecurityConfiguration=()=>({url:'https://db.test',key:'sb_secret_x',origin:'https://app.test'});
    export const requestQuota=async(request,scope,max,seconds,id)=>{s.quota.push({scope,max,seconds,id});return {allowed:true};};
    export const securityHash=async(scope,value)=>'h'.repeat(10)+Buffer.from(value).toString('hex').slice(0,54);`,
  'business-server': `export const businessResponse=(body,status=200)=>Response.json(body,{status});export const businessContext=async()=>null;
    export const databaseFailure=error=>Response.json({error:error.message},{status:400});export const viewAsFailure=()=>null;`,
  'native-request-policy': `export const isNativeRequest=()=>true;`,
  'bounded-form': `export const boundedFormData=async()=>null;`,
  'integration-server': `export const integrationSettings=()=>globalThis.__enquiryEmail.settings;`,
  '@supabase/supabase-js': `export const createClient=()=>({});`,
};
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false }, plugins: [{
  name: 'isolated-enquiry-email', enforce: 'pre',
  transform(code, id) {
    if (!/\/(client-enquiry-server|integration-providers)\.ts$/.test(id.replaceAll('\\', '/'))) return;
    for (const name of Object.keys(mocks)) code = code.replaceAll(`from '${name === '@supabase/supabase-js' ? name : './' + name}'`, `from 'enquiry-test:${name}'`);
    return { code, map: null };
  },
  resolveId: id => id.startsWith('enquiry-test:') ? '\0' + id : null,
  load: id => id.startsWith('\0enquiry-test:') ? mocks[id.slice(14)] : null,
}] });
const policy = await vite.ssrLoadModule('/lib/integration-policy.ts');
const server = await vite.ssrLoadModule('/lib/client-enquiry-server.ts');
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  state.resend.push({ url: String(url), headers: Object.fromEntries(new Headers(init.headers)), body: JSON.parse(String(init.body)) });
  return state.resendStatus === 200 ? Response.json({ id: 'resend_' + state.resend.length }) : new Response('{}', { status: state.resendStatus });
};
after(async () => { globalThis.fetch = realFetch; delete globalThis.__enquiryEmail; await vite.close(); });

const USER = '11111111-1111-4111-8111-111111111111', REQUEST = '22222222-2222-4222-8222-222222222222';
const invite = (extra = {}) => ({ action: 'inviteEnquiry', requestId: REQUEST, name: 'Alex Morgan', email: 'alex@example.com', subject: 'Your property form', body: 'Hello Alex\n\n{link}\n\nThanks', delivery: 'email', ...extra });
function context(emailStatus = 'pending') {
  return { request: new Request('https://app.test/api/workspace/teams', { method: 'POST' }), account: { userId: USER, role: 'admin' }, client: { rpc: async (name, args) => {
    state.rpc.push({ name, args });
    if (args.input.action === 'markEnquiryEmail') return { data: { id: 'e1', recipientEmail: 'alex@example.com', emailStatus: args.input.emailStatus }, error: null };
    return { data: { id: 'e1', recipientEmail: 'alex@example.com', emailStatus }, error: null };
  } } };
}
const reset = settings => Object.assign(state, { settings, rpc: [], quota: [], resend: [], resendStatus: 200 });
const KEY = { RESEND_API_KEY: 're_test' };

test('the switch is its own: ready with the key alone, off without it or when switched off, and apart from staff notice emails both ways', () => {
  const ready = s => policy.enquiryEmailReady(s), notices = s => policy.integrationConfiguration(s).email;
  assert.equal(ready(KEY), true, 'the key alone is enough');
  assert.equal(notices(KEY), false, 'and it does not turn staff notice emails on');
  assert.equal(ready({}), false);
  assert.equal(ready({ ...KEY, ENQUIRY_EMAIL_ENABLED: 'false' }), false, 'an off switch');
  assert.equal(ready({ ...KEY, ENQUIRY_EMAIL_ENABLED: 'true' }), true);
  // Staff notice emails on does not make enquiry emails ready without a key, and neither depends on the other being set.
  const noticesOn = { ...KEY, NOTIFICATION_EMAIL_ENABLED: 'true', NOTIFICATION_FROM_EMAIL: 'notices@rechargegroup.co.uk' };
  assert.equal(notices(noticesOn), true);
  assert.equal(ready(noticesOn), true);
  assert.equal(ready({ NOTIFICATION_EMAIL_ENABLED: 'true', NOTIFICATION_FROM_EMAIL: 'notices@rechargegroup.co.uk' }), false);
  assert.equal(ready({ ...noticesOn, ENQUIRY_EMAIL_ENABLED: 'false' }), false);
  assert.equal(notices({ ...noticesOn, ENQUIRY_EMAIL_ENABLED: 'false' }), true, 'switching the form off leaves staff notices alone');
});

test('the sender is always ownerrelations@, with no override, and replies go to ownerrelations@', () => {
  assert.equal(policy.enquirySender(KEY), 'Recharge Group <ownerrelations@rechargegroup.co.uk>');
  assert.equal(policy.enquirySender({ ...KEY, ENQUIRY_FROM_EMAIL: 'Recharge <guestrelations@rechargegroup.co.uk>' }), 'Recharge Group <ownerrelations@rechargegroup.co.uk>', 'a setting cannot move it to the guest mailbox');
  assert.equal(policy.ENQUIRY_REPLY_TO, 'ownerrelations@rechargegroup.co.uk');
});

test('with only the key set, the form is emailed as ownerrelations@ with a reply-to and the link, once, and marked sent', async () => {
  reset(KEY);
  const response = await server.sendEnquiryForm(context(), invite());
  assert.equal(response.status, 200);
  const { data } = await response.json();
  assert.equal(data.enquiry.emailStatus, 'sent');
  assert.match(data.link, /^https:\/\/app\.test\/enquiry\?t=/);
  assert.equal(state.resend.length, 1);
  const [call] = state.resend;
  assert.equal(call.url, 'https://api.resend.com/emails');
  assert.equal(call.headers.authorization, 'Bearer re_test');
  assert.equal(call.headers['idempotency-key'], `recharge-enquiry/${USER}/${REQUEST}`);
  assert.deepEqual([call.body.from, call.body.reply_to, call.body.to, call.body.subject], ['Recharge Group <ownerrelations@rechargegroup.co.uk>', 'ownerrelations@rechargegroup.co.uk', ['alex@example.com'], 'Your property form']);
  assert.ok(call.body.text.includes(data.link) && call.body.html.includes('Open the property form'));
  assert.deepEqual(state.quota, [{ scope: 'enquiry-send', max: 40, seconds: 3600, id: USER }], 'the 40 an hour limit is kept');
  assert.deepEqual(state.rpc.map(c => c.args.input.action), ['inviteEnquiry', 'markEnquiryEmail']);
  assert.equal(state.rpc[0].args.input.tokenHash.length, 64);
});

test('a retry of the same request sends nothing again', async () => {
  reset(KEY);
  const retry = await server.sendEnquiryForm(context('sent'), invite());
  assert.equal(retry.status, 200);
  assert.deepEqual([state.resend.length, state.rpc.map(c => c.args.input.action)], [0, ['inviteEnquiry']]);
  // Same request, same link.
  const a = (await (await server.sendEnquiryForm(context('sent'), invite())).json()).data.link, b = (await (await server.sendEnquiryForm(context('sent'), invite())).json()).data.link;
  assert.equal(a, b);
});

test('sending a new link emails it too', async () => {
  reset(KEY);
  const response = await server.sendEnquiryForm(context(), { action: 'resendEnquiry', requestId: REQUEST, enquiryId: '33333333-3333-4333-8333-333333333333', version: 1, subject: 'New link', body: 'Hi\n\n{link}', delivery: 'email' });
  assert.equal(response.status, 200);
  assert.equal(state.resend.length, 1);
  assert.equal(state.resend[0].body.subject, 'New link');
  assert.equal((await response.json()).data.enquiry.emailStatus, 'sent');
});

test('not ready is refused before anything is made or sent; a failed send is marked failed and still returns the link for the fallback', async () => {
  // Staff notice emails on, but no key: not ready.
  reset({ NOTIFICATION_EMAIL_ENABLED: 'true', NOTIFICATION_FROM_EMAIL: 'notices@rechargegroup.co.uk' });
  const refused = await server.sendEnquiryForm(context(), invite());
  assert.equal(refused.status, 400);
  assert.match((await refused.json()).error, /Email isn’t set up yet/);
  assert.deepEqual([state.rpc, state.resend, state.quota], [[], [], []]);
  // The link-only way still works without email.
  const link = await server.sendEnquiryForm(context('none'), invite({ delivery: 'link' }));
  assert.equal(link.status, 200);
  assert.deepEqual([state.resend.length, state.rpc.map(c => c.args.input.action)], [0, ['inviteEnquiry']]);
  // Resend refuses: the enquiry is marked failed and the link comes back.
  reset(KEY); state.resendStatus = 403;
  const failed = await server.sendEnquiryForm(context(), invite());
  const { data } = await failed.json();
  assert.equal(failed.status, 200);
  assert.equal(data.enquiry.emailStatus, 'failed');
  assert.match(data.link, /\/enquiry\?t=/);
  assert.equal(state.rpc.at(-1).args.input.emailStatus, 'failed');
});

test('the sheet: one Send button when email is ready, no copy button after a send, the link only as a fallback, Try again on a failure', async () => {
  const sheet = (await fs.readFile('mobile/src/LiveEnquiries.tsx', 'utf8')).replace(/\r\n/g, '\n');
  assert.doesNotMatch(sheet, /label="Copy the link instead"/);
  assert.match(sheet, /emailReady \? <Button label=\{busy \? "Sending…" : resend \? "Send the new link" : "Send the form"\}[^\n]*send\("email"\)/);
  // The link, its Copy and the mail app button sit only in the not-emailed branch.
  const result = sheet.slice(sheet.indexOf('{!result.emailed && <>'), sheet.indexOf('</>}', sheet.indexOf('{!result.emailed && <>')));
  assert.match(result, /Copy the link/);
  assert.match(result, /Open my email app/);
  assert.equal((sheet.match(/label=\{copied \? "Copied" : "Copy the link"\}/g) ?? []).length, 1, 'only one place offers the Copy button');
  assert.match(sheet, /result\.failed \? "Recharge couldn't send it\./);
  assert.match(sheet, /e\.emailStatus === "failed" \? "Try again" : "Send a new link"/);
  assert.match(sheet, /e\.emailStatus === "failed" \? "Email failed" : "Sending…"/);
  // Theme tokens only in what was added.
  assert.doesNotMatch(sheet.slice(sheet.indexOf('function SendSheet'), sheet.indexOf('const Line =')), /#[0-9a-fA-F]{3,8}\b|rgba?\(/);
});
