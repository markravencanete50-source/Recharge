// Hostaway API client: properties, reservations, calendar rates and reviews.
// Credentials come from Worker secrets; nothing here touches a local database.
import { env } from "cloudflare:workers";
import type {
  HostawayProperty,
  HostawayReview,
  HostawayCalendarRate,
  HostawayReservation,
} from "@/lib/hostaway-types";

const HOSTAWAY_API = "https://api.hostaway.com/v1";
const TOKEN_EARLY_REFRESH_MS = 60_000;

type JsonObject = Record<string, unknown>;

let cachedToken: { value: string; expiresAt: number } | null = null;
let pendingToken: Promise<string> | null = null;

class HostawayApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "HostawayApiError";
  }
}

export function isHostawayConfigured() {
  return Boolean(env.HOSTAWAY_ACCOUNT_ID && env.HOSTAWAY_API_KEY);
}

export function hostawayErrorMessage(error: unknown) {
  if (error instanceof HostawayApiError) {
    if (error.status === 401 || error.status === 403) {
      return "Hostaway rejected the saved credentials. Replace them with a fresh Hostaway Public API key.";
    }
    if (error.status === 429) {
      return "Hostaway is temporarily limiting requests. Recharge will try again automatically.";
    }
  }
  return "Hostaway could not be reached. Recharge will keep the existing inbox and retry automatically.";
}

export function hostawayPropertyErrorMessage(error: unknown) {
  if (error instanceof HostawayApiError) {
    if (error.status === 401 || error.status === 403) {
      return "Hostaway rejected the saved credentials. Replace them with a fresh Hostaway Public API key.";
    }
    if (error.status === 429) {
      return "Hostaway is temporarily limiting requests. Try loading the properties again shortly.";
    }
  }
  return "Hostaway properties could not be loaded. Try again or enter the property manually.";
}

export function hostawayReservationErrorMessage(error: unknown) {
  if (error instanceof HostawayApiError) {
    if (error.status === 401 || error.status === 403) {
      return "Hostaway rejected the saved credentials. Replace them with a fresh Hostaway Public API key.";
    }
    if (error.status === 429) {
      return "Hostaway is temporarily limiting requests. Try loading the reservations again shortly.";
    }
  }
  return "Hostaway reservations could not be loaded. The ticket can still be raised without a reservation.";
}

export async function listHostawayProperties(): Promise<HostawayProperty[]> {
  if (!isHostawayConfigured()) {
    throw new HostawayApiError("Hostaway credentials are missing", 401);
  }

  const pageSize = 100;
  const properties = new Map<string, HostawayProperty>();

  for (let offset = 0; offset < 1000; offset += pageSize) {
    const listings = await hostawayRequest<unknown[]>(
      `/listings?limit=${pageSize}&offset=${offset}&includeResources=1`,
    );
    if (!Array.isArray(listings)) {
      throw new HostawayApiError("Hostaway returned an invalid property list", 502);
    }

    for (const value of listings) {
      const listing = asObject(value);
      const location = asObject(listing.location);
      const owner = asObject(listing.owner ?? listing.ownerUser);
      const id = firstString(listing.id, listing.listingMapId);
      if (!id) continue;

      const name =
        firstString(
          listing.internalListingName,
          listing.name,
          listing.listingName,
          listing.title,
        ) || `Hostaway property ${id}`;
      const address = joinAddressParts([
        firstString(
          listing.address,
          listing.street,
          listing.streetAddress,
          location.address,
          location.street,
        ),
        firstString(listing.address2, location.address2),
        firstString(listing.city, location.city),
        firstString(
          listing.zipcode,
          listing.zipCode,
          listing.postcode,
          location.zipcode,
          location.postcode,
        ),
      ]);

      const listingLinks = uniqueLinks([
        { label: "Airbnb", url: firstUrl(listing.airbnbListingUrl, listing.airbnbUrl) },
        { label: "Booking.com", url: firstUrl(listing.bookingComListingUrl, listing.bookingUrl) },
        { label: "Vrbo", url: firstUrl(listing.vrboListingUrl, listing.vrboUrl) },
        { label: "Direct", url: firstUrl(listing.directBookingUrl, listing.bookingEngineUrl) },
        { label: "Listing", url: firstUrl(listing.listingUrl, listing.publicUrl) },
      ]);

      properties.set(id, {
        id,
        name,
        address,
        ownerName: firstString(
          owner.name,
          owner.fullName,
          listing.ownerName,
          listing.ownerFullName,
        ),
        ownerEmail: firstString(owner.email, listing.ownerEmail),
        ownerPhone: firstString(owner.phone, owner.phoneNumber, listing.ownerPhone),
        accessCode: firstString(
          listing.doorSecurityCode,
          listing.accessCode,
          listing.keyCode,
        ),
        accessInfo: firstString(
          listing.checkInInstructions,
          listing.checkinInstructions,
          listing.keyPickup,
          listing.accessInstructions,
        ),
        guidebookUrl: firstUrl(
          listing.guidebookUrl,
          listing.guidebookLink,
          listing.guestGuideUrl,
        ),
        listingLinks,
        status: firstString(
          listing.status,
          listing.listingStatus,
          listing.airbnbStatus,
          listing.isActive === false ? "inactive" : "active",
        ),
      });
    }

    if (listings.length < pageSize) break;
  }

  return Array.from(properties.values()).sort((a, b) =>
    a.name.localeCompare(b.name, "en-GB", { sensitivity: "base" }),
  );
}

