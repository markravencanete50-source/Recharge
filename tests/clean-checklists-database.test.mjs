import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Photo-required checks on cleans: who may change a clean checklist, photos taken for one check,
// and the database refusing a clean until every check that needs photos has them. Cleans at
// properties without a checklist, and checks not on it, behave exactly as before.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { checklistActionSchema, templatesSchema, cleanRulesSchema } = await vite.ssrLoadModule('/lib/clean-checklist-policy.ts');
const { mediaInputSchema } = await vite.ssrLoadModule('/lib/integration-policy.ts');
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
after(async () => { await db.close(); await vite.close(); });

const roles = ['super_admin', 'admin', 'cleaning_manager', 'cleaning_manager', 'stays', 'cleans', 'cleans', 'ready'];
const users = roles.map((_, i) => `97000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, MANAGER, OTHER_MANAGER, STAYS, CLEANER, OTHER_CLEANER, READY] = roles.map((_, i) => i);
const session = i => users[i].replace('9700', '9800');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `checklists${i}@example.com`]);
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
const owner = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const read = (section, target = null) => rpc('clean_checklists_read', [section, target]);
// Every action goes through the HTTP schema first, as the route does.
const act = input => rpc('clean_checklists_action', [checklistActionSchema.parse({ requestId: crypto.randomUUID(), ...input })]);
const operation = input => rpc('workspace_operations_action', [{ requestId: crypto.randomUUID(), ...input }]);
const today = (await db.query('select current_date::text d')).rows[0].d;

await as(SUPER);
const property = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Checklist flat' }]);
const elsewhere = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Plain cottage' }]);
const third = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Other manager lodge' }]);
for (const target of [property, elsewhere]) for (const [user, kind] of [[MANAGER, 'cleaning_manager'], [STAYS, 'staff'], [CLEANER, 'cleaner'], [OTHER_CLEANER, 'cleaner'], [READY, 'staff']]) await rpc('workspace_assign_property', [target, users[user], kind]);
await rpc('workspace_assign_property', [third, users[OTHER_MANAGER], 'cleaning_manager']);
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
async function submit(c, photoIds, cleaner = CLEANER) {
  await as(cleaner);
  const current = (await rpc('workspace_operations_read', [null])).find(w => w.workId === c.workId);
  return operation({ action: 'updateOperation', workId: c.workId, version: current.version, step: 'submitCleaning', data: { checks: c.checklist, report: 'All rooms cleaned', photoIds, mailAction: 'none' } });
}
const template = async target => (await owner('select items,version from private.clean_checklist_templates where property_id is not distinct from $1', [target]))[0];

test('admins and cleaning managers edit checklists; cleaners, Stays and other managers cannot', async () => {
  const items = [{ label: 'Kitchen', photoRequired: false }, { label: ' Hot tub ', photoRequired: true, minPhotos: 2 }];
  await as(CLEANER);
  await assert.rejects(act({ action: 'saveTemplate', propertyId: property, version: 0, items }), /Only admins and cleaning managers/);
  await assert.rejects(read('templates'), /Cleaning schedule access required/, 'cleaners read rules on their own cleans only');
  await as(READY);
  await assert.rejects(read('templates'), /Cleaning schedule access required/);
  await as(STAYS);
  await assert.rejects(act({ action: 'saveTemplate', propertyId: null, version: 0, items }), /Only admins and cleaning managers/);
  assert.equal(templatesSchema.parse(await read('templates')).canEdit, false, 'Stays schedule cleans, so they read checklists');
  await as(OTHER_MANAGER);
  await assert.rejects(act({ action: 'saveTemplate', propertyId: property, version: 0, items }), /Only admins and cleaning managers/, 'not a property they look after');

  await as(MANAGER);
  const saved = await act({ action: 'saveTemplate', propertyId: property, version: 0, items });
  assert.equal(saved.version, 1);
  assert.deepEqual((await template(property)).items, [{ label: 'Kitchen', photoRequired: false }, { label: 'Hot tub', photoRequired: true, minPhotos: 2 }], 'stored tidy');
  await assert.rejects(act({ action: 'saveTemplate', propertyId: property, version: 0, items }), /Checklist changed/, 'a stale copy cannot overwrite');
  await assert.rejects(act({ action: 'saveTemplate', propertyId: property, version: 1, items: [{ label: 'Kitchen', photoRequired: false }, { label: 'Kitchen ', photoRequired: true }] }), /different name/);
  await assert.rejects(rpc('clean_checklists_action', [{ action: 'saveTemplate', requestId: crypto.randomUUID(), propertyId: property, version: 1, items: [{ label: 'Oven', photoRequired: true, minPhotos: 6 }] }]), /1 to 5 photos/);
  await assert.rejects(rpc('clean_checklists_action', [{ action: 'saveTemplate', requestId: crypto.randomUUID(), propertyId: property, version: 1, items: [{ label: 'Oven', photoRequired: 'yes' }] }]), /1 to 5 photos/);
  assert.throws(() => checklistActionSchema.parse({ action: 'saveTemplate', requestId: crypto.randomUUID(), propertyId: property, version: 1, items: [{ label: 'Oven', photoRequired: true, minPhotos: 6 }] }), 'the route refuses it first');
  // Replaying the same request returns the first answer instead of saving twice.
  const request = { action: 'saveTemplate', requestId: crypto.randomUUID(), propertyId: null, version: 0, items: [{ label: 'Bins out', photoRequired: true }] };
  const first = await rpc('clean_checklists_action', [request]);
  assert.deepEqual(await rpc('clean_checklists_action', [request]), first);
  assert.equal((await template(null)).version, 1, 'cleaning managers keep the checklist for every property');

  await as(OTHER_MANAGER);
  const listed = templatesSchema.parse(await read('templates'));
  assert.deepEqual(listed.templates.map(t => t.propertyId), [null], 'only checklists for their own properties');
  assert.equal(listed.canEdit, true);
  await as(ADMIN);
  await act({ action: 'removeTemplate', propertyId: null, version: 1 });
  assert.equal(await template(null), undefined);
  await assert.rejects(act({ action: 'removeTemplate', propertyId: null, version: 1 }), /no checklist to remove/);
});

test('a clean whose checks need photos is refused until each one has them', async () => {
  await as(ADMIN);
  const current = await template(property);
  await act({ action: 'saveTemplate', propertyId: property, version: current.version, items: [{ label: 'Kitchen', photoRequired: true }, { label: 'Hot tub', photoRequired: true, minPhotos: 2 }, { label: 'Bathroom', photoRequired: false }] });
  const c = await clean();

  // The cleaner sees the rules on their own clean; another cleaner cannot.
  await as(CLEANER);
  assert.deepEqual(cleanRulesSchema.parse(await read('clean', c.workId)).rules, [{ label: 'Kitchen', minPhotos: 1 }, { label: 'Hot tub', minPhotos: 2 }]);
  await as(OTHER_CLEANER);
  await assert.rejects(read('clean', c.workId), /Work access denied/);

  const general = await photo(c.workId, null);
  await assert.rejects(submit(c, [general]), /Add the photos these checks need before you submit: Kitchen, Hot tub \(2 photos\)/);
  const kitchen = await photo(c.workId, 'Kitchen');
  const tub = await photo(c.workId, 'Hot tub');
  await assert.rejects(submit(c, [general, kitchen, tub]), /Hot tub$/, 'two photos of the hot tub');
  // Another cleaner's photo of the same check does not count.
  await owner("insert into private.workspace_media_evidence(property_id,work_id,owner_id,purpose,provider_id,verified_at,checklist_item) values($1,$2,$3,'cleaning',$4,now(),'Hot tub')", [property, c.workId, users[OTHER_CLEANER], 'TEST-ONLY-' + crypto.randomUUID()]);
  await assert.rejects(submit(c, [general, kitchen, tub]), /Hot tub/);
  const tub2 = await photo(c.workId, 'Hot tub');

  // The photos say which check they belong to, for the cleaner and for the reviewer.
  await as(CLEANER);
  const media = await rpc('workspace_media_read', [c.workId]);
  assert.deepEqual(media.filter(m => m.checklistItem).map(m => [m.id, m.checklistItem]).sort(), [[kitchen, 'Kitchen'], [tub, 'Hot tub'], [tub2, 'Hot tub']].sort());
  assert.equal(media.find(m => m.id === general).checklistItem, null);

  // Photos taken on checks are photos of the clean, so they alone are enough.
  const submitted = await submit(c, [kitchen, tub, tub2]);
  assert.equal(submitted.data.phase, 'review');
  await as(MANAGER);
  assert.equal((await rpc('workspace_media_read', [c.workId])).filter(m => m.checklistItem === 'Hot tub').length, 3, 'the cleaning manager reviewing sees each check\'s photos');
});

test('a checklist photo must name a check on that clean, as a clean photo', async () => {
  const c = await clean(property, ['Kitchen', 'Hot tub']);
  await as(CLEANER);
  await assert.rejects(prepare(c.workId, { checklistItem: 'Sauna' }), /Choose a check from the checklist of this clean/);
  await assert.rejects(prepare(c.workId, { purpose: 'mailbox', checklistItem: 'Kitchen' }), /cleaning photo of one check/);
  await assert.rejects(prepare(c.workId, { checklistItem: 'x'.repeat(201) }), /cleaning photo of one check/);
  assert.equal(mediaInputSchema.safeParse({ requestId: crypto.randomUUID(), workId: c.workId, purpose: 'maintenance', checklistItem: 'Kitchen' }).success, false, 'the upload route refuses it first');
  // Retrying an upload must name the same check.
  const id = crypto.randomUUID();
  await prepare(c.workId, { checklistItem: 'Kitchen' }, id);
  await assert.rejects(prepare(c.workId, { checklistItem: 'Hot tub' }, id), /Request identifier already used/);
  await assert.rejects(prepare(c.workId, {}, id), /Request identifier already used/);
  await as(OTHER_CLEANER);
  await assert.rejects(prepare(c.workId, { checklistItem: 'Kitchen' }), /denied/, 'only the cleaner on the clean');
});

test('cleans without photo rules work exactly as before', async () => {
  // No checklist at this property, and none for every property.
  const plain = await clean(elsewhere, ['Kitchen', 'Hot tub']);
  await as(CLEANER);
  assert.deepEqual(cleanRulesSchema.parse(await read('clean', plain.workId)).rules, []);
  assert.equal((await submit(plain, [await photo(plain.workId, null)])).data.phase, 'review');

  // A clean whose checks are not on the property's checklist has no photo rules either.
  const other = await clean(property, ['Windows', 'Garden']);
  assert.equal((await submit(other, [await photo(other.workId, null)])).data.phase, 'review');

  // The checklist for every property applies where a property has none of its own.
  await as(MANAGER);
  await act({ action: 'saveTemplate', propertyId: null, version: 0, items: [{ label: 'Windows', photoRequired: true }] });
  const covered = await clean(elsewhere, ['Windows']);
  await assert.rejects(submit(covered, [await photo(covered.workId, null)]), /Windows/);
  const own = await clean(property, ['Windows']);
  assert.equal((await submit(own, [await photo(own.workId, null)])).data.phase, 'review', 'a property with its own checklist does not use the one for every property');
  await as(MANAGER);
  await act({ action: 'removeTemplate', propertyId: null, version: 1 });
});

test('new Hostaway checkout cleans take the property checklist', async () => {
  // The live sync is paused for the new business; switched back on for this test.
  await owner('update private.workspace_hostaway_sync_state set paused=false where singleton');
  await owner("update public.workspace_properties set hostaway_listing_id='7001' where id=$1", [property]);
  await owner("update public.workspace_properties set hostaway_listing_id='7002' where id=$1", [elsewhere]);
  const stay = (id, listingId) => ({ id, listingId, checkIn: today, checkOut: (new Date(Date.parse(today) + 3 * 864e5)).toISOString().slice(0, 10), status: 'confirmed', channel: 'airbnb', guests: 2 });
  await as('service');
  await db.query("select set_config('request.jwt.claims','',false)");
  await rpc('workspace_hostaway_sync', [{ trigger: 'schedule', reservations: [stay('h1', '7001'), stay('h2', '7002')] }]);
  const checklists = await owner("select w.property_id,d.data->'checklist' checklist from private.workspace_domain_details d join public.workspace_work_items w on w.id=d.work_id where d.data->>'source'='hostaway'");
  assert.deepEqual(checklists.find(r => r.property_id === property).checklist, (await template(property)).items.map(i => i.label));
  assert.equal(checklists.find(r => r.property_id === elsewhere).checklist.length, 7, 'the standard checks where no checklist is set');
});
