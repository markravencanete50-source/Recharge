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
import type { DocumentsAction } from '../../../lib/invoice-maker';
import type { FurnishingAction } from '../../../lib/furnishing-studio';
import type { DeleteAccountInput } from '../../../lib/privacy-policy';
import { webWorkspacePath } from '../../../lib/workspace-web-path';
import { VIEW_AS_ENDED, VIEW_AS_HEADER, viewAsPeopleSchema } from '../../../lib/view-as';
import { contractorsQuery, limitsQuery, type RepairLimitAction } from '../../../lib/repair-contractors';
import { cleanerRepairsQuery } from '../../../lib/cleaner-repairs';

const storedRefreshKey = "recharge.live.refresh.v1";
const storageOptions = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
const tokenSchema = z.string().min(20).max(8192).regex(/^[A-Za-z0-9_.-]+$/);
const sessionSchema = z.object({ accessToken: tokenSchema, refreshToken: tokenSchema.max(2048), expiresAt: z.number().int().positive() });
const sessionResponse = z.object({ session: sessionSchema, account: workspaceAccountSchema.optional() });
let session: z.infer<typeof sessionSchema> | null = null;
let account: WorkspaceAccount | null = null;
let refreshInFlight: Promise<void> | null = null;

export class WorkspaceApiError extends Error {
  // `field`: the form field a refusal is about, when the server names one (the property journey does).
  constructor(message: string, readonly status: number, readonly retryAfter = 0, readonly field: string | null = null) { super(message); this.name = "WorkspaceApiError"; }
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
      const error = z.object({ error: z.string().max(500).optional(), field: z.string().max(100).nullable().optional() }).safeParse(await response.json().catch(() => ({})));
      const retry = Number(response.headers.get("Retry-After"));
      throw new WorkspaceApiError(error.success && error.data.error ? error.data.error : "The request could not be completed.", response.status, Number.isFinite(retry) ? retry : 0, error.success ? error.data.field ?? null : null);
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
// Whether this screen is a view (nothing is saved), and whose: a person's id, or null for a role preview.
export const viewMode = () => ({ readOnly: viewOnly !== "", person: viewing });
// Identical reads already on their way are shared: screens that open together often ask for the same thing (Home's shift
// button and end-of-day card, the to-do hub), and each caller gets its own copy of the one answer. A save forgets them, so a
// read made after it is always fresh.
const readsInFlight = new Map<string, Promise<Response>>();
export async function workspaceRequest(path: string, body?: BusinessAction | Record<string, unknown> | FormData, options: { asSelf?: boolean } = {}) {
  if (!/^\/api\/mobile\/(workspace|reports|devices|property-details|journeys|operations|portfolio|controls|media|integrations|finance|teams|admin|chat|guest-inbox|training-files|lead-files|enquiry-files|chat-files|email-files|email-inbox|client-email|estimate-link|onboarding-settings|owner-account|profile|owner|oversight|checklists|privacy|documents|furnishing|client-onboarding|agreement-follow-ups|onboarding-fee|onboarding-package|listing|listing-photos)(?:[/?]|$)/.test(path) || path.includes("..")) throw new Error("Unsupported workspace endpoint");
  // While a super admin views the app as someone else nothing is saved (this device's own
  // notification link aside), so trying the screens never changes the business's records.
  if (viewOnly && body !== undefined && !options.asSelf && !path.startsWith("/api/mobile/devices")) throw new WorkspaceApiError(viewOnly, 423);
  const as = body === undefined && !options.asSelf && !path.startsWith("/api/mobile/devices") ? viewing ?? undefined : undefined;
  if (body !== undefined) {
    readsInFlight.clear();
    try { return await send(path, body, as); } finally { readsInFlight.clear(); }
  }
  const key = path + "\n" + (as ?? "");
  let shared = readsInFlight.get(key);
  if (!shared) {
    const read = send(path, undefined, as);
    const settled = () => { if (readsInFlight.get(key) === read) readsInFlight.delete(key); };
    read.then(settled, settled);
    readsInFlight.set(key, shared = read);
  }
  return (await shared).clone();
}
async function send(path: string, body: BusinessAction | Record<string, unknown> | FormData | undefined, as: string | undefined) {
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
// One kind of work only, such as the repairs ("maintenance"), instead of every work item in the business.
export const readOperationsOfKind = async (kind:string) => (await workspaceRequest('/api/mobile/operations?kind='+encodeURIComponent(kind))).json();
// One work item by its id (an update whose item is not in the loaded list), and the 50 updates before a given one.
export const readWorkItem = async (workId: string) => (await workspaceRequest('/api/mobile/operations?workId=' + encodeURIComponent(workId))).json();
export const readOlderNotices = async (before: number) => (await workspaceRequest('/api/mobile/portfolio?section=notifications&before=' + encodeURIComponent(String(before)))).json();
export const writeOperation = async (action:OperationsAction) => (await workspaceRequest('/api/mobile/operations',action)).json();
export const readControls = async (query: Record<string,string>) => (await workspaceRequest('/api/mobile/controls?'+new URLSearchParams(query))).json();
export const writeControls = async (action: ControlsAction) => (await workspaceRequest('/api/mobile/controls',action)).json();
// Accounts: expenses, payout reconciliation and owner statements. Team: schedule, decisions, routines, training.
export const readFinance = async (query: Record<string,string>) => (await workspaceRequest('/api/mobile/finance?'+new URLSearchParams(query))).json();
export const writeFinance = async (action: FinanceAction) => (await workspaceRequest('/api/mobile/finance',action)).json();
// Recharge's invoices and the invoice maker (lib/invoice-maker.ts, migration 20261022100000).
export const readDocuments = async (query: Record<string,string>) => (await workspaceRequest('/api/mobile/documents?'+new URLSearchParams(query))).json();
export const writeDocuments = async (action: DocumentsAction) => (await workspaceRequest('/api/mobile/documents',action)).json();
// Furnishing Studio (Stays team and management): catalogue, projects, shopping list and analytics.
export const readFurnishing = async (query: Record<string,string>) => (await workspaceRequest('/api/mobile/furnishing?'+new URLSearchParams(query))).json();
export const writeFurnishing = async (action: FurnishingAction) => (await workspaceRequest('/api/mobile/furnishing',action)).json();
export const readTeams = async (query: Record<string,string>) => (await workspaceRequest('/api/mobile/teams?'+new URLSearchParams(query))).json();
export const writeTeams = async (action: TeamsAction) => (await workspaceRequest('/api/mobile/teams',action)).json();
// Administration: people and properties (admins only).
// View as: who can be viewed, and starting or ending a view. These always go as the super admin.
export const readViewAsPeople = async () => viewAsPeopleSchema.parse((await (await workspaceRequest('/api/mobile/teams?section=viewAsPeople', undefined, { asSelf: true })).json()).data);
export const startViewAs = async (userId: string) => workspaceAccountSchema.parse((await (await workspaceRequest('/api/mobile/teams', { action: 'startViewAs', userId }, { asSelf: true })).json()).data);
export const stopViewAs = async () => { await workspaceRequest('/api/mobile/teams', { action: 'stopViewAs' }, { asSelf: true }); };
export const readAdmin = async (section: 'people' | 'properties' | 'accessControl' | 'accessHistory') => (await workspaceRequest('/api/mobile/admin?section='+section)).json();
export const writeAdmin = async (action: AdminAction) => (await workspaceRequest('/api/mobile/admin',action)).json();
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
// Repairs with contractors (lib/repair-contractors.ts): the contractors for a property, and a contractor's quote or invoice
// as a PDF (photos go through the upload queue like any other photo). The server checks the file and who may add it.
export const readRepairContractors = async (propertyId: string) => (await workspaceRequest('/api/mobile/operations' + contractorsQuery(propertyId))).json();
// Limit Changer: every owner's properties and their repair limits; a super admin changes one or several.
export const readRepairLimits = async () => (await workspaceRequest('/api/mobile/operations' + limitsQuery())).json();
// The repairs a cleaner reported and where each is up to (lib/cleaner-repairs.ts; cleaners only).
export const readCleanerRepairs = async () => (await workspaceRequest('/api/mobile/operations' + cleanerRepairsQuery())).json();
export const writeRepairLimit = async (action: RepairLimitAction) => (await workspaceRequest('/api/mobile/operations', action)).json();
export async function uploadWorkFile(input: { requestId: string; workId: string; purpose: PhotoPurpose }, file: { uri: string; name: string; file?: File }) {
  const form = new FormData();
  form.append('requestId', input.requestId); form.append('workId', input.workId); form.append('purpose', input.purpose);
  if (Platform.OS === 'web') form.append('photo', file.file ?? new File([await (await fetch(file.uri)).blob()], file.name, { type: 'application/pdf' }));
  else form.append('photo', { uri: file.uri, name: file.name, type: 'application/pdf' } as unknown as Blob);
  return (await workspaceRequest('/api/mobile/media', form)).json();
}
export const readWorkMedia = async (workId: string) => (await workspaceRequest('/api/mobile/media?workId=' + encodeURIComponent(workId))).json();
export async function photoSource(assetId: string): Promise<{ uri: string; headers?: Record<string, string> }> {
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
export const readNotificationStatus = async () => notificationStatusSchema.parse(await (await call('/api/workspace/notifications')).json());
type PushAddress = { endpoint: string; p256dh: string; auth: string };
export const writeNotifications = async (body: ({ action: 'subscribe' } & PushAddress) | { action: 'unsubscribe'; endpoint: string }) => (await call('/api/workspace/notifications', body)).json();
export const testNotification = async (address: PushAddress) => z.object({ data: z.object({ outcome: z.enum(['sent', 'gone', 'failed']), status: z.number() }) })
  .parse(await (await call('/api/workspace/notifications', { action: 'test', ...address })).json()).data;

// Messages: conversations, a conversation's messages, people to message, and sending.
export const readChat = async (query: Record<string, string>) => (await workspaceRequest('/api/mobile/chat?' + new URLSearchParams(query))).json();
export const writeChat = async (action: ChatAction) => (await workspaceRequest('/api/mobile/chat', action)).json();
// Photos and videos in Messages: links to open them (for an hour, kept here so pictures don't
// reload), and sending a file straight to storage with its one-off upload link.
const fileLinks = new Map<string, { url: string; mime: string; name: string; kind: 'image' | 'video' | 'audio'; until: number }>();
export async function chatFileLinks(ids: string[]) {
  const now = Date.now(), wanted = [...new Set(ids)].filter(id => !((fileLinks.get(id)?.until ?? 0) > now));
  for (let i = 0; i < wanted.length; i += 60) {
    const found = chatFileLinksSchema.parse((await (await workspaceRequest('/api/mobile/chat-files?' + new URLSearchParams({ ids: wanted.slice(i, i + 60).join(',') }))).json()).data);
    for (const [id, link] of Object.entries(found)) fileLinks.set(id, { ...link, until: now + 50 * 60_000 });
  }
  return new Map(ids.flatMap(id => { const link = fileLinks.get(id); return link ? [[id, link] as const] : []; }));
}
export async function uploadToLink(uploadUrl: string, file: { uri: string; file?: File; type: string }, onProgress?: (share: number) => void) {
  const body: Blob = Platform.OS === 'web' && file.file ? file.file : await (await fetch(file.uri)).blob();
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
// Profile photos: where to load someone's photo from, and changing your own.
export async function profilePhotoSource(userId: string, version: string): Promise<{ uri: string; headers?: Record<string, string> } | null> {
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
// The owner's onboarding checklist and the onboarding videos (migration 20261025200000).
export const readClientOnboarding = async (propertyId?: string) => (await workspaceRequest('/api/mobile/client-onboarding' + (propertyId ? '?' + new URLSearchParams({ propertyId }) : ''))).json();
export const saveClientOnboarding = async (action: Record<string, unknown>) => (await workspaceRequest('/api/mobile/client-onboarding', action)).json();
export async function uploadAgreementTemplate(requestId: string, file: { uri: string; name: string; mimeType?: string; file?: File }) {
  const form = new FormData();
  form.append('requestId', requestId);
  if (Platform.OS === 'web') form.append('file', file.file ?? new File([await (await fetch(file.uri)).blob()], file.name, { type: file.mimeType ?? 'application/octet-stream' }));
  else form.append('file', { uri: file.uri, name: file.name, type: file.mimeType ?? 'application/octet-stream' } as unknown as Blob);
  return (await workspaceRequest('/api/mobile/onboarding-settings', form)).json();
}
// An agreement's wording read from a Word document, to edit before publishing (stays and admins; nothing is kept).
export async function readAgreementText(file: { uri: string; name: string; mimeType?: string; file?: File }) {
  const form = new FormData();
  form.append('read', '1');
  if (Platform.OS === 'web') form.append('file', file.file ?? new File([await (await fetch(file.uri)).blob()], file.name, { type: file.mimeType ?? 'application/octet-stream' }));
  else form.append('file', { uri: file.uri, name: file.name, type: file.mimeType ?? 'application/octet-stream' } as unknown as Blob);
  return z.object({ data: z.object({ text: z.string(), format: z.literal('outline') }) }).parse(await (await workspaceRequest('/api/mobile/onboarding-settings', form)).json()).data;
}
// A contract's file by a short link: admins any; an owner the one their own agreement was made from.
export const agreementFileLink = async (templateId: string, propertyId?: string) => z.object({ data: z.object({ url: z.string().url(), name: z.string(), mime: z.string() }) })
  .parse(await (await workspaceRequest('/api/mobile/onboarding-settings?' + new URLSearchParams(propertyId ? { templateId, propertyId } : { templateId }))).json()).data;
// The owner's app account made when they pressed Proceed: send the sign-in email again (the team).
export const resendOwnerAccountEmail = async (propertyId: string, requestId: string) => (await workspaceRequest('/api/mobile/owner-account', { action: 'resend', propertyId, requestId })).json();
// The PriceLabs report kept with a lead (External Analysis): the team who work with enquiries upload, open and remove it.
export async function uploadLeadFile(enquiryId: string, file: { uri: string; name: string; mimeType?: string; file?: File }) {
  const form = new FormData();
  form.append('enquiryId', enquiryId);
  if (Platform.OS === 'web') form.append('file', file.file ?? new File([await (await fetch(file.uri)).blob()], file.name, { type: file.mimeType ?? 'application/octet-stream' }));
  else form.append('file', { uri: file.uri, name: file.name, type: file.mimeType ?? 'application/octet-stream' } as unknown as Blob);
  return z.object({ data: z.unknown() }).parse(await (await workspaceRequest('/api/mobile/lead-files', form)).json()).data;
}
export const removeLeadFile = async (enquiryId: string, fileId: string) => (await workspaceRequest('/api/mobile/lead-files', { action: 'remove', enquiryId, fileId })).json();
export const leadFileLink = async (enquiryId: string, fileId: string) => z.object({ data: z.object({ url: z.string().url(), name: z.string(), mime: z.string() }) })
  .parse(await (await workspaceRequest('/api/mobile/lead-files?' + new URLSearchParams({ enquiryId, fileId }))).json()).data;
// A listing's photos (migration 20261028200000): the team who see enquiries add and open them.
export async function uploadListingPhoto(propertyId: string, file: { uri: string; name: string; mimeType?: string; file?: File }) {
  const form = new FormData();
  form.append('propertyId', propertyId);
  if (Platform.OS === 'web') form.append('file', file.file ?? new File([await (await fetch(file.uri)).blob()], file.name, { type: file.mimeType ?? 'image/jpeg' }));
  else form.append('file', { uri: file.uri, name: file.name, type: file.mimeType ?? 'image/jpeg' } as unknown as Blob);
  return z.object({ data: z.unknown() }).parse(await (await workspaceRequest('/api/mobile/listing-photos', form)).json()).data;
}
export const listingPhotoLink = async (propertyId: string, photoId: string) => z.object({ data: z.object({ url: z.string().url(), name: z.string(), mime: z.string() }) })
  .parse(await (await workspaceRequest('/api/mobile/listing-photos?' + new URLSearchParams({ propertyId, photoId }))).json()).data;
export const removeCourseFile = async (fileId: string) => (await workspaceRequest('/api/mobile/training-files', { action: 'remove', fileId })).json();
export const courseFileLink = async (fileId: string) => z.object({ data: z.object({ url: z.string().url(), name: z.string(), mime: z.string() }) }).parse(await (await workspaceRequest('/api/mobile/training-files?fileId=' + encodeURIComponent(fileId))).json()).data;
// Photos and videos landlords sent with the enquiry form, opened by a short link.
// An owner's photo or video on the property they just added in the app (migration 20261022300000): the same checks and
// storage as the public form. The server reads the file's bytes for its type.
export async function uploadEnquiryFile(propertyId: string, file: { uri: string; name: string; mime: string; file?: File }) {
  const form = new FormData();
  if (Platform.OS === 'web') form.append('file', file.file ?? new File([await (await fetch(file.uri)).blob()], file.name, { type: file.mime }));
  else form.append('file', { uri: file.uri, name: file.name, type: file.mime } as unknown as Blob);
  return (await workspaceRequest('/api/mobile/enquiry-files?' + new URLSearchParams({ propertyId }), form)).json();
}
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
