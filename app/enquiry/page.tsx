import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AuthShell } from "@/components/auth-shell";
import { openEnquiryForm } from "@/lib/client-enquiry-server";
import { EnquiryForm } from "./enquiry-form";

// The New Property Enquiry Form. Anyone can open it at /enquiry (Alex's onboarding framework, migration 20261025200000);
// a private link the team emails (?t=) still works once and fills in their name and email. No account is needed.
// Always in the light theme (Alex), whatever the browser or the app is set to.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "New property enquiry · Recharge", robots: { index: false, follow: false } };

export default async function EnquiryPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const token = (await searchParams).t;
  const shell = (title: string, intro: string, body?: ReactNode) =>
    <AuthShell eyebrow="Recharge Property Management" welcome="Let’s talk about your property." brandText="Short-term letting, cleaning, maintenance and compliance across Scotland, with a free performance estimate to start."
      title={title} intro={intro} wide theme="light">{body}</AuthShell>;
  const intro = "Please fill out the details below and a member of the team shall be in touch with our FREE performance estimate!";
  // The open form: no link, so a form of its own is made when they first upload a photo or send it.
  if (!token) return shell("New Property Enquiry Form", intro, <EnquiryForm token={null} name="" email="" files={[]} />);
  const form = await openEnquiryForm(token);
  if (form.state === "invalid") return shell("This link isn’t working", "The link may be incomplete or out of date. Please use the latest email from Recharge, or reply to it and we’ll send a new one.");
  if (form.state === "unavailable") return shell("We couldn’t open the form", "Something went wrong on our side. Please try again in a few minutes.");
  if (form.state === "answered") return shell("Thank you, we have your details", "A member of the team will be in touch with your free performance estimate.");
  if (form.state === "expired") return shell("This link has expired", "Reply to the email from Recharge and we’ll send you a new link.");
  if (form.state === "closed") return shell("This enquiry is closed", "If you’d still like a free performance estimate, reply to the email from Recharge.");
  return shell("New Property Enquiry Form", intro,
    <EnquiryForm token={token} name={form.name} email={form.email} files={form.files} />);
}
