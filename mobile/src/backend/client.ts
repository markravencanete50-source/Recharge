import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { z } from "zod";
import { workspaceAccountSchema, type WorkspaceAccount } from "../../../lib/workspace-account-policy";
import type { BusinessAction } from "../../../lib/business-policy";
import type { AnalyticsPeriod } from "../../../lib/analytics";
import type { JourneyAction } from "../../../lib/journey-policy";
import type { OperationsAction } from "../../../lib/operations-policy";
import type { PortfolioAction } from "../../../lib/portfolio-policy";
import type { ControlsAction } from '../../../lib/workspace-controls-policy';
import type { FinanceAction } from '../../../lib/workspace-finance-policy';
import type { TeamsAction } from '../../../lib/workspace-teams-policy';
import type { AdminAction } from '../../../lib/workspace-admin-policy';
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
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const multipart = body instanceof FormData;
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
export async function workspaceRequest(path: string, body?: BusinessAction | Record<string, unknown> | FormData) {
  if (!/^\/api\/mobile\/(workspace|reports|devices|property-details|journeys|operations|portfolio|controls|media|integrations|finance|teams|admin)(?:[/?]|$)/.test(path) || path.includes("..")) throw new Error("Unsupported workspace endpoint");
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
export const readReports = async (period: AnalyticsPeriod) => (await workspaceRequest("/api/mobile/reports?" + new URLSearchParams(period))).json();
export const downloadReport = async (period: AnalyticsPeriod) => (await workspaceRequest("/api/mobile/reports/export?" + new URLSearchParams(period))).text();
export const readJourneys = async (propertyId?:string) => (await workspaceRequest('/api/mobile/journeys'+(propertyId?'?propertyId='+encodeURIComponent(propertyId):''))).json();
export const writeJourney = async (action:JourneyAction) => (await workspaceRequest('/api/mobile/journeys',action)).json();
export const readOperations = async (propertyId?:string) => (await workspaceRequest('/api/mobile/operations'+(propertyId?'?propertyId='+encodeURIComponent(propertyId):''))).json();
export const writeOperation = async (action:OperationsAction) => (await workspaceRequest('/api/mobile/operations',action)).json();
export const readPortfolio = async (query:Record<string,string>={}) => (await workspaceRequest('/api/mobile/portfolio?'+new URLSearchParams(query))).json();
export const writePortfolio = async (action:PortfolioAction) => (await workspaceRequest('/api/mobile/portfolio',action)).json();
export const readControls = async (query: Record<string,string>) => (await workspaceRequest('/api/mobile/controls?'+new URLSearchParams(query))).json();
export const writeControls = async (action: ControlsAction) => (await workspaceRequest('/api/mobile/controls',action)).json();
// Accounts: expenses, payout reconciliation and owner statements. Team: schedule, decisions, routines, training.
export const readFinance = async (query: Record<string,string>) => (await workspaceRequest('/api/mobile/finance?'+new URLSearchParams(query))).json();
export const writeFinance = async (action: FinanceAction) => (await workspaceRequest('/api/mobile/finance',action)).json();
export const readTeams = async (query: Record<string,string>) => (await workspaceRequest('/api/mobile/teams?'+new URLSearchParams(query))).json();
export const writeTeams = async (action: TeamsAction) => (await workspaceRequest('/api/mobile/teams',action)).json();
// Administration: people and properties (admins only).
export const readAdmin = async (section: 'people' | 'properties') => (await workspaceRequest('/api/mobile/admin?section='+section)).json();
export const writeAdmin = async (action: AdminAction) => (await workspaceRequest('/api/mobile/admin',action)).json();
export const requestPhoneReset = async (phone: string) => (await call('/api/mobile/recovery',{action:'request',phone})).json();
export const completePhoneReset = async (phone: string, code: string, password: string) => (await call('/api/mobile/recovery',{action:'verify',phone,code,password})).json();
export async function uploadWorkPhoto(input: {requestId: string;workId: string;purpose: 'cleaning'|'mailbox'|'delivery'|'licence'|'maintenance'}, photo: {uri:string;name:string;type:'image/jpeg'|'image/png'|'image/webp'}) {
  const form = new FormData();
  form.append('requestId', input.requestId); form.append('workId', input.workId); form.append('purpose', input.purpose);
  // React Native's multipart transport accepts a local file descriptor. The server verifies bytes, size and permission.
  form.append('photo', photo as unknown as Blob);
  return (await workspaceRequest('/api/mobile/media', form)).json();
}
