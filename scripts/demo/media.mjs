// Photos for the devstack: a disk-backed stand-in for Supabase Storage (scripts/demo/storage/<bucket>/<path>)
// and a tiny PNG painter, so seeded clean, delivery and repair photos are real images the app can show.
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { DEVSTACK } from './db.mjs';

export const STORAGE = path.join(DEVSTACK, 'storage');
const safe = (bucket, file) => {
  const full = path.join(STORAGE, bucket, file);
  if (!full.startsWith(path.join(STORAGE, bucket) + path.sep) || file.includes('..')) throw new Error('Bad storage path');
  return full;
};
export async function storagePut(bucket, file, bytes) {
  const full = safe(bucket, file);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, bytes);
}
// The same picture under another name (a link, so a seeded pool of photos takes little space).
export async function storageLink(bucket, file, poolName, bytes) {
  const pool = safe(bucket, 'pool/' + poolName), full = safe(bucket, file);
  if (!existsSync(pool)) { await fs.mkdir(path.dirname(pool), { recursive: true }); await fs.writeFile(pool, bytes); }
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.rm(full, { force: true });
  await fs.symlink(path.relative(path.dirname(full), pool), full);
}
export async function storageGet(bucket, file) {
  const full = safe(bucket, file);
  return existsSync(full) ? fs.readFile(full) : null;
}
export async function storageRemove(bucket, file) { await fs.rm(safe(bucket, file), { force: true }); }
export async function clearStorage() { await fs.rm(STORAGE, { recursive: true, force: true }); }

// --- PNG -------------------------------------------------------------------------------------
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = bytes => { let c = 0xffffffff; for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
export function encodePng(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 3 + 1)] = 0; rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3); }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2; header[10] = 0; header[11] = 0; header[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
// A simple "photo" of a room: wall, floor, window, furniture blocks, soft light. Deterministic per seed.
const SCENES = {
  kitchen: { wall: '#e8e2d6', floor: '#9c7b5b', items: [['#f4f4f2', 0.08, 0.52, 0.55, 0.30], ['#3b4a52', 0.08, 0.50, 0.55, 0.04], ['#c9ced1', 0.66, 0.30, 0.22, 0.52], ['#2f6e73', 0.12, 0.22, 0.14, 0.12]] },
  bedroom: { wall: '#dfe6ea', floor: '#b08d68', items: [['#ffffff', 0.18, 0.55, 0.62, 0.22], ['#7f9aa8', 0.18, 0.47, 0.62, 0.09], ['#5b4636', 0.13, 0.40, 0.04, 0.37], ['#e9d8b4', 0.84, 0.50, 0.08, 0.12]] },
  bathroom: { wall: '#eef2f1', floor: '#c9c9c4', items: [['#ffffff', 0.10, 0.50, 0.40, 0.25], ['#ffffff', 0.62, 0.48, 0.14, 0.30], ['#b7d3d6', 0.60, 0.16, 0.20, 0.22], ['#d9a441', 0.15, 0.30, 0.10, 0.08]] },
  living: { wall: '#ece4d4', floor: '#8a6a4f', items: [['#456a6f', 0.10, 0.50, 0.50, 0.24], ['#2f4f53', 0.10, 0.44, 0.50, 0.08], ['#d8c7a3', 0.66, 0.60, 0.20, 0.10], ['#1d4038', 0.70, 0.22, 0.18, 0.14]] },
  delivery: { wall: '#d9d4cc', floor: '#7d6e60', items: [['#c69c6d', 0.20, 0.45, 0.30, 0.30], ['#b88a5c', 0.55, 0.52, 0.25, 0.23], ['#e6d3b1', 0.20, 0.45, 0.30, 0.04], ['#f3efe6', 0.30, 0.55, 0.10, 0.06]] },
  repair: { wall: '#e4e7e9', floor: '#a7a39c', items: [['#d0d4d6', 0.30, 0.30, 0.40, 0.40], ['#8e979c', 0.42, 0.62, 0.16, 0.10], ['#c0392b', 0.47, 0.42, 0.06, 0.06], ['#2d3436', 0.32, 0.28, 0.36, 0.03]] },
};
export function roomPhoto(kind = 'living', seed = 1, width = 480, height = 360) {
  const scene = SCENES[kind] ?? SCENES.living;
  let s = seed >>> 0 || 1;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const wall = hex(scene.wall), floor = hex(scene.floor), horizon = 0.66 + (rand() - 0.5) * 0.06;
  const rgb = Buffer.alloc(width * height * 3);
  const wx = 0.30 + rand() * 0.3, wy = 0.10, ww = 0.22, wh = 0.26;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / width, v = y / height;
    let c = v < horizon ? wall : floor;
    if (u > wx && u < wx + ww && v > wy && v < wy + wh) c = [200, 225, 240];
    if (u > wx && u < wx + ww && v > wy && v < wy + wh && (Math.abs(u - (wx + ww / 2)) < 0.004 || Math.abs(v - (wy + wh / 2)) < 0.005)) c = [245, 245, 245];
    for (const [color, ix, iy, iw, ih] of scene.items) if (u > ix && u < ix + iw && v > iy && v < iy + ih) c = hex(color);
    // Light from the window, a little vignette and grain.
    const light = 1.08 - Math.hypot(u - (wx + ww / 2), v - 0.2) * 0.35 - Math.hypot(u - 0.5, v - 0.5) * 0.12;
    const grain = ((x * 7919 + y * 104729 + seed) % 13) - 6;
    const i = (y * width + x) * 3;
    rgb[i] = Math.max(0, Math.min(255, c[0] * light + grain)); rgb[i + 1] = Math.max(0, Math.min(255, c[1] * light + grain)); rgb[i + 2] = Math.max(0, Math.min(255, c[2] * light + grain));
  }
  return encodePng(width, height, rgb);
}
