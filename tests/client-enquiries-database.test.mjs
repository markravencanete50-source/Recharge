import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// Client Enquiries: the team sends the property form, the landlord answers it through the site's
// server (service key, by the link's hash), and the team values the property from the answers.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { teamsActionSchema, teamsReadSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const { enquiryAnswersSchema, clientEnquiriesSchema, valuationDraft, enquiryStep, enquiryEmail, defaultBody } = await vite.ssrLoadModule('/lib/client-enquiry.ts');
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const roles = ['super_admin', 'admin', 'stays', 'stays', 'cleans', 'client', 'accounts'];
const users = roles.map((_, i) => `97700000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, STAYS, STAYS_NO_TOOL, CLEANER, OWNER, ACCOUNTS] = roles.map((_, i) => i);
const session = i => users[i].replace('9770', '9870');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `enq${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], ['Sam', 'Morag', 'Fiona', 'Callum', 'Isla', 'Owner', 'Graham'][i]]);
}
await db.query("insert into public.workspace_module_grants(user_id,module_id) values($1,'property-onboarding')", [users[STAYS]]);
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
// The site's server: no user, the service key.
async function asServer() { await db.exec('reset role'); await db.query("select set_config('request.jwt.claims','',false)"); await db.exec('set role service_role'); }
const owner = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const act = async input => rpc('workspace_teams_action', [teamsActionSchema.parse({ requestId: crypto.randomUUID(), ...input })]);
const read = () => { teamsReadSchema.parse({ section: 'clientEnquiries' }); return rpc('workspace_teams_read', ['clientEnquiries', null, null, null, null]); };
const hash = token => createHash('sha256').update(token).digest('hex');
const token = () => createHash('sha256').update(crypto.randomUUID()).digest('hex');
const pub = input => rpc('workspace_enquiry_public', [input]);
// The server adds the link's hash to the team's request (lib/client-enquiry-server.ts).
const invite = async (t, extra = {}) => { const input = teamsActionSchema.parse({ action: 'inviteEnquiry', requestId: crypto.randomUUID(), name: 'Alex Morgan', email: 'Alex@Example.com', subject: 'Your free estimate', body: defaultBody('Alex Morgan'), delivery: 'email', ...extra }); return rpc('workspace_teams_action', [{ ...input, tokenHash: hash(t) }]); };
const answers = enquiryAnswersSchema.parse({
  fullName: 'Alex Morgan', companyName: 'Morgan Lets Ltd', email: 'alex@example.com', phone: '07700 900123',
  propertyAddress: '12 Shore Road, Leith, Edinburgh EH6 6RG', propertyType: 'Flat', bedrooms: 2, wcs: 1, bathrooms: 1, parking: 'Free on-street', garden: 'Shared', mediaLink: 'https://photos.example.com/album',
  shortLet: 'no', furnishQuote: 'yes', compliance: 'yes', startWhen: 'Within a month', notes: 'Available from November', enquiryType: "I'd like a free performance estimate",
});
const notified = async (i, event) => (await owner('select count(*)::int n from private.workspace_notification_outbox o join public.workspace_activity a on a.id=o.event_id where o.user_id=$1 and a.event_type=$2', [users[i], event]))[0].n;
after(async () => { await db.close(); await vite.close(); });

test('only management and Stays with onboarding work with enquiries', async () => {
  for (const i of [CLEANER, OWNER, ACCOUNTS]) {
    await as(i);
    await assert.rejects(read(), /Client enquiries access required/, roles[i]);
    await assert.rejects(invite(token()), /Client enquiries access required/, roles[i]);
  }
  await as(STAYS_NO_TOOL);
  await assert.rejects(read(), /Client enquiries access required/, 'Stays without property onboarding');
  await as(STAYS);
  assert.equal(clientEnquiriesSchema.parse(await read()).canInvite, true);
  // Nobody signed in can use the landlord's side directly; only the site's server can.
  await as(ADMIN);
  await assert.rejects(pub({ action: 'open', tokenHash: hash(token()) }), /permission denied/);
});

