import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Round 6, Lee: "we should be able to delete client enquiries" (migration 20261016210000), and then "WE SHOULD BE
// ABLE TO DELETE ENQUIRIES" (20261020210000): admins and super admins only, at any stage up to and including the
// agreement while it is unsigned and the property is not live. The enquiry, its answers, the property it made,
// the journey, estimate, questions, work, to-dos, flags and notices all go in one transaction, the files are
// queued for removal, and the access history keeps who deleted which enquiry, and where.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { teamsActionSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { enquiryAnswersSchema, clientEnquiriesSchema, valuationDraft, canDeleteEnquiry, deleteEnquiryWarning, ENQUIRY_PAST_AGREEMENT } = await vite.ssrLoadModule('/lib/client-enquiry.ts');
const { journeyActionSchema } = await vite.ssrLoadModule('/lib/journey-policy.ts');
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const MIGRATION = '20261020210000_delete_enquiry_through_agreement.sql';
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const roles = ['super_admin', 'admin', 'stays', 'cleans', 'client', 'accounts', 'ready', 'cleaning_manager'];
const users = roles.map((_, i) => `97720000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, STAYS, CLEANER, OWNER, ACCOUNTS, READY, MANAGER] = roles.map((_, i) => i);
const session = i => users[i].replace('9772', '9872');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `ed${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], ['Sam', 'Morag', 'Fiona', 'Isla', 'Owner', 'Graham', 'Ross', 'Kirsty'][i]]);
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
const act = async input => rpc('workspace_teams_action', [teamsActionSchema.parse({ requestId: crypto.randomUUID(), ...input })]);
const read = async () => clientEnquiriesSchema.parse(await rpc('workspace_teams_read', ['clientEnquiries', null, null, null, null]));
const hash = token => createHash('sha256').update(token).digest('hex');
const token = () => createHash('sha256').update(crypto.randomUUID()).digest('hex');
const pub = input => rpc('workspace_enquiry_public', [input]);
const ANSWERS = enquiryAnswersSchema.parse({
  fullName: 'Mark Raven Canete', companyName: 'Optimal', email: 'mark@example.com', phone: '07700 900123',
  propertyAddress: '8 Tinibgan Road, Edinburgh EH6 6RG', propertyType: 'Flat', bedrooms: 2, wcs: 1, bathrooms: 1, parking: '', garden: '', mediaLink: '',
  shortLet: 'no', furnishQuote: 'yes', compliance: 'yes', startWhen: 'Within a month', notes: '', enquiryType: "I'd like a free performance estimate",
});
// A form sent by the admin; `answer` has the landlord submit it (with two photos), which makes the property.
async function enquiry({ answer = true, open = false } = {}) {
  const t = token();
  await as(ADMIN);
  const input = teamsActionSchema.parse({ action: 'inviteEnquiry', requestId: crypto.randomUUID(), name: 'Mark Raven Canete', email: 'mark@example.com', subject: 'Your free estimate', body: 'Hello {form link}', delivery: 'link' });
  const sent = await rpc('workspace_teams_action', [{ ...input, tokenHash: hash(t) }]);
  await asServer();
  if (open || answer) await pub({ action: 'open', tokenHash: hash(t) });
  const paths = [];
  if (answer) {
    for (const ext of ['jpg', 'mp4']) {
      const path = `enquiries/${sent.id}/${crypto.randomUUID()}.${ext}`;
      paths.push(path);
      await pub({ action: 'addFile', tokenHash: hash(t), file: { id: crypto.randomUUID(), path, name: 'kitchen.' + ext, mime: ext === 'jpg' ? 'image/jpeg' : 'video/mp4', bytes: 2048 } });
    }
    await pub({ action: 'submit', tokenHash: hash(t), answers: ANSWERS });
  }
  const [row] = await owner('select * from private.workspace_client_enquiries where id=$1', [sent.id]);
  const [journey] = row.property_id ? await owner('select * from private.workspace_journeys where property_id=$1', [row.property_id]) : [null];
  return { id: sent.id, row, paths, prop: row.property_id, task: journey?.work_id ?? null };
}
const current = async id => { await as(ADMIN); return (await read()).items.find(e => e.id === id); };
const del = async (i, id) => { const e = await current(id); await as(i); return act({ action: 'deleteEnquiry', enquiryId: id, version: e.version }); };
// Nothing of the enquiry is left: no enquiry, property, journey, work item, access to it, activity or notices.
async function gone({ id, prop, task }) {
  const [n] = await owner(`select (select count(*) from private.workspace_client_enquiries where id=$1)::int enquiry,
    (select count(*) from public.workspace_properties where id=$2)::int property, (select count(*) from private.workspace_journeys where property_id=$2)::int journey,
    (select count(*) from public.workspace_work_items where id=$3 or property_id=$2)::int work, (select count(*) from public.workspace_property_assignments where property_id=$2)::int access,
    (select count(*) from public.workspace_activity where property_id=$2 or work_id=$3)::int activity, (select count(*) from private.workspace_notification_outbox where work_id=$3)::int notices,
    (select count(*) from private.workspace_estimate_models where property_id=$2)::int estimate, (select count(*) from private.workspace_journey_questions where property_id=$2)::int questions,
    (select count(*) from private.workspace_hub_items where property_id=$2)::int todos, (select count(*) from private.workspace_management_flags where property_id=$2 or work_id=$3)::int flags,
    (select count(*) from private.workspace_local_events where property_id=$2)::int events`, [id, prop, task]);
  return n;
}
const NONE = { enquiry: 0, property: 0, journey: 0, work: 0, access: 0, activity: 0, notices: 0, estimate: 0, questions: 0, todos: 0, flags: 0, events: 0 };
// The journey's own actions, as the team (with no owner account the team records the owner's steps).
async function journey(prop, input) {
  await as(ADMIN);
  const [j] = await owner('select version from private.workspace_journeys where property_id=$1', [prop]);
  await as(ADMIN);
  return rpc('workspace_journey_action', [journeyActionSchema.parse({ requestId: crypto.randomUUID(), propertyId: prop, version: j.version, ...input })]);
}
const ESTIMATE = { action: 'publishEstimate', lowRateMinor: 9000, mediumRateMinor: 11000, highRateMinor: 14000, comparables: [{ name: 'Shore flat', url: 'https://example.com/1', adrMinor: 12000 }] };
const stageOf = async prop => (await owner('select stage from private.workspace_journeys where property_id=$1', [prop]))[0]?.stage;
// Things the team adds while onboarding: a to-do, a flag on the onboarding item, a question, the estimate model and a local event.
async function extras(e) {
  await as(ADMIN);
  await act({ action: 'saveHubItem', kind: 'todo', title: 'Book the photographer', propertyId: e.prop });
  await act({ action: 'flagForManagement', workId: e.task, title: 'Onboarding: Tinibgan', reason: 'Check the estimate first', source: 'work' });
  await journey(e.prop, { action: 'askQuestion', question: 'When can we visit?' });
  await owner("insert into private.workspace_estimate_models(property_id,assumptions,result,updated_by) values($1,'{}','{}',$2)", [e.prop, users[ADMIN]]);
  await owner("insert into private.workspace_local_events(property_id,name,event_on,source_url,opportunity,created_by) values($1,'Highland Games','2026-11-08','https://example.com/games','Big crowds that weekend',$2)", [e.prop, users[ADMIN]]);
}
after(async () => { await db.close(); await vite.close(); });

