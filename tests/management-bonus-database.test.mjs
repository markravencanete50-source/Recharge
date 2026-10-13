import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// The management bonus, round 6 (20261016310000): Guest relations and Client relations combined. The guest part is every
// guest message answered within the green minutes, the client part the client relations team's daily work, the value
// their average (one alone when the other has nothing, none when neither has). Only admins and managers get it, with no
// names. Every migration is applied in order; this one again to prove a second run changes nothing.
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
const { teamsActionSchema, teamsReadSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { kpiReadSchema } = await vite.ssrLoadModule('/lib/kpis.ts');

const MINE = '20261016310000_management_bonus_combined';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const files = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
assert.ok(files.includes(MINE + '.sql'));
// The second run is checked before the later migrations: 20261018300000 replaces workspace_kpi_result, which this one patched.
const upTo = files.indexOf(MINE + '.sql');
for (const file of files.slice(0, upTo + 1)) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const SIGS = ['private.workspace_kpi_measures()', 'private.workspace_kpi_teams_combined(date,date)', 'private.workspace_kpi_person_value(text,integer,uuid,date,date,jsonb)',
  'private.workspace_kpi_team_value(text,integer,uuid[],date,date,jsonb)', 'private.workspace_kpi_result(private.workspace_kpis,jsonb)'];
const snapshot = async () => ({
  defs: await Promise.all(SIGS.map(async sig => (await db.query('select pg_get_functiondef($1::regprocedure) def', [sig])).rows[0].def)),
  kpi: (await db.query("select measure,name,version from private.workspace_kpis where seed_key='management_score'")).rows,
  changes: (await db.query('select count(*)::int n from private.workspace_kpi_changes')).rows[0].n,
});
const firstRun = await snapshot();
await db.exec(await fs.readFile(`supabase/migrations/${MINE}.sql`, 'utf8'));
const secondRun = await snapshot();
for (const file of files.slice(upTo + 1)) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
after(async () => { await db.close(); await vite.close(); });

// A manager is anyone whose rota department is management (here a stays user); admins are managers by role.
const roles = ['super_admin', 'admin', 'stays', 'stays', 'stays', 'stays', 'cleans', 'ready', 'client'];
const names = ['Alex Super', 'Ada Admin', 'Mo Manager', 'Gail Guest', 'Cal Client', 'Cora Client', 'Cara Cleaner', 'Rex Ready', 'Owen Owner'];
const [SUPER, ADMIN, MANAGER, GUEST, CLIENT1, CLIENT2, CLEANER, READY, OWNER] = roles.map((_, i) => i);
const users = roles.map((_, i) => `97300000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('9730', '9740');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `mgmtbonus${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], names[i]]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
for (const [who, department] of [[MANAGER, 'management'], [GUEST, 'guest_relations'], [CLIENT1, 'client_relations'], [CLIENT2, 'client_relations']])
  await db.query("insert into private.workspace_staff_rota(user_id,department,usual_shift) values($1,$2,'early')", [users[who], department]);
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify(i === 'service' ? {} : { sub: users[i], session_id: session(i) })]);
  await db.exec(i === 'service' ? 'set role service_role' : 'set role authenticated');
}
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const owner = async (text, args = []) => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); return (await db.query(text, args)).rows; };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const day = async offset => (await db.query(`select ((now() at time zone 'Europe/London')::date+${offset})::text d`)).rows[0].d;
const [TWO_AGO, YESTERDAY, TOMORROW] = [await day(-2), await day(-1), await day(1)];
const kpis = async () => kpiReadSchema.parse(await rpc('workspace_teams_read', [teamsReadSchema.parse({ section: 'kpis', from: TWO_AGO, to: TOMORROW }).section, TWO_AGO, TOMORROW, null, null]));
const bonusId = (await owner("select id from private.workspace_kpis where seed_key='management_score'"))[0].id;
const mine = (read, who) => read.people.find(p => p.userId === users[who])?.results.find(r => r.kpiId === bonusId);
const team = read => read.teams.find(t => t.area === 'management')?.results.find(r => r.kpiId === bonusId);
const parts = r => r.parts.map(x => [x.area, x.value]);

