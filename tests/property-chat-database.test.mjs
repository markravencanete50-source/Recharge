import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';


// Property group chat (Business Plan v1.0, Phase 1; migration 20261027400000): each property with an owner gets its own chat in
// the Inbox, named by its address. Team messages there are emailed to the owner and replies come back to it; the automatic
// messages and the onboarding milestones are posted there.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { journeyActionSchema } = await vite.ssrLoadModule('/lib/journey-policy.ts');
const F = await vite.ssrLoadModule('/lib/onboarding-fee.ts');
const MIGRATION = 'supabase/migrations/20261027400000_property_chat.sql';
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
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `pc${i}@example.com`]);
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
const mails = async (who = OWNER) => owner("select o.subject,o.body from private.workspace_email_outbox o where o.to_address=$1 order by o.created_at", [`pc${who}@example.com`]);
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
  await journey(ADMIN, prop, { action: 'publishAgreement', agreement: 'This management agreement is between Recharge and the owner.' });
  return prop;
}
async function signed(who = OWNER, name = 'Harbour Flat') {
  let prop; try { prop = await sent(who, name); } catch (e) { console.log('WHERE', e.where); throw e; }
  await journey(who, prop, { action: 'signAgreement', agreementRevision: 1, signedName: names[who], consent: true });
  return prop;
}

const chats = async (who = OWNER) => owner("select c.id,c.property_id from private.chat_conversations c where c.kind='owner' and c.owner_id=$1 order by c.property_id nulls first", [users[who]]);
const chatOf = async prop => (await owner("select id from private.chat_conversations where kind='owner' and property_id=$1", [prop]))[0]?.id;
const inChat = async conv => owner('select m.body,m.kind,m.author_id from private.chat_messages m where m.conversation_id=$1 order by m.created_at,m.id', [conv]);
const chatRead = async (section, target = null) => (await db.query('select public.workspace_chat_read($1,$2) r', [section, target])).rows[0].r;
const chatAct = async input => (await db.query('select public.workspace_chat_action($1::jsonb) r', [JSON.stringify(input)])).rows[0].r;
const ADDRESS = '8 Shore Road, Leith, Edinburgh EH6 6RG';

test('the migration runs twice; one chat per property', async () => {
  await db.exec('reset role');
  for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql') && 'supabase/migrations/' + f >= MIGRATION).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
  await as(ADMIN);
  for (const fn of ['workspace_property_chat(null)', 'workspace_property_chat_post(null,null,null,null,null)', 'workspace_property_label(null)'])
    await refused(db.query('select private.' + fn), /permission denied/);
});

test("an owner's enquiry opens a chat named by the address, beside their general conversation", async () => {
  await as(OWNER);
  const general = await chatAct({ action: 'startOwner' });
  const created = await rpc('workspace_journey_action', [journeyActionSchema.parse({ action: 'createEnquiry', requestId: crypto.randomUUID(), name: 'Harbour Flat', address: '8 Shore Road\nLeith, Edinburgh EH6 6RG', propertyType: 'Flat', bedrooms: 2, bathrooms: 1 })]);
  const prop = created.propertyId;
  const conv = await chatOf(prop);
  assert.ok(conv, 'opened with the enquiry');
  assert.deepEqual((await chats()).map(c => c.property_id), [null, prop]);
  await as(OWNER);
  assert.equal((await chatAct({ action: 'startOwner' })).id, general.id, 'Message Recharge still opens the general conversation');
  const mine = (await chatRead('list')).find(c => c.id === conv);
  assert.equal(mine.title, ADDRESS);
  assert.equal(mine.subtitle, 'Recharge team');
  assert.equal(mine.ownerView, true);
  assert.deepEqual(mine.propertyIds, [prop]);
  await as(ADMIN);
  const theirs = (await chatRead('list')).find(c => c.id === conv);
  assert.equal(theirs.title, ADDRESS);
  assert.equal(theirs.subtitle, 'Olive Owner');
  assert.equal(theirs.ownerView, false);
  assert.equal((await chatAct({ action: 'startOwner', ownerId: users[OWNER] })).id, general.id);
  await as(OTHER);
  await refused(chatRead('messages', conv), /not found/);

  // The milestones are noted as updates; the estimate is the first.
  await journey(ADMIN, prop, { action: 'publishEstimate', lowRateMinor: 9000, mediumRateMinor: 11000, highRateMinor: 14000, comparables: [], managementFeeBps: 1800, otaFeeBps: 1500 });
  assert.deepEqual((await inChat(conv)).map(m => [m.kind, m.body]), [['event', 'Your estimate has been sent. You can read it in the app.']]);
  assert.equal((await mails()).length, 0, 'updates are not emailed');

  // A message from the team in the property chat is emailed to the owner, about the property.
  await as(ADMIN);
  await chatAct({ action: 'send', requestId: crypto.randomUUID(), conversationId: conv, body: 'We have a few questions about parking.' });
  assert.deepEqual((await mails()).map(m => [m.subject, m.body]), [['Update on ' + ADDRESS, 'We have a few questions about parking.']]);
  // The owner answers that email: the reply lands back in the property chat. Any other email goes to the general conversation.
  // Sent as the live sender does: the outbox row is marked sent and recorded with its message id.
  const [{ id: outId }] = await owner('select id from private.workspace_email_outbox where to_address=$1 order by created_at desc limit 1', ['pc3@example.com']);
  await owner('select private.workspace_email_outbox_result($1)', [{ id: outId, ok: true, messageId: '<out-1@mail.recharge.example>' }]);
  await owner("select private.workspace_email_owner_post($1,'pc_in_1',$2,now(),'{}'::jsonb,'pc3@example.com','Re: Update','in-1@mail.example.com','out-1@mail.recharge.example','{out-1@mail.recharge.example}')", [users[OWNER], 'Subject: Re: Update\n\nThere is a space at the back.']);
  assert.ok((await inChat(conv)).some(m => /space at the back/.test(m.body)), 'the reply is in the property chat');
  await owner("select private.workspace_email_owner_post($1,'pc_in_2',$2,now(),'{}'::jsonb,'pc3@example.com','Boiler','in-2@mail.example.com',null,'{}')", [users[OWNER], 'Subject: Boiler\n\nThe boiler is noisy.']);
  assert.ok((await inChat(general.id)).some(m => /boiler is noisy/.test(m.body)), 'a new email goes to the general conversation');
  assert.ok(!(await inChat(conv)).some(m => /boiler is noisy/.test(m.body)));
});

