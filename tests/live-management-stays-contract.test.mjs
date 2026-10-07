import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// The live Management, Stays and Training screens send these exact actions and
// parse these exact responses. Run them through the HTTP schemas and the database.
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false } });
const live = await vite.ssrLoadModule('/lib/management-live.ts');
const { payoutRowSchema } = await vite.ssrLoadModule('/lib/accounts-live.ts');
const { scheduleSchema } = await vite.ssrLoadModule('/lib/cleans-live.ts');
const { operationsActionSchema } = await vite.ssrLoadModule('/lib/operations-policy.ts');
const { businessWriteSchema } = await vite.ssrLoadModule('/lib/business-policy.ts');
const { teamsActionSchema, teamsReadSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { financeActionSchema } = await vite.ssrLoadModule('/lib/workspace-finance-policy.ts');
const { operationViewSchema } = await vite.ssrLoadModule('/lib/workspace-view.ts');

const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
after(async () => { await db.close(); await vite.close(); });
const roles = ['super_admin', 'admin', 'stays', 'cleaning_manager', 'cleans'];
const users = roles.map((_, i) => `d1000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, STAYS, MANAGER, CLEANER] = [0, 1, 2, 3, 4];
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `mgmt${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [users[i].replace('d100', 'd200'), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [users[i].replace('d100', 'd200'), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], `Person ${i}`]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: users[i].replace('d100', 'd200') })]);
  await db.exec('set role authenticated');
}
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const rpc = async (name, args) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const operation = input => rpc('workspace_operations_action', [operationsActionSchema.parse({ requestId: crypto.randomUUID(), ...input })]);
const teams = input => rpc('workspace_teams_action', [teamsActionSchema.parse({ requestId: crypto.randomUUID(), ...input })]);
const teamsRead = query => { const q = teamsReadSchema.parse(query); return rpc('workspace_teams_read', [q.section, q.from ?? null, q.to ?? null, q.propertyId ?? null, q.userId ?? null]); };
const finance = input => rpc('workspace_finance_action', [financeActionSchema.parse({ requestId: crypto.randomUUID(), ...input })]);
const day = (await db.query("select current_date::text d,(current_date+1)::text d1,(current_date+3)::text d3,(current_date+6)::text d6,(current_date+14)::text d14")).rows[0];

await as(SUPER);
const property = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Management property' }]);
for (const [u, kind] of [[STAYS, 'staff'], [MANAGER, 'cleaning_manager'], [CLEANER, 'cleaner']]) await rpc('workspace_assign_property', [property, users[u], kind]);

test('stays: record a stay with its platform, see it on the schedule, and log the daily checks', async () => {
  await as(STAYS);
  const recorded = live.recordedReservationSchema.parse(await operation({ action: 'recordReservation', propertyId: property, reference: 'Smith family', checkIn: day.d1, checkOut: day.d3, status: 'confirmed' }));
  const row = payoutRowSchema.parse(await finance({ action: 'setReservationFinancials', propertyId: property, reservationId: recorded.reservation.id, version: recorded.reservation.version, channel: 'airbnb', channelReference: 'HMSTAYS001', guests: 3, payoutMinor: 52000 }));
  assert.equal(row.channelReference, 'HMSTAYS001'); assert.equal(row.state, 'missing');
  await assert.rejects(operation({ action: 'recordReservation', propertyId: property, reference: 'Overlap', checkIn: day.d1, checkOut: day.d3, status: 'confirmed' }), /overlaps/);

  const schedule = scheduleSchema.parse(await teamsRead({ section: 'schedule', from: day.d, to: day.d14 }));
  const stay = schedule.stays.find(s => s.reservationId === recorded.reservation.id);
  assert.equal(stay.guests, 3);
  const week = [day.d, day.d1, (await db.query("select (current_date+2)::text d")).rows[0].d, day.d3];
  assert.deepEqual(live.vacantNights(property, schedule.stays, week), [day.d, day.d3]);

  // Daily checks: listing health today and a pricing decision for a vacant night.
  await operation({ action: 'createOperation', propertyId: property, kind: 'listing_health', data: { checkedOn: day.d, platform: 'Airbnb', listingVisible: true, reviewSentiment: 'negative', reviewAcknowledged: true, suspended: false, evidence: 'Listing live, one new 3-star review' } });
  await operation({ action: 'createOperation', propertyId: property, kind: 'daily_pricing', data: { night: day.d, currentRateMinor: 15000, proposedRateMinor: 12900, decision: 'change', reason: 'Tonight still empty, local rates dropped' } });
  const ops = (await rpc('workspace_operations_read', [property])).map(o => operationViewSchema.parse(o));
  const [check] = live.dailyChecks([property], ops, day.d, day.d6);
  assert.deepEqual(check, { propertyId: property, listingCheckedToday: true, pricedNights: 1, suspended: false, negativeReview: true });
});

