import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const accessUsers = sqliteTable("access_users", {
  email: text("email").primaryKey(),
  fullName: text("full_name").notNull(),
  responsibilities: text("responsibilities").notNull().default(""),
  role: text("role", {
    enum: ["admin", "stays", "cleans", "ready", "client"],
  }).notNull(),
  status: text("status", { enum: ["active", "pending", "revoked"] })
    .notNull()
    .default("active"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const teamRoles = sqliteTable(
  "team_roles",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    department: text("department").notNull().default("stays"),
    responsibilities: text("responsibilities").notNull().default("[]"),
    regions: text("regions").notNull().default("[\"General\"]"),
    parentRoleId: text("parent_role_id"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [uniqueIndex("idx_team_roles_name").on(table.name)],
);

export const teamDepartmentSchedules = sqliteTable(
  "team_department_schedules",
  {
    id: text("id").primaryKey(),
    department: text("department").notNull(),
    title: text("title").notNull(),
    scheduleDate: text("schedule_date").notNull(),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    assignedEmail: text("assigned_email").notNull().default(""),
    note: text("note").notNull().default(""),
    createdByEmail: text("created_by_email").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("idx_team_schedule_department_date").on(table.department, table.scheduleDate)],
);

export const teamDirectoryPeople = sqliteTable(
  "team_directory_people",
  {
    id: text("id").primaryKey(),
    fullName: text("full_name").notNull().default(""),
    email: text("email").notNull().default(""),
    department: text("department").notNull().default("stays"),
    responsibilities: text("responsibilities").notNull().default(""),
    status: text("status", { enum: ["active", "vacancy"] }).notNull().default("active"),
    roleIds: text("role_ids").notNull().default("[]"),
    regions: text("regions").notNull().default("[]"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("idx_team_directory_department_status").on(table.department, table.status)],
);

export const teamRoleAssignments = sqliteTable(
  "team_role_assignments",
  {
    roleId: text("role_id").notNull(),
    email: text("email").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.roleId, table.email] }),
    index("idx_team_role_assignments_email").on(table.email),
  ],
);

export const teamCoverageAreas = sqliteTable(
  "team_coverage_areas",
  {
    email: text("email").notNull(),
    region: text("region").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.email, table.region] }),
    index("idx_team_coverage_region").on(table.region),
  ],
);

export const modulePermissions = sqliteTable(
  "module_permissions",
  {
    email: text("email").notNull(),
    moduleId: text("module_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.email, table.moduleId] })],
);

export const timeEntries = sqliteTable(
  "time_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    email: text("email").notNull(),
    clockIn: integer("clock_in").notNull(),
    clockOut: integer("clock_out"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("idx_time_entries_email_clock_in").on(table.email, table.clockIn)],
);

export const workSchedules = sqliteTable(
  "work_schedules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    email: text("email").notNull(),
    shiftDate: text("shift_date").notNull(),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    label: text("label").notNull().default("Shift"),
    status: text("status", { enum: ["scheduled", "cancelled"] })
      .notNull()
      .default("scheduled"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_work_schedules_email_date_start").on(
      table.email,
      table.shiftDate,
      table.startTime,
    ),
  ],
);

export const propertyOnboardings = sqliteTable(
  "property_onboardings",
  {
    id: text("id").primaryKey(),
    propertyName: text("property_name").notNull(),
    propertyAddress: text("property_address").notNull().default(""),
    progress: integer("progress").notNull().default(0),
    status: text("status", { enum: ["active", "complete"] })
      .notNull()
      .default("active"),
    createdByEmail: text("created_by_email").notNull(),
    createdByName: text("created_by_name").notNull(),
    completedAt: integer("completed_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_property_onboardings_status_updated").on(
      table.status,
      table.updatedAt,
    ),
  ],
);

export const onboardingCases = sqliteTable(
  "onboarding_cases",
  {
    id: text("id").primaryKey(),
    clickupTaskId: text("clickup_task_id").unique(),
    reference: text("reference").notNull().unique(),
    clientEmail: text("client_email").notNull(),
    clientName: text("client_name").notNull(),
    propertyName: text("property_name").notNull().default(""),
    propertyAddress: text("property_address").notNull(),
    propertyType: text("property_type").notNull(),
    bedrooms: integer("bedrooms").notNull(),
    bathrooms: integer("bathrooms").notNull(),
    status: text("status").notNull().default("enquiry_received"),
    lowNightlyRatePence: integer("low_nightly_rate_pence"),
    mediumNightlyRatePence: integer("medium_nightly_rate_pence"),
    highNightlyRatePence: integer("high_nightly_rate_pence"),
    comparables: text("comparables").notNull().default("[]"),
    estimateComments: text("estimate_comments").notNull().default(""),
    estimatePublishedAt: integer("estimate_published_at"),
    estimateViewedAt: integer("estimate_viewed_at"),
    clientDecision: text("client_decision").notNull().default("pending"),
    decisionFeedback: text("decision_feedback").notNull().default(""),
    reviewFollowUpDate: text("review_follow_up_date"),
    agreementSignedAt: integer("agreement_signed_at"),
    agreementSignedName: text("agreement_signed_name").notNull().default(""),
    businessName: text("business_name").notNull().default(""),
    bankAccountName: text("bank_account_name").notNull().default(""),
    bankAccountNumber: text("bank_account_number").notNull().default(""),
    bankSortCode: text("bank_sort_code").notNull().default(""),
    accessDate: text("access_date"),
    accessInfo: text("access_info").notNull().default(""),
    utilitiesConnected: integer("utilities_connected", { mode: "boolean" })
      .notNull()
      .default(false),
    utilityInstallDate: text("utility_install_date"),
    prepaymentMeters: integer("prepayment_meters", { mode: "boolean" })
      .notNull()
      .default(false),
    creditSwitchDate: text("credit_switch_date"),
    broadbandConnected: integer("broadband_connected", { mode: "boolean" })
      .notNull()
      .default(false),
    broadbandInstallDate: text("broadband_install_date"),
    hasGarden: integer("has_garden", { mode: "boolean" })
      .notNull()
      .default(false),
    mailPreference: text("mail_preference").notNull().default(""),
    warrantyDetails: text("warranty_details").notNull().default(""),
    repairPermissions: text("repair_permissions").notNull().default("{}"),
    furnishingChoice: text("furnishing_choice").notNull().default("pending"),
    selfFurnishInspectionDate: text("self_furnish_inspection_date"),
    formSubmittedAt: integer("form_submitted_at"),
    inspectionDate: text("inspection_date"),
    inspectionBookedAt: integer("inspection_booked_at"),
    healthSafetyPercent: integer("health_safety_percent").notNull().default(0),
    purchaseOrderDecision: text("purchase_order_decision")
      .notNull()
      .default("pending"),
    purchaseOrderRejectionReason: text("purchase_order_rejection_reason")
      .notNull()
      .default(""),
    reportsPublishedAt: integer("reports_published_at"),
    onboardingInvoiceStatus: text("onboarding_invoice_status")
      .notNull()
      .default("not_created"),
    purchaseOrderInvoiceStatus: text("purchase_order_invoice_status")
      .notNull()
      .default("not_created"),
    supplierInvoiceStatus: text("supplier_invoice_status")
      .notNull()
      .default("not_created"),
    estimatedGuestReadyDate: text("estimated_guest_ready_date"),
    listingLinks: text("listing_links").notNull().default("[]"),
    automatedMessagesReady: integer("automated_messages_ready", {
      mode: "boolean",
    })
      .notNull()
      .default(false),
    socialPostReady: integer("social_post_ready", { mode: "boolean" })
      .notNull()
      .default(false),
    guidebookUrl: text("guidebook_url").notNull().default(""),
    liveAt: integer("live_at"),
    createdByEmail: text("created_by_email").notNull(),
    createdByName: text("created_by_name").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_onboarding_cases_client_updated").on(
      table.clientEmail,
      table.updatedAt,
    ),
    index("idx_onboarding_cases_status_updated").on(
      table.status,
      table.updatedAt,
    ),
  ],
);

