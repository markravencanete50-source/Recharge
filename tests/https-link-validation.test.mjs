import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// Hotfix (Lee, live): typing "Test" into "Comparable 1 HTTPS link" and saving showed "The property journey is temporarily
// unavailable" (a 503). The https refine ran new URL('Test') after .url() had already failed, and the TypeError escaped
// safeParse into the route's catch. A bad link must now fail validation with a field message (a 400), never throw.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { journeyActionSchema, enquiryDetailsSchema } = await vite.ssrLoadModule('/lib/journey-policy.ts');
const { portfolioActionSchema } = await vite.ssrLoadModule('/lib/portfolio-policy.ts');
const { validationReason } = await vite.ssrLoadModule('/lib/operations-policy.ts');
const { journeyValidationReason } = await vite.ssrLoadModule('/lib/journey-policy.ts');
const { journeyForms, workflowValues } = await vite.ssrLoadModule('/lib/workflow-forms.ts');
const R = '11111111-1111-4111-8111-111111111111', P = '22222222-2222-4222-8222-222222222222';
const MESSAGE = 'The link must start with https://';

const cases = {
  'journey publishEstimate comparables url': url => journeyActionSchema.safeParse({ action: 'publishEstimate', requestId: R, propertyId: P, version: 1, lowRateMinor: 9000, mediumRateMinor: 11000, highRateMinor: 14000, comparables: [{ name: 'Comparable 1', url, adrMinor: 12000 }] }),
  'journey enquiry photoLink': url => enquiryDetailsSchema.safeParse({ photoLink: url }),
  'journey makeLive listingLinks': url => journeyActionSchema.safeParse({ action: 'makeLive', requestId: R, propertyId: P, version: 1, listingLinks: [{ platform: 'Airbnb', url }] }),
  'portfolio recordLocalEvent sourceUrl': url => portfolioActionSchema.safeParse({ action: 'recordLocalEvent', requestId: R, propertyId: P, name: 'Highland Games', eventOn: '2026-11-08', sourceUrl: url, opportunity: 'Big crowds that weekend.' }),
};

for (const [name, parse] of Object.entries(cases)) {
  test(name + ': a non-link or an http:// link is refused with a message, never thrown', () => {
    for (const bad of ['Test', 'http://example.com/listing', 'example.com', 'https//missing-colon', '']) {
      if (bad === '' && name.endsWith('photoLink')) continue; // an empty photo link means "none"
      let result;
      assert.doesNotThrow(() => { result = parse(bad); }, `${name}: ${JSON.stringify(bad)}`);
      assert.equal(result.success, false, `${name}: ${JSON.stringify(bad)}`);
      assert.ok(result.error.issues.some(i => i.message === MESSAGE), `${name}: ${JSON.stringify(bad)} → ${JSON.stringify(result.error.issues)}`);
    }
    assert.equal(parse('https://www.airbnb.co.uk/rooms/123').success, true, name + ': an https link is accepted');
  });
}

