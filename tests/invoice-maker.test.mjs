import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// The invoice maker, the app side (lib/invoice-maker.ts, lib/invoice-maker-server.ts, mobile/src/InvoiceMaker.tsx): the form's
// maths (quantity times rate, rounded like the database), adding, removing and reordering lines, the defaults (today, due in
// 7 days, pounds, the terms), the live preview as the branded document (REQUEST FOR INVOICE, "Amount to invoice"), the
// requests, the list and its search, how a document can be sent (never email to a cleaner), the email itself (a guest from
// guestrelations@, everyone else from ownerrelations@, never mixed; the document attached as HTML, recorded once; its own
// switch, not EMAIL_REPLIES_ENABLED), a Receivable invoice by email, the payment details editor, and where the screens are wired.
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
  assert.equal(view.terms, 'Please send us your invoice for the amount above, quoting reference (given when issued). We pay valid invoices within 7 days.', 'a draft has no number yet');
  assert.equal(doc.rechargeInvoiceDoc({ ...maker.formToInvoice(f), status: 'issued', number: 'RC-RFI-2026-0042' }).terms, 'Please send us your invoice for the amount above, quoting reference RC-RFI-2026-0042. We pay valid invoices within 7 days.');
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

test('the email goes from ownerrelations@ to an owner with the document attached as HTML, once, and is recorded; switched off, nothing is asked', async () => {
  const REQUEST = id(20);
  const input = { action: 'sendDocument', requestId: REQUEST, id: id(9), channel: 'email' };
  const calls = [];
  const context = { request: new Request('https://app.test'), account: { userId: id(30), role: 'accounts' }, client: { rpc: async (name, args) => { calls.push([name, args]); return { data: { send: true, requestId: REQUEST, mailbox: 'owner', email: { to: 'olivia@owner.example', name: 'Olivia Owner' }, document: saved() }, error: null }; } } };
  // Only the Resend key: invoice emails do not need EMAIL_REPLIES_ENABLED (which switches replies to guests and owners).
  for (const k of Object.keys(state.env)) delete state.env[k];
  Object.assign(state.env, { RESEND_API_KEY: 're_test' }); state.sent = []; state.security = [];
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
  // Switched off (DOCUMENT_EMAIL_ENABLED=false): the person is told to download it, and the database is not asked.
  state.env.DOCUMENT_EMAIL_ENABLED = 'false';
  let asked = false;
  const off = await server.emailDocument({ ...context, client: { rpc: async () => { asked = true; return { data: null, error: null }; } } }, input);
  assert.equal(off.status, 503);
  assert.match((await off.json()).error, /Download it and share it instead/);
  assert.equal(asked, false);
  delete state.env.DOCUMENT_EMAIL_ENABLED;
});

const GUEST_FROM = 'Recharge Group <guestrelations@rechargegroup.co.uk>', OWNER_FROM = 'Recharge Group <ownerrelations@rechargegroup.co.uk>';
const guestDoc = (over = {}) => saved({ recipient: { userId: null, name: 'Sam Guest', address: '', email: null, role: null, hasEmail: true, kind: 'guest', reservationId: id(40),
  stay: { reference: 'HM-123', propertyName: '110 Hawk Street', checkIn: '2026-10-01', checkOut: '2026-10-05' } }, ...over });
const receivable = (over = {}) => ({ itemId: id(41), version: 1, title: 'Late checkout', reference: 'INV-77', details: '', status: 'sent', propertyId: id(42), propertyName: '110 Hawk Street',
  address: '110 Hawk Street, Edinburgh', amountMinor: 4000, settledMinor: 0, outstandingMinor: 4000, createdAt: '2026-10-10T09:00:00Z', updatedAt: '2026-10-10T09:00:00Z', dueOn: '2026-10-17',
  overdue: false, ageDays: 0, sentOn: '2026-10-10', link: null, reservationId: id(40), stayReference: 'HM-123', checkIn: '2026-10-01', checkOut: '2026-10-05', clientId: null, clientName: null, ...over });

