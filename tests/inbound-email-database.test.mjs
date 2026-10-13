import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Email for guests and owners (Resend), as the database sees it: matching, storing, privacy by role, replies out sent once,
// notices, the unknown-sender list, and the migration running twice. No live database; PGlite only.
const MINE = '20261016500000_inbound_email';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const files = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
assert.ok(files.includes(MINE + '.sql'));
for (const file of files) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const SIGS = ['private.workspace_guest_reply_begin(private.workspace_guest_threads,uuid,text)', 'private.workspace_guest_inbox_read(text,uuid,text)', 'private.workspace_email_guest_ingest(jsonb)', 'private.workspace_email_owner_reply_queue()'];
const definitions = async () => Promise.all(SIGS.map(async s => (await db.query('select pg_get_functiondef($1::regprocedure) def', [s])).rows[0].def));
const firstRun = await definitions();
await db.exec(await fs.readFile(`supabase/migrations/${MINE}.sql`, 'utf8'));
const secondRun = await definitions();
// The hostaway sync is paused for the new business; email does not depend on it.
after(() => db.close());

const roles = ['super_admin', 'stays', 'stays', 'stays', 'cleans', 'ready', 'client', 'client', 'accounts'];
const [ADMIN, STAYS, NO_TOOL, CLIENT_REL, CLEANER, READY, OWNER, OTHER_OWNER, ACCOUNTS] = roles.map((_, i) => i);
const users = roles.map((_, i) => `99100000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('9910', '9920');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `mail${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], 'Person ' + i]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
await db.query("delete from public.workspace_module_grants where user_id=$1 and module_id='guest-communication'", [users[NO_TOOL]]);
await db.query("insert into private.workspace_staff_rota(user_id,department,usual_shift) values($1,'client_relations','early')", [users[CLIENT_REL]]);
async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
async function asBackend() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); await db.exec('set role service_role'); }
const sql = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
beforeEach(async () => {
  await db.exec('reset role');
  await db.exec(`delete from private.workspace_write_limits;delete from private.workspace_email_outbox;delete from private.workspace_email_attachments;delete from private.workspace_email_messages;
   delete from private.workspace_email_unknown_senders;delete from private.workspace_email_owner_addresses;delete from private.workspace_email_inbound;
   delete from private.workspace_guest_reply_requests;delete from private.workspace_guest_messages;delete from private.workspace_guest_threads;
   delete from private.chat_messages;delete from private.chat_members;delete from private.chat_conversations`);
});

await as(ADMIN);
const property = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Mail flat', address: 'Example mail one', region: 'Edinburgh', bedrooms: 2 }]);
await db.exec('reset role');
await db.query('select public.workspace_assign_property($1,$2,$3)', [property, users[STAYS], 'staff']);
await db.query('select public.workspace_assign_property($1,$2,$3)', [property, users[OWNER], 'client']);
await db.query('select public.workspace_assign_property($1,$2,$3)', [property, users[CLIENT_REL], 'staff']);
await db.query("insert into private.workspace_reservations(property_id,reference,check_in,check_out,status,source,created_by,channel,channel_reference) values($1,'HA:900',current_date+3,current_date+6,'confirmed','manual',$2,'airbnb','HMABC12345')", [property, users[ADMIN]]);

let counter = 0;
const mail = (extra = {}) => ({ emailId: `em_${++counter}_${Math.random().toString(36).slice(2)}`, from: 'guest.one@example.org', fromName: 'Gus One', subject: 'Question about check in', text: 'What time can we check in?', receivedAt: new Date().toISOString(), messageId: `<in-${counter}-${Math.random().toString(36).slice(2)}@mail.example.org>`, ...extra });
const guestIn = async input => { await asBackend(); return rpc('workspace_email_guest_ingest', [input]); };
const ownerIn = async input => { await asBackend(); return rpc('workspace_email_owner_ingest', [input]); };
const threads = () => sql("select id,thread_ref,property_id,guest_name,guest_email,reservation_ref,channel,source,status from private.workspace_guest_threads where source='email' order by created_at");
const messages = () => sql("select direction,body,external_id,author_user_id,channel from private.workspace_guest_messages where source='email' order by sent_at,id");

test('the migration runs twice without change', () => assert.deepEqual(secondRun, firstRun));

