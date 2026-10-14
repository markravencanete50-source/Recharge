# Email for guests and clients (Resend), round 6, Session F

`guestrelations@rechargegroup.co.uk` feeds Messages, Guests. `ownerrelations@rechargegroup.co.uk` feeds Messages, Clients. Both mailboxes stay at
Fasthosts (mail hosting only; DNS is in Cloudflare) and keep working there (each keeps a copy of everything). Recharge reads email through **Resend inbound** and answers through **Resend**.

## How it flows

```
sender -> Fasthosts mailbox (kept there) -> forwarding rule -> guestrelations@in.rechargegroup.co.uk
       -> Resend inbound -> signed webhook POST /api/resend/webhook (the Worker)
       -> Worker checks the signature, fetches the email from Resend, drops spam / failed DKIM or DMARC,
          keeps attachments (private bucket email-files), stores through the database
```

- **Guests:** `workspace_email_guest_ingest` stores the email through `workspace_guest_messages_ingest` (source `email`, channel `email`), so the guest inbox rules apply
  unchanged (owners, cleaners and Ready never see it, in the database or on screen) and the existing guest-message trigger tells the admins and Stays (confirmed by test).
  Matching, in order, never on the display name: `In-Reply-To` / `References` against an email we stored; a booking code of a stay in the subject or text;
  the sender's address against an earlier email conversation; otherwise a new unmatched email conversation (no property, shared with everyone allowed the guest inbox; staff
  match it with Guest details).
- **Owners:** `workspace_email_owner_ingest` matches the sender's address to an active owner's sign-in email (or an address Client relations assigned) and posts the email into
  that owner's one conversation as the owner. **Anyone else** (a new landlord, an enquiry, an owner without an account) gets an **email conversation in Messages, Clients**
  (migration 20261019500000, round 7): admins, super admins and the client relations rota read it and reply from `ownerrelations@` (once per request id, threaded); their
  answer comes back into it; Close / Reopen; **Assign to owner** moves the history into that owner's conversation and remembers the address. The old Unknown senders panel is gone.
- **Replies out:** staff press Send in an email conversation: recorded once per request id (`workspace_guest_reply_requests`), emailed through Resend as
  `guestrelations@` with `In-Reply-To`, `References` and a fixed `Message-ID`, stored only after Resend accepted it. A team reply in an owner conversation whose latest owner
  message came by email is queued (`workspace_email_outbox`) and sent as `ownerrelations@` by the Worker every minute, once per row.
- **Attachments:** images (JPEG, PNG, WebP, GIF) and PDF up to 10 MB, 10 per email, type decided from the bytes. Opened only through `/api/workspace/email-files`, which returns
  one-hour signed links for people the database allows. The raw email is never kept.
- **Dropped:** spam (X-Spam-Flag/Status/Level), a DMARC or DKIM failure, no authentication result at all, mail from our own domain, bounces. Only the fact is kept (`workspace_email_inbound`), never the content. SPF alone is not a reason: a forward always fails SPF.

## Worker secrets (type **Secret**, never a plain variable, never pasted in chat)

| Name | What | Needed for |
|---|---|---|
| `RESEND_API_KEY` | Resend API key, **Full access** (reading received emails needs it) | everything. **Already set** (13 Oct). |
| `RESEND_WEBHOOK_SECRET` | the webhook's signing secret (`whsec_...`) from Resend, Webhooks | receiving. Without it the webhook answers 503. |
| `EMAIL_REPLIES_ENABLED` | `true` to let Send email replies (guests) and send owner replies | replies out. Off by default, like `HOSTAWAY_REPLIES_ENABLED`. |
| `EMAIL_ALLOW_UNVERIFIED` | `true` only if Resend adds no Authentication-Results header to received mail | only if a test email is dropped as "no authentication result". |

## Go-live order

1. **DNS is in Cloudflare** (the name servers are `*.ns.cloudflare.com`; the Fasthosts Advanced DNS page is ignored). Add the three records Resend lists, in Cloudflare, DNS, Records, each **DNS only (grey cloud)**: TXT `resend._domainkey`, CNAME `rsend`, CNAME `send`. Resend then shows the domain **Verified**. Main MX (to Fasthosts), SPF and DMARC untouched.
2. Lee runs the round's install file in Supabase (includes `20261016500000_inbound_email.sql`), then the Worker deploys from `main` as usual. The route is dead (503) until the secrets exist, so the order of 2 and 3 is safe either way.
3. **Test sending:** set `EMAIL_REPLIES_ENABLED=true`, then reply to a test email conversation (or run the test below); confirm it arrives from guestrelations@.
4. **Receiving subdomain:** in Resend, Domains, add the receiving address on a subdomain we control (`in.rechargegroup.co.uk`). Add the MX record Resend shows **for that subdomain only** in Cloudflare DNS (name `in`, DNS only). Never change the main domain's MX.
5. **Webhook:** in Resend, Webhooks, add `https://app.rechargegroup.co.uk/api/resend/webhook`, event `email.received`; copy the signing secret into the Worker secret `RESEND_WEBHOOK_SECRET`; deploy (adding a secret redeploys).
6. **Fasthosts forwarding:** on each mailbox add a rule that **keeps a copy** and forwards one to `guestrelations@in.rechargegroup.co.uk` / `ownerrelations@in.rechargegroup.co.uk`.
7. **Check:** send a test email to guestrelations@ from another account: it must still arrive at Fasthosts **and** appear in Messages, Guests (within seconds). Reply from the app; the test account gets it from guestrelations@ and replies thread back into the same conversation. Same for ownerrelations@ with an owner's sign-in email.

