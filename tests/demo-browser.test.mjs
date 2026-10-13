import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { DEMO_JOBS } from '../scripts/demo/browser/jobs.mjs';
import { shiftDatabaseDates } from '../scripts/demo/browser/dates.mjs';
import { fakeServiceResponse } from '../scripts/demo/browser/services.mjs';

// The interactive demo (scripts/demo/browser): its backend runs in the viewer's browser on a private
// copy of the sample business. These check the parts that don't need a browser; the browser itself is
// tried by tests/demo-browser-e2e.test.mjs.

test("'Run today's automatic jobs' runs every sweep the backend's schedule runs", () => {
  const worker = readFileSync('worker/index.ts', 'utf8');
  const scheduled = worker.slice(worker.indexOf('async scheduled('), worker.indexOf('async fetch('));
  const sweeps = [...scheduled.matchAll(/securityRpc\('([a-z_]+)'/g)].map(m => m[1]);
  assert.ok(sweeps.length >= 8, 'found the schedule');
  assert.deepEqual(DEMO_JOBS.map(j => j.rpc).filter(name => sweeps.includes(name)), sweeps, 'same sweeps, same order');
  assert.deepEqual(DEMO_JOBS.map(j => j.rpc).filter(name => !sweeps.includes(name)), [], 'nothing the schedule does not run');
});

test('dates move to today everywhere, including text and JSON, without unique dates colliding', async () => {
  const db = new PGlite();
  await db.exec(`create schema private;
    create table public.days(id int primary key, day date unique, at timestamptz, note text, month text, data jsonb);
    create table private.stays(id int primary key, nights daterange, arrive date, label text);
    create function public.touch() returns trigger language plpgsql as $$ begin raise exception 'triggers stay off'; end $$;
    create trigger touch before update on public.days for each row execute function public.touch();
    insert into public.days values (1, '2026-10-10', '2026-10-10 09:30+01', 'Clean at 12 High St', '2026-10', '{"checkIn":"2026-10-11","list":["2026-10-09T08:00:00Z",3],"name":"Flat 2","period":"2026-09"}'),
      (2, '2026-10-11', '2026-10-11 18:00+01', '2026-10-12', null, null), (3, '2026-10-12', null, null, null, '[]');
    insert into private.stays values (1, null, '2026-10-20', 'Arrives 2026-10-20');`);
  await shiftDatabaseDates(db, 1);
  const rows = (await db.query(`select id, day::text, to_char(at at time zone 'Europe/London', 'YYYY-MM-DD HH24:MI') at, note, month, data from public.days order by id`)).rows;
  assert.deepEqual(rows.map(r => r.day), ['2026-10-11', '2026-10-12', '2026-10-13']);
  assert.equal(rows[0].at, '2026-10-11 09:30', 'same time of day');
  assert.equal(rows[0].note, 'Clean at 12 High St');
  assert.equal(rows[1].note, '2026-10-13');
  assert.equal(rows[0].month, '2026-10');
  assert.deepEqual(rows[0].data, { checkIn: '2026-10-12', list: ['2026-10-10T08:00:00Z', 3], name: 'Flat 2', period: '2026-09' });
  assert.deepEqual(rows[2].data, []);
  assert.equal((await db.query(`select arrive::text from private.stays`)).rows[0].arrive, '2026-10-21');
  await shiftDatabaseDates(db, -31);
  assert.equal((await db.query(`select day::text from public.days where id = 1`)).rows[0].day, '2026-09-10');
  assert.equal((await db.query(`select month from public.days where id = 1`)).rows[0].month, '2026-09');
  await db.close();
});

test('outside services are answered inside the demo, with a note of what would have been sent', async () => {
  const email = await fakeServiceResponse(new URL('https://api.resend.com/emails'), 'POST', JSON.stringify({ to: ['ann@example.com'], subject: 'Your property enquiry' }));
  assert.match((await email.response.json()).id, /^demo-/);
  assert.equal(email.note, 'In demo, this email would be sent to ann@example.com: “Your property enquiry”.');
  const push = await fakeServiceResponse(new URL('https://exp.host/--/api/v2/push/send'), 'POST', JSON.stringify({ to: 'ExponentPushToken[x]', body: 'A clean was assigned to you' }));
  assert.equal((await push.response.json()).data.status, 'ok');
  assert.match(push.note, /phone notification/);
  const token = await fakeServiceResponse(new URL('https://api.hostaway.com/v1/accessTokens'), 'POST', 'grant_type=client_credentials');
  assert.equal(token.note, undefined);
  const reply = await fakeServiceResponse(new URL('https://api.hostaway.com/v1/conversations/77/messages'), 'POST', '{"body":"Hello"}');
  assert.equal((await reply.response.json()).status, 'success');
  assert.equal(reply.note, 'In demo, this message would be sent to the guest through Hostaway.');
  assert.equal(await fakeServiceResponse(new URL('https://api.cloudinary.com/v1_1/x/image/upload'), 'POST', ''), null);
  assert.equal(await fakeServiceResponse(new URL('https://example.com/api/workspace'), 'GET'), null);
});

test('the demo engine refuses every other address, and the app sends nothing live while in demo', () => {
  const engine = readFileSync('scripts/demo/browser/engine.mjs', 'utf8');
  assert.match(engine, /throw new TypeError\(`Blocked in demo/);
  assert.match(engine, /backendRouteAllowed\(url\.pathname\)/, 'the Worker allowlist is applied');
  const client = readFileSync('mobile/src/backend/client.ts', 'utf8');
  const request = client.slice(client.indexOf('export async function workspaceRequest'), client.indexOf('export async function signOut'));
  assert.ok(request.indexOf('if (demo) return await demoResponse') < request.indexOf('call('), 'demo is answered before any live call');
  for (const name of ['readNotificationKey', 'writeNotifications']) assert.match(client, new RegExp(`export const ${name} = async[^\\n]*demo( \\|\\| demoResume)? \\?`), name + ' stays local in demo');
});