test('send, open, upload, answer, value: the whole journey', async () => {
  const t = token();
  await as(ADMIN);
  const sent = await invite(t);
  assert.deepEqual([sent.status, sent.recipientEmail, sent.emailStatus, sent.sentByName], ['sent', 'alex@example.com', 'pending', 'Morag']);
  assert.equal(JSON.stringify(sent).includes(hash(t)), false, 'the link is never shown back');
  const marked = await act({ action: 'closeEnquiry', enquiryId: sent.id, version: sent.version, note: 'x' }).catch(e => e);
  assert.ok(marked instanceof Error, 'a reason of 3 or more characters is needed');

  await asServer();
  await assert.rejects(pub({ action: 'open', tokenHash: hash(token()) }), /not valid/);
  const opened = await pub({ action: 'open', tokenHash: hash(t) });
  assert.deepEqual([opened.state, opened.name, opened.id], ['open', 'Alex Morgan', sent.id]);
  await pub({ action: 'addFile', tokenHash: hash(t), file: { id: crypto.randomUUID(), path: `enquiries/${sent.id}/${crypto.randomUUID()}.jpg`, name: 'kitchen.jpg', mime: 'image/jpeg', bytes: 2048 } });
  await assert.rejects(pub({ action: 'addFile', tokenHash: hash(t), file: { id: crypto.randomUUID(), path: `enquiries/${crypto.randomUUID()}/${crypto.randomUUID()}.jpg`, name: 'x.jpg', mime: 'image/jpeg', bytes: 10 } }), /Invalid file/, 'only into its own folder');
  await assert.rejects(pub({ action: 'addFile', tokenHash: hash(t), file: { id: crypto.randomUUID(), path: `enquiries/${sent.id}/${crypto.randomUUID()}.exe`, name: 'x.exe', mime: 'application/x-msdownload', bytes: 10 } }), /Invalid file/);
  await assert.rejects(pub({ action: 'submit', tokenHash: hash(t), answers: { ...answers, shortLet: 'maybe' } }), /Check your answers/);
  await assert.rejects(pub({ action: 'submit', tokenHash: hash(t), answers: { ...answers, propertyAddress: ' ' } }), /marked with \*/);
  await assert.rejects(pub({ action: 'submit', tokenHash: hash(t), answers: { ...answers, admin: true } }), /./, 'no extra answers');
  assert.deepEqual(await pub({ action: 'submit', tokenHash: hash(t), answers }), { state: 'answered' });
  await assert.rejects(pub({ action: 'submit', tokenHash: hash(t), answers }), /already been sent/, 'it works once');
  assert.equal((await pub({ action: 'open', tokenHash: hash(t) })).state, 'answered');
  assert.equal(await notified(ADMIN, 'enquiry.received'), 1, 'the sender hears it is back');
  assert.equal(await notified(SUPER, 'enquiry.received'), 1, 'and management');
  assert.equal(await notified(CLEANER, 'enquiry.received'), 0);

  await as(STAYS);
  const list = clientEnquiriesSchema.parse(await read());
  const back = list.items.find(e => e.id === sent.id);
  assert.equal(back.status, 'received');
  assert.equal(enquiryStep(back), 'received');
  assert.deepEqual(back.answers, answers);
  assert.deepEqual(back.files.map(f => [f.name, f.mime]), [['kitchen.jpg', 'image/jpeg']]);
  assert.equal('path' in back.files[0], false, 'storage paths stay on the server');
  const file = await rpc('workspace_client_enquiry_file', [sent.id, back.files[0].id]);
  assert.match(file.path, new RegExp(`^enquiries/${sent.id}/`));

  // Start valuing: the property and its onboarding journey, from the answers.
  const draft = valuationDraft(answers);
  assert.equal(draft.name, '12 Shore Road');
  assert.equal(draft.region, 'Edinburgh');
  assert.equal(valuationDraft({ ...answers, propertyAddress: '3F2, 17 Warrender Park Road, Edinburgh EH9 1EU' }).name, '17 Warrender Park Road (3F2)');
  assert.match(draft.enquiry.notes, /Furnishing quote: Yes/);
  const valued = await act({ action: 'startValuing', enquiryId: sent.id, version: back.version, ...draft });
  assert.equal(valued.status, 'valuing');
  assert.equal(valued.propertyName, '12 Shore Road');
  assert.equal(valued.stage, 'enquiry');
  assert.equal(enquiryStep(valued), 'valuing');
  const [journey] = await owner('select j.enquiry,j.property_type,p.bedrooms,p.region from private.workspace_journeys j join public.workspace_properties p on p.id=j.property_id where j.property_id=$1', [valued.propertyId]);
  assert.deepEqual([journey.enquiry.contactName, journey.enquiry.phone, journey.enquiry.existingClient, journey.enquiry.wcs, journey.property_type, journey.bedrooms, journey.region],
    ['Alex Morgan', '07700 900123', undefined, 1, 'Flat', 2, 'Edinburgh'], 'no "existing client" on a new form');
  await assert.rejects(act({ action: 'startValuing', enquiryId: sent.id, version: valued.version, ...draft }), /Only an answered enquiry/);
  await assert.rejects(act({ action: 'closeEnquiry', enquiryId: sent.id, version: valued.version, note: 'Duplicate' }), /already being valued/);
  // Once the estimate is published the enquiry reads "Estimate sent".
  await owner("update private.workspace_journeys set stage='estimate' where property_id=$1", [valued.propertyId]);
  assert.equal(enquiryStep(clientEnquiriesSchema.parse(await read()).items.find(e => e.id === sent.id)), 'estimate');
});

