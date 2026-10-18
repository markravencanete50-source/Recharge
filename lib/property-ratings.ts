import { z } from 'zod';
import { formatCount } from './format';
import { matchesSearch, normalise } from './search-options';

// Property ratings (Lee: "Can we get the ratings for each property?"). The database works the figures out
// (workspace_property_ratings, migration 20261022500000) from Hostaway's guest reviews and the reviews the team logs by
// hand; this file reads the answer and says it in plain words. Stars are always out of 5: Booking.com's scores out of 10
// are halved, and the original rating is kept alongside.

export const RATINGS_SECTION = 'propertyRatings';
export const RATINGS_INTRO = 'Guest review ratings for each property, from Hostaway and the reviews the team logs. Stars are out of 5; scores out of 10 are halved.';
export const RATING_CHANNEL_LABEL: Record<string, string> = { airbnb: 'Airbnb', booking_com: 'Booking.com', vrbo: 'Vrbo', direct: 'Direct', other: 'Other channel' };
export const ratingChannelName = (channel: string) => RATING_CHANNEL_LABEL[channel] ?? 'Other channel';

const count = z.number().int().nonnegative();
const average = z.number().nullable();
const day = z.string().nullable();
export const propertyRatingSchema = z.object({
  propertyId: z.string().uuid(), propertyName: z.string(), linked: z.boolean(),
  reviews: count, average, recentReviews: count, recentAverage: average, hostawayReviews: count, teamReviews: count, latestOn: day,
});
export const ratingReviewSchema = z.object({
  source: z.enum(['hostaway', 'team']), channel: z.string(), stars: z.number(), rating: z.number(), scale: z.number().int(),
  reviewedOn: day, text: z.string(), url: z.string().nullable(),
});
export const propertyRatingsSchema = z.object({
  sync: z.object({ lastRunAt: z.string().nullable(), lastSuccessAt: z.string().nullable(), complete: z.boolean(), lastError: z.string().nullable(), unlinked: count }),
  properties: z.array(propertyRatingSchema),
  property: z.object({
    channels: z.array(z.object({ channel: z.string(), reviews: count, average })),
    latest: z.array(ratingReviewSchema),
  }).nullable(),
  // Every review as [day, stars rounded 1 to 5, reviews, sum of stars] per property, for the analytics (20261023300000).
  // Only on the portfolio read (null on a property's); optional so an older server's answer still reads.
  points: z.record(z.string(), z.array(z.tuple([z.string(), z.number().int().min(1).max(5), count, z.number()]))).nullish(),
});
export type PropertyRating = z.infer<typeof propertyRatingSchema>;
export type RatingReview = z.infer<typeof ratingReviewSchema>;
export type PropertyRatings = z.infer<typeof propertyRatingsSchema>;

