# Hostaway sync (7 October 2026)

> **Paused since 7 October 2026.** Recharge is starting as a new business: properties, owners
> and staff are onboarded afresh in the app, and Hostaway is being replaced by a cheaper channel
> manager. The Recharge Stays data imported from Hostaway (99 properties, 1,120 reservations,
> 419 cleans) was copied to the private `archive` schema and cleared from the live tables. The
> sync is off in two places: the database refuses it (`paused` on the sync state) and the
> Worker only runs it when `HOSTAWAY_SYNC_ENABLED` is `true`. While off, the Hostaway webhook is
> acknowledged and ignored, and the sync card is hidden. The replacement channel manager will
> reuse the same database functions.

Recharge reads Hostaway and keeps itself up to date. Nothing is written back to Hostaway.

## What it does

- **Listings become properties.** Every Hostaway listing becomes a live Recharge property, with
  its name, address, bedrooms and access notes (door code and check-in instructions, stored in
  the private access details). If a property with exactly the same name already exists and isn't
  linked yet, the listing is linked to it instead of creating a duplicate. Details staff have
  edited in Recharge are never overwritten. Admins then assign the owner and the team.
- **Reservations become stays**, with the platform (Airbnb, Booking.com, Vrbo, direct or
  other), the platform's confirmation code, the guest count and the **expected payout: what the
  platform pays out** after its commission. For Airbnb this is Hostaway's expected Airbnb payout;
  otherwise it is the guest total less the platform's commission and host fee. Amounts in a
  currency other than pounds are left blank for Accounts to fill in. Owner stays are recorded
  with a payout of £0. A blank in Hostaway never wipes a detail Accounts has filled in.
