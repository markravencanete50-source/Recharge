import { env } from "cloudflare:workers";
import type { AccessProfile } from "@/lib/access";
import { createMaintenanceTicket } from "@/lib/maintenance";
import { listHostawayReservations } from "@/lib/hostaway";

export type CommunicationSource = "guests" | "email" | "whatsapp";
export type CommunicationChannel =
  | "all"
  | CommunicationSource
  | "phone";
export type CommunicationWorkflow = {
  id: string;
  name: string;
  channel: CommunicationChannel;
  triggerText: string;
  instructions: string;
  approvedResponse: string;
  escalationTarget: "none" | "ready" | "cleans";
  priority: "standard" | "urgent";
  status: "active" | "inactive";
  createdByName: string;
  updatedAt: number;
};

export type CommunicationMessage = {
  id: string;
  source: CommunicationSource;
  direction: "inbound" | "outbound";
  body: string;
  attachments: Array<{
    url: string;
    contentType: string;
    name: string;
  }>;
  sentAt: number;
  respondedAt: number | null;
  respondedByEmail: string | null;
  respondedByName: string | null;
  isAutomated: boolean;
};

export type CommunicationThread = {
  id: string;
  source: CommunicationSource;
  propertyName: string;
  guestName: string;
  senderAddress: string;
  subject: string;
  hostawayListingId: string;
  hostawayReservationId: string;
  openedAt: number | null;
  unread: boolean;
  unreadCount: number;
  status: "open" | "closed" | "junk";
  assignedToEmail: string | null;
  assignedToName: string | null;
  lastInboundAt: number | null;
  lastOutboundAt: number | null;
  messages: CommunicationMessage[];
};

export type CommunicationCall = {
  id: string;
  direction: "inbound" | "outbound";
  phoneNumber: string;
  contactName: string;
  outcome: "answered" | "missed" | "abandoned" | "voicemail";
  answeredByName: string | null;
  startedAt: number;
  answeredAt: number | null;
  endedAt: number | null;
};

export type CommunicationCentreData = {
  available: boolean;
  integrations: {
    hostaway: boolean;
    email: boolean;
    whatsapp: boolean;
    bonline: boolean;
  };
  workflows: CommunicationWorkflow[];
  threads: CommunicationThread[];
  calls: CommunicationCall[];
  schedule: Array<{
    id: number;
    email: string;
    name: string;
    shiftDate: string;
    startTime: string;
    endTime: string;
    label: string;
  }>;
};

type ThreadRow = {
  id: string;
  source: CommunicationSource;
  property_name: string;
  guest_name: string;
  sender_address: string;
  subject: string;
  hostaway_listing_id: string;
  hostaway_reservation_id: string;
  opened_at: number | null;
  status: "open" | "closed" | "junk";
  assigned_to_email: string | null;
  assigned_to_name: string | null;
  last_inbound_at: number | null;
  last_outbound_at: number | null;
};

type MessageRow = {
  id: string;
  thread_id: string;
  source: CommunicationSource;
  direction: "inbound" | "outbound";
  body: string;
  attachments_json: string;
  sent_at: number;
  responded_at: number | null;
  responded_by_email: string | null;
  responded_by_name: string | null;
  is_automated: number;
};

type ManagedPropertyRow = {
  property_name: string;
  hostaway_listing_id: string;
  hostaway_listing_ids: string;
};

export function canUseCommunicationCentre(profile: AccessProfile) {
  return (
    profile.role === "admin" || profile.modules.includes("guest-communication")
  );
}

function database() {
  if (!env.DB) throw new Error("Recharge communication database is unavailable");
  return env.DB;
}