test('the button: admins and super admins, while the enquiry has not moved on; the warning', () => {
  for (const role of ['admin', 'super_admin']) assert.equal(canDeleteEnquiry(role, { propertyId: 'p', stage: 'enquiry' }), true, role);
  for (const role of ['stays', 'cleans', 'cleaning_manager', 'ready', 'accounts', 'client']) assert.equal(canDeleteEnquiry(role, { propertyId: 'p', stage: 'enquiry' }), false, role);
  assert.equal(canDeleteEnquiry('admin', { propertyId: null, stage: null }), true, 'not answered yet');
  assert.equal(canDeleteEnquiry('admin', { propertyId: 'p', stage: 'archived' }), true, 'closed');
  for (const stage of ['estimate', 'reviewing', 'agreement']) assert.equal(canDeleteEnquiry('super_admin', { propertyId: 'p', stage }), true, stage);
  for (const stage of ['form', 'invoice', 'inspection_to_book', 'inspection_booked', 'inspection_complete', 'live']) assert.equal(canDeleteEnquiry('admin', { propertyId: 'p', stage }), false, stage);
  assert.equal(deleteEnquiryWarning({ propertyId: null, propertyName: null, stage: null }), 'Delete this enquiry? This removes the enquiry, its answers and photos. This can’t be undone.');
  assert.equal(deleteEnquiryWarning({ propertyId: 'p', propertyName: 'Tinibgan', stage: 'enquiry' }), 'Delete this enquiry? This also removes the onboarding for Tinibgan and its history. This can’t be undone.');
  assert.equal(deleteEnquiryWarning({ propertyId: 'p', propertyName: 'Tinibgan', stage: 'estimate' }), 'Delete this enquiry? This also removes the onboarding for Tinibgan, its estimate and history. This can’t be undone.');
  assert.equal(deleteEnquiryWarning({ propertyId: 'p', propertyName: null, stage: 'agreement' }), 'Delete this enquiry? This also removes the onboarding for the property, its estimate and history. This can’t be undone.');
  assert.equal(ENQUIRY_PAST_AGREEMENT, 'The agreement is signed or the property is live, so this enquiry can no longer be deleted. Archive it instead.');
  for (const text of [deleteEnquiryWarning({ propertyId: 'p', propertyName: 'X', stage: 'estimate' }), ENQUIRY_PAST_AGREEMENT]) assert.doesNotMatch(text, /[—–]/, 'no dashes');
});

