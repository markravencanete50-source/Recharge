import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Changeovers (migration 20261031200000): replenishable stock per property, counted and used on each clean, with a restock
// request when a counted item falls below its minimum; the form is late after 14:45; and the housekeeper adds to an open
// repair instead of reporting it twice. Only the housekeeper on the clean, or the team, and the migration runs twice.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { teamsActionSchema, teamsReadSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const C = await vite.ssrLoadModule('/lib/changeover.ts');
const MINE = '20261031200000_changeover_standards.sql';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const files = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
assert.ok(files.includes(MINE));
for (const file of files) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));

const roles = ['admin', 'cleans', 'cleans', 'client', 'cleaning_manager'];
const users = roles.map((_, i) => `97760000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [ADMIN, KEEPER, OTHER_KEEPER, OWNER, MANAGER] = roles.map((_, i) => i);
const NAMES = ['Morag', 'Kirsty', 'Ailsa', 'Jamie Owner', 'Calum'];
const session = i => users[i].replace('9776', '9876');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `change${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], NAMES[i]]);
  await db.query('insert into private.workspace_onboarding_done(user_id) values($1) on conflict do nothing', [users[i]]);
}
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
const sql = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const act = async (i, input) => { await as(i); return rpc('workspace_teams_action', [teamsActionSchema.parse({ requestId: crypto.randomUUID(), ...input })]); };
const raw = async (i, input) => { await as(i); return rpc('workspace_teams_action', [{ requestId: crypto.randomUUID(), ...input }]); };
const read = async (i, workId, propertyId) => { teamsReadSchema.parse({ section: 'changeover', ...(workId ? { workId } : { propertyId }) }); await as(i); return C.changeoverReadSchema.parse(await rpc('workspace_changeover_read', [workId ?? null, propertyId ?? null])); };
const notified = async (i, event) => (await sql('select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.user_id=$1 and a.event_type=$2', [users[i], event]))[0].n;
after(async () => { await db.close(); await vite.close(); });

const PROP = (await sql("insert into public.workspace_properties(name,address,status,bedrooms,created_by,request_id) values('Leith flat','1 Leith Walk, Edinburgh EH6 5AB','active',2,$1,gen_random_uuid()) returning id", [users[ADMIN]]))[0].id;
const OTHER = (await sql("insert into public.workspace_properties(name,address,status,bedrooms,created_by,request_id) values('Glasgow flat','1 George Sq, Glasgow G2 1DU','active',1,$1,gen_random_uuid()) returning id", [users[ADMIN]]))[0].id;
for (const [i, prop, as] of [[KEEPER, PROP, 'cleaner'], [OTHER_KEEPER, OTHER, 'cleaner'], [MANAGER, PROP, 'cleaning_manager'], [MANAGER, OTHER, 'cleaning_manager']])
  await sql('insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values($1,$2,$3,$4) on conflict do nothing', [prop, users[i], as, users[ADMIN]]);