test('the migration runs twice without change', () => assert.deepEqual(secondRun, firstRun));

test('the seeded management bonus KPI is now Guest relations and Client relations combined, still a placeholder at 80, 90, 95', async () => {
  const [k] = await owner("select name,area,measure,minutes,direction,target_percent,bonus_tiers,counts_for_bonus,placeholder,active,version from private.workspace_kpis where seed_key='management_score'");
  assert.deepEqual(k, { name: 'Guest relations and Client relations, combined', area: 'management', measure: 'teams_combined', minutes: null, direction: 'higher',
    target_percent: 80, bonus_tiers: [90, 95], counts_for_bonus: true, placeholder: true, active: true, version: 2 });
  const log = await owner("select change,before->>'measure' b,after->>'measure' a,changed_by from private.workspace_kpi_changes where kpi_id=$1 order by id", [bonusId]);
  assert.deepEqual(log, [{ change: 'seeded', b: null, a: 'performance_score', changed_by: null }, { change: 'edited', b: 'performance_score', a: 'teams_combined', changed_by: null }]);
  const measure = (await owner("select e from jsonb_array_elements(private.workspace_kpi_measures()) e where e->>'key'='teams_combined'"))[0].e;
  assert.deepEqual(measure, { key: 'teams_combined', label: 'Guest relations and Client relations, combined', needsMinutes: false, direction: 'higher', areas: ['management'] });
});

test('neither team has anything to measure: no value, both parts empty', async () => {
  await as(MANAGER);
  const r = mine(await kpis(), MANAGER);
  assert.deepEqual([r.value, r.measured, r.onTarget, r.tier], [null, 0, null, null]);
  assert.deepEqual(parts(r), [['guest_relations', null], ['client_relations', null]]);
});

test('only guest relations has something: the guest figure alone', async () => {
  // Every guest message counts, whoever was on shift: 2 of 4 answered within the green 5 minutes, plus one too new to judge.
  const at = minutes => new Date(Date.now() - minutes * 60000).toISOString();
  const msg = (thread, direction, minutes) => ({ externalId: `${thread}-${direction}-${minutes}`, threadRef: thread, channel: 'airbnb', direction, sentAt: at(minutes) });
  await as('service');
  await rpc('workspace_guest_messages_ingest', [{ source: 'mgmt', messages: [msg('g1', 'guest', 100), msg('g1', 'team', 98), msg('g2', 'guest', 90), msg('g2', 'team', 87),
    msg('g3', 'guest', 80), msg('g3', 'team', 72), msg('g4', 'guest', 70), msg('g4', 'team', 50), msg('g5', 'guest', 1)] }]);
  await as(MANAGER);
  const r = mine(await kpis(), MANAGER);
  assert.deepEqual([r.value, r.measured], [50, 4]);
  assert.deepEqual(parts(r), [['guest_relations', 50], ['client_relations', null]]);
});

test('both teams: the average of the two, rounded down', async () => {
  // Client relations daily work on sign-offs only: Cal worked two days and signed off one (50%), Cora one of one (100%).
  await owner(`update private.workspace_performance_targets set daily_targets='{"signOffs":1,"listingChecks":0,"pricingDecisions":0,"reviewsLogged":0}'`);
  const shift = (who, d) => owner(`insert into private.workspace_shifts(user_id,department,clocked_in_at,clocked_out_at,request_id)
    values($1,'client_relations',($2::date+time '10:00') at time zone 'Europe/London',($2::date+time '12:00') at time zone 'Europe/London',gen_random_uuid())`, [users[who], d]);
  await shift(CLIENT1, TWO_AGO); await shift(CLIENT1, YESTERDAY); await shift(CLIENT2, YESTERDAY);
  for (const who of [CLIENT1, CLIENT2]) await owner("insert into private.workspace_daily_signoffs(user_id,day,confirmations,snapshot) values($1,$2,'{}','{}')", [users[who], YESTERDAY]);
  await as(MANAGER);
  const read = await kpis();
  const r = mine(read, MANAGER);
  // Guest 50, client (50 + 100) / 2 = 75, combined (50 + 75) / 2 = 62.5, rounded down.
  assert.deepEqual(parts(r), [['guest_relations', 50], ['client_relations', 75]]);
  assert.deepEqual([r.value, r.measured, r.onTarget, r.tier], [62, 6, false, null]);
  assert.deepEqual(parts(team(read)), parts(r), 'the management team row shows the same');
  assert.equal(team(read).value, 62);
  // Only client relations: guest messages from outside the period do not count, so the client figure stands alone.
  await owner('update private.workspace_guest_messages set sent_at=sent_at-interval \'30 days\'');
  await as(MANAGER);
  const clientOnly = mine(await kpis(), MANAGER);
  assert.deepEqual([clientOnly.value, ...parts(clientOnly)], [75, ['guest_relations', null], ['client_relations', 75]]);
  await owner('update private.workspace_guest_messages set sent_at=sent_at+interval \'30 days\'');
});

