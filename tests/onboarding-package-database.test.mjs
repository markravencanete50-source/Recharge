import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// The onboarding package (Business Plan v1.0, Phase 2; migration 20261028100000): once the owner goes ahead they build their
// package (Recharge or themselves for each part, operator and payout details), which must be in before the agreement is published;
// it fills in the agreement's placeholders, adds its extras to the onboarding fee and answers the set-up form. Admins edit it.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { journeyActionSchema } = await vite.ssrLoadModule('/lib/journey-policy.ts');
const P = await vite.ssrLoadModule('/lib/onboarding-package.ts');
const MIGRATION = 'supabase/migrations/20261028100000_onboarding_package.sql';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const roles = ['super_admin', 'admin', 'stays', 'client', 'client', 'accounts'];
const names = ['Sam', 'Morag', 'Fiona', 'Olive Owner', 'Other Owner', 'Andy Accounts'];
const users = roles.map((_, i) => `97760000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, STAYS, OWNER, OTHER, ACCOUNTS] = roles.map((_, i) => i);
const session = i => users[i].replace('9776', '9876');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `pkg${i}@example.com`]);
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
const fee = async prop => (await owner('select f.*,i.status,i.amount_minor,i.client_id,i.created_by,i.title from private.workspace_onboarding_fees f join private.workspace_hub_items i on i.id=f.item_id where f.property_id=$1', [prop]))[0];
const item = async prop => (await owner('select i.id,i.version from private.workspace_onboarding_fees f join private.workspace_hub_items i on i.id=f.item_id where f.property_id=$1', [prop]))[0];
const move = async (prop, status, extra = {}, i = ACCOUNTS) => { const it = await item(prop); await as(i); return rpc('workspace_teams_action', [{ action: 'moveHubItem', requestId: crypto.randomUUID(), id: it.id, version: it.version, status, ...extra }]); };
const stageOf = async prop => (await owner('select stage from private.workspace_journeys where property_id=$1', [prop]))[0].stage;
const messages = async (who = OWNER) => owner("select m.body from private.chat_messages m join private.chat_conversations c on c.id=m.conversation_id where c.kind='owner' and c.owner_id=$1 order by m.created_at,m.id", [users[who]]);
const mails = async (who = OWNER) => owner("select o.subject,o.body from private.workspace_email_outbox o where o.to_address=$1 order by o.created_at", [`pkg${who}@example.com`]);
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
async function proceeded(by = OWNER, name = 'Harbour Flat') {
  await as(by);
  const created = await rpc('workspace_journey_action', [journeyActionSchema.parse({ action: 'createEnquiry', requestId: crypto.randomUUID(), name, address: '8 Shore Road\nLeith, Edinburgh EH6 6RG', propertyType: 'Flat', bedrooms: 2, bathrooms: 1 })]);
  const prop = created.propertyId;
  await journey(ADMIN, prop, { action: 'publishEstimate', lowRateMinor: 9000, mediumRateMinor: 11000, highRateMinor: 14000, comparables: [], managementFeeBps: 1800, otaFeeBps: 1500 });
  await journey(by, prop, { action: 'decideEstimate', decision: 'proceed' });
  return prop;
}

const read = async (prop, i = OWNER) => { await as(i); return P.packageViewSchema.parse(await rpc('workspace_package_read', [prop])); };
const save = async (prop, answers, extra = {}, i = OWNER) => { await as(i); return P.packageViewSchema.parse(await rpc('workspace_package_action', [P.packageActionSchema.parse({ action: 'savePackage', requestId: crypto.randomUUID(), propertyId: prop, answers, submit: false, ...extra })])); };
const ALL = { setUp: 'recharge', broadbandInstalled: false, broadbandRecharge: true, utilitiesConnected: true, prepaymentMeters: false, utilitiesUnderstood: true,
  complianceRecharge: ['EICR', 'EPC'], licensingContact: true, garden: true, gardenQuote: false, waste: 'private', wasteRecharge: true,
  operatorName: 'Olive Owner Lettings Ltd', repairLimitMinor: 25000, preferredRepairContact: 'Joe the plumber, 07700 900000' };
const BANK = { accountName: 'Olive Owner Lettings', sortCode: '12-34-56', accountNumber: '12345678' };
const publish = async prop => journey(ADMIN, prop, { action: 'publishAgreement', agreement: 'This management agreement is between Recharge and {{Operator name}}.' });

test('the migration runs twice, every anchor once, and it stays locked down', async () => {
  const sql = await fs.readFile(MIGRATION, 'utf8');
  await db.exec('reset role'); await db.exec(sql); await db.exec(sql);
  assert.ok(!/—/.test(sql), 'no em dashes');
  for (const t of ['workspace_package_settings', 'workspace_onboarding_packages']) {
    const [r] = await owner('select relrowsecurity rls from pg_class where oid=$1::regclass', ['private.' + t]);
    assert.equal(r.rls, true, t);
    for (const role of ['anon', 'authenticated', 'service_role']) assert.equal((await owner('select has_table_privilege($1,$2,$3) ok', [role, 'private.' + t, 'select']))[0].ok, false, role + ' ' + t);
  }
  for (const f of ['workspace_package_read(uuid)', 'workspace_package_action(jsonb)']) assert.equal((await owner('select has_function_privilege($1,$2,$3) ok', ['anon', 'public.' + f, 'execute']))[0].ok, false);
});

test('the default wording matches the app, and only admins change it', async () => {
  const [d] = await owner('select private.workspace_package_settings_default() s');
  assert.deepEqual(P.packageSettingsSchema.parse(d.s), P.DEFAULT_PACKAGE_SETTINGS);
  await as(STAYS);
  await refused(rpc('workspace_package_action', [{ action: 'saveSettings', requestId: crypto.randomUUID(), settings: P.DEFAULT_PACKAGE_SETTINGS }]), /Only admins/);
  await as(ADMIN);
  const changed = { ...P.DEFAULT_PACKAGE_SETTINGS, broadband: { ...P.DEFAULT_PACKAGE_SETTINGS.broadband, priceMinor: 6000 } };
  const v = P.packageViewSchema.parse(await rpc('workspace_package_action', [{ action: 'saveSettings', requestId: crypto.randomUUID(), settings: changed }]));
  assert.equal(v.settings.broadband.priceMinor, 6000);
  assert.equal(v.canEditSettings, true);
  assert.equal(v.updatedByName, 'Morag');
  await refused(rpc('workspace_package_action', [{ action: 'saveSettings', requestId: crypto.randomUUID(), settings: { ...changed, setUp: { ...changed.setUp, question: '' } } }]), /Write the question/);
  await refused(rpc('workspace_package_action', [{ action: 'saveSettings', requestId: crypto.randomUUID(), settings: { ...changed, waste: { ...changed.waste, monthlyMinor: -1 } } }]), /Enter each price/);
  await rpc('workspace_package_action', [{ action: 'saveSettings', requestId: crypto.randomUUID(), settings: P.DEFAULT_PACKAGE_SETTINGS }]);
});

test('the owner builds their package before the agreement, and it fills the agreement and the fee', async () => {
  await as(ADMIN);
  await rpc('workspace_onboarding_fee_action', [{ action: 'saveSettings', requestId: crypto.randomUUID(), amountMinor: 49500, remindersOn: false, reminderHours: 48,
    signedMessage: 'Thank you for signing. Your onboarding fee is {{amount}}.', sentMessage: 'Your invoice is ready.', reminderMessage: 'A reminder.', settledMessage: 'Paid, thank you.' }]);
  const early = await (async () => { await as(OWNER); return rpc('workspace_journey_action', [journeyActionSchema.parse({ action: 'createEnquiry', requestId: crypto.randomUUID(), name: 'Early Flat', address: '1 Early Road\nLeith, Edinburgh EH6 6RG', propertyType: 'Flat', bedrooms: 1, bathrooms: 1 })]); })();
  const v0 = await read(early.propertyId);
  assert.equal(v0.package.canEdit, false, 'not before they go ahead');
  await refused(save(early.propertyId, { setUp: 'self' }), /can be changed until the agreement is signed/);

  const prop = await proceeded();
  let v = await read(prop);
  assert.equal(v.package.canEdit, true);
  assert.equal(v.package.submittedAt, null);
  assert.equal(v.baseMinor, 49500);
  await refused(publish(prop), /not finished their onboarding package/);
  await refused(save(prop, { setUp: 'recharge' }, { submit: true }), /Answer every part first/);

  v = await save(prop, { setUp: 'recharge' });
  assert.equal(v.package.answers.setUp, 'recharge');
  assert.equal(v.package.submittedAt, null);
  await as(OTHER); await refused(rpc('workspace_package_read', [prop]), /Property not found/);
  await refused(save(prop, ALL, { bank: BANK, submit: true }, OTHER), /Property not found/);
  await refused(save(prop, { ...ALL }, { bank: { ...BANK, accountNumber: '1234' } }), /./);

  v = await save(prop, ALL, { bank: BANK, submit: true });
  assert.ok(v.package.submittedAt);
  assert.deepEqual(v.package.bank, { accountName: 'Olive Owner Lettings', sortCode: '12-34-56', last4: '5678' });
  assert.ok(!JSON.stringify(v).includes('12345678'), 'the full account number never comes back');
  await said(/Onboarding package completed/);
  assert.equal(await notified(ADMIN, 'enquiry.package_submitted') + await notified(STAYS, 'enquiry.package_submitted') > 0, true, 'the team hears');

  const team = await read(prop, STAYS);
  assert.equal(team.package.bank, null, 'payout details stay with the owner, admins and accounts');
  assert.equal((await read(prop, ACCOUNTS)).package.bank.last4, '5678');
  const lines = P.packageLines(v.settings, v.package.answers, v.baseMinor);
  const s = P.DEFAULT_PACKAGE_SETTINGS;
  assert.equal(lines.extrasMinor, s.broadband.priceMinor + 2 * s.compliance.priceMinor);
  assert.equal(lines.totalMinor, 49500 + lines.extrasMinor);

  const [values] = await owner('select private.workspace_package_agreement_values($1) v', [prop]);
  assert.equal(values.v['operator name'], 'Olive Owner Lettings Ltd');
  assert.equal(values.v['payout account ending'], '5678');
  assert.equal(values.v['repair limit'], '£250.00 per repair');
  const [brief] = await owner('select private.workspace_package_brief($1) b', [prop]);
  assert.ok(brief.b.submittedAt);
  assert.ok(!('operatorName' in brief.b.answers));

  await publish(prop);
  await journey(OWNER, prop, { action: 'signAgreement', agreementRevision: 1, signedName: 'Olive Owner', consent: true });
  const [fee] = await owner('select i.amount_minor from private.workspace_onboarding_fees f join private.workspace_hub_items i on i.id=f.item_id where f.property_id=$1', [prop]);
  assert.equal(Number(fee.amount_minor), lines.totalMinor, 'the fee is the included fee plus the extras chosen');
  assert.equal((await read(prop)).package.canEdit, false, 'locked once signed');
  await refused(save(prop, ALL), /can be changed until the agreement is signed/);
});

