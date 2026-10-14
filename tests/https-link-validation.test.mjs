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
  assert.equal(validationReason(bad.error), 'Url: ' + MESSAGE);
  const event = cases['portfolio recordLocalEvent sourceUrl']('Test');
  assert.equal(validationReason(event.error), 'Source url: ' + MESSAGE);
  const server = readFileSync('lib/portfolio-server.ts', 'utf8');
  assert.match(server, /portfolioActionSchema\.safeParse\(await boundedJson\(request\)\);\r?\n\s*if\(!parsed\.success\)return businessResponse\(\{error:validationReason\(parsed\.error\)\},400\);/);
  // No refine anywhere in lib calls new URL without a try.
  for (const file of ['lib/journey-policy.ts', 'lib/portfolio-policy.ts'])
    assert.doesNotMatch(readFileSync(file, 'utf8'), /refine\(v=>new URL/, file);
});
