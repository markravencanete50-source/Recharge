import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// The onboarding fee (Business Plan v1.0, Phase 1; migration 20261027300000): signing the agreement confirms it to the owner and
// opens the fee in Receivable; accounts send it and the owner is told, then reminded every 48 hours until it is settled; settling
// it moves the onboarding on and releases the package's tasks, which were held until then. The fee and messages are a setting.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { journeyActionSchema } = await vite.ssrLoadModule('/lib/journey-policy.ts');
const F = await vite.ssrLoadModule('/lib/onboarding-fee.ts');
const MIGRATION = 'supabase/migrations/20261027300000_onboarding_fee.sql';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const roles = ['super_admin', 'admin', 'stays', 'client', 'client', 'accounts'];
const names = ['Sam', 'Morag', 'Fiona', 'Olive Owner', 'Other Owner', 'Andy Accounts'];
const users = roles.map((_, i) => `97750000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, STAYS, OWNER, OTHER, ACCOUNTS] = roles.map((_, i) => i);
const session = i => users[i].replace('9775', '9875');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `fee${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], names[i]]);
  await db.query('insert into private.workspace_onboarding_done(user_id) values($1) on conflict do nothing', [users[i]]);
}
for (const i of [STAYS, OWNER, OTHER]) await db.query("insert into public.workspace_module_grants(user_id,module_id) values($1,'property-onboarding')", [users[i]]);
// Accounts keep the finance tools, as on the live site.
await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features on conflict do nothing', [users[ACCOUNTS]]);
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
const owner = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const refused = async (promise, pattern) => assert.rejects(promise, error => pattern.test(error.message));
const sweep = async at => { await db.exec('reset role'); return (await db.query('select private.workspace_onboarding_fee_sweep($1) r', [at])).rows[0].r; };
const read = async (prop, i = ADMIN) => { await as(i); return F.feeViewSchema.parse(await rpc('workspace_onboarding_fee_read', [prop])); };
const fee = async prop => (await owner('select f.*,i.status,i.amount_minor,i.client_id,i.created_by,i.title from private.workspace_onboarding_fees f join private.workspace_hub_items i on i.id=f.item_id where f.property_id=$1', [prop]))[0];
const item = async prop => (await owner('select i.id,i.version from private.workspace_onboarding_fees f join private.workspace_hub_items i on i.id=f.item_id where f.property_id=$1', [prop]))[0];
const move = async (prop, status, extra = {}, i = ACCOUNTS) => { const it = await item(prop); await as(i); return rpc('workspace_teams_action', [{ action: 'moveHubItem', requestId: crypto.randomUUID(), id: it.id, version: it.version, status, ...extra }]); };
const stageOf = async prop => (await owner('select stage from private.workspace_journeys where property_id=$1', [prop]))[0].stage;
const messages = async (who = OWNER) => owner("select m.body from private.chat_messages m join private.chat_conversations c on c.id=m.conversation_id where c.kind='owner' and c.owner_id=$1 and m.kind='text' order by m.created_at,m.id", [users[who]]);
const mails = async (who = OWNER) => owner("select o.subject,o.body from private.workspace_email_outbox o where o.to_address=$1 order by o.created_at", [`fee${who}@example.com`]);
const notified = async (i, event) => (await owner('select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.user_id=$1 and a.event_type=$2', [users[i], event]))[0].n;
const SETUP = { businessName: 'Olive Owner', bankAccountName: 'O Owner', bankAccountNumber: '12345678', bankSortCode: '12-34-56', accessDate: '2026-10-01', accessInfo: 'Keybox by the door',
  utilitiesConnected: true, prepaymentMeters: false, broadbandConnected: true, hasGarden: true, mailPreference: 'photograph', warrantyDetails: '', preferredRepairContact: '', repairLimitMinor: 20000,
  fullRepairPermission: false, furnishingChoice: 'recharge', licensingRequired: true, gasElectricMeters: 'Smart meters', operatingStatus: 'Empty' };
const said = async (pattern, who = OWNER) => assert.ok((await messages(who)).some(m => pattern.test(m.body)), String(pattern));
const tasks = async prop => (await owner("select d.kind from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where w.property_id=$1 and d.kind in ('cleaning_setup','licensing','garden_setup','furnishing_quote','onboarding_invoice') order by d.kind", [prop])).map(r => r.kind);
const hours = (from, h) => new Date(new Date(from).getTime() + h * 3600000);
after(async () => { await db.close(); await vite.close(); });

