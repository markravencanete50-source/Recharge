// Voice notes recorded as Opus (Chrome, Firefox, Android) do not play on an iPhone, so the app turns them into WAV before
// sending: one channel, 16 kHz, 16-bit, about 1.9 MB a minute (5 minutes is about 9.2 MB, under the 10 MB limit). Speech
// keeps its clarity at 16 kHz ("wideband", as phone calls over the internet use). Safari's own recordings (AAC in MP4)
// are sent as they are. Plain functions, so the conversion is tested without a browser.
export const VOICE_RATE = 16000;

// The channels mixed to one and resampled to `to` samples a second (each output sample averages the input samples it
// covers, which also keeps out the high frequencies a plain pick would fold back in).
export function mixAndResample(channels: readonly Float32Array[], from: number, to = VOICE_RATE): Float32Array {
  const length = channels[0]?.length ?? 0;
  if (!length || !(from > 0)) return new Float32Array(0);
  const mono = new Float32Array(length);
  for (const channel of channels) for (let i = 0; i < length; i++) mono[i] += channel[i] / channels.length;
  if (from === to) return mono;
  const ratio = from / to, out = new Float32Array(Math.max(1, Math.round(length / ratio)));
  for (let i = 0; i < out.length; i++) {
    const start = i * ratio, end = Math.min(length, start + ratio);
    let first = Math.floor(start), sum = 0, weight = 0;
    if (ratio <= 1) { // Upsampling: a straight line between neighbours.
      const at = Math.min(length - 1, start), low = Math.floor(at), high = Math.min(length - 1, low + 1), t = at - low;
      out[i] = mono[low] * (1 - t) + mono[high] * t;
      continue;
    }
    for (; first < end; first++) {
      const w = Math.min(first + 1, end) - Math.max(first, start);
      if (w > 0) { sum += mono[first] * w; weight += w; }
    }
    out[i] = weight ? sum / weight : 0;
  }
  return out;
}

// A WAV file (RIFF, PCM, 16-bit little-endian, one channel).
export function encodeWav(samples: Float32Array, rate = VOICE_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2), view = new DataView(bytes.buffer);
  const ascii = (at: number, text: string) => { for (let i = 0; i < text.length; i++) bytes[at + i] = text.charCodeAt(i); };
  ascii(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  ascii(36, 'data'); view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] || 0));
    view.setInt16(44 + i * 2, s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff), true);
  }
  return bytes;
}

// How long a WAV made by encodeWav lasts, in milliseconds.
export const wavDurationMs = (bytes: Uint8Array) => {
  if (bytes.length < 44) return 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Math.round(view.getUint32(40, true) / 2 / view.getUint32(24, true) * 1000);
};

// Which way a browser's recording goes: kept as AAC in MP4 where the browser is WebKit (Safari, and every browser on an
// iPhone or iPad, which all use WebKit), otherwise recorded as Opus and converted to WAV. Chrome can also record MP4 on
// some systems, but as a fragmented file without a length, which an iPhone may not seek in, so Chrome always converts.
export function recordingPlan(userAgent: string, supported: (mime: string) => boolean): { mime: string; convert: boolean } | null {
  const ios = /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && /Mobile\//.test(userAgent));
  const webkit = ios || (/AppleWebKit/.test(userAgent) && !/Chrome|Chromium|CriOS|Edg|OPR|Android|Firefox/.test(userAgent));
  if (webkit) for (const mime of ['audio/mp4;codecs=mp4a.40.2', 'audio/mp4']) if (supported(mime)) return { mime, convert: false };
  for (const mime of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']) if (supported(mime)) return { mime, convert: true };
  return null;
}
