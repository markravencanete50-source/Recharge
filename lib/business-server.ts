import { NextResponse } from "next/server";
import { type SupabaseClient } from "@supabase/supabase-js";
import { verifiedWorkspaceUser, workspaceSupabase } from "./supabase-server";
import { isNativeRequest } from "./native-request-policy";
import { nativeWorkspace, workspaceAccountSchema } from "./native-session";
import { boundedJson, isSameOrigin, securityHeaders } from "./auth-security-policy";
import { authSecurityConfiguration, requestQuota } from "./auth-security";
import { businessReadSchema, businessWriteSchema, businessRpc } from "./business-policy";
import { z } from "zod";

export function businessResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { ...securityHeaders, Vary: "Cookie, Authorization" } });
}
export async function businessContext(request: Request, native: boolean) {
  if (native) return isNativeRequest(request) ? nativeWorkspace(request) : null;
  if (!await verifiedWorkspaceUser()) return null;
  const client = await workspaceSupabase();
  if (!client) return null;
  const result = await client.rpc("workspace_account");
  const account = workspaceAccountSchema.safeParse(result.data);
  return result.error || !account.success ? null : { client, account: account.data };
}
export function databaseFailure(error: { code?: string }) {
  if (error.code === "P0429") { const response = businessResponse({ error: "Too many changes. Wait a minute before trying again." }, 429); response.headers.set("Retry-After", "60"); return response; }
  if (error.code === "42501") return businessResponse({ error: "You do not have permission for this action" }, 403);
  if (error.code === "40001" || error.code === "23505") return businessResponse({ error: "This record changed or already exists. Refresh and try again." }, 409);
  if (error.code === "P0002") return businessResponse({ error: "Record not found" }, 404);
  if (error.code?.startsWith("22") || error.code?.startsWith("23")) return businessResponse({ error: "Check the record details and assigned access" }, 400);
  return businessResponse({ error: "The workspace connection is temporarily unavailable" }, 503);
}
const reads: Record<z.infer<typeof businessReadSchema>["entity"], { table: string; columns: string }> = {
  properties: { table: "workspace_properties", columns: "id,name,address,region,status,bedrooms,version,created_at,updated_at" },
  work: { table: "workspace_work_items", columns: "id,property_id,module_id,title,description,status,priority,due_on,assignee_id,client_visible,requires_client_approval,created_by,version,created_at,updated_at,completed_at" },
  updates: { table: "workspace_work_updates", columns: "id,work_id,actor_id,previous_status,next_status,note,created_at" },
  invoices: { table: "workspace_invoices", columns: "id,property_id,work_id,module_id,recipient_id,reference,amount_minor,currency,status,issued_on,paid_at,version" },
  threads: { table: "workspace_threads", columns: "id,property_id,subject,client_visible,created_at" },
  messages: { table: "workspace_messages", columns: "id,thread_id,author_id,body,created_at" },
  activity: { table: "workspace_activity", columns: "id,actor_id,property_id,work_id,event_type,created_at" },
};
export async function businessRead(request: Request, native = false) {
  try {
    const session = await businessContext(request, native);
    if (!session) return businessResponse({ error: "Sign in required" }, 401);
    if (session.account.status !== "active") return businessResponse({ error: "Your workspace access is awaiting approval or has been revoked" }, 403);
    const parsed = businessReadSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success) return businessResponse({ error: "Check your search parameters" }, 400);
    const input = parsed.data, spec = reads[input.entity];
    if ((input.moduleId && !["work", "invoices"].includes(input.entity)) || (input.workId && input.entity !== "updates") || (input.threadId && input.entity !== "messages") || (input.cursor && input.entity === "activity") || (input.propertyId && ["properties", "updates", "messages"].includes(input.entity))) return businessResponse({ error: "Unsupported search filter" }, 400);
    let query = session.client.from(spec.table).select(spec.columns).order("id").limit(input.limit + 1);
    if (input.cursor) query = query.gt("id", input.cursor);
    if (input.moduleId) query = query.eq("module_id", input.moduleId);
    if (input.propertyId) query = query.eq("property_id", input.propertyId);
    if (input.workId) query = query.eq("work_id", input.workId);
    if (input.threadId) query = query.eq("thread_id", input.threadId);
    // Recent activity uses time order and a bounded first page, not a UUID cursor.
    if (input.entity === "activity") {
      query = session.client.from(spec.table).select(spec.columns).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(input.limit);
      if (input.propertyId) query = query.eq("property_id", input.propertyId);
    }
    const result = await query;
    if (result.error) return databaseFailure(result.error);
    const rows = (result.data || []) as unknown as { id: string }[];
    const more = rows.length > input.limit;
    return businessResponse({ data: rows.slice(0, input.limit), nextCursor: more ? rows[input.limit - 1].id : null, account: session.account, mode: "live" });
  } catch { return businessResponse({ error: "The workspace connection is temporarily unavailable" }, 503); }
}
export async function businessWrite(request: Request, native = false) {
  const config = authSecurityConfiguration();
  if (native ? !isNativeRequest(request) : !isSameOrigin(request, config?.origin)) return businessResponse({ error: "Invalid request origin" }, 403);
  if (!config) return businessResponse({ error: "Secure workspace is awaiting configuration" }, 503);
  try {
    const session = await businessContext(request, native);
    if (!session) return businessResponse({ error: "Sign in required" }, 401);
    if (session.account.status !== "active") return businessResponse({ error: "Active workspace access required" }, 403);
    const quota = await requestQuota(request, "business-user", 60, 60, session.account.userId);
    if (!quota.allowed) { const response = businessResponse({ error: "Too many updates. Please wait." }, 429); response.headers.set("Retry-After", String(quota.retryAfter)); return response; }
    const parsed = businessWriteSchema.safeParse(await boundedJson(request));
    if (!parsed.success) return businessResponse({ error: "Check the record details" }, 400);
    const call = businessRpc(parsed.data);
    const result = await session.client.rpc(call.name, call.args);
    return result.error ? databaseFailure(result.error) : businessResponse({ ok: true, id: result.data });
  } catch { return businessResponse({ error: "The workspace connection is temporarily unavailable" }, 503); }
}
export async function scopedPropertyDetails(client: SupabaseClient, input: unknown) {
  const parsed = z.object({ propertyId: z.string().uuid(), section: z.enum(["access", "ota", "finance"]) }).strict().safeParse(input);
  if (!parsed.success) return businessResponse({ error: "Check the property details" }, 400);
  const result = await client.rpc("workspace_property_details", { target_property: parsed.data.propertyId, section: parsed.data.section });
  if (result.error) return databaseFailure(result.error);
  const data = result.data || {};
  // Keep the HTTP projection safe while a database migration is awaiting installation.
  const exposed = parsed.data.section === 'access' ? { accessInstructions: data.accessInstructions || '' }
    : parsed.data.section === 'ota' ? { otaInstructions: data.otaInstructions || '' }
    : { managementFeeBps: data.managementFeeBps ?? null, paymentNotes: data.paymentNotes || '' };
  return businessResponse({ data: exposed });
}
