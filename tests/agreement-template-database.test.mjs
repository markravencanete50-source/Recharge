import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'vite';

// The agreement from an uploaded contract (Lee, migration 20261020870000): admins upload it once; every agreement published
// after that is made from it, with {{placeholders}} filled in; a new upload changes future agreements only, and a published
// or signed agreement keeps its exact wording. A PDF gets a cover with the details. Owners open only their own contract.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { journeyActionSchema } = await vite.ssrLoadModule('/lib/journey-policy.ts');
const { journeyViewSchema } = await vite.ssrLoadModule('/lib/workspace-view.ts');
const T = await vite.ssrLoadModule('/lib/agreement-template.ts');
const MIGRATION = 'supabase/migrations/20261020870000_agreement_template.sql';
const db = new PGlite();
await db.exec(`set time zone 'Europe/London';create role anon;create role authenticated;create role service_role bypassrls;create schema auth;grant usage on schema auth to authenticated;
create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',email_confirmed_at timestamptz);
create table auth.sessions(id uuid primary key,user_id uuid references auth.users,not_after timestamptz);
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;`);
for (const file of (await fs.readdir('supabase/migrations')).filter(f => f.endsWith('.sql')).sort()) await db.exec(await fs.readFile('supabase/migrations/' + file, 'utf8'));
const roles = ['super_admin', 'admin', 'stays', 'client', 'client'];
const names = ['Sam', 'Morag', 'Fiona', 'Olive Owner', 'Other Owner'];
const users = roles.map((_, i) => `97730000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
const [SUPER, ADMIN, STAYS, OWNER, OTHER] = roles.map((_, i) => i);
const session = i => users[i].replace('9773', '9873');
for (let i = 0; i < users.length; i++) {
  await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())', [users[i], `at${i}@example.com`]);
  await db.query('insert into auth.sessions(id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query('insert into private.workspace_approved_sessions(session_id,user_id) values($1,$2)', [session(i), users[i]]);
  await db.query("update public.workspace_profiles set status='active',role=$2,full_name=$3 where user_id=$1", [users[i], roles[i], names[i]]);
  await db.query('insert into private.workspace_onboarding_done(user_id) values($1) on conflict do nothing', [users[i]]);
}
for (const i of [STAYS, OWNER, OTHER]) await db.query("insert into public.workspace_module_grants(user_id,module_id) values($1,'property-onboarding')", [users[i]]);
async function as(i) {
  await db.exec('reset role'); await db.exec('delete from private.workspace_write_limits');
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: users[i], session_id: session(i) })]);
  await db.exec('set role authenticated');
}
const owner = async (text, args = []) => { await db.exec('reset role'); return (await db.query(text, args)).rows; };
const rpc = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) result`, args)).rows[0].result;
const refused = async (promise, pattern) => assert.rejects(promise, error => pattern.test(error.message));
const settings = async (input, i = ADMIN) => { await as(i); return T.onboardingSettingsSchema.parse(await rpc(input ? 'workspace_onboarding_settings_action' : 'workspace_onboarding_settings_read', input ? [input] : [])); };
const sha = text => createHash('sha256').update(text).digest('hex');
const addTemplate = (body, kind = 'docx', fileName = kind === 'pdf' ? 'Contract.pdf' : 'Contract.docx', i = ADMIN, templateId = crypto.randomUUID()) =>
  settings({ action: 'addTemplate', templateId, kind, fileName, bytes: 2048, sha256: sha(body + fileName), body: kind === 'pdf' ? '' : body }, i);
after(async () => { await db.close(); await vite.close(); });

// A property onboarding at the agreement step: the team's (no owner account) or an owner's own.
const versionOf = async prop => (await owner('select version from private.workspace_journeys where property_id=$1', [prop]))[0].version;
async function journey(i, prop, input) {
  const version = await versionOf(prop);
  await as(i);
  return journeyViewSchema.parse(await rpc('workspace_journey_action', [journeyActionSchema.parse({ requestId: crypto.randomUUID(), propertyId: prop, version, ...input })]));
}
async function atAgreement(by = ADMIN, { fee = 1800 } = {}) {
  await as(by);
  const created = await rpc('workspace_journey_action', [journeyActionSchema.parse({ action: 'createEnquiry', requestId: crypto.randomUUID(), name: 'Harbour Flat', address: '8 Shore Road\nLeith, Edinburgh EH6 6RG', propertyType: 'Flat', bedrooms: 2, bathrooms: 1,
    ...(by === ADMIN ? { enquiry: { contactName: 'Mark Raven', companyName: 'Optimal Ltd', email: 'Mark@Example.com' } } : {}) })]);
  const prop = created.propertyId;
  await journey(ADMIN, prop, { action: 'publishEstimate', lowRateMinor: 9000, mediumRateMinor: 11000, highRateMinor: 14000, comparables: [], ...(fee === null ? {} : { managementFeeBps: fee, otaFeeBps: 1500 }) });
  await journey(by, prop, { action: 'decideEstimate', decision: 'proceed' });
  return prop;
}
const view = async (i, prop) => { await as(i); const [row] = await rpc('workspace_journey_read', [prop]); return row ? journeyViewSchema.parse(row) : null; };
const stored = async prop => (await owner('select agreement,agreement_template_id,agreement_format,agreement_revision from private.workspace_journeys where property_id=$1', [prop]))[0];
const today = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());

