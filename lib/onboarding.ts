import { env } from "cloudflare:workers";
import type { AccessProfile } from "@/lib/access";
import { reconcileMisimportedMaintenance } from "@/lib/maintenance-import-cleanup";
import type {
  Comparable,
  InvoiceStatus,
  ListingLink,
  OnboardingCase,
  OnboardingData,
  OnboardingFileKind,
  OnboardingStatus,
  RepairPermission,
} from "@/lib/onboarding-types";

type OnboardingRow = {
  id: string;
  reference: string;
  client_email: string;
  client_name: string;
  property_name: string;
  property_address: string;
  property_type: string;
  bedrooms: number;
  bathrooms: number;
  status: OnboardingStatus;
  low_nightly_rate_pence: number | null;
  medium_nightly_rate_pence: number | null;
  high_nightly_rate_pence: number | null;
  comparables: string;
  estimate_comments: string;
  estimate_published_at: number | null;
  estimate_viewed_at: number | null;
  client_decision: "pending" | "proceed" | "reviewing" | "not_proceeding";
  decision_feedback: string;
  review_follow_up_date: string | null;
  agreement_signed_at: number | null;
  agreement_signed_name: string;
  business_name: string;
  bank_account_name: string;
  bank_account_number: string;
  bank_sort_code: string;
  access_date: string | null;
  access_info: string;
  utilities_connected: number;
  utility_install_date: string | null;
  prepayment_meters: number;
  credit_switch_date: string | null;
  broadband_connected: number;
  broadband_install_date: string | null;
  has_garden: number;
  mail_preference: string;
  warranty_details: string;
  repair_permissions: string;
  furnishing_choice: "pending" | "self" | "recharge";
  self_furnish_inspection_date: string | null;
  form_submitted_at: number | null;
  inspection_date: string | null;
  inspection_booked_at: number | null;
  health_safety_percent: number;
  purchase_order_decision: "pending" | "approved" | "rejected";
  purchase_order_rejection_reason: string;
  reports_published_at: number | null;
  onboarding_invoice_status: InvoiceStatus;
  purchase_order_invoice_status: InvoiceStatus;
  supplier_invoice_status: "not_created" | "requested" | "pending" | "settled";
  estimated_guest_ready_date: string | null;
  listing_links: string;
  automated_messages_ready: number;
  social_post_ready: number;
  guidebook_url: string;
  live_at: number | null;
  created_at: number;
  updated_at: number;
};

type FileRow = {
  id: string;
  onboarding_id: string;
  kind: OnboardingFileKind;
  room_label: string;
  object_key: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  uploaded_by_name: string;
  created_at: number;
};

type UpdateRow = {
  id: string;
  onboarding_id: string;
  event_type: string;
  note: string;
  actor_name: string;
  created_at: number;
};

type NotificationRow = {
  id: string;
  onboarding_id: string;
  recipient_email: string;
  kind: string;
  subject: string;
  due_at: number;
  status: string;
};

export function canUseOnboarding(profile: AccessProfile) {
  return (
    profile.role === "admin" ||
    profile.modules.includes("property-onboarding")
  );
}

export async function getOnboardingData(
  profile: AccessProfile,
): Promise<OnboardingData | undefined> {
  if (!canUseOnboarding(profile)) return undefined;
  try {
    const db = database();
    if (profile.role !== "client") { await reconcileMisimportedMaintenance(); await matchImportedClickUpOnboarding(db, profile); }
    const where = profile.role === "client"
      ? " WHERE client_email = ?"
      : " WHERE clickup_task_id IS NULL OR clickup_task_id IN (SELECT clickup_task_id FROM management_properties WHERE merged_into_property_id IS NULL)";
    const query = db.prepare(`${CASE_SELECT}${where} ORDER BY updated_at DESC LIMIT 300`);
    const [caseRows, fileRows, updateRows, notificationRows] = await Promise.all([
      profile.role === "client"
        ? query.bind(profile.email).all<OnboardingRow>()
        : query.all<OnboardingRow>(),
      db
        .prepare(
          "SELECT id, onboarding_id, kind, room_label, object_key, file_name, content_type, size_bytes, uploaded_by_name, created_at FROM onboarding_files ORDER BY created_at DESC LIMIT 3000",
        )
        .all<FileRow>(),
      db
        .prepare(
          "SELECT id, onboarding_id, event_type, note, actor_name, created_at FROM onboarding_updates ORDER BY created_at DESC LIMIT 4000",
        )
        .all<UpdateRow>(),
      db
        .prepare(
          "SELECT id, onboarding_id, recipient_email, kind, subject, due_at, status FROM onboarding_notifications ORDER BY due_at DESC LIMIT 2000",
        )
        .all<NotificationRow>(),
    ]);
    const visibleIds = new Set(caseRows.results.map((row: OnboardingRow) => row.id));
    return {
      available: true,
      mode: profile.role === "client" ? "client" : "staff",
      emailConnected: emailConnected(),
      cases: caseRows.results.map((row: OnboardingRow) =>
        mapCase(
          row,
          fileRows.results.filter((file: FileRow) => visibleIds.has(file.onboarding_id) && file.onboarding_id === row.id),
          updateRows.results.filter((update: UpdateRow) => visibleIds.has(update.onboarding_id) && update.onboarding_id === row.id),
          notificationRows.results.filter(
            (notification: NotificationRow) =>
              visibleIds.has(notification.onboarding_id) && notification.onboarding_id === row.id,
          ),
        ),
      ),
    };
  } catch (error) {
    console.error("Unable to load property onboarding", error);
    return {
      available: false,
      mode: profile.role === "client" ? "client" : "staff",
      emailConnected: emailConnected(),
      cases: [],
    };
  }
}

async function matchImportedClickUpOnboarding(
  db: ReturnType<typeof database>,
  profile: AccessProfile,
) {
  const imported = await db.prepare(
    "SELECT clickup_task_id, property_name, property_address, property_type, bedrooms, bathrooms, owner_name, owner_email, source_status, status, source_created_at, source_updated_at FROM management_properties WHERE clickup_task_id IS NOT NULL AND clickup_task_id != '' AND (merged_into_property_id IS NULL OR merged_into_property_id = '') LIMIT 500",
  ).all<{
    clickup_task_id: string;
    property_name: string;
    property_address: string;
    property_type: string;
    bedrooms: string;
    bathrooms: string;
    owner_name: string;
    owner_email: string;
    source_status: string;
    status: string;
    source_created_at: string;
    source_updated_at: string;
  }>();
  const now = nowSeconds();
  const statements = imported.results.map((property) => db.prepare(
    "INSERT INTO onboarding_cases (id, clickup_task_id, reference, client_email, client_name, property_name, property_address, property_type, bedrooms, bathrooms, status, created_by_email, created_by_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(clickup_task_id) DO NOTHING",
  ).bind(
    `clickup:${property.clickup_task_id}`,
    property.clickup_task_id,
    `CU-${property.clickup_task_id.toUpperCase()}`,
    property.owner_email.trim().toLowerCase(),
    property.owner_name.trim(),
    property.property_name,
    property.property_address,
    property.property_type || "Not recorded",
    positiveInteger(property.bedrooms),
    positiveInteger(property.bathrooms),
    importedOnboardingStatus(property.status, property.source_status),
    profile.email,
    profile.fullName,
    sourceTimestamp(property.source_created_at) || now,
    sourceTimestamp(property.source_updated_at) || now,
  ));
  for (let index = 0; index < statements.length; index += 20) {
    await db.batch(statements.slice(index, index + 20));
  }
}

function positiveInteger(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function sourceTimestamp(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed / 1000) : 0;
}

