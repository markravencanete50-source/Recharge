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

## When this goes live
- Apply `20261014100000_clean_form_reminders.sql` before deploying the Worker. The Worker code is unchanged; it already calls `workspace_clean_form_sweep` hourly.
- On the first run, cleans from the last 14 days without a form that were already warned keep their warning. Open cleans of today get a reminder after 18:00. Earlier ones go straight to the management step.
- Invoices already waiting for approval whose cleans have no form can no longer be approved until the form is in. They can still be rejected.

## Waiting on Alex
- Q1 management fee base (does "cleaning fees" mean the changeover charge on the statement?).
- Q4 actual clean cost off the statement, and the referral-commission model.
- Q5 mid-stay cleans: switch the cron off for now?
- Q7 VRBO money through Stripe: which report to reconcile against.
- Real VRBO and Booking.com payout files.

## For other sessions
- Nothing needed from Session B or C.
