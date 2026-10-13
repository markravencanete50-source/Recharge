# Session C notes: team and people (13 and 14 October 2026)

Branch `claude/determined-cori-5jpfoj`, started from `main` at `f17c4bf`. Nothing here is deployed and the
migration is **not applied**. These notes are for whoever merges the three sessions and updates
`DEVELOPER-HANDOVER.md` (this session was told not to edit it).

## 1. Team calendar: anyone on the team edits, and every entry shows who last edited it

**Decision (Lee, 13 October 2026):** cleaners count as "anyone". Every team role (stays, ready, accounts, cleaners,
the cleaning manager, admins and super admins) can add, change and cancel **any** entry on the team calendar, for
anyone on the team, for **every kind** (absence, meeting, away, training, other). Owners never read or edit any of it.

**Migration `20261014300000_team_calendar_anyone_edits.sql`** (new, not applied):
- `private.workspace_team_events_anyone_edits()` returns `true`: the one switch. Returning `false` goes back to
  "your own; admins anyone's" without another code change. Mirrored by `TEAM_EVENTS_ANYONE_EDITS` in
  `lib/feedback-defaults.ts` (added at the end of the A9 section; the older A9 comment saying "admins can change
  anyone's" is superseded by the new lines under it).
- New column `private.workspace_team_events.updated_by` (references `workspace_profiles`, indexed). Existing rows are
  filled with `coalesce(cancelled_by, created_by)`. Every save and cancel now sets `updated_by` and `updated_at`.
- `private.workspace_team_events_read` and `private.workspace_team_events_action` are replaced whole (only
  `20261012210000` defined them and nothing patches them). The routes in `workspace_teams_read` and
  `workspace_teams_action` are unchanged, so no anchors were touched.
- The read adds `editedById`, `editedBy` (name), `editedAt` and `added` (true while nobody has changed it since it was
  added) to each event, and `canEditAll` is now true for every team role.
- Editing someone else's entry is refused once that person is no longer on the team ("This person is no longer on the
  team"); such entries are not on the calendar anyway.
- The person an entry is for is still told when someone else adds, changes or cancels it (`team.event_set`,
  `team.event_cancelled`, copy already in `lib/notice-copy.ts`). These activity rows carry no work or property, so the
  `activity_scoped` policy already keeps them from owners; nothing to hide, and the policy was not changed.
- Account deletion: `updated_by` is one more reference to a profile. `workspace_delete_own_account` scans every foreign
  key generically, so a person who edited someone else's entry is closed as "Deleted user" rather than removed, exactly
  as `created_by` already did. The privacy export was not changed.

**App:**
- `lib/calendar-live.ts`: the `teamEventsSchema` accepts the four new fields (all optional, so an older database still
  parses), and `eventEdited(event, myId)` gives "Added by you on Tue 13 Oct at 14:05" or "Last changed by Sam Reid on
  ..." in UK time.
- `mobile/src/TeamEvents.tsx`: the event sheet shows an "Added" or "Last changed" line (who and when). The "Who is it
  for?" picker already appears whenever `canEditAll` is true, so it now shows for everyone. With an older database
  (`canEditAll` false for non-admins) the sheet stays read only as before. The list rows do not show the editor, to keep
  them short; it is in the sheet.
- `mobile/src/LiveCalendar.tsx` needed no change: it passes `canEditAll` from the read and the people from the rota
  read, which every team role can read.

**Tests:** `tests/team-calendar-edits-database.test.mjs` (new): runs twice without change, backfills older rows, every
role including cleaners adds, changes and cancels anyone's, the person is told, owners are refused everything, stale
versions are refused, a person who left cannot be edited, the functions stay private.
`tests/team-calendar-database.test.mjs` now leaves this migration out, because it proves the original migration on its
own (its "nobody but admins" test describes the old rule). `tests/team-calendar.test.mjs` gained a test for
`eventEdited` and the sheet.

## 2. Bonus as a progress bar towards the target

**What it does:** "My performance" (the Home card and the My performance page, both `mobile/src/MyPerformance.tsx`)
now shows the bonus as a bar from 0 to 100% with the target and each tier marked, a check per mark reached, a headline
("6% to go to the target", "Target reached", "Bonus tier 1 reached", "Bonus tier 2 reached", "Nothing to measure
yet") and what comes next. No pound amounts anywhere.

**Placeholder schemes** (`BONUS_SCHEMES` at the end of the A3 section of `lib/feedback-defaults.ts`), all marked
`placeholder: true`, which the card shows as a "Placeholder" tag and the line "These targets and tiers are
placeholders until the bonus scheme for (area) is agreed":

| Area | Measure | Target | Tier 1 | Tier 2 |
| --- | --- | --- | --- | --- |
| Guest relations | Guest messages answered within 5 minutes (`percentGreen`) | 80% | 90% | 95% |
| Client relations | Daily work done against its targets (`workPercent`) | 80% | 90% | 95% |
| Cleaning | Performance score (`score`) | 80% | 90% | 95% |
| Ready | Performance score | 80% | 90% | 95% |
| Accounts | Performance score | 80% | 90% | 95% |
| Management | Performance score | 80% | 90% | 95% |

Guest relations is the client's own example. The rest copy its numbers until the client sends theirs. A person's
area is their rota department, else their role (`BONUS_AREA_BY_ROLE`). The "5 minutes" in the label comes from the
Team performance targets (`greenMinutes`). Logic: `bonusArea` and `bonusProgress` in `lib/my-performance.ts`; tests in
`tests/my-performance.test.mjs`.

**Questions for the client:**
- The real target and tiers for each area, and what each area is measured on. Cleaners and Ready usually have no
  `score` today (it blends guest replies and daily work on guest or client relations shifts), so their bar says
  "Nothing to measure yet". A cleaning measure such as "clean forms submitted on time" needs a new database read.
- **Conflict to settle:** admins still set the score's pass mark and bonus tiers in Team performance → Change the
  targets (`workspace_performance_targets`, live values pass 80%, tiers 80/90/95). That counts 80% as a bonus tier,
  whereas the client's example makes 80% the target and only 90% and 95% tiers. The admin Team performance list and
  `LiveShifts.tsx` still show the database tier ("Bonus tier 90%"). Once the schemes are agreed, either set the
  database tiers to 90 and 95, or move the schemes into the database per department and read them in both places.
  Until then the person's card follows the placeholder scheme and the admin list follows the database.
- `bonusFor` and `standingLine` in `lib/my-performance.ts` are kept (and tested) but the card no longer uses them.

## 3. Guest messaging: not for landlords, cleaners or maintenance (client answer 12)

**Before:** the guest inbox database refused `client` and `cleans` only. `ready` (maintenance) could list, open, log, reply,
send through Hostaway, close and edit guest conversations, and read saved replies, as soon as an admin gave them the guest
communication tool (Access control allows it; `has_workspace_module` only limits cleaners). The app hid the Guests tab from
`client` and `cleans` only (`hasGuestInbox`).

**Migration `20261014310000_guest_messaging_roles.sql`** (not applied):
- `private.workspace_guest_messaging_role(role)`: false for `client`, `cleans` and `ready`. The one switch.
- `private.guest_inbox_can` and `private.saved_replies_can_read` replaced whole (each defined once, nothing patches them).
- `workspace_guest_inbox_read` and `workspace_guest_inbox_action` keep their gate and gain a second one after it, by anchor and
  append. This also closes `logMessage` without a conversation or property, which never consulted `guest_inbox_can`.
- Everyone else (admins, Stays, Accounts, the cleaning manager) keeps what they had: the tool and the property still decide.

**App:** `hasGuestInbox` in `lib/workspace-chat-policy.ts` uses `GUEST_MESSAGING_BLOCKED_ROLES` (`client`, `cleans`,
`ready`). It drives the Guests tab in `LiveChat.tsx`, the waiting badge (`useGuestWaiting`) and the "guests waiting" to-do.

**Tests:** `tests/guest-messaging-roles-database.test.mjs` (every role given every tool; the three are refused every read and
action and saved replies, nothing is written; the others keep access). `tests/calendar-inbox.test.mjs` checks `hasGuestInbox`.

**Left alone, for the merge or the client:**
- `mobile/src/LiveStays.tsx` (retired, unrouted) still shows the inbox to anyone holding the tool; the database now refuses
  `ready` there too. Delete the file in the planned clean-up.
- Access control still lets an admin tick the guest communication tool for Ready. It now does nothing for them; hiding the box
  is a change in `lib/admin-live.ts` (`toolsFor`), outside this session's files.
- Ready still sees **guest names** on calendar stays (`workspace_guest_name_visible`: admin, stays, ready, accounts). That is a
  name, not messaging, but it comes from guest conversations. Ask the client whether maintenance should see it.
- The cleaning manager keeps guest messaging if given the tool. The answer named "cleaners"; confirm whether that includes the
  cleaning manager. It would be one word in `workspace_guest_messaging_role` and `GUEST_MESSAGING_BLOCKED_ROLES`.
- The old property threads (`workspace_threads`, owner mailbox) are not guest messaging and were not changed.

## 4. Message notifications (client answer 12)

**How chat notices work today.** Sending a message (`workspace_chat_action`, `send`) adds one activity row, `chat.message` or
`chat.owner_message` (an owner writing), and a notice in `workspace_notification_outbox` for each person in
`private.chat_audience` except the sender and anyone who blocked them. Email and push are created from the notice by
`integration_claim_notifications` (no role filter, only notices under 24 hours old). The audience is:
- direct and group chats, and property or job chats: the members (job chats add the property's Stays and Ready, the cleaning
  manager, the job's assignee and whoever opened it);
- an owner's conversation: the owner (a member) and the team that answers owners (`chat_owner_team`: admins, people whose rota
  department is client relations or management, and Stays on that owner's properties);
- a team channel: everyone in the department (`chat_in_channel`, by rota department, or by role when there is no rota), but
  admins only in Management and Everyone.
A person was told only if they had read the conversation since the message before, so one notice per conversation until read.
A **guest message** (Hostaway import or logged by hand) creates no activity row and tells nobody; the team sees it only through
the Guests badge and the "guests waiting" to-do.

**Against the client's words** (with the lead developer's reading, relayed 13 October: being a member of a chat means you are
told about it; an admin who is not a member is not told unless the message belongs to their department):
- "any chat I'm in" and "any chat a cleaner is in": members are told, cleaners included. **Gap (everyone):** someone who had
  never opened a conversation (a new starter, a person moved into a department or added to a group) was told about the first
  message only and never again, because a missing read counted as "not read since the last message". **Built.**
- "same for landlords": owners are members of their own conversation and are told. Nothing to change.
- "related to that person's department": the team channels already tell their department; admins hear only Management and
  Everyone. Guest messages tell nobody: see proposal 1.
- I first also told admins about a department channel once they had written in it (it shows as theirs under the Mine chip). That
  was taken out after the lead's reading above; admins keep today's behaviour.

**Migration `20261014320000_chat_notices.sql`** (not applied):
- Who is in the audience (`chat_audience`) is unchanged.
- New table `private.chat_notified(conversation_id, user_id, notified_at)` and `private.chat_notice_due(conversation, person)`:
  due when never told, or told before they last read it. The send branch keeps its old notice and then, by anchor and append,
  tells everyone due and records the time. One notice per conversation until it is opened, now including people who never
  opened it. Blocks and the sender are excluded as before.
- First run after deploy: anyone with unread messages in a conversation and no record yet gets one notice the next time a
  message arrives there (at most one per conversation each).
- The workflow notice routes (`workspace_notice_routes`, admins getting every routed notice) are not touched.
- Test: `tests/chat-notices-database.test.mjs`.

**Proposals, not built (outside chat and notification code, or a decision for Lee and the client):**
1. **Guest messages notify nobody.** A new guest message from Hostaway (or one logged by hand) adds no activity row and no
   notice; the team sees it only through the Guests badge and the "guests waiting" to-do, which the app reads once a minute. The
   lead's spec: a guest message notifies the Guest relations department, meaning the people on that department's rota today, or
   the Stays role when nobody is on the rota. Proposal: in the Hostaway import (`workspace_hostaway_messages_ingest`, not this
   session's file) and in `logMessage`, once per conversation when it starts waiting, add a `guest.message` activity row (with the
   property, so `activity_scoped` already hides it from anyone who cannot see the property) and notices for those people, filtered
   by `workspace_guest_messaging_role`, the guest communication tool and the property. It could reuse `workspace_notice_routes`
   (a row `guest.message` / `stays`), but that trigger also notifies every admin, which is the open question about routes, so a
   dedicated recipient rule is safer. Open: whether out-of-hours guest messages should push at night.
2. **Client chats "members only".** The lead's spec says team and client chat messages notify only the chat's members. Today an
   owner's message tells the owner team: every admin, people on the client relations or management rota, and Stays assigned to
   that owner's properties. None of them are members (owner conversations have only the owner as a member). Strictly "members
   only" would tell nobody on the team about an owner's message, so it has to be read as "the client relations department", which
   is roughly today's rule. Not changed; Lee to confirm whether admins should keep hearing every owner message.
3. **Stays without a rota and owner messages.** A Stays person with no rota counts as client relations for the team channel but
   hears an owner only for the properties they are assigned to. `chat_owner_team` also decides who may read owner conversations,
   so widening it is a privacy decision, not a notice change.
4. **Per message or per conversation.** The client wrote "a notification for any message". It is one notice per conversation
   until it is opened, so a busy channel does not push every line. Confirm that is wanted.

## 5. Calendar: an enquiry could name a direct stay (handover bug)

The name is chosen in SQL (`private.workspace_stay_guest_name`); `lib/calendar-live.ts` only shows it. The fallback matched a
conversation on the same property and dates when none carried the stay's code. Only the Hostaway import gives a conversation
dates (one logged by hand has none), and it gives the booking code whenever the reservation is one of our stays. So every
conversation matched by dates alone was a Hostaway conversation whose reservation is not ours: an enquiry, or a request that did
not go ahead. The data cannot tell it apart from the booked guest's, so **migration `20261014330000_stay_guest_name_dates.sql`
removes the date match**: a stay is named only by a conversation carrying one of its codes. A stay entered by hand is named once
its conversation is matched to it in the guest inbox (Edit, booking reference: the stay's reference); otherwise it shows "Guest
stay". The index `workspace_guest_threads_dates_idx` is now unused; drop it in a later clean-up if nothing else needs it.
Test: `tests/stay-guest-name-database.test.mjs`. `tests/team-calendar-database.test.mjs` now leaves this migration out too, as it
proves the original migration (with its date match) on its own.

## 6. Inbound email into Messages: design note (not built; Lee: "we will integrate this later")

Mailboxes (hosted at Fasthosts): `guestrelations@rechargegroup.co.uk` for guests, feeding the Guests side of Messages (Guest
relations), and `ownerrelations@rechargegroup.co.uk` for clients and owners, feeding the Clients side (Client relations).

| | (a) Fasthosts forwards a copy to an inbound address on our side | (b) A Worker cron polls the Fasthosts mailboxes over IMAP |
| --- | --- | --- |
| Set-up | A forwarding rule on each Fasthosts mailbox (keep a copy) to an address on a subdomain we control, e.g. `in.rechargegroup.co.uk`, handled by Cloudflare Email Routing to the Worker's `email()` handler, or by Resend inbound, which posts a signed webhook. | An IMAP login per mailbox; the Worker connects over TCP (`connect()`), reads new messages by UID and remembers the last UID. |
| Credentials | Email Routing: none beyond the Cloudflare account. Resend: the webhook signing secret as a Worker secret. | Each mailbox password (ideally an app password) as a Worker secret. |
| Speed | Seconds. | Each cron tick (every minute at best); IMAP from a Worker has to be hand-built and is more fragile. |
| Replies out | Both: from the app through a sending service (Resend, or Fasthosts SMTP) as the mailbox address, with `In-Reply-To` and `References` set so the guest's mail app threads it. Needs SPF and DKIM for the sender on rechargegroup.co.uk. | Same. |
| Spam | Cloudflare and Resend both pass on SPF, DKIM and DMARC results; drop failures and anything Fasthosts already marked as spam. | We would see whatever reaches the inbox, spam included, unless we read only the inbox folder. |
| Attachments | Parsed in the Worker (or by Resend) and stored in a private bucket like `chat-files`, size and type checked from the bytes, opened by short signed links only by people who can read the conversation. | Same, but fetched over IMAP. |

**Recommendation: (a) with Cloudflare Email Routing to the Worker.** It needs no stored mailbox password, it is near instant, it
runs where the backend already runs, and the Fasthosts mailboxes stay the record (forwarding keeps a copy).

**Matching a thread:** guests: first the `In-Reply-To` and `References` headers against messages we sent; then a booking code in
the subject or body against `workspace_stay_codes`; then the sender's address against an earlier conversation; otherwise a new
unmatched email conversation (`channel 'email'`, property empty, shared with everyone allowed the guest inbox), which staff match
with Edit. Owners: the sender's address against the owner's sign-in email or contact on file; otherwise it waits in an "unknown
sender" list for Client relations to assign. Never match on the display name.

**Storage and privacy:** guest email goes in the guest inbox tables (a new source such as `email`), so the rules in section 3 apply:
owners, cleaners and Ready never see it, in the database as well as the screens. Owner email goes into that owner's conversation.
Keep the message text and the attachments, not the raw MIME. Retention follows the guest inbox. Email addresses are personal
data: show them only to people who can read the conversation, and include them in "Download my data" for owners.

**What Lee sets up (later, not now; do not change DNS yet):** in Cloudflare, Email Routing on a subdomain such as
`in.rechargegroup.co.uk` (Cloudflare adds its MX and SPF records for that subdomain only, so the Fasthosts MX for the main domain
stays as it is) and a route to the Worker; at Fasthosts, a forwarding rule on each of the two mailboxes to its inbound address,
keeping a copy; for replies, a sending service with SPF and DKIM records for rechargegroup.co.uk added at whoever hosts the DNS.

## Not done yet (waiting for the client)

- Inbound email into Messages (design above; to be built later).
- The decisions listed under 3 and 4 above.

## Files changed (second round, 14 October)

Migrations `20261014310000_guest_messaging_roles.sql`, `20261014320000_chat_notices.sql`,
`20261014330000_stay_guest_name_dates.sql` (all new), `lib/workspace-chat-policy.ts`, `lib/calendar-live.ts` (a comment), tests
`guest-messaging-roles-database`, `chat-notices-database`, `stay-guest-name-database` (new), `calendar-inbox`,
`team-calendar-database` (leaves `…330000` out too), and this file. `LiveChat.tsx` needed no change: its Guests tab, badge and
the to-do already follow `hasGuestInbox`. The bonus tier conflict in section 2 is left to the lead developer, as asked.

## Files changed (first round)

`supabase/migrations/20261014300000_team_calendar_anyone_edits.sql` (new), `lib/calendar-live.ts`,
`mobile/src/TeamEvents.tsx`, `lib/my-performance.ts`, `mobile/src/MyPerformance.tsx`, `lib/feedback-defaults.ts`
(added at the end of the A9 and A3 sections only), tests `team-calendar-edits-database` (new), `team-calendar-database`,
`team-calendar`, `my-performance`, and this file. `mobile/src/LiveShifts.tsx` (and the department line in `ShiftCard`)
was not touched. `LiveHome.tsx` needed no change: the Home tile is the same `MyPerformance` card.

## Checks run (second round, 14 October)

- TypeScript: `npx tsc --noEmit -p mobile/tsconfig.json` clean; root clean except `landing/` (missing `remotion`).
- ESLint on every changed file: clean.
- New database tests pass: `guest-messaging-roles-database` (4), `chat-notices-database` (5), `stay-guest-name-database` (3).
- Full `node --test tests/*.test.mjs` (no build first): 13 failures, the **same 13 that fail on `main`** (checked on a clean
  checkout of `main`): the CRLF and em dash checks, and the tests that need build output (`backend-deployment`,
  `preview-security`, `rendered-html`, `wiring-v2`, the `privacy-phase2` anchor test's CRLF assertion). Nothing new fails.

## Checks run (first round)

- `npm ci` (root and `mobile/`).
- TypeScript: `mobile/` clean; root clean except `landing/` (cannot find `remotion`; unrelated to this work).
- ESLint on every changed file: clean.
- `node --test`: `team-calendar-edits-database`, `team-calendar-database`, `team-calendar`, `my-performance`,
  `feedback-contracts`, `privacy-phase2-database`, `wiring-fixes-v2`, `team-performance-database` all pass apart from
  two checks that **also fail on `main`**: "no em dashes, and the TypeScript files keep their CRLF line endings"
  (`team-calendar.test.mjs`) and the CRLF assertion in `privacy-phase2-database.test.mjs`. The files in the repository
  are LF, so those checks expect line endings the checkout does not have.
- Not run: the full `npm test` (it builds the app first) and anything against a live service. The new bar and the
  "Last changed" line were not screenshotted; check them with real staff accounts after the migration is applied.

## Deploy order

Apply in filename order after the round 3 migrations: `20261014300000_team_calendar_anyone_edits.sql`,
`20261014310000_guest_messaging_roles.sql`, `20261014320000_chat_notices.sql`, `20261014330000_stay_guest_name_dates.sql`, then
redeploy. The app works before and after each of them. Warn the team before `…320000`: people with unread conversations get one
notice per conversation the next time someone writes there.
