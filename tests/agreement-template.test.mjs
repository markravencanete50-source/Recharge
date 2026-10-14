import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// The contract uploaded as the agreement template (Lee, migration 20261020870000): a Word document's text read on the
// server with nothing in it run, the agreement page that prints to a PDF, and the upload route (admins only, Word or PDF
// up to 5 MB, kept in the private bucket under the request id, with the file's fingerprint).
const root = fileURLToPath(new URL('..', import.meta.url));
const state = { role: 'admin', uploads: [], removed: [], rpc: [], uploadError: null, rpcError: null };
globalThis.__agreementTemplate = state;
const mocks = {
  'auth-security': `export const authSecurityConfiguration=()=>({url:'https://db.test',key:'sb_secret_x',origin:'https://app.test'});export const requestQuota=async()=>({allowed:true});`,
  'business-server': `const s=globalThis.__agreementTemplate;export const businessResponse=(body,status=200)=>Response.json(body,{status});
    export const businessContext=async()=>({account:{userId:'u1',role:s.role,status:'active'},client:{rpc:async(name,args)=>{s.rpc.push({name,args});return s.rpcError?{data:null,error:s.rpcError}:name==='workspace_agreement_file'?{data:{path:'agreements/x.pdf',name:'Signed contract.pdf',mime:'application/pdf'},error:null}:{data:{saved:name,args},error:null};}}});
    export const databaseFailure=error=>Response.json({error:error.message},{status:400});export const viewAsFailure=()=>null;`,
  'native-request-policy': `export const isNativeRequest=()=>true;`,
  '@supabase/supabase-js': `const s=globalThis.__agreementTemplate;export const createClient=()=>({storage:{from:bucket=>({
    upload:async(path,bytes,options)=>{s.uploads.push({bucket,path,bytes:bytes.length,options});return {error:s.uploadError};},
    remove:async paths=>{s.removed.push(...paths);return {error:null};},
    createSignedUrl:async(path,seconds,options)=>({data:{signedUrl:'https://db.test/signed/'+path+'?s='+seconds+'&d='+encodeURIComponent(options?.download??'')},error:null})})}});`,
};
const vite = await createServer({ configFile: false, root, resolve: { alias: { '@': root } }, server: { middlewareMode: true, hmr: false }, plugins: [{
  name: 'isolated-agreement-template', enforce: 'pre',
  transform(code, id) {
    if (!/\/agreement-template-server\.ts$/.test(id.replaceAll('\\', '/'))) return;
    for (const name of Object.keys(mocks)) code = code.replaceAll(`from '${name === '@supabase/supabase-js' ? name : './' + name}'`, `from 'agreement-test:${name}'`);
    return { code, map: null };
  },
  resolveId: id => id.startsWith('agreement-test:') ? '\0' + id : null,
  load: id => id.startsWith('\0agreement-test:') ? mocks[id.slice(16)] : null,
}] });
const { docxOutline, DocxError } = await vite.ssrLoadModule('/lib/docx-text.ts');
const copy = await vite.ssrLoadModule('/lib/agreement-copy.ts');
const T = await vite.ssrLoadModule('/lib/agreement-template.ts');
const server = await vite.ssrLoadModule('/lib/agreement-template-server.ts');
after(async () => { delete globalThis.__agreementTemplate; await vite.close(); });

