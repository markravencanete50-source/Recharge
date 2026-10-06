import { isWorkspaceAdmin } from "@/lib/modules";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getAccessProfile } from "@/lib/access";
import {
  saveCommunicationWorkflow,
  updateCommunicationWorkflowStatus,
} from "@/lib/communications";

const createSchema = z.object({
  name: z.string().trim().min(3).max(160),
  channel: z.enum(["all", "guests", "email", "whatsapp", "phone"]),
  triggerText: z.string().trim().min(3).max(1500),
  instructions: z.string().trim().min(5).max(8000),
  approvedResponse: z.string().trim().max(5000).default(""),
  escalationTarget: z.enum(["none", "ready", "cleans"]),
  priority: z.enum(["standard", "urgent"]),
});

const updateSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["active", "inactive"]),
});

async function requireAdmin() {
  const user = await getChatGPTUser();
  if (!user) return null;
  const profile = await getAccessProfile(user.email, user.displayName);
  return isWorkspaceAdmin(profile?.role) ? profile : null;
}

export async function POST(request: Request) {
  const actor = await requireAdmin();
  if (!actor) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const parsed = createSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Check the workflow details and try again" },
      { status: 400 },
    );
  }

  await saveCommunicationWorkflow({
    ...parsed.data,
    actorEmail: actor.email,
    actorName: actor.fullName,
  });
  return NextResponse.json({ ok: true });
}

export async function PATCH(request: Request) {
  const actor = await requireAdmin();
  if (!actor) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const parsed = updateSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid workflow update" }, { status: 400 });
  }

  await updateCommunicationWorkflowStatus(parsed.data);
  return NextResponse.json({ ok: true });
}
