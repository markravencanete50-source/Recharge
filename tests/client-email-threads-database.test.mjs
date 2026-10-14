import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Email to ownerrelations@ from someone who is not an owner yet becomes a client email conversation (Lee, 14 October): the client
// team reads and answers it (from ownerrelations@, once per request), their answer comes back into the same conversation, it closes
// and reopens, and "Assign to owner" moves the history into the owner's conversation. Owners, cleaners and Ready never see it.
const MINE = '20261019500000_client_email_threads';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const files = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
assert.ok(files.includes(MINE + '.sql'));
// Run everything up to 20261016500000, leave one unknown sender in the old list, then the rest: the migration folds it in.
const cut = files.indexOf(MINE + '.sql');
for (const file of files.slice(0, cut)) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
await db.exec(`set role service_role`);
await db.query('select public.workspace_email_owner_ingest($1)', [{ emailId: 'old_1', from: 'landlord@example.org', fromName: 'Lena Lord', subject: 'Flat in Leith', text: 'Can you manage my flat?', messageId: '<old-1@mail.example.org>' }]);
await db.exec('reset role');
await db.exec(await fs.readFile(`supabase/migrations/${MINE}.sql`, 'utf8'));
const SIGS = ['private.workspace_email_owner_ingest(jsonb)', 'private.workspace_client_email_action(jsonb)', 'private.workspace_email_files(uuid[])', 'private.workspace_email_owner_reply_queue()'];
const definitions = () => Promise.all(SIGS.map(async s => (await db.query('select pg_get_functiondef($1::regprocedure) d', [s])).rows[0].d));
const firstRun = await definitions();
const threadsBefore = (await db.query('select count(*)::int n from private.workspace_client_email_threads')).rows[0].n;
await db.exec(await fs.readFile(`supabase/migrations/${MINE}.sql`, 'utf8'));
const secondRun = await definitions();
const threadsAfter = (await db.query('select count(*)::int n from private.workspace_client_email_threads')).rows[0].n;
// Then the later migrations (20261020300000 patches the email files and the client email reads for hidden messages).
for (const file of files.slice(cut + 1)) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
after(() => db.close());

const roles = ['super_admin', 'stays', 'stays', 'client', 'cleans', 'ready', 'admin'];
const [SUPER, CLIENT_REL, STAYS, OWNER, CLEANER, READY, ADMIN] = roles.map((_, i) => i);
const users = roles.map((_, i) => `99300000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('9930', '9940');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `ce${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], 'Person ' + i]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
await db.query("insert into private.workspace_staff_rota(user_id,department,usual_shift) values($1,'client_relations','early')", [users[CLIENT_REL]]);
async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
async function asBackend() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); await db.exec('set role service_role'); }
const sql = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
let n = 0;
const mail = (extra = {}) => ({ emailId: `ce_${++n}`, from: 'new.landlord@example.org', fromName: 'Nia Newman', subject: 'Managing my property', text: 'Hello, can Recharge manage my flat?', messageId: `<ce-${n}@mail.example.org>`, ...extra });
const ownerIn = async input => { await asBackend(); return rpc('workspace_email_owner_ingest', [input]); };
const list = async (who = CLIENT_REL) => { await as(who); return (await rpc('workspace_client_email_read', ['list', null])).threads; };
const thread = async (id, who = CLIENT_REL) => { await as(who); return rpc('workspace_client_email_read', ['thread', id]); };
const act = async (input, who = CLIENT_REL) => { await as(who); return rpc('workspace_client_email_action', [input]); };
const result = async input => { await asBackend(); return rpc('workspace_client_email_result', [input]); };
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });

test('the migration runs twice without change, and folds the old unknown-sender list into conversations once', async () => {
  assert.deepEqual(secondRun, firstRun);
  assert.equal(threadsBefore, 1);
  assert.equal(threadsAfter, 1);
  const [t] = await list();
  assert.equal(t.address, 'landlord@example.org');
  assert.equal(t.name, 'Lena Lord');
  assert.equal((await sql("select status from private.workspace_email_unknown_senders where email_id='old_1'"))[0].status, 'assigned', 'no longer waiting in the old list');
  await act({ action: 'close', threadId: t.id });
});

test('an unknown sender starts a conversation the client team sees, needing a reply, and is told about', async () => {
  const r = await ownerIn(mail());
  assert.equal(r.matched, 'unknown');
  const t = (await list()).find(x => x.id === r.threadId);
  assert.deepEqual([t.address, t.name, t.subject, t.status, t.lastFrom], ['new.landlord@example.org', 'Nia Newman', 'Managing my property', 'open', 'in']);
  assert.ok(t.waitingSince, 'needs a reply');
  const read = await thread(t.id);
  assert.equal(read.messages.length, 1);
  assert.match(read.messages[0].body, /^Subject: Managing my property\n\nHello, can Recharge manage my flat\?/);
  const told = (await sql("select distinct o.user_id from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where a.event_type='client.email'")).map(x => users.indexOf(x.user_id));
  for (const who of [SUPER, ADMIN, CLIENT_REL]) assert.ok(told.includes(who), 'told ' + who);
  for (const who of [STAYS, OWNER, CLEANER, READY]) assert.ok(!told.includes(who), 'not told ' + who);
});

