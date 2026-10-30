import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// The hiring process (Business Plan v2; migration 20261031300000): the directors approve a request with the maximum
// budget and recruitment is auto-assigned; the ticket's checklist runs application form, marketing, reviewing, interviews
// (3-day invites, a booked interview on the manager's to-do), job offer, contract (a director pre-signs the template)
// and onboarding.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const R = await vite.ssrLoadModule('/lib/recruitment.ts');
const MIGRATION = 'supabase/migrations/20261031300000_hiring_process.sql';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const roles = ['super_admin', 'admin', 'cleaning_manager', 'stays', 'cleans', 'admin', 'ready'];
const names = ['Alex Director', 'Morag Admin', 'Carla Coordinator', 'Rita Recruiter', 'Nina New', 'Rachel Director', 'Ian Installer'];
const users = roles.map((_, i) => `97a90000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, MANAGER, RECRUITER, NEWBIE, RACHEL, READY] = roles.map((_, i) => i);
const session = i => users[i].replace('97a9', '98a9');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `hire${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], names[i]]);
  await db.query('insert into private.workspace_onboarding_done(user_id) values($1) on conflict do nothing', [users[i]]);
}
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
const owner = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const refused = async (promise, pattern) => assert.rejects(promise, error => pattern.test(error.message));
const notified = async (i, event) => (await owner('select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.user_id=$1 and a.event_type=$2', [users[i], event]))[0].n;
const read = async i => { await as(i); return R.recruitmentReadSchema.parse(await rpc('workspace_recruitment_read')); };
const act = async (i, input) => { const body = R.recruitmentActionSchema.parse({ requestId: crypto.randomUUID(), ...input }); await as(i); return R.recruitmentReadSchema.parse(await rpc('workspace_recruitment_action', [body])); };
const vacancy = (r, id) => r.vacancies.find(v => v.id === id);
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const later = days => { const d = new Date(Date.now() + days * 86400000); d.setUTCMinutes(0, 0, 0); return d.toISOString(); };
after(async () => { await db.close(); await vite.close(); });

test('the migration runs twice, keeps the new tables private and gives each job its form to start from', async () => {
  await db.exec('reset role'); await db.exec(await fs.readFile(MIGRATION, 'utf8'));
  for (const table of ['workspace_recruitment_directors', 'workspace_hiring_contract_templates', 'workspace_hiring_contracts']) {
    const [row] = await owner(`select has_table_privilege('authenticated','private.${table}','select') a, has_table_privilege('anon','private.${table}','select') b`);
    assert.deepEqual(row, { a: false, b: false }, table);
  }
  const [grants] = await owner("select has_function_privilege('authenticated','private.workspace_recruitment_director_ids()','execute') helper, has_function_privilege('authenticated','public.workspace_recruitment_action(jsonb)','execute') team");
  assert.deepEqual(grants, { helper: false, team: true });
  const r = await read(MANAGER);
  const keeper = r.settings.jobs.find(j => j.key === 'housekeeper');
  assert.match(keeper.questions[0].label, /1, 2, 3, 4 and 5-bedroom/);
  assert.equal(r.settings.jobs.find(j => j.key === 'property_onboarding_consultant').title, 'Property Performance Consultant');
  // Directors: the super admin while nobody is named.
  assert.deepEqual(r.directors.map(d => d.name), ['Alex Director']);
  assert.deepEqual([(await read(SUPER)).canApprove, (await read(ADMIN)).canApprove, r.canApprove], [true, false, false]);
});

test('admins name the directors (admins only) and the recruiters; jobs keep their questions', async () => {
  const s = (await read(ADMIN)).settings;
  await refused(act(ADMIN, { action: 'saveSettings', settings: s, recruiterIds: [users[RECRUITER]], directorIds: [users[MANAGER]] }), /active admins/);
  const jobs = s.jobs.map(j => j.key === 'photographer' ? { ...j, hours: 'Ad hoc', questions: [...j.questions, { id: 'q9', label: 'Do you have your own camera?', kind: 'yes_no', required: false }] } : j);
  const r = await act(ADMIN, { action: 'saveSettings', settings: { jobs }, recruiterIds: [users[RECRUITER]], directorIds: [users[SUPER], users[RACHEL]] });
  assert.deepEqual(r.directors.map(d => d.name), ['Alex Director', 'Rachel Director']);
  assert.deepEqual(r.settings.jobs.find(j => j.key === 'photographer').questions.map(q => q.id), ['q1', 'q9']);
  assert.equal((await read(RACHEL)).canApprove, true);
  assert.equal((await read(ADMIN)).canApprove, false);
  await refused(act(ADMIN, { action: 'saveSettings', settings: { jobs: [{ ...jobs[0], questions: [{ id: 'q1', label: 'Hi', kind: 'short', required: true }] }] }, recruiterIds: [] }).catch(e => { throw new Error(e.issues?.[0]?.message ?? e.message); }), /at least 3 characters/);
});