test('a guest is emailed from guestrelations@ and an owner from ownerrelations@; the two never mix', async () => {
  for (const k of Object.keys(state.env)) delete state.env[k];
  Object.assign(state.env, { RESEND_API_KEY: 're_test' });
  assert.equal(maker.documentMailbox('guest'), 'guest');
  for (const kind of ['person', undefined, null]) assert.equal(maker.documentMailbox(kind), 'owner');
  const ctx = data => ({ request: new Request('https://app.test'), account: { userId: id(30), role: 'accounts' }, client: { rpc: async () => ({ data, error: null }) } });
  const input = n => ({ action: 'sendDocument', requestId: id(n), id: id(9), channel: 'email' });
  // A maker document for a guest goes from the guest mailbox, and never names the owners' one.
  state.sent = []; state.security = [];
  assert.equal((await server.emailDocument(ctx({ send: true, requestId: id(21), mailbox: 'guest', email: { to: 'sam@guest.example', name: 'Sam Guest' }, document: guestDoc() }), input(21))).status, 200);
  assert.equal(state.sent.length, 1);
  assert.deepEqual([state.sent[0].from, state.sent[0].reply_to, state.sent[0].to], [GUEST_FROM, 'guestrelations@rechargegroup.co.uk', ['sam@guest.example']]);
  assert.doesNotMatch(JSON.stringify(state.sent[0]), /ownerrelations@/);
  assert.match(Buffer.from(state.sent[0].attachments[0].content, 'base64').toString('utf8'), /<dt>Stay<\/dt><dd>HM-123, 110 Hawk Street<\/dd>/);
  // An owner never gets the guest mailbox, and a guest never the owners' one: when the database's mailbox and who it is
  // for disagree, nothing is sent and the failure is recorded.
  for (const [document, mailbox, to] of [[saved(), 'guest', 'olivia@owner.example'], [guestDoc(), 'owner', 'sam@guest.example']]) {
    state.sent = []; state.security = [];
    const res = await server.emailDocument(ctx({ send: true, requestId: id(22), mailbox, email: { to, name: 'X' }, document }), input(22));
    assert.equal(res.status, 502);
    assert.deepEqual(state.sent, [], `${document.recipient.name} is never sent from the ${mailbox} mailbox`);
    assert.equal(state.security[0].args.input.ok, false);
  }
  // A Receivable invoice for a guest stay: from guestrelations@, with the stay on it.
  const started = (over = {}) => ({ send: true, status: 'pending', requestId: id(23), mailbox: 'guest', recipientKind: 'guest', email: { to: 'sam@guest.example', name: 'Sam Guest' },
    receivable: receivable(), paymentDetails: '', ...over });
  const rInput = { action: 'emailReceivable', requestId: id(23), itemId: id(41) };
  state.sent = []; state.security = [];
  assert.equal((await server.emailReceivable(ctx(started()), rInput)).status, 200);
  assert.deepEqual([state.sent[0].from, state.sent[0].to, state.sent[0].subject], [GUEST_FROM, ['sam@guest.example'], 'Invoice INV-77 from Recharge Group']);
  assert.match(state.sent[0].text, /^Hello Sam,\n\nPlease find attached invoice INV-77 from Recharge Group for £40\.00, due Sat 17 Oct 2026\./);
  assert.deepEqual(state.security, [{ name: 'workspace_document_send_result', args: { input: { requestId: id(23), sentBy: id(30), ok: true, messageId: `${id(23)}@rechargegroup.co.uk` } } }]);
  // To the owner (client) of a Receivable invoice: from ownerrelations@, with How to pay when it is filled in.
  state.sent = []; state.security = [];
  assert.equal((await server.emailReceivable(ctx(started({ mailbox: 'owner', recipientKind: 'person', email: { to: 'olivia@owner.example', name: 'Olivia Owner' },
    receivable: receivable({ reservationId: null, stayReference: null, clientId: id(5), clientName: 'Olivia Owner' }), paymentDetails: 'TEST ONLY pay by transfer' })), rInput)).status, 200);
  assert.deepEqual([state.sent[0].from, state.sent[0].to], [OWNER_FROM, ['olivia@owner.example']]);
  assert.doesNotMatch(JSON.stringify(state.sent[0]), /guestrelations@/);
  assert.match(Buffer.from(state.sent[0].attachments[0].content, 'base64').toString('utf8'), /<h2>How to pay<\/h2><p>TEST ONLY pay by transfer<\/p>/);
  // Mixed up: nothing goes out.
  for (const over of [{ mailbox: 'owner', recipientKind: 'guest' }, { mailbox: 'guest', recipientKind: 'person' }]) {
    state.sent = [];
    assert.equal((await server.emailReceivable(ctx(started(over)), rInput)).status, 502);
    assert.deepEqual(state.sent, []);
  }
  // The switch for documents is its own: replies switched off does not stop it; DOCUMENT_EMAIL_ENABLED=false does.
  state.env.EMAIL_REPLIES_ENABLED = 'false'; state.sent = [];
  assert.equal((await server.emailReceivable(ctx(started()), rInput)).status, 200);
  state.env.DOCUMENT_EMAIL_ENABLED = 'false';
  assert.equal((await server.emailReceivable(ctx(started()), rInput)).status, 503);
  delete state.env.DOCUMENT_EMAIL_ENABLED; delete state.env.EMAIL_REPLIES_ENABLED;
});