export async function listHostawayReservations(
  listingId: string,
): Promise<HostawayReservation[]> {
  if (!isHostawayConfigured()) {
    throw new HostawayApiError("Hostaway credentials are missing", 401);
  }

  const safeListingId = listingId.trim();
  if (!safeListingId) return [];
  const pageSize = 100;
  const reservations: HostawayReservation[] = [];

  for (let offset = 0; offset < 500; offset += pageSize) {
    const result = await hostawayRequest<unknown[]>(
      `/reservations?limit=${pageSize}&offset=${offset}&listingId=${encodeURIComponent(safeListingId)}&includeResources=1`,
    );
    if (!Array.isArray(result)) {
      throw new HostawayApiError("Hostaway returned an invalid reservation list", 502);
    }

    for (const value of result) {
      const reservation = asObject(value);
      const id = firstString(
        reservation.id,
        reservation.hostawayReservationId,
      );
      if (!id) continue;
      const reservationListingId = firstString(
        reservation.listingMapId,
        reservation.listingId,
      );
      if (reservationListingId && reservationListingId !== safeListingId) continue;
      const guestFirstName = firstString(reservation.guestFirstName);
      const guestLastName = firstString(reservation.guestLastName);
      const adultCount = numberValue(reservation.adults ?? reservation.numberOfAdults);
      const childCount = numberValue(reservation.children ?? reservation.numberOfChildren);
      const infantCount = numberValue(reservation.infants ?? reservation.numberOfInfants);
      reservations.push({
        id,
        listingId: reservationListingId || safeListingId,
        propertyName: firstString(
          reservation.listingName,
          reservation.internalListingName,
        ),
        guestName:
          firstString(reservation.guestName) ||
          [guestFirstName, guestLastName].filter(Boolean).join(" "),
        guestEmail: firstString(reservation.guestEmail, reservation.email),
        guestPhone: firstString(reservation.guestPhone, reservation.phone, reservation.phoneNumber),
        guestCount:
          numberValue(
            reservation.numberOfGuests ??
              reservation.guestCount ??
              reservation.totalGuests,
          ) || adultCount + childCount + infantCount,
        bookingReference: firstString(
          reservation.confirmationCode,
          reservation.channelReservationId,
          reservation.reservationCode,
          id,
        ),
        arrivalDate: firstString(
          reservation.arrivalDate,
          reservation.checkInDate,
          reservation.startDate,
        ),
        departureDate: firstString(
          reservation.departureDate,
          reservation.checkOutDate,
          reservation.endDate,
        ),
        channelName: firstString(
          reservation.channelName,
          reservation.source,
          reservation.channel,
        ),
        status: firstString(reservation.status, reservation.reservationStatus),
        grossRevenuePence: moneyPence(
          reservation.totalPrice ?? reservation.totalReservationPrice ?? reservation.totalPaid ?? reservation.price,
        ),
        cleaningFeePence: moneyPence(
          reservation.cleaningFee ?? reservation.cleaningFeeValue ?? asObject(reservation.fees).cleaningFee,
        ),
      });
    }
    if (result.length < pageSize) break;
  }

  return reservations.sort((a, b) =>
    `${b.arrivalDate}${b.departureDate}`.localeCompare(
      `${a.arrivalDate}${a.departureDate}`,
    ),
  );
}

export async function listHostawayCalendarRates(listingId: string, startDate: string, endDate: string): Promise<HostawayCalendarRate[]> {
  if (!isHostawayConfigured()) throw new HostawayApiError("Hostaway credentials are missing", 401);
  const result = await hostawayRequest<unknown[]>(`/listings/${encodeURIComponent(listingId)}/calendar?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`);
  if (!Array.isArray(result)) return [];
  return result.map((value) => {
    const day = asObject(value);
    return {
      date: firstString(day.date, day.calendarDate).slice(0, 10),
      pricePence: moneyPence(day.price ?? day.basePrice ?? day.rate),
      available: day.isAvailable !== false && !/blocked|booked|unavailable/i.test(firstString(day.status)),
    };
  }).filter((day) => Boolean(day.date));
}