export const onboardingFiles = sqliteTable(
  "onboarding_files",
  {
    id: text("id").primaryKey(),
    onboardingId: text("onboarding_id").notNull(),
    kind: text("kind").notNull(),
    roomLabel: text("room_label").notNull().default(""),
    objectKey: text("object_key").notNull().unique(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    uploadedByEmail: text("uploaded_by_email").notNull(),
    uploadedByName: text("uploaded_by_name").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_onboarding_files_case_kind").on(
      table.onboardingId,
      table.kind,
    ),
  ],
);

export const onboardingUpdates = sqliteTable(
  "onboarding_updates",
  {
    id: text("id").primaryKey(),
    onboardingId: text("onboarding_id").notNull(),
    eventType: text("event_type").notNull(),
    note: text("note").notNull(),
    actorEmail: text("actor_email").notNull(),
    actorName: text("actor_name").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_onboarding_updates_case_created").on(
      table.onboardingId,
      table.createdAt,
    ),
  ],
);

export const onboardingNotifications = sqliteTable(
  "onboarding_notifications",
  {
    id: text("id").primaryKey(),
    onboardingId: text("onboarding_id").notNull(),
    recipientEmail: text("recipient_email").notNull(),
    kind: text("kind").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    dueAt: integer("due_at").notNull(),
    status: text("status").notNull().default("queued"),
    sentAt: integer("sent_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_onboarding_notifications_due").on(table.status, table.dueAt),
    index("idx_onboarding_notifications_case").on(table.onboardingId),
  ],
);

export const workflowTickets = sqliteTable(
  "workflow_tickets",
  {
    id: text("id").primaryKey(),
    board: text("board", {
      enum: [
        "spot_maintenance",
        "property_furnishing",
        "new_property_inspection",
        "routine_bin_garden",
        "clean_property_onboarding",
        "clean_issues",
        "aircover_reporting",
        "onboarding_invoices",
        "purchase_order_invoices",
        "purchase_order_accounts",
      ],
    }).notNull(),
    lane: text("lane").notNull().default("new"),
    sourceBusiness: text("source_business").notNull(),
    targetBusiness: text("target_business").notNull(),
    propertyName: text("property_name").notNull(),
    propertyAddress: text("property_address").notNull().default(""),
    title: text("title").notNull(),
    details: text("details").notNull().default(""),
    priority: text("priority", { enum: ["normal", "urgent"] })
      .notNull()
      .default("normal"),
    dueDate: text("due_date"),
    status: text("status", { enum: ["new", "in_progress", "complete"] })
      .notNull()
      .default("new"),
    triggerType: text("trigger_type", {
      enum: ["manual_referral", "onboarding_complete"],
    }).notNull(),
    sourceOnboardingId: text("source_onboarding_id"),
    createdByEmail: text("created_by_email").notNull(),
    createdByName: text("created_by_name").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_workflow_tickets_board_status_created").on(
      table.board,
      table.status,
      table.createdAt,
    ),
    uniqueIndex("idx_workflow_tickets_onboarding_board").on(
      table.sourceOnboardingId,
      table.board,
    ),
  ],
);

export const communicationWorkflows = sqliteTable(
  "communication_workflows",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    channel: text("channel", {
      enum: ["all", "guests", "email", "whatsapp", "phone"],
    })
      .notNull()
      .default("all"),
    triggerText: text("trigger_text").notNull(),
    instructions: text("instructions").notNull(),
    approvedResponse: text("approved_response").notNull().default(""),
    escalationTarget: text("escalation_target", {
      enum: ["none", "ready", "cleans"],
    })
      .notNull()
      .default("none"),
    priority: text("priority", { enum: ["standard", "urgent"] })
      .notNull()
      .default("standard"),
    status: text("status", { enum: ["active", "inactive"] })
      .notNull()
      .default("active"),
    createdByEmail: text("created_by_email").notNull(),
    createdByName: text("created_by_name").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_communication_workflows_status_channel_updated").on(
      table.status,
      table.channel,
      table.updatedAt,
    ),
  ],
);

