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

type NormalizedMessage = {
  externalId: string;
  direction: "inbound" | "outbound";
  body: string;
  attachments: Array<{ url: string; contentType: string; name: string }>;
  sentAt: number;
  respondedAt: number | null;
  automated: boolean;
};

type ExistingThreadRow = {
  external_id: string;
  last_inbound_at: number | null;
  last_outbound_at: number | null;
  hostaway_listing_id: string;
  hostaway_reservation_id: string;
  property_name: string;
};

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

export async function syncHostawayConversations(limit = 30) {
  if (!isHostawayConfigured()) {
    throw new HostawayApiError("Hostaway credentials are missing", 401);
  }

  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit)));
  const conversations = await hostawayRequest<unknown[]>(
    `/conversations?limit=${safeLimit}&offset=0&includeResources=1`,
  );
  if (!Array.isArray(conversations)) {
    throw new HostawayApiError("Hostaway returned an invalid conversation list", 502);
  }

  const db = database();
  const [existing, legacyMedia] = await Promise.all([
    db
      .prepare(
        "SELECT external_id, last_inbound_at, last_outbound_at, hostaway_listing_id, hostaway_reservation_id, property_name FROM communication_threads WHERE source = 'guests'",
      )
      .all<ExistingThreadRow>(),
    db
      .prepare(
        "SELECT DISTINCT thread_id FROM communication_messages WHERE source = 'guests' AND body = 'Attachment or non-text message'",
      )
      .all<{ thread_id: string }>(),
  ]);
  const existingById = new Map(
    existing.results.map((row) => [row.external_id, row]),
  );
  const legacyMediaThreads = new Set(legacyMedia.results.map((row) => row.thread_id));

  const changed = conversations.filter((value) => {
    const conversation = asObject(value);
    const externalId = scalarString(conversation.id);
    if (!externalId) return false;
    const current = existingById.get(externalId);
    if (!current) return true;
    if (legacyMediaThreads.has(`hostaway:${externalId}`)) return true;
    if (/^listing\s+\d+$/i.test(current.property_name)) return true;
    if (!current.hostaway_listing_id || !current.hostaway_reservation_id) return true;
    const remoteLatest = Math.max(
      parseTimestamp(conversation.messageReceivedOn),
      parseTimestamp(conversation.messageSentOn),
    );
    const localLatest = Math.max(
      current.last_inbound_at ?? 0,
      current.last_outbound_at ?? 0,
    );
    return remoteLatest > localLatest;
  });

  let conversationsImported = 0;
  let messagesImported = 0;
  let failures = 0;

  for (let index = 0; index < changed.length; index += 5) {
    const batch = changed.slice(index, index + 5);
    const results = await Promise.allSettled(
      batch.map((conversation) => syncConversation(asObject(conversation))),
    );
    for (const result of results) {
      if (result.status === "fulfilled") {
        conversationsImported += 1;
        messagesImported += result.value;
      } else {
        failures += 1;
        console.error("Unable to sync a Hostaway conversation", result.reason);
      }
    }
  }

  if (changed.length > 0 && conversationsImported === 0) {
    throw new HostawayApiError("Hostaway conversations could not be imported", 502);
  }

  return {
    conversationsSeen: conversations.length,
    conversationsImported,
    messagesImported,
    failures,
  };
}

