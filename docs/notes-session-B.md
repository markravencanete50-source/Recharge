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

# Round 5 (15 October 2026): every new enquiry in Properties straight away (built)

Lee approved section 5. Built on `claude/serene-babbage-xgqaus` after merging the lead branch
(`claude/fervent-brahmagupta-8qd03b`, fast-forward to `5a113a3`). One migration:
`20261015200000_enquiry_property_on_submit.sql`. Not applied anywhere.

## What happens now

- **Submit** (`workspace_enquiry_public`, action `submit`). In the same transaction as the answers, it creates:
  - the property: status onboarding, named from the first line of the address by the same rule as
    `valuationDraft`, region from the address, `created_by` = the sender;
  - the journey: stage `enquiry`, no owner, and only the property's facts (WCs, parking, garden, photo link,
    existing client);
  - the "Property onboarding" work item, `created_by` = the sender.

  The landlord's name, email, phone, correspondence address and notes stay on the enquiry. One submit per
  link and the 30-day expiry are unchanged.
- **Onboarding team:** the journey's existing insert trigger gives Guest relations staff with property
  onboarding their usual assignment. Nobody is signed in during a public submit, so the trigger now falls
  back to the work item's creator (the sender) for `granted_by`.
- **Duplicates.** Flagged, never merged, using two new columns on the enquiry:
  - `duplicate_of` is another property in use at the same address (case, punctuation, spacing, the
    postcode's space and a trailing UK or Scotland are ignored);
  - `duplicate_reason` is `same_address`, or `existing_client` when the landlord said they already work with
    us.
- **Start valuing** reuses the property. The team's corrections (name, address, region, type, rooms,
  enquiry details) are saved onto it and no second property is made. If an estimate was already published
  from the property, its details are left as they are. Enquiries answered before the migration have no
  property and keep the old path.
- **Closing** an enquiry whose property is still at the enquiry stage archives the journey and the property,
  and marks the work item declined, as for any archived journey (`workspace_onboarding_status_guard` allows
  nothing else, and still refuses every other change). Nothing is deleted. A property that has moved on is left alone.
- **Privacy.**
  - Owners, cleaners, the cleaning manager and Ready have no assignment, so they never see it.
  - Accounts could read every property (the table policy and `workspace_can_property`). Both now leave out
    a property whose journey is still at stage `enquiry`. **This also hides enquiries the team adds by
    hand from Accounts until they are valued**, which matches the rule; flagging it in case Accounts relied
    on it.
  - The `enquiry.received` notice is unchanged. Giving it a property would change who reads it under
    `activity_scoped`, so `activity_scoped` and `workspace_activity` are untouched.
- **App:**
  - `LiveEnquiries.tsx`: the button reads "Check the details and value" when the property already exists
    ("Start valuing" for older enquiries); a "Possible duplicate" badge on the row with a note in the sheet;
    an "Open" link to the property; the close sheet says the property is archived too.
  - `lib/tracker-onboarding.ts`: one row per property; the journey row carries "From: the enquiry form" and
    the duplicate flag, for staff only.
  - `lib/property-table.ts`: the Properties table shows the stage "New enquiry".
  - `lib/client-enquiry.ts`: the new fields, with defaults so older reads still parse. Once the property
    moves on, the enquiry's step follows the property.

## Existing answered enquiries (no backfill, for Lee to decide)

Enquiries answered before this migration and not yet valued keep today's flow: their property is made when
someone presses Start valuing. To list them (not run; no contact details selected):

```sql
select e.id, e.status, e.submitted_at, e.sent_by
from private.workspace_client_enquiries e
where e.status = 'received' and e.property_id is null
order by e.submitted_at;
```

If Lee wants them converted, one more migration in my range can call
`private.workspace_enquiry_create_property(id)` for each of them.

## Files outside my original list

- `lib/client-enquiry.ts`: the enquiry schema and step.
- New test files: `tests/enquiry-property-database.test.mjs` and `tests/enquiry-property.test.mjs`.

