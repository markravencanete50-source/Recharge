# Session B notes: trackers and Client relations (13 October 2026)

Branch `claude/serene-babbage-xgqaus`, from `main` at `f17c4bf`. No migrations, nothing deployed or applied.

## 1. Latest update text on every tracker row

- `updateLine(u, now, owner)` in `lib/tracker.ts` gives the stamp and then what changed:
  "Today 14:05 · Morag Reid · Invoice recorded". `mobile/src/Tracker.tsx` uses it for the phone card,
  the table's Last update column (now 240 wide, two lines) and the detail sheet. Screen readers get the
  same line in each row's label.
- Owners get the stamp only ("Today 14:05 · Recharge"): no staff name and no step name. That was
  already the rule in the detail sheet, and it is now one function. The database already sends owners
  no `updatedBy` or `updatedEvent` (migration `20261012070000`); the adapters also strip `by`.
- Question for the client: owners could see the fixed status words some adapters set (statements
  "Issued" or "Paid", AirCover "Marked as paid"). They are not names. To allow them, return
  `what` for owners in `updateLine` when it came from those adapters.

## 2. Direct-booking next action

- Cause: the next action was the first form the person could use. With the discount policy not yet
  confirmed, "Prepare a direct-booking offer" is unavailable (`gateDiscountPolicy`), so the first usable
  form was `recordGuestDecline`, titled "The guest said no". Every open follow-up read as a refusal.
- Fix (`lib/tracker-direct-bookings.ts`): each phase names the one form that moves it on
  (`prepareQuote`, `recordGuestAcceptance`, `confirmBooking`). That form is the next action. When it is
  unavailable the row shows the reason ("The discount policy awaits confirmation."), otherwise
  "Waiting for Guest relations" or "Waiting for Accounts". "The guest said no" is still offered as a
  button in the detail sheet.
- Wording for a declined follow-up: next step "Closed, the guest declined the offer"; the step's
  detail "The guest declined the offer".

## 3. Guest relations routine and the "Stays" labels

- `StaysRoutineCard.tsx` takes `part`. Guest relations (`part="guests"`) shows repairs to refer, cleans,
  AirCover, direct-booking offers and the Monday owner reports. Client relations (`part="clients"`, new,
  above the chips in `ClientRelations.tsx`) shows listing checks and empty nights to price. The card
  passes `TodaysRoutine` only that part's tools, so `StaysRoutine.tsx` is unchanged.
- Question for the client: the Monday "Weekly performance reports" item (sending owners their report)
  is still in Guest relations. It may belong in Client relations too; moving it means adding
  `weekly-performance` to `CLIENT_TOOLS` in `StaysRoutineCard.tsx`.
- "Stays" changed to "Guest relations" where users see it: "Waiting for Guest relations" in onboarding,
  enquiries, licensing and preventative visits, "Waiting for Guest relations to sign off", and the
  missed-checks approval row "Guest relations team". These are the team's name (the `stays` role). The
  listings adapter already said "Guest relations". "Stays still to reconcile" in statements means guest
  stays, not the team, so it was left.

## Tests

- New: `updateLine` (`tests/tracker.test.mjs`), the next action and the declined wording
  (`tests/tracker-guest-relations.test.mjs`), and a source check that the routine parts are split.
- Updated for the new wording: `tests/tracker-onboarding.test.mjs`, `tests/tracker-sections.test.mjs`
  and `tests/maintenance-forms.test.mjs` ("Waiting for Stays" became "Waiting for Guest relations").
- Ran every non-database test that mentions trackers or these screens (20 files): 250 of 254 pass.
  The 4 failures also fail on `main` without these changes. Each one checks for CRLF line endings,
  and this Linux checkout has LF files:
  - `wiring-v2` "the files this change touched have no em dashes and keep their line endings"
  - `tracker-guest-relations` "none of the new files contains an em dash ... CRLF"
  - `payables-screens` "the screens are wired ..." (AccountsPayable keeps CRLF line endings)
  - `statements-screens` "house rules ... CRLF source" (AccountsStatements has a lone LF)
- `npx tsc --noEmit -p mobile/tsconfig.json` passes with no errors (after `npm ci` in `mobile/`). The
  root `tsconfig.json` has 5 errors, all about the missing `remotion` packages in `landing/`. They are
  the same on `main`. ESLint is clean on the changed files.

## Waiting for the client's answers (not started)

- **Direct-booking cutoff: exactly seven nights, or more than seven?** The rule is in the database:
  `check_out - check_in >= policy.minimum_nights` in `workspace_direct_booking_sweep`
  (migration `20261012180000`), in `recordReservation` and in the reservation-change trigger. The
  setting is `private.workspace_booking_policy.minimum_nights`. `StaySheet.tsx` defaults to 7
  (`DEFAULT_MINIMUM_NIGHTS`). If the answer is "more than seven", one option needs no SQL change: set
  `minimum_nights` to 8. The other option is to change `>=` to `>` in a migration between
  `20261014200000` and `20261014299999`. Also check the record-a-stay hint wording in `StaySheet.tsx`.
- **Public enquiries creating a property immediately.** Today a submitted enquiry waits as "New: ready
  to value" until **Start valuing** creates the property and its onboarding journey
  (`LiveEnquiries.tsx`, `lib/client-enquiry*.ts`). Doing it on submit means the public
  `workspace_enquiry_public` submit path (service key) creates the property. That needs a migration
  in this session's range, and a decision on who owns a property nobody has valued yet.
