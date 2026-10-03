/* eslint-disable @typescript-eslint/no-explicit-any */
import { env } from "cloudflare:workers";
import type { AccessProfile } from "@/lib/access";
import { listHostawayCalendarRates, listHostawayProperties, listHostawayReservations, listHostawayReviews } from "@/lib/hostaway";

export type ReadyCalendarEvent = {
  id: string;
  date: string;
  endDate: string;
  type: "routine_check" | "inspection" | "ready_maintenance" | "routine_maintenance";
  title: string;
  propertyName: string;
  status: string;
  valuePence: number;
};

export type RoutineMaintenanceBooking = {
  id: string;
  propertyId: string;
  propertyName: string;
  region: string;
  category: "safety_inspection" | "garden" | "bins" | "general_check" | "other";
  scheduledDate: string;
  startTime: string;
  endTime: string;
  assignedTo: string;
  notes: string;
  status: "booked" | "complete" | "cancelled";
};

export type RoutineInspectionSubmission = {
  id: string;
  bookingId: string;
  checklist: Record<string, "pass" | "attention" | "na">;
  overallCondition: "good" | "attention" | "urgent";
  workCompleted: string;
  issuesFound: string;
  followUpRequired: boolean;
  followUpDetails: string;
  submittedByName: string;
  submittedAt: number;
};

export type ListingHealthTicket = {
  id: string;
  kind: "review" | "suspension" | "visibility" | "relisting";
  propertyId: string;
  propertyName: string;
  channel: string;
  rating: number | null;
  reviewText: string;
  responseUrl: string;
  decisionReason: string;
  decision: "pending" | "okay" | "relist" | "keep";
  responded: boolean;
  status: "new" | "in_progress" | "complete";
  createdAt: number;
};

export type PricingGapTicket = {
  id: string;
  propertyId: string;
  propertyName: string;
  gapStart: string;
  gapEnd: string;
  nights: number;
  currentPricePence: number;
  decision: "pending" | "hold" | "alter";
  decisionReason: string;
  status: "open" | "completed" | "filled" | "lapsed";
  nightDecisions: PricingNightDecision[];
};

export type PricingNightDecision = {
  id: string;
  date: string;
  currentRatePence: number;
  decidedRatePence: number;
  decision: "pending" | "hold" | "change";
  reason: string;
  pricelabsUpdated: boolean;
  completedAt: number | null;
};

export type PricingOpportunity = {
  id: string;
  propertyId: string;
  kind: "school_holiday" | "event" | "contractor_work";
  title: string;
  location: string;
  startDate: string;
  endDate: string;
  radiusMiles: number;
  decision: "pending" | "hold" | "increase";
  decisionReason: string;
  isNew: boolean;
};

export type DirectBookingTicket = {
  id: string;
  propertyName: string;
  bookerName: string;
  bookerEmail: string;
  bookerPhone: string;
  arrivalDate: string;
  departureDate: string;
  nights: number;
  originalGrossPence: number;
  offeredAmountPence: number;
  status: "new" | "contacting" | "verbally_agreed" | "booking_confirmed" | "complete" | "archived";
  response: "pending" | "accepted" | "rejected";
  invoiceStatus: "not_created" | "to_send" | "sent" | "settled";
  otaCancelled: boolean;
  uploadedToHostaway: boolean;
  lastTouchAt: number | null;
};

export type DirectBookingTouch = { id: string; ticketId: string; channel: "phone" | "email" | "whatsapp"; note: string; createdByName: string; createdAt: number };

export type WeeklyReport = {
  id: string;
  weekStart: string;
  propertyId: string;
  propertyName: string;
  clientEmail: string;
  revenue14dPence: number;
  summary: string;
  priceChanges: Array<Record<string, unknown>>;
  calendarItems: Array<Record<string, unknown>>;
  createdAt: number;
  sentAt: number | null;
};

export type OperationsData = {
  available: boolean;
  properties: Array<{ id: string; name: string; address: string; region: string; status: string; clientEmail: string }>;
  routineMaintenanceBookings: RoutineMaintenanceBooking[];
  routineInspectionSubmissions: RoutineInspectionSubmission[];
  readyEvents: ReadyCalendarEvent[];
  listingTickets: ListingHealthTicket[];
  listingDailyReport: { reportDate: string; allVisible: boolean; noNegativeReviews: boolean; completedByName: string } | null;
  listingChecksToday: number;
  listingReporting: {
    airbnb: Record<string, number>;
    booking: Record<string, number>;
    suspensions: number;
    relistings: number;
  };
  pricingGaps: PricingGapTicket[];
  opportunities: PricingOpportunity[];
  weeklyScanCompletedPropertyIds: string[];
  directBookingLeads: Array<{ id: string; title: string; location: string; startDate: string; endDate: string; details: string; status: string }>;
  directBookingTickets: DirectBookingTicket[];
  directBookingTouches: DirectBookingTouch[];
  reports: WeeklyReport[];
  lastSyncedAt: number | null;
};

function database() {
  if (!env.DB) throw new Error("Recharge operations database is unavailable");
  return env.DB;
}

export function canUseOperations(profile: AccessProfile) {
  return profile.role === "admin" || profile.role === "stays" || profile.role === "ready" || profile.role === "client";
}

