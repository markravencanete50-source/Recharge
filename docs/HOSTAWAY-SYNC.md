# Hostaway sync (7 October 2026)

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

## Setting it up (about 10 minutes)

The keys go straight into the backend as secrets. Never paste them into chat, email or a file
in the repository.

1. **Create a Hostaway API key.** In Hostaway, open *Settings → Hostaway API* (the account owner
   can do this) and create a key. The same page shows your **Account ID**.
2. **Choose a webhook password.** Any long random text, at least 24 characters. For example, run
   `openssl rand -base64 32` and copy the result.
3. **Add the three secrets to the backend.** From the project folder, after `npx wrangler login`:
   ```
   npx wrangler secret put HOSTAWAY_ACCOUNT_ID --name recharge-backend
   npx wrangler secret put HOSTAWAY_API_KEY --name recharge-backend
   npx wrangler secret put HOSTAWAY_WEBHOOK_SECRET --name recharge-backend
   ```
   Each command asks for the value; paste it there.
4. **Redeploy the backend** (this also switches on the 15-minute schedule):
   `npm run build && npm run backend:deploy`
5. **Add the webhook in Hostaway.** In *Settings → Webhooks* (unified webhooks), add:
   - URL: `https://recharge-backend.markravencanete50.workers.dev/api/hostaway/webhook`
   - Login: `recharge`
   - Password: the webhook password from step 2
6. **Run the first sync.** In the app, open Properties and press **Sync now** on the Hostaway card.
   Imported properties start with nobody assigned, and team members only see assigned properties:
   in Work → Management → People, open each cleaning manager, cleaner or Stays member and press
   **Give every property** (or add properties one by one). Owners are given their own properties.
   The checkout cleans then appear under Work → Cleans for assignment.
7. **Check one payout.** Compare the expected payout of one Airbnb stay and one Booking.com stay
   with the platform's payout report. If they differ, tell the developer which figure is right.

To pause the sync, set the Worker variable `HOSTAWAY_SYNC_ENABLED` to `false`.

## Where it lives

- Database: `supabase/migrations/20261007113020_hostaway_sync_tables.sql` and
  `20261007113021_hostaway_sync_functions.sql`
  (`workspace_hostaway_sync`, service role only; `workspace_hostaway_status` for admins and Stays).
- Mapping: `lib/hostaway-sync-policy.ts`. Runner and webhook: `lib/hostaway-sync.ts`.
  Schedule: `worker/index.ts` and `scripts/build-backend-config.mjs`.
- App: `mobile/src/HostawaySyncCard.tsx`.
- Tests: `tests/hostaway-sync-database.test.mjs`, `tests/hostaway-sync-http.test.mjs`.
