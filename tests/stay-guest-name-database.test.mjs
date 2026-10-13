import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// The guest's name on a calendar stay comes only from the conversation carrying the stay's booking code. Before migration
// 20261014330000 a conversation on exactly the same property and dates could name the stay, so a Hostaway enquiry from someone
// who never booked put their name on a direct stay. Every migration is applied in order; this one again to prove it is repeatable.
const MINE = '20261014330000_stay_guest_name_dates';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const files = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
assert.ok(files.includes(MINE + '.sql'), 'the migration exists');
for (const file of files) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const definition = async () => (await db.query("select pg_get_functiondef('private.workspace_stay_guest_name(uuid)'::regprocedure) def")).rows[0].def;
const firstRun = await definition();
await db.exec(await fs.readFile(`supabase/migrations/${MINE}.sql`, 'utf8'));
const secondRun = await definition();
after(() => db.close());

const ADMIN = '97900000-0000-4000-8000-000000000001', STAYS = '97900000-0000-4000-8000-000000000002';
for (const [id, role] of [[ADMIN, 'admin'], [STAYS, 'stays']]) {
  const session = id.replace('9790', '9791');
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [id, id.slice(-3) + '@example.com']);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session, id]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session, id]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [id, role, 'Person ' + role]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [id]);
}
const asUser = async id => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: id, session_id: id.replace('9790', '9791') })]); await db.exec('set role authenticated'); };
const asDatabase = async () => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); };
const rpc = async (name, args) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
await asUser(ADMIN);
const property = await rpc('workspace_save_property', [{ requestId: crypto.randomUUID(), name: 'Name flat', address: 'Example name address', region: 'Edinburgh', bedrooms: 2 }]);
await db.query('select public.workspace_assign_property($1,$2,$3)', [property, STAYS, 'staff']);
await asDatabase();

const iso = offset => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
let n = 0;
const stay = async (checkIn, checkOut, { channel = 'direct', code = null, reference = 'Stay ' + (++n) } = {}) =>
  (await db.query(`insert into private.workspace_reservations(property_id,reference,check_in,check_out,status,source,channel,channel_reference,guests,created_by)
    values($1,$2,$3,$4,'confirmed','manual',$5,$6,2,$7) returning id`, [property, reference, checkIn, checkOut, channel, code, ADMIN])).rows[0].id;
const thread = (source, guestName, { ref = null, checkIn = null, checkOut = null, channel = 'airbnb' } = {}) =>
  db.query(`insert into private.workspace_guest_threads(source,thread_ref,property_id,channel,guest_name,reservation_ref,check_in,check_out,last_message_at)
    values($1,$2,$3,$4,$5,$6,$7,$8,now())`, [source, crypto.randomUUID(), property, channel, guestName, ref, checkIn, checkOut]);
const nameOf = async id => (await db.query('select private.workspace_stay_guest_name($1) name', [id])).rows[0].name;
const onCalendar = async id => { await asUser(STAYS); const s = (await rpc('workspace_teams_read', ['schedule', iso(-2), iso(40), null, null])).stays.find(x => x.reservationId === id); await asDatabase(); return s?.guestName ?? null; };

test('the migration runs twice without change', () => assert.equal(secondRun, firstRun));

test('the bug: an enquiry on exactly the same dates no longer names a direct stay', async () => {
  const direct = await stay(iso(3), iso(6));
  // A Hostaway enquiry: its reservation is not one of our stays, so the import gave it dates but no booking code.
  await thread('hostaway', 'Ivy Enquirer', { checkIn: iso(3), checkOut: iso(6), channel: 'direct' });
  assert.equal(await nameOf(direct), null);
  assert.equal(await onCalendar(direct), null, 'the calendar shows "Guest stay", not the enquirer');
});

test('the conversation carrying the stay\'s code still names it, whatever its dates', async () => {
  const booked = await stay(iso(8), iso(10), { channel: 'airbnb', code: 'airbnb-confirmation-HMCODE77' });
  await thread('hostaway', 'Wrong Dates Wendy', { checkIn: iso(8), checkOut: iso(10) });
  await thread('hostaway', 'Code Carl', { ref: 'HMCODE77', checkIn: iso(20), checkOut: iso(22) });
  assert.equal(await nameOf(booked), 'Code Carl');
  assert.equal(await onCalendar(booked), 'Code Carl');
  // A stay entered by hand is named once a conversation is matched to it by the stay's own reference (Edit in the guest inbox).
  const byHand = await stay(iso(12), iso(14), { reference: 'Direct Dec 12' });
  await thread('manual', 'Hand Hannah', { channel: 'email' });
  assert.equal(await nameOf(byHand), null, 'a conversation not matched to the stay gives no name');
  await thread('manual', 'Matched Max', { ref: 'direct dec 12', channel: 'email' });
  assert.equal(await nameOf(byHand), 'Matched Max');
});
