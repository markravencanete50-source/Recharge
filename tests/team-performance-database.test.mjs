import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Team performance: clocking in and out, and guest reply times credited to whoever was on
// guest relations: green within 5 minutes, amber within 10, red after; 90% green is on track.
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
const { teamsActionSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { myShiftSchema, teamPerformanceSchema } = await vite.ssrLoadModule('/lib/management-live.ts');

const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
after(async () => { await db.close(); await vite.close(); });

const roles = ['admin', 'stays', 'stays', 'client'];
const users = roles.map((_, i) => `99100000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('9910', '9920');
const [ADMIN, ANNA, BEN, CLIENT] = [0, 1, 2, 3];
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `perf${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], ['Admin', 'Anna', 'Ben', 'Owner'][i]]);
}
async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
async function asBackend() {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims','',false)");
  await db.exec('set role service_role');
}
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const act = input => rpc('workspace_teams_action', [teamsActionSchema.parse({ requestId: crypto.randomUUID(), ...input })]);
const read = (section, from = null, to = null) => rpc('workspace_teams_read', [section, from, to, null, null]);
const today = (await db.query("select (now() at time zone 'Europe/London')::date::text d")).rows[0].d;
// Messages up to 200 minutes old can fall on yesterday, so reports cover yesterday and today.
const yesterday = (await db.query("select ((now() at time zone 'Europe/London')::date-1)::text d")).rows[0].d;
const ago = minutes => new Date(Date.now() - minutes * 60000).toISOString();

test('team members clock in and out; one open shift each; owners cannot', async () => {
  await as(ANNA);
  const shift = await act({ action: 'clockIn', department: 'guest_relations' });
  assert.equal(shift.department, 'guest_relations');
  await assert.rejects(act({ action: 'clockIn', department: 'guest_relations' }), /already clocked in/);
  let mine = myShiftSchema.parse(await read('shift'));
  assert.equal(mine.open.id, shift.id);
  const out = await act({ action: 'clockOut' });
  assert.ok(out.clockedOutAt);
  await assert.rejects(act({ action: 'clockOut' }), /not clocked in/);
  mine = myShiftSchema.parse(await read('shift'));
  assert.deepEqual([mine.open, mine.today.length], [null, 1]);
  await as(CLIENT);
  await assert.rejects(act({ action: 'clockIn', department: 'guest_relations' }), /Team access required/);
  assert.throws(() => teamsActionSchema.parse({ action: 'clockIn', requestId: crypto.randomUUID(), department: 'beach' }));
});

test('guest replies are graded and credited to whoever was on guest relations', async () => {
  // Anna worked the last two hours; Ben clocked in 30 minutes ago (still on shift).
  await db.query("insert into private.workspace_shifts(user_id,department,clocked_in_at,clocked_out_at,request_id) values($1,'guest_relations',$2,$3,gen_random_uuid()),($4,'guest_relations',$5,null,gen_random_uuid())",
    [users[ANNA], ago(120), ago(31), users[BEN], ago(30)]);
  const message = (thread, direction, minutes, n) => ({ externalId: `${thread}-${n}`, threadRef: thread, channel: 'airbnb', direction, sentAt: ago(minutes) });
  await as(ANNA);
  await assert.rejects(rpc('workspace_guest_messages_ingest', [{ source: 'test', messages: [] }]), /permission denied/);
  await asBackend();
  const ingest = await rpc('workspace_guest_messages_ingest', [{ source: 'test', messages: [
    // Anna: a 3-minute reply (green), a follow-up in the same wait not counted twice, a 7-minute reply (amber).
    message('t1', 'guest', 100, 1), message('t1', 'guest', 99, 2), message('t1', 'team', 97, 3),
    message('t2', 'guest', 90, 1), message('t2', 'team', 83, 2),
    // Anna: a later question in t1 answered in 2 minutes (green).
    message('t1', 'guest', 60, 4), message('t1', 'team', 58, 5),
    // Ben: no reply after 20 minutes (red); a message 3 minutes ago still within time (not counted yet).
    message('t3', 'guest', 20, 1), message('t4', 'guest', 3, 1),
    // Before anyone clocked in: nobody on shift.
    message('t5', 'guest', 200, 1), message('t5', 'team', 199, 2)] }]);
  assert.equal(ingest.added, 11);
  assert.equal((await rpc('workspace_guest_messages_ingest', [{ source: 'test', messages: [message('t1', 'guest', 100, 1)] }])).added, 0, 'stored once');

  await as(ADMIN);
  const report = teamPerformanceSchema.parse(await read('teamPerformance', yesterday, today));
  const anna = report.people.find(x => x.fullName === 'Anna'), ben = report.people.find(x => x.fullName === 'Ben');
  assert.deepEqual([anna.green, anna.amber, anna.red, anna.percentGreen, anna.onTrack, anna.bonusTier], [2, 1, 0, 66, false, null]);
  assert.deepEqual([ben.green, ben.amber, ben.red, ben.onTrack], [0, 0, 1, false]);
  assert.deepEqual(report.unassigned, { green: 1, amber: 0, red: 0 });
  assert.equal(anna.shifts, 2);
  assert.ok(anna.minutes >= 89 && anna.minutes <= 91, String(anna.minutes));
  assert.deepEqual(report.onShift.map(s => s.fullName), ['Ben']);
  assert.equal(report.people.some(x => x.fullName === 'Owner'), false);

  // Looser targets put Anna on track and into the first bonus tier.
  await act({ action: 'saveTargets', version: report.targets.version, greenMinutes: 8, amberMinutes: 15, passPercent: 90, bonusPercents: [95, 100] });
  const looser = teamPerformanceSchema.parse(await read('teamPerformance', yesterday, today)).people.find(x => x.fullName === 'Anna');
  assert.deepEqual([looser.green, looser.percentGreen, looser.onTrack, looser.bonusTier], [3, 100, true, 100]);
  await assert.rejects(act({ action: 'saveTargets', version: report.targets.version, greenMinutes: 5, amberMinutes: 10, passPercent: 90, bonusPercents: [95, 100] }), /Targets changed/);

  // Team members see only their own line; admins close a forgotten shift.
  await as(BEN);
  assert.deepEqual(teamPerformanceSchema.parse(await read('teamPerformance', yesterday, today)).people.map(x => x.fullName), ['Ben']);
  await assert.rejects(act({ action: 'closeShift', shiftId: report.onShift[0].id, endedAt: new Date().toISOString() }), /Management access required/);
  await as(ADMIN);
  await act({ action: 'closeShift', shiftId: report.onShift[0].id, endedAt: new Date().toISOString() });
  assert.deepEqual(teamPerformanceSchema.parse(await read('teamPerformance', yesterday, today)).onShift, []);
  await assert.rejects(read('teamPerformance', today, null), /Choose up to 92 days/);
});
