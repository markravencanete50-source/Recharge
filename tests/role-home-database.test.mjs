import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Each role's Home (20261021300000): workspace_role_home answers the caller's own counts and figures, worked out only
// from what that role may open. A contractor counts only repairs referred to Ready at their properties, a cleaner only
// their own cleans, Guest relations only their properties' guests and work, and money only reaches Accounts. Admins may
// preview any role; nobody else may read another role's Home.
const MIGRATION = 'supabase/migrations/20261021300000_role_home.sql';
const root = fileURLToPath(new URL('..', import.meta.url));
const vite = await createServer({ configFile: false, root, server: { middlewareMode: true, hmr: false } });
const { roleHomeSchema } = await vite.ssrLoadModule('/lib/role-home.ts');
const { teamsReadSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');

const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
after(async () => { await db.close(); await vite.close(); });

const roles = ['super_admin', 'admin', 'stays', 'cleaning_manager', 'cleans', 'ready', 'accounts', 'client', 'cleans', 'ready'];
const users = roles.map((_, i) => `f4100000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, STAYS, MANAGER, CLEANER, READY, ACCOUNTS, OWNER, CLEANER2, READY2] = roles.map((_, i) => i);
const session = i => users[i].replace('f410', 'f420');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `rolehome${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], `Person ${i}`]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
async function asDb() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); }
beforeEach(async () => { await db.exec('reset role'); });
const sql = async (text, args = []) => { await asDb(); return (await db.query(text, args)).rows; };
const home = async (who, role = null) => { await as(who); return roleHomeSchema.parse((await db.query('select public.workspace_role_home($1) r', [role])).rows[0].r); };
const raw = async (who, role = null) => { await as(who); return (await db.query('select public.workspace_role_home($1) r', [role])).rows[0].r; };

// ---------- two properties: Ash is looked after by the team below; Birch by nobody but management ----------
const property = async name => (await sql("insert into public.workspace_properties(name,region,status,created_by,request_id) values($1,'Fife','active',$2,gen_random_uuid()) returning id", [name, users[ADMIN]]))[0].id;
const ASH = await property('Ash Cottage'), BIRCH = await property('Birch House');
for (const [who, kind] of [[STAYS, 'staff'], [MANAGER, 'cleaning_manager'], [CLEANER, 'cleaner'], [CLEANER2, 'cleaner'], [READY, 'staff'], [ACCOUNTS, 'staff'], [OWNER, 'client']])
  await sql('insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values($1,$2,$3,$4)', [ASH, users[who], kind, users[ADMIN]]);
// The second contractor looks after Birch only.
await sql('insert into public.workspace_property_assignments(property_id,user_id,assignment,granted_by) values($1,$2,$3,$4)', [BIRCH, users[READY2], 'staff', users[ADMIN]]);

const DAY = "(now() at time zone 'Europe/London')::date";
// One work item with its details; `due` is days from today (null: no date).
async function work(prop, module, kind, data, { status = 'waiting', due = null, assignee = null, completed = false, created = null } = {}) {
  return (await sql(`insert into public.workspace_work_items(request_id,property_id,module_id,title,status,due_on,assignee_id,created_by,completed_at,created_at)
    values(gen_random_uuid(),$1,$2,$3,$4,case when $5::int is null then null else ${DAY}+$5::int end,$6,$7,case when $8 then now() end,coalesce($9::timestamptz,now())) returning id`,
  [prop, module, kind + ' job', status, due, assignee === null ? null : users[assignee], users[ADMIN], completed, created]).then(async ([r]) => {
    await sql('insert into private.workspace_domain_details(work_id,kind,data) values($1,$2,$3)', [r.id, kind, data]);
    return r.id;
  }));
}
const today = (await sql(`select to_char(${DAY},'YYYY-MM-DD') d`))[0].d;
const dayFrom = async n => (await sql(`select to_char(${DAY}+$1::int,'YYYY-MM-DD') d`, [n]))[0].d;