// 4.8, never 4.80; null when there is nothing to average.
export const starsValue = (n: number | null) => n === null ? null : (Math.round(n * 10) / 10).toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
// "4.8 stars from 132 reviews", "5.0 stars from 1 review", or "No reviews yet".
export function starsLine(average: number | null, reviews: number): string {
  const stars = starsValue(average);
  if (!reviews || stars === null) return 'No reviews yet';
  return `${stars} stars from ${formatCount(reviews)} ${reviews === 1 ? 'review' : 'reviews'}`;
}
// "4.6 in the last 90 days (12 reviews)", or what is missing.
export function recentLine(r: Pick<PropertyRating, 'recentAverage' | 'recentReviews'>): string {
  const stars = starsValue(r.recentAverage);
  if (!r.recentReviews || stars === null) return 'No reviews in the last 90 days';
  return `${stars} in the last 90 days (${formatCount(r.recentReviews)} ${r.recentReviews === 1 ? 'review' : 'reviews'})`;
}
// Where the figures come from: "128 from Hostaway, 4 logged by the team".
export function sourceLine(r: Pick<PropertyRating, 'hostawayReviews' | 'teamReviews'>): string {
  return [r.hostawayReviews ? `${formatCount(r.hostawayReviews)} from Hostaway` : '', r.teamReviews ? `${formatCount(r.teamReviews)} logged by the team` : ''].filter(Boolean).join(', ');
}
// One review's rating as the guest gave it: "5 stars", "9 out of 10 (4.5 stars)".
export function reviewRatingLine(r: Pick<RatingReview, 'rating' | 'scale' | 'stars'>): string {
  const given = Number.isInteger(r.rating) ? String(r.rating) : r.rating.toLocaleString('en-GB', { maximumFractionDigits: 2 });
  return r.scale === 5 ? `${given} ${r.rating === 1 ? 'star' : 'stars'}` : `${given} out of ${r.scale} (${starsValue(r.stars)} stars)`;
}
export function reviewByLine(r: Pick<RatingReview, 'source' | 'channel' | 'reviewedOn'>): string {
  const when = r.reviewedOn ? new Date(r.reviewedOn + 'T12:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';
  return [ratingChannelName(r.channel), when, r.source === 'team' ? 'Logged by the team' : ''].filter(Boolean).join(' · ');
}

// The empty states, in plain words. Hostaway has never sent reviews / it has, but none for this property / none at all.
export function emptyRatingsLine(data: Pick<PropertyRatings, 'sync'>, property?: Pick<PropertyRating, 'linked'>): string {
  if (!data.sync.lastSuccessAt) return 'No reviews yet. Hostaway has not sent any reviews; they appear here after the next Hostaway sync.';
  if (property && !property.linked) return 'No reviews yet. This property is not linked to a Hostaway listing, so only reviews the team logs are counted.';
  return 'No reviews yet for this property.';
}
// "Reviews last synced from Hostaway on 22 October 2026 at 09:15", the last error when it failed, or that it never ran.
export function syncLine(sync: PropertyRatings['sync']): string {
  const at = (value: string) => `${new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/London' })} at ${new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' })}`;
  const parts = [sync.lastSuccessAt ? `Reviews last synced from Hostaway on ${at(sync.lastSuccessAt)}.` : 'Reviews have not synced from Hostaway yet. They sync every hour once the Hostaway sync is on.'];
  if (sync.lastError && sync.lastRunAt && (!sync.lastSuccessAt || sync.lastRunAt > sync.lastSuccessAt)) parts.push(`The last try failed: ${sync.lastError}`);
  if (sync.lastSuccessAt && !sync.complete) parts.push('The first full read of Hostaway\'s reviews is still under way (a few hours), so older reviews may be missing.');
  if (sync.unlinked) parts.push(`${formatCount(sync.unlinked)} rated ${sync.unlinked === 1 ? 'review is' : 'reviews are'} for Hostaway listings not linked to a property yet.`);
  return parts.join(' ');
}

// The report's order. Lowest first by default, so problems come to the top; properties with no reviews go last either way.
export const RATING_SORTS = ['lowest', 'highest', 'most', 'name'] as const;
export type RatingSort = (typeof RATING_SORTS)[number];
export const RATING_SORT_LABEL: Record<RatingSort, string> = { lowest: 'Lowest first', highest: 'Highest first', most: 'Most reviews', name: 'Name' };
export function sortRatings(rows: readonly PropertyRating[], sort: RatingSort, query = ''): PropertyRating[] {
  const shown = query.trim() ? rows.filter(r => matchesSearch(normalise(r.propertyName), query)) : [...rows];
  const byName = (a: PropertyRating, b: PropertyRating) => a.propertyName.localeCompare(b.propertyName, 'en-GB');
  return shown.sort((a, b) => {
    if (sort === 'name') return byName(a, b);
    if (sort === 'most') return b.reviews - a.reviews || byName(a, b);
    if ((a.average === null) !== (b.average === null)) return a.average === null ? 1 : -1;
    if (a.average !== null && b.average !== null && a.average !== b.average) return sort === 'lowest' ? a.average - b.average : b.average - a.average;
    return byName(a, b);
  });
}

// Who is offered ratings on a property's page: the team. Owners (client) are not shown ratings for now (Lee decides
// later); the database refuses them in its one marked check (private.workspace_property_ratings), and this mirrors it.
// Beyond that the database decides: Guest relations and admins see every property, the rest of the team the ones they
// are assigned to, which are the only properties they can open anyway.
export const canSeeRatings = (account: { role: string }) => account.role !== 'client';
