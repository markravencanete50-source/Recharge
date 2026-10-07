# Legacy portal port plan (7 October 2026)

## Where things stand

The old portal (`app/page.tsx` → `recharge-portal.tsx` and its "centres") runs on a **separate,
older database**: Cloudflare D1 (`drizzle/*.sql`, `db/schema.ts`), with files in R2. Only its
sign-in and access requests use Supabase.

The deployed backend Worker **does not serve any of it**. `worker/backend-route-policy.ts` allows
only the Supabase-backed routes: `/workspace`, `/api/workspace/*`, `/api/mobile/*`, `/api/session*`
and `/api/access*`. So "porting" a centre means rebuilding its useful parts on Supabase and in the
new app, then deleting the D1 code. It does not mean copying screens over.

Much of that is already done: the live phone screens cover Cleans, Repairs, Accounts, Management,
Stays and Training. The table below shows what each old centre still has that the new app lacks.

## Centre by centre

| Old centre | Covered in the new app | Still missing | Needs keys? |
| --- | --- | --- | --- |
| Maintenance (1,469 lines) | Repairs: report, owner approval, refer, book, complete, invoice to Accounts; routine visits | Repair photos; the owner's repair proposal PDF; daily, weekly, monthly and yearly checklists | Cloudinary for photos |
| Cleans (352) | Cleans: schedule, job sheet, review, assign, complaints, performance | **Cleaner invoices** (the hand-off exists, there is no screen); **replenishment requests**; a cleaner list; cleans created automatically from checkouts | Hostaway for automatic cleans |
| Operations and routine maintenance (373) | Stays: listing checks, pricing decisions, recording stays. Repairs: routines | **Direct-booking screen** (only basic forms today); relisting tasks; demand calendar | Hostaway for rates and reviews |
| Owner statements (58) | Accounts: payouts, reconciliation, statements. Better than the old version | **Owners seeing their statements in their app** (the backend is ready) | — |
| Onboarding (1,348) | Owner's journey in the Properties tab: estimate, comparables, agreement, inspection | **Staff pipeline view** of all cases by stage; documents; property chat; onboarding invoices to Accounts | Cloudinary for documents |
| Purchase orders (917) | The backend flow exists (request, approve, order, delivery, reconcile), reachable only through basic forms | **A proper purchase-order screen** and the owner's quote approval | Cloudinary for delivery photos |
| Property database (702) | Supabase properties with private access, OTA and finance sections | **Create, edit and archive property records in the app**; portfolio view; Hostaway listing sync; one-off ClickUp history import | Hostaway for sync |
| Communication centre and new-message alerts (2,701) | **Nothing** | Guest inbox, Hostaway replies, reply templates, escalation to repairs | **Hostaway** (email and WhatsApp were never actually built) |
| Client workspace (278) | Owner home, journey, repairs | Owner stays and revenue from real data, and statements (see above) | Hostaway for revenue |
| Workflow boards (567) | Hand-offs show in All work (inspection, furnishing, bins and garden) | AirCover claims tracker; onboarding and purchase-order invoice boards for Accounts | — |
| Team (admin) | Login, access requests and role approval run on Supabase | **People admin in the app**: approve accounts, set roles and modules, assign properties, revoke access. Also coverage regions and rotas | — |
| Clock in and out (in the portal shell) | Nothing | Stays time entries | — |
| Analytics board (93) | Reports tab and CSV export | Nothing important | — |
| Notification bell (119) | Activity tab | Push and email delivery | Expo push, Resend |
| Account registration (258) | Already live on Supabase | — | — |

## The plan

Bold items are the ones that unblock day-to-day use. Each phase ends with contract tests (exact
requests through the schemas and the database) and its own push.

### Phase 1: admin basics, no keys needed (start here)
1. **People admin** (S–M). Approve new accounts, change roles and module access, assign
   properties, revoke access. The Supabase functions exist; this needs a mobile endpoint and a
   screen in Management. Without it, every staff account has to be set up in the Supabase dashboard.
2. **Property records** (M). Create, edit and archive properties, and fill in the private access,
   OTA and finance details, using the existing Supabase functions.
3. **Owners' statements and stays** (S). Owners see issued statements and their confirmed stays.
   Both reads already exist.

### Phase 2: finish the workflows, no keys needed
4. **Purchase orders** (M). A screen like Repairs: request, approve within budget, owner quote
   approval, order, delivery evidence, Accounts reconciliation.
5. **Onboarding pipeline for staff** (M). All cases by stage with the next step for each team, and
   onboarding invoices handed to Accounts. Documents stay as text notes until Phase 3.
6. **Direct bookings for Stays** (S–M). Follow-up, quote with the discount policy, guest
   acceptance, then confirmation once the Accounts invoice exists.
7. **Cleaner invoices and replenishment** (M). Weekly invoice per cleaner built from accepted
   cleans and approved by Accounts; supply requests raised from a clean. Both need a small
   database addition.
8. **AirCover claims and clock in/out** (S each). Only if the client still wants them (see the
   questions at the end).

### Phase 3: files and photos (needs Cloudinary)
9. Switch on uploads (the backend is already built) for cleans, expenses, repair evidence,
   purchase-order deliveries, onboarding documents and training videos. Add the owner's repair
   proposal PDF.

### Phase 4: Hostaway (needs the client's Hostaway account and API key)
10. Sync reservations and listings: stays arrive automatically, checkouts create cleans, and the
    platform codes and expected payouts fill in, so Accounts stops typing them.
11. **Guest communication**: an inbox per property, replies through Hostaway, reply templates,
    escalation to Repairs, and new-message push alerts. This is the largest single piece (L), and
    it can only be tested against a real Hostaway account.

### Phase 5: move the old data, then switch the old portal off
12. **Data move.** If the D1 database holds real records, run a one-off checked import into
    Supabase: properties, open repairs and cleans, cleaners, onboarding cases and owner details.
    Then optionally the ClickUp history.
13. **Retire the old portal.** Point `/` to the new workspace, remove the D1 handlers,
    `drizzle/`, the R2 binding and the old centres (about 11,000 lines), and drop the unused
    variables (`CLICKUP_MIGRATION_KEY`, and the WhatsApp, BOnline and email-bridge
    placeholders).

### Dropped or folded in
- The analytics board is replaced by the Reports tab.
- The PriceLabs tick-box is replaced by recorded pricing decisions.
- The furnishing calculator stays an external link in Tools.

## Questions for the client before Phase 2

1. Does the old portal's database hold **real records they use today**? If so, Phase 5's data move
   should happen before anyone works in both places.
2. Do they still want **clock in/out** for Stays, and the **AirCover claims** tracker?
3. When will they have **Hostaway API access** and a **Cloudinary** account? Phases 3 and 4
   depend on these.
4. Should **cleaner invoices** be weekly or per clean, and at a fixed rate per property?
