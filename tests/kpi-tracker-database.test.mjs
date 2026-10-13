import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// The KPI tracker (20261015100000): admins keep a list of KPIs per area, one of them counting for the bonus; every
// change is recorded with who made it; each measure is worked out per person and per team for a period.
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
const { teamsActionSchema, teamsReadSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { kpiReadSchema } = await vite.ssrLoadModule('/lib/kpis.ts');
const { teamPerformanceSchema } = await vite.ssrLoadModule('/lib/management-live.ts');

const NAME = '20261015100000_kpi_tracker.sql';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
after(async () => { await db.close(); await vite.close(); });

const roles = ['super_admin', 'admin', 'stays', 'stays', 'cleans', 'cleans', 'cleaning_manager', 'accounts', 'client'];
const names = ['Alex Super', 'Ada Admin', 'Anna Stays', 'Ben Stays', 'Cara Cleaner', 'Cleo Cleaner', 'Mia Manager', 'Abe Accounts', 'Owen Owner'];
const [SUPER, ADMIN, ANNA, BEN, CARA, CLEO, MIA, ACCOUNTS, OWNER] = roles.map((_, i) => i);
const users = roles.map((_, i) => `97100000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('9710', '9720');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `kpi${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], names[i]]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify(i === 'service' ? {} : { sub: users[i], session_id: session(i) })]);
  await db.exec(i === 'service' ? 'set role service_role' : 'set role authenticated');
}
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const owner = async (text, args = []) => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); return (await db.query(text, args)).rows; };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const act = input => rpc('workspace_teams_action', [teamsActionSchema.parse({ requestId: crypto.randomUUID(), ...input })]);
const day = async offset => (await db.query(`select ((now() at time zone 'Europe/London')::date+${offset})::text d`)).rows[0].d;
const [YESTERDAY, TODAY, TOMORROW] = [await day(-1), await day(0), await day(1)];
const kpis = async (from = YESTERDAY, to = TOMORROW) => kpiReadSchema.parse(await rpc('workspace_teams_read', [teamsReadSchema.parse({ section: 'kpis', from, to }).section, from, to, null, null]));
const seeded = async key => (await owner('select * from private.workspace_kpis where seed_key=$1', [key]))[0];
const result = (row, kpiId) => row.results.find(r => r.kpiId === kpiId);

// ---------------------------------------------------------------- fixtures
// Guest relations: Anna on shift for the last five hours, Ben for an earlier stretch. One base time, so each wait is exact.
const base = Date.now();
const ago = minutes => new Date(base - minutes * 60000).toISOString();
await owner("insert into private.workspace_shifts(user_id,department,clocked_in_at,clocked_out_at,request_id) values($1,'guest_relations',$2,null,gen_random_uuid()),($3,'guest_relations',$4,$5,gen_random_uuid())",
  [users[ANNA], ago(300), users[BEN], ago(600), ago(400)]);
const msg = (thread, direction, minutes) => ({ externalId: `${thread}-${direction}-${minutes}`, threadRef: thread, channel: 'airbnb', direction, sentAt: ago(minutes) });
await as('service');
await rpc('workspace_guest_messages_ingest', [{ source: 'kpi', messages: [
  // Anna: answered after 3, 7, 20, 45 and 90 minutes; one waiting about 100 minutes; one waiting 2 minutes (too soon to judge).
  msg('a1', 'guest', 200), msg('a1', 'team', 197), msg('a2', 'guest', 190), msg('a2', 'team', 183), msg('a3', 'guest', 180), msg('a3', 'team', 160),
  msg('a4', 'guest', 170), msg('a4', 'team', 125), msg('a5', 'guest', 150), msg('a5', 'team', 60), msg('a6', 'guest', 100), msg('a7', 'guest', 2),
  // Ben: three answered within 2 minutes.
  msg('b1', 'guest', 590), msg('b1', 'team', 589), msg('b2', 'guest', 580), msg('b2', 'team', 578), msg('b3', 'guest', 570), msg('b3', 'team', 569)] }]);

// Cleaning: Cara has a form in on time, one in after a reminder, one missing, one due tomorrow and a cancelled one; Cleo one on time.
await as(SUPER);
const property = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'KPI flat', address: '1 KPI Street, Leith', region: 'Edinburgh', bedrooms: 2 }]);
const clean = (cleaner, due, data, status = 'waiting') => owner(`with w as (insert into public.workspace_work_items(request_id,property_id,module_id,title,created_by,assignee_id,due_on,status)
   values(gen_random_uuid(),$1,'cleaning-schedule','KPI clean',$2,$3,$4::date,$6) returning id)
  insert into private.workspace_domain_details(work_id,kind,data) select id,'cleaning',$5::jsonb from w`, [property, users[SUPER], users[cleaner], due, JSON.stringify({ checklist: ['Kitchen'], ...data }), status]);
