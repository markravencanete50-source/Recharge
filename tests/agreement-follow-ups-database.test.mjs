import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Agreement follow-ups (Business Plan v1.0, Phase 1; migration 20261027200000): once the agreement is sent, Recharge follows up
// by itself (automatic messages in the owner's conversation and by email, personal follow-ups ticked by the team) until the
// owner signs or replies; with no answer after the last step the onboarding is archived. The steps are an admin setting.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { journeyActionSchema } = await vite.ssrLoadModule('/lib/journey-policy.ts');
const F = await vite.ssrLoadModule('/lib/agreement-follow-ups.ts');
const MIGRATION = 'supabase/migrations/20261027200000_agreement_follow_ups.sql';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const roles = ['super_admin', 'admin', 'stays', 'client', 'client'];
const names = ['Sam', 'Morag', 'Fiona', 'Olive Owner', 'Other Owner'];
const users = roles.map((_, i) => `97740000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, STAYS, OWNER, OTHER] = roles.map((_, i) => i);
const session = i => users[i].replace('9774', '9874');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `fu${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], names[i]]);
  await db.query('insert into private.workspace_onboarding_done(user_id) values($1) on conflict do nothing', [users[i]]);
}
for (const i of [STAYS, OWNER, OTHER]) await db.query("insert into public.workspace_module_grants(user_id,module_id) values($1,'property-onboarding')", [users[i]]);
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
const owner = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const refused = async (promise, pattern) => assert.rejects(promise, error => pattern.test(error.message));
const sweep = async at => { await db.exec('reset role'); return (await db.query('select private.workspace_agreement_followup_sweep($1) r', [at])).rows[0].r; };
const read = async (prop, i = ADMIN) => { await as(i); return F.followUpViewSchema.parse(await rpc('workspace_agreement_followup_read', [prop])); };
const act = async (input, i = ADMIN) => { await as(i); return F.followUpViewSchema.parse(await rpc('workspace_agreement_followup_action', [F.followUpActionSchema.parse({ requestId: crypto.randomUUID(), ...input })])); };
const row = async prop => (await owner('select * from private.workspace_agreement_followups where property_id=$1', [prop]))[0];
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
const sentAt = async prop => (await owner("select max(created_at) t from public.workspace_activity where property_id=$1 and event_type='journey.publishAgreement'", [prop]))[0].t;
const ownerMessages = async (who = OWNER) => owner("select m.body,m.author_id from private.chat_messages m join private.chat_conversations c on c.id=m.conversation_id where c.kind='owner' and c.owner_id=$1 and m.kind='text' order by m.created_at", [users[who]]);

test('the migration runs twice and keeps one settings row with the plan\'s default steps', async () => {
  await db.exec('reset role');
  // Run twice, with the migrations after it run again too (a later one may replace a function this one defines).
  for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql') && 'supabase/migrations/' + f >= MIGRATION).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
  const [{ n, steps, archive }] = await owner('select count(*)::int n,max(steps::text)::jsonb steps,max(archive_after_hours) archive from private.workspace_followup_settings');
  assert.equal(n, 1);
  assert.deepEqual(steps.map(s => [s.kind, s.afterHours]), F.DEFAULT_FOLLOW_UP_STEPS.map(s => [s.kind, s.afterHours]), 'the app shows the same defaults');
  assert.equal(archive, 168);
  for (const i of [OWNER, OTHER]) { await as(i); await refused(rpc('workspace_agreement_followup_read', [null]), /Client enquiries access required/); }
  await as(ADMIN);
  await refused(db.query('select private.workspace_agreement_followup_sweep()'), /permission denied/);
  await refused(db.query('select * from private.workspace_agreement_followups'), /permission denied/);
});

