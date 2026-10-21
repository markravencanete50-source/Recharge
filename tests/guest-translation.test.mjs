import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'vite';
import { PGlite } from '@electric-sql/pglite';

// Guest messages in English (20261026000000): which messages go to the translator, how its answer is read, and the
// stored translations, reachable only by the backend's service role.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { mayNeedTranslation, translatorAnswerSchema, isEnglishName } = await vite.ssrLoadModule('/lib/guest-translation-policy.ts');
const { inboxThreadSchema } = await vite.ssrLoadModule('/lib/guest-inbox-policy.ts');

const MINE = '20261026000000_guest_translations';
const db = new PGlite();
after(() => Promise.all([vite.close(), db.close()]));
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const files = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
for (const file of files) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const SIGS = ['private.workspace_guest_translations_get(uuid[])', 'private.workspace_guest_translations_put(jsonb)'];
const definition = async sig => (await db.query('select pg_get_functiondef($1::regprocedure) def', [sig])).rows[0].def;
const firstRun = await Promise.all(SIGS.map(definition));
await db.exec(await fs.readFile(`supabase/migrations/${MINE}.sql`, 'utf8'));
const secondRun = await Promise.all(SIGS.map(definition));

const message = async (direction, body) => (await db.query(`insert into private.workspace_guest_messages(source,external_id,thread_ref,channel,direction,sent_at,body)
  values('hostaway',gen_random_uuid()::text,'t1','airbnb',$1,now(),$2) returning id`, [direction, body])).rows[0].id;

test('Japanese, Chinese and other languages go to the translator; plain English does not', () => {
  for (const text of ['チェックインは何時ですか？', '请问可以提前入住吗？', '안녕하세요, 체크인 시간이 궁금합니다', 'Здравствуйте, во сколько заезд?',
    'Hola, llegaremos sobre las tres de la tarde', 'Bonjour, est-ce que le parking est gratuit ?', 'Guten Abend, wo finden wir den Schlüssel bitte'])
    assert.equal(mayNeedTranslation(text), true, text);
  for (const text of ['Hi, what time can we check in?', 'Thank you so much for a lovely stay!', 'Where is the key safe?', 'ok', '👍', '', null, '12:30', 'Thanks!'])
    assert.equal(mayNeedTranslation(text), false, String(text));
  // A mostly English message with a Japanese name still goes, and the translator decides.
  assert.equal(mayNeedTranslation('Hi, this is 田中 arriving tomorrow'), true);
});

test('the translator answer is read safely', () => {
  assert.equal(translatorAnswerSchema.safeParse({ language: 'Japanese', english: 'What time is check-in?' }).success, true);
  assert.equal(translatorAnswerSchema.safeParse({ language: 'Japanese', english: 'x', extra: 1 }).success, true);
  for (const bad of [{ language: '<script>', english: 'x' }, { language: 'Japanese' }, 'text', null, { language: '', english: '' }])
    assert.equal(translatorAnswerSchema.safeParse(bad).success, false, JSON.stringify(bad));
  assert.equal(isEnglishName('English'), true);
  assert.equal(isEnglishName('english (UK)'), true);
  assert.equal(isEnglishName('Japanese'), false);
  // The app reads a message with or without a translation.
  const thread = { id: '00000000-0000-4000-8000-000000000001', source: 'hostaway', channel: 'airbnb', guestName: 'Aiko', propertyId: null, propertyName: null, reservationRef: null,
    checkIn: null, checkOut: null, status: 'open', lastMessageAt: null, preview: null, lastFrom: null, waitingSince: null, messages: 2 };
  const base = { direction: 'guest', body: 'チェックイン', sentAt: '2026-10-21T10:00:00Z', delivery: null, author: null };
  const parsed = inboxThreadSchema.parse({ thread, targets: { greenMinutes: 5, amberMinutes: 15 }, messages: [
    { ...base, id: '00000000-0000-4000-8000-000000000002', translation: { language: 'Japanese', english: 'Check-in' } }, { ...base, id: '00000000-0000-4000-8000-000000000003' }] });
  assert.equal(parsed.messages[0].translation.english, 'Check-in');
  assert.equal(parsed.messages[1].translation, undefined);
});

test('the migration runs twice without change', () => assert.deepEqual(secondRun, firstRun));

test('translations are stored once, for guest messages only, and read back', async () => {
  const ja = await message('guest', 'チェックインは何時ですか？'), en = await message('guest', 'Hola amigos que tal'), team = await message('team', 'Hello');
  await db.exec('set role service_role');
  const stored = (await db.query(`select public.workspace_guest_translations_put($1) n`, [JSON.stringify([
    { id: ja, language: 'Japanese', english: 'What time is check-in?' }, { id: en, language: 'English', english: null }, { id: team, language: 'Spanish', english: 'x' }])])).rows[0].n;
  assert.equal(stored, 2);
  // A second answer for the same message changes nothing.
  await db.query(`select public.workspace_guest_translations_put($1)`, [JSON.stringify([{ id: ja, language: 'Chinese', english: 'Other' }])]);
  const rows = (await db.query('select public.workspace_guest_translations_get($1::uuid[]) r', [[ja, en, team]])).rows[0].r;
  assert.deepEqual(rows.sort((a, b) => a.language.localeCompare(b.language)), [{ id: en, language: 'English', english: null }, { id: ja, language: 'Japanese', english: 'What time is check-in?' }]);
  for (const bad of [{ id: ja, language: 'Japanese', english: 'x', more: 1 }, { id: 'nope', language: 'Japanese' }, { id: ja, language: 'DROP;', english: 'x' }, { id: ja, language: 'Japanese', english: 'x'.repeat(12001) }])
    await assert.rejects(db.query(`select public.workspace_guest_translations_put($1)`, [JSON.stringify([bad])]), /Invalid translations/);
  await assert.rejects(db.query(`select public.workspace_guest_translations_put('{}')`), /Invalid translations/);
  await db.exec('reset role');
  // The translation goes with its message.
  await db.query('delete from private.workspace_guest_messages where id=$1', [ja]);
  assert.equal((await db.query('select count(*)::int n from private.workspace_guest_message_translations where message_id=$1', [ja])).rows[0].n, 0);
});

test('signed-in users and visitors cannot read or write translations', async () => {
  for (const role of ['authenticated', 'anon']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query("select public.workspace_guest_translations_get('{}'::uuid[])"), /permission denied/);
    await assert.rejects(db.query("select public.workspace_guest_translations_put('[]')"), /permission denied/);
    await assert.rejects(db.query('select * from private.workspace_guest_message_translations'), /permission denied/);
    await db.exec('reset role');
  }
});
