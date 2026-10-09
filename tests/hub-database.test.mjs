import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// The hub's own rows: to-dos for a person or a department (with a notification), approval tickets
// that only management decides, AirCover claims and invoices to send, each seen by the right people.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { teamsActionSchema, hubSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const roles = ['super_admin', 'stays', 'stays', 'cleans', 'accounts', 'client'];
const users = roles.map((_, i) => `97400000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [ADMIN, DAN, ERIC, ANGELA, ACCOUNTS, OWNER] = roles.map((_, i) => i);
const session = i => users[i].replace('9740', '9840');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `hub${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], ['Admin', 'Dan', 'Eric', 'Angela', 'Accounts', 'Owner'][i]]);
}
// Dan and Eric are both client relations.
for (const i of [DAN, ERIC]) await db.query("insert into private.workspace_staff_rota(user_id,department,usual_shift) values($1,'client_relations','early')", [users[i]]);
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
const owner = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const act = async input => rpc('workspace_teams_action', [teamsActionSchema.parse({ requestId: crypto.randomUUID(), ...input })]);
const hub = async () => hubSchema.parse(await rpc('workspace_teams_read', ['hub', null, null, null, null]));
const notified = async (i, event) => (await owner('select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.user_id=$1 and a.event_type=$2', [users[i], event]))[0].n;
after(async () => { await db.close(); await vite.close(); });

test('to-dos: your own, your department\'s, and the admin sees everyone\'s', async () => {
  await as(ADMIN);
  const forDan = await act({ action: 'saveHubItem', kind: 'todo', title: 'Send the onboarding pack to 2 Holmhead Place', assigneeId: users[DAN], dueOn: '2026-10-12' });
  assert.equal(forDan.status, 'open'); assert.equal(forDan.assigneeName, 'Dan');
  const forTeam = await act({ action: 'saveHubItem', kind: 'todo', title: 'Call back every owner who messaged today', department: 'client_relations' });
  assert.equal(forTeam.assigneeId, null);
  assert.equal(await notified(DAN, 'hub.todo_added'), 2, 'Dan hears about his own and his department\'s');
  assert.equal(await notified(ERIC, 'hub.todo_added'), 1);
  await as(ANGELA);
  const own = await act({ action: 'saveHubItem', kind: 'todo', title: 'Buy more bin bags' });
  assert.equal(own.assigneeId, users[ANGELA], 'no one chosen: it is yours');
  assert.deepEqual((await hub()).items.map(i => i.title), ['Buy more bin bags']);
  await as(ERIC);
  assert.deepEqual((await hub()).items.map(i => i.title).sort(), ['Call back every owner who messaged today']);
  await assert.rejects(act({ action: 'moveHubItem', id: forDan.id, version: forDan.version, status: 'done' }), /not found/);
  await as(DAN);
  assert.equal((await hub()).items.length, 2);
  const done = await act({ action: 'moveHubItem', id: forDan.id, version: forDan.version, status: 'done' });
  assert.equal(done.status, 'done');
  assert.equal(await notified(ADMIN, 'hub.todo_done'), 1, 'whoever set it hears it is done');
  await as(ADMIN);
  assert.equal((await hub()).items.filter(i => i.kind === 'todo').length, 3);
  await as(OWNER);
  await assert.rejects(hub(), /Team access/);
});

test('approval tickets: raised with an amount, decided only by management', async () => {
  assert.throws(() => teamsActionSchema.parse({ action: 'saveHubItem', requestId: crypto.randomUUID(), kind: 'approval', title: 'New hoover' }), /amount/);
  await as(ANGELA);
  const ticket = await act({ action: 'saveHubItem', kind: 'approval', title: 'New hoover for the Leith flats', amountMinor: 14999, details: 'The old one broke' });
  assert.equal(ticket.status, 'pending');
  assert.equal(await notified(ADMIN, 'hub.approval_added'), 1);
  await assert.rejects(act({ action: 'moveHubItem', id: ticket.id, version: ticket.version, status: 'approved' }), /Only management/);
  await as(DAN);
  assert.equal((await hub()).items.some(i => i.id === ticket.id), false, 'others do not see someone else\'s ticket');
  await as(ADMIN);
  await assert.rejects(act({ action: 'moveHubItem', id: ticket.id, version: ticket.version, status: 'declined' }), /why/);
  const ok = await act({ action: 'moveHubItem', id: ticket.id, version: ticket.version, status: 'approved', note: 'Go ahead' });
  assert.equal(ok.decidedBy, 'Admin');
  assert.equal(await notified(ANGELA, 'hub.approval_approved'), 1);
  await assert.rejects(act({ action: 'moveHubItem', id: ticket.id, version: ok.version, status: 'declined', note: 'Changed my mind' }), /pending/);
});

test('AirCover claims and invoices to send are kept by the right teams', async () => {
  await as(DAN);
  const claim = await act({ action: 'saveHubItem', kind: 'aircover', title: 'Red wine on the sofa', amountMinor: 32000, reference: 'HMABCD1234', link: 'https://www.airbnb.co.uk/resolutions/123' });
  assert.equal(claim.status, 'to_claim');
  const paid = await act({ action: 'moveHubItem', id: claim.id, version: claim.version, status: 'paid', settledMinor: 28000 });
  assert.equal(paid.settledMinor, 28000);
  await assert.rejects(act({ action: 'saveHubItem', kind: 'invoice', title: 'Onboarding fee', amountMinor: 25000 }), /cannot keep/);
  await assert.rejects(act({ action: 'saveHubItem', kind: 'aircover', title: 'Broken lamp', link: 'http://insecure.example.com' }), /./);
  await as(ACCOUNTS);
  assert.ok((await hub()).items.some(i => i.id === claim.id), 'Accounts sees the claims');
  const invoice = await act({ action: 'saveHubItem', kind: 'invoice', title: 'Onboarding fee, Holmhead flat', amountMinor: 25000, link: 'https://in.xero.com/abc' });
  assert.equal(invoice.status, 'to_send');
  await as(ANGELA);
  await assert.rejects(act({ action: 'saveHubItem', kind: 'aircover', title: 'Broken lamp' }), /cannot keep/);
  assert.equal((await hub()).items.some(i => i.kind === 'invoice' || i.kind === 'aircover'), false);
});
