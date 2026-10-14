import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createServer } from 'vite';

// Voice notes (Alex: "like WhatsApp"): how each browser records, the WAV every phone plays, and the wiring.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { encodeWav, mixAndResample, recordingPlan, wavDurationMs, VOICE_RATE } = await vite.ssrLoadModule('/lib/voice-wav.ts');
const { CHAT_AUDIO_TYPES, MAX_CHAT_AUDIO_BYTES, MAX_VOICE_MS, attachmentSchema } = await vite.ssrLoadModule('/lib/workspace-chat-policy.ts');

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/138.0.7204.156 Mobile/15E148 Safari/604.1',
  iphoneApp: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  macSafari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0',
};
// What each browser's MediaRecorder says it records.
const safari = m => m.startsWith('audio/mp4'), safariNew = m => m.startsWith('audio/mp4') || m.startsWith('audio/webm');
const chrome = m => m.startsWith('audio/webm') || m.startsWith('audio/mp4'), firefox = m => m.startsWith('audio/ogg') || m.startsWith('audio/webm');

test('Safari and every iPhone browser keep AAC in MP4; Chrome, Android and Firefox convert their Opus to WAV', () => {
  assert.deepEqual(recordingPlan(UA.iphoneSafari, safari), { mime: 'audio/mp4;codecs=mp4a.40.2', convert: false });
  assert.deepEqual(recordingPlan(UA.iphoneSafari, safariNew), { mime: 'audio/mp4;codecs=mp4a.40.2', convert: false }, 'Safari 18.4 also records WebM; MP4 is still chosen');
  assert.deepEqual(recordingPlan(UA.iphoneChrome, safari), { mime: 'audio/mp4;codecs=mp4a.40.2', convert: false }, 'Chrome on an iPhone records like Safari');
  assert.deepEqual(recordingPlan(UA.iphoneApp, safari), { mime: 'audio/mp4;codecs=mp4a.40.2', convert: false }, 'the installed app on an iPhone');
  assert.deepEqual(recordingPlan(UA.macSafari, safari), { mime: 'audio/mp4;codecs=mp4a.40.2', convert: false });
  assert.deepEqual(recordingPlan(UA.macChrome, chrome), { mime: 'audio/webm;codecs=opus', convert: true }, "Chrome's MP4 is fragmented, so it converts");
  assert.deepEqual(recordingPlan(UA.androidChrome, chrome), { mime: 'audio/webm;codecs=opus', convert: true });
  assert.deepEqual(recordingPlan(UA.firefox, firefox), { mime: 'audio/webm;codecs=opus', convert: true });
  assert.deepEqual(recordingPlan(UA.firefox, m => m.startsWith('audio/ogg')), { mime: 'audio/ogg;codecs=opus', convert: true });
  assert.equal(recordingPlan(UA.firefox, () => false), null, 'no recorder: no microphone button');
  for (const ua of Object.values(UA)) for (const can of [safari, chrome, firefox]) {
    const plan = recordingPlan(ua, can);
    if (plan && !plan.convert) assert.match(plan.mime, /^audio\/mp4/, 'only MP4 is ever kept as recorded');
  }
});

test('the WAV: 16 kHz, one channel, 16-bit, the right length, and 5 minutes under 10 MB', () => {
  const second = new Float32Array(48000).map((_, i) => 0.5 * Math.sin(2 * Math.PI * 440 * i / 48000));
  const mono = mixAndResample([second, second.map(x => -x * 0)], 48000);
  assert.equal(mono.length, VOICE_RATE);
  assert.ok(Math.max(...mono) > 0.2 && Math.max(...mono) <= 0.25 + 1e-6, 'two channels are averaged (one silent halves it)');
  const wav = encodeWav(mixAndResample([second], 48000));
  const ascii = (from, to) => String.fromCharCode(...wav.slice(from, to));
  const view = new DataView(wav.buffer);
  assert.deepEqual([ascii(0, 4), ascii(8, 12), ascii(12, 16), ascii(36, 40)], ['RIFF', 'WAVE', 'fmt ', 'data']);
  assert.deepEqual([view.getUint16(20, true), view.getUint16(22, true), view.getUint32(24, true), view.getUint16(34, true)], [1, 1, 16000, 16], 'PCM, mono, 16 kHz, 16-bit');
  assert.equal(view.getUint32(4, true), wav.length - 8);
  assert.equal(wavDurationMs(wav), 1000);
  const peak = Math.max(...Array.from({ length: 16000 }, (_, i) => view.getInt16(44 + i * 2, true)));
  assert.ok(peak > 0.48 * 32767 && peak < 0.52 * 32767, 'the level survives the resampling');
  assert.equal(encodeWav(new Float32Array([2, -2])).slice(44).join(), [0xff, 0x7f, 0x00, 0x80].join(), 'loud samples are clipped, not wrapped');
  const fiveMinutes = 44 + MAX_VOICE_MS / 1000 * VOICE_RATE * 2;
  assert.ok(fiveMinutes < MAX_CHAT_AUDIO_BYTES, `${fiveMinutes} bytes`);
  assert.deepEqual([...CHAT_AUDIO_TYPES], ['audio/mp4', 'audio/wav']);
  assert.equal(mixAndResample([new Float32Array(441)], 44100).length, 160, '44.1 kHz too');
});

test('older messages and other clients read as before: durationMs is optional', () => {
  const id = '97a30000-0000-4000-8000-000000000001';
  assert.equal(attachmentSchema.parse({ id, kind: 'image', mime: 'image/jpeg', name: 'a.jpg', bytes: 1 }).durationMs, null);
  assert.equal(attachmentSchema.parse({ id, kind: 'audio', mime: 'audio/mp4', name: 'Voice note.m4a', bytes: 1, durationMs: 42400 }).durationMs, 42400);
});

test('wiring: the microphone is allowed for the site, the composer offers it, and notes play in the conversation', async () => {
  const proxy = await fs.readFile('proxy.ts', 'utf8');
  assert.equal((proxy.match(/microphone=\(self\)/g) ?? []).length, 2, 'Permissions-Policy lets the site itself use the microphone');
  assert.doesNotMatch(proxy, /microphone=\(\)/);
  const chat = await fs.readFile('mobile/src/LiveChat.tsx', 'utf8'), parts = await fs.readFile('mobile/src/ChatParts.tsx', 'utf8'), voice = await fs.readFile('mobile/src/VoiceNotes.tsx', 'utf8');
  assert.match(chat, /const showMic = voice\.supported && !readOnly && \(voice\.active \|\| \(!text\.trim\(\) && !files\.items\.length\)\)/, 'the microphone only while the box is empty');
  assert.match(chat, /\{showMic \? <MicButton p=\{p\} voice=\{voice\} \/> :/);
  assert.match(parts, /voice\.map\(x => <VoiceNotePlayer key=\{x\.id\}/);
  assert.match(voice, /if \(ms >= MAX_VOICE_MS\) void finish\(\)/, 'five minutes stops and sends');
  assert.match(voice, /getUserMedia/);
  assert.doesNotMatch(voice.split('export function useVoiceNote')[0], /getUserMedia\(/, 'the microphone is asked for only when it is first used');
  assert.match(voice, /if \(playing && playing !== player\) playing\.audio\?\.pause\(\)/, 'one note plays at a time');
  assert.match(voice, /onPointerCancel=\{pointerCancel\}/);
});
