import { env } from "cloudflare:workers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getAccessProfile } from "@/lib/access";
import {
  canUsePropertyDatabase,
  getPropertyDatabaseData,
  importClickUpProperties,
  saveManagementProperty,
  syncPropertiesFromHostaway,
  type ClickUpImportRecord,
} from "@/lib/property-database";

const linkSchema = z.object({
  label: z.string().trim().min(1).max(80),
  url: z.string().trim().url().max(1000),
});

const propertyStatusSchema = z
  .enum(["new_enquiry", "sign_them_up", "onboarding", "live", "archived", "active", "inactive"])
  .transform((value) => value === "active" ? "live" : value === "inactive" ? "archived" : value);

const saveSchema = z.object({
  action: z.literal("save"),
  id: z.string().uuid().optional(),
  propertyName: z.string().trim().min(2).max(200),
  propertyAddress: z.string().trim().max(500).default(""),
  region: z.string().trim().max(120).default(""),
  propertyType: z.string().trim().max(120).default(""),
  bedrooms: z.string().trim().max(40).default(""),
  beds: z.string().trim().max(200).default(""),
  bathrooms: z.string().trim().max(40).default(""),
  wcCount: z.string().trim().max(40).default(""),
  parking: z.string().trim().max(500).default(""),
  garden: z.string().trim().max(500).default(""),
  ownerName: z.string().trim().max(160).default(""),
  ownerCompany: z.string().trim().max(200).default(""),
  ownerEmail: z.union([z.string().trim().email(), z.literal("")]).default(""),
  ownerPhone: z.string().trim().max(80).default(""),
  correspondenceAddress: z.string().trim().max(500).default(""),
  accessCode: z.string().trim().max(300).default(""),
  accessInfo: z.string().trim().max(5000).default(""),
  guidebookUrl: z.union([z.string().trim().url(), z.literal("")]).default(""),
  listingLinks: z.array(linkSchema).max(20).default([]),
  payoutSchedule: z.string().trim().max(500).default(""),
  managementFeePercent: z.number().min(0).max(100).default(0),
  cleaningCostPence: z.number().int().min(0).max(1_000_000).default(0),
  payoutNotes: z.string().trim().max(5000).default(""),
  status: propertyStatusSchema,
});

const importText = z.string().max(250_000).default("");
const clickupImportRecordSchema = z.object({
  clickupTaskId: z.string().min(1).max(100),
  parentTaskId: z.string().max(100).optional(),
  parent: z.string().max(100).optional(),
  clickupUrl: z.string().url().max(1000),
  clickupStatus: z.string().max(120).default(""),
  status: propertyStatusSchema,
  region: z.string().max(120).default(""),
  propertyName: z.string().min(1).max(500),
  propertyAddress: z.string().max(1000).default(""),
  propertyType: z.string().max(200).default(""),
  bedrooms: z.string().max(1000).default(""),
  bathrooms: z.string().max(1000).default(""),
  wcCount: z.string().max(1000).default(""),
  parking: z.string().max(1000).default(""),
  garden: z.string().max(1000).default(""),
  ownerName: z.string().max(300).default(""),
  ownerCompany: z.string().max(300).default(""),
  ownerEmail: z.string().max(300).default(""),
  ownerPhone: z.string().max(160).default(""),
  correspondenceAddress: z.string().max(1000).default(""),
  existingClient: z.string().max(120).default(""),
  currentlyOperating: z.string().max(500).default(""),
  furnishingPreference: z.string().max(500).default(""),
  licensingPreference: z.string().max(500).default(""),
  startPreference: z.string().max(500).default(""),
  enquiryReason: importText,
  additionalNotes: importText,
  descriptionMarkdown: importText,
  textContent: importText,
  priority: z.string().max(80).default(""),
  dueAt: z.string().max(80).default(""),
  createdAt: z.string().max(80).default(""),
  updatedAt: z.string().max(80).default(""),
  customFields: z.record(z.string(), z.string()).default({}),
  checklists: z.array(z.unknown()).default([]),
  comments: z.array(z.unknown()).default([]),
  attachments: z.array(z.unknown()).default([]),
  linkedTaskIds: z.array(z.string()).default([]),
});

const actionSchema = z.discriminatedUnion("action", [
  saveSchema,
  z.object({ action: z.literal("sync") }),
  z.object({
    action: z.literal("import-clickup"),
    records: z.array(clickupImportRecordSchema).min(1).max(500),
  }),
]);

export async function GET() {
  const access = await authorisedProfile();
  if (access instanceof NextResponse) return access;
  return NextResponse.json({ data: await getPropertyDatabaseData(access) });
}

export async function POST(request: Request) {
  const access = migrationProfile(request) || await authorisedProfile();
  if (access instanceof NextResponse) return access;
  if (access.role === "client") {
    return NextResponse.json({ error: "Property database editing access required" }, { status: 403 });
  }
  const parsed = actionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Check the property details" }, { status: 400 });
  }
  try {
    if (parsed.data.action === "sync") {
      await syncPropertiesFromHostaway(access);
    } else if (parsed.data.action === "import-clickup") {
      const summary = await importClickUpProperties(
        access,
        parsed.data.records as ClickUpImportRecord[],
      );
      return NextResponse.json({ ok: true, summary });
    } else {
      await saveManagementProperty(access, parsed.data);
    }
    return NextResponse.json({ ok: true, data: await getPropertyDatabaseData(access) });
  } catch (error) {
    console.error("Property database update failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Property database update failed" },
      { status: 400 },
    );
  }
}

function migrationProfile(request: Request) {
  const supplied = request.headers.get("x-recharge-migration-key");
  if (!env.CLICKUP_MIGRATION_KEY || supplied !== env.CLICKUP_MIGRATION_KEY) return null;
  return {
    email: "enquiries@rechargestays.co.uk",
    fullName: "Recharge migration",
    role: "admin" as const,
    modules: [],
    status: "active" as const,
  };
}

async function authorisedProfile() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const profile = await getAccessProfile(user.email, user.displayName);
  if (!profile || !canUsePropertyDatabase(profile)) {
    return NextResponse.json({ error: "Property database access required" }, { status: 403 });
  }
  return profile;
}
