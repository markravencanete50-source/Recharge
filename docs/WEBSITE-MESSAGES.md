# Guest messages from the company website

The website (rechargestays.co.uk, a separate Next.js project on Vercel) has a booking panel and a "Message the team" chat on each
home's page. Its server route `/api/guest-message` forwards each message, server to server, to this app. The message lands in
Messages > Guests (the Stays Communication Centre) as a **Website** conversation, beside the Hostaway and email ones. The team's
replies appear in the guest's chat window on the website (live chat, below); a message sent without a chat key is answered by email
from guestrelations@ as before.

## The endpoint

`POST https://app.rechargegroup.co.uk/api/website/guest-messages` (`lib/website-guest-messages-server.ts`, migration `20261026200000_website_guest_messages.sql`)

- **Key:** header `x-recharge-website-key` must equal the Worker secret `WEBSITE_MESSAGES_KEY` (compared in constant time). Missing or wrong: `401`.
  Secret not set, or shorter than 32 characters: `503`. Nothing is read or stored before the key is checked. No CORS: browsers never call it.
- **Body** (JSON, up to 32 KB; unknown fields are ignored):
  `{"source":"website","home":{"slug":"4-bedroom-home-in-boness","hostawayListingId":601876,"town":"Bo'ness"},"name":"Guest Name","email":"guest@example.com","phone":"07700 900123","body":"Hi, ...","booking":{"checkin":"2026-11-10","checkout":"2026-11-16","guests":2,"total":1073,"currency":"GBP"},"sentAt":"2026-10-21T12:00:00.000Z"}`.
  `home`, `phone` and `booking` may be null or missing; `name` (120), `email` and `body` (4,000) are required; dates are `YYYY-MM-DD`
  and check-out is after check-in. Anything else: `400` with the first problem in `error`.
  `chat` (optional) is the chat key the guest's browser made for this chat: 32 to 128 characters of `A-Z a-z 0-9 _ -`.
- **Quotas:** 1,000 messages an hour from the website's servers (every message comes from Vercel, so this is a ceiling on the website
  as a whole), 10 an hour per guest email address (40 when the message is part of a chat), and 30 an hour per chat. Over any: `429`
  with `Retry-After`. These routes are not counted against the app's general per-address limit, since every guest reaches them from
  Vercel's few addresses.
- **Answer:** `200 {"ok":true,"duplicate":false}`. The same delivery sent again is answered `200 {"ok":true,"duplicate":true}` and stored once.
  The database being unavailable: `503` (the website may retry).

## Live chat

`POST https://app.rechargegroup.co.uk/api/website/guest-chat` with the same key header and `{"chat":"<the chat key>"}` returns the chat
for the guest's window: `200 {"ok":true,"found":true,"messages":[{"id":"…","from":"guest","body":"…","sentAt":"…"},{"id":"…","from":"team","body":"…","sentAt":"…","name":"Anna"}]}`
(oldest first, the last 200; an unknown chat is `found:false` with no messages). The website asks every few seconds while the window
is open, up to 30 times a minute per chat. Migration `20261027100000_website_live_chat.sql`.

- The app stores only a keyed hash of the chat key (`thread_ref` `website-chat:<hash>`), so a chat can be read only by whoever holds
  the key, never by knowing a guest's email address. Each chat is its own conversation.
- The guest's own messages are returned without the summary lines the app adds for the team (booking, phone, home). Hidden messages,
  and replies that are still going out or failed, are left out. A team reply carries the sender's first name.
- In the Guest inbox a chat says so (`websiteChat`), and **Send** is always available for it: the reply is stored into the chat as
  sent (`workspace_website_reply_result`) and nothing is emailed, whatever `EMAIL_REPLIES_ENABLED` says.
- The website keeps the chat key only for that browser tab, so closing the page ends the chat for the guest; the conversation stays
  in the Guest inbox.

## In the Guest inbox

- A chat is its own conversation (above). Without a chat key: one conversation per guest email address and home: a follow-up from the same guest about the same home joins it (and reopens it if
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