// A status changed behind the workflow (a restock done, a repair finished), as the app's own steps would.
const finish = async (where, args) => { await db.exec('reset role'); await db.exec('set session_replication_role=replica'); await db.query(`update public.workspace_work_items set status='completed' where ${where}`, args); await db.exec('set session_replication_role=default'); };
for (const i of [KEEPER, OTHER_KEEPER, MANAGER]) for (const m of ['cleaning-schedule', 'replenishment-requests']) await sql('insert into public.workspace_module_grants(user_id,module_id) values($1,$2) on conflict do nothing', [users[i], m]);
const clean = async (prop, keeper, phase = 'assigned', status = 'in_progress') => {
  const w = (await sql("insert into public.workspace_work_items(request_id,property_id,module_id,title,created_by,assignee_id,status,due_on) values(gen_random_uuid(),$1,'cleaning-schedule','Changeover',$2,$3,$4,current_date) returning id", [prop, users[ADMIN], users[keeper], status]))[0].id;
  await sql("insert into private.workspace_domain_details(work_id,kind,data) values($1,'cleaning',$2)", [w, { phase, dueOn: new Date().toISOString().slice(0, 10) }]);
  return w;
};
const CLEAN = await clean(PROP, KEEPER);
const DONE = await clean(PROP, KEEPER, 'review', 'completed');
const REPAIR = (await sql("insert into public.workspace_work_items(request_id,property_id,module_id,title,created_by,status) values(gen_random_uuid(),$1,'stays-maintenance-reporting','Property repair request',$2,'waiting') returning id", [PROP, users[ADMIN]]))[0].id;
await sql("insert into private.workspace_domain_details(work_id,kind,data) values($1,'maintenance','{\"phase\":\"triage\",\"issue\":\"Bathroom tap drips\"}')", [REPAIR]);
const ELSEWHERE = (await sql("insert into public.workspace_work_items(request_id,property_id,module_id,title,created_by,status) values(gen_random_uuid(),$1,'stays-maintenance-reporting','Property repair request',$2,'waiting') returning id", [OTHER, users[ADMIN]]))[0].id;
await sql("insert into private.workspace_domain_details(work_id,kind,data) values($1,'maintenance','{\"phase\":\"triage\",\"issue\":\"Glasgow boiler\"}')", [ELSEWHERE]);

test('the plan\'s stock list and the 14:45 late time are the defaults', async () => {
  const r = await read(KEEPER, CLEAN);
  assert.equal(r.lateAfter, '14:45');
  assert.deepEqual(r.stock.map(s => [s.key, s.minimum]), [['toilet_roll', 12], ['kitchen_roll', 12], ['body_wash', 2], ['shampoo', 2], ['hand_wash', 2], ['washing_up', 2], ['irn_bru', 12], ['surface_cleaner', 5], ['cloths', 24]]);
  assert.ok(r.stock.every(s => s.onHand === null && !s.low), 'nothing is counted yet');
  assert.equal(r.canCount, true); assert.equal(r.canEditSettings, false); assert.equal(r.settings, null);
  assert.deepEqual(r.used, {});
  assert.deepEqual(r.repairs.map(x => x.issue), ['Bathroom tap drips'], 'only open repairs at this property');
  assert.equal(C.sentLate('2026-03-02T14:44:00Z', '2026-03-02', '14:45'), false);
  assert.equal(C.sentLate('2026-03-02T14:46:00Z', '2026-03-02', '14:45'), true);
  assert.equal(C.sentLate('2026-07-02T13:50:00Z', '2026-07-02', '14:45'), true, '14:50 in London in summer');
  assert.equal(C.sentLate('2026-03-03T09:00:00Z', '2026-03-02', '14:45'), true, 'the next day');
});