function importedOnboardingStatus(propertyStatus: string, clickUpStatus: string): OnboardingStatus {
  if (propertyStatus === "live" || propertyStatus === "active") return "live";
  if (propertyStatus === "archived" || propertyStatus === "inactive") return "not_proceeding";
  const status = clickUpStatus.toLowerCase();
  if (/listing/.test(status)) return "listings_in_progress";
  if (/guest.?ready/.test(status)) return "guest_ready";
  if (/furnish/.test(status)) return "furnishing";
  if (/invoice|account/.test(status)) return "invoices_pending";
  if (/purchase|order/.test(status)) return "purchase_order_review";
  if (/inspection/.test(status)) return "inspection_to_book";
  if (/onboard/.test(status)) return "onboarding_form";
  if (/sign|agreement|contract/.test(status)) return "agreement_pending";
  if (/review|estimate/.test(status)) return "reviewing";
  return "enquiry_received";
}

export async function createOnboardingEnquiry(
  profile: AccessProfile,
  input: {
    clientName?: string;
    clientEmail?: string;
    propertyAddress: string;
    propertyType: string;
    bedrooms: number;
    bathrooms: number;
  },
) {
  if (!canUseOnboarding(profile)) throw new Error("Property onboarding access required");
  const clientEmail =
    profile.role === "client"
      ? profile.email
      : (input.clientEmail || profile.email).trim().toLowerCase();
  const clientName =
    profile.role === "client"
      ? profile.fullName
      : (input.clientName || profile.fullName).trim();
  const id = crypto.randomUUID();
  const now = nowSeconds();
  const reference = onboardingReference();
  const propertyName = shortPropertyName(input.propertyAddress);
  const db = database();
  await db.batch([
    db
      .prepare(
        "INSERT INTO onboarding_cases (id, reference, client_email, client_name, property_name, property_address, property_type, bedrooms, bathrooms, status, created_by_email, created_by_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'enquiry_received', ?, ?, ?, ?)",
      )
      .bind(
        id,
        reference,
        clientEmail,
        clientName,
        propertyName,
        input.propertyAddress.trim(),
        input.propertyType.trim(),
        input.bedrooms,
        input.bathrooms,
        profile.email,
        profile.fullName,
        now,
        now,
      ),
    db
      .prepare(
        "INSERT INTO management_properties (id, hostaway_listing_id, property_name, property_address, owner_name, owner_email, owner_phone, access_code, access_info, guidebook_url, listing_links, payout_schedule, management_fee_bps, payout_notes, status, last_synced_at, updated_by_email, updated_by_name, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, ?, '', '', '', '', '[]', 'Between the 5th and 10th of the following month', 1500, '', 'new_enquiry', NULL, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET property_name = excluded.property_name, property_address = excluded.property_address, owner_name = excluded.owner_name, owner_email = excluded.owner_email, status = 'new_enquiry', updated_at = excluded.updated_at",
      )
      .bind(
        `onboarding:${id}`,
        propertyName,
        input.propertyAddress.trim(),
        clientName,
        clientEmail,
        profile.email,
        profile.fullName,
        now,
        now,
      ),
    updateStatement(db, id, "enquiry_received", "New performance estimate requested.", profile, now),
  ]);
  return id;
}

export type OnboardingAction =
  | {
      action: "publish_estimate";
      id: string;
      lowRatePence: number;
      mediumRatePence: number;
      highRatePence: number;
      comparables: Comparable[];
      comments: string;
    }
  | { action: "mark_estimate_viewed"; id: string }
  | {
      action: "client_decision";
      id: string;
      decision: "proceed" | "reviewing" | "not_proceeding";
      feedback: string;
      reviewFollowUpDate: string | null;
    }
  | { action: "staff_update"; id: string; note: string; nextFollowUpDate: string | null; resolution: "response" | "continue" | "archive" }
  | { action: "sign_agreement"; id: string; signedName: string; responsiblePartyName: string }
  | { action: "post_chat_message"; id: string; message: string }
  | {
      action: "submit_onboarding_form";
      id: string;
      businessName: string;
      bankAccountName: string;
      bankAccountNumber: string;
      bankSortCode: string;
      accessDate: string;
      accessInfo: string;
      utilitiesConnected: boolean;
      utilityInstallDate: string | null;
      prepaymentMeters: boolean;
      creditSwitchDate: string | null;
      broadbandConnected: boolean;
      broadbandInstallDate: string | null;
      hasGarden: boolean;
      mailPreference: string;
      warrantyDetails: string;
      repairPermissions: RepairPermission[];
      furnishingChoice: "self" | "recharge";
      inspectionDate: string | null;
      broadbandSetupByRecharge: boolean;
      broadbandCreditDetails: string;
      prepaymentSwitchByRecharge: boolean;
      licensingRequired: boolean;
    }
  | { action: "book_inspection"; id: string; inspectionDate: string }
  | { action: "set_self_inspection_date"; id: string; inspectionDate: string }
  | { action: "publish_reports"; id: string; healthSafetyPercent: number }
  | {
      action: "purchase_order_decision";
      id: string;
      decision: "approved" | "rejected";
      reason: string;
    }
  | { action: "quote_decision"; id: string; decision: "accept" | "consider" | "contest" | "reject"; reason: string; followUpDate: string | null }
  | {
      action: "invoice_status";
      id: string;
      invoice: "onboarding" | "purchase_order" | "supplier";
      status: "pending" | "settled";
    }
  | { action: "set_guest_ready_date"; id: string; date: string }
  | { action: "confirm_guest_ready"; id: string }
  | {
      action: "publish_live";
      id: string;
      listingLinks: ListingLink[];
      automatedMessagesReady: boolean;
      socialPostReady: boolean;
      guidebookUrl: string;
    };