const submitted = cleaner => ({ phase: 'review', submittedBy: users[cleaner], report: 'All done and checked' });
await clean(CARA, YESTERDAY, submitted(CARA), 'in_review');
await clean(CARA, YESTERDAY, { ...submitted(CARA), unsubmittedAt: '2026-01-01T18:05:00.000Z' }, 'in_review');
await clean(CARA, YESTERDAY, { phase: 'assigned', unsubmittedAt: '2026-01-01T18:05:00.000Z' });
await clean(CARA, TOMORROW, { phase: 'assigned' });
await clean(CARA, YESTERDAY, { phase: 'assigned' }, 'cancelled');
await clean(CLEO, YESTERDAY, submitted(CLEO), 'in_review');

// ---------------------------------------------------------------- tests
test('the seed: Alex\'s guest relations scheme from the old targets, one placeholder bonus KPI for every other area', async () => {
  const targets = (await owner('select pass_percent,bonus_percents from private.workspace_performance_targets'))[0];
  const rows = await owner("select seed_key,name,area,measure,minutes,direction,target_percent,bonus_tiers,counts_for_bonus,placeholder,active from private.workspace_kpis where seed_key is not null order by area,sort_order");
  const gr = rows.find(r => r.seed_key === 'guest_reply_within_5');
  assert.deepEqual([gr.name, gr.measure, gr.minutes, gr.direction, gr.target_percent, gr.bonus_tiers, gr.counts_for_bonus, gr.placeholder],
    ['Replies within 5 minutes', 'guest_reply_within', 5, 'higher', targets.pass_percent, targets.bonus_percents.filter(b => b > targets.pass_percent), true, false]);
  for (const [key, minutes, direction] of [['guest_reply_within_10', 10, 'higher'], ['guest_reply_within_30', 30, 'higher'], ['guest_reply_within_60', 60, 'higher'], ['guest_reply_over_60', 60, 'lower']]) {
    const r = rows.find(x => x.seed_key === key);
    assert.deepEqual([r.minutes, r.direction, r.target_percent, r.bonus_tiers, r.counts_for_bonus], [minutes, direction, null, [], false], key);
  }
  const others = rows.filter(r => r.area !== 'guest_relations');
  assert.deepEqual(others.map(r => [r.area, r.measure]), [['accounts', 'performance_score'], ['cleaning', 'clean_forms_on_time'], ['client_relations', 'daily_work_done'], ['management', 'performance_score'], ['ready', 'performance_score']]);
  assert.ok(others.every(r => r.target_percent === 80 && r.bonus_tiers.join() === '90,95' && r.counts_for_bonus && r.placeholder && r.active));
  assert.equal((await owner("select count(*)::int n from private.workspace_kpi_changes where change='seeded' and changed_by is null"))[0].n, 10, 'each seeded row is in the change log');
  // On the live database (pass 80, tiers 90 and 95) the same rule gives Alex's 80, 90 and 95.
  const live = (await owner(`select array(select distinct b from unnest(array[90,95]) b where b>80 order by b) tiers`))[0].tiers;
  assert.deepEqual(live, [90, 95]);
});

