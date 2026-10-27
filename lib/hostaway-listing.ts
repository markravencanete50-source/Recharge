import { z } from 'zod';

// Listings in Hostaway, made from onboarding (migration 20261028200000). Everything onboarding already knows (the
// enquiry, the estimate, the set-up form and the onboarding package) fills in a draft listing for each property. The
// stays team checks it, adds the photos and edits anything; an admin approves it, and the app creates the listing in
// Hostaway (or updates the one it made before) and links it to the property, so the Hostaway sync takes it from there.
// Connecting the listing to Airbnb, Booking.com and the other channels is still done once in Hostaway.

export const LISTING_LIMITS = { name: 200, external: 100, text: 5000, short: 200, photos: 40, photoBytes: 15 * 1024 * 1024, price: 10_000_000 } as const;
export const LISTING_PHOTO_MIMES = ['image/jpeg', 'image/png', 'image/webp'] as const;

const text = (max: number) => z.string().trim().max(max, `Up to ${max} characters`);
const hour = z.number().int().min(0, 'Choose an hour').max(23, 'Choose an hour');
const count = (min: number, max: number) => z.number().int('Whole numbers only').min(min).max(max, `Up to ${max}`);
const money = z.number().int('Whole pence').min(0).max(LISTING_LIMITS.price, 'Up to £100,000');

// The listing's details: the same keys as the database's draft (private.workspace_listing_prefill).
export const listingFieldsSchema = z.object({
  name: text(LISTING_LIMITS.name),
  externalName: text(LISTING_LIMITS.external),
  description: text(LISTING_LIMITS.text),
  address: text(1000),
  propertyType: text(120),
  bedrooms: count(0, 40), bathrooms: count(0, 40), beds: count(0, 80), guests: count(1, 40),
  nightlyMinor: money, cleaningFeeMinor: money, minNights: count(1, 365),
  checkInFrom: hour, checkInTo: hour, checkOut: hour,
  houseRules: text(LISTING_LIMITS.text),
  wifiName: text(LISTING_LIMITS.short), wifiPassword: text(LISTING_LIMITS.short),
  accessCode: text(LISTING_LIMITS.short), checkInInstructions: text(3000),
}).strict();
export type ListingFields = z.infer<typeof listingFieldsSchema>;
export const FIELD_LABEL: Record<keyof ListingFields, string> = {
  name: 'Internal name', externalName: 'Listing title guests see', description: 'Description', address: 'Address', propertyType: 'Property type',
  bedrooms: 'Bedrooms', bathrooms: 'Bathrooms', beds: 'Beds', guests: 'Sleeps (guests)', nightlyMinor: 'Base nightly price', cleaningFeeMinor: 'Cleaning fee',
  minNights: 'Minimum nights', checkInFrom: 'Check-in from', checkInTo: 'Check-in until', checkOut: 'Check-out by', houseRules: 'House rules',
  wifiName: 'Wi-Fi name', wifiPassword: 'Wi-Fi password', accessCode: 'Door or key safe code', checkInInstructions: 'Check-in instructions',
};

// The settings: the starting wording and times for every new draft (private.workspace_listing_settings_default()).
export const listingSettingsSchema = z.object({
  descriptionTemplate: text(LISTING_LIMITS.text).min(1, 'Write the description'),
  houseRules: text(LISTING_LIMITS.text),
  checkInFrom: hour, checkInTo: hour, checkOut: hour,
  minNights: count(1, 365), guestsPerBedroom: count(1, 10), cleaningFeeMinor: money,
}).strict();
export type ListingSettings = z.infer<typeof listingSettingsSchema>;
// The description's placeholders. A line whose placeholder has nothing to fill it is left out.
export const DESCRIPTION_PLACEHOLDERS = ['name', 'propertyType', 'bedrooms', 'bathrooms', 'guests', 'area', 'parking', 'garden'] as const;
export const DEFAULT_LISTING_SETTINGS: ListingSettings = {
  descriptionTemplate: '{name} is a {bedrooms}-bedroom {propertyType} in {area}, sleeping up to {guests} guests.\n\nThe space\n{bedrooms} bedrooms and {bathrooms} bathrooms.\nParking: {parking}.\nOutside: {garden}.\n\nGuest access\nSelf check-in, with your instructions sent before you arrive.\n\nManaged by Recharge, with a fresh clean, fresh linen and towels, and local support for every stay.',
  houseRules: 'No smoking.\nNo parties or events.\nNo pets unless agreed in advance.\nQuiet hours from 10pm to 8am.\nPlease respect the neighbours.',
  checkInFrom: 15, checkInTo: 22, checkOut: 10, minNights: 2, guestsPerBedroom: 2, cleaningFeeMinor: 0,
};

