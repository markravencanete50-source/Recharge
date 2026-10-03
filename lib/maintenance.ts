import { env } from "cloudflare:workers";
import type { AccessProfile } from "@/lib/access";
import { checklistForCategory } from "@/lib/maintenance-checklists";
import { reconcileMisimportedMaintenance } from "@/lib/maintenance-import-cleanup";
import {
  MAINTENANCE_CATEGORIES,
  type ApprovalState,
  type EvidenceKind,
  type MaintenanceCategory,
  type MaintenanceData,
  type MaintenancePermissions,
  type MaintenancePropertyOption,
  type MaintenanceStatus,
  type MaintenanceThreshold,
  type MaintenanceTicket,
} from "@/lib/maintenance-types";

export { MAINTENANCE_CATEGORIES } from "@/lib/maintenance-types";
export type {
  EvidenceKind,
  MaintenanceCategory,
  MaintenanceData,
  MaintenancePermissions,
  MaintenancePropertyOption,
  MaintenanceStatus,
  MaintenanceThreshold,
  MaintenanceTicket,
} from "@/lib/maintenance-types";

type TicketRow = {
  id: string;
  reference: string;
  source: "manual" | "guest_communication" | "clean";
  source_thread_id: string | null;
  source_message_id: string | null;
  property_name: string;
  property_address: string;
  client_name: string;
  client_email: string;
  guest_name: string;
  booking_reference: string;
  hostaway_listing_id: string | null;
  hostaway_reservation_id: string | null;
  reservation_arrival_date: string | null;
  reservation_departure_date: string | null;
  reservation_channel: string;
  category: MaintenanceCategory;
  priority: "normal" | "urgent" | "emergency";
  summary: string;
  details: string;
  troubleshooting_completed_items: string;
  troubleshooting_notes: string;
  troubleshooting_outcome: "pending" | "resolved" | "ready_required";
  physical_repair: number;
  status: MaintenanceStatus;
  ready_reference: string | null;
  quote_amount_pence: number | null;
  work_required: string;
  proposed_repair_date: string | null;
  approval_route: "unassessed" | "none" | "management" | "client";
  management_approval: ApprovalState;
  client_approval: ApprovalState;
  scheduled_date: string | null;
  scheduled_start_time: string | null;
  scheduled_end_time: string | null;
  assigned_ready_email: string | null;
  assigned_ready_name: string | null;
  final_approval: ApprovalState;
  accounts_status: "not_created" | "pending" | "paid" | "reconciled";
  payment_reference: string;
  paid_at: number | null;
  paid_by_email: string | null;
  paid_by_name: string | null;
  invoice_reference: string;
  closed_reason: string;
  closed_at: number | null;
  closed_by_email: string | null;
  closed_by_name: string | null;
  raised_by_email: string;
  raised_by_name: string;
  completed_at: number | null;
  management_approved_at: number | null;
  reconciled_at: number | null;
  created_at: number;
  updated_at: number;
};

type UpdateRow = {
  id: string;
  ticket_id: string;
  event_type: string;
  note: string;
  actor_name: string;
  created_at: number;
};

type EvidenceRow = {
  id: string;
  ticket_id: string;
  kind: EvidenceKind;
  object_key: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  uploaded_by_name: string;
  created_at: number;
};

type ThresholdRow = {
  category: MaintenanceCategory;
  management_limit_pence: number;
  client_limit_pence: number;
};

type PropertyOptionRow = {
  id: string;
  property_name: string;
  property_address: string;
  owner_name: string;
  owner_email: string;
  hostaway_listing_id: string | null;
  hostaway_listing_ids: string;
};

export type MaintenanceAction =
  | { action: "refer_to_ready"; id: string }
  | {
      action: "troubleshoot";
      id: string;
      completedItems: string[];
      notes: string;
      outcome: "resolved" | "ready_required";
      closureReason: string;
    }
  | {
      action: "quote";
      id: string;
      amountPence: number;
      workRequired: string;
      proposedRepairDate: string;
    }
  | {
      action: "approval";
      id: string;
      approvalKind: "management" | "client";
      decision: "approved" | "rejected";
      note: string;
    }
  | {
      action: "schedule";
      id: string;
      scheduledDate: string;
      startTime: string;
      endTime: string;
      assignedEmail: string;
      assignedName: string;
    }
  | { action: "start"; id: string }
  | { action: "complete"; id: string; note: string }
  | {
      action: "final_approval";
      id: string;
      decision: "approved" | "rejected";
      note: string;
    }
  | { action: "mark_paid"; id: string; paymentReference: string; note: string }
  | { action: "reconcile"; id: string; invoiceReference: string; note: string }
  | { action: "close"; id: string; note: string }
  | { action: "note"; id: string; note: string };

