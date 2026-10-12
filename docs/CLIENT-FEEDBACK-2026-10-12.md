# Client feedback, 12 October 2026

Alex's two screen recordings ("Dashboard Workflow Feedback", 24 min, and "Property Management
Workflows", 7.5 min), turned into a list of asks and checked against the code on 12 October 2026
(commit `770bc93`). The code was read, not run.

## Decisions already made

- **No WhatsApp.** All communication (guests through Hostaway, email, the internal team) stays
  inside the Recharge app. Checklist item C11 in `CLIENT-VIDEO-CHECKLIST.md` is dropped.
- **The ChatGPT "Management Hub" prototype Alex showed is not the target layout.** Keep its
  functions (a simple row per item, click in for the checklist and progress bar) and improve the
  design.

Key: ✅ built · 🟡 partly built · ❌ not built

**Totals (35 asks, as audited before any building):** ✅ 0 · 🟡 26 · ❌ 9

**Build progress (12 October 2026):** Phase 1 is built on the local branch `feedback-2026-10-12`
(not committed or pushed). C1 and C2 now exist as shared components, piloted on purchase orders and
licensing (Hub tabs, Accounts Purchases, the shared work sheet); the C9 style pass is done. The
tables below still show the audit as it stood before this work. Details, the unapplied migration and
the checks are in `DEVELOPER-HANDOVER.md` ("Client feedback round 2"). Phases 2 to 7 are not started.

IDs here start with A, B, C and D so they do not clash with the older C, D, O and S numbers. Section D
comes from a written Accounts brief Alex sent after the videos. The videos only mention accounts in
one line ("invoices to be sent, invoices to be settled, owner statements, performance reporting"),
so the written brief is the current source for Accounts.

## The one pattern behind most asks

Every section should look and work the same: a plain row per item (full property address, next
step, next action, last update with date, time and who made it), and a click-in view with a
progress bar, the full checklist and every detail. Any item can be flagged for management, and
flagged items arrive in one Management approvals list. Building that once (C1 and C2) unlocks most
of the rest.

## A. Home, inbox, to-do, calendar

| # | Ask | Status | What exists / what is missing |
|---|---|---|---|
| A1 | Home is each person's own area: their favourites, clock in and out, own performance, bonus earned, own schedule, quick task overview | 🟡 | Clock in and out, pauses, a guest-reply score and today's jobs exist (`LiveHome.tsx`, `LiveShifts.tsx` `ShiftCard`, `TodayBoard.tsx`). "Your tools" is a fixed per-role list (`lib/home-tools.ts`), not the person's favourites (`Favorites.tsx`). No bonus amount (only the tier), no own performance for most roles, no schedule beyond the usual shift. |
| A2 | Remove the quick-action buttons and property counts from Home | ❌ | `HomeTools.tsx` still shows the pills from `homeActionsFor`; `LiveHome.tsx` `QuickOverview` still starts with a property count. |
| A3 | Reports becomes "my performance" | ❌ | `Reports.tsx` shows generic task charts. Per-person data exists (cleaner `performance` section, `teamPerformance`) but is not wired in. |
| A4 | Messages is shorter and Updates folds into it | ❌ | Updates is still its own page (`LiveActivity`, `lib/role-panel.ts`, `liveNavigation`). `LiveChat.tsx` has Guests, Clients and Team tabs. |
| A5 | Inbox is purely communication (guests, email, team), no shiny animation | 🟡 | Messages covers guests (Hostaway ingest), clients and team chat. Email is only logged by hand; no inbound email. WhatsApp is still a channel option (`GUEST_CHANNELS`, `CHANNEL_LABEL` in `guest-inbox-policy.ts`) and should go. A duplicate "Guest inbox" tab sits inside Stays (`LiveStays.tsx`). Entrance and pop motion in `LiveChat.tsx`. |
| A6 | To-do list replaces Daily checks: guest relations and client relations headings, daily and department tasks added automatically, a personal list | 🟡 | A personal to-do exists but only as a Hub tab (`LiveHub.tsx`, `lib/hub.ts`). "Daily checks" is still a Stays section and a Home tool. No two headings, no automatic daily or department tasks, no maintenance reminders. |
| A7 | Daily sign-off becomes an end-of-day reflection, required before clocking out | ❌ | Only the Stays tick-box `SignOffCard` (`signOffDay`) exists. No ticket counts, no went-well or not-well, no feedback, no weekly management review, and `clockOut` does not check it (enforced in the database, migration `20261010290000_productivity.sql`). |
| A8 | No separate Stays; fold it into Guest relations | ❌ | Stays is still a Work area (`workViewsFor` in `lib/tool-directory.ts`, `lib/role-panel.ts`). Guest relations exists only as a department label. |
| A9 | Team calendar like Hostaway's: guest names and dates, a changeovers view, cleaners, booked maintenance, where each person is, near the top of the menu | 🟡 | `LiveCalendar.tsx` shows arrivals, departures, cleans, repairs, routine visits and inspections with team and person filters. Missing: guest names (the data is available at Hostaway ingest), a changeovers view, absences and meetings (no model at all), and its position in the menu. |
| A10 | Remove Hub; keep Training and Favorites | 🟡 | Training and Favorites stay as asked. Hub is still a Work view for every team role (`LiveHub.tsx`). It also holds to-dos, approvals, purchase orders, preventative, AirCover and invoices, so those need homes first. |