const versionOf = async prop => (await owner('select version from private.workspace_journeys where property_id=$1', [prop]))[0].version;
async function journey(i, prop, input) {
  const version = await versionOf(prop);
  await as(i);
  return rpc('workspace_journey_action', [journeyActionSchema.parse({ requestId: crypto.randomUUID(), propertyId: prop, version, ...input })]);
}
async function sent(by = OWNER, name = 'Harbour Flat') {
  await as(by);
  const created = await rpc('workspace_journey_action', [journeyActionSchema.parse({ action: 'createEnquiry', requestId: crypto.randomUUID(), name, address: '8 Shore Road\nLeith, Edinburgh EH6 6RG', propertyType: 'Flat', bedrooms: 2, bathrooms: 1 })]);
  const prop = created.propertyId;
  await journey(ADMIN, prop, { action: 'publishEstimate', lowRateMinor: 9000, mediumRateMinor: 11000, highRateMinor: 14000, comparables: [], managementFeeBps: 1800, otaFeeBps: 1500 });
  await journey(by, prop, { action: 'decideEstimate', decision: 'proceed' });
  await db.exec('reset role'); await db.query("insert into private.workspace_onboarding_packages(property_id,answers,submitted_at) values($1,'{}',now()) on conflict(property_id) do update set submitted_at=coalesce(private.workspace_onboarding_packages.submitted_at,now())", [prop]);
  await journey(ADMIN, prop, { action: 'publishAgreement', agreement: 'This management agreement is between Recharge and the owner.' });
  return prop;
}
async function signed(who = OWNER, name = 'Harbour Flat') {
  let prop; try { prop = await sent(who, name); } catch (e) { console.log('WHERE', e.where); throw e; }
  await journey(who, prop, { action: 'signAgreement', agreementRevision: 1, signedName: names[who], consent: true });
  return prop;
}

test('the migration runs twice; one settings row; the defaults; who may read and change it', async () => {
  await db.exec('reset role');
  // Run twice, with the migrations after it run again too (a later one may replace a function this one defines).
  for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql') && 'supabase/migrations/' + f >= MIGRATION).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
  const [{ n }] = await owner('select count(*)::int n from private.workspace_onboarding_fee_settings');
  assert.equal(n, 1);
  const v = await read(null);
  assert.equal(v.settings.amountMinor, null, 'no fee until an admin sets one');
  assert.equal(v.settings.reminderHours, F.DEFAULT_FEE_REMINDER_HOURS);
  assert.equal(v.settings.canEdit, true);
  assert.equal((await read(null, ACCOUNTS)).settings.canEdit, false, 'accounts read it');
  for (const i of [OWNER, OTHER]) { await as(i); await refused(rpc('workspace_onboarding_fee_read', [null]), /access required/); }
  await as(ACCOUNTS);
  await refused(rpc('workspace_onboarding_fee_action', [{ action: 'saveSettings', requestId: crypto.randomUUID(), amountMinor: 1, remindersOn: true, reminderHours: 48, signedMessage: 'a', sentMessage: 'b', reminderMessage: 'c', settledMessage: 'd' }]), /Only admins/);
  await as(ADMIN);
  await refused(db.query('select private.workspace_onboarding_fee_sweep()'), /permission denied/);
  await refused(db.query('select private.workspace_handover(null,null,null,null,null)'), /permission denied/);
  const s = v.settings;
  await as(SUPER);
  const saved = F.feeViewSchema.parse(await rpc('workspace_onboarding_fee_action', [F.feeSettingsActionSchema.parse({ action: 'saveSettings', requestId: crypto.randomUUID(), amountMinor: 49500, remindersOn: true, reminderHours: 48,
    signedMessage: s.signedMessage, sentMessage: s.sentMessage, reminderMessage: s.reminderMessage, settledMessage: s.settledMessage })]));
  assert.equal(saved.settings.amountMinor, 49500);
  assert.equal(saved.settings.updatedByName, 'Sam');
  await refused(rpc('workspace_onboarding_fee_action', [{ action: 'saveSettings', requestId: crypto.randomUUID(), amountMinor: 1, remindersOn: true, reminderHours: 0, signedMessage: 'a', sentMessage: 'b', reminderMessage: 'c', settledMessage: 'd' }]), /Remind every/);
  assert.equal(F.feeSettingsActionSchema.safeParse({ action: 'saveSettings', requestId: crypto.randomUUID(), amountMinor: null, remindersOn: true, reminderHours: 48, signedMessage: '', sentMessage: 'b', reminderMessage: 'c', settledMessage: 'd' }).success, false);
});