test('a Receivable invoice emailed is marked sent the way Mark sent does (moveHubItem, its version); one already sent, or a failed email, is left alone', async () => {
  for (const k of Object.keys(state.env)) delete state.env[k];
  Object.assign(state.env, { RESEND_API_KEY: 're_test' });
  const run = async (status, { fail = false, moveError = null } = {}) => {
    const calls = [];
    const data = { send: true, status: 'pending', requestId: id(24), mailbox: 'guest', recipientKind: 'guest', email: { to: 'sam@guest.example', name: 'Sam Guest' },
      receivable: receivable({ status, version: 4, sentOn: status === 'sent' ? '2026-10-10' : null }), paymentDetails: '' };
    const client = { rpc: async (name, args) => { calls.push([name, args.input]); return name === 'workspace_documents_action' ? { data, error: null } : { data: moveError ? null : {}, error: moveError }; } };
    const before = globalThis.fetch;
    if (fail) globalThis.fetch = async () => Response.json({ message: 'nope' }, { status: 422 });
    try { const res = await server.emailReceivable({ request: new Request('https://app.test'), account: { userId: id(30), role: 'accounts' }, client }, { action: 'emailReceivable', requestId: id(24), itemId: id(41) }); return { res, body: await res.json(), calls }; }
    finally { globalThis.fetch = before; }
  };
  const toSend = await run('to_send');
  assert.equal(toSend.res.status, 200);
  assert.deepEqual(toSend.calls.map(c => c[0]), ['workspace_documents_action', 'workspace_teams_action']);
  const move = toSend.calls[1][1];
  assert.deepEqual([move.action, move.id, move.version, move.status], ['moveHubItem', id(41), 4, 'sent']);
  assert.match(move.requestId, /^[0-9a-f-]{36}$/);
  assert.equal(toSend.body.data.marked, true);
  const already = await run('sent');
  assert.deepEqual(already.calls.map(c => c[0]), ['workspace_documents_action'], 'already sent: nothing changes');
  const failed = await run('to_send', { fail: true });
  assert.equal(failed.res.status, 502);
  assert.deepEqual(failed.calls.map(c => c[0]), ['workspace_documents_action'], 'not emailed: not marked');
  const stale = await run('to_send', { moveError: { code: '40001', message: 'changed' } });
  assert.equal(stale.res.status, 200);
  assert.equal(stale.body.note, 'Emailed, but it could not be marked sent. Refresh and use Mark sent.');
  assert.match(read('mobile/src/AccountsReceivable.tsx'), /onSent=\{load\} \/>/);
  assert.match(read('lib/tracker-receivable.ts'), /row\.status === 'to_send' \? \{ key: MARK_SENT, title: 'Mark sent' \}/, 'Mark sent stays for invoices shared by download');
});

