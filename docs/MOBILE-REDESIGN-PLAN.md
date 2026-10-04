# Recharge mobile redesign plan

Proposal and source audit, 4 October 2026. No application changes or deployment are included in this planning step.

## 1. Outcome and audit verdict

Make Recharge feel like a working mobile operations app: a user opens it, sees what needs attention, and completes the next action. Preserve all existing business workflows while changing their presentation and navigation. Keep the forest-green identity, add restrained department accents, and use individual 3D illustrations where they improve recognition.

The previous direction is useful, but needs five corrections:

1. Additional accent colors cannot double as ordinary text colors. Dusty blue #7395A6, lavender #9A8DAD and clay #C5876D have approximately 3.19:1, 3.09:1 and 2.97:1 contrast against white. All fall below the 4.5:1 requirement for normal text. Use darker foreground variants and pale containers in light mode.
2. A long gallery of oversized tool cards is a useful directory, but a poor daily landing page. The saved iOS screenshot shows substantial space occupied by branding, introductory copy, filters and a large first card. Put urgent work above the fold and make the directory compact.
3. Five generic tabs are not automatically better than three. Use a small, stable navigation structure shaped by each persona's main tasks. Keep reports and calendar reachable without repeatedly searching a large More menu.
4. A common visual style must not collapse distinct workflows. Ready maintenance, Stays maintenance reporting, client maintenance and accounts reconciliation have different responsibilities and permissions.
5. A visual refresh is not completion of the native application. The inspected native model imports sample fixtures, several record views are read-only, and some modules return no sample records. Each required live workflow needs an explicit completion check.

## 2. Evidence and limits

Inspected source includes mobile/src/model.ts, mobile/src/theme.ts, the shared module and analytics definitions, existing web centres, and the saved native preview screenshot. The registry contains 37 feature identifiers, plus cross-cutting functions such as authentication, profile, Team, Access, notifications and analytics.

The current role model has super_admin, admin, stays, cleans, ready and client. Accounts is a department rather than a separate role. The cleans role covers management modules, while the native selector labels it Cleaner. Distinguish an individual cleaner's assignments from a cleaning manager's broader permissions before defining either home screen.

The native sample client-property list currently returns the complete fixture property list. Its analytics use separate scoping logic. This is a preview consistency gap, not evidence of a live data breach. Use the same ownership rules for lists, detail screens and analytics before connecting real records.

The existing security audit documents pending hosted activation and a separate native authentication flow still needed. It also documents 52 original business tables in Cloudflare D1; Supabase access-table RLS does not mean those business records have already moved to PostgreSQL. Recheck the hosted state during the implementation audit. This document does not certify production security, provider integrations or store readiness.

## 3. Information architecture

Use no more than five primary destinations. Labels stay stable within a user's approved access profile. Empty data does not remove a tab. Permission changes are handled deliberately after a refreshed session.

| Persona | Proposed primary navigation | First screen priority |
| --- | --- | --- |
| Stays and Ready staff | Home, Work, Properties, Inbox, More | Assigned work, upcoming visits, approvals and overdue items |
| Individual cleaner | Today, Jobs, Calendar, Inbox, More | Next assigned clean, property instructions and outstanding checklist items |
| Client | Home, Properties, Approvals, Inbox, More | Own properties, pending decisions and updates |
| Admin and super admin | Overview, Work, Properties, Reports, More | Operational exceptions, approvals, workload and performance |

These are prototype layouts, not new roles or automatic grants. Cleaning managers use the staff layout with their approved management modules. Accounts users receive a prominent Finance shortcut and relevant work queues based on explicit grants; access is not inferred from a display label. Admin messages remain directly reachable through a visible unread inbox action. Access administration is available only to eligible users.

Home contains a compact identity header, at most three useful summary figures, a prioritized action list and a small set of shortcuts. Avoid generic greetings, repeated page titles and department labels consuming the first screen. Users can still open the complete tool directory.

Work provides list and calendar views, with filters for assigned work, status, property and due date. Show property, due time, status and next action on each compact row. Preserve full feature names in the directory. Tool search continues to match feature titles only. Property and job searches have separately labeled inputs and do not silently change tool-search behavior.

Properties provides an overview and permitted sections for work, schedule, onboarding, documents and finances. An individual cleaner sees assigned-property context, not a company-wide database. Client views are restricted to owned or explicitly authorized properties. Displaying a unified property page does not merge the underlying records or expand access.

