import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Round 6, Lee: "we should be able to delete client enquiries" (migration 20261016210000). Admins and super
// admins only; only while the enquiry has not moved on; the enquiry, its answers, the property it made, the
// journey and the onboarding item all go, the files are queued for removal, and the access history keeps
// who deleted which enquiry by name.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { teamsActionSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { enquiryAnswersSchema, clientEnquiriesSchema, valuationDraft, canDeleteEnquiry, deleteEnquiryWarning, ENQUIRY_MOVED_ON } = await vite.ssrLoadModule('/lib/client-enquiry.ts');
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const MIGRATION = '20261016210000_delete_client_enquiry.sql';
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
  fullName: 'Mark Raven Canete', companyName: 'Optimal', correspondenceAddress: '4 Queen Street\nEdinburgh EH2 1JE', email: 'mark@example.com', phone: '07700 900123', existingClient: 'no',
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
    (select count(*) from public.workspace_activity where property_id=$2 or work_id=$3)::int activity, (select count(*) from private.workspace_notification_outbox where work_id=$3)::int notices`, [id, prop, task]);
  return n;
}
const NONE = { enquiry: 0, property: 0, journey: 0, work: 0, access: 0, activity: 0, notices: 0 };
after(async () => { await db.close(); await vite.close(); });

test('the button: admins and super admins, while the enquiry has not moved on; the warning', () => {
  for (const role of ['admin', 'super_admin']) assert.equal(canDeleteEnquiry(role, { propertyId: 'p', stage: 'enquiry' }), true, role);
  for (const role of ['stays', 'cleans', 'cleaning_manager', 'ready', 'accounts', 'client']) assert.equal(canDeleteEnquiry(role, { propertyId: 'p', stage: 'enquiry' }), false, role);
  assert.equal(canDeleteEnquiry('admin', { propertyId: null, stage: null }), true, 'not answered yet');
  assert.equal(canDeleteEnquiry('admin', { propertyId: 'p', stage: 'archived' }), true, 'closed');
  assert.equal(canDeleteEnquiry('admin', { propertyId: 'p', stage: 'estimate' }), false, 'moved on');
  assert.equal(deleteEnquiryWarning({ propertyId: 'p' }), 'Delete this enquiry? This removes the enquiry, its answers and photos, and the property it created. This can’t be undone.');
  assert.equal(ENQUIRY_MOVED_ON, 'This enquiry has moved on. Close it instead.');
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
  await del(ADMIN, e.id);
  const [event] = await owner("select user_id,actor_id,old_access,new_access from public.workspace_access_events where event_type='client_enquiry.deleted' and old_access->>'enquiryId'=$1", [e.id]);
  assert.equal(event.actor_id, users[ADMIN]);
  assert.deepEqual(event.old_access, { enquiryId: e.id, name: 'Mark Raven Canete', company: 'Optimal', status: 'received', stage: 'enquiry', propertyDeleted: true });
  for (const secret of ['mark@example.com', '07700', 'Queen Street', 'Tinibgan']) assert.ok(!JSON.stringify(event).includes(secret), secret);
});

test('refused once it has moved on, and nothing is deleted', async () => {
  const cases = {
    'an estimate was sent': async e => owner("update private.workspace_journeys set stage='estimate' where property_id=$1", [e.prop]),
    'an owner is linked': async e => owner("insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values($1,$2,'client',$3)", [e.prop, users[OWNER], users[ADMIN]]),
    'the agreement is signed': async e => owner("update private.workspace_journeys set signed_name='Mark Raven Canete',signed_at=now() where property_id=$1", [e.prop]),
    'there is other work on it': async e => { await as(ADMIN); await act({ action: 'saveHubItem', kind: 'todo', title: 'Book the photographer', propertyId: e.prop }); },
    'there is money on it': async e => owner("insert into public.workspace_invoices(request_id,property_id,module_id,recipient_id,reference,amount_minor,currency,created_by) values(gen_random_uuid(),$1,'property-onboarding',$2,'INV-'||left(md5(random()::text),10),15000,'GBP',$2)", [e.prop, users[ADMIN]]),
  };
  for (const [why, moveOn] of Object.entries(cases)) {
    const e = await enquiry();
    await moveOn(e);
    await assert.rejects(del(ADMIN, e.id), /This enquiry has moved on\. Close it instead\./, why);
    const left = await gone(e);
    assert.deepEqual([left.enquiry, left.property, left.journey], [1, 1, 1], why + ': nothing deleted');
    assert.equal((await owner('select count(*)::int n from private.workspace_storage_removals where path like $1', [`enquiries/${e.id}/%`]))[0].n, 0, why + ': no files queued');
  }
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
  assert.match(screen, /\{canDelete && <Button label="Delete enquiry" icon="trash-2"/);
  assert.match(screen, /<Text style=\{\[ui\.body, \{ color: p\.text \}\]\}>\{deleteEnquiryWarning\(e\)\}<\/Text>/);
  assert.match(screen, /writeTeams\(\{ action: "deleteEnquiry", requestId: request\.get\(\), enquiryId: e\.id, version: e\.version \}\)/);
  assert.match(screen, /label="Close this enquiry"/, 'Close is kept');
  const server = readFileSync('lib/client-enquiry-server.ts', 'utf8');
  assert.match(server, /export async function deleteEnquiry\(/);
  assert.match(server, /storage\.remove\(paths\)/);
  assert.match(server, /rpc\('workspace_storage_removed', \{ bucket_name: ENQUIRY_BUCKET, removed: paths \}\)/);
  assert.match(readFileSync('lib/workspace-finance-server.ts', 'utf8'), /input\.action === 'deleteEnquiry' \? import\('\.\/client-enquiry-server'\)\.then\(m => m\.deleteEnquiry\(context, input\)\)/);
});

test('the migration runs twice without change', async () => {
  const sql = await fs.readFile('supabase/migrations/' + MIGRATION, 'utf8');
  const defs = async () => (await owner("select pg_get_functiondef('private.workspace_teams_action(jsonb)'::regprocedure) t"))[0].t;
  const before = await defs();
  await db.exec('reset role');
  await db.exec(sql);
  assert.equal(await defs(), before);
  assert.equal(before.split('private.workspace_client_enquiry_delete(input)').length, 2, 'routed once');
});