const CONTRACT = ['# Management agreement', 'This agreement is between Recharge and {{Owner name}} of {{ company  NAME }}, for {{Property address}}.',
  '- The management fee is {{Management fee}} of booking income.\n- It starts on {{Start date}}.', 'Signed: {{Owner signature}}'].join('\n\n');

test('onboarding settings are for admins: defaults, Recharge\'s details and the own-cost categories', async () => {
  for (const i of [STAYS, OWNER]) {
    await as(i);
    await refused(rpc('workspace_onboarding_settings_read'), /Management access required/);
    await refused(rpc('workspace_onboarding_settings_action', [{ action: 'saveCompanyDetails', companyDetails: 'x' }]), /Management access required/);
  }
  let s = await settings();
  assert.equal(s.template, null);
  assert.deepEqual(s.supported, [...T.AGREEMENT_PLACEHOLDERS], 'the app lists the same placeholders as the database');
  assert.deepEqual(s.ownCostCategories, [...T.DEFAULT_OWN_COST_CATEGORIES]);
  s = await settings({ action: 'saveCompanyDetails', companyDetails: '  Recharge Group Ltd\nSC123456\n1 George Street, Edinburgh  ' });
  assert.equal(s.companyDetails, 'Recharge Group Ltd\nSC123456\n1 George Street, Edinburgh');
  s = await settings({ action: 'saveCostCategories', categories: ['Mortgage', 'Insurance', 'Utilities', 'Council tax', 'Factor fees', 'Other'] });
  assert.deepEqual(s.ownCostCategories, ['Mortgage', 'Insurance', 'Utilities', 'Council tax', 'Factor fees', 'Other'], 'in the order given');
  await as(ADMIN);
  await refused(rpc('workspace_onboarding_settings_action', [{ action: 'saveCostCategories', categories: ['Mortgage', 'mortgage'] }]), /Each category once/);
  await refused(rpc('workspace_onboarding_settings_action', [{ action: 'saveCostCategories', categories: [] }]), /between 1 and 12/);
  assert.equal(T.onboardingSettingsActionSchema.safeParse({ action: 'saveCostCategories', categories: ['A', 'a'] }).success, false);
  await settings({ action: 'saveCostCategories', categories: [...T.DEFAULT_OWN_COST_CATEGORIES] });
});

test('a Word contract: the placeholders found and the ones not recognised; a retried upload is kept once', async () => {
  const id = crypto.randomUUID();
  let s = await addTemplate(CONTRACT, 'docx', 'Management agreement 2026.docx', ADMIN, id);
  assert.equal(s.template.version, 1);
  assert.equal(s.template.fileName, 'Management agreement 2026.docx');
  assert.deepEqual(s.template.placeholders, ['Owner name', 'Company name', 'Property address', 'Management fee', 'Start date']);
  assert.deepEqual(s.template.unknown, ['{{Owner signature}}']);
  s = await addTemplate(CONTRACT, 'docx', 'Management agreement 2026.docx', ADMIN, id);
  assert.equal(s.history.length, 1, 'the same upload again is the same contract');
  await refused(addTemplate(CONTRACT, 'docx', 'x.docx', SUPER, id), /Request identifier reused/);
  await as(ADMIN);
  await refused(rpc('workspace_onboarding_settings_action', [{ action: 'addTemplate', templateId: crypto.randomUUID(), kind: 'docx', fileName: 'Empty.docx', bytes: 10, sha256: sha('e'), body: ' ' }]), /No text was found/);
  await refused(rpc('workspace_onboarding_settings_action', [{ action: 'addTemplate', templateId: crypto.randomUUID(), kind: 'docx', fileName: 'Big.docx', bytes: 5242881, sha256: sha('b'), body: CONTRACT }]), /up to 5 MB/);
  await refused(rpc('workspace_onboarding_settings_action', [{ action: 'addTemplate', templateId: crypto.randomUUID(), kind: 'exe', fileName: 'x', bytes: 1, sha256: sha('x'), body: '' }]), /Word document \(\.docx\) or a PDF/);
});

