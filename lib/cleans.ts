/* eslint-disable @typescript-eslint/no-explicit-any */
import { env } from "cloudflare:workers";
import type { AccessProfile } from "@/lib/access";
import { createMaintenanceTicket } from "@/lib/maintenance";
import {
  hostawayErrorMessage,
  isHostawayConfigured,
  listHostawayProperties,
  listHostawayReservations,
} from "@/lib/hostaway";
import type {
  CleanFileKind,
  CleansData,
  CleanStatus,
} from "@/lib/cleans-types";

type Db = NonNullable<typeof env.DB>;
type CleanTicketRow = {
  id: string;
  hostaway_reservation_id: string | null;
  hostaway_listing_id: string | null;
  property_id: string | null;
  property_name: string;
  property_address: string;
  guest_name: string;
  guest_count: number;
  booking_reference: string;
  arrival_date: string | null;
  clean_date: string;
  channel_name: string;
  assigned_cleaner_id: string | null;
  assigned_cleaner_name: string;
  status: CleanStatus;
  broadband_working: number | null;
  heating_working: number | null;
  hot_water_working: number | null;
  maintenance_notes: string;
  replenishment_notes: string;
  mail_present: number;
  mail_notes: string;
  guest_confirmation_notes: string;
  complaint_notes: string;
  refund_or_cancellation: number;
  invoice_week: string | null;
  submitted_at: number | null;
  approved_at: number | null;
  unsuccessful_at: number | null;
  invoiced_at: number | null;
};

export type CleanAction =
  | { action: "save_cleaner"; id?: string; fullName: string; email: string; phone: string; notes: string; status: "active" | "inactive" }
  | { action: "save_property"; id?: string; propertyName: string; propertyAddress: string; accessInstructions: string; clientName: string; clientEmail: string; cleanerId: string | null; cleanPricePence: number; status: "active" | "inactive" }
  | { action: "assign_property_cleaner"; propertyId: string; cleanerId: string | null }
  | { action: "assign_cleaner"; id: string; cleanerId: string }
  | { action: "start_clean"; id: string }
  | { action: "submit_clean"; id: string; broadbandWorking: boolean; heatingWorking: boolean; hotWaterWorking: boolean; maintenanceNotes: string; replenishmentNotes: string; mailPresent: boolean; mailNotes: string }
  | { action: "approve_clean"; id: string; guestConfirmationNotes: string }
  | { action: "mark_unsuccessful"; id: string; complaintNotes: string; refundOrCancellation: boolean }
  | { action: "add_to_invoice"; id: string; invoiceWeek: string }
  | { action: "mail_status"; id: string; status: "reviewed" | "archived" }
  | { action: "replenishment_status"; id: string; status: "ordered" | "complete" }
  | { action: "close_review"; id: string }
  | { action: "complete_onboarding"; id: string; cleanerId: string; accessInstructions: string; cleanPricePence: number };

export function canUseCleans(profile: AccessProfile) {
  return (
    profile.role === "admin" ||
    profile.modules.some((id) =>
      [
        "clean-client-database",
        "cleaner-database",
        "cleaning-schedule",
        "cleaner-performance",
        "clean-property-onboarding",
        "cleans-invoices",
        "clean-reporting",
        "client-mailbox",
        "replenishment-requests",
      ].includes(id),
    )
  );
}

