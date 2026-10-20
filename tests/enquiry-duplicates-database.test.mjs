import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Client enquiries (migration 20261020800000, Lee and Alex): the form no longer asks for a correspondence address or "Are you
// an existing client?"; a returned form is a possible duplicate when its email is an owner's, or its email or phone matches
// another open enquiry (beside the same address, as before); and the people told it is back also hear it may be a duplicate.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { teamsActionSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { enquiryAnswersSchema, clientEnquiriesSchema, duplicateNote } = await vite.ssrLoadModule('/lib/client-enquiry.ts');
const { noticeCopy } = await vite.ssrLoadModule('/lib/notice-copy.ts');
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const MIGRATION = '20261020800000_enquiry_duplicates.sql';
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const roles = ['super_admin', 'admin', 'stays', 'cleans', 'client', 'client', 'client'];
const users = roles.map((_, i) => `97720000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, STAYS, CLEANER, OWNER, NEW_OWNER, GONE_OWNER] = roles.map((_, i) => i);
const emails = ['super@example.com', 'admin@example.com', 'stays@example.com', 'cleaner@example.com', 'Rose.Owner@Example.com', 'new.owner@example.com', 'gone@example.com'];
const session = i => users[i].replace('9772', '9872');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], emails[i]]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status=$4,role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], ['Sam', 'Morag', 'Fiona', 'Isla', 'Rose', 'Neil', 'Gail'][i], i === GONE_OWNER ? 'revoked' : 'active']);
  await db.query('insert into private.workspace_onboarding_done(user_id) values($1) on conflict do nothing', [users[i]]);
}
await db.query("insert into public.workspace_module_grants(user_id,module_id) values($1,'property-onboarding')", [users[STAYS]]);
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
async function asServer() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); await db.exec('set role service_role'); }
const owner = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const read = async () => clientEnquiriesSchema.parse(await rpc('workspace_teams_read', ['clientEnquiries', null, null, null, null]));
const hash = token => createHash('sha256').update(token).digest('hex');
const token = () => createHash('sha256').update(crypto.randomUUID()).digest('hex');
const pub = input => rpc('workspace_enquiry_public', [input]);
// A new form: no correspondence address, no "existing client".
const ANSWERS = enquiryAnswersSchema.parse({
  fullName: 'Alex Morgan', email: 'alex@example.com', phone: '07700 900123',
  propertyAddress: '12 Shore Road, Leith, Edinburgh EH6 6RG', propertyType: 'Flat', bedrooms: 2, wcs: 1, bathrooms: 1,
  shortLet: 'no', furnishQuote: 'yes', compliance: 'yes', startWhen: 'As soon as possible', enquiryType: "I'd like a free performance estimate",
});
let places = 0;
// The team sends a form to `to` (as `sender`); the landlord answers it. Each form has its own address unless one is given.
async function answered({ sender = ADMIN, to = 'someone@example.com', ...extra } = {}) {
  const t = token();
  await as(sender);
  const input = teamsActionSchema.parse({ action: 'inviteEnquiry', requestId: crypto.randomUUID(), name: 'Alex Morgan', email: to, subject: 'Your free estimate', body: 'Hello {form link}', delivery: 'link' });
  const sent = await rpc('workspace_teams_action', [{ ...input, tokenHash: hash(t) }]);
  await asServer();
  assert.deepEqual(await pub({ action: 'submit', tokenHash: hash(t), answers: { ...ANSWERS, propertyAddress: `${++places} Harbour Lane, Oban PA34 5AA`, ...extra } }), { state: 'answered' });
  const [row] = await owner('select * from private.workspace_client_enquiries where id=$1', [sent.id]);
  return { t, sent, row };
}
const flag = row => [row.duplicate_reason, row.duplicate_of];
const notified = async (i, event) => (await owner('select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.user_id=$1 and a.event_type=$2', [users[i], event]))[0].n;
after(async () => { await db.close(); await vite.close(); });

test('a form without a correspondence address or "existing client" is taken; the other questions are still required', async () => {
  assert.equal('correspondenceAddress' in enquiryAnswersSchema.shape, false);
  assert.equal('existingClient' in enquiryAnswersSchema.shape, false);
  assert.throws(() => enquiryAnswersSchema.parse({ ...ANSWERS, existingClient: 'no' }), /Unrecognized key/, 'the form never sends them');
  const { row } = await answered({ to: 'first@example.com', email: 'first@example.com', phone: '07700 900001' });
  assert.equal(row.status, 'received');
  assert.ok(row.property_id, 'its property is made as before');
  assert.deepEqual(flag(row), ['', null], 'nobody else has these details');
  // A form already open in a browser before the change still sends them; that is accepted too.
  const old = await answered({ to: 'second@example.com', email: 'second@example.com', phone: '07700 900002', correspondenceAddress: '4 Queen Street', existingClient: 'yes' });
  assert.equal(old.row.answers.correspondenceAddress, '4 Queen Street');
  assert.deepEqual(flag(old.row), ['', null], '"existing client" no longer flags a duplicate');
  // Still required: everything else marked with *.
  const t = token();
  await as(ADMIN);
  await rpc('workspace_teams_action', [{ ...teamsActionSchema.parse({ action: 'inviteEnquiry', requestId: crypto.randomUUID(), name: 'X', email: 'x@example.com', subject: 'S', body: 'B', delivery: 'link' }), tokenHash: hash(t) }]);
  await asServer();
  const { phone: _phone, ...noPhone } = ANSWERS; void _phone;
  await assert.rejects(pub({ action: 'submit', tokenHash: hash(t), answers: noPhone }), /marked with \*/);
  await assert.rejects(pub({ action: 'submit', tokenHash: hash(t), answers: { ...ANSWERS, admin: true } }), /./, 'no other keys');
});

test('an owner\'s email flags a possible duplicate, with one of their properties', async () => {
  const [{ id: home }] = await owner("insert into public.workspace_properties(name,address,created_by,request_id,status) values('Rose Cottage','1 Kelso Road, Kelso TD5 7AA',$1,gen_random_uuid(),'active') returning id", [users[ADMIN]]);
  await owner("insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values($1,$2,'client',$3)", [home, users[OWNER], users[ADMIN]]);
  // Their answer, in any case.
  const byAnswer = await answered({ to: 'someone.else@example.com', email: 'rose.owner@example.COM', phone: '07700 900010' });
  assert.deepEqual(flag(byAnswer.row), ['existing_owner', home]);
  // Or the address the team sent the form to.
  const bySend = await answered({ to: 'rose.owner@example.com', email: 'rose.private@example.com', phone: '07700 900011' });
  assert.deepEqual(flag(bySend.row), ['existing_owner', home]);
  // An owner with no property yet is still an owner; a revoked one is not.
  const fresh = await answered({ to: 'n@example.com', email: emails[NEW_OWNER], phone: '07700 900012' });
  assert.deepEqual(flag(fresh.row), ['existing_owner', null]);
  const gone = await answered({ to: 'g@example.com', email: 'gone@example.com', phone: '07700 900013' });
  assert.deepEqual(flag(gone.row), ['', null]);
  // A team member's email is not an owner's.
  const staff = await answered({ to: 's@example.com', email: 'stays@example.com', phone: '07700 900014' });
  assert.deepEqual(flag(staff.row), ['', null]);
  // The team reads why.
  await as(ADMIN);
  const view = (await read()).items.find(e => e.id === byAnswer.sent.id);
  assert.deepEqual([view.duplicateReason, view.duplicateOf, view.duplicateOfName], ['existing_owner', home, 'Rose Cottage']);
  assert.equal(duplicateNote(view), 'Their email matches the owner of Rose Cottage. Check their other properties before valuing.');
  assert.equal(duplicateNote({ duplicateReason: 'existing_owner', duplicateOfName: null }), 'Their email matches an owner we already work with. Check their other properties before valuing.');
});

test('the same email or phone as another open enquiry flags it, with that enquiry\'s property; the same address still comes first', async () => {
  const first = await answered({ to: 'jo@example.com', email: 'jo@example.com', phone: '07700 900020' });
  assert.deepEqual(flag(first.row), ['', null]);
  // The same email, written differently.
  const email = await answered({ to: 'other@example.com', email: 'JO@Example.com', phone: '07700 900021' });
  assert.deepEqual(flag(email.row), ['same_contact', first.row.property_id]);
  // The same phone, written the international way.
  const phone = await answered({ to: 'p@example.com', email: 'p@example.com', phone: '+44 (0)7700 900020' });
  assert.deepEqual(flag(phone.row), ['same_contact', first.row.property_id]);
  const plus = await answered({ to: 'q@example.com', email: 'q@example.com', phone: '+447700900020' });
  assert.deepEqual(flag(plus.row), ['same_contact', first.row.property_id]);
  // Its own email and phone never count, and nor does a closed enquiry.
  const lone = await answered({ to: 'lone@example.com', email: 'lone@example.com', phone: '07700 900030' });
  assert.deepEqual(flag(lone.row), ['', null]);
  await as(ADMIN);
  await rpc('workspace_teams_action', [teamsActionSchema.parse({ action: 'closeEnquiry', requestId: crypto.randomUUID(), enquiryId: lone.sent.id, version: lone.row.version, note: 'Not going ahead' })]);
  const after = await answered({ to: 'lone2@example.com', email: 'lone2@example.com', phone: '07700 900030' });
  assert.deepEqual(flag(after.row), ['', null], 'only enquiries still open count');
  // The same address as a property in use still wins, with that property.
  const [{ id: place }] = await owner("insert into public.workspace_properties(name,address,created_by,request_id,status) values('Cramond flat','7 Cramond Glebe Road, Edinburgh EH4 6NS',$1,gen_random_uuid(),'active') returning id", [users[ADMIN]]);
  const both = await answered({ to: 'jo@example.com', email: 'jo@example.com', phone: '07700 900020', propertyAddress: '7 cramond glebe road edinburgh eh46ns' });
  assert.deepEqual(flag(both.row), ['same_address', place]);
  // The team reads why.
  await as(ADMIN);
  const view = (await read()).items.find(e => e.id === email.sent.id);
  assert.equal(view.duplicateReason, 'same_contact');
  assert.equal(duplicateNote(view), `Same email or phone as the enquiry for ${view.duplicateOfName}. Check before valuing; close one of them if it is the same place.`);
});

test('phone numbers compare by their digits, with +44 read as 0', async () => {
  const key = async phone => (await owner('select private.workspace_phone_key($1) k', [phone]))[0].k;
  for (const phone of ['07700 900123', '07700-900-123', '(07700) 900123', '+44 7700 900123', '+44 (0)7700 900123', '0044 7700 900123', '447700900123']) assert.equal(await key(phone), '07700900123', phone);
  assert.equal(await key('0131 496 0000'), '01314960000');
  assert.equal(await key('12345'), null, 'too short to compare');
  assert.equal(await key(null), null);
});

test('a possible duplicate tells the same people as the form coming back; a form that is not one tells nobody twice', async () => {
  const count = async () => Object.fromEntries(await Promise.all([SUPER, ADMIN, STAYS, CLEANER, OWNER].map(async i => [i, await notified(i, 'enquiry.duplicate')])));
  const before = await count();
  await answered({ sender: STAYS, to: 'ann@example.com', email: 'ann@example.com', phone: '07700 900040' });
  assert.deepEqual(await count(), before, 'not a duplicate: no notice');
  const received = await notified(STAYS, 'enquiry.received');
  await answered({ sender: STAYS, to: 'ann2@example.com', email: 'ann@example.com', phone: '07700 900041' });
  const now = await count();
  assert.equal(now[STAYS] - before[STAYS], 1, 'the person who sent the form');
  assert.equal(now[ADMIN] - before[ADMIN], 1, 'the admins');
  assert.equal(now[SUPER] - before[SUPER], 1, 'and super admins');
  assert.equal(now[CLEANER], before[CLEANER]);
  assert.equal(now[OWNER], before[OWNER], 'never an owner');
  assert.equal(await notified(STAYS, 'enquiry.received'), received + 1, 'beside the usual notice');
  const [a] = await owner("select actor_id,property_id from public.workspace_activity where event_type='enquiry.duplicate' order by id desc limit 1");
  assert.deepEqual(a, { actor_id: null, property_id: null }, 'like enquiry.received: no property, so who reads it does not change');
  // The wording: in the app, by email and on a phone.
  const copy = noticeCopy('enquiry.duplicate');
  assert.equal(copy.title, 'An enquiry may be a duplicate');
  assert.match(copy.message, /^A returned enquiry form matches a property at the same address, an owner we already work with, or another enquiry\. Check it in Leads before valuing\. Sign in/);
  assert.doesNotMatch(copy.title + copy.message, /—/);
});

test('enquiries answered before the change still read in full, with their old answers and reason', async () => {
  const t = token();
  await as(ADMIN);
  const sent = await rpc('workspace_teams_action', [{ ...teamsActionSchema.parse({ action: 'inviteEnquiry', requestId: crypto.randomUUID(), name: 'Old', email: 'old@example.com', subject: 'Estimate', body: 'Hi', delivery: 'link' }), tokenHash: hash(t) }]);
  const oldAnswers = { ...ANSWERS, email: 'old@example.com', phone: '07700 900050', correspondenceAddress: '4 Queen Street\nEdinburgh EH2 1JE', existingClient: 'yes' };
  await owner("update private.workspace_client_enquiries set status='received',answers=$2,submitted_at=now(),duplicate_reason='existing_client' where id=$1", [sent.id, JSON.stringify(oldAnswers)]);
  await as(ADMIN);
  const back = (await read()).items.find(e => e.id === sent.id);
  assert.equal(back.answers.correspondenceAddress, '4 Queen Street\nEdinburgh EH2 1JE');
  assert.equal(back.answers.existingClient, 'yes');
  assert.equal(back.duplicateReason, 'existing_client');
  assert.equal(duplicateNote(back), 'They said they already work with us. Check their other properties before valuing.');
});

test('the migration runs twice without change', async () => {
  const fns = ['private.workspace_enquiry_public(jsonb)', 'private.workspace_enquiry_create_property(uuid)', 'private.workspace_enquiry_contact_duplicate(uuid)', 'private.workspace_phone_key(text)'];
  const state = async () => ({
    defs: await Promise.all(fns.map(async f => (await owner('select pg_get_functiondef($1::regprocedure) d', [f]))[0].d)),
    check: (await owner("select pg_get_constraintdef(oid) d from pg_constraint where conrelid='private.workspace_client_enquiries'::regclass and conname='workspace_client_enquiries_duplicate_reason'"))[0].d,
  });
  const before = await state();
  for (const f of fns.slice(0, 2)) assert.equal((before.defs[fns.indexOf(f)].match(/workspace_enquiry_contact_duplicate|'enquiry\.duplicate'/g) ?? []).length, 1, f + ' patched once');
  assert.doesNotMatch(before.defs[1], /then 'existing_client'/, '"existing client" no longer sets the reason');
  assert.match(before.check, /existing_owner.*same_contact.*existing_client/);
  await db.exec('reset role');
  await db.exec(await fs.readFile('supabase/migrations/' + MIGRATION, 'utf8'));
  assert.deepEqual(await state(), before);
  // Still works after the second run.
  const { row } = await answered({ to: 'twice@example.com', email: 'jo@example.com', phone: '07700 900060' });
  assert.equal(row.duplicate_reason, 'same_contact');
  // Nobody signed in can call the new functions directly.
  await as(ADMIN);
  await assert.rejects(db.query('select private.workspace_enquiry_contact_duplicate($1)', [row.id]), /permission denied/);
});
