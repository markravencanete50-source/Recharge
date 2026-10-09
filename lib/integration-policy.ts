import { z } from 'zod';

export type IntegrationSettings = Record<string, string | undefined>;
export function integrationConfiguration(settings: IntegrationSettings) {
  const cloudinary = settings.MEDIA_UPLOADS_ENABLED === 'true' && /^[a-z0-9_-]+$/i.test(settings.CLOUDINARY_CLOUD_NAME || '') && Boolean(settings.CLOUDINARY_API_KEY && settings.CLOUDINARY_API_SECRET);
  // Photos are kept in the project's own private Supabase Storage bucket unless Cloudinary is
  // switched on. That needs only the backend's existing database connection.
  const storage = settings.MEDIA_STORAGE !== 'off' && /^https:\/\/[a-z0-9.-]+(:\d+)?$/i.test((settings.SUPABASE_URL || '').replace(/\/$/, '')) && Boolean(settings.SUPABASE_SECRET_KEY?.startsWith('sb_secret_'));
  const media = cloudinary || storage;
  const email = settings.NOTIFICATION_EMAIL_ENABLED === 'true' && Boolean(settings.RESEND_API_KEY) && z.string().email().safeParse(settings.NOTIFICATION_FROM_EMAIL).success;
  const push = settings.NOTIFICATION_PUSH_ENABLED === 'true' && Boolean(settings.EXPO_ACCESS_TOKEN);
  const reservations = settings.HOSTAWAY_IMPORT_ENABLED === 'true' && Boolean(settings.HOSTAWAY_ACCOUNT_ID && settings.HOSTAWAY_API_KEY);
  return { media, mediaProvider: cloudinary ? 'cloudinary' as const : storage ? 'storage' as const : null, email, push, reservations };
}
export const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
export function photoFormat(bytes: Uint8Array): 'jpg' | 'png' | 'webp' | null {
  if (bytes.length < 12 || bytes.length > MAX_PHOTO_BYTES) return null;
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg';
  if ([137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) return 'png';
  if (String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP') return 'webp';
  return null;
}
export const MEDIA_PURPOSES = ['cleaning','mailbox','delivery','licence','maintenance','inspection','setup','expense'] as const;
// A photo belongs to a work item, or (for Accounts' invoice paperwork) to an expense.
// A clean photo can name the check on the clean's checklist it was taken for.
export const mediaInputSchema = z.object({ requestId:z.string().uuid(),workId:z.string().uuid().optional(),expenseId:z.string().uuid().optional(),purpose:z.enum(MEDIA_PURPOSES),checklistItem:z.string().min(1).max(200).optional() }).strict()
  .refine(v => Boolean(v.workId) !== Boolean(v.expenseId) && (!v.expenseId || v.purpose === 'expense'), 'Choose a work item or an expense')
  .refine(v => !v.checklistItem || v.purpose === 'cleaning', 'Only clean photos belong to a checklist item');
export const integrationActionSchema = z.discriminatedUnion('action',[
  z.object({action:z.literal('dispatchNotifications')}).strict(),
  z.object({action:z.literal('syncHostaway')}).strict(),
  z.object({action:z.literal('importReservations'),propertyId:z.string().uuid(),offset:z.number().int().min(0).max(490).default(0)}).strict(),
]);
export class ProviderFailure extends Error {
  constructor(readonly code: 'unconfigured'|'retryable'|'rejected'|'uncertain'|'device_removed') { super(code); }
}
export type DeliveryResult = {state:'accepted'|'delivered'|'pending';providerId?:string};
export type DeliveryJob = { id:string;lease:string;channel:'email'|'push';destination:string;state:'queued'|'accepted';providerId:string|null;createdAt:string;eventType?:string|null };

export function normalizeHostawayReservation(value: {id:string;listingId:string;arrivalDate:string;departureDate:string;status:string},listingId:string) {
  const status = value.status.toLowerCase();
  const mapped = ['cancelled','canceled'].includes(status) ? 'cancelled' : ['new','modified','confirmed'].includes(status) ? 'confirmed' : ['inquiry','enquiry','pending'].includes(status) ? 'enquiry' : null;
  const date = /^\d{4}-\d{2}-\d{2}$/;
  // Unknown provider states must not accidentally block or free a property's calendar.
  if (!mapped || value.listingId !== listingId || !value.id || !date.test(value.arrivalDate) || !date.test(value.departureDate)) throw new ProviderFailure('rejected');
  return {externalId:value.id,checkIn:value.arrivalDate,checkOut:value.departureDate,status:mapped};
}
