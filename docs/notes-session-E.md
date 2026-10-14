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

## Task 2: UI/UX sweep (both themes, desktop and phone)

Fixed in my files:

| Where | Change |
| --- | --- |
| `mobile/src/theme.ts` | One scale for corners (`radius`: tag 8, control 14, tile 18, card 24, sheet 28, pill 999), icons (`icon`: 14, 16, 18, 20) and spacing (`space`: 6, 10, 14, 20, 24). The shared `ui` styles use it: icon buttons now share the 14px corner of buttons and fields (were 16), and sheets space their sections 20px apart (were 18). The sweep counted corners of 12, 14, 15, 16, 18, 20, 22 and 24 and icons from 12 to 22 side by side. |
| Header buttons (`LiveWorkspace.tsx`) | The header icon buttons take the shared 14px corner (were 15). |
| Property search (`SearchPicker.tsx`) | The placeholder was cut off on phones ("…street or p"). Now "Search property, street or postcode", which fits a 390px field. |

Routed, continuing the list above:

| # | Screen | Problem | Suggested fix | Owner | Severity |
| --- | --- | --- | --- | --- | --- |
| 13 | Maintenance | Nine filter pills in one row that runs off the screen ("With R…"); each repair is a tall card; a Refresh button next to Report a repair. | One Dropdown for the filter; thin rows (property, problem, status, cost, updated); drop Refresh (pages reload on their own). | Lead to route (`LiveRepairs`) | High |
| 14 | Management centre | Nine or more tabs in a row that runs off the screen ("Day refle…"). | Dropdown above 5 tabs. | B | High |
| 15 | Client relations | Eight tabs (Onboarding … Purchase orders). | Dropdown. | B | High |
| 16 | Calendar (phone) | Four view pills and five team pills wrap, leaving "Team" and "Accounts" alone on a line. | Teams as a Dropdown next to the two existing dropdowns; views as a 4-segment `Segmented`. | Lead to route (`LiveCalendar`) | Medium |
| 17 | Record a stay, New clean, edit stay, local and team events, team time, New expense | Dates are typed as text, "(YYYY-MM-DD)": 13 fields in `LiveCleans`, `StaySheet`, `StayEditSheet`, `LiveRepairs`, `LiveCalendar`, `LocalEvents`, `TeamEvents`, `LiveTeamTime`, `AccountsPayable`. | The shared `DateField` (one field that opens the calendar). | Lead to route; A for `AccountsPayable` | High |
| 18 | Report a repair | Eleven repair-type pills. | Dropdown. | Lead to route (`LiveRepairs`) | High |
| 19 | Messages (phone) | Helper lines cut short with "…" ("Hostaway isn't connected yet: log each gue…", "5 guests have waited longer than 30 minut…"). | Let them wrap (drop `numberOfLines={1}`). | C | Medium |
| 20 | Accounts summary tiles (phone) | "TO RECONCILE" and "STATEMENTS PAID" wrap to two lines, and the three tiles use three different fills. | Shorter labels ("Reconcile", "Statements") or two tiles per row; one fill (`p.surface`). | A | Medium |
| 21 | Everywhere | Corner and icon sizes are typed as numbers. | Use `radius`, `icon` and `space` from `theme.ts` when a file is next touched: 12/16 become `radius.control`, 20/22 become `radius.card`, icons 15/17/19 become the nearest step. | All sessions | Low |

## Round 9: full sweep from main (`5763aa0`, 14 October 2026)

How: the interactive demo, all eight sample roles (super admin, admin, stays, cleaning manager, cleaner, Ready,
accounts, owner), every link in each role's left panel (desktop) and bottom bar and Menu (phone), light and dark, at
1440×900 and 390×844, the top of each page and one screen further down: 616 page views. On every view axe-core
checked text contrast, and a script looked for text running past the right edge. Then the Management views (Rota,
Team performance, Onboarding & training, Day reflections, Daily tasks, Responsibilities, Decisions, Cleaning team,
Access control and Menu order), Profile, Help, a guest conversation, the owner's Home and chat, and, outside the
demo, the web sign-in page, the app's sign-in screen and the public enquiry form. Not opened: a cleaner's clean form
(it needs a clean started in the demo).

Checks on the branch: the full suite (`npm test`) 1618 of 1618, `tsc -p mobile` clean, ESLint clean on the changed files.

### Fixed here (theme)

| Where | Change |
| --- | --- |
| `mobile/src/CalendarPicker.tsx` | **Decision: the chosen day moves to the selected tokens.** Light mode looks the same (selected is forest). In dark mode the day is deep green with a mint edge and bone figures, like a chosen pill or tab, not a bright mint disc. Range ends and single days both use it; the days between keep the wash; today keeps its outline. |
| `lib/design-tokens.ts` | Light `disabled` `#6A786F` → `#647169`: days outside the month in the calendar were 4.44:1 on a card; now 4.90:1. Still lighter than `muted`, as the contrast test requires. |