export const communicationThreads = sqliteTable(
  "communication_threads",
  {
    id: text("id").primaryKey(),
    source: text("source", { enum: ["guests", "email", "whatsapp"] })
      .notNull(),
    externalId: text("external_id").notNull(),
    propertyName: text("property_name").notNull().default(""),
    guestName: text("guest_name").notNull().default(""),
    senderAddress: text("sender_address").notNull().default(""),
    subject: text("subject").notNull().default(""),
    hostawayListingId: text("hostaway_listing_id").notNull().default(""),
    hostawayReservationId: text("hostaway_reservation_id").notNull().default(""),
    openedAt: integer("opened_at"),
    status: text("status", { enum: ["open", "closed", "junk"] })
      .notNull()
      .default("open"),
    assignedToEmail: text("assigned_to_email"),
    assignedToName: text("assigned_to_name"),
    lastInboundAt: integer("last_inbound_at"),
    lastOutboundAt: integer("last_outbound_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("idx_communication_threads_source_external").on(
      table.source,
      table.externalId,
    ),
    index("idx_communication_threads_source_status_inbound").on(
      table.source,
      table.status,
      table.lastInboundAt,
    ),
  ],
);

export const communicationMessages = sqliteTable(
  "communication_messages",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id").notNull(),
    source: text("source", { enum: ["guests", "email", "whatsapp"] })
      .notNull(),
    externalId: text("external_id"),
    direction: text("direction", { enum: ["inbound", "outbound"] })
      .notNull(),
    body: text("body").notNull(),
    attachmentsJson: text("attachments_json").notNull().default("[]"),
    sentAt: integer("sent_at").notNull(),
    respondedAt: integer("responded_at"),
    respondedByEmail: text("responded_by_email"),
    respondedByName: text("responded_by_name"),
    isAutomated: integer("is_automated", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_communication_messages_thread_sent").on(
      table.threadId,
      table.sentAt,
    ),
    uniqueIndex("idx_communication_messages_source_external").on(
      table.source,
      table.externalId,
    ),
  ],
);

export const communicationCalls = sqliteTable(
  "communication_calls",
  {
    id: text("id").primaryKey(),
    externalId: text("external_id").notNull().unique(),
    direction: text("direction", { enum: ["inbound", "outbound"] })
      .notNull(),
    phoneNumber: text("phone_number").notNull(),
    contactName: text("contact_name").notNull().default(""),
    outcome: text("outcome", {
      enum: ["answered", "missed", "abandoned", "voicemail"],
    }).notNull(),
    answeredByEmail: text("answered_by_email"),
    answeredByName: text("answered_by_name"),
    startedAt: integer("started_at").notNull(),
    answeredAt: integer("answered_at"),
    endedAt: integer("ended_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_communication_calls_outcome_started").on(
      table.outcome,
      table.startedAt,
    ),
  ],
);

export const maintenanceTickets = sqliteTable(
  "maintenance_tickets",
  {
    id: text("id").primaryKey(),
    reference: text("reference").notNull().unique(),
    source: text("source", { enum: ["manual", "guest_communication", "clean"] })
      .notNull()
      .default("manual"),
    sourceThreadId: text("source_thread_id"),
    sourceMessageId: text("source_message_id").unique(),
    propertyName: text("property_name").notNull(),
    propertyAddress: text("property_address").notNull().default(""),
    clientName: text("client_name").notNull().default(""),
    clientEmail: text("client_email").notNull().default(""),
    guestName: text("guest_name").notNull().default(""),
    bookingReference: text("booking_reference").notNull().default(""),
    hostawayListingId: text("hostaway_listing_id"),
    hostawayReservationId: text("hostaway_reservation_id"),
    reservationArrivalDate: text("reservation_arrival_date"),
    reservationDepartureDate: text("reservation_departure_date"),
    reservationChannel: text("reservation_channel").notNull().default(""),
    category: text("category").notNull(),
    priority: text("priority", { enum: ["normal", "urgent", "emergency"] })
      .notNull()
      .default("normal"),
    summary: text("summary").notNull(),
    details: text("details").notNull().default(""),
    troubleshootingCompletedItems: text("troubleshooting_completed_items")
      .notNull()
      .default("[]"),
    troubleshootingNotes: text("troubleshooting_notes").notNull().default(""),
    troubleshootingOutcome: text("troubleshooting_outcome", {
      enum: ["pending", "resolved", "ready_required"],
    })
      .notNull()
      .default("pending"),
    physicalRepair: integer("physical_repair", { mode: "boolean" })
      .notNull()
      .default(false),
    status: text("status", {
      enum: [
        "new",
        "quote_required",
        "approval_pending",
        "ready_to_schedule",
        "scheduled",
        "in_progress",
        "management_review",
        "accounts_pending",
        "accounts_paid",
        "reconciled",
        "closed",
      ],
    })
      .notNull()
      .default("new"),
    readyReference: text("ready_reference").unique(),
    quoteAmountPence: integer("quote_amount_pence"),
    workRequired: text("work_required").notNull().default(""),
    proposedRepairDate: text("proposed_repair_date"),
    approvalRoute: text("approval_route", {
      enum: ["unassessed", "none", "management", "client"],
    })
      .notNull()
      .default("unassessed"),
    managementApproval: text("management_approval", {
      enum: ["not_required", "pending", "approved", "rejected"],
    })
      .notNull()
      .default("not_required"),
    clientApproval: text("client_approval", {
      enum: ["not_required", "pending", "approved", "rejected"],
    })
      .notNull()
      .default("not_required"),
    scheduledDate: text("scheduled_date"),
    scheduledStartTime: text("scheduled_start_time"),
    scheduledEndTime: text("scheduled_end_time"),
    assignedReadyEmail: text("assigned_ready_email"),
    assignedReadyName: text("assigned_ready_name"),
    finalApproval: text("final_approval", {
      enum: ["not_required", "pending", "approved", "rejected"],
    })
      .notNull()
      .default("not_required"),
    accountsStatus: text("accounts_status", {
      enum: ["not_created", "pending", "paid", "reconciled"],
    })
      .notNull()
      .default("not_created"),
    paymentReference: text("payment_reference").notNull().default(""),
    paidAt: integer("paid_at"),
    paidByEmail: text("paid_by_email"),
    paidByName: text("paid_by_name"),
    invoiceReference: text("invoice_reference").notNull().default(""),
    closedReason: text("closed_reason").notNull().default(""),
    closedAt: integer("closed_at"),
    closedByEmail: text("closed_by_email"),
    closedByName: text("closed_by_name"),
    raisedByEmail: text("raised_by_email").notNull(),
    raisedByName: text("raised_by_name").notNull(),
    completedAt: integer("completed_at"),
    managementApprovedAt: integer("management_approved_at"),
    reconciledAt: integer("reconciled_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_maintenance_tickets_status_updated").on(
      table.status,
      table.updatedAt,
    ),
    index("idx_maintenance_tickets_client_status").on(
      table.clientEmail,
      table.clientApproval,
    ),
    index("idx_maintenance_tickets_accounts_updated").on(
      table.accountsStatus,
      table.updatedAt,
    ),
    index("idx_maintenance_tickets_hostaway_listing").on(
      table.hostawayListingId,
    ),
  ],
);