test('a request waits for the directors: turned down with a reason, or approved with the budget and recruitment assigned', async () => {
  await refused(act(MANAGER, { action: 'requestRole', jobKey: 'housekeeper', area: 'Leith', reason: '', positions: 1 }).catch(e => { throw new Error(e.issues?.[0]?.message ?? e.message); }), /why the role is needed/);
  let r = await act(MANAGER, { action: 'requestRole', jobKey: 'photographer', area: 'Fife', reason: 'Listings need photos', positions: 1 });
  const fife = r.vacancies.find(v => v.area === 'Fife');
  assert.equal(await notified(SUPER, 'recruitment.approval_needed'), 1);
  assert.equal(await notified(RACHEL, 'recruitment.approval_needed'), 1);
  // Directors see the request with its form to start from; others cannot decide.
  assert.equal(vacancy(await read(RACHEL), fife.id).canDecide, true);
  assert.equal(vacancy(await read(MANAGER), fife.id).canDecide, false);
  await refused(act(ADMIN, { action: 'decideRequest', vacancyId: fife.id, decision: 'reject', note: 'No' }), /directors approve/);
  await refused(act(RACHEL, { action: 'decideRequest', vacancyId: fife.id, decision: 'reject' }), /Say why/);
  r = await act(RACHEL, { action: 'decideRequest', vacancyId: fife.id, decision: 'reject', note: 'We use an agency in Fife' });
  assert.deepEqual([vacancy(r, fife.id).status, vacancy(r, fife.id).closeReason, R.vacancyStage(vacancy(r, fife.id))], ['rejected', 'We use an agency in Fife', 'rejected']);
  assert.equal(await notified(MANAGER, 'recruitment.rejected'), 1);
  await refused(act(SUPER, { action: 'decideRequest', vacancyId: fife.id, decision: 'approve', budgetMinor: 100, budgetUnit: 'hour' }), /already decided/);

  r = await act(MANAGER, { action: 'requestRole', jobKey: 'housekeeper', area: 'Leith', reason: 'Three new flats', notes: 'Weekends', positions: 1 });
  const v = r.vacancies.find(x => x.area === 'Leith');
  assert.equal(v.form.questions.length, 3);
  r = await act(SUPER, { action: 'decideRequest', vacancyId: v.id, decision: 'approve', budgetMinor: 4500, budgetUnit: 'job' });
  const open = vacancy(r, v.id);
  assert.deepEqual([open.status, open.assignedToName, open.approvedByName, R.budgetText(open.budgetMinor, open.budgetUnit)], ['open', 'Rita Recruiter', 'Alex Director', 'up to £45 per job']);
  assert.equal(await notified(RECRUITER, 'recruitment.requested'), 1);
  assert.equal(await notified(MANAGER, 'recruitment.approved'), 1);
  assert.deepEqual(R.hiringSteps(open).filter(s => s.done).map(s => s.key), ['approval']);
  // Handing over: to a recruiter or an admin only.
  await refused(act(RECRUITER, { action: 'assignVacancy', vacancyId: v.id, userId: users[MANAGER] }), /recruiter or an admin/);
  r = await act(RECRUITER, { action: 'assignVacancy', vacancyId: v.id, userId: users[ADMIN] });
  assert.equal(vacancy(r, v.id).assignedToName, 'Morag Admin');
  await act(ADMIN, { action: 'assignVacancy', vacancyId: v.id, userId: users[RECRUITER] });
});

