import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// The redesigned management agreement (Lee, 19 October 2026: "use the wordings but redesign the template"): the Word
// template in docs/ uses the approved wording with the app's placeholders, reads cleanly through the app's own Word
// reader, and the saved copy of an agreement (lib/agreement-copy.ts) has the Recharge letterhead and hanging clause numbers.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { docxOutline } = await vite.ssrLoadModule('/lib/docx-text.ts');
const { agreementDocument, outlineBlocks, AGREEMENT_LETTERHEAD } = await vite.ssrLoadModule('/lib/agreement-copy.ts');
const { AGREEMENT_PLACEHOLDERS } = await vite.ssrLoadModule('/lib/agreement-template.ts');

test('the Word template: the approved wording, only placeholders the app can fill, headings, clauses and bullets', async () => {
  const text = await docxOutline(new Uint8Array(readFileSync('docs/Recharge-Management-Agreement-Template.docx')));
  const used = [...new Set(text.match(/\{\{[^}]+\}\}/g))].map(t => t.slice(2, -2));
  assert.ok(used.length >= 5, 'the details are placeholders, not typed in');
  for (const name of used) assert.ok(AGREEMENT_PLACEHOLDERS.includes(name), `${name} is a placeholder the database fills`);
  for (const name of ['Owner name', 'Company name', 'Property address', 'Management fee', 'Start date']) assert.ok(used.includes(name), name);
  const headings = text.split('\n\n').filter(b => b.startsWith('# ')).map(b => b.slice(2));
  assert.deepEqual(headings.slice(1), ['1. Appointment & Scope of Services', '2. Management Fee & Payment Terms', '3. Costs and Expenses', '4. Term & Termination', '5. Compliance & Legal Responsibilities',
    '6. Guest Damage & Liability', '7. Indemnity', '8. Insurance', '9. Confidentiality', '10. Governing Law & Jurisdiction', 'Acceptance of Terms']);
  assert.match(headings[0], /^SHORT-TERM LET MANAGEMENT AGREEMENT/);
  for (const clause of ['1.1', '1.2', '2.1', '2.2', '2.3', '3.1', '3.2', '4.1', '4.2', '4.3', '5.1', '5.2', '6.1', '6.2', '7.1', '8.1', '9.1', '10.1', '10.2'])
    assert.match(text, new RegExp(`(^|\\n)${clause.replace('.', '\\.')} [A-Z]`), 'clause ' + clause);
  assert.equal(text.split('\n').filter(l => l.startsWith('- ')).length, 18, 'the nine services and the nine certificates are bullet points');
  assert.match(text, /Governed by|governed by and construed in accordance with the laws of Scotland/);
  assert.match(text, /90 days’ notice/);
  assert.doesNotMatch(text, /—/, 'no em dashes');
  assert.doesNotMatch(text, /\b\d{2}\/\d{2}\/\d{2,4}\b/, 'no numeric dates left from the sample');
});

test('the saved copy: Recharge letterhead, hanging clause numbers, signature box and print layout', () => {
  const html = agreementDocument({ propertyName: 'Flat 1', agreement: '# 1. Appointment\n\n1.1 The Client appoints the Manager.\nSecond line.\n\n1.2 Services:\n\n- Guests\n- Bookings', revision: 1, signedName: 'Olive Owner', signedAt: '2026-10-14T10:00:00Z', format: 'outline' });
  assert.match(html, new RegExp(`<div class="letterhead"><div><b>${AGREEMENT_LETTERHEAD.name}</b>`));
  assert.match(html, /<h2>1\. Appointment<\/h2>/);
  assert.match(html, /<p class="clause"><span class="no">1\.1<\/span><span>The Client appoints the Manager\.<br>Second line\.<\/span><\/p>/);
  assert.match(html, /<ul><li>Guests<\/li><li>Bookings<\/li><\/ul>/);
  assert.match(html, /<b>Status<\/b>Signed 14 October 2026<\/div>/);
  assert.match(html, /@page\{size:A4/);
  assert.match(html, /@media print\{\.print\{display:none\}/);
  assert.doesNotMatch(html, /gradient/i, 'no gradients');
  assert.deepEqual(outlineBlocks('1.1 A clause').map(b => b.kind), ['p']);
  const typed = agreementDocument({ propertyName: 'Flat', agreement: '1.1 Typed text stays a plain paragraph.', revision: 1, signedName: null, signedAt: null });
  assert.match(typed, /<p>1\.1 Typed text stays a plain paragraph\.<\/p>/);
  assert.match(typed, /<b>Status<\/b>Awaiting signature/);
});

test('the touched files keep CRLF and have no em dash', () => {
  const text = readFileSync('lib/agreement-copy.ts', 'utf8');
  assert.doesNotMatch(text.replace(/\r\n/g, ''), /\n/);
  assert.doesNotMatch(text, /—/);
});
