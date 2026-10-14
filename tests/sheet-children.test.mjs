import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createElement, Fragment } from 'react';
import { createServer } from 'vite';

// A sheet spaces its blocks 16px apart (Sheet in mobile/src/TeamFlows.tsx). A body passed as a fragment,
// as in `{target && <>…</>}` (the Rejected clean sheet), must be spaced like direct children.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, logLevel: 'error' });
const { flattenSheetChildren } = await vite.ssrLoadModule('/lib/sheet-children.ts');
await vite.close();
const el = (name, key) => createElement('div', key == null ? { id: name } : { id: name, key });
const ids = list => list.map(x => x.node.props.id);

test("a fragment's children are spaced like direct children", () => {
  const direct = flattenSheetChildren([el('why'), el('side'), el('photos')]);
  const wrapped = flattenSheetChildren(createElement(Fragment, null, el('why'), el('side'), el('photos')));
  assert.deepEqual(ids(wrapped), ids(direct));
  assert.equal(wrapped.length, 3, 'three blocks, so the gap applies twice');
});

test('nested fragments and arrays open up; empty slots are dropped', () => {
  const target = true, loading = false;
  const body = [target && createElement(Fragment, null, el('intro'), loading && el('loading'), [el('a', 'a'), el('b', 'b')], createElement(Fragment, null, el('inner1'), null, el('inner2')), '', undefined)];
  assert.deepEqual(ids(flattenSheetChildren(body)), ['intro', 'a', 'b', 'inner1', 'inner2']);
  assert.deepEqual(flattenSheetChildren(false && el('x')), []);
  assert.deepEqual(flattenSheetChildren(null), []);
  // Text and numbers stay (as Children.toArray kept them).
  assert.deepEqual(flattenSheetChildren(['Hello', 3]).map(x => x.node), ['Hello', 3]);
});

test('keys are stable and unique: own keys kept, positions otherwise, prefixed by the fragment they sat in', () => {
  const list = flattenSheetChildren([el('first'), createElement(Fragment, { key: 'f' }, el('x', 'x'), el('y')), el('last', 'last')]);
  assert.deepEqual(list.map(x => x.key), ['i0', 'kf.kx', 'kf.i1', 'klast']);
  assert.equal(new Set(list.map(x => x.key)).size, list.length);
  const again = flattenSheetChildren([el('first'), createElement(Fragment, { key: 'f' }, el('x', 'x'), el('y')), el('last', 'last')]);
  assert.deepEqual(again.map(x => x.key), list.map(x => x.key), 'the same body gives the same keys');
});

test('Sheet staggers every flattened child with the section gap (20px) and 20px padding', () => {
  const flows = readFileSync('mobile/src/TeamFlows.tsx', 'utf8');
  assert.match(flows, /flattenSheetChildren\(content\.children\)\.map\(\(\{ key, node \}, n\) => <Stagger key=\{key\} index=\{n\}>/);
  assert.match(flows, /contentContainerStyle=\{\{ padding: 20, gap: space\.section,/);
  assert.doesNotMatch(flows, /Children\.toArray\(content\.children\)/);
});
