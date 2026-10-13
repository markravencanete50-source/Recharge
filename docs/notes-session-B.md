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
  AirCover and direct-booking offers. Client relations (`part="clients"`, new, above the chips in
  `ClientRelations.tsx`) shows listing checks, empty nights to price and the Monday owner reports. The card
  passes `TodaysRoutine` only that part's tools, so `StaysRoutine.tsx` is unchanged.
- The Monday "Weekly performance reports" item (sending owners their report) moved to Client relations
  in its own commit ("Routine: Monday owner reports in Client relations"), so it can be reverted alone if
  the client says no.
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

## Waiting for the client's answers

- **Direct-booking cutoff** (exactly seven nights, or more than seven): both answers are ready in section 6.
- **Public enquiries creating a property immediately**: the proposal is in section 5, waiting for Lee.

# Round 2 (13 October 2026)

Changes to files outside my original list: `lib/regions.ts` (the region rules) and
`tests/property-region-database.test.mjs` (its tests). Both were needed for the region fix.

## 4. Region data: Dunbartonshire filed as East Lothian

**Cause (confirmed).** A property's region comes from `normaliseRegion` in `lib/regions.ts` (app) and its twin
`private.workspace_infer_region` (database, migration `20261010140000`). The database trigger fills a blank
region when a property is saved or imported and never replaces a set one. The postcode lookup
(`regionForCouncil` in `lib/postcode-lookup.ts`) uses the same app function on the council name. Both took the
first rule in a fixed list that matched anywhere in the text, inside words too. East Lothian's `dunbar` is
inside "Dunbartonshire", and East Lothian came first, so "West Dunbartonshire Council" read East Lothian.
The same kind of clash existed for Innerleithen (`leith`, Edinburgh). Street names also beat towns:
"Huntly Terrace, Paisley" read Aberdeenshire and Moray, and "Edinburgh Rd, Glasgow" read Edinburgh.

