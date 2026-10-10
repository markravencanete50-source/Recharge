import type { Metadata } from "next";
import { AuthShell } from "@/components/auth-shell";
import { ContactEmail, LegalIdentity } from "@/components/legal-details";
import { legalDetails } from "@/lib/legal-details";
import { BUSINESS_RECORD_YEARS } from "@/lib/privacy-policy";

export const metadata: Metadata = { title: "Privacy policy | Recharge", description: "How Recharge collects, uses, keeps and protects personal data." };

// The privacy policy for the Recharge workspace (app and website). Retention periods match the
// daily job in supabase/migrations/20261010100000_privacy_compliance.sql.
export default function Privacy() {
  return <AuthShell wide eyebrow="Recharge" title="Privacy policy" welcome="Your data."
    intro={<>How {legalDetails.tradingName} collects, uses, keeps and protects personal data in the Recharge workspace app and website. Last updated: {legalDetails.lastUpdated}.</>}
    footer={<><a href="/terms">Terms of use</a><a href="/delete-account">Delete your account</a><a href="/workspace">Back to Recharge</a></>}>
    <div className="legal-body">
      <section>
        <h2>Who we are</h2>
        <p>Recharge manages short-let properties in Scotland for their owners. We run the Recharge workspace, which our team, our contractors and property owners use to manage stays, cleans, repairs and money. For the personal data described here, we are the controller under the UK General Data Protection Regulation (UK GDPR) and the Data Protection Act 2018.</p>
        <LegalIdentity />
      </section>

      <section>
        <h2>Who this policy covers</h2>
        <ul>
          <li><strong>Our team and contractors</strong>: people with a Stays, Cleans, cleaning manager, Ready, Accounts, admin or super admin account.</li>
          <li><strong>Property owners</strong> who use Recharge to follow their properties, statements and onboarding.</li>
          <li><strong>Guests</strong> who stay at a property we manage, whose bookings and messages we record.</li>
          <li><strong>Suppliers and tradespeople</strong> named on quotes, invoices and expenses.</li>
        </ul>
      </section>

      <section>
        <h2>What we collect</h2>
        <h3>Everyone with an account</h3>
        <ul>
          <li>Your name, the name you show in the app, your avatar choice, your email address and, if you use it, your phone number.</li>
          <li>Your password, which our sign-in provider stores in scrambled (hashed) form. We never see it.</li>
          <li>Your role, the tools you can use and the properties you are assigned to.</li>
          <li>Sign-in and security records: when you signed in, failed password attempts and lockouts. These are linked to a scrambled version of your email or phone number, and request limits use a scrambled version of your network address.</li>
          <li>The browsers and phones you allow to show notifications (a delivery address and keys from your browser), and the notifications we send you.</li>
          <li>Messages you write in Recharge and anything you type into forms.</li>
        </ul>
        <h3>Our team and contractors</h3>
        <ul>
          <li>Work you are given or do: cleans, repairs, inspections, deliveries, pricing and listing checks, with notes and times.</li>
          <li>Photos you take as evidence of work, with the property and time they were taken.</li>
          <li>Shift clock-ins and clock-outs, daily sign-offs, training you have completed and staff contracts you have signed (your typed name and the time).</li>
          <li>Reviews of cleans and performance figures, cleaner rates, and expenses and receipts you submit.</li>
        </ul>
        <h3>Property owners</h3>
        <ul>
          <li>Your contact details, your property’s address and details, and access instructions.</li>
          <li>Your onboarding: estimates, your answers in the set-up form, the management agreement you signed (your typed name and the time), questions you ask and our answers.</li>
          <li>Your payout bank details (account holder, sort code and account number). These are kept apart from everything else; only Accounts and administrators can see them in full, and you see them with only the last digits showing.</li>
          <li>Owner statements, invoices, repair approvals and messages with Recharge.</li>
        </ul>
        <h3>Guests</h3>
        <ul>
          <li>Your name, booking reference, dates, number of guests, the platform you booked through and the payout for the stay.</li>
          <li>Messages between you and us about your stay.</li>
          <li>We get these from the booking platform or channel manager, or our team enters them. We never receive your payment card details.</li>
        </ul>
        <h3>Suppliers and tradespeople</h3>
        <ul><li>Names and contact details on quotes, invoices and expenses, and the work you did.</li></ul>
      </section>

      <section>
        <h2>Why we use it, and our lawful basis</h2>
        <ul>
          <li><strong>To provide the workspace and carry out our contracts</strong> (contract): the management agreement with owners, and the employment or service agreement with our team and contractors. This covers accounts, work, schedules, photos, statements, payouts and messages.</li>
          <li><strong>To keep records the law requires</strong> (legal obligation): accounting and tax records, invoices and statements, and records needed for short-let licensing.</li>
          <li><strong>To keep accounts and data safe</strong> (legitimate interests): password lockouts, request limits, sign-in approvals and a record of access changes.</li>
          <li><strong>To run stays for owners</strong> (legitimate interests): recording guests’ bookings and answering their messages, which guests expect when they book.</li>
          <li><strong>To check quality and support our team</strong> (legitimate interests): reviews of cleans, performance figures and training.</li>
          <li><strong>To tell you about updates</strong> (legitimate interests): notifications in the app, and in your browser if you switch them on. You can switch browser notifications off at any time.</li>
        </ul>
        <p>We do not sell personal data, show advertising or use tracking analytics, and we make no decisions about you by automated means alone.</p>
      </section>

      <section>
        <h2>Who we share it with</h2>
        <p>These service providers process data for us, under contract and only on our instructions:</p>
        <ul>
          <li><strong>Supabase</strong>: our database, sign-in and private file storage.</li>
          <li><strong>Cloudflare</strong>: hosting for the website and the app’s server, security and scheduled jobs.</li>
          <li><strong>Your browser’s push service</strong> (for example Google, Mozilla, Apple or Microsoft), only if you switch on browser notifications. It carries a short notice with no property names, addresses, money or codes.</li>
        </ul>
        <p>The team’s app also looks up property postcodes with <strong>postcodes.io</strong>, a free service built on open UK postcode data, to show a property’s area and place it on the map. Only the postcode is sent, never the rest of the address or anyone’s name.</p>
        <p>When we connect them, these also process data for us:</p>
        <ul>
          <li><strong>Hostaway</strong> (channel manager): bookings, guest names and guest messages.</li>
          <li><strong>Cloudinary</strong>: storage for work photos, instead of Supabase.</li>
          <li><strong>Resend</strong>: notification emails.</li>
          <li><strong>Expo push service</strong>: notifications on phones.</li>
          <li><strong>The text message provider set up with our sign-in provider</strong>: codes sent by text message.</li>
          <li><strong>Xero</strong>: accounting records for expenses.</li>
        </ul>
        <p>Booking platforms such as Airbnb and Booking.com are separate controllers with their own privacy policies. We may also share data with our professional advisers, with authorities such as HMRC or a licensing authority where the law requires it, and with a buyer if our business is sold.</p>
        <p>Inside Recharge, people see only what their role needs: for example, owners see the work done at their own properties, and cleaners see the cleans they are given.</p>
      </section>

      <section>
        <h2>International transfers</h2>
        <p>Our database, sign-in records and private files are stored with Supabase in Mumbai, India. India does not have UK adequacy regulations, so for that transfer we rely on the UK Addendum to the EU standard contractual clauses in Supabase’s data processing agreement, and we have assessed the risks of the transfer. Cloudflare and our other providers also process some data outside the UK, including in the European Economic Area and the United States. When they do, we rely on UK adequacy regulations (including the UK extension to the EU-US Data Privacy Framework where the provider is certified) or on the UK International Data Transfer Agreement or the UK Addendum.</p>
      </section>

      <section>
        <h2>How long we keep it</h2>
        <dl className="legal-retention">
          <div><dt>Your account details</dt><dd>While your account is open. When you delete your account, your name, email, phone number and password are removed straight away and your profile becomes “Deleted user”.</dd></div>
          <div><dt>Notifications you have read</dt><dd>Deleted once they are 12 months old.</dd></div>
          <div><dt>Sign-in security records</dt><dd>Failed-password counts, lockouts and sign-in events: deleted after 90 days.</dd></div>
          <div><dt>Password reset links</dt><dd>Work for 15 minutes; deleted once they expire.</dd></div>
          <div><dt>Device sign-in approvals</dt><dd>Last up to 7 days; deleted a day after they expire, and at once when you sign out everywhere or delete your account.</dd></div>
          <div><dt>Browser notification settings</dt><dd>Until you switch notifications off or delete your account.</dd></div>
          <div><dt>Business and financial records</dt><dd>Work, bookings, guest details and messages, invoices, expenses, statements, payouts, shifts, signed contracts and messages in business conversations: {BUSINESS_RECORD_YEARS} years from the end of the financial year they relate to, as UK law requires, then deleted or anonymised.</dd></div>
          <div><dt>Owners’ payout bank details</dt><dd>While we manage the property and until any money owed has been paid, then deleted.</dd></div>
          <div><dt>Account deletion record</dt><dd>Which account was deleted, its role and when, with no personal details: {BUSINESS_RECORD_YEARS} years.</dd></div>
        </dl>
        <p>A daily job deletes read notifications, sign-in security records, expired reset links and device approvals, and anything left over from deleted accounts, as they reach the end of these periods. We review and delete the other records when their period ends.</p>
      </section>

      <section>
        <h2>Your rights</h2>
        <ul>
          <li><strong>Access and portability</strong>: in the app, open Profile &amp; preferences and choose <strong>Download my data</strong> for a copy of your data as a file. You can also ask us.</li>
          <li><strong>Correction</strong>: ask us, or your administrator, to correct anything that is wrong.</li>
          <li><strong>Erasure</strong>: delete your account yourself (see below) or ask us. We keep what the law requires us to keep.</li>
          <li><strong>Restriction and objection</strong>: you can ask us to stop or limit using your data where we rely on legitimate interests.</li>
          <li><strong>Complaints</strong>: please tell us first. You can also complain to the Information Commissioner’s Office at <a href="https://ico.org.uk/make-a-complaint/">ico.org.uk</a> or on 0303 123 1113.</li>
        </ul>
        <p>Email <ContactEmail /> to use any of these rights. We reply within one month.</p>
      </section>

      <section>
        <h2>Cookies and storage on your device</h2>
        <p>We use only cookies that are strictly necessary, so we do not ask for cookie consent:</p>
        <ul>
          <li>Sign-in cookies set by our sign-in provider, which keep you signed in. They cannot be read by scripts and end when your sign-in ends.</li>
          <li><strong>recharge-recovery-proof</strong>, which lasts 15 minutes while you choose a new password.</li>
        </ul>
        <p>Your browser also remembers your theme, motion and help-button choices on your device; these are not sent to us. The phone app keeps a sign-in token in your phone’s secure storage. We use no analytics or advertising cookies.</p>
      </section>

      <section>
        <h2>Children</h2>
        <p>Recharge is not for anyone under 18 and we do not knowingly collect children’s data. For guests we record only the number of people staying, not details about children.</p>
      </section>

      <section>
        <h2>How we protect it</h2>
        <p>Data travels encrypted (HTTPS). Every request is checked against your role and the properties you are assigned to. Each sign-in must be approved by our server, five wrong passwords pause sign-in for 24 hours, photos and files are private and opened through short-lived links, and bank details are kept in a separate, restricted store. Only our server holds the keys that can change sign-in accounts.</p>
      </section>

      <section>
        <h2>Deleting your account</h2>
        <p>In the app: open <strong>Profile &amp; preferences</strong> and choose <strong>Delete my account</strong>. On the web: go to <a href="/delete-account">the account deletion page</a>. You type DELETE and your password to confirm.</p>
        <p>Your name, email, phone number, password, sign-ins, access and notifications are deleted. Business records you were part of stay on record for {BUSINESS_RECORD_YEARS} years under “Deleted user”. If you own properties we manage, they stay with Recharge and your management agreement does not end: contact us to end it.</p>
      </section>

      <section>
        <h2>Changes to this policy</h2>
        <p>We will update this page when the way we use data changes, and tell you in the app about important changes.</p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>Questions about privacy: email <ContactEmail />, or write to {legalDetails.legalName}, {legalDetails.registeredAddress}. Data protection contact: {legalDetails.dataProtectionContact}.</p>
      </section>
    </div>
  </AuthShell>;
}