export async function listHostawayReviews(): Promise<HostawayReview[]> {
  if (!isHostawayConfigured()) throw new HostawayApiError("Hostaway credentials are missing", 401);
  const reviews: HostawayReview[] = [];
  const pageSize = 100;
  for (let offset = 0; offset < 500; offset += pageSize) {
    const result = await hostawayRequest<unknown[]>(`/reviews?limit=${pageSize}&offset=${offset}&includeResources=1`);
    if (!Array.isArray(result)) throw new HostawayApiError("Hostaway returned an invalid review list", 502);
    for (const value of result) {
      const review = asObject(value);
      const id = firstString(review.id, review.reviewId, review.externalId);
      if (!id) continue;
      reviews.push({
        id,
        listingId: firstString(review.listingMapId, review.listingId),
        propertyName: firstString(review.listingName, review.internalListingName),
        channelName: firstString(review.channelName, review.channel, review.source, "Hostaway"),
        rating: numberValue(review.rating ?? review.overallRating ?? review.score),
        text: firstString(review.publicReview, review.review, review.comment, review.text),
        createdAt: firstString(review.createdOn, review.createdAt, review.submittedAt),
        reviewUrl: firstString(review.reviewUrl, review.publicReviewUrl, review.channelReviewUrl, review.url),
      });
    }
    if (result.length < pageSize) break;
  }
  return reviews;
}

function moneyPence(value: unknown) {
  const amount = numberValue(value);
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount * 100)) : 0;
}

async function hostawayRequest<T>(
  path: string,
  init: RequestInit = {},
  retry = true,
): Promise<T> {
  const token = await accessToken();
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  headers.set("cache-control", "no-cache");
  const response = await fetch(`${HOSTAWAY_API}${path}`, {
    ...init,
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
  });

  if (response.status === 403 && retry) {
    cachedToken = null;
    return hostawayRequest<T>(path, init, false);
  }

  const payload = await response.json().catch(() => null);
  const object = asObject(payload);
  if (!response.ok || object.status === "fail") {
    const detail = firstString(object.message, object.result, response.statusText);
    throw new HostawayApiError(detail || "Hostaway request failed", response.status);
  }
  return object.result as T;
}

async function accessToken() {
  if (
    cachedToken &&
    cachedToken.expiresAt - TOKEN_EARLY_REFRESH_MS > Date.now()
  ) {
    return cachedToken.value;
  }
  if (pendingToken) return pendingToken;

  pendingToken = issueAccessToken();
  try {
    return await pendingToken;
  } finally {
    pendingToken = null;
  }
}

async function issueAccessToken() {
  const accountId = String(env.HOSTAWAY_ACCOUNT_ID || "");
  const apiKey = String(env.HOSTAWAY_API_KEY || "");
  if (!accountId || !apiKey) {
    throw new HostawayApiError("Hostaway credentials are missing", 401);
  }

  const response = await fetch(`${HOSTAWAY_API}/accessTokens`, {
    method: "POST",
    redirect: 'error',
    signal: AbortSignal.timeout(10_000),
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "cache-control": "no-cache",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: accountId,
      client_secret: apiKey,
      scope: "general",
    }),
  });
  const payload = asObject(await response.json().catch(() => null));
  const value = scalarString(payload.access_token);
  const expiresIn = numberValue(payload.expires_in) || 3600;
  if (!response.ok || !value) {
    throw new HostawayApiError(
      firstString(payload.message, payload.error) || "Hostaway token request failed",
      response.status,
    );
  }

  cachedToken = {
    value,
    expiresAt: Date.now() + expiresIn * 1000,
  };
  await new Promise((resolve) => setTimeout(resolve, 1100));
  return value;
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function arrayValue(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function scalarString(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function firstString(...values: unknown[]) {
  for (const value of values) {
    const text = scalarString(value);
    if (text) return text;
  }
  return "";
}

function firstUrl(...values: unknown[]) {
  for (const value of values) {
    const url = scalarString(value);
    if (/^https?:\/\//i.test(url)) return url;
  }
  return "";
}

function uniqueLinks(links: Array<{ label: string; url: string }>) {
  const seen = new Set<string>();
  return links.filter((link) => {
    if (!link.url || seen.has(link.url)) return false;
    seen.add(link.url);
    return true;
  });
}

function joinAddressParts(values: string[]) {
  const parts: string[] = [];
  for (const value of values) {
    const part = value.trim();
    if (!part) continue;
    const current = parts.join(", ").toLowerCase();
    if (!current.includes(part.toLowerCase())) parts.push(part);
  }
  return parts.join(", ");
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function booleanLike(value: unknown) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function parseTimestamp(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? Math.floor(value / 1000) : Math.floor(value);
  }
  const text = scalarString(value);
  if (!text) return 0;
  const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(text);
  const normalized = hasZone ? text : `${text.replace(" ", "T")}Z`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : 0;
}

function titleCase(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
