import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { z } from "zod";
import { workspaceAccountSchema, type WorkspaceAccount } from "../../../lib/workspace-account-policy";
import type { BusinessAction } from "../../../lib/business-policy";
import type { AnalyticsPeriod } from "../../../lib/analytics";
import type { OperationsAction } from "../../../lib/operations-policy";
import type { FinanceAction } from '../../../lib/workspace-finance-policy';
import type { TeamsAction } from '../../../lib/workspace-teams-policy';
import type { AdminAction } from '../../../lib/workspace-admin-policy';
import type { ChatAction } from '../../../lib/workspace-chat-policy';
import type { InboxAction } from '../../../lib/guest-inbox-policy';
import { webWorkspacePath } from '../../../lib/workspace-web-path';

const storedRefreshKey = "recharge.live.refresh.v1";
const storageOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const tokenSchema = z.string().min(20).max(8192).regex(/^[A-Za-z0-9_.-]+$/);
const sessionSchema = z.object({ accessToken: tokenSchema, refreshToken: tokenSchema.max(2048), expiresAt: z.number().int().positive() });
const sessionResponse = z.object({ session: sessionSchema, account: workspaceAccountSchema.optional() });
let session: z.infer<typeof sessionSchema> | null = null;
let account: WorkspaceAccount | null = null;
let refreshInFlight: Promise<void> | null = null;

export class WorkspaceApiError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfter = 0) { super(message); this.name = "WorkspaceApiError"; }
}
// The same app also runs in the browser, served by the backend at /workspace
// (scripts/build-workspace-web.mjs). There it uses the web session instead: the cookies
// set by the sign-in page, sent only to its own origin, and the /api/workspace twin of
// each /api/mobile route. The app itself stores nothing in the browser.
const sameOriginWeb = Platform.OS === "web" && process.env.EXPO_PUBLIC_WORKSPACE_WEB === "same-origin";
export function liveApiOrigin(): string | null {
  if (sameOriginWeb) return globalThis.location?.origin ?? null;
  const value = process.env.EXPO_PUBLIC_WORKSPACE_API_ORIGIN;
  if (!value || Platform.OS === "web") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash ? url.origin : null;
  } catch { return null; }
}
async function call(path: string, body?: unknown, accessToken?: string) {
  const origin = liveApiOrigin();
  if (!origin) throw new WorkspaceApiError("The live mobile backend is awaiting configuration.", 503);
  const multipart = body instanceof FormData;
  // Photo uploads and a manual Hostaway sync (which pages through every listing and stay) take longer.
  const slow = multipart || (body !== undefined && /\/integrations(?:[?]|$)/.test(path));
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), slow ? 120000 : 15000);
  try {
    const response = await fetch(sameOriginWeb ? path : origin + path, {
      method: body === undefined ? "GET" : "POST", credentials: sameOriginWeb ? "same-origin" : "omit", redirect: sameOriginWeb ? "manual" : "error", signal: controller.signal,
      headers: { ...(sameOriginWeb ? {} : { "X-Recharge-Client": "native" }), ...(body === undefined || multipart ? {} : { "Content-Type": "application/json" }), ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }),
    });
    if (!response.ok) {
      const error = z.object({ error: z.string().max(500).optional() }).safeParse(await response.json().catch(() => ({})));
      const retry = Number(response.headers.get("Retry-After"));
      throw new WorkspaceApiError(error.success && error.data.error ? error.data.error : "The request could not be completed.", response.status, Number.isFinite(retry) ? retry : 0);
    }
    return response;
  } catch (error) {
    if (error instanceof WorkspaceApiError) throw error;
    throw new WorkspaceApiError("Connection failed. Check your internet connection and try again.", 503);
  } finally { clearTimeout(timeout); }
}
async function saveSession(value: unknown) {
  const parsed = sessionResponse.parse(value);
  // Persist only the rotating refresh token. Access tokens stay in memory and passwords are never stored.
  if (!await SecureStore.isAvailableAsync()) throw new WorkspaceApiError("Secure storage is unavailable on this device.", 503);
  await SecureStore.setItemAsync(storedRefreshKey, parsed.session.refreshToken, storageOptions);
  session = parsed.session;
  account = parsed.account || null;
  return parsed.account;
}
// Browser: the account comes from the signed-in web session.
async function webAccount() {
  const response = await call("/api/workspace/account");
  account = workspaceAccountSchema.parse(z.object({ account: z.unknown() }).parse(await response.json()).account);
  return account;
}
export async function signIn(email: string, password: string) {
  const contact = email.trim();
  if (sameOriginWeb) {
    await call("/api/session", contact.startsWith('+') ? { phone: contact, password } : { email: contact, password });
    return webAccount();
  }
  const response = await call("/api/mobile/session", contact.startsWith('+') ? { action: "loginPhone", phone: contact, password } : { action: "login", email: contact, password });
  return saveSession(await response.json());
}
async function refresh() {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    const token = session?.refreshToken || await SecureStore.getItemAsync(storedRefreshKey, storageOptions);
    if (!token || !tokenSchema.safeParse(token).success) throw new WorkspaceApiError("Please sign in.", 401);
    try {
      const response = await call("/api/mobile/session", { action: "refresh", refreshToken: token });
      await saveSession(await response.json());
    } catch (error) {
      if (error instanceof WorkspaceApiError && error.status === 401) { session = null; account = null; await SecureStore.deleteItemAsync(storedRefreshKey, storageOptions); }
      throw error;
    }
  })().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}