- **Every confirmed checkout gets a "Checkout clean"** on the checkout day, unassigned, with the
  standard turnover checklist. The cleaning manager assigns the cleaner (and the clean's pay).
  If the next guest arrives the same day, the clean is marked urgent. If the stay moves, the clean
  moves; if it is cancelled, the clean is cancelled. A clean that has already been started or
  submitted is never changed automatically: it is listed under "To check" instead.
- **When it runs:** every 15 minutes, straight away when Hostaway sends a change (webhook), and
  when an admin presses **Sync now** on the Hostaway card (Management → Properties). Each run
  covers every stay that checks out from 30 days ago onwards.
- **The Hostaway card** shows when it last ran, the numbers linked, any error, and anything to
  check (overlapping stays, a listing that couldn't be added, a clean already started).

## Guest messages

Guest conversations from Hostaway come into the Guest inbox (Stays → Guest inbox) by themselves,
read only: nothing is ever sent or written to Hostaway.

- **What comes in:** each guest message and each reply the team sends in Hostaway (or that
  Hostaway sends automatically), grouped into one conversation per guest with the property, the
  platform, the guest's name, the booking reference and the stay dates. Photos show as "(Photo)".
  Messages that were scheduled but not sent, or failed, are left out. Reply times, scores and
  bonuses count from these messages exactly as for ones logged by hand.
- **When:** every minute the backend asks Hostaway for the 100 conversations with the newest
  activity (one request), and fetches the messages only of those that changed (25 at most per
  minute, one after another, to stay inside Hostaway's rate limit). So a guest's message shows
  within about a minute even without the webhook. For an even quicker start, add the event
  **`message.received`** to the existing Hostaway webhook (same URL and password as the
  reservation events): the backend then fetches that conversation straight away. The webhook body
  is never trusted; only the conversation id is used.
- **History:** the last 14 days of messages. Older ones are not imported.
- **Old conversations start Done.** A conversation new to Recharge whose newest message is over
  24 hours old is added as Done, so the first import doesn't fill "Waiting" with old chats. A
  newer guest message reopens it, as for any done conversation. A conversation Hostaway shows but
  with nothing in the last 14 days is not added.
- **Replies are still sent in Hostaway** (or on the platform). The reply comes back into the inbox
  within a minute and ends the wait. "Save reply" in the app only records one; nothing is sent.
  The "Log a guest message" option stays for WhatsApp, email and anything else outside Hostaway.
- **Properties and stays:** a conversation is matched to the property by its Hostaway listing ID,
  and to the stay (`HA:<reservation id>`) for the booking reference, dates and platform. If the
  listing isn't in Recharge yet the conversation is shared with everyone with the inbox until a
  later message finds the property, or someone matches it by hand (Guest details).
- **Off and paused:** the same switches as the rest of the sync. While `HOSTAWAY_SYNC_ENABLED` is
  not `true`, or the database sync state is paused, nothing is fetched or stored.
- **If something goes wrong,** the error is logged and the next minute retries. It doesn't change
  the Hostaway card's "last error", which belongs to the reservation sync.

## Setting it up (about 10 minutes)

The keys go straight into the backend as secrets. Never paste them into chat, email or a file
in the repository.

1. **Create a Hostaway API key.** In Hostaway, open *Settings → Hostaway API* (the account owner
   can do this) and create a key. The same page shows your **Account ID**.
2. **Choose a webhook password.** At least 24 letters and numbers. For example, run
   `openssl rand -hex 32` and copy the result.
3. **Add the three secrets to the backend.** From the project folder, after `npx wrangler login`:
   ```
   npx wrangler secret put HOSTAWAY_ACCOUNT_ID --name recharge-backend
   npx wrangler secret put HOSTAWAY_API_KEY --name recharge-backend
   npx wrangler secret put HOSTAWAY_WEBHOOK_SECRET --name recharge-backend
   ```
   Each command asks for the value; paste it there.
4. **Redeploy the backend** (this also switches on the 15-minute schedule):
   `npm run build && npm run backend:deploy`
5. **Add the webhook in Hostaway.** In *Settings → Integrations → Webhooks* (unified webhooks), add
   the events `reservation.created`, `reservation.updated` and `message.received` and, as the URL,
   `https://app.rechargegroup.co.uk/api/hostaway/webhook?key=<webhook password>`.
   (If the form has Login and Password fields, you can instead leave `?key=…` off and use the login
   `recharge` with the webhook password.) Make the password letters and numbers only, for example
   `openssl rand -hex 32`, so it is safe in a web address.
   The webhook's history log in Hostaway shows each call: 200 is working, 401 is a wrong password,
   and 503 means the backend has no `HOSTAWAY_WEBHOOK_SECRET` yet.
6. **Run the first sync.** In the app, open Properties and press **Sync now** on the Hostaway card.
   Imported properties start with nobody assigned, and team members only see assigned properties:
   in Work → Management → People, open each cleaning manager, cleaner or Stays member and press
   **Give every property** (or add properties one by one). Owners are given their own properties.
   The checkout cleans then appear under Work → Cleans for assignment.
7. **Check one payout.** Compare the expected payout of one Airbnb stay and one Booking.com stay
   with the platform's payout report. If they differ, tell the developer which figure is right.

The sync is off unless the Worker variable `HOSTAWAY_SYNC_ENABLED` is `true` **and** the database
sync state is unpaused (`update private.workspace_hostaway_sync_state set paused=false where singleton`).

## Where it lives

- Database: `supabase/migrations/20261007113020_hostaway_sync_tables.sql` and
  `20261007113021_hostaway_sync_functions.sql`
  (`workspace_hostaway_sync`, service role only; `workspace_hostaway_status` for admins and Stays).
- Guest messages: `supabase/migrations/20261012040000_hostaway_guest_messages.sql`
  (`workspace_hostaway_conversations_due` and `workspace_hostaway_messages_ingest`, service role
  only; they store through `workspace_guest_messages_ingest`; `remote_marker` on
  `workspace_guest_threads`).
- Mapping: `lib/hostaway-sync-policy.ts` (reservations, listings), `lib/hostaway-messages-policy.ts`
  (conversations, messages, the message webhook; every Hostaway field name for messages is there).
  Runner and webhook: `lib/hostaway-sync.ts` (`runHostawayMessages`, `syncHostawayConversation`).
  Schedule: `worker/index.ts` (messages every minute, the rest every 15) and `scripts/build-backend-config.mjs`.
- App: `mobile/src/HostawaySyncCard.tsx`, `mobile/src/LiveGuestInbox.tsx`.
- Tests: `tests/hostaway-sync-database.test.mjs`, `tests/hostaway-sync-http.test.mjs`,
  `tests/hostaway-messages-database.test.mjs`, `tests/hostaway-messages-policy.test.mjs`.
