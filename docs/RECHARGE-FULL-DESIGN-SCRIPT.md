# Recharge full design script

This is the intended design brief for the complete responsive website and mobile application. It extends the approved mobile visual direction to desktop. It describes required experiences, including live workflows that still need backend activation; it is not a statement that every screen or integration is already live.

## 1. Product direction

Design Recharge as a professional workspace for property operations, cleaning, maintenance, client approvals and accounts. Make the first screen answer three questions: what needs attention, what is scheduled, and what can this user do next. Keep every existing feature, permission, destination and business workflow available while changing the presentation.

Use calm surfaces, strong hierarchy, generous spacing, compact useful lists and purposeful colour. Combine the clarity of a business application with the polish of a modern mobile product. Every prominent element must help someone understand their work or take an action.

## 2. Colour system

Use cloud white F5F7FC for the light background, white FFFFFF for cards, graphite 172033 for primary text, slate 5C667A for secondary text and E0E5EF for borders. Use blue 3457D5 for primary actions, selection and the overview summary.

Give departments consistent secondary colours. Stays uses blue on EAF0FF. Ready uses teal 137D73 on E3F5EF. Cleans uses ochre 8A6417 on FFF3D7. Clients uses violet 55418C on EAE5FF. Accounts uses terracotta 833A27 on FFE9E1. Keep most of each screen neutral, with accents concentrated in icons, status labels and a few summary surfaces.

Dark mode uses 111827 for the background, 1E293B for surfaces, F5F7FF for main text, C0C8D8 for secondary text and 3B4860 for borders. Blue actions use A9BAFF. Adapt department accents to brighter foregrounds on muted tinted surfaces. Test every label, icon, input, date, chart axis, modal and disabled state in both themes. Pair status colours with words or symbols so colour is never the only explanation.

## 3. Typography and spacing

Use Inter throughout, with regular, medium, semibold and bold weights. Mobile page titles use approximately 28 to 32 pixels; desktop titles use 32 to 40. Section headings use 19 to 22. Main body text uses 15 to 16 with comfortable line spacing. Small metadata remains readable, usually 12 to 13, and never carries the primary action or essential instruction.

Keep labels concise and use sentence case. Use consistent date, currency and number formatting. Allow feature names to wrap rather than hiding important words. Financial figures and report totals should align cleanly.

Use an eight-pixel spacing rhythm. Mobile screens have approximately 20 pixels of horizontal padding. Separate major sections by 24 to 32 pixels. Give cards 16 to 20 pixels of internal space. Use restrained borders, soft shadows and rounded corners of approximately 16 to 24 pixels. Touch targets must be at least 44 pixels; primary controls should usually reach 48.

## 4. Desktop and mobile shell

On desktop, use a fixed navigation sidebar approximately 240 pixels wide, a compact top bar and a flexible main workspace. Put the logo, main destinations, departments and permitted administration links in the sidebar. Place the current page title, relevant controls, theme switch and avatar in the top bar. Give the main content one clear scrolling area. Keep reports and record tables wide enough to scan, with horizontal overflow available when needed.

On mobile, use a compact Recharge header with role, theme control and avatar. Keep the main content independently scrollable between the header and bottom navigation. Use five labelled destinations appropriate to the user's role. The selected tab has a soft highlighted background and a short sliding indicator. Keep the navigation visible without covering the final record or action.

The browser phone preview supports mouse wheel, trackpad, touch and mouse dragging. Dragging over a card scrolls the content; tapping still opens that card. Horizontal schedules and filters retain their own movement. Provide a subtle visible scroll indicator. This browser preview does not consume cloud simulator minutes.

## 5. Sign-in and profile setup

Use a focused entry screen with a clear welcome, Recharge identity and one obvious sign-in action. Support the agreed email or phone registration journey, verification, password setup, profile name and avatar. Break setup into short steps with clear progress, validation and a way to go back.

Show precise error messages beside the relevant field. Provide password visibility and password recovery. Display account restriction or retry information from the authentication service. The agreed five failed attempts and 24-hour lock must be enforced by the server. Show a confirmation animation only after an action has actually succeeded.

## 6. Role-specific overview

Start with a personal greeting, current date and one useful headline. Place a blue summary card below it with actual accessible work counts, completion progress and a direct link to the work queue. Follow with two small summaries for waiting work and accessible properties, or appropriate client approvals.

Next show a selectable weekly schedule, the selected day's records, department shortcuts and a compact needs-attention list. Each list row contains the task title, property, relevant date, status and destination. Keep the first screen useful even when the workspace is empty. Explain the next action instead of inventing records or statistics.

Cleaners see their assigned jobs and personal results. Cleaning managers see the permitted team workload. Clients see their properties, maintenance updates, messages and approvals. Ready and Stays teams see their permitted operational tools. Admins and super admins receive the workspace overview within their authorised scope.

## 7. Work and calendar

