import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const nav = readFileSync(new URL('../mobile/src/RoleNavigation.tsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../lib/design-tokens.ts', import.meta.url), 'utf8');

test('the desktop left panel scrolls without a mouse wheel', () => {
  // The scroll bar shows on the web, so it can be dragged with a trackpad or touch.
  assert.match(nav, /testID="sidebar-scroll"[^>]*showsVerticalScrollIndicator=\{Platform\.OS==='web'\}/);
  assert.doesNotMatch(nav, /<ScrollView[^>]*showsVerticalScrollIndicator=\{false\}/);
  // Arrow buttons page the menu up and down while there is more beyond the edge.
  assert.match(nav, /accessibilityLabel=\{dir>0\?'Scroll the menu down':'Scroll the menu up'\}/);
  assert.match(nav, /\{below&&arrow\(1\)\}/);
  assert.match(nav, /\{above&&arrow\(-1\)\}/);
  assert.match(css, /\[data-testid="sidebar-scroll"\]::-webkit-scrollbar\{width:10px\}/);
});
