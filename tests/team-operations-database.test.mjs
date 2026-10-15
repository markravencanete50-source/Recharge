import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const roles = ['super_admin', 'stays', 'cleans', 'client', 'cleaning_manager', 'ready', 'admin', 'cleans'];
const users = roles.map((_, i) => `91000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, STAYS, CLEANER, OWNER, MANAGER, READY, ADMIN, OTHER_CLEANER] = roles.map((_, i) => i);
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `teams${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [users[i].replace('9100', '9200'), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [users[i].replace('9100', '9200'), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], `Team ${i}`]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: users[i].replace('9100', '9200') })]);
  await db.exec('set role authenticated');
}
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const teams = input => rpc('workspace_teams_action', [{ requestId: crypto.randomUUID(), ...input }]);
const read = (section, from = null, to = null, propertyId = null, userId = null) => rpc('workspace_teams_read', [section, from, to, propertyId, userId]);
const operation = input => rpc('workspace_operations_action', [{ requestId: crypto.randomUUID(), ...input }]);
const day = (await db.query("select current_date::text d,to_char(current_date,'YYYY-MM') m,(current_date+20)::text later")).rows[0];

await as(SUPER);
const property = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Team test property' }]);
for (const [user, kind] of [[STAYS, 'staff'], [CLEANER, 'cleaner'], [OWNER, 'client'], [MANAGER, 'cleaning_manager'], [READY, 'staff'], [OTHER_CLEANER, 'cleaner']]) await rpc('workspace_assign_property', [property, users[user], kind]);
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
after(() => db.close());

// A clean submitted by the cleaner, then rejected by the cleaning manager.
async function rejectedClean(cleaner = CLEANER) {
  await as(MANAGER);
  const clean = await operation({ action: 'createOperation', propertyId: property, kind: 'cleaning', data: { dueOn: day.d, checklist: ['Kitchen'] } });
  await rpc('workspace_assign_work', [clean.workId, clean.version, users[cleaner]]);
  await db.exec('reset role');
  const photo = (await db.query("insert into private.workspace_media_evidence(property_id,work_id,owner_id,purpose,provider_id,verified_at) values($1,$2,$3,'cleaning',$4,now()) returning id", [property, clean.workId, users[cleaner], 'TEST-ONLY-' + crypto.randomUUID()])).rows[0].id;
  await as(cleaner);
  let work = (await rpc('workspace_operations_read', [property])).find(w => w.workId === clean.workId);
  work = await operation({ action: 'updateOperation', workId: clean.workId, version: work.version, step: 'submitCleaning', data: { checks: ['Kitchen'], report: 'Kitchen cleaned', photoIds: [photo] } });
  await as(MANAGER);
  await operation({ action: 'updateOperation', workId: clean.workId, version: work.version, step: 'reviewCleaning', data: { accepted: false, redoBy: new Date(Date.now() + 3600000).toISOString(), guestFeedback: 'Guest reported crumbs', reviewNote: 'Counter not wiped' } });
  await db.exec('reset role');
  const complaint = (await db.query("select w.id,w.version from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where d.kind='cleaning_complaint' and d.data->>'sourceWorkId'=$1", [clean.workId])).rows[0];
  return { clean: clean.workId, complaint };
}

