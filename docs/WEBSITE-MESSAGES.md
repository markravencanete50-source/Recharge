# Guest messages from the company website

The website (rechargestays.co.uk, a separate Next.js project on Vercel) has a booking panel and a "Message the team" chat on each
home's page. Its server route `/api/guest-message` forwards each message, server to server, to this app. The message lands in
Messages > Guests (the Stays Communication Centre) as a **Website** conversation, beside the Hostaway and email ones, and the team's
replies go to the guest by email from guestrelations@.

## The endpoint

`POST https://app.rechargegroup.co.uk/api/website/guest-messages` (`lib/website-guest-messages-server.ts`, migration `20261026200000_website_guest_messages.sql`)

- **Key:** header `x-recharge-website-key` must equal the Worker secret `WEBSITE_MESSAGES_KEY` (compared in constant time). Missing or wrong: `401`.
  Secret not set, or shorter than 32 characters: `503`. Nothing is read or stored before the key is checked. No CORS: browsers never call it.
- **Body** (JSON, up to 32 KB; unknown fields are ignored):
  `{"source":"website","home":{"slug":"4-bedroom-home-in-boness","hostawayListingId":601876,"town":"Bo'ness"},"name":"Guest Name","email":"guest@example.com","phone":"07700 900123","body":"Hi, ...","booking":{"checkin":"2026-11-10","checkout":"2026-11-16","guests":2,"total":1073,"currency":"GBP"},"sentAt":"2026-10-21T12:00:00.000Z"}`.
  `home`, `phone` and `booking` may be null or missing; `name` (120), `email` and `body` (4,000) are required; dates are `YYYY-MM-DD`
  and check-out is after check-in. Anything else: `400` with the first problem in `error`.
- **Quotas:** 300 messages an hour from the website's servers (every message comes from Vercel, so this is a ceiling on the website as
  a whole), and 10 an hour per guest email address. Over either: `429` with `Retry-After`.
- **Answer:** `200 {"ok":true,"duplicate":false}`. The same delivery sent again is answered `200 {"ok":true,"duplicate":true}` and stored once.
  The database being unavailable: `503` (the website may retry).

## In the Guest inbox

- One conversation per guest email address and home: a follow-up from the same guest about the same home joins it (and reopens it if
  it was Done). The home is the property whose **Hostaway listing id** is the website's `hostawayListingId`. A home that matches no
  property starts an unmatched conversation (shared like an unmatched email) whose message begins `Home: <town> · <slug>`; match it
  with Edit as usual.
- The conversation carries the guest's name, email and the stay's dates. The message begins with a one-line summary when a booking was
  asked about (`Booking request: 10 Nov to 16 Nov 2026 · 2 guests · quoted £1,073.00`) and the phone number when given.
- It notifies exactly like any guest message (the admins, and Stays with the guest communication tool on that home), counts as
  waiting, and is seen only by people allowed into the guest inbox.
- **Replies:** Send emails the reply from guestrelations@ (needs `RESEND_API_KEY` and `EMAIL_REPLIES_ENABLED=true`, as for email
  conversations), subject `Your Recharge stay at <home>, 10 Nov to 16 Nov 2026`. When the guest answers that email it comes back into the
  same Website conversation.

## Go-live

1. Run `20261026200000_website_guest_messages.sql` in Supabase, then deploy the Worker from `main` as usual. Until step 2 the route answers `503`.
2. Make a random key of at least 32 characters (for example `openssl rand -hex 32`) and set it on the backend Worker:
   `npx wrangler secret put WEBSITE_MESSAGES_KEY --name recharge-backend`
3. In the website's Vercel project, Settings, Environment Variables (Production and Preview), set
   `RECHARGE_GUEST_MESSAGES_URL=https://app.rechargegroup.co.uk/api/website/guest-messages` and `RECHARGE_WEBSITE_KEY=<the same key>`, then redeploy the website.
4. Check: send a message from a home's page; it appears in Messages > Guests under Website within seconds, and the team is notified.
   Reply with Send; the guest's address receives it from guestrelations@.