Use status filters, title search and a compact chronological work list. Show each record's main identifier, property, status, assignee and date where available. Opening a record reveals its existing details and permitted actions with a clear back path.

Offer both a weekly schedule and a monthly calendar. Selecting a date updates the related list. Highlight today separately from the selected date. Support previous and next periods and a return to today. Date controls and filters must remain usable at narrow widths. Show an informative empty state for days without records.

## 8. Properties

Create a clean property directory with readable names, location, useful metadata and relevant status. Use verified property photos when available, or a consistent flat architectural illustration. Opening a property presents its overview, work, maintenance, onboarding, relevant documents and authorised tools.

Keep information grouped and make ownership or scope clear. Clients can view only their properties. Any edit, assignment or sensitive field must follow existing backend permissions.

## 9. Departments and tools

Use a full-width department directory followed by grouped feature rows. Each department has a clear colour, a unique vector symbol and a truthful feature count. Each feature row contains its own 2D icon, full title, short supporting context, opening action and separate bookmark control. Search matches feature titles only. Saved tools remain personal to the user's profile and role.

Preserve all 37 existing features. Stays includes pricing, listing health, property records, weekly performance, licensing, AirCover, direct bookings, OTA access, maintenance reporting, cleaning reporting and communications. Ready includes calendars, routine maintenance, purchase orders, maintenance records, furnishing, inspections, bins and gardening. Cleaning includes schedules, cleaner performance, client and cleaner records, onboarding and invoices. Clients retain their dashboard, property maintenance, onboarding, furnishing calculator, mailbox and purchase-order quotes. Accounts retains owner statements, approved maintenance, onboarding invoices, purchase-order invoices, purchase-order accounts and replenishment requests. Some destinations cross departments; preserve the actual workflow and access mapping rather than changing permissions to match a visual grouping.

## 10. Reports and analytics

Place a calendar date-range selector near the page title. Offer useful presets and custom start and end dates with visible validation. Clearly identify the selected period, data source and scope.

Show summary counts followed by a line chart for activity, a circular chart for work status and a bar chart for source or department volume. Include legends, clear axis labels, accessible text summaries and a tabular data view. Selecting a day or status reveals its value. Chart values and exported totals must agree.

Give every role access to analytics appropriate to its authorised records. Provide report export to admins and super admins with a visible preparing state, success feedback and a retryable error. CSV exports respect the selected dates and server-side permissions. Distinguish missing data from a real zero, and label sample reports clearly.

## 11. Inbox, accounts and administration

The inbox uses a readable message list with subject, related property, time and unread state when the source supports it. A conversation opens into an organised message view with permitted actions. Keep important operational notices easy to identify.

Accounts screens prioritise invoice reference, client or property, amount, status and relevant date. Use aligned numbers and clear reconciliation details. Require confirmation for consequential financial or irreversible actions.

Administration includes member search, role labels, active or pending access, permitted modules and a clear view of who can do what. Authorised administrators can manage the access allowed by the backend. Super-admin tools include managing administrators, granting or revoking permissions and initiating the proper account recovery process. Show confirmations, outcomes and audit records. Every action still requires authenticated identity and server authorisation.

## 12. Icons, motion and interaction

Use a consistent family of flat 2D vector icons, approximately 22 to 24 pixels with balanced strokes. Give each feature a meaningful unique symbol and an accessible label. Put icons on subtle department-coloured surfaces. Use small vector illustrations for empty states and confirmations.

Use brief press feedback, approximately 160 to 240 milliseconds for screen and filter transitions, and smooth sliding selection indicators. Progress rings, chart lines and bars reveal actual values once when appropriate. Bottom sheets enter smoothly; desktop dialogs fade with a small positional movement. Respect reduced-motion preferences by removing unnecessary movement.

Motion should communicate selection, navigation, loading or completion. Prevent repeated animations from delaying routine work. Keep buttons responsive during transitions and prevent duplicate submissions.

## 13. Modals and system states

Use bottom sheets on phones and centred dialogs on desktop. Keep titles and close controls visible, scroll long content internally and preserve keyboard access. Allow Escape and appropriate backdrop dismissal for ordinary dialogs. Confirmation dialogs describe the consequence of the action.

Design loading, empty, error, permission-denied, offline and successful states consistently. Preserve entered information where safe after a failed request. Use skeletons that match the eventual content and short helpful messages with a meaningful action. Keep preview or unavailable features clearly identified.

## 14. Completion standard

Keep every existing feature reachable by the correct role. Verify scrolling to the last item on small and large screens, taps after dragging, horizontal filters, calendar selection, search, saved tools, dialogs, forms and report downloads. Test light and dark mode, keyboard navigation, readable contrast and reduced motion.

Validate counts against their sources and exports. Test role boundaries at the backend as well as in the interface. Review the actual rendered screens with screenshots. The final experience should feel consistent, clear and professional across desktop, mobile browser, Android and iOS.