export function maintenancePermissions(profile: AccessProfile): MaintenancePermissions {
  const admin = profile.role === "admin";
  return {
    stays: admin || profile.modules.includes("stays-maintenance-reporting"),
    ready: admin || profile.modules.includes("maintenance-reporting"),
    approvals: admin,
    accounts: admin || profile.modules.includes("maintenance-reconciliation"),
    thresholds: admin,
    client:
      profile.role === "client" &&
      profile.modules.includes("client-property-maintenance"),
  };
}

export function canUseMaintenance(profile: AccessProfile) {
  const permissions = maintenancePermissions(profile);
  return (
    permissions.stays ||
    permissions.ready ||
    permissions.approvals ||
    permissions.accounts ||
    permissions.thresholds ||
    permissions.client
  );
}

export async function getMaintenanceData(
  profile: AccessProfile,
): Promise<MaintenanceData | undefined> {
  const permissions = maintenancePermissions(profile);
  if (!canUseMaintenance(profile)) return undefined;

  try {
    await reconcileMisimportedMaintenance();
    const db = database();
    const [ticketRows, updateRows, evidenceRows, thresholdRows, propertyRows] = await Promise.all([
      db.prepare(`${TICKET_SELECT} ORDER BY updated_at DESC LIMIT 500`).all<TicketRow>(),
      db
        .prepare(
          "SELECT id, ticket_id, event_type, note, actor_name, created_at FROM maintenance_updates ORDER BY created_at DESC LIMIT 2500",
        )
        .all<UpdateRow>(),
      db
        .prepare(
          "SELECT id, ticket_id, kind, object_key, file_name, content_type, size_bytes, uploaded_by_name, created_at FROM maintenance_evidence ORDER BY created_at DESC LIMIT 1500",
        )
        .all<EvidenceRow>(),
      db
        .prepare(
          "SELECT category, management_limit_pence, client_limit_pence FROM maintenance_thresholds ORDER BY category",
        )
        .all<ThresholdRow>(),
      db
        .prepare(
          "SELECT id, property_name, property_address, owner_name, owner_email, hostaway_listing_id, hostaway_listing_ids FROM management_properties WHERE merged_into_property_id IS NULL AND status != 'archived' ORDER BY property_name COLLATE NOCASE",
        )
        .all<PropertyOptionRow>(),
    ]);

    const visibleRows = ticketRows.results.filter((row) =>
      canSeeTicketRow(profile, permissions, row),
    );
    return {
      available: true,
      permissions,
      tickets: visibleRows.map((row) =>
        mapTicket(row, updateRows.results, evidenceRows.results),
      ),
      thresholds: thresholdsWithDefaults(thresholdRows.results),
      properties: (profile.role === "client" ? propertyRows.results.filter((row) => row.owner_email.toLowerCase() === profile.email.toLowerCase()) : propertyRows.results).map(mapPropertyOption),
    };
  } catch (error) {
    console.error("Unable to load maintenance reporting", error);
    return { available: false, permissions, tickets: [], thresholds: thresholdsWithDefaults([]), properties: [] };
  }
}

export async function createMaintenanceTicketsForProperties(input: {
  selections: Array<{
    propertyId: string;
    hostawayListingId?: string;
    hostawayReservationId?: string;
    guestName?: string;
    bookingReference?: string;
    reservationArrivalDate?: string;
    reservationDepartureDate?: string;
    reservationChannel?: string;
  }>;
  category: MaintenanceCategory;
  priority: "normal" | "urgent" | "emergency";
  summary: string;
  details: string;
  actorEmail: string;
  actorName: string;
}) {
  const db = database();
  const uniqueSelections = [...new Map(input.selections.map((selection) => [selection.propertyId, selection])).values()];
  for (const selection of uniqueSelections) {
    const property = await db.prepare("SELECT id, property_name, property_address, owner_name, owner_email, hostaway_listing_id, hostaway_listing_ids FROM management_properties WHERE id = ? AND merged_into_property_id IS NULL AND status != 'archived' LIMIT 1").bind(selection.propertyId).first<PropertyOptionRow>();
    if (!property) throw new Error("Choose a property from the Management Property Database");
    const option = mapPropertyOption(property);
    const listingId = selection.hostawayListingId && option.hostawayListingIds.includes(selection.hostawayListingId) ? selection.hostawayListingId : option.hostawayListingIds[0] || null;
    await createMaintenanceTicket({
      propertyName: option.propertyAddress || option.propertyName,
      propertyAddress: option.propertyAddress,
      clientName: option.clientName,
      clientEmail: option.clientEmail,
      guestName: selection.guestName || "",
      bookingReference: selection.bookingReference || "",
      hostawayListingId: listingId,
      hostawayReservationId: selection.hostawayReservationId || null,
      reservationArrivalDate: selection.reservationArrivalDate || null,
      reservationDepartureDate: selection.reservationDepartureDate || null,
      reservationChannel: selection.reservationChannel || "",
      category: input.category,
      priority: input.priority,
      summary: input.summary,
      details: input.details,
      actorEmail: input.actorEmail,
      actorName: input.actorName,
    });
  }
}

