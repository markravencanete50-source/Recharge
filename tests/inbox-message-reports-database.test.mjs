import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Reporting guest and client messages (Lee, 14 October): whoever can open a guest or client conversation can report a message
// the guest or sender wrote, with the Team chat reasons; admins see it in Reported messages beside the Team chat reports,
// labelled Guest message, Guest email or Client email, and either dismiss it or hide it in the app ("Hidden by an admin").
// Owners, cleaners and Ready never can, and never see a report.
const MINE = '20261020300000_inbox_message_reports';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const files = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
assert.ok(files.includes(MINE + '.sql'));
for (const file of files) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const SIGS = ['private.workspace_chat_action(jsonb)', 'private.workspace_teams_action(jsonb)', 'private.guest_thread_json(private.workspace_guest_threads)', 'private.workspace_guest_inbox_read(text,uuid,text)',
  'private.workspace_client_email_json(private.workspace_client_email_threads)', 'private.workspace_client_email_read(text,uuid)', 'private.workspace_email_files(uuid[])', 'private.chat_reports_read()'];
const definitions = () => Promise.all(SIGS.map(async s => (await db.query('select pg_get_functiondef($1::regprocedure) d', [s])).rows[0].d));
const firstRun = await definitions();
await db.exec(await fs.readFile(`supabase/migrations/${MINE}.sql`, 'utf8'));
const secondRun = await definitions();
after(() => db.close());

const roles = ['admin', 'stays', 'stays', 'client', 'cleans', 'ready', 'super_admin'];
const [ADMIN, GUEST_TEAM, CLIENT_REL, OWNER, CLEANER, READY, SUPER] = roles.map((_, i) => i);
const users = roles.map((_, i) => `99600000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('9960', '9970');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `ir${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], ['Ada Admin', 'Gail Guest', 'Cora Client', 'Olly Owner', 'Cleo Cleaner', 'Rory Ready', 'Sam Super'][i]]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
await db.query("insert into private.workspace_staff_rota(user_id,department,usual_shift) values($1,'client_relations','early')", [users[CLIENT_REL]]);
const property = (await db.query("insert into public.workspace_properties(name,created_by,request_id) values('Harbour View',$1,gen_random_uuid()) returning id", [users[ADMIN]])).rows[0].id;

async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
async function asBackend() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); await db.exec('set role service_role'); }
const sql = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const fails = async (work, pattern) => assert.rejects(work, e => pattern.test(e.message), String(pattern));
const report = async (who, source, messageId, extra = {}) => { await as(who); return rpc('workspace_chat_action', [{ action: 'reportInboxMessage', requestId: crypto.randomUUID(), source, messageId, reason: 'offensive', ...extra }]); };
const reports = async (who = ADMIN) => { await as(who); return rpc('workspace_teams_read', ['chatReports', null, null, null, null]); };
const decide = async (r, decision, who = ADMIN, requestId = crypto.randomUUID()) => { await as(who); return rpc('workspace_teams_action', [{ action: 'decideMessageReport', requestId, reportId: r.id, version: r.version, decision }]); };
const told = async (i, event) => (await sql('select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.user_id=$1 and a.event_type=$2', [users[i], event]))[0].n;
await as(ADMIN);
await db.query('select public.workspace_assign_property($1,$2,$3)', [property, users[GUEST_TEAM], 'staff']);
await db.query('select public.workspace_assign_property($1,$2,$3)', [property, users[CLIENT_REL], 'staff']);
await db.query('select public.workspace_assign_property($1,$2,$3)', [property, users[OWNER], 'client']);
await db.exec('reset role');
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });

// A Hostaway guest at Harbour View (with an answer from the team), a guest email, and an email from someone not an owner yet.
const ago = m => new Date(Date.now() - m * 60000).toISOString();
await asBackend();
await rpc('workspace_guest_messages_ingest', [{ source: 'hostaway', messages: [
  { externalId: 'hw-1', threadRef: 'hw', channel: 'airbnb', direction: 'guest', sentAt: ago(30), propertyId: property, guestName: 'Maria Lopez', body: 'You are all useless.' },
  { externalId: 'hw-2', threadRef: 'hw', channel: 'airbnb', direction: 'team', sentAt: ago(20), body: 'Sorry to hear that, how can we help?' },
  { externalId: 'hw-3', threadRef: 'hw', channel: 'airbnb', direction: 'guest', sentAt: ago(10), body: 'Rude words again.' }] }]);