export async function sendHostawayReply(input: {
  threadId: string;
  body: string;
  actorEmail: string;
  actorName: string;
}) {
  const db = database();
  const thread = await db
    .prepare(
      "SELECT external_id FROM communication_threads WHERE id = ? AND source = 'guests' LIMIT 1",
    )
    .bind(input.threadId)
    .first<{ external_id: string }>();
  if (!thread) throw new HostawayApiError("Hostaway conversation not found", 404);

  const conversation = asObject(
    await hostawayRequest<unknown>(
      `/conversations/${encodeURIComponent(thread.external_id)}?includeResources=1`,
    ),
  );
  const communicationType = hostawayCommunicationType(conversation);
  const created = asObject(
    await hostawayRequest<unknown>(
      `/conversations/${encodeURIComponent(thread.external_id)}/messages`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          body: input.body.trim(),
          communicationType,
        }),
      },
    ),
  );

  const now = Math.floor(Date.now() / 1000);
  const externalId = scalarString(created.id) || `${thread.external_id}:${now}`;
  const sentAt = parseTimestamp(created.insertedOn ?? created.date) || now;
  const messageId = `hostaway:${externalId}`;

  await db.batch([
    db
      .prepare(
        "INSERT INTO communication_messages (id, thread_id, source, external_id, direction, body, sent_at, responded_at, responded_by_email, responded_by_name, is_automated, created_at) VALUES (?, ?, 'guests', ?, 'outbound', ?, ?, NULL, ?, ?, 0, ?) ON CONFLICT(source, external_id) DO UPDATE SET body = excluded.body, sent_at = excluded.sent_at, responded_by_email = COALESCE(communication_messages.responded_by_email, excluded.responded_by_email), responded_by_name = COALESCE(communication_messages.responded_by_name, excluded.responded_by_name)",
      )
      .bind(
        messageId,
        input.threadId,
        externalId,
        input.body.trim(),
        sentAt,
        input.actorEmail,
        input.actorName,
        now,
      ),
    db
      .prepare(
        "UPDATE communication_messages SET responded_at = ?, responded_by_email = ?, responded_by_name = ? WHERE thread_id = ? AND direction = 'inbound' AND responded_at IS NULL AND sent_at <= ?",
      )
      .bind(
        sentAt,
        input.actorEmail,
        input.actorName,
        input.threadId,
        sentAt,
      ),
    db
      .prepare(
        "UPDATE communication_threads SET last_outbound_at = ?, assigned_to_email = COALESCE(assigned_to_email, ?), assigned_to_name = COALESCE(assigned_to_name, ?), status = 'open', updated_at = ? WHERE id = ?",
      )
      .bind(sentAt, input.actorEmail, input.actorName, now, input.threadId),
  ]);

  return { messageId, sentAt };
}

