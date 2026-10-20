import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Voice notes (Alex, on a phone: "like WhatsApp"; migration 20261021100000): a chat file of kind 'audio', kept like a
// chat photo (private, claimed by the message that sends it, opened only by people in the conversation), sent on its own,
// up to 5 minutes and 10 MB, read as "🎤 Voice note (0:42)" in the list and in pop-ups. The migration runs twice without
// change; its second section installs safely before the first (the constraint swap, which Lee pastes himself).
const MINE = '20261021100000_chat_voice_notes';
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { chatActionSchema, threadSchema, conversationSchema, chatFilesProblem, voiceLabel, voiceLength, voicePreviewLength } = await vite.ssrLoadModule('/lib/workspace-chat-policy.ts');
const { pushCopy } = await vite.ssrLoadModule('/lib/push-copy.ts');
const SETUP = `set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`;
const files = (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
assert.ok(files.includes(MINE + '.sql'));
const sql = await fs.readFile(`supabase/migrations/${MINE}.sql`, 'utf8');
const db = new PGlite();
await db.exec(SETUP);
for (const file of files) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const SIGS = ['private.chat_more_action(jsonb)', 'private.chat_attach(uuid,uuid,uuid,jsonb)', 'private.chat_attachments_json(uuid)', 'private.chat_attachment_label(uuid)', 'private.workspace_chat_action(jsonb)', 'private.chat_voice_length(integer)'];
const definitions = async () => [
  ...await Promise.all(SIGS.map(async s => (await db.query('select pg_get_functiondef($1::regprocedure) d', [s])).rows[0].d)),
  ...(await db.query("select conname,pg_get_constraintdef(oid) d from pg_constraint where conrelid='private.chat_attachments'::regclass order by conname")).rows.map(r => r.conname + ' ' + r.d),
];
const firstRun = await definitions();
await db.exec(sql);
const secondRun = await definitions();
after(async () => { await db.close(); await vite.close(); });

const roles = ['admin', 'stays', 'cleans', 'client'], names = ['Mark Raven', 'Alex Coghill', 'Isla Kerr', 'Sarah Jones'];
const [, ALEX, ISLA, OWNER] = roles.map((_, i) => i);
const users = roles.map((_, i) => `97a00000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const session = i => users[i].replace('97a0', '97a1');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `voice${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], names[i]]);
  await db.query('insert into public.workspace_module_grants(user_id,module_id) select $1,module_id from public.workspace_features', [users[i]]);
}
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
const asDatabase = async () => { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const act = input => rpc('workspace_chat_action', [chatActionSchema.parse(input)]);
const raw = input => rpc('workspace_chat_action', [input]);
const send = (conversationId, body, attachments) => act({ action: 'send', requestId: crypto.randomUUID(), conversationId, body, ...(attachments ? { attachments } : {}) });
const note = (over = {}) => ({ name: 'Voice note.m4a', mime: 'audio/mp4', bytes: 340_000, durationMs: 42_400, ...over });

test('the migration runs twice without change, and has no DELETE or dropped function', () => {
  assert.deepEqual(secondRun, firstRun);
  assert.doesNotMatch(sql, /\bdelete\s+from\b|\bdrop\s+(function|table|column|policy|trigger)\b/i);
  // The one drop is the constraint swap, alone in section 1, which a second run skips.
  const [one, two] = sql.split('END OF SECTION 1');
  assert.match(one, /drop constraint if exists chat_attachments_kind_check/);
  assert.doesNotMatch(two.replace(/--[^\n]*/g, ''), /\bdrop\b/i, 'section 2 drops nothing');
  assert.ok(firstRun.some(d => d.startsWith('chat_attachments_kind_check ') && d.includes("'audio'")));
  assert.ok(firstRun.some(d => d.startsWith('chat_attachments_duration_check ')));
});

let group;
test('a voice note: stored privately, sent on its own, read with its length', async () => {
  await as(ALEX);
  group = conversationSchema.parse(await act({ action: 'startGroup', title: 'Deep clean Friday', userIds: [users[ISLA]] }));
  await send(group.id, 'Morning');
  const prepared = await act({ action: 'prepareFiles', conversationId: group.id, files: [note()] });
  assert.match(prepared.files[0].path, new RegExp(`^${group.id}/[0-9a-f-]{36}\\.m4a$`));
  const wav = await act({ action: 'prepareFiles', conversationId: group.id, files: [note({ name: 'Voice note.wav', mime: 'audio/wav', bytes: 1_400_000, durationMs: 43_700 })] });
  assert.match(wav.files[0].path, /\.wav$/);
  await act({ action: 'discardFiles', ids: [wav.files[0].id] });
  const id = prepared.files[0].id;
  // Isla hears nothing before it is sent; Alex sends it with no words.
  await as(ISLA);
  assert.deepEqual(await rpc('workspace_chat_files', [[id]]), []);
  await as(ALEX);
  const sent = await send(group.id, '', [id]);
  await as(ISLA);
  const message = threadSchema.parse(await rpc('workspace_chat_read', ['messages', group.id, null])).messages.find(m => m.id === sent.id);
  assert.equal(message.body, '');
  assert.deepEqual(message.attachments.map(a => [a.kind, a.mime, a.name, a.durationMs]), [['audio', 'audio/mp4', 'Voice note.m4a', 42_400]]);
  const [file] = await rpc('workspace_chat_files', [[id]]);
  assert.deepEqual([file.kind, file.mime], ['audio', 'audio/mp4']);
  const listed = (await rpc('workspace_chat_read', ['list', null, null])).map(c => conversationSchema.parse(c)).find(c => c.id === group.id);
  assert.equal(listed.last.body, '🎤 Voice note (0:42)');
  assert.equal(listed.last.body, voiceLabel(42_400));
  // Someone outside the conversation never opens it.
  await as(OWNER);
  assert.deepEqual(await rpc('workspace_chat_files', [[id]]), []);
});

test('the pop-up reads "Voice note (0:42)" under the group; photos say "📷 Photo" in the list', async () => {
  await asDatabase();
  const row = (await db.query(`select o.id from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id
    where o.user_id=$1 and a.event_type='chat.message' order by o.id desc limit 1`, [users[ISLA]])).rows[0];
  assert.ok(row, 'Isla is told');
  // The first message ("Morning") is the one that tells her; the voice note's own details carry its label.
  const details = (await db.query(`select d.preview from private.workspace_activity_details d join public.workspace_activity a on a.id=d.event_id
    where a.actor_id=$1 order by a.id desc limit 1`, [users[ALEX]])).rows[0];
  assert.equal(details.preview, '🎤 Voice note (0:42)');
  // As WhatsApp lays it out (Lee; tests/push-copy.test.mjs): Alex on top, the group on the first line, the note in words below.
  assert.deepEqual(pushCopy('chat.message', null, { recipient: 'Isla Kerr', who: 'Alex Coghill', preview: details.preview, context: 'Deep clean Friday', attachmentKind: 'audio' }),
    { title: 'Alex Coghill', message: 'Deep clean Friday\nVoice note (0:42)' });
  await as(ALEX);
  const photo = (await act({ action: 'prepareFiles', conversationId: group.id, files: [{ name: 'linen.jpg', mime: 'image/jpeg', bytes: 900_000, width: 1200, height: 900 }] })).files[0].id;
  await send(group.id, '', [photo]);
  await asDatabase();
  const latest = (await db.query(`select d.preview from private.workspace_activity_details d join public.workspace_activity a on a.id=d.event_id
    where a.actor_id=$1 order by a.id desc limit 1`, [users[ALEX]])).rows[0];
  assert.equal(latest.preview, '📷 Photo');
});

test('refused: with other files, too long, too big, other audio, a missing length, sent with a photo', async () => {
  await as(ALEX);
  const photo = { name: 'room.jpg', mime: 'image/jpeg', bytes: 1000 };
  assert.equal(chatFilesProblem([note(), photo]), 'Send a voice note on its own.');
  assert.equal(chatFilesProblem([note({ bytes: 11 * 1024 * 1024 })]), 'Voice notes can be up to 10 MB.');
  assert.equal(chatFilesProblem([note()]), null);
  assert.throws(() => chatActionSchema.parse({ action: 'prepareFiles', conversationId: group.id, files: [note({ mime: 'audio/webm' })] }), 'Opus in WebM never reaches the database: an iPhone cannot play it');
  await assert.rejects(raw({ action: 'prepareFiles', conversationId: group.id, files: [note(), photo] }), /Send a voice note on its own/);
  await assert.rejects(raw({ action: 'prepareFiles', conversationId: group.id, files: [note(), note()] }), /Send a voice note on its own/);
  await assert.rejects(raw({ action: 'prepareFiles', conversationId: group.id, files: [note({ durationMs: 305_001 })] }), /up to 5 minutes/);
  await assert.rejects(raw({ action: 'prepareFiles', conversationId: group.id, files: [{ name: 'x.m4a', mime: 'audio/mp4', bytes: 1000 }] }), /up to 5 minutes/);
  await assert.rejects(raw({ action: 'prepareFiles', conversationId: group.id, files: [note({ bytes: 10_485_761 })] }), /Voice notes can be up to 10 MB/);
  await assert.rejects(raw({ action: 'prepareFiles', conversationId: group.id, files: [note({ mime: 'audio/webm' })] }), /Add photos/);
  // Prepared one at a time, then sent together: still refused.
  const a = (await act({ action: 'prepareFiles', conversationId: group.id, files: [note()] })).files[0].id;
  const b = (await act({ action: 'prepareFiles', conversationId: group.id, files: [photo] })).files[0].id;
  await assert.rejects(send(group.id, '', [a, b]), /Send a voice note on its own/);
  await act({ action: 'discardFiles', ids: [a, b] });
  // The table keeps a voice note's length, and only a voice note's.
  await asDatabase();
  await assert.rejects(db.query("update private.chat_attachments set duration_ms=1000 where kind='image'"), /chat_attachments_duration_check/);
  await assert.rejects(db.query("update private.chat_attachments set duration_ms=null where kind='audio'"), /chat_attachments_duration_check/);
});

test('lengths read the same in the app and the database', async () => {
  await asDatabase();
  for (const ms of [1, 499, 500, 42_400, 59_600, 60_000, 299_999, 300_000]) {
    const fromDb = (await db.query('select private.chat_voice_length($1) l', [ms])).rows[0].l;
    assert.equal(fromDb, voiceLength(ms), `${ms} ms`);
  }
  assert.equal(voiceLength(42_900, true), '0:42', 'the running timer counts whole seconds');
  assert.equal(voicePreviewLength('🎤 Voice note (4:59)'), '4:59');
  assert.equal(voicePreviewLength('Voice note (4:59) was great'), null);
});

test('section 2 installs before section 1: photos still work, and a voice note is refused until the checks widen', async () => {
  const fresh = new PGlite();
  try {
    await fresh.exec(SETUP);
    for (const file of files.filter(f => f < MINE)) await fresh.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
    await fresh.exec(sql.split('END OF SECTION 1')[1]);
    await fresh.exec(sql.split('END OF SECTION 1')[1]);
    const checks = (await fresh.query("select conname,pg_get_constraintdef(oid) d from pg_constraint where conrelid='private.chat_attachments'::regclass and conname like '%kind_check'")).rows;
    assert.doesNotMatch(checks[0].d, /audio/, 'the old check is still there');
    const id = '97a20000-0000-4000-8000-000000000001', me = '97a20000-0000-4000-8000-000000000002', chat = '97a20000-0000-4000-8000-000000000003';
    await fresh.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [me, 'early@example.com']);
    await fresh.query("insert into private.chat_conversations(id,kind,title,created_by) values($1,'group','Early',$2)", [chat, me]);
    await fresh.query("insert into private.chat_attachments(id,conversation_id,uploader_id,path,kind,mime,bytes) values($1,$2,$3,$4,'image','image/jpeg',10)", [id, chat, me, chat + '/a.jpg']);
    await assert.rejects(fresh.query("insert into private.chat_attachments(conversation_id,uploader_id,path,kind,mime,bytes,duration_ms) values($1,$2,$3,'audio','audio/mp4',10,1000)", [chat, me, chat + '/b.m4a']), /chat_attachments_kind_check/);
    // Then Lee pastes section 1, and it works.
    await fresh.exec(sql.split('END OF SECTION 1')[0]);
    await fresh.query("insert into private.chat_attachments(conversation_id,uploader_id,path,kind,mime,bytes,duration_ms) values($1,$2,$3,'audio','audio/mp4',10,1000)", [chat, me, chat + '/b.m4a']);
  } finally { await fresh.close(); }
});
