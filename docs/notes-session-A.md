# Session A notes: cleans and money

Branch: `claude/compassionate-bardeen-anm9qt`. Nothing here has been applied to the live database or deployed.

Work is on the lead developer's instructions (Lee's decisions of 13 October 2026), in the order 1, 2, 2b, 6, 3, 4.

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

## Deploy order for this session's migrations
Apply in filename order, before deploying the Worker (the Worker code is unchanged by this session):

1. `20261014100000_clean_form_reminders.sql`
2. `20261014110000_mid_stay_switch.sql`
3. `20261014120000_fee_base_after_changeovers.sql`
4. `20261014130000_owner_history_internal_events.sql`
5. `20261014140000_clean_charge_agreed_fee.sql`
6. `20261014150000_visitor_levy.sql`
7. `20261014160000_owner_work_staff_fields.sql`

Things to tell the team after:
- Clean form reminders start at 18:00, and the management flag comes at 09:00 the next day.
- An invoice for cleans without a form cannot be approved.
- New statements charge the fee after changeovers and charge every clean at the agreed fee.
- No new mid-stay cleans are made; the query above lists the open ones.

## Open questions
For Alex:
- **Visitor levy collection:** do Airbnb or Booking.com collect and pass on the levy for these stays, or does Recharge? If a platform collects it, it may already be inside or outside the payout, which changes the base.
- **Visitor levy base:** with or without the cleaning fee, and with or without VAT. Today it is the gross less the guest's cleaning fee.
- **Fee and levy:** is the management fee charged before or after the levy? Today it is after.
- **Which properties, and from which date,** the levy applies to.
- **Referral commission:** rate, who it is set for, start date, netted or invoiced.
- **Cleaning manager:** should they see, and decide, clean-form flags?

For Lee or the lead developer:
- Whether owners should stop reading `actor_id` on activity rows (see task 3).

## Tests run
- Targeted database and unit tests for every change: clean forms, mid-stay, statements (worked examples and 200 random scenarios), visitor levy, clean costs, performance, finance, payables, privacy.
- `npx tsc --noEmit -p mobile/tsconfig.json`: no errors. Root: only the 5 known `remotion` errors in `landing/`.
- ESLint clean on the changed files.
- The only failures are the CRLF line-ending checks, which the lead developer is handling across the repo.