## To verify live (not provable in tests)

- Resend's received-email API field names (`GET /emails/receiving/{id}`, `.../attachments/{id}`) and whether received mail carries an `Authentication-Results` header. The Worker reads fields defensively; if a test email is dropped as "no authentication result", set `EMAIL_ALLOW_UNVERIFIED`.
- Resend honours a custom `Message-ID` header on send (replies are matched by it, and fall back to the sender's address if not).
- Fasthosts forwarding keeps the original From and DKIM signature (so DMARC passes at Resend).

## The client enquiry form is emailed automatically

Client relations, Client enquiries, "Send the enquiry form" now emails the form by itself. It has **its own switch**, apart from the staff notice emails:

- **Ready** when `RESEND_API_KEY` is set (it is) and `ENQUIRY_EMAIL_ENABLED` is not `false`. It does **not** need `NOTIFICATION_EMAIL_ENABLED` or `NOTIFICATION_FROM_EMAIL`, and it never turns staff notice emails on.
- Sent as `Recharge Group <ownerrelations@rechargegroup.co.uk>` with reply-to `ownerrelations@rechargegroup.co.uk`, so a landlord's reply reaches that mailbox (and Messages, Clients, once inbound is on). There is no sender override: the form can never go out from the guest mailbox.
- One request makes one link and one email (Resend idempotency key `recharge-enquiry/<user>/<request>`); 40 forms an hour per person.
- The sheet has one button, "Send the form" (and "Send the new link"). The link with Copy and "Open my email app" appears only when email is not ready or the send failed. The enquiry row shows "Email failed" with **Try again**.
- **Worker secrets to add:** none. To switch the form's email off: `ENQUIRY_EMAIL_ENABLED=false`. Because the key is already set and the domain is verified, enquiry emails start as soon as this is deployed.

## The estimate is emailed with a private link

Migration 20261019520000, `lib/estimate-link.ts`, `lib/estimate-link-server.ts`, `app/estimate`.

- **When it's sent:** the team publishes (or republishes) an estimate on a journey with no owner account. If the enquiry has an email address and the enquiry email switch is ready (`RESEND_API_KEY`, `ENQUIRY_EMAIL_ENABLED` not `false`), the server emails it straight after the publish.
- **Who it's from:** `ownerrelations@`, with replies to `ownerrelations@`, so they land in Messages, Clients.
- **What's in it:** the property, the low, expected and high nightly rates, the notes, up to 3 comparables with their links, and one button, **View your estimate**.
- **Retries:** the request id is derived from the publish, so a retried publish never sends a second email.
- **The link:** made from the request. Only its hash is stored. It lasts 30 days and needs no sign-in.
- **The client's page** (`/estimate?t=…`) shows the rates, the notes, similar properties and a small explorer, using the same sums as the owner app.
- **The client's answer:** Proceed, Review later (with a follow-up date) or Decline, plus optional feedback. This records the same decision as `decideEstimate`: the journey moves on, the team is notified, and "Owner decides on the estimate" ticks.
- **What the team sees:** "Estimate sent" only once the email for the current estimate has gone. Otherwise it shows "Estimate ready": published but not emailed, the email failed, or the enquiry has no email address. The property's Onboarding card has **Email the estimate** (or **Resend the estimate**) and **Copy link**, which gives a link to send by hand and also works when email isn't set up.
- **Screenshots:** `docs/screenshots/session-f/estimate-*.png`.

## Two addresses, never mixed (Lee's rule)

- **Guests:** `guestrelations@rechargegroup.co.uk`. Comes in to Messages, Guests; every reply goes out from it, with reply-to the same.
- **Owners and clients:** `ownerrelations@rechargegroup.co.uk`. Comes in to Messages, Clients; replies to owners and the automatic enquiry form email go out from it, reply-to the same.
- Enforced in code and by `tests/email-sender-rule.test.mjs`: `sendMailboxEmail('guest'|'owner')` fixes From and Reply-To per mailbox and refuses a recipient that is one of our own mailboxes; the one-off sender (`sendEmail`) refuses guestrelations@; the staff notice sender `NOTIFICATION_FROM_EMAIL` is ignored (notice emails stay off) if it is set to either mailbox.
- Not code, so not tested here: **sign-in, invite and password emails** are sent by Supabase Auth, whose sender is configured in the Supabase dashboard (Authentication, SMTP / emails). Nothing in this repo sends them from either address; check that dashboard setting says neither.