test('automatic follow-ups go in the app and by email; personal ones need all four ticks; no answer archives', async () => {
  const prop = await sent();
  const start = await sentAt(prop);
  assert.equal((await sweep(hours(start, 1))).started, 1);
  let f = await row(prop);
  assert.equal(f.status, 'running');
  assert.equal(f.step, 0);
  assert.equal(new Date(f.due_at).getTime(), hours(start, 24).getTime(), 'the first follow-up a day after the agreement was sent');
  assert.equal((await sweep(hours(start, 23))).sent, 0);

  assert.equal((await sweep(hours(start, 24))).sent, 1);
  const [msg] = await ownerMessages();
  assert.match(msg.body, /^Hi Olive, have you had a chance to review your estimate and the management agreement for Harbour Flat\?/);
  assert.equal(msg.author_id, users[ADMIN], 'from whoever sent the agreement');
  const [mail] = await owner('select o.to_address,o.subject,o.body from private.workspace_email_outbox o join private.chat_messages m on m.id=o.chat_message_id where m.body=$1', [msg.body]);
  assert.deepEqual([mail.to_address, mail.subject], [`fu${OWNER}@example.com`, 'Your management agreement for Harbour Flat']);
  assert.equal((await sweep(hours(start, 25))).sent, 0, 'once');

  // The personal follow-up: due a day later, the team is told once, and it moves on only when all four are ticked.
  let r = await sweep(hours(start, 48));
  assert.equal(r.personalDue, 1);
  assert.equal((await sweep(hours(start, 49))).personalDue, 0, 'told once');
  const told = await owner("select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where a.property_id=$1 and a.event_type='enquiry.follow_up_due' and o.user_id=$2", [prop, users[ADMIN]]);
  assert.equal(told[0].n, 1, 'whoever published the agreement hears about it');
  for (const channel of ['chat', 'email', 'whatsapp']) assert.equal((await act({ action: 'confirm', propertyId: prop, channel }, STAYS)).followUp.step, 1);
  await refused(act({ action: 'confirm', propertyId: prop, channel: 'email' }, STAYS), /already ticked/);
  let v = await act({ action: 'confirm', propertyId: prop, channel: 'phone' });
  assert.equal(v.followUp.step, 2);
  assert.deepEqual(v.followUp.checks, {});
  await refused(act({ action: 'confirm', propertyId: prop, channel: 'phone' }), /no personal follow-up to tick/);

  // Fast forward: every remaining step, then the archive a week after the last one.
  for (let i = 0; i < 4; i++) {
    f = await row(prop);
    r = await sweep(f.due_at);
    if ((await row(prop)).plan[f.step].kind === 'personal') for (const channel of ['chat', 'email', 'whatsapp', 'phone']) await act({ action: 'confirm', propertyId: prop, channel });
  }
  f = await row(prop);
  assert.equal(f.step, 6);
  assert.equal((await ownerMessages()).length, 4, 'four automatic follow-ups');
  assert.equal((await sweep(hours(f.due_at, -1))).archived, 0);
  assert.equal((await sweep(f.due_at)).archived, 1);
  assert.equal((await row(prop)).status, 'archived');
  const [{ stage }] = await owner('select stage from private.workspace_journeys where property_id=$1', [prop]);
  assert.equal(stage, 'archived');
  const [{ status }] = await owner('select status from public.workspace_properties where id=$1', [prop]);
  assert.equal(status, 'archived');
  const notes = await owner("select a.body from private.workspace_lead_activity a join private.workspace_client_enquiries e on e.id=a.enquiry_id where e.property_id=$1 order by a.created_at,a.id", [prop]);
  assert.ok(notes.length >= 5, 'every step is on the lead');
  assert.match(notes.at(-1).body, /archived/);
  assert.deepEqual(await sweep(hours(f.due_at, 1)), { started: 0, sent: 0, personalDue: 0, stopped: 0, archived: 0 }, 'nothing more to do');
});

