# Recharge backend activation

Verified 5 October 2026 against Supabase project `brixfalrrmzqoioggvfx` through the signed-in dashboard. Access/security and the core business services are installed. This does not certify the mobile application, all 37 feature workflows or production provider delivery.

## Completed on the hosted project

Preflight confirmed PostgreSQL 17.11, zero Auth users, zero workspace profiles and only `20261003120633_access_foundation` recorded.

The following original migrations were applied in one transaction, with exact original SQL stored in `supabase_migrations.schema_migrations.statements`:

- `20261003151028_workspace_administration`
- `20261003162617_authentication_security`
- `20261004083809_cleaning_manager_role`

The transaction succeeded. No accounts or role grants were created. New accounts continue to default to pending clients; a requested or user-editable role cannot activate access.

`supabase/tests/hosted_security_activation.sql` then passed on the actual project. It checks migration presence, private security-table RLS, access-table RLS, invoker-only public RPCs, direct-write denial, server-only guard permissions, the separate cleaning-manager role, five failures followed by a 24-hour lockout, persistent quota enforcement and refusal of an unapproved workspace session. Synthetic guard counters and events roll back. It does not create Auth users or send messages.

The existing local route and PostgreSQL access suites passed 31 checks covering recovery proofs, session invalidation, role escalation, custom grants, revocation, cleaner restrictions, lockout and rate limiting. These provider-mocked/local tests complement the hosted checks; they do not prove email/SMS delivery or a native login.

The refreshed Security Advisor reported zero errors and zero warnings, with six informational notices for RLS-enabled private security tables without policies. Those tables intentionally deny direct client access and are written only through checked server RPCs. Adding permissive policies to remove those notices would weaken the design.

Data API schema selection confirmed `public` and `graphql_public` exposed, with `private` unchecked. Automatic exposure of new tables was disabled and saved. No paid plan, third-party subscription or new credential was enabled.

## Core business milestone completed

Two additional CLI-created migrations are now applied and recorded with their original SQL in hosted migration history:

- `20261005065933_business_workspace`
- `20261005075617_business_device_limits`

The first adds nine public business tables and five private tables, all with RLS. The 37-row feature catalogue contains definitions only. Properties, jobs, invoices, conversations and Auth users remain empty. The second bounds push tokens, limits each account to ten registered devices and enforces a database write quota on registration. There are no sample business records in the hosted workspace.

The new services use Auth UUIDs and explicit property/job assignments. Clients see permitted owner records and cleaners see their assigned jobs and invoices; cleaning managers have distinct team access. Restricted access instructions, OTA details, financial notes, device tokens and notification queues remain private. Even administrators do not get those fields through ordinary property SELECTs. Clients and cleaners cannot approve their own work or assign another user's access. Removing an assignment, revoking a role or signing out takes effect on the next database call.

Checked RPCs implement property creation and assignment, work creation and state changes, explicit client approvals, invoice creation and administrator payment confirmation, threads/messages, and restricted property details. Requests that may be retried have UUID request identifiers and duplicate-content checks. Versioned updates reject stale writes. PostgreSQL enforces a per-account limit of 60 business row mutations per minute, including direct REST RPC calls that bypass the HTTP limiter.

Cookie and native bearer API routes are built. Native email login uses the existing five-attempt guard; refresh cannot approve a session obtained by bypassing guarded sign-in. Logout revokes the caller's current provider session. The native SDK stores only the rotating refresh token in SecureStore; access tokens stay in memory. It is not wired into the sample mobile screens yet and is deliberately disabled in the public web preview.

Live report RPCs aggregate only RLS-visible data using UK dates. The Today/Reports calculation accepts those weighted groups without changing totals. Admin and super-admin CSV exports enforce current access and neutralize spreadsheet formulas. Device tokens and assignment notifications can be recorded privately; there is no push delivery worker yet.

`supabase/tests/hosted_business_workspace.sql` passed on the real project after both migrations. It checks RLS on all 14 new tables, direct-write denial, private-field isolation, invoker-only public functions, device quota triggers and unapproved/anonymous RPC refusal. Its transaction rolls back. Local tests additionally exercise authorized and forbidden operations with synthetic identities; no real Auth accounts were created for testing.

