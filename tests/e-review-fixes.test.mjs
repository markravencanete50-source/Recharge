import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// Round 6, Session E's design review (docs/notes-session-E.md), the items routed to Session B:
// 5 no floating Favorites star on phones, 6 the phone header never covers the logo, 8 the enquiry card is a
// card, 10 the department strip uses the selected tokens, 12 no hard-coded white on the hero.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { phoneHeader, PHONE_HEADER } = await vite.ssrLoadModule('/lib/header-actions.ts');
const source = path => readFileSync(path, 'utf8');
const workspace = source('mobile/src/LiveWorkspace.tsx');

// The header row: Menu, bell and Messages always, the extras shown, and the avatar.
const rowWidth = n => n * (PHONE_HEADER.button + PHONE_HEADER.between) + PHONE_HEADER.avatar;
const used = (width, h) => PHONE_HEADER.padding + PHONE_HEADER.gap + h.logoWidth + rowWidth(3 + h.inHeader.length);

test('#6: at 390 px the header keeps Menu, the bell, Messages and the avatar, and the logo is not covered', () => {
  const superAdmin = phoneHeader(390, { search: true, viewAs: true });
  assert.deepEqual(superAdmin.inHeader, []);
  assert.deepEqual(superAdmin.inMenu, ['search', 'viewAs', 'refresh', 'theme'], 'the rest move to the top of the Menu');
  assert.ok(superAdmin.logoWidth >= PHONE_HEADER.logoMin);
  assert.ok(used(390, superAdmin) <= 390);
  const owner = phoneHeader(390, { search: false, viewAs: false });
  assert.deepEqual(owner.inMenu, ['refresh', 'theme']);
});

test('#6: the row always fits beside the logo, which keeps 88 px from 346 px up; wider phones get more buttons', () => {
  for (const has of [{ search: true, viewAs: true }, { search: true, viewAs: false }, { search: false, viewAs: false }]) {
    let before = -1;
    for (let width = 320; width < 1024; width += 2) {
      const h = phoneHeader(width, has);
      assert.ok(h.logoWidth <= PHONE_HEADER.logoMax, `${width}: logo ${h.logoWidth}`);
      if (width >= 346) assert.ok(h.logoWidth >= PHONE_HEADER.logoMin, `${width}: at least 88 px of logo`);
      if (width >= 330) assert.ok(used(width, h) <= width, `${width}: the row fits, so nothing covers the logo`);
      assert.ok(h.inHeader.length >= before, `${width}: never fewer buttons on a wider screen`);
      before = h.inHeader.length;
      assert.deepEqual([...h.inHeader, ...h.inMenu].sort(), [...(has.search ? ['search'] : []), ...(has.viewAs ? ['viewAs'] : []), 'refresh', 'theme'].sort(), 'each button once, in the header or the Menu');
    }
  }
  assert.deepEqual(phoneHeader(600, { search: true, viewAs: true }).inHeader, ['search', 'viewAs', 'refresh', 'theme']);
});

test('#6: the workspace uses the rule for the header and lists the rest in the Menu', () => {
  assert.match(workspace, /const phoneBar = phoneHeader\(width, \{ search: account\.role !== "client", viewAs: canViewAs\(realAccount\) \}\);/);
  assert.match(workspace, /const logoWidth = phoneBar\.logoWidth;/);
  for (const extra of ['search', 'viewAs', 'refresh', 'theme']) assert.match(workspace, new RegExp(`inHeader\\("${extra}"\\)`), extra);
  assert.match(workspace, /phoneBar\.inMenu\.map\(extra =>/);
  assert.doesNotMatch(workspace, /narrowHeader|headerButtons/);
});

test('#5: no floating Favorites star on phones, and no padding kept for it', () => {
  assert.doesNotMatch(workspace, /FavoritesShortcut|showFavorites|paddingBottom: 184/);
});

test('#8: the enquiry card is a surface card with one primary action', () => {
  const card = source('mobile/src/HomeOverview.tsx');
  const body = card.slice(card.indexOf('export function EnquiryCard('), card.indexOf('export function EnquiryCard(') + 2000);
  assert.match(body, /backgroundColor: p\.surface, borderWidth: 1, borderColor: p\.border/);
  assert.match(body, /backgroundColor: p\.wash, borderWidth: 1, borderColor: p\.washBorder/);
  assert.match(body, /backgroundColor: p\.primary \}\]\}>\s*<Feather name="plus" size=\{16\} color=\{p\.onPrimary\}/);
  assert.doesNotMatch(body, /#FFFFFF|#1F3D38/);
});

test('#10: the department strip (FilterBar) uses the selected tokens', () => {
  const bar = source('mobile/src/FilterBar.tsx');
  assert.match(bar, /backgroundColor: p\.selected,\s*borderWidth: 1,\s*borderColor: p\.selectedBorder,/);
  assert.match(bar, /color: selected === value \? p\.onSelected : p\.muted/);
  assert.doesNotMatch(bar, /p\.primary|p\.onPrimary/);
});

test('#12: no hard-coded white on the hero in RoleNavigation, LiveProductivity and LiveEnquiries', () => {
  for (const file of ['mobile/src/RoleNavigation.tsx', 'mobile/src/LiveProductivity.tsx', 'mobile/src/LiveEnquiries.tsx']) {
    const text = source(file);
    assert.doesNotMatch(text, /#FFFFFF|#fff\b|rgba\(255, ?255, ?255/i, file);
    assert.doesNotMatch(text, /"#1F3D38"|'#1F3D38'|"#A7D9C1"|'#A7D9C1'|"#7BE0A8"/, file + ': no brand colours written in');
  }
  assert.match(source('mobile/src/HeroWash.tsx'), /backgroundColor: p\.heroText, opacity: fill/);
});
