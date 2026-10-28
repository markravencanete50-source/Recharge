import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Furnishing Studio (20261023200000), against the real database functions: the shared catalogue, client quotes worked out
// from the property, the price snapshot on sending, the status flow, the shopping list ticked off while buying, and the
// analytics. Only the Stays team and management (admin, super_admin) can read or change anything; owners, cleaners, the
// cleaning manager, Ready and Accounts are refused, and nobody signed out reaches it.
const MIGRATION = 'supabase/migrations/20261023200000_furnishing_studio.sql';
const INVENTORY = 'supabase/migrations/20261029400000_launch_inventory.sql';
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const studio = await vite.ssrLoadModule('/lib/furnishing-studio.ts');
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
after(async () => { await db.close(); await vite.close(); });

const roles = ['super_admin', 'admin', 'stays', 'client', 'cleans', 'cleaning_manager', 'ready', 'accounts'];
const [SUPER, ADMIN, STAYS, OWNER, CLEANER, MANAGER, READY, ACCOUNTS] = roles.map((_, i) => i);
const names = ['Alex Super', 'Admin Person', 'Sam Stays', 'Olivia Owner', 'Cara Cleaner', 'Mia Manager', 'Andy Plumber', 'Acc Ounts'];
const users = roles.map((_, i) => `7a000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('7a00', '7b00');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `furnishing${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], names[i]]);
  // Everyone holds every tool: the roles alone decide who reaches Furnishing Studio.
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
async function as(i) { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]); await db.exec('set role authenticated'); }
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const owner = async (sql, args = []) => { await db.exec('reset role'); return (await db.query(sql, args)).rows; };
const read = async (section, id = null) => (await db.query('select public.workspace_furnishing_read($1,$2) r', [section, id])).rows[0].r;
const analytics = async (from, to) => (await db.query('select public.workspace_furnishing_analytics($1,$2) r', [from, to])).rows[0].r;
const act = async input => (await db.query('select public.workspace_furnishing_action($1::jsonb) r', [JSON.stringify({ requestId: crypto.randomUUID(), ...input })])).rows[0].r;
const today = (await db.query("select (now() at time zone 'Europe/London')::date::text d")).rows[0].d;

await as(SUPER);
const property = (await db.query('select public.workspace_save_property($1::jsonb) id', [JSON.stringify({ requestId: crypto.randomUUID(), name: 'Harbour flat', address: '1 Harbour Road', region: 'Edinburgh', bedrooms: 3 })])).rows[0].id;

// A project's save, worked out with the app's own rules from the catalogue as the screen reads it.
const inputsFor = extra => studio.normaliseInputs({ ...studio.DEFAULT_INPUTS, ...extra });
async function draftFor(catalogue, form, overrides = {}) {
  const f = { ...studio.emptyProjectForm(today), ...form, overrides };
  const lines = studio.estimateLines(studio.catalogueSchema.parse(catalogue), f.inputs, overrides, f);
  return { action: studio.saveProjectAction(f, lines, crypto.randomUUID()), lines, totals: studio.estimateTotals(lines, f) };
}
const FUNCTIONS = ['private.workspace_furnishing_actor()', 'private.workspace_furnishing_inputs(jsonb)', 'private.workspace_furnishing_item_json(private.workspace_furnishing_items)',
  'private.workspace_furnishing_line_json(private.workspace_furnishing_lines)', 'private.workspace_furnishing_project_json(private.workspace_furnishing_projects,boolean)',
  'private.workspace_furnishing_read(text,uuid)', 'private.workspace_furnishing_analytics(date,date)', 'private.workspace_furnishing_write_lines(uuid,integer,jsonb)',
  'private.workspace_furnishing_pence(jsonb,text,text,boolean)', 'private.workspace_furnishing_action(jsonb)',
  'public.workspace_furnishing_read(text,uuid)', 'public.workspace_furnishing_analytics(date,date)', 'public.workspace_furnishing_action(jsonb)'];

