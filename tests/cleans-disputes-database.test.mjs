import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Cleaners, clean reviews and disputes: the second-rejection rule, the cleaner's notices, cleaning
// managers deciding disputes, pay rates, guests per clean and problems reported from a clean.
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const roles = ['super_admin', 'admin', 'cleaning_manager', 'cleaning_manager', 'stays', 'cleans', 'cleans', 'cleans', 'accounts', 'client'];
const users = roles.map((_, i) => `95000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, MANAGER, OTHER_MANAGER, STAYS, CLEANER, OTHER_CLEANER, THIRD_CLEANER, ACCOUNTS, OWNER] = roles.map((_, i) => i);
const session = i => users[i].replace('9500', '9600');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `disputes${i}@example.com`]);
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
const teams = input => rpc('workspace_teams_action', [{ requestId: crypto.randomUUID(), ...input }]);
const read = (section, from = null, to = null, propertyId = null, userId = null) => rpc('workspace_teams_read', [section, from, to, propertyId, userId]);
const operation = input => rpc('workspace_operations_action', [{ requestId: crypto.randomUUID(), ...input }]);
const day = (await db.query("select current_date::text d,(current_date-3)::text before,(current_date+2)::text soon,(current_date+5)::text later,(current_date+20)::text far")).rows[0];

await as(SUPER);
const property = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Dispute test flat' }]);
const elsewhere = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Another flat' }]);
for (const [user, kind] of [[MANAGER, 'cleaning_manager'], [STAYS, 'staff'], [CLEANER, 'cleaner'], [OTHER_CLEANER, 'cleaner'], [THIRD_CLEANER, 'cleaner'], [OWNER, 'client']]) await rpc('workspace_assign_property', [property, users[user], kind]);
await rpc('workspace_assign_property', [elsewhere, users[OTHER_MANAGER], 'cleaning_manager']);
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
after(() => db.close());

// A clean assigned to the cleaner and submitted with one verified photo.
async function submittedClean(cleaner = CLEANER, dueOn = day.d) {
  await as(MANAGER);
  const clean = await operation({ action: 'createOperation', propertyId: property, kind: 'cleaning', data: { dueOn, checklist: ['Kitchen', 'Bathroom'] } });
  await rpc('workspace_assign_work', [clean.workId, clean.version, users[cleaner]]);
  const [{ id: photo }] = await owner("insert into private.workspace_media_evidence(property_id,work_id,owner_id,purpose,provider_id,verified_at) values($1,$2,$3,'cleaning',$4,now()) returning id", [property, clean.workId, users[cleaner], 'TEST-ONLY-' + crypto.randomUUID()]);
  await as(cleaner);
  const work = (await rpc('workspace_operations_read', [property])).find(w => w.workId === clean.workId);
  const submitted = await operation({ action: 'updateOperation', workId: clean.workId, version: work.version, step: 'submitCleaning', data: { checks: ['Kitchen', 'Bathroom'], report: 'Kitchen and bathroom cleaned', photoIds: [photo], mailAction: 'none' } });
  return { workId: clean.workId, version: submitted.version, photo };
}
async function review(clean, accepted, reviewer = MANAGER) {
  await as(reviewer);
  return operation({ action: 'updateOperation', workId: clean.workId, version: clean.version, step: 'reviewCleaning', data: { accepted, guestFeedback: accepted ? 'Guests were happy' : 'Guest found hair in the shower', reviewNote: accepted ? 'All checks fine' : 'Shower not cleaned' } });
}
async function rejectedClean(cleaner = CLEANER) {
  const clean = await submittedClean(cleaner);
  await review(clean, false);
  const [complaint] = await owner("select w.id,w.version from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where d.kind='cleaning_complaint' and d.data->>'sourceWorkId'=$1", [clean.workId]);
  return { ...clean, complaint };
}
const openReviews = async cleaner => (await owner("select count(*)::int n from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where d.kind='cleaner_management_review' and d.data->>'cleanerId'=$1 and w.status<>'completed'", [users[cleaner]]))[0].n;
const notices = async (user, work = null) => (await owner('select a.event_type,o.work_id from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.user_id=$1 and ($2::uuid is null or o.work_id=$2::uuid) order by o.id', [users[user], work])).map(r => r.event_type);

test('a management review follows the second upheld rejection this month, not an overturned or older one', async () => {
  // A rejection of another clean last month does not count towards this month.
  const earlier = await submittedClean(THIRD_CLEANER);
  await owner("insert into private.workspace_cleaning_reviews(work_id,cleaner_id,reviewer_id,accepted,guest_feedback,review_note,created_at) values($1,$2,$3,false,'Old feedback','Old rejection',date_trunc('month',current_date)-interval '3 days')", [earlier.workId, users[THIRD_CLEANER], users[MANAGER]]);
  await review(await submittedClean(THIRD_CLEANER), false);
  assert.equal(await openReviews(THIRD_CLEANER), 0, 'one rejection this month and one last month');

  // The first rejection is overturned, so the second is only one upheld rejection.
  const first = await rejectedClean(OTHER_CLEANER);
  await as(ADMIN);
  await teams({ action: 'decideComplaint', workId: first.complaint.id, version: first.complaint.version, outcome: 'overturned', note: 'Photos show the shower clean' });
  await rejectedClean(OTHER_CLEANER);
  assert.equal(await openReviews(OTHER_CLEANER), 0, 'an overturned rejection no longer counts');
  await rejectedClean(OTHER_CLEANER);
  assert.equal(await openReviews(OTHER_CLEANER), 1, 'two upheld rejections this month');
  await as(MANAGER);
  const month = (await read('performance')).find(c => c.cleanerId === users[OTHER_CLEANER]);
  assert.equal(month.rejected, 2); assert.equal(month.warning, true, 'the same rule as the monthly warning');
  await rejectedClean(OTHER_CLEANER);
  assert.equal(await openReviews(OTHER_CLEANER), 1, 'one open review at a time');
});

test('the cleaner hears when a clean is accepted or rejected and when the dispute is decided', async () => {
  const good = await submittedClean();
  await review(good, true);
  const bad = await rejectedClean();
  assert.deepEqual((await notices(CLEANER, good.workId)).filter(e => e.startsWith('cleaning.')), ['cleaning.accepted']);
  assert.deepEqual((await notices(CLEANER, bad.workId)).filter(e => e.startsWith('cleaning.')), ['cleaning.rejected']);
  assert.ok(!(await notices(MANAGER)).some(e => e === 'cleaning.accepted' || e === 'cleaning.rejected'), 'only the cleaner, not the reviewer');
  await as(CLEANER);
  const inApp = (await rpc('workspace_controls_read', ['notifications', null, null])).map(n => n.event_type);
  assert.ok(inApp.includes('cleaning.accepted') && inApp.includes('cleaning.rejected'), 'shown in the app');
  // The rejected clean carries the reason and links to its dispute.
  let clean = (await rpc('workspace_operations_read', [property])).find(w => w.workId === bad.workId);
  assert.equal(clean.data.accepted, false); assert.equal(clean.data.reviewNote, 'Shower not cleaned'); assert.equal(clean.data.complaintWorkId, bad.complaint.id);
  await as(MANAGER);
  await teams({ action: 'decideComplaint', workId: bad.complaint.id, version: bad.complaint.version, outcome: 'upheld', note: 'Guest photo shows hair in the shower' });
  assert.deepEqual((await notices(CLEANER, bad.workId)).filter(e => e.startsWith('cleaning.')), ['cleaning.rejected', 'cleaning.dispute_upheld']);
  await as(CLEANER);
  clean = (await rpc('workspace_operations_read', [property])).find(w => w.workId === bad.workId);
  assert.equal(clean.data.disputeDecision, 'upheld'); assert.equal(clean.data.disputeNote, 'Guest photo shows hair in the shower');
  const mine = (await read('performance'))[0];
  assert.deepEqual(mine.decidedComplaints.map(c => [c.workId, c.decision, c.decisionNote]), [[bad.complaint.id, 'upheld', 'Guest photo shows hair in the shower']]);
  assert.ok((await rpc('workspace_controls_read', ['notifications', null, null])).some(n => n.event_type === 'cleaning.dispute_upheld'));
  // Overturned.
  const second = await rejectedClean();
  await as(ADMIN);
  await teams({ action: 'decideComplaint', workId: second.complaint.id, version: second.complaint.version, outcome: 'overturned', note: 'Photos show the shower clean' });
  assert.ok((await notices(CLEANER, second.workId)).includes('cleaning.dispute_overturned'));
});

test('cleaning managers decide disputes on their properties; removing a cleaner stays with admins', async () => {
  const clean = await rejectedClean();
  await as(CLEANER);
  await teams({ action: 'addCleanerStatement', workId: clean.complaint.id, statement: 'The shower was cleaned; see photo two' });
  await assert.rejects(teams({ action: 'decideComplaint', workId: clean.complaint.id, version: clean.complaint.version, outcome: 'overturned', note: 'Deciding my own' }), /Management access required/);
  for (const who of [STAYS, OTHER_MANAGER, ACCOUNTS]) {
    await as(who);
    await assert.rejects(teams({ action: 'decideComplaint', workId: clean.complaint.id, version: clean.complaint.version, outcome: 'upheld', note: 'Not my property' }), /Management access required/, roles[who]);
  }
  // The manager sees the dispute with what was submitted and why it was rejected.
  await as(MANAGER);
  const dispute = (await rpc('workspace_operations_read', [property])).find(w => w.workId === clean.complaint.id);
  assert.equal(dispute.kind, 'cleaning_complaint');
  assert.equal(dispute.data.report, 'Kitchen and bathroom cleaned'); assert.deepEqual(dispute.data.checklist, ['Kitchen', 'Bathroom']);
  assert.deepEqual(dispute.data.photoIds, [clean.photo]); assert.equal(dispute.data.reviewNote, 'Shower not cleaned'); assert.equal(dispute.data.guestFeedback, 'Guest found hair in the shower');
  assert.equal(dispute.data.cleanerStatement, 'The shower was cleaned; see photo two');
  assert.ok(await rpc('workspace_media_asset', [clean.photo]).catch(e => e.message.includes('Verified asset unavailable')), 'the manager may open the clean photos');
  const request = crypto.randomUUID();
  const input = { action: 'decideComplaint', requestId: request, workId: clean.complaint.id, version: dispute.version, outcome: 'overturned', note: 'Photo two shows the shower clean' };
  const decided = await rpc('workspace_teams_action', [input]);
  assert.equal(decided.status, 'completed');
  assert.deepEqual(await rpc('workspace_teams_action', [input]), decided, 'a retry gets the same answer');
  await assert.rejects(teams({ action: 'decideComplaint', workId: clean.complaint.id, version: decided.version, outcome: 'upheld', note: 'Changing my mind' }), /Already decided/);
  const [source] = await owner("select w.status,d.data->>'phase' phase,d.data->>'disputeDecision' decision from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where w.id=$1", [clean.workId]);
  assert.deepEqual(source, { status: 'completed', phase: 'accepted', decision: 'overturned' });
  const [invoice] = await owner("select data from private.workspace_domain_details where kind='cleaning_invoice' and data->>'sourceWorkId'=$1", [clean.workId]);
  assert.equal(invoice.data.cleanerId, users[CLEANER]); assert.equal(invoice.data.cleanerName, `Person ${CLEANER}`);

  // A cleaner review after repeated rejections is still for admins.
  for (let i = 0; i < 2; i++) await rejectedClean(THIRD_CLEANER);
  const [reviewItem] = await owner("select w.id,w.version from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where d.kind='cleaner_management_review' and d.data->>'cleanerId'=$1 and w.status<>'completed'", [users[THIRD_CLEANER]]);
  assert.ok(reviewItem);
  await as(MANAGER);
  await assert.rejects(teams({ action: 'decideCleanerReview', workId: reviewItem.id, version: reviewItem.version, outcome: 'removed_from_rota', note: 'Too many rejections' }), /Management access required/);
  await assert.rejects(teams({ action: 'decideComplaint', workId: reviewItem.id, version: reviewItem.version, outcome: 'upheld', note: 'Wrong kind of decision' }), /Management access required/);
  await as(ADMIN);
  await assert.rejects(teams({ action: 'decideComplaint', workId: reviewItem.id, version: reviewItem.version, outcome: 'upheld', note: 'Wrong kind of decision' }), /Decision not found/);
  assert.equal((await teams({ action: 'decideCleanerReview', workId: reviewItem.id, version: reviewItem.version, outcome: 'supervised', note: 'Two supervised cleans' })).outcome, 'supervised');
});

test('a pay rate per clean gives the cleaner their month and Accounts the amount', async () => {
  await as(MANAGER);
  let row = (await read('performance')).find(c => c.cleanerId === users[CLEANER]);
  assert.equal(row.rateMinor, null); assert.equal(row.rateVersion, 0);
  for (const [who, pattern] of [[CLEANER, /cleaning manager can set/], [STAYS, /cleaning manager can set/], [OTHER_MANAGER, /cleaning manager can set/], [ACCOUNTS, /cleaning manager can set/]]) {
    await as(who);
    await assert.rejects(teams({ action: 'setCleanerRate', cleanerId: users[CLEANER], rateMinor: 9900, version: 0 }), pattern, roles[who]);
  }
  await as(ADMIN);
  await assert.rejects(teams({ action: 'setCleanerRate', cleanerId: users[STAYS], rateMinor: 2500, version: 0 }), /cleaning manager can set/, 'only cleaners have a rate');
  await as(MANAGER);
  await assert.rejects(teams({ action: 'setCleanerRate', cleanerId: users[CLEANER], rateMinor: 0, version: 0 }), /between/);
  const first = await teams({ action: 'setCleanerRate', cleanerId: users[CLEANER], rateMinor: 2000, version: 0 });
  assert.deepEqual(first, { cleanerId: users[CLEANER], rateMinor: 2000, version: 1 });
  await assert.rejects(teams({ action: 'setCleanerRate', cleanerId: users[CLEANER], rateMinor: 2600, version: 0 }), /changed by someone else/);
  await as(ADMIN);
  assert.equal((await teams({ action: 'setCleanerRate', cleanerId: users[CLEANER], rateMinor: 2500, version: 1 })).version, 2);

  // Two accepted cleans this month; Accounts' invoice tasks carry one each.
  for (let i = 0; i < 2; i++) await review(await submittedClean(), true);
  const [{ n: paid }] = await owner("select count(*)::int n from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where d.kind='cleaning_invoice' and d.data->>'cleanerId'=$1 and w.created_at>=date_trunc('month',current_date)", [users[CLEANER]]);
  await as(CLEANER);
  const mine = (await read('performance'))[0];
  assert.equal(mine.rateMinor, 2500); assert.equal(mine.paidCleans, paid); assert.ok(paid >= 2);
  await assert.rejects(read('cleanerRates'), /rates access required/);
  await as(STAYS);
  row = (await read('performance')).find(c => c.cleanerId === users[CLEANER]);
  assert.equal(row.rateMinor, null, 'Stays do not see pay'); assert.equal(row.rateVersion, null);
  await as(ACCOUNTS);
  assert.deepEqual((await read('cleanerRates')).map(r => [r.cleanerId, r.rateMinor, r.version]), [[users[CLEANER], 2500, 2]]);
  await as(OTHER_MANAGER);
  assert.deepEqual(await read('cleanerRates'), [], 'a cleaning manager sees only their own cleaners');
  await as(MANAGER);
  assert.equal((await read('cleanerRates')).length, 1);
});

test('cleaners see how many guests leave and arrive, and nothing else about the booking', async () => {
  await owner(`insert into private.workspace_reservations(property_id,reference,check_in,check_out,status,source,created_by,channel,channel_reference,guests,payout_minor)
   values($1,'SECRET-REF-1',$2,$3,'confirmed','hostaway',$5,'airbnb','HM-SECRET-1',4,123456),($1,'SECRET-REF-2',$4,$6,'confirmed','hostaway',$5,'booking_com','BK-SECRET-2',2,98765)`, [property, day.before, day.d, day.soon, users[SUPER], day.later]);
  await as(MANAGER);
  const clean = await operation({ action: 'createOperation', propertyId: property, kind: 'cleaning', data: { dueOn: day.d, checklist: ['Kitchen'] } });
  await rpc('workspace_assign_work', [clean.workId, clean.version, users[CLEANER]]);
  await as(CLEANER);
  const schedule = await read('schedule', day.before, day.far, null, users[CLEANER]);
  assert.deepEqual(schedule.stays, [], 'no bookings for cleaners');
  assert.deepEqual(schedule.cleanGuests.find(g => g.workId === clean.workId), { workId: clean.workId, guestsLeaving: 4, nextArrivalOn: day.soon, nextArrivalGuests: 2 });
  const text = JSON.stringify(schedule);
  for (const secret of ['SECRET-REF', 'HM-SECRET', 'BK-SECRET', 'airbnb', 'booking_com', 'payout', 'channel', 'reservationId', 'reference']) assert.ok(!text.includes(secret), secret);
  await as(OTHER_CLEANER);
  assert.ok(!(await read('schedule', day.before, day.far)).cleanGuests.some(g => g.workId === clean.workId), 'only their own cleans');
  await as(MANAGER);
  assert.equal((await read('schedule', day.before, day.far)).cleanGuests.find(g => g.workId === clean.workId).guestsLeaving, 4);
});

test('a cleaner reports a problem from a clean: a repair in triage for Stays, with photos', async () => {
  await as(MANAGER);
  const created = await operation({ action: 'createOperation', propertyId: property, kind: 'cleaning', data: { dueOn: day.d, checklist: ['Kitchen'] } });
  await rpc('workspace_assign_work', [created.workId, created.version, users[CLEANER]]);
  const prepare = (purpose, id = crypto.randomUUID()) => rpc('workspace_prepare_upload', [{ requestId: id, workId: created.workId, purpose, contentHash: 'c'.repeat(64) }]);
  const commit = async intent => { await as('service'); return rpc('integration_commit_upload', [intent.id, { assetId: 'storage:' + intent.publicId + '.jpg', publicId: intent.publicId, version: 1, format: 'jpg', bytes: 2048 }]); };
  await as(OTHER_CLEANER); await assert.rejects(prepare('maintenance'), /denied/, 'not their clean');
  await as(MANAGER); await assert.rejects(prepare('maintenance'), /denied/, 'cleaners add problem photos to their cleans');
  await as(CLEANER); const photo = await commit(await prepare('maintenance'));
  await as(CLEANER); const cleanPhoto = await commit(await prepare('cleaning'));
  await as(CLEANER);
  let clean = (await rpc('workspace_operations_read', [property])).find(w => w.workId === created.workId);
  const report = data => operation({ action: 'updateOperation', workId: created.workId, version: clean.version, step: 'reportCleanProblem', data });
  await assert.rejects(report({ issue: 'Leak', urgent: true, photoIds: [cleanPhoto] }), /saved photos of this problem/, 'a clean photo is not a problem photo');
  await assert.rejects(report({ issue: 'Leak under the sink', urgent: 'yes' }), /urgent/);
  await as(OTHER_CLEANER);
  await assert.rejects(report({ issue: 'Leak under the sink', urgent: true }), /access denied/);
  await as(MANAGER);
  await assert.rejects(report({ issue: 'Leak under the sink', urgent: true }), /Only the cleaner on this clean/);
  await as(CLEANER);
  clean = await report({ issue: 'Kitchen tap leaking under the sink', urgent: true, repairType: 'leak', photoIds: [photo] });
  const [problem] = clean.data.problems;
  assert.equal(problem.issue, 'Kitchen tap leaking under the sink'); assert.equal(problem.urgent, true); assert.equal(problem.repairType, 'leak'); assert.equal(problem.photos, 1);
  assert.equal(clean.status, 'waiting'); assert.equal(clean.data.phase, 'assigned', 'the clean carries on');
  const [repair] = await owner("select w.module_id,w.client_visible,w.created_by,d.data from public.workspace_work_items w join private.workspace_domain_details d on d.work_id=w.id where w.id=$1", [problem.repairWorkId]);
  assert.equal(repair.module_id, 'stays-maintenance-reporting'); assert.equal(repair.client_visible, true); assert.equal(repair.created_by, users[CLEANER]);
  assert.equal(repair.data.phase, 'triage'); assert.equal(repair.data.urgent, true); assert.equal(repair.data.repairType, 'leak'); assert.equal(repair.data.estimatedCostMinor, 0);
  assert.equal(repair.data.reportedFromClean, created.workId); assert.equal(repair.data.reportedBy, users[CLEANER]);
  assert.deepEqual((await owner('select work_id from private.workspace_media_evidence where id=$1', [photo]))[0], { work_id: problem.repairWorkId }, 'the photo moves to the repair');
  // Stays on the property hear about it, see it and its photo, and can refer it to Ready.
  assert.ok((await notices(STAYS, problem.repairWorkId)).includes('handover.created'));
  await as(STAYS);
  const listed = (await rpc('workspace_operations_read', [property])).find(w => w.workId === problem.repairWorkId);
  assert.equal(listed.kind, 'maintenance');
  assert.deepEqual((await rpc('workspace_media_read', [problem.repairWorkId])).map(x => x.id), [photo]);
  const referred = await operation({ action: 'updateOperation', workId: listed.workId, version: listed.version, step: 'referReady', data: { troubleshooting: 'Checked the tap, leak confirmed', guestUpdate: 'Plumber on the way' } });
  assert.equal(referred.data.phase, 'referred');
  await as(CLEANER);
  assert.ok(!(await rpc('workspace_operations_read', [property])).some(w => w.workId === problem.repairWorkId), 'the cleaner does not see the repair itself');
  // A second report without photos is listed too.
  clean = await operation({ action: 'updateOperation', workId: created.workId, version: clean.version, step: 'reportCleanProblem', data: { issue: 'Bedroom lamp not working', urgent: false } });
  assert.deepEqual(clean.data.problems.map(x => [x.issue, x.repairType, x.photos]), [['Kitchen tap leaking under the sink', 'leak', 1], ['Bedroom lamp not working', 'other', 0]]);
});