export async function getCleansData(profile: AccessProfile): Promise<CleansData | undefined> {
  if (!canUseCleans(profile)) return undefined;
  try {
    const db = database();
    const [properties, cleaners, tickets, files, mail, replenishments, reviews, onboarding] =
      await Promise.all([
        profile.role === "client" ? Promise.resolve({ results: [] as any[] }) : db.prepare("SELECT p.id, p.hostaway_listing_id, p.property_name, p.property_address, p.access_instructions, p.client_name, p.client_email, p.cleaner_id, COALESCE(c.full_name, '') AS cleaner_name, p.clean_price_pence, p.status FROM clean_properties p LEFT JOIN cleaners c ON c.id = p.cleaner_id ORDER BY p.property_name").all<any>(),
        profile.role === "client" ? Promise.resolve({ results: [] as any[] }) : db.prepare("SELECT c.id, c.full_name, c.email, c.phone, c.notes, c.status, COUNT(DISTINCT p.id) AS assigned_properties, SUM(CASE WHEN t.status IN ('approved','invoiced') THEN 1 ELSE 0 END) AS approved_cleans, SUM(CASE WHEN t.status = 'unsuccessful' THEN 1 ELSE 0 END) AS unsuccessful_cleans FROM cleaners c LEFT JOIN clean_properties p ON p.cleaner_id = c.id LEFT JOIN clean_tickets t ON t.assigned_cleaner_id = c.id GROUP BY c.id ORDER BY c.full_name").all<any>(),
        profile.role === "client" ? Promise.resolve({ results: [] as CleanTicketRow[] }) : db.prepare(`${TICKET_SELECT} ORDER BY clean_date DESC, created_at DESC LIMIT 1500`).all<CleanTicketRow>(),
        profile.role === "client" ? Promise.resolve({ results: [] as any[] }) : db.prepare("SELECT id, clean_ticket_id, kind, file_name, content_type, size_bytes, uploaded_by_name, created_at FROM clean_files ORDER BY created_at DESC LIMIT 5000").all<any>(),
        profile.role === "client"
          ? db.prepare("SELECT id, clean_ticket_id, property_name, property_address, client_email, note, photo_file_id, status, created_at FROM client_mail_items WHERE lower(client_email) = lower(?) ORDER BY created_at DESC").bind(profile.email).all<any>()
          : db.prepare("SELECT id, clean_ticket_id, property_name, property_address, client_email, note, photo_file_id, status, created_at FROM client_mail_items ORDER BY created_at DESC LIMIT 1000").all<any>(),
        profile.role === "client"
          ? Promise.resolve({ results: [] as any[] })
          : db.prepare("SELECT id, clean_ticket_id, property_name, items, status, created_at FROM replenishment_requests ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'ordered' THEN 1 ELSE 2 END, created_at DESC").all<any>(),
        profile.role === "client"
          ? Promise.resolve({ results: [] as any[] })
          : db.prepare("SELECT r.id, r.cleaner_id, COALESCE(c.full_name, 'Unknown cleaner') AS cleaner_name, r.success_rate_bps, r.reason, r.status, r.created_at FROM cleaner_reviews r LEFT JOIN cleaners c ON c.id = r.cleaner_id ORDER BY CASE r.status WHEN 'open' THEN 0 ELSE 1 END, r.created_at DESC").all<any>(),
        profile.role === "client"
          ? Promise.resolve({ results: [] as any[] })
          : db.prepare("SELECT id, property_name, property_address, details, status, created_at FROM workflow_tickets WHERE board = 'clean_property_onboarding' ORDER BY CASE status WHEN 'new' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, created_at DESC LIMIT 500").all<any>(),
      ]);

    const visibleTickets = profile.role === "client" ? [] : tickets.results;
    return {
      available: true,
      hostawayConnected: isHostawayConfigured(),
      properties: properties.results.map((row) => ({ id: row.id, hostawayListingId: row.hostaway_listing_id, propertyName: row.property_name, propertyAddress: row.property_address, accessInstructions: row.access_instructions, clientName: row.client_name, clientEmail: row.client_email, cleanerId: row.cleaner_id, cleanerName: row.cleaner_name, cleanPricePence: row.clean_price_pence, status: row.status })),
      cleaners: cleaners.results.map((row) => {
        const approved = Number(row.approved_cleans || 0);
        const unsuccessful = Number(row.unsuccessful_cleans || 0);
        const total = approved + unsuccessful;
        return { id: row.id, fullName: row.full_name, email: row.email, phone: row.phone, notes: row.notes, status: row.status, assignedProperties: Number(row.assigned_properties || 0), approvedCleans: approved, unsuccessfulCleans: unsuccessful, successRate: total ? Math.round((approved / total) * 1000) / 10 : null };
      }),
      tickets: visibleTickets.map((row) => ({
        id: row.id, hostawayReservationId: row.hostaway_reservation_id, hostawayListingId: row.hostaway_listing_id, propertyId: row.property_id, propertyName: row.property_name, propertyAddress: row.property_address, guestName: row.guest_name, guestCount: row.guest_count, bookingReference: row.booking_reference, arrivalDate: row.arrival_date, cleanDate: row.clean_date, channelName: row.channel_name, assignedCleanerId: row.assigned_cleaner_id, assignedCleanerName: row.assigned_cleaner_name, status: row.status, broadbandWorking: boolOrNull(row.broadband_working), heatingWorking: boolOrNull(row.heating_working), hotWaterWorking: boolOrNull(row.hot_water_working), maintenanceNotes: row.maintenance_notes, replenishmentNotes: row.replenishment_notes, mailPresent: Boolean(row.mail_present), mailNotes: row.mail_notes, guestConfirmationNotes: row.guest_confirmation_notes, complaintNotes: row.complaint_notes, refundOrCancellation: Boolean(row.refund_or_cancellation), invoiceWeek: row.invoice_week, submittedAt: row.submitted_at, approvedAt: row.approved_at, unsuccessfulAt: row.unsuccessful_at, invoicedAt: row.invoiced_at,
        files: files.results.filter((file) => file.clean_ticket_id === row.id).map((file) => ({ id: file.id, cleanTicketId: file.clean_ticket_id, kind: file.kind, fileName: file.file_name, contentType: file.content_type, sizeBytes: file.size_bytes, uploadedByName: file.uploaded_by_name, createdAt: file.created_at })),
      })),
      mail: mail.results.map((row) => ({ id: row.id, cleanTicketId: row.clean_ticket_id, propertyName: row.property_name, propertyAddress: row.property_address, clientEmail: row.client_email, note: row.note, photoFileId: row.photo_file_id, status: row.status, createdAt: row.created_at })),
      replenishments: replenishments.results.map((row) => ({ id: row.id, cleanTicketId: row.clean_ticket_id, propertyName: row.property_name, items: row.items, status: row.status, createdAt: row.created_at })),
      reviews: reviews.results.map((row) => ({ id: row.id, cleanerId: row.cleaner_id, cleanerName: row.cleaner_name, successRate: row.success_rate_bps / 100, reason: row.reason, status: row.status, createdAt: row.created_at })),
      onboarding: onboarding.results.map((row) => ({ id: row.id, propertyName: row.property_name, propertyAddress: row.property_address, details: row.details, status: row.status, createdAt: row.created_at })),
    };
  } catch (error) {
    console.error("Unable to load Recharge Cleans", error);
    return { available: false, hostawayConnected: isHostawayConfigured(), properties: [], cleaners: [], tickets: [], mail: [], replenishments: [], reviews: [], onboarding: [] };
  }
}