export async function createMaintenanceTicket(input: {
  source?: "manual" | "guest_communication" | "clean";
  sourceThreadId?: string | null;
  sourceMessageId?: string | null;
  propertyName: string;
  propertyAddress?: string;
  clientName?: string;
  clientEmail?: string;
  guestName?: string;
  bookingReference?: string;
  hostawayListingId?: string | null;
  hostawayReservationId?: string | null;
  reservationArrivalDate?: string | null;
  reservationDepartureDate?: string | null;
  reservationChannel?: string;
  category: MaintenanceCategory;
  priority: "normal" | "urgent" | "emergency";
  summary: string;
  details: string;
  actorEmail: string;
  actorName: string;
}) {
  const db = database();
  if (input.sourceMessageId) {
    const existing = await db
      .prepare("SELECT id FROM maintenance_tickets WHERE source_message_id = ? LIMIT 1")
      .bind(input.sourceMessageId)
      .first<{ id: string }>();
    if (existing) return existing.id;
  }

  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const reference = ticketReference("MNT");
  const message = "Maintenance ticket raised for Stays troubleshooting.";

  await db.batch([
    db
      .prepare(
        "INSERT INTO maintenance_tickets (id, reference, source, source_thread_id, source_message_id, property_name, property_address, client_name, client_email, guest_name, booking_reference, hostaway_listing_id, hostaway_reservation_id, reservation_arrival_date, reservation_departure_date, reservation_channel, category, priority, summary, details, troubleshooting_outcome, physical_repair, status, ready_reference, raised_by_email, raised_by_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        id,
        reference,
        input.source || "manual",
        input.sourceThreadId || null,
        input.sourceMessageId || null,
        input.propertyName.trim(),
        input.propertyAddress?.trim() || "",
        input.clientName?.trim() || "",
        input.clientEmail?.trim().toLowerCase() || "",
        input.guestName?.trim() || "",
        input.bookingReference?.trim() || "",
        input.hostawayListingId?.trim() || null,
        input.hostawayReservationId?.trim() || null,
        input.reservationArrivalDate?.trim() || null,
        input.reservationDepartureDate?.trim() || null,
        input.reservationChannel?.trim() || "",
        input.category,
        input.priority,
        input.summary.trim(),
        input.details.trim(),
        "pending",
        0,
        "new",
        null,
        input.actorEmail.trim().toLowerCase(),
        input.actorName,
        now,
        now,
      ),
    updateStatement(db, id, "ticket_created", message, input.actorEmail, input.actorName, now),
  ]);
  return id;
}