// ---------- guests: three waiting (Ash, Birch, not yet matched to a property), one answered ----------
async function conversation(ref, prop, guestName, replied) {
  await sql(`insert into private.workspace_guest_threads(source,thread_ref,property_id,channel,guest_name,last_message_at) values('hostaway',$1,$2,'airbnb',$3,now())`, [ref, prop, guestName]);
  await sql(`insert into private.workspace_guest_messages(source,external_id,thread_ref,property_id,channel,direction,sent_at,body) values('hostaway',$1,$2,$3,'airbnb','guest',now()-interval '30 minutes','Hello')`, [ref + '-g', ref, prop]);
  if (replied) await sql(`insert into private.workspace_guest_messages(source,external_id,thread_ref,property_id,channel,direction,sent_at,body,author_user_id,delivery) values('hostaway',$1,$2,$3,'airbnb','team',now()-interval '10 minutes','Hi',$4,'sent')`, [ref + '-t', ref, prop, users[STAYS]]);
}
await conversation('c-ash', ASH, 'Gina Guest', false);
await conversation('c-birch', BIRCH, 'Bob Birch', false);
await conversation('c-none', null, 'Una Unplaced', false);
await conversation('c-done', ASH, 'Rita Replied', true);

// ---------- a client enquiry back from the landlord, ready to value ----------
await sql(`insert into private.workspace_client_enquiries(token_hash,recipient_name,recipient_email,subject,body,delivery,status,answers,sent_by)
  values(repeat('a',64),'Lena Landlord','lena@example.com','Your flat','Please fill in the form','link','received','{}'::jsonb,$1)`, [users[STAYS]]);

// ---------- stays at Ash: two arrive today, one tomorrow, one leaves today; Birch's arrival is not theirs ----------
async function stay(prop, ref, checkIn, checkOut) {
  await sql(`insert into private.workspace_reservations(property_id,reference,check_in,check_out,status,source,channel,payout_minor) values($1,$2,${DAY}+$3::int,${DAY}+$4::int,'confirmed','manual','direct',10000)`, [prop, ref, checkIn, checkOut]);
}
await stay(ASH, 'A1', 0, 2); await stay(ASH, 'A2', 0, 1); await stay(ASH, 'A3', 1, 3); await stay(ASH, 'A0', -2, 0); await stay(BIRCH, 'B1', 0, 2);

// ---------- cleans ----------
const CLEAN = 'cleaning-schedule';
await work(ASH, CLEAN, 'cleaning', { phase: 'assigned' }, { due: 0, assignee: CLEANER });                       // the cleaner's clean today
await work(ASH, CLEAN, 'cleaning', { phase: 'assigned' }, { due: 0 });                                          // not assigned today
await work(ASH, CLEAN, 'cleaning', { phase: 'assigned' }, { due: 1 });                                          // not assigned tomorrow
await work(ASH, CLEAN, 'cleaning', { phase: 'review' }, { status: 'in_review', due: 0, assignee: CLEANER });    // done today, waiting for review
await work(ASH, CLEAN, 'cleaning', { phase: 'assigned', accepted: false }, { status: 'in_progress', due: -1, assignee: CLEANER }); // sent back to redo
await work(ASH, CLEAN, 'cleaning', { phase: 'assigned' }, { due: -2, assignee: CLEANER });                      // missed: overdue
await work(ASH, CLEAN, 'cleaning', { phase: 'assigned' }, { due: 0, assignee: CLEANER2 });                      // another cleaner's
await work(BIRCH, CLEAN, 'cleaning', { phase: 'assigned' }, { due: 0 });                                        // Birch: not the manager's
// A rejected clean the cleaner has not answered yet, and one they have.
await work(ASH, 'cleaner-performance', 'cleaning_complaint', { cleanerId: users[CLEANER], sourceWorkId: null });
await work(ASH, 'cleaner-performance', 'cleaning_complaint', { cleanerId: users[CLEANER], cleanerStatement: 'The guest left late' }, { created: '2020-01-01T10:00:00Z' });
// First reviews this month: one passed, one sent back (passed on the second go); one from last month is not counted.
const [r1, r2, r3] = [await work(ASH, CLEAN, 'cleaning', { phase: 'done' }, { status: 'completed', due: 0, assignee: CLEANER }),
  await work(ASH, CLEAN, 'cleaning', { phase: 'done' }, { status: 'completed', due: 0, assignee: CLEANER }),
  await work(ASH, CLEAN, 'cleaning', { phase: 'done' }, { status: 'completed', due: -40, assignee: CLEANER })];
const review = (w, accepted, at) => sql(`insert into private.workspace_cleaning_reviews(work_id,cleaner_id,reviewer_id,accepted,guest_feedback,review_note,created_at) values($1,$2,$3,$4,'Fine','Checked',${at})`, [w, users[CLEANER], users[MANAGER], accepted]);
await review(r1, true, 'now()');
await review(r2, false, "now()-interval '1 minute'"); await review(r2, true, 'now()');
await review(r3, true, "now()-interval '45 days'");
// A restock request at Ash.
await work(ASH, 'replenishment-requests', 'replenishment', {});