test('a fresh link replaces the old one; closed and expired links stop working', async () => {
  const first = token(), second = token();
  await as(SUPER);
  const sent = await invite(first, { delivery: 'link' });
  assert.equal(sent.emailStatus, 'manual');
  const again = await rpc('workspace_teams_action', [{ ...teamsActionSchema.parse({ action: 'resendEnquiry', requestId: crypto.randomUUID(), enquiryId: sent.id, version: sent.version, subject: 'A new link', body: 'Here it is: {form link}', delivery: 'link' }), tokenHash: hash(second) }]);
  assert.equal(again.subject, 'A new link');
  await asServer();
  await assert.rejects(pub({ action: 'open', tokenHash: hash(first) }), /not valid/, 'the old link stops working');
  assert.equal((await pub({ action: 'open', tokenHash: hash(second) })).state, 'open');
  await as(SUPER);
  await act({ action: 'closeEnquiry', enquiryId: sent.id, version: again.version, note: 'Sold the property' });
  await asServer();
  assert.equal((await pub({ action: 'open', tokenHash: hash(second) })).state, 'closed');
  await assert.rejects(pub({ action: 'submit', tokenHash: hash(second), answers }), /already been sent/);

  const late = token();
  await as(SUPER);
  const old = await invite(late);
  await owner("update private.workspace_client_enquiries set expires_at=now()-interval '1 day' where id=$1", [old.id]);
  await asServer();
  assert.equal((await pub({ action: 'open', tokenHash: hash(late) })).state, 'expired');
  await assert.rejects(pub({ action: 'submit', tokenHash: hash(late), answers }), /expired/);
});

test('the email: the link where they asked for it, or at the end', () => {
  const link = 'https://app.example.com/enquiry?t=' + 'a'.repeat(64);
  const end = enquiryEmail('Subject', 'Hello <Alex>\n\nThanks', link);
  assert.ok(end.text.endsWith(`Fill in the form: ${link}\n`));
  assert.ok(end.html.includes('Hello &lt;Alex&gt;'), 'what the team writes is escaped');
  const placed = enquiryEmail('Subject', 'Hi\n\n{form link}\n\nThanks', link);
  assert.equal(placed.text, `Hi\n\n${link}\n\nThanks`);
  assert.equal((placed.html.match(/Open the property form/g) ?? []).length, 1);
  assert.throws(() => enquiryAnswersSchema.parse({ ...answers, phone: '12345' }), /UK phone/);
  assert.throws(() => enquiryAnswersSchema.parse({ ...answers, mediaLink: 'http://insecure.example.com' }), /https/);
});