## B. Cleans, bookings, maintenance, management flag

| # | Ask | Status | What exists / what is missing |
|---|---|---|---|
| B1 | Cleans list with the assigned cleaner, a "submitted forms" column and a flag for outstanding forms | 🟡 | `LiveCleans.tsx` and `WhoIsCleaning` (`DefaultCleaners.tsx`) show today's cleans by cleaner with phase tags. No submitted-form column and no outstanding-form flag or notice. |
| B2 | Team checks the form and the guest is happy, then clean complete; a complaint or a missing form goes to warning and creates a management ticket | 🟡 | `reviewCleaning` (`lib/operations-policy.ts`) accepts or rejects. A rejection starts the cleaner dispute flow and appears under "Needs a management decision". A missing form never triggers anything, and no ticket reaches a general management list. Alex has not decided what the warning state should do. |
| B3 | Direct bookings as their own section: any stay over 7 nights creates a ticket and the team follows up | 🟡 | `recordReservation` creates a `direct_booking` item at the policy minimum (7 by default), with follow-up, quote, accept, confirm and decline steps. Hostaway bookings do not create it (old item S12). It sits in "Bookings & licences" and the Stays routine card, not its own section. |
| B4 | Air cover claims: its own section, accounts can see it, any maintenance ticket can be flagged as a claim, opening shows the issue and the claim's journey | 🟡 | A Hub AirCover tab exists with stages to claim, claimed, paid and declined (`20261010190000_hub_items.sql`). A claim is a standalone row with no link to a maintenance item, so no flag and no issue shown. Accounts lacks the `aircover-reporting` tool by default (`lib/modules.ts`). `LEGACY-PORT-PLAN.md` called this optional, so this is a change of scope. |
| B5 | Reactive maintenance: ticket with property and issue, automatic troubleshooting, resolved or sent to Ready, Ready quotes, client approves before booking | 🟡 | Property, repair type, issue, a guided troubleshooting checklist (`lib/repair-guides.ts`), `referReady`, `bookRepair` and owner approval exist. Troubleshooting is manual and has no "resolved, mark complete" exit (`closeRepair` only follows a decline). A cost estimate is required up front (`estimatedCostMinor`), which Alex says the team cannot give. The owner approves the team's estimate before Ready, not Ready's quote. |
| B6 | Preventative maintenance (routine, garden, bins): a form required before completion, last done and next due, a calendar with availability, booked by Ready | 🟡 | Monthly visits are created automatically (`workspace_routine_plans`, `workspace_routine_visits`); the Hub Preventative tab shows Last, Done, Photos and Next; the calendar shows booked visits. The visit form is optional (`VisitSheet` in `LiveRepairs.tsx`), "last" is a date not "X days ago", and there is no availability view. |
| B7 | A "flag for management attention" on every section, arriving in one Management approvals list; staff can also add a free-standing request | ❌ | No flag exists anywhere. Hub Approvals allows a free-standing request but requires an amount, non-admins see only their own, and it is a separate list from the Admin Home "Needs a management decision" queue (`management-live.ts`). |
| B8 | The relevant team is notified as items are ticked off | 🟡 | Onboarding stages notify Ready and Stays; hub approvals notify the requester; repair and clean decisions have notice copy (`lib/notice-copy.ts`). Nothing routes by team when something is ticked off, and the flag does not exist. |

## C. Properties, onboarding, accounts, style

