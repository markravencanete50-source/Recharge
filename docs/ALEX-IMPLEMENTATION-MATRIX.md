# Recorded requirements and implementation ledger

Scope approved 5 October 2026: implement the Property Management Database, Property Onboarding and Remainder of Stays recordings. The Communication Centre is deferred for the user and Alex to discuss. Do not activate its external channels, response timers, shifts or AI assistant as part of this scope.

Source: local timestamped transcripts in client-project/Recharge-Client-Notes/2026-10-05. A FAQ answer, route declaration or preview card is not evidence of a live workflow.

| Requirement | Implementation target | Verification needed |
| --- | --- | --- |
| One property record, client portfolio, regional counts and map | Shared UUID property, explicit owner, location, listing references, restricted financial/access sections | Cross-owner isolation; portfolio counts; coordinates are entered/imported, never invented |
| Enquiry to estimate, comparables, proceed/review/decline | Versioned onboarding case tied to shared property | Client decision, follow-up date, shared archive; forbid skipping stages |
| Management agreement and signatures | Staff publishes actual agreement; owner accepts frozen content/version with typed name and consent | Saved agreement accessible to both parties; no invented legal terms |
| Onboarding questions and handovers | Private form, owner/staff projection, licensing/garden/furnishing/cleaning tasks | Exactly-once departmental work, mailbox consent, warranty/repair thresholds |
| Accounts invoice, settlement and Ready inspection | Agreement creates invoice task; actual invoice payment plus form/access date gates inspection | Unpaid invoice cannot advance; booking differs from completion |
| Progress and notifications | Shared case stage, server activity, notification outbox and in-app updates | Never label a queued external notification delivered |
| Listing health and relisting | Daily property checks, reviews and suspension flags, linked relisting tasks | Trigger only on recorded evidence; no unconnected OTA scan claimed |
| Daily pricing and seven-day gaps | Reservations and vacant-date tasks, hold/change with reason | Real dates/rates; changes remain proposals until explicitly recorded as applied |
| Weekly downloadable client report | Pricing, listing work and dated local events grouped by property/week | Owner isolation, CSV injection protection, report contains actual records |
| Licensing from onboarding | Linked licence task, checklist and grant evidence | A task never means a licence is granted |
| Direct booking follow-up | Seven nights or longer creates follow-up; Accounts invoice precedes confirmation | Discount policy remains configurable and UNCONFIRMED until Alex confirms, per user reply |
| Maintenance referral | Reservation link, basic troubleshooting, warranty contact, spending limit, Ready booking and client approval | Stays retains visibility; approval gates dispatch; no dangerous troubleshooting advice |
| Cleaning report and mailbox | Assigned cleaner checks/photos, client mailbox consent, team review and guest feedback | Only accepted work invoiced; complaints create human review, never automated dismissal/pay denial |
| Purchase requests and reconciliation | Requirements/budget, approval, order, Ready delivery evidence, Accounts reconciliation | No completion without delivery evidence and invoice checks |
| OTA instructions | Restricted per-property field | Never included in ordinary records, activity or exports |

External provider dependencies: Hostaway credentials, Cloudinary configuration, production email/SMS and native push delivery. Implement their safe configuration boundaries and manual workflows while access is unavailable. Do not fabricate live imports, attachments, sends or events.

## Development delivered on 5 October 2026

The five property-workflow migrations are installed in hosted project `brixfalrrmzqoioggvfx`: `20261005092605`, `20261005093514`, `20261005095332`, `20261005103726`, and `20261005110625`. They extend the existing authentication, account administration and empty business workspace migrations. Installed migrations must not be edited or replayed.

The connected onboarding path now runs in PostgreSQL: owner enquiry, staff estimate and actual comparable links, owner decision, supplied management agreement with revision-bound consent, private property questionnaire, Accounts invoice and verified settlement, Ready inspection booking and findings, required team handovers, and actual listing URL before going live. A generic property or task update cannot skip this path. Retried actions return the original result without duplicating work. Booked inspections cannot be completed before their visit date.

Ready, licensing, furnishing, cleaning setup and Accounts work link to the same property. The inspection task is created when paid-invoice and completed-form checks pass, then reused when booked. In-app journey updates target the owner and permitted assigned staff. No external email or push is marked delivered by these functions.

The operational APIs cover recorded listing health and relisting, reservations and vacant dates, pricing proposals versus applied changes, seven-night direct-booking follow-up, capped versioned quotes, paid-invoice booking confirmation, maintenance approval and warranty gates, assigned cleaning with verified evidence and independent manager review, and purchase delivery/payment reconciliation. Direct-booking policy remains unconfirmed. Complaint handling records a human review rather than making employment or payment decisions automatically.

