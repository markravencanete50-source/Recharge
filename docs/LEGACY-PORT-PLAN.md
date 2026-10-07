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

## Client answers (7 October 2026)

- **No real records in the old portal.** No data move is needed, so the old portal can be retired
  as soon as people admin and property records work in the new app.
- **Hostaway: access is available**, so the Hostaway work moves up. **Cloudinary comes later**, so
  photos and documents stay as text notes for now.
- **Cleaner pay varies with every task, and there is no fixed payday.** Pay is set per clean, and
  Accounts pays whenever it chooses (see item 7).
- **Clock in/out is for the team only**, not owners. It is item 8 in Phase 2.
- AirCover was not confirmed, so it stays optional.

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
7. **Cleaner pay and replenishment** (M).
   - Each clean carries its own pay amount. The cleaning manager sets it when creating or
     assigning the clean and can adjust it when accepting.
   - Only accepted (or overturned) cleans count towards what a cleaner is owed.
   - Accounts sees each cleaner's unpaid balance, broken down clean by clean. Whenever they choose
     to pay, they select the cleans and record one payment with its bank reference.
   - Supply requests can be raised from a clean.
   - Both need a small database addition.
8. **Clock in/out for the team** (S). Staff roles only, never owners. Management sees hours by
   person and week. The **AirCover claims** tracker stays optional.

### Phase 3: files and photos (needs Cloudinary, which comes later)
9. Switch on uploads (the backend is already built) for cleans, expenses, repair evidence,
   purchase-order deliveries, onboarding documents and training videos. Add the owner's repair
   proposal PDF.

### Phase 4: Hostaway (access is available; moved ahead of Phase 3)
The keys go in as Worker secrets with `wrangler secret put HOSTAWAY_ACCOUNT_ID` and
`wrangler secret put HOSTAWAY_API_KEY`. They are never pasted into chat or committed.
10. Sync reservations and listings: stays arrive automatically, checkouts create cleans, and the
    platform codes and expected payouts fill in, so Accounts stops typing them.
11. **Guest communication**: an inbox per property, replies through Hostaway, reply templates,
    escalation to Repairs, and new-message push alerts. This is the largest single piece (L), and
    it can only be tested against a real Hostaway account.

### Phase 5: switch the old portal off (no data to move)
12. **Data move: not needed.** There are no real records in the old portal. A ClickUp history
    import stays optional.
13. **Retire the old portal**, straight after Phase 1. Point `/` to the new workspace, remove the D1 handlers,
    `drizzle/`, the R2 binding and the old centres (about 11,000 lines), and drop the unused
    variables (`CLICKUP_MIGRATION_KEY`, and the WhatsApp, BOnline and email-bridge
    placeholders).

### Dropped or folded in
- The analytics board is replaced by the Reports tab.
- The PriceLabs tick-box is replaced by recorded pricing decisions.
- The furnishing calculator stays an external link in Tools.

## Order of work after the client's answers

1. Phase 1: people admin, property records, the owners' view. **Done on 7 October 2026**: see
   `BACKEND-FINANCE-AND-TEAMS-2026-10-07.md`, People, Properties and owner view.
2. Retire the old portal (item 13).
3. Phase 4: Hostaway reservations and listings sync, then guest communication.
4. Phase 2: purchase orders, onboarding pipeline, direct bookings, cleaner pay.
5. Phase 3: uploads, once Cloudinary is set up.

## Still open

- The AirCover claims tracker: is it wanted?