| # | Ask | Status | What exists / what is missing |
|---|---|---|---|
| C1 | One row format everywhere: address, next step, next action, last update with date, time and author | 🟡 | No such row exists. `SheetTable.tsx` is used mainly in Hub tabs with different columns each; Stays, Cleans, Maintenance and Accounts use cards or `Row`. Last-update data exists (`updatedAt`, `WorkHistory` actor) but never reaches list rows, and `PropertyView` has no `updatedAt`. |
| C2 | Click in for a progress bar, the full checklist and every detail | 🟡 | The generic work sheet (`LiveWorkspace.tsx`, `lib/work-details.ts`) has no checklist or bar. Checklists with bars exist only for cleans, Stays routine, Home and Owner Home. Licensing, purchase orders, listing health, pricing, reviews, re-listing, direct bookings, AirCover and invoices have none. |
| C3 | Property onboarding as a staged list, new enquiries first, progress to 100% | 🟡 | Stages exist (`ONBOARDING_PHASES` in `lib/workspace-view.ts`, `onboardingProgress()`), shown by `OnboardingPipeline` and the Hub Onboarding tab. Not grouped by stage, no percentage, sorted furthest-along first (the opposite of what Alex wants), and enquiries are a separate screen (`LiveEnquiries.tsx`). Notifications at each stage are built. |
| C4 | Properties database as a table: status, Scotland region, last update; click in for cleaner, landlord, access, maintenance history, statements, payout | 🟡 | `LiveProperties` is a card grid with no region or last-update column. The detail sheet covers owner, listings, stays, set-up answers, masked payout, access, work and invoices. The assigned cleaner is not shown there (it lives in `DefaultCleaners.tsx`), owner statements live in Accounts, and reactive and proactive history are mixed together. |
| C5 | Licensing ticket created from the onboarding tick, same format | 🟡 | Auto-created when `licensingRequired` is set, with the staged process (`workspace_handover`, `lib/workflow-forms.ts`). No licensing list, checklist or progress bar. |
| C6 | Purchase orders in the same format | 🟡 | Hub Purchase orders tab and the Accounts Purchases section exist. No address, next action, last comment, checklist or progress. |
| C7 | Listing health, pricing, reviews and re-listing as tabs in the same format | 🟡 | The Hub tab is a per-day count table. Listing health, reviews and pricing are cards under "Daily checks" (`LiveStays.tsx`); re-listings are a `Row` list. |
| C8 | Accounts: invoices to send, invoices to settle, owner statements, performance reporting | 🟡 | "Invoices to send" (Hub) and owner statements (`LiveAccounts.tsx`) are built. No dedicated "to settle" list (only the per-property Settled tick). Team performance is admin-only (`LiveManagement.tsx`); owners see earnings, not team performance. |
| C9 | Style: thinner text, solid green not shiny, no shiny animations, outline icons | ❌ | The opposite is in place. See "Where the style lives" below. |

## D. Accounts (from Alex's written brief)