await rpc('workspace_email_guest_ingest', [{ emailId: 'g_1', from: 'gus@example.org', fromName: 'Gus Mail', subject: 'Check in', text: 'Spam spam spam', receivedAt: new Date().toISOString(), messageId: '<g-1@mail.example.org>' }]);
const owned = await rpc('workspace_email_owner_ingest', [{ emailId: 'c_1', from: 'nia@example.org', fromName: 'Nia Newman', subject: 'Managing my flat', text: 'Offensive pitch', messageId: '<c-1@mail.example.org>' }]);
const id = async (where, args) => (await sql(`select id from private.workspace_guest_messages where ${where}`, args))[0].id;
const GUEST_MSG = await id("external_id='hw-1'"), GUEST_AGAIN = await id("external_id='hw-3'"), TEAM_REPLY = await id("external_id='hw-2'"), GUEST_EMAIL = await id("source='email'");
const CLIENT_MSG = (await sql('select id from private.workspace_client_email_messages where thread_id=$1', [owned.threadId]))[0].id;
const HW_THREAD = (await sql("select id from private.workspace_guest_threads where thread_ref='hw'"))[0].id;

test('the migration runs twice without change', () => assert.deepEqual(secondRun, firstRun));

test('the guest team reports a guest message; admins are told and see it labelled, with the guest, property and conversation', async () => {
  assert.deepEqual(await report(GUEST_TEAM, 'guest', GUEST_MSG, { note: '  Swearing at the cleaner  ' }), { reported: true, reportId: (await sql('select id from private.inbox_reports'))[0].id });
  assert.equal(await told(ADMIN, 'inbox.reported'), 1);
  assert.equal(await told(SUPER, 'inbox.reported'), 1);
  for (const who of [GUEST_TEAM, CLIENT_REL, OWNER, CLEANER, READY]) assert.equal(await told(who, 'inbox.reported'), 0, 'not told: ' + roles[who]);
  const read = await reports();
  assert.equal(read.open, 1);
  const [r] = read.items;
  assert.deepEqual([r.source, r.authorName, r.authorId, r.propertyName, r.conversation, r.openId, r.conversationId, r.body, r.note, r.reporterName, r.removed, r.status],
    ['guest_message', 'Maria Lopez', null, 'Harbour View', 'Harbour View', 'guest:' + HW_THREAD, HW_THREAD, 'You are all useless.', 'Swearing at the cleaner', 'Gail Guest', false, 'open']);
  assert.deepEqual([r.sameMessageReports, r.authorReports, r.attachmentCount], [1, 1, 0]);
  await fails(() => report(GUEST_TEAM, 'guest', GUEST_MSG), /already reported this message/);
});

test('a guest email and a client email are labelled by source; only the client team can report a client email', async () => {
  await report(CLIENT_REL, 'guest', GUEST_EMAIL, { reason: 'spam' });
  await fails(() => report(GUEST_TEAM, 'client_email', CLIENT_MSG), /Message not found/);
  await report(CLIENT_REL, 'client_email', CLIENT_MSG);
  const items = (await reports()).items;
  const email = items.find(r => r.messageId === GUEST_EMAIL), client = items.find(r => r.messageId === CLIENT_MSG);
  assert.deepEqual([email.source, email.authorName, email.conversation, email.reason], ['guest_email', 'Gus Mail', 'No property yet', 'spam']);
  assert.deepEqual([client.source, client.authorName, client.conversation, client.openId, client.propertyName], ['client_email', 'Nia Newman', 'Managing my flat', 'email:' + owned.threadId, null]);
});

test('our own messages cannot be reported, and owners, cleaners and Ready cannot report or read reports', async () => {
  await fails(() => report(GUEST_TEAM, 'guest', TEAM_REPLY), /only report a message the guest sent/);
  for (const who of [OWNER, CLEANER, READY]) {
    await fails(() => report(who, 'guest', GUEST_AGAIN), /Message not found/);
    await fails(() => report(who, 'client_email', CLIENT_MSG), /Message not found/);
    await fails(() => reports(who), /Moderation access required/);
  }
  await fails(() => reports(GUEST_TEAM), /Moderation access required/);
  await fails(() => report(GUEST_TEAM, 'chat', GUEST_AGAIN), /Choose a message to report/);
  await fails(() => report(GUEST_TEAM, 'guest', GUEST_AGAIN, { reason: 'rude' }), /Choose a reason/);
  await fails(() => report(GUEST_TEAM, 'guest', GUEST_AGAIN, { note: 'x'.repeat(501) }), /500 characters/);
  await fails(() => report(GUEST_TEAM, 'guest', GUEST_AGAIN, { extra: true }), /./);
});