test('a reply from the owner stops the automatic messages; the team can stop and resume them; signing ends them', async () => {
  const prop = await sent(OTHER, 'Garden Cottage');
  const start = await sentAt(prop);
  await sweep(hours(start, 1));
  await sweep(hours(start, 24));
  assert.equal((await ownerMessages(OTHER)).length, 1);
  // The owner replies in the app.
  await owner("insert into private.chat_messages(conversation_id,author_id,body,request_id,created_at) select c.id,$1,'Sorry, still reading it',gen_random_uuid(),$2 from private.chat_conversations c where c.kind='owner' and c.owner_id=$1", [users[OTHER], hours(start, 30)]);
  assert.equal((await sweep(hours(start, 31))).stopped, 1);
  let v = await read(prop);
  assert.equal(v.followUp.status, 'stopped');
  assert.equal(v.followUp.reason, 'The owner replied');
  await sweep(hours(start, 300));
  assert.equal((await ownerMessages(OTHER)).length, 2, 'no more automatic messages (the owner\'s reply is the second)');

  v = await act({ action: 'resume', propertyId: prop });
  assert.equal(v.followUp.status, 'running');
  await refused(act({ action: 'resume', propertyId: prop }), /not stopped/);
  v = await act({ action: 'stop', propertyId: prop, note: 'Owner asked us to wait until Friday' }, STAYS);
  assert.equal(v.followUp.reason, 'Owner asked us to wait until Friday');
  await act({ action: 'resume', propertyId: prop });

  await journey(OTHER, prop, { action: 'signAgreement', agreementRevision: 1, signedName: 'Other Owner', consent: true });
  await sweep(new Date());
  assert.equal((await row(prop)).status, 'signed');
});

test('publishing the agreement again starts the sequence again', async () => {
  const prop = await sent(OWNER, 'Loft');
  await sweep(new Date());
  await owner("update private.workspace_agreement_followups set step=3 where property_id=$1", [prop]);
  await journey(ADMIN, prop, { action: 'publishAgreement', agreement: 'This management agreement is between Recharge and the owner, revised.' });
  assert.equal((await sweep(new Date())).started, 1);
  const f = await row(prop);
  assert.equal(f.revision, 2);
  assert.equal(f.step, 0);
});

test('admins change the steps; new sequences use them, running ones keep theirs', async () => {
  const steps = [{ kind: 'auto', afterHours: 12, message: 'Hello {first_name}, a reminder about {property}.' }, { kind: 'personal', afterHours: 24 }];
  await as(STAYS);
  await refused(rpc('workspace_agreement_followup_action', [{ action: 'saveSettings', requestId: crypto.randomUUID(), steps, archiveAfterHours: 72 }]), /Only admins/);
  await as(ADMIN);
  await refused(rpc('workspace_agreement_followup_action', [{ action: 'saveSettings', requestId: crypto.randomUUID(), steps: [{ kind: 'personal', afterHours: 24 }], archiveAfterHours: 72 }]), /at least one automatic/);
  await refused(rpc('workspace_agreement_followup_action', [{ action: 'saveSettings', requestId: crypto.randomUUID(), steps: [{ kind: 'auto', afterHours: 12 }], archiveAfterHours: 72 }]), /Write the message/);
  await refused(rpc('workspace_agreement_followup_action', [{ action: 'saveSettings', requestId: crypto.randomUUID(), steps: [{ kind: 'auto', afterHours: 0, message: 'x' }], archiveAfterHours: 72 }]), /between 1 hour and 90 days/);
  const v = await act({ action: 'saveSettings', steps, archiveAfterHours: 72 }, SUPER);
  assert.equal(v.settings.steps.length, 2);
  assert.equal(v.settings.updatedByName, 'Sam');
  const prop = await sent(OWNER, 'Studio');
  await sweep(new Date());
  const f = await row(prop);
  assert.equal(f.plan.length, 2);
  assert.equal(f.archive_after_hours, 72);
  assert.equal(F.followUpSettingsActionSchema.safeParse({ action: 'saveSettings', requestId: crypto.randomUUID(), steps: [], archiveAfterHours: 1 }).success, false);
});