export async function syncCleansFromHostaway(profile: AccessProfile) {
  requireTeam(profile, "cleaning-schedule");
  const db = database();
  let properties;
  try {
    properties = await listHostawayProperties();
  } catch (error) {
    throw new Error(hostawayErrorMessage(error));
  }
  const now = nowSeconds();
  for (const property of properties) {
    await db.prepare("INSERT INTO clean_properties (id, hostaway_listing_id, property_name, property_address, access_instructions, client_name, client_email, cleaner_id, clean_price_pence, status, last_synced_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 0, 'active', ?, ?, ?) ON CONFLICT(hostaway_listing_id) DO UPDATE SET property_name = excluded.property_name, property_address = CASE WHEN excluded.property_address != '' THEN excluded.property_address ELSE clean_properties.property_address END, access_instructions = CASE WHEN clean_properties.access_instructions = '' THEN excluded.access_instructions ELSE clean_properties.access_instructions END, client_name = CASE WHEN clean_properties.client_name = '' THEN excluded.client_name ELSE clean_properties.client_name END, client_email = CASE WHEN clean_properties.client_email = '' THEN excluded.client_email ELSE clean_properties.client_email END, last_synced_at = excluded.last_synced_at, updated_at = excluded.updated_at")
      .bind(crypto.randomUUID(), property.id, property.name, property.address, [property.accessCode, property.accessInfo].filter(Boolean).join(" — "), property.ownerName, property.ownerEmail, now, now, now).run();
  }

  const stored = await db.prepare("SELECT id, hostaway_listing_id, property_name, property_address, cleaner_id FROM clean_properties WHERE status = 'active' AND hostaway_listing_id IS NOT NULL ORDER BY property_name").all<any>();
  const earliest = dateOffset(-45);
  const latest = dateOffset(365);
  for (let start = 0; start < stored.results.length; start += 4) {
    const chunk = stored.results.slice(start, start + 4);
    await Promise.all(chunk.map(async (property) => {
      const reservations = await listHostawayReservations(property.hostaway_listing_id);
      for (const reservation of reservations) {
        if (!reservation.departureDate || reservation.departureDate < earliest || reservation.departureDate > latest || /cancel/i.test(reservation.status)) continue;
        const cleaner = property.cleaner_id
          ? await db.prepare("SELECT full_name FROM cleaners WHERE id = ? LIMIT 1").bind(property.cleaner_id).first<{ full_name: string }>()
          : null;
        await db.prepare("INSERT INTO clean_tickets (id, hostaway_reservation_id, hostaway_listing_id, property_id, property_name, property_address, guest_name, guest_count, booking_reference, arrival_date, clean_date, channel_name, assigned_cleaner_id, assigned_cleaner_name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?) ON CONFLICT(hostaway_reservation_id) DO UPDATE SET property_id = excluded.property_id, property_name = excluded.property_name, property_address = excluded.property_address, guest_name = excluded.guest_name, guest_count = excluded.guest_count, booking_reference = excluded.booking_reference, arrival_date = excluded.arrival_date, clean_date = excluded.clean_date, channel_name = excluded.channel_name, assigned_cleaner_id = CASE WHEN clean_tickets.status = 'scheduled' THEN excluded.assigned_cleaner_id ELSE clean_tickets.assigned_cleaner_id END, assigned_cleaner_name = CASE WHEN clean_tickets.status = 'scheduled' THEN excluded.assigned_cleaner_name ELSE clean_tickets.assigned_cleaner_name END, updated_at = excluded.updated_at")
          .bind(crypto.randomUUID(), reservation.id, reservation.listingId, property.id, reservation.propertyName || property.property_name, property.property_address, reservation.guestName, reservation.guestCount, reservation.bookingReference, reservation.arrivalDate || null, reservation.departureDate, reservation.channelName, property.cleaner_id, cleaner?.full_name || "", now, now).run();
      }
    }));
  }
}