test('the cleaner responds once and management overturns a rejection so the clean can be invoiced', async () => {
  const { clean, complaint } = await rejectedClean();
  await as(OTHER_CLEANER);
  await assert.rejects(teams({ action: 'addCleanerStatement', workId: complaint.id, statement: 'This was not my clean at all' }), /cleaner concerned/);
  await as(CLEANER);
  let mine = (await read('performance'))[0];
  assert.equal(mine.rejected, 1); assert.equal(mine.openComplaints.length, 1);
  await teams({ action: 'addCleanerStatement', workId: complaint.id, statement: 'Counter was wiped; photo shows it clean' });
  await assert.rejects(teams({ action: 'addCleanerStatement', workId: complaint.id, statement: 'Trying to answer a second time' }), /already responded/);
  // Cleaning managers decide disputes on their own properties (cleans-disputes-database.test.mjs); Stays do not.
  await as(STAYS);
  await assert.rejects(teams({ action: 'decideComplaint', workId: complaint.id, version: complaint.version, outcome: 'overturned', note: 'Not management' }), /Management access required/);
  await as(ADMIN);
  const queue = await read('management');
  const pending = queue.cleaningDecisions.find(d => d.workId === complaint.id);
  assert.equal(pending.cleanerStatement, 'Counter was wiped; photo shows it clean');
  await assert.rejects(teams({ action: 'decideComplaint', workId: complaint.id, version: complaint.version, outcome: 'maybe', note: 'Unclear outcome' }), /Choose an outcome/);
  const decided = await teams({ action: 'decideComplaint', workId: complaint.id, version: pending.version, outcome: 'overturned', note: 'Photos show the counter clean' });
  assert.equal(decided.status, 'completed');
  await assert.rejects(teams({ action: 'decideComplaint', workId: complaint.id, version: decided.version, outcome: 'upheld', note: 'Second decision attempt' }), /Already decided/);
  await db.exec('reset role');
  const source = (await db.query("select w.status,d.data->>'phase' phase from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where w.id=$1", [clean])).rows[0];
  assert.deepEqual(source, { status: 'completed', phase: 'accepted' });
  assert.equal((await db.query("select count(*)::int n from private.workspace_domain_details where kind='cleaning_invoice' and data->>'sourceWorkId'=$1", [clean])).rows[0].n, 1);
  await as(CLEANER);
  mine = (await read('performance'))[0];
  assert.equal(mine.rejected, 0); assert.equal(mine.overturned, 1); assert.equal(mine.openComplaints.length, 0);
});

test('two upheld rejections in a month raise a warning for management', async () => {
  for (let i = 0; i < 2; i++) {
    const { complaint } = await rejectedClean(OTHER_CLEANER);
    await as(SUPER);
    await teams({ action: 'decideComplaint', workId: complaint.id, version: complaint.version, outcome: 'upheld', note: 'Guest evidence confirms the issue' });
  }
  await as(MANAGER);
  const other = (await read('performance')).find(c => c.cleanerId === users[OTHER_CLEANER]);
  assert.equal(other.rejected, 2); assert.equal(other.warning, true);
  await as(ADMIN);
  const queue = await read('management');
  assert.ok(queue.cleanerWarnings.some(c => c.cleanerId === users[OTHER_CLEANER]));
  assert.ok(queue.cleaningDecisions.some(d => d.kind === 'cleaner_management_review'));
  const review = queue.cleaningDecisions.find(d => d.kind === 'cleaner_management_review');
  const result = await teams({ action: 'decideCleanerReview', workId: review.workId, version: review.version, outcome: 'supervised', note: 'Two supervised cleans before working alone' });
  assert.equal(result.outcome, 'supervised');
  await as(STAYS); await assert.rejects(read('management'), /Management access required/);
  await as(CLEANER); await assert.rejects(read('management'), /Management access required/);
});

test('the shared schedule respects each role and range limits', async () => {
  await as(STAYS);
  await operation({ action: 'recordReservation', propertyId: property, reference: 'Schedule stay', checkIn: day.d, checkOut: day.later, status: 'confirmed' });
  const staff = await read('schedule', day.d, day.later);
  assert.ok(staff.work.length >= 1); assert.equal(staff.stays.length, 1); assert.equal(staff.stays[0].channel, 'direct');
  await as(CLEANER);
  const mine = await read('schedule', day.d, day.later);
  assert.ok(mine.work.every(w => w.assigneeId === users[CLEANER])); assert.deepEqual(mine.stays, []);
  await assert.rejects(read('schedule', day.d, day.later, null, users[OTHER_CLEANER]), /Schedule access denied/);
  await as(OWNER);
  const owner = await read('schedule', day.d, day.later);
  assert.equal(owner.stays.length, 1); assert.equal(owner.stays[0].channel, null);
  await assert.rejects(read('schedule', day.d, '2099-01-01'), /up to 62 days/);
  await as(MANAGER);
  const filtered = await read('schedule', day.d, day.later, null, users[OTHER_CLEANER]);
  assert.ok(filtered.work.length >= 1 && filtered.work.every(w => w.assigneeId === users[OTHER_CLEANER]));
});

