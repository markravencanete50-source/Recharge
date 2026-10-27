import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { authSecurityConfiguration, requestQuota, securityRpc } from './auth-security';
import { isSameOrigin } from './auth-security-policy';
import { businessContext, businessResponse, databaseFailure, viewAsFailure } from './business-server';
import { isNativeRequest } from './native-request-policy';
import { boundedFormData } from './bounded-form';
import { trainingFileType } from './training-files';
import { LEAD_FILES_BUCKET } from './enquiry-storage-cleanup';
import { rpcRoute, type RpcContext } from './workspace-rpc-route';
import { createHostawayListing, hostawayListingErrorMessage, isHostawayConfigured, updateHostawayListing } from './hostaway';
import { hostawayListingBody, LISTING_LIMITS, LISTING_PHOTO_MIMES, listingActionSchema, listingFieldsSchema, listingReadSchema, type ListingAction } from './hostaway-listing';

// Listings in Hostaway, made from onboarding (migration 20261028200000). The database decides who may do what and keeps the
// draft; this server stores the photos (private "lead-files" bucket, under listings/) and, when an admin approves, calls
// Hostaway and writes the outcome back through the service-role-only workspace_listing_publish_result.
const bucket = () => {
  const config = authSecurityConfiguration();
  if (!config) return null;
  return createClient(config.url, config.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }).storage.from(LEAD_FILES_BUCKET);
};
// Hostaway fetches the photos from these links; a week leaves room for it to retry.
const PHOTO_LINK_SECONDS = 7 * 24 * 3600;

const startedSchema = z.union([
  z.object({ send: z.literal(true), requestId: z.string().uuid(), propertyId: z.string().uuid(), hostawayListingId: z.string().nullable(), fields: listingFieldsSchema,
    photos: z.array(z.object({ id: z.string().uuid(), path: z.string(), caption: z.string() })) }),
  z.object({ send: z.literal(false), listing: z.unknown() }),
]);

async function readListing({ client }: RpcContext, propertyId: string) {
  const fresh = await client.rpc('workspace_listing_read', { target: propertyId });
  return fresh.error ? null : fresh.data;
}

async function publishListing(context: RpcContext, input: Extract<ListingAction, { action: 'publish' }>) {
  if (!isHostawayConfigured()) return businessResponse({ error: 'Hostaway is not connected yet. Add the Hostaway Account ID and API key first.' }, 503);
  const started = await context.client.rpc('workspace_listing_action', { input });
  if (started.error) return databaseFailure(started.error);
  const state = startedSchema.safeParse(started.data);
  if (!state.success) return businessResponse({ error: 'The listing is temporarily unavailable' }, 503);
  // Already sent for this press: nothing is posted again.
  if (!state.data.send) return businessResponse({ ok: true, data: await readListing(context, input.propertyId) });
  const job = state.data;
  let listingId = job.hostawayListingId, failure = '';
  const sentPhotos: string[] = [];
  try {
    let photos: { url: string; caption: string }[] | null = null;
    if (!listingId) {
      const storage = bucket();
      if (!storage) throw new Error('storage');
      photos = [];
      for (const photo of job.photos) {
        const signed = await storage.createSignedUrl(photo.path, PHOTO_LINK_SECONDS);
        if (signed.error || !signed.data?.signedUrl) continue;
        photos.push({ url: signed.data.signedUrl, caption: photo.caption });
        sentPhotos.push(photo.id);
      }
      if (!photos.length) throw new Error('photos');
    }
    const body = hostawayListingBody(job.fields, photos);
    if (listingId) await updateHostawayListing(listingId, body);
    else listingId = await createHostawayListing(body);
  } catch (error) {
    failure = error instanceof Error && error.message === 'storage' ? 'The photos could not be read just now. Try again in a few minutes.'
      : error instanceof Error && error.message === 'photos' ? 'The photos could not be read just now. Try again in a few minutes.'
      : hostawayListingErrorMessage(error);
  }
  let recorded = true;
  try {
    await securityRpc('workspace_listing_publish_result', { input: { requestId: job.requestId, propertyId: job.propertyId, ok: !failure,
      ...(listingId ? { hostawayListingId: listingId } : {}), ...(failure ? { error: failure } : {}), photoIds: sentPhotos } });
  } catch { recorded = false; }
  if (failure) return businessResponse({ error: failure, data: await readListing(context, input.propertyId) }, 502);
  if (!recorded) return businessResponse({ ok: true, data: null, note: `Sent to Hostaway (listing ${listingId}), but Recharge could not note it. Link the listing to the property in the Property database.` });
  return businessResponse({ ok: true, data: await readListing(context, input.propertyId) });
}

async function removePhoto(context: RpcContext, input: Extract<ListingAction, { action: 'removePhoto' }>) {
  const removed = await context.client.rpc('workspace_listing_action', { input });
  if (removed.error) return databaseFailure(removed.error);
  const { removedPath, ...view } = (removed.data ?? {}) as Record<string, unknown>;
  if (typeof removedPath === 'string') await bucket()?.remove([removedPath]).catch(() => undefined);
  return businessResponse({ ok: true, data: view });
}

