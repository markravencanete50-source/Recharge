# Lead developer handover (13 October 2026, round 6 in progress)

For whoever picks up the **lead developer** role, for example a new Claude Code CLI session run with an API key. Read this
first, then `DEVELOPER-HANDOVER.md` (the product as built) and the per-session notes in `docs/notes-session-*.md`.

## 1. What we are building

**Recharge** is a property-management platform for **Alex** (the client), who runs short-let properties in Scotland.
**Lee** (the owner, our user) runs the build and talks to Alex. The work is done by a team of Claude sessions: one lead
and five developers.

- **Web workspace and API:** Cloudflare Worker `recharge-backend` at `https://app.rechargegroup.co.uk` (`/workspace` is the app).
- **Database:** Supabase Postgres, project `brixfalrrmzqoioggvfx`. Every action is a checked database function (no direct
  table access from the app). Migrations are in `supabase/migrations/`.
- **App:** Expo / React Native in `mobile/`. The web workspace is a web build of the same app. Shared logic is in `lib/`.
- **Areas:**
  - Guest relations: stays, guest inbox via Hostaway.
  - Client relations: owners, enquiries, onboarding, pricing, listing checks.
  - Cleaning: cleans, clean forms, disputes.
  - Ready.
  - Accounts: payouts, reconciliation, statements, invoices.
  - Management: approvals, people, rota, performance and bonus, KPIs, access control, menu order, daily tasks.
  - Plus: To-do, Messages, Updates feed, Calendar, Favorites, Help, and an interactive Demo.
- **Hostaway:** the sync is on. Guest messages come into the inbox. Replies are sent from the app because
  `HOSTAWAY_REPLIES_ENABLED=true` is set as a **Worker secret**. Details are in `docs/HOSTAWAY-SYNC.md`.
- **Two email addresses, never mixed (Lee):**
  - **Guests:** `guestrelations@rechargegroup.co.uk`. Guest emails go to Messages → Guests, and replies to guests are sent
    from it.
  - **Clients and owners:** `ownerrelations@rechargegroup.co.uk`. Owner and client emails go to Messages → Clients, and
    replies to owners, plus the client enquiry form email, are sent from it.

  Both mailboxes are hosted at Fasthosts. The domain's DNS is in **Cloudflare** (nameservers `*.ns.cloudflare.com`); the
  Fasthosts "Advanced DNS" page has no effect. Resend is verified for the domain. Session F built it; see `docs/EMAIL.md`.

## 2. How a round ships

1. Developers work on their own branches. Each session owns specific files and has its own migration-number range.
2. The lead merges each branch into the lead branch **`claude/fervent-brahmagupta-8qd03b`** and runs `npm test`, which
   builds everything and runs the whole suite on PGlite. Developers fix their own failures. The lead only integrates.
3. The lead builds the one-transaction install file and checks it (see section 5):
   ```
   node scripts/lead/build-install-bundle.mjs 20261016 "Round 6"
   node scripts/lead/check-install.mjs 20261016
   ```
   The check must show every migration recorded, `second run:` stopped at the guard, and `differences: 0` for
   functions and policies.
4. Check for drift on live. For each function a round's migrations patch, compare live with the local build. Lee does
   this, or the lead does it with read-only Supabase access:
   ```sql
   select n.nspname||'.'||p.proname f, md5(replace(p.prosrc,chr(13),'')) h
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname in ('private','public') and p.proname in ('<function>', ...) order by 1;
   ```
   Many migrations patch a function by anchor (`pg_get_functiondef` plus `replace`, with exactly one anchor and a
   sentinel). If live has drifted, the anchor may be missing and the migration raises: nothing is half-applied.
   21 older function groups are known to differ on live, but none of them is touched by round 5 or 6. Check again
   for round 6.
5. Open a pull request from the lead branch to `main`. The body ends with the Claude Code footer.
6. **Lee** pastes `supabase/install-pending.sql` into the Supabase SQL editor and runs it once. The Supabase MCP
   `apply_migration` call timed out at 60 s on big rounds, so Lee runs the file by hand.
7. **Lee** merges the pull request. A push to `main` is mirrored to `codex/cloudflare-preview` by
   `.github/workflows/sync-live-preview.yml`, and Cloudflare Workers Builds deploys `recharge-backend` from that branch.
   No `wrangler deploy` is needed. Check that the build is *Ready* in Cloudflare and that the site shows the change.
8. Record the round as live in `DEVELOPER-HANDOVER.md`, and reset `supabase/install-pending.sql` to "Nothing pending".

**Rules that are in force:**
- Never push to `main`. Lee merges pull requests. (An automatic classifier blocked a direct push.)
- Live steps (SQL, deploys, data fixes) need Lee's explicit approval each time. Approval for one step does not cover
  the next.
