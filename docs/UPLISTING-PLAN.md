# Uplisting connection: research and plan (9 October 2026)

Status: **researched, not built.** Nothing here has been run against a real Uplisting account.
Uplisting's own documentation could not be opened from the build environment, so the API
details below come from search summaries of its help centre and public Postman docs. Treat
every endpoint, scope and field name as **unconfirmed** until we have an account and have
called it. Items marked **(verify)** are the ones that must be checked first.

## What we need from the channel manager

From the client checklist (C1, D9, S1, S7, S12) the app needs four things:

| Need | Used for | Hostaway equivalent today |
|---|---|---|
| Properties (listings) | Create or link Recharge properties; listing links | `fetchHostawayListings` |
| Bookings (check-in, check-out, status, channel, guests, payout) | Stays, owner payouts, automatic checkout cleans | `fetchHostawayReservations` |
| Guest messages (threads, send) | Guest inbox, reply timing, bonus tiers | none yet (inbox is filled by hand) |
| Reviews | Daily review totals, bad-review re-listing | none yet |

## What Uplisting appears to offer

- **Public/Partner API, key-based (V2).** Key generated in the app under *Connect → API*; sent
  as HTTP Basic auth with the key Base64-encoded on its own (not `key:password`). Base host
  `connect.uplisting.io`. Third-party integrations also send an `X-Uplisting-Client-ID`
  header, which Uplisting issues to partners **(verify whether a single-account key works
  without one)**.
- **A newer V3 with OAuth** is mentioned. Not needed for a single business using its own account.
- **Bookings and properties** can be listed (paged, filter by date).
- **Webhooks**: register with `POST /hooks` giving a target URL and an event, e.g.
  `booking_created`. Uplisting's guidance is that deliveries can repeat, so handlers must be
  idempotent. Which other events exist (changed, cancelled, removed, property events) **(verify)**.
- **Messages and reviews**: Uplisting's MCP/permission list names `messaging:read`,
  `messaging:write` and `reviews:read`, which suggests these are reachable by API, but whether
  they are in the REST key API, V3 only, or MCP only is **unknown (verify)**. This decides
  whether the guest inbox can be automated at all.
- **Access may be restricted.** One source says the API is invite-only via support. Whether it
  is included in every plan **(verify, ask support)**.

## Cost (conflicting, check the live pricing page)

- A tracker that read Uplisting's pricing page on 3 Sep 2026: **£72/month for 1–5 properties,
  £16/property/month for 6–40**, custom above 40, about 10% off annually.
- Another source shows a flat Pro plan at **£99/month up to 15 properties**; a third gives
  other figures.
- The client checklist currently says "about £13 per listing (Hostaway about £25)". That looks
  **out of date**; at 6–40 properties the sources suggest about £16. Correct the checklist
  figure once the live price is confirmed, before the client relies on it.

## Plan

### Phase 0: questions for Uplisting support (before any code)
Ask in one email from the account owner:
1. Is the public API (bookings, properties, webhooks) included in our plan, and how do we enable it?
2. Do we need a partner `X-Uplisting-Client-ID`, or does the account API key work alone?
3. Can we read and send **guest messages** and read **reviews** by API or webhook? Which version (V2 key or V3 OAuth)?
4. Which webhook events exist, how are they authenticated or signed, and what are the retry rules and rate limits?
5. What does a booking carry: channel, channel confirmation code, guest count, currency, payout after commission, cancellation status?
6. Live pricing for our property count, including any API or messaging add-ons.

### Phase 1: bookings and properties (the part we can build with confidence)
Reuse the Hostaway design, which was built to be provider-neutral at the app level:
- **Database:** `workspace_hostaway_sync` is Hostaway-specific (column `hostaway_listing_id`,
  reference prefix `HA:`, source `'hostaway'`, one-sync-state row). Generalise instead of
  copying: add `external_source` and `external_listing_id` to properties, key reservations by
  `(source, reference)`, and make the sync function take the source from its input. One
  migration; Hostaway data is already archived, so there is nothing to convert.