test('guest reply measures: within and over N minutes, settled waits only, rounded against the person', async () => {
  await as(ADMIN);
  const read = await kpis();
  const anna = read.people.find(p => p.userId === users[ANNA]), ben = read.people.find(p => p.userId === users[BEN]);
  const ids = Object.fromEntries(await Promise.all(['guest_reply_within_5', 'guest_reply_within_10', 'guest_reply_within_30', 'guest_reply_within_60', 'guest_reply_over_60'].map(async k => [k, (await seeded(k)).id])));
  // Six waits are settled (five answered, one waiting about 100 minutes); the 2-minute wait is not counted yet.
  assert.deepEqual(Object.values(ids).map(id => [result(anna, id).value, result(anna, id).measured, result(anna, id).count]), [[16, 6, 1], [33, 6, 2], [50, 6, 3], [66, 6, 4], [34, 6, 2]]);
  const five = result(anna, ids.guest_reply_within_5);
  assert.deepEqual([five.onTarget, five.tier, five.tierAt], [false, null, null]);
  // Tracking-only KPIs have no target, so nothing is on or off target.
  assert.deepEqual([result(anna, ids.guest_reply_over_60).onTarget, result(anna, ids.guest_reply_within_30).onTarget], [null, null]);
  // Ben: everything within 2 minutes reaches the top tier.
  const top = result(ben, ids.guest_reply_within_5), gr = await seeded('guest_reply_within_5');
  assert.deepEqual([top.value, top.onTarget, top.tier, top.tierAt], [100, true, gr.bonus_tiers.length, Math.max(...gr.bonus_tiers)]);
  // The breakdown: the same sums, plus how many are still waiting.
  assert.deepEqual(anna.guestReplies.bands.map(b => [b.key, b.minutes, b.count, b.measured, b.value]),
    [['within5', 5, 1, 6, 16], ['within10', 10, 2, 6, 33], ['within30', 30, 3, 6, 50], ['within60', 60, 4, 6, 66], ['over60', 60, 2, 6, 34]]);
  assert.deepEqual([anna.guestReplies.waits, anna.guestReplies.stillWaiting], [7, 2]);
  // The team counts every guest message: Anna's and Ben's.
  const team = read.teams.find(t => t.area === 'guest_relations');
  assert.deepEqual([result(team, ids.guest_reply_within_5).value, result(team, ids.guest_reply_within_5).measured], [44, 9]);
  assert.deepEqual([team.guestReplies.waits, team.guestReplies.stillWaiting], [10, 2]);
});

test('the reply rows match the Team performance reply times, and the score matches its score', async () => {
  const rows = await owner(`select message_id::text id,user_id::text u from private.workspace_kpi_reply_rows(now()-interval '1 day',now()+interval '1 day') x,private.workspace_performance_targets t
    where x.answered or x.minutes>t.amber_minutes order by 1`);
  const old = await owner(`select message_id::text id,user_id::text u from private.workspace_response_rows(now()-interval '1 day',now()+interval '1 day') order by 1`);
  assert.deepEqual(rows, old);
  await as(ADMIN);
  const perf = teamPerformanceSchema.parse(await rpc('workspace_teams_read', ['teamPerformance', YESTERDAY, TOMORROW, null, null]));
  const kpi = (await owner("insert into private.workspace_kpis(name,area,measure,direction) values('Score check','guest_relations','performance_score','higher') returning id"))[0].id;
  await as(ADMIN);
  const read = await kpis();
  for (const who of [ANNA, BEN]) assert.equal(result(read.people.find(p => p.userId === users[who]), kpi).value, perf.people.find(p => p.userId === users[who]).score, names[who]);
  await owner('delete from private.workspace_kpis where id=$1', [kpi]);
});

test('cleaning forms in on time, per cleaner and for the team; nothing to measure is null, never 0%', async () => {
  const id = (await seeded('cleaning_forms_on_time')).id;
  await as(ADMIN);
  const read = await kpis();
  const at = who => result(read.people.find(p => p.userId === users[who]), id);
  // Cara: on time, late after a reminder, missing; tomorrow's is not due and the cancelled one is left out.
  assert.deepEqual([at(CARA).value, at(CARA).measured, at(CARA).count, at(CARA).onTarget], [33, 3, 1, false]);
  assert.deepEqual([at(CLEO).value, at(CLEO).measured, at(CLEO).tier], [100, 1, 2]);
  assert.deepEqual([at(MIA).value, at(MIA).measured, at(MIA).onTarget, at(MIA).tier], [null, 0, null, null], 'the cleaning manager has no cleans');
  const team = read.teams.find(t => t.area === 'cleaning');
  assert.deepEqual([result(team, id).value, result(team, id).measured, team.members], [50, 4, 3]);
  // Ready, accounts and management have nothing to score yet.
  const accounts = read.people.find(p => p.userId === users[ACCOUNTS]);
  assert.equal(accounts.area, 'accounts');
  assert.deepEqual(accounts.results.map(r => r.value), [null]);
  // A window with nothing in it.
  const empty = await kpis('2020-01-01', '2020-01-07');
  assert.ok(empty.people.every(p => p.results.every(r => r.value === null && r.measured === 0)));
});

