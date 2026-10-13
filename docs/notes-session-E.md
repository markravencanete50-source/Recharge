# Session E notes: dark mode and the UI/UX sweep (13 October 2026)

Branch `claude/round6-uiux-session-e`, from `main` at `8329f37`. Nothing deployed, no migrations.

## Task 1: dark mode

Lee's screenshot (Accounts → Reconciliation → Platform stays, dark) showed cards melting into the page, a hard-to-read
"Approve" button, loud mint pills next to near-invisible ones, the floating Help button covering a row's Approve, and
faint secondary text and calendar counts.

### What changed

| Where | Change |
| --- | --- |
| `lib/design-tokens.ts` | A proper dark scale. Page `#0B1714` → card `#1A322B` → raised `#25453D` → hairline `#41655A` → control outline `#8AAC9E`, each step visibly lighter (card on page went from 1.17:1 to 1.34:1, raised on card from 1.20:1 to 1.30:1). Text `#F5F1E8`, muted `#BFC9C2`, new `disabled`. Brand kept: forest `#1F3D38` (light primary, dark Home panel) and bone `#EFE9DB` (light page, dark header); dark primary stays mint `#A7D9C1`. Brighter secondary `wash` (`#2A594A`), so a secondary button reads as a button on a dark card. Status colours and washes nudged (success, waiting, danger and their washes). |
| `lib/design-tokens.ts` | New state tokens in both themes: `disabled`, `primaryHover`, `washBorder` (edge of a secondary button), `selected` / `onSelected` / `selectedBorder` (a chosen pill, tab or option: forest in light; deep green with a mint edge in dark, so a row of pills no longer reads as a row of bright buttons), `hover` (row and option under the pointer), `onSuccess` (label or tick on a success fill). |
| `lib/design-tokens.ts` (light) | Light got better, not worse: `success` `#136D3A` and `waiting` `#8A5010` (they were 4.10 to 4.45:1 on the raised colour and the page), hairline `border` `#D2CAB8`, raised `#E3DBCA`. |
| web CSS (`designTokenCss`) | Hover washes use `--rc-hover`; a primary button under the pointer takes `--rc-primaryHover`. |
| `lib/contrast.ts` (new) | The table of every token pair the app draws (ink, ground, minimum, where used), and the WCAG contrast maths. |
| `tests/contrast-tokens.test.mjs` (new) | Fails if any pair is under its minimum in either theme (4.5 body text; 3 large text, icons, control outlines, focus ring; 1.3 "edge" for a card on a dark page and other layers). Also checks both themes have the same tokens, the dark scale steps up, the brand colours stay, and `Button` uses the state tokens. Run alone it prints the whole table, lowest first. |
| `mobile/src/LiveKit.tsx` `Button` | Secondary: wash with a visible `washBorder` edge. Disabled: raised fill, hairline, `disabled` label. Primary: `primaryHover` under the pointer. |
| `mobile/src/Segmented.tsx` | The chosen tab uses the `selected` tokens. An alert count uses `badge` / `onBadge` (was white on the dark theme's pale red). |
| `mobile/src/CalendarPicker.tsx` | Days outside the month use the `disabled` ink instead of 50% opacity (counts were fading to about 2:1); counts 10px instead of 9px; the date field's outline is `controlBorder` (3:1). |
| `mobile/src/Celebrate.tsx`, `LiveCleans.tsx` (Accept) | The tick and label on a success fill use `onSuccess` (white on the dark theme's pale green was 1.6:1). |
| Help button (`FaqShortcut.tsx`, `LiveWorkspace.tsx`, `App.tsx`) | Help no longer floats. On wide screens it is an icon button in the header, beside the theme switch; on phones it is the last row of the Menu ("Help and FAQs") when the bottom bar has no Help. Nothing sits over the page any more, so it can never cover a row's Approve. The Profile switch still hides it. |

### Contrast results

`node --test tests/contrast-tokens.test.mjs`: 5 of 5 pass; 161 pairs (both themes, with the department and left-panel
tiles), none under its minimum. Lowest now: dark `elevated` on `surface` 1.30 and dark `selected` on `wash` 1.31
(edges), light `hue-sky` tile 4.52, light `elevated` on `surface` 1.32.

The same table run on `main`'s tokens (the 133 pairs whose tokens existed then) has 7 failures: dark card on page 1.17
and raised on card 1.20; light success on raised 4.10 and on the page 4.45, waiting on raised 4.15, raised on card
1.26, hairline on the page 1.21. Not counted there because the token didn't exist: white ticks and labels on the dark
theme's pale success green (about 1.6:1), now `onSuccess`.

### Screenshots

`docs/screenshots/session-e/before/` and `after/`: desktop (1440×900) and phone (390×844), light and dark, for Home,
To-do, Messages, Guest relations, Client relations, Cleans, Maintenance, Accounts (Expenses, Reconciliation, plus
Platform stays and its rows, Statements, Receivable, Performance, AirCover), Calendar, Properties, Management and the
New expense sheet. 76 each. Taken in the interactive demo (Chromium, Playwright) as the sample super admin. The
before set is `main` at `8329f37`.

## Routed to the Lead (outside my files)

Severity: **High** breaks the client's rules or hides something; **Medium** clearly visible; **Low** polish.

| # | Screen | Problem | Suggested fix | Owner | Severity |
| --- | --- | --- | --- | --- | --- |
| 1 | Every pill row (`PayoutStays` `Chip`, `SheetTable` `Chip`, `LivePortfolio` `Chip`, expense category pills) | Selected pills are a solid mint block with dark text in dark mode; unselected ones only have a hairline. This is Lee's "mint pills next to dark pills". | Selected: `backgroundColor: p.selected, borderColor: p.selectedBorder`, text `p.onSelected`. Unselected: `borderColor: p.controlBorder` (3:1). Best done once in A's shared Pills and the copies removed. `Segmented` already does this. | A | High |
| 2 | Accounts → Reconciliation, row "Approve £…" (`PayoutStays` `StayRow`) | Its own button: wash with no edge, so on a dark card it reads as a tinted block. | Use `Button` from `LiveKit`, or add `borderWidth: 1, borderColor: p.washBorder`. | A | Medium |
| 3 | Accounts tabs (Expenses, Reconciliation, Statements, Receivable, Performance, AirCover) | Six tabs, and the chosen one is a mint block. House rule: more than 5 tabs use a Dropdown. | Shared `Dropdown`, or at least the `selected` tokens. | A | High |
| 4 | New expense sheet | "Received on (YYYY-MM-DD)" is a typed text field; six category pills. | `DateField` for the date; `Dropdown` for the category (more than 5 options). | A | High |
| 5 | Phones, every page (`FavoritesShortcut` in `WorkspaceSearch.tsx`) | The floating Favorites star covers content at rest: it cut off "Checklists" on Cleans and sits over Home's Stays rows. Same fault Help had. | Put Favorites in the Menu (as Help now is) or the bottom bar, and drop the floating button. Then `LiveWorkspace`'s `paddingBottom: 184` can go. | B (navigation) | High |
| 6 | Phone header, 390px wide (`LiveWorkspace` toolbar) | The logo is covered by the buttons ("R…ARGE"). `logoWidth` counts the buttons wrongly: it leaves out Menu and Messages, so five buttons are budgeted as three. | Count Menu and Messages in `headerButtons`, and move View as (and Search for non-team roles) into the Menu under 420px so the logo keeps at least 88px. | B (navigation) | High |
| 7 | To-do (`TodoList`) | Each to-do is a tall card with tags under it. House rule: thin spreadsheet-like rows (property, task, latest update, who, when, status). | One-line rows like the Direct bookings table on Guest relations. | B | High |
| 8 | Properties: "New property enquiry" card | A full-width mint block in dark mode, the loudest thing on the page. | `p.surface` card with a `Button primary` for the action. | B (LiveEnquiries) | Medium |
| 9 | Calendar (`Calendars.tsx` month grid) | Days outside the month are drawn at reduced opacity, so their counts fall under 3:1 in dark. | Use `p.disabled` for their ink, as `CalendarPicker` now does. | Lead to route | Medium |
| 10 | Department strip and the "Work" tabs on phones | The chosen tab is a mint block (dark) and the strip scrolls with a chevron. | `selected` tokens; consider the Dropdown above 5. | B | Medium |
| 11 | `AccountsFlows.tsx` step dots | A white tick on `p.success` (1.6:1 in dark). | `color={p.onSuccess}`. | A | Low |
| 12 | `RoleNavigation.tsx`, `LiveProductivity.tsx`, `LiveEnquiries.tsx` | White and white-alpha colours written into the components (`#FFFFFF`, `rgba(255,255,255,…)`), so they can't follow the tokens. | Move to `heroText` / `heroMuted` / `onPrimary` and a new token if needed (ask me). | B | Low |