const id = z.string().uuid();
const photoOrder = z.array(z.object({ id, caption: text(300) }).strict()).max(LISTING_LIMITS.photos);
export const listingActionSchema = z.discriminatedUnion('action', [
  // The stays team's draft: the details and the photos in order, with captions.
  z.object({ action: z.literal('saveDraft'), requestId: id, propertyId: id, fields: listingFieldsSchema, photos: photoOrder }).strict(),
  // An admin approves: the app creates (or updates) the listing in Hostaway.
  z.object({ action: z.literal('publish'), requestId: id, propertyId: id }).strict(),
  z.object({ action: z.literal('removePhoto'), requestId: id, propertyId: id, photoId: id }).strict(),
  z.object({ action: z.literal('saveSettings'), requestId: id, settings: listingSettingsSchema }).strict(),
]);
export type ListingAction = z.infer<typeof listingActionSchema>;
export const listingReadSchema = z.object({ propertyId: id.optional() }).strict();

export const LISTING_STATUS = ['draft', 'publishing', 'published', 'changed', 'failed'] as const;
export type ListingStatus = (typeof LISTING_STATUS)[number];
export const STATUS_LABEL: Record<ListingStatus, string> = {
  draft: 'Draft', publishing: 'Sending to Hostaway', published: 'In Hostaway', changed: 'Changed since it went to Hostaway', failed: 'Not sent',
};
const photoSchema = z.object({ id, name: z.string(), caption: z.string(), sort: z.number(), sent: z.boolean().default(false) });
export type ListingPhoto = z.infer<typeof photoSchema>;
export const listingViewSchema = z.object({
  settings: listingSettingsSchema,
  canEditSettings: z.boolean().default(false),
  settingsUpdatedAt: z.string().nullable().default(null), settingsUpdatedByName: z.string().nullable().default(null),
  listing: z.object({
    propertyId: id, stage: z.string(),
    fields: listingFieldsSchema, prefill: listingFieldsSchema, saved: z.boolean(),
    status: z.enum(LISTING_STATUS), hostawayListingId: z.string().nullable(), linkedElsewhere: z.boolean().default(false),
    publishedAt: z.string().nullable(), publishedByName: z.string().nullable(), lastError: z.string().nullable(),
    updatedAt: z.string().nullable(), updatedByName: z.string().nullable(), version: z.number().default(0),
    photos: z.array(photoSchema), canEdit: z.boolean(), canPublish: z.boolean(),
  }).nullable().default(null),
});
export type ListingView = z.infer<typeof listingViewSchema>;

// What still has to be filled in before an admin can approve (the database checks the same).
export function listingMissing(f: ListingFields, photos: number): string[] {
  const missing: string[] = [];
  if (f.name.length < 2) missing.push(FIELD_LABEL.name);
  if (f.externalName.length < 5) missing.push(FIELD_LABEL.externalName);
  if (f.description.length < 50) missing.push(FIELD_LABEL.description);
  if (f.address.length < 5) missing.push(FIELD_LABEL.address);
  if (f.nightlyMinor < 100) missing.push(FIELD_LABEL.nightlyMinor);
  if (f.checkInTo < f.checkInFrom) missing.push('Check-in times');
  if (photos < 1) missing.push('Photos');
  return missing;
}

// "8 Shore Road\nLeith, Edinburgh EH6 6RG" -> the street, the town and the postcode, as Hostaway keeps them.
const POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\s*$/i;
export function splitAddress(address: string) {
  const parts = address.split(/\s*[\n,]\s*/).map(p => p.trim()).filter(Boolean);
  const last = parts.at(-1) ?? '';
  const postcode = POSTCODE.exec(last)?.[1].toUpperCase().replace(/\s+/, ' ') ?? '';
  if (postcode) {
    const rest = last.replace(POSTCODE, '').trim();
    if (rest) parts[parts.length - 1] = rest; else parts.pop();
  }
  const street = parts.length > 1 ? parts[0] : parts[0] ?? '';
  const city = parts.length > 1 ? parts.at(-1)! : '';
  return { street, city, postcode };
}

// The body Hostaway takes to create or update a listing (POST /v1/listings, PUT /v1/listings/{id}). Prices are in pounds.
// Photos go only with a new listing; later photos are added in Hostaway.
export function hostawayListingBody(f: ListingFields, photos: { url: string; caption: string }[] | null) {
  const { street, city, postcode } = splitAddress(f.address);
  const pounds = (minor: number) => Math.round(minor) / 100;
  return {
    name: f.externalName || f.name, internalListingName: f.name, externalListingName: f.externalName || f.name,
    description: f.description, address: [street, city, postcode].filter(Boolean).join(', '), street, city, zipcode: postcode,
    country: 'United Kingdom', countryCode: 'GB', currencyCode: 'GBP', roomType: 'entire_home',
    bedroomsNumber: f.bedrooms, bathroomsNumber: f.bathrooms, bedsNumber: f.beds, personCapacity: f.guests, guestsIncluded: f.guests,
    price: pounds(f.nightlyMinor), cleaningFee: pounds(f.cleaningFeeMinor), minNights: f.minNights,
    checkInTimeStart: f.checkInFrom, checkInTimeEnd: f.checkInTo, checkOutTime: f.checkOut,
    houseRules: f.houseRules, wifiUsername: f.wifiName, wifiPassword: f.wifiPassword, doorSecurityCode: f.accessCode, specialInstruction: f.checkInInstructions,
    ...(photos ? { listingImages: photos.map((p, i) => ({ url: p.url, caption: p.caption, sortOrder: i + 1 })) } : {}),
  };
}
