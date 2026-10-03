import { NextResponse } from "next/server";
import { z } from "zod";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getAccessAccount, registerAccessRequest } from "@/lib/access";

const schema = z.object({
  fullName: z.string().trim().min(2).max(160),
  role: z.enum(["admin", "stays", "cleans", "ready", "client"]),
});

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });

  const existing = await getAccessAccount(user.email, user.displayName);
  if (existing) {
    return NextResponse.json({ ok: true, status: existing.status });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Enter your full name and select an account type" },
      { status: 400 },
    );
  }

  const account = await registerAccessRequest({
    email: user.email,
    fullName: parsed.data.fullName,
    role: parsed.data.role,
  });

  return NextResponse.json({ ok: true, status: account.status });
}