| # | Ask | Status | What exists / what is missing |
|---|---|---|---|
| D1 | Accounts receivable: tickets added by admin or accounts for any guest stay or client invoice; direct bookings may need an invoice created and sent | 🟡 | Hub "Invoices to send" (`private.workspace_hub_items` kind `invoice`, `20261010190000_hub_items.sql`) and onboarding invoices (`workspace_create_invoice`) exist. The ticket has no link to a reservation or client, no invoice document is generated or sent (manual until Xero and email are connected), and there is no "to settle" list. |
| D2 | Match Airbnb, Booking.com and VRBO payout reports to reservations by reservation code to confirm funds were received | 🟡 | Airbnb and Booking.com are built: `readPayoutReport` (`lib/payout-reconciliation.ts`), `importPayoutReport`, `workspace_payout_lines` matched on `channel_reference`, states matched, different, missing, no reference, agreed, bulk agree (`PayoutStays.tsx`). VRBO is excluded in three places (`lib/workspace-finance-policy.ts`, the `channel` check on `workspace_payout_reports`, and `prepareStatement` and `workspace_owner_period_cell`), so a VRBO stay is treated like a direct stay with no check that funds arrived. No VRBO file format exists. |
| D3 | Accounts payable: tickets for every supplier invoice, matched to an approved clean or maintenance task | 🟡 | `workspace_expenses` with evidence, `createExpense`, `approveExpense`, `linkExpenseJob`, and `recordPurchaseInvoice` exist (`LiveAccounts.tsx`). `linkExpenseJob` accepts only a completed repair or a delivered purchase, so a clean cannot be linked. There is no cleaning expense category. Cleaner invoices are grouped separately (`LiveAccountsWork.tsx`) and are not part of the payables that statements read. |
| D4 | Owner statements auto-generate: occupancy %, nights booked, gross revenue, then chronological deductions (OTA fees, changeovers, management fee 12% or 15% plus VAT set per property, other payables), payout due, and a net figure if the owner enters monthly expenses | 🟡 | `prepareStatement` and `workspace_owner_statements` give revenue, cleans (accepted cleans times the agreed clean cost), approved expenses, the management fee (`management_fee_bps` per property) and the payout. Missing: OTA fees shown as their own deduction (revenue is already net of the platform cut, `syncPayoutMinor` in `lib/hostaway-sync-policy.ts`), VAT on the fee, a 12% or 15% choice, chronological order (fixed buckets today), occupancy % and nights on the statement itself (only in the owner period summary, `OwnerPeriodSummary.tsx`), a selectable period (monthly only; membership is by check-in date), auto-generation (prepared on request), and owner-entered expenses with a net figure (no table or screen at all). |
| D5 | A toggle for the clean charge, because the value charged to the owner differs from what was paid; clean cost is not carried across automatically from payables | 🟡 | The two are already separate (`cleaning_cost_minor` on `workspace_property_financials` versus `workspace_cleaner_rates`), and cleaning is not carried across from payables. There is no switch between "charge the agreed fee" and "charge the actual cost", and no per-clean actual cost beyond the cleaner's flat rate. |
| D6 | Flag a clean for manual review when its actual cost is more than the value charged | ❌ | Nothing compares the cleaner rate or invoice with `cleaning_cost_minor`. The nearest flags are the expense approval limit and `expensesOverLimit` in `lib/management-live.ts`. |
| D7 | Any stay longer than 14 nights gets a mid-stay clean | ❌ | The Hostaway sync creates one "Checkout clean" per reservation (`20261007113021_hostaway_sync_functions.sql`). Nothing handles long stays. |
| D8 | Performance: money made from management and cleaning fees, plus occupancy and nightly rates, filterable | 🟡 | Per-owner occupancy, average nightly rate and earnings exist (`lib/owner-reports.ts`, `LiveClientReports.tsx`), and team performance is admin-only. Nothing sums management-fee or cleaning-fee income across properties, and there is no portfolio occupancy or rate view or filters (`lib/business-reports.ts` covers work volumes only). |

Facts a builder will need for section D:
- `private.workspace_property_financials` already holds `management_fee_bps` and `cleaning_cost_minor`
  per property; a VAT flag and a clean-charge mode column would sit there. `setStatementTerms` and
  `saveFinance` (`lib/business-private-routes.ts`) are the only writers.
- Reservations are keyed by `private.workspace_reservations.reference` (`HA:<hostaway id>`) and by
  `channel_reference` (the platform code), unique per channel and matched case-insensitively.
- The payout reader sums repeated codes, and `AMOUNT_HEADERS` lists `amount` before `paid out`. If a
  real Airbnb export fills both, the gross column wins over the net one, so check against a real file.
- The Host fee, Commission and Cleaning Fee columns of the sample payout files are ignored on import,
  so itemised OTA-fee and cleaning-fee lines need new columns on `workspace_payout_lines`.
- `tests/owner-statements-inbox-database.test.mjs` already includes a VRBO stay and can be reused.

## Where the style lives (C9)

- **Weights:** `mobile/src/Typography.tsx` maps 700, 800 and 900 to `Montserrat_700Bold` and 600 to
  SemiBold. Remapping that table (for example 700 to SemiBold, 600 to Medium) is the cheapest change.
  Web CSS weights are in `app/workspace-theme.css` and `app/globals.css`; token styles are in
  `mobile/src/theme.ts` (`ui.title`, `statValue`, `sectionTitle`, `buttonText`, `label`).
- **Green:** `lib/design-tokens.ts` (`primary`, `bright`, `chart`, `hero`, `heroEnd`, `heroGlow`,
  `header`, `wash`). Gradients and sheen come from `primaryFill()` and `depthTokens` in `theme.ts`,
  `IconChip` in `LiveKit.tsx`, the hero gradients in `LiveEnquiries.tsx`, `LiveProductivity.tsx`,
  `RoleNavigation.tsx`, `LivePages.tsx` and `DemoMode.tsx`, and `premiumCss` (`[data-sheen]`,
  `[data-hover=lift]`, `[data-canvas]`). Dark mode flips primary and header to mint, so both token
  sets need editing.
