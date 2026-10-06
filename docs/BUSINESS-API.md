# Core business API

Status: implemented and locally tested; database migrations are installed in Supabase. Live HTTP deployment, provider delivery and mobile screen integration are pending. This contract covers shared core services, not all legacy feature-specific D1 workflows.

## Identity and transport

Browser requests use HTTP-only Supabase session cookies on the backend's exact APP_ORIGIN. Every mutation requires its exact Origin header. Native requests use `X-Recharge-Client: native` and a bearer access token, with no Cookie, Origin or Sec-Fetch-Site headers. The marker selects transport only; the provider identity, database-approved session and active current profile establish authority.

Native `POST /api/mobile/session` accepts `login` with normalized email and password, `refresh` with the rotating refreshToken, or `logout` with the current bearer token. Login returns only the session tokens/expiry and the authoritative account. A pending account can finish registration but cannot read or write business data. Phone workspace login is not enabled. Provider tokens from a direct, unguarded Supabase password login cannot reach the workspace.

The mobile SDK requires the HTTPS origin in EXPO_PUBLIC_WORKSPACE_API_ORIGIN. It stores a refresh token in SecureStore, never passwords or privileged provider keys. The current public web preview remains a separate read-only sample product.

## Reads

`GET /api/workspace` and `GET /api/mobile/workspace` accept:

| Parameter | Contract |
| --- | --- |
| entity | properties, work, updates, invoices, threads, messages or activity; defaults to work |
| limit | 1 to 100; defaults to 50 |
| cursor | Last returned UUID, except recent activity |
| propertyId | Work, invoices, threads or activity |
| moduleId | Work or invoices |
| workId | Work update history |
| threadId | Messages |

Unknown/unsupported filters are rejected. UUID entities use bounded keyset pages with `nextCursor`; recent activity returns a bounded first page, ordered newest first. Work/property permissions are enforced again by PostgreSQL RLS. Ordinary responses never contain access codes, OTA instructions, private payment notes or push tokens.

## Mutations

Both workspace endpoints accept POST JSON with one strict action. Bodies are capped at 16 KiB. Caller-supplied tables, SQL, roles, creator IDs and unknown fields are refused.

| Action | Required fields and authority |
| --- | --- |
| saveProperty | input.name plus requestId for a create, or id and version for an edit; administrator |
| assignProperty / unassignProperty | propertyId, userId and matching assignment kind for assignment; administrator |
| createWork | input.requestId, propertyId, moduleId and title; permitted staff, or an owner's mapped request feature |
| transitionWork | workId, version, status, note and requestId; checked role/state graph |
| assignWork | workId, version and userId (nullable); permitted staff, active matching property assignee |
| requestClientApproval | workId and version; permitted staff on a mapped client-visible feature |
| createInvoice | input.requestId, propertyId, moduleId, recipientId, reference, amountMinor and currency; permitted invoice staff |
| setInvoiceStatus | invoiceId, version, paid or void; administrator confirmation only |
| createThread | propertyId, subject, clientVisible and requestId; permitted communications staff or owner |
| sendMessage | threadId, body and requestId; visible thread participant |

Create/message/status-history retries must reuse the original requestId and content. Changed content under the same key returns a conflict. Versioned edits require the current record version. Cleaners can start and submit their assigned jobs, but cannot create/assign jobs or approve them. Explicit staff-requested client approval is required before an owner can approve a job. Approved work is distinct from completed work. Invoice amounts use integer minor units; no payment processor is connected.

Database write limits count row mutations, not only HTTP calls. A change affecting several rows consumes several of the 60 row mutations permitted per minute for an account. API limits provide additional IP/user protection. Quota failures return 429; stale/duplicate writes 409; denied actions 403; missing records 404; invalid input 400; unavailable services 503. Private database errors are not returned to clients.

## Restricted fields, reports and devices

`GET /api/workspace/property-details` or its mobile counterpart requires propertyId and section (`access` or `finance`). Checked RPCs decide access. An assigned cleaner gets only cleaning access instructions while an assigned job is waiting/in progress; OTA details and financial notes stay hidden. Administrator POST updates require a version and section-specific known fields.

`GET /api/workspace/reports` and `GET /api/mobile/reports` accept inclusive from/to dates, up to 366 days, defaulting to 90 days. The server obtains RLS-filtered date/status aggregates, plus preceding comparison cohorts, using Europe/London dates. Cancelled records are excluded. These groups describe the current status of records created on each date; they are not historical daily balances. Today and Reports must consume this same snapshot. Property totals are a current count.

`/reports/export` below either prefix returns a formula-safe aggregate CSV for an active admin or super admin only. It contains permitted chart aggregates, not raw client contact or financial details.

`POST /api/mobile/devices` registers or unregisters the caller's device UUID with an iOS/Android Expo push token. Tokens are private, bounded in length and limited to ten devices per user, with HTTP and database write quotas. Assignments/invoice changes can enqueue generic notification events. Delivery, native permissions and receipt/retry handling remain pending.

## Deployment

The approved live API origin is `https://recharge-backend.markravencanete50.workers.dev`. It is a protected API and authentication service, not the product preview. The existing Pages studio remains synthetic. The mobile SDK will use this value for EXPO_PUBLIC_WORKSPACE_API_ORIGIN when its live screens are integrated; that public value is an origin, never a secret. Current mobile screens remain sample-backed.

Production APP_ORIGIN, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY and AUTH_RATE_LIMIT_SECRET are encrypted Worker secrets. They survive ordinary Wrangler code deployments. Do not rotate the rate-limit secret casually: doing so changes account/bucket hashes and resets the mapping to existing guard counters. Supabase's exact recovery callback is this origin plus `/auth/recovery`.

Build with `npm run build` (or `npx vinext build` followed by `npm run backend:config` on Windows). Review `dist/server/wrangler.backend.json`, then use `npm run backend:deploy` after credential authorization. This configuration contains no server secrets, D1 placeholders, R2 subscriptions or legacy API routes. `GET /health` reports configuration presence only, not provider delivery readiness. Keep SUPABASE_SECRET_KEY and AUTH_RATE_LIMIT_SECRET in encrypted Worker secrets, with SUPABASE_PUBLISHABLE_KEY and the exact APP_ORIGIN configured there. Never add those secrets to EXPO_PUBLIC variables, client bundles or Git.
