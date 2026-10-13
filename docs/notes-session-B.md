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

# Round 2 (13 October 2026)

## 4. Region data: Dunbartonshire filed as East Lothian

**Cause (code).** A property's region comes from `normaliseRegion` in `lib/regions.ts` (app) and its twin
`private.workspace_infer_region` (database; the trigger fills a blank region on save and import and never
replaces a set one). Both test the place names in a fixed order and the first match anywhere in the text wins.
East Lothian's list has `dunbar`, which also matches inside "Dunbartonshire" and "Dunbarton", and East Lothian
is checked before Dunbartonshire. So any address, or council name, with "West Dunbartonshire" or
"East Dunbartonshire" was filed as East Lothian. The postcode lookup has the same fault: it turns the council
name from postcodes.io into a region with the same function (`regionForCouncil` in `lib/postcode-lookup.ts`).
Edinburgh's `leith` had the same problem with Innerleithen (Scottish Borders).

**Fix.** `dunbar` and `leith` now match whole words only, in `lib/regions.ts` and in migration
`20261014200000_region_whole_words.sql` (it replaces `workspace_infer_region` only and changes no stored data).
Not applied to any database. `lib/regions.ts` was outside my original file list; the region task needed it.

**Tests** (`tests/property-region-database.test.mjs`): Dunbartonshire and Innerleithen addresses and council
names in the app and the database, a new property in West Dunbartonshire filed under Dunbartonshire, and every
place name in the rules plus all 32 council names mapping to their own area. They fail without the fix. The
six region-related test files pass (49 tests).

**Affected live properties** (read with one SELECT on 13 October; nothing written). 101 properties checked.
Street addresses are left out of this file on purpose (no live records in the repository); Lee can see them in
Properties.

| Property id | Name | Stored region | Region from its address |
| --- | --- | --- | --- |
| `292802c6-13ad-4b01-865a-d6f6b69b0369` | 416 Main | East Lothian | Dunbartonshire (West Dunbartonshire, G83) |
| `1946216c-40da-4b10-a4b8-77fa0cfc178d` | Townend v2 | East Lothian | Dunbartonshire (Dumbarton, G82) |

There are two, not one. Applying the migration does not move them, because the trigger never replaces a set
region. If Lee agrees, either edit the region on each property in the app, or run this (not run):
`update public.workspace_properties set region='Dunbartonshire' where id in ('292802c6-13ad-4b01-865a-d6f6b69b0369','1946216c-40da-4b10-a4b8-77fa0cfc178d') and region='East Lothian';`

**Also seen, not changed (the stored regions are right):**
- A street named after a town wins over the real town, because the first rule to match wins: "65 Huntly"
  (Huntly Terrace, Paisley) and "80 Huntly" (Huntly Ave, Livingston) would be filed as Aberdeenshire and
  Moray if their region were blank. Both have the right region typed in. A sturdier rule would take the match
  furthest to the right (the town and council come after the street) or use the postcode district. That
  changes more results, so it is a separate decision.
- "5 Eden" is stored as Aberdeen, but its address is in Peterhead (AB42), which the rules file under
  Aberdeenshire and Moray. It was typed in, so it may be on purpose.

## 5. Proposal: a property from a public enquiry, before valuation (not built)

Today a submitted landlord form waits as *New: ready to value*. **Start valuing** (`startValuing` in
`workspace_client_enquiry_action`) runs `createEnquiry` as the staff member. That creates the property, the
onboarding journey (stage `enquiry`) and the "Property onboarding" work item. The proposal is to do the same at
the moment the landlord submits.

**What the property looks like before valuation**
- `workspace_properties.status = 'onboarding'`, the journey at stage `enquiry`. No new status: the check
  constraint allows only onboarding, active and archived, and every screen already treats "onboarding, stage
  enquiry" as a new enquiry (the Properties table shows the stage "New enquiry"; the onboarding tracker shows it
  first).
- Name: the first line of the property address, address and room counts from the answers, the same as the
  draft `lib/client-enquiry.ts` already builds for Start valuing. Region left blank so the trigger works it out
  from the address (this is where the region fix above matters).
- `created_by` = the staff member who sent the link (`sent_by`), since the landlord has no account and the
  submit runs with the service key (`auth.uid()` is null).

**Owner link**
- None. `journeys.client_id` stays null and no `client` assignment is made, exactly as for an enquiry the team
  adds for someone without an account. The form never creates an account. When the landlord later gets one,
  the existing owner assignment links it.
- If the landlord answered "existing client: yes", or the address matches an existing property, the enquiry is
  flagged as a possible duplicate for the team, not merged automatically.

**Who can see it**
- Admins and super admins; the sender, by a `staff` assignment when they are Guest relations (`stays`), as
  `createEnquiry` does today; anyone else only through the usual property-onboarding access.
- Never owners, cleaners, Ready or Accounts (no assignment, and no stays or cleans exist for it).
- It shows in the Properties table and the onboarding tracker. It is also counted in the portfolio summary
  under "onboarding" (`portfolioSummary` counts every property that is not archived). Lee to decide whether an
  unvalued enquiry should count there.

**Closing**: closing or declining such an enquiry archives the property and cancels its onboarding work item,
as long as the journey is still at stage `enquiry`. Nothing is deleted.

**Migration and functions** (one file, `20261014210000_enquiry_property_on_submit.sql`, anchor and append like
the round 3 migrations, safe to run twice)
1. New `private.workspace_enquiry_create_property(e private.workspace_client_enquiries)`, security definer, no
   grants. Inserts the property, the optional staff assignment, the work item and the journey (the same rows as
   `createEnquiry`, without its role checks, which need a signed-in actor). Sets `property_id` on the enquiry.
2. Patch `private.workspace_enquiry_public`, `submit` branch: after the `update ... set status='received'` line,
   call (1). The activity event `enquiry.received` gets the property id.
3. Patch `private.workspace_client_enquiry_action`:
   - `startValuing`: when the enquiry already has a property, update its name, address, region, type and rooms
     from the team's corrections and move the enquiry to `valuing`. Do not create a second property.
   - `closeEnquiry`: archive the property and cancel the work item (stage `enquiry` only). The rule
     "already being valued" stays as it is.
4. No backfill: enquiries already received keep today's flow, unless Lee wants them converted.
- App: `LiveEnquiries.tsx` says "Check the details and value" and opens the property; the onboarding tracker
  already drops an enquiry row once it has a property (`onboardingTrackerItems`), so no double rows.
- Test: a new `tests/enquiry-property-database.test.mjs` covering submit creating exactly one property with no
  owner; who can and cannot read it; startValuing reusing it; closing archiving it; a second submit refused.

**Decisions for Lee before building**: (a) status `onboarding` at stage `enquiry` (recommended) or a new
status; (b) count unvalued enquiries in the portfolio summary and the map, or hide them until valued;
(c) the sender's staff assignment; (d) archive on close (recommended) or delete; (e) convert enquiries already
received.