**Fix** (`lib/regions.ts`, migration `20261014200000_region_whole_words.sql`, not applied anywhere):
- The names live in one list, `REGION_RULES`: per area, council and county names (`councils`: "West
  Dunbartonshire" matches `dunbartonshire`, also "Perthshire", "Clackmannanshire", "Na h-Eileanan Siar") and
  towns and other places (`places`).
- Every name matches as whole words only.
- A council name wins over any place. Among names of the same kind, the one furthest to the right wins,
  because an address runs street, town, council. At the same spot the longer name wins, then the earlier area.
- The migration replaces only `workspace_infer_region`. Its name lists are generated from `REGION_RULES`, and a
  test fails if they ever differ. It changes no stored region.

**Tests** (`tests/property-region-database.test.mjs`, each address checked in the app and the database):
- the reported address shape, both Dunbartonshire councils, and Dunbar itself (still East Lothian);
- 49 real Scottish addresses (public buildings and landmarks), at least one for each of the 21 areas;
- 10 street-name clashes ("Huntly Terrace, Paisley", "Glasgow Road, Dumbarton", "Moray Place, Edinburgh");
- every name in the rules and all 32 council names;
- the migration's name lists equal the app's.

The new tests fail on the old rules and pass on the new. The region-related test files pass (9 files, 69 tests).

**Listing the affected properties.** I wrote no repair UPDATE. Once the migration is applied, this query lists
every property whose stored region differs from what its address now gives:

```sql
select id, name, status, region as stored_region, private.workspace_infer_region(address) as from_address
from public.workspace_properties
where private.workspace_infer_region(address) <> ''
  and region is distinct from private.workspace_infer_region(address)
order by name;
```

I ran the same comparison read-only on 13 October, with the new rule written inline because the migration is
not applied. It covered all 101 live properties and wrote nothing. Four disagree. Each one is the new rule being
right (I checked the addresses). Street addresses are left out here on purpose, so no live records are in the
repository:

| Property id | Name | Stored region | From its address | Why |
| --- | --- | --- | --- | --- |
| `292802c6-13ad-4b01-865a-d6f6b69b0369` | 416 Main | East Lothian | Dunbartonshire | West Dunbartonshire Council, G83 (the reported one) |
| `1946216c-40da-4b10-a4b8-77fa0cfc178d` | Townend v2 | East Lothian | Dunbartonshire | Dumbarton G82, West Dunbartonshire |
| `de9b3438-33e1-4d57-8ab3-ffe4ecda03e3` | 329 Edinburgh | Edinburgh | Glasgow | Edinburgh Rd, Glasgow G33 (street name won) |
| `88f090fa-87eb-4b57-8724-663596c8a840` | 9 Iona v2 | Inverness and Highlands | Fife | Skye Rd, Dunfermline KY11, Fife (street name won) |

- **Repair:** Lee to approve. The migration will not move them, because the trigger never replaces a set
  region. Each can be corrected in the app, or with one approved UPDATE written then.
- **Huntly rows:** "65 Huntly" and "80 Huntly" were typed correctly. Under the old rule their addresses read
  Aberdeenshire and Moray; the new rule agrees with what is stored.
- **"5 Eden":** stored Aberdeen. The address names both Peterhead and Aberdeen, and the new rule now agrees
  with what is stored.

## 5. Proposal: every new enquiry in Properties straight away (design only, not built)

Today a landlord's answers wait as *New: ready to value*. **Start valuing** (`startValuing`) runs `createEnquiry`
as the staff member, which creates the property, the onboarding journey (stage `enquiry`) and the "Property
onboarding" work item. The proposal: do the same when the landlord submits the form.

**What submit creates** (`workspace_enquiry_public`, action `submit`, runs with the service key, no signed-in user):
- **Property:** `workspace_properties` with `status = 'onboarding'`. The name is the first line of the
  property address (as `lib/client-enquiry.ts` already drafts it), plus the address and bedrooms. The region
  is left blank, so the trigger fills it from the address. `created_by` is the staff member who sent the link
  (`sent_by`).
- **Journey and work item:** `workspace_journeys` at stage `enquiry` with `client_id` null, holding the
  property type, bathrooms and answers. The "Property onboarding" work item as today.
- **Enquiry link:** the enquiry keeps status `received` and gains `property_id`.

**Status shown:** "Onboarding", stage "New enquiry". There is no new property status: the check constraint
allows onboarding, active and archived, and every screen already reads stage `enquiry` that way.

**Who owns an unvalued property:** no owner. There is no `client` assignment and the form never creates an
account. The landlord is linked later through the usual owner assignment, once they have an account. The
sender gets a `staff` assignment when they are Guest relations, as `createEnquiry` does today.

**Spam and duplicates:**
- **Spam:** the form only works through a private link the team sent: one link, one submit (the status must be
  "sent" or "opened"), and the link expires after 30 days. So spam needs a leaked link and can create at most
  one property per link.
- **Duplicates:** if the address matches an existing property, after case, spacing and postcode tidying, or the
  landlord answered "existing client: yes", the property is still created, but the enquiry is marked
  "possible duplicate" with the other property's id. The team then closes one; nothing is merged
  automatically.
- **Closing:** closing or declining the enquiry archives its property and cancels the work item, only while the
  journey is at stage `enquiry`. Nothing is deleted.

**PropertiesTable and OnboardingTracker:**
- **PropertiesTable:** shows the row at once, with status "Onboarding", stage "New enquiry", the region from
  the address, and last update = the submit time, shown as "Recharge" to owners.
- **Portfolio summary:** counts it under onboarding (`portfolioSummary` counts everything not archived).
  Open question: should unvalued enquiries count there, and on the map?
- **OnboardingTracker:** shows it as a property in the *New enquiry* group. It already drops an enquiry row
  once the enquiry has a property (`onboardingTrackerItems`), so nothing is listed twice. Start valuing becomes
  "Check the details and value": the team corrects the name, address and region on the property, then values
  it as now.

**Privacy:**
- Owners never see these properties. Nor do cleaners, Ready or Accounts: they have no assignment, and there
  are no stays or cleans.
- The landlord's contact details stay on the enquiry, read only by people with enquiry access
  (`workspace_can_enquiries`). They are not copied onto the property.
- The public submit returns nothing about the property.
- Files stay in the private `enquiry-files` bucket.

**Migration outline:** one file, `20261014210000_enquiry_property_on_submit.sql`, anchor and append, safe to
run twice:
1. New `private.workspace_enquiry_create_property(e private.workspace_client_enquiries)`, security definer, no
   grants. It inserts the same rows as `createEnquiry`, without its signed-in role checks, and runs the
   duplicate check.
2. Patch the `submit` branch of `workspace_enquiry_public`: call (1) after the `set status='received'` update.
   The `enquiry.received` activity carries the property id.
3. Patch `workspace_client_enquiry_action`. `startValuing` reuses the existing property and applies the team's
   corrections instead of creating another one. `closeEnquiry` archives the property while the journey is at
   stage `enquiry`.
4. New column `possible_duplicate_of uuid` on `private.workspace_client_enquiries`, shown in the enquiry view.
5. No backfill, unless Lee wants enquiries already received converted.
6. App: `LiveEnquiries.tsx` gets the new button wording and the duplicate badge.
7. Test: `tests/enquiry-property-database.test.mjs`. It checks one property per submit, with no owner, and
   who can read it; the duplicate flag; startValuing reuse; close archives; a second submit is refused.

**Decisions for Lee or Alex:**
- (a) status `onboarding` at stage `enquiry` (recommended);
- (b) count unvalued enquiries in the portfolio summary and the map, or not;
- (c) give the sender a staff assignment;
- (d) archive on close (recommended), or delete;
- (e) convert enquiries already received.

## 6. Direct-booking cutoff: ready for Alex's answer (not applied)

Today a confirmed booking-site stay of `check_out - check_in >= minimum_nights` gets a follow-up, and the
setting is 7, so **exactly seven nights qualifies**. If Alex says "seven or more", nothing changes.

If Alex says **"more than seven"**, there are two ways to do it:

- **A. Change the setting to 8 (recommended).** No code and no migration. A super admin opens the
  direct-booking policy form in the app ("Minimum nights for an offer", action `configureBookingPolicy`) and
  enters 8. The equivalent one line, for the record only (the app is the right place, because it keeps the
  version and the activity log):
  `update private.workspace_booking_policy set minimum_nights = 8, version = version + 1 where singleton;`
  Everything that reads the setting follows at once: the six-hourly sweep (`workspace_direct_booking_sweep`),
  `recordReservation`, the Hostaway import (`workspace_import_reservation`), the reservation-change path
  (`workspace_controls_action`), the offer's own night check in `prepareQuote` (`not between
  policy.minimum_nights and …`) and the record-a-stay hint. `StaySheet.tsx` reads `minimumNights` from the
  policy, so the hint becomes "8 nights. Stays of 8 nights or more get a direct-booking follow-up for the
  team." This is correct, and no wording change is needed. Watch out: the same form also holds the
  discount-policy "confirmed" tick, so leave it as it is when saving.
- **B. Change `>=` to `>`** in a migration in my range. This is not one line. The comparison is in four
  database functions (`workspace_operations_action` twice, for `recordReservation` and for `prepareQuote`'s
  `not between`; `workspace_import_reservation`; `workspace_controls_action`; `workspace_direct_booking_sweep`),
  each patched by anchor. Then in `StaySheet.tsx` (outside my files): `nights >= minimumNights` becomes
  `nights > minimumNights`, and the hint becomes "Stays of more than ${minimumNights} nights get a
  direct-booking follow-up for the team." The setting label "Minimum nights for an offer" would then be
  wrong and would need renaming too.

**Recommendation: A.** It is one value, consistent everywhere, takes effect immediately and can be undone the
same way.

**Either way:** follow-ups already open for stays of exactly seven nights stay open. The team can close them;
this read-only query lists them:
`select w.id, w.title from public.workspace_work_items w join private.workspace_domain_details d on d.work_id = w.id join private.workspace_reservations r on r.id::text = d.data->>'reservationId' where d.kind = 'direct_booking' and w.status not in ('completed','cancelled') and r.check_out - r.check_in = 7;`
