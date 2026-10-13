# Session A notes: Cleans and money

Branch: `claude/compassionate-bardeen-anm9qt`. Nothing here has been applied to the live database or deployed.

## Done

### Clock-in shows the person's own department (commit 71f51dc)
- `mobile/src/LiveShifts.tsx`: the department chooser on the Home shift card is replaced by a read-only tag.
- The department is today's rota department when one is planned, else the one for the person's role (`departmentFor`: stays to Guest relations, cleans and cleaning_manager to Cleaning, ready to Ready, accounts to Accounts, everyone else Management).
- A Stays person who works in Client relations must have Client relations set on the rota for that day.

### Clean form reminders (client answer 8)
Alex: "if not done by 6pm, prompt the cleaner with reminder notifications and change status of their clean to unsubmitted. No clean invoice will be settled without clean form. If it has been marked unsuccessful or still not filled out next day, auto flag this ticket to management approval section."

- Migration `supabase/migrations/20261014100000_clean_form_reminders.sql`:
  - The hourly sweep now has two steps. After 18:00 London on the clean day the clean gets `data.unsubmittedAt`, the event `cleaning.form_reminder` and a notice to the assigned cleaner only. From 09:00 London the next day it gets the old warning (`data.warning = 'no_form'`), the event `cleaning.form_missing`, a management flag and notices to admins and the cleaner.
  - `private.workspace_clean_form_escalate_time()` = `'09:00'` is my assumption for "next day". It is one function to change.
  - `private.workspace_clean_form_in(data)` is the single "form is in" rule.
  - A cleaner invoice cannot be approved while any live line's clean has no form (patch on `private.workspace_decide_cleaner_invoice`). Recording and rejecting are unchanged.
  - Each invoice line carries `formIn` (patch on `private.workspace_cleaner_invoice_view`).
  - The `activity_scoped` policy also hides `cleaning.form_reminder` from owners.
  - The sweep now answers `{ reminded, warned, skipped }`.
- App:
  - `lib/clean-forms.ts`: "Outstanding" is now "Unsubmitted". A clean is a Warning from 09:00 the next day, no longer from midnight.
  - `lib/feedback-defaults.ts`: adds `CLEAN_FORM_ESCALATE_AT`.
  - `lib/notice-copy.ts` and `lib/oversight-policy.ts`: wording for the reminder.
  - `LiveCleans.tsx`: the filter is now "Unsubmitted forms".
  - `AccountsPayable.tsx`: Approve is disabled, with a note naming the cleans without a form (`cleansWithoutForm` in `lib/accounts-work.ts`, `formIn` in `lib/accounts-live.ts`).
- "Marked unsuccessful": a rejected clean already becomes a `cleaning_complaint` decision in the management queue, which Management approvals lists. No change was needed.

### Mid-stay clean switch (client answer 5: "Forget this for now")
- Migration `supabase/migrations/20261014110000_mid_stay_switch.sql` adds `private.workspace_mid_stay_cleans_enabled()`, ON here, so nothing changes yet.
- Switching it off is a one-line migration (`select false`). While off: no new mid-stay cleans; automatic ones nobody has started are cancelled with the reason "Mid-stay cleans are switched off"; started, submitted or completed ones and cleans made by hand are left alone. Switching back on brings them back for stays still ahead.
- Test: `tests/mid-stay-switch-database.test.mjs`.
- Needs Lee's go-ahead to switch off, because it also cancels unstarted mid-stay cleans already on the schedule.