test('deletes at each allowed stage, leaving nothing behind', async () => {
  // Sent, and opened, before any answer: just the enquiry.
  for (const options of [{ answer: false }, { answer: false, open: true }]) {
    const e = await enquiry(options);
    const done = await del(ADMIN, e.id);
    assert.deepEqual([done.deleted, done.propertyDeleted, done.paths], [true, false, []]);
    assert.deepEqual(await gone(e), NONE);
  }
  // Answered: the property, its journey and onboarding item, the team's access and the photos.
  const answered = await enquiry();
  assert.ok(answered.prop && answered.task);
  assert.equal((await gone(answered)).access, 1, 'the onboarding team had access');
  assert.ok((await gone(answered)).activity > 0, 'and the property and its item had activity');
  const done = await del(SUPER, answered.id);
  assert.deepEqual([done.propertyDeleted, [...done.paths].sort()], [true, [...answered.paths].sort()]);
  assert.deepEqual(await gone(answered), NONE);
  // Valuing (Start valuing done), and closed (the property archived).
  const valuing = await enquiry();
  await as(ADMIN);
  const back = await current(valuing.id);
  await act({ action: 'startValuing', enquiryId: valuing.id, version: back.version, ...valuationDraft(back.answers) });
  await del(ADMIN, valuing.id);
  assert.deepEqual(await gone(valuing), NONE);
  const closed = await enquiry();
  await act({ action: 'closeEnquiry', enquiryId: closed.id, version: (await current(closed.id)).version, note: 'A test entry' });
  assert.equal((await owner('select status from public.workspace_properties where id=$1', [closed.prop]))[0].status, 'archived');
  await del(ADMIN, closed.id);
  assert.deepEqual(await gone(closed), NONE);
});