- **Mapping:** new `lib/uplisting-sync-policy.ts`, same shape as `hostaway-sync-policy.ts`
  (listing, reservation, channel, payout), unit-tested against sample payloads copied from
  Uplisting's docs.
- **Runner:** `lib/uplisting.ts` (fetch with Basic auth, timeouts, paging) and
  `lib/uplisting-sync.ts` (every 15 minutes from the Worker cron, on a webhook, and "Sync now").
  Webhooks only trigger a fresh fetch of that booking; the body is never trusted, as with Hostaway.
- **Checkout cleans, owner payouts, calendar, Today board** already hang off reservations and
  need no change.
- **Secrets:** `UPLISTING_API_KEY` (and `UPLISTING_CLIENT_ID` if required) and a webhook secret
  of at least 24 random characters, set with `npx wrangler secret put … --config
  dist/server/wrangler.backend.json` in the client's own terminal. Never pasted into chat.
  Sync stays off until `UPLISTING_SYNC_ENABLED=true`, as with Hostaway.
- **Payout:** the client chose "what the platform pays out". Confirm Uplisting exposes it, or
  how to derive it, and check one Airbnb and one Booking.com stay against the platform report.

### Phase 2: guest messages and reviews (only if Phase 0 says they are available)
- Messages: poll or webhook into the existing `workspace_guest_messages_ingest` (already
  built, takes `source: 'uplisting'`), so the inbox, reply timing and bonus tiers need no new
  tables. Sending replies from the app needs `messaging:write` and an approval-gated action.
- Reviews: feed the daily review totals on Hub → Reviews & pricing.
- If messaging is **not** available by API, keep entering messages by hand and tell the client
  plainly that reply-time bonuses will rely on manual logging.

### Phase 3: go live
1. Connect the account on a **trial** with two or three test listings first.
2. Run the first sync, check properties, stays, one payout and one checkout clean.
3. Assign owners and teams (imported properties start with nobody assigned).
4. Add the webhook in Uplisting; confirm a new test booking appears within a minute.
5. Switch on the schedule, then connect the remaining listings.

## Risks and fallbacks
- **API not on our plan or invite-only:** fall back to **iCal feeds** per listing (read-only
  bookings, no payouts, no guest names), or evaluate a cheaper channel manager with an open API.
  The app-side design above is provider-neutral, so switching provider is a new mapper and runner.
- **Duplicate and out-of-order webhooks:** already handled by fetching fresh and upserting by
  `(source, reference)`.
- **Cancellations and edits:** Hostaway logic already moves or cancels the checkout clean
  unless it has been started; the same rule applies.
- **Pricing drift:** confirm before the client commits and before the checklist is re-sent.

## Decisions needed from the client
1. Confirm Uplisting (rather than a cheaper alternative) and the number of listings.
2. Who owns the Uplisting account and sends the Phase 0 email (support replies go to the account holder).
3. Is automated guest messaging a must-have, or acceptable to enter by hand if the API does not allow it?

## Sources
- [Uplisting "API & Webhooks" help article](https://support.uplisting.io/en/article/api-webhooks-vzlowi/)
- [Uplisting API (public Postman docs)](https://documenter.getpostman.com/view/1320372/SWTBfdW6)
- [Uplisting help: Public and Partner API](https://support.uplisting.io/en/category/public-and-partner-api-10rq3o4/)
- [Uplisting help: MCP server](https://support.uplisting.io/en/article/uplisting-mcp-server-silb1i/)
- [Cleanster: finding an Uplisting API key](https://help.cleanster.com/how-to-find-uplisting-api-key/)
- [Pricing summary, frontdeskreview (checked 3 Sep 2026)](https://frontdeskreview.com/software/vacation-rental-software/uplisting/)
- [Uplisting Pro plan pricing article](https://temp-help.uplisting.io/en/article/uplisting-pro-plan-pricing-jccwrb/)
- [Uplisting pricing 2026, roommaster](https://www.roommaster.com/blog/uplisting-pricing)