export async function getOperationsData(profile: AccessProfile): Promise<OperationsData> {
  try {
    const db = database();
    const propertyWhere = profile.role === "client" ? "AND lower(owner_email) = ?" : "";
    const propertyQuery = `SELECT id, property_name, property_address, region, status, owner_email FROM management_properties WHERE merged_into_property_id IS NULL AND status != 'archived' ${propertyWhere} ORDER BY property_name COLLATE NOCASE`;
    const propertyStmt = db.prepare(propertyQuery);
    const weekStart = isoDate(startOfWeek(new Date()));
    const [properties, routineBookings, routineSubmissions, readyMaintenance, readyWorkflow, listingTickets, dailyReport, checks, pricingGaps, pricingNights, opportunities, weeklyScans, leads, directTickets, directTouches, reports] = await Promise.all([
      (profile.role === "client" ? propertyStmt.bind(profile.email.toLowerCase()) : propertyStmt).all<any>(),
      profile.role === "client" ? Promise.resolve({ results: [] }) : db.prepare("SELECT id, property_id, property_name, region, category, scheduled_date, start_time, end_time, assigned_to, notes, status FROM routine_maintenance_bookings ORDER BY scheduled_date, start_time LIMIT 2000").all<any>(),
      profile.role === "client" ? Promise.resolve({ results: [] }) : db.prepare("SELECT id, booking_id, checklist_json, overall_condition, work_completed, issues_found, follow_up_required, follow_up_details, submitted_by_name, submitted_at FROM routine_maintenance_submissions ORDER BY submitted_at DESC LIMIT 2000").all<any>(),
      profile.role === "client" ? Promise.resolve({ results: [] }) : db.prepare("SELECT id, COALESCE(scheduled_date, proposed_repair_date) AS event_date, property_name, summary, status, COALESCE(quote_amount_pence, 0) AS value_pence FROM maintenance_tickets WHERE COALESCE(scheduled_date, proposed_repair_date) IS NOT NULL AND status IN ('ready_to_schedule','scheduled','in_progress','management_review') ORDER BY event_date LIMIT 500").all<any>(),
      profile.role === "client" ? Promise.resolve({ results: [] }) : db.prepare("SELECT id, board, due_date, property_name, title, status FROM workflow_tickets WHERE board IN ('new_property_inspection','routine_bin_garden') AND status != 'complete' ORDER BY due_date LIMIT 500").all<any>(),
      profile.role === "client" ? Promise.resolve({ results: [] }) : db.prepare("SELECT id, kind, property_id, property_name, channel, rating, review_text, response_url, decision_reason, decision, responded, status, created_at FROM listing_health_tickets ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, created_at DESC LIMIT 500").all<any>(),
      profile.role === "client" ? Promise.resolve(null) : db.prepare("SELECT report_date, all_visible, no_negative_reviews, completed_by_name FROM listing_health_daily_reports WHERE report_date = date('now') LIMIT 1").first<any>(),
      profile.role === "client" ? Promise.resolve({ results: [] }) : db.prepare("SELECT COUNT(*) AS count FROM listing_health_checks WHERE check_date = date('now')").first<any>(),
      profile.role === "client" ? Promise.resolve({ results: [] }) : db.prepare("SELECT id, property_id, property_name, gap_start, gap_end, nights, current_price_pence, decision, decision_reason, status FROM pricing_gap_tickets ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, gap_start LIMIT 500").all<any>(),
      profile.role === "client" ? Promise.resolve({ results: [] }) : db.prepare("SELECT id, gap_ticket_id, night_date, current_rate_pence, decided_rate_pence, decision, reason, pricelabs_updated, completed_at FROM pricing_night_decisions ORDER BY night_date LIMIT 1000").all<any>(),
      profile.role === "client" ? Promise.resolve({ results: [] }) : db.prepare("SELECT id, property_id, kind, title, location, start_date, end_date, radius_miles, decision, decision_reason, first_seen_at FROM pricing_opportunities WHERE end_date >= date('now') ORDER BY start_date LIMIT 500").all<any>(),
      profile.role === "client" ? Promise.resolve({ results: [] }) : db.prepare("SELECT property_id FROM property_weekly_pricing_scans WHERE week_start = ?").bind(weekStart).all<any>(),
      profile.role === "client" ? Promise.resolve({ results: [] }) : db.prepare("SELECT id, title, location, start_date, end_date, details, status FROM direct_booking_leads ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'contacted' THEN 1 ELSE 2 END, start_date LIMIT 500").all<any>(),
      profile.role === "client" ? Promise.resolve({ results: [] }) : db.prepare("SELECT id, property_name, booker_name, booker_email, booker_phone, arrival_date, departure_date, nights, original_gross_pence, offered_amount_pence, status, response, invoice_status, ota_cancelled, uploaded_to_hostaway, last_touch_at FROM direct_booking_tickets WHERE arrival_date >= date('now') AND status != 'archived' ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'contacting' THEN 1 WHEN 'verbally_agreed' THEN 2 WHEN 'booking_confirmed' THEN 3 WHEN 'complete' THEN 4 ELSE 5 END, updated_at DESC LIMIT 500").all<any>(),
      profile.role === "client" ? Promise.resolve({ results: [] }) : db.prepare("SELECT id, ticket_id, channel, note, created_by_name, created_at FROM direct_booking_touches ORDER BY created_at DESC LIMIT 1000").all<any>(),
      profile.role === "client"
        ? db.prepare("SELECT id, week_start, property_id, property_name, client_email, revenue_14d_pence, summary, price_changes, calendar_items, created_at, sent_at FROM weekly_performance_reports WHERE lower(client_email) = ? ORDER BY week_start DESC LIMIT 100").bind(profile.email.toLowerCase()).all<any>()
        : db.prepare("SELECT id, week_start, property_id, property_name, client_email, revenue_14d_pence, summary, price_changes, calendar_items, created_at, sent_at FROM weekly_performance_reports ORDER BY week_start DESC LIMIT 250").all<any>(),
    ]);

    const listing = listingTickets.results as any[];
    const ratingCounts = (channel: string) => listing.filter((item) => item.kind === "review" && item.channel.toLowerCase().includes(channel)).reduce<Record<string, number>>((acc, item) => {
      const key = String(item.rating || 0);
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const today = Math.floor(Date.now() / 1000);
    return {
      available: true,
      properties: properties.results.map((row: any) => ({ id: row.id, name: row.property_name, address: row.property_address, region: titleCaseRegion(row.region), status: row.status, clientEmail: row.owner_email })),
      routineMaintenanceBookings: routineBookings.results.map((row: any) => ({ id: row.id, propertyId: row.property_id, propertyName: row.property_name, region: titleCaseRegion(row.region), category: row.category, scheduledDate: row.scheduled_date, startTime: row.start_time, endTime: row.end_time, assignedTo: row.assigned_to, notes: row.notes, status: row.status })),
      routineInspectionSubmissions: routineSubmissions.results.map((row: any) => ({ id: row.id, bookingId: row.booking_id, checklist: parseChecklist(row.checklist_json), overallCondition: row.overall_condition, workCompleted: row.work_completed, issuesFound: row.issues_found, followUpRequired: Boolean(row.follow_up_required), followUpDetails: row.follow_up_details, submittedByName: row.submitted_by_name, submittedAt: row.submitted_at })),
      readyEvents: [
        ...routineBookings.results.filter((row: any) => row.status !== "cancelled").map((row: any) => ({ id: row.id, date: row.scheduled_date, endDate: row.scheduled_date, type: "routine_check" as const, title: routineCategoryLabel(row.category), propertyName: row.property_name, status: row.status, valuePence: 0 })),
        ...readyMaintenance.results.map((row: any) => ({ id: row.id, date: row.event_date, endDate: row.event_date, type: "ready_maintenance" as const, title: row.summary, propertyName: row.property_name, status: row.status, valuePence: row.value_pence })),
        ...readyWorkflow.results.map((row: any) => ({ id: row.id, date: row.due_date || isoDate(new Date()), endDate: row.due_date || isoDate(new Date()), type: row.board === "new_property_inspection" ? "inspection" as const : "routine_maintenance" as const, title: row.title, propertyName: row.property_name, status: row.status, valuePence: 0 })),
      ].sort((a, b) => a.date.localeCompare(b.date)),
      listingTickets: listing.map((row) => ({ id: row.id, kind: row.kind, propertyId: row.property_id, propertyName: row.property_name, channel: row.channel, rating: row.rating, reviewText: row.review_text, responseUrl: row.response_url, decisionReason: row.decision_reason, decision: row.decision, responded: Boolean(row.responded), status: row.status, createdAt: row.created_at })),
      listingDailyReport: dailyReport ? { reportDate: dailyReport.report_date, allVisible: Boolean(dailyReport.all_visible), noNegativeReviews: Boolean(dailyReport.no_negative_reviews), completedByName: dailyReport.completed_by_name } : null,
      listingChecksToday: Number((checks as any)?.count || 0),
      listingReporting: { airbnb: ratingCounts("airbnb"), booking: ratingCounts("booking"), suspensions: listing.filter((item) => item.kind === "suspension").length, relistings: listing.filter((item) => item.decision === "relist").length },
      pricingGaps: pricingGaps.results.map((row: any) => ({ id: row.id, propertyId: row.property_id, propertyName: row.property_name, gapStart: row.gap_start, gapEnd: row.gap_end, nights: row.nights, currentPricePence: row.current_price_pence, decision: row.decision, decisionReason: row.decision_reason, status: row.status, nightDecisions: pricingNights.results.filter((night: any) => night.gap_ticket_id === row.id).map((night: any) => ({ id: night.id, date: night.night_date, currentRatePence: night.current_rate_pence, decidedRatePence: night.decided_rate_pence, decision: night.decision, reason: night.reason, pricelabsUpdated: Boolean(night.pricelabs_updated), completedAt: night.completed_at })) })),
      opportunities: opportunities.results.map((row: any) => ({ id: row.id, propertyId: row.property_id, kind: row.kind, title: row.title, location: row.location, startDate: row.start_date, endDate: row.end_date, radiusMiles: row.radius_miles, decision: row.decision, decisionReason: row.decision_reason, isNew: today - row.first_seen_at < 7 * 86400 })),
      weeklyScanCompletedPropertyIds: weeklyScans.results.map((row: any) => row.property_id),
      directBookingLeads: (leads as any).results.map((row: any) => ({ id: row.id, title: row.title, location: row.location, startDate: row.start_date, endDate: row.end_date, details: row.details, status: row.status })),
      directBookingTickets: directTickets.results.map((row: any) => ({ id: row.id, propertyName: row.property_name, bookerName: row.booker_name, bookerEmail: row.booker_email, bookerPhone: row.booker_phone, arrivalDate: row.arrival_date, departureDate: row.departure_date, nights: row.nights, originalGrossPence: row.original_gross_pence, offeredAmountPence: row.offered_amount_pence, status: row.status, response: row.response, invoiceStatus: row.invoice_status, otaCancelled: Boolean(row.ota_cancelled), uploadedToHostaway: Boolean(row.uploaded_to_hostaway), lastTouchAt: row.last_touch_at })),
      directBookingTouches: directTouches.results.map((row: any) => ({ id: row.id, ticketId: row.ticket_id, channel: row.channel, note: row.note, createdByName: row.created_by_name, createdAt: row.created_at })),
      reports: reports.results.map(mapReport),
      lastSyncedAt: null,
    };
  } catch (error) {
    console.error("Unable to load operations data", error);
    return { available: false, properties: [], routineMaintenanceBookings: [], routineInspectionSubmissions: [], readyEvents: [], listingTickets: [], listingDailyReport: null, listingChecksToday: 0, listingReporting: { airbnb: {}, booking: {}, suspensions: 0, relistings: 0 }, pricingGaps: [], opportunities: [], weeklyScanCompletedPropertyIds: [], directBookingLeads: [], directBookingTickets: [], directBookingTouches: [], reports: [], lastSyncedAt: null };
  }
}

export async function createRoutineMaintenanceBooking(input: { propertyId: string; category: RoutineMaintenanceBooking["category"]; scheduledDate: string; startTime: string; endTime: string; assignedTo: string; notes: string; actorEmail: string; actorName: string }) {
  const db = database();
  const property = await db.prepare("SELECT property_name, region FROM management_properties WHERE id = ? AND merged_into_property_id IS NULL AND status != 'archived' LIMIT 1").bind(input.propertyId).first<any>();
  if (!property) throw new Error("Property not found");
  if (input.endTime && input.startTime && input.endTime <= input.startTime) throw new Error("End time must be after the start time");
  await db.prepare("INSERT INTO routine_maintenance_bookings (id, property_id, property_name, region, category, scheduled_date, start_time, end_time, assigned_to, notes, status, created_by_email, created_by_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'booked', ?, ?, unixepoch(), unixepoch())").bind(crypto.randomUUID(), input.propertyId, property.property_name, titleCaseRegion(property.region), input.category, input.scheduledDate, input.startTime, input.endTime, input.assignedTo.trim(), input.notes.trim(), input.actorEmail, input.actorName).run();
}

export async function updateRoutineMaintenanceBookingStatus(input: { id: string; status: "booked" | "complete" | "cancelled" }) {
  const result = await database().prepare("UPDATE routine_maintenance_bookings SET status = ?, updated_at = unixepoch() WHERE id = ?").bind(input.status, input.id).run();
  if (!result.meta.changes) throw new Error("Routine maintenance booking not found");
}

export async function submitRoutineInspection(input: { bookingId: string; checklist: Record<string, "pass" | "attention" | "na">; overallCondition: "good" | "attention" | "urgent"; workCompleted: string; issuesFound: string; followUpRequired: boolean; followUpDetails: string; actorEmail: string; actorName: string }) {
  const db = database();
  const booking = await db.prepare("SELECT id, status FROM routine_maintenance_bookings WHERE id = ? LIMIT 1").bind(input.bookingId).first<any>();
  if (!booking || booking.status === "cancelled") throw new Error("Scheduled inspection not found");
  if (input.followUpRequired && !input.followUpDetails.trim()) throw new Error("Add the required follow-up details");
  const existing = await db.prepare("SELECT id FROM routine_maintenance_submissions WHERE booking_id = ? LIMIT 1").bind(input.bookingId).first<any>();
  await db.batch([
    db.prepare("INSERT INTO routine_maintenance_submissions (id, booking_id, checklist_json, overall_condition, work_completed, issues_found, follow_up_required, follow_up_details, submitted_by_email, submitted_by_name, submitted_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch()) ON CONFLICT(booking_id) DO UPDATE SET checklist_json = excluded.checklist_json, overall_condition = excluded.overall_condition, work_completed = excluded.work_completed, issues_found = excluded.issues_found, follow_up_required = excluded.follow_up_required, follow_up_details = excluded.follow_up_details, submitted_by_email = excluded.submitted_by_email, submitted_by_name = excluded.submitted_by_name, submitted_at = excluded.submitted_at, updated_at = excluded.updated_at").bind(existing?.id || crypto.randomUUID(), input.bookingId, JSON.stringify(input.checklist), input.overallCondition, input.workCompleted.trim(), input.issuesFound.trim(), input.followUpRequired ? 1 : 0, input.followUpDetails.trim(), input.actorEmail, input.actorName),
    db.prepare("UPDATE routine_maintenance_bookings SET status = 'complete', updated_at = unixepoch() WHERE id = ?").bind(input.bookingId),
  ]);
}

function titleCaseRegion(value: unknown) {
  const region = String(value || "").trim();
  if (!region) return "Region Not Set";
  return region.toLowerCase().replace(/(^|[\s/-])([a-z])/g, (_match, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`);
}

function parseChecklist(value: unknown): Record<string, "pass" | "attention" | "na"> {
  try {
    const parsed = JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function routineCategoryLabel(category: string) {
  if (category === "safety_inspection") return "Safety inspection";
  if (category === "garden") return "Garden maintenance";
  if (category === "bins") return "Bin collection";
  if (category === "general_check") return "General property check";
  return "Other routine maintenance";
}

export async function syncListingHealth() {
  const db = database();
  const [properties, reviews] = await Promise.all([
    listHostawayProperties(),
    listHostawayReviews().catch((error) => { console.error("Hostaway reviews could not be synced", error); return []; }),
  ]);
  const now = Math.floor(Date.now() / 1000);
  const date = isoDate(new Date());
  const statements: any[] = [];
  const savedProperties = await db.prepare("SELECT hostaway_listing_id, hostaway_listing_ids, listing_links FROM management_properties WHERE merged_into_property_id IS NULL AND status = 'live'").all<any>();
  const savedLinks = new Map<string, Array<{ label?: string; url?: string }>>();
  for (const row of savedProperties.results) {
    const ids = Array.from(new Set([row.hostaway_listing_id, ...parseStringArray(row.hostaway_listing_ids)].filter(Boolean)));
    const links = parseObjectArray(row.listing_links);
    for (const id of ids) savedLinks.set(String(id), links);
  }
  for (const property of properties) {
    const links = [...property.listingLinks, ...(savedLinks.get(property.id) || [])];
    const visible = {
      airbnb: links.some((link) => link.label.toLowerCase().includes("airbnb")),
      booking: links.some((link) => link.label.toLowerCase().includes("booking")),
      comfy: links.some((link) => link.label.toLowerCase().includes("comfy")),
    };
    statements.push(db.prepare("INSERT INTO listing_health_checks (id, check_date, property_id, property_name, airbnb_visible, booking_visible, comfy_visible, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(property_id, check_date) DO UPDATE SET property_name = excluded.property_name, airbnb_visible = excluded.airbnb_visible, booking_visible = excluded.booking_visible, comfy_visible = excluded.comfy_visible").bind(crypto.randomUUID(), date, property.id, property.name, Number(visible.airbnb), Number(visible.booking), Number(visible.comfy), now));
    for (const [channel, isVisible] of Object.entries(visible)) {
      if (isVisible) continue;
      const sourceKey = `visibility:${date}:${property.id}:${channel}`;
      statements.push(db.prepare("INSERT INTO listing_health_tickets (id, source_key, kind, property_id, property_name, channel, review_text, created_at) VALUES (?, ?, 'visibility', ?, ?, ?, ?, ?) ON CONFLICT(source_key) DO NOTHING").bind(crypto.randomUUID(), sourceKey, property.id, property.name, channel === "booking" ? "Booking.com" : channel === "comfy" ? "Comfy Workers" : "Airbnb", `${property.name} could not be confirmed as visible on ${channel}. Check the live listing and rectify it.`, now));
    }
    const status = property.status.toLowerCase();
    if (/suspend|inactive|disabled|blocked/.test(status)) {
      for (const channel of ["Airbnb", "Booking.com"] as const) {
        const responseUrl = findChannelLink(links, channel);
        if (!responseUrl) continue;
        const sourceKey = `suspension:${property.id}:${status}:${channel.toLowerCase()}`;
        statements.push(db.prepare("INSERT INTO listing_health_tickets (id, source_key, kind, property_id, property_name, channel, review_text, response_url, created_at) VALUES (?, ?, 'suspension', ?, ?, ?, ?, ?, ?) ON CONFLICT(source_key) DO NOTHING").bind(crypto.randomUUID(), sourceKey, property.id, property.name, channel, `Hostaway reports that this ${channel} listing is ${property.status}. Verify the channel listing and relist if required.`, responseUrl, now));
      }
    }
  }
  const propertyByListing = new Map(properties.map((property) => [property.id, property]));
  for (const review of reviews.filter((item) => item.rating > 0 && /airbnb|booking/i.test(item.channelName))) {
    const property = propertyByListing.get(review.listingId);
    const sourceKey = `review:${review.id}`;
    const responseUrl = review.reviewUrl || findChannelLink([...(property?.listingLinks || []), ...(savedLinks.get(review.listingId) || [])], review.channelName);
    statements.push(db.prepare("INSERT INTO listing_health_tickets (id, source_key, kind, property_id, property_name, channel, rating, review_text, response_url, decision, responded, status, created_at, completed_at) VALUES (?, ?, 'review', ?, ?, ?, ?, ?, ?, 'pending', 0, 'new', ?, NULL) ON CONFLICT(source_key) DO NOTHING").bind(crypto.randomUUID(), sourceKey, review.listingId, property?.name || review.propertyName || "Hostaway listing", review.channelName, Math.round(review.rating), review.text, responseUrl, review.createdAt ? Math.floor(new Date(review.createdAt).getTime() / 1000) || now : now));
  }
  if (statements.length) await db.batch(statements);
  return { propertiesChecked: properties.length, checkedAt: now };
}

export async function syncPricingGaps() {
  const db = database();
  const properties = await listHostawayProperties();
  const now = new Date();
  const start = startOfDay(now);
  const end = addDays(start, 7);
  const createdAt = Math.floor(Date.now() / 1000);
  const activeKeys = new Set<string>();
  for (const property of properties) {
    const [reservations, calendarRates] = await Promise.all([
      listHostawayReservations(property.id),
      listHostawayCalendarRates(property.id, isoDate(start), isoDate(end)).catch(() => []),
    ]);
    const rateByDate = new Map(calendarRates.map((day) => [day.date, day.pricePence]));
    const occupied = new Set<string>();
    for (const reservation of reservations) {
      const arrival = parseDate(reservation.arrivalDate);
      const departure = parseDate(reservation.departureDate);
      if (!arrival || !departure) continue;
      for (let day = new Date(Math.max(arrival.getTime(), start.getTime())); day < departure && day < end; day = addDays(day, 1)) occupied.add(isoDate(day));
    }
    const gaps: string[][] = [];
    let current: string[] = [];
    for (let day = start; day < end; day = addDays(day, 1)) {
      const key = isoDate(day);
      if (!occupied.has(key)) current.push(key);
      else if (current.length) { gaps.push(current); current = []; }
    }
    if (current.length) gaps.push(current);
    for (const gap of gaps.filter((item) => item.length > 2)) {
      const gapEnd = isoDate(addDays(parseDate(gap.at(-1)!)!, 1));
      const sourceKey = `gap:${property.id}:${gap[0]}:${gapEnd}`;
      activeKeys.add(sourceKey);
      await db.prepare("INSERT INTO pricing_gap_tickets (id, source_key, property_id, property_name, gap_start, gap_end, nights, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(source_key) DO UPDATE SET property_name = excluded.property_name, nights = excluded.nights, status = 'open', updated_at = excluded.updated_at").bind(crypto.randomUUID(), sourceKey, property.id, property.name, gap[0], gapEnd, gap.length, createdAt, createdAt).run();
      const savedGap = await db.prepare("SELECT id FROM pricing_gap_tickets WHERE source_key = ? LIMIT 1").bind(sourceKey).first<any>();
      if (savedGap) for (const night of gap) {
        const nightKey = `night:${savedGap.id}:${night}`;
        const currentRate = rateByDate.get(night) || 0;
        await db.prepare("INSERT INTO pricing_night_decisions (id, source_key, gap_ticket_id, night_date, current_rate_pence, decided_rate_pence, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(source_key) DO UPDATE SET current_rate_pence = CASE WHEN pricing_night_decisions.completed_at IS NULL THEN excluded.current_rate_pence ELSE pricing_night_decisions.current_rate_pence END, updated_at = excluded.updated_at").bind(crypto.randomUUID(), nightKey, savedGap.id, night, currentRate, currentRate, createdAt).run();
      }
    }
  }
  const open = await db.prepare("SELECT id, source_key, gap_end FROM pricing_gap_tickets WHERE status = 'open'").all<any>();
  for (const row of open.results) {
    if (!activeKeys.has(row.source_key)) await db.prepare("UPDATE pricing_gap_tickets SET status = CASE WHEN gap_end < date('now') THEN 'lapsed' ELSE 'filled' END, updated_at = ? WHERE id = ?").bind(createdAt, row.id).run();
  }
  return { propertiesChecked: properties.length, gapsOpen: activeKeys.size, checkedAt: createdAt };
}

export async function updateListingTicket(input: { id: string; decision: "okay" | "relist" | "keep"; responded: boolean; reason: string }) {
  const db = database();
  const ticket = await db.prepare("SELECT id, source_key, kind, property_id, property_name, channel, rating, review_text FROM listing_health_tickets WHERE id = ? LIMIT 1").bind(input.id).first<any>();
  if (!ticket) throw new Error("Listing ticket not found");
  if (ticket.kind === "review" && !input.responded) throw new Error("Confirm the review response before completing this ticket");
  if (input.decision === "relist" && !input.reason.trim()) throw new Error("Add why the property needs to be relisted");
  const statements = [db.prepare("UPDATE listing_health_tickets SET decision = ?, decision_reason = ?, responded = ?, status = 'complete', completed_at = unixepoch() WHERE id = ?").bind(input.decision, input.reason.trim(), input.responded ? 1 : 0, input.id)];
  if (input.decision === "relist") statements.push(db.prepare("INSERT INTO listing_health_tickets (id, source_key, kind, property_id, property_name, channel, rating, review_text, decision_reason, status, created_at) VALUES (?, ?, 'relisting', ?, ?, ?, ?, ?, ?, 'new', unixepoch()) ON CONFLICT(source_key) DO NOTHING").bind(crypto.randomUUID(), `relisting:${ticket.source_key}`, ticket.property_id, ticket.property_name, ticket.channel, ticket.rating, ticket.review_text, input.reason.trim()));
  await db.batch(statements);
}

export async function completeRelisting(id: string) {
  await database().prepare("UPDATE listing_health_tickets SET status = 'complete', completed_at = unixepoch() WHERE id = ? AND kind = 'relisting'").bind(id).run();
}

export async function submitListingDailyReport(input: { allVisible: boolean; noNegativeReviews: boolean; actorEmail: string; actorName: string }) {
  if (!input.allVisible || !input.noNegativeReviews) throw new Error("Both daily checks must be confirmed");
  await database().prepare("INSERT INTO listing_health_daily_reports (id, report_date, all_visible, no_negative_reviews, completed_by_email, completed_by_name, created_at) VALUES (?, date('now'), 1, 1, ?, ?, unixepoch()) ON CONFLICT(report_date) DO UPDATE SET all_visible = 1, no_negative_reviews = 1, completed_by_email = excluded.completed_by_email, completed_by_name = excluded.completed_by_name, created_at = excluded.created_at").bind(crypto.randomUUID(), input.actorEmail, input.actorName).run();
}

export async function updatePricingGap(input: { id: string; decision: "hold" | "alter"; reason: string; currentPricePence: number }) {
  if (!input.reason.trim()) throw new Error("Add the reason for the pricing decision");
  await database().prepare("UPDATE pricing_gap_tickets SET decision = ?, decision_reason = ?, current_price_pence = ?, updated_at = unixepoch() WHERE id = ?").bind(input.decision, input.reason.trim(), Math.max(0, input.currentPricePence), input.id).run();
}

export async function updatePricingNight(input: { id: string; decision: "hold" | "change"; reason: string; decidedRatePence: number; pricelabsUpdated: boolean }) {
  if (!input.reason.trim()) throw new Error("Add the reason for this night's decision");
  if (!input.pricelabsUpdated) throw new Error("Confirm the rate has been updated in Pricelabs");
  const db = database();
  const night = await db.prepare("SELECT gap_ticket_id FROM pricing_night_decisions WHERE id = ? LIMIT 1").bind(input.id).first<any>();
  if (!night) throw new Error("Pricing night not found");
  await db.prepare("UPDATE pricing_night_decisions SET decision = ?, reason = ?, decided_rate_pence = ?, pricelabs_updated = 1, completed_at = unixepoch(), updated_at = unixepoch() WHERE id = ?").bind(input.decision, input.reason.trim(), input.decidedRatePence, input.id).run();
  const remaining = await db.prepare("SELECT COUNT(*) AS count FROM pricing_night_decisions WHERE gap_ticket_id = ? AND completed_at IS NULL").bind(night.gap_ticket_id).first<any>();
  if (Number(remaining?.count || 0) === 0) await db.prepare("UPDATE pricing_gap_tickets SET status = 'completed', updated_at = unixepoch() WHERE id = ?").bind(night.gap_ticket_id).run();
}

export async function addPricingOpportunity(input: { propertyId: string; kind: "school_holiday" | "event" | "contractor_work"; title: string; location: string; startDate: string; endDate: string; decision: "hold" | "increase"; reason: string }) {
  const db = database();
  const normalized = `${input.kind}:${normalise(input.title)}:${normalise(input.location)}:${input.startDate}:${input.endDate}`;
  const now = Math.floor(Date.now() / 1000);
  const id = crypto.randomUUID();
  await db.prepare("INSERT INTO pricing_opportunities (id, source_key, property_id, kind, title, location, start_date, end_date, decision, decision_reason, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(source_key) DO UPDATE SET property_id = excluded.property_id, last_seen_at = excluded.last_seen_at, decision = excluded.decision, decision_reason = excluded.decision_reason").bind(id, normalized, input.propertyId, input.kind, input.title.trim(), input.location.trim(), input.startDate, input.endDate, input.decision, input.reason.trim(), now, now).run();
  if (input.kind === "contractor_work") {
    await db.prepare("INSERT INTO direct_booking_leads (id, source_key, title, location, start_date, end_date, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(source_key) DO NOTHING").bind(crypto.randomUUID(), normalized, input.title.trim(), input.location.trim(), input.startDate, input.endDate, input.reason.trim(), now).run();
  }
}

export async function completeWeeklyScan(input: { propertyId: string; actorEmail: string; actorName: string }) {
  const db = database();
  const property = await db.prepare("SELECT property_name FROM management_properties WHERE id = ? AND merged_into_property_id IS NULL LIMIT 1").bind(input.propertyId).first<any>();
  if (!property) throw new Error("Property not found");
  const weekStart = isoDate(startOfWeek(new Date()));
  await db.prepare("INSERT INTO property_weekly_pricing_scans (id, source_key, property_id, property_name, week_start, completed_by_email, completed_by_name, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch()) ON CONFLICT(source_key) DO UPDATE SET completed_by_email = excluded.completed_by_email, completed_by_name = excluded.completed_by_name, completed_at = excluded.completed_at").bind(crypto.randomUUID(), `weekly:${weekStart}:${input.propertyId}`, input.propertyId, property.property_name, weekStart, input.actorEmail, input.actorName).run();
}

export async function syncLongStayBookings() {
  const db = database();
  const properties = await listHostawayProperties();
  const saved = await db.prepare("SELECT id, property_name, hostaway_listing_id, hostaway_listing_ids FROM management_properties WHERE merged_into_property_id IS NULL AND status = 'live'").all<any>();
  const propertyByListing = new Map<string, { id: string; name: string }>();
  for (const row of saved.results) for (const listingId of Array.from(new Set([row.hostaway_listing_id, ...parseStringArray(row.hostaway_listing_ids)].filter(Boolean)))) propertyByListing.set(String(listingId), { id: row.id, name: row.property_name });
  const now = Math.floor(Date.now() / 1000);
  let created = 0;
  for (const property of properties) {
    const reservations = await listHostawayReservations(property.id);
    for (const reservation of reservations) {
      if (/cancel|declin|expired|inquir|enquir|pending|quote/i.test(reservation.status)) continue;
      if (!/confirm|new|modified/i.test(reservation.status)) continue;
      const arrival = parseDate(reservation.arrivalDate);
      const departure = parseDate(reservation.departureDate);
      if (!arrival || !departure) continue;
      if (arrival < startOfDay(new Date())) continue;
      const nights = Math.round((departure.getTime() - arrival.getTime()) / 86400000);
      if (nights <= 7) continue;
      const managed = propertyByListing.get(property.id);
      const result = await db.prepare("INSERT INTO direct_booking_tickets (id, source_key, hostaway_reservation_id, property_id, property_name, booker_name, booker_email, booker_phone, arrival_date, departure_date, nights, original_gross_pence, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(source_key) DO UPDATE SET property_name = excluded.property_name, booker_name = excluded.booker_name, booker_email = excluded.booker_email, booker_phone = excluded.booker_phone, arrival_date = excluded.arrival_date, departure_date = excluded.departure_date, nights = excluded.nights, original_gross_pence = excluded.original_gross_pence, updated_at = excluded.updated_at").bind(crypto.randomUUID(), `reservation:${reservation.id}`, reservation.id, managed?.id || property.id, managed?.name || property.name, reservation.guestName, reservation.guestEmail, reservation.guestPhone, reservation.arrivalDate, reservation.departureDate, nights, reservation.grossRevenuePence, now, now).run();
      if ((result.meta as any)?.changes) created += 1;
    }
  }
  return { propertiesChecked: properties.length, ticketsCreated: created };
}

export async function saveDirectBookingOffer(input: { id: string; offeredAmountPence: number }) {
  if (input.offeredAmountPence <= 0) throw new Error("Enter the amount offered to the booker");
  await database().prepare("UPDATE direct_booking_tickets SET offered_amount_pence = ?, status = CASE WHEN status = 'new' THEN 'contacting' ELSE status END, updated_at = unixepoch() WHERE id = ?").bind(input.offeredAmountPence, input.id).run();
}

export async function addDirectBookingTouch(input: { id: string; channel: "phone" | "email" | "whatsapp"; note: string; actorEmail: string; actorName: string }) {
  const db = database();
  const ticket = await db.prepare("SELECT offered_amount_pence, status FROM direct_booking_tickets WHERE id = ? LIMIT 1").bind(input.id).first<any>();
  if (!ticket) throw new Error("Direct booking ticket not found");
  if (!ticket.offered_amount_pence) throw new Error("Enter the offered amount before contacting the booker");
  if (["archived", "complete"].includes(ticket.status)) throw new Error("This ticket is already closed");
  await db.batch([
    db.prepare("INSERT INTO direct_booking_touches (id, ticket_id, channel, note, created_by_email, created_by_name, created_at) VALUES (?, ?, ?, ?, ?, ?, unixepoch())").bind(crypto.randomUUID(), input.id, input.channel, input.note.trim(), input.actorEmail, input.actorName),
    db.prepare("UPDATE direct_booking_tickets SET status = CASE WHEN status = 'new' THEN 'contacting' ELSE status END, last_touch_at = unixepoch(), updated_at = unixepoch() WHERE id = ?").bind(input.id),
  ]);
}

export async function recordDirectBookingResponse(input: { id: string; response: "accepted" | "rejected" }) {
  const db = database();
  const ticket = await db.prepare("SELECT offered_amount_pence FROM direct_booking_tickets WHERE id = ? LIMIT 1").bind(input.id).first<any>();
  if (!ticket) throw new Error("Direct booking ticket not found");
  if (input.response === "accepted" && !ticket.offered_amount_pence) throw new Error("Enter the agreed amount first");
  await db.prepare("UPDATE direct_booking_tickets SET response = ?, status = ?, invoice_status = ?, updated_at = unixepoch() WHERE id = ?").bind(input.response, input.response === "accepted" ? "verbally_agreed" : "archived", input.response === "accepted" ? "to_send" : "not_created", input.id).run();
}

export async function updateDirectBookingInvoice(input: { id: string; invoiceStatus: "sent" | "settled" }) {
  await database().prepare("UPDATE direct_booking_tickets SET invoice_status = ?, status = CASE WHEN ? = 'settled' THEN 'booking_confirmed' ELSE status END, updated_at = unixepoch() WHERE id = ? AND response = 'accepted'").bind(input.invoiceStatus, input.invoiceStatus, input.id).run();
}

export async function completeDirectBooking(input: { id: string; otaCancelled: boolean; uploadedToHostaway: boolean }) {
  if (!input.otaCancelled || !input.uploadedToHostaway) throw new Error("Confirm both the OTA cancellation and Hostaway upload");
  const ticket = await database().prepare("SELECT invoice_status FROM direct_booking_tickets WHERE id = ? LIMIT 1").bind(input.id).first<any>();
  if (!ticket || ticket.invoice_status !== "settled") throw new Error("Accounts must mark the invoice as settled first");
  await database().prepare("UPDATE direct_booking_tickets SET ota_cancelled = 1, uploaded_to_hostaway = 1, status = 'complete', updated_at = unixepoch() WHERE id = ?").bind(input.id).run();
}

export async function createWeeklyReports() {
  const db = database();
  const properties = await db.prepare("SELECT id, property_name, owner_email, hostaway_listing_id FROM management_properties WHERE merged_into_property_id IS NULL AND status = 'live' ORDER BY property_name").all<any>();
  const weekStart = isoDate(startOfWeek(new Date()));
  const now = Math.floor(Date.now() / 1000);
  let created = 0;
  for (const property of properties.results) {
    let revenue = 0;
    if (property.hostaway_listing_id) {
      try {
        const reservations = await listHostawayReservations(property.hostaway_listing_id);
        const end = addDays(new Date(), 14);
        revenue = reservations.filter((item) => { const arrival = parseDate(item.arrivalDate); return arrival && arrival <= end && parseDate(item.departureDate)! >= new Date(); }).reduce((sum, item) => sum + item.grossRevenuePence, 0);
      } catch { /* retain a report even when Hostaway is temporarily unavailable */ }
    }
    const gaps = await db.prepare("SELECT gap_start, gap_end, decision, decision_reason, status, CASE WHEN status = 'filled' AND decision = 'alter' THEN 1 ELSE 0 END AS booking_after_price_change FROM pricing_gap_tickets WHERE property_id = ? AND updated_at >= ? ORDER BY gap_start").bind(property.hostaway_listing_id || property.id, now - 7 * 86400).all<any>();
    const items = await db.prepare("SELECT kind, title, location, start_date, end_date, first_seen_at FROM pricing_opportunities WHERE property_id = ? AND last_seen_at >= ? ORDER BY start_date").bind(property.id, now - 7 * 86400).all<any>();
    const sourceKey = `report:${weekStart}:${property.id}`;
    const result = await db.prepare("INSERT INTO weekly_performance_reports (id, source_key, week_start, property_id, property_name, client_email, revenue_14d_pence, summary, price_changes, calendar_items, created_at, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(source_key) DO NOTHING").bind(crypto.randomUUID(), sourceKey, weekStart, property.id, property.property_name, property.owner_email, revenue, `14-day revenue and pricing update for ${property.property_name}.`, JSON.stringify(gaps.results), JSON.stringify(items.results.map((item: any) => ({ ...item, isNew: now - item.first_seen_at < 7 * 86400 }))), now, now).run();
    if ((result.meta as any)?.changes) created += 1;
  }
  return { reportsCreated: created, weekStart };
}

function mapReport(row: any): WeeklyReport {
  return { id: row.id, weekStart: row.week_start, propertyId: row.property_id, propertyName: row.property_name, clientEmail: row.client_email, revenue14dPence: row.revenue_14d_pence, summary: row.summary, priceChanges: parseJson(row.price_changes), calendarItems: parseJson(row.calendar_items), createdAt: row.created_at, sentAt: row.sent_at };
}
function parseJson(value: string) { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
function parseStringArray(value: string) { return parseJson(value).filter((item): item is string => typeof item === "string"); }
function parseObjectArray(value: string) { return parseJson(value).filter((item): item is { label?: string; url?: string } => Boolean(item) && typeof item === "object"); }
function findChannelLink(links: Array<{ label?: string; url?: string }>, channel: string) { const needle = /booking/i.test(channel) ? "booking" : /vrbo|homeaway/i.test(channel) ? "vrbo" : /airbnb/i.test(channel) ? "airbnb" : channel.toLowerCase(); return links.find((link) => (link.label || "").toLowerCase().includes(needle))?.url || ""; }
function normalise(value: string) { return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-"); }
function isoDate(date: Date) { return date.toISOString().slice(0, 10); }
function parseDate(value: string) { const date = new Date(`${value.slice(0, 10)}T00:00:00Z`); return Number.isNaN(date.getTime()) ? null : date; }
function startOfDay(date: Date) { return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())); }
function addDays(date: Date, days: number) { const next = new Date(date); next.setUTCDate(next.getUTCDate() + days); return next; }
function startOfWeek(date: Date) { const start = startOfDay(date); const day = start.getUTCDay(); return addDays(start, day === 0 ? -6 : 1 - day); }