test('the follow-ups and the fee messages go to the property chat, with each milestone', async () => {
  await as(SUPER);
  const s = F.feeViewSchema.parse(await rpc('workspace_onboarding_fee_read', [null])).settings;
  await rpc('workspace_onboarding_fee_action', [{ action: 'saveSettings', requestId: crypto.randomUUID(), amountMinor: 49500, remindersOn: true, reminderHours: 48,
    signedMessage: s.signedMessage, sentMessage: s.sentMessage, reminderMessage: s.reminderMessage, settledMessage: s.settledMessage }]);
  const prop = await signed(OTHER, 'Garden Cottage');
  const conv = await chatOf(prop);
  const [general] = await chats(OTHER);
  assert.equal(general.property_id, prop, 'no general conversation is made for them');
  await move(prop, 'sent');
  await journey(OTHER, prop, { action: 'submitForm', form: SETUP });
  await move(prop, 'paid', { settledMinor: 49500 });
  const log = await inChat(conv);
  const texts = log.filter(m => m.kind === 'text').map(m => m.body);
  assert.match(texts[0], /thank you for signing the management agreement for Garden Cottage/);
  assert.ok(texts.some(t => /has been sent for £495\.00/.test(t)));
  assert.ok(texts.some(t => /we have received the onboarding fee for Garden Cottage/.test(t)));
  assert.deepEqual(log.filter(m => m.kind === 'event').map(m => m.body), [
    'Your estimate has been sent. You can read it in the app.',
    'Thank you for going ahead. We are preparing your management agreement.',
    'Your management agreement is ready to read and sign in the app.',
    'Agreement signed. Next: the property set-up form.',
    'Set-up form received. Next: the onboarding fee.',
    'Onboarding fee settled. Next: we book the property inspection.',
  ]);
  assert.ok((await mails(OTHER)).some(m => m.subject === 'Your management agreement for Garden Cottage is signed'), 'the automatic messages are still emailed with their own subjects');
  assert.ok(await notified(OTHER, 'chat.message') >= 3, 'and the owner is notified');
});

test('an owner assigned to an existing property gets its chat', async () => {
  await db.exec('reset role');
  const [{ id: prop }] = await owner("insert into public.workspace_properties(name,address,status,request_id) values('Old Mill','1 Mill Lane','active',gen_random_uuid()) returning id");
  assert.equal(await chatOf(prop), undefined);
  await owner("insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values($1,$2,'client',$3)", [prop, users[OWNER], users[ADMIN]]);
  const conv = await chatOf(prop);
  assert.ok(conv);
  assert.equal((await owner('select count(*)::int n from private.chat_members where conversation_id=$1 and user_id=$2', [conv, users[OWNER]]))[0].n, 1);
});