test('admins add, edit, switch off and reorder KPIs; every change is recorded with who made it', async () => {
  await as(ADMIN);
  const made = await act({ action: 'saveKpi', name: 'Replies within 15 minutes', area: 'guest_relations', measure: 'guest_reply_within', minutes: 15, targetPercent: 70, bonusTiers: [80], countsForBonus: false, placeholder: false });
  assert.deepEqual([made.name, made.direction, made.targetPercent, made.bonusTiers, made.active, made.version, made.updatedByName], ['Replies within 15 minutes', 'higher', 70, [80], true, 1, 'Ada Admin']);
  // Edited by the super admin: the last change shows who.
  await as(SUPER);
  const edited = await act({ action: 'saveKpi', kpiId: made.id, version: 1, name: 'Replies within 15 min', area: 'guest_relations', measure: 'guest_reply_within', minutes: 15, targetPercent: 75, bonusTiers: [85, 80], countsForBonus: false, placeholder: true });
  assert.deepEqual([edited.version, edited.targetPercent, edited.bonusTiers, edited.placeholder, edited.updatedByName], [2, 75, [80, 85], true, 'Alex Super']);
  await assert.rejects(act({ action: 'saveKpi', kpiId: made.id, version: 1, name: 'Stale', area: 'guest_relations', measure: 'guest_reply_within', minutes: 15, targetPercent: 75, bonusTiers: [], countsForBonus: false, placeholder: false }), /Changed by someone else/);
  // Lower is better: tiers sit below the target.
  const over = await act({ action: 'saveKpi', name: 'Waiting over 30 minutes', area: 'guest_relations', measure: 'guest_reply_over', minutes: 30, targetPercent: 10, bonusTiers: [5], countsForBonus: false, placeholder: false });
  assert.equal(over.direction, 'lower');
  const bad = { action: 'saveKpi', name: 'Bad', area: 'guest_relations', measure: 'guest_reply_within', minutes: 5, targetPercent: 80, bonusTiers: [], countsForBonus: false, placeholder: false };
  await assert.rejects(act({ ...bad, measure: 'guest_reply_over', bonusTiers: [90] }), /must be below the target/);
  await assert.rejects(act({ ...bad, bonusTiers: [70] }), /must be above the target/);
  await assert.rejects(act({ ...bad, minutes: null }), /Set the minutes/);
  await assert.rejects(act({ ...bad, measure: 'performance_score' }), /takes no minutes/);
  await assert.rejects(act({ ...bad, area: 'ready', measure: 'clean_forms_on_time', minutes: undefined }), /does not fit this area/);
  await assert.rejects(act({ ...bad, targetPercent: null, bonusTiers: [90] }), /Set a target before the bonus tiers/);
  // History: created then edited, each with its author and the row before and after.
  const log = await owner('select change,changed_by::text by,before->>\'target_percent\' b,after->>\'target_percent\' a from private.workspace_kpi_changes where kpi_id=$1 order by id', [made.id]);
  assert.deepEqual(log.map(l => [l.change, l.by, l.b, l.a]), [['created', users[ADMIN], null, '70'], ['edited', users[SUPER], '70', '75']]);
  // Reorder within the area: the new KPI is last; it moves up past the one above it.
  await as(ADMIN);
  const order = async () => (await kpis()).kpis.filter(k => k.area === 'guest_relations').map(k => k.name);
  assert.deepEqual((await order()).slice(-2), ['Replies within 15 min', 'Waiting over 30 minutes']);
  const current = (await kpis()).kpis.find(k => k.id === over.id);
  const moved = await act({ action: 'moveKpi', kpiId: over.id, version: current.version, direction: 'up' });
  assert.deepEqual((await order()).slice(-2), ['Waiting over 30 minutes', 'Replies within 15 min']);
  const first = (await kpis()).kpis.find(k => k.area === 'guest_relations');
  await assert.rejects(act({ action: 'moveKpi', kpiId: first.id, version: first.version, direction: 'up' }), /already first/);
  assert.equal(moved.version, current.version + 1);
  // Switch off: staff no longer see it, admins still do, and it is recorded.
  const latest = (await kpis()).kpis.find(k => k.id === made.id);
  const off = await act({ action: 'setKpiActive', kpiId: made.id, version: latest.version, active: false });
  assert.equal(off.active, false);
  await assert.rejects(act({ action: 'setKpiActive', kpiId: made.id, version: off.version, active: false }), /already off/);
  assert.equal((await kpis()).kpis.find(k => k.id === made.id).active, false);
  await as(ANNA);
  assert.equal((await kpis()).kpis.some(k => k.id === made.id), false);
  assert.ok((await owner("select 1 from private.workspace_kpi_changes where kpi_id=$1 and change='switched_off' and changed_by=$2", [made.id, users[ADMIN]])).length);
  // A repeated request returns the same answer and changes nothing twice.
  await as(ADMIN);
  const again = { action: 'setKpiActive', requestId: crypto.randomUUID(), kpiId: made.id, version: off.version, active: true };
  const on1 = await rpc('workspace_teams_action', [again]), on2 = await rpc('workspace_teams_action', [again]);
  assert.deepEqual(on1, on2); assert.equal(on1.active, true);
});