test('a guest email becomes an email conversation, once, and tells the guest team', async () => {
  const input = mail();
  const first = await guestIn(input);
  assert.equal(first.stored, true);
  assert.equal(first.matched, 'new');
  const [t] = await threads();
  assert.equal(t.channel, 'email');
  assert.equal(t.guest_email, 'guest.one@example.org');
  assert.equal(t.guest_name, 'Gus One');
  assert.equal(t.property_id, null, 'unmatched: shared with everyone allowed the guest inbox');
  const [m] = await messages();
  assert.equal(m.direction, 'guest');
  assert.match(m.body, /^Subject: Question about check in\n\nWhat time can we check in\?/);
  // The same webhook again stores nothing more.
  assert.deepEqual(await guestIn(input), { duplicate: true });
  assert.equal((await messages()).length, 1);
  // The existing guest-message trigger tells admins and Stays with the tool, never the cleaner, Ready, owner or a Stays person without the tool.
  const told = (await sql(`select distinct o.user_id from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where a.event_type='guest.message'`)).map(r => users.indexOf(r.user_id));
  assert.ok(told.includes(ADMIN) && told.includes(STAYS));
  for (const who of [CLEANER, READY, OWNER, OTHER_OWNER, NO_TOOL]) assert.ok(!told.includes(who), 'not told: ' + who);
});

test('matching: reply headers, then a booking code, then the sender; never the display name', async () => {
  const a = await guestIn(mail());
  const [t1] = await threads();
  // 1. A reply to an email we stored is matched by In-Reply-To (or References), whoever sends it, whatever its subject.
  const [{ rfc_message_id: stored }] = await sql('select rfc_message_id from private.workspace_email_messages limit 1');
  const reply = await guestIn(mail({ from: 'someone.else@example.org', subject: 'completely different', inReplyTo: `<${stored.toUpperCase()}>` }));
  assert.equal(reply.matched, 'reply');
  assert.equal(reply.threadId, t1.id);
  const viaRefs = await guestIn(mail({ from: 'third@example.org', references: ['<unknown@x>', `<${stored}>`] }));
  assert.equal(viaRefs.matched, 'reply');
  assert.equal(viaRefs.threadId, t1.id);
  // 3. The same sender address, later, joins the earlier conversation.
  const bySender = await guestIn(mail({ subject: 'One more thing' }));
  assert.equal(bySender.matched, 'sender');
  assert.equal(bySender.threadId, t1.id);
  // The display name alone never matches: the same name from another address is a new conversation.
  const sameName = await guestIn(mail({ from: 'gus.other@example.net' }));
  assert.equal(sameName.matched, 'new');
  assert.notEqual(sameName.threadId, t1.id);
  // 2. A booking code in the subject or text finds the stay, its property and dates, and a later email with it joins that conversation.
  const code = await guestIn(mail({ from: 'booker@example.org', fromName: 'Booker', subject: 'Booking HMABC12345 arrival', text: 'We land at noon.' }));
  assert.equal(code.matched, 'booking');
  const [coded] = (await threads()).filter(t => t.id === code.threadId);
  assert.equal(coded.property_id, property);
  assert.equal(coded.reservation_ref, 'HMABC12345');
  const again = await guestIn(mail({ from: 'partner@example.org', text: 'Re booking hmabc12345: parking?' }));
  assert.equal(again.matched, 'booking');
  assert.equal(again.threadId, code.threadId);
  // A short word that happens to look like a code, or part of a longer word, does not match.
  const near = await guestIn(mail({ from: 'nobody@example.org', text: 'XHMABC12345Y is not a booking' }));
  assert.equal(near.matched, 'new');
  assert.ok(a.stored);
});

test('guest email stays with the guest team: owners, cleaners and Ready never see it', async () => {
  await guestIn(mail());
  const [t] = await threads();
  await sql("insert into private.workspace_email_attachments(guest_message_id,path,filename,mime,bytes) select id,'guest/x/a.pdf','a.pdf','application/pdf',100 from private.workspace_guest_messages limit 1");
  const [{ id: file }] = await sql('select id from private.workspace_email_attachments');
  await as(STAYS);
  const read = await rpc('workspace_guest_inbox_read', ['thread', t.id, null]);
  assert.equal(read.messages.length, 1);
  assert.equal(read.messages[0].files[0].filename, 'a.pdf');
  assert.equal((await rpc('workspace_email_files', [[file]])).length, 1, 'staff who may read the conversation may open its files');
  for (const who of [OWNER, CLEANER, READY, NO_TOOL]) {
    await as(who);
    await assert.rejects(rpc('workspace_guest_inbox_read', ['thread', t.id, null]), /Guest inbox access required/, 'role ' + roles[who] + who);
    await assert.rejects(rpc('workspace_guest_inbox_read', ['list', null, 'all']), /Guest inbox access required/);
    assert.deepEqual(await rpc('workspace_email_files', [[file]]), [], 'no file link for ' + who);
  }
  // Nobody signed in reaches the tables or the ingest directly.
  for (const who of [STAYS, OWNER]) {
    await as(who);
    await assert.rejects(db.query('select * from private.workspace_email_messages'), /permission denied/);
    await assert.rejects(rpc('workspace_email_guest_ingest', [mail()]), /permission denied/);
    await assert.rejects(rpc('workspace_email_owner_ingest', [mail()]), /permission denied/);
    await assert.rejects(rpc('workspace_email_outbox_claim', [5]), /permission denied/);
  }
});

