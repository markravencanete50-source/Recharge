import { NextResponse } from "next/server";
import { z } from "zod";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getAccessProfile, removeAccessUser, saveAccessUser } from "@/lib/access";
import { MODULE_IDS } from "@/lib/modules";

const accessSchema = z.object({
  email: z.string().trim().email().max(254),
  fullName: z.string().trim().min(2).max(120),
  responsibilities: z.string().trim().max(5000).default(""),
  role: z.enum(["admin", "stays", "cleans", "ready", "client"]),
  status: z.enum(["active", "pending", "revoked"]),
  modules: z.array(z.enum(MODULE_IDS)),
});

export async function POST(request: Request) {
  const signedInUser = await getChatGPTUser();
  if (!signedInUser) {
    return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  }

  const actor = await getAccessProfile(
    signedInUser.email,
    signedInUser.displayName,
  );
  if (actor?.role !== "admin") {
    return NextResponse.json(
      { error: "Admin access required" },
      { status: 403 },
    );
  }

  const parsed = accessSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid access details" },
      { status: 400 },
    );
  }

  if (
    parsed.data.status === "active" &&
    parsed.data.role !== "admin" &&
    parsed.data.modules.length === 0
  ) {
    return NextResponse.json(
      { error: "Select at least one tool for an active account" },
      { status: 400 },
    );
  }

  try {
    await saveAccessUser(parsed.data);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Access could not be saved",
      },
      { status: 400 },
    );
  }
}

export async function DELETE(request: Request) {
  const signedInUser = await getChatGPTUser();
  if (!signedInUser) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const actor = await getAccessProfile(signedInUser.email, signedInUser.displayName);
  if (actor?.role !== "admin") return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  const parsed = z.object({ email: z.string().trim().email().max(254) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid team member" }, { status: 400 });
  try {
    await removeAccessUser(parsed.data.email);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Team member could not be removed" }, { status: 400 });
  }
}