export async function updateMaintenanceTicket(
  profile: AccessProfile,
  input: MaintenanceAction,
) {
  const db = database();
  const ticket = await loadTicket(input.id);
  if (!ticket) throw new Error("Maintenance ticket not found");
  const permissions = maintenancePermissions(profile);
  if (!canSeeTicketRow(profile, permissions, ticket)) throw new Error("Ticket access required");
  const now = Math.floor(Date.now() / 1000);

  if (input.action === "refer_to_ready") {
    requirePermission(permissions.stays, "Stays access required");
    if (ticket.ready_reference || ["reconciled", "closed"].includes(ticket.status)) {
      throw new Error("This ticket cannot be referred to Ready");
    }
    const checklist = checklistForCategory(ticket.category);
    const completed = new Set(parseStringArray(ticket.troubleshooting_completed_items));
    if (checklist.some((item) => !completed.has(item.id))) {
      throw new Error("Complete every troubleshooting step before referring this ticket to Ready");
    }
    const readyReference = ticketReference("RDY");
    await db.batch([
      db.prepare(
        "UPDATE maintenance_tickets SET troubleshooting_outcome = 'ready_required', troubleshooting_notes = CASE WHEN troubleshooting_notes = '' THEN 'Referred directly from Property Maintenance.' ELSE troubleshooting_notes END, physical_repair = 1, ready_reference = ?, status = 'quote_required', updated_at = ? WHERE id = ?",
      ).bind(readyReference, now, ticket.id),
      updateStatement(db, ticket.id, "referred_to_ready", `Referred to Recharge Ready as ${readyReference}.`, profile.email, profile.fullName, now),
    ]);
    return;
  }

  if (input.action === "troubleshoot") {
    requirePermission(permissions.stays, "Stays access required");
    if (ticket.ready_reference || ticket.status !== "new") {
      throw new Error("This ticket has already completed triage");
    }
    const checklist = checklistForCategory(ticket.category);
    const completed = new Set(input.completedItems);
    if (input.outcome === "ready_required" && checklist.some((item) => !completed.has(item.id))) {
      throw new Error("Complete every troubleshooting step before deciding the next action");
    }
    if (input.outcome === "resolved" && completed.size < 1) {
      throw new Error("Record the troubleshooting step that resolved the issue");
    }
    const notes = input.notes.trim();
    if (notes.length < 3) throw new Error("Record what happened during troubleshooting");

    const completedItems = JSON.stringify(
      checklist.filter((item) => completed.has(item.id)).map((item) => item.id),
    );
    if (input.outcome === "ready_required") {
      const readyReference = ticketReference("RDY");
      await db.batch([
        db
          .prepare(
            "UPDATE maintenance_tickets SET troubleshooting_completed_items = ?, troubleshooting_notes = ?, troubleshooting_outcome = 'ready_required', physical_repair = 1, ready_reference = ?, status = 'quote_required', updated_at = ? WHERE id = ?",
          )
          .bind(completedItems, notes, readyReference, now, ticket.id),
        updateStatement(
          db,
          ticket.id,
          "troubleshooting_completed",
          `Troubleshooting completed. The issue remains unresolved and was referred to Recharge Ready as ${readyReference}. ${notes}`,
          profile.email,
          profile.fullName,
          now,
        ),
      ]);
      return;
    }

    const reason = input.closureReason.trim();
    if (reason.length < 3) throw new Error("Add the reason this ticket is being closed");
    await db.batch([
      db
        .prepare(
          "UPDATE maintenance_tickets SET troubleshooting_completed_items = ?, troubleshooting_notes = ?, troubleshooting_outcome = 'resolved', status = 'closed', closed_reason = ?, closed_at = ?, closed_by_email = ?, closed_by_name = ?, updated_at = ? WHERE id = ?",
        )
        .bind(
          completedItems,
          notes,
          reason,
          now,
          profile.email,
          profile.fullName,
          now,
          ticket.id,
        ),
      updateStatement(
        db,
        ticket.id,
        "ticket_closed",
        `Troubleshooting resolved the issue. Closed because: ${reason}`,
        profile.email,
        profile.fullName,
        now,
      ),
    ]);
    return;
  }

  if (input.action === "quote") {
    requirePermission(permissions.ready, "Ready access required");
    if (!ticket.ready_reference || ticket.status !== "quote_required") {
      throw new Error("Complete Stays troubleshooting before adding a Ready quote");
    }
    const threshold = await db
      .prepare(
        "SELECT management_limit_pence, client_limit_pence FROM maintenance_thresholds WHERE category = ? LIMIT 1",
      )
      .bind(ticket.category)
      .first<{ management_limit_pence: number; client_limit_pence: number }>();
    const managementLimit = threshold?.management_limit_pence ?? 0;
    const clientLimit = Math.max(managementLimit, threshold?.client_limit_pence ?? 0);
    const route = !threshold
      ? "client"
      : input.amountPence <= managementLimit
        ? "none"
        : input.amountPence <= clientLimit
          ? "management"
          : "client";
    const status: MaintenanceStatus = route === "none" ? "ready_to_schedule" : "approval_pending";
    const managementApproval: ApprovalState = route === "none" ? "not_required" : "pending";
    const clientApproval: ApprovalState = route === "client" ? "pending" : "not_required";
    await db.batch([
      db
        .prepare(
          "UPDATE maintenance_tickets SET quote_amount_pence = ?, work_required = ?, proposed_repair_date = ?, approval_route = ?, management_approval = ?, client_approval = ?, status = ?, updated_at = ? WHERE id = ?",
        )
        .bind(
          input.amountPence,
          input.workRequired.trim(),
          input.proposedRepairDate,
          route,
          managementApproval,
          clientApproval,
          status,
          now,
          input.id,
        ),
      updateStatement(
        db,
        input.id,
        "quote_added",
        `Ready quoted ${formatMoney(input.amountPence)}. Approval route: ${approvalRouteLabel(route)}.`,
        profile.email,
        profile.fullName,
        now,
      ),
    ]);
    return;
  }

  if (input.action === "approval") {
    const isClient = input.approvalKind === "client";
    if (isClient) {
      const ownsTicket =
        profile.role === "client" &&
        ticket.client_email.toLowerCase() === profile.email.toLowerCase();
      requirePermission(ownsTicket || permissions.approvals, "Client approval access required");
    } else {
      requirePermission(permissions.approvals, "Management approval access required");
    }
    const field = isClient ? "client_approval" : "management_approval";
    const current = isClient ? ticket.client_approval : ticket.management_approval;
    if (current === "not_required") throw new Error("This approval is not required");
    const management = isClient ? ticket.management_approval : input.decision;
    const client = isClient ? input.decision : ticket.client_approval;
    const rejected = input.decision === "rejected";
    const ready = !rejected && approvalsComplete(ticket.approval_route, management, client);
    await db.batch([
      db
        .prepare(
          `UPDATE maintenance_tickets SET ${field} = ?, status = ?, updated_at = ? WHERE id = ?`,
        )
        .bind(input.decision, rejected ? "quote_required" : ready ? "ready_to_schedule" : "approval_pending", now, input.id),
      updateStatement(
        db,
        input.id,
        `${input.approvalKind}_approval`,
        `${isClient ? "Client" : "Management"} ${input.decision} the quote.${input.note ? ` ${input.note.trim()}` : ""}`,
        profile.email,
        profile.fullName,
        now,
      ),
    ]);
    return;
  }

  if (input.action === "schedule") {
    requirePermission(permissions.ready, "Ready access required");
    if (ticket.status !== "ready_to_schedule") throw new Error("Required approvals are not complete");
    await db.batch([
      db
        .prepare(
          "UPDATE maintenance_tickets SET scheduled_date = ?, scheduled_start_time = ?, scheduled_end_time = ?, assigned_ready_email = ?, assigned_ready_name = ?, status = 'scheduled', updated_at = ? WHERE id = ?",
        )
        .bind(
          input.scheduledDate,
          input.startTime,
          input.endTime,
          input.assignedEmail.trim().toLowerCase(),
          input.assignedName.trim(),
          now,
          input.id,
        ),
      updateStatement(
        db,
        input.id,
        "scheduled",
        `Repair scheduled for ${input.scheduledDate}, ${input.startTime}-${input.endTime}, assigned to ${input.assignedName.trim()}.`,
        profile.email,
        profile.fullName,
        now,
      ),
    ]);
    return;
  }

  if (input.action === "start") {
    requirePermission(permissions.ready, "Ready access required");
    if (ticket.status !== "scheduled") throw new Error("Schedule the repair before starting work");
    await setStatusWithUpdate(ticket.id, "in_progress", "work_started", "Ready marked the repair in progress.", profile, now);
    return;
  }

  if (input.action === "complete") {
    requirePermission(permissions.ready, "Ready access required");
    if (!["scheduled", "in_progress"].includes(ticket.status)) throw new Error("The repair is not ready to complete");
    const evidence = await db
      .prepare("SELECT COUNT(*) AS count FROM maintenance_evidence WHERE ticket_id = ? AND kind = 'completion'")
      .bind(ticket.id)
      .first<{ count: number }>();
    if (!evidence?.count) throw new Error("Upload completion evidence before marking the work complete");
    await db.batch([
      db
        .prepare(
          "UPDATE maintenance_tickets SET status = 'management_review', final_approval = 'pending', completed_at = ?, updated_at = ? WHERE id = ?",
        )
        .bind(now, now, ticket.id),
      updateStatement(
        db,
        ticket.id,
        "work_completed",
        `Ready marked the work complete.${input.note ? ` ${input.note.trim()}` : ""}`,
        profile.email,
        profile.fullName,
        now,
      ),
    ]);
    return;
  }

  if (input.action === "final_approval") {
    requirePermission(permissions.approvals, "Management approval access required");
    if (ticket.status !== "management_review") throw new Error("This job is not awaiting final review");
    const approved = input.decision === "approved";
    await db.batch([
      db
        .prepare(
          "UPDATE maintenance_tickets SET final_approval = ?, status = ?, accounts_status = ?, management_approved_at = ?, updated_at = ? WHERE id = ?",
        )
        .bind(
          input.decision,
          approved ? "accounts_pending" : "in_progress",
          approved ? "pending" : "not_created",
          approved ? now : null,
          now,
          ticket.id,
        ),
      updateStatement(
        db,
        ticket.id,
        "final_approval",
        approved
          ? `Management approved the completed work. Accounts reconciliation ticket created.${input.note ? ` ${input.note.trim()}` : ""}`
          : `Management returned the job to Ready.${input.note ? ` ${input.note.trim()}` : ""}`,
        profile.email,
        profile.fullName,
        now,
      ),
    ]);
    return;
  }

  if (input.action === "mark_paid") {
    requirePermission(permissions.accounts, "Accounts access required");
    if (ticket.accounts_status !== "pending") {
      throw new Error("This approved maintenance ticket is not awaiting payment");
    }
    const invoice = await db
      .prepare("SELECT COUNT(*) AS count FROM maintenance_evidence WHERE ticket_id = ? AND kind = 'invoice'")
      .bind(ticket.id)
      .first<{ count: number }>();
    if (!invoice?.count) throw new Error("Upload the supplier invoice before marking this ticket paid");
    const paymentReference = input.paymentReference.trim();
    await db.batch([
      db
        .prepare(
          "UPDATE maintenance_tickets SET accounts_status = 'paid', status = 'accounts_paid', payment_reference = ?, paid_at = ?, paid_by_email = ?, paid_by_name = ?, updated_at = ? WHERE id = ?",
        )
        .bind(
          paymentReference,
          now,
          profile.email,
          profile.fullName,
          now,
          ticket.id,
        ),
      updateStatement(
        db,
        ticket.id,
        "accounts_paid",
        `Accounts marked the repair paid under ${paymentReference}.${input.note ? ` ${input.note.trim()}` : ""}`,
        profile.email,
        profile.fullName,
        now,
      ),
    ]);
    return;
  }

  if (input.action === "reconcile") {
    requirePermission(permissions.accounts, "Accounts access required");
    if (ticket.accounts_status !== "paid") throw new Error("Mark the maintenance payment as paid before reconciling it");
    const invoice = await db
      .prepare("SELECT COUNT(*) AS count FROM maintenance_evidence WHERE ticket_id = ? AND kind = 'invoice'")
      .bind(ticket.id)
      .first<{ count: number }>();
    if (!invoice?.count) throw new Error("Upload the supplier invoice before reconciling this job");
    await db.batch([
      db
        .prepare(
          "UPDATE maintenance_tickets SET accounts_status = 'reconciled', invoice_reference = ?, reconciled_at = ?, status = 'reconciled', closed_reason = ?, closed_at = ?, closed_by_email = ?, closed_by_name = ?, updated_at = ? WHERE id = ?",
        )
        .bind(
          input.invoiceReference.trim(),
          now,
          `Repair completed, approved and matched to invoice ${input.invoiceReference.trim()}.`,
          now,
          profile.email,
          profile.fullName,
          now,
          ticket.id,
        ),
      updateStatement(
        db,
        ticket.id,
        "accounts_reconciled",
        `Accounts matched invoice ${input.invoiceReference.trim()}.${input.note ? ` ${input.note.trim()}` : ""}`,
        profile.email,
        profile.fullName,
        now,
      ),
    ]);
    return;
  }

  if (input.action === "close") {
    requirePermission(permissions.stays || permissions.approvals, "Stays access required");
    if (ticket.physical_repair) throw new Error("Physical repairs must be completed through Ready");
    const reason = input.note.trim();
    if (reason.length < 3) throw new Error("Add the reason this ticket is being closed");
    await db.batch([
      db
        .prepare(
          "UPDATE maintenance_tickets SET status = 'closed', troubleshooting_outcome = CASE WHEN troubleshooting_outcome = 'pending' THEN 'resolved' ELSE troubleshooting_outcome END, closed_reason = ?, closed_at = ?, closed_by_email = ?, closed_by_name = ?, updated_at = ? WHERE id = ?",
        )
        .bind(reason, now, profile.email, profile.fullName, now, ticket.id),
      updateStatement(
        db,
        ticket.id,
        "ticket_closed",
        `Ticket closed because: ${reason}`,
        profile.email,
        profile.fullName,
        now,
      ),
    ]);
    return;
  }

  if (input.action === "note") {
    await db.batch([
      db.prepare("UPDATE maintenance_tickets SET updated_at = ? WHERE id = ?").bind(now, ticket.id),
      db.prepare("INSERT INTO maintenance_updates (id, ticket_id, event_type, note, actor_email, actor_name, created_at) VALUES (?, ?, 'note', ?, ?, ?, ?)").bind(crypto.randomUUID(), ticket.id, input.note.trim(), profile.email, profile.fullName, now),
    ]);
  }
}

