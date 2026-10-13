# Session A notes: cleans and money

Branch: `claude/compassionate-bardeen-anm9qt`. Nothing here has been applied to the live database or deployed.

Work is on the lead developer's instructions (Lee's decisions of 13 October 2026), in the order 1, 2, 2b, 6, 3, 4. Round 5 (the KPI tracker) is at the end.

## What changed

| Task | Commit | Migration |
| --- | --- | --- |
| Clock-in shows the person's own department | `71f51dc` | none |
| Clean form reminders (client answer 8) | `f132dba` | `20261014100000_clean_form_reminders.sql` |
| 1. Mid-stay cleans switched off | `30cd16d` | `20261014110000_mid_stay_switch.sql` |
| 2. Fee charged after platform fees and changeovers | `3b979ea` | `20261014120000_fee_base_after_changeovers.sql` |
| 2b. Clean charge always the agreed fee; profit per clean | `d7ee22d` | `20261014140000_clean_charge_agreed_fee.sql` |
| 6. Visitor levy | `6129b73` | `20261014150000_visitor_levy.sql` |
| 3. Owner privacy | `cf9834e`, `a20bd36` | `20261014130000_owner_history_internal_events.sql`, `20261014160000_owner_work_staff_fields.sql` |

### Clock-in department (`mobile/src/LiveShifts.tsx`)
- The Home shift card shows a read-only department tag instead of a chooser.
- The department is today's rota department when one is planned, else the one for the role: stays to Guest relations, cleans and cleaning_manager to Cleaning, ready to Ready, accounts to Accounts, everyone else Management.
- A Stays person working in Client relations needs Client relations on the rota for that day.

### Clean form reminders (client answer 8)
- After 18:00 London on the clean day, a clean with no form gets `data.unsubmittedAt`, the event `cleaning.form_reminder` and a notice to its cleaner only.
- From 09:00 London the next day (`private.workspace_clean_form_escalate_time()`, Lee agreed 09:00) it gets the warning, `cleaning.form_missing`, a management flag, and notices to admins and the cleaner.
- A cleaner invoice cannot be approved while any clean on it has no form; each invoice line says `formIn`. Recording and rejecting are unchanged.
- Owners never read the reminder event.
- App: "Unsubmitted" label and filter; Approve disabled in Accounts payable with the cleans named.
- A clean marked unsuccessful already reaches Management approvals as a `cleaning_complaint` decision.

### 1. Mid-stay cleans switch (client answer 5, "forget this for now")
- `private.workspace_mid_stay_cleans_enabled()` is **off**, mirrored by `MID_STAY_CLEANS_ENABLED = false` in `lib/feedback-defaults.ts`.
- While off, `private.workspace_mid_stay_cleans` returns straight away, from the cron and from the Hostaway sync: no new mid-stay cleans, and no existing one is cancelled, moved or changed. Its answer is all zeros with `switchedOff: true`.
- The worker keeps calling it; the switch lives in the database so both callers obey it.
- Switching on again is a one-line migration (`select true`).
- The open mid-stay cleans already created, for Lee to decide what to do with them:

```sql
select w.id work_id, p.name property, w.due_on clean_day, w.status, w.assignee_id cleaner, d.data->>'midStayOf' stay_id
from public.workspace_work_items w
join private.workspace_domain_details d on d.work_id = w.id
join public.workspace_properties p on p.id = w.property_id
where d.kind = 'cleaning' and d.data->>'cleanType' = 'mid_stay' and d.data->>'source' = 'mid_stay'
  and w.status not in ('completed', 'cancelled', 'declined')
order by w.due_on, p.name;
```

### 2. Management fee after platform fees and changeovers (client answer 1, Lee's decision)
- The one base: gross less OTA fees less the statement's changeover charges. No switch. VAT stays 20% of the rounded fee.
- Built in both twins: `private.workspace_statement_compute` and `lib/statement-maths.ts` (`feeBaseMinor`). `private.workspace_statement_fee_base()` only names it now (`payout_after_ota_fees_and_changeovers`).
- Issued and paid statements are never recomputed (the stored-copy rule), so only statements prepared or issued from now on change. An issued statement keeps the base it was issued with, and the screen words its note to match.
- The base is plain subtraction, so a period with cleans and little revenue can have a negative fee, as before.

