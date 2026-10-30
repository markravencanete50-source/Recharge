import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { openAccountLink } from "@/lib/careers-server";
import { CreateAccount } from "./create-account";

// The link in an applicant's "we received your application" email (migration 20261031400000): it makes their account
// (already verified, as the link came to their inbox) and sends them on to choose a password. Good for 30 days.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your application account · Recharge Careers", robots: { index: false, follow: false } };

export default async function CareersAccountPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const token = (await searchParams).t;
  const link = await openAccountLink(token);
  const shell = (title: string, intro: string, body?: React.ReactNode) =>
    <AuthShell eyebrow="Recharge Careers" welcome="Work with us." brandText="Follow your application, choose an interview time, and message our recruitment team." title={title} intro={intro} theme="light">{body ?? <></>}</AuthShell>;
  if (link.state === "invalid") return shell("This link isn't working", "The link may be incomplete or out of date. Please use the latest email from Recharge Careers, or reply to it and we'll send a new one.");
  if (link.state !== "ready") return shell("We couldn't open this link", "Something went wrong on our side. Please try again in a few minutes.");
  return shell(link.hasSignIn ? "Open your account" : "Create your account",
    link.hasSignIn ? `${link.email} already has a Recharge account. We'll add your applications to it, then you can sign in.` : `Your account will use ${link.email}. Next you'll choose a password.`,
    <CreateAccount token={token!} existing={link.hasSignIn} />);
}
