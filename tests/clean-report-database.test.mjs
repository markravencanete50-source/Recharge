import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// The post-clean report: the property check the cleaner answers with each clean. The database keeps
// only known answers, and the route refuses anything else first.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { cleanConditionSchema, purchaseFromClean, repairFromClean, cleanAnswers } = await vite.ssrLoadModule('/lib/clean-report.ts');
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
after(async () => { await db.close(); await vite.close(); });

const roles = ['super_admin', 'admin', 'cleaning_manager', 'cleaning_manager', 'stays', 'cleans', 'cleans', 'ready'];
const users = roles.map((_, i) => `97100000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, , MANAGER, , STAYS, CLEANER, OTHER_CLEANER, READY] = roles.map((_, i) => i);
const session = i => users[i].replace('9710', '9810');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `cleanreport${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], `Person ${i}`]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify(i === 'service' ? {} : { sub: users[i], session_id: session(i) })]);
  await db.exec(i === 'service' ? 'set role service_role' : 'set role authenticated');
}
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const operation = input => rpc('workspace_operations_action', [{ requestId: crypto.randomUUID(), ...input }]);
const today = (await db.query('select current_date::text d')).rows[0].d;

await as(SUPER);
const property = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Report flat' }]);
for (const [user, kind] of [[MANAGER, 'cleaning_manager'], [STAYS, 'staff'], [CLEANER, 'cleaner'], [OTHER_CLEANER, 'cleaner'], [READY, 'staff']]) await rpc('workspace_assign_property', [property, users[user], kind]);
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });

// A clean at a property, assigned to a cleaner.
async function clean(target = property, checklist = ['Kitchen', 'Bathroom', 'Hot tub'], cleaner = CLEANER) {
  await as(MANAGER);
  const created = await operation({ action: 'createOperation', propertyId: target, kind: 'cleaning', data: { dueOn: today, checklist } });
  await rpc('workspace_assign_work', [created.workId, created.version, users[cleaner]]);
  return { workId: created.workId, checklist };
}
const prepare = (workId, extra = {}, id = crypto.randomUUID()) => rpc('workspace_prepare_upload', [{ requestId: id, workId, purpose: 'cleaning', contentHash: 'c'.repeat(64), ...extra }]);
const commit = async intent => { await as('service'); return rpc('integration_commit_upload', [intent.id, { assetId: 'storage:' + intent.publicId + '.jpg', publicId: intent.publicId, version: 1, format: 'jpg', bytes: 2048 }]); };
async function photo(workId, item, cleaner = CLEANER) { await as(cleaner); return commit(await prepare(workId, item ? { checklistItem: item } : {})); }
async function submit(c, photoIds, condition, cleaner = CLEANER) {
  await as(cleaner);
  const current = (await rpc('workspace_operations_read', [null])).find(w => w.workId === c.workId);
  return operation({ action: 'updateOperation', workId: c.workId, version: current.version, step: 'submitCleaning', data: { checks: c.checklist, report: 'All rooms cleaned', photoIds, mailAction: 'none', ...(condition === undefined ? {} : { condition }) } });
}

const condition = { broadband: 'not_working', heatingHotWater: 'working', bins: 'need_emptying', garden: 'none', prepaymentMeter: 'over_10', cutlery: 'short', letters: 'some', repairs: ' Shower head cracked ', itemOrder: [{ item: 'Toilet roll', quantity: 6 }], recommendations: 'A second kettle' };

test('the route and the database accept a full property check, stored tidy', async () => {
  assert.ok(cleanConditionSchema.safeParse(condition).success);
  const c = await clean();
  const done = await submit(c, [await photo(c.workId, null)], condition);
  await as(MANAGER);
  const stored = (await rpc('workspace_operations_read', [null])).find(w => w.workId === c.workId).data.condition;
  assert.equal(stored.repairs, 'Shower head cracked');
  assert.deepEqual(stored.itemOrder, [{ item: 'Toilet roll', quantity: 6 }]);
  assert.equal(stored.cutlery, 'short');
  assert.ok(done);
  assert.equal(purchaseFromClean(stored), 'From the clean report:\n6 × Toilet roll\nCutlery to replace what is missing');
  assert.equal(repairFromClean(stored), 'The broadband is not working.\nShower head cracked');
  assert.deepEqual(cleanAnswers(stored).filter(a => a.attention).map(a => a.answer), ['Not working', 'Yes, they need emptying', 'No, some is missing', 'Yes']);
});

test('unknown answers, keys and item rows are refused', async () => {
  for (const bad of [{ broadband: 'maybe' }, { colour: 'blue' }, { itemOrder: [{ item: '', quantity: 1 }] }, { itemOrder: [{ item: 'Mop', quantity: 0 }] }, { itemOrder: [{ item: 'Mop', quantity: 1, price: 3 }] }, { repairs: 'x'.repeat(2001) }, { itemOrder: Array.from({ length: 21 }, () => ({ item: 'Mop', quantity: 1 })) }, 'fine']) {
    assert.equal(cleanConditionSchema.safeParse(bad).success, false, JSON.stringify(bad).slice(0, 60));
    const c = await clean();
    const id = await photo(c.workId, null);
    await assert.rejects(submit(c, [id], bad), /./, JSON.stringify(bad).slice(0, 60));
  }
});

test('a clean without a property check still goes through, as before', async () => {
  const c = await clean();
  await submit(c, [await photo(c.workId, null)]);
  await as(MANAGER);
  assert.equal((await rpc('workspace_operations_read', [null])).find(w => w.workId === c.workId).data.condition, undefined);
});