test('hiding a guest message: the team sees "Hidden by an admin", no words or files; every reporter is told', async () => {
  await report(CLIENT_REL, 'guest', GUEST_MSG, { reason: 'harassment' });
  const r = (await reports()).items.find(x => x.messageId === GUEST_MSG && x.reporterName === 'Gail Guest');
  assert.equal(r.sameMessageReports, 2);
  await fails(() => decide(r, 'hide', GUEST_TEAM), /Moderation access required/);
  await fails(() => decide(r, 'remove'), /hide the message or dismiss/);
  await fails(() => decide({ ...r, version: r.version + 1 }, 'hide'), /Changed by someone else/);
  const requestId = crypto.randomUUID();
  const done = await decide(r, 'hide', ADMIN, requestId);
  assert.deepEqual([done.status, done.removed, done.handledByName], ['actioned', true, 'Ada Admin']);
  assert.deepEqual(await decide(r, 'hide', ADMIN, requestId), done, 'a repeated request gives the same answer');
  assert.equal((await reports()).items.filter(x => x.messageId === GUEST_MSG && x.status === 'actioned').length, 2, 'both reports decided together');
  assert.equal(await told(GUEST_TEAM, 'inbox.report_hidden'), 1);
  assert.equal(await told(CLIENT_REL, 'inbox.report_hidden'), 1);
  await as(GUEST_TEAM);
  const thread = await rpc('workspace_guest_inbox_read', ['thread', HW_THREAD, null]);
  const hidden = thread.messages.find(m => m.id === GUEST_MSG);
  assert.deepEqual([hidden.body, hidden.hidden, hidden.files], ['', true, []]);
  assert.equal(thread.messages.find(m => m.id === GUEST_AGAIN).hidden, false);
  // The admin still reads what it said, to judge it.
  assert.equal((await reports()).items.find(x => x.id === r.id).body, 'You are all useless.');
  await fails(() => report(CLIENT_REL, 'guest', GUEST_MSG), /already hidden/);
  await fails(() => decide(r, 'dismiss'), /Changed by someone else|already been dealt with/);
});

test('hiding the latest message shows "Hidden by an admin" in the conversation list, for guests and client email', async () => {
  await report(GUEST_TEAM, 'guest', GUEST_AGAIN);
  await decide((await reports()).items.find(x => x.messageId === GUEST_AGAIN && x.status === 'open'), 'hide');
  await as(GUEST_TEAM);
  assert.equal((await rpc('workspace_guest_inbox_read', ['list', null, 'all'])).threads.find(t => t.id === HW_THREAD).preview, 'Hidden by an admin');
  await decide((await reports()).items.find(x => x.messageId === CLIENT_MSG && x.status === 'open'), 'hide', SUPER);
  await as(CLIENT_REL);
  assert.equal((await rpc('workspace_client_email_read', ['list', null])).threads.find(t => t.id === owned.threadId).preview, 'Hidden by an admin');
  const m = (await rpc('workspace_client_email_read', ['thread', owned.threadId])).messages[0];
  assert.deepEqual([m.body, m.hidden, m.files], ['', true, []]);
});

test('dismissing leaves the message in place and tells the reporter it was reviewed', async () => {
  const before = await told(CLIENT_REL, 'chat.report_reviewed');
  const r = (await reports()).items.find(x => x.messageId === GUEST_EMAIL);
  assert.equal((await decide(r, 'dismiss')).status, 'dismissed');
  assert.equal(await told(CLIENT_REL, 'chat.report_reviewed'), before + 1);
  assert.equal((await sql('select hidden_at from private.workspace_guest_messages where id=$1', [GUEST_EMAIL]))[0].hidden_at, null);
  assert.equal((await reports()).open, 0);
});

test('the reports tables stay out of reach; owners are never told', async () => {
  await as(GUEST_TEAM);
  await fails(() => db.query('select * from private.inbox_reports'), /permission denied/);
  await fails(() => db.query("select private.inbox_report_action('{}'::jsonb)"), /permission denied/);
  for (const event of ['inbox.reported', 'inbox.report_hidden', 'chat.report_reviewed']) assert.equal(await told(OWNER, event), 0);
});
