import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Recruitment (Business Plan v1.0; migration 20261029600000): a manager asks for a role, recruitment advertise it, add and
// shortlist candidates, the manager selects, recruitment onboard the new starter; admins edit the jobs and recruiters.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const R = await vite.ssrLoadModule('/lib/recruitment.ts');
const MIGRATION = 'supabase/migrations/20261029600000_recruitment.sql';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const roles = ['super_admin', 'admin', 'cleaning_manager', 'stays', 'cleans', 'client', 'ready', 'cleans'];
const names = ['Sam', 'Morag', 'Carla Coordinator', 'Rita Recruiter', 'Hannah Housekeeper', 'Olive Owner', 'Ian Installer', 'Nina New'];
const users = roles.map((_, i) => `97990000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, MANAGER, RECRUITER, KEEPER, OWNER, READY, NEWBIE] = roles.map((_, i) => i);
const session = i => users[i].replace('9799', '9899');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `rec${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], names[i]]);
  if (i !== NEWBIE) await db.query('insert into private.workspace_onboarding_done(user_id) values($1) on conflict do nothing', [users[i]]);
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
after(async () => { await db.close(); await vite.close(); });

test('the migration runs twice, keeps everything private and shows the jobs from the plan', async () => {
  await db.exec('reset role'); await db.exec(await fs.readFile(MIGRATION, 'utf8'));
  for (const table of ['workspace_recruitment_settings', 'workspace_recruiters', 'workspace_recruitment_vacancies', 'workspace_recruitment_candidates']) {
    const [row] = await owner(`select has_table_privilege('authenticated','private.${table}','select') a, has_table_privilege('anon','private.${table}','select') b`);
    assert.deepEqual(row, { a: false, b: false }, table);
  }
  const [grants] = await owner("select has_function_privilege('anon','public.workspace_recruitment_read()','execute') anon, has_function_privilege('authenticated','public.workspace_recruitment_action(jsonb)','execute') team, has_function_privilege('authenticated','private.workspace_recruitment_team()','execute') helper");
  assert.deepEqual(grants, { anon: false, team: true, helper: false });
  const r = await read(MANAGER);
  assert.deepEqual(r.settings.jobs.map(j => j.key).slice(0, 3), ['housekeeper', 'property_operations_technician', 'furniture_install_technician']);
  assert.equal(r.settings.jobs.find(j => j.key === 'housekeeper').role, 'cleans');
  assert.ok(R.recruitmentSettingsSchema.safeParse(r.settings).success);
  assert.deepEqual([r.canRequest, r.canRecruit, r.canEditSettings], [true, false, false]);
  assert.deepEqual([(await read(ADMIN)).canRecruit, (await read(ADMIN)).canEditSettings], [true, true]);
  // Housekeepers and owners have no Recruitment page.
  await as(KEEPER); await refused(rpc('workspace_recruitment_read'), /for the team/);
  await as(OWNER); await refused(rpc('workspace_recruitment_read'), /for the team/);
});

test('admins name the recruiters and edit the jobs', async () => {
  await refused(act(RECRUITER, { action: 'saveSettings', settings: (await read(ADMIN)).settings, recruiterIds: [users[RECRUITER]] }), /Only admins/);
  const settings = (await read(ADMIN)).settings;
  // A housekeeper cannot be a recruiter; jobs need titles and unique keys.
  await refused(act(ADMIN, { action: 'saveSettings', settings, recruiterIds: [users[KEEPER]] }), /active team/);
  await refused(act(ADMIN, { action: 'saveSettings', settings: { jobs: [settings.jobs[0], settings.jobs[0]] }, recruiterIds: [] }), /Invalid settings/);
  const jobs = [...settings.jobs, { key: R.jobKey('Window Cleaner', settings.jobs.map(j => j.key)), title: 'Window Cleaner', role: 'ready', advert: 'Clean windows.' }];
  assert.equal(jobs.at(-1).key, 'window_cleaner');
  const r = await act(ADMIN, { action: 'saveSettings', settings: { jobs }, recruiterIds: [users[RECRUITER]] });
  assert.deepEqual(r.recruiters.map(x => x.name), ['Rita Recruiter']);
  assert.equal(r.settings.jobs.at(-1).title, 'Window Cleaner');
  assert.equal((await read(RECRUITER)).canRecruit, true);
  assert.equal((await read(RECRUITER)).canEditSettings, false);
  assert.equal((await read(MANAGER)).canRecruit, false);
});

