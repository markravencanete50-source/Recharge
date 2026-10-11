import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// Uploads are read with a size cap that holds with or without an honest Content-Length.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { boundedFormData } = await vite.ssrLoadModule('/lib/bounded-form.ts');
after(() => vite.close());

const multipart = (bytes, { length = true, stream = false } = {}) => {
  const form = new FormData(); form.append('file', new Blob([new Uint8Array(bytes)]), 'a.jpg');
  const encoded = new Response(form);
  return encoded.arrayBuffer().then(body => {
    const headers = { 'Content-Type': encoded.headers.get('Content-Type') };
    if (length) headers['Content-Length'] = String(body.byteLength);
    const sent = stream ? new ReadableStream({ start(c) { c.enqueue(new Uint8Array(body)); c.close(); } }) : body;
    return new Request('https://example.test/upload', { method: 'POST', headers, body: sent, ...(stream ? { duplex: 'half' } : {}) });
  });
};

test('a file within the cap is read', async () => {
  const form = await boundedFormData(await multipart(1000), 5000);
  assert.ok(form instanceof FormData);
  assert.equal(form.get('file').size, 1000);
});
test('an oversized Content-Length is refused before reading', async () => {
  assert.equal(await boundedFormData(await multipart(6000), 5000), 'too-large');
});
test('a body with no Content-Length is cut off once it passes the cap', async () => {
  assert.equal(await boundedFormData(await multipart(6000, { length: false, stream: true }), 5000), 'too-large');
});
test('anything that is not a multipart form is refused', async () => {
  assert.equal(await boundedFormData(new Request('https://example.test/upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }), 5000), null);
  const broken = new Request('https://example.test/upload', { method: 'POST', headers: { 'Content-Type': 'multipart/form-data; boundary=x' }, body: 'not a form' });
  assert.equal(await boundedFormData(broken, 5000), null);
});