function mapPropertyOption(row: PropertyOptionRow): MaintenancePropertyOption {
  const ids = parseStringArray(row.hostaway_listing_ids);
  if (row.hostaway_listing_id && !ids.includes(row.hostaway_listing_id)) ids.unshift(row.hostaway_listing_id);
  return {
    id: row.id,
    propertyName: row.property_name,
    propertyAddress: row.property_address,
    clientName: row.owner_name,
    clientEmail: row.owner_email,
    hostawayListingIds: ids,
  };
}

export async function saveMaintenanceThresholds(
  profile: AccessProfile,
  input: {
    category: MaintenanceCategory;
    managementLimitPence: number;
    clientLimitPence: number;
  },
) {
  if (!maintenancePermissions(profile).thresholds) throw new Error("Admin access required");
  if (input.clientLimitPence < input.managementLimitPence) {
    throw new Error("The client approval limit must be equal to or higher than the management limit");
  }
  await database()
    .prepare(
      "INSERT INTO maintenance_thresholds (category, management_limit_pence, client_limit_pence, updated_by_email, updated_by_name, updated_at) VALUES (?, ?, ?, ?, ?, unixepoch()) ON CONFLICT(category) DO UPDATE SET management_limit_pence = excluded.management_limit_pence, client_limit_pence = excluded.client_limit_pence, updated_by_email = excluded.updated_by_email, updated_by_name = excluded.updated_by_name, updated_at = excluded.updated_at",
    )
    .bind(
      input.category,
      input.managementLimitPence,
      input.clientLimitPence,
      profile.email,
      profile.fullName,
    )
    .run();
}

