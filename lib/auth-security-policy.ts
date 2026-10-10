import { z } from "zod";
// Shown when a super admin has revoked the password: the old one no longer signs in.
export const PASSWORD_RESET_REQUIRED = "Your password was reset by an administrator. Use “Forgot password” to set a new one.";
export const LOCKOUT_SECONDS = 24 * 60 * 60;
export const MAX_PASSWORD_FAILURES = 5;
export const RECOVERY_COOKIE = "recharge-recovery-proof";
export const emailSchema = z.string().trim().email().max(254).transform(value => value.toLowerCase());
export const phoneSchema = z.string().trim().regex(/^\+[1-9]\d{7,14}$/, 'Include your country code, for example +447123456789.');
export const loginSchema = z.union([
  z.object({ email: emailSchema, password: z.string().min(1).max(1024) }).strict(),
  z.object({ phone: phoneSchema, password: z.string().min(1).max(1024) }).strict(),
]);
export function loginContact(input: z.infer<typeof loginSchema>) { return 'email' in input ? input.email : input.phone; }
export const newPasswordSchema = z.object({ password: z.string().min(12).max(72).refine(value => new TextEncoder().encode(value).byteLength <= 72) });
// A password that is just the account's email address (or the part before the @) or its phone number
// is the first thing anyone would guess, so it is refused everywhere a password is chosen.
export const PASSWORD_IS_CONTACT = "Choose a password that isn't your email address or phone number.";
export function passwordIsContact(password: string, ...contacts: (string | null | undefined)[]): boolean {
  const typed = password.trim().toLowerCase(), squashed = typed.replace(/[\s()+.-]/g, "");
  return contacts.some(contact => {
    const value = contact?.trim().toLowerCase();
    if (!value) return false;
    const digits = value.replace(/\D/g, "");
    return typed === value || (value.includes("@") && typed === value.split("@")[0]) || (digits.length >= 8 && !value.includes("@") && (squashed === digits || squashed === "0" + digits.slice(2)));
  });
}
export const uuidSchema = z.string().uuid();
export function isSameOrigin(request: Request, origin?: string): boolean {
  const expected = origin || new URL(request.url).origin;
  return new URL(request.url).origin === expected && request.headers.get("origin") === expected;
}
export async function boundedJson(request: Pick<Request, "body" | "headers">, limit = 16_384): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return null;
  const reader = request.body?.getReader(); if (!reader) return null;
  let length = 0; const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch { return null; } finally { reader.releaseLock(); }
}
export async function authResponseMessage(response: Response) {
  const parsed = z.object({ error: z.string().max(500).optional(), message: z.string().max(500).optional(), signedIn: z.boolean().optional() }).safeParse(await boundedJson(response));
  return parsed.success ? parsed.data : {};
}
export const securityHeaders = {
  "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Content-Security-Policy": "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
};
