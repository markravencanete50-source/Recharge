import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// The calendar's payment runs (admins and accounts only), saved replies (used by the guest inbox
// team, kept by admins and Stays) and property team conversations (the team on a property, or on
// one job there).
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
after(() => db.close());

const roles = ['admin', 'stays', 'stays', 'cleans', 'cleaning_manager', 'ready', 'accounts', 'client', 'cleans', 'admin', 'ready'];
const users = roles.map((_, i) => `95100000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('9510', '9520');
const [ADMIN, STAYS, OTHER_STAYS, CLEANER, MANAGER, READY, ACCOUNTS, OWNER, OTHER_CLEANER, ASSIGNED_ADMIN, LATE_READY] = roles.map((_, i) => i);
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `calendar${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], 'Person ' + i]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
// Ready does not hold the guest inbox, so saved replies are not theirs.
await db.query("delete from public.workspace_module_grants where user_id=$1 and module_id='guest-communication'", [users[READY]]);

async function as(i) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
async function asDatabase() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); }
beforeEach(async () => { await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits'); });
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const chatRead = section => rpc('workspace_chat_read', [section, null, null]);
const chat = input => rpc('workspace_chat_action', [input]);
const schedule = (from, to, propertyId = null) => rpc('workspace_teams_read', ['schedule', from, to, propertyId, null]);
const operation = input => rpc('workspace_operations_action', [{ requestId: crypto.randomUUID(), ...input }]);
const members = async conversationId => { await asDatabase(); return (await db.query('select user_id from private.chat_members where conversation_id=$1 order by user_id', [conversationId])).rows.map(r => r.user_id); };

await as(ADMIN);
const property = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Calendar flat', address: 'Example calendar address', region: 'Edinburgh', bedrooms: 2 }]);
const otherProperty = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Other flat', address: 'Example other address', region: 'Glasgow', bedrooms: 1 }]);
for (const [who, kind] of [[STAYS, 'staff'], [CLEANER, 'cleaner'], [MANAGER, 'cleaning_manager'], [READY, 'staff'], [OWNER, 'client'], [OTHER_CLEANER, 'cleaner'], [ASSIGNED_ADMIN, 'staff']])
  await db.query('select public.workspace_assign_property($1,$2,$3)', [property, users[who], kind]);
await db.query('select public.workspace_assign_property($1,$2,$3)', [otherProperty, users[OTHER_STAYS], 'staff']);
const day = (await db.query("select current_date::text today,(date_trunc('month',current_date)::date-5)::text from_on,(current_date+5)::text to_on,date_trunc('month',current_date)::date::text first")).rows[0];

test('payment runs are on the calendar for admins and accounts only', async () => {
  await asDatabase();
  const statement = (months, status, extra = '') => db.query(`insert into private.workspace_owner_statements(property_id,period_start,status,revenue_minor,cleaning_count,cleaning_minor,expenses_minor,fee_bps,fee_minor,payout_minor,detail,prepared_by${extra ? ',' + extra.split('=')[0] : ''})
    values($1,(date_trunc('month',current_date)-interval '${months} months')::date,'${status}',100000,2,8000,0,1500,15000,77000,'{}',$2${extra ? ',' + extra.split('=')[1] : ''})`, [property, users[ADMIN]]);
  await statement(3, 'paid', "paid_at=now()");
  await statement(2, 'issued', "issued_at=now()-interval '1 day'");
  await statement(1, 'draft');
  await statement(4, 'void');
  for (const who of [ADMIN, ACCOUNTS]) {
    await as(who);
    const read = await schedule(day.from_on, day.to_on);
    assert.ok(Array.isArray(read.work) && Array.isArray(read.stays), 'the rest of the schedule is unchanged');
    const byStatus = Object.fromEntries(read.payments.map(x => [x.status, x]));
    assert.deepEqual(Object.keys(byStatus).sort(), ['draft', 'issued', 'paid'], 'void statements are left out');
    assert.equal(byStatus.paid.date, day.today);
    assert.equal(byStatus.draft.date, day.first, 'a draft is due on the first day after its month');
    assert.equal(byStatus.paid.propertyName, 'Calendar flat');
    assert.equal(byStatus.paid.payoutMinor, 77000);
    assert.deepEqual(await schedule(day.from_on, day.to_on, otherProperty).then(r => r.payments), [], 'the property filter applies');
  }
  for (const who of [OWNER, CLEANER, STAYS, MANAGER, READY]) {
    await as(who);
    assert.deepEqual((await schedule(day.from_on, day.to_on)).payments, [], roles[who] + ' sees no payment runs');
  }
});

test('saved replies: the guest inbox team uses them, admins and Stays keep them', async () => {
  await as(STAYS);
  assert.deepEqual(await chatRead('savedReplies'), { canEdit: true, replies: [] }, 'nothing is seeded');
  const reply = await chat({ action: 'saveReply', title: 'Wi-Fi details', body: 'Hi {guest}, the Wi-Fi details for {property} are in the welcome book.', audience: 'guest' });
  assert.equal(reply.version, 1);
  await assert.rejects(chat({ action: 'saveReply', title: 'x', body: 'Too short a title', audience: 'guest' }), /title of 2 to 80/);
  await assert.rejects(chat({ action: 'saveReply', title: 'Who for', body: 'Nobody in particular', audience: 'cleaners' }), /who the reply is for/);
  await assert.rejects(chat({ action: 'saveReply', title: 'Extra', body: 'With an extra field', audience: 'all', pinned: true }), /Unknown or oversized/);

  await as(ADMIN);
  const edited = await chat({ action: 'saveReply', replyId: reply.id, version: 1, title: 'Wi-Fi', body: reply.body, audience: 'all' });
  assert.deepEqual([edited.title, edited.audience, edited.version, edited.updatedBy], ['Wi-Fi', 'all', 2, 'Person 0']);
  await assert.rejects(chat({ action: 'saveReply', replyId: reply.id, version: 1, title: 'Old copy', body: reply.body, audience: 'all' }), /Someone else changed/);

  for (const who of [MANAGER, OTHER_STAYS]) {
    await as(who);
    const list = await chatRead('savedReplies');
    assert.deepEqual(list.replies.map(r => r.title), ['Wi-Fi'], roles[who] + ' with the guest inbox sees them');
    assert.equal(list.canEdit, who === OTHER_STAYS);
  }
  await as(MANAGER);
  await assert.rejects(chat({ action: 'saveReply', title: 'Manager reply', body: 'Not allowed to add this', audience: 'all' }), /Only admins and the Stays team/);
  await assert.rejects(chat({ action: 'deleteReply', replyId: reply.id, version: 2 }), /Only admins and the Stays team/);
  for (const who of [READY, CLEANER, OWNER]) {
    await as(who);
    await assert.rejects(chatRead('savedReplies'), /guest inbox team/, roles[who] + ' cannot read them');
    await assert.rejects(chat({ action: 'saveReply', title: 'Sneaky', body: 'Should not be saved', audience: 'all' }), /Only admins and the Stays team/);
  }
  await as(STAYS);
  await assert.rejects(db.query('select * from private.workspace_saved_replies'), /permission denied/);
  await assert.rejects(chat({ action: 'deleteReply', replyId: reply.id, version: 1 }), /Someone else changed/);
  assert.deepEqual(await chat({ action: 'deleteReply', replyId: reply.id, version: 2 }), { id: reply.id, deleted: true });
  await assert.rejects(chat({ action: 'deleteReply', replyId: reply.id, version: 2 }), /not found/);
  assert.deepEqual((await chatRead('savedReplies')).replies, []);
});

test('a property team conversation has the team on the property, and is found again', async () => {
  await as(STAYS);
  const conv = await chat({ action: 'startProperty', propertyId: property });
  assert.equal(conv.kind, 'group'); assert.equal(conv.title, 'Calendar flat team'); assert.equal(conv.propertyName, 'Calendar flat');
  // Stays, Ready and the cleaning manager; not cleaners, the owner or an admin assigned as staff.
  assert.deepEqual(await members(conv.id), [users[STAYS], users[MANAGER], users[READY]].sort());
  await as(READY);
  assert.ok((await chatRead('list')).some(c => c.id === conv.id), 'members see it in Messages');
  assert.equal((await chat({ action: 'startProperty', propertyId: property })).id, conv.id, 'the same conversation is reused');
  // Someone assigned later joins when it is opened again; the person who opens it always joins.
  await as(ADMIN);
  await db.query('select public.workspace_assign_property($1,$2,$3)', [property, users[LATE_READY], 'staff']);
  assert.equal((await chat({ action: 'startProperty', propertyId: property })).id, conv.id);
  assert.deepEqual(await members(conv.id), [users[ADMIN], users[STAYS], users[MANAGER], users[READY], users[LATE_READY]].sort());
  await as(CLEANER);
  assert.equal((await chat({ action: 'startProperty', propertyId: property })).id, conv.id);
  assert.ok((await members(conv.id)).includes(users[CLEANER]) && !(await members(conv.id)).includes(users[OTHER_CLEANER]), 'cleaners join only themselves');
  // People who do not work on the property cannot start or join it.
  for (const who of [OTHER_STAYS, OWNER, ACCOUNTS]) {
    await as(who);
    await assert.rejects(chat({ action: 'startProperty', propertyId: property }), /Property not found/, roles[who]);
  }
  await as(STAYS);
  await assert.rejects(chat({ action: 'startProperty', propertyId: property, extra: true }), /Unknown or oversized/);
});

test('a job has its own team conversation with the job’s assignee', async () => {
  await as(MANAGER);
  const clean = await operation({ action: 'createOperation', propertyId: property, kind: 'cleaning', data: { dueOn: day.today, checklist: ['Kitchen'] } });
  await rpc('workspace_assign_work', [clean.workId, clean.version, users[CLEANER]]);
  const job = await chat({ action: 'startProperty', propertyId: property, workId: clean.workId });
  assert.equal(job.workId, clean.workId);
  assert.match(job.title, /· Calendar flat$/);
  assert.notEqual(job.id, (await chat({ action: 'startProperty', propertyId: property })).id, 'separate from the property conversation');
  assert.deepEqual(await members(job.id), [users[STAYS], users[CLEANER], users[MANAGER], users[READY], users[LATE_READY]].sort());
  await as(CLEANER);
  assert.equal((await chat({ action: 'startProperty', propertyId: property, workId: clean.workId })).id, job.id);
  await assert.rejects(chat({ action: 'startProperty', propertyId: otherProperty, workId: clean.workId }), /Property not found/);
  await as(OTHER_CLEANER);
  await assert.rejects(chat({ action: 'startProperty', propertyId: property, workId: clean.workId }), /Job not found/, 'not their job');
  await as(ADMIN);
  await assert.rejects(chat({ action: 'startProperty', propertyId: otherProperty, workId: clean.workId }), /Job not found/, 'the job must be on that property');
});
