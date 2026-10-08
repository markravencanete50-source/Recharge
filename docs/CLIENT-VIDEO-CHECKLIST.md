# Client video checklist

Every ask from Alex's four ClickUp videos (Communication Centre, Property Management Database,
Property Onboarding, Remainder of Stays), checked against the live app code and database on
8 October 2026.

Key: ✅ built and usable · 🟡 partly built · ⏸ built, waiting on an outside service · ❌ not built

**Totals (76 asks):** ✅ 36 · 🟡 23 · ⏸ 10 · ❌ 7

## 1. Communication Centre

| # | Ask | Status | What's there / what's missing |
|---|---|---|---|
| C1 | Guest inbox with new messages from Airbnb, Booking.com and direct (Recharge logo on direct) | ❌ | No inbox screen and no message text stored. Needs the channel manager (Uplisting) and the inbox building. |
| C2 | AI-assisted guest replies | ❌ | No AI in the live app. Needs an AI key and building. |
| C3 | Reply timing: green under 5 min, amber 5–10, red over 10 | ⏸ | Grading built (targets editable). No messages arrive yet, so reports are empty. Needs the channel manager. |
| C4 | Every team member has their own login | ✅ | Sign-up, admin approval, roles. |
| C5 | Guest relations and client relations teams | 🟡 | Both exist as clock-in departments. Client relations isn't measured, and people pick a department at clock-in rather than belonging to one. |
| C6 | Two shifts: 8am–3/4pm and 3pm–11pm | 🟡 | Shifts are labelled early/late by clock-in time. No rota or fixed shift windows. |
| C7 | Clock in and out on the site | ✅ | Shift card on Home; admins can close forgotten shifts. |
| C8 | Each reply credited to whoever is clocked in | ⏸ | Built. Waiting on message data. Open question for the client: in the 3–4pm overlap both people get credit. |
| C9 | Per-person green/amber/red with a 90% pass mark (on/off track) | ⏸ | Built in Team performance. Waiting on message data. |
| C10 | Bonus tiers at 95% and 100% | ⏸ | Built (tiers editable). Shows the tier reached; no bonus amounts. |
| C11 | Team WhatsApp via Meta | ❌ | Needs Meta WhatsApp Business set up, then building. |
| C12 | Shared mailboxes: onboarding, enquiries, guest relations, client relations | ❌ | Needs Google Workspace or Microsoft 365 access, then building. |
| C13 | Each person sees their own email | ❌ | As C12. |
| C14 | AI insight / guest sentiment | 🟡 | Staff tick a review's sentiment by hand on listing checks. No AI analysis. |

## 2. Property Management Database