test('a reply by email is sent once per request, stored only when Resend accepted it, and threads the next answer', async () => {
  await guestIn(mail());
  const [t] = await threads();
  const requestId = crypto.randomUUID();
  await as(STAYS);
  const started = await rpc('workspace_guest_inbox_action', [{ action: 'sendReply', requestId, threadId: t.id, body: 'Check in is from 3pm.' }]);
  assert.equal(started.send, true);
  assert.equal(started.source, 'email');
  assert.equal(started.email.to, 'guest.one@example.org');
  assert.equal(started.email.subject, 'Re: Question about check in');
  assert.equal(started.email.references.length, 1);
  assert.match(started.email.inReplyTo, /^in-/);
  // Pressed again while it is going out: nothing is sent a second time.
  const again = await rpc('workspace_guest_inbox_action', [{ action: 'sendReply', requestId, threadId: t.id, body: 'Check in is from 3pm.' }]);
  assert.equal(again.send, false);
  assert.equal((await messages()).filter(m => m.direction === 'team').length, 0, 'nothing stored before Resend accepted it');
  // Resend refused: nothing is stored, and a retry may send.
  await asBackend();
  await rpc('workspace_email_reply_result', [{ requestId, ok: false, error: 'Resend said no' }]);
  assert.equal((await messages()).filter(m => m.direction === 'team').length, 0);
  await as(STAYS);
  assert.equal((await rpc('workspace_guest_inbox_action', [{ action: 'sendReply', requestId, threadId: t.id, body: 'Check in is from 3pm.' }])).send, true);
  await asBackend();
  const sentId = 'out-1@rechargegroup.co.uk';
  assert.deepEqual(await rpc('workspace_email_reply_result', [{ requestId, ok: true, resendId: 'r_1', messageId: `<${sentId}>` }]), { recorded: true });
  assert.deepEqual(await rpc('workspace_email_reply_result', [{ requestId, ok: true, resendId: 'r_1', messageId: `<${sentId}>` }]), { recorded: false }, 'a repeated result changes nothing');
  const team = (await messages()).filter(m => m.direction === 'team');
  assert.equal(team.length, 1);
  assert.equal(team[0].body, 'Check in is from 3pm.');
  assert.equal(team[0].author_user_id, users[STAYS]);
  // The guest answers from a mail app that sets In-Reply-To to our Message-ID, from a different address: same conversation.
  const next = await guestIn(mail({ from: 'guest.alias@example.org', inReplyTo: `<${sentId}>`, text: 'Thanks!' }));
  assert.equal(next.matched, 'reply');
  assert.equal((await threads()).length, 1);
  // A Hostaway conversation still behaves as before, and a manual one still cannot be replied to by email.
  await as(ADMIN);
  await rpc('workspace_guest_inbox_action', [{ action: 'logMessage', requestId: crypto.randomUUID(), channel: 'whatsapp', guestName: 'Sam', body: 'Hi' }]);
  const [{ id: manual }] = await sql("select id from private.workspace_guest_threads where source='manual'");
  await assert.rejects(rpc('workspace_guest_inbox_action', [{ action: 'sendReply', requestId: crypto.randomUUID(), threadId: manual, body: 'Hello' }]), /Only Hostaway conversations/);
});

test('spam and failed authentication are recorded as dropped, without content, and never stored', async () => {
  const input = { emailId: 'em_drop_1', mailbox: 'guest', from: 'Bad@Example.org', reason: 'dmarc fail' };
  await asBackend();
  assert.deepEqual(await rpc('workspace_email_drop', [input]), { recorded: true });
  assert.deepEqual(await rpc('workspace_email_drop', [input]), { recorded: false });
  const [row] = await sql("select mailbox,outcome,reason,from_address from private.workspace_email_inbound where email_id='em_drop_1'");
  assert.deepEqual(row, { mailbox: 'guest', outcome: 'dropped', reason: 'dmarc fail', from_address: 'bad@example.org' });
  assert.equal((await messages()).length, 0);
  await assert.rejects(rpc('workspace_email_drop', [{ ...input, mailbox: 'x' }]), /Invalid email drop/);
  await assert.rejects(rpc('workspace_email_drop', [{ ...input, body: 'no content kept' }]), /Invalid email drop/);
  await assert.rejects(guestIn(mail({ from: 'not an address' })), /Invalid sender/);
  await assert.rejects(guestIn({ ...mail(), unexpected: true }), /Invalid email/);
});

