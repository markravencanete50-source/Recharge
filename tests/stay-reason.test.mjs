import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// Why guests stay (migration 20261021800000): the question's exact words, reading a reply, the survey email, and the
// two jobs with Hostaway, Resend and the database replaced by fakes (no real message or email is sent). The database
// side is tested in stay-reason-database.test.mjs.
const root = fileURLToPath(new URL('..', import.meta.url));
const state = { env: {}, rpc: [], due: {}, claims: {}, hostaway: [], conversations: [], sent: [], failHostaway: false };
globalThis.__stayReason = state;
const mocks = {
  'cloudflare:workers': `export const env=globalThis.__stayReason.env;`,
  'auth-security': `const s=globalThis.__stayReason;export const authSecurityConfiguration=()=>({url:'https://db.test',key:'sb_secret_x',origin:'https://app.test',salt:'s'.repeat(32)});
    export const requestQuota=async()=>({allowed:true});export const securityHash=async(scope,value)=>(scope==='stay-survey'?'a':'b').repeat(32)+value.replace(/-/g,'').slice(0,32);
    export const securityRpc=async(name,args)=>{s.rpc.push({name,args});if(name.endsWith('_due'))return s.due[name];if(name.endsWith('_claim'))return {send:s.claims[args.input.reservationId]!==false};return {recorded:true};};`,
  'business-server': `export const businessResponse=(body,status=200)=>Response.json(body,{status});export const businessContext=async()=>null;export const databaseFailure=e=>Response.json({error:e.message},{status:400});export const viewAsFailure=()=>null;`,
  hostaway: `const s=globalThis.__stayReason;export const hostawayReplyErrorMessage=()=>'Hostaway would not take it';
    export const sendHostawayConversationMessage=async(id,body)=>{if(s.failHostaway)throw new Error('x');s.hostaway.push({id,body});return 'hm-'+s.hostaway.length;};
    export const fetchHostawayConversations=async()=>s.conversations;`,
  'guest-reply-server': `export const hostawayRepliesEnabled=()=>globalThis.__stayReason.env.HOSTAWAY_REPLIES_ENABLED==='true';`,
  '@supabase/supabase-js': `export const createClient=()=>({rpc:async()=>({data:null,error:null})});`,
};
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false }, plugins: [{
  name: 'isolated-stay-reason', enforce: 'pre',
  transform(code, id) {
    if (!/\/(stay-reason-server|resend-email)\.ts$/.test(id.replaceAll('\\', '/'))) return;
    for (const name of Object.keys(mocks)) code = code.replaceAll(`from '${name === '@supabase/supabase-js' || name === 'cloudflare:workers' ? name : './' + name}'`, `from 'stay-test:${name}'`);
    return { code, map: null };
  },
  resolveId: id => id.startsWith('stay-test:') ? '\0' + id : null,
  load: id => id.startsWith('\0stay-test:') ? mocks[id.slice(11)] : null,
}] });
const R = await vite.ssrLoadModule('/lib/stay-reason.ts');
const server = await vite.ssrLoadModule('/lib/stay-reason-server.ts');
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  if (String(url) === 'https://api.resend.com/emails' && init.method === 'POST') { state.sent.push(JSON.parse(String(init.body))); return Response.json({ id: 'r_' + state.sent.length }); }
  throw new Error('Unexpected fetch ' + url);
};
after(async () => { globalThis.fetch = realFetch; delete globalThis.__stayReason; await vite.close(); });
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const reset = env => { for (const k of Object.keys(state.env)) delete state.env[k]; Object.assign(state.env, env); Object.assign(state, { rpc: [], due: {}, claims: {}, hostaway: [], conversations: [], sent: [], failHostaway: false }); };
const A = '11111111-1111-4111-8111-111111111111', B = '22222222-2222-4222-8222-222222222222', C = '33333333-3333-4333-8333-333333333333';

