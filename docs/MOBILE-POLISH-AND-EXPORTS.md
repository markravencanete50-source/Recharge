# Mobile polish and report exports

4 October 2026.

The mobile home and workspace have been redesigned around recognizable Stays, Ready, Cleans, Clients and Accounts departments. Department visibility follows existing module permissions. Individual features retain their identifiers, title-only search, unique artwork, saved preferences and existing destinations. The directory groups compact feature cards by department, with independent bookmark controls. The overview adds grouped operational summaries and a work-queue action. Work rows separate status, date and title. Forest green anchors the palette, with restrained department colours and readable light/dark surfaces. Existing press and entrance animations respect reduced motion.

Design research used official Guesty mobile property/task/calendar patterns and Linear mobile navigation and pinned-item patterns:

https://www.guesty.com/features/property-management-mobile-app/

https://linear.app/changelog/2026-01-22-customize-your-navigation-in-linear-mobile

Admins and super admins have CSV analytics exports with the current date selection. Reports reconcile with chart totals, contain daily source counts and flag disconnected sources, source limits and current property snapshots. The live endpoint rechecks active admin identity on the server; preview downloads are clearly marked as sample data. No live database grants or administrative accounts were changed by this update. Native exports use an on-device temporary file and the system sharing sheet. Browser exports download a UTF-8 CSV. Export notifications clear when switching preview roles.

The free floating phone studio is at /studio.html. Cloudflare packaging includes both the original desktop preview and the Expo mobile web export, with reloadable mobile routes. Existing ?view=phone links open the studio. The studio is explicitly labelled as a browser preview and consumes no simulator minutes.

## Verification

Root/mobile TypeScript and changed-source lint passed. Sixteen analytics and mobile-workspace tests passed, including forged export roles, every non-admin role, revoked/pending/suspended admins, invalid dates, CSV totals, sample labels and spreadsheet formula neutralization. Four preview endpoint tests passed, covering native routes, studio links, synthetic reads, denied mutations and unsupported authentication/API routes. Full server and combined preview builds passed. iOS bundling passed; subsequent native builds require their own runtime check.

Browser interaction checked department navigation, a feature modal, theme switching, role changes and client analytics with no export control. An actual CSV downloaded to the local Downloads folder and its summary matched the charts. Phone evidence covers 390 by 844 and 320 by 740; desktop evidence covers 1440 by 900. The shared leaf-text visual audit found zero issues on the polished home at 390 pixels and reports at 320 pixels after resolving title overflow and small report labels. Screenshots and audit results are stored locally under .audit/polished-*.

The native preview remains read-only. Live sessions, hosted security migrations and business integration work described in MOBILE-REDESIGN-IMPLEMENTATION.md remain pending. CSVs are aggregate operational reports rather than complete historical or financial ledgers. No claim of production readiness or full workflow completion is made.
