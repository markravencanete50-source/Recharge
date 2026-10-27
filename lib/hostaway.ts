// Hostaway API client: properties, reservations, calendar rates and reviews.
// Credentials come from Worker secrets; nothing here touches a local database.
import { env } from "cloudflare:workers";
import type { HostawayReservation } from "@/lib/hostaway-types";
import { reviewsPath, sweepReviews, type ReviewSweep } from "./hostaway-reviews-policy";

const HOSTAWAY_API = "https://api.hostaway.com/v1";
const TOKEN_EARLY_REFRESH_MS = 60_000;

type JsonObject = Record<string, unknown>;

let cachedToken: { value: string; expiresAt: number } | null = null;
let pendingToken: Promise<string> | null = null;

class HostawayApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    // "sign-in" when Hostaway refused to issue an access token for the Account ID and API key.
    readonly step: "sign-in" | "request" = "request",
  ) {
    super(message);
    this.name = "HostawayApiError";
  }
}

export function isHostawayConfigured() {
  return Boolean(env.HOSTAWAY_ACCOUNT_ID && env.HOSTAWAY_API_KEY);
}

// Shown to admins on the Hostaway card, so it says what actually went wrong. Never includes
// the Account ID or API key.
function withoutCredentials(text: string) {
  let clean = text;
  for (const value of [env.HOSTAWAY_API_KEY, env.HOSTAWAY_ACCOUNT_ID]) if (value) clean = clean.split(String(value)).join("…");
  return clean.replace(/\s+/g, " ").trim().slice(0, 160);
}
export function hostawaySyncErrorMessage(error: unknown) {
  if (error instanceof HostawayApiError) {
    const detail = withoutCredentials(error.message);
    if (error.step === "sign-in") return `Hostaway did not accept the Account ID and API key (HTTP ${error.status}: ${detail}). Check both values in the backend's Hostaway settings.`;
    if (error.status === 401 || error.status === 403) return "Hostaway rejected the saved credentials. Add a fresh Hostaway API key.";
    if (error.status === 429) return "Hostaway is limiting requests. The next sync will try again.";
    return `Hostaway answered with an error (HTTP ${error.status}: ${detail}). The next sync will try again.`;
  }
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError") return "Hostaway took too long to answer. The next sync will try again.";
  if (error instanceof TypeError && /fetch|network/i.test(error.message)) return "Hostaway could not be reached. The next sync will try again.";
  const detail = withoutCredentials(error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  return `The sync stopped on an unexpected error (${detail}). The next sync will try again.`;
}

export function hostawayCancelErrorMessage(error: unknown) {
  if (error instanceof HostawayApiError) {
    if (error.step === "sign-in" || error.status === 401 || error.status === 403) return "Hostaway did not accept the saved API key. Add a fresh Hostaway API key, then try again.";
    if (error.status === 429) return "Hostaway is limiting requests. Wait a minute and try again.";
    return `Hostaway refused the cancellation (HTTP ${error.status}: ${withoutCredentials(error.message)}). Cancel it in the Hostaway dashboard instead.`;
  }
  return "Hostaway could not be reached. Nothing was cancelled; try again in a minute.";
}

// Shown to the person who pressed Send. A timeout is the one case where the message may still have gone out.
export function hostawayReplyErrorMessage(error: unknown) {
  if (error instanceof HostawayApiError) {
    if (error.step === "sign-in" || error.status === 401 || error.status === 403) return "Hostaway did not accept the saved API key. Add a fresh Hostaway API key, then try again.";
    if (error.status === 429) return "Hostaway is limiting requests. Wait a minute and try again.";
    return `Hostaway refused the message (HTTP ${error.status}: ${withoutCredentials(error.message)}). Nothing was sent; reply in Hostaway instead.`;
  }
  const name = error instanceof Error ? error.name : "";
  if (name === "TimeoutError" || name === "AbortError") return "Hostaway took too long to answer. The message may have been sent: check the conversation in a minute before sending it again.";
  return "Hostaway could not be reached. Nothing was sent; try again in a minute.";
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

// Raw records for the sync (mapped in lib/hostaway-sync-policy.ts).
export async function fetchHostawayListings(): Promise<unknown[]> {
  if (!isHostawayConfigured()) throw new HostawayApiError("Hostaway credentials are missing", 401);
  const rows: unknown[] = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const page = await hostawayRequest<unknown[]>(`/listings?limit=100&offset=${offset}`);
    if (!Array.isArray(page)) throw new HostawayApiError("Hostaway returned an invalid property list", 502);
    rows.push(...page);
    if (page.length < 100) break;
  }
  return rows;
}

// Every reservation that checks out on or after `departureFrom` (YYYY-MM-DD), across all listings.
export async function fetchHostawayReservations(departureFrom: string): Promise<unknown[]> {
  if (!isHostawayConfigured()) throw new HostawayApiError("Hostaway credentials are missing", 401);
  const rows: unknown[] = [];
  for (let offset = 0; offset < 5000; offset += 100) {
    // includeResources=1: each reservation comes with its itemised finance lines (financeField) for the expected payout.
    const page = await hostawayRequest<unknown[]>(`/reservations?limit=100&offset=${offset}&departureStartDate=${encodeURIComponent(departureFrom)}&sortOrder=arrivalDate&includeResources=1`);
    if (!Array.isArray(page)) throw new HostawayApiError("Hostaway returned an invalid reservation list", 502);
    rows.push(...page);
    if (page.length < 100) break;
  }
  return rows;
}

export async function fetchHostawayReservation(id: string): Promise<unknown> {
  if (!isHostawayConfigured()) throw new HostawayApiError("Hostaway credentials are missing", 401);
  return hostawayRequest<unknown>(`/reservations/${encodeURIComponent(id)}?includeResources=1`);
}

// Cancels a booking in Hostaway (it then tells the channel where it can: direct and Vrbo bookings).
// Airbnb and Booking.com bookings can only be cancelled on the channel itself.
export async function cancelHostawayReservation(id: string): Promise<void> {
  if (!isHostawayConfigured()) throw new HostawayApiError("Hostaway credentials are missing", 401);
  if (!/^\d{1,20}$/.test(id)) throw new HostawayApiError("Invalid Hostaway reservation", 400);
  await hostawayRequest<unknown>(`/reservations/${id}/statuses/cancelled`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cancelledBy: "host" }),
  });
}

