# Client feedback, 6 October 2026

Four walkthrough videos of the phone version: client view, Stays and admin team view, Cleans view and
Ready view. This note records what is now in the preview (sample data, nothing is saved or sent) and
what each flow still needs from the live backend.

## In the preview now

### Everyone
- Loading screen with a seamless logo, then a time-of-day greeting card.
- Dark mode reverses the top bar to bone with forest lettering; light mode keeps the forest bar.
- A Training centre (Home, Tools) with courses by team and progress. Admins see an upload area.

### Clients
- Home: properties, items to approve, new messages, earnings this month; onboarding progress per
  property with the next step; a "Start a new enquiry" card and form.
- Navigation: Home, Properties, Inbox (raised centre), Approvals, Reports. Tools from Home.
- Reports: earnings, occupancy, average nightly rate, a 14-day multi-property booking calendar,
  guests staying now, upcoming bookings and earnings by property.

### Stays and admin team
- Home: Quick access to the four most used tools instead of task counts.
- Work: "Today's routine" (daily pricing, listing health, maintenance, cleans, AirCover, direct
  bookings; weekly performance on Mondays), "Cleans to approve" with approve or reject-with-reason,
  and the list split into "Due today or overdue" and "Ongoing".
- Calendar: filter the schedule by team (Stays, Ready, Cleans).
- Inbox: channels for Guests, Clients, Team, WhatsApp and Email with unread counts. Guest
  conversations show a suggested reply that can be used and edited before sending.
- Properties: an onboarding pipeline showing each enquiry's stage and next action.

### Cleans
- Home: Quick access and "Your performance" (approved, rejected, amount on the invoice).
- Jobs: tapping a clean opens the completion form: room checklist, Wi-Fi and broadband confirmed,
  photos or a walkthrough video, and maintenance issues. Submitting shows what happens next.
- Inbox: property conversations with the Stays and Ready teams.

### Cleaning managers and admins
- Cleaner performance with approved and rejected counts and warning status.

### Ready
- Home: repairs in progress by stage, from the Stays report to payment by Accounts, and routine
  maintenance visits per assigned property this month.

## Still needed from the live backend

| Flow | What it needs |
|---|---|
| Guest messages | Hostaway conversations API and webhooks into the inbox; replies sent back through Hostaway |
| Suggested replies | A model call grounded in the property details and Recharge's guest workflows; staff always review before sending |
| WhatsApp | WhatsApp Business Platform account and number for the team WhatsApp |
| Email | A shared inbox connection (Google Workspace or Microsoft 365) per team |
| Clean approval and pay | Persist clean submissions and media (Cloudinary), the Stays approval decision, adding approved cleans to the cleaner's invoice, notifications for approve and reject |
| Contested cleans | A management review state with the decision to include or exclude from the invoice |
| Cleaner warnings | Count rejected cleans per month; two rejections opens a warning and a management chat |
| Booking guest counts | Hostaway reservations (guest numbers, check-in and out) shown on each clean |
| Repairs | Stays report, Ready visit booking, quote, landlord approval, scheduling on the shared calendar, completion report, Accounts notification; most states exist in the database already |
| Routine maintenance | A monthly schedule per assigned property and reminders |
| Team calendar | Assignments per team member so the calendar can filter by person, not only by team |
| Training centre | Storage for uploaded documents and videos, and course progress per person |
| Notifications | Resend email and Expo push (keys pending), triggered at each hand-over |
| The client's cleaner form | Replace the sample checklist with the form the client will send |

## Ideas for approval flows

- **Spend thresholds.** Repairs or purchases under an agreed amount go straight ahead; above it they
  need landlord approval, and above a second limit management approval as well. Thresholds are set
  per client agreement.
- **Two-step approvals with a deadline.** If a landlord has not responded within 48 hours, remind
  them, then escalate to the account manager rather than letting work stall.
- **Clean disputes.** A rejected clean goes to a cleaning manager, who confirms or overturns it with
  photo evidence. The cleaner sees the outcome and the reason.
- **Daily routine sign-off.** At the end of the day, unfinished routine reports roll over and appear
  for the team lead, so nothing silently slips.
- **Audit trail.** Every approval records who decided, when, and on what evidence, viewable on the
  property and in reports.