test('the migration is safe to run twice, keeps edits to the catalogue, and follows the conventions', async () => {
  const prints = async () => (await owner("select f, md5(replace(p.prosrc,chr(13),'')) h from unnest($1::text[]) f join pg_proc p on p.oid=f::regprocedure order by f", [FUNCTIONS])).map(r => r.f + ' ' + r.h).join('\n');
  const before = await prints();
  assert.equal(before.split('\n').length, FUNCTIONS.length, 'every function is there');
  await owner("update private.workspace_furnishing_items set cost_cap_pence=cost_cap_pence+1 where code='kettle'");
  const count = async () => (await owner('select count(*)::int n, sum(cost_cap_pence)::bigint s from private.workspace_furnishing_items'))[0];
  const seeded = await count();
  // Launch Preparation's inventory (20261029400000) replaces the catalogue save; it runs again after, as it does in order.
  await db.exec(await fs.readFile(MIGRATION, 'utf8'));
  await db.exec(await fs.readFile(INVENTORY, 'utf8'));
  assert.equal(await prints(), before, 'the fingerprints do not change on a second run');
  assert.deepEqual(await count(), seeded, 'the second run adds nothing and overwrites no edit');
  const text = await fs.readFile(MIGRATION, 'utf8');
  const code = text.split('\n').filter(l => !l.trim().startsWith('--')).join('\n');
  assert.doesNotMatch(code, /\bdrop\b|\bdelete\s+from\b/i, 'no DROP, no DELETE');
  assert.doesNotMatch(text, /—/, 'no em dashes');
  assert.equal(text.replace(/\r\n/g, '').includes('\n'), false, 'every line ends CRLF');
  assert.equal(code.match(/grant execute/gi).length, 1, 'one grant');
  assert.match(code, /grant execute on function private\.workspace_furnishing_read\(text,uuid\),public\.workspace_furnishing_read\(text,uuid\),\s+private\.workspace_furnishing_analytics\(date,date\),public\.workspace_furnishing_analytics\(date,date\),\s+private\.workspace_furnishing_action\(jsonb\),public\.workspace_furnishing_action\(jsonb\) to authenticated;/);
  const meta = await owner("select p.oid::regprocedure::text f,n.nspname s,p.prosecdef d,p.proconfig c from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.oid=any($1::text[]::regprocedure[]) order by 1", [FUNCTIONS]);
  for (const m of meta) {
    assert.deepEqual(m.c, ['search_path=""'], m.f + " sets search_path=''");
    if (m.s === 'public') assert.equal(m.d, false, m.f + ' is security invoker');
  }
  for (const f of ['read(text,uuid)', 'analytics(date,date)', 'action(jsonb)']) assert.equal(meta.find(m => m.f === 'private.workspace_furnishing_' + f).d, true, f + ' private is security definer');
  // Execute: signed-in people the three entry points only; nobody else anything.
  const can = await owner("select f, has_function_privilege('authenticated',f,'execute') a, has_function_privilege('anon',f,'execute') n, has_function_privilege('service_role',f,'execute') s from unnest($1::text[]) f", [FUNCTIONS]);
  for (const c of can) {
    assert.equal(c.n, false, c.f + ' anon');
    assert.equal(c.s, false, c.f + ' service_role');
    assert.equal(c.a, /_(read|analytics|action)\(/.test(c.f), c.f + ' authenticated');
  }
  // The tables are closed: RLS on, no grants to anyone signed in.
  const tables = await owner("select c.relname t,c.relrowsecurity r,has_table_privilege('authenticated',c.oid,'select') s from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='private' and c.relname like 'workspace_furnishing_%' and c.relkind='r' order by 1");
  assert.deepEqual(tables.map(t => t.t), ['workspace_furnishing_events', 'workspace_furnishing_item_history', 'workspace_furnishing_items', 'workspace_furnishing_lines', 'workspace_furnishing_numbers', 'workspace_furnishing_projects']);
  for (const t of tables) assert.deepEqual([t.r, t.s], [true, false], t.t);
  await as(STAYS);
  await assert.rejects(db.query("select private.workspace_furnishing_inputs('{}'::jsonb)"), /permission denied/);
  await db.exec('reset role'); await db.exec('set role anon');
  await assert.rejects(db.query("select public.workspace_furnishing_read('catalogue',null)"), /permission denied/);
  await assert.rejects(db.query("select public.workspace_furnishing_action('{}'::jsonb)"), /permission denied/);
});

test('the app and the database agree on the ranges, rooms, rules and conditions', async () => {
  const fn = (await owner("select prosrc s from pg_proc where oid='private.workspace_furnishing_inputs(jsonb)'::regprocedure"))[0].s;
  const sqlCounts = [...fn.match(/counts constant text\[\]\[\]:=array\[(.*?)\];/s)[1].matchAll(/\['(\w+)','(\d+)','(\d+)'\]/g)].map(m => [m[1], +m[2], +m[3]]);
  assert.deepEqual(sqlCounts, studio.COUNT_INPUTS.map(i => [i.key, i.min, i.max]));
  for (const k of studio.OPTION_KEYS) assert.match(fn, new RegExp(`'${k}'`));
  const action = (await owner("select prosrc s from pg_proc where oid='private.workspace_furnishing_action(jsonb)'::regprocedure"))[0].s;
  const list = re => [...action.match(re)[1].matchAll(/'(\w+)'/g)].map(m => m[1]);
  assert.deepEqual(list(/v_category not in \(([^)]*)\)/), [...studio.FURNISHING_CATEGORIES]);
  assert.deepEqual(list(/v_basis not in \(([^)]*)\)/), [...studio.RULE_BASES]);
  assert.deepEqual(list(/v_when not in \(([^)]*)\)/), [...studio.RULE_WHEN]);
  // Every seeded product parses as the app reads it, and the labour line is the one-bedroom cap plus GBP 250 a bedroom.
  await as(STAYS);
  const catalogue = studio.catalogueSchema.parse(await read('catalogue'));
  assert.ok(catalogue.length >= 90, 'a full starting catalogue');
  for (const c of studio.FURNISHING_CATEGORIES) assert.ok(catalogue.some(i => i.category === c), c + ' has products');
  const labour = catalogue.find(i => i.category === 'labour');
  assert.deepEqual([labour.costCapPence, labour.stepPence, labour.rule], [45000, 25000, { basis: 'fixed', per: 1, when: null }]);
});