export const managementProperties = sqliteTable(
  "management_properties",
  {
    id: text("id").primaryKey(),
    mergedIntoPropertyId: text("merged_into_property_id"),
    hostawayListingId: text("hostaway_listing_id").unique(),
    hostawayListingIds: text("hostaway_listing_ids").notNull().default("[]"),
    clickupTaskId: text("clickup_task_id").unique(),
    clickupUrl: text("clickup_url").notNull().default(""),
    sourceStatus: text("source_status").notNull().default(""),
    sourcePriority: text("source_priority").notNull().default(""),
    sourceDueAt: text("source_due_at").notNull().default(""),
    sourceCreatedAt: text("source_created_at").notNull().default(""),
    sourceUpdatedAt: text("source_updated_at").notNull().default(""),
    propertyName: text("property_name").notNull(),
    propertyAddress: text("property_address").notNull().default(""),
    region: text("region").notNull().default(""),
    propertyType: text("property_type").notNull().default(""),
    bedrooms: text("bedrooms").notNull().default(""),
    beds: text("beds").notNull().default(""),
    bathrooms: text("bathrooms").notNull().default(""),
    wcCount: text("wc_count").notNull().default(""),
    parking: text("parking").notNull().default(""),
    garden: text("garden").notNull().default(""),
    ownerName: text("owner_name").notNull().default(""),
    ownerCompany: text("owner_company").notNull().default(""),
    ownerEmail: text("owner_email").notNull().default(""),
    ownerPhone: text("owner_phone").notNull().default(""),
    correspondenceAddress: text("correspondence_address").notNull().default(""),
    existingClient: text("existing_client").notNull().default(""),
    accessCode: text("access_code").notNull().default(""),
    accessInfo: text("access_info").notNull().default(""),
    guidebookUrl: text("guidebook_url").notNull().default(""),
    listingLinks: text("listing_links").notNull().default("[]"),
    payoutSchedule: text("payout_schedule").notNull().default(""),
    managementFeeBps: integer("management_fee_bps").notNull().default(0),
    cleaningCostPence: integer("cleaning_cost_pence").notNull().default(0),
    payoutNotes: text("payout_notes").notNull().default(""),
    currentlyOperating: text("currently_operating").notNull().default(""),
    furnishingPreference: text("furnishing_preference").notNull().default(""),
    licensingPreference: text("licensing_preference").notNull().default(""),
    startPreference: text("start_preference").notNull().default(""),
    enquiryReason: text("enquiry_reason").notNull().default(""),
    additionalNotes: text("additional_notes").notNull().default(""),
    sourceDescription: text("source_description").notNull().default(""),
    sourceCustomFields: text("source_custom_fields").notNull().default("{}"),
    sourceChecklists: text("source_checklists").notNull().default("[]"),
    sourceComments: text("source_comments").notNull().default("[]"),
    sourceAttachments: text("source_attachments").notNull().default("[]"),
    sourceLinkedTaskIds: text("source_linked_task_ids").notNull().default("[]"),
    clickupImportedAt: integer("clickup_imported_at"),
    status: text("status", { enum: ["new_enquiry", "sign_them_up", "onboarding", "live", "archived"] })
      .notNull()
      .default("new_enquiry"),
    lastSyncedAt: integer("last_synced_at"),
    updatedByEmail: text("updated_by_email").notNull(),
    updatedByName: text("updated_by_name").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_management_properties_name").on(table.propertyName),
    index("idx_management_properties_address").on(table.propertyAddress),
    index("idx_management_properties_owner").on(table.ownerEmail, table.ownerName),
    index("idx_management_properties_status").on(table.status),
    index("idx_management_properties_region_status").on(table.region, table.status),
  ],
);

export const managementPropertySources = sqliteTable(
  "management_property_sources",
  {
    clickupTaskId: text("clickup_task_id").primaryKey(),
    propertyId: text("property_id").notNull(),
    clickupUrl: text("clickup_url").notNull(),
    sourceStatus: text("source_status").notNull().default(""),
    sourcePropertyName: text("source_property_name").notNull().default(""),
    payloadJson: text("payload_json").notNull().default("{}"),
    importedAt: integer("imported_at").notNull(),
  },
  (table) => [
    index("idx_management_property_sources_property").on(table.propertyId),
    index("idx_management_property_sources_status").on(table.sourceStatus),
  ],
);

export const routineMaintenanceBookings = sqliteTable(
  "routine_maintenance_bookings",
  {
    id: text("id").primaryKey(),
    propertyId: text("property_id").notNull(),
    propertyName: text("property_name").notNull(),
    region: text("region").notNull().default(""),
    category: text("category", {
      enum: ["safety_inspection", "garden", "bins", "general_check", "other"],
    }).notNull(),
    scheduledDate: text("scheduled_date").notNull(),
    startTime: text("start_time").notNull().default(""),
    endTime: text("end_time").notNull().default(""),
    assignedTo: text("assigned_to").notNull().default(""),
    notes: text("notes").notNull().default(""),
    status: text("status", { enum: ["booked", "complete", "cancelled"] }).notNull().default("booked"),
    createdByEmail: text("created_by_email").notNull(),
    createdByName: text("created_by_name").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_routine_maintenance_date_status").on(table.scheduledDate, table.status),
    index("idx_routine_maintenance_property_date").on(table.propertyId, table.scheduledDate),
    index("idx_routine_maintenance_region_date").on(table.region, table.scheduledDate),
  ],
);