test('the files are queued for removal, and only the person who queued them marks them removed', async () => {
  const e = await enquiry();
  await del(ADMIN, e.id);
  const queued = await owner("select path,reason,queued_by,removed_at from private.workspace_storage_removals where path like $1 order by path", [`enquiries/${e.id}/%`]);
  assert.deepEqual(queued.map(q => [q.path, q.reason, q.queued_by, q.removed_at]), [...e.paths].sort().map(path => [path, 'client_enquiry.deleted', users[ADMIN], null]));
  await as(SUPER);
  assert.equal(await rpc('workspace_storage_removed', ['enquiry-files', e.paths]), 0, 'not theirs to mark');
  await as(STAYS);
  await assert.rejects(rpc('workspace_storage_removed', ['enquiry-files', e.paths]), /Only management/);
  await as(ADMIN);
  assert.equal(await rpc('workspace_storage_removed', ['enquiry-files', e.paths]), 2);
  assert.equal(await rpc('workspace_storage_removed', ['enquiry-files', e.paths]), 0, 'once');
  await as(ADMIN);
  await assert.rejects(db.query('select * from private.workspace_storage_removals'), /permission denied/);
});

test('the access history names who deleted which enquiry, without contact details', async () => {
  const e = await enquiry();
  const [{ name }] = await owner('select name from public.workspace_properties where id=$1', [e.prop]);
  await del(ADMIN, e.id);
  const [event] = await owner("select user_id,actor_id,old_access,new_access from public.workspace_access_events where event_type='client_enquiry.deleted' and old_access->>'enquiryId'=$1", [e.id]);
  assert.equal(event.actor_id, users[ADMIN]);
  assert.deepEqual(event.old_access, { enquiryId: e.id, name: 'Mark Raven Canete', company: 'Optimal', address: '8 Tinibgan Road, Edinburgh EH6 6RG', property: name, status: 'received', stage: 'enquiry', propertyDeleted: true });
  // Since the history goes with it, the entry says where; still no email or phone.
  for (const secret of ['mark@example.com', '07700']) assert.ok(!JSON.stringify(event).includes(secret), secret);
});

test('deletes at every stage up to the agreement, with everything onboarding added', async () => {
  const at = {
    'estimate sent': async e => { await journey(e.prop, ESTIMATE); },
    'owner reviewing': async e => { await journey(e.prop, ESTIMATE); await journey(e.prop, { action: 'decideEstimate', decision: 'review', followUpOn: '2026-11-01' }); },
    'agreement, published and unsigned': async e => {
      await journey(e.prop, ESTIMATE); await journey(e.prop, { action: 'decideEstimate', decision: 'proceed' });
      await journey(e.prop, { action: 'publishAgreement', agreement: 'The management agreement supplied by Recharge.' });
    },
    'declined (closed)': async e => { await journey(e.prop, ESTIMATE); await journey(e.prop, { action: 'decideEstimate', decision: 'decline' }); },
    'an owner is linked': async e => { await journey(e.prop, ESTIMATE); await owner("insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values($1,$2,'client',$3)", [e.prop, users[OWNER], users[ADMIN]]); },
  };
  const expected = { 'estimate sent': 'estimate', 'owner reviewing': 'reviewing', 'agreement, published and unsigned': 'agreement', 'declined (closed)': 'archived', 'an owner is linked': 'estimate' };
  for (const [why, moveOn] of Object.entries(at)) {
    const e = await enquiry();
    await moveOn(e);
    await extras(e);
    assert.equal(await stageOf(e.prop), expected[why], why);
    const before = await gone(e);
    for (const k of ['estimate', 'questions', 'todos', 'flags', 'events', 'journey']) assert.ok(before[k] > 0, `${why}: has ${k} before`);
    const done = await del(why === 'owner reviewing' ? SUPER : ADMIN, e.id);
    assert.equal(done.propertyDeleted, true, why);
    assert.deepEqual(await gone(e), NONE, why + ': nothing left');
    const [event] = await owner("select old_access from public.workspace_access_events where event_type='client_enquiry.deleted' and old_access->>'enquiryId'=$1", [e.id]);
    assert.equal(event.old_access.stage, expected[why], why + ': the audit says how far it had gone');
  }
});

