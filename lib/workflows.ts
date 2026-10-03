import { env } from "cloudflare:workers";
import type { AccessProfile } from "@/lib/access";
import type { ModuleId } from "@/lib/modules";
import { createMaintenanceTicket } from "@/lib/maintenance";

export const WORKFLOW_BOARDS = [
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
] as const;

export type WorkflowBoard = (typeof WORKFLOW_BOARDS)[number];
export type WorkflowStatus = "new" | "in_progress" | "complete";
export type ReferralType = "maintenance" | "furnishing" | "inspection";

export type WorkflowTicket = {
  id: string;
  board: WorkflowBoard;
  lane: string;
  sourceBusiness: string;
  targetBusiness: string;
  propertyName: string;
  propertyAddress: string;
  title: string;
  details: string;
  priority: "normal" | "urgent";
  dueDate: string | null;
  status: WorkflowStatus;
  triggerType: "manual_referral" | "onboarding_complete";
  createdByName: string;
  createdAt: number;
};

export type PropertyOnboarding = {
  id: string;
  propertyName: string;
  propertyAddress: string;
  progress: number;
  status: "active" | "complete";
  createdByName: string;
  completedAt: number | null;
  createdAt: number;
};

export type WorkflowData = {
  available: boolean;
  onboardings: PropertyOnboarding[];
  tickets: WorkflowTicket[];
};

const BOARD_MODULES: Record<WorkflowBoard, ModuleId> = {
  spot_maintenance: "maintenance-reporting",
  property_furnishing: "property-furnishing-board",
  new_property_inspection: "new-property-inspection-board",
  routine_bin_garden: "routine-bin-garden-board",
  clean_property_onboarding: "clean-property-onboarding",
  clean_issues: "cleaner-performance",
  aircover_reporting: "aircover-reporting",
  onboarding_invoices: "onboarding-invoices",
  purchase_order_invoices: "purchase-order-invoices",
  purchase_order_accounts: "purchase-order-accounts",
};

const REFERRAL_BOARD: Record<ReferralType, WorkflowBoard> = {
  maintenance: "spot_maintenance",
  furnishing: "property_furnishing",
  inspection: "new_property_inspection",
};

function database() {
  if (!env.DB) throw new Error("Recharge workflow database is unavailable");
  return env.DB;
}

export function canUseStaysWorkflow(profile: AccessProfile) {
  return (
    profile.role === "admin" ||
    profile.modules.some((moduleId) =>
      [
        "property-onboarding",
        "stays-maintenance-reporting",
        "property-database",
      ].includes(moduleId),
    )
  );
}

export function canManageBoard(
  profile: AccessProfile,
  board: WorkflowBoard,
) {
  return (
    profile.role === "admin" || profile.modules.includes(BOARD_MODULES[board])
  );
}

export async function getWorkflowData(
  profile: AccessProfile,
): Promise<WorkflowData> {
  if (profile.role === "client") return emptyWorkflowData(true);

  try {
    const db = database();
    const [onboardingRows, ticketRows] = await Promise.all([
      canUseStaysWorkflow(profile)
        ? db
            .prepare(
              "SELECT id, property_name, property_address, progress, status, created_by_name, completed_at, created_at FROM property_onboardings ORDER BY created_at DESC LIMIT 50",
            )
            .all<{
              id: string;
              property_name: string;
              property_address: string;
              progress: number;
              status: "active" | "complete";
              created_by_name: string;
              completed_at: number | null;
              created_at: number;
            }>()
        : Promise.resolve({ results: [] }),
      db
        .prepare(
          "SELECT id, board, lane, source_business, target_business, property_name, property_address, title, details, priority, due_date, status, trigger_type, created_by_name, created_by_email, created_at FROM workflow_tickets ORDER BY created_at DESC LIMIT 250",
        )
        .all<{
          id: string;
          board: WorkflowBoard;
          lane: string;
          source_business: string;
          target_business: string;
          property_name: string;
          property_address: string;
          title: string;
          details: string;
          priority: "normal" | "urgent";
          due_date: string | null;
          status: WorkflowStatus;
          trigger_type: "manual_referral" | "onboarding_complete";
          created_by_name: string;
          created_by_email: string;
          created_at: number;
        }>(),
    ]);

    const tickets = ticketRows.results
      .filter(
        (ticket) =>
          canManageBoard(profile, ticket.board) ||
          (canUseStaysWorkflow(profile) && ticket.source_business === "Stays"),
      )
      .map(mapTicket);

    return {
      available: true,
      onboardings: onboardingRows.results.map((row) => ({
        id: row.id,
        propertyName: row.property_name,
        propertyAddress: row.property_address,
        progress: row.progress,
        status: row.status,
        createdByName: row.created_by_name,
        completedAt: row.completed_at,
        createdAt: row.created_at,
      })),
      tickets,
    };
  } catch (error) {
    console.error("Unable to load Recharge workflows", error);
    return emptyWorkflowData(false);
  }
}