test('one bonus KPI per area: a second one is refused until the first is unticked or switched off', async () => {
  await as(ADMIN);
  const second = { action: 'saveKpi', name: 'Replies within 10 minutes (bonus)', area: 'guest_relations', measure: 'guest_reply_within', minutes: 10, targetPercent: 85, bonusTiers: [90], countsForBonus: true, placeholder: false };
  await assert.rejects(act(second), /Only one KPI in each area counts for the bonus. Untick "Replies within 5 minutes" first/);
  // Ready: switch the seeded bonus KPI off (it stops counting), then another can count.
  const ready = (await kpis()).kpis.find(k => k.area === 'ready' && k.countsForBonus);
  const off = await act({ action: 'setKpiActive', kpiId: ready.id, version: ready.version, active: false });
  assert.equal(off.countsForBonus, false);
  const replaced = await act({ action: 'saveKpi', name: 'Ready score', area: 'ready', measure: 'performance_score', targetPercent: 70, bonusTiers: [80, 90], countsForBonus: true, placeholder: true });
  assert.equal(replaced.countsForBonus, true);
  // Switching the old one back on does not make two bonus KPIs.
  const on = await act({ action: 'setKpiActive', kpiId: ready.id, version: off.version, active: true });
  assert.equal(on.countsForBonus, false);
  await assert.rejects(act({ action: 'saveKpi', kpiId: ready.id, version: on.version, name: 'Performance score', area: 'ready', measure: 'performance_score', targetPercent: 80, bonusTiers: [90, 95], countsForBonus: true, placeholder: true }), /Untick "Ready score" first/);
  assert.equal((await owner('select count(*)::int n from private.workspace_kpis where area=$1 and counts_for_bonus and active', ['ready']))[0].n, 1);
  // The database holds the rule too, whatever writes the row.
  await assert.rejects(owner("update private.workspace_kpis set counts_for_bonus=true where id=$1", [ready.id]), /workspace_kpis_one_bonus_idx/);
});

test('staff see only themself and their own area; staff and owners cannot change KPIs', async () => {
  await as(ANNA);
  const mine = await kpis();
  assert.deepEqual([mine.canEdit, mine.myArea, mine.people.map(p => p.userId), mine.teams.map(t => t.area), mine.changes], [false, 'guest_relations', [users[ANNA]], ['guest_relations'], []]);
  assert.ok(mine.kpis.every(k => k.active && k.updatedByName === undefined));
  await as(CARA);
  const cleaner = await kpis();
  assert.deepEqual([cleaner.myArea, cleaner.people.length, cleaner.people[0].guestReplies, cleaner.teams.map(t => t.area)], ['cleaning', 1, null, ['cleaning']]);
  const change = { action: 'saveKpi', name: 'Mine', area: 'cleaning', measure: 'clean_forms_on_time', targetPercent: 10, bonusTiers: [], countsForBonus: false, placeholder: false };
  for (const who of [ANNA, CARA, MIA, ACCOUNTS]) { await as(who); await assert.rejects(act(change), /Only admins change the KPIs/, names[who]); }
  await as(OWNER);
  await assert.rejects(act(change), /Team access required/);
  await assert.rejects(rpc('workspace_teams_read', ['kpis', YESTERDAY, TODAY, null, null]), /Team access required/);
  await as(ADMIN);
  await assert.rejects(rpc('workspace_teams_read', ['kpis', '2026-01-01', '2026-06-01', null, null]), /Choose up to 92 days/);
  assert.equal(teamsReadSchema.safeParse({ section: 'kpis', from: '2026-01-01', to: '2026-06-01' }).success, false);
  assert.equal(teamsReadSchema.safeParse({ section: 'kpis' }).success, false);
});

test('the migration runs twice without adding or changing anything', async () => {
  const count = async () => (await owner('select (select count(*)::int from private.workspace_kpis) k,(select count(*)::int from private.workspace_kpi_changes) c'))[0];
  const before = await count();
  await db.exec('reset role');
  await db.exec(await fs.readFile('supabase/migrations/' + NAME, 'utf8'));
  assert.deepEqual(await count(), before);
  for (const [fn, needle] of [['private.workspace_teams_read(text,date,date,uuid,uuid)', 'workspace_kpis_read('], ['private.workspace_teams_action(jsonb)', 'workspace_kpi_action(']]) {
    const d = (await owner('select pg_get_functiondef($1::regprocedure) d', [fn]))[0].d;
    assert.equal(d.split(needle).length - 1, 1, fn);
  }
});