export async function getCommunicationCentreData(
  profile: AccessProfile,
): Promise<CommunicationCentreData | undefined> {
  if (!canUseCommunicationCentre(profile)) return undefined;

  const integrations = integrationStatus();
  try {
    const db = database();
    const [workflowRows, threadRows, messageRows, callRows, scheduleRows, propertyRows] = await Promise.all([
      db
        .prepare(
          "SELECT id, name, channel, trigger_text, instructions, approved_response, escalation_target, priority, status, created_by_name, updated_at FROM communication_workflows ORDER BY status, updated_at DESC",
        )
        .all<{
          id: string;
          name: string;
          channel: CommunicationChannel;
          trigger_text: string;
          instructions: string;
          approved_response: string;
          escalation_target: "none" | "ready" | "cleans";
          priority: "standard" | "urgent";
          status: "active" | "inactive";
          created_by_name: string;
          updated_at: number;
        }>(),
      db
        .prepare(
          "SELECT id, source, property_name, guest_name, sender_address, subject, hostaway_listing_id, hostaway_reservation_id, opened_at, status, assigned_to_email, assigned_to_name, last_inbound_at, last_outbound_at FROM communication_threads WHERE status != 'junk' ORDER BY COALESCE(last_inbound_at, updated_at) DESC LIMIT 250",
        )
        .all<ThreadRow>(),
      db
        .prepare(
          "SELECT id, thread_id, source, direction, body, attachments_json, sent_at, responded_at, responded_by_email, responded_by_name, is_automated FROM communication_messages ORDER BY sent_at DESC LIMIT 1500",
        )
        .all<MessageRow>(),
      db
        .prepare(
          "SELECT id, direction, phone_number, contact_name, outcome, answered_by_name, started_at, answered_at, ended_at FROM communication_calls ORDER BY started_at DESC LIMIT 250",
        )
        .all<{
          id: string;
          direction: "inbound" | "outbound";
          phone_number: string;
          contact_name: string;
          outcome: "answered" | "missed" | "abandoned" | "voicemail";
          answered_by_name: string | null;
          started_at: number;
          answered_at: number | null;
          ended_at: number | null;
        }>(),
      db
        .prepare(
          "SELECT ws.id, ws.email, COALESCE(au.full_name, ws.email) AS full_name, ws.shift_date, ws.start_time, ws.end_time, ws.label FROM work_schedules ws LEFT JOIN access_users au ON au.email = ws.email WHERE ws.status = 'scheduled' AND ws.shift_date BETWEEN date('now') AND date('now', '+6 days') ORDER BY ws.shift_date, ws.start_time",
        )
        .all<{
          id: number;
          email: string;
          full_name: string;
          shift_date: string;
          start_time: string;
          end_time: string;
          label: string;
        }>(),
      db
        .prepare(
          "SELECT property_name, hostaway_listing_id, hostaway_listing_ids FROM management_properties WHERE merged_into_property_id IS NULL",
        )
        .all<ManagedPropertyRow>(),
    ]);

    const propertyNameByListing = new Map<string, string>();
    for (const property of propertyRows.results as ManagedPropertyRow[]) {
      for (const listingId of [property.hostaway_listing_id, ...parseStringArray(property.hostaway_listing_ids)]) {
        if (listingId) propertyNameByListing.set(listingId, property.property_name);
      }
    }

    const messages = (messageRows.results as MessageRow[]).map((row) => ({
      id: row.id,
      source: row.source,
      direction: row.direction,
      body: row.body,
      attachments: parseAttachments(row.attachments_json),
      sentAt: row.sent_at,
      respondedAt: row.responded_at,
      respondedByEmail: row.responded_by_email,
      respondedByName: row.responded_by_name,
      isAutomated: Boolean(row.is_automated),
      threadId: row.thread_id,
    }));

    return {
      available: true,
      integrations,
      workflows: workflowRows.results.map((row) => ({
        id: row.id,
        name: row.name,
        channel: row.channel,
        triggerText: row.trigger_text,
        instructions: row.instructions,
        approvedResponse: row.approved_response,
        escalationTarget: row.escalation_target,
        priority: row.priority,
        status: row.status,
        createdByName: row.created_by_name,
        updatedAt: row.updated_at,
      })),
      threads: (threadRows.results as ThreadRow[]).map((row) => ({
        id: row.id,
        source: row.source,
        propertyName: propertyNameByListing.get(row.hostaway_listing_id) || row.property_name,
        guestName: row.guest_name,
        senderAddress: row.sender_address,
        subject: row.subject,
        hostawayListingId: row.hostaway_listing_id,
        hostawayReservationId: row.hostaway_reservation_id,
        openedAt: row.opened_at,
        unread: Boolean(row.last_inbound_at && row.last_inbound_at > Math.max(row.opened_at || 0, row.last_outbound_at || 0)),
        unreadCount: messages.filter((message) => message.threadId === row.id && message.direction === "inbound" && message.sentAt > Math.max(row.opened_at || 0, row.last_outbound_at || 0)).length,
        status: row.status,
        assignedToEmail: row.assigned_to_email,
        assignedToName: row.assigned_to_name,
        lastInboundAt: row.last_inbound_at,
        lastOutboundAt: row.last_outbound_at,
        messages: messages
          .filter((message) => message.threadId === row.id)
          .map((message) => ({
            id: message.id,
            source: message.source,
            direction: message.direction,
            body: message.body,
            attachments: message.attachments,
            sentAt: message.sentAt,
            respondedAt: message.respondedAt,
            respondedByEmail: message.respondedByEmail,
            respondedByName: message.respondedByName,
            isAutomated: message.isAutomated,
          }))
          .sort((a, b) => a.sentAt - b.sentAt),
      })),
      calls: callRows.results.map((row) => ({
        id: row.id,
        direction: row.direction,
        phoneNumber: row.phone_number,
        contactName: row.contact_name,
        outcome: row.outcome,
        answeredByName: row.answered_by_name,
        startedAt: row.started_at,
        answeredAt: row.answered_at,
        endedAt: row.ended_at,
      })),
      schedule: scheduleRows.results.map((row) => ({
        id: row.id,
        email: row.email,
        name: row.full_name,
        shiftDate: row.shift_date,
        startTime: row.start_time,
        endTime: row.end_time,
        label: row.label,
      })),
    };
  } catch (error) {
    console.error("Unable to load Stays Communication Centre", error);
    return {
      ...emptyCommunicationCentreData(),
      integrations,
    };
  }
}