test('a manager asks for a housekeeper; recruitment advertise, shortlist, the manager selects and recruitment onboard', async () => {
  const [prop] = await owner("insert into public.workspace_properties(name,address,created_by,request_id) values('Shore Flat','8 Shore Road, Leith',$1,gen_random_uuid()) returning id", [users[ADMIN]]);
  // Asking: the job must exist, an area and 1 to 20 people.
  await refused(act(MANAGER, { action: 'requestRole', jobKey: 'astronaut', area: 'Leith', positions: 1 }), /Choose the job/);
  await refused(act(MANAGER, { action: 'requestRole', jobKey: 'housekeeper', area: 'Leith', positions: 1, startBy: '2020-01-01' }), /from today/);
  let r = await act(MANAGER, { action: 'requestRole', jobKey: 'housekeeper', area: 'Leith', positions: 1, notes: 'For the Shore flat', propertyId: prop.id });
  let v = r.vacancies[0];
  assert.deepEqual([v.title, v.role, v.area, v.propertyName, v.isMine, R.vacancyStage(v)], ['Housekeeper', 'cleans', 'Leith', 'Shore Flat', true, 'requested']);
  assert.match(v.advert, /not a cleaner/);
  // The recruiter is told (not the admins, now a recruiter is named).
  assert.equal(await notified(RECRUITER, 'recruitment.requested'), 1);
  assert.equal(await notified(ADMIN, 'recruitment.requested'), 0);
  // Another manager does not see it; the recruiter does.
  assert.equal(vacancy(await read(READY), v.id), undefined);
  assert.ok(vacancy(await read(RECRUITER), v.id));

  // Only recruitment write the advert; posting needs where.
  await refused(act(MANAGER, { action: 'saveAdvert', vacancyId: v.id, advert: 'Join us', postedTo: '', posted: false }), /Recruitment write the advert/);
  await refused(act(RECRUITER, { action: 'saveAdvert', vacancyId: v.id, advert: 'Join us', postedTo: '', posted: true }), /where the advert is posted/);
  r = await act(RECRUITER, { action: 'saveAdvert', vacancyId: v.id, advert: 'Join Recharge as a Housekeeper.', postedTo: 'Indeed', posted: true });
  v = vacancy(r, v.id);
  assert.equal(R.vacancyStage(v), 'advertised');
  assert.equal(await notified(MANAGER, 'recruitment.advertised'), 1);

  // Candidates: a name and a way to reach them; CV links are https.
  await refused(act(RECRUITER, { action: 'addCandidate', vacancyId: v.id, fullName: 'Ann Able', email: '', phone: '', cvUrl: '', notes: '' }), /email address or a phone/);
  await refused(act(RECRUITER, { action: 'addCandidate', vacancyId: v.id, fullName: 'Ann Able', email: 'ann@example.com', phone: '', cvUrl: 'http://cv', notes: '' }), /https/);
  await refused(act(MANAGER, { action: 'addCandidate', vacancyId: v.id, fullName: 'Ann Able', email: 'ann@example.com', phone: '', cvUrl: '', notes: '' }), /Recruitment add/);
  r = await act(RECRUITER, { action: 'addCandidate', vacancyId: v.id, fullName: 'Ann Able', email: 'Ann@Example.com', phone: '', cvUrl: 'https://example.com/ann.pdf', notes: 'Five years in hotels' });
  r = await act(RECRUITER, { action: 'addCandidate', vacancyId: v.id, fullName: 'Bob Busy', email: '', phone: '07700 900000', cvUrl: '', notes: 'Weekends only' });
  r = await act(RECRUITER, { action: 'addCandidate', vacancyId: v.id, fullName: 'Nina New', email: 'rec7@example.com', phone: '', cvUrl: '', notes: '' });
  v = vacancy(r, v.id);
  const [ann, bob, nina] = v.candidates;
  assert.equal(ann.email, 'ann@example.com');
  // The manager sees nothing until candidates are shortlisted, and never recruitment's notes.
  assert.equal(vacancy(await read(MANAGER), v.id).candidates.length, 0);
  await refused(act(RECRUITER, { action: 'shareShortlist', vacancyId: v.id }), /Shortlist at least one/);
  r = await act(RECRUITER, { action: 'setCandidate', vacancyId: v.id, candidateId: ann.id, status: 'shortlisted' });
  r = await act(RECRUITER, { action: 'setCandidate', vacancyId: v.id, candidateId: nina.id, status: 'shortlisted' });
  r = await act(RECRUITER, { action: 'setCandidate', vacancyId: v.id, candidateId: bob.id, status: 'rejected', note: 'Weekends only' });
  r = await act(RECRUITER, { action: 'shareShortlist', vacancyId: v.id });
  assert.equal(await notified(MANAGER, 'recruitment.shortlist_ready'), 1);
  let mine = vacancy(await read(MANAGER), v.id);
  assert.deepEqual(mine.candidates.map(c => [c.fullName, c.notes]), [['Ann Able', ''], ['Nina New', '']]);
  assert.equal(R.vacancyStage(mine), 'choosing');

  // Only the manager who asked (or an admin) chooses; turning down needs a reason.
  await refused(act(RECRUITER, { action: 'chooseCandidate', vacancyId: v.id, candidateId: nina.id, decision: 'select' }), /manager who asked/);
  await refused(act(MANAGER, { action: 'chooseCandidate', vacancyId: v.id, candidateId: bob.id, decision: 'select' }), /from the shortlist/);
  await refused(act(MANAGER, { action: 'chooseCandidate', vacancyId: v.id, candidateId: ann.id, decision: 'decline' }), /Say why/);
  await act(MANAGER, { action: 'chooseCandidate', vacancyId: v.id, candidateId: ann.id, decision: 'decline', note: 'Lives too far away' });
  await refused(act(RECRUITER, { action: 'hireCandidate', vacancyId: v.id, candidateId: nina.id, userId: users[NEWBIE] }), /selects the candidate first/);
  await act(MANAGER, { action: 'chooseCandidate', vacancyId: v.id, candidateId: nina.id, decision: 'select' });
  assert.equal(await notified(RECRUITER, 'recruitment.candidate_selected'), 1);

  // Recruitment onboard her: her account (made in Access control) is linked; the vacancy is filled.
  await refused(act(MANAGER, { action: 'hireCandidate', vacancyId: v.id, candidateId: nina.id, userId: users[NEWBIE] }), /Recruitment onboard/);
  await refused(act(RECRUITER, { action: 'hireCandidate', vacancyId: v.id, candidateId: nina.id, userId: users[OWNER] }), /team account/);
  r = await act(RECRUITER, { action: 'hireCandidate', vacancyId: v.id, candidateId: nina.id, userId: users[NEWBIE] });
  v = vacancy(r, v.id);
  assert.equal(v.status, 'filled');
  assert.equal(R.vacancyStage(v), 'filled');
  const hired = v.candidates.find(c => c.id === nina.id);
  assert.deepEqual([hired.status, hired.hiredName], ['hired', 'Nina New']);
  assert.ok(hired.onboarding && typeof hired.onboarding.complete === 'boolean');
  assert.equal(await notified(MANAGER, 'recruitment.hired'), 1);
  // A hired candidate stays on record; a closed vacancy takes no more changes until it is reopened (for one more person).
  await refused(act(RECRUITER, { action: 'deleteCandidate', vacancyId: v.id, candidateId: nina.id }), /stays on record/);
  await refused(act(RECRUITER, { action: 'addCandidate', vacancyId: v.id, fullName: 'Cara Late', email: 'cara@example.com', phone: '', cvUrl: '', notes: '' }), /Recruitment add/);
  r = await act(MANAGER, { action: 'reopenVacancy', vacancyId: v.id });
  v = vacancy(r, v.id);
  assert.deepEqual([v.status, v.positions, v.hired], ['open', 2, 1]);
  // Removing a candidate's details (data no longer needed).
  r = await act(RECRUITER, { action: 'deleteCandidate', vacancyId: v.id, candidateId: bob.id });
  assert.ok(!vacancy(r, v.id).candidates.some(c => c.id === bob.id));
});