Use full screens for detailed forms, property records, long checklists, quotes and invoices. Use bottom sheets for filters, date selection, short choices and concise confirmations. Preserve unsaved drafts and warn before discarding them. Avoid opening several sheets on top of one another.

Inbox can offer a common entry point, but internal, client and guest conversations retain separate audiences, permission checks and supported delivery channels. Do not imply a channel works merely because its button appears.

## 4. Complete feature preservation map

The directory retains all 37 entries and their existing identifiers. The destinations below are proposed navigation locations. Every entry needs its current actions, validations, statuses, uploads, permissions and external dependencies recorded before implementation. Related property and home shortcuts open the same canonical workflow.

| Existing feature | Proposed main destination |
| --- | --- |
| Daily Pricing Report | Work / Stays / Pricing |
| Listing Health Reporting | Work / Stays / Listing checks |
| Client Self-Furnishing Calculator | Properties / Furnishing |
| Routine Maintenance | Work / Ready / Routine maintenance |
| Recharge Purchase Orders | Work / Ready / Purchase orders |
| Purchase Order Requests | Work / Stays / Requests |
| Purchase Order Quotes | Approvals / Furnishing quotes |
| Management Property Database | Properties |
| Property Onboarding | Properties / Onboarding |
| Recharge Client Dashboard | Client Home and Properties |
| Property Maintenance | Client Properties / Maintenance |
| Weekly Performance Report | Reports / Stays performance |
| Ready Maintenance | Work / Ready / Maintenance |
| Maintenance Reporting | Reports / Stays maintenance |
| Clean Reporting | Reports / Stays cleaning |
| AirCover Reporting | Work / Stays / AirCover |
| Clean Calendar | Calendar or Work / Cleaning calendar |
| Cleaner Performance Reporting | Reports / Cleaning performance |
| Clean Client Database | Cleaning workspace / Clients |
| Cleaner Database | Cleaning workspace / Cleaners |
| Cleaner Invoices | Cleaning workspace / Invoices |
| Mailbox | Client Inbox / Property mail |
| Replenishment Requests | Finance workspace / Replenishment |
| Ready Calendar | Work / Ready calendar |
| Licensing | Properties / Licensing |
| Direct Booking Reporting | Reports / Direct bookings |
| OTA Logins | Properties / Authorized OTA access |
| Stays Communication Centre | Inbox / Stays communications |
| Property Furnishing Board | Work / Ready / Furnishing |
| New Property Inspection | Work / Ready / Inspections |
| Routine Bin Collection & Garden Maintenance | Work / Ready / Recurring services |
| Clean Property Onboarding Tracker | Cleaning workspace / Onboarding |
| Owner Statements | Finance workspace / Owner statements |
| Approved Maintenance | Finance workspace / Maintenance reconciliation |
| Onboarding Invoices | Finance workspace / Onboarding invoices |
| Purchase Order Invoices | Finance workspace / Purchase invoices |
| Purchase Order Accounts | Finance workspace / Purchase accounts |

More contains the permission-filtered tool directory, saved tools, profile, settings, support and appropriate specialist workspaces. Team and Access administration remain distinct functions. Keep a clear route from a report or notification to its authorized source record.

## 5. Color system

Keep the existing core: forest #315F50 for light-mode primary actions, deep forest #1C3934 for text, off-white #F2F5F2 for the canvas and white surfaces. Dark mode retains #10211B backgrounds, #1A2E25 surfaces, #E3EEE6 text and sage primary buttons with deep text.

Department color appears in small icon containers, section markers and selected illustrations. Most screen area remains neutral and forest. Avoid tinting every full card or giving every screen an unrelated palette.

| Department | Light foreground | Light container | Calculated contrast |
| --- | --- | --- | --- |
| Cleans, sage | #506337 | #EDF2E4 | 5.79:1 |
| Ready, teal | #2F665B | #E7F2EE | 5.78:1 |
| Stays, dusty blue | #36596C | #EAF1F5 | 6.57:1 |
| Clients and onboarding, lavender | #625173 | #F1EDF6 | 6.18:1 |
| Accounts, clay | #7A4936 | #F8EEE7 | 6.48:1 |

Proposed dark-mode blue, lavender and clay pairs are #AFC7D4 on #20343D, #C6B7D9 on #302B3B and #DFB09A on #3B2D26. Their calculated contrast is approximately 7.37:1, 7.28:1 and 6.80:1. Validate every actual component combination, including opacity, chart labels and disabled states; these pair calculations alone do not certify an entire screen.