async function syncConversation(conversation: JsonObject) {
  const externalId = scalarString(conversation.id);
  if (!externalId) throw new HostawayApiError("Conversation ID missing", 502);

  const result = await hostawayRequest<unknown[]>(
    `/conversations/${encodeURIComponent(externalId)}/messages?limit=75&offset=0`,
  );
  const rawMessages = Array.isArray(result)
    ? result
    : arrayValue(conversation.conversationMessages);
  const messages = normalizeMessages(externalId, rawMessages);
  const reservation = asObject(
    conversation.Reservation ?? conversation.reservation,
  );
  const hostawayListingId = firstString(
    conversation.listingMapId,
    reservation.listingMapId,
    reservation.listingId,
  );
  const hostawayReservationId = firstString(
    reservation.hostawayReservationId,
    conversation.reservationId,
    reservation.id,
  );
  const db = database();
  const managedProperty = hostawayListingId
    ? await db
        .prepare(
          "SELECT property_name FROM management_properties WHERE merged_into_property_id IS NULL AND (hostaway_listing_id = ? OR instr(hostaway_listing_ids, ? || char(34)) > 0) LIMIT 1",
        )
        .bind(hostawayListingId, hostawayListingId)
        .first<{ property_name: string }>()
    : null;
  const propertyName =
    managedProperty?.property_name ||
    firstString(reservation.listingName, conversation.listingName) ||
    "Property not identified";
  const guestName =
    firstString(
      conversation.recipientName,
      reservation.guestName,
      reservation.guestFirstName,
    ) || "Guest";
  const senderAddress = firstString(
    conversation.guestEmail,
    conversation.recipientEmail,
  );
  const subject = hostawayConversationLabel(conversation, reservation);
  const lastInboundAt = latestMessageTime(messages, "inbound") || null;
  const lastOutboundAt = latestMessageTime(messages, "outbound") || null;
  const now = Math.floor(Date.now() / 1000);
  const threadId = `hostaway:${externalId}`;
  const statements = [
    db
      .prepare(
        "INSERT INTO communication_threads (id, source, external_id, property_name, guest_name, sender_address, subject, hostaway_listing_id, hostaway_reservation_id, status, assigned_to_email, assigned_to_name, last_inbound_at, last_outbound_at, created_at, updated_at) VALUES (?, 'guests', ?, ?, ?, ?, ?, ?, ?, 'open', NULL, NULL, ?, ?, ?, ?) ON CONFLICT(source, external_id) DO UPDATE SET property_name = excluded.property_name, guest_name = excluded.guest_name, sender_address = excluded.sender_address, subject = excluded.subject, hostaway_listing_id = excluded.hostaway_listing_id, hostaway_reservation_id = excluded.hostaway_reservation_id, opened_at = CASE WHEN excluded.last_inbound_at IS NOT NULL AND (communication_threads.last_inbound_at IS NULL OR excluded.last_inbound_at > communication_threads.last_inbound_at) THEN NULL ELSE communication_threads.opened_at END, status = CASE WHEN excluded.last_inbound_at IS NOT NULL AND (communication_threads.last_inbound_at IS NULL OR excluded.last_inbound_at > communication_threads.last_inbound_at) THEN 'open' ELSE communication_threads.status END, last_inbound_at = CASE WHEN excluded.last_inbound_at IS NULL THEN communication_threads.last_inbound_at WHEN communication_threads.last_inbound_at IS NULL OR excluded.last_inbound_at > communication_threads.last_inbound_at THEN excluded.last_inbound_at ELSE communication_threads.last_inbound_at END, last_outbound_at = CASE WHEN excluded.last_outbound_at IS NULL THEN communication_threads.last_outbound_at WHEN communication_threads.last_outbound_at IS NULL OR excluded.last_outbound_at > communication_threads.last_outbound_at THEN excluded.last_outbound_at ELSE communication_threads.last_outbound_at END, updated_at = excluded.updated_at",
      )
      .bind(
        threadId,
        externalId,
        propertyName,
        guestName,
        senderAddress,
        subject,
        hostawayListingId,
        hostawayReservationId,
        lastInboundAt,
        lastOutboundAt,
        now,
        now,
      ),
    ...messages.map((message) =>
      db
        .prepare(
          "INSERT INTO communication_messages (id, thread_id, source, external_id, direction, body, attachments_json, sent_at, responded_at, responded_by_email, responded_by_name, is_automated, created_at) VALUES (?, ?, 'guests', ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?) ON CONFLICT(source, external_id) DO UPDATE SET thread_id = excluded.thread_id, direction = excluded.direction, body = excluded.body, attachments_json = excluded.attachments_json, sent_at = excluded.sent_at, responded_at = COALESCE(communication_messages.responded_at, excluded.responded_at), is_automated = excluded.is_automated",
        )
        .bind(
          `hostaway:${message.externalId}`,
          threadId,
          message.externalId,
          message.direction,
          message.body,
          JSON.stringify(message.attachments),
          message.sentAt,
          message.respondedAt,
          message.automated ? 1 : 0,
          now,
        ),
    ),
  ];
  await db.batch(statements);
  return messages.length;
}

function normalizeMessages(
  conversationId: string,
  values: unknown[],
): NormalizedMessage[] {
  const messages = values
    .map((value, index): NormalizedMessage => {
      const message = asObject(value);
      const sentAt =
        parseTimestamp(message.insertedOn ?? message.date ?? message.createdOn) ||
        Math.floor(Date.now() / 1000);
      const externalId =
        scalarString(message.id) || `${conversationId}:${sentAt}:${index}`;
      const attachments = extractMessageAttachments(message);
      return {
        externalId,
        direction: booleanLike(message.isIncoming) ? "inbound" : "outbound",
        body: firstString(message.body, message.message, message.content),
        attachments,
        sentAt,
        respondedAt: null,
        automated: Boolean(message.communicationEvent ?? message.isAutomated),
      } satisfies NormalizedMessage;
    })
    .sort((a, b) => a.sentAt - b.sentAt);

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.direction !== "inbound") continue;
    const response = messages
      .slice(index + 1)
      .find((candidate) => candidate.direction === "outbound");
    if (response) message.respondedAt = response.sentAt;
  }
  return messages;
}

