import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AuthShell } from "@/components/auth-shell";
import { openStaySurvey } from "@/lib/stay-reason-server";
import { stayDates, surveyTap } from "@/lib/stay-reason";
import { SurveyView } from "./survey-view";

// The short survey a guest opens from the email after a direct stay (migration 20261021800000). No account is needed: the
// link is the key, for one stay, for 30 days. The page shows only the property name and the stay dates. A tap in the
// email (a rating or a reason) opens the page with that answer chosen, and the page records it.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your stay · Recharge", robots: { index: false, follow: false } };

export default async function StaySurveyPage({ searchParams }: { searchParams: Promise<{ t?: string; rating?: string; reason?: string }> }) {
  const query = await searchParams;
  const page = await openStaySurvey(query.t);
  const shell = (title: string, intro: string, body?: ReactNode) =>
    <AuthShell eyebrow="Recharge Property Management" welcome="Thank you for staying with us." brandText="Short-term letting, cleaning, maintenance and compliance across Scotland."
      title={title} intro={intro} theme="light">{body}</AuthShell>;
  if (page.state === "open" || page.state === "thanks") return shell("How was your stay?", `${page.propertyName}, ${stayDates(page.checkIn, page.checkOut)}.`, <SurveyView token={query.t!} tap={surveyTap(query)} />);
  if (page.state === "invalid") return shell("This link isn’t working", "The link may be incomplete. Please use the link in the email from Recharge.");
  if (page.state === "unavailable") return shell("We couldn’t open this page", "Something went wrong on our side. Please try again in a few minutes.");
  return shell("This link has expired", "Thank you all the same. If you would like to tell us about your stay, just reply to our email.");
}