test('only the Stays team and management reach Furnishing Studio', async () => {
  for (const i of [OWNER, CLEANER, MANAGER, READY, ACCOUNTS]) {
    await as(i);
    for (const section of ['catalogue', 'projects', 'properties']) await assert.rejects(read(section), /Furnishing Studio is for the Stays team and management/, `${roles[i]} ${section}`);
    await assert.rejects(analytics(today, today), /Furnishing Studio is for the Stays team and management/, roles[i]);
    await assert.rejects(act({ action: 'saveItem', name: 'Sneaky', category: 'bedroom', unit: 'each', packSize: 1, costCapPence: 1, retailPricePence: null, supplier: '', productUrl: null,
      rule: { basis: 'fixed', per: 1, when: null }, stepPence: 0, active: true }), /Furnishing Studio is for the Stays team and management/, roles[i]);
  }
  for (const i of [SUPER, ADMIN, STAYS]) {
    await as(i);
    assert.ok((await read('catalogue')).length > 0, roles[i]);
    assert.ok(Array.isArray(await read('projects')), roles[i]);
    assert.ok((await read('properties')).some(p => p.id === property && p.bedrooms === 3), roles[i]);
  }
});

test('the catalogue: add and edit products against their version, with the history kept and never deleted', async () => {
  await as(STAYS);
  const added = await act({ action: 'saveItem', name: 'Bath sheet', category: 'linen', unit: 'pack of 2', packSize: 2, costCapPence: 1800, retailPricePence: 2400, supplier: 'Dunelm',
    productUrl: 'https://example.com/bath-sheet', rule: { basis: 'bathroom', per: 1.5, when: null }, stepPence: 0, active: true });
  assert.deepEqual([added.name, added.packSize, added.rule, added.version, added.updatedBy], ['Bath sheet', 2, { basis: 'bathroom', per: 1.5, when: null }, 1, 'Sam Stays']);
  await assert.rejects(act({ action: 'saveItem', name: 'Bad link', category: 'linen', unit: 'each', packSize: 1, costCapPence: 1, retailPricePence: null, supplier: '', productUrl: 'http://example.com',
    rule: { basis: 'fixed', per: 1, when: null }, stepPence: 0, active: true }), /https/);
  await assert.rejects(act({ action: 'saveItem', name: 'Bad rule', category: 'linen', unit: 'each', packSize: 1, costCapPence: 1, retailPricePence: null, supplier: '', productUrl: null,
    rule: { basis: 'bedroom', per: 1.234, when: null }, stepPence: 0, active: true }), /two decimals/);
  await as(ADMIN);
  const edit = { action: 'saveItem', id: added.id, version: 1, name: 'Bath sheet', category: 'linen', unit: 'pack of 2', packSize: 2, costCapPence: 2000, retailPricePence: null, supplier: 'Dunelm',
    productUrl: null, rule: { basis: 'bathroom', per: 2, when: null }, stepPence: 0, active: false };
  const changed = await act(edit);
  assert.deepEqual([changed.version, changed.active, changed.costCapPence, changed.retailPricePence, changed.updatedBy], [2, false, 2000, null, 'Admin Person']);
  await assert.rejects(act(edit), /changed by someone else/, 'a stale version is refused');
  const history = await owner('select action,version,before->>\'costCapPence\' cap from private.workspace_furnishing_item_history where item_id=$1 order by id', [added.id]);
  assert.deepEqual(history.map(h => [h.action, h.version, h.cap]), [['created', 1, null], ['saved', 2, '1800']]);
  await as(STAYS);
  assert.equal((await read('catalogue')).find(i => i.id === added.id).active, false, 'out of use, still listed');
});