test('the team sees the filled-in agreement before publishing; it is kept exactly, and a new contract never changes it', async () => {
  const prop = await atAgreement();
  let j = await view(ADMIN, prop);
  const draft = j.agreementDraft;
  assert.equal(draft.fileName, 'Management agreement 2026.docx');
  assert.equal(draft.text, ['# Management agreement', `This agreement is between Recharge and Mark Raven of Optimal Ltd, for 8 Shore Road, Leith, Edinburgh EH6 6RG.`,
    `- The management fee is 18% of booking income.\n- It starts on ${today}.`, 'Signed: {{Owner signature}}'].join('\n\n'), 'line breaks in the address become commas; unknown placeholders stay as written');
  assert.deepEqual(draft.missing, []);
  assert.equal((await view(STAYS, prop)).agreementDraft.text, draft.text, 'the stays team on the property sees it too');
  assert.equal(T.agreementTemplateForms({ role: 'admin' }, j)[0].build({}, 'r').templateId, draft.templateId);
  assert.match(T.agreementTemplateForms({ role: 'admin' }, j)[0].description, /Made from Management agreement 2026\.docx \(contract 1\)\./);
  assert.deepEqual(T.agreementTemplateForms({ role: 'client' }, j), [], 'owners never publish');

  j = await journey(ADMIN, prop, { action: 'publishAgreement', templateId: draft.templateId });
  assert.equal(j.agreement, draft.text);
  assert.equal(j.agreementFormat, 'outline');
  assert.deepEqual(j.agreementTemplate, { id: draft.templateId, version: 1, kind: 'docx', fileName: 'Management agreement 2026.docx', bytes: 2048, sha256: j.agreementTemplate.sha256 });
  const published = await stored(prop);
  assert.equal(published.agreement_revision, 1);

  // A new contract: the published agreement keeps every byte; publishing from the old contract is refused.
  const s = await addTemplate('# New terms\n\n{{Owner name}} agrees to the new terms for {{Property name}}.', 'docx', 'Agreement v2.docx');
  assert.equal(s.template.version, 2);
  assert.equal(sha((await stored(prop)).agreement), sha(published.agreement));
  await refused(journey(ADMIN, prop, { action: 'publishAgreement', templateId: draft.templateId }), /The contract has changed since you opened this/);
  assert.equal((await view(ADMIN, prop)).agreementDraft.text, '# New terms\n\nMark Raven agrees to the new terms for Harbour Flat.');

  // Signed (the team records it, as there is no owner account): still the same words, whatever is uploaded next.
  j = await journey(ADMIN, prop, { action: 'signAgreement', agreementRevision: 1, signedName: 'Mark Raven', consent: true });
  assert.equal(j.signedRevision, 1);
  assert.equal(j.agreementDraft, null, 'nothing more to publish once signed');
  await addTemplate('# Third\n\n{{Owner name}}, {{Property address}}.', 'docx', 'Agreement v3.docx');
  const signed = await stored(prop);
  assert.equal(signed.agreement, published.agreement);
  assert.equal(signed.agreement_template_id, draft.templateId, 'it remembers the contract it came from');
  const [history] = await owner('select count(*)::int n from private.workspace_agreement_templates');
  assert.equal(history.n, 3, 'every contract is kept');
});

