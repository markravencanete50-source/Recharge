# Mobile redesign implementation

4 October 2026. This delivers the navigation and representative read-only flows from the approved plan. It is not a production launch or a claim that all 37 live workflows are complete.

## Delivered

The shared destination map preserves all 37 module identifiers and records their service dependencies in MOBILE-WORKFLOW-INVENTORY.json. Seven preview roles have five stable primary tabs. Home highlights actionable work; the directory uses compact individual illustrations, title-only search, area filters and bookmarks stored on the device separately for each preview role. Work has searchable lists, status filters and a Monday-first calendar. Properties open a full detail screen and link to related work and tools. Inbox, approvals and analytics reuse permitted sample sources and show explicit empty states where a connection is absent.

Forest green remains the primary colour, with restrained sage, teal, blue, lavender and terracotta department accents. Light and dark tokens apply to text, controls, cards and charts. Press and entrance animations honour Reduce Motion. Full feature details use a native screen presentation; supporting settings and date controls retain dismissible sheets. iOS property-to-tool transitions wait for the first modal to dismiss.

The client confirmed separate cleaner and cleaning-manager access. The cleans role now has personal jobs, performance and invoice tools. The cleaning_manager role has team tools and cannot administer accounts. Cleaners' server responses exclude other cleaners' records, team reviews and onboarding queues. Management mutations, assignment changes, approvals and invoice processing are blocked for cleaners. File reads and uploads verify assignment. Job status updates recheck ownership in the SQL write to guard against reassignment races. Analytics fails closed for a cleaner with no linked active identity.

The client also confirmed that the live workspace should start empty. Preview fixtures remain synthetic and labelled. No fixtures are to be imported into the production database; no existing hosted records were deleted.

## Verification

Root and mobile TypeScript checks pass. Changed mobile and permission code passes ESLint. Expo web, Android and iOS exports pass, as do the desktop preview and complete Vinext server builds. Tests cover all module destinations, title-only search, cleaner/client isolation, manager restrictions, PostgreSQL access hierarchy, RLS, session revocation, lockout and registration validation.

Browser checks cover persisted bookmarks, checked/selected accessibility states, filtered calendar days, summary-to-filter navigation, client properties and detail transitions. Phone evidence uses 390 by 844 and 320 by 740 viewports; desktop evidence uses 1440 by 900. At 320 pixels, calendar day targets are approximately 44.3 by 48 pixels without horizontal page overflow.

The uploaded native iOS simulator build is 8e365cc1-954b-4d1e-92cf-0ea0b3ca573c, from source commit 876e2cf. It was run on iPhone 14 Pro with iOS 17.2 through Appetize. Testing found and fixed full-screen modal headers overlapping the status bar by providing each modal its own safe-area context. The replacement build verifies property details, property-to-tool presentation, back navigation, light/dark mode, the profile sheet and cleaner-specific navigation. Screenshots are saved under .audit/redesign-ios-*.png. The Appetize build identifier is b_h5s4kzp4f5pevoabibknfv3vty. Simulator sessions were stopped after testing.

The standard visual-lint run reports inherited container colours and the intentionally scrollable content region. Direct text-node checks distinguish these from actual rendered text and report zero findings in light mode at 390 pixels and dark mode at 320 pixels. Screenshots are retained locally under .audit. This does not replace screen-reader testing or physical-device checks.

The broad suite initially found a registration mock that matched single-quoted imports only; it now handles both quote styles and all six registration checks pass. The rendered-html test depends on loading a Cloudflare worker artifact in plain Node, which rejects the cloudflare:workers import in this Windows environment. Record that limitation rather than claiming the entire suite passed.

## Backend and release gates

The reconnected Supabase dashboard showed only access_foundation applied. The administration, authentication-security and cleaning-manager migrations require hosted application and verification before live access can be enabled. The checked local SQL migration does not itself activate hosted security.

A read-only hosted query confirmed zero workspace profiles. The Supabase connector denied access; the signed-in browser dashboard remains available. The three pending migrations are prepared as one transaction, with their original SQL retained in migration history. Browser confirmation was requested before enabling the administration functions; no pending migration was applied without that confirmation.

The original 52 business tables remain in D1. Their migration to Supabase and table-specific ownership policies remain a separate workstream. Native session approval, phone-only workspace provisioning, email/SMS delivery, media uploads, push notifications and complete write workflows still need integration and end-to-end verification. Registration stays disabled in the preview. No manager or super-admin account was silently created or promoted.

Before release, complete allowed and denied action checks against the deployed backend, physical-device uploads and notifications, Android runtime checks, then the agreed minimum three-day role-based user testing. Store approval timing remains external.