test('management: decide complaints and cleaner reviews from the queue', async () => {
  // Two rejected cleans: each opens a complaint, the second also a management review.
  const rejectClean = async (dueOn) => {
    await as(MANAGER);
    const created = await operation({ action: 'createOperation', propertyId: property, kind: 'cleaning', data: { dueOn, checklist: ['Kitchen'] } });
    const assign = businessWriteSchema.parse({ action: 'assignWork', workId: created.workId, version: created.version, userId: users[CLEANER] });
    await rpc('workspace_assign_work', [assign.workId, assign.version, assign.userId]);
    await db.exec('reset role');
    const photo = (await db.query("insert into private.workspace_media_evidence(property_id,work_id,owner_id,purpose,provider_id,verified_at) values($1,$2,$3,'cleaning','TEST-ONLY-mgmt-'||$4,now()) returning id", [property, created.workId, users[CLEANER], dueOn])).rows[0].id;
    await as(CLEANER);
    let job = (await rpc('workspace_operations_read', [property])).map(o => operationViewSchema.parse(o)).find(o => o.workId === created.workId);
    job = await operation({ action: 'updateOperation', workId: job.workId, version: job.version, step: 'submitCleaning', data: { checks: ['Kitchen'], report: 'Kitchen cleaned', photoIds: [photo], mailAction: 'none' } });
    await as(MANAGER);
    await operation({ action: 'updateOperation', workId: job.workId, version: job.version, step: 'reviewCleaning', data: { accepted: false, guestFeedback: 'Guest found crumbs', reviewNote: 'Counter missed' } });
  };
  await rejectClean(day.d);
  await rejectClean(day.d1);

  await as(MANAGER);
  await assert.rejects(teamsRead({ section: 'management' }), /Management access required/);
  await as(ADMIN);
  let queue = live.managementSchema.parse(await teamsRead({ section: 'management' }));
  const complaints = queue.cleaningDecisions.filter(d => d.kind === 'cleaning_complaint');
  const review = queue.cleaningDecisions.find(d => d.kind === 'cleaner_management_review');
  assert.equal(complaints.length, 2); assert.ok(review);
  assert.equal(queue.cleanerWarnings[0].cleanerId, users[CLEANER]);
  assert.ok(live.queueCount(queue) >= 3);

  // The screen builds the action from the decision kind and its outcomes.
  for (const [decision, outcome] of [[complaints[0], 'overturned'], [complaints[1], 'upheld'], [review, 'supervised']]) {
    assert.ok(live.DECISION_OUTCOMES[decision.kind].some(([value]) => value === outcome));
    const result = await teams({ action: live.decisionAction(decision), workId: decision.workId, version: decision.version, outcome, note: 'Checked the photos and the guest message' });
    assert.equal(result.status, 'completed');
  }
  queue = live.managementSchema.parse(await teamsRead({ section: 'management' }));
  assert.equal(queue.cleaningDecisions.length, 0);
  // One rejection overturned, so the warning no longer applies.
  assert.equal(queue.cleanerWarnings.length, 0);
});

test('training: management publishes a course, staff complete it', async () => {
  await as(ADMIN);
  const saved = await teams({ action: 'saveCourse', title: 'Guest arrival checks', audience: ['stays', 'cleans'], summary: 'What to check before every arrival', body: 'Check the key safe, heating and Wi-Fi before each arrival.', minutes: 10, published: true });
  let courses = live.coursesSchema.parse(await teamsRead({ section: 'training' }));
  const course = courses.find(c => c.title === 'Guest arrival checks');
  assert.equal(course.completions, 0);
  assert.ok(saved);
  await teams({ action: 'saveCourse', courseId: course.id, version: course.version, title: course.title, audience: ['stays'], body: course.body, minutes: 12, published: true });

  await as(CLEANER);
  assert.equal(live.coursesSchema.parse(await teamsRead({ section: 'training' })).length, 0, 'no longer for cleaners');
  await as(STAYS);
  courses = live.coursesSchema.parse(await teamsRead({ section: 'training' }));
  assert.equal(courses.length, 1); assert.equal(courses[0].completedAt, null); assert.equal(courses[0].completions, null);
  await teams({ action: 'completeCourse', courseId: courses[0].id });
  assert.ok(live.coursesSchema.parse(await teamsRead({ section: 'training' }))[0].completedAt);
  await as(ADMIN);
  assert.equal(live.coursesSchema.parse(await teamsRead({ section: 'training' }))[0].completions, 1);
});