test('the team edits the contract\'s wording before publishing, and the owner signs with a drawn signature (20261024100000)', async () => {
  const prop = await atAgreement(OWNER);
  const draft = (await view(STAYS, prop)).agreementDraft;
  const edited = draft.text + '\n\nAn extra clause the team added for this property.';
  const form = T.agreementTemplateForms({ role: 'stays' }, await view(STAYS, prop))[0];
  assert.equal(form.fields[0].defaultValue, draft.text, 'the form starts from the filled-in contract');
  assert.equal(form.build({ agreement: draft.text }, 'r').agreement, undefined, 'unchanged wording is filled in again by the database');
  assert.equal(form.build({ agreement: edited }, 'r').agreement, edited);
  let j = await journey(STAYS, prop, form.build({ agreement: edited }, 'r'));
  assert.equal(j.agreement, edited);
  assert.equal(j.agreementFormat, 'outline');
  assert.equal(j.agreementTemplate.id, draft.templateId, 'still recorded against the contract it came from');
  await refused(journey(STAYS, prop, { action: 'publishAgreement', templateId: draft.templateId, agreement: 'short' }), /./);

  // A typed or uploaded agreement in the outline format, longer than the old 10,000 characters.
  const long = '# Terms\n\n' + Array.from({ length: 400 }, (_, i) => `${i + 1}. Clause ${i + 1} of the agreement, in full.`).join('\n');
  assert.ok(long.length > 10000);
  assert.equal(journeyActionSchema.safeParse({ action: 'publishAgreement', requestId: crypto.randomUUID(), propertyId: prop, version: 1, agreement: long, format: 'outline' }).success, true);
  j = await journey(ADMIN, prop, { action: 'publishAgreement', agreement: long, format: 'outline' });
  assert.equal(j.agreementFormat, 'outline');
  assert.equal(j.agreement, long);
  assert.equal(j.agreementTemplate, null);

  // The owner signs with their name and a drawing; a bad image is refused, with or without the app's checks.
  const { signaturePng } = await vite.ssrLoadModule('/lib/signature-png.ts');
  const png = signaturePng([[{ x: 10, y: 40 }, { x: 120, y: 20 }, { x: 220, y: 60 }]], 240, 80);
  const sign = extra => ({ action: 'signAgreement', agreementRevision: j.agreementRevision, signedName: 'Olive Owner', consent: true, ...extra });
  assert.equal(journeyActionSchema.safeParse({ ...sign({ signatureImage: 'data:image/svg+xml;base64,PHN2Zz4=' }), requestId: crypto.randomUUID(), propertyId: prop, version: 1 }).success, false);
  await refused(journey(OWNER, prop, sign({ signatureImage: 'data:image/svg+xml;base64,PHN2Zz4=' })), /Draw your signature again/);
  await as(OWNER);
  await refused(rpc('workspace_journey_action', [{ ...sign({ signatureImage: 42 }), requestId: crypto.randomUUID(), propertyId: prop, version: await versionOf(prop) }]), /Draw your signature again/);
  j = await journey(OWNER, prop, sign({ signatureImage: png }));
  assert.equal(j.signedName, 'Olive Owner');
  assert.equal(j.signatureImage, png);
  assert.equal((await view(ADMIN, prop)).signatureImage, png, 'the team sees it on the signed agreement');
  const copy = await vite.ssrLoadModule('/lib/agreement-copy.ts');
  const html = copy.agreementDocument({ propertyName: 'Flat', agreement: j.agreement, revision: j.signedRevision, signedName: j.signedName, signedAt: j.signedAt, format: 'outline', signatureImage: png });
  assert.match(html, /Signed electronically by Olive Owner/);
  assert.ok(html.includes(`<img class="signature" alt="Signature of Olive Owner" src="${png}">`));
  assert.doesNotMatch(copy.agreementDocument({ propertyName: 'Flat', agreement: 'x', revision: 1, signedName: 'A', signedAt: null, signatureImage: 'javascript:alert(1)' }), /<img/);

  // Signing with the name alone still works.
  const plain = await atAgreement(OTHER);
  const published = await journey(ADMIN, plain, { action: 'publishAgreement', agreement: 'Our own wording for this property, agreed by phone.' });
  const signed = await journey(OTHER, plain, { action: 'signAgreement', agreementRevision: published.agreementRevision, signedName: 'Other Owner', consent: true });
  assert.equal(signed.signatureImage, null);
});

test('the editing and signature migration runs twice, and the contract migration after it', async () => {
  const defs = async () => (await owner(`select string_agg(pg_get_functiondef(p.oid),'' order by p.oid::regprocedure::text) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname in ('workspace_journey_action','workspace_journey_view','workspace_agreement_signature')`))[0].d;
  const before = await defs();
  const mine = await fs.readFile('supabase/migrations/20261024100000_agreement_signature.sql', 'utf8');
  await db.exec('reset role'); await db.exec(mine); await db.exec(await fs.readFile(MIGRATION, 'utf8'));
  assert.equal(await defs(), before);
  assert.doesNotMatch(mine, /—/);
  assert.doesNotMatch(mine.replace(/^--.*$/gm, ''), /\b(drop|delete)\b/i);
});