Portfolio APIs provide scoped property counts, stored coordinates, reservation references, sourced local opportunities, private owner payout details, in-app activity and dated property CSV reports. CSV exports neutralise spreadsheet formulas. Restricted bank, access and OTA information is omitted from ordinary records and report downloads.

The new authenticated web workspace at `/workspace` and native `/live` screen share guided forms, onboarding stages and data validation. They use permitted database records rather than preview fixtures. Role-scoped Reports supplies metrics and charts; administrators can export workspace reports, and owners can download their property reports. Native dates use a calendar picker, tokens use SecureStore, and login refresh returns current account permissions. Failed refreshes clear stale visible collections. Role-specific FAQs remain accessible through hideable sticky help.

The palette follows Alex's latest instruction: dark green header, white light-mode content and minimal accent colours. The specifically approved blue Today analytics hero is preserved. Reduced motion disables nonessential animation.

## Verification

Hosted rollback-only checks passed after all five migrations: unapproved and anonymous workflow invocations are rejected, private tables have RLS and no direct authenticated/anonymous access, internal helpers are not exposed, and there are no public security-definer functions. The refreshed Supabase Security Advisor reports zero errors, zero warnings and 20 informational suggestions; the private security/workflow tables intentionally have no direct user policies. Hosted Auth users and live properties both remain zero, as requested. No production test accounts or fixture records were created.

The final automated suite passed all 145 checks with zero failures, covering authentication, five-failure 24-hour lockout and reset, role hierarchy, revocation, row isolation, durable quotas, workflow transitions, retries, private projections, safe comparable links, report exports, preview isolation and analytics. Root and mobile TypeScript checks and scoped ESLint passed; backend and Expo web production builds passed. The built-Worker checks confirm that no D1/R2 bindings, privileged keys or public sample data are packaged for the live backend.

Browser checks use an ignored localhost-only harness of the actual web workspace components with synthetic layout records. At 390 by 844 pixels, the property and reporting views had no horizontal overflow, and the long property-setup form's final action scrolled above the fixed navigation. Loading, empty and error states are checked separately. Measured header, navigation, report and button text contrast was at least 5.96:1 in light mode and 6.71:1 in dark mode. These checks do not prove native iOS behaviour or actual account/provider delivery.

## Remaining development and activation

The internal editing, forecast, resource-candidate, operation-invoice and phone-only
authentication contracts are now implemented. See
`BACKEND-INTERNAL-CONTROLS-2026-10-06.md` for migration order, tests and the distinction
between completed backend contracts and pending interface/provider acceptance.

1. The existing backend Worker is deployed through the approved Git build connection. Install the new, locally tested `20261005172019_integration_foundation.sql` migration once Recharge database access is restored; the current connector/dashboard account cannot access that project. The existing hosted migrations remain unchanged.
2. Photo evidence upload/viewing, notification email/push delivery and scoped reservation import adapters are now built and locally tested. See `BACKEND-STRUCTURE-2026-10-06.md` for endpoint contracts, flags, secrets and failure handling. Configure providers later, connect the pending upload controls, add deliberate scheduling, and verify actual imports/deliveries and native devices. Provider webhooks/automatic polling are not yet enabled or claimed tested. Do not put privileged keys in the native app or repository.
3. Create verified real accounts and bootstrap Alex's approved owner address through the existing guarded administration process. Assign separate cleaner and cleaning-manager roles, then run cross-role acceptance tests. No role is granted by an email address alone.
4. Finish the map renderer, estimate calculator interface, resource-assignment pickers, reservation/local-event editing screens, restricted OTA details screen, and operation-specific invoice creation controls. Their stored-data/API foundations exist, but a tested API is not a finished user interface.
5. Exercise the new native live screen on an actual iOS build and Android device after the backend origin is configured. Email/phone registration and avatar upload require their production services; the current native live sign-in explicitly gates those paths.
6. The refreshed mobile audit confirms 20 high findings propagated from braces and node-forge advisories. Their current latest published versions are affected and no patched SDK-compatible release is available at this check. Root npm audit still resets; a direct root lockfile advisory lookup also reports braces. These remain unresolved. Do not apply the audit's incompatible Expo/React Native downgrade recommendation.

The Communication Centre remains deferred. External integrations, real-account testing and the listed interface work are not claimed complete.