export async function applyOnboardingAction(
  profile: AccessProfile,
  action: OnboardingAction,
) {
  if (!canUseOnboarding(profile)) throw new Error("Property onboarding access required");
  const row = await requireVisibleCase(profile, action.id);
  const db = database();
  const now = nowSeconds();

  if (action.action === "publish_estimate") {
    requireStaff(profile);
    if (!(action.lowRatePence <= action.mediumRatePence && action.mediumRatePence <= action.highRatePence)) {
      throw new Error("Enter low, medium and high rates in ascending order");
    }
    if (!env.BUCKET) throw new Error("Recharge document storage is unavailable");
    const estimateId = crypto.randomUUID();
    const estimateName = `Performance Estimate - ${safeFileName(row.property_name || shortPropertyName(row.property_address))}.html`;
    const estimateObjectKey = `onboarding/${row.id}/${estimateId}-${estimateName}`;
    const estimateBody = performanceEstimateHtml(row, action, now);
    await env.BUCKET.put(estimateObjectKey, estimateBody, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
    await db.batch([
      db
        .prepare(
          "UPDATE onboarding_cases SET low_nightly_rate_pence = ?, medium_nightly_rate_pence = ?, high_nightly_rate_pence = ?, comparables = ?, estimate_comments = ?, estimate_published_at = ?, estimate_viewed_at = NULL, client_decision = 'pending', status = 'estimate_received', updated_at = ? WHERE id = ?",
        )
        .bind(
          action.lowRatePence,
          action.mediumRatePence,
          action.highRatePence,
          JSON.stringify(action.comparables),
          action.comments.trim(),
          now,
          now,
          row.id,
        ),
      updateStatement(db, row.id, "estimate_published", "Performance estimate published to the client.", profile, now),
      notificationStatement(db, row, "estimate_ready", "Your Recharge performance estimate is ready", "Your estimate is ready. Sign in to your Recharge Dashboard to review it.", now),
      notificationStatement(db, row, "estimate_follow_up", "Following up on your Recharge performance estimate", "We sent your performance estimate yesterday and wanted to check whether you have any questions or would like to proceed.", now + 86_400),
      db.prepare("INSERT INTO onboarding_files (id, onboarding_id, kind, room_label, object_key, file_name, content_type, size_bytes, uploaded_by_email, uploaded_by_name, created_at) VALUES (?, ?, 'performance_estimate', '', ?, ?, 'text/html; charset=utf-8', ?, ?, ?, ?)").bind(estimateId, row.id, estimateObjectKey, estimateName, new TextEncoder().encode(estimateBody).byteLength, profile.email, profile.fullName, now),
    ]);
    return;
  }

  if (action.action === "mark_estimate_viewed") {
    requireClient(profile, row);
    await db.batch([
      db
        .prepare(
          "UPDATE onboarding_cases SET estimate_viewed_at = COALESCE(estimate_viewed_at, ?), updated_at = ? WHERE id = ?",
        )
        .bind(now, now, row.id),
      db
        .prepare(
          "UPDATE onboarding_notifications SET status = 'cancelled' WHERE onboarding_id = ? AND kind = 'estimate_reminder' AND status = 'queued'",
        )
        .bind(row.id),
    ]);
    return;
  }

  if (action.action === "client_decision") {
    requireClient(profile, row);
    const status: OnboardingStatus =
      action.decision === "proceed"
        ? "agreement_pending"
        : action.decision === "reviewing"
          ? "reviewing"
          : "not_proceeding";
    if (action.decision === "reviewing" && !action.reviewFollowUpDate) {
      throw new Error("Choose when you would like us to check in again");
    }
    await db.batch([
      db
        .prepare(
          "UPDATE onboarding_cases SET client_decision = ?, decision_feedback = ?, review_follow_up_date = ?, status = ?, updated_at = ? WHERE id = ?",
        )
        .bind(
          action.decision,
          action.feedback.trim(),
          action.reviewFollowUpDate,
          status,
          now,
          row.id,
        ),
      updateStatement(
        db,
        row.id,
        "client_decision",
        action.decision === "proceed"
          ? "Client is ready to proceed with onboarding."
          : action.decision === "reviewing"
            ? `Client is reviewing and requested a follow-up on ${action.reviewFollowUpDate}.`
            : `Client is not proceeding${action.feedback ? `: ${action.feedback}` : "."}`,
        profile,
        now,
      ),
      ...(action.decision === "reviewing" && action.reviewFollowUpDate
        ? [
            notificationStatement(
              db,
              row,
              "review_follow_up",
              "Checking in on your Recharge estimate",
              "You asked us to check in while you reviewed your performance estimate. You can proceed at any time from your Recharge Dashboard.",
              dateToTimestamp(action.reviewFollowUpDate),
            ),
          ]
        : []),
      db
        .prepare(
          "UPDATE onboarding_notifications SET status = 'cancelled' WHERE onboarding_id = ? AND kind = 'estimate_follow_up' AND status = 'queued'",
        )
        .bind(row.id),
    ]);
    return;
  }

  if (action.action === "staff_update") {
    requireStaff(profile);
    const status = action.resolution === "continue" ? "reviewing" : action.resolution === "archive" ? "not_proceeding" : row.status;
    await db.batch([
      db.prepare("UPDATE onboarding_cases SET review_follow_up_date = COALESCE(?, review_follow_up_date), status = ?, updated_at = ? WHERE id = ?").bind(action.nextFollowUpDate, status, now, row.id),
      updateStatement(db, row.id, "stays_response", action.note.trim(), profile, now),
      notificationStatement(db, row, "stays_response", "Recharge replied to your onboarding", action.note.trim(), now),
      ...(action.nextFollowUpDate ? [notificationStatement(db, row, "review_follow_up", "Onboarding follow-up due", `Recharge will follow up with you on ${action.nextFollowUpDate}.`, dateToTimestamp(action.nextFollowUpDate))] : []),
    ]);
    return;
  }

  if (action.action === "post_chat_message") {
    if (profile.role === "client") requireClient(profile, row);
    else requireStaff(profile);
    const subject = profile.role === "client" ? "New client message" : "Recharge replied to your property chat";
    await db.batch([
      updateStatement(db, row.id, "property_chat", action.message.trim(), profile, now),
      ...(profile.role === "client" ? [] : [notificationStatement(db, row, "property_chat", subject, action.message.trim(), now)]),
      db.prepare("UPDATE onboarding_cases SET updated_at = ? WHERE id = ?").bind(now, row.id),
    ]);
    return;
  }

  if (action.action === "sign_agreement") {
    requireClient(profile, row);
    if (!env.BUCKET) throw new Error("Recharge document storage is unavailable");
    const agreementId = crypto.randomUUID();
    const agreementName = `Signed Management Agreement - ${safeFileName(row.property_name || shortPropertyName(row.property_address))}.html`;
    const agreementObjectKey = `onboarding/${row.id}/${agreementId}-${agreementName}`;
    const agreementBody = managementAgreementHtml(row, action.signedName.trim(), action.responsiblePartyName.trim(), now);
    await env.BUCKET.put(agreementObjectKey, agreementBody, { httpMetadata: { contentType: "text/html; charset=utf-8" } });
    await db.batch([
      db
        .prepare(
          "UPDATE onboarding_cases SET agreement_signed_at = ?, agreement_signed_name = ?, business_name = ?, onboarding_invoice_status = 'pending', status = 'onboarding_form', updated_at = ? WHERE id = ?",
        )
        .bind(now, action.signedName.trim(), action.responsiblePartyName.trim(), now, row.id),
      db
        .prepare(
          "INSERT INTO management_properties (id, hostaway_listing_id, property_name, owner_name, owner_email, owner_phone, access_code, access_info, guidebook_url, listing_links, payout_schedule, management_fee_bps, payout_notes, status, last_synced_at, updated_by_email, updated_by_name, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, '', '', '', '', '[]', 'Between the 5th and 10th of the following month', 1500, ?, 'onboarding', NULL, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET owner_name = excluded.owner_name, owner_email = excluded.owner_email, status = 'onboarding', management_fee_bps = 1500, payout_schedule = excluded.payout_schedule, payout_notes = excluded.payout_notes, updated_by_email = excluded.updated_by_email, updated_by_name = excluded.updated_by_name, updated_at = excluded.updated_at",
        )
        .bind(
          `onboarding:${row.id}`,
          row.property_name || shortPropertyName(row.property_address),
          action.responsiblePartyName.trim(),
          row.client_email,
          `Contracting party: ${action.responsiblePartyName.trim()}. Management agreement signed by ${action.signedName.trim()} on ${new Date(now * 1000).toISOString().slice(0, 10)}.`,
          profile.email,
          profile.fullName,
          now,
          now,
        ),
      updateStatement(db, row.id, "agreement_signed", `Management agreement signed by ${action.signedName.trim()}.`, profile, now),
      db.prepare("INSERT INTO onboarding_files (id, onboarding_id, kind, room_label, object_key, file_name, content_type, size_bytes, uploaded_by_email, uploaded_by_name, created_at) VALUES (?, ?, 'management_agreement', '', ?, ?, 'text/html; charset=utf-8', ?, ?, ?, ?)").bind(agreementId, row.id, agreementObjectKey, agreementName, new TextEncoder().encode(agreementBody).byteLength, profile.email, "Alexander Coghill & client", now),
      workflowTicketStatement(db, row, {
        board: "onboarding_invoices",
        lane: "new_invoice",
        sourceBusiness: "Clients",
        targetBusiness: "Accounts",
        title: "Issue £475 onboarding invoice (VAT included)",
        details: `Management agreement signed. Issue the £475 onboarding invoice for ${row.client_name}.`,
        dueDate: null,
        profile,
        now,
      }),
      notificationStatement(db, row, "onboarding_form_reminder", "Please complete your onboarding form", "Your management agreement is signed. Complete the onboarding form so the property can move to inspection.", now + 86_400),
    ]);
    return;
  }

  if (action.action === "submit_onboarding_form") {
    requireClient(profile, row);
    const inspectionDate = action.furnishingChoice === "self" ? action.inspectionDate : action.accessDate;
    const statements = [
      db
        .prepare(
          "UPDATE onboarding_cases SET business_name = ?, bank_account_name = ?, bank_account_number = ?, bank_sort_code = ?, access_date = ?, access_info = ?, utilities_connected = ?, utility_install_date = ?, prepayment_meters = ?, credit_switch_date = ?, broadband_connected = ?, broadband_install_date = ?, has_garden = ?, mail_preference = ?, warranty_details = ?, repair_permissions = ?, furnishing_choice = ?, self_furnish_inspection_date = ?, form_submitted_at = ?, onboarding_invoice_status = 'pending', status = 'inspection_to_book', updated_at = ? WHERE id = ?",
        )
        .bind(
          action.businessName.trim(),
          action.bankAccountName.trim(),
          action.bankAccountNumber.trim(),
          action.bankSortCode.trim(),
          action.accessDate,
          action.accessInfo.trim(),
          action.utilitiesConnected ? 1 : 0,
          action.utilityInstallDate,
          action.prepaymentMeters ? 1 : 0,
          action.creditSwitchDate,
          action.broadbandConnected ? 1 : 0,
          action.broadbandInstallDate,
          action.hasGarden ? 1 : 0,
          action.mailPreference.trim(),
          action.warrantyDetails.trim(),
          JSON.stringify(action.repairPermissions),
          action.furnishingChoice,
          action.furnishingChoice === "self" ? inspectionDate : null,
          now,
          now,
          row.id,
        ),
      updateStatement(db, row.id, "onboarding_form_submitted", "Property onboarding form submitted.", profile, now),
      db
        .prepare(
          "UPDATE management_properties SET owner_company = ?, access_info = ?, payout_notes = ?, additional_notes = ?, status = 'onboarding', updated_by_email = ?, updated_by_name = ?, updated_at = ? WHERE id = ?",
        )
        .bind(
          action.businessName.trim(),
          action.accessInfo.trim(),
          `Payout account: ${action.bankAccountName.trim()}, sort code ${action.bankSortCode.trim()}, account ending ${action.bankAccountNumber.trim().slice(-4)}.`,
          `Maintenance preferences and warranties:\n${action.warrantyDetails.trim() || "No warranties supplied."}\n\nRepair authorisation:\n${action.repairPermissions.map((permission) => `${permission.category}: ${permission.fullPermission ? "full permission" : `up to £${(permission.amountPence / 100).toFixed(2)}`}`).join("\n")}\n\nMail preference: ${action.mailPreference.trim()}`,
          profile.email,
          profile.fullName,
          now,
          `onboarding:${row.id}`,
        ),
      workflowTicketStatement(db, row, {
        board: "clean_property_onboarding",
        lane: "new_enquiry",
        sourceBusiness: "Stays",
        targetBusiness: "Cleans",
        title: "Assign a cleaner to the new property",
        details: "New property onboarding submitted. A primary cleaner must be assigned before launch.",
        dueDate: inspectionDate,
        profile,
        now,
      }),
    ];
    if (inspectionDate) {
      statements.push(workflowTicketStatement(db, row, { board: "new_property_inspection", lane: "new_enquiry", sourceBusiness: "Stays", targetBusiness: "Ready", title: "Book guest-readiness inspection", details: `Access information: ${action.accessInfo.trim()}. Complete guest safety, amenities, Wi-Fi, meter and guest-guide video checks. Maintenance preferences: ${action.warrantyDetails.trim() || "None supplied"}. Repair permissions: ${JSON.stringify(action.repairPermissions)}.`, dueDate: inspectionDate, profile, now }));
    }
    if (action.furnishingChoice === "recharge") {
      statements.push(
        workflowTicketStatement(db, row, {
          board: "property_furnishing",
          lane: "new",
          sourceBusiness: "Stays",
          targetBusiness: "Ready",
          title: "Prepare Recharge furnishing quote",
          details: "The client selected Recharge furnishing. Inspect, prepare the itemised purchase order and propose a delivery plan.",
          dueDate: inspectionDate,
          profile,
          now,
        }),
      );
    }
    if (action.licensingRequired) {
      statements.push(workflowTicketStatement(db, row, { board: "licensing_onboarding", lane: "new_enquiry", sourceBusiness: "Clients", targetBusiness: "Stays", title: "New licensing and compliance enquiry", details: `Licensing support requested for ${row.property_address}.`, dueDate: action.accessDate, profile, now }));
    }
    if (!action.broadbandConnected && action.broadbandSetupByRecharge) {
      statements.push(workflowTicketStatement(db, row, { board: "broadband_setup", lane: "new_request", sourceBusiness: "Clients", targetBusiness: "Stays", title: "Arrange Wi-Fi installation", details: `Client consented to the £50 staff labour charge. Credit-check details supplied: ${action.broadbandCreditDetails}`, dueDate: action.accessDate, profile, now }));
    }
    if (action.prepaymentMeters && action.prepaymentSwitchByRecharge) {
      statements.push(workflowTicketStatement(db, row, { board: "credit_meter_switch", lane: "new_request", sourceBusiness: "Clients", targetBusiness: "Stays", title: "Switch prepayment meter to credit", details: "Client requested and consented to a credit-meter switch.", dueDate: action.accessDate, profile, now }));
    }
    if (action.hasGarden) {
      statements.push(
        workflowTicketStatement(db, row, {
          board: "routine_bin_garden",
          lane: "new_enquiry",
          sourceBusiness: "Stays",
          targetBusiness: "Ready",
          title: "Prepare routine garden maintenance quote",
          details: `The client requested routine garden maintenance. Contact the client with a quote. Warranty and maintenance notes: ${action.warrantyDetails.trim() || "None supplied"}.`,
          dueDate: action.accessDate,
          profile,
          now,
        }),
      );
    }
    await db.batch(statements);
    return;
  }

  if (action.action === "set_self_inspection_date") {
    requireClient(profile, row);
    await db.batch([
      db.prepare("UPDATE onboarding_cases SET self_furnish_inspection_date = ?, updated_at = ? WHERE id = ?").bind(action.inspectionDate, now, row.id),
      updateStatement(db, row.id, "self_furnish_inspection_date", `Client confirmed the guest-readiness inspection date as ${action.inspectionDate}.`, profile, now),
      workflowTicketStatement(db, row, { board: "new_property_inspection", lane: "new_enquiry", sourceBusiness: "Clients", targetBusiness: "Ready", title: "Book self-furnished guest-readiness inspection", details: `Inspection date confirmed by the client. Access information: ${row.access_info}.`, dueDate: action.inspectionDate, profile, now }),
    ]);
    return;
  }

  if (action.action === "book_inspection") {
    requireStaff(profile);
    await db.batch([
      db
        .prepare(
          "UPDATE onboarding_cases SET inspection_date = ?, inspection_booked_at = ?, status = 'inspection_booked', updated_at = ? WHERE id = ?",
        )
        .bind(action.inspectionDate, now, now, row.id),
      updateStatement(db, row.id, "inspection_booked", `Inspection booked for ${action.inspectionDate}.`, profile, now),
      notificationStatement(db, row, "inspection_booked", "Your property inspection is booked", `Your Recharge Ready inspection is booked for ${action.inspectionDate}.`, now),
      db.prepare("UPDATE workflow_tickets SET due_date = ?, lane = 'inspection_booked', status = 'in_progress', updated_at = ? WHERE source_onboarding_id = ? AND board = 'new_property_inspection'").bind(action.inspectionDate, now, row.id),
    ]);
    return;
  }

  if (action.action === "publish_reports") {
    requireStaff(profile);
    await db.batch([
      db
        .prepare(
          "UPDATE onboarding_cases SET health_safety_percent = ?, reports_published_at = ?, status = 'purchase_order_review', updated_at = ? WHERE id = ?",
        )
        .bind(action.healthSafetyPercent, now, now, row.id),
      updateStatement(db, row.id, "inspection_reports_published", "Purchase order and health & safety reports published to the client.", profile, now),
      notificationStatement(db, row, "reports_ready", "Your property reports are ready", "Your purchase order and health & safety reports are ready in your Recharge Dashboard.", now),
    ]);
    return;
  }

  if (action.action === "purchase_order_decision") {
    requireClient(profile, row);
    if (action.decision === "rejected" && !action.reason.trim()) {
      throw new Error("Tell us why the purchase order is being rejected");
    }
    const approved = action.decision === "approved";
    const statements = [
      db
        .prepare(
          "UPDATE onboarding_cases SET purchase_order_decision = ?, purchase_order_rejection_reason = ?, purchase_order_invoice_status = ?, status = ?, updated_at = ? WHERE id = ?",
        )
        .bind(
          action.decision,
          action.reason.trim(),
          approved ? "pending" : "not_created",
          approved ? "purchase_order_approved" : "purchase_order_rejected",
          now,
          row.id,
        ),
      updateStatement(
        db,
        row.id,
        "purchase_order_decision",
        approved ? "Client approved the purchase order." : `Client rejected the purchase order: ${action.reason.trim()}`,
        profile,
        now,
      ),
    ];
    if (approved) {
      statements.push(
        workflowTicketStatement(db, row, {
          board: "purchase_order_invoices",
          lane: "to_invoice",
          sourceBusiness: "Clients",
          targetBusiness: "Accounts",
          title: "Issue approved purchase order invoice",
          details: "The client approved the purchase order. Issue the corresponding client invoice and mark it settled when paid.",
          dueDate: null,
          profile,
          now,
        }),
      );
    }
    await db.batch(statements);
    return;
  }

  if (action.action === "quote_decision") {
    requireClient(profile, row);
    if (["contest", "reject"].includes(action.decision) && !action.reason.trim()) throw new Error("Tell us why you selected this option");
    if (action.decision === "consider" && !action.followUpDate) throw new Error("Choose a follow-up date");
    const accepted = action.decision === "accept";
    const status: OnboardingStatus = accepted ? "purchase_order_approved" : action.decision === "consider" ? "purchase_order_review" : "purchase_order_rejected";
    const statements = [
      db.prepare("UPDATE onboarding_cases SET purchase_order_decision = ?, purchase_order_rejection_reason = ?, review_follow_up_date = ?, status = ?, updated_at = ? WHERE id = ?").bind(accepted ? "approved" : action.decision === "consider" ? "pending" : "rejected", action.reason.trim(), action.followUpDate, status, now, row.id),
      updateStatement(db, row.id, "quote_decision", `Client selected ${action.decision}${action.reason ? `: ${action.reason.trim()}` : "."}`, profile, now),
    ];
    if (action.decision === "consider" && action.followUpDate) statements.push(notificationStatement(db, row, "quote_follow_up", "Furnishing quote follow-up", "You asked Recharge Ready to follow up while you consider the quote.", dateToTimestamp(action.followUpDate)));
    if (accepted) statements.push(workflowTicketStatement(db, row, { board: "purchase_order_accounts", lane: "new_order", sourceBusiness: "Ready", targetBusiness: "Accounts", title: "Place accepted furnishing order", details: "The client accepted the furnishing quote. Purchase every item on the attached order form and record receipts and delivery dates.", dueDate: null, profile, now }));
    await db.batch(statements);
    return;
  }

  if (action.action === "invoice_status") {
    requireStaff(profile);
    const column =
      action.invoice === "onboarding"
        ? "onboarding_invoice_status"
        : action.invoice === "purchase_order"
          ? "purchase_order_invoice_status"
          : "supplier_invoice_status";
    await db.batch([
      db
        .prepare(`UPDATE onboarding_cases SET ${column} = ?, updated_at = ? WHERE id = ?`)
        .bind(action.status, now, row.id),
      updateStatement(db, row.id, "invoice_status", `${humanise(action.invoice)} invoice marked ${action.status}.`, profile, now),
      ...(action.invoice === "onboarding" ? [db.prepare("UPDATE workflow_tickets SET lane = ?, status = ?, updated_at = ? WHERE source_onboarding_id = ? AND board = 'onboarding_invoices'").bind(action.status === "settled" ? "settled" : "invoice_sent", action.status === "settled" ? "complete" : "in_progress", now, row.id)] : []),
      ...(action.invoice === "onboarding" && action.status === "pending" ? [notificationStatement(db, row, "onboarding_invoice_sent", "Your onboarding invoice has been sent", "Please check your email for the onboarding invoice. We will update your progress as soon as it is settled.", now)] : []),
      ...(action.invoice === "onboarding" && action.status === "pending" ? [notificationStatement(db, row, "onboarding_invoice_follow_up", "Onboarding invoice still outstanding", "Your onboarding invoice remains outstanding. Please check your email or contact the team if you need another copy.", now + 172_800)] : []),
      ...(action.invoice === "onboarding" && action.status === "settled" ? [notificationStatement(db, row, "onboarding_invoice_settled", "Onboarding invoice settled", "Your onboarding invoice has been marked as settled.", now)] : []),
    ]);
    const refreshed = await requireVisibleCase(profile, row.id);
    if (
      action.invoice !== "supplier" &&
      refreshed.onboarding_invoice_status === "settled" &&
      refreshed.purchase_order_invoice_status === "settled" &&
      refreshed.supplier_invoice_status === "not_created"
    ) {
      await db.batch([
        db
          .prepare(
            "UPDATE onboarding_cases SET supplier_invoice_status = 'requested', status = 'invoices_pending', updated_at = ? WHERE id = ?",
          )
          .bind(now, row.id),
        workflowTicketStatement(db, row, {
          board: "purchase_order_accounts",
          lane: "invoices_to_settle",
          sourceBusiness: "Ready",
          targetBusiness: "Accounts",
          title: "Settle Ready purchase order invoice",
          details: "The client onboarding and purchase order invoices are settled. Ready must provide its supplier invoice for Accounts to settle.",
          dueDate: null,
          profile,
          now,
        }),
      ]);
    }
    return;
  }

  if (action.action === "set_guest_ready_date") {
    requireStaff(profile);
    await db.batch([
      db
        .prepare(
          "UPDATE onboarding_cases SET estimated_guest_ready_date = ?, status = 'guest_ready_scheduled', updated_at = ? WHERE id = ?",
        )
        .bind(action.date, now, row.id),
      updateStatement(db, row.id, "guest_ready_date", `Estimated guest-ready date set for ${action.date}.`, profile, now),
      notificationStatement(db, row, "guest_ready_date", "Your estimated guest-ready date", `Your property's estimated guest-ready date is ${action.date}.`, now),
    ]);
    return;
  }

  if (action.action === "confirm_guest_ready") {
    requireStaff(profile);
    const photos = await db
      .prepare(
        "SELECT room_label, COUNT(*) AS count FROM onboarding_files WHERE onboarding_id = ? AND kind = 'room_photo' GROUP BY room_label",
      )
      .bind(row.id)
      .all<{ room_label: string; count: number }>();
    if (row.health_safety_percent !== 100) {
      throw new Error("The health & safety inspection must be 100% complete");
    }
    if (!photos.results.length || photos.results.some((room: { room_label: string; count: number }) => !room.room_label.trim() || room.count < 3)) {
      throw new Error("Upload three labelled photos of every inspected room before marking guest ready");
    }
    await db.batch([
      db
        .prepare(
          "UPDATE onboarding_cases SET status = 'guest_ready', updated_at = ? WHERE id = ?",
        )
        .bind(now, row.id),
      updateStatement(db, row.id, "guest_ready", "Property passed the 100% health & safety check and is guest ready.", profile, now),
      notificationStatement(db, row, "guest_ready", "Your property is guest ready", "Your property has passed its final inspection. The Stays team is now completing the listings and launch assets.", now),
    ]);
    return;
  }

  if (action.action === "publish_live") {
    requireStaff(profile);
    const requiredPlatforms = new Set<ListingLink["platform"]>([
      "Airbnb",
      "Booking.com",
      "Comfy Workers",
      "Direct",
    ]);
    const suppliedPlatforms = new Set(action.listingLinks.map((link) => link.platform));
    if ([...requiredPlatforms].some((platform) => !suppliedPlatforms.has(platform))) {
      throw new Error("Attach all four listing links before publishing live");
    }
    if (!action.automatedMessagesReady || !action.socialPostReady || !action.guidebookUrl.trim()) {
      throw new Error("Complete automated messages, social media and the guest guidebook before publishing live");
    }
    await db.batch([
      db
        .prepare(
          "UPDATE onboarding_cases SET listing_links = ?, automated_messages_ready = 1, social_post_ready = 1, guidebook_url = ?, live_at = ?, status = 'live', updated_at = ? WHERE id = ?",
        )
        .bind(JSON.stringify(action.listingLinks), action.guidebookUrl.trim(), now, now, row.id),
      db
        .prepare(
          "INSERT INTO management_properties (id, hostaway_listing_id, property_name, owner_name, owner_email, owner_phone, access_code, access_info, guidebook_url, listing_links, payout_schedule, management_fee_bps, payout_notes, status, last_synced_at, updated_by_email, updated_by_name, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, '', '', ?, ?, ?, 'Between the 5th and 10th of the following month', 1500, ?, 'live', NULL, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET property_name = excluded.property_name, owner_name = excluded.owner_name, owner_email = excluded.owner_email, access_info = excluded.access_info, guidebook_url = excluded.guidebook_url, listing_links = excluded.listing_links, payout_schedule = excluded.payout_schedule, management_fee_bps = excluded.management_fee_bps, status = 'live', updated_by_email = excluded.updated_by_email, updated_by_name = excluded.updated_by_name, updated_at = excluded.updated_at",
        )
        .bind(
          `onboarding:${row.id}`,
          row.property_name || shortPropertyName(row.property_address),
          row.client_name,
          row.client_email,
          row.access_info,
          action.guidebookUrl.trim(),
          JSON.stringify(action.listingLinks.map((link) => ({ label: link.platform, url: link.url }))),
          `Created from ${row.reference}.`,
          profile.email,
          profile.fullName,
          now,
          now,
        ),
      db
        .prepare(
          "INSERT INTO property_onboardings (id, property_name, property_address, progress, status, created_by_email, created_by_name, completed_at, created_at, updated_at) VALUES (?, ?, ?, 100, 'complete', ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET progress = 100, status = 'complete', completed_at = COALESCE(property_onboardings.completed_at, excluded.completed_at), updated_at = excluded.updated_at",
        )
        .bind(row.id, row.property_name || shortPropertyName(row.property_address), row.property_address, profile.email, profile.fullName, now, now, now),
      updateStatement(db, row.id, "property_live", "All four listings are attached and the property is live.", profile, now),
      notificationStatement(db, row, "property_live", "Your property is live", "Your property is now live across Airbnb, Booking.com, Comfy Workers and Recharge direct bookings.", now),
    ]);
  }
}

export async function uploadOnboardingFile(
  profile: AccessProfile,
  input: {
    onboardingId: string;
    kind: OnboardingFileKind;
    roomLabel: string;
    file: File;
  },
) {
  const row = await requireVisibleCase(profile, input.onboardingId);
  if (profile.role === "client" && input.kind !== "enquiry_media") {
    throw new Error("This document is uploaded by the Recharge team");
  }
  if (!env.BUCKET) throw new Error("Recharge file storage is unavailable");
  if (input.file.size <= 0 || input.file.size > 25 * 1024 * 1024) {
    throw new Error("Choose a file up to 25 MB");
  }
  if (input.kind === "room_photo" && !input.roomLabel.trim()) {
    throw new Error("Add the room name for inspection photos");
  }
  const id = crypto.randomUUID();
  const now = nowSeconds();
  const safeName = input.file.name.replace(/[^a-zA-Z0-9._-]+/g, "-").slice(0, 120) || "upload";
  const objectKey = `onboarding/${row.id}/${id}-${safeName}`;
  await env.BUCKET.put(objectKey, await input.file.arrayBuffer(), {
    httpMetadata: { contentType: input.file.type || "application/octet-stream" },
  });
  await database()
    .prepare(
      "INSERT INTO onboarding_files (id, onboarding_id, kind, room_label, object_key, file_name, content_type, size_bytes, uploaded_by_email, uploaded_by_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      id,
      row.id,
      input.kind,
      input.roomLabel.trim(),
      objectKey,
      input.file.name,
      input.file.type || "application/octet-stream",
      input.file.size,
      profile.email,
      profile.fullName,
      now,
    )
    .run();
  return id;
}

export async function getOnboardingFile(profile: AccessProfile, fileId: string) {
  if (!env.BUCKET) throw new Error("Recharge file storage is unavailable");
  const file = await database()
    .prepare(
      "SELECT id, onboarding_id, kind, room_label, object_key, file_name, content_type, size_bytes, uploaded_by_name, created_at FROM onboarding_files WHERE id = ? LIMIT 1",
    )
    .bind(fileId)
    .first<FileRow>();
  if (!file) return null;
  await requireVisibleCase(profile, file.onboarding_id);
  const object = await env.BUCKET.get(file.object_key);
  if (!object) return null;
  return { file, object };
}

async function requireVisibleCase(profile: AccessProfile, id: string) {
  const row = await database()
    .prepare(`${CASE_SELECT} WHERE id = ? LIMIT 1`)
    .bind(id)
    .first<OnboardingRow>();
  if (!row) throw new Error("Onboarding record not found");
  if (profile.role === "client" && row.client_email.toLowerCase() !== profile.email.toLowerCase()) {
    throw new Error("Onboarding record not found");
  }
  return row;
}

function requireStaff(profile: AccessProfile) {
  if (profile.role === "client") throw new Error("Stays onboarding access required");
}

function requireClient(profile: AccessProfile, row: OnboardingRow) {
  if (profile.role !== "client" && profile.role !== "admin") {
    throw new Error("Client decision access required");
  }
  if (profile.role === "client" && row.client_email.toLowerCase() !== profile.email.toLowerCase()) {
    throw new Error("Onboarding record not found");
  }
}

function updateStatement(
  db: ReturnType<typeof database>,
  onboardingId: string,
  eventType: string,
  note: string,
  profile: AccessProfile,
  createdAt: number,
) {
  return db
    .prepare(
      "INSERT INTO onboarding_updates (id, onboarding_id, event_type, note, actor_email, actor_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(
      crypto.randomUUID(),
      onboardingId,
      eventType,
      note,
      profile.email,
      profile.fullName,
      createdAt,
    );
}

function notificationStatement(
  db: ReturnType<typeof database>,
  row: OnboardingRow,
  kind: string,
  subject: string,
  body: string,
  dueAt: number,
) {
  return db
    .prepare(
      "INSERT INTO onboarding_notifications (id, onboarding_id, recipient_email, kind, subject, body, due_at, status, sent_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', NULL, ?)",
    )
    .bind(crypto.randomUUID(), row.id, row.client_email, kind, subject, body, dueAt, nowSeconds());
}

function workflowTicketStatement(
  db: ReturnType<typeof database>,
  row: OnboardingRow,
  input: {
    board: string;
    lane: string;
    sourceBusiness: string;
    targetBusiness: string;
    title: string;
    details: string;
    dueDate: string | null;
    profile: AccessProfile;
    now: number;
  },
) {
  return db
    .prepare(
      "INSERT OR IGNORE INTO workflow_tickets (id, board, lane, source_business, target_business, property_name, property_address, title, details, priority, due_date, status, trigger_type, source_onboarding_id, created_by_email, created_by_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'normal', ?, 'new', 'onboarding_complete', ?, ?, ?, ?, ?)",
    )
    .bind(
      crypto.randomUUID(),
      input.board,
      input.lane,
      input.sourceBusiness,
      input.targetBusiness,
      row.property_name || shortPropertyName(row.property_address),
      row.property_address,
      input.title,
      input.details,
      input.dueDate,
      row.id,
      input.profile.email,
      input.profile.fullName,
      input.now,
      input.now,
    );
}

function mapCase(
  row: OnboardingRow,
  files: FileRow[],
  updates: UpdateRow[],
  notifications: NotificationRow[],
): OnboardingCase {
  return {
    id: row.id,
    reference: row.reference,
    clientEmail: row.client_email,
    clientName: row.client_name,
    propertyName: row.property_name,
    propertyAddress: row.property_address,
    propertyType: row.property_type,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    status: row.status,
    lowNightlyRatePence: row.low_nightly_rate_pence,
    mediumNightlyRatePence: row.medium_nightly_rate_pence,
    highNightlyRatePence: row.high_nightly_rate_pence,
    comparables: parseJson<Comparable[]>(row.comparables, []),
    estimateComments: row.estimate_comments,
    estimatePublishedAt: row.estimate_published_at,
    estimateViewedAt: row.estimate_viewed_at,
    clientDecision: row.client_decision,
    decisionFeedback: row.decision_feedback,
    reviewFollowUpDate: row.review_follow_up_date,
    agreementSignedAt: row.agreement_signed_at,
    agreementSignedName: row.agreement_signed_name,
    businessName: row.business_name,
    bankAccountName: row.bank_account_name,
    bankAccountNumber: row.bank_account_number,
    bankSortCode: row.bank_sort_code,
    accessDate: row.access_date,
    accessInfo: row.access_info,
    utilitiesConnected: Boolean(row.utilities_connected),
    utilityInstallDate: row.utility_install_date,
    prepaymentMeters: Boolean(row.prepayment_meters),
    creditSwitchDate: row.credit_switch_date,
    broadbandConnected: Boolean(row.broadband_connected),
    broadbandInstallDate: row.broadband_install_date,
    hasGarden: Boolean(row.has_garden),
    mailPreference: row.mail_preference,
    warrantyDetails: row.warranty_details,
    repairPermissions: parseJson<RepairPermission[]>(row.repair_permissions, []),
    furnishingChoice: row.furnishing_choice,
    selfFurnishInspectionDate: row.self_furnish_inspection_date,
    formSubmittedAt: row.form_submitted_at,
    inspectionDate: row.inspection_date,
    inspectionBookedAt: row.inspection_booked_at,
    healthSafetyPercent: row.health_safety_percent,
    purchaseOrderDecision: row.purchase_order_decision,
    purchaseOrderRejectionReason: row.purchase_order_rejection_reason,
    reportsPublishedAt: row.reports_published_at,
    onboardingInvoiceStatus: row.onboarding_invoice_status,
    purchaseOrderInvoiceStatus: row.purchase_order_invoice_status,
    supplierInvoiceStatus: row.supplier_invoice_status,
    estimatedGuestReadyDate: row.estimated_guest_ready_date,
    listingLinks: parseJson<ListingLink[]>(row.listing_links, []),
    automatedMessagesReady: Boolean(row.automated_messages_ready),
    socialPostReady: Boolean(row.social_post_ready),
    guidebookUrl: row.guidebook_url,
    liveAt: row.live_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    files: files.map((file) => ({
      id: file.id,
      kind: file.kind,
      roomLabel: file.room_label,
      fileName: file.file_name,
      contentType: file.content_type,
      sizeBytes: file.size_bytes,
      uploadedByName: file.uploaded_by_name,
      createdAt: file.created_at,
    })),
    updates: updates.map((update) => ({
      id: update.id,
      eventType: update.event_type,
      note: update.note,
      actorName: update.actor_name,
      createdAt: update.created_at,
    })),
    notifications: notifications.map((notification) => ({
      id: notification.id,
      kind: notification.kind,
      recipientEmail: notification.recipient_email,
      subject: notification.subject,
      dueAt: notification.due_at,
      status: notification.status,
    })),
  };
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function shortPropertyName(address: string) {
  return address.split(",")[0]?.trim() || address.trim();
}

function onboardingReference() {
  return `ONB-${new Date().getUTCFullYear()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

function dateToTimestamp(value: string) {
  const parsed = Date.parse(`${value}T09:00:00Z`);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : nowSeconds();
}

function humanise(value: string) {
  return value.replaceAll("_", " ");
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function emailConnected() {
  const runtime = env as unknown as Record<string, unknown>;
  return Boolean(runtime.FASTHOSTS_EMAIL_ENABLED || runtime.TRANSACTIONAL_EMAIL_API_KEY);
}

function database() {
  if (!env.DB) throw new Error("Recharge onboarding database is unavailable");
  return env.DB;
}

function safeFileName(value: string) { return value.replace(/[^a-zA-Z0-9 -]+/g, "").trim().replace(/\s+/g, "-").slice(0, 80) || "Property"; }

function performanceEstimateHtml(row: OnboardingRow, action: Extract<OnboardingAction, { action: "publish_estimate" }>, createdAt: number) {
  const esc=(value:string)=>value.replace(/[&<>"']/g,(character)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[character] || character);
  const money=(pence:number)=>new Intl.NumberFormat("en-GB",{style:"currency",currency:"GBP",maximumFractionDigits:0}).format(pence/100);
  const date=new Date(createdAt*1000).toLocaleDateString("en-GB",{day:"numeric",month:"long",year:"numeric"});
  const comparables=action.comparables.length?action.comparables.map((item)=>`<li><strong>${esc(item.name)}</strong> — ${money(item.adrPence)} nightly${item.url?` · <a href="${esc(item.url)}">view comparable</a>`:""}</li>`).join(""):"<li>No external comparables recorded.</li>";
  return `<!doctype html><html><head><meta charset="utf-8"><title>Performance Estimate</title><style>body{font-family:Arial,sans-serif;color:#18352f;max-width:820px;margin:40px auto;padding:0 28px;line-height:1.6}.brand{letter-spacing:.2em;text-transform:uppercase;color:#4f7368;font-size:12px}h1{font-size:30px;margin:8px 0}.rates{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:28px 0}.rate{border:1px solid #d5e0dc;border-radius:14px;padding:18px}.rate strong{display:block;font-size:24px;margin-top:6px}.note{background:#f2f6f4;border-radius:14px;padding:18px}@media print{body{margin:0}}</style></head><body><p class="brand">Recharge · Performance estimate</p><h1>${esc(row.property_name || shortPropertyName(row.property_address))}</h1><p>${esc(row.property_address)} · prepared ${date}</p><div class="rates"><div class="rate">Low nightly rate<strong>${money(action.lowRatePence)}</strong></div><div class="rate">Expected nightly rate<strong>${money(action.mediumRatePence)}</strong></div><div class="rate">High nightly rate<strong>${money(action.highRatePence)}</strong></div></div><h2>Comparable properties</h2><ul>${comparables}</ul><h2>Recharge assessment</h2><div class="note">${esc(action.comments || "No additional comments supplied.").replaceAll("\n","<br>")}</div><p style="margin-top:32px;color:#60736f;font-size:13px">This document is a performance estimate, not a guarantee of income. Actual performance depends on market conditions, availability, pricing, presentation and guest demand.</p></body></html>`;
}

function managementAgreementHtml(row: OnboardingRow, signedName: string, responsiblePartyName: string, signedAt: number) {
  const esc=(value:string)=>value.replace(/[&<>"']/g,(character)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[character] || character);
  const date=new Date(signedAt*1000).toLocaleDateString("en-GB",{day:"2-digit",month:"2-digit",year:"numeric"});
  return `<!doctype html><html><head><meta charset="utf-8"><title>Short-Term Let Management Agreement</title><style>body{font-family:Arial,sans-serif;color:#18352f;max-width:820px;margin:40px auto;padding:0 28px;line-height:1.58}h1{font-size:27px}h2{font-size:18px;margin-top:27px}li{margin:5px 0}.callout{background:#f1f6f3;border-left:4px solid #315f50;padding:15px 18px}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin-top:48px}.signature{border-top:1px solid #18352f;padding-top:12px}.ink{font-family:'Brush Script MT','Segoe Script',cursive;font-size:31px;line-height:1.2}.muted{color:#60736f;font-size:13px}@media print{body{margin:0}.signatures{break-inside:avoid}}</style></head><body><h1>SHORT-TERM LET MANAGEMENT AGREEMENT</h1><p>This Agreement is made on <strong>${date}</strong> between:</p><p><strong>(1) Recharge Group Ltd</strong> (SC799955), of 14 Newton Place, Glasgow, G3 7PY, trading as <strong>Recharge</strong> (the “Manager”); and</p><p><strong>(2) ${esc(responsiblePartyName)}</strong> (the “Client”).</p><p>Together, the “Parties”. The Property is <strong>${esc(row.property_address)}</strong>.</p><div class="callout"><strong>Commercial terms:</strong> management fee of 15% + VAT and a one-off onboarding fee of £475 including VAT per property.</div><h2>1. Appointment and scope</h2><p>The Client appoints the Manager as exclusive short-term-let management agent. The Manager will use reasonable skill and care to coordinate guest communications, bookings, listing creation and optimisation, dynamic pricing, housekeeping and linen, maintenance, supplies, performance reporting and client support. The Manager may use vetted employees, contractors, platforms and suppliers.</p><h2>2. Fees, revenue and payment</h2><p>The Client will pay a management fee equal to <strong>15% plus VAT</strong> of gross accommodation revenue after deduction of cleaning charges and OTA or payment-processing commissions. A separate <strong>£475 onboarding fee including VAT per property</strong> is payable when invoiced. Authorised operational, cleaning, repair and supply costs may be deducted before payout. The Client’s balance is normally paid monthly to the nominated account between the fifth and tenth day of the following month, subject to cleared funds, reconciliations, refunds, disputes and chargebacks.</p><h2>3. Client responsibilities</h2><p>The Client is responsible for mortgage or rent, utilities, council tax, TV licence, insurance, licences, certificates, repairs and all ownership or tenancy obligations. The Client warrants that they have authority to instruct the Manager and permit short-term letting, will provide accurate information and safe access, and will not obstruct confirmed bookings or agreed operations.</p><h2>4. Compliance and safety</h2><p>The Client must maintain all applicable Gas Safety, EICR, PAT, EPC, fire-safety, alarm, detector, legionella, planning and short-term-let licensing requirements. The Manager may coordinate assistance but does not assume the Client’s legal responsibilities. The Manager may suspend bookings where safety, legality or insurance is reasonably in doubt.</p><h2>5. Maintenance, cleaning and emergencies</h2><p>The Manager may arrange routine and urgent work within the Client’s recorded authority limits. Where urgent action is reasonably required to protect a guest, the Property or neighbouring premises, the Manager may act without prior approval and recover the reasonable cost. Supplier workmanship remains the supplier’s responsibility, although the Manager will assist with resolution.</p><h2>6. Listings, pricing and bookings</h2><p>The Manager may create and amend listings, rates, minimum stays, promotions and channel availability. Revenue and occupancy are not guaranteed. Existing confirmed bookings, cancellation liabilities and guest commitments survive termination where reasonably necessary for orderly handover.</p><h2>7. Guest damage, refunds and chargebacks</h2><p>The Manager will reasonably assist with evidence, platform claims and insurance recovery. The Client remains responsible for losses not recovered from the guest, OTA or insurer, except to the extent caused by the Manager’s negligence or breach. Platform-directed refunds, chargebacks and compensation may be deducted from revenue.</p><h2>8. Insurance and liability</h2><p>The Client must maintain suitable buildings, contents, public-liability and short-term-let insurance. Neither Party is liable for indirect or consequential loss. Nothing excludes liability that cannot lawfully be excluded.</p><h2>9. Term and termination</h2><p>The Agreement begins on ${date} and continues until either Party gives 90 days’ written notice. A Party may terminate immediately for material breach, illegality, unsafe conditions, insolvency or serious reputational risk. Accrued fees and committed third-party costs remain payable.</p><h2>10. Data, confidentiality and communications</h2><p>Each Party will protect confidential information and personal data and may process information reasonably required to deliver the services, comply with law, manage bookings and communicate with guests, suppliers and authorities. Operational notices may be sent through the Recharge platform or by email.</p><h2>11. Entire agreement and law</h2><p>This document and any written schedules form the agreement. Changes must be agreed in writing. If a provision is unenforceable, the remainder continues. Scots law applies and the Scottish courts have exclusive jurisdiction.</p><div class="signatures"><div class="signature"><div class="ink">Alexander Coghill</div><strong>Alexander Coghill</strong><br>Director, Recharge Group Ltd<br><span class="muted">Signed for the Manager · ${date}</span></div><div class="signature"><strong>${esc(signedName)}</strong><br>For ${esc(responsiblePartyName)}<br><span class="muted">Electronically signed · ${date}</span></div></div></body></html>`;
}

const CASE_SELECT =
  "SELECT id, reference, client_email, client_name, property_name, property_address, property_type, bedrooms, bathrooms, status, low_nightly_rate_pence, medium_nightly_rate_pence, high_nightly_rate_pence, comparables, estimate_comments, estimate_published_at, estimate_viewed_at, client_decision, decision_feedback, review_follow_up_date, agreement_signed_at, agreement_signed_name, business_name, bank_account_name, bank_account_number, bank_sort_code, access_date, access_info, utilities_connected, utility_install_date, prepayment_meters, credit_switch_date, broadband_connected, broadband_install_date, has_garden, mail_preference, warranty_details, repair_permissions, furnishing_choice, self_furnish_inspection_date, form_submitted_at, inspection_date, inspection_booked_at, health_safety_percent, purchase_order_decision, purchase_order_rejection_reason, reports_published_at, onboarding_invoice_status, purchase_order_invoice_status, supplier_invoice_status, estimated_guest_ready_date, listing_links, automated_messages_ready, social_post_ready, guidebook_url, live_at, created_at, updated_at FROM onboarding_cases";
