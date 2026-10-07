# Accounts, finance and team operations backend, 7 October 2026

This release completes the backend for the client's Management, Accounts, Cleans and Ready
feedback, without any provider keys. Xero, Stripe, email ingestion and media storage stay off;
where they will plug in, the database records a queued intent and never claims a posting,
payment or delivery happened.

Migrations, in order:

1. `20261007090000_accounts_finance.sql`
2. `20261007091000_team_operations.sql`

Web endpoints: `/api/workspace/finance`, `/api/workspace/teams`.
Native endpoints: `/api/mobile/finance`, `/api/mobile/teams` (SDK: `readFinance`, `writeFinance`,
`readTeams`, `writeTeams`). Both follow the existing rules: approved session, active profile,
exact origin or native transport, a shared write quota, strict input and a `requestId` on every
action. Identical retries return the original receipt. Changed input under the same identifier
is refused, and revoked or changed roles cannot replay old receipts.

## Accounts role

- `accounts` is a new workspace role, assigned by administrators only. Self-registration
  refuses it.
- Accounts users reach finance tools across the whole portfolio without being assigned to
  each property: cleans invoices, maintenance reconciliation, onboarding and purchase-order
  invoices, and owner statements.
- Entry instructions and OTA logins are not finance tools. They stay limited to assigned
  property staff.
- Finance handovers (for example "Invoice accepted property clean") notify the accounts team.
- Owners can now be granted `owner-statements` to read their own issued statements.

## Supplier expenses (`/finance`)

| Action | Who | Rules |
|---|---|---|
| `createExpense` | Accounts, management, or property staff with maintenance reconciliation | Property, supplier, reference, category, description, integer pence, received date, source (`manual` or `email`). A supplier and reference pair cannot be entered twice. |
| `addExpenseEvidence` | Same | `invoice`, `photo`, `quote` or `report`. Each item is a verified upload, a completed job on the same property, or a written check of at least 10 characters. Only allowed before a decision. |
| `approveExpense` | Accounts or management | Needs an invoice **and** proof of the work. Above the approval limit, management must approve. Approval sets Xero to `queued`. |
| `queryExpense` / `resolveExpenseQuery` / `rejectExpense` | Accounts or management | Each requires a note. |
| `setFinancePolicy` | Super admin | Sets the approval limit, or no limit. Nothing is assumed by default. |

Reads: `section=expenses` (optional `status`, `propertyId`), `section=expense&id=` (includes
evidence) and `section=overview&period=YYYY-MM`.

`public.workspace_finance_xero_result(expense, posted, billId)` can only be run by the service
role. The future Xero worker uses it to record a posted or failed bill.

## Payout reconciliation and owner statements

1. **Reservation values.** `setReservationFinancials` records the channel (`airbnb`,
   `booking_com`, `vrbo`, `direct`, `other`), the platform reservation code (required for Airbnb
   and Booking.com), guests and the expected payout. Hostaway imports will fill these later.
2. **Upload.** `importPayoutReport` takes the downloaded CSV.
   - The server reads the Airbnb or Booking.com columns and refuses a file from the wrong
     platform.
   - Repeated codes are summed, so adjustments are included, and summary rows without a code
     are ignored.
   - Only one total per code reaches the database.
   - The same report cannot be uploaded twice.
3. **Reconcile.** `section=reconciliation&period=` lists each confirmed platform stay as
   `matched`, `different`, `missing`, `no_reference`, `no_expected_amount` or `agreed`, plus
   report lines that match no reservation.
   - `agreePayout` records the agreed amount with a note.
   - An agreement lapses automatically if a later report changes that reservation's total.
   - `setAsidePayoutLine` parks an unmatched line with a reason.
4. **Terms.** `setStatementTerms` (management) stores the management fee and cleaning cost
   from each agreement. Statements refuse to run until both are set.
5. **Prepare.** `prepareStatement` (property, month) works out the figures below. It refuses
   while any stay in the month is unreconciled or a direct stay has no payout amount. A draft
   can be re-prepared.
   - Revenue: the agreed or matched payout for platform stays, and the recorded payout for
     direct stays.
   - Cleaning: accepted cleans in the month multiplied by the agreed cleaning cost.
   - Costs: approved expenses received in the month.
   - The fee on gross revenue.
   - The owner payout.
6. **Issue.** `issueStatement` locks it. Reservation values and agreements for that month can
   no longer change, and the property's owners get an in-app notice.
7. **Pay.** `recordOwnerPayout` records a bank transfer reference.
   - Stripe is refused until it is connected.
   - A negative balance cannot be "paid"; it appears in the management queue as owed by the
     owner.
   - `voidStatement`: accounts can void a draft; only management can void an issued statement.
     Paid statements cannot be voided.

Owners read `section=statements` and see only issued or paid statements for their own
properties.

## Team operations (`/teams`)