export async function applyCleanAction(profile: AccessProfile, input: CleanAction) {
  const db = database();
  const now = nowSeconds();
  if (input.action === "save_cleaner") {
    requireTeam(profile, "cleaner-database");
    const id = input.id || crypto.randomUUID();
    await db.prepare("INSERT INTO cleaners (id, full_name, email, phone, notes, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET full_name = excluded.full_name, email = excluded.email, phone = excluded.phone, notes = excluded.notes, status = excluded.status, updated_at = excluded.updated_at")
      .bind(id, input.fullName.trim(), input.email.trim().toLowerCase(), input.phone.trim(), input.notes.trim(), input.status, now, now).run();
    return;
  }
  if (input.action === "save_property") {
    requireTeam(profile, "clean-client-database");
    const cleaner = input.cleanerId ? await cleanerName(db, input.cleanerId) : "";
    const id = input.id || crypto.randomUUID();
    await db.prepare("INSERT INTO clean_properties (id, property_name, property_address, access_instructions, client_name, client_email, cleaner_id, clean_price_pence, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET property_name = excluded.property_name, property_address = excluded.property_address, access_instructions = excluded.access_instructions, client_name = excluded.client_name, client_email = excluded.client_email, cleaner_id = excluded.cleaner_id, clean_price_pence = excluded.clean_price_pence, status = excluded.status, updated_at = excluded.updated_at")
      .bind(id, input.propertyName.trim(), input.propertyAddress.trim(), input.accessInstructions.trim(), input.clientName.trim(), input.clientEmail.trim().toLowerCase(), input.cleanerId, input.cleanPricePence, input.status, now, now).run();
    if (cleaner) await db.prepare("UPDATE clean_tickets SET assigned_cleaner_id = ?, assigned_cleaner_name = ?, updated_at = ? WHERE property_id = ? AND status = 'scheduled'").bind(input.cleanerId, cleaner, now, id).run();
    return;
  }
  if (input.action === "assign_property_cleaner") {
    requireTeam(profile, "cleaner-database");
    const property = await db.prepare("SELECT id FROM clean_properties WHERE id = ? LIMIT 1").bind(input.propertyId).first<{ id: string }>();
    if (!property) throw new Error("Cleaning property not found");
    const cleaner = input.cleanerId ? await cleanerName(db, input.cleanerId) : "";
    if (input.cleanerId && !cleaner) throw new Error("Choose a valid active cleaner");
    await db.batch([
      db.prepare("UPDATE clean_properties SET cleaner_id = ?, updated_at = ? WHERE id = ?").bind(input.cleanerId, now, input.propertyId),
      db.prepare("UPDATE clean_tickets SET assigned_cleaner_id = ?, assigned_cleaner_name = ?, updated_at = ? WHERE property_id = ? AND status = 'scheduled'").bind(input.cleanerId, cleaner, now, input.propertyId),
    ]);
    return;
  }

  if (input.action === "mail_status") {
    if (profile.role !== "client" && profile.role !== "admin") throw new Error("Client Mailbox access required");
    const where = profile.role === "client" ? " AND lower(client_email) = lower(?)" : "";
    const query = db.prepare(`UPDATE client_mail_items SET status = ?, updated_at = ? WHERE id = ?${where}`);
    await (profile.role === "client" ? query.bind(input.status, now, input.id, profile.email) : query.bind(input.status, now, input.id)).run();
    return;
  }
  if (input.action === "replenishment_status") {
    requireTeam(profile, "replenishment-requests");
    await db.prepare("UPDATE replenishment_requests SET status = ?, updated_at = ? WHERE id = ?").bind(input.status, now, input.id).run();
    return;
  }
  if (input.action === "close_review") {
    requireTeam(profile, "cleaner-performance");
    await db.prepare("UPDATE cleaner_reviews SET status = 'closed', closed_at = ? WHERE id = ?").bind(now, input.id).run();
    return;
  }
  if (input.action === "complete_onboarding") {
    requireTeam(profile, "clean-property-onboarding");
    const ticket = await db.prepare("SELECT property_name, property_address FROM workflow_tickets WHERE id = ? AND board = 'clean_property_onboarding' LIMIT 1").bind(input.id).first<any>();
    if (!ticket) throw new Error("Clean onboarding ticket not found");
    const existing = await db.prepare("SELECT id FROM clean_properties WHERE lower(property_name) = lower(?) OR (property_address != '' AND lower(property_address) = lower(?)) LIMIT 1").bind(ticket.property_name, ticket.property_address).first<{ id: string }>();
    const cleaner = await cleanerName(db, input.cleanerId);
    if (!cleaner) throw new Error("Choose a valid cleaner");
    const propertyId = existing?.id || crypto.randomUUID();
    await db.batch([
      db.prepare("INSERT INTO clean_properties (id, property_name, property_address, access_instructions, cleaner_id, clean_price_pence, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?) ON CONFLICT(id) DO UPDATE SET access_instructions = excluded.access_instructions, cleaner_id = excluded.cleaner_id, clean_price_pence = excluded.clean_price_pence, status = 'active', updated_at = excluded.updated_at").bind(propertyId, ticket.property_name, ticket.property_address, input.accessInstructions.trim(), input.cleanerId, input.cleanPricePence, now, now),
      db.prepare("UPDATE workflow_tickets SET status = 'complete', lane = 'cleaner_assigned', updated_at = ? WHERE id = ?").bind(now, input.id),
    ]);
    return;
  }

  const ticket = await loadTicket(db, input.id);
  if (!ticket) throw new Error("Clean ticket not found");
  if (input.action === "assign_cleaner") {
    requireTeam(profile, "cleaning-schedule");
    const name = await cleanerName(db, input.cleanerId);
    if (!name) throw new Error("Choose a valid cleaner");
    await db.prepare("UPDATE clean_tickets SET assigned_cleaner_id = ?, assigned_cleaner_name = ?, updated_at = ? WHERE id = ?").bind(input.cleanerId, name, now, ticket.id).run();
    return;
  }
  if (input.action === "start_clean") {
    requireTeam(profile, "cleaning-schedule");
    if (!ticket.assigned_cleaner_id) throw new Error("Assign a cleaner before starting the clean");
    await db.prepare("UPDATE clean_tickets SET status = 'in_progress', updated_at = ? WHERE id = ? AND status = 'scheduled'").bind(now, ticket.id).run();
    return;
  }
  if (input.action === "submit_clean") {
    requireTeam(profile, "cleaning-schedule");
    if (!ticket.assigned_cleaner_id) throw new Error("Assign a cleaner before submitting the clean");
    const fileRows = await db.prepare("SELECT id, kind FROM clean_files WHERE clean_ticket_id = ?").bind(ticket.id).all<{ id: string; kind: CleanFileKind }>();
    if (!fileRows.results.some((file) => file.kind === "property_video")) throw new Error("Upload the property walkthrough video before submitting");
    if (input.mailPresent && !fileRows.results.some((file) => file.kind === "mail_photo")) throw new Error("Upload a photo of the mail before submitting");
    const property = ticket.property_id ? await db.prepare("SELECT client_name, client_email FROM clean_properties WHERE id = ? LIMIT 1").bind(ticket.property_id).first<any>() : null;
    const maintenanceNeeded = !input.broadbandWorking || !input.heatingWorking || !input.hotWaterWorking || Boolean(input.maintenanceNotes.trim());
    await db.prepare("UPDATE clean_tickets SET status = 'submitted', broadband_working = ?, heating_working = ?, hot_water_working = ?, maintenance_notes = ?, replenishment_notes = ?, mail_present = ?, mail_notes = ?, submitted_at = ?, updated_at = ? WHERE id = ?")
      .bind(input.broadbandWorking ? 1 : 0, input.heatingWorking ? 1 : 0, input.hotWaterWorking ? 1 : 0, input.maintenanceNotes.trim(), input.replenishmentNotes.trim(), input.mailPresent ? 1 : 0, input.mailNotes.trim(), now, now, ticket.id).run();
    if (maintenanceNeeded) {
      const failed = [!input.broadbandWorking && "Broadband", !input.heatingWorking && "Heating", !input.hotWaterWorking && "Hot water"].filter(Boolean).join(", ");
      await createMaintenanceTicket({ source: "clean", sourceMessageId: `clean:${ticket.id}`, propertyName: ticket.property_name, propertyAddress: ticket.property_address, clientName: property?.client_name || "", clientEmail: property?.client_email || "", guestName: ticket.guest_name, bookingReference: ticket.booking_reference, hostawayListingId: ticket.hostaway_listing_id, hostawayReservationId: ticket.hostaway_reservation_id, reservationArrivalDate: ticket.arrival_date, reservationDepartureDate: ticket.clean_date, reservationChannel: ticket.channel_name, category: !input.heatingWorking || !input.hotWaterWorking ? "Heating & hot water" : "General repair", priority: "normal", summary: `Clean issue at ${ticket.property_name}`, details: [failed && `Failed checks: ${failed}.`, input.maintenanceNotes].filter(Boolean).join(" "), actorEmail: profile.email, actorName: profile.fullName });
    }
    if (input.replenishmentNotes.trim()) {
      await db.prepare("INSERT INTO replenishment_requests (id, clean_ticket_id, property_name, items, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'new', ?, ?) ON CONFLICT(clean_ticket_id) DO UPDATE SET items = excluded.items, status = 'new', updated_at = excluded.updated_at").bind(crypto.randomUUID(), ticket.id, ticket.property_name, input.replenishmentNotes.trim(), now, now).run();
    }
    if (input.mailPresent) {
      const photo = fileRows.results.find((file) => file.kind === "mail_photo");
      await db.prepare("INSERT INTO client_mail_items (id, clean_ticket_id, property_name, property_address, client_email, note, photo_file_id, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?, ?) ON CONFLICT(clean_ticket_id) DO UPDATE SET note = excluded.note, photo_file_id = excluded.photo_file_id, client_email = excluded.client_email, status = 'new', updated_at = excluded.updated_at").bind(crypto.randomUUID(), ticket.id, ticket.property_name, ticket.property_address, property?.client_email || "", input.mailNotes.trim(), photo?.id || null, now, now).run();
    }
    return;
  }
  if (input.action === "approve_clean") {
    requireTeam(profile, "clean-reporting");
    if (ticket.status !== "submitted") throw new Error("Only submitted cleans can be approved");
    await db.prepare("UPDATE clean_tickets SET status = 'approved', guest_confirmation_notes = ?, approved_at = ?, updated_at = ? WHERE id = ?").bind(input.guestConfirmationNotes.trim(), now, now, ticket.id).run();
    return;
  }
  if (input.action === "mark_unsuccessful") {
    requireTeam(profile, "clean-reporting");
    if (ticket.status !== "submitted") throw new Error("Only submitted cleans can be marked unsuccessful");
    const evidence = await db.prepare("SELECT id FROM clean_files WHERE clean_ticket_id = ? AND kind = 'guest_evidence' LIMIT 1").bind(ticket.id).first();
    if (!evidence) throw new Error("Upload the guest evidence before marking the clean unsuccessful");
    if (input.complaintNotes.trim().length < 3) throw new Error("Record the complaint and evidence outcome");
    await db.prepare("UPDATE clean_tickets SET status = 'unsuccessful', complaint_notes = ?, refund_or_cancellation = ?, unsuccessful_at = ?, updated_at = ? WHERE id = ?").bind(input.complaintNotes.trim(), input.refundOrCancellation ? 1 : 0, now, now, ticket.id).run();
    if (ticket.assigned_cleaner_id) await ensurePerformanceReview(db, ticket.assigned_cleaner_id, now);
    return;
  }
  if (input.action === "add_to_invoice") {
    requireTeam(profile, "cleans-invoices");
    if (ticket.status !== "approved") throw new Error("Only approved cleans can be added to an invoice");
    await db.prepare("UPDATE clean_tickets SET status = 'invoiced', invoice_week = ?, invoiced_at = ?, updated_at = ? WHERE id = ?").bind(input.invoiceWeek, now, now, ticket.id).run();
  }
}