test('the routes answer a bad link with a 400 that names the problem', () => {
  const bad = cases['journey publishEstimate comparables url']('Test');
  assert.equal(journeyValidationReason(bad.error), 'Comparable 1 link: ' + MESSAGE);
  assert.equal(journeyValidationReason(cases['journey makeLive listingLinks']('Test').error), 'Listing link 1: ' + MESSAGE);
  const server = readFileSync('lib/journey-server.ts', 'utf8');
  assert.match(server, /error:kind==='journey'\?journeyValidationReason\(parsed\.error\):validationReason\(parsed\.error\)/);
  const event = cases['portfolio recordLocalEvent sourceUrl']('Test');
  assert.equal(validationReason(event.error), 'Source url: ' + MESSAGE);
  const portfolio = readFileSync('lib/portfolio-server.ts', 'utf8');
  assert.match(portfolio, /portfolioActionSchema\.safeParse\(await boundedJson\(request\)\);\r?\n\s*if\(!parsed\.success\)return businessResponse\(\{error:validationReason\(parsed\.error\)\},400\);/);
  // No refine anywhere in lib calls new URL without a try.
  for (const file of ['lib/journey-policy.ts', 'lib/portfolio-policy.ts'])
    assert.doesNotMatch(readFileSync(file, 'utf8'), /refine\(v=>new URL/, file);
});

// Lee's second try: the link typed into "Comparable 1 name" with the link field empty. The form sent the comparable with no
// url, which hit the same throw. Each comparable is all three fields or none, checked in the form and again on the server.
const estimate = comparables => journeyActionSchema.safeParse({ action: 'publishEstimate', requestId: R, propertyId: P, version: 1, lowRateMinor: 9000, mediumRateMinor: 11000, highRateMinor: 14000, comparables });
const reason = comparables => { let r; assert.doesNotThrow(() => { r = estimate(comparables); }); assert.equal(r.success, false); return journeyValidationReason(r.error); };

test('the server names the comparable and the field in plain words', () => {
  assert.equal(reason([{ name: 'https://www.airbnb.co.uk/rooms/1', adrMinor: 12000 }]), 'Comparable 1 name: Put the link in the link field');
  assert.equal(reason([{ name: 'Harbour flat', adrMinor: 12000 }]), 'Comparable 1 link: ' + MESSAGE, 'no url at all');
  assert.equal(reason([{ name: 'Harbour flat', url: '', adrMinor: 12000 }]), 'Comparable 1 link: ' + MESSAGE, 'an empty url');
  assert.equal(reason([{ name: 'Harbour flat', url: 'https://example.com/1', adrMinor: 12000 }, { name: 'Shore flat', url: 'https://example.com/2' }]), 'Comparable 2 nightly rate: Add the nightly rate');
  assert.equal(reason([{ name: '', url: 'https://example.com/1', adrMinor: 12000 }]), 'Comparable 1 name: Add the name');
  assert.equal(estimate([{ name: 'Harbour flat', url: 'https://example.com/1', adrMinor: 12000 }]).success, true);
  assert.equal(estimate([]).success, true, 'no comparables is fine');
});

test('the estimate form checks each comparable before sending', () => {
  const admin = { userId: '11111111-1111-4111-8111-111111111111', role: 'admin', modules: [] };
  const j = { propertyId: P, clientId: '33333333-3333-4333-8333-333333333333', workId: '44444444-4444-4444-8444-444444444444', stage: 'enquiry', version: 2, agreement: '', agreementRevision: 0, signedName: null, inspectionReport: null, invoiceId: null, estimate: null, form: null };
  const form = journeyForms(admin, j).find(f => f.key === 'publishEstimate');
  const rates = { lowRateMinor: '100', mediumRateMinor: '120', highRateMinor: '150' };
  const build = extra => form.build(workflowValues(form.fields, { ...rates, ...extra }), 'r');
  const ALL_THREE = 'add the name, an https:// link and the nightly rate, or leave all three empty';
  assert.deepEqual(build({}).comparables, [], 'all empty: none sent');
  assert.throws(() => build({ name0: 'https://www.airbnb.co.uk/rooms/1' }), { message: 'Comparable 1 name: Put the link in the link field' }, "Lee's second try");
  assert.throws(() => build({ name0: 'Harbour flat' }), { message: 'Comparable 1: ' + ALL_THREE });
  assert.throws(() => build({ url1: 'https://example.com/2' }), { message: 'Comparable 2: ' + ALL_THREE });
  assert.throws(() => build({ adrMinor2: '120' }), { message: 'Comparable 3: ' + ALL_THREE });
  assert.throws(() => build({ name0: 'Harbour flat', url0: 'Test', adrMinor0: '120' }), { message: 'Comparable 1 link: ' + MESSAGE }, "Lee's first try");
  assert.throws(() => build({ name0: 'Harbour flat', url0: 'http://example.com/1', adrMinor0: '120' }), { message: 'Comparable 1 link: ' + MESSAGE });
  const body = build({ name0: ' Harbour flat ', url0: 'https://example.com/1', adrMinor0: '120', name2: 'Shore flat', url2: 'https://example.com/3', adrMinor2: '95.50' });
  assert.deepEqual(body.comparables, [{ name: 'Harbour flat', url: 'https://example.com/1', adrMinor: 12000 }, { name: 'Shore flat', url: 'https://example.com/3', adrMinor: 9550 }]);
  assert.equal(estimate(body.comparables).success, true, 'what the form sends, the server accepts');
  // The form still labels each comparable field optional (layout and wording of the labels are another developer's next batch).
  assert.ok(form.fields.filter(f => /^(name|url|adrMinor)\d$/.test(f.name)).every(f => !f.required));
});