export const routineMaintenanceSubmissions = sqliteTable(
  "routine_maintenance_submissions",
  {
    id: text("id").primaryKey(),
    bookingId: text("booking_id").notNull().unique(),
    checklistJson: text("checklist_json").notNull().default("{}"),
    overallCondition: text("overall_condition", { enum: ["good", "attention", "urgent"] }).notNull(),
    workCompleted: text("work_completed").notNull().default(""),
    issuesFound: text("issues_found").notNull().default(""),
    followUpRequired: integer("follow_up_required", { mode: "boolean" }).notNull().default(false),
    followUpDetails: text("follow_up_details").notNull().default(""),
    submittedByEmail: text("submitted_by_email").notNull(),
    submittedByName: text("submitted_by_name").notNull(),
    submittedAt: integer("submitted_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_routine_submission_condition_date").on(table.overallCondition, table.submittedAt),
  ],
);

export const maintenanceThresholds = sqliteTable("maintenance_thresholds", {
  category: text("category").primaryKey(),
  managementLimitPence: integer("management_limit_pence").notNull().default(0),
  clientLimitPence: integer("client_limit_pence").notNull().default(0),
  updatedByEmail: text("updated_by_email").notNull(),
  updatedByName: text("updated_by_name").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const maintenanceUpdates = sqliteTable(
  "maintenance_updates",
  {
    id: text("id").primaryKey(),
    ticketId: text("ticket_id").notNull(),
    eventType: text("event_type").notNull(),
    note: text("note").notNull(),
    actorEmail: text("actor_email").notNull(),
    actorName: text("actor_name").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_maintenance_updates_ticket_created").on(
      table.ticketId,
      table.createdAt,
    ),
  ],
);

export const maintenanceEvidence = sqliteTable(
  "maintenance_evidence",
  {
    id: text("id").primaryKey(),
    ticketId: text("ticket_id").notNull(),
    kind: text("kind", { enum: ["issue", "completion", "invoice"] })
      .notNull()
      .default("issue"),
    objectKey: text("object_key").notNull().unique(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    uploadedByEmail: text("uploaded_by_email").notNull(),
    uploadedByName: text("uploaded_by_name").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_maintenance_evidence_ticket_created").on(
      table.ticketId,
      table.createdAt,
    ),
  ],
);

export const cleaners = sqliteTable(
  "cleaners",
  {
    id: text("id").primaryKey(),
    fullName: text("full_name").notNull(),
    email: text("email").notNull().default(""),
    phone: text("phone").notNull().default(""),
    notes: text("notes").notNull().default(""),
    status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("idx_cleaners_name_status").on(table.status, table.fullName)],
);

export const cleanProperties = sqliteTable(
  "clean_properties",
  {
    id: text("id").primaryKey(),
    hostawayListingId: text("hostaway_listing_id").unique(),
    propertyName: text("property_name").notNull(),
    propertyAddress: text("property_address").notNull().default(""),
    accessInstructions: text("access_instructions").notNull().default(""),
    clientName: text("client_name").notNull().default(""),
    clientEmail: text("client_email").notNull().default(""),
    cleanerId: text("cleaner_id"),
    cleanPricePence: integer("clean_price_pence").notNull().default(0),
    status: text("status", { enum: ["active", "inactive"] }).notNull().default("active"),
    lastSyncedAt: integer("last_synced_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_clean_properties_name").on(table.propertyName),
    index("idx_clean_properties_cleaner").on(table.cleanerId),
    index("idx_clean_properties_client").on(table.clientEmail),
  ],
);

export const cleanTickets = sqliteTable(
  "clean_tickets",
  {
    id: text("id").primaryKey(),
    hostawayReservationId: text("hostaway_reservation_id").unique(),
    hostawayListingId: text("hostaway_listing_id"),
    propertyId: text("property_id"),
    propertyName: text("property_name").notNull(),
    propertyAddress: text("property_address").notNull().default(""),
    guestName: text("guest_name").notNull().default(""),
    guestCount: integer("guest_count").notNull().default(0),
    bookingReference: text("booking_reference").notNull().default(""),
    arrivalDate: text("arrival_date"),
    cleanDate: text("clean_date").notNull(),
    channelName: text("channel_name").notNull().default(""),
    assignedCleanerId: text("assigned_cleaner_id"),
    assignedCleanerName: text("assigned_cleaner_name").notNull().default(""),
    status: text("status", { enum: ["scheduled", "in_progress", "submitted", "approved", "unsuccessful", "invoiced"] }).notNull().default("scheduled"),
    broadbandWorking: integer("broadband_working", { mode: "boolean" }),
    heatingWorking: integer("heating_working", { mode: "boolean" }),
    hotWaterWorking: integer("hot_water_working", { mode: "boolean" }),
    maintenanceNotes: text("maintenance_notes").notNull().default(""),
    replenishmentNotes: text("replenishment_notes").notNull().default(""),
    mailPresent: integer("mail_present", { mode: "boolean" }).notNull().default(false),
    mailNotes: text("mail_notes").notNull().default(""),
    guestConfirmationNotes: text("guest_confirmation_notes").notNull().default(""),
    complaintNotes: text("complaint_notes").notNull().default(""),
    refundOrCancellation: integer("refund_or_cancellation", { mode: "boolean" }).notNull().default(false),
    invoiceWeek: text("invoice_week"),
    submittedAt: integer("submitted_at"),
    approvedAt: integer("approved_at"),
    unsuccessfulAt: integer("unsuccessful_at"),
    invoicedAt: integer("invoiced_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_clean_tickets_date_status").on(table.cleanDate, table.status),
    index("idx_clean_tickets_cleaner_status").on(table.assignedCleanerId, table.status),
    index("idx_clean_tickets_property").on(table.propertyId),
  ],
);

export const cleanFiles = sqliteTable(
  "clean_files",
  {
    id: text("id").primaryKey(),
    cleanTicketId: text("clean_ticket_id").notNull(),
    kind: text("kind", { enum: ["property_video", "mail_photo", "guest_evidence"] }).notNull(),
    objectKey: text("object_key").notNull().unique(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    uploadedByEmail: text("uploaded_by_email").notNull(),
    uploadedByName: text("uploaded_by_name").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("idx_clean_files_ticket_kind").on(table.cleanTicketId, table.kind)],
);

export const clientMailItems = sqliteTable(
  "client_mail_items",
  {
    id: text("id").primaryKey(),
    cleanTicketId: text("clean_ticket_id").notNull().unique(),
    propertyName: text("property_name").notNull(),
    propertyAddress: text("property_address").notNull().default(""),
    clientEmail: text("client_email").notNull().default(""),
    note: text("note").notNull().default(""),
    photoFileId: text("photo_file_id"),
    status: text("status", { enum: ["new", "reviewed", "archived"] }).notNull().default("new"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("idx_client_mail_email_status").on(table.clientEmail, table.status)],
);

export const replenishmentRequests = sqliteTable(
  "replenishment_requests",
  {
    id: text("id").primaryKey(),
    cleanTicketId: text("clean_ticket_id").notNull().unique(),
    propertyName: text("property_name").notNull(),
    items: text("items").notNull(),
    status: text("status", { enum: ["new", "ordered", "complete"] }).notNull().default("new"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("idx_replenishment_status_updated").on(table.status, table.updatedAt)],
);

export const cleanerReviews = sqliteTable(
  "cleaner_reviews",
  {
    id: text("id").primaryKey(),
    cleanerId: text("cleaner_id").notNull(),
    successRateBps: integer("success_rate_bps").notNull(),
    reason: text("reason").notNull(),
    status: text("status", { enum: ["open", "closed"] }).notNull().default("open"),
    createdAt: integer("created_at").notNull(),
    closedAt: integer("closed_at"),
  },
  (table) => [index("idx_cleaner_reviews_cleaner_status").on(table.cleanerId, table.status)],
);

export const purchaseOrders = sqliteTable(
  "purchase_orders",
  {
    id: text("id").primaryKey(),
    reference: text("reference").notNull().unique(),
    propertyName: text("property_name").notNull(),
    clientName: text("client_name").notNull().default(""),
    clientEmail: text("client_email").notNull().default(""),
    propertyType: text("property_type").notNull().default("Flat"),
    bedrooms: integer("bedrooms").notNull().default(0),
    beds: integer("beds").notNull().default(0),
    sofaBeds: integer("sofa_beds").notNull().default(0),
    bathrooms: integer("bathrooms").notNull().default(0),
    livingRooms: integer("living_rooms").notNull().default(0),
    guests: integer("guests").notNull().default(0),
    notes: text("notes").notNull().default(""),
    status: text("status", {
      enum: [
        "new",
        "ready_draft",
        "management_review",
        "revision_requested",
        "client_review",
        "client_rejected",
        "client_accepted",
        "purchasing",
        "reconciliation",
        "complete",
      ],
    })
      .notNull()
      .default("new"),
    labourEstimatePence: integer("labour_estimate_pence").notNull().default(0),
    rechargeFeePence: integer("recharge_fee_pence").notNull().default(0),
    readyInvoicePence: integer("ready_invoice_pence").notNull().default(0),
    managementNotes: text("management_notes").notNull().default(""),
    clientDecisionNotes: text("client_decision_notes").notNull().default(""),
    clientInvoiceStatus: text("client_invoice_status", {
      enum: ["not_created", "to_send", "sent", "paid"],
    })
      .notNull()
      .default("not_created"),
    readyInvoiceStatus: text("ready_invoice_status", {
      enum: ["not_requested", "requested", "received", "settled"],
    })
      .notNull()
      .default("not_requested"),
    reconciliationStatus: text("reconciliation_status", {
      enum: [
        "not_started",
        "balanced",
        "ready_refund_due",
        "ready_extra_due",
        "settled",
      ],
    })
      .notNull()
      .default("not_started"),
    createdByEmail: text("created_by_email").notNull(),
    createdByName: text("created_by_name").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_purchase_orders_status_updated").on(table.status, table.updatedAt),
    index("idx_purchase_orders_client_status").on(table.clientEmail, table.status),
    index("idx_purchase_orders_accounts").on(
      table.clientInvoiceStatus,
      table.reconciliationStatus,
    ),
  ],
);

export const purchaseOrderItems = sqliteTable(
  "purchase_order_items",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull(),
    area: text("area").notNull(),
    name: text("name").notNull(),
    requiredQty: integer("required_qty").notNull().default(0),
    inPropertyQty: integer("in_property_qty").notNull().default(0),
    estimateUnitCostPence: integer("estimate_unit_cost_pence").notNull().default(0),
    actualUnitCostPence: integer("actual_unit_cost_pence").notNull().default(0),
    note: text("note").notNull().default(""),
    position: integer("position").notNull().default(0),
  },
  (table) => [
    index("idx_purchase_order_items_order_position").on(
      table.orderId,
      table.position,
    ),
  ],
);

export const purchaseOrderFiles = sqliteTable(
  "purchase_order_files",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id").notNull(),
    itemId: text("item_id").notNull(),
    kind: text("kind", { enum: ["receipt", "photo"] }).notNull(),
    objectKey: text("object_key").notNull().unique(),
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    uploadedByEmail: text("uploaded_by_email").notNull(),
    uploadedByName: text("uploaded_by_name").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("idx_purchase_order_files_item_kind").on(table.itemId, table.kind),
    index("idx_purchase_order_files_order").on(table.orderId),
  ],
);

export const listingHealthTickets = sqliteTable(
  "listing_health_tickets",
  {
    id: text("id").primaryKey(),
    sourceKey: text("source_key").notNull().unique(),
    kind: text("kind", { enum: ["review", "suspension", "visibility", "relisting"] }).notNull(),
    propertyId: text("property_id").notNull().default(""),
    propertyName: text("property_name").notNull(),
    channel: text("channel").notNull(),
    rating: integer("rating"),
    reviewText: text("review_text").notNull().default(""),
    responseUrl: text("response_url").notNull().default(""),
    decisionReason: text("decision_reason").notNull().default(""),
    decision: text("decision", { enum: ["pending", "okay", "relist", "keep"] }).notNull().default("pending"),
    responded: integer("responded", { mode: "boolean" }).notNull().default(false),
    status: text("status", { enum: ["new", "in_progress", "complete"] }).notNull().default("new"),
    createdAt: integer("created_at").notNull(),
    completedAt: integer("completed_at"),
  },
  (table) => [
    index("idx_listing_health_status_created").on(table.status, table.createdAt),
    index("idx_listing_health_property").on(table.propertyId, table.channel),
  ],
);

export const listingHealthDailyReports = sqliteTable(
  "listing_health_daily_reports",
  {
    id: text("id").primaryKey(),
    reportDate: text("report_date").notNull().unique(),
    allVisible: integer("all_visible", { mode: "boolean" }).notNull().default(false),
    noNegativeReviews: integer("no_negative_reviews", { mode: "boolean" }).notNull().default(false),
    completedByEmail: text("completed_by_email").notNull(),
    completedByName: text("completed_by_name").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("idx_listing_daily_report_date").on(table.reportDate)],
);

export const listingHealthChecks = sqliteTable(
  "listing_health_checks",
  {
    id: text("id").primaryKey(),
    checkDate: text("check_date").notNull(),
    propertyId: text("property_id").notNull(),
    propertyName: text("property_name").notNull(),
    airbnbVisible: integer("airbnb_visible", { mode: "boolean" }).notNull().default(false),
    bookingVisible: integer("booking_visible", { mode: "boolean" }).notNull().default(false),
    comfyVisible: integer("comfy_visible", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [uniqueIndex("idx_listing_check_property_date").on(table.propertyId, table.checkDate)],
);

export const pricingGapTickets = sqliteTable(
  "pricing_gap_tickets",
  {
    id: text("id").primaryKey(),
    sourceKey: text("source_key").notNull().unique(),
    propertyId: text("property_id").notNull(),
    propertyName: text("property_name").notNull(),
    gapStart: text("gap_start").notNull(),
    gapEnd: text("gap_end").notNull(),
    nights: integer("nights").notNull(),
    currentPricePence: integer("current_price_pence").notNull().default(0),
    decision: text("decision", { enum: ["pending", "hold", "alter"] }).notNull().default("pending"),
    decisionReason: text("decision_reason").notNull().default(""),
    status: text("status", { enum: ["open", "completed", "filled", "lapsed"] }).notNull().default("open"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("idx_pricing_gap_status_start").on(table.status, table.gapStart)],
);

export const pricingOpportunities = sqliteTable(
  "pricing_opportunities",
  {
    id: text("id").primaryKey(),
    sourceKey: text("source_key").notNull().unique(),
    propertyId: text("property_id").notNull().default(""),
    kind: text("kind", { enum: ["school_holiday", "event", "contractor_work"] }).notNull(),
    title: text("title").notNull(),
    location: text("location").notNull().default(""),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    radiusMiles: integer("radius_miles").notNull().default(30),
    decision: text("decision", { enum: ["pending", "hold", "increase"] }).notNull().default("pending"),
    decisionReason: text("decision_reason").notNull().default(""),
    firstSeenAt: integer("first_seen_at").notNull(),
    lastSeenAt: integer("last_seen_at").notNull(),
  },
  (table) => [index("idx_pricing_opportunity_dates").on(table.startDate, table.endDate)],
);

export const pricingNightDecisions = sqliteTable(
  "pricing_night_decisions",
  {
    id: text("id").primaryKey(),
    sourceKey: text("source_key").notNull().unique(),
    gapTicketId: text("gap_ticket_id").notNull(),
    nightDate: text("night_date").notNull(),
    currentRatePence: integer("current_rate_pence").notNull().default(0),
    decidedRatePence: integer("decided_rate_pence").notNull().default(0),
    decision: text("decision", { enum: ["pending", "hold", "change"] }).notNull().default("pending"),
    reason: text("reason").notNull().default(""),
    pricelabsUpdated: integer("pricelabs_updated", { mode: "boolean" }).notNull().default(false),
    completedAt: integer("completed_at"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("idx_pricing_nights_gap_date").on(table.gapTicketId, table.nightDate)],
);

export const propertyWeeklyPricingScans = sqliteTable(
  "property_weekly_pricing_scans",
  {
    id: text("id").primaryKey(),
    sourceKey: text("source_key").notNull().unique(),
    propertyId: text("property_id").notNull(),
    propertyName: text("property_name").notNull(),
    weekStart: text("week_start").notNull(),
    completedByEmail: text("completed_by_email").notNull(),
    completedByName: text("completed_by_name").notNull(),
    completedAt: integer("completed_at").notNull(),
  },
  (table) => [index("idx_property_weekly_scan_week").on(table.weekStart, table.propertyId)],
);

export const directBookingLeads = sqliteTable(
  "direct_booking_leads",
  {
    id: text("id").primaryKey(),
    sourceKey: text("source_key").notNull().unique(),
    title: text("title").notNull(),
    location: text("location").notNull().default(""),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    details: text("details").notNull().default(""),
    status: text("status", { enum: ["new", "contacted", "won", "closed"] }).notNull().default("new"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("idx_direct_booking_leads_status").on(table.status, table.createdAt)],
);

export const directBookingTickets = sqliteTable(
  "direct_booking_tickets",
  {
    id: text("id").primaryKey(),
    sourceKey: text("source_key").notNull().unique(),
    hostawayReservationId: text("hostaway_reservation_id").notNull().unique(),
    propertyId: text("property_id").notNull().default(""),
    propertyName: text("property_name").notNull(),
    bookerName: text("booker_name").notNull().default(""),
    bookerEmail: text("booker_email").notNull().default(""),
    bookerPhone: text("booker_phone").notNull().default(""),
    arrivalDate: text("arrival_date").notNull(),
    departureDate: text("departure_date").notNull(),
    nights: integer("nights").notNull(),
    originalGrossPence: integer("original_gross_pence").notNull().default(0),
    offeredAmountPence: integer("offered_amount_pence").notNull().default(0),
    status: text("status", { enum: ["new", "contacting", "verbally_agreed", "booking_confirmed", "complete", "archived"] }).notNull().default("new"),
    response: text("response", { enum: ["pending", "accepted", "rejected"] }).notNull().default("pending"),
    invoiceStatus: text("invoice_status", { enum: ["not_created", "to_send", "sent", "settled"] }).notNull().default("not_created"),
    otaCancelled: integer("ota_cancelled", { mode: "boolean" }).notNull().default(false),
    uploadedToHostaway: integer("uploaded_to_hostaway", { mode: "boolean" }).notNull().default(false),
    lastTouchAt: integer("last_touch_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("idx_direct_booking_status_updated").on(table.status, table.updatedAt),
    index("idx_direct_booking_invoice_status").on(table.invoiceStatus, table.updatedAt),
  ],
);

export const directBookingTouches = sqliteTable(
  "direct_booking_touches",
  {
    id: text("id").primaryKey(),
    ticketId: text("ticket_id").notNull(),
    channel: text("channel", { enum: ["phone", "email", "whatsapp"] }).notNull(),
    note: text("note").notNull().default(""),
    createdByEmail: text("created_by_email").notNull(),
    createdByName: text("created_by_name").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [index("idx_direct_booking_touches_ticket").on(table.ticketId, table.createdAt)],
);

export const weeklyPerformanceReports = sqliteTable(
  "weekly_performance_reports",
  {
    id: text("id").primaryKey(),
    sourceKey: text("source_key").notNull().unique(),
    weekStart: text("week_start").notNull(),
    propertyId: text("property_id").notNull(),
    propertyName: text("property_name").notNull(),
    clientEmail: text("client_email").notNull().default(""),
    revenue14dPence: integer("revenue_14d_pence").notNull().default(0),
    summary: text("summary").notNull().default(""),
    priceChanges: text("price_changes").notNull().default("[]"),
    calendarItems: text("calendar_items").notNull().default("[]"),
    createdAt: integer("created_at").notNull(),
    sentAt: integer("sent_at"),
  },
  (table) => [index("idx_weekly_reports_client_week").on(table.clientEmail, table.weekStart)],
);

export const ownerStatementBookings = sqliteTable("owner_statement_bookings", {
  id: text("id").primaryKey(), sourceKey: text("source_key").notNull().unique(), hostawayReservationId: text("hostaway_reservation_id").notNull().default(""), bookingReference: text("booking_reference").notNull().default(""), propertyId: text("property_id").notNull(), propertyName: text("property_name").notNull(), ownerName: text("owner_name").notNull().default(""), ownerEmail: text("owner_email").notNull().default(""), channel: text("channel").notNull(), arrivalDate: text("arrival_date").notNull(), departureDate: text("departure_date").notNull(), grossRevenuePence: integer("gross_revenue_pence").notNull().default(0), cleaningFeePence: integer("cleaning_fee_pence").notNull().default(0), expectedPayoutPence: integer("expected_payout_pence").notNull().default(0), actualReceivedPence: integer("actual_received_pence").notNull().default(0), status: text("status", { enum: ["awaiting", "matched", "partial", "underpaid", "overpaid", "adjustment", "missing", "review"] }).notNull().default("awaiting"), note: text("note").notNull().default(""), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (table) => [index("idx_owner_statement_booking_property_arrival").on(table.propertyId, table.arrivalDate), index("idx_owner_statement_booking_status").on(table.status, table.updatedAt)]);

export const ownerStatementReceipts = sqliteTable("owner_statement_receipts", {
  id: text("id").primaryKey(), sourceKey: text("source_key").notNull().unique(), channel: text("channel").notNull(), payoutReference: text("payout_reference").notNull(), receivedDate: text("received_date").notNull(), amountPence: integer("amount_pence").notNull(), allocatedPence: integer("allocated_pence").notNull().default(0), status: text("status", { enum: ["unmatched", "partially_matched", "matched"] }).notNull().default("unmatched"), importedByEmail: text("imported_by_email").notNull(), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (table) => [index("idx_owner_statement_receipt_status_date").on(table.status, table.receivedDate)]);

export const ownerStatementAllocations = sqliteTable("owner_statement_allocations", {
  id: text("id").primaryKey(), receiptId: text("receipt_id").notNull(), bookingId: text("booking_id").notNull(), amountPence: integer("amount_pence").notNull(), createdByEmail: text("created_by_email").notNull(), createdAt: integer("created_at").notNull(),
}, (table) => [uniqueIndex("idx_owner_statement_allocation_pair").on(table.receiptId, table.bookingId), index("idx_owner_statement_allocation_booking").on(table.bookingId)]);

export const ownerStatements = sqliteTable("owner_statements", {
  id: text("id").primaryKey(), sourceKey: text("source_key").notNull().unique(), propertyId: text("property_id").notNull(), propertyName: text("property_name").notNull(), ownerName: text("owner_name").notNull().default(""), ownerEmail: text("owner_email").notNull().default(""), periodStart: text("period_start").notNull(), periodEnd: text("period_end").notNull(), grossRevenuePence: integer("gross_revenue_pence").notNull().default(0), receivedRevenuePence: integer("received_revenue_pence").notNull().default(0), cleaningCostPence: integer("cleaning_cost_pence").notNull().default(0), managementFeePence: integer("management_fee_pence").notNull().default(0), ownerPayoutPence: integer("owner_payout_pence").notNull().default(0), status: text("status", { enum: ["draft", "issued"] }).notNull().default("draft"), issuedAt: integer("issued_at"), createdByEmail: text("created_by_email").notNull(), createdAt: integer("created_at").notNull(), updatedAt: integer("updated_at").notNull(),
}, (table) => [index("idx_owner_statements_property_period").on(table.propertyId, table.periodStart)]);
