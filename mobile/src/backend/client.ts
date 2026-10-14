import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { z } from "zod";
import { workspaceAccountSchema, type ProfileAction, type WorkspaceAccount } from "../../../lib/workspace-account-policy";
import type { BusinessAction } from "../../../lib/business-policy";
import type { AnalyticsPeriod } from "../../../lib/analytics";
import type { OperationsAction } from "../../../lib/operations-policy";
import type { FinanceAction } from '../../../lib/workspace-finance-policy';
import type { TeamsAction } from '../../../lib/workspace-teams-policy';
import type { AdminAction } from '../../../lib/workspace-admin-policy';
import { chatFileLinksSchema, type ChatAction } from '../../../lib/workspace-chat-policy';
import type { InboxAction } from '../../../lib/guest-inbox-policy';
import type { OversightAction } from '../../../lib/oversight-policy';
import type { ChecklistAction } from '../../../lib/clean-checklist-policy';
import type { ControlsAction } from '../../../lib/workspace-controls-policy';
import type { DeleteAccountInput } from '../../../lib/privacy-policy';
import { webWorkspacePath } from '../../../lib/workspace-web-path';
import { VIEW_AS_ENDED, VIEW_AS_HEADER, viewAsPeopleSchema } from '../../../lib/view-as';
import { DEMO_ROLES, DEMO_SAVE_MESSAGE, demoAnswer, demoDataSchema, demoPeople, type DemoData, type DemoRole } from '../../../lib/demo-data';
import { DemoEngine, demoEngineSupported, type DemoJobs, type DemoOpened } from '../demo/engine';
import { emitDemoChanged } from '../demo/notes';

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
async function call(path: string, body?: unknown, accessToken?: string, viewAs?: string) {
  const origin = liveApiOrigin();
  if (!origin) throw new WorkspaceApiError("The live mobile backend is awaiting configuration.", 503);
  const multipart = body instanceof FormData;
  // Photo uploads, a manual Hostaway sync (which pages through every listing and stay) and a payout report (up to about 2.5 MB) take longer.
  const slow = multipart || (body !== undefined && /\/integrations(?:[?]|$)/.test(path))
    || (typeof body === "object" && body !== null && (body as { action?: unknown }).action === "importPayoutReport");
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), slow ? 120000 : 15000);
  try {
    const response = await fetch(sameOriginWeb ? path : origin + path, {
      method: body === undefined ? "GET" : "POST", credentials: sameOriginWeb ? "same-origin" : "omit", redirect: sameOriginWeb ? "manual" : "error", signal: controller.signal,
      headers: { ...(sameOriginWeb ? {} : { "X-Recharge-Client": "native" }), ...(body === undefined || multipart ? {} : { "Content-Type": "application/json" }), ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...(viewAs ? { [VIEW_AS_HEADER]: viewAs } : {}) },
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
// A super admin's "View as" (lib/view-as.ts): while it is on nothing is saved, and when it is a
// person, every read carries their id so the database answers as them.
let viewOnly = "", viewing: string | null = null, viewEnded: (() => void) | null = null;
export function setViewOnly(message: string, person?: { userId: string; onEnded: () => void } | null) {
  viewOnly = message; viewing = message && person ? person.userId : null; viewEnded = message && person ? person.onEnded : null;
}
// Demo mode (lib/demo-data.ts): a super admin's switch to a sample business, as the persona being
// shown. In the browser it is interactive: the demo backend (src/demo/engine.ts) runs the real routes
// and database functions on a private copy kept in this browser, so every flow can be tried and
// nothing reaches the live backend. Where that can't run (the phone app, or no WebAssembly) the
// recorded answers are shown instead, read-only.
let demo: { data: DemoData; role: DemoRole } | null = null;
let demoEngine: { engine: DemoEngine; opened: DemoOpened; personIds: Partial<Record<DemoRole, string>> } | null = null;
// A tab that was in the demo opens it again after a reload (LiveWorkspace) once the signed-in account
// is back. Until then the app's reads wait, so a reloaded demo tab never reads the live records first.
// The same hold covers the moment Demo is being switched on.
const demoHold = () => { let resolve = () => undefined as void; const done = new Promise<void>(r => { resolve = r; }); return { done, resolve }; };
let demoResume: { done: Promise<void>; resolve: () => void } | null = (() => {
  try { return Platform.OS === "web" && globalThis.sessionStorage?.getItem("rc-demo") === "on" ? demoHold() : null; } catch { return null; }
})();
const releaseDemoHold = () => { demoResume?.resolve(); demoResume = null; };
let demoLoading = false;
// Waits while the demo is opening; a tab whose demo never comes back (30 seconds without it starting) carries on.
async function demoResumed() {
  while (demoResume && !demo) {
    const waiting = demoResume;
    await Promise.race([waiting.done, new Promise(r => setTimeout(r, 30_000))]);
    if (demoResume === waiting && !demoLoading) releaseDemoHold();
  }
}
export function setDemo(next: { data: DemoData; role: DemoRole } | null) {
  demo = next;
  releaseDemoHold();
  // The demo's files were links into its worker; they go with it.
  if (!next && demoEngine) { demoEngine.engine.stop(); demoEngine = null; demoPhotos.clear(); fileLinks.clear(); }
}
export const demoMode = () => demo;
// The interactive demo's state for the banner: whether it runs, and how it opened.
export const demoInteractive = () => demoEngine ? { opened: demoEngine.opened } : null;
// The demo business. Interactive: start the demo backend and take each sample person's account from
// it. Otherwise the recording (mobile/web-static/demo-data.json). Both are static files next to the
// app, fetched only when demo mode is switched on, so nobody else downloads them.
export async function loadDemoData(): Promise<DemoData> {
  demoResume ??= demoHold();
  demoLoading = true;
  try { return await openDemoData(); } catch (error) { releaseDemoHold(); throw error; } finally { demoLoading = false; }
}
async function startDemoEngine() {
  demoEngine?.engine.stop();
  const { engine, opened } = await DemoEngine.start();
  demoEngine = { engine, opened, personIds: Object.fromEntries(Object.entries(opened.personas).map(([role, p]) => [role, p.personId])) };
  return opened;
}
async function openDemoData(): Promise<DemoData> {
  if (demoEngineSupported() && sameOriginWeb) {
    try {
      const opened = await startDemoEngine();
      const personas = Object.fromEntries(DEMO_ROLES.filter(role => opened.personas[role]).map(role => [role, { account: opened.personas[role].account, responses: {}, loose: {} }]));
      return demoDataSchema.parse({ version: 2, capturedOn: londonToday(), answers: {}, personas });
    } catch (error) { demoEngine = null; console.warn('The interactive demo could not start; showing the recorded demo instead.', error); }
  }
  const origin = sameOriginWeb ? globalThis.location?.origin : liveApiOrigin();
  if (!origin) throw new WorkspaceApiError("The demo business is not available yet.", 503);
  const response = await fetch(origin + "/workspace/demo-data.json", { credentials: "omit", cache: "no-cache" });
  if (!response.ok) throw new WorkspaceApiError("The demo business could not be loaded. Try again.", response.status);
  return demoDataSchema.parse(await response.json());
}
// "Reset demo": this browser's copy is wiped and opened again from the sample business as it was
// built, in place (the screens load again; nothing is asked of the live backend).
export async function resetDemo() {
  if (!demoEngine) throw new WorkspaceApiError("The demo isn't running.", 409);
  await demoEngine.engine.reset();
  demoEngine = null; demoPhotos.clear(); fileLinks.clear();
  await startDemoEngine();
  emitDemoChanged();
}
// "Run today's automatic jobs": the backend's scheduled sweeps, on the demo's copy, now.
export async function runDemoJobs(): Promise<DemoJobs> {
  if (!demoEngine) throw new WorkspaceApiError("The demo isn't running.", 409);
  const done = await demoEngine.engine.jobs();
  emitDemoChanged();
  return done;
}
const londonToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
async function demoResponse(path: string, body: unknown) {
  const { data, role } = demo!;
  // This device's notification link and the app's own housekeeping need no answer in the demo.
  if (path.startsWith("/api/mobile/devices")) return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
  if (demoEngine) {
    const personId = demoEngine.personIds[role];
    if (!personId) throw new WorkspaceApiError("That person isn't in the demo business.", 404);
    const response = await demoEngine.engine.request(personId, body === undefined ? "GET" : "POST", webWorkspacePath(path), body);
    if (!response.ok) {
      const error = z.object({ error: z.string().max(500).optional() }).safeParse(await response.json().catch(() => ({})));
      throw new WorkspaceApiError(error.success && error.data.error ? error.data.error : "The request could not be completed.", response.status);
    }
    return response;
  }
  if (body !== undefined) throw new WorkspaceApiError(DEMO_SAVE_MESSAGE, 423);
  const answer = demoAnswer(data, role, path, londonToday());
  if (answer === null) throw new WorkspaceApiError("This part isn't in the demo business.", 404);
  return typeof answer === "string"
    ? new Response(answer, { status: 200, headers: { "content-type": "text/csv" } })
    : new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
}
// Whether this screen is a view (nothing is saved), and whose: a person's id, or null for a role preview.
export const viewMode = () => ({ readOnly: viewOnly !== "" || (demo !== null && !demoEngine), person: viewing });
export async function workspaceRequest(path: string, body?: BusinessAction | Record<string, unknown> | FormData, options: { asSelf?: boolean } = {}) {
  if (!/^\/api\/mobile\/(workspace|reports|devices|property-details|journeys|operations|portfolio|controls|media|integrations|finance|teams|admin|chat|guest-inbox|training-files|enquiry-files|chat-files|email-files|email-inbox|client-email|estimate-link|onboarding-settings|owner-account|profile|owner|oversight|checklists|privacy)(?:[/?]|$)/.test(path) || path.includes("..")) throw new Error("Unsupported workspace endpoint");
  if (!demo && demoResume && !options.asSelf) await demoResumed();
  if (demo) return await demoResponse(path, body);
  // While a super admin views the app as someone else nothing is saved (this device's own
  // notification link aside), so trying the screens never changes the business's records.
  if (viewOnly && body !== undefined && !options.asSelf && !path.startsWith("/api/mobile/devices")) throw new WorkspaceApiError(viewOnly, 423);
  const as = body === undefined && !options.asSelf && !path.startsWith("/api/mobile/devices") ? viewing ?? undefined : undefined;
  try {
    if (sameOriginWeb) return await call(webWorkspacePath(path), body, undefined, as);
    if (!session || session.expiresAt * 1000 <= Date.now() + 60000) await refresh();
    return await call(path, body, session!.accessToken, as);
  } catch (error) {
    if (as && error instanceof WorkspaceApiError && error.status === 409 && error.message === VIEW_AS_ENDED) viewEnded?.();
    throw error;
  }
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
// One work item by its id (an update whose item is not in the loaded list), and the 50 updates before a given one.
export const readWorkItem = async (workId: string) => (await workspaceRequest('/api/mobile/operations?workId=' + encodeURIComponent(workId))).json();
export const readOlderNotices = async (before: number) => (await workspaceRequest('/api/mobile/portfolio?section=notifications&before=' + encodeURIComponent(String(before)))).json();
export const writeOperation = async (action:OperationsAction) => (await workspaceRequest('/api/mobile/operations',action)).json();
export const readControls = async (query: Record<string,string>) => (await workspaceRequest('/api/mobile/controls?'+new URLSearchParams(query))).json();
export const writeControls = async (action: ControlsAction) => (await workspaceRequest('/api/mobile/controls',action)).json();
// Accounts: expenses, payout reconciliation and owner statements. Team: schedule, decisions, routines, training.
export const readFinance = async (query: Record<string,string>) => (await workspaceRequest('/api/mobile/finance?'+new URLSearchParams(query))).json();
export const writeFinance = async (action: FinanceAction) => (await workspaceRequest('/api/mobile/finance',action)).json();
export const readTeams = async (query: Record<string,string>) => (await workspaceRequest('/api/mobile/teams?'+new URLSearchParams(query))).json();
export const writeTeams = async (action: TeamsAction) => (await workspaceRequest('/api/mobile/teams',action)).json();
// Administration: people and properties (admins only).
// View as: who can be viewed, and starting or ending a view. These always go as the super admin.
// In demo mode the people are the sample business's, one per role.
export const readViewAsPeople = async () => demo ? demoPeople(demo.data) : viewAsPeopleSchema.parse((await (await workspaceRequest('/api/mobile/teams?section=viewAsPeople', undefined, { asSelf: true })).json()).data);
export const startViewAs = async (userId: string) => workspaceAccountSchema.parse((await (await workspaceRequest('/api/mobile/teams', { action: 'startViewAs', userId }, { asSelf: true })).json()).data);
export const stopViewAs = async () => { await workspaceRequest('/api/mobile/teams', { action: 'stopViewAs' }, { asSelf: true }); };
export const readAdmin = async (section: 'people' | 'properties' | 'accessControl' | 'accessHistory') => (await workspaceRequest('/api/mobile/admin?section='+section)).json();
export const writeAdmin = async (action: AdminAction) => (await workspaceRequest('/api/mobile/admin',action)).json();
export const requestPhoneReset = async (phone: string) => (await call('/api/mobile/recovery',{action:'request',phone})).json();
export const completePhoneReset = async (phone: string, code: string, password: string) => (await call('/api/mobile/recovery',{action:'verify',phone,code,password})).json();
export type PhotoPurpose = 'cleaning'|'mailbox'|'delivery'|'licence'|'maintenance'|'inspection'|'setup'|'expense';
// A photo goes on a work item, or (Accounts' invoice paperwork) on an expense.
export async function uploadWorkPhoto(input: {requestId: string;workId?: string;expenseId?: string;purpose: PhotoPurpose;checklistItem?: string}, photo: {uri:string;name:string;type:'image/jpeg'|'image/png'|'image/webp'}) {
  const form = new FormData();
  form.append('requestId', input.requestId); form.append(input.expenseId ? 'expenseId' : 'workId', input.expenseId ?? input.workId ?? ''); form.append('purpose', input.purpose);
  // A clean photo taken for one check on its checklist.
  if (input.checklistItem) form.append('checklistItem', input.checklistItem);
  // React Native's multipart transport accepts a local file descriptor; a browser needs the file's bytes.
  // The server verifies bytes, size and permission either way.
  if (Platform.OS === 'web') form.append('photo', new File([await (await fetch(photo.uri)).blob()], photo.name, { type: photo.type }));
  else form.append('photo', photo as unknown as Blob);
  return (await workspaceRequest('/api/mobile/media', form)).json();
}

// Photos already saved on a work item, and where to load each one from. In the browser the
// web session cookie goes with the image request; the phone app sends its access token.
export const readWorkMedia = async (workId: string) => (await workspaceRequest('/api/mobile/media?workId=' + encodeURIComponent(workId))).json();
// In demo mode photos are sample pictures drawn here (the demo has no photo files): a soft scene in
// one of four colours, picked by the photo's id so each keeps its look.
const DEMO_TINTS = [['#DCEAE4', '#1F5F55'], ['#F3E7CF', '#875A1C'], ['#E4EDD8', '#3F6A2A'], ['#DFE7E8', '#3B5866']];
function demoPhoto(assetId: string) {
  const [wash, ink] = DEMO_TINTS[[...assetId].reduce((n, c) => n + c.charCodeAt(0), 0) % DEMO_TINTS.length];
  if (Platform.OS !== 'web') return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGO48+oJAAVQAqur8NI4AAAAAElFTkSuQmCC'; // one pixel of mint wash
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${wash}"/><stop offset="1" stop-color="#FCFAF5"/></linearGradient></defs><rect width="400" height="300" fill="url(#g)"/><circle cx="310" cy="70" r="26" fill="${ink}" opacity=".18"/><path d="M0 230 L120 150 L200 205 L280 140 L400 225 L400 300 L0 300Z" fill="${ink}" opacity=".16"/><path d="M150 205 L200 165 L250 205 L250 255 L150 255Z" fill="${ink}" opacity=".55"/><rect x="188" y="222" width="24" height="33" rx="3" fill="#FCFAF5"/><text x="200" y="285" text-anchor="middle" font-family="Montserrat,Arial" font-size="15" font-weight="600" fill="${ink}" opacity=".7">Sample photo</text></svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}
// In the interactive demo a photo is read through the demo backend and shown from this browser's memory.
const demoPhotos = new Map<string, Promise<string>>();
function demoObjectUrl(key: string, path: string) {
  if (!demoPhotos.has(key)) demoPhotos.set(key, workspaceRequest(path).then(async r => r.headers.get('x-demo-location') || URL.createObjectURL(await r.blob())).catch(error => { demoPhotos.delete(key); throw error; }));
  return demoPhotos.get(key)!;
}
export async function photoSource(assetId: string): Promise<{ uri: string; headers?: Record<string, string> }> {
  if (demo && demoEngine) return { uri: await demoObjectUrl('media:' + assetId, '/api/mobile/media?assetId=' + encodeURIComponent(assetId)) };
  if (demo) return { uri: demoPhoto(assetId) };
  const path = '/api/mobile/media?assetId=' + encodeURIComponent(assetId);
  if (sameOriginWeb) return { uri: webWorkspacePath(path) };
  if (!session || session.expiresAt * 1000 <= Date.now() + 60000) await refresh();
  return { uri: liveApiOrigin() + path, headers: { Authorization: `Bearer ${session!.accessToken}`, 'X-Recharge-Client': 'native' } };
}

// Browser notifications (web push): Recharge's public key, how this person's devices are doing, adding or
// removing this browser, and a test notification with the push service's answer.
const pushDeviceSchema = z.object({ endpointHost: z.string().nullable(), since: z.string(), sent: z.number(), failed: z.number(), lastStatus: z.number().nullable(), lastAt: z.string().nullable() });
export type PushDevice = z.infer<typeof pushDeviceSchema>;
const notificationStatusSchema = z.object({ publicKey: z.string().nullable(), devices: z.array(pushDeviceSchema).nullable().optional() });
export const readNotificationStatus = async () => demo || demoResume ? { publicKey: null, devices: null } : notificationStatusSchema.parse(await (await call('/api/workspace/notifications')).json());
export const readNotificationKey = async () => demo || demoResume ? null : (await readNotificationStatus()).publicKey;
type PushAddress = { endpoint: string; p256dh: string; auth: string };
export const writeNotifications = async (body: ({ action: 'subscribe' } & PushAddress) | { action: 'unsubscribe'; endpoint: string }) => demo || demoResume ? { ok: true } : (await call('/api/workspace/notifications', body)).json();
export const testNotification = async (address: PushAddress) => demo || demoResume ? { outcome: 'failed' as const, status: 0 } : z.object({ data: z.object({ outcome: z.enum(['sent', 'gone', 'failed']), status: z.number() }) })
  .parse(await (await call('/api/workspace/notifications', { action: 'test', ...address })).json()).data;

// Messages: conversations, a conversation's messages, people to message, and sending.
export const readChat = async (query: Record<string, string>) => (await workspaceRequest('/api/mobile/chat?' + new URLSearchParams(query))).json();
export const writeChat = async (action: ChatAction) => (await workspaceRequest('/api/mobile/chat', action)).json();
// Photos and videos in Messages: links to open them (for an hour, kept here so pictures don't
// reload), and sending a file straight to storage with its one-off upload link.
const fileLinks = new Map<string, { url: string; mime: string; name: string; kind: 'image' | 'video'; until: number }>();
export async function chatFileLinks(ids: string[]) {
  const now = Date.now(), wanted = [...new Set(ids)].filter(id => !((fileLinks.get(id)?.until ?? 0) > now));
  if (demo && !demoEngine) for (const id of wanted) fileLinks.set(id, { url: demoPhoto(id), mime: 'image/svg+xml', name: 'Sample photo', kind: 'image', until: now + 3600_000 });
  else for (let i = 0; i < wanted.length; i += 60) {
    const found = chatFileLinksSchema.parse((await (await workspaceRequest('/api/mobile/chat-files?' + new URLSearchParams({ ids: wanted.slice(i, i + 60).join(',') }))).json()).data);
    for (const [id, link] of Object.entries(found)) fileLinks.set(id, { ...link, until: now + 50 * 60_000 });
  }
  return new Map(ids.flatMap(id => { const link = fileLinks.get(id); return link ? [[id, link] as const] : []; }));
}
export async function uploadToLink(uploadUrl: string, file: { uri: string; file?: File; type: string }, onProgress?: (share: number) => void) {
  const body: Blob = Platform.OS === 'web' && file.file ? file.file : await (await fetch(file.uri)).blob();
  // The demo's upload links are kept by the demo backend, in this browser.
  if (demo && demoEngine) {
    if (!uploadUrl.startsWith('demo-upload://')) throw new WorkspaceApiError('The upload did not finish. Try again.', 400);
    await demoEngine.engine.put(uploadUrl, body).catch(error => { throw new WorkspaceApiError(error?.message ?? 'The upload did not finish. Try again.', error?.status ?? 500); });
    onProgress?.(1);
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    xhr.setRequestHeader('Content-Type', file.type); xhr.setRequestHeader('x-upsert', 'false'); xhr.setRequestHeader('Cache-Control', 'max-age=3600');
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new WorkspaceApiError(xhr.status === 413 ? 'This file is too large.' : 'The upload did not finish. Try again.', xhr.status));
    xhr.onerror = () => reject(new WorkspaceApiError('The upload did not finish. Check your connection and try again.', 0));
    xhr.send(body);
  });
}
// Profile photos: where to load someone's photo from (null in the demo), and changing your own.
export async function profilePhotoSource(userId: string, version: string): Promise<{ uri: string; headers?: Record<string, string> } | null> {
  if (demo && demoEngine) return demoObjectUrl('profile:' + userId + ':' + version, '/api/mobile/profile?' + new URLSearchParams({ userId, v: version })).then(uri => ({ uri })).catch(() => null);
  if (demo) return null;
  const path = '/api/mobile/profile?' + new URLSearchParams({ userId, v: version });
  if (sameOriginWeb) return { uri: webWorkspacePath(path) };
  if (!session || session.expiresAt * 1000 <= Date.now() + 60000) await refresh();
  return { uri: liveApiOrigin() + path, headers: { Authorization: `Bearer ${session!.accessToken}`, 'X-Recharge-Client': 'native' } };
}
export const writeProfile = async (action: ProfileAction) => workspaceAccountSchema.parse((await (await workspaceRequest('/api/mobile/profile', action)).json()).data);
export async function uploadProfilePhoto(photo: { uri: string; name: string; type: string; file?: File }) {
  const form = new FormData();
  if (Platform.OS === 'web') form.append('photo', photo.file ?? new File([await (await fetch(photo.uri)).blob()], photo.name, { type: photo.type }));
  else form.append('photo', { uri: photo.uri, name: photo.name, type: photo.type } as unknown as Blob);
  return workspaceAccountSchema.parse((await (await workspaceRequest('/api/mobile/profile', form)).json()).data);
}
// Course files (Training centre): admins upload; everyone the course is for opens them by a short link.
export async function uploadCourseFile(courseId: string, file: { uri: string; name: string; mimeType?: string; file?: File }) {
  const form = new FormData();
  form.append('courseId', courseId);
  if (Platform.OS === 'web') form.append('file', file.file ?? new File([await (await fetch(file.uri)).blob()], file.name, { type: file.mimeType ?? 'application/octet-stream' }));
  else form.append('file', { uri: file.uri, name: file.name, type: file.mimeType ?? 'application/octet-stream' } as unknown as Blob);
  return (await workspaceRequest('/api/mobile/training-files', form)).json();
}
// Onboarding settings (admins): the contract used as the agreement template, Recharge's details and the own-cost categories.
export const readOnboardingSettings = async () => (await workspaceRequest('/api/mobile/onboarding-settings')).json();
export const saveOnboardingSettings = async (action: Record<string, unknown>) => (await workspaceRequest('/api/mobile/onboarding-settings', action)).json();
export async function uploadAgreementTemplate(requestId: string, file: { uri: string; name: string; mimeType?: string; file?: File }) {
  const form = new FormData();
  form.append('requestId', requestId);
  if (Platform.OS === 'web') form.append('file', file.file ?? new File([await (await fetch(file.uri)).blob()], file.name, { type: file.mimeType ?? 'application/octet-stream' }));
  else form.append('file', { uri: file.uri, name: file.name, type: file.mimeType ?? 'application/octet-stream' } as unknown as Blob);
  return (await workspaceRequest('/api/mobile/onboarding-settings', form)).json();
}
// A contract's file by a short link: admins any; an owner the one their own agreement was made from.
export const agreementFileLink = async (templateId: string, propertyId?: string) => z.object({ data: z.object({ url: z.string().url(), name: z.string(), mime: z.string() }) })
  .parse(await (await workspaceRequest('/api/mobile/onboarding-settings?' + new URLSearchParams(propertyId ? { templateId, propertyId } : { templateId }))).json()).data;
// The owner's app account made when they pressed Proceed: send the sign-in email again (the team).
export const resendOwnerAccountEmail = async (propertyId: string, requestId: string) => (await workspaceRequest('/api/mobile/owner-account', { action: 'resend', propertyId, requestId })).json();
export const removeCourseFile = async (fileId: string) => (await workspaceRequest('/api/mobile/training-files', { action: 'remove', fileId })).json();
export const courseFileLink = async (fileId: string) => z.object({ data: z.object({ url: z.string().url(), name: z.string(), mime: z.string() }) }).parse(await (await workspaceRequest('/api/mobile/training-files?fileId=' + encodeURIComponent(fileId))).json()).data;
// Photos and videos landlords sent with the enquiry form, opened by a short link.
export const enquiryFileLink = async (enquiryId: string, fileId: string) => z.object({ data: z.object({ url: z.string().url(), name: z.string(), mime: z.string() }) }).parse(await (await workspaceRequest('/api/mobile/enquiry-files?' + new URLSearchParams({ enquiryId, fileId }))).json()).data;
export const readInbox = async (query: Record<string, string>) => (await workspaceRequest('/api/mobile/guest-inbox?' + new URLSearchParams(query))).json();
// Owner reports: confirmed bookings, nights and payouts at the owner's properties, and statement figures by month (read only).
export const readOwner = async (query: { section: 'bookings' | 'periods'; from: string; to: string }) => (await workspaceRequest('/api/mobile/owner?' + new URLSearchParams(query))).json();
export const writeOwner = async (action: import('../../../lib/owner-policy').OwnerAction) => (await workspaceRequest('/api/mobile/owner', action)).json();
export const writeInbox = async (action: InboxAction) => (await workspaceRequest('/api/mobile/guest-inbox', action)).json();
// Email in Messages: an attachment is opened by a fresh short link each time (never kept), and owner email from addresses Recharge does not know waits in a list.
export const emailFileLink = async (id: string) => {
  const found = z.record(z.string(), z.object({ url: z.string().url(), name: z.string(), mime: z.string(), bytes: z.number() })).parse((await (await workspaceRequest('/api/mobile/email-files?' + new URLSearchParams({ ids: id }))).json()).data);
  if (!found[id]) throw new Error('You cannot open this file');
  return found[id];
};
// Client email conversations (ownerrelations@ from someone who is not an owner yet): list, one conversation, and reply / close / reopen / assign.
export const readClientEmail = async (query: { section: 'list' } | { section: 'thread'; threadId: string }) => (await workspaceRequest('/api/mobile/client-email?' + new URLSearchParams(query))).json();
export const writeClientEmail = async (action: import('../../../lib/client-email-policy').ClientEmailAction) => (await workspaceRequest('/api/mobile/client-email', action)).json();
// The estimate emailed with a private link: email it again, or make a link to send by hand.
export const writeEstimateLink = async (action: import('../../../lib/estimate-link').EstimateLinkAction) => (await workspaceRequest('/api/mobile/estimate-link', action)).json() as Promise<{ data?: { link: string; estimateDelivery: unknown } }>;
export const readEmailInbox = async () => (await workspaceRequest('/api/mobile/email-inbox')).json();
export const writeEmailInbox = async (action: { action: 'assign'; id: string; ownerId: string } | { action: 'dismiss'; id: string }) => (await workspaceRequest('/api/mobile/email-inbox', action)).json();
// Management oversight: the business overview, an item's history, the decisions report and management's reminders.
export const readOversight = async (query: Record<string, string>) => (await workspaceRequest('/api/mobile/oversight?' + new URLSearchParams(query))).json();
export const writeOversight = async (action: OversightAction) => (await workspaceRequest('/api/mobile/oversight', action)).json();
// Clean checklists: the checklists to edit, the photo rules on one clean, and saving a checklist.
export const readChecklists = async (query: Record<string, string>) => (await workspaceRequest('/api/mobile/checklists?' + new URLSearchParams(query))).json();
export const writeChecklists = async (action: ChecklistAction) => (await workspaceRequest('/api/mobile/checklists', action)).json();
// Your own data: what deleting your account would mean, a full copy, and deleting the account.
export const readPrivacy = async (query: { section: 'deletion' | 'export' }) => (await workspaceRequest('/api/mobile/privacy?' + new URLSearchParams(query))).json();
export async function deleteMyAccount(input: DeleteAccountInput) {
  await workspaceRequest('/api/mobile/privacy', input);
  // The server has ended every session; forget this one here too.
  session = null; account = null;
  if (!sameOriginWeb) await SecureStore.deleteItemAsync(storedRefreshKey, storageOptions).catch(() => undefined);
}