export const workspaceListing = rpcRoute({
  readSchema: listingReadSchema, actionSchema: listingActionSchema, bodyLimit: 80_000, unavailable: 'The listing is temporarily unavailable',
  read: (client, input) => client.rpc('workspace_listing_read', { target: input.propertyId ?? null }),
  handle: (context, input) => input.action === 'publish' ? publishListing(context, input) : input.action === 'removePhoto' ? removePhoto(context, input) : null,
  action: 'workspace_listing_action',
});

// The listing's photos: GET opens one (a 10-minute link), POST adds one (multipart: propertyId, file).
const id = z.string().uuid();
export async function listingPhotosRoute(request: Request, native = false) {
  if (request.method === 'POST' && (native ? !isNativeRequest(request) : !isSameOrigin(request, authSecurityConfiguration()?.origin))) return businessResponse({ error: 'Invalid request origin' }, 403);
  try {
    const session = await businessContext(request, native);
    if (!session) return businessResponse({ error: 'Sign in required' }, 401);
    if (session.account.status !== 'active') return businessResponse({ error: 'Active workspace access required' }, 403);
    const storage = bucket();
    if (!storage) return businessResponse({ error: 'Listing photos are awaiting configuration' }, 503);
    if (request.method === 'GET') {
      const parsed = z.object({ propertyId: id, photoId: id }).strict().safeParse(Object.fromEntries(new URL(request.url).searchParams));
      if (!parsed.success) return businessResponse({ error: 'Choose a photo' }, 400);
      const photo = await session.client.rpc('workspace_listing_photo', { prop: parsed.data.propertyId, photo: parsed.data.photoId });
      if (photo.error) return databaseFailure(photo.error);
      const signed = await storage.createSignedUrl(String(photo.data.path), 600);
      if (signed.error || !signed.data?.signedUrl) return businessResponse({ error: 'The photo could not be opened just now' }, 503);
      return businessResponse({ data: { url: signed.data.signedUrl, name: photo.data.name, mime: photo.data.mime } });
    }
    if (request.method !== 'POST') return businessResponse({ error: 'Method not allowed' }, 405);
    if (!['admin', 'super_admin', 'stays'].includes(session.account.role)) return businessResponse({ error: 'Client enquiries access required' }, 403);
    const quota = await requestQuota(request, 'listing-photos-user', 120, 600, session.account.userId);
    if (!quota.allowed) { const r = businessResponse({ error: 'Too many uploads. Please wait.' }, 429); r.headers.set('Retry-After', String(quota.retryAfter || 60)); return r; }
    const form = await boundedFormData(request, LISTING_LIMITS.photoBytes + 65536);
    if (form === 'too-large') return businessResponse({ error: 'Photos can be up to 15 MB each' }, 413);
    if (!form) return businessResponse({ error: 'Choose a photo to upload' }, 400);
    if ([...form.keys()].some(k => !['propertyId', 'file'].includes(k)) || [...form.keys()].some(k => form.getAll(k).length !== 1)) return businessResponse({ error: 'Unexpected upload fields' }, 400);
    const propertyId = id.safeParse(form.get('propertyId')); const file = form.get('file');
    if (!propertyId.success || !(file instanceof Blob)) return businessResponse({ error: 'Choose a property and a photo' }, 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const name = (file instanceof File ? file.name : 'Photo').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200) || 'Photo';
    const type = trainingFileType(bytes, name);
    if (!type || !(LISTING_PHOTO_MIMES as readonly string[]).includes(type.mime) || bytes.length > LISTING_LIMITS.photoBytes) return businessResponse({ error: 'Upload a JPG, PNG or WebP photo up to 15 MB' }, 400);
    const ext = type.mime === 'image/jpeg' ? 'jpg' : type.mime === 'image/png' ? 'png' : 'webp';
    const photoId = crypto.randomUUID(), path = `listings/${propertyId.data}/${photoId}.${ext}`;
    const stored = await storage.upload(path, bytes, { contentType: type.mime, upsert: false, cacheControl: 'private, max-age=0' });
    if (stored.error) return businessResponse({ error: 'The photo could not be stored. Please try again.' }, 503);
    const saved = await session.client.rpc('workspace_listing_action', { input: { action: 'addPhoto', requestId: crypto.randomUUID(), propertyId: propertyId.data, photoId, name, mime: type.mime, bytes: bytes.length, path } });
    if (saved.error) { await storage.remove([path]).catch(() => undefined); return databaseFailure(saved.error); }
    return businessResponse({ ok: true, data: saved.data });
  } catch (error) { return viewAsFailure(error) ?? businessResponse({ error: 'Listing photos are temporarily unavailable' }, 503); }
}