test('a quote: worked out from the property, saved with the same sums as the app, sent with its prices frozen', async () => {
  await as(STAYS);
  const catalogue = await read('catalogue');
  const inputs = inputsFor({ bedrooms: 3, guests: 6, zipLinkBeds: 1, zipLinkSetups: ['twin'], doubleBeds: 2, singleBeds: 0, dishwasher: true, garden: true });
  const kettle = catalogue.find(i => i.name.toLowerCase().includes('kettle'));
  const { action, lines, totals } = await draftFor(catalogue, { clientName: 'Morag Client', clientEmail: 'morag@example.com', propertyId: property, address: '', inputs, markupPercent: 12.5,
    feePence: 15000, vat: true, notes: 'Ready for March' }, { [kettle.id]: { units: 2, existing: 1 } });
  const saved = await act(action);
  const year = today.slice(0, 4);
  assert.match(saved.number, new RegExp(`^RC-FQ-${year}-\\d{4}$`));
  assert.deepEqual([saved.status, saved.propertyName, saved.bedrooms, saved.version, saved.lines.length], ['draft', 'Harbour flat', 3, 1, lines.length]);
  assert.deepEqual([saved.estimatePence, saved.subtotalPence, saved.vatPence, saved.quotePence], [totals.estimatePence, totals.subtotalPence, totals.vatPence, totals.quotePence], 'the database sums match the app');
  for (const l of lines) {
    const s = saved.lines.find(x => x.itemId === l.itemId);
    assert.deepEqual([s.packs, s.costPence, s.pricePence], [l.packs, l.costPence, l.pricePence], l.name);
  }
  const labour = saved.lines.find(l => l.category === 'labour');
  assert.deepEqual([labour.unitCostPence, labour.packs], [45000 + 2 * 25000, 1], 'labour: the one-bedroom cap plus GBP 250 for each extra bedroom');
  const k = saved.lines.find(l => l.itemId === kettle.id);
  assert.deepEqual([k.units, k.existingUnits, k.packs], [2, 1, 1], 'fine-tuned, stock deducted');
  // Linen: three rotations for the twin primary setup of the zip & link bed (two singles) and one for the double secondary.
  const linen = studio.basisValue(inputs, 'singleSets'), king = studio.basisValue(inputs, 'kingSets');
  assert.deepEqual([linen, king], [6, 1]);
  const project = studio.projectSchema.parse(await read('project', saved.id));
  assert.deepEqual(studio.formFromProject(project).overrides[kettle.id], { units: 2, existing: 1 }, 'the fine-tuning comes back to the screen');
  // A second save is a new revision; the first stays.
  const again = await act({ ...action, requestId: crypto.randomUUID(), id: saved.id, version: 1, clientName: 'Morag Client-Smith' });
  assert.equal(again.version, 2);
  const revisions = await owner('select revision,count(*)::int n from private.workspace_furnishing_lines where project_id=$1 group by revision order by revision', [saved.id]);
  assert.deepEqual(revisions.map(r => r.revision), [1, 2]);
  // Replaying a request gives the same answer; reusing it for something else is refused.
  assert.deepEqual(await act({ ...action, requestId: action.requestId }), saved);
  await assert.rejects(act({ ...action, clientName: 'Someone else' }), /reused/);
  // Sending freezes the prices: a later catalogue change does not touch the sent quote.
  const sent = await act({ action: 'moveProject', id: saved.id, version: 2, status: 'sent' });
  assert.deepEqual([sent.status, sent.quotePence, sent.history.at(-1).toStatus, sent.history.at(-1).by], ['sent', totals.quotePence, 'sent', 'Sam Stays']);
  const kettleNow = (await read('catalogue')).find(i => i.id === kettle.id);
  await as(ADMIN);
  await act({ action: 'saveItem', id: kettle.id, version: kettleNow.version, ...Object.fromEntries(Object.entries(studio.itemToForm(kettleNow))), costCapPence: kettleNow.costCapPence + 5000 });
  await as(STAYS);
  const after = await read('project', saved.id);
  assert.equal(after.lines.find(l => l.itemId === kettle.id).unitCostPence, k.unitCostPence, 'the sent quote keeps its price');
  assert.equal(after.quotePence, sent.quotePence);
  await assert.rejects(act({ ...action, requestId: crypto.randomUUID(), id: saved.id, version: sent.version }), /Only a draft can be changed/);
  await assert.rejects(act({ action: 'tickLine', id: saved.id, lineId: after.lines[0].id, purchased: true, actualPence: null }), /once the client has accepted/);
  await assert.rejects(act({ action: 'moveProject', id: saved.id, version: sent.version, status: 'complete' }), /cannot be moved/);
  await assert.rejects(act({ action: 'moveProject', id: saved.id, version: 1, status: 'accepted' }), /changed by someone else/);
});

