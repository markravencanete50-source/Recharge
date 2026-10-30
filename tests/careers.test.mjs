import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'vite';

// Careers helpers (lib/careers.ts): CVs are read from their first bytes, answers are checked like the database does, and
// every careers email comes from careers@ with the response promise and the link to the account.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const C = await vite.ssrLoadModule('/lib/careers.ts');
after(() => vite.close());

test('a CV is a PDF or Word file by its bytes, whatever its name', () => {
  const bytes = (...b) => new Uint8Array([...b, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(C.cvFileType(bytes(0x25, 0x50, 0x44, 0x46, 0x2d)).ext, 'pdf');
  assert.equal(C.cvFileType(bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1)).ext, 'doc');
  assert.equal(C.cvFileType(bytes(0x50, 0x4b, 0x03, 0x04)).ext, 'docx');
  assert.equal(C.cvFileType(bytes(0xff, 0xd8, 0xff)), null);
  assert.equal(C.cvFileType(new TextEncoder().encode('<html>')), null);
});

test('answers: required ones, yes or no, and numbers', () => {
  const qs = [{ id: 'q1', label: 'Pay?', kind: 'long', required: true }, { id: 'q2', label: 'Drive?', kind: 'yes_no', required: false }, { id: 'q3', label: 'Years?', kind: 'number', required: false }];
  assert.deepEqual(C.answersProblem(qs, {}), { id: 'q1', message: 'Please answer this question' });
  assert.deepEqual(C.answersProblem(qs, { q1: 'x', q2: 'maybe' }), { id: 'q2', message: 'Answer yes or no' });
  assert.deepEqual(C.answersProblem(qs, { q1: 'x', q3: 'ten' }), { id: 'q3', message: 'Answer with a number' });
  assert.equal(C.answersProblem(qs, { q1: 'x', q2: 'Yes', q3: '2.5' }), null);
  assert.equal(C.applicationSchema.safeParse({ vacancyId: crypto.randomUUID(), fullName: 'A', email: 'a@b.co', phone: '0770090', answers: {}, otherRoles: false }).success, false);
});

test('each careers email names the role, links to the account and is signed from careers@', () => {
  const job = { id: crypto.randomUUID(), kind: 'received', to: 'ann@example.com', name: 'Ann Able', title: 'Housekeeper', candidateId: crypto.randomUUID(), hasAccount: false, interviewExpiresAt: null, interviewMode: null };
  for (const kind of C.CAREERS_EMAIL_KINDS) {
    const mail = C.careersEmail({ ...job, kind }, { url: 'https://app.example/careers/account?t=a"b', label: 'Create your account' });
    assert.match(mail.subject, /Housekeeper/);
    assert.match(mail.text, /^Hi Ann,/);
    assert.match(mail.html, /careers@rechargegroup\.co\.uk/);
    assert.doesNotMatch(mail.html, /a"b/);
  }
  assert.match(C.careersEmail(job, { url: 'https://x', label: 'Go' }).text, /within 14 working days/);
  assert.match(C.careersEmail({ ...job, kind: 'interview', interviewMode: 'in_person', interviewExpiresAt: '2026-11-03T12:00:00Z' }, { url: 'https://x', label: 'Go' }).text, /interview in person.*by Tuesday 3 November/);
});

test('the careers emails go out from the Worker every minute and only through careers@', async () => {
  const worker = (await fs.readFile('worker/index.ts', 'utf8')).replace(/\r\n/g, '\n');
  assert.match(worker, /import\('\.\.\/lib\/careers-email-server'\)\.then\(module => module\.runCareersEmails\(\)\)/);
  const server = await fs.readFile('lib/careers-email-server.ts', 'utf8');
  assert.match(server, /from: CAREERS_FROM, replyTo: CAREERS_ADDRESS, idempotencyKey: `recharge-careers\/\$\{job\.id\}`/);
  assert.doesNotMatch(server, /guestrelations@|ownerrelations@/);
});