test('signing: a confirmation to the owner, and the fee ticket in Receivable for accounts', async () => {
  const prop = await signed();
  const [first] = await messages();
  assert.match(first.body, /^Hi Olive, thank you for signing the management agreement for Harbour Flat\./);
  assert.deepEqual((await mails()).map(m => m.subject), ['Your management agreement for Harbour Flat is signed']);
  const f = await fee(prop);
  assert.equal(f.status, 'to_send', 'the orange dot: accounts are preparing it');
  assert.equal(Number(f.amount_minor), 49500);
  assert.equal(f.client_id, users[OWNER]);
  assert.equal(f.created_by, users[ADMIN], 'raised in the name of whoever sent the agreement');
  assert.equal(f.title, 'Onboarding fee: Harbour Flat');
  assert.equal(await notified(ACCOUNTS, 'hub.onboarding_fee'), 1);
  await as(ACCOUNTS);
  const report = await rpc('workspace_finance_report', ['receivable', null, null, null, null, null]);
  const row = report.toSend.find(r => r.title === 'Onboarding fee: Harbour Flat');
  assert.ok(row, 'listed in Receivable, as an invoice to send');
  assert.equal(row.clientName, 'Olive Owner');
  // The package's tasks wait for the fee; the old invoice task is not made at all.
  await journey(OWNER, prop, { action: 'submitForm', form: SETUP });
  assert.equal(await stageOf(prop), 'invoice');
  assert.deepEqual(await tasks(prop), []);
  const held = (await read(prop)).fee.held;
  assert.deepEqual(held.map(h => h.releasedAt), [null, null, null, null], 'cleaning set-up, licensing, garden and furnishing wait');

  // Sent: the owner and the team are told; reminders every 48 hours until settled.
  await move(prop, 'sent');
  await said(/the onboarding fee invoice for Harbour Flat has been sent for £495\.00\./);
  assert.ok(await notified(ADMIN, 'enquiry.fee_sent') >= 1, 'whoever sent the agreement hears it went');
  const sentAt = (await fee(prop)).sent_at;
  assert.equal((await sweep(new Date(new Date(sentAt).getTime() + 47 * 3600000))).reminded, 0);
  assert.equal((await sweep(new Date(new Date(sentAt).getTime() + 48 * 3600000))).reminded, 1);
  assert.equal((await sweep(new Date(new Date(sentAt).getTime() + 49 * 3600000))).reminded, 0, 'once per 48 hours');
  assert.equal((await sweep(new Date(new Date(sentAt).getTime() + 96 * 3600000))).reminded, 1);
  await said(/a friendly reminder that the onboarding fee invoice for Harbour Flat for £495\.00 is still outstanding/);
  assert.equal((await mails()).filter(m => /^Reminder:/.test(m.subject)).length, 2, 'by email too');
  let v = await read(prop);
  assert.equal(v.fee.reminders, 2);
  assert.equal(F.feeStage(v.fee).tone, 'wait');
  assert.ok(F.nextReminder(v.fee, v.settings));

  // Settled: the step turns green, the onboarding moves on and the held tasks are released onto their boards.
  await move(prop, 'paid', { settledMinor: 49500 });
  v = await read(prop);
  assert.ok(v.fee.settledAt);
  assert.equal(v.fee.released, 4);
  assert.equal(F.feeStage(v.fee).tone, 'good');
  assert.equal(F.nextReminder(v.fee, v.settings), null);
  assert.equal(await stageOf(prop), 'inspection_to_book');
  assert.deepEqual(await tasks(prop), ['cleaning_setup', 'furnishing_quote', 'garden_setup', 'licensing']);
  await said(/we have received the onboarding fee for Harbour Flat/);
  assert.ok(await notified(ADMIN, 'enquiry.fee_settled') >= 1);
  assert.equal((await sweep(new Date(new Date(sentAt).getTime() + 500 * 3600000))).reminded, 0, 'no reminders once settled');
  // The inspection can be booked: the onboarding invoice counts as settled.
  await journey(ADMIN, prop, { action: 'bookInspection', inspectionOn: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) });
  assert.equal(await stageOf(prop), 'inspection_booked');
});

test('the fee settled before the set-up form: the form\'s tasks go straight to their boards', async () => {
  const prop = await signed(OTHER, 'Garden Cottage');
  await move(prop, 'sent');
  await move(prop, 'paid', { settledMinor: 49500 });
  assert.equal(await stageOf(prop), 'form');
  await journey(OTHER, prop, { action: 'submitForm', form: SETUP });
  assert.equal(await stageOf(prop), 'inspection_to_book');
  assert.deepEqual(await tasks(prop), ['cleaning_setup', 'furnishing_quote', 'garden_setup', 'licensing']);
});

test('reminders can be switched off; signing twice never opens a second ticket', async () => {
  const s = (await read(null)).settings;
  await as(ADMIN);
  await rpc('workspace_onboarding_fee_action', [{ action: 'saveSettings', requestId: crypto.randomUUID(), amountMinor: null, remindersOn: false, reminderHours: 24,
    signedMessage: s.signedMessage, sentMessage: s.sentMessage, reminderMessage: s.reminderMessage, settledMessage: s.settledMessage }]);
  const prop = await signed(OWNER, 'Loft');
  assert.equal((await fee(prop)).amount_minor, null, 'accounts fill in the amount');
  await move(prop, 'sent');
  await said(/the onboarding fee invoice for Loft has been sent\./);
  assert.equal((await sweep(new Date(Date.now() + 100 * 3600000))).reminded, 0);
  await owner('update private.workspace_journeys set signed_at=null where property_id=$1', [prop]);
  await owner('update private.workspace_journeys set signed_at=now() where property_id=$1', [prop]);
  assert.equal((await owner('select count(*)::int n from private.workspace_onboarding_fees where property_id=$1', [prop]))[0].n, 1);
});
