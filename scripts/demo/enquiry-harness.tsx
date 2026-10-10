import { createRoot } from "react-dom/client";
import { AuthShell } from "@/components/auth-shell";
import { designTokenCss } from "@/lib/design-tokens";
import { EnquiryForm } from "@/app/enquiry/enquiry-form";

// A client-rendered copy of app/enquiry/page.tsx for the local review backend (build-enquiry-harness.mjs).
const { token, form } = (window as unknown as { __ENQUIRY__: { token: string; form: { state: string; name?: string; email?: string; files?: [] } } }).__ENQUIRY__;
const shell = (title: string, intro: string, body?: React.ReactNode) =>
  <><style>{designTokenCss}</style><AuthShell eyebrow="Recharge Property Management" welcome="Let’s talk about your property." brandText="Short-term letting, cleaning, maintenance and compliance across Scotland, with a free performance estimate to start."
    title={title} intro={intro} wide>{body}</AuthShell></>;
const page = form.state === "invalid" ? shell("This link isn’t working", "The link may be incomplete or out of date.")
  : form.state === "answered" ? shell("Thank you, we have your details", "A member of the team will be in touch with your free performance estimate.")
  : form.state === "expired" ? shell("This link has expired", "Reply to the email from Recharge and we’ll send you a new link.")
  : form.state === "closed" ? shell("This enquiry is closed", "If you’d still like a free performance estimate, reply to the email from Recharge.")
  : form.state !== "open" ? shell("We couldn’t open the form", "Something went wrong on our side.")
  : shell("New Property Enquiry Form", "Please fill out the details below and a member of the team shall be in touch with our FREE performance estimate!", <EnquiryForm token={token} name={form.name!} email={form.email!} files={form.files ?? []} />);
createRoot(document.getElementById("root")!).render(page);