Worked example, the brief's November (15% fee, VAT on), in pence:

| | Before (after platform fees) | Now (after platform fees and changeovers) |
| --- | ---: | ---: |
| Gross | 175,374 | 175,374 |
| Platform fees | 13,372 | 13,372 |
| Changeovers | 18,000 | 18,000 |
| Fee base | 162,002 | 144,002 |
| Management fee 15% | 24,300 (24,300.3) | 21,600 (21,600.3) |
| VAT 20% | 4,860 | 4,320 |
| Other payables | 8,500 | 8,500 |
| **Payout** | **106,342** | **109,582** |

The owner receives 3,240 more: the fee and VAT on the 18,000 of changeovers.

### 2b. Clean charge (client answer 4)
- Statements always charge the agreed fee per clean. The per-property `clean_charge_mode` column stays (nothing breaks) but the statement no longer uses it, nor a review's decision.
- Actual cost is the cleaner's invoice line only (`private.workspace_clean_cost`; the cleaner's rate no longer counts).
- A clean whose invoice is above the agreed fee is still flagged for staff (`clean_over_agreed`, the cleans-to-review list) but no statement waits for it (`private.workspace_statement_waits_for_clean_review()` is false).
- Performance (staff only) adds profit per clean over the cleans on issued statements that have an invoice: `invoicedCleanCount`, `invoicedChargedMinor`, `invoicedCostMinor`, `cleanProfitMinor`, `profitPerCleanMinor`. Cleans without an invoice are left out and counted.
- Screens: the Terms sheet has no actual-cost choice; the review sheet only records why a clean cost more; Performance shows "Profit per clean".

#### Referral commission: design only, not built
Alex: the cleaner may soon invoice the full amount and Recharge then deducts a "referral commission" from the cleaner.
- **Payables:** a cleaner invoice line would be the full amount the guest-side clean is worth. A new deduction per line (or per invoice) records the commission, at a rate per cleaner or per property (to confirm). What Recharge pays the cleaner = invoice total less the commission. Approval and the clean-form gate are unchanged. If the commission is invoiced to the cleaner separately rather than netted, it becomes a receivable instead.
- **Statements:** unchanged. The owner still pays the agreed fee per clean.
- **Profitability:** profit per clean becomes agreed fee charged + commission received - invoice amount. `workspace_performance_clean_profit` would take the commission as a fourth input.
- **Tax:** the reason for the change. Accounts should confirm VAT treatment of the commission before it is built.
- **Questions:** the rate and who it is set for, when it starts, and whether it is netted from the payment or invoiced.