- Developers never touch the live database. (B was told off once for a live SELECT.)
- Never paste tokens, keys or passwords into chat. Lee was advised to revoke a Supabase token that was pasted in an
  earlier session.
- Worker settings must be **Secrets**. Plain dashboard variables are dropped on the next build, because
  `scripts/build-backend-config.mjs` only declares `BACKEND_ONLY` and `SUPABASE_URL`.
- `.gitattributes` checks out `*.ts`, `*.tsx` and `*.sql` with CRLF (live function bodies are CRLF). `*.mjs` and
  `*.sh` stay LF. Line-ending tests fail on a working copy that has LF files; fix the working copy, don't commit it.
- The lead coordinates and integrates. **Code changes go to the developers.** Lee rejected the lead editing screens
  directly.
- The client's feedback video contains staff personal details. Don't forward it to developers; send them the
  transcript only.
- UI direction from Alex and Lee: **minimal, fewer buttons**.
  - Lists are search-only.
  - Dates use a calendar.
  - Use a dropdown above 5 choices, and a searchable one above 10.
  - Rows are thin, one line, like a spreadsheet.
  - No hard-coded colours (theme tokens only).
  - Check every screen in dark mode.

## 3. History

| Round | Live | Main | Worker | What |
|---|---|---|---|---|
| 4 | 13 Oct 2026 | `b25d02f` (pull request #2) | `b3f6054c` | 12 migrations `20261014*`: clean-form reminders, fee after changeovers, visitor levy, regions, calendar editing, guest-messaging roles, chat notices. See `docs/GO-LIVE-2026-10-14.md`. |
| 5 | 13 Oct 2026 | `8329f37` (pull request #3) | `227817b6` | 9 migrations `20261015*`: KPI tracker, Messages redesign, notification bell, menu order, demo interactive, enquiry to property. |
| 6 | **in progress** | – | – | see below |

## 4. The team (Claude Code cloud sessions)

The developers are **cloud sessions on claude.ai/code**. The current lead talks to them with the `claude-code-remote`
MCP tools (`send_message`, `get_session`, `list_events`). **A CLI session using an API key may not have those tools.**
If it doesn't, Lee relays messages by pasting them into each session, or the new lead works from the branches alone.

| Who | Session (title) | Session id | Branch | Model | Owns |
|---|---|---|---|---|---|
| Lead | – | `session_01XFR6s8y4AHbjtTG2xH7Fgh` | `claude/fervent-brahmagupta-8qd03b` | Opus 5.5 | integration, install file, go-live docs |
| A | "1st developer" | `session_011YcdYnb1ZyE5g461MMEY1R` | `claude/compassionate-bardeen-anm9qt` | Sonnet 5.5 (switch pending) | Accounts, money, cleans, Pills/Dropdown |
| B | – | `session_01SokBUArK2U5nGqujqzZWXJ` | `claude/serene-babbage-xgqaus` | Opus 5.5 | To-do, trackers, Client relations, menu and Favorites, enquiries; migrations `20261016200000–299999` |
| C | – | `session_017q1kW6zE6djgXB76GoS9gF` | `claude/determined-cori-5jpfoj` | Opus 5.5 | team, people, bonus, notices and Updates, chat; migrations `20261016300000–399999` |
| D | "4th Developer" | `session_01HkEF7tiRFSCw16C8ErtC1Z` | `claude/round6-forms-session-d` | Sonnet 5.5 (switch pending) | forms, sheets, demo, enquiry form, Management checklist; migrations `20261016400000–499999` |
| E | UI/UX | `session_01FkZ7wvBwi6Yb6jwxQq1MSy` | `claude/round6-uiux-session-e` | Opus 5.5 | theme tokens (`lib/design-tokens.ts`, `theme.ts`, only E edits them), contrast test, design review of every branch |
| F | "6th Developer (Email)" | `session_01Msce2EGBrVPZMznwLwpew2` | `claude/round6-email-session-f` | Opus 5.5 | guest and client email through Resend (`guestrelations@` and `ownerrelations@rechargegroup.co.uk`): domain verification with Lee, inbound webhook, threading, replies out; migrations `20261016500000–599999` |

**Model choice:**
- Opus for database, privacy and money logic.
- Sonnet for screen work.
- Haiku for small one-off fixes.

Lee switches a running session with `/model claude-sonnet-5-5`. A and D were asked to switch; Lee hasn't confirmed it.

## 5. Round 6: status at handover

**Lead branch:** `850ca09`, pushed. It contains:
- D up to `dd3a4a6`;
- C `71720a9`;
- B `f113abd`.

`npm test` on `850ca09` passed **1514/1514**.

**Migrations so far (none applied):**
- `20261016200000_todo_updates.sql` (B)
- `20261016210000_delete_client_enquiry.sql` (B)
- `20261016300000_notice_details.sql` (C)

C's management bonus may add one more in `2026101630xxxx`. A draft bundle of the first three checks clean: 3 recorded,
the guard stops a second run, and functions 557/557 and policies 13/13 show 0 differences.

| Dev | Done and where | Still to come |
|---|---|---|
| A | `bc8b50e`: Pills → Dropdown by one shared rule (`lib/pills.ts` uses `lib/choice-control.ts`: 5 or fewer are pills, 6–10 a dropdown, over 10 searchable). Management sections are one dropdown. Properties is search-only. Merged with D's Dropdown. | E's items 1, 2, 3, 4, 11: mint pills to the selected tokens; the Approve wash button gets an edge; check that Accounts' 6 tabs are a dropdown; the New expense date becomes a DateField and its categories a dropdown; onSuccess tick. **Not merged yet.** When merging, A's `bc8b50e` and D's `dd3a4a6` both fixed `tests/demo-browser-e2e.test.mjs`; keep one. |
| B | Merged (`f113abd`): To-do update log (who and when, "Marked done" and "Reopened"); thin 40 px rows (`ThinTable`) for To-do and trackers; dropdown, DateField and PropertySelect form; pricing shows 10 per heading with "Show all"; Favorites after Home for every role, locked in Menu order; admins can **delete client enquiries** only at the enquiry stage. | E's items 5, 6, 7, 8, 10, 12: remove the floating Favorites star; stop phone header buttons covering the logo; confirm the To-do thin rows; the Properties enquiry card in dark mode; the Work department strip uses the selected tokens; hard-coded whites. |
| C | Merged (`71720a9`): Updates titles "<type>: <title>" with a second line (property, who, time); tap opens the item; bursts grouped; owners see only "You" or "Recharge". | **Management bonus** (Alex: "Managers bonus will be based off of how guest relations and client relations perform"). It averages team Guest relations `percentGreen` and Client relations `workPercent`, shows both parts, stays a placeholder (80/90/95), and needs a team-wide read for managers and admins only. |
| D | Merged up to `dd3a4a6`: the forms rule (`ChoiceField`, 16 screens); Sheet fragment spacing fix (Rejected clean overlap); public enquiry form (option colours, no focus box or animation); **Management "Today's checklist"** (Alex: "a daily checklist for management centre, which shows up in to-do list as well"), built from Management daily tasks and ticking the same to-dos; e2e fix. | `74cd69f` (calendar faded days use `p.disabled`) is pushed but **not merged**. It also merges E's `0da9cd7`. Nothing else is assigned. |
| E | `fb3657a` and `0da9cd7`: dark-mode scale and new state tokens; `tests/contrast-tokens.test.mjs` (161 pairs, both themes); Help moved into the header and Menu; 76 before and after screenshots. **Not merged directly**; it comes in through D's `74cd69f`. | Design review of the lead branch (D's and C's screens), then the full UI sweep. A list of taste calls for Lee. |

**E's sweep, second batch** (`6e5053c` and `41e6279`, items 13–21 in `docs/notes-session-E.md`). E took the screenshots
from `main`, so 14, 15, 16 (teams) and 18 are already fixed on round 6 branches. They are routed:
- D: 13 (Maintenance filter dropdown, thin rows, no Refresh), 16 (calendar views as a Segmented control), 17 (13 typed
  "YYYY-MM-DD" dates become DateField, except AccountsPayable), 21.
- A: 17 (AccountsPayable dates), 20 (phone Accounts tiles), and checking 14 and 15.
- C: 19 (Messages helper lines wrap), after the bonus.

E was asked to review the lead branch with A merged on top.

**To finish round 6:**
1. Merge D's `74cd69f` (which brings E), then A, B's E-fixes and C's bonus, as each reports.
2. Run `npm test`, `cd mobile && npx tsc -p . --noEmit`, and ESLint.
3. Get E's sign-off on the screens.
4. Build and check the install file, check drift on live, and open the pull request.
5. Lee runs the SQL, then merges.
6. **The order matters for the enquiry delete:** the migration *and* the new Worker must be live before anyone presses
   Delete. The Worker (`lib/client-enquiry-server.ts`) removes the stored files. With the old Worker, the files stay
   queued in `private.workspace_storage_removals`.
7. Once live, Lee can delete the "Mark Raven Canete · Optimal" test enquiry in the app.

## 5a. All developers stopped (13 October 2026, 14:28)

Lee asked for every developer to stop. Each session was interrupted and told to change nothing more.

| Dev | Last pushed | Left unpushed in its cloud container (lost if the container is reclaimed) |
|---|---|---|
| A | `d560ed1`: E's items 1–4 and 11; the full suite was not run | nothing |
| B | `f113abd` | a local merge of E's branch (`edb7c13`), plus 9 uncommitted files: E's items 5, 6, 8, 10, 12 and a test |
| C | `71720a9` | the management bonus: 6 changed files and 3 new ones, including migration `20261016310000` and two tests |
| D | `74cd69f` | a local merge of E's branch (`365efd8`), plus uncommitted `CalendarPicker.tsx` (an `empty` prop) and a new `DayField.tsx` (item 17) |
| E | `41e6279` | nothing (only a review branch, `review/lead-cf59b6e`) |

The lead branch is at `d3fde42` and later; its last full run, on `850ca09` with B, C and D merged, passed 1514/1514. Anything unpushed
has to be redone from these notes, unless Lee asks a developer to push it as work in progress.

## 5b. Rounds 6 to 8: ready to go live (13 October 2026, evening)

Everything from A–F is merged into the lead branch. Full `npm test` on `e4baea3` passed **1618/1618**. After that only
C's go-live note (documents) and F's one-line Unknown senders layout were added; their tests and the style and contrast
tests pass, and tsc is clean. E signed off the design of every screen in light and dark, at 1440 and 390.

- Install file: `supabase/install-pending.sql`, seven migrations in one transaction (to-do updates, delete client
  enquiry, notice details, management bonus combined, inbound email, updates open and older, management bonus weighting).
  It is checked against the files one by one (0 differences). On live, the 14 functions it patches match the local build,
  and live has nothing after `20261015330000`.
- Team note: `docs/GO-LIVE-ROUND-6-8.md` (C).
- Email set-up after deploy: `docs/EMAIL.md` (F).
- Go-live order:
  1. Lee runs `supabase/install-pending.sql` in the Supabase SQL editor.
  2. Lee merges the pull request; Cloudflare deploys.
  3. The client enquiry email works straight away (RESEND_API_KEY is already a Secret).
  4. Inbound email and replies by email follow `docs/EMAIL.md`: the EMAIL_REPLIES_ENABLED Secret, receiving on
     `in.rechargegroup.co.uk` (MX for `in` only, in Cloudflare), the Resend webhook and its Secret, and Fasthosts
     forward-and-keep-copy rules.
- Lee to check in the Supabase dashboard: the sender of Auth emails (sign-in, invite, password) is neither mailbox.

Next round (not blocking):
- A: Dropdown closed box and menu use p.controlBorder; the typed dates left in AccountsPayable, AccountsReceivable and
  AccountsStatements.
- D: the TeamEvents label "Dates (one day: choose it twice)" becomes "Dates" with a helper line.
- B: on phones, the Client enquiries stat tile labels wrap; shorten them.

## 6. Waiting on Lee

- Switch A and D to Sonnet (`/model claude-sonnet-5-5` in each session).
- Whether to send the team note: "theme tokens only, check dark mode, don't edit theme files, E reviews before merge".
  The developers have since been told the main points one by one.
- Taste calls:
  - the Access control people filter (6 choices with live counts) as a dropdown: keep it, or go back to buttons?
  - rows of exactly 5 buttons now scroll sideways on phones instead of wrapping: is that okay?
- Check the public enquiry form once on an iPhone and on a Mac (D tested Chromium only).
- Optional data steps from round 4: bonus tiers 90/95 in Team performance targets; the four wrong regions; the open
  mid-stay cleans. See `docs/GO-LIVE-2026-10-14.md`.

## 7. Questions for Alex

- Managers' bonus: settled by Lee. The guest part always uses the 5-minute reply rate. Targets, tiers and weighting are Alex's to set himself in the KPI screens (Management → KPIs, from round 5); the system follows whatever he sets. Don't ask Alex about it.
- The Management daily checklist items. Lee or an admin can enter them in Management → Daily tasks; no code is needed.
- Visitor levy: who collects it, its base, whether the fee is taken before or after it, which properties, and from when.
- Referral commission.
- Whether the cleaning manager sees clean-form flags.
- 7 nights or more than 7.
- Real VRBO (Stripe) and Booking.com payout files.
- Onboarding stages, and the maintenance form questions.
- KPIs for the other areas, whether tracked reply KPIs get targets, and whether out-of-shift messages count.

## 8. Where things are

- `DEVELOPER-HANDOVER.md`: the product, area by area, and "Round N is live" entries.
- `docs/notes-session-{A,B,C,D,E}.md`: each developer's detailed notes, per round.
- `docs/GO-LIVE-2026-10-14.md`: the round 4 go-live, a template for later rounds.
- `docs/HOSTAWAY-SYNC.md`: Hostaway sync, guest messages and replies.
- `supabase/install-pending.sql`: the next install, or "Nothing pending".
- `scripts/lead/build-install-bundle.mjs` and `scripts/lead/check-install.mjs`: the install file tools.
- Screenshots:
  - `docs/screenshots/session-a/`, `session-b/`, `session-e/`;
  - `docs/session-D-screenshots/`;
  - `docs/screenshots/round6-updates-*.png` (C).
