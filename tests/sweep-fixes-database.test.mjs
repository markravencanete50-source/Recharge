import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Fixes from the end-to-end sweep: who can see what, names people can set for themselves, and inputs
// the app accepts that the database used to refuse.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { teamsActionSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { journeyViewSchema } = await vite.ssrLoadModule('/lib/workspace-view.ts');
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const roles = ['super_admin', 'stays', 'client', 'client'];
const users = roles.map((_, i) => `97500000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [ADMIN, DAN, OWNER, OTHER_OWNER] = roles.map((_, i) => i);
const session = i => users[i].replace('9750', '9850');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `sweep${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], ['Admin', 'Dan', 'Owner', 'Other owner'][i]]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
await db.query("insert into private.workspace_staff_rota(user_id,department,usual_shift) values($1,'client_relations','early')", [users[DAN]]);
const PROP = (await db.query('insert into public.workspace_properties(name,created_by,request_id) values($1,$2,gen_random_uuid()) returning id', ['Harbour Flat', users[ADMIN]])).rows[0].id;
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
const sql = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const act = async input => rpc('workspace_teams_action', [teamsActionSchema.parse({ requestId: crypto.randomUUID(), ...input })]);
after(async () => { await db.close(); await vite.close(); });

test('a to-do for another department, with no one assigned, cannot be moved by someone outside it', async () => {
  await as(ADMIN);
  const item = await act({ action: 'saveHubItem', kind: 'todo', title: 'Chase the October payouts', department: 'accounts' });
  await as(DAN);
  await assert.rejects(act({ action: 'moveHubItem', id: item.id, version: item.version, status: 'done' }), /not found/);
  assert.equal((await sql('select status from private.workspace_hub_items where id=$1', [item.id]))[0].status, 'open');
});

test('a name set at sign-up reaches the profile; later changes to sign-in details do not', async () => {
  const fresh = '97500000-0000-4000-8000-000000000099';
  await sql('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [fresh, 'new@example.com']);
  await sql(`update auth.users set raw_user_meta_data=$2 where id=$1`, [fresh, { display_name: 'Morag‮ Reid\u0007', avatar_preset: 'sage' }]);
  assert.deepEqual((await sql('select full_name,avatar_preset,status from public.workspace_profiles where user_id=$1', [fresh]))[0], { full_name: 'Morag Reid', avatar_preset: 'sage', status: 'pending' });
  // An active team member renaming themselves through their sign-in details.
  await sql(`update auth.users set raw_user_meta_data=$2 where id=$1`, [users[DAN], { display_name: 'Admin', avatar_preset: 'plum' }]);
  assert.deepEqual((await sql('select full_name,avatar_preset from public.workspace_profiles where user_id=$1', [users[DAN]]))[0], { full_name: 'Dan', avatar_preset: 'plum' });
});

test('training for everyone means the team, not owners; long courses save', async () => {
  await as(ADMIN);
  const body = 'Step by step. '.repeat(1500);
  assert.ok(body.length > 20000);
  await act({ action: 'saveCourse', title: 'Linen standards', audience: ['all'], body, minutes: 15, published: true });
  await as(DAN);
  assert.match(JSON.stringify(await rpc('workspace_teams_read', ['training', null, null, null, null])), /Linen standards/);
  await as(OWNER);
  const seen = await rpc('workspace_teams_read', ['training', null, null, null, null]).catch(() => null);
  assert.doesNotMatch(JSON.stringify(seen), /Linen standards/);
  const [course] = await sql("select id from private.workspace_training_courses where title='Linen standards'");
  await sql("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[OWNER], session_id: session(OWNER) })]);
  assert.equal((await sql('select private.workspace_course_visible($1) v', [course.id]))[0].v, false);
});

test('an invoice task closes only through its own action', async () => {
  const work = (await sql(`insert into public.workspace_work_items(request_id,property_id,module_id,title,created_by) values(gen_random_uuid(),$1,'maintenance-reconciliation','Reconcile repair',$2) returning id,version`, [PROP, users[ADMIN]]))[0];
  await sql("insert into private.workspace_domain_details(work_id,kind,data) values($1,'maintenance_invoice','{}')", [work.id]);
  await as(ADMIN);
  await assert.rejects(rpc('workspace_transition_work', [work.id, work.version, 'in_progress', '', crypto.randomUUID()]), /Use the workflow action/);
});

test('a leftover rota row never lets an owner into another owner\'s chat', async () => {
  await sql("insert into private.workspace_staff_rota(user_id,department,usual_shift) values($1,'client_relations','early')", [users[OTHER_OWNER]]);
  const team = async (owner, subject) => (await sql('select private.chat_owner_team($1,$2) t', [users[owner], users[subject]]))[0].t;
  assert.equal(await team(OWNER, OTHER_OWNER), false);
  assert.equal(await team(OWNER, DAN), true);
});

test('a journey the team started (no owner yet) still reads', async () => {
  const work = (await sql(`insert into public.workspace_work_items(request_id,property_id,module_id,title,created_by) values(gen_random_uuid(),$1,'property-onboarding','Onboarding',$2) returning id`, [PROP, users[ADMIN]]))[0].id;
  await sql("insert into private.workspace_journeys(property_id,client_id,work_id,property_type,bathrooms) values($1,null,$2,'Flat',1)", [PROP, work]);
  await sql("insert into private.workspace_journey_questions(property_id,asked_by,question) values($1,$2,'Is there parking?')", [PROP, users[DAN]]);
  const [row] = await sql('select private.workspace_journey_view(j) v from private.workspace_journeys j where j.work_id=$1', [work]);
  assert.equal(row.v.questions[0].askedByOwner, false);
  journeyViewSchema.parse(row.v);
});

test('hub amounts above the database limit are refused by the app first', () => {
  assert.equal(teamsActionSchema.safeParse({ action: 'saveHubItem', requestId: crypto.randomUUID(), kind: 'invoice', title: 'Big invoice', amountMinor: 10000001 }).success, false);
});
