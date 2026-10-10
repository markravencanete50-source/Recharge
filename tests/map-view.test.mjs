import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// Moving around the portfolio map: pan, zoom about a point, full screen on a wide box, and the Google Maps link.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { MAP_WIDTH, MAP_HEIGHT, MIN_VIEW_WIDTH, clampView, wholeView, fitView, zoomAt, panBy, googleMapsLink } = await vite.ssrLoadModule('/lib/scotland-map.ts');
after(() => vite.close());
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);

test('zooming keeps the point under the pointer still, and stops at street level and at all of Scotland', () => {
  const v = wholeView();
  assert.deepEqual(v, { x: 0, y: 0, w: MAP_WIDTH, h: MAP_HEIGHT });
  const z = zoomAt(v, 2, 0.25, 0.75);
  close(z.w, MAP_WIDTH / 2);
  close(z.x + 0.25 * z.w, v.x + 0.25 * v.w);
  close(z.y + 0.75 * z.h, v.y + 0.75 * v.h);
  assert.equal(zoomAt(v, 1e6).w, MIN_VIEW_WIDTH);
  assert.deepEqual(zoomAt(z, 1e-6), v, 'zooming far out shows all of Scotland, never more');
});

test('dragging moves the map with the finger, never off the map', () => {
  const z = zoomAt(wholeView(), 4);
  const moved = panBy(z, 100, 0, 300);
  close(moved.x, z.x - 100 * (z.w / 300));
  assert.equal(panBy(z, 1e6, 1e6, 300).x, 0);
  assert.equal(panBy(z, -1e6, -1e6, 300).y, MAP_HEIGHT - z.h);
});

test('on a wide screen the whole of Scotland is centred with sea at the sides', () => {
  const aspect = 9 / 16, v = wholeView(aspect);
  close(v.h, MAP_HEIGHT); close(v.w, MAP_HEIGHT / aspect);
  close(v.x, (MAP_WIDTH - v.w) / 2); close(v.y, 0);
  const area = fitView({ x: 200, y: 400, w: 100, h: 100 * MAP_HEIGHT / MAP_WIDTH }, aspect);
  close(area.h / area.w, aspect);
  close(area.x + area.w / 2, 250);
  assert.deepEqual(clampView(area, aspect), area);
});

test('Google Maps opens at the address when there is one, otherwise the map position', () => {
  assert.equal(googleMapsLink({ lat: 55.97, lon: -3.18, address: '12 Leith Walk, Edinburgh EH6 5AB' }), 'https://www.google.com/maps/search/?api=1&query=12%20Leith%20Walk%2C%20Edinburgh%20EH6%205AB');
  assert.equal(googleMapsLink({ lat: 55.97, lon: -3.18 }), 'https://www.google.com/maps/search/?api=1&query=55.97000%2C-3.18000');
});