export async function createReferral(input: {
  type: ReferralType;
  propertyName: string;
  propertyAddress: string;
  title: string;
  details: string;
  priority: "normal" | "urgent";
  dueDate: string | null;
  actorEmail: string;
  actorName: string;
}) {
  if (input.type === "maintenance") {
    await createMaintenanceTicket({
      propertyName: input.propertyName,
      propertyAddress: input.propertyAddress,
      category: "General repair",
      priority: input.priority,
      summary: input.title,
      details: input.details,
      actorEmail: input.actorEmail,
      actorName: input.actorName,
    });
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  const board = REFERRAL_BOARD[input.type];
  await database()
    .prepare(
      "INSERT INTO workflow_tickets (id, board, lane, source_business, target_business, property_name, property_address, title, details, priority, due_date, status, trigger_type, source_onboarding_id, created_by_email, created_by_name, created_at, updated_at) VALUES (?, ?, 'new', 'Stays', 'Ready', ?, ?, ?, ?, ?, ?, 'new', 'manual_referral', NULL, ?, ?, ?, ?)",
    )
    .bind(
      crypto.randomUUID(),
      board,
      input.propertyName.trim(),
      input.propertyAddress.trim(),
      input.title.trim(),
      input.details.trim(),
      input.priority,
      input.dueDate,
      input.actorEmail.trim().toLowerCase(),
      input.actorName,
      now,
      now,
    )
    .run();
}

export async function recordOnboarding(input: {
  propertyName: string;
  propertyAddress: string;
  progress: 25 | 50 | 75 | 100;
  actorEmail: string;
  actorName: string;
}) {
  const db = database();
  const now = Math.floor(Date.now() / 1000);
  const onboardingId = propertyOnboardingKey(
    input.propertyName,
    input.propertyAddress,
  );
  const complete = input.progress === 100;
  const statements = [
    db
      .prepare(
        "INSERT INTO property_onboardings (id, property_name, property_address, progress, status, created_by_email, created_by_name, completed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET property_name = excluded.property_name, property_address = excluded.property_address, progress = MAX(property_onboardings.progress, excluded.progress), status = CASE WHEN property_onboardings.status = 'complete' OR excluded.status = 'complete' THEN 'complete' ELSE 'active' END, completed_at = COALESCE(property_onboardings.completed_at, excluded.completed_at), created_by_email = excluded.created_by_email, created_by_name = excluded.created_by_name, updated_at = excluded.updated_at",
      )
      .bind(
        onboardingId,
        input.propertyName.trim(),
        input.propertyAddress.trim(),
        input.progress,
        complete ? "complete" : "active",
        input.actorEmail.trim().toLowerCase(),
        input.actorName,
        complete ? now : null,
        now,
        now,
      ),
  ];

  if (complete) {
    statements.push(
      automatedTicketStatement(db, {
        id: crypto.randomUUID(),
        board: "routine_bin_garden",
        lane: "to_schedule",
        targetBusiness: "Ready",
        propertyName: input.propertyName,
        propertyAddress: input.propertyAddress,
        title: "Add property to bin and garden cycle",
        details:
          "Property onboarding reached 100%. Review the property and add its bin collection and garden maintenance requirements to the recurring cycle.",
        onboardingId,
        actorEmail: input.actorEmail,
        actorName: input.actorName,
        now,
      }),
      automatedTicketStatement(db, {
        id: crypto.randomUUID(),
        board: "clean_property_onboarding",
        lane: "new_enquiry",
        targetBusiness: "Cleans",
        propertyName: input.propertyName,
        propertyAddress: input.propertyAddress,
        title: "New property cleaning enquiry",
        details:
          "Property onboarding reached 100%. Contact the Stays team and begin the Recharge Cleans onboarding process.",
        onboardingId,
        actorEmail: input.actorEmail,
        actorName: input.actorName,
        now,
      }),
    );
  }

  await db.batch(statements);
}

export async function updateTicketStatus(input: {
  id: string;
  status: WorkflowStatus;
  profile: AccessProfile;
}) {
  const db = database();
  const ticket = await db
    .prepare("SELECT board, source_onboarding_id FROM workflow_tickets WHERE id = ? LIMIT 1")
    .bind(input.id)
    .first<{ board: WorkflowBoard; source_onboarding_id: string | null }>();

  if (!ticket) throw new Error("Ticket not found");
  if (!canManageBoard(input.profile, ticket.board)) {
    throw new Error("You do not have access to this board");
  }

  const statements = [db.prepare("UPDATE workflow_tickets SET status = ?, lane = CASE WHEN board = 'onboarding_invoices' THEN CASE ? WHEN 'new' THEN 'new_invoice' WHEN 'in_progress' THEN 'invoice_sent' ELSE 'invoice_settled' END ELSE lane END, updated_at = unixepoch() WHERE id = ?").bind(input.status,input.status,input.id)];
  if (ticket.board === "onboarding_invoices" && ticket.source_onboarding_id) statements.push(db.prepare("UPDATE onboarding_cases SET onboarding_invoice_status = ?, updated_at = unixepoch() WHERE id = ?").bind(input.status === "complete" ? "settled" : "pending",ticket.source_onboarding_id));
  await db.batch(statements);
}

function automatedTicketStatement(
  db: ReturnType<typeof database>,
  input: {
    id: string;
    board: WorkflowBoard;
    lane: string;
    targetBusiness: "Ready" | "Cleans";
    propertyName: string;
    propertyAddress: string;
    title: string;
    details: string;
    onboardingId: string;
    actorEmail: string;
    actorName: string;
    now: number;
  },
) {
  return db
    .prepare(
      "INSERT INTO workflow_tickets (id, board, lane, source_business, target_business, property_name, property_address, title, details, priority, due_date, status, trigger_type, source_onboarding_id, created_by_email, created_by_name, created_at, updated_at) VALUES (?, ?, ?, 'Stays', ?, ?, ?, ?, ?, 'normal', NULL, 'new', 'onboarding_complete', ?, ?, ?, ?, ?) ON CONFLICT(source_onboarding_id, board) DO NOTHING",
    )
    .bind(
      input.id,
      input.board,
      input.lane,
      input.targetBusiness,
      input.propertyName.trim(),
      input.propertyAddress.trim(),
      input.title,
      input.details,
      input.onboardingId,
      input.actorEmail.trim().toLowerCase(),
      input.actorName,
      input.now,
      input.now,
    );
}

function mapTicket(row: {
  id: string;
  board: WorkflowBoard;
  lane: string;
  source_business: string;
  target_business: string;
  property_name: string;
  property_address: string;
  title: string;
  details: string;
  priority: "normal" | "urgent";
  due_date: string | null;
  status: WorkflowStatus;
  trigger_type: "manual_referral" | "onboarding_complete";
  created_by_name: string;
  created_at: number;
}): WorkflowTicket {
  return {
    id: row.id,
    board: row.board,
    lane: row.lane,
    sourceBusiness: row.source_business,
    targetBusiness: row.target_business,
    propertyName: row.property_name,
    propertyAddress: row.property_address,
    title: row.title,
    details: row.details,
    priority: row.priority,
    dueDate: row.due_date,
    status: row.status,
    triggerType: row.trigger_type,
    createdByName: row.created_by_name,
    createdAt: row.created_at,
  };
}

function emptyWorkflowData(available: boolean): WorkflowData {
  return { available, onboardings: [], tickets: [] };
}

function propertyOnboardingKey(propertyName: string, propertyAddress: string) {
  const normalise = (value: string) =>
    value.trim().toLowerCase().replace(/\s+/g, " ");
  return `property:${normalise(propertyName)}|${normalise(propertyAddress)}`;
}
