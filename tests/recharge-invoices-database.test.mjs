import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Recharge invoices and the invoice maker (migration 20261022100000): who may make, read and send a document; drafts kept
// per revision and edited only with the current version; Issue locks and numbers RC-INV / RC-RFI per year; paid and void;
// every change in the history; sending in the app, by email (never to a cleaner) and by download, each recorded once; and
// the document for Recharge's existing bills to owners, read by exactly who may read the invoice row today.
const MIGRATION = 'supabase/migrations/20261022100000_recharge_invoices.sql';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const files = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
for (const file of files) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
// Safe to run twice.
await db.exec(await fs.readFile(MIGRATION, 'utf8'));

const roles = ['super_admin', 'accounts', 'stays', 'cleans', 'client', 'client', 'cleaning_manager'];
const names = ['Admin', 'Accounts', 'Stays', 'Angela Cleaner', 'Olivia Owner', 'Other Owner', 'Manager'];
const users = roles.map((_, i) => `97700000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [ADMIN, ACCOUNTS, STAYS, CLEANER, OWNER, OTHER, MANAGER] = roles.map((_, i) => i);
const email = i => `doc${i}@example.com`;
const session = i => users[i].replace('9770', '9870');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], email(i)]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], names[i]]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  if (i === 'backend') { await db.query("select set_config('request.jwt.claims','',false)"); await db.exec('set role service_role'); return; }
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
const owner = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const act = input => rpc('workspace_documents_action', [{ requestId: crypto.randomUUID(), ...input }]);
const read = (section, target = null) => rpc('workspace_documents_read', [section, target]);
const code = async promise => { try { await promise; return 'ok'; } catch (e) { return e.code; } };
const today = (await owner("select (now() at time zone 'Europe/London')::date::text d"))[0].d;
const year = today.slice(0, 4);
const plus = async n => (await owner('select ($1::date+$2::int)::text d', [today, n]))[0].d;

await as(ADMIN);
const hawk = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: '110 Hawk Street', address: '110 Hawk Street, Edinburgh, EH1 1AA' }]).catch(() => rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: '110 Hawk Street' }]));
const leith = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: '12 Leith St' }]);
await rpc('workspace_assign_property', [hawk, users[OWNER], 'client']);
await rpc('workspace_assign_property', [leith, users[OTHER], 'client']);
for (const prop of [hawk, leith]) for (const u of [ACCOUNTS, STAYS]) await rpc('workspace_assign_property', [prop, users[u], 'staff']);
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
after(() => db.close());

const draft = (over = {}) => ({ action: 'saveDocumentDraft', kind: 'invoice', recipientId: users[OWNER], currency: 'GBP', issueOn: today,
  terms: 'Payment is due within 7 days of the invoice date. Please quote the invoice number with your payment.',
  lines: [{ description: 'Linen restock', quantity: '1.5', rateMinor: 3333 }, { description: 'Key cutting', quantity: '2', rateMinor: 1250 }], ...over });

test('only Accounts and management make documents; nobody reaches the tables directly', async () => {
  for (const who of [STAYS, CLEANER, OWNER, MANAGER]) {
    await as(who);
    assert.equal(await code(read('documents')), '42501', names[who]);
    assert.equal(await code(read('recipients')), '42501', names[who]);
    assert.equal(await code(act(draft())), '42501', names[who]);
  }
  for (const table of ['workspace_documents', 'workspace_document_lines', 'workspace_document_numbers', 'workspace_document_history', 'workspace_document_sends']) {
    await as(ACCOUNTS);
    assert.equal(await code(db.query(`select * from private.${table}`)), '42501', table);
  }
  await as(ACCOUNTS);
  assert.equal(await code(rpc('workspace_document_send_result', [{ requestId: crypto.randomUUID(), sentBy: users[ACCOUNTS], ok: true }])), '42501', 'only the backend records an email');
  const people = await read('recipients');
  assert.deepEqual(people.find(p => p.userId === users[CLEANER]), { userId: users[CLEANER], name: 'Angela Cleaner', role: 'cleans', canEmail: false }, 'a cleaner is never offered by email');
  assert.equal(people.find(p => p.userId === users[OWNER]).canEmail, true);
});

test('a draft works out its lines, defaults its due date to 7 days, keeps every revision and needs the current version', async () => {
  await as(ACCOUNTS);
  const doc = await act(draft({ dueOn: undefined }));
  assert.equal(doc.status, 'draft');
  assert.equal(doc.number, null);
  assert.equal(doc.dueOn, await plus(7));
  // 1.5 x £33.33 = £49.995, rounded to £50.00; 2 x £12.50 = £25.00.
  assert.deepEqual(doc.lines.map(l => [l.position, l.amountMinor]), [[1, 5000], [2, 2500]]);
  assert.equal(doc.totalMinor, 7500);
  assert.equal(doc.recipient.name, 'Olivia Owner');
  assert.equal(await code(act(draft({ id: doc.id, version: doc.version + 1 }))), '40001', 'an old version is refused');
  const edited = await act(draft({ id: doc.id, version: doc.version, lines: [{ description: 'Linen restock', quantity: '3', rateMinor: 3333 }] }));
  assert.equal(edited.version, 2);
  assert.equal(edited.totalMinor, 9999);
  const kept = await owner('select revision,count(*)::int n from private.workspace_document_lines where document_id=$1 group by revision order by revision', [doc.id]);
  assert.deepEqual(kept, [{ revision: 1, n: 2 }, { revision: 2, n: 1 }], 'nothing is deleted');
  assert.equal(await code(act(draft({ dueOn: '2020-01-01' }))), '22023', 'due before issue');
  assert.equal(await code(act(draft({ lines: [{ description: 'x', quantity: '0', rateMinor: 1 }] }))), '22023');
  assert.equal(await code(act(draft({ currency: 'EUR' }))), '22023');
  assert.equal((await act(draft({ currency: 'USD', recipientId: undefined, recipientName: 'Maria Santos', recipientEmail: 'maria@va.example', recipientAddress: 'Manila' }))).currency, 'USD');
  // The recipient never sees a draft.
  await as(OWNER);
  assert.equal(await code(read('document', doc.id)), 'P0002');
  assert.deepEqual((await read('mine')).documents, []);
});

test('the same request is the same save; a changed request under the same id is refused', async () => {
  await as(ACCOUNTS);
  const input = { requestId: crypto.randomUUID(), ...draft() };
  const first = await rpc('workspace_documents_action', [input]);
  assert.deepEqual(await rpc('workspace_documents_action', [input]), first);
  assert.equal(await code(rpc('workspace_documents_action', [{ ...input, note: 'changed' }])), '23505');
});

test('Issue locks and numbers per kind and year; paid and void follow; every change is in the history', async () => {
  await as(ACCOUNTS);
  const before = (await owner("select coalesce(max(last_number),0) n from private.workspace_document_numbers where prefix='RC-INV'"))[0].n;
  const a = await act(draft());
  const issued = await act({ action: 'issueDocument', id: a.id, version: a.version });
  assert.equal(issued.status, 'issued');
  assert.equal(issued.number, `RC-INV-${year}-${String(before + 1).padStart(4, '0')}`);
  const b = await act(draft());
  assert.equal((await act({ action: 'issueDocument', id: b.id, version: b.version })).number, `RC-INV-${year}-${String(before + 2).padStart(4, '0')}`);
  const r = await act(draft({ kind: 'request', recipientId: users[CLEANER] }));
  assert.match((await act({ action: 'issueDocument', id: r.id, version: r.version })).number, new RegExp(`^RC-RFI-${year}-\\d{4}$`));
  assert.equal(await code(act(draft({ id: a.id, version: issued.version }))), '42501', 'an issued document is locked');
  assert.equal(await code(act({ action: 'issueDocument', id: a.id, version: issued.version })), '42501');
  const empty = await act(draft({ lines: [] }));
  assert.equal(await code(act({ action: 'issueDocument', id: empty.id, version: empty.version })), '22023', 'nothing to bill');
  assert.equal(await code(act({ action: 'markDocumentPaid', id: a.id, version: issued.version, paidOn: '2020-01-01' })), '22023');
  assert.equal(await code(act({ action: 'markDocumentPaid', id: a.id, version: 1, paidOn: today })), '40001');
  const paid = await act({ action: 'markDocumentPaid', id: a.id, version: issued.version, paidOn: today });
  assert.deepEqual([paid.status, paid.paidOn], ['paid', today]);
  assert.equal(await code(act({ action: 'voidDocument', id: a.id, version: paid.version, reason: 'Raised in error' })), '42501', 'a paid document stays paid');
  const bNow = (await read('documents')).find(d => d.id === b.id);
  assert.equal(await code(act({ action: 'voidDocument', id: b.id, version: bNow.version, reason: 'no' })), '22023', 'a reason is needed');
  const voided = await act({ action: 'voidDocument', id: b.id, version: bNow.version, reason: 'Raised twice by mistake' });
  assert.deepEqual([voided.status, voided.voidReason, voided.number !== null], ['void', 'Raised twice by mistake', true]);
  const discarded = await act({ action: 'voidDocument', id: empty.id, version: empty.version, reason: 'Started by mistake' });
  assert.deepEqual([discarded.status, discarded.number], ['void', null], 'a draft is voided, never deleted');
  const history = (await read('document', a.id)).history;
  assert.deepEqual(history.map(h => [h.action, h.fromStatus, h.toStatus, h.by]), [['created', null, 'draft', 'Accounts'], ['issued', 'draft', 'issued', 'Accounts'], ['paid', 'issued', 'paid', 'Accounts']]);
  assert.equal((await owner('select count(*)::int n from private.workspace_documents'))[0].n >= 3, true);
});

test('the recipient reads an issued document addressed to them, without the history or the email; nobody else does', async () => {
  await as(ACCOUNTS);
  const d = await act(draft());
  const issued = await act({ action: 'issueDocument', id: d.id, version: d.version });
  await as(OWNER);
  const mine = await read('document', d.id);
  assert.equal(mine.number, issued.number);
  assert.equal(mine.lines.length, 2);
  assert.equal(mine.history, undefined);
  assert.equal(mine.sends, undefined);
  assert.equal(mine.recipient.email, null);
  assert.ok((await read('mine')).documents.some(x => x.id === d.id));
  for (const who of [OTHER, STAYS, CLEANER]) { await as(who); assert.equal(await code(read('document', d.id)), 'P0002', names[who]); }
});

test('sending: in the app with a notice, by email from the server (never to a cleaner), by download; each recorded once with who and when', async () => {
  await as(ACCOUNTS);
  const toCleaner = await act(draft({ kind: 'request', recipientId: users[CLEANER] }));
  const c = await act({ action: 'issueDocument', id: toCleaner.id, version: toCleaner.version });
  assert.equal(await code(act({ action: 'sendDocument', id: c.id, channel: 'email' })), '42501', 'a cleaner is never emailed');
  const typed = await act(draft({ recipientId: undefined, recipientName: 'Angela', recipientEmail: email(CLEANER).toUpperCase() }));
  const t = await act({ action: 'issueDocument', id: typed.id, version: typed.version });
  assert.equal(await code(act({ action: 'sendDocument', id: t.id, channel: 'email' })), '42501', 'not even at their address typed by hand');
  assert.deepEqual(await owner("select * from private.workspace_document_sends where channel='email' and document_id in ($1,$2)", [c.id, t.id]), []);
  const inApp = await act({ action: 'sendDocument', id: c.id, channel: 'in_app' });
  assert.equal(inApp.send, false);
  const notes = await owner(`select a.event_type,a.property_id,o.work_id,d.preview from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id
    left join private.workspace_activity_details d on d.event_id=a.id where o.user_id=$1 and a.event_type='finance.document_sent'`, [users[CLEANER]]);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].property_id, null);
  assert.match(notes[0].preview, new RegExp(`^Request for invoice ${c.number} from Recharge Group: £\\d`));
  await as(CLEANER);
  assert.ok((await read('mine')).documents.some(x => x.id === c.id), 'the cleaner opens it in the app');
  await as(ACCOUNTS);
  assert.equal(await code(act({ action: 'sendDocument', id: toCleaner.id, channel: 'email' })), '42501');
  const draftOnly = await act(draft());
  assert.equal(await code(act({ action: 'sendDocument', id: draftOnly.id, channel: 'in_app' })), '42501', 'issue first');

  const d = await act(draft());
  const issued = await act({ action: 'issueDocument', id: d.id, version: d.version });
  const requestId = crypto.randomUUID();
  const started = await rpc('workspace_documents_action', [{ requestId, action: 'sendDocument', id: d.id, channel: 'email' }]);
  assert.deepEqual([started.send, started.email], [true, { to: email(OWNER), name: 'Olivia Owner' }]);
  assert.equal(started.document.number, issued.number);
  assert.equal((await rpc('workspace_documents_action', [{ requestId, action: 'sendDocument', id: d.id, channel: 'email' }])).send, true, 'still pending: the server may try again');
  await as('backend');
  assert.deepEqual(await rpc('workspace_document_send_result', [{ requestId, sentBy: users[ACCOUNTS], ok: true, messageId: requestId + '@rechargegroup.co.uk' }]), { recorded: true, status: 'sent' });
  assert.deepEqual(await rpc('workspace_document_send_result', [{ requestId, sentBy: users[ACCOUNTS], ok: true }]), { recorded: false, status: 'sent' });
  await as(ACCOUNTS);
  assert.equal((await rpc('workspace_documents_action', [{ requestId, action: 'sendDocument', id: d.id, channel: 'email' }])).send, false, 'sent once');
  await act({ action: 'sendDocument', id: d.id, channel: 'download' });
  const full = await read('document', d.id);
  assert.deepEqual(full.sends.map(s => [s.channel, s.toName, s.toEmail, s.status, s.by]), [['email', 'Olivia Owner', email(OWNER), 'sent', 'Accounts'], ['download', 'Olivia Owner', null, 'sent', 'Accounts']]);
  assert.deepEqual(full.history.map(h => h.action), ['created', 'issued', 'email_started', 'emailed', 'downloaded']);
  assert.ok(full.lastSentAt);
  const external = await act(draft({ recipientId: undefined, recipientName: 'Holyrood Lettings Ltd' }));
  const x = await act({ action: 'issueDocument', id: external.id, version: external.version });
  assert.equal(await code(act({ action: 'sendDocument', id: x.id, channel: 'email' })), '22023', 'no address: download instead');
  assert.equal(await code(act({ action: 'sendDocument', id: x.id, channel: 'in_app' })), '22023', 'no account: not in the app');
});

test('the document for an existing bill to an owner follows the invoice row: the owner their own, staff by tool, never a cleaner or supplier invoice', async () => {
  const [{ id: bill }] = await owner(`insert into public.workspace_invoices(request_id,property_id,module_id,recipient_id,reference,amount_minor,currency,created_by)
    values(gen_random_uuid(),$1,'onboarding-invoices',$2,'ONB-2026-014',45000,'GBP',$3) returning id`, [hawk, users[OWNER], users[ACCOUNTS]]);
  const [{ id: supplierBill }] = await owner(`insert into public.workspace_invoices(request_id,property_id,module_id,recipient_id,reference,amount_minor,currency,created_by)
    values(gen_random_uuid(),$1,'purchase-order-invoices',$2,'SUP-881',4000,'GBP',$3) returning id`, [hawk, users[ACCOUNTS], users[ACCOUNTS]]);
  await as(OWNER);
  const doc = await read('invoice', bill);
  assert.deepEqual([doc.source, doc.module, doc.reference, doc.recipientName, doc.propertyName, doc.amountMinor, doc.status, doc.paidOn], ['workspace', 'onboarding-invoices', 'ONB-2026-014', 'Olivia Owner', '110 Hawk Street', 45000, 'issued', null]);
  assert.ok((await read('mine')).invoices.some(i => i.id === bill));
  await as(OTHER);
  assert.equal(await code(read('invoice', bill)), 'P0002', 'another owner never');
  assert.deepEqual((await read('mine')).invoices, []);
  await as(ACCOUNTS);
  assert.equal((await read('invoice', bill)).reference, 'ONB-2026-014');
  assert.equal(await code(read('invoice', supplierBill)), 'P0002', 'not a bill from Recharge');
  await as(CLEANER);
  assert.equal(await code(read('invoice', bill)), 'P0002');
  await owner("update public.workspace_invoices set status='paid',paid_at=now(),version=version+1 where id=$1", [bill]);
  await as(OWNER);
  assert.equal((await read('invoice', bill)).paidOn, today);
});

test('RC-RFI numbers are shared with the cleaners\' requests: a cleaner request and a maker request in the same year are consecutive and distinct', async () => {
  const counter = async () => (await owner('select coalesce((select last_number from private.workspace_cleaner_invoice_numbers where year=$1),0) n', [Number(year)]))[0].n;
  const rfi = n => `RC-RFI-${year}-${String(n).padStart(4, '0')}`;
  const start = await counter();
  // A maker request first.
  await as(ACCOUNTS);
  const m1 = await act(draft({ kind: 'request', recipientId: users[CLEANER] }));
  const first = (await act({ action: 'issueDocument', id: m1.id, version: m1.version })).number;
  assert.equal(first, rfi(start + 1));
  // Then the cleaners' run: an accepted clean ten days ago, in a week that has ended, makes the cleaner's request.
  await as(ADMIN);
  const clean = await rpc('workspace_operations_action', [{ requestId: crypto.randomUUID(), action: 'createOperation', propertyId: hawk, kind: 'cleaning', data: { dueOn: today, checklist: ['Kitchen'] } }]);
  await owner(`insert into private.workspace_clean_earnings(work_id,cleaner_id,property_id,clean_on,accepted_at,rate_minor)
    values($1,$2,$3,(now() at time zone 'Europe/London')::date-10,now()-interval '10 days',4000)`, [clean.workId, users[CLEANER], hawk]);
  assert.equal((await owner('select private.workspace_cleaner_invoice_run(now()) r'))[0].r.invoices, 1);
  const cleanerRequest = (await owner('select number from private.workspace_cleaner_invoices where cleaner_id=$1 and generated', [users[CLEANER]]))[0].number;
  assert.equal(cleanerRequest, rfi(start + 2));
  // And a maker request after it.
  await as(ACCOUNTS);
  const m2 = await act(draft({ kind: 'request', recipientId: users[CLEANER] }));
  assert.equal((await act({ action: 'issueDocument', id: m2.id, version: m2.version })).number, rfi(start + 3));
  assert.equal(await counter(), start + 3, 'one counter');
  const all = (await owner(`select number from private.workspace_documents where number like 'RC-RFI-%' union all select number from private.workspace_cleaner_invoices where number is not null`)).map(r => r.number);
  assert.equal(new Set(all).size, all.length, 'never the same number twice');
  assert.equal((await owner("select count(*)::int n from private.workspace_document_numbers where prefix<>'RC-INV'"))[0].n, 0, 'the maker keeps no RC-RFI counter of its own');
});

// Fake text only: the real payment details are typed in the app by management.
const FAKE_PAY = 'TEST ONLY account name\nTEST ONLY 00-00-00 00000000';
test('payment details: empty until saved (nothing seeded), saved by Accounts and management against the version with who and when; shown on invoices only', async () => {
  assert.equal((await owner('select count(*)::int n from private.workspace_finance_settings'))[0].n, 0, 'nothing seeded');
  for (const table of ['workspace_finance_settings', 'workspace_finance_settings_history']) {
    const [row] = await owner("select c.relrowsecurity rls,has_table_privilege('authenticated','private.'||c.relname,'select') auth_select from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname=$1", [table]);
    assert.deepEqual(row, { rls: true, auth_select: false }, table);
  }
  for (const who of [STAYS, CLEANER, OWNER, MANAGER]) {
    await as(who);
    assert.equal(await code(read('payment')), '42501', names[who]);
    assert.equal(await code(act({ action: 'savePaymentDetails', version: 0, paymentDetails: FAKE_PAY })), '42501', names[who]);
  }
  await as(ACCOUNTS);
  assert.deepEqual(await read('payment'), { paymentDetails: '', version: 0, updatedAt: null, updatedBy: null, history: [] });
  const inv = await act(draft());
  assert.equal(inv.paymentDetails, '', 'an invoice has none to show yet');
  const first = await act({ action: 'savePaymentDetails', version: 0, paymentDetails: '  ' + FAKE_PAY.replace('\n', '\r\n') + '\n ' });
  assert.deepEqual([first.paymentDetails, first.version, first.updatedBy, first.history.length], [FAKE_PAY, 1, 'Accounts', 1]);
  assert.equal(await code(act({ action: 'savePaymentDetails', version: 0, paymentDetails: 'TEST ONLY other' })), '40001', 'the version read');
  assert.equal(await code(act({ action: 'savePaymentDetails', version: 1, paymentDetails: 'x'.repeat(1001) })), '22023', 'up to 1,000 characters');
  assert.equal(await code(act({ action: 'savePaymentDetails', version: 1, paymentDetails: 7 })), '22023');
  await as(ADMIN);
  const second = await act({ action: 'savePaymentDetails', version: 1, paymentDetails: FAKE_PAY + '\nTEST ONLY reference: the invoice number' });
  assert.deepEqual([second.version, second.updatedBy, second.history.map(h => [h.version, h.by, h.cleared])], [2, 'Admin', [[2, 'Admin', false], [1, 'Accounts', false]]]);
  assert.deepEqual((await owner('select version,actor_id,old_value,new_value from private.workspace_finance_settings_history order by id')).map(h => [h.version, h.actor_id, h.old_value === '', h.new_value.startsWith('TEST ONLY')]),
    [[1, users[ACCOUNTS], true, true], [2, users[ADMIN], false, true]]);
  // On every invoice (the maker's and Recharge's bills to owners), never on a request for invoice.
  await as(ACCOUNTS);
  const issued = await act({ action: 'issueDocument', id: inv.id, version: inv.version });
  assert.equal(issued.paymentDetails, second.paymentDetails);
  const req = await act(draft({ kind: 'request', recipientId: users[OWNER] }));
  assert.equal(req.paymentDetails, null);
  await as(OWNER);
  assert.equal((await read('document', issued.id)).paymentDetails, second.paymentDetails, 'the owner sees how to pay');
  // Cleared again: invoices show nothing.
  await as(ACCOUNTS);
  const cleared = await act({ action: 'savePaymentDetails', version: 2, paymentDetails: '' });
  assert.deepEqual([cleared.paymentDetails, cleared.version, cleared.history[0].cleared], ['', 3, true]);
  assert.equal((await read('document', issued.id)).paymentDetails, '');
});

test('guests: chosen from the stays, emailed from the guest mailbox; owners from the owners\' one; the two never mix; Receivable invoices too', async () => {
  const stay = async (ref, channel = 'direct', channelRef = null) => (await owner(`insert into private.workspace_reservations(property_id,reference,check_in,check_out,status,source,channel,channel_reference)
    values($1,$2,$3::date-3,$3::date-1,'confirmed','hostaway',$4,$5) returning id`, [hawk, ref, today, channel, channelRef]))[0].id;
  const sam = await stay('GUEST-SAM'), nomail = await stay('GUEST-NONE'), ownStay = await stay('OWNER-OWN', 'other', 'Owner stay');
  await owner('insert into private.workspace_stay_contacts(reservation_id,first_name,email) values($1,$2,$3)', [sam, 'Sam', 'sam.guest@example.org']);
  await as(STAYS);
  assert.equal(await code(read('guests')), '42501');
  await as(ACCOUNTS);
  const guests = await read('guests');
  const g = guests.find(x => x.reservationId === sam);
  assert.deepEqual([g.hasEmail, g.email, g.reference], [true, 'sam.guest@example.org', 'GUEST-SAM']);
  assert.equal(guests.find(x => x.reservationId === nomail).hasEmail, false);
  assert.ok(!guests.some(x => x.reservationId === ownStay), 'never an owner\'s own stay');
  assert.equal(await code(act(draft({ recipientId: undefined, recipientType: 'guest', reservationId: ownStay }))), '22023');
  // A maker document for the guest: from guestrelations@ (the database's choice, recorded on the send).
  const send = doc => act({ action: 'sendDocument', id: doc.id, channel: 'email', requestId: crypto.randomUUID() });
  const issue = async over => { const d = await act(draft({ recipientId: undefined, ...over })); return act({ action: 'issueDocument', id: d.id, version: d.version }); };
  const forSam = await issue({ recipientType: 'guest', reservationId: sam, recipientName: 'Sam Guest' });
  assert.deepEqual([forSam.recipient.kind, forSam.recipient.userId, forSam.recipient.reservationId, forSam.recipient.hasEmail, forSam.recipient.stay.reference], ['guest', null, sam, true, 'GUEST-SAM']);
  const started = await send(forSam);
  assert.deepEqual([started.send, started.mailbox, started.email.to], [true, 'guest', 'sam.guest@example.org']);
  assert.equal(await code(act({ action: 'sendDocument', id: forSam.id, channel: 'in_app', requestId: crypto.randomUUID() })), '22023', 'a guest has no account');
  // An owner: from ownerrelations@.
  const forOlivia = await issue({ recipientId: users[OWNER] });
  assert.equal((await send(forOlivia)).mailbox, 'owner');
  // Never mixed: a guest document to an account's address, an owners' mailbox email to a guest's address.
  assert.equal(await code(send(await issue({ recipientType: 'guest', reservationId: nomail, recipientEmail: email(OWNER) }))), '42501', 'an owner never gets the guest mailbox');
  assert.equal(await code(send(await issue({ recipientName: 'Sam typed by hand', recipientEmail: 'SAM.guest@example.org' }))), '42501', 'a guest never gets the owners\' mailbox');
  assert.equal(await code(send(await issue({ recipientType: 'guest', reservationId: nomail }))), '22023', 'no address');
  const boxes = await owner("select s.mailbox,d.recipient_kind from private.workspace_document_sends s join private.workspace_documents d on d.id=s.document_id where s.channel='email'");
  assert.ok(boxes.length >= 2 && boxes.every(b => b.mailbox === (b.recipient_kind === 'guest' ? 'guest' : 'owner')), 'every email send: a guest from the guest mailbox, everyone else from the owners\' one');

  // Receivable invoices (hub invoices): the guest of the stay from guestrelations@, the owner (client) from ownerrelations@.
  const hub = async extra => (await rpc('workspace_teams_action', [{ action: 'saveHubItem', requestId: crypto.randomUUID(), kind: 'invoice', title: 'Late checkout', amountMinor: 4000, reference: 'INV-' + Math.random().toString(36).slice(2, 7), ...extra }])).id;
  await as(ACCOUNTS);
  const guestBill = await hub({ reservationId: sam }), ownerBill = await hub({ clientId: users[OWNER], propertyId: hawk }), loose = await hub({ propertyId: hawk });
  const emailHub = (itemId, requestId = crypto.randomUUID()) => act({ action: 'emailReceivable', itemId, requestId });
  const req = crypto.randomUUID();
  const viaGuest = await emailHub(guestBill, req);
  assert.deepEqual([viaGuest.send, viaGuest.mailbox, viaGuest.recipientKind, viaGuest.email.to, viaGuest.receivable.itemId, viaGuest.receivable.stayReference, viaGuest.receivable.details],
    [true, 'guest', 'guest', 'sam.guest@example.org', guestBill, 'GUEST-SAM', '']);
  assert.deepEqual(await emailHub(guestBill, req), viaGuest, 'the same request is the same send');
  await as('backend');
  await rpc('workspace_document_send_result', [{ requestId: req, sentBy: users[ACCOUNTS], ok: true, messageId: 'm1' }]);
  await as(ACCOUNTS);
  assert.equal((await emailHub(guestBill, req)).send, false, 'sent once');
  const viaOwner = await emailHub(ownerBill);
  assert.deepEqual([viaOwner.mailbox, viaOwner.recipientKind, viaOwner.email.to], ['owner', 'person', email(OWNER)]);
  assert.equal(await code(emailHub(loose)), '22023', 'nobody to email');
  const state = await read('receivable', guestBill);
  assert.deepEqual([state.recipient.kind, state.recipient.mailbox, state.recipient.hasEmail, state.recipient.email, state.sends.map(s => [s.mailbox, s.status])], ['guest', 'guest', true, undefined, [['guest', 'sent']]]);
  for (const who of [STAYS, OWNER, CLEANER]) { await as(who); assert.equal(await code(emailHub(guestBill)), '42501', names[who]); assert.equal(await code(read('receivable', guestBill)), '42501', names[who]); }
});