test('a guest in the form: chosen from the stays, saved as a guest, emailed only from guestrelations@; payment details shown on invoices only', () => {
  const f = { ...maker.emptyForm('2026-10-15'), recipientType: 'guest', reservationId: id(40), recipientName: 'Sam Guest', lines: [maker.newLine({ description: 'Late checkout', rate: '40' })] };
  const built = maker.formToAction(f, id(1));
  assert.equal(built.action.recipientType, 'guest');
  assert.equal(built.action.reservationId, id(40));
  assert.equal(built.action.recipientId, undefined);
  assert.ok(maker.documentsActionSchema.safeParse(built.action).success);
  assert.deepEqual(maker.formToAction({ ...f, reservationId: '' }, id(1)), { error: 'Choose the guest.' });
  const back = maker.formFromDocument(maker.makerDocumentSchema.parse(guestDoc({ status: 'draft', number: null })));
  assert.deepEqual([back.recipientType, back.reservationId, back.recipientId], ['guest', id(40), '']);
  assert.deepEqual(maker.sendChoices(maker.makerDocumentSchema.parse(guestDoc())), ['email', 'download'], 'a guest has no account: email or download');
  assert.equal(maker.emailLabel('guest'), 'Email it (from guestrelations@)');
  assert.equal(maker.emailLabel('person'), 'Email it (from ownerrelations@)');
  assert.equal(maker.guestLabel({ reservationId: id(40), name: 'Sam Guest', reference: 'HM-123', propertyName: '110 Hawk Street', checkIn: '2026-10-01', checkOut: '2026-10-05', hasEmail: true }),
    'Sam Guest · 110 Hawk Street, 1 to 5 Oct 2026 (HM-123)');
  // Payment details: in the preview of an invoice, never of a request; from the saved document too.
  const FAKE = 'TEST ONLY sort code 00-00-00';
  assert.equal(doc.rechargeInvoiceDoc(maker.formToInvoice(f, FAKE)).payment, FAKE);
  assert.equal(doc.rechargeInvoiceDoc(maker.formToInvoice(maker.withKind(f, 'request'), FAKE)).payment, '');
  assert.equal(doc.rechargeInvoiceDoc(maker.fromMakerDocument(maker.makerDocumentSchema.parse(saved({ paymentDetails: FAKE })))).payment, FAKE);
  assert.equal(doc.rechargeInvoiceDoc(maker.fromMakerDocument(maker.makerDocumentSchema.parse(saved({ status: 'paid', paidOn: '2026-10-18', paymentDetails: FAKE })))).payment, '', 'never on a paid invoice');
  assert.ok(maker.documentsActionSchema.safeParse({ action: 'savePaymentDetails', requestId: id(1), version: 0, paymentDetails: '' }).success, 'empty clears it');
  assert.ok(!maker.documentsActionSchema.safeParse({ action: 'savePaymentDetails', requestId: id(1), version: -1, paymentDetails: 'x' }).success);
  assert.equal(maker.paymentSavedLine({ version: 0, updatedAt: null, updatedBy: null }), 'Not filled in yet: invoices show no How to pay.');
  assert.equal(maker.paymentSavedLine({ version: 2, updatedAt: '2026-10-15T09:30:00Z', updatedBy: 'Accounts' }), 'Last saved Thu 15 Oct 2026 09:30 by Accounts.');
  const screen = read('mobile/src/InvoiceMaker.tsx');
  assert.match(screen, /<PaymentDetailsEditor p=\{p\} settings=\{payment\} onSaved=\{setPayment\} \/>/);
  assert.match(screen, /m === "guest" \? "A guest"/);
  assert.match(screen, /<RechargeInvoicePaper invoice=\{formToInvoice\(asChosen\(f\), paymentDetails\)\} \/>/);
  assert.match(read('mobile/src/RechargeInvoice.tsx'), /action: "emailReceivable", requestId: request\.get\("email"\), itemId: receivableId/);
});

test('the route, the requests and where the screens are wired', () => {
  assert.ok(maker.documentsReadSchema.safeParse({ section: 'documents' }).success);
  assert.ok(!maker.documentsReadSchema.safeParse({ section: 'document' }).success, 'a document needs its id');
  assert.ok(!maker.documentsActionSchema.safeParse({ action: 'sendDocument', requestId: id(1), id: id(2), channel: 'fax' }).success);
  assert.ok(!maker.documentsActionSchema.safeParse({ action: 'saveDocumentDraft', requestId: id(1), kind: 'invoice', currency: 'EUR', issueOn: '2026-10-15', dueOn: '2026-10-22', note: '', terms: '', lines: [] }).success);
  // The mailbox is never written into a send: it is worked out from who the email is for, and must match the database's.
  const serverSource = read('lib/invoice-maker-server.ts');
  assert.match(serverSource, /sendMailboxEmail\(mailbox, \{/);
  assert.doesNotMatch(serverSource, /sendMailboxEmail\('(guest|owner)'/);
  assert.match(serverSource, /state\.data\.mailbox !== mailbox/);
  assert.doesNotMatch(serverSource, /emailRepliesEnabled/, 'not tied to EMAIL_REPLIES_ENABLED');
  for (const kind of ['mobile', 'workspace']) assert.match(read(`app/api/${kind}/documents/route.ts`), /workspaceDocuments\(request(, true)?\)/);
  assert.match(read('worker/backend-route-policy.ts'), /"\/api\/workspace\/documents", "\/api\/mobile\/documents"/);
  assert.match(read('mobile/src/backend/client.ts'), /\|privacy\|documents\)/);
  assert.match(read('mobile/src/LiveAccounts.tsx'), /\{view === "maker" && isFinanceRole\(role\) && <InvoiceMaker p=\{p\} \/>\}/);
  const screen = read('mobile/src/InvoiceMaker.tsx');
  assert.match(screen, /<RechargeInvoicePaper invoice=\{formToInvoice\(/, 'the live preview');
  for (const label of ['Save draft', 'Issue', 'Mark paid', 'Void it', 'Add a line', 'Up', 'Down', 'Remove', 'Someone in the app', 'Someone else']) assert.ok(screen.includes(`"${label}`) || screen.includes(`? "${label}"`) || screen.includes(`: "${label}"`), label);
  const sql = read('supabase/migrations/20261022100000_recharge_invoices.sql');
  assert.doesNotMatch(sql, /TODO/);
  assert.match(sql, /insert into private\.workspace_cleaner_invoice_numbers\(year,last_number\)/, 'RC-RFI from the cleaners\' counter');
});
