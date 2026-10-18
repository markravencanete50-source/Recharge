import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import zlib from 'node:zlib';
import { createServer } from 'vite';

// Agreements edited and signed (Lee: upload the agreement, edit its wording, and sign it with more than the full name;
// migration 20261024100000). The drawn signature is a 1-bit PNG made in lib/signature-png.ts, so a phone and the web
// make the same image; the owner's sign form offers it, the copy of the agreement shows it, and the team can upload a
// Word agreement at the agreement step to edit before publishing.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const S = await vite.ssrLoadModule('/lib/signature-png.ts');
const wf = await vite.ssrLoadModule('/lib/workflow-forms.ts');

test('a signature is a small, valid black-and-white PNG of the strokes', () => {
  const strokes = [Array.from({ length: 60 }, (_, i) => ({ x: 10 + i * 5, y: 50 + Math.sin(i / 5) * 25 }))];
  const url = S.signaturePng(strokes, 320, 120);
  assert.match(url, S.SIGNATURE_PATTERN);
  assert.ok(url.length < 40000, 'about 20 KB');
  const png = Buffer.from(url.slice(S.SIGNATURE_PREFIX.length), 'base64');
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.readUInt32BE(16), S.SIGNATURE_WIDTH);
  assert.equal(png.readUInt32BE(20), S.SIGNATURE_HEIGHT);
  assert.deepEqual([png[24], png[25]], [1, 0], '1 bit, greyscale');
  const at = png.indexOf('IDAT'), raw = zlib.inflateSync(png.subarray(at + 4, at + 4 + png.readUInt32BE(at - 4)));
  const row = S.SIGNATURE_WIDTH / 8 + 1;
  assert.equal(raw.length, row * S.SIGNATURE_HEIGHT);
  let ink = 0;
  for (let y = 0; y < S.SIGNATURE_HEIGHT; y++) for (let x = 1; x < row; x++) ink += 8 - raw[y * row + x].toString(2).replace(/0/g, '').length;
  assert.ok(ink > 500, 'the strokes are drawn');
  assert.equal(S.base64(new Uint8Array([1, 2, 3, 4])), Buffer.from([1, 2, 3, 4]).toString('base64'));
});

test('a tap is not a signature; the form sends the drawing only when there is one', () => {
  assert.equal(S.hasSignature([[{ x: 1, y: 1 }]]), false);
  assert.equal(S.hasSignature([[{ x: 0, y: 0 }, { x: 60, y: 0 }]]), true);
  const field = { name: 'signatureImage', label: 'Your signature', type: 'signature', required: false };
  assert.deepEqual(wf.workflowValues([field], { signatureImage: '' }), {});
  assert.deepEqual(wf.workflowValues([field], { signatureImage: 'data:image/png;base64,AAAA' }), { signatureImage: 'data:image/png;base64,AAAA' });
  assert.deepEqual(wf.workflowIssues({ fields: [{ ...field, required: true }] }, {}), [{ field: 'signatureImage', message: 'Draw your signature in the box' }]);
});

test('the owner\'s sign form offers the drawing; the team\'s publish form takes an uploaded Word agreement', () => {
  const owner = { role: 'client', userId: 'c1', modules: ['property-onboarding'] }, team = { role: 'stays', userId: 's1', modules: ['property-onboarding'] };
  const j = { propertyId: 'b17c38b7-db8f-4b01-bd57-1f3961f51283', clientId: 'c1', workId: 'f9f072d8-706d-4d10-8826-710a3c6eeb27', stage: 'agreement', version: 4, agreement: 'Agreed terms for the property.', agreementRevision: 2, signedName: null };
  const sign = wf.journeyForms(owner, j).find(f => f.key === 'signAgreement');
  assert.deepEqual(sign.fields.map(f => [f.name, f.type ?? 'text']), [['signedName', 'text'], ['signatureImage', 'signature'], ['consent', 'checkbox']]);
  assert.deepEqual(sign.build({ signedName: 'Olive', signatureImage: 'data:image/png;base64,AAAA', consent: true }), { action: 'signAgreement', propertyId: j.propertyId, version: 4, signedName: 'Olive', signatureImage: 'data:image/png;base64,AAAA', consent: true, agreementRevision: 2 });
  const publish = wf.journeyForms(team, { ...j, clientId: null }).find(f => f.key === 'publishAgreement');
  assert.equal(publish.fields[0].type, 'document');
  assert.deepEqual(publish.build({ agreement: '# Terms\n\nAll of them.' }), { action: 'publishAgreement', propertyId: j.propertyId, version: 4, agreement: '# Terms\n\nAll of them.', format: 'outline' });
});

test('wiring: the pad in the form, the drawing on the agreement, the Word upload, and the larger journey requests', async () => {
  const pages = await fs.readFile('mobile/src/LivePages.tsx', 'utf8');
  assert.match(pages, /f\.type === "signature" \? <Stagger key=\{f\.name\} index=\{n\}><SignaturePad /);
  assert.match(pages, /signatureImage: a\.signatureImage \?\? null/);
  assert.match(pages, /f\.type === "document" && <DocumentText /);
  assert.match(await fs.readFile('mobile/src/SignaturePad.tsx', 'utf8'), /Clear signature/);
  assert.match(await fs.readFile('mobile/src/backend/client.ts', 'utf8'), /form\.append\('read', '1'\)/);
  const server = await fs.readFile('lib/agreement-template-server.ts', 'utf8');
  assert.match(server, /if \(form\.has\('read'\)\)/);
  assert.match(server, /PDF_WORDING_MESSAGE/);
  assert.match(await fs.readFile('lib/journey-server.ts', 'utf8'), /boundedJson\(request,kind==='journey'\?JOURNEY_BODY_LIMIT:16_384\)/);
  for (const f of ['lib/signature-png.ts', 'mobile/src/SignaturePad.tsx', 'supabase/migrations/20261024100000_agreement_signature.sql']) assert.doesNotMatch(await fs.readFile(f, 'utf8'), /—/);
});

test('the owner\'s Mailbox: "Recharge sent the management agreement", waiting ones first, with when it was sent and signed', async () => {
  const { ownerMailboxDocuments } = await vite.ssrLoadModule('/lib/owner-approvals.ts');
  const base = { clientId: 'c1', workId: 'w', version: 1, agreement: 'Terms.', agreementRevision: 1, signedName: null };
  const journeys = [
    { ...base, propertyId: 'p1', stage: 'form', signedName: 'Olive Owner', signedAt: '2026-10-10T10:00:00Z', agreementSentAt: '2026-10-08T09:00:00Z' },
    { ...base, propertyId: 'p2', stage: 'agreement', agreementRevision: 2, agreementSentAt: '2026-10-17T15:00:00Z' },
    { ...base, propertyId: 'p3', stage: 'estimate', agreement: '', agreementRevision: 0 },
    { ...base, propertyId: 'p4', clientId: 'someone-else', stage: 'agreement' },
  ];
  const docs = ownerMailboxDocuments({ userId: 'c1' }, journeys, [{ id: 'p1', name: 'Harbour Flat' }, { id: 'p2', name: 'Shore Road' }]);
  assert.deepEqual(docs.map(d => [d.propertyId, d.title, d.detail, d.toSign]), [
    ['p2', 'Recharge sent the management agreement for Shore Road', 'Sent 17 October 2026 · revision 2 · Waiting for your signature', true],
    ['p1', 'Recharge sent the management agreement for Harbour Flat', 'Sent 8 October 2026 · revision 1 · Signed by Olive Owner on 10 October 2026', false],
  ]);
});