// ---------- repairs ----------
const MAINT = 'maintenance-reporting';
const referred = { referredAt: new Date().toISOString() };
await work(ASH, MAINT, 'maintenance', { phase: 'triage' });                                                      // Stays: to refer
await work(ASH, MAINT, 'maintenance', { phase: 'referred', ...referred });                                       // Ready: new job
await work(ASH, MAINT, 'maintenance', { phase: 'referred', bookingApprovedAt: new Date().toISOString(), ...referred }); // approved: book the visit
await work(ASH, MAINT, 'maintenance', { phase: 'booked', repairOn: today, ...referred }, { status: 'in_progress' });    // visit today
await work(ASH, MAINT, 'maintenance', { phase: 'booked', repairOn: await dayFrom(-1), ...referred }, { status: 'in_progress' }); // to mark done
await work(ASH, MAINT, 'maintenance', { phase: 'completed', repairOn: await dayFrom(-1), ...referred }, { status: 'completed', completed: true });
await work(BIRCH, MAINT, 'maintenance', { phase: 'referred', ...referred });                                     // Birch: the other contractor's
// Routine visits at Ash: one today nobody has taken, one for somebody else.
await work(ASH, 'routine-bin-garden-board', 'routine_visit', {}, { due: 0 });
await work(ASH, 'routine-bin-garden-board', 'routine_visit', {}, { due: 0, assignee: READY2 });

// ---------- accounts ----------
await sql('update private.workspace_finance_policy set expense_approval_limit_minor=50000 where singleton');
for (const [ref, amount] of [['E1', 12000], ['E2', 90000]])
  await sql(`insert into private.workspace_expenses(property_id,supplier,reference,category,description,amount_minor,received_on,source,created_by,request_id)
    values($1,'Fixit Ltd',$2,'maintenance','Boiler repair at the flat',$3,${DAY},'manual',$4,gen_random_uuid())`, [ASH, ref, amount, users[ACCOUNTS]]);
await sql(`insert into private.workspace_cleaner_invoices(supplier,cleaner_id,reference,invoice_date,total_minor,created_by,request_id) values('Person 4',$1,'INV-1',${DAY},4500,$2,gen_random_uuid())`, [users[CLEANER], users[ACCOUNTS]]);

test('Guest relations: their guests, enquiries, reviews, repairs to refer, and today at their properties', async () => {
  const h = await home(STAYS);
  assert.equal(h.role, 'stays');
  assert.equal(h.guestsWaiting, 2, 'Ash and the unmatched conversation; Birch is not theirs, the answered one is not waiting');
  assert.equal(h.enquiriesToValue, 1);
  assert.equal(h.cleansToReview, 1);
  assert.equal(h.repairsToRefer, 1);
  assert.deepEqual([h.checkInsToday, h.checkInsTomorrow, h.checkOutsToday], [2, 1, 1]);
  assert.equal(h.openRepairs, 5, 'triage, two referred, two booked at Ash; the finished one is not open');
  // No guest or enquirer names, and no money.
  const text = JSON.stringify(await raw(STAYS));
  for (const word of ['Gina', 'Una', 'Lena', 'lena@', 'Minor']) assert.ok(!text.includes(word), word);
});

test('the cleaning manager: their properties\' cleans, reviews, disputes and restock', async () => {
  const h = await home(MANAGER);
  assert.deepEqual([h.unassignedToday, h.unassignedTomorrow, h.toReview, h.disputes, h.restockOpen], [1, 1, 1, 2, 1]);
  assert.equal(h.cleansToday, 6, 'Ash today: the cleaner\'s, the unassigned one, the reviewed one, the other cleaner\'s and two finished; Birch is left out');
  assert.equal(h.cleansDoneToday, 3);
  assert.ok(h.cleansThisWeek >= h.cleansToday);
  assert.deepEqual([h.reviewedFirst, h.acceptedFirst], [2, 1], 'this month only; a clean passed on the second go is not first time');
  assert.ok(!JSON.stringify(await raw(MANAGER)).includes('Minor'), 'no money');
});