test('counted, then used on the clean: a counted item below its minimum opens one restock request', async () => {
  // Use before any count: kept, but nothing is alerted.
  let s = C.stockResultSchema.parse(await act(KEEPER, { action: 'recordStockUse', workId: CLEAN, used: { toilet_roll: 2 } }));
  assert.equal(s.stock[0].onHand, null); assert.deepEqual(s.used, { toilet_roll: 2 });
  s = C.stockResultSchema.parse(await act(KEEPER, { action: 'countStock', workId: CLEAN, counts: { toilet_roll: 14, kitchen_roll: 12, cloths: 30 } }));
  assert.equal(s.stock[0].onHand, 14); assert.equal(s.stock[0].countedByName, 'Kirsty');
  // Correcting the clean's use: the old amounts go back, the new ones come off.
  s = C.stockResultSchema.parse(await act(KEEPER, { action: 'recordStockUse', workId: CLEAN, used: { toilet_roll: 3, kitchen_roll: 1 } }));
  assert.deepEqual(s.stock.slice(0, 2).map(x => [x.onHand, x.low]), [[11, true], [11, true]]);
  const restocks = async () => sql("select title,description from public.workspace_work_items where module_id='replenishment-requests' and property_id=$1 order by title", [PROP]);
  assert.deepEqual((await restocks()).map(r => r.title), ['Restock: Kitchen rolls', 'Restock: Toilet rolls']);
  assert.match((await restocks())[1].description, /11 left, the minimum is 12/);
  assert.equal(await notified(ADMIN, 'cleaning.stock_low'), 2);
  assert.equal(await notified(MANAGER, 'cleaning.stock_low'), 2, 'cleaning managers with Restock requests');
  // Using more does not open a second request while one is open; once it is done, a new one can.
  await act(KEEPER, { action: 'recordStockUse', workId: CLEAN, used: { toilet_roll: 5, kitchen_roll: 1 } });
  assert.equal((await restocks()).length, 2);
  assert.ok((await read(MANAGER, null, PROP)).stock[0].restockOpen);
  await finish("module_id='replenishment-requests' and title='Restock: Toilet rolls'", []);
  // The delivery is counted by the team: at the minimum, nothing new opens.
  s = C.stockResultSchema.parse(await act(MANAGER, { action: 'countStock', propertyId: PROP, counts: { toilet_roll: 24 } }));
  assert.equal(s.stock[0].onHand, 24); assert.equal(s.stock[0].low, false); assert.equal(s.used, null);
  assert.equal((await restocks()).length, 2);
  // Checks on the amounts and the list.
  assert.throws(() => teamsActionSchema.parse({ action: 'countStock', requestId: crypto.randomUUID(), counts: { toilet_roll: 1 } }), /clean or the property/);
  assert.throws(() => teamsActionSchema.parse({ action: 'recordStockUse', requestId: crypto.randomUUID(), workId: CLEAN, used: { toilet_roll: 1.5 } }));
  await assert.rejects(raw(KEEPER, { action: 'recordStockUse', workId: CLEAN, used: { champagne: 1 } }), /not on the list/);
  await assert.rejects(raw(KEEPER, { action: 'recordStockUse', workId: CLEAN, used: { toilet_roll: -1 } }), /whole number/);
});

test('only the housekeeper on an open clean, or the team; owners and other housekeepers are refused', async () => {
  await assert.rejects(raw(OTHER_KEEPER, { action: 'recordStockUse', workId: CLEAN, used: { cloths: 1 } }), /Clean not found/);
  await assert.rejects(raw(KEEPER, { action: 'recordStockUse', workId: DONE, used: { cloths: 1 } }), /Clean not found/, 'a finished clean is closed to its housekeeper');
  await assert.rejects(raw(KEEPER, { action: 'countStock', propertyId: PROP, counts: { cloths: 1 } }), /Property not found/);
  await assert.rejects(raw(OWNER, { action: 'countStock', propertyId: PROP, counts: { cloths: 1 } }), /Property not found/);
  await as(OTHER_KEEPER); await assert.rejects(rpc('workspace_changeover_read', [CLEAN, null]), /Clean not found/);
  await as(OWNER); await assert.rejects(rpc('workspace_changeover_read', [null, PROP]), /Property not found/);
  await as(ADMIN);
  for (const t of ['workspace_changeover_settings', 'workspace_property_stock', 'workspace_clean_stock_use']) await assert.rejects(db.query(`select * from private.${t}`), /permission denied/);
});

test('admins edit the stock list and the late time', async () => {
  const r = await read(ADMIN, null, PROP);
  assert.equal(r.canEditSettings, true);
  const settings = { lateAfter: '15:00', stock: [...r.settings.stock.filter(x => x.key !== 'irn_bru'), { key: 'coffee_pods', label: 'Coffee pods', minimum: 20 }] };
  await assert.rejects(raw(MANAGER, { action: 'saveChangeoverSettings', settings }), /Only admins/);
  assert.throws(() => teamsActionSchema.parse({ action: 'saveChangeoverSettings', requestId: crypto.randomUUID(), settings: { ...settings, lateAfter: '3pm' } }), /HH:MM/);
  await assert.rejects(raw(ADMIN, { action: 'saveChangeoverSettings', settings: { ...settings, stock: [settings.stock[0], settings.stock[0]] } }), /Invalid settings/);
  await act(ADMIN, { action: 'saveChangeoverSettings', settings });
  const after = await read(KEEPER, CLEAN);
  assert.equal(after.lateAfter, '15:00');
  assert.ok(after.stock.some(x => x.key === 'coffee_pods') && !after.stock.some(x => x.key === 'irn_bru'));
  // The on-time rule follows the setting.
  const onTime = async at => (await sql("select private.workspace_clean_form_on_time(jsonb_build_object('phase','review','submittedAt',$1::text),'2026-03-02'::date) ok", [at]))[0].ok;
  assert.equal(await onTime('2026-03-02T14:59:00.000Z'), true);
  assert.equal(await onTime('2026-03-02T15:01:00.000Z'), false);
  await act(ADMIN, { action: 'saveChangeoverSettings', settings: { ...settings, lateAfter: '14:45' } });
  assert.equal(await onTime('2026-03-02T14:50:00.000Z'), false, 'after 14:45 is late');
});