### Management fee after changeovers, prepared (client answer 1)
- Migration `supabase/migrations/20261014120000_fee_base_after_changeovers.sql` adds a third value to the fee base switch: `payout_after_ota_fees_and_changeovers` (gross less platform fees less the period's changeover charges). The switch still says `payout_after_ota_fees`, so no figure changes.
- `lib/statement-maths.ts`: `feeBaseMinor` and `statementFor` (via an optional `terms.feeBase`) do the same. `lib/tracker-statements.ts` words the note for it. That file is under Session B's `lib/tracker*.ts`, but Session B did not touch it.
- Tests: the 200 random scenarios now also run with the new base (seed 20261015), and the database and TypeScript agree on all of them. Unit cases are in `tests/statement-maths.test.mjs`.
- Before switching: confirm with Alex that "the cleaning fees" means the changeover charges. Also decide whether the fee base should stop at zero; today it is plain subtraction, so a period with cleans but little revenue gives a negative fee.

### Owner privacy, the remaining place
- An owner reading the history of their own work still got internal events by name (management and AirCover flags, reflections, routine visit forms, direct-booking follow-ups, clean form events), because `private.workspace_work_history` reads with its own rights and the round 3 policy did not reach it.
- Migration `supabase/migrations/20261014130000_owner_history_internal_events.sql` leaves those entries out for owners. The repair-resolved entry stays (Lee's decision). Staff are unchanged.
- Test: `tests/owner-history-internal-events-database.test.mjs`. It fails without the migration.

## When this goes live
- Apply `20261014100000_clean_form_reminders.sql`, `20261014110000_mid_stay_switch.sql`, `20261014120000_fee_base_after_changeovers.sql` and `20261014130000_owner_history_internal_events.sql` (in that order) before deploying the Worker. The Worker code is unchanged; it already calls `workspace_clean_form_sweep` hourly.
- On the first run, cleans from the last 14 days without a form that were already warned keep their warning. Open cleans of today get a reminder after 18:00. Earlier ones go straight to the management step.
- Invoices already waiting for approval whose cleans have no form can no longer be approved until the form is in. They can still be rejected.

## Waiting on Alex
- Q1 management fee base: prepared; switch once Alex confirms "cleaning fees" means the changeover charges, and Lee decides on a zero floor.
- Q4 actual clean cost off the statement, and the referral-commission model.
- Q5 mid-stay cleans: switch ready; switch off once Lee confirms existing unstarted ones may be cancelled.
- Q7 VRBO money through Stripe: which report to reconcile against.
- Real VRBO and Booking.com payout files.

## For other sessions
- Nothing needed from Session B or C.

## Integration check (14 October)
- Trial merge of A (`cf9834e`), B (`2d3ffbc`) and C (`0409b80`) onto A: no conflicts (only `lib/feedback-defaults.ts` is shared, in different sections).
- Combined: TypeScript has no errors in the app; the root has only the 5 known `remotion` errors in `landing/`. Tests: 1,289 of 1,302 pass. The 13 failures are the same on every branch and on `main`:
  - 7 need the build output (`dist/`, `preview-dist/`). After `npm run build` and `npm run preview:build` all of them pass (checked on A).
  - 6 expect Windows line endings (CRLF). Git stores these files with Unix line endings, so they fail on any Linux checkout; they pass in a Windows checkout that converts line endings.

## Go-live order (each step needs Lee's approval; approval for one step does not cover the next)
1. Merge A, B and C into `main` through pull requests, one at a time, re-running the tests after each. Pushing `main` also updates the sample preview through the GitHub Action, so treat the merge itself as a live step.
2. Apply the migrations to the live database in filename order:
   1. `20261014100000_clean_form_reminders.sql` (A)
   2. `20261014110000_mid_stay_switch.sql` (A, switch stays on)
   3. `20261014120000_fee_base_after_changeovers.sql` (A, base unchanged)
   4. `20261014130000_owner_history_internal_events.sql` (A)
   5. `20261014200000_region_whole_words.sql` (B, function only, no stored region changed)
   6. `20261014300000_team_calendar_anyone_edits.sql` (C)
3. Build (`npm run build`) and deploy the Worker with `dist/server/wrangler.backend.json` and `--keep-vars`. Check that the live `/workspace/` page references the same bundle file as the local build, and look for Worker versions that are not ours (Codex).
4. After deploy: set the bonus tiers to "90, 95" with the target at 80% in Team performance (Session C's note), and warn the team that clean form reminders start at 18:00 and that invoices for cleans without a form cannot be approved.
5. Phone app: a new EAS build is still needed for installed phones to see any of this.
