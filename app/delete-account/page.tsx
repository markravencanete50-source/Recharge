import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { ContactEmail } from "@/components/legal-details";
import { verifiedWorkspaceUser, workspaceSupabase } from "@/lib/supabase-server";
import { deletionCopy, deletionSummarySchema } from "@/lib/privacy-policy";
import { DeleteAccountForm } from "./delete-account-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Delete your account | Recharge", description: "How to delete your Recharge account, and what is deleted and kept." };

// The web address the app stores ask for: how to delete an account, and the deletion itself for
// someone signed in on this browser.
async function signedInSummary() {
  try {
    if (!await verifiedWorkspaceUser()) return null;
    const result = await (await workspaceSupabase())?.rpc("workspace_privacy_read", { section: "deletion" });
    const parsed = deletionSummarySchema.safeParse(result?.data);
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

export default async function DeleteAccount() {
  const summary = await signedInSummary();
  const copy = deletionCopy(summary ?? { role: "", properties: 0, lastSuperAdmin: false });
  return <AuthShell wide eyebrow="Recharge" title="Delete your account" welcome="Your choice."
    intro="You can delete your Recharge account yourself at any time. It can’t be undone."
    footer={<><a href="/privacy">Privacy policy</a><a href="/terms">Terms of use</a><a href="/workspace">Back to Recharge</a></>}>
    <div className="legal-body">
      <section>
        <h2>How to delete your account</h2>
        <ol>
          <li>Sign in to Recharge in the app or at <a href="/workspace">the Recharge workspace</a>.</li>
          <li>Open <strong>Profile &amp; preferences</strong> (your name or picture at the top of the page).</li>
          <li>Choose <strong>Delete my account</strong>, type DELETE and enter your password.</li>
        </ol>
        <p>Or, if you are signed in on this browser, delete it below. Can’t sign in? Email <ContactEmail /> from the address on your account and we will delete it for you.</p>
      </section>
      <section>
        <h2>What is deleted</h2>
        <ul>{copy.deleted.map(line => <li key={line}>{line}</li>)}</ul>
      </section>
      <section>
        <h2>What is kept</h2>
        <ul>{copy.kept.map(line => <li key={line}>{line}</li>)}</ul>
        <p>{copy.properties || "Owners: your properties stay with Recharge, no longer linked to your login. Deleting your account does not end your management agreement: contact Recharge to end it."}</p>
      </section>
      <section>
        <h2>{summary ? "Delete your account now" : "Signed in on this browser?"}</h2>
        {summary
          ? copy.blocked ? <p role="alert" className="auth-alert">{copy.blocked}</p> : <DeleteAccountForm />
          : <p><a href="/sign-in">Sign in</a>, then come back to this page to delete your account here, or use the steps above.</p>}
      </section>
    </div>
  </AuthShell>;
}
