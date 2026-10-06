# Recharge frontend upgrade, Phase 1 review

Applied the supplied upgrade prompt to the presentation layer. The current 37 features, seven roles, permission checks, routes, integrations and synthetic data are preserved. Today and Tools use the same components on the mobile web preview and native source. The original desktop portal receives the shared colours and flat icon family; its shell redesign remains Phase 2.

## What changed

A shared palette supplies CSS variables on the web and resolved values on iOS and Android. Light uses F6F8FD, white and EEF2FA; dark uses 0D1220, 151C30 and 1C2540. Blue primary actions are separate from teal Stays, green Ready, amber Cleans, purple Clients and rose Accounts. Every feature has a distinct flat vector glyph, and every department has a separate symbol.

Today has a time-aware greeting, a calendar chip, a genuine attention marker from the existing role-scoped sample counts, a blue-to-violet gradient with restrained cyan glow and rings, neutral summaries, distinctive today/selected-date controls and readable status chips. Numbers use Inter tabular figures. The final item has 112 pixels of bottom padding, in addition to the separate navigation and safe-area layout.

Tools now opens directly from the existing Tools destination. It provides literal title-only search with highlights, grouped results, truthful counts, sticky mobile search and department chips that hide on downward scroll, section jumps, collapsible departments, remembered open state, an Expand all control, session-only role-specific pins without a cap, filled save controls and quick links to Reports, Calendar, Inbox and Profile. At 1024 pixels and wider, a fixed department finder sits beside a full-width card grid. Search and saved views can show matching tools across departments.

Theme defaults to the system and stores an explicit choice. Supported web browsers cross-fade over 200ms. Native source fades out and in over 200ms without blocking input. Browsers without the transition API switch immediately. Existing reduced-motion settings skip the new effects.

## Contrast adjustments

The requested light warning B45309 measured 4.48:1 on EEF2FA in the status glyph audit. It is now AD5008, measuring 4.77:1 there and 4.76:1 on the warning tint. No other requested foreground colour was changed. Decorative border E1E6F0 and dark border 2A3552 remain; additional input-outline tokens 8590A8 and 6B789C make control boundaries exceed 3:1. Primary-bright is decorative, not a small-text colour. Hero text uses white; rendered-pixel samples are recorded with the local screenshot gallery.

## Differences from the earlier full design script

1. Both complete theme palettes are replaced with the attached prompt's palettes.
2. Stays changes from blue to teal; Ready from teal to green; Cleans to a clearer amber; Clients to brighter violet; Accounts from terracotta to rose. These are presentation colours, not access or destination changes.
3. The solid overview becomes the specified gradient, restrained glow and concentric rings. Hero corners are 28px, cards 22px and selection pills rounded.
4. The department-first Tools page becomes a search-first finder with mobile collapsible sections and a desktop department/card layout. Feature rows use full titles without invented descriptions. Quick links remain available.
5. Preview bookmarks now last for the session, replacing the previous device-persistent preference. They remain separated by role; real account data is unaffected.
6. Status words use ordinary text colour with a status symbol. Department colours stay in their own tiles and indicators.
7. Wider motion and analytics changes from the prompt take precedence over the earlier script but remain scheduled for Phase 2. Phase 3 is not started.

## Icon replacements

All feature and department illustrations now share Lucide vector geometry, already available in the repository, with its ISC licence included. Direct Booking uses calendar-check; bins/gardening uses sprout; the property database uses building-2; Ready Calendar uses calendar-clock; Clean Calendar uses calendar-days. The department symbols are stays: hotel, ready: hard-hat, cleans: spray-can, clients: handshake, accounts: circle-pound-sterling. They do not repeat any feature icon. Saving has its own bookmark symbol.

| Feature | New symbol |
| --- | --- |
| Daily Pricing Report | trending-up |
| Listing Health Reporting | badge-check |
| Client Self-Furnishing Calculator | sliders-horizontal |
| Routine Maintenance | shield-check |
| Recharge Purchase Orders | shopping-bag |
| Purchase Order Requests | send |
| Purchase Order Quotes | file-check-corner |
| Management Property Database | building-2 |
| Property Onboarding | key-round |
| Recharge Client Dashboard | chart-pie |
| Property Maintenance | triangle-alert |
| Weekly Performance Report | chart-no-axes-combined |
| Ready Maintenance | wrench |
| Maintenance Reporting | activity |
| Clean Reporting | clipboard-list |
| AirCover Reporting | umbrella |
| Clean Calendar | calendar-days |
| Cleaner Performance Reporting | award |
| Clean Client Database | users |
| Cleaner Database | user-round-check |
| Cleaner Invoices | receipt-pound-sterling |
| Mailbox | mail |
| Replenishment Requests | package-open |
| Ready Calendar | calendar-clock |
| Licensing | file-badge |
| Direct Booking Reporting | calendar-check |
| OTA Logins | lock-keyhole |
| Stays Communication Centre | messages-square |
| Property Furnishing Board | sofa |
| New Property Inspection | scan-search |
| Routine Bin Collection & Garden Maintenance | sprout |
| Clean Property Onboarding Tracker | list-checks |
| Owner Statements | book-open-text |
| Approved Maintenance | git-merge |
| Onboarding Invoices | file-plus-corner |
| Purchase Order Invoices | credit-card |
| Purchase Order Accounts | briefcase-business |

## Verification

Production preview build, website type-check, mobile type-check and Expo lint pass. All 24 relevant automated tests pass, covering roles, destinations, title-only search, date ranges, reports/export reconciliation, read-only preview behavior, vector uniqueness, palette pairs and a 100-entry finder.

Browser checks covered all seven roles: cleaner 3 tools, cleaning manager 7, client 6, Ready 7, Stays 26, admin 37 and super admin 37. The local 100-tool stress harness rendered all 100 expanded rows, returned three title matches for Direct Booking, saved the final match and scrolled to the final section. It was never published or added to the live catalog.

Light and dark Today and Tools were captured at 375x844, 768x1024 and 1440x1000. Keyboard search and button activation, save/open controls, an empty search state, reduced motion, four colour-blind simulations, mouse dragging and scrolling to the final record were checked. The floating preview still opens a record after dragging. Automated visual lint reported no findings for the checked light Today and desktop Tools screens. Native sources compile, but a fresh iOS simulator binary and a physical-device/screen-reader audit have not been completed for this phase.

## Dependencies and reversible tradeoffs

New runtime dependencies: none, 0 bytes. Existing React Native Animated, react-native-svg and the installed Lucide geometry are reused. The original image assets are retained for rollback. Native platforms use resolved palette values because CSS variables are web-only. Optional grain is omitted to keep the background clean and avoid a new rendering layer. Web cards have subtle token-based shadows; native surfaces use borders and tonal elevation. Very long titles may use more than two lines at the narrowest width rather than lose words.

The 100-entry stress fixture demonstrates larger departments, but no fictional grouping is shipped. Before a real department grows beyond roughly 12 tools, propose subgroups based on its actual new workflows for approval.

## Remaining phases

Phase 2: broader motion orchestration, nav/icon fill and bounce, number and chart reveals, accessible direct labels, Reports layout, Work/Properties refinements, desktop shell, offline/error-state polish and a profile reduce-motion preference. Existing functionality remains available until its presentation is upgraded.

Phase 3, only after approval: command palette, pinned-tool reorder, parallax and isometric building glyph. The optional decorative building must not replace the flat feature icon system.

The supplied prompt explicitly says to stop after each phase for review. Phase 1 is the delivered review boundary. No database schema, authentication, authorization, access grants, billing or integrations were changed.
