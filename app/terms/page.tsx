import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { ContactEmail, LegalIdentity } from "@/components/legal-details";
import { legalDetails } from "@/lib/legal-details";
import { BUSINESS_RECORD_YEARS } from "@/lib/privacy-policy";

export const metadata: Metadata = { title: "Terms of use | Recharge", description: "The terms for using the Recharge workspace app and website." };

export default function Terms() {
  return <AuthShell wide eyebrow="Recharge" title="Terms of use" welcome="Fair use."
    intro={<>The rules for using the Recharge workspace app and website. Last updated: {legalDetails.lastUpdated}.</>}
    footer={<><a href="/privacy">Privacy policy</a><a href="/delete-account">Delete your account</a><a href="/workspace">Back to Recharge</a></>}>
    <div className="legal-body">
      <section>
        <h2>About these terms</h2>
        <p>The Recharge workspace is provided by {legalDetails.legalName}, trading as {legalDetails.tradingName}. By creating an account, signing in or choosing a password you agree to these terms. Our <a href="/privacy">privacy policy</a> explains how we use personal data.</p>
        <LegalIdentity />
      </section>

      <section>
        <h2>Who can use Recharge</h2>
        <p>Recharge is a business tool for our team, our contractors and the owners of properties we manage. You must be 18 or over. An administrator approves each account and chooses what it can see.</p>
      </section>

      <section>
        <h2>Your account and role</h2>
        <ul>
          <li>Your role and tools decide what you can see and do. Use only the access you have been given.</li>
          <li>Keep your password to yourself and tell us straight away if you think someone else has used your account. You are responsible for what is done with it.</li>
          <li>We may pause, limit or block an account to keep the workspace safe or if these terms are broken.</li>
          <li>If you work for us or with us, these terms sit alongside your employment or service agreement; if they conflict, that agreement wins.</li>
        </ul>
      </section>

      <section>
        <h2>Acceptable use</h2>
        <p>You must not:</p>
        <ul>
          <li>share access codes, key-safe numbers, platform logins or guests’ details with anyone who does not need them for the work;</li>
          <li>use guests’ details for anything other than their stay;</li>
          <li>upload anything unlawful, offensive or that you do not have the right to share, or take photos of people without good reason;</li>
          <li>try to reach data or tools you have not been given, test or get round our security, or overload, copy or scrape the service;</li>
          <li>use the messages to harass or mislead anyone.</li>
        </ul>
      </section>

      <section>
        <h2>Owners’ data and Recharge’s records</h2>
        <p>Owners keep ownership of the information they give us about themselves and their properties, and can download a copy of their data at any time. The records Recharge makes while managing a property (work, bookings, photos, invoices, expenses, statements and messages) are Recharge’s business records. We keep them for {BUSINESS_RECORD_YEARS} years, as UK law requires, even after an account is deleted. Your management agreement sets out the commercial terms between you and Recharge and wins if it conflicts with these terms.</p>
        <p>Deleting an owner’s account does not end the management agreement. The properties stay with Recharge until the agreement is ended in the way it describes.</p>
      </section>

      <section>
        <h2>What you add</h2>
        <p>You keep the rights in photos, notes and messages you add. You let us use them to run the service and keep our records, and you confirm you are allowed to share them.</p>
      </section>

      <section>
        <h2>Availability and changes</h2>
        <p>We work to keep Recharge available and accurate, but it may sometimes be unavailable for maintenance or reasons outside our control, and features may change. Keep anything urgent, such as a guest emergency, to the phone.</p>
      </section>

      <section>
        <h2>Our liability</h2>
        <p>To the extent the law allows, we are not liable for indirect or consequential loss, or for loss caused by events outside our reasonable control. For owners, the liability terms in the management agreement apply. Nothing in these terms limits liability for death or personal injury caused by negligence, for fraud, or for anything else the law does not allow us to limit.</p>
      </section>

      <section>
        <h2>Ending your use</h2>
        <p>You can delete your account at any time from Profile &amp; preferences in the app or on the <a href="/delete-account">account deletion page</a>. We may close accounts that break these terms or are no longer needed.</p>
      </section>

      <section>
        <h2>Changes to these terms</h2>
        <p>We may update these terms. We will tell you in the app about important changes, and the date at the top of this page shows when they last changed.</p>
      </section>

      <section>
        <h2>Law and courts</h2>
        <p>These terms are governed by Scots law, and the courts of Scotland deal with any dispute. If you live elsewhere in the UK, you may also use your local courts.</p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>Email <ContactEmail />, or write to {legalDetails.legalName}, {legalDetails.registeredAddress}.</p>
      </section>
    </div>
  </AuthShell>;
}