test('accepted quotes become the shopping list: ticks, actual spend, purchasing and complete; archive hides, never deletes', async () => {
  await as(STAYS);
  const catalogue = await read('catalogue');
  const { action } = await draftFor(catalogue, { clientName: 'Iain Buyer', address: '22 New Street, Leith', inputs: inputsFor({ bedrooms: 1 }) });
  let p = await act(action);
  p = await act({ action: 'moveProject', id: p.id, version: p.version, status: 'sent' });
  p = await act({ action: 'moveProject', id: p.id, version: p.version, status: 'accepted' });
  assert.equal(p.status, 'accepted');
  const [first, second] = p.lines.filter(l => l.packs > 0);
  await as(ADMIN);
  p = await act({ action: 'tickLine', id: p.id, lineId: first.id, purchased: true, actualPence: first.costPence - 500 });
  assert.equal(p.status, 'purchasing', 'the first tick starts the purchasing');
  const ticked = p.lines.find(l => l.id === first.id);
  assert.deepEqual([ticked.purchased, ticked.actualPence, ticked.purchasedBy], [true, first.costPence - 500, 'Admin Person']);
  p = await act({ action: 'tickLine', id: p.id, lineId: second.id, purchased: true, actualPence: second.costPence + 1200 });
  assert.equal(p.actualPence, first.costPence - 500 + second.costPence + 1200);
  const summary = (await read('projects')).find(x => x.id === p.id);
  assert.deepEqual([summary.purchasedLines, summary.status], [2, 'purchasing']);
  p = await act({ action: 'moveProject', id: p.id, version: p.version, status: 'complete' });
  assert.equal(p.status, 'complete');
  await assert.rejects(act({ action: 'tickLine', id: p.id, lineId: first.id, purchased: false, actualPence: null }), /once the client has accepted/);
  // Archive and restore: the project stays, flagged.
  p = await act({ action: 'archiveProject', id: p.id, version: p.version, archived: true });
  assert.equal(p.archived, true);
  assert.equal((await read('projects')).find(x => x.id === p.id).archived, true, 'still there, marked archived');
  await assert.rejects(act({ action: 'moveProject', id: p.id, version: p.version, status: 'draft' }), /archived|cannot be moved/);
  p = await act({ action: 'archiveProject', id: p.id, version: p.version, archived: false });
  assert.deepEqual(p.history.map(h => h.action), ['created', 'moved', 'moved', 'moved', 'purchased', 'purchased', 'moved', 'archived', 'restored']);
  // A declined quote can be reopened as a draft and changed.
  let d = await act((await draftFor(catalogue, { clientName: 'Declan Decline', address: '3 Side Lane', inputs: inputsFor({}) })).action);
  d = await act({ action: 'moveProject', id: d.id, version: d.version, status: 'sent' });
  d = await act({ action: 'moveProject', id: d.id, version: d.version, status: 'declined' });
  d = await act({ action: 'moveProject', id: d.id, version: d.version, status: 'draft' });
  assert.equal(d.status, 'draft');
  await assert.rejects(act((await draftFor(catalogue, { clientName: 'No Where', address: '', inputs: inputsFor({}) })).action), /Choose a property or type the address/);
  await assert.rejects(act({ ...(await draftFor(catalogue, { clientName: 'Big House', address: '1 Big Road', inputs: inputsFor({}) })).action, inputs: { ...inputsFor({}), bedrooms: 13 } }), /bedrooms can be 0 to 12/);
});