// Self sign-up, when the server has it switched on (MOBILE_REGISTRATION_ENABLED and an email
// service for the codes). New accounts wait for an administrator to approve them.
export async function registrationOpen() {
  try { return z.object({ enabled: z.boolean() }).parse(await (await call("/api/mobile/account")).json()).enabled; } catch { return false; }
}
export async function accountStep(body: Record<string, unknown>, accessToken?: string) {
  return z.record(z.unknown()).parse(await (await call("/api/mobile/account", body, accessToken)).json());
}
export async function workspaceRequest(path: string, body?: BusinessAction | Record<string, unknown> | FormData) {
  if (!/^\/api\/mobile\/(workspace|reports|devices|property-details|journeys|operations|portfolio|controls|media|integrations|finance|teams|admin|chat|guest-inbox|training-files|owner)(?:[/?]|$)/.test(path) || path.includes("..")) throw new Error("Unsupported workspace endpoint");
  if (sameOriginWeb) return call(webWorkspacePath(path), body);
  if (!session || session.expiresAt * 1000 <= Date.now() + 60000) await refresh();
  return call(path, body, session!.accessToken);
}
export async function signOut() {
  // The web sign-out answers with a redirect to the sign-in page, which manual mode reports as status 0.
  if (sameOriginWeb) { account = null; await call("/api/session/logout", {}).catch(error => { if (!(error instanceof WorkspaceApiError && error.status === 0)) throw error; }); return; }
  try { if (!session) await refresh(); await call("/api/mobile/session", { action: "logout" }, session!.accessToken); }
  finally { session = null; account = null; await SecureStore.deleteItemAsync(storedRefreshKey, storageOptions); }
}
export async function restoreAccount() { if (sameOriginWeb) return webAccount(); await refresh(); if (!account) throw new WorkspaceApiError('Please sign in again.',401); return account; }
export const readWorkspace = async (query: Record<string, string>) => (await workspaceRequest("/api/mobile/workspace?" + new URLSearchParams(query))).json();
export const writeWorkspace = async (action: BusinessAction) => (await workspaceRequest("/api/mobile/workspace", action)).json();
export const downloadReport = async (period: AnalyticsPeriod) => (await workspaceRequest("/api/mobile/reports/export?" + new URLSearchParams(period))).text();
export const readOperations = async (propertyId?:string) => (await workspaceRequest('/api/mobile/operations'+(propertyId?'?propertyId='+encodeURIComponent(propertyId):''))).json();
export const writeOperation = async (action:OperationsAction) => (await workspaceRequest('/api/mobile/operations',action)).json();
export const readControls = async (query: Record<string,string>) => (await workspaceRequest('/api/mobile/controls?'+new URLSearchParams(query))).json();
// Accounts: expenses, payout reconciliation and owner statements. Team: schedule, decisions, routines, training.
export const readFinance = async (query: Record<string,string>) => (await workspaceRequest('/api/mobile/finance?'+new URLSearchParams(query))).json();
export const writeFinance = async (action: FinanceAction) => (await workspaceRequest('/api/mobile/finance',action)).json();
export const readTeams = async (query: Record<string,string>) => (await workspaceRequest('/api/mobile/teams?'+new URLSearchParams(query))).json();
export const writeTeams = async (action: TeamsAction) => (await workspaceRequest('/api/mobile/teams',action)).json();
// Administration: people and properties (admins only).
export const readAdmin = async (section: 'people' | 'properties' | 'accessControl' | 'accessHistory') => (await workspaceRequest('/api/mobile/admin?section='+section)).json();
export const writeAdmin = async (action: AdminAction) => (await workspaceRequest('/api/mobile/admin',action)).json();
export const requestPhoneReset = async (phone: string) => (await call('/api/mobile/recovery',{action:'request',phone})).json();
export const completePhoneReset = async (phone: string, code: string, password: string) => (await call('/api/mobile/recovery',{action:'verify',phone,code,password})).json();
export type PhotoPurpose = 'cleaning'|'mailbox'|'delivery'|'licence'|'maintenance'|'inspection'|'setup'|'expense';
// A photo goes on a work item, or (Accounts' invoice paperwork) on an expense.
export async function uploadWorkPhoto(input: {requestId: string;workId?: string;expenseId?: string;purpose: PhotoPurpose}, photo: {uri:string;name:string;type:'image/jpeg'|'image/png'|'image/webp'}) {
  const form = new FormData();
  form.append('requestId', input.requestId); form.append(input.expenseId ? 'expenseId' : 'workId', input.expenseId ?? input.workId ?? ''); form.append('purpose', input.purpose);
  // React Native's multipart transport accepts a local file descriptor; a browser needs the file's bytes.
  // The server verifies bytes, size and permission either way.
  if (Platform.OS === 'web') form.append('photo', new File([await (await fetch(photo.uri)).blob()], photo.name, { type: photo.type }));
  else form.append('photo', photo as unknown as Blob);
  return (await workspaceRequest('/api/mobile/media', form)).json();
}

