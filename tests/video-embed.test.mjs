import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// Training videos play inside the app.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { videoEmbed } = await vite.ssrLoadModule('/lib/video-embed.ts');
after(() => vite.close());

test('YouTube, Vimeo and video files become in-app players; other links do not', () => {
  const yt = { kind: 'frame', src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' };
  assert.deepEqual(videoEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10'), yt);
  assert.deepEqual(videoEmbed('https://youtu.be/dQw4w9WgXcQ'), yt);
  assert.deepEqual(videoEmbed('https://youtube.com/shorts/dQw4w9WgXcQ'), yt);
  assert.deepEqual(videoEmbed('https://vimeo.com/123456789'), { kind: 'frame', src: 'https://player.vimeo.com/video/123456789' });
  assert.deepEqual(videoEmbed('https://cdn.example.com/training/turnover.mp4'), { kind: 'file', src: 'https://cdn.example.com/training/turnover.mp4' });
  assert.equal(videoEmbed('http://youtu.be/dQw4w9WgXcQ'), null, 'HTTPS only');
  assert.equal(videoEmbed('https://example.com/page'), null);
  assert.equal(videoEmbed('javascript:alert(1)'), null);
  assert.equal(videoEmbed('https://www.youtube.com/watch?v=bad"id'), null);
});