// Sends a message to the guest through the booking channel (Airbnb, Booking.com, Vrbo) of a Hostaway
// conversation. Returns the new message's id when Hostaway gives one back.
export async function sendHostawayConversationMessage(conversationId: string, body: string): Promise<string | null> {
  if (!isHostawayConfigured()) throw new HostawayApiError("Hostaway credentials are missing", 401);
  if (!/^\d{1,20}$/.test(conversationId)) throw new HostawayApiError("Invalid Hostaway conversation", 400);
  const result = asObject(await hostawayRequest<unknown>(`/conversations/${conversationId}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ body, communicationType: "channel" }),
  }));
  return firstString(result.id, result.messageId) || null;
}

// Guest conversations, newest activity first (100 a page), with their reservation embedded.
export async function fetchHostawayConversations(pages = 1): Promise<unknown[]> {
  if (!isHostawayConfigured()) throw new HostawayApiError("Hostaway credentials are missing", 401);
  const rows: unknown[] = [];
  for (let page = 0; page < Math.min(10, Math.max(1, pages)); page++) {
    const batch = await hostawayRequest<unknown[]>(`/conversations?limit=100&offset=${page * 100}&includeResources=1`);
    if (!Array.isArray(batch)) throw new HostawayApiError("Hostaway returned an invalid conversation list", 502);
    rows.push(...batch);
    if (batch.length < 100) break;
  }
  return rows;
}

export async function fetchHostawayConversation(id: string): Promise<unknown> {
  if (!isHostawayConfigured()) throw new HostawayApiError("Hostaway credentials are missing", 401);
  return hostawayRequest<unknown>(`/conversations/${encodeURIComponent(id)}?includeResources=1`);
}

// A conversation's messages (up to 500, in the order Hostaway gives them; the mapping sorts them).
export async function fetchHostawayConversationMessages(id: string): Promise<unknown[]> {
  if (!isHostawayConfigured()) throw new HostawayApiError("Hostaway credentials are missing", 401);
  const rows: unknown[] = [];
  for (let offset = 0; offset < 500; offset += 100) {
    const page = await hostawayRequest<unknown[]>(`/conversations/${encodeURIComponent(id)}/messages?limit=100&offset=${offset}`);
    if (!Array.isArray(page)) throw new HostawayApiError("Hostaway returned an invalid message list", 502);
    rows.push(...page);
    if (page.length < 100) break;
  }
  return rows;
}

export async function fetchHostawayListing(id: string): Promise<unknown> {
  if (!isHostawayConfigured()) throw new HostawayApiError("Hostaway credentials are missing", 401);
  return hostawayRequest<unknown>(`/listings/${encodeURIComponent(id)}`);
}

// Raw guest reviews for the ratings sync (mapped in lib/hostaway-reviews-policy.ts): the newest pages, then the sweep from
// `sweepOffset` (where the last run stopped), REVIEW_PAGES requests at most. See sweepReviews.
// Listings made from onboarding (lib/hostaway-listing.ts): create one, or update the one Recharge made before. Hostaway
// fetches the photos from their links, so these get longer than the usual 10 seconds.
export async function createHostawayListing(body: JsonObject): Promise<string> {
  if (!isHostawayConfigured()) throw new HostawayApiError("Hostaway credentials are missing", 401);
  const created = asObject(await hostawayRequest<unknown>("/listings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, true, 45_000));
  const id = firstString(created.id, created.listingMapId);
  if (!id) throw new HostawayApiError("Hostaway did not return a listing ID", 502);
  return id;
}
export async function updateHostawayListing(id: string, body: JsonObject): Promise<void> {
  if (!isHostawayConfigured()) throw new HostawayApiError("Hostaway credentials are missing", 401);
  if (!/^[A-Za-z0-9._:-]{1,100}$/.test(id)) throw new HostawayApiError("Invalid Hostaway listing", 400);
  await hostawayRequest<unknown>(`/listings/${encodeURIComponent(id)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }, true, 45_000);
}
export function hostawayListingErrorMessage(error: unknown) {
  if (error instanceof HostawayApiError) {
    if (error.step === "sign-in" || error.status === 401) return "Hostaway refused the connection. Check the Hostaway Account ID and API key.";
    if (error.status === 403) return "The Hostaway API key is not allowed to create listings.";
    if (error.status >= 400 && error.status < 500) return `Hostaway did not accept the listing: ${error.message}`.slice(0, 900);
  }
  if (error instanceof Error && error.name === "TimeoutError") return "Hostaway took too long to answer. Check Hostaway before approving again, in case the listing was made.";
  return "Hostaway could not be reached just now. Try again in a few minutes.";
}

export async function fetchHostawayReviews(sweepOffset: number): Promise<ReviewSweep> {
  if (!isHostawayConfigured()) throw new HostawayApiError("Hostaway credentials are missing", 401);
  return sweepReviews(async (offset) => {
    const batch = await hostawayRequest<unknown[]>(reviewsPath(offset));
    if (!Array.isArray(batch)) throw new HostawayApiError("Hostaway returned an invalid review list", 502);
    return batch;
  }, sweepOffset);
}

function moneyPence(value: unknown) {
  const amount = numberValue(value);
  return Number.isFinite(amount) ? Math.max(0, Math.round(amount * 100)) : 0;
}

async function hostawayRequest<T>(
  path: string,
  init: RequestInit = {},
  retry = true,
  timeoutMs = 10_000,
): Promise<T> {
  const token = await accessToken();
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  headers.set("cache-control", "no-cache");
  const response = await fetch(`${HOSTAWAY_API}${path}`, {
    ...init,
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (response.status === 403 && retry) {
    cachedToken = null;
    return hostawayRequest<T>(path, init, false, timeoutMs);
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
    redirect: 'manual',
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
      firstString(payload.message, payload.error_description, payload.error) || "Hostaway token request failed",
      response.status,
      "sign-in",
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

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}



