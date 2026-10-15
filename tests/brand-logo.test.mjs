import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

// The final Recharge logo (Lee, 15 October 2026: "make sure to use the new logo moving forward"). docs/BRAND.md
// lists every file. This fails if the earlier bold logo, the old favicon or Expo's placeholder icons come back.
const md5 = path => createHash('md5').update(readFileSync(path)).digest('hex');
const OLD = new Set([
  // the earlier bold logo and Expo's placeholder art, as they were before 15 October 2026
  '1e097dab989759fc0b69440092ca22cd', '2d65569cc0e2afdcea0af9f9902d4173', '4084d19d3548d373ae142bb83c5eada6', '64860264e29ab8d5438f09f5eea024d0',
  '72e71a9c846c6aa4ae32476641a00e18', '811896a2876369362a2a3b94d545810d', '890da19ae30625e95acb9331cc1ab1c7', '97dae5a0e62ad8551d8a31897b425e63',
  'cb975bba2216ce10a60e6c0ffe9941a2', 'e66ac92218980b7d0529a8a3d29ee2ad', 'e7232b3b76dcccc34ce5fde7e381f3b7',
]);

test('the brand guide names the final logo and every file made from it', () => {
  const doc = readFileSync('docs/BRAND.md', 'utf8');
  for (const name of ['recharge-logo-light.png', 'recharge-logo-dark.png', 'public/recharge-company-logo.png', 'public/recharge-company-logo-dark.png',
    'public/recharge-email-logo.png', 'public/favicon.svg', 'mobile/assets/favicon.png', 'public/recharge-wordmark.svg', 'mobile/assets/icon.png',
    'splash-icon-dark.png', 'docs/brand-logo-on-cream.jpg', 'docs/brand-logo-on-forest.jpg'])
    assert.ok(doc.includes(name), name);
  readFileSync('docs/brand-logo-on-cream.jpg'); readFileSync('docs/brand-logo-on-forest.jpg');
});

test('the logo files are the final artwork, not the earlier ones', () => {
  const files = ['mobile/assets/brand/recharge-logo-light.png', 'mobile/assets/brand/recharge-logo-dark.png', 'public/recharge-company-logo.png',
    'public/recharge-company-logo-dark.png', 'public/recharge-email-logo.png', 'mobile/assets/icon.png', 'mobile/assets/splash-icon.png',
    'mobile/assets/android-icon-foreground.png', 'mobile/assets/android-icon-background.png', 'mobile/assets/android-icon-monochrome.png', 'mobile/assets/favicon.png'];
  for (const file of files) assert.ok(!OLD.has(md5(file)), file + ' is the earlier artwork');
  // The old favicon and wordmark were drawn with thick strokes; the final ones carry the supplied line art.
  for (const svg of ['public/favicon.svg', 'public/recharge-wordmark.svg']) {
    const text = readFileSync(svg, 'utf8');
    assert.ok(text.includes('data:image/png;base64,') && !/stroke-width="(5|14)"/.test(text), svg);
  }
});

test('the phone app uses the Recharge icon and splash, not Expo placeholders', () => {
  const { expo } = JSON.parse(readFileSync('mobile/app.json', 'utf8'));
  assert.equal(expo.icon, './assets/icon.png');
  assert.equal(expo.android.adaptiveIcon.backgroundColor, '#1B3E38');
  const splash = expo.plugins.find(p => Array.isArray(p) && p[0] === 'expo-splash-screen')[1];
  assert.equal(splash.image, './assets/splash-icon.png');
  assert.equal(splash.dark.image, './assets/splash-icon-dark.png');
});
