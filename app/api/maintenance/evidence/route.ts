import { NextResponse } from "next/server";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getAccessProfile } from "@/lib/access";
import {
  canUseMaintenance,
  getMaintenanceData,
  uploadMaintenanceEvidence,
  type EvidenceKind,
} from "@/lib/maintenance";

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const profile = await getAccessProfile(user.email, user.displayName);
  if (!profile || !canUseMaintenance(profile)) {
    return NextResponse.json({ error: "Maintenance access required" }, { status: 403 });
  }

  const form = await request.formData().catch(() => null);
  const ticketId = String(form?.get("ticketId") || "");
  const kind = String(form?.get("kind") || "") as EvidenceKind;
  const file = form?.get("file");
  if (!ticketId || !["issue", "completion", "invoice"].includes(kind) || !(file instanceof File)) {
    return NextResponse.json({ error: "Choose a valid evidence file" }, { status: 400 });
  }

  try {
    await uploadMaintenanceEvidence(profile, { ticketId, kind, file });
    return NextResponse.json({ ok: true, data: await getMaintenanceData(profile) });
  } catch (error) {
    console.error("Maintenance evidence upload failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Evidence upload failed" },
      { status: 400 },
    );
  }
}
