import { NextResponse } from "next/server";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getAccessProfile } from "@/lib/access";
import { canUseMaintenance, getMaintenanceEvidence } from "@/lib/maintenance";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const profile = await getAccessProfile(user.email, user.displayName);
  if (!profile || !canUseMaintenance(profile)) {
    return NextResponse.json({ error: "Maintenance access required" }, { status: 403 });
  }
  const { id } = await context.params;
  try {
    const result = await getMaintenanceEvidence(profile, id);
    if (!result) return NextResponse.json({ error: "Evidence not found" }, { status: 404 });
    const safeName = result.row.file_name.replace(/["\r\n]/g, "");
    return new Response(result.object.body, {
      headers: {
        "content-type": result.row.content_type,
        "content-disposition": `attachment; filename="${safeName}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("Maintenance evidence download failed", error);
    return NextResponse.json({ error: "Evidence could not be downloaded" }, { status: 403 });
  }
}
