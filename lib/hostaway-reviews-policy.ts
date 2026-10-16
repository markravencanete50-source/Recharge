import { syncChannel, type SyncChannel } from './hostaway-sync-policy';

// How Hostaway's guest reviews map onto Recharge for the ratings sync (lib/hostaway-sync.ts runHostawayReviews) and the
// database function workspace_hostaway_reviews_ingest (migration 20261022500000). Pure, so it is unit-tested against
// sample payloads with no network.
//
// The rating scale. Hostaway's API reference gives a review's `rating` from 1 to 10, and Booking.com scores are out of 10.
// Airbnb (and Vrbo) rate in stars out of 5, and Hostaway has been seen to pass those as they are (a 5 for five stars)
// rather than doubled. So, in this order:
//  1. a scale Hostaway states on the review (ratingScale, maxRating, outOf), when it is 5 or 10;
//  2. out of 10 when the rating, or any category rating, is above 5;
//  3. out of 5 for Airbnb and Vrbo reviews (their own scale);
//  4. otherwise out of 10, as Hostaway documents.
// The rating and the scale are both kept as Hostaway gave them, and stars (out of 5) are worked out in the database, so a
// wrong guess can be corrected later without asking Hostaway again.

type Raw = Record<string, unknown>;
const text = (value: unknown) => typeof value === 'string' ? value.trim() : typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
const first = (...values: unknown[]) => values.map(text).find(Boolean) ?? '';
const number = (value: unknown) => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
};
const object = (value: unknown): Raw => value && typeof value === 'object' && !Array.isArray(value) ? value as Raw : {};

export type ReviewScale = 5 | 10;
export type SyncReview = {
  id: string; listingId: string | null; channel: SyncChannel; channelName: string | null;
  // As Hostaway gave it, with its scale; both null when the review has no rating yet (an Airbnb review still hidden, say).
  rating: number | null; scale: ReviewScale | null;
  text: string | null; reviewedAt: string | null; url: string | null; status: string | null;
};

// The most pages of 100 one run asks Hostaway for, and how many reviews go to the database in one call. Ten pages (1,000
// reviews) keeps a run to about ten sequential Hostaway requests, so it finishes well inside a minute tick; a list longer
// than that is marked incomplete on the Ratings report rather than slowing every run.
export const REVIEW_PAGES = 10;
export const REVIEW_BATCH = 250;
export const REVIEW_TEXT_MAX = 4000;

// Hostaway's channel ids, for a review that gives no channel name: 2018 Airbnb, 2005 Booking.com, 2000 direct.
const CHANNEL_IDS: Record<number, SyncChannel> = { 2018: 'airbnb', 2005: 'booking_com', 2000: 'direct', 2013: 'direct' };
export function reviewChannel(r: Raw): SyncChannel {
  const name = first(r.channelName, r.channel, r.source);
  if (name) return syncChannel(name);
  const id = number(r.channelId);
  return id !== null && CHANNEL_IDS[id] ? CHANNEL_IDS[id] : 'other';
}

function categoryRatings(r: Raw): number[] {
  const list = Array.isArray(r.reviewCategory) ? r.reviewCategory : Array.isArray(r.reviewCategories) ? r.reviewCategories : [];
  return list.map(c => number(object(c).rating)).filter((n): n is number => n !== null && n > 0);
}

export function reviewScale(r: Raw, rating: number, channel: SyncChannel): ReviewScale {
  const stated = number(r.ratingScale ?? r.maxRating ?? r.outOf);
  if (stated === 5 || stated === 10) return stated;
  if (rating > 5 || categoryRatings(r).some(n => n > 5)) return 10;
  if (channel === 'airbnb' || channel === 'vrbo') return 5;
  return 10;
}

// Stars out of 5, to one decimal place, for the screens and the tests (the database works out its own, to two places).
export const toStars = (rating: number, scale: ReviewScale) => Math.round((rating * 5 / scale) * 10) / 10;

// Hostaway's times come as "2026-10-01 14:05:00" (UTC) or ISO; a day alone is midday UTC so it stays on that London day.
export function reviewTime(value: unknown): string | null {
  const t = text(value);
  let iso = '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) iso = t + 'T12:00:00Z';
  else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(t)) iso = t.replace(' ', 'T') + (t.length === 16 ? ':00Z' : 'Z');
  else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(t)) iso = t;
  if (!iso) return null;
  const at = new Date(iso);
  if (Number.isNaN(at.getTime()) || at.getUTCFullYear() < 2000 || at.getTime() > Date.now() + 86_400_000) return null;
  return at.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const httpsUrl = (value: unknown) => {
  const t = text(value);
  if (!/^https:\/\//i.test(t) || t.length > 1000) return null;
  try { const u = new URL(t); return u.protocol === 'https:' && !u.username && !u.password ? t : null; } catch { return null; }
};

// One review as the database takes it, or null for anything that is not a guest's review of a stay (Hostaway also lists
// the host's reviews of guests) or has no id.
export function syncReview(raw: unknown): SyncReview | null {
  const r = object(raw);
  const id = first(r.id, r.reviewId);
  if (!id || id.length > 100) return null;
  const type = text(r.type).toLowerCase().replace(/[^a-z]/g, '');
  if (type === 'hosttoguest') return null;
  const channel = reviewChannel(r);
  const value = number(r.rating ?? r.overallRating ?? r.score);
  const rated = value !== null && value > 0;
  const scale = rated ? reviewScale(r, value, channel) : null;
  // A rating above its scale cannot be read; it is kept without one rather than guessed.
  const rating = rated && scale !== null && value <= scale ? Math.round(value * 100) / 100 : null;
  const listing = first(r.listingMapId, r.listingId);
  const words = first(r.publicReview, r.review, r.comment, r.text).replace(/\r\n?/g, '\n').slice(0, REVIEW_TEXT_MAX);
  return {
    id, listingId: listing && listing.length <= 100 ? listing : null, channel,
    channelName: first(r.channelName, r.channel, r.source).slice(0, 60) || null,
    rating, scale: rating === null ? null : scale,
    text: words || null,
    reviewedAt: reviewTime(r.submittedAt) ?? reviewTime(r.departureDate) ?? reviewTime(r.createdOn) ?? reviewTime(r.createdAt) ?? reviewTime(r.updatedOn),
    url: httpsUrl(r.reviewUrl) ?? httpsUrl(r.publicReviewUrl) ?? httpsUrl(r.channelReviewUrl) ?? httpsUrl(r.url),
    status: text(r.status).slice(0, 40) || null,
  };
}

// Every review once (Hostaway's pages can overlap when a review arrives mid-run), in batches for the database.
export function reviewBatches(reviews: readonly SyncReview[], size = REVIEW_BATCH): SyncReview[][] {
  const seen = new Set<string>(), unique = reviews.filter(r => !seen.has(r.id) && !!seen.add(r.id));
  const batches: SyncReview[][] = [];
  for (let i = 0; i < unique.length; i += size) batches.push(unique.slice(i, i + size));
  return batches.length ? batches : [[]];
}