### 6. Visitor levy (Alex: "a toggle for visitor levy too at 5%... a property specific thing")
- Per-property settings on `private.workspace_property_financials`: `levy_enabled` (default off), `levy_rate_bps` (default 500), `levy_night_cap` (null: every night), `levy_from` (null: every stay). Set with `setStatementTerms` and `visitorLevy`. Nothing about a council is fixed.
- The levy of a stay is worked out once, when a statement first counts it: the accommodation (gross less the guest's cleaning fee from its payout lines) times the levied nights over the stay's nights, at the rate, rounded half away from zero. A platform stay whose payout has no cleaning fee is levied on its gross and flagged `levy_cleaning_fee_unknown` for staff. Owner stays are never levied.
- It is shared across periods by its levied nights (the first nights of the stay) with the statements' floor rule; by check-in month it is taken whole.
- Its own "Visitor levy" line comes straight after the OTA fees: OTA fees, visitor levy, changeovers, management fee, VAT, other payables.
- The fee is charged after the levy: one switch, `private.workspace_statement_fee_after_levy()` / `FEE_AFTER_LEVY`, default true.
- Stored-copy rule: an issued statement keeps each stay's levy and levied nights, and later periods share from that copy, never from the settings as they are now. A stay first issued before the levy existed is never levied. Issuing refuses a draft whose levy setting changed.
- Owners see the levy line and `detail.visitorLevyMinor`.
- Built in both twins. The worked example and the 200 random scenarios (now with levies) match.
- Terms sheet: switch, rate, night cap and first check-in day.

Worked example, an Edinburgh-style setting (5%, first 5 nights, stays from 24 July), 15% fee and VAT on, in pence:

| Stay | Nights | Accommodation | Levy |
| --- | --- | ---: | ---: |
| Airbnb 5 to 9 Nov, settled 50,000 + fees 1,546, guest cleaning fee 6,000 | 4, all levied | 45,546 | 45,546 x 4/4 x 5% = 2,277.3, so **2,277** |
| Direct 28 Nov to 5 Dec, 70,000 | 7, first 5 levied (28, 29, 30 Nov, 1, 2 Dec) | 70,000 | 70,000 x 5/7 x 5% = **2,500**: November 1,500, December 1,000 |

November: gross 81,546 (51,546 + 30,000, the direct stay's 3 of 7 nights), platform fees 1,546, levy 3,777, fee base 76,223 (fee after the levy), fee 11,433 (11,433.45), VAT 2,287 (2,286.6), payout **62,503**.

### 3. Owner privacy
Everything an owner can read about their own work was checked by walking a repair through staff steps, flags and internal events.
- **History** (`20261014130000`): owners no longer get internal events: management and AirCover flags, reflections, routine visit forms, direct-booking follow-ups, clean form events. The repair-resolved entry stays (Lee's decision).
- **Work data** (`20261014160000`): owners no longer get any field ending in `By` (`reportedBy`, `referredBy`, `submittedBy`, `reviewedBy`, `quoteRevisedBy` and so on, each a staff user id), on top of the earlier internal fields. One filter: `private.workspace_owner_work_data`.
- **Test:** `tests/owner-privacy-round4-database.test.mjs` proves the owner reads no staff name or id, no identity field, no internal event and no internal note in the work item and its history, while staff still read everything.
- **Still readable, for a decision:** the activity table rows an owner may read (their work's ordinary events) still carry `actor_id`, a staff user id (no name), and raw event names such as `operations.updateOperation.referReady`. The owner pages use those event names. Hiding the `actor_id` column from owners needs column privileges or a view, which would also change what staff read through the table, so it is left for the lead developer.

### 4. Cleaning manager and clean-form flags: design only, not built (open with Alex)
Today the automatic "Cleaning form missing" flags (`source = 'clean_form'`) are seen and decided by admins only. If Alex wants the cleaning manager to have them:
- **Read:** `private.workspace_flags_read()` lists flags where `manager or raised_by = auth.uid()`. Add: `or (actor = 'cleaning_manager' and x.source = 'clean_form' and private.workspace_can_work(x.work_id))`, so they see clean-form flags on the properties they manage, and no other flags.
- **Decide:** `private.workspace_flag_action` lets only admins `decideFlag`. Either keep it admin-only (the cleaning manager sees and chases, management decides) or allow the cleaning manager to resolve, not decline, `clean_form` flags on their properties.
- **Notify:** `private.workspace_clean_form_sweep` sends the management step's notice to active admins and the cleaner. Add the cleaning managers assigned to the property (`workspace_property_assignments`, assignment `cleaning_manager`) to that outbox insert.
- **Policy:** the flags table stays private (no RLS change); everything goes through those two functions.
- **Screens:** Management approvals already lists what `flags` returns; the cleaning manager's navigation would need the approvals page, or a "Cleaning flags" filter on Cleans.
- One migration in this session's range, with a database test for each role.

## Round 5: KPI tracker
Alex wants his own KPIs, edited by admins in the app, with one per area counting for the bonus. Lee told Alex the backend comes first, so this is mostly backend with simple screens.

| Part | Where |
| --- | --- |
| Table, change log, seed, measures, reads, admin actions | `supabase/migrations/20261015100000_kpi_tracker.sql` |
| App schemas | `lib/workspace-teams-policy.ts` (`kpis` read, `saveKpi`, `setKpiActive`, `moveKpi`), `lib/kpis.ts` |
| My performance (Home card and page) | `lib/my-performance.ts`, `mobile/src/MyPerformance.tsx` |
| Team performance list and the admin's KPI screen | `mobile/src/LiveShifts.tsx`, `mobile/src/KpiAdmin.tsx` |
| Tests | `tests/kpi-tracker-database.test.mjs`, `tests/kpi-screens.test.mjs`, `tests/my-performance.test.mjs` |

**The table** (`private.workspace_kpis`): name, area (the six rota departments), measure key, minutes (only for measures that take them), direction (set by the measure), target % (empty means tracked only), up to five bonus tiers beyond the target, counts for bonus, placeholder, active, sort order, version, who created it, who changed it last and when. A unique index allows only one active bonus KPI per area. Nothing is deleted: a KPI is switched off, which also stops it counting for the bonus. Every change goes into `private.workspace_kpi_changes` with who made it and the row before and after.

**Measures** (`private.workspace_kpi_measures()`; to add one, add its entry there and a branch in `private.workspace_kpi_person_value`, and in `private.workspace_kpi_team_value` when a team is not the average of its people):

| Key | What it is | Areas |
| --- | --- | --- |
| `guest_reply_within` | Share of guest messages answered within N minutes | Guest relations |
| `guest_reply_over` | Share of guest messages that waited longer than N minutes (lower is better) | Guest relations |
| `daily_work_done` | Daily work % (`private.workspace_daily_work`) | Guest and client relations |
| `performance_score` | The blended score Team performance shows | Every area |
| `clean_forms_on_time` | Share of a cleaner's cleans with the form in by 18:00 on the day | Cleaning |

- Guest replies use a new `private.workspace_kpi_reply_rows`: the same conversations, waits and credit as `workspace_response_rows` (a test checks they match), but each wait says whether it was answered. A wait counts for "within N" once it was answered or has lasted longer than N; one still inside N is not counted either way yet. Higher-is-better values round down, lower-is-better values round up, so a rounding never flatters.
- Teams: guest replies count every guest message (also those that came in with nobody on shift); cleaning forms count every clean of the area's cleaners; anything else is the average of the members who have a value.
- A clean is on time when its form is in and the sweep never reminded the cleaner (`unsubmittedAt`) or warned management (`formWarningAt`). There is no submission time on a clean, so a late form sent while the sweep was not running would count as on time.
- A person's area is their rota department, else their role (stays to guest relations, cleans and cleaning managers to cleaning, admins to management). This replaces `BONUS_AREA_BY_ROLE`.
- No data gives no value, shown as "Nothing to measure yet", never 0%.

**Seed** (rows carry a `seed_key`, so a second run adds nothing):

| Area | KPI | Target and tiers | Bonus |
| --- | --- | --- | --- |
| Guest relations | Replies within 5 minutes | Pass mark and tiers from `workspace_performance_targets` (80, then 90 and 95 live) | Yes, Alex's own |
| Guest relations | Replies within 10, 30, 60 minutes; waiting over 60 minutes | Tracked only | No |
| Client relations | Daily work done | 80, 90, 95 | Yes, placeholder |
| Cleaning | Cleaning forms in on time | 80, 90, 95 | Yes, placeholder |
| Ready, Accounts, Management | Performance score | 80, 90, 95 | Yes, placeholder |

**Reads and writes** go through the team routes: `workspace_teams_read('kpis', from, to)` (up to 92 days) and the actions `saveKpi`, `setKpiActive`, `moveKpi`. Admins and super admins see everyone, every area and the last 50 changes, and are the only ones who can change KPIs. Anyone else on the team sees only their own results and their own area's team. Owners are refused.

**Screens**
- My performance: the bonus bar is the area's bonus KPI (target and tiers marked, placeholder labelled), with the area's other KPIs as rows underneath. `BONUS_SCHEMES` and `bonusProgress` are gone.
- Team performance: each person's tag is their bonus KPI's value and tier. The owner reply times list no longer shows a tier from the old targets.
- Team performance → KPIs (admins only): area tabs, the list with "Counts for the bonus", "Switched off" and "Placeholder" tags and who changed it last; add, edit, switch off or on, move up or down.

**`workspace_performance_targets` still works** and is still read by:
- the reply grades in `workspace_response_rows` (green and amber minutes);
- `score`, `onTrack` and `bonusTier` in the `teamPerformance` read;
- the client relations owner reply times (pass mark and tiers);
- the daily-work targets and their weight.

Only the screens' bonus moved to the KPIs.

**Targets sheet (lead's follow-up):** the "Change the targets" sheet (now "Reply and daily-work targets") no longer shows the pass mark or the bonus tiers.
- It sends the stored values back unchanged, so nothing that looks like a bonus setting stays there.
- What is left: the green and amber reply minutes, the daily-work targets per Stays shift day, and how much daily work counts in the score.
- The stored pass mark still sets "on track" in Team performance; it can only be changed in the database now.

**Clean form `submittedAt` (lead's follow-up, `20261015120000_clean_form_submitted_at.sql`):**
- The server stamps `data.submittedAt` when the cleaner sends the form. The app sends nothing new.
- A clean sent back after a review keeps its first stamp.
- "Cleaning forms in on time" uses the stamp when it is there (at or before 18:00 London on the clean's day). Older cleans without it fall back to the reminder markers.

## Round 5: Accounts, fewer buttons
Lee: "minimize buttons as much as possible, so users will not be overwhelmed."

**Shared pieces (new files)**
- `mobile/src/CalendarPicker.tsx` with `lib/calendar-picker.ts`:
  - a compact month calendar for one day or a range, built on the team calendar's `monthGrid`;
  - optional counts on each day, month arrows, and "Today" and "Whole month" links;
  - 44pt day cells on the phone, arrow keys and Page Up and Down on the web.
  - `DateField` is one field showing the period ("1 Oct 2026 to 31 Oct 2026") that opens the calendar under it.
  - `LiveCalendar.tsx` is not touched.
- `mobile/src/Dropdown.tsx`: one control showing the current choice. On the web it is the browser's select; on the phone, a plain list under it.

**Platform stays (Reconciliation)**
- The row of day chips is now the calendar. Each day shows how many stays in view check in that day, after the search, platform and status filters.
- Choosing a day narrows the figures and the list to it. A heading names the day and has "Approve these N", with the same held-back rules as before.
- Choosing the day again, or "All dates", clears it.
- "Approve all N" at the top always covers the whole filtered set.
- Logic: `lib/payout-calendar.ts`.

**Approve the payout**
- `mobile/src/PayoutApproveSheet.tsx` lists, before the amount box:
  - the property and its address;
  - the guest (staff only) and the number of guests;
  - the platform, the reservation code and the Hostaway reference;
  - check-in, check-out and nights;
  - the money: expected, received or "Not received yet", the difference (highlighted when not zero), and gross, platform fee and net when known;
  - the matched payout lines;
  - any warnings: cancelled, the same amount on several lines, money changed after the statement, or the stay changed since the statement;
  - one line saying what approving does.
- The amount, "Why this amount is right" and the button are unchanged. The note is still always required (5 characters), as before.
- Extended the read: the new finance report `payoutStay` (`20261015110000_payout_stay_summary.sql`, finance roles only, read only) adds the guest name, stay status, payout lines, the issued statement holding the stay, and the two statement warnings.
- `LiveAccounts.tsx` opens the new sheet from `openPayout`. `AccountsPayable.tsx` is not touched.

**Statements**: the month chips and "Custom dates" are replaced by one date field:
- it defaults to the page's month;
- "Whole month" on the calendar picks a month, which moves the page's month as the chips did (`pickStatementDates` in `lib/tracker-statements.ts`);
- any other range is custom and sends the same request as typed dates did.

**Performance**:
- "This month / Last month / Last 3 months / This year / Choose dates" is replaced by one date field, defaulting to this month.
- Region and Channel are dropdowns with the same values as before.
- The property chips shown when there are 8 or fewer properties are left for Session B's search-only picker change.

## Round 6: long tab rows become a dropdown
Lee: "I'd rather have a drop down, so it's much cleaner." The Management tabs ran off the screen after "Daily tasks".

**How it works**
- `Pills` moved into `mobile/src/Pills.tsx`; the rule lives in `lib/pills.ts`.
- 5 or fewer choices stay pills, on one line. On a narrow phone that line scrolls sideways instead of wrapping.
- More than 5 become the shared `Dropdown`, showing the current choice, e.g. "Waiting on you".
- The dropdown lists every choice with the pill's own words, so a count in a label ("Waiting (3)") shows there too.
- Same props and the same `onChange`, so no screen's logic changed. `wrap` is still accepted from older callers but no longer changes anything.
- A new optional `title` names the dropdown for screen readers; Management passes "Management section".
- `AccountsPayable.tsx` re-exports `Pills`, so old imports still work. Every screen now imports it from `./Pills`.
- `Dropdown`:
  - on the web it is the browser's select, in the app's Montserrat font;
  - on the phone it is a combobox that opens a plain list;
  - `showLabel={false}` hides the heading text when it stands in for a row of tabs.
- No migration.

**Screenshots** (in `docs/screenshots/session-a/`):
- `management-before-desktop.png` and `management-before-phone.png`: the old row runs off the screen.
- `management-after-desktop.png` and `management-after-phone.png`: one dropdown, and a 3-choice row still as pills.
- How they were made: the live Management screen needs a signed-in backend, so a temporary page (not committed) drew Management's header and real section row with the app's theme, using the old code for "before" and `Pills.tsx` for "after".

**Every screen that uses Pills** (choices, then what it becomes):

| Screen | Choices | Now |
| --- | --- | --- |
| Management sections (`LiveManagement`) | 12 or 13 | Dropdown |
| Client relations sub-pages | up to 8 | Dropdown when more than 5 |
| Guest relations sub-pages | up to 5 | Pills |
| Expense category (`AccountsPayable`) | 6 | Dropdown |
| Evidence kind, expense status | 4, 5 | Pills |
| Cleaner filter on cleaner invoices | the cleaners, plus "All" | Dropdown when more than 5 |
| Performance property, when 8 or fewer properties | up to 9 | Dropdown when more than 5 |
| KPI area, in the list and in the form | 6 | Dropdown |
| Rota department (`LiveShifts`) | 6 | Dropdown |
| Usual shift, range (`LiveShifts`) | 3 | Pills |
| Access control filter (`LiveAccessControl`) | 6, counts in labels | Dropdown |
| Access control People or Menu order | 2 | Pills |
| Menu order role (`MenuOrderEditor`) | 8 | Dropdown |
| Person role (`LivePeople`) | role list | Dropdown when more than 5 |
| Login platform (`LivePeople`) | 8 | Dropdown |
| Login holder; property status; person and property filters | 2, 3, 5, 4 | Pills |
| Guest inbox channel | 6 | Dropdown |
| Guest inbox "how long ago" | 5 | Pills |
| Listing night (`ListingSheets`) | the nights | Dropdown when more than 5 |
| Listing platform, review, decision, sentiment | 4, 3, 2, 3 | Pills |
| Calendar mode, team | 4, up to 5 | Pills |
| Stays Today or Guest inbox; stay status; stay channel | 2, 2, 5 | Pills |
| Owner expenses property and month | per owner | Dropdown when more than 5 |
| Owner expense category | 5 | Pills |
| Owner period, saved replies audience, onboarding filter, reflection range and read state, oversight area, accounts channel | 4, 3, 3, 3 and 2, 5, 5 | Pills |

**Where the switch may feel wrong** (for Lee to look at):
- **Access control filter** (6 choices with live counts) is tapped often. A dropdown hides the counts until opened. Dropping one filter would keep it as pills.
- **Rows of exactly 5 that used to wrap now scroll sideways on a phone**, so the fifth choice can sit just off screen:
  - the person filter with counts;
  - expense status;
  - the accounts and stay channels;
  - oversight areas;
  - owner expense categories;
  - "how long ago".
  This follows the "one line, no wrapping" rule.
- **The KPI area in the KPI form** is a natural dropdown. Its list of areas is also a dropdown now, so admins see one area at a time, as before.
- Two-option toggles all stay pills.

## Deploy order for this session's migrations
Apply in filename order, before deploying the Worker (the Worker code is unchanged by this session):

1. `20261014100000_clean_form_reminders.sql`
2. `20261014110000_mid_stay_switch.sql`
3. `20261014120000_fee_base_after_changeovers.sql`
4. `20261014130000_owner_history_internal_events.sql`
5. `20261014140000_clean_charge_agreed_fee.sql`
6. `20261014150000_visitor_levy.sql`
7. `20261014160000_owner_work_staff_fields.sql`
8. `20261015100000_kpi_tracker.sql` (round 5; needs nothing new in the Worker beyond the updated teams schemas)
9. `20261015110000_payout_stay_summary.sql` (round 5; the Worker needs the updated finance schemas for the `payoutStay` report)
10. `20261015120000_clean_form_submitted_at.sql` (round 5; after 20261015100000)

Things to tell the team after:
- Clean form reminders start at 18:00, and the management flag comes at 09:00 the next day.
- An invoice for cleans without a form cannot be approved.
- New statements charge the fee after changeovers and charge every clean at the agreed fee.
- No new mid-stay cleans are made; the query above lists the open ones.
- KPIs: the bonus now follows each area's bonus KPI. Every area except guest relations has a placeholder until Alex sends his.

## Open questions
For Alex:
- **Visitor levy collection:** do Airbnb or Booking.com collect and pass on the levy for these stays, or does Recharge? If a platform collects it, it may already be inside or outside the payout, which changes the base.
- **Visitor levy base:** with or without the cleaning fee, and with or without VAT. Today it is the gross less the guest's cleaning fee.
- **Fee and levy:** is the management fee charged before or after the levy? Today it is after.
- **Which properties, and from which date,** the levy applies to.
- **Referral commission:** rate, who it is set for, start date, netted or invoiced.
- **Cleaning manager:** should they see, and decide, clean-form flags?
- **KPIs for the other areas:** the real measure, target and tiers for client relations, cleaning, ready, accounts and management. Each has a placeholder at 80, 90 and 95 today.
- **Guest relations tracked KPIs:** should within 10, 30 or 60 minutes, or "over 60", have targets of their own?
- **Team guest reply figures:** should messages that come in with nobody on shift count against the team? Today they do.

For Lee or the lead developer:
- Whether owners should stop reading `actor_id` on activity rows (see task 3).
- Whether to take the pass mark and tiers out of the "Change the targets" sheet now that the bonus follows the KPIs.
- A clean has no submission time, so "forms in on time" relies on the sweep's reminder marker. A `submittedAt` on the form would make it exact.

## Tests run
- Targeted database and unit tests for every change: clean forms, mid-stay, statements (worked examples and 200 random scenarios), visitor levy, clean costs, performance, finance, payables, privacy.
- `npx tsc --noEmit -p mobile/tsconfig.json`: no errors. Root: only the 5 known `remotion` errors in `landing/`.
- ESLint clean on the changed files.
- The only failures are the CRLF line-ending checks, which the lead developer is handling across the repo.