// A small zip writer (deflated entries, with CRCs), to make Word documents for the tests.
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = bytes => { let c = 0xffffffff; for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const deflate = async bytes => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
async function zip(files) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = new TextEncoder().encode(text), data = await deflate(raw), n = new TextEncoder().encode(name);
    const header = new DataView(new ArrayBuffer(30));
    [[0, 0x04034b50, 4], [4, 20, 2], [8, 8, 2], [14, crc32(raw), 4], [18, data.length, 4], [22, raw.length, 4], [26, n.length, 2]].forEach(([at, v, size]) => size === 4 ? header.setUint32(at, v, true) : header.setUint16(at, v, true));
    local.push(new Uint8Array(header.buffer), n, data);
    const entry = new DataView(new ArrayBuffer(46));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [10, 8, 2], [16, crc32(raw), 4], [20, data.length, 4], [24, raw.length, 4], [28, n.length, 2], [42, offset, 4]].forEach(([at, v, size]) => size === 4 ? entry.setUint32(at, v, true) : entry.setUint16(at, v, true));
    central.push(new Uint8Array(entry.buffer), n);
    offset += 30 + n.length + data.length;
  }
  const size = central.reduce((s, b) => s + b.length, 0), end = new DataView(new ArrayBuffer(22));
  [[0, 0x06054b50, 4], [8, Object.keys(files).length, 2], [10, Object.keys(files).length, 2], [12, size, 4], [16, offset, 4]].forEach(([at, v, s]) => s === 4 ? end.setUint32(at, v, true) : end.setUint16(at, v, true));
  return new Uint8Array(await new Blob([...local, ...central, new Uint8Array(end.buffer)]).arrayBuffer());
}
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const p = (text, props = '') => `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${text}</w:p>`;
const r = text => `<w:r><w:t xml:space="preserve">${text}</w:t></w:r>`;
const list = (numId, level = 0) => `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${numId}"/></w:numPr>`;
const NUMBERING = `<w:numbering ${W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;
const docx = (body, extra = {}) => zip({ '[Content_Types].xml': '<Types><Default Extension="xml" ContentType="application/xml"/></Types>', 'word/document.xml': `<?xml version="1.0"?><w:document ${W}><w:body>${body}<w:sectPr/></w:body></w:document>`, 'word/numbering.xml': NUMBERING, ...extra });
const CONTRACT = [
  p(r('Management agreement'), '<w:pStyle w:val="Title"/>'),
  p(r('This agreement is between Recharge &amp; ') + r('{{Owner') + `<w:proofErr w:type="spellStart"/>` + r(' name}}') + r(' for {{Property address}}.')),
  p(r('1. Fees'), '<w:pStyle w:val="Heading2"/>'),
  p(r('Management fee of {{Management fee}}'), list(1)), p(r('Paid monthly'), list(1)),
  p(r('First step'), list(2)), p(r('Second step'), list(2)),
  p(r('A note') + '<w:r><w:br/></w:r>' + r('on two lines') + '<w:r><w:tab/></w:r>' + r('with a tab')),
  p('<w:del><w:r><w:delText>deleted words</w:delText></w:r></w:del>' + r('Kept words')),
  p(`<w:r><mc:AlternateContent><mc:Choice><w:drawing><w:txbxContent>${p(r('Text box words'))}</w:txbxContent></w:drawing></mc:Choice></mc:AlternateContent></w:r>` + r('After the box')),
  p(r('# not a heading')), p(''), '<w:p/>',
  `<w:tbl><w:tr><w:tc>${p(r('In a table'))}</w:tc></w:tr></w:tbl>`,
].join('');

test('a Word contract becomes headings, paragraphs and lists; placeholders split across runs are kept whole', async () => {
  const text = await docxOutline(await docx(CONTRACT));
  assert.equal(text, [
    '# Management agreement',
    'This agreement is between Recharge & {{Owner name}} for {{Property address}}.',
    '## 1. Fees',
    '- Management fee of {{Management fee}}\n- Paid monthly',
    '1. First step\n2. Second step',
    'A note\non two lines with a tab',
    'Kept words',
    'After the box',
    '\\# not a heading',
    'In a table',
  ].join('\n\n'), 'deleted text, text boxes and pictures are left out; a paragraph starting "#" is not a heading');
});

// Contracts often put the fees in a table (Lee: "make sure the contract reads pdf and word document"): a table is one
// block, a line per row with its cells joined by " | ", so the owner reads the fee schedule as rows.
test('a Word table becomes a line per row, "cell | cell", with placeholders, merged cells and a table in a cell', async () => {
  const cell = (...paras) => `<w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr>${paras.join('')}</w:tc>`;
  const row = (...cells) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${cells.join('')}</w:tr>`;
  const table = (...rows) => `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr><w:tblGrid><w:gridCol w:w="3000"/></w:tblGrid>${rows.join('')}</w:tbl>`;
  const text = await docxOutline(await docx([
    p(r('Fees'), '<w:pStyle w:val="Heading1"/>'),
    p(r('Fee schedule:')),
    table(
      row(cell(p(r('Service'))), cell(p(r('Fee'))), cell(p(r('When')))),
      row(cell(p(r('Management'))), cell(p(r('{{Management') + r(' fee}}'))), cell(p(r('Monthly')))),
      row(cell(p(r('Linen'))), cell(p(r('£35')), p(r('per stay'))), cell('<w:p/>')),
      row(cell('<w:p/>'), cell('<w:p/>'), cell('<w:p/>')),
      row(cell(p(r('Repairs'))), cell(table(row(cell(p(r('Up to £250'))), cell(p(r('cost')))), row(cell(p(r('Over £250'))), cell(p(r('cost plus 10%')))))), cell(p(r('As incurred')))),
      row(cell(p(r('- 1. looks like a list')))),
    ),
    p(r('After the table'), list(2)),
  ].join('')));
  assert.equal(text, [
    '# Fees',
    'Fee schedule:',
    'Service | Fee | When\nManagement | {{Management fee}} | Monthly\nLinen | £35 per stay\nRepairs | Up to £250 | cost; Over £250 | cost plus 10% | As incurred\n\\- 1. looks like a list',
    '1. After the table',
  ].join('\n\n'), 'rows stay rows, empty rows and cells are left out, and a row that looks like a list item is not one');
  assert.deepEqual(copy.outlineBlocks(text)[2], { kind: 'p', lines: ['Service | Fee | When', 'Management | {{Management fee}} | Monthly', 'Linen | £35 per stay', 'Repairs | Up to £250 | cost; Over £250 | cost plus 10% | As incurred', '- 1. looks like a list'] });
});