test('the housekeeper adds to an open repair at the property, and the team hears', async () => {
  assert.throws(() => teamsActionSchema.parse({ action: 'addRepairNote', requestId: crypto.randomUUID(), workId: CLEAN, repairId: REPAIR, note: 'x' }), /at least 3/);
  const r = await act(KEEPER, { action: 'addRepairNote', workId: CLEAN, repairId: REPAIR, note: 'Still dripping after this changeover.' });
  assert.equal(r.notes, 1);
  const notes = (await sql("select data->'housekeeperNotesBy' n from private.workspace_domain_details where work_id=$1", [REPAIR]))[0].n;
  assert.deepEqual(notes.map(n => [n.name, n.note, n.cleanWorkId]), [['Kirsty', 'Still dripping after this changeover.', CLEAN]]);
  assert.equal(await notified(ADMIN, 'maintenance.housekeeper_note'), 1);
  assert.equal((await read(KEEPER, CLEAN)).repairs[0].notes, 1);
  await assert.rejects(raw(KEEPER, { action: 'addRepairNote', workId: CLEAN, repairId: ELSEWHERE, note: 'Not mine' }), /closed or not at this property/);
  await assert.rejects(raw(ADMIN, { action: 'addRepairNote', workId: CLEAN, repairId: REPAIR, note: 'From the team' }), /Only the housekeeper/);
  await finish('id=$1', [REPAIR]);
  await assert.rejects(raw(KEEPER, { action: 'addRepairNote', workId: CLEAN, repairId: REPAIR, note: 'Again' }), /closed or not at this property/);
  assert.deepEqual((await read(KEEPER, CLEAN)).repairs, []);
});

test('the same request is answered once, and the migration runs twice without changing anything', async () => {
  const input = { action: 'countStock', requestId: crypto.randomUUID(), workId: CLEAN, counts: { cloths: 40 } };
  await as(KEEPER); const first = await rpc('workspace_teams_action', [input]);
  await sql("update private.workspace_property_stock set on_hand=1 where item_key='cloths'");
  await as(KEEPER); assert.deepEqual(await rpc('workspace_teams_action', [input]), first);
  const SIGS = ['private.workspace_teams_action(jsonb)', 'private.workspace_changeover_action(jsonb)', 'private.workspace_changeover_read(uuid,uuid)', 'private.workspace_clean_form_on_time(jsonb,date)'];
  const defs = async () => { await db.exec('reset role'); return Promise.all(SIGS.map(async s => (await db.query('select pg_get_functiondef($1::regprocedure) d', [s])).rows[0].d)); };
  const counts = 'select (select count(*) from private.workspace_property_stock)::int s,(select count(*) from private.workspace_clean_stock_use)::int u,(select settings from private.workspace_changeover_settings) st';
  const before = await defs(), rows = (await sql(counts))[0];
  const text = await fs.readFile('supabase/migrations/' + MINE, 'utf8');
  await db.exec(text);
  assert.deepEqual(await defs(), before); assert.deepEqual((await sql(counts))[0], rows);
  assert.equal(before[0].split('changeover actions: 20261031200000').length, 2, 'patched once');
  assert.equal(text.includes(String.fromCharCode(0x2014)), false, 'no em dash');
});