test('only admins, super admins and the client relations rota see or act on these', async () => {
  const [t] = await list();
  for (const who of [ADMIN, SUPER]) assert.ok((await list(who)).length >= 1);
  for (const who of [STAYS, OWNER, CLEANER, READY]) {
    await as(who);
    await assert.rejects(rpc('workspace_client_email_read', ['list', null]), /Client relations access required/, 'role ' + roles[who]);
    await assert.rejects(rpc('workspace_client_email_read', ['thread', t.id]), /Client relations access required/);
    await assert.rejects(rpc('workspace_client_email_action', [{ action: 'reply', requestId: crypto.randomUUID(), threadId: t.id, body: 'Hi' }]), /Client relations access required/);
    await assert.rejects(rpc('workspace_client_email_result', [{ requestId: crypto.randomUUID(), ok: true }]), /permission denied/);
    await assert.rejects(db.query('select * from private.workspace_client_email_threads'), /permission denied/);
  }
});

test('a reply is recorded once per request, sent as a reply to their email, stored only when Resend accepted it; their answer joins the conversation', async () => {
  const [t] = (await list()).filter(x => x.address === 'new.landlord@example.org');
  const requestId = crypto.randomUUID();
  const started = await act({ action: 'reply', requestId, threadId: t.id, body: '  Yes, we can help. What is the address?  ' });
  assert.equal(started.send, true);
  assert.deepEqual(started.email, { to: 'new.landlord@example.org', subject: 'Re: Managing my property', inReplyTo: started.email.inReplyTo, references: started.email.references });
  assert.match(started.email.inReplyTo, /^ce-\d+@mail\.example\.org$/);
  assert.equal((await act({ action: 'reply', requestId, threadId: t.id, body: 'Yes' })).send, false, 'pressed again while going out: not sent twice');
  assert.equal((await thread(t.id)).messages.length, 1, 'nothing shown before Resend accepted it');
  await assert.rejects(act({ action: 'reply', requestId, threadId: t.id, body: 'Yes' }, ADMIN), /Request identifier already used/);
  await result({ requestId, ok: false, error: 'Resend said no' });
  assert.equal((await thread(t.id)).messages.length, 1);
  assert.equal((await act({ action: 'reply', requestId, threadId: t.id, body: 'Yes, we can help. What is the address?' })).send, true, 'a failed one may be tried again');
  assert.deepEqual(await result({ requestId, ok: true, messageId: `<${requestId}@rechargegroup.co.uk>` }), { recorded: true });
  assert.deepEqual(await result({ requestId, ok: true, messageId: '<x@y>' }), { recorded: false });
  const after1 = await thread(t.id);
  assert.deepEqual(after1.messages.map(m => [m.direction, m.author]), [['in', null], ['out', 'Person 1']]);
  assert.equal(after1.thread.waitingSince, null, 'engaged once answered');
  // Their answer to our email (In-Reply-To our Message-ID), from another address even: same conversation, needing a reply again.
  const back = await ownerIn(mail({ from: 'nia.other@example.net', subject: 'Re: Managing my property', text: '12 Shore Road.', inReplyTo: `<${requestId}@rechargegroup.co.uk>` }));
  assert.equal(back.threadId, t.id);
  const after2 = await thread(t.id);
  assert.equal(after2.messages.length, 3);
  assert.equal(after2.messages[2].body, '12 Shore Road.', 'a reply in an existing conversation keeps its text as written');
  assert.ok(after2.thread.waitingSince);
  // And the same address later, without reply headers, also joins it.
  assert.equal((await ownerIn(mail({ subject: 'One more thing' }))).threadId, t.id);
});

test('close and reopen; a new email reopens a closed conversation', async () => {
  const [t] = (await list()).filter(x => x.address === 'new.landlord@example.org');
  assert.equal((await act({ action: 'close', threadId: t.id })).thread.status, 'closed');
  assert.equal((await thread(t.id)).thread.waitingSince, null, 'closed is not waiting');
  assert.equal((await act({ action: 'reopen', threadId: t.id })).thread.status, 'open');
  await act({ action: 'close', threadId: t.id });
  await ownerIn(mail({ text: 'Are you there?' }));
  assert.equal((await thread(t.id)).thread.status, 'open');
  await assert.rejects(act({ action: 'delete', threadId: t.id }), /Unknown action/);
  await assert.rejects(act({ action: 'close', threadId: t.id, extra: 1 }));
});