test('the question, word for word', () => {
  assert.equal(R.arrivalLabel('2025-10-18'), 'Sat 18 Oct');
  assert.equal(R.stayReasonQuestion({ firstName: 'Morag', propertyName: 'Holmhead Flat', checkIn: '2025-10-18' }),
    "Hi Morag, we're looking forward to welcoming you to Holmhead Flat on Sat 18 Oct! A quick question to help us prepare: what brings you here? Just reply with a number:\n"
    + '1 Holiday\n2 Work\n3 Visiting family or friends\n4 An event\n5 Something else\nThank you! The Recharge team');
  assert.match(R.stayReasonQuestion({ firstName: null, propertyName: 'Holmhead Flat', checkIn: '2026-01-01' }), /^Hi there, we're looking forward to welcoming you to Holmhead Flat on Thu 1 Jan!/);
  assert.match(R.stayReasonQuestion({ firstName: 'Mary Ann Smith', propertyName: 'X', checkIn: '2026-01-01' }), /^Hi Mary,/);
  assert.match(R.stayReasonQuestion({ firstName: '<script>', propertyName: 'X', checkIn: '2026-01-01' }), /^Hi there,/, 'only a name is used');
  assert.ok(R.stayReasonQuestion({ firstName: 'Morag', propertyName: 'x'.repeat(5000), checkIn: '2026-01-01' }).length < R.QUESTION_LIMIT, 'within the channel limit');
  assert.doesNotMatch(R.stayReasonQuestion({ firstName: 'Morag', propertyName: 'X', checkIn: '2026-01-01' }), /—/);
});

test('reading a reply: a number 1 to 5 or its words, at the start; anything else is left alone', () => {
  const yes = { '1': 'holiday', '1.': 'holiday', '1 holiday': 'holiday', '1) Holiday': 'holiday', '1 - holiday': 'holiday', 'Holiday': 'holiday', 'HOLIDAY!': 'holiday', 'holiday, thanks': 'holiday',
    '2': 'work', 'work': 'work', 'Work.': 'work', '2 work': 'work', 'business trip': 'work', '3': 'family_friends', '3 Visiting family or friends': 'family_friends', 'visiting friends': 'family_friends',
    'family': 'family_friends', '4': 'event', '4 an event': 'event', 'An event': 'event', 'a wedding': 'event', '5': 'other', '5 Something else': 'other', 'something else': 'other', '  2  ': 'work', '1 thank you': 'holiday' };
  for (const [text, reason] of Object.entries(yes)) assert.equal(R.parseStayReason(text), reason, JSON.stringify(text));
  for (const text of ['', '0', '6', '12', '1st', '1 work', '2 holiday', 'Hi! 1', 'thanks', 'Can we check in early?', 'We are here for a wedding and some sightseeing', 'I have 2 kids', null, undefined, '1'.padEnd(70, ' x')])
    assert.equal(R.parseStayReason(text), null, JSON.stringify(text));
});

test('the thread line and the survey answer', () => {
  assert.deepEqual(R.threadStayReasonLines(null), []);
  assert.deepEqual(R.threadStayReasonLines({ askedAt: '2026-10-15T09:00:00Z', reason: null, from: null }), ['Asked reason for stay on 15 Oct', 'No answer yet']);
  assert.deepEqual(R.threadStayReasonLines({ askedAt: '2026-10-15T09:00:00Z', reason: 'family_friends', from: 'message' }), ['Asked reason for stay on 15 Oct', 'Reason for stay: Visiting family or friends']);
  assert.equal(R.threadStayReasonLines({ askedAt: '2026-10-15T09:00:00Z', reason: 'work', from: 'survey' })[1], 'Reason for stay: Work (from the survey)');
  assert.deepEqual(R.surveyTap({ rating: '4' }), { rating: 4 });
  assert.deepEqual(R.surveyTap({ reason: 'event' }), { reason: 'event' });
  assert.deepEqual(R.surveyTap({ rating: '9', reason: 'shopping' }), {});
  const token = 'f'.repeat(64);
  assert.equal(R.surveyAnswerSchema.safeParse({ token, rating: 5 }).success, true);
  assert.equal(R.surveyAnswerSchema.safeParse({ token }).success, false, 'an answer is needed');
  assert.equal(R.surveyAnswerSchema.safeParse({ token, rating: 6 }).success, false);
  assert.equal(R.surveyAnswerSchema.safeParse({ token: 'abc', rating: 3 }).success, false);
  assert.equal(R.surveyAnswerSchema.safeParse({ token, comment: 'x'.repeat(2001) }).success, false);
  assert.equal(R.stayDates('2026-10-18', '2026-10-21'), '18 October 2026 to 21 October 2026');
});

test('the question job: switched off at the Worker, nothing; else one Hostaway message per claimed stay, through the existing send', async () => {
  reset({});
  assert.equal(await server.runStayReasonQuestions(), null);
  assert.deepEqual(state.rpc, [], 'the database is not even asked');
  reset({ HOSTAWAY_REPLIES_ENABLED: 'true' });
  state.due.workspace_stay_reason_questions_due = { switchedOff: false, stays: [
    { reservationId: A, hostawayReservationId: '9101', conversationId: '5101', firstName: 'Morag', propertyName: 'Holmhead Flat', checkIn: '2025-10-18' },
    { reservationId: B, hostawayReservationId: '9102', conversationId: null, firstName: null, propertyName: 'Holmhead Flat', checkIn: '2025-10-18' },
    { reservationId: C, hostawayReservationId: '9103', conversationId: null, firstName: null, propertyName: 'Holmhead Flat', checkIn: '2025-10-18' },
  ] };
  // B's conversation is among Hostaway's newest; C's is not (tried again next run).
  state.conversations = [{ id: 7002, reservationId: 9102, recipientName: 'Ailsa Brown' }];
  assert.deepEqual(await server.runStayReasonQuestions(), { sent: 2, failed: 0 });
  assert.deepEqual(state.hostaway.map(h => h.id), ['5101', '7002']);
  assert.match(state.hostaway[1].body, /^Hi Ailsa, /, 'the name from the conversation when the booking had none');
  assert.deepEqual(state.rpc.filter(r => r.name.endsWith('_result')).map(r => r.args.input), [{ reservationId: A, ok: true, messageId: 'hm-1' }, { reservationId: B, ok: true, messageId: 'hm-2' }]);
  assert.ok(!state.rpc.some(r => r.args.input?.reservationId === C), 'C is not claimed');
  // A stay another worker already took is not sent; a Hostaway failure is recorded.
  reset({ HOSTAWAY_REPLIES_ENABLED: 'true' });
  state.due.workspace_stay_reason_questions_due = { switchedOff: false, stays: [{ reservationId: A, hostawayReservationId: '9101', conversationId: '5101', firstName: 'Morag', propertyName: 'H', checkIn: '2025-10-18' }] };
  state.claims[A] = false;
  assert.deepEqual(await server.runStayReasonQuestions(), { sent: 0, failed: 0 });
  state.claims[A] = true; state.failHostaway = true;
  assert.deepEqual(await server.runStayReasonQuestions(), { sent: 0, failed: 1 });
  assert.deepEqual(state.rpc.at(-1).args.input, { reservationId: A, ok: false, error: 'Hostaway would not take it' });
  // Switched off in the database: nothing is sent.
  reset({ HOSTAWAY_REPLIES_ENABLED: 'true' });
  state.due.workspace_stay_reason_questions_due = { switchedOff: true, stays: [] };
  assert.deepEqual(await server.runStayReasonQuestions(), { sent: 0, failed: 0 });
  assert.deepEqual(state.hostaway, []);
});

test('the survey job: from guestrelations@ only, with the stay\'s own link, the logo and one-tap answers', async () => {
  reset({ RESEND_API_KEY: 're_test' });
  assert.equal(await server.runStaySurveys(), null, 'off unless guest email is switched on');
  reset({ RESEND_API_KEY: 're_test', EMAIL_REPLIES_ENABLED: 'true' });
  state.due.workspace_stay_surveys_due = { switchedOff: false, stays: [{ reservationId: A, email: 'fiona@example.org', firstName: 'Fiona', propertyName: 'Holmhead Flat', checkIn: '2026-10-10', checkOut: '2026-10-14' }] };
  assert.deepEqual(await server.runStaySurveys(), { sent: 1, failed: 0 });
  const [mail] = state.sent;
  assert.deepEqual([mail.from, mail.reply_to, mail.to, mail.subject], ['Recharge Group <guestrelations@rechargegroup.co.uk>', 'guestrelations@rechargegroup.co.uk', ['fiona@example.org'], 'How was your stay at Holmhead Flat?']);
  assert.doesNotMatch(JSON.stringify(mail), /ownerrelations@/);
  const token = 'a'.repeat(32) + A.replace(/-/g, '');
  assert.match(mail.text, /^Hi Fiona,\n\nThank you for staying with us\.\n\nHow was your stay\?/);
  for (const n of [1, 2, 3, 4, 5]) assert.ok(mail.html.includes(`https://app.test/stay-survey?t=${token}&amp;rating=${n}`), `rating ${n}`);
  for (const reason of R.STAY_REASONS) assert.ok(mail.text.includes(`https://app.test/stay-survey?t=${token}&reason=${reason}`), reason);
  assert.match(mail.html, /recharge-email-logo\.png/);
  assert.match(mail.html, /leave a comment on the page/);
  const claim = state.rpc.find(r => r.name === 'workspace_stay_survey_claim').args.input;
  assert.equal(claim.reservationId, A);
  assert.match(claim.tokenHash, /^[0-9a-f]{64}$/);
  assert.notEqual(claim.tokenHash, token, 'only the hash is kept');
  assert.deepEqual(state.rpc.at(-1), { name: 'workspace_stay_survey_result', args: { input: { reservationId: A, ok: true } } });
});

test('wiring: the Worker runs both jobs every 15 minutes, the page and its answer are on the backend, the switches are on the report', () => {
  const worker = read('worker/index.ts');
  const quarter = worker.indexOf('if (tick.getUTCMinutes() % 15 !== 0) return;');
  for (const job of ['runStayReasonQuestions()', 'runStaySurveys()']) {
    const at = worker.indexOf(`import('../lib/stay-reason-server').then(module => module.${job})`);
    assert.ok(at > quarter && at < worker.indexOf("if (env.INTEGRATION_SCHEDULE_ENABLED !== 'true') return;"), job);
  }
  assert.doesNotMatch(worker, /guestrelations@|ownerrelations@/);
  const routes = read('worker/backend-route-policy.ts');
  assert.match(routes, /"\/stay-survey", "\/api\/stay-survey"/);
  assert.match(read('app/api/stay-survey/route.ts'), /staySurveyAnswerRoute/);
  const sender = read('lib/stay-reason-server.ts');
  assert.match(sender, /sendMailboxEmail\('guest',/);
  assert.doesNotMatch(sender, /sendMailboxEmail\('owner'/);
  assert.match(sender, /sendHostawayConversationMessage\(conversationId, body\)/, 'the Guest inbox\'s own Hostaway send');
  const page = read('app/stay-survey/page.tsx');
  assert.match(page, /page\.propertyName, \$\{stayDates\(page\.checkIn, page\.checkOut\)\}|\$\{page\.propertyName\}, \$\{stayDates\(page\.checkIn, page\.checkOut\)\}/);
  const screen = read('mobile/src/StayReports.tsx');
  assert.match(screen, /<StaySwitchesCard p=\{p\} \/>/);
  assert.match(screen, /action: "setStayReasonSwitch"/);
  assert.match(read('lib/workspace-finance-server.ts'), /input\.section === 'stayReasonSettings' \? client\.rpc\('workspace_stay_reason_settings'\)/);
  assert.match(read('lib/workspace-finance-server.ts'), /input\.action === 'setStayReasonSwitch' \? 'workspace_stay_reason_switch'/);
  assert.match(read('mobile/src/LiveGuestInbox.tsx'), /threadStayReasonLines\(t\.stayReason\)/);
  assert.deepEqual(Object.values(R.STAY_SWITCHES), ['Ask guests the reason for their stay', 'Send a survey after direct stays']);
  for (const file of ['lib/stay-reason.ts', 'lib/stay-reason-server.ts', 'app/stay-survey/page.tsx', 'app/stay-survey/survey-view.tsx', 'app/api/stay-survey/route.ts', 'supabase/migrations/20261021800000_stay_reason.sql']) {
    const text = read(file);
    assert.doesNotMatch(text.replace(/\r\n/g, ''), /\n/, file + ' keeps CRLF line endings');
  }
});
