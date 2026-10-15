import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// The invoice maker, the app side (lib/invoice-maker.ts, lib/invoice-maker-server.ts, mobile/src/InvoiceMaker.tsx): the form's
// maths (quantity times rate, rounded like the database), adding, removing and reordering lines, the defaults (today, due in
// 7 days, pounds, the terms), the live preview as the branded document (REQUEST FOR INVOICE, "Amount to invoice"), the
// requests, the list and its search, how a document can be sent (never email to a cleaner), the email itself (from
// ownerrelations@, the document attached as HTML, recorded once), and where the screens are wired.
const root = fileURLToPath(new URL('..', import.meta.url));
const state = { env: {}, sent: [], security: [] };
globalThis.__makerMail = state;
const mocks = {
  'cloudflare:workers': `export const env=globalThis.__makerMail.env;`,
  'auth-security': `const s=globalThis.__makerMail;export const authSecurityConfiguration=()=>({url:'https://db.test',key:'sb_secret_x',origin:'https://app.test'});
    export const requestQuota=async()=>({allowed:true});export const securityRpc=async(name,args)=>{s.security.push({name,args});return {recorded:true};};`,
  'business-server': `export const businessResponse=(body,status=200)=>Response.json(body,{status});export const businessContext=async()=>null;
    export const databaseFailure=error=>Response.json({error:error.message},{status:400});export const viewAsFailure=()=>null;`,
  'native-request-policy': `export const isNativeRequest=()=>true;`,
};
const vite = await createServer({ configFile: false, root, server: { middlewareMode: true, hmr: false }, logLevel: 'error', plugins: [{
  name: 'isolated-maker-mail', enforce: 'pre',
  transform(code, id) {
    if (!/\/(invoice-maker-server|resend-email|workspace-rpc-route)\.ts$/.test(id.replaceAll('\\', '/'))) return;
    for (const name of Object.keys(mocks)) code = code.replaceAll(`from '${name === 'cloudflare:workers' ? name : './' + name}'`, `from 'maker-test:${name}'`);
    return { code, map: null };
  },
  resolveId: id => id === 'cloudflare:workers' ? '\0maker-test:cloudflare:workers' : id.startsWith('maker-test:') ? '\0' + id : null,
  load: id => id.startsWith('\0maker-test:') ? mocks[id.slice(12)] : null,
}] });
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  if (String(url) === 'https://api.resend.com/emails' && init.method === 'POST') { state.sent.push(JSON.parse(String(init.body))); return Response.json({ id: 'r_' + state.sent.length }); }
  throw new Error('Unexpected fetch ' + url);
};
after(async () => { globalThis.fetch = realFetch; delete globalThis.__makerMail; await vite.close(); });
const maker = await vite.ssrLoadModule('/lib/invoice-maker.ts');
const doc = await vite.ssrLoadModule('/lib/recharge-invoice.ts');
const server = await vite.ssrLoadModule('/lib/invoice-maker-server.ts');
const { noticeCopy } = await vite.ssrLoadModule('/lib/notice-copy.ts');
const read = path => readFileSync(path, 'utf8');
const id = n => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`;

test('the form starts today, due in 7 days, in pounds, with the default terms and one empty line; the kind swaps the terms until edited', () => {
  const f = maker.emptyForm('2026-10-15');
  assert.deepEqual([f.kind, f.issueOn, f.dueOn, f.currency, f.terms, f.lines.length, f.lines[0].quantity], ['invoice', '2026-10-15', '2026-10-22', 'GBP', doc.DEFAULT_TERMS.invoice, 1, '1']);
  const r = maker.withKind(f, 'request');
  assert.equal(r.terms, doc.DEFAULT_TERMS.request);
  assert.equal(maker.withKind({ ...f, terms: 'Our own words', termsEdited: true }, 'request').terms, 'Our own words');
  assert.equal(maker.withIssueOn(f, '2026-10-20').dueOn, '2026-10-27', 'the default due date follows the issue date');
  assert.equal(maker.withIssueOn({ ...f, dueOn: '2026-11-30' }, '2026-10-20').dueOn, '2026-11-30', 'a chosen due date stays');
});

test('line maths: quantity times rate to the penny, halves up, whole numbers only; subtotal and total', () => {
  assert.equal(maker.quantityHundredths('1.5'), 150);
  assert.equal(maker.quantityHundredths('0'), null);
  assert.equal(maker.quantityHundredths('1.234'), null);
  assert.equal(maker.rateMinor('£1,250.5'), 125050);
  assert.equal(maker.rateMinor('$80'), 8000);
  assert.equal(maker.rateMinor('abc'), null);
  assert.equal(maker.lineAmountMinor(150, 3333), 5000, '49.995 rounds to 50.00, as the database does');
  assert.equal(maker.lineAmountMinor(37, 1999), 740, '0.37 x 19.99 = 7.3963');
  const lines = [maker.newLine({ description: 'VA hours', quantity: '37.5', rate: '12' }), maker.newLine({ description: 'Bonus', quantity: '1', rate: '50' }), maker.newLine({ description: 'Half', quantity: 'x', rate: '1' })];
  const m = maker.formMaths(lines);
  assert.deepEqual(m.lines.map(l => l.amountMinor), [45000, 5000, null]);
  assert.deepEqual([m.subtotalMinor, m.totalMinor, m.complete], [50000, 50000, false]);
});

test('lines are added, removed and reordered', () => {
  const [a, b, c] = ['A', 'B', 'C'].map(description => maker.newLine({ description }));
  assert.deepEqual(maker.moveLine([a, b, c], c.key, -1).map(l => l.description), ['A', 'C', 'B']);
  assert.deepEqual(maker.moveLine([a, b, c], a.key, -1).map(l => l.description), ['A', 'B', 'C'], 'the first cannot go up');
  assert.deepEqual(maker.removeLine([a, b, c], b.key).map(l => l.description), ['A', 'C']);
  assert.equal(maker.addLine([a]).length, 2);
});

test('the form becomes a Save draft request: someone in the app or typed, empty lines dropped, the first problem named', () => {
  const f = { ...maker.emptyForm('2026-10-15'), recipientName: 'Maria Santos', recipientEmail: 'maria@va.example', recipientAddress: 'Unit 4, Makati, Manila', currency: 'USD',
    lines: [maker.newLine({ description: 'Virtual assistant, October', quantity: '80', rate: '6.25' }), maker.newLine()] };
  const built = maker.formToAction(f, id(1));
  assert.deepEqual(built.action, { action: 'saveDocumentDraft', requestId: id(1), kind: 'invoice', recipientName: 'Maria Santos', recipientEmail: 'maria@va.example', recipientAddress: 'Unit 4, Makati, Manila',
    currency: 'USD', issueOn: '2026-10-15', dueOn: '2026-10-22', note: '', terms: doc.DEFAULT_TERMS.invoice, lines: [{ description: 'Virtual assistant, October', quantity: '80', rateMinor: 625 }] });
  assert.ok(maker.documentsActionSchema.safeParse(built.action).success);
  const app = maker.formToAction({ ...f, recipientId: id(2) }, id(3), { id: id(4), version: 2 });
  assert.equal(app.action.recipientId, id(2));
  assert.equal(app.action.recipientEmail, undefined, 'an account has its own email');
  assert.deepEqual([app.action.id, app.action.version], [id(4), 2]);
  assert.equal(maker.formToAction({ ...f, recipientName: '' }, id(1)).error, 'Choose who it is for, or type their name.');
  assert.equal(maker.formToAction({ ...f, dueOn: '2026-10-01' }, id(1)).error, 'The due date cannot be before the issue date.');
  assert.equal(maker.formToAction({ ...f, lines: [maker.newLine({ description: 'x', rate: 'abc' })] }, id(1)).error, 'Check the rate on line 1, for example 45.00.');
  assert.equal(maker.formToAction({ ...f, periodStart: '2026-10-01' }, id(1)).error, 'Give the period a start and an end, in order, or leave both empty.');
});

test('the live preview is the branded document: REQUEST FOR INVOICE, Requested from, Amount to invoice, a draft', () => {
  const f = { ...maker.withKind(maker.emptyForm('2026-10-15'), 'request'), recipientName: 'Maria Santos', recipientEmail: 'maria@va.example', currency: 'USD',
    periodStart: '2026-10-01', periodEnd: '2026-10-31', lines: [maker.newLine({ description: 'Virtual assistant, October', quantity: '80', rate: '6.25' })] };
  const view = doc.rechargeInvoiceDoc(maker.formToInvoice(f));
  assert.deepEqual([view.word, view.number, view.chip, view.to.label, view.to.name, view.to.lines], ['REQUEST FOR INVOICE', 'DRAFT', { label: 'Draft, not issued', tone: 'wait' }, 'Requested from', 'Maria Santos', ['maria@va.example']]);
  assert.deepEqual([view.totalLabel, view.total, view.subtotal], ['Amount to invoice', '$500.00', '$500.00']);
  assert.deepEqual(view.rows, [{ key: '0', description: 'Virtual assistant, October', quantity: '80', rate: '$6.25', amount: '$500.00' }]);
  assert.deepEqual(view.facts.map(f => f.label), ['Request date', 'Due date', 'Period', 'Currency']);
  assert.equal(view.facts.at(-1).value, 'US dollars');
  assert.equal(view.terms, doc.DEFAULT_TERMS.request);
  const html = doc.rechargeInvoiceHtml(maker.formToInvoice(f));
  assert.match(html, /<div class="word">REQUEST FOR INVOICE<\/div><div class="number">DRAFT<\/div>/);
  assert.match(html, /<th class="num">Qty<\/th><th class="num">Rate<\/th><th class="num">Amount<\/th>/);
  assert.match(html, /<span>Amount to invoice<\/span><span class="num">\$500\.00<\/span>/);
});

const saved = (over = {}) => ({ source: 'maker', id: id(9), kind: 'invoice', status: 'issued', number: 'RC-INV-2026-0001',
  recipient: { userId: id(5), name: 'Olivia Owner', address: '3 Sample Row, Glasgow', email: null, role: 'client', hasEmail: true },
  currency: 'GBP', issueOn: '2026-10-15', dueOn: '2026-10-22', periodStart: null, periodEnd: null, note: 'Thank you for choosing Recharge.', terms: doc.DEFAULT_TERMS.invoice,
  totalMinor: 7500, paidOn: null, voidReason: null, version: 2, createdAt: '2026-10-15T09:00:00Z', updatedAt: '2026-10-15T09:00:00Z', issuedAt: '2026-10-15T09:05:00Z',
  lineCount: 2, lastSentAt: null, lines: [{ position: 1, description: 'Linen restock', quantity: 1.5, rateMinor: 3333, amountMinor: 5000 }, { position: 2, description: 'Key cutting', quantity: 2, rateMinor: 1250, amountMinor: 2500 }], ...over });

test('a saved document: back into the form to edit, and as the document with PAID once paid', () => {
  const d = maker.makerDocumentSchema.parse(saved({ status: 'draft', number: null }));
  const f = maker.formFromDocument(d);
  assert.deepEqual(f.lines.map(l => [l.description, l.quantity, l.rate]), [['Linen restock', '1.5', '33.33'], ['Key cutting', '2', '12.50']]);
  assert.equal(f.termsEdited, false);
  const paid = doc.rechargeInvoiceHtml(maker.fromMakerDocument(maker.makerDocumentSchema.parse(saved({ status: 'paid', paidOn: '2026-10-18' }))));
  assert.match(paid, /<div class="stamp" aria-hidden="true">PAID<small>Sun 18 Oct 2026<\/small><\/div>/);
  assert.match(paid, /<dt>Paid on<\/dt><dd>Sun 18 Oct 2026<\/dd>/);
  assert.match(paid, /<td>Linen restock<\/td><td class="num">1\.5<\/td><td class="num">£33\.33<\/td><td class="num">£50\.00<\/td>/);
  assert.match(paid, /<h2>Note<\/h2><p>Thank you for choosing Recharge\.<\/p>/);
  assert.match(paid, /<h2>Billed to<\/h2><p class="name">Olivia Owner<\/p><p>3 Sample Row<\/p><p>Glasgow<\/p>/);
  const voided = doc.rechargeInvoiceHtml(maker.fromMakerDocument(maker.makerDocumentSchema.parse(saved({ status: 'void', voidReason: 'Raised twice' }))));
  assert.match(voided, /VOID<small>Raised twice<\/small>/);
});

test('the list by status with search by recipient or number', () => {
  const docs = [saved(), saved({ id: id(10), number: 'RC-INV-2026-0002', recipient: { ...saved().recipient, name: 'Holyrood Lettings' } }), saved({ id: id(11), status: 'draft', number: null })];
  assert.deepEqual(maker.statusCounts(docs), { draft: 1, issued: 2, paid: 0, void: 0 });
  assert.deepEqual(maker.filterDocuments(docs, 'issued', 'holyrood').map(d => d.id), [id(10)]);
  assert.deepEqual(maker.filterDocuments(docs, 'issued', '0001').map(d => d.id), [id(9)]);
  assert.deepEqual(maker.STATUS_LABEL, { draft: 'Drafts', issued: 'Issued', paid: 'Paid', void: 'Void' });
});

test('how it can be sent: in the app to an account, email to anyone with an address but never a cleaner, download always; nothing for a draft', () => {
  assert.deepEqual(maker.sendChoices(saved()), ['in_app', 'email', 'download']);
  assert.deepEqual(maker.sendChoices(saved({ recipient: { ...saved().recipient, role: 'cleans' } })), ['in_app', 'download']);
  assert.deepEqual(maker.sendChoices(saved({ recipient: { userId: null, name: 'Maria', address: '', email: 'maria@va.example', role: null, hasEmail: true } })), ['email', 'download']);
  assert.deepEqual(maker.sendChoices(saved({ recipient: { userId: null, name: 'Maria', address: '', email: null, role: null, hasEmail: false } })), ['download']);
  assert.deepEqual(maker.sendChoices(saved({ status: 'draft' })), []);
  assert.match(noticeCopy('finance.document_sent').title, /A document from Recharge Group/);
});

test('the email goes from ownerrelations@ with the document attached as HTML, once, and is recorded; switched off, nothing is asked', async () => {
  const REQUEST = id(20);
  const input = { action: 'sendDocument', requestId: REQUEST, id: id(9), channel: 'email' };
  const calls = [];
  const context = { request: new Request('https://app.test'), account: { userId: id(30), role: 'accounts' }, client: { rpc: async (name, args) => { calls.push([name, args]); return { data: { send: true, requestId: REQUEST, email: { to: 'olivia@owner.example', name: 'Olivia Owner' }, document: saved() }, error: null }; } } };
  Object.assign(state.env, { RESEND_API_KEY: 're_test', EMAIL_REPLIES_ENABLED: 'true' }); state.sent = []; state.security = [];
  const res = await server.emailDocument(context, input);
  assert.equal(res.status, 200);
  assert.deepEqual(calls, [['workspace_documents_action', { input }]]);
  assert.equal(state.sent.length, 1);
  const [mail] = state.sent;
  assert.equal(mail.from, 'Recharge Group <ownerrelations@rechargegroup.co.uk>');
  assert.equal(mail.reply_to, 'ownerrelations@rechargegroup.co.uk');
  assert.doesNotMatch(JSON.stringify(mail), /guestrelations@/);
  assert.deepEqual(mail.to, ['olivia@owner.example']);
  assert.equal(mail.subject, 'Invoice RC-INV-2026-0001 from Recharge Group');
  assert.match(mail.text, /^Hello Olivia,\n\nPlease find attached invoice RC-INV-2026-0001 from Recharge Group for £75\.00, due Thu 22 Oct 2026\./);
  assert.equal(mail.attachments.length, 1);
  assert.deepEqual([mail.attachments[0].filename, mail.attachments[0].content_type], ['RC-INV-2026-0001.html', 'text/html']);
  const attached = Buffer.from(mail.attachments[0].content, 'base64').toString('utf8');
  assert.match(attached, /<div class="word">INVOICE<\/div><div class="number">RC-INV-2026-0001<\/div>/);
  assert.match(attached, /https:\/\/app\.test\/recharge-company-logo\.png/);
  assert.deepEqual(state.security, [{ name: 'workspace_document_send_result', args: { input: { requestId: REQUEST, sentBy: id(30), ok: true, messageId: `${REQUEST}@rechargegroup.co.uk` } } }]);
  // Already sent: the database says so and nothing goes out again.
  state.sent = []; state.security = [];
  const again = await server.emailDocument({ ...context, client: { rpc: async () => ({ data: { send: false, status: 'sent', document: saved() }, error: null }) } }, input);
  assert.equal(again.status, 200);
  assert.deepEqual([state.sent, state.security], [[], []]);
  // A cleaner is refused by the database, before anything is sent.
  const refused = await server.emailDocument({ ...context, client: { rpc: async () => ({ data: null, error: { code: '42501', message: 'Cleaners are never emailed. Send it in the app instead' } }) } }, input);
  assert.equal(refused.status, 400);
  assert.deepEqual(state.sent, []);
  // Switched off: the person is told to download it, and the database is not asked.
  delete state.env.EMAIL_REPLIES_ENABLED;
  let asked = false;
  const off = await server.emailDocument({ ...context, client: { rpc: async () => { asked = true; return { data: null, error: null }; } } }, input);
  assert.equal(off.status, 503);
  assert.match((await off.json()).error, /Download it and share it instead/);
  assert.equal(asked, false);
});

test('the route, the requests and where the screens are wired', () => {
  assert.ok(maker.documentsReadSchema.safeParse({ section: 'documents' }).success);
  assert.ok(!maker.documentsReadSchema.safeParse({ section: 'document' }).success, 'a document needs its id');
  assert.ok(!maker.documentsActionSchema.safeParse({ action: 'sendDocument', requestId: id(1), id: id(2), channel: 'fax' }).success);
  assert.ok(!maker.documentsActionSchema.safeParse({ action: 'saveDocumentDraft', requestId: id(1), kind: 'invoice', currency: 'EUR', issueOn: '2026-10-15', dueOn: '2026-10-22', note: '', terms: '', lines: [] }).success);
  assert.match(read('lib/invoice-maker-server.ts'), /sendMailboxEmail\('owner',/);
  assert.doesNotMatch(read('lib/invoice-maker-server.ts'), /sendMailboxEmail\('guest'/);
  for (const kind of ['mobile', 'workspace']) assert.match(read(`app/api/${kind}/documents/route.ts`), /workspaceDocuments\(request(, true)?\)/);
  assert.match(read('worker/backend-route-policy.ts'), /"\/api\/workspace\/documents", "\/api\/mobile\/documents"/);
  assert.match(read('mobile/src/backend/client.ts'), /\|privacy\|documents\)/);
  assert.match(read('mobile/src/LiveAccounts.tsx'), /\{view === "maker" && isFinanceRole\(role\) && <InvoiceMaker p=\{p\} \/>\}/);
  const screen = read('mobile/src/InvoiceMaker.tsx');
  assert.match(screen, /<RechargeInvoicePaper invoice=\{formToInvoice\(/, 'the live preview');
  for (const label of ['Save draft', 'Issue', 'Mark paid', 'Void it', 'Add a line', 'Up', 'Down', 'Remove', 'Someone in the app', 'Someone else']) assert.ok(screen.includes(`"${label}`) || screen.includes(`? "${label}"`) || screen.includes(`: "${label}"`), label);
  assert.match(read('supabase/migrations/20261022100000_recharge_invoices.sql'), /TODO\(lead, at merge\): RC-RFI numbers are shared with the cleaner requests in 20261022000000/);
});