export async function uploadCleanFile(profile: AccessProfile, input: { ticketId: string; kind: CleanFileKind; file: File }) {
  requireTeam(profile, input.kind === "guest_evidence" ? "clean-reporting" : "cleaning-schedule");
  const ticket = await loadTicket(database(), input.ticketId);
  if (!ticket) throw new Error("Clean ticket not found");
  const allowed = input.kind === "property_video" ? ["video/mp4", "video/quicktime", "video/webm"] : ["image/jpeg", "image/png", "image/webp", "application/pdf"];
  if (!allowed.includes(input.file.type)) throw new Error(input.kind === "property_video" ? "Upload an MP4, MOV or WebM video" : "Upload a JPG, PNG, WebP or PDF");
  if (input.file.size < 1 || input.file.size > 100 * 1024 * 1024) throw new Error("Files must be no larger than 100 MB");
  if (!env.BUCKET) throw new Error("Recharge file storage is unavailable");
  const id = crypto.randomUUID();
  const safeName = input.file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-120) || "evidence";
  const objectKey = `cleans/${ticket.id}/${id}-${safeName}`;
  await env.BUCKET.put(objectKey, await input.file.arrayBuffer(), { httpMetadata: { contentType: input.file.type } });
  try {
    await database().prepare("INSERT INTO clean_files (id, clean_ticket_id, kind, object_key, file_name, content_type, size_bytes, uploaded_by_email, uploaded_by_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, ticket.id, input.kind, objectKey, input.file.name, input.file.type, input.file.size, profile.email, profile.fullName, nowSeconds()).run();
  } catch (error) {
    await env.BUCKET.delete(objectKey);
    throw error;
  }
}