test('owner email goes into that owner\'s conversation; an unknown sender waits for Client relations', async () => {
  const sent = await ownerIn(mail({ from: 'MAIL6@example.com', fromName: 'Owner Person', subject: 'Boiler', text: 'The boiler is making a noise.' }));
  assert.deepEqual(sent, { stored: true, matched: 'owner' });
  const [conv] = await sql("select id,owner_id from private.chat_conversations where kind='owner'");
  assert.equal(conv.owner_id, users[OWNER]);
  const [msg] = await sql('select author_id,body from private.chat_messages where conversation_id=$1', [conv.id]);
  assert.equal(msg.author_id, users[OWNER]);
  assert.match(msg.body, /Boiler\n\nThe boiler is making a noise\./);
  // Admins and the client relations rota are told; the owner is not.
  const told = (await sql(`select distinct o.user_id from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where a.event_type='chat.owner_message'`)).map(r => users.indexOf(r.user_id));
  assert.ok(told.includes(ADMIN) && told.includes(CLIENT_REL));
  assert.ok(!told.includes(OWNER) && !told.includes(OTHER_OWNER));
  // The same email again adds nothing.
  const again = mail({ from: 'mail6@example.com' });
  await ownerIn(again);
  assert.deepEqual(await ownerIn(again), { duplicate: true });
  // An unknown address is held, not matched by name even when the name is the owner's.
  const unknown = await ownerIn(mail({ from: 'someone@elsewhere.org', fromName: 'Person 6', subject: 'Hello', text: 'I own a flat.' }));
  assert.equal(unknown.matched, 'unknown');
  assert.equal((await sql("select count(*)::int n from private.chat_messages"))[0].n, 2, 'the unknown sender is not in any conversation');
  await as(CLIENT_REL);
  const list = await rpc('workspace_email_unknown_read');
  assert.equal(list.senders.length, 1);
  assert.equal(list.senders[0].from, 'someone@elsewhere.org');
  for (const who of [STAYS, OWNER, CLEANER, READY, ACCOUNTS]) {
    await as(who);
    await assert.rejects(rpc('workspace_email_unknown_read'), /Client relations access required/, 'role ' + who);
  }
  // Assigning posts it to the owner's conversation and remembers the address.
  await as(CLIENT_REL);
  await assert.rejects(rpc('workspace_email_unknown_action', [{ action: 'assign', id: list.senders[0].id, ownerId: users[STAYS] }]), /Owner not found/);
  await rpc('workspace_email_unknown_action', [{ action: 'assign', id: list.senders[0].id, ownerId: users[OWNER] }]);
  assert.equal((await sql("select count(*)::int n from private.chat_messages"))[0].n, 3);
  assert.equal((await rpc('workspace_email_unknown_read')).senders.length, 0);
  assert.deepEqual(await ownerIn(mail({ from: 'someone@elsewhere.org' })), { stored: true, matched: 'owner' });
});

test('a team reply to an owner who wrote by email is queued once and sent through the outbox once', async () => {
  await ownerIn(mail({ from: 'mail6@example.com', subject: 'Boiler', messageId: '<owner-1@mail.example.com>' }));
  const [conv] = await sql("select id from private.chat_conversations where kind='owner'");
  await as(CLIENT_REL);
  await rpc('workspace_chat_action', [{ action: 'send', requestId: crypto.randomUUID(), conversationId: conv.id, body: 'We will send an engineer.' }]);
  assert.equal((await sql('select count(*)::int n from private.workspace_email_outbox'))[0].n, 1);
  await asBackend();
  const [row] = await rpc('workspace_email_outbox_claim', [10]);
  assert.equal(row.to, 'mail6@example.com');
  assert.equal(row.subject, 'Re: Boiler');
  assert.equal(row.inReplyTo, 'owner-1@mail.example.com');
  assert.deepEqual(await rpc('workspace_email_outbox_claim', [10]), [], 'a claimed row is not handed out again');
  await rpc('workspace_email_outbox_result', [{ id: row.id, ok: true, messageId: '<own-out-1@rechargegroup.co.uk>' }]);
  assert.deepEqual(await rpc('workspace_email_outbox_result', [{ id: row.id, ok: true, messageId: '<other@x>' }]), { recorded: false });
  assert.equal((await sql("select status from private.workspace_email_outbox"))[0].status, 'sent');
  // A failure goes back to pending (up to 5 tries); an owner's own message, or one in the app, queues nothing.
  await as(OWNER);
  await rpc('workspace_chat_action', [{ action: 'send', requestId: crypto.randomUUID(), conversationId: conv.id, body: 'In the app now' }]);
  await as(CLIENT_REL);
  await rpc('workspace_chat_action', [{ action: 'send', requestId: crypto.randomUUID(), conversationId: conv.id, body: 'Reply to the app message' }]);
  assert.equal((await sql('select count(*)::int n from private.workspace_email_outbox'))[0].n, 1, 'their latest message came through the app, so the reply stays in the app');
});