test('routine plans generate one visit per due period with a current team assignee', async () => {
  await as(OWNER);
  await assert.rejects(teams({ action: 'saveRoutinePlan', propertyId: property, moduleId: 'routine-bin-garden-board', title: 'Bins', checklist: ['Bins out'], frequency: 'monthly', dayOfMonth: 5, active: true }), /Routine maintenance access/);
  await as(READY);
  await assert.rejects(teams({ action: 'saveRoutinePlan', propertyId: property, moduleId: 'routine-bin-garden-board', title: 'Bins', checklist: ['Bins out'], frequency: 'monthly', dayOfMonth: 5, assigneeId: users[CLEANER], active: true }), /property team/);
  const plan = await teams({ action: 'saveRoutinePlan', propertyId: property, moduleId: 'routine-bin-garden-board', title: 'Bins and garden', checklist: ['Bins out', 'Lawn cut'], frequency: 'monthly', dayOfMonth: 5, assigneeId: users[READY], active: true });
  await teams({ action: 'saveRoutinePlan', propertyId: property, moduleId: 'safety-maintenance', title: 'Smoke alarm test', checklist: ['Test alarms'], frequency: 'quarterly', dayOfMonth: 10, active: true });
  const first = await teams({ action: 'generateRoutineVisits', period: day.m });
  assert.equal(first.created.length, 2); assert.equal(first.remaining, 0);
  assert.equal((await teams({ action: 'generateRoutineVisits', period: day.m })).created.length, 0);
  const next = (await db.query("select to_char(current_date+interval '1 month','YYYY-MM') m")).rows[0].m;
  assert.equal((await teams({ action: 'generateRoutineVisits', period: next })).created.length, 1, 'quarterly plan is not due next month');
  await assert.rejects(teams({ action: 'generateRoutineVisits', period: '2020-01' }), /this month or the next two/);
  const listed = (await read('routines')).find(r => r.id === plan.id);
  assert.equal(listed.lastVisit.period, next);
  await db.exec('reset role');
  const visit = (await db.query("select w.assignee_id,w.due_on::text due from public.workspace_work_items w join private.workspace_routine_visits v on v.work_id=w.id where v.plan_id=$1 and v.period_start=date_trunc('month',current_date)::date", [plan.id])).rows[0];
  assert.equal(visit.assignee_id, users[READY]); assert.ok(visit.due.endsWith('-05'));
  await as(READY);
  const edited = await teams({ action: 'saveRoutinePlan', planId: plan.id, version: plan.version, propertyId: property, moduleId: 'routine-bin-garden-board', title: 'Bins and garden', checklist: ['Bins out'], frequency: 'monthly', dayOfMonth: 5, active: false });
  assert.equal(edited.active, false);
  await assert.rejects(teams({ action: 'saveRoutinePlan', planId: plan.id, version: plan.version, propertyId: property, moduleId: 'routine-bin-garden-board', title: 'Stale edit', checklist: ['x'], frequency: 'monthly', dayOfMonth: 5, active: true }), /Routine plan changed/);
});

test('training courses reach their audience and record completion', async () => {
  await as(STAYS);
  await assert.rejects(teams({ action: 'saveCourse', title: 'Turnover standard', audience: ['cleans'], body: 'How to complete a turnover clean.', minutes: 15, published: true }), /Management access required/);
  await as(ADMIN);
  await assert.rejects(teams({ action: 'saveCourse', title: 'Bad audience', audience: ['everyone'], body: 'Body text that is long enough.', minutes: 15, published: true }), /audience|check/);
  await assert.rejects(teams({ action: 'saveCourse', title: 'Bad link', audience: ['cleans'], body: 'Body text that is long enough.', videoUrl: 'http://example.com/v', minutes: 15, published: true }), /video_url|check/);
  const course = await teams({ action: 'saveCourse', title: 'Turnover standard', audience: ['cleans', 'cleaning_manager'], summary: 'Room by room', body: 'How to complete a turnover clean.', videoUrl: 'https://videos.example.com/turnover', minutes: 15, published: true });
  const draft = await teams({ action: 'saveCourse', title: 'Draft course', audience: ['all'], body: 'Not ready for the team yet.', minutes: 5, published: false });
  await as(CLEANER);
  const visible = await read('training');
  assert.deepEqual(visible.map(c => c.title), ['Turnover standard']);
  await teams({ action: 'completeCourse', courseId: course.id });
  await teams({ action: 'completeCourse', courseId: course.id });
  assert.ok((await read('training'))[0].completedAt);
  await assert.rejects(teams({ action: 'completeCourse', courseId: draft.id }), /Course not available/);
  await as(STAYS);
  assert.deepEqual(await read('training'), []);
  await as(ADMIN);
  const admin = await read('training');
  assert.equal(admin.find(c => c.id === course.id).completions, 1);
  assert.ok(admin.some(c => c.id === draft.id));
});