test('refused: not a zip, no document, macros, a password; nothing in the file is run', async () => {
  await assert.rejects(docxOutline(new TextEncoder().encode('%PDF-1.7 not a zip')), DocxError);
  await assert.rejects(docxOutline(await zip({ 'other.xml': '<x/>' })), /not a Word document/);
  await assert.rejects(docxOutline(await docx(p(r('Hello')), { 'word/vbaProject.bin': 'macro' })), /contains macros/);
  await assert.rejects(docxOutline(await zip({ '[Content_Types].xml': '<Override ContentType="application/vnd.ms-word.document.macroEnabled.main+xml"/>', 'word/document.xml': `<w:document ${W}><w:body>${p(r('Hi'))}</w:body></w:document>` })), /contains macros/);
  const locked = await docx(p(r('Hello')));
  const view = new DataView(locked.buffer), at = locked.findLastIndex((_, i) => i + 4 <= locked.length && view.getUint32(i, true) === 0x02014b50 && new TextDecoder().decode(locked.subarray(i + 46, i + 46 + 17)) === 'word/document.xml');
  view.setUint16(at + 8, 1, true);
  await assert.rejects(docxOutline(locked), /password protected/);
  const source = await fs.readFile('lib/docx-text.ts', 'utf8');
  assert.doesNotMatch(source, /\beval\(|new Function|import\(/, 'the reader only reads text');
});

test('the agreement page: outline headings and lists, escaped, a print-to-PDF button, the PDF contract and not yet signed', () => {
  const html = copy.agreementDocument({ propertyName: 'Harbour <Flat>', agreement: '# Terms\n\n## Fees\n\n- 18% <of> income\n- Paid monthly\n\n1. One\n2. Two\n\n\\# Kept as words\nsecond line', revision: 2, signedName: null, signedAt: null, format: 'outline',
    attachment: { fileName: 'Contract.pdf', sha256: 'a'.repeat(64) } });
  assert.match(html, /<h2>Terms<\/h2>\n<h3>Fees<\/h3>\n<ul><li>18% &lt;of&gt; income<\/li><li>Paid monthly<\/li><\/ul>\n<ol><li>One<\/li><li>Two<\/li><\/ol>\n<p># Kept as words<br>second line<\/p>/);
  assert.match(html, /<button class="print" type="button" onclick="window\.print\(\)">Print or save as PDF<\/button>/);
  assert.match(html, /@media print\{\.print\{display:none\}/);
  assert.match(html, /<b>Not signed yet<\/b>This is revision 2/);
  assert.match(html, /Contract\.pdf, downloaded with this page\. Its SHA-256 fingerprint is <span class="hash">a{64}<\/span>/);
  assert.ok(!html.includes('<Flat>'));
  const typed = copy.agreementDocument({ propertyName: 'Flat', agreement: '# Not a heading in typed text', revision: 1, signedName: 'Mark', signedAt: '2026-10-14T10:00:00Z' });
  assert.match(typed, /<p># Not a heading in typed text<\/p>/, 'a typed agreement shows exactly as before');
  assert.equal(copy.agreementReadable('# Terms\n\n- A\n- B\n\n1. One\n\n\\- dash', 'outline'), 'Terms\n\n• A\n• B\n\n1. One\n\n- dash');
  assert.equal(copy.agreementReadable('# Typed', 'text'), '# Typed');
});

const upload = async (bytes, name = 'Contract.docx', extra = {}) => {
  const form = new FormData();
  form.append('requestId', extra.requestId ?? '5b0a8c62-56f4-4a62-9a39-6b0e4b8b2a01');
  form.append('file', new File([bytes], name));
  return server.onboardingSettingsRoute(new Request('https://app.test/api/workspace/onboarding-settings', { method: 'POST', headers: { origin: 'https://app.test' }, body: form }));
};
const reset = role => Object.assign(state, { role, uploads: [], removed: [], rpc: [], uploadError: null, rpcError: null });

test('upload: a Word contract is read, stored privately under the request id, and saved with its text and fingerprint', async () => {
  reset('admin');
  const bytes = await docx(CONTRACT);
  const response = await upload(bytes, 'Recharge agreement.docx');
  assert.equal(response.status, 200);
  assert.deepEqual(state.uploads, [{ bucket: 'agreement-templates', path: 'agreements/5b0a8c62-56f4-4a62-9a39-6b0e4b8b2a01.docx', bytes: bytes.length, options: { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', upsert: false, cacheControl: 'private, max-age=0' } }]);
  const [saved] = state.rpc;
  assert.equal(saved.name, 'workspace_onboarding_settings_action');
  const input = saved.args.input;
  assert.equal(input.action, 'addTemplate');
  assert.equal(input.templateId, '5b0a8c62-56f4-4a62-9a39-6b0e4b8b2a01');
  assert.equal(input.fileName, 'Recharge agreement.docx');
  assert.equal(input.sha256, (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex'));
  assert.match(input.body, /^# Management agreement\n\nThis agreement is between Recharge & \{\{Owner name\}\}/);
  // A retried upload: the file is already stored, so the database keeps the first.
  reset('admin'); state.uploadError = { message: 'The resource already exists' };
  assert.equal((await upload(bytes)).status, 200);
  assert.equal(state.rpc.length, 1);
  // The database refuses: the file just stored is removed again (but never one from an earlier try).
  reset('admin'); state.rpcError = { message: 'Management access required' };
  assert.equal((await upload(bytes)).status, 400);
  assert.deepEqual(state.removed, ['agreements/5b0a8c62-56f4-4a62-9a39-6b0e4b8b2a01.docx']);
});

// Word saves a password-protected document and an old .doc as an OLE compound file, not a zip: each says what it is.
test('upload: an old .doc and a password-protected Word document say so, and a file over 5 MB says how big it can be', async () => {
  reset('admin');
  const ole = (...streams) => { const b = new Uint8Array(4096); b.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]); let at = 1024; for (const s of streams) { b.set([...s].flatMap(c => [c.charCodeAt(0), 0]), at); at += 128; } return b; };
  let response = await upload(ole('Root Entry', 'EncryptionInfo', 'EncryptedPackage'), 'Locked.docx');
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, 'This document is password protected. Remove the password and upload it again.');
  response = await upload(ole('Root Entry', 'WordDocument', '1Table'), 'Agreement.doc');
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /older Word document \(\.doc\)\. Open it in Word, save it as a Word Document \(\.docx\) or a PDF/);
  response = await upload(new Uint8Array(T.MAX_AGREEMENT_BYTES + 70000).fill(0x25), 'Scan.pdf');
  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /larger than 5 MB\. Contracts can be up to 5 MB/);
  response = await upload(new TextEncoder().encode('MANAGEMENT AGREEMENT\nplain text renamed'), 'Renamed.docx');
  assert.match((await response.json()).error, /^Upload the contract as a Word document \(\.docx\) or a PDF, up to 5 MB$/);
  assert.equal(state.uploads.length, 0, 'nothing refused is stored');
});

test('upload: a PDF is kept as it is; other files, macros, 5 MB and non-admins are refused', async () => {
  reset('admin');
  assert.equal((await upload(new TextEncoder().encode('%PDF-1.7\n1 0 obj'), 'Signed.pdf')).status, 200);
  assert.equal(state.uploads[0].path, 'agreements/5b0a8c62-56f4-4a62-9a39-6b0e4b8b2a01.pdf');
  assert.deepEqual({ kind: state.rpc[0].args.input.kind, body: state.rpc[0].args.input.body }, { kind: 'pdf', body: '' });
  reset('admin');
  let response = await upload(new TextEncoder().encode('MZ executable'), 'Contract.docx');
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Word document \(\.docx\) or a PDF, up to 5 MB/);
  response = await upload(await docx(p(r('Hello')), { 'word/vbaProject.bin': 'x' }));
  assert.match((await response.json()).error, /contains macros/);
  response = await upload(new Uint8Array(T.MAX_AGREEMENT_BYTES + 70000).fill(0x25), 'Big.pdf');
  assert.equal(response.status, 413);
  assert.equal(state.uploads.length, 0, 'nothing refused is stored');
  reset('stays');
  assert.equal((await upload(await docx(CONTRACT))).status, 403);
  reset('client');
  response = await server.onboardingSettingsRoute(new Request('https://app.test/api/workspace/onboarding-settings', { method: 'POST', headers: { origin: 'https://app.test', 'content-type': 'application/json' }, body: JSON.stringify({ action: 'stopTemplate' }) }));
  assert.equal(response.status, 403);
});

test('opening a contract: a 10-minute download link for the file the database allows', async () => {
  reset('client');
  const response = await server.onboardingSettingsRoute(new Request('https://app.test/api/workspace/onboarding-settings?templateId=5b0a8c62-56f4-4a62-9a39-6b0e4b8b2a01&propertyId=6b0a8c62-56f4-4a62-9a39-6b0e4b8b2a02'));
  assert.deepEqual(state.rpc[0], { name: 'workspace_agreement_file', args: { template: '5b0a8c62-56f4-4a62-9a39-6b0e4b8b2a01', target: '6b0a8c62-56f4-4a62-9a39-6b0e4b8b2a02' } });
  assert.deepEqual((await response.json()).data, { url: 'https://db.test/signed/agreements/x.pdf?s=600&d=Signed%20contract.pdf', name: 'Signed contract.pdf', mime: 'application/pdf' });
  reset('admin');
  assert.equal((await server.onboardingSettingsRoute(new Request('https://app.test/api/workspace/onboarding-settings?templateId=nope'))).status, 400);
  assert.equal((await server.onboardingSettingsRoute(new Request('https://app.test/api/workspace/onboarding-settings?section=x'))).status, 400);
});

// Found on the devstack: the onboarding tracker and the onboarding ticket (All work, Home) offered only the typed
// "Publish the management agreement", so an admin there never saw the contract in use. The ticket's forms now lead
// with the contract's, as the property page's do.
test('the onboarding ticket offers "Publish the agreement from the contract" wherever it opens', async () => {
  const wf = await vite.ssrLoadModule('/lib/workflow-forms.ts');
  const draft = { templateId: '855ba556-338b-42a7-9c38-1700f6a6f8cc', version: 6, kind: 'docx', fileName: 'Agreement.docx', text: '# Agreement\n\nService | Fee\nManagement | 20%', missing: [] };
  const journey = { propertyId: 'b17c38b7-db8f-4b01-bd57-1f3961f51283', workId: 'f9f072d8-706d-4d10-8826-710a3c6eeb27', version: 3, stage: 'agreement', signedName: null, agreementDraft: draft, data: {} };
  const ticket = { workId: journey.workId, propertyId: journey.propertyId, kind: 'onboarding', status: 'open', data: {}, assigneeId: null };
  const admin = { role: 'admin', modules: ['property-onboarding'], userId: 'u1' };
  const keys = wf.workItemForms(admin, ticket, [journey], [ticket]).map(f => f.key);
  assert.equal(keys[0], 'publishAgreementTemplate');
  assert.ok(keys.includes('publishAgreement'), 'typing an agreement in stays possible');
  const form = wf.workItemForms(admin, ticket, [journey], [ticket])[0];
  assert.match(form.description, /Management \| 20%/, 'the fee table reads as rows before publishing');
  assert.deepEqual(form.build({ checked: true }), { action: 'publishAgreement', propertyId: journey.propertyId, version: 3, templateId: draft.templateId });
  assert.ok(!wf.workItemForms({ ...admin, role: 'client' }, ticket, [journey], [ticket]).some(f => f.key === 'publishAgreementTemplate'), 'never for the owner');
  assert.ok(!wf.workItemForms(admin, ticket, [{ ...journey, agreementDraft: null }], [ticket]).some(f => f.key === 'publishAgreementTemplate'), 'only with a contract in use');
  assert.match(await fs.readFile('mobile/src/OnboardingTracker.tsx', 'utf8'), /\[\.\.\.agreementTemplateForms\(account, journey\), \.\.\.journeyForms\(account, journey\)\]/);
});

test('wiring: the routes, the Management centre view for admins, and the journey page', async () => {
  for (const kind of ['mobile', 'workspace']) assert.match(await fs.readFile(`app/api/${kind}/onboarding-settings/route.ts`, 'utf8'), /onboardingSettingsRoute\(request(, true)?\)/);
  const management = await fs.readFile('mobile/src/LiveManagement.tsx', 'utf8');
  assert.match(management, /\(v !== "onboarding" \|\| isWorkspaceAdmin\(account\.role\)\)/);
  assert.match(management, /\{view === "onboarding" && <OnboardingSettings p=\{p\} account=\{account\} \/>\}/);
  const pages = await fs.readFile('mobile/src/LivePages.tsx', 'utf8');
  assert.match(pages, /\[\.\.\.agreementTemplateForms\(account, j\), \.\.\.journeyForms\(account, j\)\]/);
  assert.match(pages, /agreementReadable\(j\.agreement, journeyAgreement\(j\)\.agreementFormat\)/);
  const screen = await fs.readFile('mobile/src/OnboardingSettings.tsx', 'utf8');
  assert.doesNotMatch(screen, /#[0-9a-fA-F]{3,8}\b|fontWeight: "700"|—/);
  for (const name of T.AGREEMENT_PLACEHOLDERS) assert.ok(T.PLACEHOLDER_HELP[name], name);
  const sql = await fs.readFile('supabase/migrations/20261020870000_agreement_template.sql', 'utf8');
  assert.ok(sql.includes(`array[${T.AGREEMENT_PLACEHOLDERS.map(n => `'${n}'`).join(',')}]`), 'the database lists the same placeholders');
});
