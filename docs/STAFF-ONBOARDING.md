# Staff onboarding (updated 9 October 2026)

Before a new team member (Stays, cleaner, cleaning manager, Ready or Accounts) can use any tool,
they sign the contract for their role and finish the required training. Admins, super admins and
owners never go through it. The database enforces it, so it can't be skipped from another screen.

## How it works, start to finish

1. **Write the contracts** (Work → Management → Onboarding & training → Staff contracts → New
   contract). Choose who signs it: every team member, or specific roles. Only contracts marked
   "In use" are asked for.
2. **Choose the training** (same page, Training). Publish courses and tick "Required before they
   start" on the ones new people must finish. Each course can have text, a video link and up to 10
   files: PDFs, Word documents, pictures and short videos (up to 25 MB each; longer videos as a
   YouTube, Vimeo or Loom link).
3. **Add the person** (Access control → Add a person), or approve someone who signed up. The sheet
   says what their role will be asked to sign and complete.
4. **They complete it.** When they sign in they see only "Let's get you started": read and sign
   the contract (typed name and a tick), then open each course and mark it complete. The moment the
   last step is done they see "You're all set" and their tools open. Admins are notified.

## What the admin page shows

- **How staff onboarding works**: the four steps above.
- **What each role is asked for**: each role's contracts and required courses, with "Not set up"
  where a role has nothing (its people go straight to their tools). Tap a role to preview exactly
  what a new person in it sees.
- **Staff contracts**: who has signed the current wording and who still has to.
- **Team onboarding**: "Still to finish", "Done" or everyone. Tap a person to see each contract
  (signed, which version, when) and each course (required and optional, done or not), and when they
  finished onboarding.
- **Training**: open a course to edit it, add or remove files, and see who has done it.

## When things change

- **New wording**: tick "Ask everyone who signed to sign this new wording again". Their tools
  close until they sign it, and they are notified.
- **Course changes**: tick "Ask everyone who completed it to do it again" to clear completions.
  For a required course, their tools close until they redo it.
- **A new contract or newly required course** closes the tools of people it now applies to, and
  tells them.
- **Changing someone's role** asks for the new role's contract and courses. Contracts for every
  team member carry over. Promoting someone to admin removes the checklist.

## For team members

- Their signed contracts are in Help → Your contracts, with the exact wording they signed.
- Training (required and optional) is in Help → Training, with the course files.

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
