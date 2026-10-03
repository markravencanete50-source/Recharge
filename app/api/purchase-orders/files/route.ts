import { NextResponse } from "next/server";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getAccessProfile } from "@/lib/access";
import {
  canUsePurchaseOrders,
  getPurchaseOrderData,
  uploadPurchaseOrderFile,
} from "@/lib/purchase-orders";

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const profile = await getAccessProfile(user.email, user.displayName);
  if (!profile || !canUsePurchaseOrders(profile)) {
    return NextResponse.json({ error: "Purchase order access required" }, { status: 403 });
  }
  const form = await request.formData().catch(() => null);
  const orderId = String(form?.get("orderId") || "");
  const itemId = String(form?.get("itemId") || "");
  const kind = String(form?.get("kind") || "") as "receipt" | "photo";
  const file = form?.get("file");
  if (!orderId || !itemId || !["receipt", "photo"].includes(kind) || !(file instanceof File)) {
    return NextResponse.json({ error: "Choose a valid receipt or item photo" }, { status: 400 });
  }
  try {
    await uploadPurchaseOrderFile(profile, { orderId, itemId, kind, file });
    return NextResponse.json({ ok: true, data: await getPurchaseOrderData(profile) });
  } catch (error) {
    console.error("Purchase order evidence upload failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Evidence upload failed" },
      { status: 400 },
    );
  }
}
