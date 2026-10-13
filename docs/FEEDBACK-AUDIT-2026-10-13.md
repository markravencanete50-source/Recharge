# Check of the live build against what Alex asked for (13 October 2026)

This is an honest, limited check. It is **not** a fresh line-by-line replay of Alex's videos. It checks what
the code does for the things Alex said he did **not** want, and it restates what is built from the status
table in `docs/CLIENT-FEEDBACK-2026-10-12.md`. Nobody has clicked through the screens as each role on the
live site yet; that is still the most useful next check.

## Things Alex said he did not want

| Alex said | Checked in the code | Result |
|---|---|---|
| Report repair, new clean and new routine visit pills on Home are not needed | No pill labels in `HomeTools.tsx` or `LiveHome.tsx` | Matches |
| No property count on Home | No property count in `LiveHome.tsx` | Matches |
| No Hub | `LiveHub` is not mounted by `LiveWorkspace.tsx`; no role lists `hub` in `lib/tool-directory.ts` | Matches |
| Updates can go in with the messages | Updates is a tab inside `LiveChat.tsx` | Matches |
| Stays is Guest relations, no separate Stays thing | `WORK_VIEW_LABEL` names it Guest relations; direct bookings, AirCover and guest communication point there | Matches |
| WhatsApp is dropped | Offered channels no longer include it; the access FAQ, the access-control copy, the Inbox heading and the sample inbox no longer mention it. Old WhatsApp conversations still open and keep their label | Matches (fixed in this round) |
| No shiny effects, gradients or looping animation | No gradient or looping animation in any new screen; the only match is the sample-data demo mode | Matches |
| Reflection before clocking off | Migration `20261012150000` gates clock-out for Stays, Ready, Accounts and the cleaning manager | Matches |

## Fixed in this round

| Item | Change |
|---|---|
| Owners saw the name of every staff member on a work item's history | New migration `20261013090000_owner_privacy_round3.sql`: owners get the timeline and notes, no names. Staff are unchanged |
| Owners could read internal event names (management flags, AirCover, reflections, routine visits, missing clean form, repair resolved) | Same migration: the activity policy hides those event types from the client role |
| A stay cancelled after its first statement was issued still paid its share in later periods | New migration `20261013100000_statement_cancelled_after_issue.sql` and the same rule in `lib/statement-maths.ts`. The stay is flagged and its money is listed as late money |
| "Same amount on more than one payout line" was returned but never shown | The bulk approval recap now says how many stays were held back for it |
| "Paid a different amount after the statement was issued" and "stay changed since its first statement" were never shown | The statement check now lists both under its notes |
| Home tile said "Payouts" | It now says "Reconciliation: Match platform payouts to stays" |
| Test `conversations show the tidy Airbnb booking code` failed on a Windows line-ending split | The test normalises line endings; the migration is untouched |

## What is still open

* The 15 asks that run on a default I chose are listed with their questions for Alex in
  `docs/CLIENT-FEEDBACK-2026-10-12.md`. Until he answers, they are best guesses.
* Not built: inbound email in Messages, automatic troubleshooting, calendar editing and Ready availability
  booking, the bonus in pounds, photo upload on the visit form and an editor for the notice routes.
* Not done in this round: screenshots of the new screens (the sample preview was not built), and the check
  of the Accounts brief sentence by sentence beyond what the money tests already cover.
