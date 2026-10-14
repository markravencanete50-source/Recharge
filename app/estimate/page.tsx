import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AuthShell } from "@/components/auth-shell";
import { openEstimatePage } from "@/lib/estimate-link-server";
import { EstimateView } from "./estimate-view";

// The free performance estimate a client opens from the email the team sent (migration 20261019520000).
// No account is needed: the private link is the key. They explore it and tell us how they would like to go ahead.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your estimate · Recharge", robots: { index: false, follow: false } };

export default async function EstimatePage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const token = (await searchParams).t;
  const page = await openEstimatePage(token);
  const shell = (title: string, intro: string, body?: ReactNode) =>
    <AuthShell eyebrow="Recharge Property Management" welcome="Your free performance estimate." brandText="Short-term letting, cleaning, maintenance and compliance across Scotland."
      title={title} intro={intro} wide>{body}</AuthShell>;
  if (page.state === "invalid") return shell("This link isn’t working", "The link may be incomplete or out of date. Please use the latest email from Recharge, or reply to it and we’ll send a new one.");
  if (page.state === "unavailable") return shell("We couldn’t open your estimate", "Something went wrong on our side. Please try again in a few minutes.");
  if (page.state === "expired") return shell("This link has expired", "Reply to the email from Recharge and we’ll send you a new link.");
  if (page.state === "withdrawn") return shell("This estimate is being updated", "The team is working on it. You’ll get a new email from Recharge when it’s ready.");
  const first = page.name.trim().split(/\s+/)[0];
  return shell(`Your estimate for ${page.propertyName}`, `${first ? `Hello ${first}. ` : ""}Here is what we think the property could earn. Explore the figures, then tell us how you would like to go ahead.`,
    <EstimateView token={token!} state={page.state} estimate={page.estimate} followUpOn={page.followUpOn} />);
}
