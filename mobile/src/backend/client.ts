import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { z } from "zod";
import { workspaceAccountSchema, type WorkspaceAccount } from "../../../lib/workspace-account-policy";
import type { BusinessAction } from "../../../lib/business-policy";
import type { AnalyticsPeriod } from "../../../lib/analytics";
import type { JourneyAction } from "../../../lib/journey-policy";
import type { OperationsAction } from "../../../lib/operations-policy";
import type { PortfolioAction } from "../../../lib/portfolio-policy";

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
export function liveApiOrigin(): string | null {
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
    const response = await fetch(origin + path, {
      method: body === undefined ? "GET" : "POST", credentials: "omit", redirect: "error", signal: controller.signal,
      headers: { "X-Recharge-Client": "native", ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
export async function signIn(email: string, password: string) {
  const response = await call("/api/mobile/session", { action: "login", email, password });
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
export async function workspaceRequest(path: string, body?: BusinessAction | Record<string, unknown>) {
  if (!/^\/api\/mobile\/(workspace|reports|devices|property-details|journeys|operations|portfolio)(?:[/?]|$)/.test(path) || path.includes("..")) throw new Error("Unsupported workspace endpoint");
  if (!session || session.expiresAt * 1000 <= Date.now() + 60000) await refresh();
  return call(path, body, session!.accessToken);
}
export async function signOut() {
  try { if (!session) await refresh(); await call("/api/mobile/session", { action: "logout" }, session!.accessToken); }
  finally { session = null; account = null; await SecureStore.deleteItemAsync(storedRefreshKey, storageOptions); }
}
export async function restoreAccount() { await refresh(); if (!account) throw new WorkspaceApiError('Please sign in again.',401); return account; }
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
