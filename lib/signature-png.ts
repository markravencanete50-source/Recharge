// A drawn signature as a small black-and-white PNG (migration 20261024100000 keeps it with the signed agreement). The
// strokes are drawn into a 600 by 200 bitmap here and written as a 1-bit PNG, so a phone and the web make the same
// image with no canvas and no extra package; a signature is about 20 KB as a data URL.
export type SignaturePoint = { x: number; y: number };
export type SignatureStroke = SignaturePoint[];
export const SIGNATURE_WIDTH = 600, SIGNATURE_HEIGHT = 200;
export const SIGNATURE_PREFIX = 'data:image/png;base64,';
export const SIGNATURE_PATTERN = /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/;
export const MAX_SIGNATURE_LENGTH = 200000;

// Enough ink to be a signature rather than a tap: the strokes together run at least 40 points of the pad's width.
export function signatureInk(strokes: SignatureStroke[]) {
  let length = 0;
  for (const s of strokes) for (let i = 1; i < s.length; i++) length += Math.hypot(s[i].x - s[i - 1].x, s[i].y - s[i - 1].y);
  return length;
}
export const hasSignature = (strokes: SignatureStroke[]) => signatureInk(strokes) >= 40;

const CRC = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  return table;
})();
function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function adler32(bytes: Uint8Array) {
  let a = 1, b = 0;
  for (let i = 0; i < bytes.length; i++) { a = (a + bytes[i]) % 65521; b = (b + a) % 65521; }
  return ((b << 16) | a) >>> 0;
}
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
function chunk(type: string, data: Uint8Array) {
  const body = new Uint8Array(4 + data.length);
  for (let i = 0; i < 4; i++) body[i] = type.charCodeAt(i);
  body.set(data, 4);
  return [...u32(data.length), ...body, ...u32(crc32(body))];
}
// A zlib stream of stored (uncompressed) blocks: plain, and small enough at 1 bit a pixel.
function zlibStored(raw: Uint8Array) {
  const out: number[] = [0x78, 0x01];
  for (let at = 0; at < raw.length || at === 0; at += 65535) {
    const len = Math.min(65535, raw.length - at), last = at + len >= raw.length;
    out.push(last ? 1 : 0, len & 0xff, len >>> 8, ~len & 0xff, (~len >>> 8) & 0xff);
    for (let i = 0; i < len; i++) out.push(raw[at + i]);
    if (last) break;
  }
  out.push(...u32(adler32(raw)));
  return new Uint8Array(out);
}
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function base64(bytes: Uint8Array) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63] + (i + 1 < bytes.length ? B64[(n >>> 6) & 63] : '=') + (i + 2 < bytes.length ? B64[n & 63] : '=');
  }
  return out;
}

// The strokes, drawn on a pad `width` by `height`, fitted into the image with a margin and written as a PNG data URL.
export function signaturePng(strokes: SignatureStroke[], width: number, height: number) {
  const W = SIGNATURE_WIDTH, H = SIGNATURE_HEIGHT, margin = 8, radius = 1.8;
  const scale = Math.min((W - margin * 2) / Math.max(1, width), (H - margin * 2) / Math.max(1, height));
  const ox = (W - width * scale) / 2, oy = (H - height * scale) / 2;
  const row = Math.ceil(W / 8) + 1;
  const raw = new Uint8Array(row * H);
  for (let y = 0; y < H; y++) raw.fill(0xff, y * row + 1, (y + 1) * row); // white; each row starts with filter 0
  const ink = (cx: number, cy: number) => {
    for (let y = Math.max(0, Math.floor(cy - radius)); y <= Math.min(H - 1, Math.ceil(cy + radius)); y++)
      for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(W - 1, Math.ceil(cx + radius)); x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= radius * radius) raw[y * row + 1 + (x >> 3)] &= ~(0x80 >> (x & 7));
  };
  for (const s of strokes) {
    const pts = s.map(p => ({ x: ox + p.x * scale, y: oy + p.y * scale }));
    if (pts.length === 1) ink(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.5));
      for (let k = 0; k <= steps; k++) ink(a.x + (b.x - a.x) * k / steps, a.y + (b.y - a.y) * k / steps);
    }
  }
  const header = new Uint8Array([...u32(W), ...u32(H), 1, 0, 0, 0, 0]); // 1 bit, greyscale
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...chunk('IHDR', header), ...chunk('IDAT', zlibStored(raw)), ...chunk('IEND', new Uint8Array(0))]);
  return SIGNATURE_PREFIX + base64(png);
}
