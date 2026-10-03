import { NextResponse } from "next/server";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getAccessProfile } from "@/lib/access";
import { getPurchaseOrderFile } from "@/lib/purchase-orders";
import { privateFileHeaders } from "@/lib/file-response";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const profile = await getAccessProfile(user.email, user.displayName);
  if (!profile) return NextResponse.json({ error: "Access required" }, { status: 403 });
  try {
    const { id } = await context.params;
    const result = await getPurchaseOrderFile(profile, id);
    if (!result) return NextResponse.json({ error: "File not found" }, { status: 404 });
    return new Response(result.object.body, {
      headers: privateFileHeaders(result.row.content_type, result.row.file_name),
    });
  } catch (error) {
    console.error("Purchase order file download failed", error);
    return NextResponse.json({ error: "File could not be downloaded" }, { status: 403 });
  }
}