export async function uploadMaintenanceEvidence(
  profile: AccessProfile,
  input: { ticketId: string; kind: EvidenceKind; file: File },
) {
  const ticket = await loadTicket(input.ticketId);
  if (!ticket) throw new Error("Maintenance ticket not found");
  const permissions = maintenancePermissions(profile);
  if (!canSeeTicketRow(profile, permissions, ticket)) throw new Error("Ticket access required");
  if (input.kind === "completion") requirePermission(permissions.ready, "Ready access required");
  if (input.kind === "invoice") requirePermission(permissions.accounts, "Accounts access required");
  if (profile.role === "client") throw new Error("Team access required");

  const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
  if (!allowed.includes(input.file.type)) throw new Error("Upload a JPG, PNG, WebP or PDF file");
  if (input.file.size < 1 || input.file.size > 10 * 1024 * 1024) {
    throw new Error("Evidence files must be between 1 byte and 10 MB");
  }
  if (!env.BUCKET) throw new Error("Evidence storage is unavailable");

  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const safeName = input.file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(-120) || "evidence";
  const objectKey = `maintenance/${ticket.id}/${id}-${safeName}`;
  await env.BUCKET.put(objectKey, await input.file.arrayBuffer(), {
    httpMetadata: { contentType: input.file.type },
  });
  try {
    const db = database();
    await db.batch([
      db
        .prepare(
          "INSERT INTO maintenance_evidence (id, ticket_id, kind, object_key, file_name, content_type, size_bytes, uploaded_by_email, uploaded_by_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          id,
          ticket.id,
          input.kind,
          objectKey,
          input.file.name,
          input.file.type,
          input.file.size,
          profile.email,
          profile.fullName,
          now,
        ),
      updateStatement(
        db,
        ticket.id,
        "evidence_uploaded",
        `${evidenceLabel(input.kind)} uploaded: ${input.file.name}.`,
        profile.email,
        profile.fullName,
        now,
      ),
    ]);
  } catch (error) {
    await env.BUCKET.delete(objectKey);
    throw error;
  }
  return id;
}

