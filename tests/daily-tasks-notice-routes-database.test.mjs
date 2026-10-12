import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Daily department to-dos and notices for the next team (20261012160000). Admins keep templates of
// what a department does on given weekdays; making a day's to-dos is safe to repeat (one per template
// per day) and only follows the template's weekdays; any team role can make today's, owners nothing.
// A ticked-off step that has a notice route reaches the routed team on the work's property and the
// admins, never the person who did it, owners, cleaners or staff not on the property, and the
// trigger can never make the step itself fail.
const NAME = 'supabase/migrations/20261012160000_daily_tasks_notice_routes';
const exists = path => fs.access(path).then(() => true, () => false);
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
// While it is still a draft, apply it after everything else (rule R1); once renamed it is in the loop above.
const FINAL = await exists(NAME + '.sql');
const MIGRATION = await fs.readFile(NAME + (FINAL ? '.sql' : '.sql.draft'), 'utf8');
if (!FINAL) await db.exec(MIGRATION);
after(() => db.close());

const people = [
  ['super_admin', 'Alex Admin'], ['admin', 'Ada Admin'], ['stays', 'Sam Stays'], ['stays', 'Una Elsewhere'], ['ready', 'Rory Ready'], ['ready', 'Rita Elsewhere'],
  ['accounts', 'Aileen Accounts'], ['cleans', 'Cara Cleaner'], ['cleaning_manager', 'Mo Manager'], ['client', 'Owen Owner'], ['ready', 'Reg Revoked'],
];
const users = people.map((_, i) => `d6000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [ALEX, ADA, SAM, UNA, RORY, RITA, AILEEN, CARA, MO, OWEN, REG] = people.map((_, i) => i);
const session = i => users[i].replace('d600', 'd700');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `daily${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  // Profiles are made in this order, so Alex is the earliest admin.
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3,created_at=now()+make_interval(secs=>$4) where user_id=$1", [users[i], people[i][0], people[i][1], i]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
for (const [i, department] of [[SAM, 'guest_relations'], [UNA, 'guest_relations'], [AILEEN, 'accounts'], [MO, 'cleaning'], [RORY, 'ready']]) {
  await db.query("insert into private.workspace_staff_rota(user_id,department,usual_shift) values($1,$2,'early')", [users[i], department]);
}
async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
async function asDb() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); }
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const sql = async (text, args = []) => { await asDb(); return (await db.query(text, args)).rows; };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const act = (input, requestId = crypto.randomUUID()) => rpc('workspace_teams_action', [JSON.stringify({ requestId, ...input })]);
const read = section => rpc('workspace_teams_read', [section, null, null, null, null]);
const ensure = async day => (await sql('select private.workspace_ensure_daily_todos($1::date) r', [day]))[0].r;
const madeFor = (template, day) => sql('select * from private.workspace_hub_items where template_id=$1 and due_on=$2', [template, day]);
const notices = async (i, event) => Number((await sql('select count(*) n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.user_id=$1 and a.event_type=$2', [users[i], event]))[0].n);
const recipients = async eventId => (await sql('select p.full_name from private.workspace_notification_outbox o join public.workspace_profiles p on p.user_id=o.user_id where o.event_id=$1 order by p.full_name', [eventId])).map(r => r.full_name);
const today = (await sql("select (now() at time zone 'Europe/London')::date::text d"))[0].d;
const MONDAY = '2026-10-12', TUESDAY = '2026-10-13', SUNDAY = '2026-10-18';

// One property: Sam, Rory, Aileen and Reg are its staff, Cara its cleaner, Mo its cleaning manager and
// Owen its owner. Una (Stays) and Rita (Ready) work elsewhere. Reg is then blocked.
await as(ALEX);
const HOME = (await db.query('select public.workspace_save_property($1::jsonb) id', [JSON.stringify({ requestId: crypto.randomUUID(), name: 'Daily routes flat', address: '1 Test Street', region: 'Glasgow', bedrooms: 2 })])).rows[0].id;
for (const [i, assignment] of [[SAM, 'staff'], [RORY, 'staff'], [AILEEN, 'staff'], [REG, 'staff'], [CARA, 'cleaner'], [MO, 'cleaning_manager'], [OWEN, 'client']]) {
  await db.query('select public.workspace_assign_property($1,$2,$3)', [HOME, users[i], assignment]);
}
await sql("update public.workspace_profiles set status='revoked' where user_id=$1", [users[REG]]);