test('nothing is left pointing at a deleted property or work item', async () => {
  const e = await enquiry();
  await journey(e.prop, ESTIMATE);
  await extras(e);
  await del(ADMIN, e.id);
  // Every foreign key into the property, its work and the enquiry: no row left over.
  const keys = await owner(`select c.conrelid::regclass::text tbl, a.attname col, c.confrelid::regclass::text ref from pg_constraint c join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
    where c.contype='f' and c.confrelid in ('public.workspace_properties'::regclass,'public.workspace_work_items'::regclass,'private.workspace_client_enquiries'::regclass)`);
  assert.ok(keys.length > 20);
  for (const k of keys) {
    const value = k.ref.endsWith('workspace_properties') ? e.prop : k.ref.endsWith('workspace_work_items') ? e.task : e.id;
    const [{ n }] = await owner(`select count(*)::int n from ${k.tbl} where ${k.col}=$1`, [value]);
    assert.equal(n, 0, `${k.tbl}.${k.col}`);
  }
});

test('refused once signed or live, or when it has money or bookings, and nothing is deleted', async () => {
  const PAST = /The agreement is signed or the property is live, so this enquiry can no longer be deleted\. Archive it instead\./;
  const cases = {
    'the agreement is signed': [PAST, async e => {
      await journey(e.prop, ESTIMATE); await journey(e.prop, { action: 'decideEstimate', decision: 'proceed' });
      await journey(e.prop, { action: 'publishAgreement', agreement: 'The management agreement supplied by Recharge.' });
      // Signing moves the journey on through the shared onboarding flow; the signature alone is enough to refuse.
      await owner("update private.workspace_journeys set signed_name='Mark Raven Canete',signed_at=now() where property_id=$1", [e.prop]);
    }],
    'signed, then closed': [PAST, async e => owner("update private.workspace_journeys set stage='archived',signed_name='Mark Raven Canete',signed_at=now() where property_id=$1", [e.prop])],
    'the property is live': [PAST, async e => { await owner("update private.workspace_journeys set stage='live',signed_name='Mark Raven Canete',signed_at=now() where property_id=$1", [e.prop]); await owner("update public.workspace_properties set status='active' where id=$1", [e.prop]); }],
    'live without a signature on record': [PAST, async e => { await owner("update private.workspace_journeys set stage='live' where property_id=$1", [e.prop]); await owner("update public.workspace_properties set status='active' where id=$1", [e.prop]); }],
    'past the agreement': [PAST, async e => owner("update private.workspace_journeys set stage='form' where property_id=$1", [e.prop])],
    'an invoice': [/This property has an invoice recorded, so this enquiry can no longer be deleted\. Archive it instead\./, async e => owner("insert into public.workspace_invoices(request_id,property_id,module_id,recipient_id,reference,amount_minor,currency,created_by) values(gen_random_uuid(),$1,'property-onboarding',$2,'INV-'||left(md5(random()::text),10),15000,'GBP',$2)", [e.prop, users[ADMIN]])],
    'bookings': [/This property has bookings recorded/, async e => owner("insert into private.workspace_reservations(property_id,reference,check_in,check_out,status,source,created_by) values($1,'HA-1','2026-12-01','2026-12-03','confirmed','manual',$2)", [e.prop, users[ADMIN]])],
  };
  for (const [why, [refusal, moveOn]] of Object.entries(cases)) {
    const e = await enquiry();
    await moveOn(e);
    await assert.rejects(del(ADMIN, e.id), refusal, why);
    const left = await gone(e);
    assert.deepEqual([left.enquiry, left.property, left.journey], [1, 1, 1], why + ': nothing deleted');
    assert.equal((await owner('select count(*)::int n from private.workspace_storage_removals where path like $1', [`enquiries/${e.id}/%`]))[0].n, 0, why + ': no files queued');
    assert.equal((await owner("select count(*)::int n from public.workspace_access_events where event_type='client_enquiry.deleted' and old_access->>'enquiryId'=$1", [e.id]))[0].n, 0, why + ': no audit entry');
  }
});