test('no placeholders, or a PDF: the owner\'s, the property\'s and Recharge\'s details in a block at the top', async () => {
  await settings({ action: 'saveCompanyDetails', companyDetails: 'Recharge Group Ltd\n1 George Street, Edinburgh' });
  await addTemplate('# Terms\n\nRecharge manages the property for the owner.', 'docx', 'Plain.docx');
  const prop = await atAgreement(ADMIN, { fee: null });
  let j = await view(ADMIN, prop);
  const details = ['# Agreement details', '## The owner', 'Name: Mark Raven\nCompany: Optimal Ltd\nEmail: mark@example.com', '## The property', 'Harbour Flat\n8 Shore Road, Leith, Edinburgh EH6 6RG',
    '## Recharge', 'Recharge Group Ltd\n1 George Street, Edinburgh', `Start date: ${today}`];
  assert.equal(j.agreementDraft.text, [...details, '# Terms', 'Recharge manages the property for the owner.'].join('\n\n'));
  assert.deepEqual(j.agreementDraft.missing, ['Management fee'], 'no fee on the estimate: the team is told before publishing');
  const pdf = await addTemplate('', 'pdf', 'Signed contract.pdf');
  assert.equal(pdf.template.kind, 'pdf');
  assert.deepEqual(pdf.template.placeholders, []);
  j = await view(ADMIN, prop);
  assert.equal(j.agreementDraft.text, [...details, '## The agreement', 'The agreement is the attached document, Signed contract.pdf. Read it with this page; both together are the agreement.'].join('\n\n'));
  j = await journey(ADMIN, prop, { action: 'publishAgreement', templateId: j.agreementDraft.templateId });
  assert.equal(j.agreementTemplate.kind, 'pdf');
  // A typed agreement still works, and is plain text again.
  j = await journey(ADMIN, prop, { action: 'publishAgreement', agreement: 'Our own wording for this property, agreed by phone.' });
  assert.equal(j.agreementFormat, 'text');
  assert.equal(j.agreementTemplate, null);
  assert.equal(j.agreementRevision, 2);
});

test('contract files: admins open any; an owner only the one their own agreement was made from', async () => {
  const pdf = (await settings()).template;
  const mine = await atAgreement(OWNER), theirs = await atAgreement(OTHER);
  for (const prop of [mine, theirs]) await journey(ADMIN, prop, { action: 'publishAgreement', templateId: pdf.id });
  const ownView = await view(OWNER, mine);
  assert.equal(ownView.agreementDraft, null, 'owners never see the team\'s preview');
  assert.equal(ownView.agreementTemplate.fileName, 'Signed contract.pdf');
  assert.match(ownView.agreement, /Name: Olive Owner\nEmail: at3@example\.com/, 'an owner with an account: their account name and email');
  await as(OWNER);
  assert.deepEqual(await rpc('workspace_agreement_file', [pdf.id, mine]), { path: `agreements/${pdf.id}.pdf`, name: 'Signed contract.pdf', kind: 'pdf', mime: 'application/pdf' });
  await refused(rpc('workspace_agreement_file', [pdf.id, theirs]), /Contract not found/);
  await refused(rpc('workspace_agreement_file', [pdf.id, null]), /Contract not found/);
  const older = (await settings()).history.find(h => h.version === 1);
  await as(OWNER);
  await refused(rpc('workspace_agreement_file', [older.id, mine]), /Contract not found/);
  await as(ADMIN);
  assert.equal((await rpc('workspace_agreement_file', [older.id, null])).name, 'Management agreement 2026.docx');
  await as(STAYS);
  await refused(rpc('workspace_agreement_file', [older.id, null]), /Contract not found/);
  // Stop using a contract, then pick an earlier one again.
  let s = await settings({ action: 'stopTemplate' });
  assert.equal(s.template, null);
  assert.equal((await view(ADMIN, await atAgreement())).agreementDraft, null, 'agreements are typed in again');
  s = await settings({ action: 'useTemplate', templateId: older.id });
  assert.equal(s.template.version, 1);
  assert.equal(s.history.find(h => h.inUse).id, older.id);
});

test('the migration runs twice without changing anything', async () => {
  const defs = async () => (await owner(`select string_agg(pg_get_functiondef(p.oid),'' order by p.oid::regprocedure::text) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('private','public') and (p.proname like 'workspace_agreement%' or p.proname like 'workspace_onboarding_settings%' or p.proname in ('workspace_journey_action','workspace_journey_view'))`))[0].d;
  const before = await defs(), rows = (await owner('select count(*)::int n from private.workspace_onboarding_settings'))[0].n;
  await db.exec('reset role'); await db.exec(await fs.readFile(MIGRATION, 'utf8'));
  assert.equal(await defs(), before);
  assert.equal((await owner('select count(*)::int n from private.workspace_onboarding_settings'))[0].n, rows);
  const text = await fs.readFile(MIGRATION, 'utf8');
  assert.match(text, /^-- Management agreement from an uploaded contract/);
  assert.doesNotMatch(text, /—/);
});