let inbox, sunday, paused;
test('daily tasks: only admins keep the list, owners can do nothing', async () => {
  const task = { action: 'saveDailyTask', department: 'guest_relations', title: 'Check the guest inbox', details: 'Before 10am', weekdays: [5, 1, 2, 3, 4], active: true };
  await as(SAM);
  await assert.rejects(act(task), /Management access/);
  await assert.rejects(read('dailyTasks'), /Management access/);
  await as(OWEN);
  await assert.rejects(act(task), /Team access/);
  await assert.rejects(act({ action: 'ensureDailyTodos' }), /Team access/);
  await assert.rejects(read('dailyTasks'), /Management access/);

  await as(ADA);
  for (const [change, message] of [[{ weekdays: [1, 1] }, /each once/], [{ weekdays: [8] }, /each once/], [{ weekdays: [] }, /each once/], [{ weekdays: [1.5] }, /each once/],
    [{ department: 'nowhere' }, /department/], [{ title: 'x' }, /title/], [{ active: 'yes' }, /is on/], [{ colour: 'red' }, /Unknown or oversized/]]) {
    await assert.rejects(act({ ...task, ...change }), message);
  }
  inbox = await act(task);
  assert.deepEqual(inbox.weekdays, [1, 2, 3, 4, 5], 'kept in weekday order');
  assert.equal(inbox.createdByName, 'Ada Admin');
  assert.equal(inbox.lastMadeOn, null);
  sunday = await act({ ...task, department: 'cleaning', title: 'Sunday linen count', details: '', weekdays: [7] });
  paused = await act({ ...task, department: 'accounts', title: 'Chase late invoices', weekdays: [1, 2, 3, 4, 5, 6, 7], active: false });
  const requestId = crypto.randomUUID();
  const renamed = await act({ ...task, id: inbox.id, title: 'Check the guest inbox and reply' }, requestId);
  assert.equal(renamed.version, 2);
  assert.deepEqual(await act({ ...task, id: inbox.id, title: 'Check the guest inbox and reply' }, requestId), renamed, 'a retry gets the same answer');
  await assert.rejects(act({ ...task, id: inbox.id, title: 'Something else' }, requestId), /reused/);
  inbox = renamed;

  const gone = await act({ ...task, department: 'management', title: 'Removed straight away', weekdays: [1] });
  await as(SAM);
  await assert.rejects(act({ action: 'removeDailyTask', id: gone.id }), /Management access/);
  await as(ALEX);
  assert.deepEqual(await act({ action: 'removeDailyTask', id: gone.id }), { id: gone.id, removed: true });
  await assert.rejects(act({ action: 'removeDailyTask', id: gone.id }), /not found/);
  await assert.rejects(act({ ...task, id: gone.id }), /not found/);
  const list = await read('dailyTasks');
  assert.equal(list.section, 'dailyTasks');
  assert.equal(list.today, today);
  assert.deepEqual(list.templates.map(t => t.title), ['Chase late invoices', 'Sunday linen count', 'Check the guest inbox and reply']);
});

