# Email for guests and clients (Resend), round 6, Session F

`guestrelations@rechargegroup.co.uk` feeds Messages, Guests. `ownerrelations@rechargegroup.co.uk` feeds Messages, Clients. Both mailboxes stay at
Fasthosts and keep working there (each keeps a copy of everything). Recharge reads email through **Resend inbound** and answers through **Resend**.

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
  that owner's one conversation as the owner. Unknown addresses wait in **Messages, Clients, Unknown senders** (admins and Client relations): Assign to owner (the address is
  remembered) or Dismiss.
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

1. DNS at Fasthosts (done with Lee): TXT `resend._domainkey`, CNAME `rsend`, CNAME `send`. Resend shows the domain **Verified**. Main MX, SPF and DMARC untouched.
2. Lee runs the round's install file in Supabase (includes `20261016500000_inbound_email.sql`), then the Worker deploys from `main` as usual. The route is dead (503) until the secrets exist, so the order of 2 and 3 is safe either way.
3. **Test sending:** set `EMAIL_REPLIES_ENABLED=true`, then reply to a test email conversation (or run the test below); confirm it arrives from guestrelations@.
4. **Receiving subdomain:** in Resend, Domains, add the receiving address on a subdomain we control (`in.rechargegroup.co.uk`). Add the MX record Resend shows **for that subdomain only** at Fasthosts (host `in`). Never change the main domain's MX.
5. **Webhook:** in Resend, Webhooks, add `https://app.rechargegroup.co.uk/api/resend/webhook`, event `email.received`; copy the signing secret into the Worker secret `RESEND_WEBHOOK_SECRET`; deploy (adding a secret redeploys).
6. **Fasthosts forwarding:** on each mailbox add a rule that **keeps a copy** and forwards one to `guestrelations@in.rechargegroup.co.uk` / `ownerrelations@in.rechargegroup.co.uk`.
7. **Check:** send a test email to guestrelations@ from another account: it must still arrive at Fasthosts **and** appear in Messages, Guests (within seconds). Reply from the app; the test account gets it from guestrelations@ and replies thread back into the same conversation. Same for ownerrelations@ with an owner's sign-in email.

## To verify live (not provable in tests)

- Resend's received-email API field names (`GET /emails/receiving/{id}`, `.../attachments/{id}`) and whether received mail carries an `Authentication-Results` header. The Worker reads fields defensively; if a test email is dropped as "no authentication result", set `EMAIL_ALLOW_UNVERIFIED`.
- Resend honours a custom `Message-ID` header on send (replies are matched by it, and fall back to the sender's address if not).
- Fasthosts forwarding keeps the original From and DKIM signature (so DMARC passes at Resend).