export async function getCleanFile(profile: AccessProfile, id: string) {
  const row = await database().prepare("SELECT id, clean_ticket_id, kind, object_key, file_name, content_type FROM clean_files WHERE id = ? LIMIT 1").bind(id).first<any>();
  if (!row) return null;
  if (profile.role === "client") {
    const allowed = await database().prepare("SELECT id FROM client_mail_items WHERE photo_file_id = ? AND lower(client_email) = lower(?) LIMIT 1").bind(id, profile.email).first();
    if (!allowed) throw new Error("File access required");
  } else if (!canUseCleans(profile)) throw new Error("File access required");
  if (!env.BUCKET) throw new Error("Recharge file storage is unavailable");
  const object = await env.BUCKET.get(row.object_key);
  return object ? { row, object } : null;
}

async function ensurePerformanceReview(db: Db, cleanerId: string, now: number) {
  const stats = await db.prepare("SELECT SUM(CASE WHEN status IN ('approved','invoiced') THEN 1 ELSE 0 END) AS approved, SUM(CASE WHEN status = 'unsuccessful' THEN 1 ELSE 0 END) AS unsuccessful FROM clean_tickets WHERE assigned_cleaner_id = ?").bind(cleanerId).first<any>();
  const approved = Number(stats?.approved || 0);
  const unsuccessful = Number(stats?.unsuccessful || 0);
  const total = approved + unsuccessful;
  if (!total) return;
  const rate = Math.round((approved / total) * 10000);
  if (rate >= 9500) return;
  const open = await db.prepare("SELECT id FROM cleaner_reviews WHERE cleaner_id = ? AND status = 'open' LIMIT 1").bind(cleanerId).first();
  if (!open) await db.prepare("INSERT INTO cleaner_reviews (id, cleaner_id, success_rate_bps, reason, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)").bind(crypto.randomUUID(), cleanerId, rate, `Cleaner success rate is ${(rate / 100).toFixed(1)}%, below the required 95%.`, now).run();
}

