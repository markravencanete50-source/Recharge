import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Careers (migration 20261031400000): the public careers page lists published application forms, anyone applies with
// their CV and answers, careers@ emails are queued for each step, the applicant's account link makes a limited account
// that sees only their applications, and from it they book an interview, accept the offer, sign the contract and message
// recruitment. Their sign-in stays out of the access requests until they are chosen.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const R = await vite.ssrLoadModule('/lib/recruitment.ts');
const C = await vite.ssrLoadModule('/lib/careers.ts');
const MIGRATION = 'supabase/migrations/20261031400000_careers.sql';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const roles = ['super_admin', 'cleaning_manager', 'stays'];
const names = ['Alex Director', 'Carla Coordinator', 'Rita Recruiter'];
const users = roles.map((_, i) => `97c90000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, MANAGER, RECRUITER] = [0, 1, 2];
const session = id => id.replace(/^97c9|^97d9/, m => m === '97c9' ? '98c9' : '98d9');
async function signIn(id, email) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now()) on conflict do nothing', [id, email]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2) on conflict do nothing', [session(id), id]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2) on conflict do nothing', [session(id), id]);
}
for (let i = 0; i < users.length; i++) {
  await signIn(users[i], `careers${i}@example.com`);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], names[i]]);
  await db.query('insert into private.workspace_onboarding_done(user_id) values($1) on conflict do nothing', [users[i]]);
}
async function asUser(id) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id, session_id: session(id) })]);
  await db.exec('set role authenticated');
}
const as = i => asUser(users[i]);
const owner = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const refused = async (promise, pattern) => assert.rejects(promise, error => pattern.test(error.message));
const read = async i => { await as(i); return R.recruitmentReadSchema.parse(await rpc('workspace_recruitment_read')); };
const act = async (i, input) => { const body = R.recruitmentActionSchema.parse({ requestId: crypto.randomUUID(), ...input }); await as(i); return R.recruitmentReadSchema.parse(await rpc(body.action === 'sendMessage' ? 'workspace_recruitment_message' : 'workspace_recruitment_action', [body])); };
// The server's side: the service role, nobody signed in.
const careers = async input => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); await db.exec('set role service_role'); try { return await rpc('workspace_careers_public', [input]); } finally { await db.exec('reset role'); } };
const applicant = async (id, input) => { await asUser(id); return C.applicantReadSchema.parse(await rpc('workspace_applicant_action', [C.applicantActionSchema.parse({ requestId: crypto.randomUUID(), ...input })])); };
const applicantRead = async id => { await asUser(id); return C.applicantReadSchema.parse(await rpc('workspace_applicant_read')); };
const emails = async () => (await owner('select c.full_name name,e.kind,e.status from private.workspace_careers_emails e join private.workspace_recruitment_candidates c on c.id=e.candidate_id order by e.created_at,e.kind')).map(e => `${e.name}:${e.kind}:${e.status}`);
const notified = async (i, event) => (await owner('select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.user_id=$1 and a.event_type=$2', [users[i], event]))[0].n;
const accessList = async () => { await as(SUPER); return JSON.stringify((await owner("select private.workspace_access_control_read('accessControl') r"))[0].r); };
const hex = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAAABJRU5ErkJggg==';
const later = days => { const d = new Date(Date.now() + days * 86400000); d.setUTCMinutes(0, 0, 0); return d.toISOString(); };
const cv = vid => ({ path: `applications/${vid}/${crypto.randomUUID()}.pdf`, name: 'My CV.pdf', mime: 'application/pdf', bytes: 2048 });
after(async () => { await db.close(); await vite.close(); });

let vid, ann, annUser;
test('the migration runs twice and keeps the new tables private; only the server can use the public side', async () => {
  await db.exec('reset role'); await db.exec(await fs.readFile(MIGRATION, 'utf8'));
  for (const table of ['workspace_applicants', 'workspace_recruitment_messages', 'workspace_careers_emails']) {
    const [row] = await owner(`select has_table_privilege('authenticated','private.${table}','select') a, has_table_privilege('anon','private.${table}','select') b`);
    assert.deepEqual(row, { a: false, b: false }, table);
  }
  const [grants] = await owner(`select has_function_privilege('anon','public.workspace_careers_public(jsonb)','execute') anon, has_function_privilege('authenticated','public.workspace_careers_public(jsonb)','execute') signed,
    has_function_privilege('service_role','public.workspace_careers_public(jsonb)','execute') server, has_function_privilege('authenticated','public.workspace_applicant_action(jsonb)','execute') applicant`);
  assert.deepEqual(grants, { anon: false, signed: false, server: true, applicant: true });
});

test('a published form is on the careers page, and anyone applies with their CV and answers', async () => {
  assert.deepEqual(await careers({ action: 'list' }), []);
  await act(SUPER, { action: 'saveSettings', settings: (await read(SUPER)).settings, recruiterIds: [users[RECRUITER]] });
  let r = await act(MANAGER, { action: 'requestRole', jobKey: 'housekeeper', area: 'Leith', reason: 'New flats', positions: 1 });
  vid = r.vacancies[0].id;
  await act(SUPER, { action: 'decideRequest', vacancyId: vid, decision: 'approve', budgetMinor: 4500, budgetUnit: 'job' });
  await refused(careers({ action: 'form', vacancyId: vid }), /no longer taking applications/);
  const v = (await read(RECRUITER)).vacancies[0];
  await act(RECRUITER, { action: 'saveApplicationForm', vacancyId: vid, hours: 'Weekends', earnings: '£35 to £60 per clean', advert: 'Join Recharge as a Housekeeper making every stay guest ready.', questions: v.form.questions, publish: true });
  const list = (await careers({ action: 'list' })).map(l => C.listingSchema.parse(l));
  assert.deepEqual(list.map(l => [l.title, l.area, l.earnings]), [['Housekeeper', 'Leith', '£35 to £60 per clean']]);
  const questions = list[0].questions;
  const answers = Object.fromEntries(questions.map(q => [q.id, q.kind === 'yes_no' ? 'Yes' : q.kind === 'number' ? '3' : 'Some answer']));
  const apply = extra => careers({ action: 'apply', vacancyId: vid, fullName: 'Ann Able', email: 'Ann@Example.com', phone: '07700 900123', answers, otherRoles: true, cv: cv(vid), tokenHash: hex(), ...extra });
  // Required answers, a stored CV in this vacancy's folder, and one application per email.
  const required = questions.find(q => q.required);
  if (required) await refused(apply({ answers: { ...answers, [required.id]: '' } }), /Answer:/);
  await refused(apply({ cv: { ...cv(vid), path: `applications/${crypto.randomUUID()}/x.pdf` } }), /Add your CV/);
  await refused(apply({ answers: { ...answers, q99: 'x' } }), /Invalid request/);
  const done = await apply();
  ann = done.candidateId;
  await refused(apply({ email: 'ann@example.com' }), /already applied/);
  r = await read(RECRUITER);
  const c = r.vacancies[0].candidates.find(x => x.id === ann);
  assert.deepEqual([c.source, c.email, c.otherRoles, c.hasAccount, c.cvFile.name, c.answers.length], ['careers', 'ann@example.com', true, false, 'My CV.pdf', Object.keys(answers).length]);
  assert.equal(await notified(RECRUITER, 'recruitment.applied'), 1);
  assert.deepEqual(await emails(), ['Ann Able:received:pending']);
});

test('the careers@ emails are claimed once and marked sent; the account link makes a limited account', async () => {
  const jobs = (await careers({ action: 'emailClaim' })).map(j => C.careersEmailJobSchema.parse(j));
  assert.deepEqual(jobs.map(j => [j.kind, j.to, j.title, j.hasAccount]), [['received', 'ann@example.com', 'Housekeeper', false]]);
  assert.deepEqual(await careers({ action: 'emailClaim' }), []);
  const mail = C.careersEmail(jobs[0], { url: 'https://app.example/careers/account?t=x', label: 'Create your account' });
  assert.match(mail.subject, /We received your application: Housekeeper/);
  assert.match(mail.text, /within 14 working days/);
  // The link the server put in the email (its hash replaces the one made when they applied).
  const token = hex(), hash = await sha(token);
  assert.deepEqual(await careers({ action: 'refreshToken', id: jobs[0].candidateId, tokenHash: hash }), { ok: true });
  await careers({ action: 'emailDone', id: jobs[0].id, ok: true });
  assert.deepEqual(await emails(), ['Ann Able:received:sent']);
  await refused(careers({ action: 'claimAccount', tokenHash: hex() }), /expired/);
  assert.deepEqual(await careers({ action: 'claimAccount', tokenHash: hash }), { email: 'ann@example.com', name: 'Ann Able', userId: null, linked: false });
  // The server makes the sign-in (a pending profile, as for anyone), then links it.
  annUser = '97d90000-0000-4000-8000-000000000001';
  await owner('reset role'); await signIn(annUser, 'ann@example.com');
  await refused(careers({ action: 'linkApplicant', tokenHash: hash, userId: users[MANAGER] }), /Invalid request/);
  await careers({ action: 'linkApplicant', tokenHash: hash, userId: annUser });
  assert.equal((await careers({ action: 'claimAccount', tokenHash: hash })).linked, true);
  const [profile] = await owner('select status,role from public.workspace_profiles where user_id=$1', [annUser]);
  assert.deepEqual(profile, { status: 'pending', role: 'client' });
  // Their sign-in is not an access request; they see only their own application; the team's tools refuse them.
  assert.equal((await accessList()).includes(annUser), false);
  const mine = await applicantRead(annUser);
  assert.deepEqual([mine.applicant, mine.name, mine.applications.map(a => [a.title, a.stage])], [true, 'Ann Able', [['Housekeeper', 'received']]]);
  await asUser(annUser);
  await refused(rpc('workspace_recruitment_read'), /./);
  assert.equal((await applicantRead(users[MANAGER])).applicant, false);
  await refused(applicant(users[MANAGER], { action: 'withdraw', candidateId: ann }), /for applicants/);
  assert.equal((await read(RECRUITER)).vacancies[0].candidates.find(x => x.id === ann).hasAccount, true);
});

test('from their account: the interview, the offer, the contract and messages, each step emailed', async () => {
  await act(RECRUITER, { action: 'setCandidate', vacancyId: vid, candidateId: ann, status: 'shortlisted' });
  await act(RECRUITER, { action: 'shareShortlist', vacancyId: vid });
  const [s1, s2] = [later(2), later(3)];
  await act(MANAGER, { action: 'setInterviews', vacancyId: vid, mode: 'virtual', place: 'https://meet.example.com/x', minutes: 30, slots: [s1, s2] });
  await act(MANAGER, { action: 'inviteToInterview', vacancyId: vid, candidateId: ann });
  let mine = await applicantRead(annUser);
  let a = mine.applications[0];
  assert.deepEqual([a.stage, a.interview.status, a.interview.freeSlots.length, a.interview.place], ['interview', 'invited', 2, 'https://meet.example.com/x']);
  await refused(applicant(annUser, { action: 'bookInterview', candidateId: ann, at: later(9) }), /times offered/);
  mine = await applicant(annUser, { action: 'bookInterview', candidateId: ann, at: s1 });
  assert.equal(new Date(mine.applications[0].interview.at).getTime(), new Date(s1).getTime());
  assert.equal(await notified(MANAGER, 'recruitment.interview_booked'), 1);
  assert.equal((await owner("select count(*)::int n from private.workspace_hub_items where title='Interview: Ann Able (Housekeeper)' and assignee_id=$1", [users[MANAGER]]))[0].n, 1);
  await act(MANAGER, { action: 'interviewOutcome', vacancyId: vid, candidateId: ann, outcome: 'done' });
  await act(MANAGER, { action: 'finishInterviews', vacancyId: vid });
  await act(MANAGER, { action: 'chooseCandidate', vacancyId: vid, candidateId: ann, decision: 'select' });
  // Chosen: their sign-in now shows in Access control, so it can become their team account.
  assert.equal((await accessList()).includes(annUser), true);
  mine = await applicant(annUser, { action: 'answerOffer', candidateId: ann, answer: 'accept' });
  assert.equal(mine.applications[0].stage, 'accepted');
  // The contract: from a template a director signed; they sign it with a drawn signature.
  const wording = 'This agreement is between Recharge Group and {{full_name}}, as {{job_title}}. {{full_name}} agrees to the terms below.';
  let r = await act(SUPER, { action: 'saveContractTemplate', title: 'Housekeeper contract', jobKeys: ['housekeeper'], body: wording, active: true, directorName: 'Alex Coghill', directorSignature: PNG });
  await act(RECRUITER, { action: 'issueContract', vacancyId: vid, candidateId: ann, templateId: r.templates[0].id, fields: { full_name: 'Ann Able', job_title: 'Housekeeper' } });
  mine = await applicantRead(annUser);
  assert.deepEqual([mine.applications[0].stage, mine.applications[0].contract.directorName], ['contract', 'Alex Coghill']);
  assert.match(mine.applications[0].contract.body, /Recharge Group and Ann Able, as Housekeeper/);
  await refused(applicant(annUser, { action: 'signContract', candidateId: ann, signedName: 'Ann Able', signatureImage: 'data:image/jpeg;base64,AAAA', consent: true }).catch(e => { throw new Error(e.issues?.[0]?.message ?? e.message); }), /Draw your signature/);
  mine = await applicant(annUser, { action: 'signContract', candidateId: ann, signedName: 'Ann Able', signatureImage: PNG, consent: true });
  assert.equal(mine.applications[0].stage, 'signed');
  await refused(applicant(annUser, { action: 'withdraw', candidateId: ann }), /signed your contract/);
  r = await read(RECRUITER);
  assert.deepEqual([r.vacancies[0].candidates[0].contract.signedHow, r.vacancies[0].candidates[0].contract.signedName], ['candidate', 'Ann Able']);
  assert.equal(await notified(RECRUITER, 'recruitment.contract_signed'), 1);
  // Messages both ways; the team's is emailed too.
  r = await act(RECRUITER, { action: 'sendMessage', vacancyId: vid, candidateId: ann, body: 'Welcome! Your first day is Monday.' });
  await refused(act(MANAGER, { action: 'sendMessage', vacancyId: vid, candidateId: ann, body: 'Hi' }), /Recruitment message applicants/);
  mine = await applicant(annUser, { action: 'sendMessage', candidateId: ann, body: 'Thank you, see you then.' });
  assert.deepEqual(mine.applications[0].messages.map(m => [m.authorName, m.body]), [['Rita', 'Welcome! Your first day is Monday.'], ['You', 'Thank you, see you then.']]);
  r = await read(RECRUITER);
  assert.deepEqual(r.vacancies[0].candidates[0].messages.map(m => [m.fromApplicant, m.authorName]), [[false, 'Rita Recruiter'], [true, 'Ann Able']]);
  assert.equal(await notified(RECRUITER, 'recruitment.applicant_message'), 1);
  assert.deepEqual((await emails()).filter(e => e.endsWith('pending')), ['Ann Able:shortlisted:pending', 'Ann Able:interview:pending', 'Ann Able:offer:pending', 'Ann Able:contract:pending', 'Ann Able:message:pending']);
  // The same request twice does one thing.
  await asUser(annUser);
  const body = C.applicantActionSchema.parse({ requestId: crypto.randomUUID(), action: 'sendMessage', candidateId: ann, body: 'Once' });
  await rpc('workspace_applicant_action', [body]); await rpc('workspace_applicant_action', [body]);
  assert.equal((await owner("select count(*)::int n from private.workspace_recruitment_messages where body='Once'"))[0].n, 1);
});

test('a closed form takes no more applications; another applicant withdraws', async () => {
  assert.equal((await accessList()).includes(annUser), true);
  // The shortlist was shared, which closed the form.
  await refused(careers({ action: 'form', vacancyId: vid }), /no longer taking applications/);
  assert.deepEqual(await careers({ action: 'list' }), []);
  const bobUser = '97d90000-0000-4000-8000-000000000002';
  await owner('reset role'); await signIn(bobUser, 'bob@example.com');
  await owner("insert into private.workspace_applicants(user_id,email) values($1,'bob@example.com')", [bobUser]);
  const [bob] = await owner("insert into private.workspace_recruitment_candidates(vacancy_id,full_name,email,phone,source,applicant_id,applied_at) values($1,'Bob Burns','bob@example.com','07700 900124','careers',$2,now()) returning id", [vid, bobUser]);
  const mine = await applicant(bobUser, { action: 'withdraw', candidateId: bob.id });
  assert.equal(mine.applications[0].stage, 'withdrawn');
  await refused(applicant(bobUser, { action: 'withdraw', candidateId: ann }), /Application not found/);
  assert.equal(await notified(RECRUITER, 'recruitment.applicant_withdrew'), 1);
});

async function sha(text) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
}