test('analytics: status counts, conversion, values, per bedroom, spend variance, top items and months', async () => {
  await as(SUPER);
  const from = `${today.slice(0, 4)}-01-01`, to = `${today.slice(0, 4)}-12-31`;
  const a = studio.analyticsSchema.parse(await analytics(from, to));
  const projects = (await read('projects')).filter(p => !p.archived && p.estimateOn >= from && p.estimateOn <= to);
  assert.equal(a.projects, projects.length);
  const sent = projects.filter(p => p.status !== 'draft'), won = projects.filter(p => ['accepted', 'purchasing', 'complete'].includes(p.status));
  assert.deepEqual([a.sent, a.accepted, a.declined], [sent.length, won.length, projects.filter(p => p.status === 'declined').length]);
  assert.equal(a.conversionPercent, Math.round(won.length * 1000 / sent.length) / 10);
  assert.equal(a.quotedPence, sent.reduce((t, p) => t + p.quotePence, 0));
  assert.equal(a.acceptedPence, won.reduce((t, p) => t + p.quotePence, 0));
  assert.equal(a.averagePerBedroomPence, Math.round(a.quotedPence / sent.reduce((t, p) => t + Math.max(p.bedrooms, 1), 0)));
  assert.equal(a.byStatus.reduce((t, s) => t + s.projects, 0), a.projects);
  assert.equal(a.byMonth.length, 12);
  assert.equal(a.byMonth.reduce((t, m) => t + m.sent, 0), a.sent);
  assert.equal(a.spend.recordedLines, 2);
  assert.equal(a.spend.variancePence, 700, '500 under on one line, 1,200 over on the other');
  assert.ok(a.topByUnits.length > 0 && a.topBySpend.length > 0);
  assert.ok(a.topBySpend.every((x, i, list) => i === 0 || list[i - 1].spendPence >= x.spendPence), 'sorted by spend');
  // Archived projects are left out.
  const archived = (await read('projects')).find(p => p.status === 'complete');
  await act({ action: 'archiveProject', id: archived.id, version: archived.version, archived: true });
  const without = await analytics(from, to);
  assert.equal(without.projects, a.projects - 1);
  assert.equal(without.spend.recordedLines, 0);
  await assert.rejects(analytics('2024-01-01', '2026-12-31'), /up to two years/);
});
