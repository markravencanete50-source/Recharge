# Analytics

Every active workspace role has an Analytics navigation item. Quick periods cover 7, 30 and 90 days. Custom dates open a keyboard-accessible calendar with typed date fields, month/year navigation, Apply and Cancel. Desktop shows two months; narrow screens show one. Both dates are included, including single-day selections. Ranges are limited to 366 days. Creation timestamps and presets use Europe/London dates; scheduled cleans retain their calendar date. All three charts and the exact-data table use the same range.

## Access

Live snapshots are created on the server from the verified identity and current active access profile. Neither URL parameters nor frontend role selections establish authority. GET /api/analytics rechecks access on every refresh and uses private, no-store responses. The existing global API guard also applies. The snapshot contains date/status categories and property counts, without ticket descriptions or personal details.

Super admins and admins see workspace totals. Department users see workflows and sources allowed by their current module grants. A Cleans user whose email matches a cleaner sees only that cleaner's assigned jobs and properties. Schedule-only Cleans access without a cleaner match shows zero assigned jobs. Cleans management accounts without a cleaner association see department counts within their grants. Clients see their own maintenance requests, onboarding cases, mailbox activity and properties, matched by their verified email. Custom module grants also restrict analytics. An account with no granted sources has an explicit empty state. A revoked account cannot refresh its analytics; the UI clears its counters on an authorization rejection.

## Interpretation

Counts describe current statuses of records dated within the selection, not a historical reconstruction of status changes. Property counts are a current snapshot and are labelled accordingly. Source loaders currently limit workflows to 250, maintenance to 500, cleans to 1,500 and onboarding to 300 records before analytics filtering. Long ranges may therefore omit older records; the board displays this limitation. Unavailable sources contribute no counts. Linked work may appear in multiple sources. Booking revenue, occupancy and payment analytics require connected operational data and are not fabricated.

The public product preview contains only fictional data. Its role selector demonstrates permission-scoped dashboards; it grants no live account authority. Preview refresh uses the initial fictional snapshot and never contacts the live analytics API.

## Verification

52 focused tests pass, including UK daylight-saving boundaries, inclusive custom dates, invalid dates, leap years, totals reconciling across charts, client ownership, cleaner assignments, department/custom grants, revoked accounts, unavailable sources and API identity checks. Full application and preview builds, TypeScript and scoped lint pass. Browser checks cover all six preview roles, calendar clicks, immediate invalid-range feedback, Apply/Cancel, desktop/mobile layouts and both themes. Existing source limits and disconnected live integrations remain visible in the product preview.
