import { noticeCopy } from './notice-copy';
import type { IntegrationSettings } from './integration-policy';

// Web push (RFC 8030), sent straight from the backend with no outside account: the request is
// signed with Recharge's own VAPID key (RFC 8292) and the message is encrypted for the one
// browser it is for (RFC 8291, aes128gcm). The browser's push service only relays it.
const encoder = new TextEncoder();
// Typed views over plain ArrayBuffers, as the WebCrypto calls expect.
const bytes = (u: Uint8Array) => u as Uint8Array<ArrayBuffer>;
export const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function fromB64url(text: string) {
  const plain = text.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(plain + '='.repeat((4 - plain.length % 4) % 4)), c => c.charCodeAt(0));
}
const concat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
async function hmac(key: Uint8Array, data: Uint8Array) {
  const k = await crypto.subtle.importKey('raw', bytes(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, bytes(data)));
}

export type WebPushKeys = { publicKey: string; privateKey: string; subject: string };
export function webPushKeys(settings: IntegrationSettings): WebPushKeys | null {
  const publicKey = settings.VAPID_PUBLIC_KEY ?? '', privateKey = settings.VAPID_PRIVATE_KEY ?? '';
  const origin = (settings.APP_ORIGIN ?? '').replace(/\/$/, '');
  if (!/^[A-Za-z0-9_-]{86,88}$/.test(publicKey) || !/^[A-Za-z0-9_-]{42,44}$/.test(privateKey) || !/^https:\/\//.test(origin)) return null;
  if (fromB64url(publicKey).length !== 65 || fromB64url(privateKey).length !== 32) return null;
  return { publicKey, privateKey, subject: origin };
}

// The signed token that proves the message comes from Recharge.
export async function vapidHeader(endpoint: string, keys: WebPushKeys, now = Date.now()) {
  const pub = fromB64url(keys.publicKey);
  const jwk = { kty: 'EC', crv: 'P-256', d: keys.privateKey, x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)), ext: true };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const header = b64url(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(encoder.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: keys.subject })));
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(`${header}.${claims}`)));
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${keys.publicKey}`;
}

// Encrypts the message for one browser (its public key and auth secret).
export async function encryptPush(payload: Uint8Array, p256dh: string, authSecret: string, salt = crypto.getRandomValues(new Uint8Array(16))) {
  const uaPublic = fromB64url(p256dh), auth = fromB64url(authSecret);
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey) as ArrayBuffer);
  const peer = await crypto.subtle.importKey('raw', bytes(uaPublic), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, local.privateKey, 256));
  const prkKey = await hmac(auth, shared);
  const ikm = (await hmac(prkKey, concat(encoder.encode('WebPush: info\0'), uaPublic, asPublic, new Uint8Array([1])))).slice(0, 32);
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(encoder.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(encoder.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);
  const aes = await crypto.subtle.importKey('raw', bytes(cek), 'AES-GCM', false, ['encrypt']);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: bytes(nonce) }, aes, bytes(concat(payload, new Uint8Array([2])))));
  const header = new Uint8Array(21); header.set(salt, 0); new DataView(header.buffer).setUint32(16, 4096); header[20] = 65;
  return concat(header, asPublic, sealed);
}

// Only the browsers' own push services: Chrome, Edge and Android (Google), Firefox, Windows and Safari.
// Any other address would make the backend post to a server of someone's choosing.
export const PUSH_SERVICE = /^https:\/\/(fcm\.googleapis\.com|android\.googleapis\.com|[a-z0-9-]+(\.[a-z0-9-]+)*\.push\.services\.mozilla\.com|[a-z0-9-]+(\.[a-z0-9-]+)*\.notify\.windows\.com|web\.push\.apple\.com)\//;
export type WebPushJob = { endpoint: string; p256dh: string; auth: string; eventType?: string | null };
// Sends one notice. 'gone' means the browser no longer accepts notifications.
export async function sendWebPush(job: WebPushJob, keys: WebPushKeys): Promise<'sent' | 'gone' | 'failed'> {
  if (!PUSH_SERVICE.test(job.endpoint)) return 'gone';
  const { title, message } = noticeCopy(job.eventType);
  const body = await encryptPush(encoder.encode(JSON.stringify({ title, body: message, url: '/workspace/live' })), job.p256dh, job.auth);
  try {
    const response = await fetch(job.endpoint, {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10_000), body: bytes(body),
      headers: { Authorization: await vapidHeader(job.endpoint, keys), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'normal' },
    });
    if (response.status === 404 || response.status === 410) return 'gone';
    return response.ok ? 'sent' : 'failed';
  } catch { return 'failed'; }
}

// Every minute (worker/index.ts): send the waiting notices to the browsers that allowed them.
export async function dispatchWebPush(settings: IntegrationSettings, rpc: <T>(name: string, args: Record<string, unknown>) => Promise<T>) {
  const keys = webPushKeys(settings);
  if (!keys) return { mode: 'unconfigured', sent: 0 };
  const jobs = await rpc<WebPushJob[]>('integration_claim_web_push', {});
  let sent = 0;
  for (const job of jobs) {
    const outcome = await sendWebPush(job, keys);
    if (outcome === 'sent') sent++;
    if (outcome === 'gone') await rpc('integration_remove_web_push', { target_endpoint: job.endpoint }).catch(() => undefined);
  }
  return { mode: 'configured', sent, claimed: jobs.length };
}