function extractMessageAttachments(message: JsonObject) {
  const attachments: Array<{ url: string; contentType: string; name: string }> = [];
  const values = [
    ...arrayValue(message.attachments),
    ...arrayValue(message.communicationAttachments),
    ...arrayValue(message.conversationMessageAttachments),
    ...arrayValue(message.files),
    ...arrayValue(message.images),
    ...arrayValue(message.media),
    message.attachment,
    message.file,
  ].filter(Boolean);

  for (const value of values) {
    const attachment = asObject(value);
    const url = typeof value === "string"
      ? value
      : firstString(
          attachment.url,
          attachment.fileUrl,
          attachment.downloadUrl,
          attachment.publicUrl,
          attachment.src,
        );
    if (!/^https?:\/\//i.test(url)) continue;
    attachments.push({
      url,
      contentType: firstString(attachment.contentType, attachment.mimeType, attachment.mediaType, attachment.type) || inferAttachmentType(url),
      name: firstString(attachment.fileName, attachment.filename, attachment.name, attachment.title) || "Guest attachment",
    });
  }

  for (const [key, type] of [["imageUrl", "image"], ["videoUrl", "video"], ["attachmentUrl", ""], ["fileUrl", ""]] as const) {
    const url = firstString(message[key]);
    if (/^https?:\/\//i.test(url) && !attachments.some((item) => item.url === url)) {
      attachments.push({ url, contentType: type || inferAttachmentType(url), name: "Guest attachment" });
    }
  }

  const body = firstString(message.body, message.message, message.content);
  for (const match of body.matchAll(/https?:\/\/[^\s<>"']+\.(?:jpe?g|png|gif|webp|heic|mp4|mov|webm|m4v)(?:\?[^\s<>"']*)?/gi)) {
    const url = match[0];
    if (!attachments.some((item) => item.url === url)) {
      attachments.push({ url, contentType: inferAttachmentType(url), name: "Guest attachment" });
    }
  }

  return attachments;
}

function inferAttachmentType(url: string) {
  const value = url.toLowerCase().split("?")[0];
  if (/\.(jpg|jpeg|png|gif|webp|heic)$/.test(value)) return "image";
  if (/\.(mp4|mov|webm|m4v)$/.test(value)) return "video";
  return "file";
}

function hostawayCommunicationType(conversation: JsonObject) {
  const reservation = asObject(
    conversation.Reservation ?? conversation.reservation,
  );
  const combined = [conversation.type, reservation.channelName]
    .map((value) => scalarString(value).toLowerCase())
    .join(" ");
  if (combined.includes("whatsapp")) return "whatsapp";
  if (combined.includes("sms")) return "sms";
  if (combined.includes("email") || combined.includes("direct")) return "email";
  return "channel";
}

function hostawayConversationLabel(
  conversation: JsonObject,
  reservation: JsonObject,
) {
  const channel = firstString(reservation.channelName, conversation.type);
  const reservationId = scalarString(
    reservation.hostawayReservationId ??
      conversation.reservationId ??
      reservation.id,
  );
  return [channel ? titleCase(channel) : "Hostaway", reservationId ? `Booking ${reservationId}` : ""]
    .filter(Boolean)
    .join(" · ");
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

function database() {
  if (!env.DB) throw new Error("Recharge communication database is unavailable");
  return env.DB;
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

function latestMessageTime(
  messages: NormalizedMessage[],
  direction: NormalizedMessage["direction"],
) {
  return messages.reduce(
    (latest, message) =>
      message.direction === direction ? Math.max(latest, message.sentAt) : latest,
    0,
  );
}

function titleCase(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}
