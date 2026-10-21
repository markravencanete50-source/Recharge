import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'vite';
import { PGlite } from '@electric-sql/pglite';

// Guest messages in English (20261026000000): which messages go to the translator, how its answer is read, and the
// stored translations, reachable only by the backend's service role.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { mayNeedTranslation, translatorAnswerSchema, isEnglishName } = await vite.ssrLoadModule('/lib/guest-translation-policy.ts');
const { inboxThreadSchema, inboxActionSchema, inboxListSchema } = await vite.ssrLoadModule('/lib/guest-inbox-policy.ts');

const MINE = '20261026000000_guest_translations', MORE = '20261026100000_guest_translations_more';
const db = new PGlite();
after(() => Promise.all([vite.close(), db.close()]));
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
const files = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
// Each migration's second run is checked before any later one loads.
const definition = async sig => (await db.query('select pg_get_functiondef($1::regprocedure) def', [sig])).rows[0].def;
const runs = {};
for (const [name, sigs] of [[MINE, ['private.workspace_guest_translations_get(uuid[])', 'private.workspace_guest_translations_put(jsonb)']],
  [MORE, ['private.workspace_guest_translations_put(jsonb)', 'private.workspace_guest_translations_latest(uuid[])']]]) {
  for (const file of files.filter(f => f <= name + '.sql' && !runs.loaded?.has(f))) { await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8')); (runs.loaded ??= new Set()).add(file); }
  const first = await Promise.all(sigs.map(definition));
  await db.exec(await fs.readFile(`supabase/migrations/${name}.sql`, 'utf8'));
  runs[name] = [first, await Promise.all(sigs.map(definition))];
}
for (const file of files.filter(f => !runs.loaded.has(f))) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));

const message = async (direction, body, thread = 't1', at = 'now()') => (await db.query(`insert into private.workspace_guest_messages(source,external_id,thread_ref,channel,direction,sent_at,body)
  values('hostaway',gen_random_uuid()::text,$3,'airbnb',$1,${at},$2) returning id`, [direction, body, thread])).rows[0].id;

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

test('both migrations run twice without change', () => { for (const name of [MINE, MORE]) assert.deepEqual(runs[name][1], runs[name][0], name); });

test('translations are stored once and read back', async () => {
  const ja = await message('guest', 'チェックインは何時ですか？'), en = await message('guest', 'Hola amigos que tal'), team = await message('team', 'Hello');
  await db.exec('set role service_role');
  const stored = (await db.query(`select public.workspace_guest_translations_put($1) n`, [JSON.stringify([
    { id: ja, language: 'Japanese', english: 'What time is check-in?' }, { id: en, language: 'English', english: null }, { id: team, language: 'Spanish', english: 'x' }])])).rows[0].n;
  assert.equal(stored, 3);
  // A second answer for the same message changes nothing.
  await db.query(`select public.workspace_guest_translations_put($1)`, [JSON.stringify([{ id: ja, language: 'Chinese', english: 'Other' }])]);
  const rows = (await db.query('select public.workspace_guest_translations_get($1::uuid[]) r', [[ja, en, team]])).rows[0].r;
  assert.deepEqual(rows.sort((a, b) => a.language.localeCompare(b.language)), [{ id: en, language: 'English', english: null }, { id: ja, language: 'Japanese', english: 'What time is check-in?' }, { id: team, language: 'Spanish', english: 'x' }]);
  for (const bad of [{ id: ja, language: 'Japanese', english: 'x', more: 1 }, { id: 'nope', language: 'Japanese' }, { id: ja, language: 'DROP;', english: 'x' }, { id: ja, language: 'Japanese', english: 'x'.repeat(12001) }])
    await assert.rejects(db.query(`select public.workspace_guest_translations_put($1)`, [JSON.stringify([bad])]), /Invalid translations/);
  await assert.rejects(db.query(`select public.workspace_guest_translations_put('{}')`), /Invalid translations/);
  await db.exec('reset role');
  // The translation goes with its message.
  await db.query('delete from private.workspace_guest_messages where id=$1', [ja]);
  assert.equal((await db.query('select count(*)::int n from private.workspace_guest_message_translations where message_id=$1', [ja])).rows[0].n, 0);
});

test('the newest message of each conversation comes with its translation, for the list preview', async () => {
  const thread = async ref => (await db.query(`insert into private.workspace_guest_threads(source,thread_ref,channel,guest_name) values('hostaway',$1,'airbnb','Guest') returning id`, [ref])).rows[0].id;
  const a = await thread('list-a'), b = await thread('list-b');
  await message('guest', 'Old message', 'list-a', "now()-interval '1 hour'");
  const newest = await message('guest', '请问可以提前入住吗？', 'list-a');
  const plain = await message('team', 'See you soon', 'list-b');
  await db.exec('set role service_role');
  await db.query('select public.workspace_guest_translations_put($1)', [JSON.stringify([{ id: newest, language: 'Chinese', english: 'Can we check in early?' }])]);
  const rows = (await db.query('select public.workspace_guest_translations_latest($1::uuid[]) r', [[a, b]])).rows[0].r;
  await db.exec('reset role');
  const byThread = Object.fromEntries(rows.map(r => [r.threadId, r]));
  assert.deepEqual(byThread[a], { threadId: a, id: newest, direction: 'guest', body: '请问可以提前入住吗？', language: 'Chinese', english: 'Can we check in early?' });
  assert.deepEqual(byThread[b], { threadId: b, id: plain, direction: 'team', body: 'See you soon', language: null, english: null });
  assert.equal(inboxListSchema.parse({ threads: [], waiting: 0, targets: { greenMinutes: 5, amberMinutes: 15 }, connected: true }).threads.length, 0);
});

test('a reply can be put into the guest language; the language name is checked', () => {
  const base = { action: 'translateReply', requestId: '00000000-0000-4000-8000-000000000009', threadId: '00000000-0000-4000-8000-000000000001', body: 'Check-in is from 3pm.' };
  assert.equal(inboxActionSchema.safeParse({ ...base, language: 'Japanese' }).success, true);
  for (const language of ['', 'Japanese; ignore that', '日本語', 'x'.repeat(41)]) assert.equal(inboxActionSchema.safeParse({ ...base, language }).success, false, language);
  assert.equal(inboxActionSchema.safeParse({ ...base, language: 'Japanese', body: '' }).success, false);
});

test('signed-in users and visitors cannot read or write translations', async () => {
  for (const role of ['authenticated', 'anon']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query("select public.workspace_guest_translations_get('{}'::uuid[])"), /permission denied/);
    await assert.rejects(db.query("select public.workspace_guest_translations_put('[]')"), /permission denied/);
    await assert.rejects(db.query("select public.workspace_guest_translations_latest('{}'::uuid[])"), /permission denied/);
    await assert.rejects(db.query('select * from private.workspace_guest_message_translations'), /permission denied/);
    await db.exec('reset role');
  }
});