export async function getMaintenanceEvidence(
  profile: AccessProfile,
  evidenceId: string,
) {
  const row = await database()
    .prepare(
      "SELECT id, ticket_id, object_key, file_name, content_type FROM maintenance_evidence WHERE id = ? LIMIT 1",
    )
    .bind(evidenceId)
    .first<{
      id: string;
      ticket_id: string;
      object_key: string;
      file_name: string;
      content_type: string;
    }>();
  if (!row) return null;
  const ticket = await loadTicket(row.ticket_id);
  if (!ticket || !canSeeTicketRow(profile, maintenancePermissions(profile), ticket)) {
    throw new Error("Evidence access required");
  }
  if (!env.BUCKET) throw new Error("Evidence storage is unavailable");
  const object = await env.BUCKET.get(row.object_key);
  if (!object) return null;
  return { row, object };
}

export async function getMaintenanceTicketForProfile(
  profile: AccessProfile,
  id: string,
) {
  const ticket = await loadTicket(id);
  if (!ticket || !canSeeTicketRow(profile, maintenancePermissions(profile), ticket)) return null;
  return mapTicket(ticket, [], []);
}

const TICKET_SELECT =
  "SELECT id, reference, source, source_thread_id, source_message_id, property_name, property_address, client_name, client_email, guest_name, booking_reference, hostaway_listing_id, hostaway_reservation_id, reservation_arrival_date, reservation_departure_date, reservation_channel, category, priority, summary, details, troubleshooting_completed_items, troubleshooting_notes, troubleshooting_outcome, physical_repair, status, ready_reference, quote_amount_pence, work_required, proposed_repair_date, approval_route, management_approval, client_approval, scheduled_date, scheduled_start_time, scheduled_end_time, assigned_ready_email, assigned_ready_name, final_approval, accounts_status, payment_reference, paid_at, paid_by_email, paid_by_name, invoice_reference, closed_reason, closed_at, closed_by_email, closed_by_name, raised_by_email, raised_by_name, completed_at, management_approved_at, reconciled_at, created_at, updated_at FROM maintenance_tickets";

