import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// The management bonus split, round 8 (20261018300000): admins set Guest relations' share of the combined measure (0 to
// 100, Client relations gets the rest, 50 when unset). Every migration is applied in order; this one again to prove a second
// run changes nothing.
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
const { teamsActionSchema, teamsReadSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { kpiReadSchema } = await vite.ssrLoadModule('/lib/kpis.ts');

const MINE = '20261018300000_management_bonus_weighting';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const files = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
assert.ok(files.includes(MINE + '.sql'));
for (const file of files) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const SIGS = ['private.workspace_kpi_action(jsonb)', 'private.workspace_kpi_view(private.workspace_kpis,boolean)', 'private.workspace_kpi_result(private.workspace_kpis,jsonb)', 'private.workspace_kpi_weighted(jsonb,integer)'];
const snapshot = async () => ({
  defs: await Promise.all(SIGS.map(async sig => (await db.query('select pg_get_functiondef($1::regprocedure) def', [sig])).rows[0].def)),
  columns: (await db.query("select column_name,data_type,is_nullable from information_schema.columns where table_schema='private' and table_name='workspace_kpis' order by ordinal_position")).rows,
});
const firstRun = await snapshot();
await db.exec(await fs.readFile(`supabase/migrations/${MINE}.sql`, 'utf8'));
const secondRun = await snapshot();
after(async () => { await db.close(); await vite.close(); });

const roles = ['admin', 'stays', 'stays', 'stays'];
const names = ['Ada Admin', 'Mo Manager', 'Cal Client', 'Gail Guest'];
const [ADMIN, MANAGER, CLIENT1, GUEST] = roles.map((_, i) => i);
const users = roles.map((_, i) => `97500000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('9750', '9760');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `split${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], names[i]]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
for (const [who, department] of [[MANAGER, 'management'], [CLIENT1, 'client_relations'], [GUEST, 'guest_relations']])
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
const bonusRow = async () => (await owner("select * from private.workspace_kpis where seed_key='management_score'"))[0];
const bonusId = (await bonusRow()).id;
const mine = read => read.people.find(p => p.userId === users[MANAGER]).results.find(r => r.kpiId === bonusId);
const parts = r => r.parts.map(x => [x.area, x.value, x.share]);
// The save the admin form sends, with the KPI's current version.
const save = async (patch, who = ADMIN, raw = false) => {
  const k = await bonusRow();
  const input = { action: 'saveKpi', requestId: crypto.randomUUID(), kpiId: k.id, version: k.version, name: k.name, area: k.area, measure: k.measure, minutes: null,
    targetPercent: k.target_percent, bonusTiers: k.bonus_tiers, countsForBonus: k.counts_for_bonus, placeholder: k.placeholder, ...patch };
  await as(who);
  return rpc('workspace_teams_action', [raw ? input : teamsActionSchema.parse(input)]);
};

// Guest relations: 1 of 2 settled waits answered within 5 minutes (50%). Client relations: two days worked, two sign-offs (100%)
// with sign-offs as the only daily target. So at 50/50 the bonus is 75.
const at = minutes => new Date(Date.now() - minutes * 60000).toISOString();
const msg = (thread, direction, minutes) => ({ externalId: `${thread}-${direction}-${minutes}`, threadRef: thread, channel: 'airbnb', direction, sentAt: at(minutes) });
await as('service');
await rpc('workspace_guest_messages_ingest', [{ source: 'split', messages: [msg('s1', 'guest', 100), msg('s1', 'team', 98), msg('s2', 'guest', 90), msg('s2', 'team', 70)] }]);
await owner(`update private.workspace_performance_targets set daily_targets='{"signOffs":1,"listingChecks":0,"pricingDecisions":0,"reviewsLogged":0}'`);
for (const d of [TWO_AGO, YESTERDAY]) {
  await owner(`insert into private.workspace_shifts(user_id,department,clocked_in_at,clocked_out_at,request_id)
    values($1,'client_relations',($2::date+time '10:00') at time zone 'Europe/London',($2::date+time '12:00') at time zone 'Europe/London',gen_random_uuid())`, [users[CLIENT1], d]);
  await owner("insert into private.workspace_daily_signoffs(user_id,day,confirmations,snapshot) values($1,$2,'{}','{}')", [users[CLIENT1], d]);
}

test('the migration runs twice without change', () => assert.deepEqual(secondRun, firstRun));

test('unset, the split is 50/50: the value, each part\'s share, and the share the KPI list shows', async () => {
  assert.equal((await bonusRow()).guest_share, null);
  await as(MANAGER);
  const read = await kpis(), r = mine(read);
  assert.deepEqual(parts(r), [['guest_relations', 50, 50], ['client_relations', 100, 50]]);
  assert.equal(r.value, 75);
  assert.equal(read.kpis.find(k => k.id === bonusId).guestShare, 50);
  assert.ok(read.kpis.filter(k => k.measure !== 'teams_combined').every(k => k.guestShare === null), 'other measures carry no share');
});

test('70/30: the maths, the tier, the history row, and an edit that leaves the share out keeps it', async () => {
  const before = await bonusRow();
  const saved = await save({ guestShare: 70 });
  assert.equal(saved.guestShare, 70);
  await as(MANAGER);
  const r = mine(await kpis());
  // floor((50 x 70 + 100 x 30) / 100) = floor(65) = 65: short of the 80 target.
  assert.deepEqual([r.value, r.onTarget, ...parts(r)], [65, false, ['guest_relations', 50, 70], ['client_relations', 100, 30]]);
  const log = await owner("select change,before->>'guest_share' b,after->>'guest_share' a,changed_by from private.workspace_kpi_changes where kpi_id=$1 order by id desc limit 1", [bonusId]);
  assert.deepEqual(log, [{ change: 'edited', b: before.guest_share === null ? null : String(before.guest_share), a: '70', changed_by: users[ADMIN] }]);
  // 0 and 100: one team only, while both are measured.
  await save({ guestShare: 0 }); await as(MANAGER);
  assert.equal(mine(await kpis()).value, 100);
  await save({ guestShare: 100 }); await as(MANAGER);
  assert.equal(mine(await kpis()).value, 50);
  // An edit that does not send the share (an older app) keeps it.
  await save({ guestShare: 70 });
  const k = await bonusRow();
  await as(ADMIN);
  await rpc('workspace_teams_action', [{ action: 'saveKpi', requestId: crypto.randomUUID(), kpiId: k.id, version: k.version, name: k.name, area: k.area, measure: k.measure, minutes: null,
    targetPercent: 75, bonusTiers: k.bonus_tiers, countsForBonus: k.counts_for_bonus, placeholder: k.placeholder }]);
  assert.deepEqual([(await bonusRow()).guest_share, (await bonusRow()).target_percent], [70, 75]);
  await save({ targetPercent: 80 });
});

test('one team with nothing to measure: the other counts alone, whatever the split, and no share is shown for the gap', async () => {
  await save({ guestShare: 70 });
  await owner("update private.workspace_guest_messages set sent_at=sent_at-interval '30 days'");
  await as(MANAGER);
  const r = mine(await kpis());
  assert.deepEqual([r.value, ...parts(r).map(x => x.slice(0, 2))], [100, ['guest_relations', null], ['client_relations', 100]]);
  await owner("update private.workspace_guest_messages set sent_at=sent_at+interval '30 days'");
});

test('the share is a whole percentage from 0 to 100, on the combined measure only', async () => {
  for (const bad of [101, -1, 50.5, '50', true]) await assert.rejects(save({ guestShare: bad }, ADMIN, true), /whole percentage from 0 to 100/, JSON.stringify(bad));
  for (const bad of [101, -1, 50.5]) assert.equal(teamsActionSchema.safeParse({ action: 'saveKpi', requestId: crypto.randomUUID(), name: 'X y', area: 'management', measure: 'teams_combined', targetPercent: 80, bonusTiers: [], countsForBonus: false, placeholder: false, guestShare: bad }).success, false);
  await as(ADMIN);
  await assert.rejects(rpc('workspace_teams_action', [teamsActionSchema.parse({ action: 'saveKpi', requestId: crypto.randomUUID(), name: 'Score with a share', area: 'management', measure: 'performance_score',
    targetPercent: null, bonusTiers: [], countsForBonus: false, placeholder: false, guestShare: 60 })]), /Only the combined measure takes a Guest relations share/);
  // Moving the KPI to another measure clears its share.
  await save({ guestShare: 60 });
  await save({ measure: 'performance_score', guestShare: undefined });
  assert.deepEqual([(await bonusRow()).measure, (await bonusRow()).guest_share], ['performance_score', null]);
  await save({ measure: 'teams_combined', guestShare: 70 });
  assert.equal((await bonusRow()).guest_share, 70);
});

test('only admins change the split', async () => {
  for (const who of [MANAGER, CLIENT1, GUEST]) await assert.rejects(save({ guestShare: 20 }, who), /Only admins change the KPIs/, names[who]);
  assert.equal((await bonusRow()).guest_share, 70);
});
