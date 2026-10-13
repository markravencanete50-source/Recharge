# Session C notes: team and people (13 October 2026)

Branch `claude/determined-cori-5jpfoj`, started from `main` at `f17c4bf`. Nothing here is deployed and the
migration is **not applied**. These notes are for whoever merges the three sessions and updates
`DEVELOPER-HANDOVER.md` (this session was told not to edit it).

## 1. Team calendar: anyone on the team edits, and every entry shows who last edited it

**Decision (Lee, 13 October 2026):** cleaners count as "anyone". Every team role (stays, ready, accounts, cleaners,
the cleaning manager, admins and super admins) can add, change and cancel **any** entry on the team calendar, for
anyone on the team, for **every kind** (absence, meeting, away, training, other). Owners never read or edit any of it.

**Migration `20261014300000_team_calendar_anyone_edits.sql`** (new, not applied):
- `private.workspace_team_events_anyone_edits()` returns `true`: the one switch. Returning `false` goes back to
  "your own; admins anyone's" without another code change. Mirrored by `TEAM_EVENTS_ANYONE_EDITS` in
  `lib/feedback-defaults.ts` (added at the end of the A9 section; the older A9 comment saying "admins can change
  anyone's" is superseded by the new lines under it).
- New column `private.workspace_team_events.updated_by` (references `workspace_profiles`, indexed). Existing rows are
  filled with `coalesce(cancelled_by, created_by)`. Every save and cancel now sets `updated_by` and `updated_at`.
- `private.workspace_team_events_read` and `private.workspace_team_events_action` are replaced whole (only
  `20261012210000` defined them and nothing patches them). The routes in `workspace_teams_read` and
  `workspace_teams_action` are unchanged, so no anchors were touched.
- The read adds `editedById`, `editedBy` (name), `editedAt` and `added` (true while nobody has changed it since it was
  added) to each event, and `canEditAll` is now true for every team role.
- Editing someone else's entry is refused once that person is no longer on the team ("This person is no longer on the
  team"); such entries are not on the calendar anyway.
- The person an entry is for is still told when someone else adds, changes or cancels it (`team.event_set`,
  `team.event_cancelled`, copy already in `lib/notice-copy.ts`). These activity rows carry no work or property, so the
  `activity_scoped` policy already keeps them from owners; nothing to hide, and the policy was not changed.
- Account deletion: `updated_by` is one more reference to a profile. `workspace_delete_own_account` scans every foreign
  key generically, so a person who edited someone else's entry is closed as "Deleted user" rather than removed, exactly
  as `created_by` already did. The privacy export was not changed.

**App:**
- `lib/calendar-live.ts`: the `teamEventsSchema` accepts the four new fields (all optional, so an older database still
  parses), and `eventEdited(event, myId)` gives "Added by you on Tue 13 Oct at 14:05" or "Last changed by Sam Reid on
  ..." in UK time.
- `mobile/src/TeamEvents.tsx`: the event sheet shows an "Added" or "Last changed" line (who and when). The "Who is it
  for?" picker already appears whenever `canEditAll` is true, so it now shows for everyone. With an older database
  (`canEditAll` false for non-admins) the sheet stays read only as before. The list rows do not show the editor, to keep
  them short; it is in the sheet.
- `mobile/src/LiveCalendar.tsx` needed no change: it passes `canEditAll` from the read and the people from the rota
  read, which every team role can read.

**Tests:** `tests/team-calendar-edits-database.test.mjs` (new): runs twice without change, backfills older rows, every
role including cleaners adds, changes and cancels anyone's, the person is told, owners are refused everything, stale
versions are refused, a person who left cannot be edited, the functions stay private.
`tests/team-calendar-database.test.mjs` now leaves this migration out, because it proves the original migration on its
own (its "nobody but admins" test describes the old rule). `tests/team-calendar.test.mjs` gained a test for
`eventEdited` and the sheet.

## 2. Bonus as a progress bar towards the target

**What it does:** "My performance" (the Home card and the My performance page, both `mobile/src/MyPerformance.tsx`)
now shows the bonus as a bar from 0 to 100% with the target and each tier marked, a check per mark reached, a headline
("6% to go to the target", "Target reached", "Bonus tier 1 reached", "Bonus tier 2 reached", "Nothing to measure
yet") and what comes next. No pound amounts anywhere.

**Placeholder schemes** (`BONUS_SCHEMES` at the end of the A3 section of `lib/feedback-defaults.ts`), all marked
`placeholder: true`, which the card shows as a "Placeholder" tag and the line "These targets and tiers are
placeholders until the bonus scheme for (area) is agreed":

| Area | Measure | Target | Tier 1 | Tier 2 |
| --- | --- | --- | --- | --- |
| Guest relations | Guest messages answered within 5 minutes (`percentGreen`) | 80% | 90% | 95% |
| Client relations | Daily work done against its targets (`workPercent`) | 80% | 90% | 95% |
| Cleaning | Performance score (`score`) | 80% | 90% | 95% |
| Ready | Performance score | 80% | 90% | 95% |
| Accounts | Performance score | 80% | 90% | 95% |
| Management | Performance score | 80% | 90% | 95% |

Guest relations is the client's own example. The rest copy its numbers until the client sends theirs. A person's
area is their rota department, else their role (`BONUS_AREA_BY_ROLE`). The "5 minutes" in the label comes from the
Team performance targets (`greenMinutes`). Logic: `bonusArea` and `bonusProgress` in `lib/my-performance.ts`; tests in
`tests/my-performance.test.mjs`.

**Questions for the client:**
- The real target and tiers for each area, and what each area is measured on. Cleaners and Ready usually have no
  `score` today (it blends guest replies and daily work on guest or client relations shifts), so their bar says
  "Nothing to measure yet". A cleaning measure such as "clean forms submitted on time" needs a new database read.
- **Conflict to settle:** admins still set the score's pass mark and bonus tiers in Team performance → Change the
  targets (`workspace_performance_targets`, live values pass 80%, tiers 80/90/95). That counts 80% as a bonus tier,
  whereas the client's example makes 80% the target and only 90% and 95% tiers. The admin Team performance list and
  `LiveShifts.tsx` still show the database tier ("Bonus tier 90%"). Once the schemes are agreed, either set the
  database tiers to 90 and 95, or move the schemes into the database per department and read them in both places.
  Until then the person's card follows the placeholder scheme and the admin list follows the database.
- `bonusFor` and `standingLine` in `lib/my-performance.ts` are kept (and tested) but the card no longer uses them.

## Not done yet (waiting for the client)

- Message notifications by department and by chat membership.
- No guest messaging for landlords, cleaners and maintenance.
- Inbound email into Messages.

## Files changed

`supabase/migrations/20261014300000_team_calendar_anyone_edits.sql` (new), `lib/calendar-live.ts`,
`mobile/src/TeamEvents.tsx`, `lib/my-performance.ts`, `mobile/src/MyPerformance.tsx`, `lib/feedback-defaults.ts`
(added at the end of the A9 and A3 sections only), tests `team-calendar-edits-database` (new), `team-calendar-database`,
`team-calendar`, `my-performance`, and this file. `mobile/src/LiveShifts.tsx` (and the department line in `ShiftCard`)
was not touched. `LiveHome.tsx` needed no change: the Home tile is the same `MyPerformance` card.

## Checks run

- `npm ci` (root and `mobile/`).
- TypeScript: `mobile/` clean; root clean except `landing/` (cannot find `remotion`; unrelated to this work).
- ESLint on every changed file: clean.
- `node --test`: `team-calendar-edits-database`, `team-calendar-database`, `team-calendar`, `my-performance`,
  `feedback-contracts`, `privacy-phase2-database`, `wiring-fixes-v2`, `team-performance-database` all pass apart from
  two checks that **also fail on `main`**: "no em dashes, and the TypeScript files keep their CRLF line endings"
  (`team-calendar.test.mjs`) and the CRLF assertion in `privacy-phase2-database.test.mjs`. The files in the repository
  are LF, so those checks expect line endings the checkout does not have.
- Not run: the full `npm test` (it builds the app first) and anything against a live service. The new bar and the
  "Last changed" line were not screenshotted; check them with real staff accounts after the migration is applied.

## Deploy order

Apply `20261014300000_team_calendar_anyone_edits.sql` after `20261012210000_team_calendar.sql`, then redeploy. The app
works before the migration (no editor line, non-admins read only on others' entries) and after it.