| # | Ask | Status | What's there / what's missing |
|---|---|---|---|
| D1 | Call it "Property Management Database" | ✅ | The page and the tool carry the name. The bottom-bar tab stays "Properties" to fit. |
| D2 | Clear the old properties; re-onboard everything through the new process | ✅ | Old Hostaway properties archived and cleared. Admins can still add a property directly, bypassing onboarding. |
| D3 | All of a property's information in one place | ✅ | One page: owner (name, email), listings, stays (now, upcoming, recent), the owner's set-up answers, payout details (on request, account number masked), access and logins, onboarding, work and invoices. Each part only shows to people allowed to see it. Guest names aren't stored yet; they come with the channel manager. |
| D4 | See what stage every property is at | 🟡 | Each property has a stage tracker. No list or pipeline of all properties by stage. |
| D5 | Client portfolio: number of clients, properties per client, portfolio size | 🟡 | Totals shown (properties, live, onboarding, owners). No per-client breakdown, although the database already works it out. |
| D6 | Take the enquiry/onboarding strike rate out of this report | ✅ | Removed. (It isn't shown anywhere else yet.) |
| D7 | Map, or properties per region of Scotland | 🟡 | "By region" bars. No map; region is free text, so spellings can split the counts. |
| D8 | General portfolio statistics | 🟡 | Headline counts only. No trends over time, revenue or occupancy across the portfolio. |
| D9 | Each property linked to its channel-manager listing so messages sync | ⏸ | Needs the Uplisting connection; no screen yet to link a listing by hand. |

## 3. Property Onboarding

| # | Ask | Status | What's there / what's missing |
|---|---|---|---|
| O1 | Client logs in and fills in a new enquiry | ✅ | |
| O2 | Shows in the client's properties with the full journey stage by stage | ✅ | Updates when the app refreshes. |
| O3 | Team writes the estimate (e.g. 110 / 120 / 130 a night) with comparables and publishes it | ✅ | |
| O4 | Email and app notification at every stage (WhatsApp a bonus) | 🟡 | In-app notices at every stage. Email ready but waiting on the Resend key (and the wording is generic). Phone push needs the app to register devices. No WhatsApp. |
| O5 | Estimate page explains the service, extra services and the onboarding process | 🟡 | Shows rates, notes and next step. No service or add-on explainer. |
| O6 | Client can change the occupancy level and see the estimate change | ✅ | "Explore your estimate" on the estimate: pick a quieter / expected / strong year and an occupancy, and earnings update as you go. Same sums as the team's estimate model. |
| O7 | Client can toggle direct bookings vs Airbnb bookings | ✅ | "Booked direct" control: platform fees fall and the saving is spelled out. Shown once the team publishes the platform and management fees with the estimate. |
| O8 | Links to the comparables | ✅ | |
| O9 | Approve and proceed / need more time (team check-in) / won't proceed (archived both sides) / ask questions | 🟡 | All three decisions work; "need more time" puts a check-in on the team's Home. Questions can only be sent alongside a decision. |
| O10 | FAQ section on the estimate | 🟡 | FAQs are on the Help page and written for staff. None on the estimate page. |
| O11 | Sign the management agreement electronically, stored both sides | ✅ | Typed-name signature with consent and agreement version. No PDF copy. |
| O12 | Onboarding form: access information | ✅ | Stored privately; staff see it under "Access and logins". |
| O13 | Recharge mailbox choice (open and photograph post, or leave it safe); cleaners' post photos go to the client's mailbox | 🟡 | Choice saved; cleaners log post with a note and it shows in the owner's Mailbox. No post photos yet (needs Cloudinary and a mailbox photo step). |
| O14 | Ready-team questions for getting the property ready to go live | ✅ | Answers show on the property page under "Getting ready to go live" for the team, Ready included. |
| O15 | Needs a licensing compliance report → licensing ticket in Stays | ✅ | |
| O16 | Has a garden → Ready ticket for regular garden maintenance | ✅ | Creates a set-up ticket; doesn't create a recurring garden plan. |
| O17 | Warranty and repair contacts → "contact this person first" on repairs | ✅ | The owner's preferred repair contact and warranties show on every repair at that property, highlighted as "contact first", and warranty repairs need proof the provider was contacted. |
| O18 | Auto-permission for repairs up to £X | ✅ | Under the limit goes straight ahead; over it goes to the owner. |
| O19 | "Furnish it for me" → furnishing quote ticket for Ready; otherwise self-furnish | ✅ | Self-furnishers get the furnishing calculator. |
| O20 | Submit the form with permissions and evidence | 🟡 | Permissions checked. No way to attach documents or photos. |
| O21 | Once signed → Accounts ticket to send the onboarding invoice | ✅ | Sending itself is manual until Xero/email are connected. |
| O22 | Invoice marked settled → ticked on client and team side | ✅ | The property page lists each invoice with a "Settled" tick for the client and the team. |
| O23 | Access dates → Ready "new property inspection" ticket | ✅ | Ticket created automatically; the first access date shows on the property page. |
| O24 | Ready books the inspection and fills in a detailed report | 🟡 | Booking and the report now open straight from the inspection ticket. The report is one free-text box (no checklist or photos). |
| O25 | Ready notified straight away when something is needed | 🟡 | In-app only, and only staff assigned to that property. New enquiries aren't auto-assigned to Ready. |
| O26 | Whole onboarding automated, client always updated | 🟡 | Stages, tickets and in-app notices are automatic. Emails and push not yet going out; some steps are manual. |

## 4. Remainder of Stays

| # | Ask | Status | What's there / what's missing |
|---|---|---|---|
| S1 | Every new Airbnb / Booking.com review appears in Listing health | ❌ | Reviews aren't imported. Needs the channel manager and building. |
| S2 | Staff acknowledge each review as good or bad | ✅ | "Log a review" on each property: platform, rating, good / mixed / bad, what the guest said and how it was handled. Reviews still have to be entered by hand until the channel manager feeds them in. |
| S3 | Tag a really bad review "re-list" → re-listing ticket → complete | ✅ | Staff choose to re-list after a bad review (from the review or the listing check). Re-listings show on the Stays screen: to start → under way → re-listed. |
| S4 | Suspension found → automatic re-list ticket | 🟡 | Hidden or suspended listings go on the re-listing list automatically when a check records it. No automatic scan of the platforms (needs the channel manager). |
| S5 | Daily check: all visible, no unhandled bad reviews, suspensions dealt with, re-listings done | ✅ | "Today's sign-off" on the Stays screen: all listings visible, bad reviews answered, suspensions dealt with, re-listings done or under way, with a note if any are still open. Admins see the last 14 days in Team performance. |
| S6 | Report of that daily work per person feeding performance and bonuses | 🟡 | Team performance shows each person's listing checks, reviews, pricing decisions and daily sign-offs. Bonus tiers still use reply times only. |
| S7 | Gap nights in the next 7 days → ticket; staff change or hold the price with a reason | 🟡 | Gaps highlighted, decision and reason recorded. The ticket only appears once staff save a decision, and stays are entered by hand while there's no channel manager. |
| S8 | Pricing changes feed the weekly client report | ✅ | |
| S9 | Weekly scan for local events near each property | ❌ | Needs an events data provider and building. The report says no scan is connected. |
| S10 | Weekly report downloaded and sent to the client; client report section | 🟡 | Download (CSV) works for clients and staff. Not sent automatically each week (needs Resend). |
| S11 | Licensing tickets from onboarding worked through the full licensing process | ✅ | Licensing runs in stages: application submitted (council and reference) → safety checks (gas, electrical, alarms, legionella, EPC, insurance) → licence granted. |
| S12 | Any booking of 7+ nights → direct-booking ticket | 🟡 | Works for stays entered or edited in the app. Bookings from the channel manager don't create it yet. |
| S13 | Recommended rate about 10% below, max £100 off | ✅ | The offer price is shown on the booking once prepared, alongside the original price, and the policy (e.g. 10% off, up to £100) is shown before preparing it. A super admin confirms the policy once. |
| S14 | Track until yes/no → Accounts invoice → settled → booking confirmed → complete | ✅ | Yes route works end to end, and "The guest said no" closes the offer. |
| S15 | OTA logins database | 🟡 | Staff with the OTA logins tool now see them under "Access and logins". Still one logins box per property, admin-edited. |
| S16 | Maintenance ticket: choose property, link a reservation, choose repair type | ✅ | Repair type (heating, hot water, leak, toilet, electrics, appliance, Wi-Fi, locks, pests, damage, other), urgent flag, and the guest's stay can be linked. |
| S17 | Repair type → AI troubleshooting steps before passing on | 🟡 | Each repair type has a guided checklist of safe checks to go through with the guest, ticked off and sent with the referral. No AI yet (needs an AI key). |
| S18 | Refer (urgently) to Ready; ticket stays visible to Stays to chase | ✅ | "Urgent" can be set when reporting or referring; Stays keep seeing the repair to chase it. |
| S19 | Ready books the repair → Stays told so they can tell the guest | ✅ | Ready on the property is notified when a repair is referred (admins if no Ready is assigned); the Stays person who referred it, and Stays on the property, are notified when it is booked and when it is done. |
| S20 | Expensive work goes to the client for approval first | ✅ | Uses the estimate given when reporting; a later quote needs a new request. |
| S21 | Cleaner's end-of-clean report (broadband etc., photos) | ⏸ | Built; needs Cloudinary for photos before it can be submitted. |
| S22 | Guest happy → clean complete → added to the cleaner's invoice | ⏸ | Accepted cleans are grouped by cleaner in Accounts, so several go on one invoice. Waiting on clean photos (S21) before cleans can be accepted. |
| S23 | Guest unhappy → management review ticket; cleaner not paid | ⏸ | Built; depends on S21. |
| S24 | Two or more complaints → warning / replace section; management decides | ⏸ | "Remove from the rota" now takes the cleaner off every property and frees their open cleans for reassignment. Complaints need submitted cleans, which wait on photos (S21). |
| S25 | Purchase request with what's needed and why | ✅ | |
| S26 | Accounts check against a budget chart and place the order | ✅ | Accounts are told about each purchase request, approve it against the budget chart (the most each item should cost, kept by Accounts), and record the order. |
| S27 | Ready proves the items arrived before Accounts close it | ⏸ | Ready's delivery ticket offers "Record delivery" and closes itself; Accounts reconcile against the paid invoice. Delivery photos need Cloudinary. |

## Can be built now, no keys needed

- C5/C6: departments and fixed shift windows per person.
- D4, D5, D7, D8: stage pipeline, per-client view, Scottish region list and map, portfolio stats. (D1 and D3 done.)
- O5, O9, O10, O17, O24, O25: explainer and FAQ, questions, repair contacts on repair screens, inspection checklist, auto-assignment.
- Bug fixes: done (OTA logins panel, client invoices, inspection ticket steps, Ready's purchase delivery ticket).

## Waiting on an outside service

- Channel manager (Uplisting or similar): C1, C3, C8–C10, D9, S1, S7, S12.
- AI key: C2, C14, S17.
- Meta WhatsApp: C11, O4.
- Google Workspace / Microsoft 365: C12, C13.
- Resend (email): O4, O26, S10.
- Phone push (Expo, plus an app release): O4, O25.
- Cloudinary (photos): O13, O20, S21–S24, S27 (the rest of those flows is built).
- Events data provider: S9.
- Xero: O21 sending.