- **Animation:** the sign-in loops (`LiveSignIn.tsx`, `Float` in `motion.tsx`), shimmer, `SwapIn`,
  `Entrance`, `Stagger`, `TweenNumber`, `DrawLine`, `Bump` and `Pop` (`motion.tsx`),
  `Celebrate.tsx`, `RechargeSplash.tsx`, and the `nav-settle` and `workspace-arrive` keyframes.
- **Icons:** `DimensionalIcon.tsx` (gradient and shadow illustrations) is used in `LiveRows`,
  `HomeTools`, `HomeOverview`, `LiveOwnerHome`, `LiveAccounts`, `LiveCalendar`, `TeamFlows`,
  `WorkspaceSearch` and `WelcomeMoment`. `HomeScene.tsx` and `RechargeSplash.tsx` are illustrated.
  Outline (Feather) icons already exist in most places; their colours come from `departmentTokens`
  and `navHueTokens`.

## Suggested build order

1. **Foundation (C1, C2) and style (C9), in parallel.** A shared tracker row and detail sheet built
   on `SheetTable`, fed by `updatedAt` and `WorkHistory`. The style pass is mostly token and
   `Typography.tsx` changes, so it is cheap and visible straight away.
2. **Management flag and one Management approvals list (B7, B8).** Merge Hub Approvals with the
   Admin Home decisions queue. Many other asks feed into it.
3. **Home and navigation (A1 to A4, A6 to A8, A10).** Includes the end-of-day reflection (A7), which
   needs a new table and a `clockOut` change.
4. **Section conversions to the shared format (C3 to C8).** Onboarding stages first, then properties,
   licensing, purchase orders, listing health and pricing, accounts.
5. **Operations flows (B1 to B6).** Unsubmitted-clean flag and automatic review, Hostaway direct
   bookings, air cover linked to maintenance, the reactive flow, the preventative form.
6. **Calendar and inbox (A9, A5).** Guest names, changeovers and absences; drop WhatsApp from the
   channel list.
7. **Accounts (D1 to D8).** Start with the data model on `workspace_property_financials` (fee
   percentage choice, VAT flag, clean-charge mode), then VRBO payout matching, then statements
   (itemised OTA fees, chronological deductions, occupancy and nights, selectable period, owner
   expenses and net), then the clean cost review flag and the 14-night mid-stay clean, then the
   performance view. Payables need a link between a clean and its supplier invoice first.

## Open questions for Alex

- What should happen when a clean gets a complaint or has no form (the warning state)?
- The full onboarding checklist and process, which Alex offered to send.
- The proactive maintenance form (Alex offered to help write it).
- Listing health checks and pricing: guest relations or client relations? The two videos differ.
- Reactive repairs: should Ready quote before the owner is asked, with no estimate up front?
- Absences and management meetings on the calendar: who can add them, and who sees them?
- Accounts: which of "invoices to be sent" and "invoices to be settled" (the video) is Receivable and
  which is Payable (the written brief)?
- The brief says the payout amount is "payable to the guest". Does it mean the owner?
- Is VAT charged on the management fee only, or on other statement lines too? Is the 12% or 15% rate
  fixed for the life of a property?
- Which deduction order exactly: OTA fees, changeovers, management fee, other fees, as listed?
- Should the statement period be any chosen date range, and are stays split across period ends
  counted by nights inside the period (the brief says occupancy and nights for the period)?
- What counts as "actual cost" of a clean: the cleaner's flat rate or the cleaner's invoice?
- A mid-stay clean for a 14-night-plus stay: one clean at the midpoint, or one every 14 nights?
- A real VRBO payout report sample, and a real Airbnb export (to check which amount column is used).

## Watch-outs for whoever builds this

- Renaming the "Daily checks" section breaks Home tools, because `sectionAnchor("Daily checks")` is
  used in `lib/home-tools.ts`, `StaysRoutine.tsx`, `WorkHistory.tsx` and `LiveOversight.tsx`.
- `tests/role-panel.test.mjs` and `tests/home-tools.test.mjs` assert the current navigation and
  must change with it.
- The Stays sign-off notices (`stays.daily_signoff`, `stays.missed_yesterday`) and the oversight
  "missed" queue are built on the old sign-off and need rework with A7.
- The 12 October chat report and block migrations (`20261012010000`, `20261012030000`) are still
  marked "not yet applied to the live database" in `DEVELOPER-HANDOVER.md`.