function parseAttachments(value: string) {
  try {
    const parsed = JSON.parse(value || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is { url?: unknown; contentType?: unknown; name?: unknown } => Boolean(item && typeof item === "object"))
      .map((item) => ({
        url: typeof item.url === "string" ? item.url : "",
        contentType: typeof item.contentType === "string" ? item.contentType : "",
        name: typeof item.name === "string" ? item.name : "Attachment",
      }))
      .filter((item) => /^https?:\/\//i.test(item.url));
  } catch {
    return [];
  }
}

function parseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string" && Boolean(item))
      : [];
  } catch {
    return [];
  }
}

export async function saveCommunicationWorkflow(input: {
  name: string;
  channel: CommunicationChannel;
  triggerText: string;
  instructions: string;
  approvedResponse: string;
  escalationTarget: "none" | "ready" | "cleans";
  priority: "standard" | "urgent";
  actorEmail: string;
  actorName: string;
}) {
  const now = Math.floor(Date.now() / 1000);
  await database()
    .prepare(
      "INSERT INTO communication_workflows (id, name, channel, trigger_text, instructions, approved_response, escalation_target, priority, status, created_by_email, created_by_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?)",
    )
    .bind(
      crypto.randomUUID(),
      input.name.trim(),
      input.channel,
      input.triggerText.trim(),
      input.instructions.trim(),
      input.approvedResponse.trim(),
      input.escalationTarget,
      input.priority,
      input.actorEmail,
      input.actorName,
      now,
      now,
    )
    .run();
}

export async function updateCommunicationWorkflowStatus(input: {
  id: string;
  status: "active" | "inactive";
}) {
  await database()
    .prepare(
      "UPDATE communication_workflows SET status = ?, updated_at = unixepoch() WHERE id = ?",
    )
    .bind(input.status, input.id)
    .run();
}

export async function updateCommunicationThread(input: {
  id: string;
  action: "read" | "junk" | "close" | "reopen";
  actorEmail: string;
  actorName: string;
}) {
  const db = database();
  if (input.action === "read") {
    await db.prepare("UPDATE communication_threads SET opened_at = unixepoch(), updated_at = unixepoch() WHERE id = ?").bind(input.id).run();
    return;
  }
  const status =
    input.action === "junk"
      ? "junk"
      : input.action === "close"
        ? "closed"
        : "open";
  await db
    .prepare(
      "UPDATE communication_threads SET status = ?, updated_at = unixepoch() WHERE id = ?",
    )
    .bind(status, input.id)
    .run();
}