test('the checklist: form, marketing, shortlist, interviews, offer, contract and onboarding', async () => {
  let v = (await read(RECRUITER)).vacancies.find(x => x.area === 'Leith' && x.status === 'open');
  const form = { vacancyId: v.id, hours: 'Weekends, 11am to 3pm', earnings: '£35 to £60 per clean', advert: 'Join Recharge as a Housekeeper making every stay guest ready.', questions: v.form.questions };
  // 1. Application form: recruitment only, hours, earnings and a description; questions are checked.
  await refused(act(MANAGER, { action: 'saveApplicationForm', ...form, publish: true }), /Recruitment write the application form/);
  await refused(act(RECRUITER, { action: 'saveMarketing', vacancyId: v.id, platforms: { instagram: 'posted', facebook: 'todo', linkedin: 'todo', indeed: 'todo' }, postedTo: '' }), /Publish the application form first/);
  let r = await act(RECRUITER, { action: 'saveApplicationForm', ...form, publish: true });
  v = vacancy(r, v.id);
  assert.ok(v.form.publishedAt && !v.form.closedAt);
  assert.equal(v.form.earnings, '£35 to £60 per clean');
  // 2. Marketing: ticked once all four are posted or not used.
  r = await act(RECRUITER, { action: 'saveMarketing', vacancyId: v.id, platforms: { instagram: 'posted', facebook: 'posted', linkedin: 'todo', indeed: 'todo' }, postedTo: '' });
  assert.equal(vacancy(r, v.id).advertisedAt, null);
  r = await act(RECRUITER, { action: 'saveMarketing', vacancyId: v.id, platforms: { instagram: 'posted', facebook: 'posted', linkedin: 'skipped', indeed: 'posted' }, postedTo: 'Jobcentre' });
  v = vacancy(r, v.id);
  assert.ok(v.advertisedAt);
  assert.deepEqual(v.platforms, { instagram: 'posted', facebook: 'posted', linkedin: 'skipped', indeed: 'posted' });
  assert.equal(await notified(MANAGER, 'recruitment.advertised'), 1);
  // 3. Reviewing: sharing the shortlist ticks it and withdraws the form.
  for (const [fullName, email] of [['Ann Able', 'ann@example.com'], ['Nina New', 'hire4@example.com'], ['Cat Cole', 'cat@example.com']])
    r = await act(RECRUITER, { action: 'addCandidate', vacancyId: v.id, fullName, email, phone: '', cvUrl: '', notes: '' });
  const [ann, nina, cat] = vacancy(r, v.id).candidates;
  for (const c of [ann, nina, cat]) await act(RECRUITER, { action: 'setCandidate', vacancyId: v.id, candidateId: c.id, status: 'shortlisted' });
  r = await act(RECRUITER, { action: 'shareShortlist', vacancyId: v.id });
  v = vacancy(r, v.id);
  assert.ok(v.shortlistSharedAt && v.form.closedAt);
  assert.deepEqual(R.hiringSteps(v).filter(s => s.done).map(s => s.key), ['approval', 'form', 'marketing', 'review']);

  // 4. Interviews: the manager says how and when; invites expire after 3 days.
  await refused(act(MANAGER, { action: 'inviteToInterview', vacancyId: v.id, candidateId: ann.id }), /how and when you can interview/);
  await refused(act(READY, { action: 'setInterviews', vacancyId: v.id, mode: 'virtual', place: 'https://meet.example.com/x', minutes: 30, slots: [later(2)] }), /Vacancy not found/);
  const [s1, s2] = [later(2), later(3)];
  r = await act(MANAGER, { action: 'setInterviews', vacancyId: v.id, mode: 'virtual', place: 'https://meet.example.com/x', minutes: 30, slots: [s2, s1] });
  assert.deepEqual(vacancy(r, v.id).interview.slots.map(x => new Date(x).getTime()), [s1, s2].map(x => new Date(x).getTime()));
  for (const c of [ann, nina, cat]) r = await act(MANAGER, { action: 'inviteToInterview', vacancyId: v.id, candidateId: c.id });
  assert.equal(vacancy(r, v.id).candidates.find(c => c.id === cat.id).interviewStatus, 'invited');
  await refused(act(MANAGER, { action: 'inviteToInterview', vacancyId: v.id, candidateId: ann.id }), /already invited/);
  // Cat does not answer within 3 days: expired, and she cannot be booked.
  await owner("update private.workspace_recruitment_candidates set interview_expires_at=now()-interval '1 minute' where id=$1", [cat.id]);
  assert.equal(vacancy(await read(MANAGER), v.id).candidates.find(c => c.id === cat.id).interviewStatus, 'expired');
  await refused(act(RECRUITER, { action: 'bookInterview', vacancyId: v.id, candidateId: cat.id, at: s1 }), /Invite them to interview first/);
  // Ann and Nina choose times (recorded for them); a taken or unoffered time is refused. It goes on the manager's to-do.
  await refused(act(RECRUITER, { action: 'bookInterview', vacancyId: v.id, candidateId: ann.id, at: later(9) }), /times offered/);
  r = await act(RECRUITER, { action: 'bookInterview', vacancyId: v.id, candidateId: ann.id, at: s1 });
  await refused(act(RECRUITER, { action: 'bookInterview', vacancyId: v.id, candidateId: nina.id, at: s1 }), /taken/);
  r = await act(RECRUITER, { action: 'bookInterview', vacancyId: v.id, candidateId: nina.id, at: s2 });
  assert.equal(await notified(MANAGER, 'recruitment.interview_booked'), 2);
  const todos = await owner("select title,assignee_id,due_on::text,status,priority from private.workspace_hub_items where kind='todo' and title like 'Interview:%' order by title");
  assert.deepEqual(todos.map(t => [t.title, t.assignee_id, t.status, t.priority]), [['Interview: Ann Able (Housekeeper)', users[MANAGER], 'open', 'high'], ['Interview: Nina New (Housekeeper)', users[MANAGER], 'open', 'high']]);
  assert.equal(todos[0].due_on, new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date(s1)));
  // Interviews are recorded, then ticked.
  await refused(act(MANAGER, { action: 'finishInterviews', vacancyId: v.id }), /at least one interview/);
  await act(MANAGER, { action: 'interviewOutcome', vacancyId: v.id, candidateId: ann.id, outcome: 'done', note: 'Strong' });
  await refused(act(MANAGER, { action: 'finishInterviews', vacancyId: v.id }), /booked interviews/);
  await act(MANAGER, { action: 'interviewOutcome', vacancyId: v.id, candidateId: nina.id, outcome: 'done', note: 'Great eye for detail' });
  assert.equal((await owner("select count(*)::int n from private.workspace_hub_items where title like 'Interview:%' and status='done'"))[0].n, 2);
  r = await act(MANAGER, { action: 'finishInterviews', vacancyId: v.id });
  assert.ok(vacancy(r, v.id).interview.doneAt);

  // 5. Job offer: Ann turns it down; Nina accepts.
  await act(MANAGER, { action: 'chooseCandidate', vacancyId: v.id, candidateId: ann.id, decision: 'select' });
  r = await act(RECRUITER, { action: 'answerOffer', vacancyId: v.id, candidateId: ann.id, answer: 'decline', note: 'Took another job' });
  assert.deepEqual([vacancy(r, v.id).candidates.find(c => c.id === ann.id).status, vacancy(r, v.id).candidates.find(c => c.id === ann.id).offerStatus], ['withdrawn', 'declined']);
  assert.equal(await notified(MANAGER, 'recruitment.offer_declined'), 1);
  await act(MANAGER, { action: 'chooseCandidate', vacancyId: v.id, candidateId: nina.id, decision: 'select' });
  await refused(act(RECRUITER, { action: 'issueContract', vacancyId: v.id, candidateId: nina.id, templateId: crypto.randomUUID(), fields: {} }), /accept the job offer first/);
  r = await act(RECRUITER, { action: 'answerOffer', vacancyId: v.id, candidateId: nina.id, answer: 'accept' });
  assert.equal(await notified(MANAGER, 'recruitment.offer_accepted'), 1);
  assert.ok(R.hiringSteps(vacancy(r, v.id)).find(s => s.key === 'offer').done);

  // 6. Contract: a template with blanks, signed by a director, filled in for Nina.
  const wording = 'This agreement is between Recharge Group and {{full_name}} of {{address}}, as {{job_title}}, paid {{rate}}. {{full_name}} agrees to the terms below.';
  await refused(act(RECRUITER, { action: 'saveContractTemplate', title: 'Housekeeper contract', jobKeys: ['housekeeper'], body: wording, active: true, directorName: 'Rita', directorSignature: PNG }), /A director signs/);
  r = await act(RECRUITER, { action: 'saveContractTemplate', title: 'Housekeeper contract', jobKeys: ['housekeeper'], body: wording, active: true, directorName: '' });
  let t = r.templates[0];
  assert.deepEqual(t.blanks, ['full_name', 'address', 'job_title', 'rate']);
  assert.deepEqual(R.contractBlanks(wording), t.blanks);
  await refused(act(RECRUITER, { action: 'issueContract', vacancyId: v.id, candidateId: nina.id, templateId: t.id, fields: { full_name: 'Nina New', address: '1 Road', job_title: 'Housekeeper', rate: '£45' } }), /director signs this template first/);
  r = await act(RACHEL, { action: 'saveContractTemplate', templateId: t.id, title: t.title, jobKeys: t.jobKeys, body: t.body, active: true, directorName: 'Rachel Craig', directorSignature: PNG });
  t = r.templates[0];
  assert.deepEqual([t.directorName, !!t.directorSignature], ['Rachel Craig', true]);
  // Changing the wording without signing again removes the signature; the director signs again.
  r = await act(RECRUITER, { action: 'saveContractTemplate', templateId: t.id, title: t.title, jobKeys: t.jobKeys, body: t.body + ' Notice is one week.', active: true, directorName: t.directorName });
  assert.equal(r.templates[0].directorSignature, null);
  r = await act(SUPER, { action: 'saveContractTemplate', templateId: t.id, title: t.title, jobKeys: t.jobKeys, body: r.templates[0].body, active: true, directorName: 'Alex Coghill', directorSignature: PNG });
  t = r.templates[0];
  await refused(act(RECRUITER, { action: 'issueContract', vacancyId: v.id, candidateId: nina.id, templateId: t.id, fields: { full_name: 'Nina New', job_title: 'Housekeeper', rate: '£45' } }), /Fill in address/);
  r = await act(RECRUITER, { action: 'issueContract', vacancyId: v.id, candidateId: nina.id, templateId: t.id, fields: { full_name: 'Nina New', address: '1 Shore Road, Leith', job_title: 'Housekeeper', rate: '£45 per clean' } });
  let k = vacancy(r, v.id).candidates.find(c => c.id === nina.id).contract;
  assert.match(k.body, /between Recharge Group and Nina New of 1 Shore Road, Leith, as Housekeeper, paid £45 per clean\. Nina New agrees/);
  assert.deepEqual([k.directorName, k.signedAt], ['Alex Coghill', null]);
  // The manager sees the contract; the hire waits for the signature.
  assert.ok(vacancy(await read(MANAGER), v.id).candidates.find(c => c.id === nina.id).contract);
  await refused(act(RECRUITER, { action: 'hireCandidate', vacancyId: v.id, candidateId: nina.id, userId: users[NEWBIE] }), /sign their contract first/);
  r = await act(RECRUITER, { action: 'recordContractSigned', vacancyId: v.id, candidateId: nina.id, signedName: 'Nina New' });
  k = vacancy(r, v.id).candidates.find(c => c.id === nina.id).contract;
  assert.deepEqual([k.signedName, k.signedHow], ['Nina New', 'paper']);
  assert.equal(await notified(MANAGER, 'recruitment.contract_signed'), 1);
  await refused(act(RECRUITER, { action: 'withdrawContract', vacancyId: v.id, candidateId: nina.id }), /stays on record/);
  // 7. Onboarding: her account is linked and the vacancy is filled.
  r = await act(RECRUITER, { action: 'hireCandidate', vacancyId: v.id, candidateId: nina.id, userId: users[NEWBIE] });
  v = vacancy(r, v.id);
  assert.equal(v.status, 'filled');
  assert.deepEqual(R.hiringSteps(v).filter(s => !s.done).map(s => s.key), []);
});

test('a cancelled request that was never approved goes back to the directors when reopened', async () => {
  let r = await act(READY, { action: 'requestRole', jobKey: 'furniture_install_technician', area: 'Perth', reason: 'Furniture installs in Perth', positions: 1 });
  const v = r.vacancies.find(x => x.area === 'Perth');
  r = await act(READY, { action: 'cancelVacancy', vacancyId: v.id, reason: 'Not now' });
  assert.equal(vacancy(r, v.id).status, 'cancelled');
  const before = await notified(SUPER, 'recruitment.approval_needed');
  r = await act(READY, { action: 'reopenVacancy', vacancyId: v.id });
  assert.equal(vacancy(r, v.id).status, 'requested');
  assert.equal(await notified(SUPER, 'recruitment.approval_needed'), before + 1);
});
