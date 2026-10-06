import { z } from "zod";
import { emailSchema, phoneSchema } from "./auth-security-policy";

const token = z.string().min(20).max(8192).regex(/^[A-Za-z0-9_.-]+$/);
export const nativeSessionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("login"), email: emailSchema, password: z.string().min(1).max(1024) }).strict(),
  z.object({ action: z.literal("loginPhone"), phone: phoneSchema, password: z.string().min(1).max(1024) }).strict(),
  z.object({ action: z.literal("refresh"), refreshToken: token }).strict(),
  z.object({ action: z.literal("logout") }).strict(),
]);
// This transport never accepts ambient web credentials or emits CORS permission.
// The header selects transport, not identity. Every protected route verifies its JWT.
export function isNativeRequest(request: Request): boolean {
  return new URL(request.url).pathname.startsWith("/api/mobile/") &&
    request.headers.get("x-recharge-client") === "native" &&
    !request.headers.has("origin") && !request.headers.has("cookie") &&
    !request.headers.has("sec-fetch-site");
}
export function bearerToken(request: Request): string | null {
  const raw = request.headers.get("authorization");
  if (!raw?.startsWith("Bearer ")) return null;
  const parsed = token.safeParse(raw.slice(7));
  return parsed.success ? parsed.data : null;
}