## Tests

- **App side:** `tests/enquiry-property.test.mjs`, 6 of 6 pass.
- **Related non-database tests:** tracker-onboarding, property-table, enquiry-and-preview, tracker-sections,
  navigation-v2 and wiring-v2: 87 of 88 pass. The 1 failure is the known CRLF check in `wiring-v2`.
- **Types and lint:** `npx tsc --noEmit -p mobile/tsconfig.json` passes. ESLint on the changed files is
  clean apart from an unused `web` import in `LiveEnquiries.tsx` that was already on `main`.
- **Database tests:** `tests/enquiry-property-database.test.mjs` covers create, privacy per role,
  duplicates, Start valuing reuse, closing, older enquiries, and running twice. It and the existing
  `tests/client-enquiries-database.test.mjs` have **not been run yet**: running database tests was blocked
  by this session's permission check midway through this round. See the open points.

## Open points

1. **Database tests.** The Lead ran them on `c2a8bbc`: 11 of 13 passed, including all of
   `client-enquiries-database`. Both failures are now fixed:
   - Closing tried to set the onboarding work item to "cancelled". `workspace_onboarding_status_guard`
     allows only "declined" once a journey is archived, so it is now set to "declined", the journey's own
     rule. The test also checks that the guard still refuses cancelled, completed and declined from anyone
     else.
   - The "runs twice" test passed the whole migration to `db.query`. It now uses `db.exec`.

   Every patch anchor is a single line, so the migration does not depend on line endings: `.gitattributes`
   checks SQL out as CRLF, and the live functions may have been created from LF text.
2. **Lee:** convert the enquiries answered before this change, or not (query above).
3. **Lee:** should unvalued enquiries count in the portfolio summary and on the map? They currently do, as
   onboarding.

## Tell the team

- Accounts no longer see a property while it is at the enquiry stage, including one the team adds by hand
  before valuing it. It appears for them as soon as it is valued (estimate stage onwards).
- Every answered enquiry form is now in Properties straight away, as "Onboarding · New enquiry". Closing
  the enquiry archives that property.
- "Possible duplicate" on an enquiry means: check the other property and close one if it is the same place.
  Nothing is merged automatically.

# Round 5, second task: menu order per role (Lee's request)

Built on `claude/serene-babbage-xgqaus` after merging `main` (`b25d02f`). One migration:
`20261015210000_menu_layouts.sql`. Not applied anywhere. For this round Session B owns the navigation.

## What it does

- **Access control → Menu order** (super admins only; a new People / Menu order switch at the top of
  Access control, in `mobile/src/MenuOrderEditor.tsx`):
  - pick a role (Super admin, Admin, Guest relations, Cleaning manager, Cleaner, Ready, Accounts, Owner);
  - move its sections up or down, and the links inside each section up or down;
  - press **Save and publish**. **Undo changes** and **Reset this role to default** are there too, with
    "Last changed by X on ...".

  The move buttons are plain 44-point buttons with labels such as "Move section Overview up", so they work
  on a phone, with a keyboard and with a screen reader. There is no drag.
- **Live preview:** it shows the phone bar, the left panel and the phone menu's sections for that role. It
  is built by the same code the app uses (`rolePanel` with the layout, then `orderPhoneBar`), with the
  role's usual tools.