### Must fix (owner)

| # | Screen | Problem | Fix | Owner |
| --- | --- | --- | --- | --- |
| R1 | Cleans → Schedule (cleaning manager, Guest relations' Cleans) at 1440 | The schedule table is wider than its card: "Last update" is cut ("Last updat…", "11 Oct, 09:…"). | Fixed widths for Status and Submitted forms, or drop a column at this width, as B did for To-do. | A |
| R2 | Maintenance rows on phones (390) | "· Urgent · Safety hazard" runs past the right edge of the row. | Let the status line wrap (`flexWrap: "wrap"`), or put the flags on their own line. | D |
| R3 | Access control on phones (390) | "Signed in … ago" runs past the right edge of each row. | Wrap the email and sign-in line, or drop the sign-in time on phones. | D |
| R4 | Productivity, dark mode | The month grid's day cells put text on a hand-mixed green (`rgba(143,211,194,…)`), 3.6–4.4:1. | Use `p.selected` with `p.onSelected` for the busiest days and `p.wash` with `p.text` below that, or keep the mix but cap its strength so text stays at 4.5:1. | B |

### Low

| # | Screen | Problem | Fix | Owner |
| --- | --- | --- | --- | --- |
| R5 | Owner: Stays & statements and Reports, booking calendar | Days outside the month are drawn at 55% opacity: 2.4:1 in light, 3.5:1 in dark. | `p.disabled` for those days, no opacity. | B |
| R6 | Management → Responsibilities | Nine filter pills (Everything, Mine and seven departments). | The Dropdown, per the rule for more than 5. | B |
| R7 | Cleans day strip (Schedule, Your cleans) | The chosen day is a solid primary fill; the calendar's chosen day now uses the selected tokens. | `p.selected`, `p.onSelected` and `p.selectedBorder` for the chosen day. | A |

### Taste calls for Lee

- The app's sign-in screen on wide screens: the left panel has department chips and four example activity cards
  ("Clean accepted", "Repair booked"…). They look like buttons but do nothing. Keep them as illustration, or make the
  panel plain like the web sign-in page?

### Checked and fine

Guest relations and Client relations home pages and their routines; the guest inbox with a conversation open;
Cleans (schedule, review, disputes, not assigned, cleaners, set-ups, invoices) and the cleaner's own pages; Ready
(reactive, preventative, inspections, purchases, furnishing quotes); Accounts (expenses, reconciliation and
Platform stays, statements, receivable, performance, budget chart, cleaner invoices, purchases); the owner (Home, properties, approvals,
repairs, Stays & statements, mailbox, furnishing calculator, chat); Management (people, productivity apart from R4,
team performance, rota, onboarding and training, reflections, daily tasks, decisions, cleaning team, access control
apart from R3, menu order); Profile; Help; both sign-in screens; the public enquiry form. axe found no other contrast
failures in either theme.

## Round 9: Lee's requests (14 October 2026)

| Request | Change |
| --- | --- |
| "Remove all of the emdash": the line under page titles | `PageHeading` (`LivePages.tsx`) no longer draws the short green accent line; the title and its subtitle sit 6px apart. `DrawLine` is gone from `motion.tsx` (it had no other use). |
| "Remove all of the emdash": the character | Home's loading count shows "…" instead of "—"; "Channel manager not connected. Sync is paused."; "Thanks. An admin will review this."; the owner weekly email says "None" for no review. No other user-facing "—" was left in `mobile/src`, `lib` or `app`. `tests/no-em-dash.test.mjs` fails on any new one (comments may keep them) and on a line under the page title. |
| No second box inside a focused search field | `SearchBox` (`SearchPicker.tsx`) is now the one search field: its frame is marked bareInput, so the global input outline never draws inside it, and focus shows only as the frame's border turning `p.primary` (2px, 3:1 or more). No glow, no animation. Messages (`MessagesLayout` SearchBar, as a pill), Access control, Properties, Help, the tool directory, saved replies, New message and Add people now use it; the lists and pickers already did. The searchable Dropdown keeps its own bare-framed box (A's tests require it). `tests/search-fields.test.mjs` fails on any raw "Search …" input outside SearchBox or a bareInput frame. |
| Plain sign-in panel (wide screens) | `LiveSignIn.tsx`: the left panel is the logo, "Welcome back." with one line, and the house. The team chips, the four example activity cards and the footer line are gone. |

Screenshots: `docs/screenshots/session-e/round9/before/` and `after/`: a page title (Properties), the Messages search focused with "mark", and the sign-in screen, light and dark, 1440 and 390.