test('making a day\'s to-dos: once per template per day, only on its weekdays', async () => {
  const monday = await ensure(MONDAY);
  assert.deepEqual(monday, { day: MONDAY, due: 1, created: 1 }, 'the inbox check; not the Sunday count, not the paused one');
  assert.deepEqual(await ensure(MONDAY), { day: MONDAY, due: 1, created: 0 }, 'again: nothing new');
  assert.equal((await madeFor(inbox.id, MONDAY)).length, 1);
  assert.equal((await madeFor(sunday.id, MONDAY)).length, 0);
  assert.equal((await madeFor(paused.id, MONDAY)).length, 0);
  const [made] = await madeFor(inbox.id, MONDAY);
  assert.equal(made.kind, 'todo'); assert.equal(made.status, 'open'); assert.equal(made.department, 'guest_relations');
  assert.equal(made.assignee_id, null); assert.equal(made.title, 'Check the guest inbox and reply'); assert.equal(made.details, 'Before 10am');
  assert.equal(made.created_by, users[ALEX], 'made by the earliest active admin');

  assert.deepEqual(await ensure(SUNDAY), { day: SUNDAY, due: 1, created: 1 });
  assert.equal((await madeFor(inbox.id, SUNDAY)).length, 0);
  assert.equal((await madeFor(sunday.id, SUNDAY)).length, 1);
  assert.equal((await ensure(TUESDAY)).created, 1);
  assert.equal((await ensure(TUESDAY)).created, 0);

  // The department hears once per run that makes something; nobody else does.
  assert.equal(await notices(SAM, 'todo.daily_created'), 2, 'Monday and Tuesday');
  assert.equal(await notices(UNA, 'todo.daily_created'), 2);
  assert.equal(await notices(MO, 'todo.daily_created'), 1, 'Sunday');
  for (const i of [AILEEN, RORY, OWEN, CARA, ALEX]) assert.equal(await notices(i, 'todo.daily_created'), 0);

  // The department sees its own, with the template it came from; the template knows its last day.
  await as(UNA);
  const hub = await read('hub');
  const mine = hub.items.filter(i => i.templateId === inbox.id).map(i => i.dueOn).sort();
  assert.deepEqual(mine, [MONDAY, TUESDAY]);
  assert.ok(!hub.items.some(i => i.templateId === sunday.id), 'not the cleaning team\'s');
  await as(ALEX);
  assert.equal((await read('dailyTasks')).templates.find(t => t.id === inbox.id).lastMadeOn, TUESDAY);

  // Moving it to done does not bring it back.
  await as(SAM);
  const item = hub.items.find(i => i.templateId === inbox.id && i.dueOn === MONDAY);
  assert.equal((await act({ action: 'moveHubItem', id: item.id, version: item.version, status: 'done' })).status, 'done');
  assert.equal((await ensure(MONDAY)).created, 0);
  assert.equal((await madeFor(inbox.id, MONDAY))[0].status, 'done');
  // A to-do can only point at a template if it is a dated department to-do.
  await assert.rejects(sql("insert into private.workspace_hub_items(kind,title,status,created_by,template_id,assignee_id) values('todo','No day',  'open',$1,$2,$1)", [users[ALEX], inbox.id]), /template_todo/);
});

test('the ensureDailyTodos action: any team role, for today only, safe to repeat', async () => {
  await as(ALEX);
  const every = await act({ action: 'saveDailyTask', department: 'ready', title: 'Walk round the van stock', details: '', weekdays: [1, 2, 3, 4, 5, 6, 7], active: true });
  await as(CARA);
  const first = await act({ action: 'ensureDailyTodos' });
  assert.equal(first.day, today);
  assert.ok(first.created >= 1);
  assert.deepEqual(await act({ action: 'ensureDailyTodos', day: today }), { ...first, created: 0 }, 'a cleaner can ask too; nothing new');
  const tomorrow = (await sql("select ((now() at time zone 'Europe/London')::date+1)::text d"))[0].d;
  await as(SAM);
  await assert.rejects(act({ action: 'ensureDailyTodos', day: tomorrow }), /today only/);
  await assert.rejects(act({ action: 'ensureDailyTodos', day: 'today' }), /valid date/);
  await assert.rejects(act({ action: 'ensureDailyTodos', when: today }), /Unknown or oversized/);
  assert.equal((await madeFor(every.id, today)).length, 1);
  assert.equal(await notices(RORY, 'todo.daily_created') >= 1, true, 'the Ready team hears');

  // The backend's daily run: service role only.
  await asDb(); await db.exec('set role service_role');
  assert.equal((await db.query('select public.workspace_ensure_daily_todos() r')).rows[0].r.created, 0);
  await as(SAM);
  await assert.rejects(db.query('select public.workspace_ensure_daily_todos()'), /permission denied/);
  await assert.rejects(db.query("select private.workspace_ensure_daily_todos('2026-10-12')"), /permission denied/);
});

// A piece of work on the property, written straight into the tables, and a step on it.
async function work(title = 'Two dining chairs') {
  return (await sql("insert into public.workspace_work_items(request_id,property_id,module_id,title) values(gen_random_uuid(),$1,'purchase-order-requests',$2) returning id", [HOME, title]))[0].id;
}
async function step(workId, event, actor) {
  return (await sql('insert into public.workspace_activity(actor_id,property_id,work_id,event_type) values($1,$2,$3,$4) returning id', [actor === null ? null : users[actor], HOME, workId, event]))[0].id;
}