export async function createCommunicationEscalation(input: {
  threadId: string;
  messageId: string;
  target: "ready" | "cleans" | "direct";
  actorEmail: string;
  actorName: string;
}) {
  const db = database();
  const thread = await db
    .prepare(
      "SELECT property_name, guest_name, sender_address, subject, hostaway_listing_id, hostaway_reservation_id FROM communication_threads WHERE id = ? LIMIT 1",
    )
    .bind(input.threadId)
    .first<{
      property_name: string;
      guest_name: string;
      sender_address: string;
      subject: string;
      hostaway_listing_id: string;
      hostaway_reservation_id: string;
    }>();
  const message = await db
    .prepare(
      "SELECT body FROM communication_messages WHERE id = ? AND thread_id = ? LIMIT 1",
    )
    .bind(input.messageId, input.threadId)
    .first<{ body: string }>();

  if (!thread || !message) throw new Error("Communication not found");

  if (input.target === "ready") {
    await createMaintenanceTicket({
      source: "guest_communication",
      sourceThreadId: input.threadId,
      sourceMessageId: input.messageId,
      propertyName: thread.property_name || "Property not identified",
      guestName: thread.guest_name,
      category: "General repair",
      priority: "urgent",
      summary: `Guest maintenance issue${thread.guest_name ? ` · ${thread.guest_name}` : ""}`,
      details: [thread.subject, message.body].filter(Boolean).join("\n\n"),
      actorEmail: input.actorEmail,
      actorName: input.actorName,
    });
    return;
  }

  if (input.target === "direct") {
    if (!thread.hostaway_listing_id || !thread.hostaway_reservation_id) throw new Error("A linked Hostaway booking is required");
    const reservations = await listHostawayReservations(thread.hostaway_listing_id);
    const reservation = reservations.find((item) => item.id === thread.hostaway_reservation_id);
    if (!reservation) throw new Error("The linked Hostaway booking could not be found");
    if (/cancel|declin|expired|inquir|enquir|pending|quote/i.test(reservation.status)) throw new Error("Only confirmed bookings can become direct booking tickets");
    const arrival = new Date(`${reservation.arrivalDate.slice(0, 10)}T00:00:00Z`);
    const departure = new Date(`${reservation.departureDate.slice(0, 10)}T00:00:00Z`);
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (!Number.isFinite(arrival.getTime()) || !Number.isFinite(departure.getTime()) || arrival < today) throw new Error("Only confirmed future bookings can become direct booking tickets");
    const nights = Math.max(1, Math.round((departure.getTime() - arrival.getTime()) / 86_400_000));
    const now = Math.floor(Date.now() / 1000);
    await db.prepare("INSERT INTO direct_booking_tickets (id, source_key, hostaway_reservation_id, property_id, property_name, booker_name, booker_email, booker_phone, arrival_date, departure_date, nights, original_gross_pence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(source_key) DO UPDATE SET property_name = excluded.property_name, booker_name = excluded.booker_name, booker_email = excluded.booker_email, booker_phone = excluded.booker_phone, arrival_date = excluded.arrival_date, departure_date = excluded.departure_date, nights = excluded.nights, original_gross_pence = excluded.original_gross_pence, updated_at = excluded.updated_at")
      .bind(crypto.randomUUID(), `reservation:${reservation.id}`, reservation.id, reservation.listingId, thread.property_name || reservation.propertyName, reservation.guestName || thread.guest_name, reservation.guestEmail || thread.sender_address, reservation.guestPhone, reservation.arrivalDate, reservation.departureDate, nights, reservation.grossRevenuePence, now, now).run();
    return;
  }

  const report = {
    cleans: {
      board: "clean_issues",
      targetBusiness: "Cleans",
      lane: "guest_issue",
      title: "Guest cleaning issue",
    },
  }[input.target as "cleans"];
  const sourceKey = `communication:${input.messageId}:${input.target}`;
  const now = Math.floor(Date.now() / 1000);

  await db
    .prepare(
      "INSERT INTO workflow_tickets (id, board, lane, source_business, target_business, property_name, property_address, title, details, priority, due_date, status, trigger_type, source_onboarding_id, created_by_email, created_by_name, created_at, updated_at) VALUES (?, ?, ?, 'Stays', ?, ?, '', ?, ?, 'urgent', NULL, 'new', 'manual_referral', ?, ?, ?, ?, ?) ON CONFLICT(source_onboarding_id, board) DO NOTHING",
    )
    .bind(
      crypto.randomUUID(),
      report.board,
      report.lane,
      report.targetBusiness,
      thread.property_name || "Property not identified",
      `${report.title}${thread.guest_name ? ` · ${thread.guest_name}` : ""}`,
      [thread.subject, message.body].filter(Boolean).join("\n\n"),
      sourceKey,
      input.actorEmail,
      input.actorName,
      now,
      now,
    )
    .run();
}

function integrationStatus() {
  return {
    hostaway: Boolean(env.HOSTAWAY_ACCOUNT_ID && env.HOSTAWAY_API_KEY),
    email: Boolean(env.COMMUNICATION_EMAIL_BRIDGE_TOKEN),
    whatsapp: Boolean(
      env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID,
    ),
    bonline: Boolean(env.BONLINE_API_KEY),
  };
}

function emptyCommunicationCentreData(): CommunicationCentreData {
  return {
    available: false,
    integrations: {
      hostaway: false,
      email: false,
      whatsapp: false,
      bonline: false,
    },
    workflows: [],
    threads: [],
    calls: [],
    schedule: [],
  };
}