// Photos already saved on a work item, and where to load each one from. In the browser the
// web session cookie goes with the image request; the phone app sends its access token.
export const readWorkMedia = async (workId: string) => (await workspaceRequest('/api/mobile/media?workId=' + encodeURIComponent(workId))).json();
export async function photoSource(assetId: string): Promise<{ uri: string; headers?: Record<string, string> }> {
  const path = '/api/mobile/media?assetId=' + encodeURIComponent(assetId);
  if (sameOriginWeb) return { uri: webWorkspacePath(path) };
  if (!session || session.expiresAt * 1000 <= Date.now() + 60000) await refresh();
  return { uri: liveApiOrigin() + path, headers: { Authorization: `Bearer ${session!.accessToken}`, 'X-Recharge-Client': 'native' } };
}

// Browser notifications (web push): Recharge's public key, and adding or removing this browser.
export const readNotificationKey = async () => z.object({ publicKey: z.string().nullable() }).parse(await (await call('/api/workspace/notifications')).json()).publicKey;
export const writeNotifications = async (body: { action: 'subscribe'; endpoint: string; p256dh: string; auth: string } | { action: 'unsubscribe'; endpoint: string }) => (await call('/api/workspace/notifications', body)).json();

// Messages: conversations, a conversation's messages, people to message, and sending.
export const readChat = async (query: Record<string, string>) => (await workspaceRequest('/api/mobile/chat?' + new URLSearchParams(query))).json();
export const writeChat = async (action: ChatAction) => (await workspaceRequest('/api/mobile/chat', action)).json();
// Course files (Training centre): admins upload; everyone the course is for opens them by a short link.
export async function uploadCourseFile(courseId: string, file: { uri: string; name: string; mimeType?: string; file?: File }) {
  const form = new FormData();
  form.append('courseId', courseId);
  if (Platform.OS === 'web') form.append('file', file.file ?? new File([await (await fetch(file.uri)).blob()], file.name, { type: file.mimeType ?? 'application/octet-stream' }));
  else form.append('file', { uri: file.uri, name: file.name, type: file.mimeType ?? 'application/octet-stream' } as unknown as Blob);
  return (await workspaceRequest('/api/mobile/training-files', form)).json();
}
export const removeCourseFile = async (fileId: string) => (await workspaceRequest('/api/mobile/training-files', { action: 'remove', fileId })).json();
export const courseFileLink = async (fileId: string) => z.object({ data: z.object({ url: z.string().url(), name: z.string(), mime: z.string() }) }).parse(await (await workspaceRequest('/api/mobile/training-files?fileId=' + encodeURIComponent(fileId))).json()).data;
export const readInbox = async (query: Record<string, string>) => (await workspaceRequest('/api/mobile/guest-inbox?' + new URLSearchParams(query))).json();
// Owner reports: confirmed bookings, nights and payouts at the owner's properties (read only).
export const readOwner = async (query: { section: 'bookings'; from: string; to: string }) => (await workspaceRequest('/api/mobile/owner?' + new URLSearchParams(query))).json();
export const writeInbox = async (action: InboxAction) => (await workspaceRequest('/api/mobile/guest-inbox', action)).json();