// Lee (20261024200000): an enquiry at "Estimate sent" said "This property has other records recorded": the property had a
// repair spending limit (Limit Changer). The limit and its history now go with it; a furnishing quote says what it is.
test('a property with a repair spending limit can be deleted while onboarding is ongoing; a furnishing quote is named', async () => {
  const e = await enquiry();
  await journey(e.prop, ESTIMATE);
  assert.equal(await stageOf(e.prop), 'estimate');
  await owner('insert into private.workspace_repair_limits(property_id,limit_minor,updated_by) values($1,25000,$2)', [e.prop, users[SUPER]]);
  await owner(`insert into private.workspace_repair_limit_history(property_id,changed_by,before,after,request_id) values($1,$2,null,'{"limitMinor":25000}',gen_random_uuid())`, [e.prop, users[SUPER]]);
  const done = await del(ADMIN, e.id);
  assert.equal(done.deleted, true);
  assert.deepEqual(await gone(e), NONE);
  const [left] = await owner('select (select count(*) from private.workspace_repair_limits where property_id=$1)::int limits,(select count(*) from private.workspace_repair_limit_history where property_id=$1)::int history', [e.prop]);
  assert.deepEqual(left, { limits: 0, history: 0 });

  const quoted = await enquiry();
  await owner(`insert into private.workspace_furnishing_projects(number,client_name,property_id,estimate_on,created_by,updated_by,request_id) values('RC-FQ-2026-0999','Mark Raven Canete',$1,current_date,$2,$2,gen_random_uuid())`, [quoted.prop, users[ADMIN]]);
  await assert.rejects(del(ADMIN, quoted.id), /This property has a furnishing quote recorded, so this enquiry can no longer be deleted\. Archive it instead\./);
  assert.equal((await gone(quoted)).property, 1);
});

test('owners, staff and everyone else are refused', async () => {
  const e = await enquiry();
  for (const i of [STAYS, CLEANER, OWNER, ACCOUNTS, READY, MANAGER]) await assert.rejects(del(i, e.id), /Only management can delete an enquiry/, roles[i]);
  assert.equal((await gone(e)).enquiry, 1);
  // A stale version, unknown keys, and a repeat of the same request.
  await as(ADMIN);
  const v = (await current(e.id)).version;
  await assert.rejects(act({ action: 'deleteEnquiry', enquiryId: e.id, version: v + 1 }), /Changed by someone else/);
  await assert.rejects(rpc('workspace_teams_action', [{ action: 'deleteEnquiry', requestId: crypto.randomUUID(), enquiryId: e.id, version: v, note: 'x' }]), /Unknown or oversized/);
  const input = teamsActionSchema.parse({ action: 'deleteEnquiry', requestId: crypto.randomUUID(), enquiryId: e.id, version: v });
  const first = await rpc('workspace_teams_action', [input]);
  assert.deepEqual(await rpc('workspace_teams_action', [input]), first, 'the same answer, nothing more');
  await assert.rejects(act({ action: 'deleteEnquiry', enquiryId: e.id, version: v }), /Enquiry not found/);
});

test('the enquiry it duplicated is kept, unlinked', async () => {
  const first = await enquiry();
  const second = await enquiry();
  await owner('update private.workspace_client_enquiries set duplicate_of=$1 where id=$2', [first.prop, second.id]);
  await del(ADMIN, first.id);
  const [left] = await owner('select duplicate_of from private.workspace_client_enquiries where id=$1', [second.id]);
  assert.equal(left.duplicate_of, null);
});