Status colors are a separate system: success, waiting, error and information always include a readable label or recognizable symbol. Department color never becomes the only way to understand a task's status.

Contrast reference: [W3C text contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html).

## 6. Icons, illustrations and layout

Use a shared semantic icon map across native and web. Match stroke weight, optical size and rounded geometry. Existing Feather and Lucide assets can be mapped consistently before adding another library. Use restrained outline icons for navigation, filters and actions; pair unfamiliar icons with text.

Provide a unique visual concept for every feature illustration. Examples: an appointment diary for Ready Calendar, a diagnostic checklist for inspections, a house with tools for maintenance, a receipt with a repair marker for Approved Maintenance, and a property key with an invoice for Onboarding Invoices. Different records must not reuse the same wallet image.

All illustrations share camera angle, lighting, material quality, scale and transparent padding. Forest materials receive a small department accent. Inspect exported assets individually for clipping and dark-mode halos. Use optimized static assets and subtle interface movement instead of adding a real-time 3D engine.

Use illustrations at roughly 56 to 72 points in the compact tool directory and larger only where space supports them. Day-to-day work rows prioritize readable content. Start with 16-point body text, 12 to 13-point secondary text, clear heading hierarchy and a consistent spacing scale. Support device text scaling without truncating actions or essential values.

Aim for at least 44-point touch areas on iOS and 48-dp areas on Android. These are design targets, not a claim that WCAG AA requires 44 CSS pixels. Keep safe areas, keyboards and bottom navigation clear of form actions.

On desktop, retain a properly bounded sidebar and independently scrolling content where appropriate. Prevent the department navigation from sliding underneath the account section. Style necessary scrollbars discreetly while retaining keyboard and pointer usability.

## 7. Interaction and animation

Use short press feedback around 100 to 160 ms, navigation transitions around 180 to 240 ms, and sheet transitions around 240 to 320 ms. Charts can enter once in roughly 300 to 450 ms. Tune these values on actual devices; do not animate every card again when returning to a list.

Add pull-to-refresh, explicit loading states, contextual success feedback and reliable sheet dismissal. Saved tools should persist for the signed-in user rather than only the current preview session. Preserve relevant filters and scroll position when returning from a record.

Support Reduce Motion, screen readers, visible focus and keyboard navigation on web. Avoid continuous floating, exaggerated card tilt and animated values that delay reading. Never show a payment, approval or irreversible action as completed before the server confirms it.

For each interactive component define loading, empty, error, disabled, permission-denied and successful states. Show retry options and preserve entered data when submission fails. Offline behavior must clearly indicate what is cached and what cannot be submitted; do not imply offline writes synchronize until that capability is implemented and tested.

## 8. Analytics

Give every access profile relevant analytics, using its actual property, module and assignment permissions. Cleaner analytics concern assigned jobs; client analytics concern authorized properties; staff and administrators see their granted operational scope. Do not fabricate revenue, occupancy or performance measures where the source data is absent.

Retain date presets and custom start/end calendars. Apply one selected period consistently across charts and period-based totals. Label current snapshots separately from period metrics. Preserve the shared Europe/London date handling and existing range validation.

Use line charts for trends, bars for comparisons and a donut for a small number of status categories. Add tap targets and readable values, and offer access to the underlying records. Depth belongs in the chart card and restrained shadows, not perspective that makes the data harder to compare.

Distinguish zero results from unavailable data. Avoid duplicated counts when one workflow appears in several department views. Opening a chart segment must preserve its date/status filters and recheck record authorization.

## 9. Functional and security integration

First trace one complete journey for each persona through the existing application. Record which steps have reusable APIs, which need native screens, and which lack a verified service integration. An external furnishing-calculator link is not equivalent to possessing its source code.

Retain React Native with Expo for mobile. Continue with the agreed Supabase authentication/database direction, Cloudinary media direction and current Cloudflare hosting direction, but inspect actual connections before representing them as live. The D1-to-Supabase business-data migration remains a distinct backend workstream. Do not combine an untested database replacement and every visual change into one release.

Provide native email or phone registration, verified contact, password setup, profile name and avatar through a server-approved flow. Phone verification depends on configuring and testing the SMS provider. Avatar photo uploads need validation, storage rules and failure recovery. New accounts cannot choose privileged roles.