test('a routed step reaches the next team on the property and the admins, nobody else', async () => {
  const chairs = await work();
  // Accounts approve a purchase: Ready and Stays on the property hear, and both admins.
  assert.deepEqual(await recipients(await step(chairs, 'operations.updateOperation.approvePurchase', AILEEN)), ['Ada Admin', 'Alex Admin', 'Rory Ready', 'Sam Stays'],
    'not Aileen who did it, not Una or Rita who work elsewhere, not Reg who is blocked, not the owner or the cleaner');
  // Ready record the delivery: Accounts hear.
  assert.deepEqual(await recipients(await step(chairs, 'operations.updateOperation.recordDelivery', RORY)), ['Ada Admin', 'Aileen Accounts', 'Alex Admin']);
  // A rejected clean goes to the property's cleaning manager.
  assert.deepEqual(await recipients(await step(chairs, 'cleaning.rejected', SAM)), ['Ada Admin', 'Alex Admin', 'Mo Manager']);
  // An admin doing it is left out; the other admin still hears.
  assert.deepEqual(await recipients(await step(chairs, 'operations.updateOperation.recordOrder', ALEX)), ['Ada Admin', 'Rory Ready']);
  // The backend doing it (no actor): everyone routed.
  assert.deepEqual(await recipients(await step(chairs, 'operations.updateOperation.submitCleaning', null)), ['Ada Admin', 'Alex Admin', 'Mo Manager', 'Sam Stays']);
  // Events without a route, or without a work item, add nothing.
  assert.deepEqual(await recipients(await step(chairs, 'operations.createOperation', SAM)), []);
  assert.deepEqual(await recipients(await step(null, 'operations.updateOperation.approvePurchase', AILEEN)), []);
  // Owners never get a route, and nor do cleaners.
  await assert.rejects(sql("insert into private.workspace_notice_routes(event_type,role) values('operations.updateOperation.approvePurchase','client')"), /check/);
  await assert.rejects(sql("insert into private.workspace_notice_routes(event_type,role) values('operations.updateOperation.approvePurchase','cleans')"), /check/);
  assert.equal(Number((await sql("select count(*) n from private.workspace_notice_routes where role not in ('stays','cleaning_manager','ready','accounts')"))[0].n), 0);
});

test('a real step through the operations action: one notice each, also on a retry', async () => {
  await as(SAM);
  const action = (input, requestId = crypto.randomUUID()) => db.query('select public.workspace_operations_action($1::jsonb) result', [JSON.stringify({ requestId, ...input })]).then(r => r.rows[0].result);
  const purchase = await action({ action: 'createOperation', propertyId: HOME, kind: 'purchase', data: { requirements: 'A new kettle for the kitchen', budgetMinor: 5000 } });
  await as(AILEEN);
  const requestId = crypto.randomUUID();
  const approve = { action: 'updateOperation', workId: purchase.workId, version: purchase.version, step: 'approvePurchase', data: { approvedAmountMinor: 4000, approvalNote: 'Within the request' } };
  const approved = await action(approve, requestId);
  assert.equal(approved.data.phase, 'approved');
  assert.deepEqual(await action(approve, requestId), approved, 'the retry is answered from the receipt');
  const events = await sql("select id from public.workspace_activity where work_id=$1 and event_type='operations.updateOperation.approvePurchase'", [purchase.workId]);
  assert.equal(events.length, 1);
  const heard = await recipients(events[0].id);
  for (const name of ['Rory Ready', 'Sam Stays', 'Ada Admin', 'Alex Admin']) assert.ok(heard.includes(name), name);
  for (const name of ['Aileen Accounts', 'Rita Elsewhere', 'Una Elsewhere', 'Cara Cleaner', 'Reg Revoked']) assert.ok(!heard.includes(name), name);
  assert.equal(new Set(heard).size, heard.length, 'one row per person');
  assert.equal(await notices(RITA, 'operations.updateOperation.approvePurchase'), 0, 'Ready elsewhere never hears');

  // Referring a repair to Ready: the action already tells Ready; the route adds the admins, never a second row.
  await as(SAM);
  const repair = await action({ action: 'createOperation', propertyId: HOME, kind: 'maintenance', data: { issue: 'The kitchen tap drips', estimatedCostMinor: 0, hazard: false } });
  assert.equal(repair.data.phase, 'triage');
  await action({ action: 'updateOperation', workId: repair.workId, version: repair.version, step: 'referReady', data: { troubleshooting: 'Tightened the tap, still drips', guestUpdate: 'A plumber will be booked' } });
  const [refer] = await sql("select id from public.workspace_activity where work_id=$1 and event_type='operations.updateOperation.referReady'", [repair.workId]);
  const referHeard = await recipients(refer.id);
  assert.equal(referHeard.filter(n => n === 'Rory Ready').length, 1);
  assert.ok(referHeard.includes('Ada Admin') && referHeard.includes('Alex Admin'));
  assert.ok(!referHeard.includes('Sam Stays') && !referHeard.includes('Rita Elsewhere'));
});

