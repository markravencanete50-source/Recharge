import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Team feedback: admins and Stays send it under their own name, only super admins read the inbox,
// mark it seen or done and reply, and everyone hears what they should.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { teamsActionSchema, teamsReadSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { feedbackSchema, feedbackCounts, canSendFeedback } = await vite.ssrLoadModule('/lib/team-feedback.ts');
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const roles = ['super_admin', 'admin', 'stays', 'cleans', 'accounts', 'client', 'super_admin'];
const names = ['Mark', 'Maria', 'Dan', 'Ewan', 'Ava', 'Owner', 'Alex'];
const users = roles.map((_, i) => `97600000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, STAYS, CLEANS, ACCOUNTS, CLIENT, SUPER2] = roles.map((_, i) => i);
const session = i => users[i].replace('9760', '9860');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `feedback${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], names[i]]);
}
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
const owner = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const act = async input => rpc('workspace_teams_action', [teamsActionSchema.parse({ requestId: crypto.randomUUID(), ...input })]);
const read = async () => { teamsReadSchema.parse({ section: 'feedback' }); return feedbackSchema.parse(await rpc('workspace_teams_read', ['feedback', null, null, null, null])); };
const notified = async (i, event) => (await owner('select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.user_id=$1 and a.event_type=$2', [users[i], event]))[0].n;
after(async () => { await db.close(); await vite.close(); });

test('admins and Stays send feedback; only super admins read the inbox', async () => {
  assert.ok(canSendFeedback('admin') && canSendFeedback('stays') && !canSendFeedback('super_admin') && !canSendFeedback('cleans'));
  await as(ADMIN);
  const sent = await act({ action: 'sendFeedback', category: 'idea', message: '  Could the rota show bank holidays?  ' });
  assert.equal(sent.message, 'Could the rota show bank holidays?'); assert.equal(sent.status, 'new'); assert.equal(sent.senderName, 'Maria');
  await as(STAYS);
  await act({ action: 'sendFeedback', category: 'problem', message: 'The guest inbox is slow in the mornings.' });
  assert.equal((await read()).items.length, 1, 'Stays sees only what they sent');
  assert.equal((await read()).canSend, true);

  for (const i of [CLEANS, ACCOUNTS, CLIENT]) {
    await as(i);
    await assert.rejects(read(), /Feedback access required/, roles[i]);
    await assert.rejects(act({ action: 'sendFeedback', category: 'other', message: 'Can I send this?' }), /Only admins and the Stays team/, roles[i]);
  }
  await as(SUPER);
  await assert.rejects(act({ action: 'sendFeedback', category: 'other', message: 'Super admins receive it' }), /Only admins and the Stays team/);
  const inbox = await read();
  assert.equal(inbox.inbox, true); assert.equal(inbox.canSend, false);
  assert.deepEqual(inbox.items.map(i => [i.senderName, i.category]), [['Dan', 'problem'], ['Maria', 'idea']], 'newest first, always named');
  assert.deepEqual(feedbackCounts(inbox.items), { new: 2, seen: 0, done: 0, all: 2 });
  // Every super admin hears about each piece; nobody else does.
  assert.equal(await notified(SUPER, 'feedback.received'), 2); assert.equal(await notified(SUPER2, 'feedback.received'), 2);
  assert.equal(await notified(ADMIN, 'feedback.received'), 0);
  // An admin can't handle feedback, even their own.
  await as(ADMIN);
  await assert.rejects(act({ action: 'updateFeedback', feedbackId: sent.id, version: 1, status: 'done', reply: 'Self-approved' }), /Only a super admin/);
  // Nothing reaches the table directly.
  await assert.rejects(db.query('select * from private.workspace_feedback'), /permission denied/);
});

test('super admins mark it seen or done and reply; the sender sees the reply and hears about it', async () => {
  await as(ADMIN);
  const sent = await act({ action: 'sendFeedback', category: 'praise', message: 'The new clock card is great.' });
  await as(SUPER);
  let item = await act({ action: 'updateFeedback', feedbackId: sent.id, version: sent.version, status: 'seen' });
  assert.equal(item.status, 'seen'); assert.equal(item.handledByName, 'Mark'); assert.equal(item.reply, '');
  assert.equal(await notified(ADMIN, 'feedback.replied'), 0, 'marking it seen sends nothing');
  await as(SUPER);
  await assert.rejects(act({ action: 'updateFeedback', feedbackId: sent.id, version: sent.version, status: 'done' }), /Changed by someone else/);
  item = await act({ action: 'updateFeedback', feedbackId: sent.id, version: item.version, status: 'done', reply: ' Thanks Maria, glad it helps! ' });
  assert.equal(item.status, 'done'); assert.equal(item.reply, 'Thanks Maria, glad it helps!'); assert.equal(item.repliedByName, 'Mark');
  assert.equal(await notified(ADMIN, 'feedback.replied'), 1);
  // Changing only the status again doesn't send another reply notice.
  await as(SUPER);
  item = await act({ action: 'updateFeedback', feedbackId: sent.id, version: item.version, status: 'seen', reply: 'Thanks Maria, glad it helps!' });
  assert.equal(await notified(ADMIN, 'feedback.replied'), 1);
  await as(ADMIN);
  const mine = (await read()).items.find(i => i.id === sent.id);
  assert.equal(mine.reply, 'Thanks Maria, glad it helps!'); assert.equal(mine.status, 'seen');
  await as(SUPER);
  await assert.rejects(act({ action: 'updateFeedback', feedbackId: crypto.randomUUID(), version: 1, status: 'done' }), /Feedback not found/);
  assert.throws(() => teamsActionSchema.parse({ action: 'sendFeedback', requestId: crypto.randomUUID(), category: 'idea', message: 'hi' }), 'too short');
  assert.throws(() => teamsActionSchema.parse({ action: 'sendFeedback', requestId: crypto.randomUUID(), category: 'idea', message: 'Long enough', anonymous: true }), 'no extra fields');
});

test('feedback is limited to ten an hour per person', async () => {
  await as(STAYS);
  const before = (await read()).items.length;
  for (let n = before; n < 10; n++) { await act({ action: 'sendFeedback', category: 'other', message: `Note number ${n}` }); await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); await as(STAYS); }
  await assert.rejects(act({ action: 'sendFeedback', category: 'other', message: 'One too many' }), /a lot of feedback in one hour/);
});