test('closing and changing a vacancy, and replaying an action', async () => {
  let r = await act(READY, { action: 'requestRole', jobKey: 'photographer', area: 'Glasgow', positions: 2 });
  const v = r.vacancies.find(x => x.title === 'Photographer');
  await refused(act(MANAGER, { action: 'updateVacancy', vacancyId: v.id, area: 'Glasgow', positions: 1 }), /Vacancy not found/);
  r = await act(READY, { action: 'updateVacancy', vacancyId: v.id, area: 'Glasgow and Paisley', positions: 1, startBy: '', notes: 'One is enough' });
  assert.deepEqual([vacancy(r, v.id).area, vacancy(r, v.id).positions], ['Glasgow and Paisley', 1]);
  await refused(act(READY, { action: 'cancelVacancy', vacancyId: v.id, reason: '  ' }), /Say why the vacancy is closed/);
  // The same request id gives the same answer without doing it twice.
  await as(READY);
  const input = R.recruitmentActionSchema.parse({ action: 'cancelVacancy', requestId: crypto.randomUUID(), vacancyId: v.id, reason: 'Found someone through a friend' });
  const first = await rpc('workspace_recruitment_action', [input]);
  const again = await rpc('workspace_recruitment_action', [input]);
  assert.deepEqual(again, first);
  assert.equal(vacancy(R.recruitmentReadSchema.parse(first), v.id).status, 'cancelled');
  assert.equal(await notified(RECRUITER, 'recruitment.closed'), 1);
});