async function loadTicket(id: string) {
  return database()
    .prepare(`${TICKET_SELECT} WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<TicketRow>();
}

function database() {
  if (!env.DB) throw new Error("Recharge maintenance database is unavailable");
  return env.DB;
}

function canSeeTicketRow(
  profile: AccessProfile,
  permissions: MaintenancePermissions,
  ticket: TicketRow,
) {
  if (profile.role === "admin" || permissions.stays) return true;
  if (profile.role === "client") {
    return Boolean(ticket.client_email) && ticket.client_email.toLowerCase() === profile.email.toLowerCase();
  }
  if (permissions.ready && ticket.ready_reference) return true;
  return permissions.accounts && ticket.accounts_status !== "not_created";
}

function mapTicket(
  row: TicketRow,
  updates: UpdateRow[],
  evidence: EvidenceRow[],
): MaintenanceTicket {
  const ticketUpdates = updates.filter((update) => update.ticket_id === row.id);
  return {
    id: row.id,
    reference: row.reference,
    source: row.source,
    propertyName: row.property_name,
    propertyAddress: row.property_address,
    clientName: row.client_name,
    clientEmail: row.client_email,
    guestName: row.guest_name,
    bookingReference: row.booking_reference,
    hostawayListingId: row.hostaway_listing_id,
    hostawayReservationId: row.hostaway_reservation_id,
    reservationArrivalDate: row.reservation_arrival_date,
    reservationDepartureDate: row.reservation_departure_date,
    reservationChannel: row.reservation_channel,
    category: row.category,
    priority: row.priority,
    summary: row.summary,
    details: row.details,
    troubleshootingCompletedItems: parseStringArray(
      row.troubleshooting_completed_items,
    ),
    troubleshootingNotes: row.troubleshooting_notes,
    troubleshootingOutcome: row.troubleshooting_outcome,
    physicalRepair: Boolean(row.physical_repair),
    status: row.status,
    readyReference: row.ready_reference,
    quoteAmountPence: row.quote_amount_pence,
    workRequired: row.work_required,
    proposedRepairDate: row.proposed_repair_date,
    approvalRoute: row.approval_route,
    managementApproval: row.management_approval,
    clientApproval: row.client_approval,
    scheduledDate: row.scheduled_date,
    scheduledStartTime: row.scheduled_start_time,
    scheduledEndTime: row.scheduled_end_time,
    assignedReadyEmail: row.assigned_ready_email,
    assignedReadyName: row.assigned_ready_name,
    finalApproval: row.final_approval,
    accountsStatus: row.accounts_status,
    paymentReference: row.payment_reference,
    paidAt: row.paid_at,
    paidByName: row.paid_by_name,
    invoiceReference: row.invoice_reference,
    closedReason: row.closed_reason,
    closedAt: row.closed_at,
    closedByName: row.closed_by_name,
    raisedByName: row.raised_by_name,
    completedAt: row.completed_at,
    managementApprovedAt: row.management_approved_at,
    reconciledAt: row.reconciled_at,
    createdAt: row.created_at,
    updatedAt: Math.max(row.updated_at, ...ticketUpdates.map((update) => update.created_at)),
    updates: ticketUpdates
      .map((update) => ({
        id: update.id,
        eventType: update.event_type,
        note: update.note,
        actorName: update.actor_name,
        createdAt: update.created_at,
      }))
      .sort((a, b) => b.createdAt - a.createdAt),
    evidence: evidence
      .filter((item) => item.ticket_id === row.id)
      .map((item) => ({
        id: item.id,
        kind: item.kind,
        fileName: item.file_name,
        contentType: item.content_type,
        sizeBytes: item.size_bytes,
        uploadedByName: item.uploaded_by_name,
        createdAt: item.created_at,
      }))
      .sort((a, b) => b.createdAt - a.createdAt),
  };
}

function thresholdsWithDefaults(rows: ThresholdRow[]): MaintenanceThreshold[] {
  const byCategory = new Map(rows.map((row) => [row.category, row]));
  return MAINTENANCE_CATEGORIES.map((category) => {
    const row = byCategory.get(category);
    return {
      category,
      managementLimitPence: row?.management_limit_pence ?? 0,
      clientLimitPence: row?.client_limit_pence ?? 0,
      configured: Boolean(row),
    };
  });
}

function updateStatement(
  db: ReturnType<typeof database>,
  ticketId: string,
  eventType: string,
  note: string,
  actorEmail: string,
  actorName: string,
  now: number,
) {
  return db
    .prepare(
      "INSERT INTO maintenance_updates (id, ticket_id, event_type, note, actor_email, actor_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(crypto.randomUUID(), ticketId, eventType, note, actorEmail, actorName, now);
}

async function setStatusWithUpdate(
  id: string,
  status: MaintenanceStatus,
  eventType: string,
  note: string,
  profile: AccessProfile,
  now: number,
) {
  const db = database();
  await db.batch([
    db.prepare("UPDATE maintenance_tickets SET status = ?, updated_at = ? WHERE id = ?").bind(status, now, id),
    updateStatement(db, id, eventType, note, profile.email, profile.fullName, now),
  ]);
}

function requirePermission(value: boolean, message: string): asserts value {
  if (!value) throw new Error(message);
}

function approvalsComplete(
  route: TicketRow["approval_route"],
  management: ApprovalState,
  client: ApprovalState,
) {
  if (route === "none") return true;
  if (route === "management") return management === "approved";
  if (route === "client") return management === "approved" && client === "approved";
  return false;
}

function ticketReference(prefix: "MNT" | "RDY") {
  const date = new Date().toISOString().slice(2, 10).replaceAll("-", "");
  const suffix = crypto.randomUUID().slice(0, 5).toUpperCase();
  return `${prefix}-${date}-${suffix}`;
}

function formatMoney(pence: number) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(pence / 100);
}

function approvalRouteLabel(route: "none" | "management" | "client") {
  return route === "none"
    ? "no approval required"
    : route === "management"
      ? "management approval"
      : "management and client approval";
}

function evidenceLabel(kind: EvidenceKind) {
  return kind === "completion" ? "Completion evidence" : kind === "invoice" ? "Supplier invoice" : "Issue evidence";
}

function parseStringArray(value: string) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}