- **Arrange only, never grant.** `lib/menu-layout.ts` (`applyMenuLayout`):
  - it starts from the sections and links the role and its tools allow, then applies the saved layout;
  - **links can move between sections** (Lee's answer): each section lists its links in order, and a link
    belongs to the section that lists it. If a layout lists a link under two sections, the first wins:
    sections in the saved order first, then any other listed sections;
  - a link the layout does not list (for example a tool added later) goes back to its default section,
    after the listed ones, in its default order;
  - unknown keys, keys the role does not have, sections the role does not have, and repeats are ignored;
  - a section left with no links is hidden in the app. The editor keeps it ("Empty: hidden for this role
    until a link is moved here"), so links can be moved back.
- **Move to section:** every link in the editor has a "Move to…" button. It opens a row of plain buttons,
  one per other section, and the link goes to the end of the chosen section. Move up and Move down work as
  before.
- **Stable keys:**
  - each section now has a key in `lib/role-panel.ts` (`overview`, `departments`, `calendar-messages`,
    `management`, `more`, `start`, `today`, `work`, `guests-listings`, `my-day`, `my-work`, `me`,
    `cleaning-team`, `cleaning-desk`, `jobs`, `ready-desk`, `accounts`, `money`, `costs`,
    `your-properties`, `requests`);
  - links use their existing keys (`page:home`, `area:stays`, `tool:payouts`...);
  - renaming a section title keeps its key.
- **Desktop and phone use the same merged menu** (`mobile/src/LiveWorkspace.tsx`):
  - **Desktop:** the left panel is `rolePanel(role, modules, layout)`.
  - **Phone bar:** the same destinations as today, reordered by where they come in the merged menu (Work
    counts as the first Work area). So the first sections fill the bar.
  - **Phone menu:** there was no More menu on phones. A new **Menu** button in the phone header opens a
    sheet with every section in order, without the places already on the bar.
  - **Work tabs:** the phone's Work area tabs follow the order of the areas too. Which area opens first does
    not change.
- **View as:**
  - **a person:** the reads run as that person, so the menu shown is their role's;
  - **a role preview** (no person): the app takes that role's layout from the super admin's list of every
    role;
  - **Demo mode:** uses the default order.
- **Publishing:**
  - after Save, the editor's own app updates at once, through `mobile/src/MenuLayoutStore.ts`, when the
    saved role is the editor's own;
  - everyone else gets it on the existing one-minute quiet refresh, or when they reopen the app;
  - the read is one small row.

## Database (`20261015210000_menu_layouts.sql`)

- `private.workspace_menu_layouts`: one row per role (`sections` array, `items` object of arrays, `version`,
  `updated_by`, `updated_at`). Empty arrays mean the default order.
- Team read `menuLayout`: anyone signed in gets **their own role's** layout, order data only (role,
  sections, items, version).
- Team read `menuLayouts`: super admins get every role's layout, with who changed it and when.
- Team actions `saveMenuLayout` and `resetMenuLayout`:
  - super admins only;
  - optimistic version check (version 0 is a role never changed);
  - keys must be stable keys (lower case, digits, `: _ = -`), each once, at most 40 sections and 80 links
    per section;
  - a retried request gets the same answer (action receipts).
- Every save or reset writes `workspace_access_events` (`menu_order_saved` / `menu_order_reset`). The person
  and the actor are both the super admin, the old order is in `old_access`, and the role and new order are in
  `new_access`. Access control's history shows "Menu order saved · Guest relations".
- Routes are appended after the hub anchors in `workspace_teams_read` and `workspace_teams_action`. They
  are single-line anchors with sentinels, so the migration is safe to run twice.
- Schemas: `lib/workspace-teams-policy.ts` gained the two read sections and the two actions (at the end
  of their lists).

## Tests

- `tests/menu-layout.test.mjs`, 13 of 13 pass:
  - the merge never adds a tool the role lacks and never loses one, and lists each link once;
  - a link moved between sections shows there on desktop, on the phone bar and in the phone menu;
  - a link listed twice stays in the first section;
  - an emptied section is hidden in the app and kept in the editor;
  - a moved link disappears when the role loses its tool, and a new tool appears in its default section;
  - saved order applied;
  - unknown and duplicate keys ignored;
  - new tools fall in at their default place;
  - the desktop panel, phone bar, phone menu and Work tabs agree;
  - the editor's moves, and the preview equals what the role gets;
  - request schemas;
  - wiring.
- `tests/menu-layout-database.test.mjs`, 5 of 5 pass:
  - own-role read only, order data only;
  - only super admins can save or reset (admin, staff and owners refused);
  - version check;
  - keys checked;
  - access history and retry;
  - the migration runs twice.
- Database tests that share the patched team routes, plus the two enquiry ones: management-flags,
  enquiry-property, client-enquiries, team-calendar, aircover-links, day-reflection, daily-tasks,
  access-control. 67 of 67 pass.
- Whole non-database suite: 849 of 861. The 12 failures fail on `main` too:
  - 5 are line-ending checks: this checkout's files predate the new `.gitattributes` and are LF;
  - 7 need build output (prepared Worker, preview, hosted routes, icon fonts, Cloudflare redirect).
- `npx tsc --noEmit -p mobile/tsconfig.json`: no errors. ESLint: no errors on the changed files.

## Decisions (Lee and the Lead, 13 October)

1. Links can move between sections: Lee said yes, and it is built (`128e016`).
2. Phone bar: decided by the Lead. It stays as built: the bar follows the section order, and the Menu
   button sits in the phone header. There is no editor control for the bar this round. Lee can change this
   later.
3. Home tools: decided by the Lead. They keep their own order this round. Lee can change this later.
4. Section titles: decided by the Lead. They cannot be renamed in the editor. Lee can change this later.

# Round 5, third task: the property and person picker is search only (Lee)

Lee: "don't add property names just make it searchable, the less buttons the less confusion."

## What changed

- **One picker:** `mobile/src/SearchPicker.tsx` (`SearchPicker`, `PropertySelect`). It is used in 28 places.
  The rule is in `lib/search-picker.ts` (`pickerView`). Matching (`lib/search-options.ts`) is unchanged.
- **Long lists (more than 8 options):**
  - **before anything is typed:** only the search box, the fixed options ("Every property", "All
    properties", "Not sure yet", "Me") and the current choice as one selected chip (with `clearable`,
    tapping it clears the choice). When nothing is chosen, a line says "Nothing chosen yet. Type to find
    one of the 101 properties.";
  - **once something is typed:** the best matches (up to 12) as before, the current choice kept first,
    "Showing x of y properties. Keep typing to narrow it down." when there are more, and "Nothing matches
    ..." when there are none.
- **Short lists (8 or fewer):** unchanged. Every option is a chip, with no search box.
- **Placeholder:** `PropertySelect` now reads "Search for a property by name, street or postcode".

## Every screen that uses it

- **A choice is needed, and the button waits for it:** Create clean (`LiveCleans.tsx`, the button is
  disabled until a property is chosen) and Check figures in Statements (`AccountsStatements.tsx`, disabled
  with "Choose a property to check its figures"). Both are fine.
- **A choice is needed, but the button only checks when pressed** (an error names the property): Record a
  stay (`StaySheet.tsx`), Report a repair and New routine plan (`LiveRepairs.tsx`), and Supplier invoice
  (`AccountsPayable.tsx`). They still work, and the picker now says "Nothing chosen yet". **Suggested
  follow-up (not done; these files are not mine this round):** disable each Save until a property is
  chosen, as Create clean does.
- **The first property is already chosen:** Restock requests (`LiveTools.tsx`). Fine.
- **Choosing acts at once (the picker always starts empty):** Give someone a property (`LivePeople.tsx`,
  type, then tap to assign), Find a person (`LivePeople.tsx`) and New to-do's property step
  (`HubItemSheet.tsx`). Fine: type, tap, done.
- **Filters with a fixed option:** Checklist templates (Every property), Calendar property and person
  filters (All properties / everyone), Guest inbox property (Not sure yet), Team events (Me). Fine.
- **Optional, clearable:** Receivable (stay, property, client), Performance filter, Cleaner invoices
  property filter, Messages property, To-do property, Team time owner and backup. Fine.
- **People pickers that are usually short:** Assign a cleaner (`LiveCleans.tsx`, only the cleaners who can
  take that clean), To-do assignee, Team time person. Unchanged while 8 or fewer.
- **Feels wrong: the Messages property filter in the guest inbox** (`InboxChips.tsx`). Its chips carried a
  count per property ("Leith flat (3)"), so the team could see where messages were waiting. On a long
  list those counts are now hidden until something is typed. Lee to decide: keep it search only, or show
  the properties with waiting messages there. Not special-cased.
- `LiveHub.tsx` also uses it, but that screen is retired and not routed.

## Tests

- `tests/search-picker.test.mjs`, 5 of 5 pass:
  - no chips before typing on a long list;
  - fixed options and the current choice still shown;
  - matches (the same as `searchOptions`) appear when typing, with the count and the no-match state;
  - short lists unchanged;
  - the component uses the view.
- `tests/search-and-cancel.test.mjs`, 7 of 7 pass (matching unchanged).

## Lee's four acceptance screens: before and after

All four use the shared picker (`AccountsStatements.tsx` line 298, `AccountsReceivable.tsx` line 66,
`AccountsPerformance.tsx` line 102, and `HubItemSheet.tsx` for AirCover's "Add a claim"), so the change
covers them. None shows a chip before typing now.

**How the shots were taken:** these screens only render with a signed-in backend. So a temporary route
(not committed) rendered the real `SearchPicker` / `PropertySelect` with each screen's own props (empty
text, `clearable`, placeholder, nouns). It used made-up data of the reported size, 101 properties and 332
stays, and Playwright took the shots in Chromium.
- **Before:** the picker as it was at `128e016`.
- **After:** the current picker. A third shot for each screen shows it after typing.
- The surrounding screens are not in the shots.

| Screen | Before | After | After typing |
| --- | --- | --- | --- |
| Statements → Prepare a statement → Property | ![](screenshots/session-b/before-statements.png) | ![](screenshots/session-b/after-statements.png) | ![](screenshots/session-b/after-statements-typed.png) |
| Receivable → Record invoice → Guest stay | ![](screenshots/session-b/before-receivable.png) | ![](screenshots/session-b/after-receivable.png) | ![](screenshots/session-b/after-receivable-typed.png) |
| Performance → Filters → Property | ![](screenshots/session-b/before-performance.png) | ![](screenshots/session-b/after-performance.png) | ![](screenshots/session-b/after-performance-typed.png) |
| AirCover → Add a claim → Property | ![](screenshots/session-b/before-aircover.png) | ![](screenshots/session-b/after-aircover.png) | ![](screenshots/session-b/after-aircover-typed.png) |

Before, each showed 12 chips, with property names, or for stays the property, HA code and dates, plus
"Showing 12 of 101 properties" or "Showing 12 of 332 stays". After: the search box and "Nothing chosen yet.
Type to find one of the ...". Typing shows up to 12 matches with "Showing x of y. Keep typing to narrow it
down."

## Follow-up: Save waits for a property

- **Where:** Record a stay (`StaySheet.tsx`), Report a repair and New routine plan (`LiveRepairs.tsx`), and
  Supplier invoice (`AccountsPayable.tsx`, edited for this change only).
- **What:** Save stays disabled until a property is chosen, and "Choose a property first." shows just above
  it while none is chosen. The rule is one helper, `saveDisabled(busy, propertyId)` with
  `CHOOSE_PROPERTY_FIRST`, in `lib/search-picker.ts`.
- **Unchanged:** each form's own check when saving, and the server's check.
- **Tests:** `tests/search-picker.test.mjs` checks the rule (disabled with no property or while saving,
  enabled once one is chosen) and, per screen, that the Save button uses it and the hint is shown. 11 of 11
  pass. The screens are checked from their source, because this repository has no React Native
  renderer for tests.
- **Guest inbox filter counts:** left as they are. Session C's Messages redesign removes that filter.