| Action | Who | Rules |
|---|---|---|
| `addCleanerStatement` | The cleaner named in the complaint | Once, while the complaint is open. |
| `decideComplaint` | Management | `upheld` or `overturned`, with a note. Overturning removes the rejection from the cleaner's record. If the clean was not redone, it becomes accepted and goes to the cleans invoice. |
| `decideCleanerReview` | Management | Repeated-complaint reviews: `no_action`, `supervised` or `removed_from_rota`. |
| `saveRoutinePlan` | Ready, Stays, management on the property | Monthly or quarterly visits on day 1–28, with a checklist and an optional current team assignee. Edits need the current version. |
| `generateRoutineVisits` | Same | For this month or the next two. One visit per plan per period. Assignees who have left the property team are dropped. Each call handles 10 plans and reports how many remain. |
| `saveCourse` | Management | Title, audience (roles or `all`), body, optional HTTPS video link, minutes, published. |
| `completeCourse` | Anyone in the audience | Published courses only. Repeat completions are ignored. |

Reads:

- `section=schedule&from=&to=` covers up to 62 days, filtered by `propertyId` or `userId`.
  - Staff see every job they can open, plus guest stays.
  - Cleaners see only their own jobs.
  - Owners see their stays without the channel.
- `section=performance`: monthly accepted, rejected and overturned cleans per cleaner, with a
  warning at two upheld rejections. Cleaners see only themselves.
- `section=management` (management only):
  - open cleaning decisions, including the cleaner's statement
  - expenses over the limit
  - owner approvals waiting more than 48 hours
  - cleaner warnings
  - owner balances due
- `section=routines`
- `section=training`: completion counts for management.

## Verification

- 14 new database tests (PGlite, all migrations applied in order) cover:
  - role scope
  - evidence and approval limits
  - receipts and replay
  - Xero service-only results
  - CSV duplicates
  - stale agreements
  - statement maths
  - issue and void rules
  - owner visibility
  - complaint decisions and overturns
  - warnings
  - schedule scoping
  - routine generation
  - training audiences
- 5 HTTP tests cover forged origins, browser-shaped native calls, inactive sessions, quotas,
  strict schemas and server-side CSV parsing.
- The existing database and HTTP suites still pass.

## Still waiting on keys or providers

- Xero OAuth app and bill posting worker.
- An inbound invoice mailbox that creates `source=email` expenses.
- Cloudinary for evidence photos and training videos.
- Stripe Connect for automatic payouts.
- Hostaway for reservation codes and payouts.
- Resend or Expo push for notification delivery.

## Live Cleans screens (phone app)

The phone app's live mode (`/live`, used when `EXPO_PUBLIC_WORKSPACE_API_ORIGIN` is set) now opens a
**Cleans** tab for cleaners and cleaning managers, backed only by the live endpoints above. The public
web preview still shows sample data, because the native API refuses browser requests by design.

**Cleaners** see:
- **Schedule:** their own jobs on a two-week strip, with guest arrivals and departures for that day.
- **Job sheet:** a tick-box checklist, camera or library photos that upload and verify one by one with
  retry, and a short report. Submit stays disabled until every check is ticked, at least one photo is
  verified and the report is written.
- **Complaints:** guest complaints they can answer once, a monthly warning, and their accepted and
  rejected counts.

**Cleaning managers** see:
- **Schedule:** the team schedule, filterable by cleaner.
- **New clean:** pick a property, date and checklist.
- **Reviews:** accept or reject with guest feedback and a note. A rejection opens the complaint flow.
- **Assigning:** cleans with no cleaner yet, and assigning or reassigning from the property's cleaners.
- **Performance:** each cleaner's results this month.

Each action keeps its request identifier until it succeeds, so a retry after a dropped response
does not create a duplicate. `tests/live-cleans-contract.test.mjs` runs the exact requests the
screens send through the HTTP schemas and the real database functions, and parses every response
with the schemas the screens use (`lib/cleans-live.ts`).

Before a cleaner can submit, two things must happen:

1. **Redeploy the backend Worker** so it serves `/api/mobile/teams` and `/api/mobile/finance`:
   `npm run build && npm run backend:deploy`, after `wrangler login`.
2. **Switch on photo uploads** with the Cloudinary keys and `MEDIA_UPLOADS_ENABLED=true`. Until then,
   uploads show "Photo uploads are not switched on yet". Scheduling, reviews, assignments and
   complaints work without it.

## Live Repairs screens (phone app)

Ready opens on a **Repairs** tab. Stays, management and owners get a Repairs / All work switch on
the Work tab. The stage rules live in `lib/repairs-live.ts` and match the database checks, so each
person is offered only the step they can actually take.

**The repair pipeline:**
1. **Report:** an owner, Stays or management reports a repair with a cost estimate and a safety flag.
2. **Owner approval:** if the estimate is above the owner's agreed limit, the owner ticks to approve
   it first.
3. **Refer:** Stays records the checks already made and the update given to the guest, plus the
   warranty contact if the property's agreement requires one.
4. **Book:** Ready or Stays sets the repair date and the contractor.
5. **Complete:** Ready or Stays files the report and the actual cost. The cost can't exceed the
   approved estimate. Completing sends the repair to Accounts to reconcile the invoice.

**Routine visits:**
- Ready or Stays sets up a monthly or quarterly plan with a checklist and a day of the month.
- "Create this month's visits" builds the visits from the plans.
- Ready starts a visit and marks it done; Stays or management then sign it off and close it.

`tests/live-repairs-contract.test.mjs` runs the full pipeline and a visit sign-off through the HTTP
schemas and the database, including the refusal when the cost exceeds the approved estimate. The
same backend redeploy noted for Cleans applies.