Validate the requested five-failure, 24-hour password lockout and verified password recovery through the mobile flow, not only the web route. Confirm deployed rate limiting, session approval, revocation, SQL parameterization and table-specific data access rules. Server checks and RLS must enforce access even when the interface is bypassed. Alex's super-admin role can manage approved permissions but is never implemented by embedding a privileged database key in the app.

Set up native notification delivery only after its credentials and server events are ready. Test permission denied, foreground/background delivery and opening the correct authorized record. Separate task alerts from conversation messages and avoid including sensitive record content in lock-screen previews.

Keep sample data visibly identified until each live flow is verified. Do not promote a preview role picker into production authorization.

## 10. Delivery sequence and estimates

| Phase | Deliverable and completion gate | Planning allowance |
| --- | --- | --- |
| 1. Functional inventory | All 37 workflows and cross-cutting services mapped; roles, record ownership and external dependencies recorded | 1 to 2 working days |
| 2. Design system and representative flows | Light/dark tokens and components; prototypes for cleaner, client and admin journeys; long text and empty/error states | 2 to 3 working days |
| 3. Backend readiness | Verified native authentication and permissions; confirmed business-data strategy; usable workflow and media contracts | Estimate after phase 1 |
| 4. Native interface migration | Navigation, Home, directory, work lists, property details, forms, Inbox and analytics moved in small verified groups | Estimate per workflow after phases 1 and 2 |
| 5. Three-day release testing | Role-based user testing, repairs and regression, then complete release rehearsal | Minimum 3 working days |
| 6. Submission and handover | Verified builds, release notes, account ownership and support handover; store submissions | Depends on account/build readiness; store review is external |

Design work may run alongside independent backend work, but real mobile workflow integration starts only when its backend contract is ready. Preserve the user's backend-first integration sequence.

Day 1 of release testing uses representatives of each access profile completing realistic journeys. Day 2 fixes findings and retests related permissions, data and interaction states. Day 3 covers end-to-end regression, both operating systems, notifications, recovery and release rehearsal. A critical failure extends testing. Submission follows a passed gate, not merely the end of day 3.

The earlier three-week maximum should not be repeated as a guaranteed completion date for all 37 live workflows. The current native preview and the documented backend activation/migration work do not support that guarantee. Phase 1 produces a defensible phased estimate and identifies any decisions needed from Alex. No new paid design subscription is necessary for this plan; existing service fees remain separate from the development agreement.

## 11. Verification and acceptance

Create a feature matrix with read, create, edit, submit, approve/reject, upload, export and notification actions wherever those actions exist in the current scope. Each action needs an allowed-user test, a denied-user test where relevant, and observable saved results. A working-looking card does not count as a completed workflow.

Test client-to-client and cleaner-to-cleaner isolation, pending/revoked accounts, ordinary-admin versus super-admin actions, session expiry and direct API access. Validate business ownership rules in the actual deployed data layer. Confirm analytics totals against the same authorized records shown in lists.

Check light/dark mode, small phones, large text, keyboard-open forms, screen readers, safe areas, back gestures, interrupted uploads and slow networks. iOS simulator success is useful but does not replace Android runtime testing or physical-device verification of notifications, camera and file handling.

Measure scrolling and transitions on representative devices. Avoid layout jumps, excessive image memory and long lists rendered all at once. Test loading and repeated navigation rather than only a still screenshot.

Release only when the feature inventory is accounted for, no critical workflow or permission defect remains, visible controls work, and any deliberately deferred item is clearly recorded and agreed. Maintain screenshots and a concise verification record for each delivered group.

## 12. Implementation approach and handover

Make small reviewable changes on the project branch. Establish shared components first, then complete one representative journey per persona before applying the pattern across the remaining modules. Preserve module identifiers and existing contracts where they remain suitable. Keep an explicit mapping whenever a label or route changes.

Provide the feature preservation matrix, design tokens, icon/illustration manifest, native and web screen inventory, integration checklist, test evidence, release notes and documented outstanding items. Push and deploy implementation only in the implementation step; this planning request does not require changing the running product.

Open decisions to resolve during the inventory are the cleaner versus cleaning-manager grants, Accounts-user grants, required communication channels, external calculator ownership, SMS/media/notification provider readiness and production data availability. These do not prevent preparing the design direction now, but they affect implementation and release estimates.