test('the notice trigger never makes the step fail', async () => {
  const kettle = await work('A new kettle');
  // Two ways to make every outbox insert fail: a check no row can pass (NOT VALID, so the rows already
  // there are not checked), and a trigger that raises. Either way the step is still written, simply
  // without the routed notices. (A revoke would not do: the trigger runs as the table owner.)
  const failures = [
    ['alter table private.workspace_notification_outbox add constraint s3_test_refuse_all check (event_id<0) not valid',
      'alter table private.workspace_notification_outbox drop constraint s3_test_refuse_all'],
    [`create function public.s3_test_outbox_down() returns trigger language plpgsql as $$begin raise exception 'The outbox is down';end$$;
      create trigger s3_test_outbox_down before insert on private.workspace_notification_outbox for each row execute function public.s3_test_outbox_down();`,
      'drop trigger s3_test_outbox_down on private.workspace_notification_outbox;drop function public.s3_test_outbox_down();'],
  ];
  for (const [breakIt, mendIt] of failures) {
    await asDb();
    await db.exec(breakIt);
    try {
      const id = await step(kettle, 'operations.updateOperation.approvePurchase', AILEEN);
      assert.ok(id, 'the activity row is written');
      assert.deepEqual(await recipients(id), []);
    } finally {
      await asDb();
      await db.exec(mendIt);
    }
  }
  assert.deepEqual(await recipients(await step(kettle, 'operations.updateOperation.approvePurchase', AILEEN)), ['Ada Admin', 'Alex Admin', 'Rory Ready', 'Sam Stays'], 'and works again');
});

test('every seeded route is an event the database really writes with its work item', async () => {
  const routes = await sql('select distinct event_type from private.workspace_notice_routes order by 1');
  assert.ok(routes.length >= 20);
  const operations = (await sql("select pg_get_functiondef('private.workspace_operations_action(jsonb)'::regprocedure) d"))[0].d;
  assert.ok(operations.includes("values(auth.uid(),prop,target,'operations.'||a||coalesce('.'||step,''))"), 'operations steps are written with their work item');
  const sources = (await sql(`select p.oid::regprocedure::text fn,p.prosrc src from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname<>'workspace_notice_route_activity'`));
  for (const { event_type: event } of routes) {
    if (event.startsWith('operations.updateOperation.')) {
      const name = event.slice('operations.updateOperation.'.length);
      assert.ok(new RegExp(`step(='|\\s+in\\s*\\([^)]*')${name}'`).test(operations), `${name} is a step of workspace_operations_action`);
    } else {
      const writers = sources.filter(s => s.src.includes(`'${event}'`) && /insert into public\.workspace_activity\(actor_id,property_id,work_id,event_type\)/.test(s.src));
      assert.ok(writers.length >= 1, `${event} is written with a work item`);
    }
  }
});

test('safe to run twice; every patch anchor found once', async () => {
  const before = Number((await sql('select count(*) n from private.workspace_notice_routes'))[0].n);
  await asDb();
  await db.exec(MIGRATION);
  assert.equal(Number((await sql('select count(*) n from private.workspace_notice_routes'))[0].n), before);
  const def = async fn => (await sql('select pg_get_functiondef($1::regprocedure) d', [fn]))[0].d;
  const count = (text, part) => text.split(part).length - 1;
  const reader = await def('private.workspace_teams_read(text,date,date,uuid,uuid)');
  assert.equal(count(reader, "elsif section='hub' then result:=private.workspace_hub_read();"), 1);
  assert.equal(count(reader, 'private.workspace_daily_tasks_read()'), 1);
  const action = await def('private.workspace_teams_action(jsonb)');
  assert.equal(count(action, "if a in ('saveHubItem','moveHubItem') then return private.workspace_hub_action(input);end if;"), 1);
  assert.equal(count(action, 'private.workspace_daily_task_action(input)'), 1);
  const view = await def('private.workspace_hub_view(private.workspace_hub_items)');
  assert.equal(count(view, "'clientId',item.client_id,"), 1);
  assert.equal(count(view, "'templateId',item.template_id"), 1);
  assert.equal(Number((await sql("select count(*) n from pg_trigger where tgrelid='public.workspace_activity'::regclass and tgname='workspace_notice_routes'"))[0].n), 1);
  // And it still works after the second run.
  assert.equal((await ensure(MONDAY)).created, 0);
  assert.deepEqual(await recipients(await step(await work('After the rerun'), 'operations.updateOperation.recordDelivery', RORY)), ['Ada Admin', 'Aileen Accounts', 'Alex Admin']);
});