test('one conversation per person, but a new subject shows: its message starts with it, the conversation takes it, the reply is "Re: <it>"', async () => {
  const sam = (extra = {}) => mail({ from: 'sam.seller@example.org', fromName: 'Sam Seller', ...extra });
  const first = await ownerIn(sam({ subject: 'Owner test', text: 'First.' }));
  const second = await ownerIn(sam({ subject: 'Client test 1', text: 'Second.' }));
  assert.equal(second.threadId, first.threadId, 'same person, same conversation');
  let view = await thread(first.threadId);
  assert.equal(view.thread.subject, 'Client test 1', 'the row and header show the newest subject');
  assert.deepEqual(view.messages.map(m => m.body), ['Subject: Owner test\n\nFirst.', 'Subject: Client test 1\n\nSecond.']);
  const requestId = crypto.randomUUID();
  const started = await act({ action: 'reply', requestId, threadId: first.threadId, body: 'Thanks.' });
  assert.equal(started.email.subject, 'Re: Client test 1');
  assert.match(started.email.inReplyTo, /^ce-\d+@mail\.example\.org$/);
  await result({ requestId, ok: true, messageId: `<${requestId}@rechargegroup.co.uk>` });
  // Their reply (headers match) and "Re:" / "Fwd:" of the same subject change nothing.
  await ownerIn(sam({ subject: 'Re: Owner test', text: 'Back on the first.', inReplyTo: `<${requestId}@rechargegroup.co.uk>` }));
  await ownerIn(sam({ subject: 'RE: client TEST 1', text: 'Same subject.' }));
  await ownerIn(sam({ subject: 'Fwd: Client test 1', text: 'Forwarded.' }));
  await ownerIn(sam({ subject: '', text: 'No subject.' }));
  // An older email arriving late keeps its subject line but does not take over the conversation's subject.
  await ownerIn(sam({ subject: 'Old news', text: 'Late.', receivedAt: '2020-01-01T10:00:00Z' }));
  view = await thread(first.threadId);
  assert.equal(view.thread.subject, 'Client test 1');
  assert.equal(view.messages[0].body, 'Subject: Old news\n\nLate.', 'shown in date order');
  assert.deepEqual(view.messages.slice(4).map(m => m.body), ['Back on the first.', 'Same subject.', 'Forwarded.', 'No subject.']);
  assert.deepEqual(await sql("select private.workspace_client_email_topic(' Re: Fwd: RE[2]: Hello ') a, private.workspace_client_email_topic('Re:') b"), [{ a: 'hello', b: null }]);
  const def = async () => (await sql("select pg_get_functiondef('private.workspace_client_email_in(text,text,text,text,text,timestamptz,text,text,text[],jsonb)'::regprocedure) d"))[0].d;
  const once = await def();
  await db.exec(await fs.readFile('supabase/migrations/20261019510000_client_email_new_subject.sql', 'utf8'));
  assert.equal(await def(), once, 'the round-2 migration runs twice without change');
  assert.match(once, /new_topic/);
  await act({ action: 'close', threadId: first.threadId });
});

test('assigning to an owner moves the whole history into their conversation, without emailing it again, and remembers the address', async () => {
  const [t] = (await list()).filter(x => x.address === 'new.landlord@example.org');
  const before = (await thread(t.id)).messages;
  await assert.rejects(act({ action: 'assign', threadId: t.id, ownerId: users[STAYS] }), /Owner not found/);
  const moved = await act({ action: 'assign', threadId: t.id, ownerId: users[OWNER] });
  const rows = await sql('select author_id,body from private.chat_messages where conversation_id=$1 order by created_at,id', [moved.conversationId]);
  assert.equal(rows.length, before.length);
  assert.deepEqual(rows.map(r => r.author_id === users[OWNER] ? 'owner' : 'team'), before.map(m => m.direction === 'in' ? 'owner' : 'team'));
  assert.equal((await sql('select count(*)::int n from private.workspace_email_outbox'))[0].n, 0, 'the moved replies are not sent again');
  assert.ok(!(await list()).some(x => x.id === t.id), 'gone from the list');
  await assert.rejects(thread(t.id), /Conversation not found/);
  // Their next email goes straight to the owner's conversation, and a team reply there is emailed from ownerrelations@ (the outbox).
  assert.equal((await ownerIn(mail({ text: 'Thanks!' }))).matched, 'owner');
  await as(CLIENT_REL);
  await rpc('workspace_chat_action', [{ action: 'send', requestId: crypto.randomUUID(), conversationId: moved.conversationId, body: 'You are welcome.' }]);
  assert.equal((await sql('select to_address from private.workspace_email_outbox'))[0].to_address, 'new.landlord@example.org');
});
