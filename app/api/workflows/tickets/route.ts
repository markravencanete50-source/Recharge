import { NextResponse } from "next/server";
import { z } from "zod";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getAccessProfile } from "@/lib/access";
import { getWorkflowData, updateTicketStatus } from "@/lib/workflows";

const ticketSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["new", "in_progress", "complete"]),
});

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const profile = await getAccessProfile(user.email, user.displayName);
  if (!profile || profile.role === "client") return NextResponse.json({ error: "Team access required" }, { status: 403 });
  return NextResponse.json({ data: await getWorkflowData(profile) });
}

export async function PATCH(request: Request) {
  const user = await getChatGPTUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const profile = await getAccessProfile(user.email, user.displayName);
  if (!profile || profile.role === "client") {
    return NextResponse.json(
      { error: "Team access required" },
      { status: 403 },
    );
  }

  const parsed = ticketSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid ticket update" }, { status: 400 });
  }

  try {
    await updateTicketStatus({ ...parsed.data, profile });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Update failed" },
      { status: 403 },
    );
  }
}
