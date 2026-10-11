import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// The profile photo crop: the photo always covers the round frame, drags and zooms stay inside
// the photo, and the saved square is exactly what the frame showed.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const c = await vite.ssrLoadModule('/lib/photo-crop.ts');
after(() => vite.close());
const wide = { width: 1600, height: 1000 }, tall = { width: 900, height: 1800 }, F = 260;
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg}: ${a} vs ${b}`);

test('starts centred, with the shorter side filling the frame', () => {
  const v = c.centredView(wide, F);
  close(c.coverScale(wide, F), 0.26, 'scale'); close(v.y, 0, 'no gap top or bottom'); close(v.x, (F - 1600 * 0.26) / 2, 'centred across');
  assert.deepEqual(c.cropRect(v, wide, F), { sx: 300, sy: 0, size: 1000 }, 'the middle square of the photo');
  const t = c.cropRect(c.centredView(tall, F), tall, F);
  close(t.sx, 0, 'tall x'); close(t.sy, 450, 'tall y'); close(t.size, 900, 'tall size');
});

test('dragging stops at the edges, so no empty space ever shows', () => {
  let v = c.moveView(c.centredView(wide, F), 5000, 5000, wide, F);
  close(v.x, 0, 'left edge'); close(v.y, 0, 'top edge');
  assert.deepEqual(c.cropRect(v, wide, F), { sx: 0, sy: 0, size: 1000 });
  v = c.moveView(v, -5000, -5000, wide, F);
  assert.deepEqual(c.cropRect(v, wide, F), { sx: 600, sy: 0, size: 1000 }, 'right edge');
});

test('zooming keeps the middle on the same spot, within 1x to 4x', () => {
  const start = c.centredView(wide, F);
  const z = c.zoomView(start, 2, wide, F);
  assert.equal(z.zoom, 2);
  const r = c.cropRect(z, wide, F);
  close(r.size, 500, 'half the size at 2x'); close(r.sx + r.size / 2, 800, 'same middle across'); close(r.sy + r.size / 2, 500, 'same middle down');
  assert.equal(c.zoomView(start, 10, wide, F).zoom, 4); assert.equal(c.zoomView(start, 0.2, wide, F).zoom, 1); assert.equal(c.clampZoom(NaN), 1);
  // Zoomed into a corner, then zoomed back out: still covering the frame.
  const corner = c.moveView(c.zoomView(start, 4, wide, F), 9999, 9999, wide, F);
  const out = c.zoomView(corner, 1, wide, F);
  assert.ok(out.x <= 0 && out.y <= 0 && out.x >= F - 1600 * 0.26 && out.y >= F - 1000 * 0.26);
  const rect = c.cropRect(out, wide, F);
  assert.ok(rect.sx >= 0 && rect.sy >= 0 && rect.sx + rect.size <= 1600 + 1e-6 && rect.sy + rect.size <= 1000 + 1e-6);
});
