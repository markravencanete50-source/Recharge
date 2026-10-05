import { z } from "zod";
import { authSecurityConfiguration, requestQuota } from "./auth-security";
import { boundedJson, isSameOrigin } from "./auth-security-policy";
import { businessContext, businessResponse, databaseFailure, scopedPropertyDetails } from "./business-server";
import { isNativeRequest } from "./native-request-policy";

const deviceSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("register"), deviceId: z.string().uuid(), token: z.string().min(20).max(200).regex(/^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/), platform: z.enum(["ios", "android"]) }).strict(),
  z.object({ action: z.literal("unregister"), deviceId: z.string().uuid() }).strict(),
]);
const propertyDetailsSchema = z.discriminatedUnion("section", [
  z.object({ propertyId: z.string().uuid(), version: z.number().int().positive(), section: z.literal("access"), input: z.object({ accessInstructions: z.string().max(5000), otaInstructions: z.string().max(5000) }).strict() }).strict(),
  z.object({ propertyId: z.string().uuid(), version: z.number().int().positive(), section: z.literal("finance"), input: z.object({ managementFeeBps: z.number().int().min(0).max(10000).nullable(), paymentNotes: z.string().max(5000) }).strict() }).strict(),
]);
export async function deviceWrite(request: Request) {
  if (!isNativeRequest(request)) return businessResponse({ error: "Invalid native request" }, 403);
  try {
    const session = await businessContext(request, true);
    if (!session) return businessResponse({ error: "Sign in required" }, 401);
    const quota = await requestQuota(request, "device-user", 10, 60, session.account.userId);
    if (!quota.allowed) return businessResponse({ error: "Too many device updates" }, 429);
    const input = deviceSchema.safeParse(await boundedJson(request));
    if (!input.success) return businessResponse({ error: "Check the device registration" }, 400);
    const result = input.data.action === "register" ? await session.client.rpc("workspace_register_device", { device_id: input.data.deviceId, push_token: input.data.token, platform: input.data.platform }) : await session.client.rpc("workspace_unregister_device", { device_id: input.data.deviceId });
    return result.error ? databaseFailure(result.error) : businessResponse({ ok: true });
  } catch { return businessResponse({ error: "Device registration is temporarily unavailable" }, 503); }
}
export async function propertyDetails(request: Request, native = false) {
  if (native ? !isNativeRequest(request) : request.method !== "GET" && !isSameOrigin(request, authSecurityConfiguration()?.origin)) return businessResponse({ error: "Invalid request origin" }, 403);
  try {
    const session = await businessContext(request, native);
    if (!session) return businessResponse({ error: "Sign in required" }, 401);
    if (request.method === "GET") return scopedPropertyDetails(session.client, Object.fromEntries(new URL(request.url).searchParams));
    const quota = await requestQuota(request, "property-details-user", 20, 60, session.account.userId);
    if (!quota.allowed) return businessResponse({ error: "Too many property updates" }, 429);
    const input = propertyDetailsSchema.safeParse(await boundedJson(request));
    if (!input.success) return businessResponse({ error: "Check the property details" }, 400);
    const result = await session.client.rpc("workspace_save_property_details", { target_property: input.data.propertyId, expected_version: input.data.version, section: input.data.section, input: input.data.input });
    return result.error ? databaseFailure(result.error) : businessResponse({ ok: true });
  } catch { return businessResponse({ error: "Property details are temporarily unavailable" }, 503); }
}