The refreshed hosted Security Advisor shows zero errors, zero warnings and eleven informational RLS-without-policy notices on intentionally inaccessible private tables. The full local suite passed 121 tests with no failures or skips. Root and mobile TypeScript/lint checks, Vinext build, mobile web export and the Cloudflare deployment dry run passed. Subsequent esbuild lockfile remediation was checked with a fresh build, Drizzle's schema check and the Worker integration tests.

`scripts/build-backend-config.mjs` prepares a separate `recharge-backend` Worker with no D1 placeholders or R2 resources. Its route allowlist exposes only the Supabase-backed APIs and authentication pages. Unfinished legacy D1 handlers and sample pages return 404. Missing production configuration returns 503. The existing Pages URL is still a sample-only preview.

## Approved deployment completed

After the approval request was emailed to `markravencanete50@gmail.com`, the user replied "Approve" in this chat. Wrangler was authorized for user/account read, Workers write and Workers scripts write, using encrypted local configuration backed by Windows Credential Manager. No D1, R2, KV or billing permissions were requested.

The dedicated API is deployed at `https://recharge-backend.markravencanete50.workers.dev`. SUPABASE_SECRET_KEY, SUPABASE_PUBLISHABLE_KEY, AUTH_RATE_LIMIT_SECRET and APP_ORIGIN were saved as encrypted production Worker secrets through the dashboard. Credentials were not placed in Git, email, public bundles or local environment files. The initial code version is `a2b4bd56-25a1-4bb9-ab76-f0c269f744f3`; dashboard secret updates created subsequent versions. Active version `cdda731e` receives 100 percent of traffic.

Ten deployed HTTP checks passed: health configuration presence, unauthenticated workspace/report/export/private-field refusal, legacy/sample route exclusion, and cross-origin write/native transport refusal. Responses are no-store and do not grant CORS access. A separate live test using a random nonexistent `example.invalid` account returned four 401 failures, then 429 with `locked: true` and `retryAfter: 86400` on attempts five and six. This proves the deployed server can reach the hosted persistent guard. It does not prove a real account can log in, recover by email or use every business workflow.

Supabase's Site URL is now the deployed `/sign-in` page. Its redirect list contains only the exact deployed `/auth/recovery` callback, with no wildcard or preview origin. Delivery and an end-to-end recovery by a real user still require production email configuration. No Auth users were created and Alex has not yet been promoted.

## Remaining work in dependency order

1. Configure production email delivery and verification; configure a supported SMS provider before enabling phone registration. Complete phone-only profile provisioning, guarded phone login and recovery first: current workspace identity checks intentionally require a confirmed email. Exact server recovery redirects are already saved.
2. Alex registers and verifies `enquiries@rechargestays.co.uk`, setting his own password. Reviewed owner provisioning then establishes the first super admin. There are currently no registered users, so owner provisioning has not run.
3. Replace mobile sample loaders and read-only detail flows with the authorized live services. The new SDK is transport infrastructure, not a completed live mobile integration.
4. Port remaining feature-specific contracts from the 52-table D1 implementation. The generic work/approval services are not a complete replacement for all onboarding stages, quotations, purchasing, owner statements, calendars, cleaners' detailed forms or the Hostaway workflows. Keep legacy routes excluded until each contract and its access tests are complete.
5. Configure Cloudinary and implement scoped attachments/uploaded avatars; complete native push permissions, delivery, receipts/retries and cleanup; connect Hostaway and any approved external integrations. Queue storage alone is not notification delivery.
6. Connect the mobile Today and Reports screens to the same live report snapshot, wire actual exports and recent activity, and exercise pagination and empty/error states with verified test accounts.
7. Extend deployed allow/deny tests to verified role accounts, perform physical Android/iOS checks and run the agreed three days of role-based acceptance testing before launch.

The installed database lockout cannot protect an application that bypasses the guarded server path. Direct Supabase password tokens still need server session approval to reach Recharge. The full server and native client must both enforce this before live use.

Earlier audit documents describe historical observations. This document supersedes their statements that the security/access migrations remain unapplied or that the new native session API and core business schema are absent. It does not change the status of unfinished feature-specific contracts.

Local evidence is in the ignored `.audit/backend-activation` and `.audit/business-activation` directories, including live-api-checks.json, live-login-guard.json, cloudflare-encrypted-settings.png and auth-redirects.png. See BUSINESS-API.md for the new API boundary and SECURITY-AUDIT.md for dependency limitations. No service key, password or client business data is stored in these reports.