test('only admins and managers get the team figures, and never a name', async () => {
  for (const who of [SUPER, ADMIN]) {
    await as(who);
    const read = await kpis();
    // Admins see every manager's bonus (the same team figure) and the management team row.
    for (const m of [SUPER, ADMIN, MANAGER]) assert.equal(mine(read, m).value, 62, `${names[who]} sees ${names[m]}`);
    assert.equal(team(read).value, 62);
  }
  await as(MANAGER);
  const manager = await kpis();
  assert.deepEqual(manager.people.map(p => p.userId), [users[MANAGER]], 'a manager sees only themself');
  assert.deepEqual(manager.teams.map(t => t.area), ['management']);
  const partsJson = JSON.stringify(mine(manager, MANAGER).parts);
  for (const name of names) assert.ok(!partsJson.includes(name) && !partsJson.includes(name.split(' ')[0]), `no ${name} in the parts`);
  assert.ok(mine(manager, MANAGER).parts.every(x => Object.keys(x).sort().join() === 'area,measured,share,value'), 'an area, its figure, its count and its share (20261018300000): no names');
  // Guest relations, client relations, cleaners and Ready get nothing new: no management result and no parts anywhere.
  for (const who of [GUEST, CLIENT1, CLEANER, READY]) {
    await as(who);
    const read = await kpis();
    assert.ok(!JSON.stringify(read.people).includes('"parts"') && !JSON.stringify(read.teams).includes('"parts"'), names[who]);
    assert.ok(!read.teams.some(t => t.area === 'management'), names[who]);
  }
  // Owners are refused the read altogether.
  await as(OWNER);
  await assert.rejects(rpc('workspace_teams_read', ['kpis', TWO_AGO, TOMORROW, null, null]), /Team access required/);
  // The measure itself is not callable from the app, and it checks the caller again: anyone else gets no value.
  await as(GUEST);
  await assert.rejects(db.query('select private.workspace_kpi_teams_combined($1,$2)', [TWO_AGO, TOMORROW]), /permission denied/);
  for (const who of [GUEST, CLIENT1, CLEANER, READY, OWNER]) {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[who], session_id: session(who) })]);
    const v = (await db.query('select private.workspace_kpi_teams_combined($1,$2) v', [TWO_AGO, TOMORROW])).rows[0].v;
    assert.deepEqual(v, { value: null, measured: 0 }, names[who]);
  }
});

test('admins can add the measure to management only', async () => {
  await as(ADMIN);
  const act = input => rpc('workspace_teams_action', [teamsActionSchema.parse({ requestId: crypto.randomUUID(), ...input })]);
  const saved = await act({ action: 'saveKpi', name: 'Teams combined, tracked', area: 'management', measure: 'teams_combined', targetPercent: null, bonusTiers: [], countsForBonus: false, placeholder: false });
  assert.equal(saved.measure, 'teams_combined');
  await as(ADMIN);
  await assert.rejects(act({ action: 'saveKpi', name: 'Wrong area', area: 'guest_relations', measure: 'teams_combined', targetPercent: null, bonusTiers: [], countsForBonus: false, placeholder: false }), /does not fit this area/);
  // Any other measure's result carries no parts.
  const read = await kpis();
  const guestTeam = read.teams.find(t => t.area === 'guest_relations');
  assert.ok(guestTeam.results.every(r => r.parts === undefined));
});
