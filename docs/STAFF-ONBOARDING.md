# Staff onboarding (8 October 2026)

Recharge onboards its team afresh. Before a new team member (Stays, cleaner, cleaning manager,
Ready or Accounts) can use any tool, they:

1. **Sign the staff contract for their role.** They read the full wording in the app, type their
   full name and tick "I have read this contract and agree to it". Their typed name, the date and
   the exact wording they signed are kept on record.
2. **Complete the required training** for their role: every published course marked
   "Required before they start".

Until both are done they see only a "Let's get you started" checklist and the sign-out button.
The database enforces this (every tool check requires a finished onboarding), so it cannot be
skipped from another screen. Admins and owners are never gated.

## For admins: Work → Management → Onboarding & training

- **Staff contracts → New contract.** Give it a title, choose who signs it (every team member, or
  specific roles such as Cleaners) and paste the full wording. Nothing is gated until a contract is
  saved "In use" or a course is marked required.
- **Editing a contract** keeps every earlier wording with its signatures. A small fix doesn't need
  new signatures; tick "Ask everyone who signed to sign this new wording again" for a real change,
  and their tools close until they sign the new wording.
- **Switching a contract off** ("In use" unticked) stops asking for it.
- **Courses:** tick "Required before they start" on any published course.
- **Team onboarding** shows each active team member's progress (for example
  "Contract 0/1 · Training 1/2"). Open a contract to see who signed, when, and which wording.

## Suggested order for a new hire

1. They sign up in the app; you approve them in People and choose their tools and properties.
2. They sign in and complete the checklist; their tools open the moment the last step is done.

# Shifts and team performance (8 October 2026)

- **Clocking in and out:** every team member has a shift card at the top of Home. They choose
  their department (guest relations, client relations, cleaning, Ready, Accounts or management)
  and tap Clock in; Clock out when they finish. Early shift is 08:00-15:00/16:00, late 15:00-23:00.
- **Guest reply times:** each guest message that is waiting for a reply is timed until the team
  replies. Green within 5 minutes, amber within 10, red after that. It counts for whoever was
  clocked in to guest relations when it arrived. 90% green is on track; 95% and 100% unlock the
  bonus tiers. Admins change these under Work → Management → Team performance → Change the targets.
- **Team performance** (admins) shows who is on shift now (tap someone to end a shift they forgot
  to clock out of) and, for today, 7 or 30 days: each person's green/amber/red replies, on or off
  track, bonus tier, hours worked, listing checks and pricing decisions. Team members see their
  own figures on their shift card.
- Guest messages arrive once the new channel manager is connected; until then reply times read
  "No guest messages yet". The backend stores them through `workspace_guest_messages_ingest`.
