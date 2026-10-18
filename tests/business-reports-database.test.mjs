import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Business reports (migration 20261020860000): enquiries, repairs and spend, to-dos, messages and time worked, for
// admins and super admins only, with every answer read through the app's own schemas.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { teamsReadSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const R = await vite.ssrLoadModule('/lib/business-reports-view.ts');
const { START_WHEN } = await vite.ssrLoadModule('/lib/client-enquiry.ts');
const MIGRATION = 'supabase/migrations/20261020860000_business_reports.sql';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const roles = ['super_admin', 'admin', 'stays', 'client', 'accounts'];
const names = ['Sam', 'Alex', 'Dan', 'Olive Owner', 'Ann'];
const users = roles.map((_, i) => `97600000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, DAN, OWNER, ACCOUNTS] = roles.map((_, i) => i);
const session = i => users[i].replace('9760', '9860');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `report${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], names[i]]);
}
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
const owner = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const one = async (text, args = []) => (await owner(text, args))[0];
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date());
const day = n => new Date(Date.parse(today + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
// An instant on a London day: hours after midnight UTC on that day (the tests only compare differences).
const at = (n, h) => new Date(Date.parse(day(n) + 'T00:00:00Z') + h * 3600000).toISOString();
const FROM = day(-29), TO = today;
const report = async (section, from = FROM, to = TO) => {
  const parsed = teamsReadSchema.parse({ section: R.REPORT_SECTION[section], from, to });
  return (await db.query('select public.workspace_business_report($1,$2,$3) r', [section, parsed.from, parsed.to])).rows[0].r;
};
after(async () => { await db.close(); await vite.close(); });

const property = async name => (await one("insert into public.workspace_properties(name,address,created_by,request_id,status) values($1,$1||', Perth',$2,gen_random_uuid(),'active') returning id", [name, users[ADMIN]])).id;
const ROSE = await property('Rose Cottage'), HARBOUR = await property('Harbour Flat');

// ---------- enquiries: three forms (one inside the dates closed) and one onboarding added in the app ----------
async function journey(name, stage, createdAt, extra = {}) {
  const prop = await property(name);
  const work = (await one("insert into public.workspace_work_items(request_id,property_id,module_id,title,created_by) values(gen_random_uuid(),$1,'property-onboarding','Property onboarding',$2) returning id", [prop, users[ADMIN]])).id;
  await owner(`insert into private.workspace_journeys(property_id,client_id,work_id,stage,property_type,bathrooms,created_at,signed_at,enquiry) values($1,null,$2,$3,'Cottage',1,$4,$5,$6::jsonb)`,
    [prop, work, stage, createdAt, extra.signedAt ?? null, JSON.stringify(extra.enquiry ?? {})]);
  return prop;
}
let hex = 0;
const enquiry = async (submittedAt, answers, extra = {}) => owner(`insert into private.workspace_client_enquiries(token_hash,recipient_name,recipient_email,subject,body,delivery,email_status,status,answers,sent_by,sent_at,submitted_at,property_id)
  values($1,'Sarah Jones',$2,'Your enquiry','Hello','email','sent',$3,$4::jsonb,$5,$6,$6,$7)`,
  [String(++hex).padStart(64, '0'), extra.email ?? 'sarah@example.com', extra.status ?? 'received', JSON.stringify(answers), users[ADMIN], submittedAt, extra.property ?? null]);
const e1 = await journey('Mill House', 'form', at(-5, 9), { signedAt: at(-4, 9) });
await enquiry(at(-5, 9), { startWhen: START_WHEN[0], phone: '07700 900123' }, { property: e1 });
await owner("insert into public.workspace_activity(actor_id,property_id,event_type,created_at) values($1,$2,'journey.publishEstimate',$3)", [users[ADMIN], e1, at(-5, 11)]);
const e2 = await journey('Glen Lodge', 'enquiry', at(-3, 9));
await enquiry(at(-3, 9), { startWhen: START_WHEN[1] }, { property: e2, email: 'glen@example.com' });
await enquiry(at(-2, 9), { startWhen: START_WHEN[0] }, { status: 'closed', email: 'nope@example.com' });
await enquiry(at(-60, 9), { startWhen: START_WHEN[0] }, { email: 'old@example.com' });
const app = await journey('Loch View', 'live', at(-2, 10), { signedAt: at(-1, 9), enquiry: { email: 'loch@example.com' } });
await owner(`insert into private.workspace_estimate_links(property_id,token_hash,request_id,delivery,email_status,recipient_email,estimate,issued_by,issued_at)
  values($1,$2,gen_random_uuid(),'link','manual',null,'{}'::jsonb,$3,$4)`, [app, 'f'.repeat(64), users[ADMIN], at(-2, 10.5)]);
// Client emails: Sarah is answered an hour after her form (earlier than her estimate), and a landlord's email is answered in 30 minutes.
const thread = async address => (await one("insert into private.workspace_client_email_threads(address,name,subject,last_message_at) values($1,'Sarah Jones','Hi',now()) returning id", [address])).id;
const sarah = await thread('sarah@example.com'), landlord = await thread('landlord@example.com');
const email = (threadId, direction, sentAt, status = direction === 'in' ? 'received' : 'sent') => owner(`insert into private.workspace_client_email_messages(thread_id,direction,email_id,request_id,body,sent_at,status,author_user_id)
  values($1,$2,case when $2='in' then gen_random_uuid()::text end,case when $2='out' then gen_random_uuid() end,'Hello',$3,$4,case when $2='out' then $5::uuid end)`, [threadId, direction, sentAt, status, users[ADMIN]]);
await email(sarah, 'out', at(-5, 10));
await email(landlord, 'in', at(-1, 9));
await email(landlord, 'out', at(-1, 9.5));
await email(landlord, 'out', at(-1, 9.6), 'failed');

// ---------- repairs and maintenance spend ----------
async function repair(prop, status, data, createdAt = at(-4, 9), completedAt = null) {
  const id = (await one("insert into public.workspace_work_items(request_id,property_id,module_id,title,status,created_by,created_at,completed_at) values(gen_random_uuid(),$1,'stays-maintenance-reporting','Property repair request',$2,$3,$4,$5) returning id",
    [prop, status, users[DAN], createdAt, completedAt])).id;
  await owner("insert into private.workspace_domain_details(work_id,kind,data) values($1,'maintenance',$2::jsonb)", [id, JSON.stringify(data)]);
}
await repair(ROSE, 'waiting', { phase: 'referred', estimatedCostMinor: 15000, issue: 'Boiler not firing' });
await repair(ROSE, 'completed', { phase: 'completed', paidAt: at(-1, 9), estimatedCostMinor: 20000, actualCostMinor: 18000 }, at(-6, 9), at(-2, 9));
await repair(HARBOUR, 'cancelled', { phase: 'triage' });
await repair(HARBOUR, 'waiting', { phase: 'triage', estimatedCostMinor: 999 }, at(-90, 9));
const expense = (prop, category, amount, status, receivedOn = day(-2)) => owner(`insert into private.workspace_expenses(property_id,supplier,reference,category,description,amount_minor,received_on,source,status,created_by,request_id)
  values($1,'Perth Plumbing','INV-'||gen_random_uuid()::text,$2,'Boiler repair work',$3,$4,'manual',$5,$6,gen_random_uuid())`, [prop, category, amount, receivedOn, status, users[ACCOUNTS]]);
await expense(ROSE, 'maintenance', 18000, 'approved');
await expense(HARBOUR, 'maintenance', 5000, 'to_approve');
await expense(HARBOUR, 'maintenance', 1000, 'rejected');
await expense(HARBOUR, 'cleaning_supplies', 777, 'approved');
await expense(ROSE, 'maintenance', 4444, 'approved', day(-90));

// ---------- to-dos ----------
const todo = (fields) => owner(`insert into private.workspace_hub_items(kind,title,status,department,assignee_id,due_on,decided_by,decided_at,created_by,created_at)
  values('todo',$1,$2,$3,$4,$5,$6,$7,$8,$9)`, [fields.title, fields.status ?? 'open', fields.department ?? null, fields.assignee ?? null, fields.dueOn ?? null, fields.doneBy ?? null, fields.doneAt ?? null, users[ADMIN], fields.createdAt ?? at(-10, 9)]);
await todo({ title: 'Restock linen', department: 'cleaning', dueOn: day(-3), status: 'done', doneBy: users[DAN], doneAt: at(-2, 12) });
await todo({ title: 'Ring the plumber', assignee: users[DAN], dueOn: day(-3) });
await todo({ title: 'Check reviews', department: 'guest_relations', dueOn: day(-1), status: 'done', doneBy: users[DAN], doneAt: at(-1, 12) });
await todo({ title: 'Read the report', assignee: users[ADMIN], createdAt: at(-1, 9) });
await todo({ title: 'Old one', assignee: users[ADMIN], dueOn: day(-90) });

// ---------- messages ----------
const guest = (ref, channel, direction, sentAt) => owner(`insert into private.workspace_guest_messages(source,external_id,thread_ref,channel,direction,sent_at,author_user_id,delivery,body)
  values('test',gen_random_uuid()::text,$1,$2,$3,$4,case when $3='team' then $5::uuid end,case when $3='team' then 'sent' end,'Hi')`, [ref, channel, direction, sentAt, users[DAN]]);
await guest('a1', 'airbnb', 'guest', at(-2, 10));
await guest('a1', 'airbnb', 'team', at(-2, 10 + 20 / 60));
await guest('b1', 'booking_com', 'guest', at(-40, 10));
const chat = (await one("insert into private.chat_conversations(kind,owner_id,created_by) values('owner',$1,$1) returning id", [users[OWNER]])).id;
const said = (who, createdAt) => owner("insert into private.chat_messages(conversation_id,author_id,body,request_id,created_at) values($1,$2,'Hello',gen_random_uuid(),$3)", [chat, users[who], createdAt]);
await said(OWNER, at(-2, 12));
await said(ADMIN, at(-2, 13.5));

// ---------- time worked: an old lunch pause (unpaid) and a break (paid) ----------
const shift = async (i, department, from, to) => (await one("insert into private.workspace_shifts(user_id,department,clocked_in_at,clocked_out_at,request_id) values($1,$2,$3,$4,gen_random_uuid()) returning id", [users[i], department, from, to])).id;
const danShift = await shift(DAN, 'guest_relations', at(-2, 9), at(-2, 17));
await owner("insert into private.workspace_shift_pauses(shift_id,user_id,kind,started_at,ended_at) values($1,$2,'lunch',$3,$4),($1,$2,'break',$5,$6)", [danShift, users[DAN], at(-2, 12), at(-2, 13), at(-2, 15), at(-2, 15.25)]);
await shift(ADMIN, 'management', at(-1, 10), at(-1, 12));

test('only admins and super admins can read the business reports, for up to 366 days', async () => {
  for (const i of [DAN, OWNER, ACCOUNTS]) {
    await as(i);
    await assert.rejects(report('time'), /Management access required/, roles[i]);
  }
  await as(SUPER);
  await assert.rejects(db.query("select public.workspace_business_report('time',$1,$2)", [day(-366), today]), /Choose up to 366 days/);
  await assert.rejects(db.query("select public.workspace_business_report('nope',$1,$2)", [FROM, TO]), /Unknown report/);
  assert.ok(R.reportRangeError(day(-365), today) === '', 'a year and a day is allowed');
  assert.match(R.reportRangeError(day(-366), today), /366 days/);
  assert.ok(!teamsReadSchema.safeParse({ section: 'reportTime', from: day(-366), to: today }).success);
  assert.ok(!teamsReadSchema.safeParse({ section: 'reportTime' }).success, 'the dates are needed');
  await as(ADMIN);
  assert.equal(R.timeReportSchema.parse(await report('time')).shifts, 2);
});

test('enquiries: received by source and start, the funnel to live, and the first reply time', async () => {
  await as(ADMIN);
  const r = R.enquiriesReportSchema.parse(await report('enquiries'));
  assert.equal(r.received, 4);
  assert.equal(r.priority, 2, 'two forms said "As soon as possible" (one later closed)');
  assert.deepEqual(r.bySource, { form: 3, app: 1 });
  assert.deepEqual(Object.fromEntries(r.byStart.map(x => [x.startWhen, x.count])), { [START_WHEN[0]]: 2, [START_WHEN[1]]: 1 });
  assert.deepEqual(r.funnel, { received: 4, estimate: 2, agreement: 2, live: 1, declined: 1 });
  // Sarah: an email after 1h (before her estimate at 2h); the app onboarding: its estimate link after 30 minutes.
  assert.deepEqual([r.reply.replied, r.reply.waiting, r.reply.medianMinutes, r.reply.slowestMinutes], [2, 1, 45, 60]);
  assert.deepEqual([r.reply.estimateSent, r.reply.estimateMedianMinutes, r.reply.estimateSlowestMinutes], [2, 75, 120]);
  assert.deepEqual(r.rows.map(x => x.reached), ['agreement', 'received', 'received', 'live']);
  assert.deepEqual(R.funnelSteps(r.funnel).map(s => [s.label, s.count, s.fromPrevious]), [
    ['Enquiries received', 4, null], ['Estimate sent', 2, 50], ['Agreement signed', 2, 100], ['Gone live', 1, 50]]);
  // No names, emails or phone numbers leave the database.
  const text = JSON.stringify(r);
  for (const secret of ['Sarah', 'sarah@example.com', 'glen@example.com', 'loch@example.com', '07700']) assert.ok(!text.includes(secret), secret);
  const csv = R.enquiriesCsv(r);
  assert.ok(csv.startsWith('﻿') && csv.endsWith('\r\n'));
  assert.match(csv, /"Priority \(as soon as possible\)","2"/);
});

test('repairs: by stage and property, quoted and final costs, and maintenance spend', async () => {
  await as(SUPER);
  const r = R.repairsReportSchema.parse(await report('repairs'));
  assert.equal(r.raised, 3);
  assert.equal(r.completed, 1);
  assert.deepEqual(Object.fromEntries(r.byStage.map(x => [x.stage, x.count])), { referred: 1, paid: 1, cancelled: 1 });
  assert.deepEqual([r.quotedMinor, r.quotedRepairs, r.finalMinor, r.finalRepairs], [35000, 2, 18000, 1]);
  assert.deepEqual(r.spend, { approvedMinor: 18000, waitingMinor: 5000, rejectedMinor: 1000, expenses: 3 });
  const rose = r.byProperty.find(x => x.propertyName === 'Rose Cottage'), harbour = r.byProperty.find(x => x.propertyName === 'Harbour Flat');
  assert.deepEqual([rose.raised, rose.completed, rose.quotedMinor, rose.approvedMinor], [2, 1, 35000, 18000]);
  assert.deepEqual([harbour.raised, harbour.waitingMinor], [1, 5000]);
  assert.equal(R.REPAIR_STAGE_LABEL.paid, 'Paid');
  assert.match(R.repairsCsv(r), /"Rose Cottage","2","1","£350.00","£180.00","£180.00","£0.00"/);
});

test('to-dos: done, done late and overdue, by department and by person', async () => {
  await as(ADMIN);
  const r = R.todosReportSchema.parse(await report('todos'));
  assert.deepEqual([r.total, r.done, r.doneLate, r.overdue, r.open], [4, 2, 1, 1, 2]);
  const dept = Object.fromEntries(r.byDepartment.map(x => [x.department, [x.total, x.done, x.doneLate, x.overdue]]));
  assert.deepEqual(dept, { '': [2, 0, 0, 1], cleaning: [1, 1, 1, 0], guest_relations: [1, 1, 0, 0] });
  const dan = r.byPerson.find(x => x.fullName === 'Dan'), alex = r.byPerson.find(x => x.fullName === 'Alex');
  assert.deepEqual([dan.assigned, dan.done, dan.doneLate, dan.overdue], [1, 2, 1, 1]);
  assert.deepEqual([alex.assigned, alex.done], [1, 0]);
  assert.equal(R.departmentName(''), 'Given to a person');
  assert.match(R.todosCsv(r), /"Cleaning","1","1","1","0"/);
});

test('messages: received and sent per channel, week and month, and reply times', async () => {
  await as(ADMIN);
  const r = R.messagesReportSchema.parse(await report('messages'));
  const ch = Object.fromEntries(r.byChannel.map(x => [x.channel, [x.received, x.sent]]));
  assert.deepEqual(ch, { airbnb: [1, 1], client_email: [1, 2], owner_chat: [1, 1] }, 'the failed email and the message from 40 days ago are left out');
  const times = Object.fromEntries(r.replyTimes.map(x => [x.channel, [x.count, x.medianMinutes]]));
  assert.deepEqual(times.airbnb, [1, 20]);
  assert.deepEqual(times.owner_chat, [1, 90]);
  assert.deepEqual(times.client_email, [1, 30]);
  const months = R.receivedByMonth(r);
  assert.equal(months.reduce((n, m) => n + m.received, 0), 3, 'messages received per month: the AI cost input');
  assert.equal(r.byWeek.reduce((n, w) => n + w.received + w.sent, 0), 7);
  assert.equal(R.channelName('owner_chat'), 'Owner app chat');
  assert.equal(R.channelName('client_email'), 'Client emails');
  assert.equal(R.channelName('booking_com'), 'Booking.com');
  assert.match(R.messagesCsv(r), /Messages received per month/);
});

test('time worked: hours per person and department, with unpaid pauses taken off as the Productivity Tool does', async () => {
  await as(ADMIN);
  const r = R.timeReportSchema.parse(await report('time'));
  assert.deepEqual([r.minutes, r.unpaidMinutes, r.shifts, r.running], [540, 60, 2, 0], 'Dan: 8h less the unpaid lunch; the break is paid');
  const dan = r.byPerson.find(x => x.fullName === 'Dan');
  assert.deepEqual([dan.minutes, dan.unpaidMinutes, dan.shifts, dan.days], [420, 60, 1, 1]);
  assert.deepEqual(Object.fromEntries(r.byDepartment.map(x => [x.department, x.minutes])), { guest_relations: 420, management: 120 });
  // The same total as the Productivity Tool for the same dates.
  const productivity = (await db.query('select public.workspace_teams_read($1,$2,$3,null,null) r', ['productivity', FROM, TO])).rows[0].r;
  assert.equal(productivity.people.reduce((n, p) => n + p.minutes, 0), r.minutes);
  assert.match(R.timeCsv(r), /"Dan","Guest relations","7.00","1.00","0.00","1","1"/);
});

test('the migration runs twice without changing anything', async () => {
  const definition = async () => (await owner("select pg_get_functiondef('private.workspace_business_report(text,date,date)'::regprocedure) d"))[0].d;
  const before = await definition();
  await db.exec('reset role'); await db.exec(await fs.readFile(MIGRATION, 'utf8'));
  // The report analytics patch (20261023300000) sits on top of this function, so it is run again after it.
  await db.exec(await fs.readFile('supabase/migrations/20261023300000_report_analytics.sql', 'utf8'));
  assert.equal(await definition(), before);
  await as(ADMIN);
  assert.equal(R.todosReportSchema.parse(await report('todos')).total, 4);
});

test('report analytics (20261023300000): repairs, to-dos and time worked carry day-by-day figures that add up to the totals', async () => {
  await as(ADMIN);
  const sum = (rows, key) => rows.reduce((n, x) => n + x[key], 0);
  const inDates = rows => rows.every(x => x.day >= FROM && x.day <= TO);
  const repairs = R.repairsReportSchema.parse(await report('repairs'));
  assert.ok(repairs.byDay?.length && inDates(repairs.byDay));
  assert.equal(sum(repairs.byDay, 'raised'), repairs.raised); assert.equal(sum(repairs.byDay, 'completed'), repairs.completed);
  const todos = R.todosReportSchema.parse(await report('todos'));
  assert.ok(todos.byDay?.length && inDates(todos.byDay));
  assert.equal(sum(todos.byDay, 'total'), todos.total - 1, 'the to-do with no due day is left out of byDay only');
  assert.equal(sum(todos.byDay, 'done'), todos.done); assert.equal(sum(todos.byDay, 'overdue'), todos.overdue);
  const time = R.timeReportSchema.parse(await report('time'));
  assert.ok(time.byDay?.length && inDates(time.byDay));
  assert.equal(sum(time.byDay, 'shifts'), time.shifts);
  assert.ok(Math.abs(sum(time.byDay, 'minutes') - time.minutes) <= time.byDay.length, 'minutes agree to the rounding of each day');
  // Still management only.
  await as(DAN); await assert.rejects(db.query('select public.workspace_business_report($1,$2,$3)', ['todos', FROM, TO]), /Management access required/);
});