const TICKET_SELECT = "SELECT id, hostaway_reservation_id, hostaway_listing_id, property_id, property_name, property_address, guest_name, guest_count, booking_reference, arrival_date, clean_date, channel_name, assigned_cleaner_id, assigned_cleaner_name, status, broadband_working, heating_working, hot_water_working, maintenance_notes, replenishment_notes, mail_present, mail_notes, guest_confirmation_notes, complaint_notes, refund_or_cancellation, invoice_week, submitted_at, approved_at, unsuccessful_at, invoiced_at, created_at FROM clean_tickets";

async function loadTicket(db: Db, id: string) {
  return db.prepare(`${TICKET_SELECT} WHERE id = ? LIMIT 1`).bind(id).first<CleanTicketRow>();
}

async function cleanerName(db: Db, id: string) {
  const cleaner = await db.prepare("SELECT full_name FROM cleaners WHERE id = ? AND status = 'active' LIMIT 1").bind(id).first<{ full_name: string }>();
  return cleaner?.full_name || "";
}

function requireTeam(profile: AccessProfile, moduleId: string) {
  if (profile.role === "client" || (profile.role !== "admin" && !profile.modules.includes(moduleId as any))) throw new Error("This Recharge Cleans tool is not assigned to your account");
}

function database() {
  if (!env.DB) throw new Error("Recharge Cleans database is unavailable");
  return env.DB;
}

function boolOrNull(value: number | null) {
  return value === null ? null : Boolean(value);
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function dateOffset(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