test('a cleaner: only their own cleans', async () => {
  const h = await home(CLEANER);
  assert.deepEqual([h.cleansToday, h.overdue, h.redo, h.toRespond], [1, 1, 1, 1]);
  assert.equal(h.doneThisMonth, 3, 'the one in review and the two accepted today');
  assert.deepEqual([h.reviewedFirst, h.acceptedFirst], [2, 1]);
  const other = await home(CLEANER2);
  assert.deepEqual([other.cleansToday, other.overdue, other.redo, other.toRespond, other.reviewedFirst], [1, 0, 0, 0, 0]);
});

test('a contractor: repairs referred at their properties, and visits that are theirs or nobody\'s', async () => {
  const h = await home(READY);
  assert.deepEqual([h.newJobs, h.approvedToBook, h.repairsToday, h.toMarkDone, h.openJobs], [1, 1, 1, 1, 4]);
  assert.equal(h.repairsDoneThisMonth, 1);
  assert.deepEqual([h.visitsToday, h.visitsOverdue], [1, 0], 'the visit given to somebody else is not theirs');
  const text = JSON.stringify(await raw(READY));
  for (const word of ['Gina', 'guest', 'Minor', 'imit']) assert.ok(!text.includes(word), word);
  // The second contractor sees Birch's job only.
  const other = await home(READY2);
  assert.deepEqual([other.newJobs, other.openJobs, other.visitsToday], [1, 1, 0], 'a visit at a property they do not look after is not theirs either');
});

test('Accounts: expenses within their limit, cleaner invoices, and this month\'s money', async () => {
  const h = await home(ACCOUNTS);
  assert.equal(h.expensesToApprove, 1, 'the one over the approval limit waits for management');
  assert.equal(h.cleanerInvoicesToApprove, 1);
  assert.deepEqual([h.expensesMinor, h.expensesCount], [102000, 2]);
  assert.deepEqual([h.payoutsReceivedMinor, h.statementsToIssue, h.statementsIssued], [0, 0, 0]);
  // Management previewing Accounts sees the same expenses line (the limit is Accounts').
  assert.equal((await home(SUPER, 'accounts')).expensesToApprove, 1);
});

test('admins preview any role; owners and admins themselves get only the day', async () => {
  const preview = await home(SUPER, 'stays');
  assert.equal(preview.role, 'stays');
  assert.equal(preview.guestsWaiting, 3, 'management sees every conversation');
  assert.equal((await home(ADMIN, 'ready')).newJobs, 2, 'every referred repair');
  assert.deepEqual((await home(SUPER, 'cleans')).cleansToday, 0, 'a cleaner\'s Home is their own cleans: none for the super admin');
  for (const [who, role] of [[OWNER, null], [ADMIN, null]]) {
    const r = await raw(who, role);
    assert.deepEqual(Object.keys(r).sort(), ['month', 'role', 'today', 'weekStart'], roles[who]);
  }
  assert.equal((await raw(STAYS, 'stays')).role, 'stays', 'naming your own role is fine');
});

test('nobody else reads another role\'s Home; anon cannot call it', async () => {
  for (const [who, role] of [[STAYS, 'accounts'], [CLEANER, 'cleaning_manager'], [READY, 'stays'], [OWNER, 'accounts'], [ACCOUNTS, 'admin']]) {
    await as(who);
    await assert.rejects(db.query('select public.workspace_role_home($1)', [role]), /Only your own Home can be read/, `${roles[who]} as ${role}`);
  }
  await as(SUPER);
  await assert.rejects(db.query("select public.workspace_role_home('nobody')"), /Choose a role/);
  await asDb(); await db.exec('set role anon');
  await assert.rejects(db.query('select public.workspace_role_home()'), /permission denied/);
  await assert.rejects(db.query('select private.workspace_role_home(null)'), /permission denied/);
  await db.exec('reset role');
  // The app's read section is accepted, with the role to preview.
  assert.deepEqual(teamsReadSchema.parse({ section: 'roleHome', role: 'ready' }), { section: 'roleHome', role: 'ready' });
});

test('the migration is safe to run twice and deletes or drops nothing', async () => {
  await asDb();
  const text = await fs.readFile(MIGRATION, 'utf8');
  assert.doesNotMatch(text, /\b(drop|delete|truncate)\b/i);
  assert.match(text, /security definer/);
  assert.match(text, /public\.workspace_role_home\(view_role text default null\) returns jsonb language sql security invoker/);
  await db.exec(text);
  assert.equal((await home(CLEANER)).cleansToday, 1);
});
