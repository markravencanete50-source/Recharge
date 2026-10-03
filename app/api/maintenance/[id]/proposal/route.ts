import { NextResponse } from "next/server";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getAccessProfile } from "@/lib/access";
import { buildMaintenanceProposalPdf } from "@/lib/maintenance-pdf";
import {
  canUseMaintenance,
  getMaintenanceTicketForProfile,
} from "@/lib/maintenance";

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
  const ticket = await getMaintenanceTicketForProfile(profile, id);
  if (!ticket) return NextResponse.json({ error: "Maintenance ticket not found" }, { status: 404 });
  if (ticket.quoteAmountPence === null || !ticket.workRequired) {
    return NextResponse.json({ error: "Add the Ready quote before downloading the proposal" }, { status: 400 });
  }

  const pdf = buildMaintenanceProposalPdf(ticket);
  return new Response(pdf, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="Recharge-${ticket.reference}-repair-proposal.pdf"`,
      "cache-control": "private, no-store",
    },
  });
}