test('the screen asks first, for admins only, and the server removes the stored copies', () => {
  const screen = readFileSync('mobile/src/LiveEnquiries.tsx', 'utf8');
  assert.match(screen, /canDelete=\{!!open && canDeleteEnquiry\(account\.role, open\)\}/);
  // E's review: the enquiry sheet uses the same quiet red link as the Onboarding sheet.
  assert.match(screen, /\{canDelete && <DeleteLink p=\{p\} onPress=\{\(\) => setMode\("delete"\)\} \/>\}/);
  assert.doesNotMatch(screen, /<Button label="Delete enquiry" icon="trash-2" p=\{p\} onPress/);
  assert.match(screen, /<Text style=\{\[ui\.body, \{ color: p\.text \}\]\}>\{deleteEnquiryWarning\(e\)\}<\/Text>/);
  assert.match(screen, /writeTeams\(\{ action: "deleteEnquiry", requestId: request\.get\(\), enquiryId: e\.id, version: e\.version \}\)/);
  assert.match(screen, /label="Close this enquiry"/, 'Close is kept');
  // The property's Onboarding sheet: a quiet danger link at the bottom, under Flag for management, then the same sheet.
  assert.match(screen, /export function DeleteEnquiryAction\(/);
  assert.match(screen, /if \(!canDeleteEnquiry\(role, enquiry\)\) return null;/);
  assert.match(screen, /<DeleteLink p=\{p\} onPress=\{\(\) => setOpen\(true\)\} \/>/);
  assert.match(screen, /<Feather name="trash-2" size=\{15\} color=\{p\.danger\} \/>\r?\n\s*<Text style=\{\{ color: p\.danger, fontSize: 14, fontWeight: "600" \}\}>Delete this enquiry<\/Text>/);
  const tracker = readFileSync('mobile/src/OnboardingTracker.tsx', 'utf8');
  const flag = tracker.indexOf('<FlagButton'), del = tracker.indexOf('<DeleteEnquiryAction');
  assert.ok(flag > 0 && del > flag, 'Delete sits below Flag for management');
  assert.match(tracker, /enquiries\.find\(e => !!journey && e\.propertyId === journey\.propertyId\)/);
  assert.match(tracker, /onDeleted=\{async \(\) => \{ setOpenId\(null\); await Promise\.all\(\[load\(\), onRefresh\?\.\(\)\]\); \}\}/);
  assert.match(readFileSync('mobile/src/LiveWorkspace.tsx', 'utf8'), /<ClientRelations [^\n]*onRefresh=\{\(\) => refresh\(true\)\} \/>/);
  const server = readFileSync('lib/client-enquiry-server.ts', 'utf8');
  assert.match(server, /export async function deleteEnquiry\(/);
  assert.match(server, /storage\.remove\(paths\)/);
  assert.match(server, /rpc\('workspace_storage_removed', \{ bucket_name: ENQUIRY_BUCKET, removed: paths \}\)/);
  assert.match(readFileSync('lib/workspace-finance-server.ts', 'utf8'), /input\.action === 'deleteEnquiry' \? import\('\.\/client-enquiry-server'\)\.then\(m => m\.deleteEnquiry\(context, input\)\)/);
});

test('the migration runs twice without change', async () => {
  const sql = await fs.readFile('supabase/migrations/' + MIGRATION, 'utf8');
  const defs = async () => (await owner("select pg_get_functiondef('private.workspace_teams_action(jsonb)'::regprocedure)||pg_get_functiondef('private.workspace_client_enquiry_delete(jsonb)'::regprocedure)||pg_get_functiondef('private.workspace_enquiry_blocker(uuid,uuid[],uuid)'::regprocedure) t"))[0].t;
  const before = await defs();
  await db.exec('reset role');
  await db.exec(sql);
  // The later fix (20261024200000) patches the same functions: run again after it, nothing changes either.
  await db.exec(await fs.readFile('supabase/migrations/20261024200000_enquiry_delete_repair_limits.sql', 'utf8'));
  await db.exec(await fs.readFile('supabase/migrations/20261024200000_enquiry_delete_repair_limits.sql', 'utf8'));
  assert.equal(await defs(), before);
  assert.equal(before.split('private.workspace_client_enquiry_delete(input)').length, 2, 'routed once');
});
