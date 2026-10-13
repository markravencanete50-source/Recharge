# Go-live note: rounds 6, 7 and 8

For Lee's team. What changes for each role, and what to check as each role once it is live. The install steps are the
lead developer's and are not in this note. Drafted by Session C from every session's notes (`docs/notes-session-A.md` to
`-E.md`), Session F's `docs/EMAIL.md` and the merged lead branch. Rounds 6, 7 and 8 ship together.

## Tell the team

### Everyone on the team

- **Updates (the bell at the top)** say what each one is about. Each update starts with the type of work and its title,
  for example "Repair: Boiler not working" or "Pricing: 3 empty nights to price". The line under it shows the property
  and who did it. Updates the system makes on its own say "Automatic".
  - Several automatic updates of the same kind within a minute are one line, for example "Pricing: 12 new tasks". Tap it
    to see each one.
  - Tap an update to open its task, even an older one. Message updates open Messages.
  - The newest 50 show first. "Show older updates" at the end loads 50 more each time.
- **Favorites** is always in the first section of the menu, straight after Home, for every role. Changing the menu order
  cannot move it out of that section.
- **Fewer buttons.** Rows of more than five choices are now one dropdown, and a list of more than ten has a search box at
  the top. This covers tabs (for example the Management sections), filters and form fields such as the area of a new
  property or the type of a repair. Properties, people and stays are always picked with a search.
- **The To-do page:**
  - On a computer each to-do is one thin row: property, task, latest update, who updated it, when, due date and status.
    On a phone each is a two-line card.
  - Click or tap a to-do to open it. Inside you can add an update, mark it done or reopen it, and see every update with
    who wrote it and when. Ticking a to-do logs "Marked done"; unticking logs "Reopened".
  - The person a to-do is for, and the person who set it, get an update when someone adds one.
  - New to-do: "Who is it for" is a dropdown (Me, A person, A department), and the due date opens a calendar.
  - Each heading shows 10 rows; "Show all" opens the rest.
- **Trackers** (purchases, licensing, onboarding, accounts and the others) use the same thin rows on a computer.
- **Dark mode** is easier to read: cards stand out from the page, and chosen buttons and tabs are clearly marked, including
  the department strip and the Work tabs on a phone. The banners at the top of pages follow the theme too.
- **On a phone:**
  - The Favorites star no longer floats over the page and covers rows. Favorites is on the bottom bar or first in the Menu.
  - The logo is never covered. Menu, the bell, Messages and your picture always show in the header; when there is not
    room, Search, View as, Refresh and the dark-mode switch move to the top of the Menu.
- **The "New property enquiry" card** is a plain card with one Add button, instead of a bright block (owners see "Have
  another property?").
- **Help** no longer floats over the page. On a computer it is a button in the header, beside the theme switch. On a phone
  it is "Help and FAQs" at the end of the Menu.
- **Help answers** cover all of the above, and more for each role.
- Pop-up sheets (for example "Rejected clean") no longer have their contents squashed together.

### Admins and super admins

- **Management centre:**
  - The sections are one dropdown instead of a row of tabs that ran off the screen.
  - **Today's checklist** sits at the top. It lists today's to-dos from the Management daily tasks, with a tick box each
    and "3 of 5 done". A ticked item shows who ticked it and when. It is the same to-do as on the To-do page, so ticking
    either one ticks both.
  - With no daily tasks yet, it says "No daily checklist yet", with a "Set up the checklist" link that opens Daily tasks
    for Management.
- **Client enquiries:** an admin can delete an enquiry with "Delete enquiry" in its detail. It asks first, then removes the
  enquiry, its answers and photos, and the property it created; it cannot be undone. The button shows only while the
  enquiry is still at the enquiry stage or was closed; once it has moved on (an estimate, an owner, a signature, money
  or other work), close it instead.
- **The management bonus:**
  - For people in management, the bonus bar on My performance now combines two teams over the same period. Guest
    relations: guest messages answered within five minutes. Client relations: daily work done against its targets.
  - Half and half by default, rounded down. If one team has nothing to measure, the other counts alone.
  - **Admins set the split:** in Team performance, under KPIs, open the combined KPI and set "Guest relations share %"
    (0 to 100; Client relations gets the rest). The change is recorded in the KPI history.
  - Under the bar: each team's figure and its share, for example "Guest relations 86% (60%) · Client relations 74% (40%)".
  - It is the management bonus KPI in Team performance, under KPIs, now named "Guest relations and Client relations,
    combined". It is still a placeholder at an 80% target with tiers at 90% and 95% until Alex sets his own there.
- **Messages:** the status "Waiting for reply" is now **"Engaged"**: we wrote last and the conversation is still open. Needs
  a reply and Closed are unchanged.
- **Properties page:** search only. The region and status buttons are gone; type a town, street, postcode or "onboarding"
  in the search box.
- **Access control:** the role is a dropdown, with the chosen role's summary under it. **View as:** pick the person with a
  search ("Name · Role"); role previews are one dropdown.

### Email (Guest relations and Client relations)

Once email is switched on, guest and owner emails come into Messages, and replies go out by email. The mailboxes at Fasthosts
keep a copy of everything, as now.
- **Guests:** an email to guestrelations@rechargegroup.co.uk appears in **Messages, Guests**, within seconds. It joins the
  conversation it replies to, or the stay whose booking code it mentions, or that sender's earlier emails; otherwise it is a
  new conversation with no property yet (match it with Guest details). Press Send in an email conversation and the reply
  goes out by email from guestrelations@. The guest's answer threads back into the same conversation.
- **Owners:** an email to ownerrelations@rechargegroup.co.uk from an owner's sign-in address appears in that owner's
  conversation in **Messages, Clients**. When the owner's latest message came by email, the team's reply is emailed to them
  from ownerrelations@.
- **Unknown senders:** an email to ownerrelations@ from an address we don't know waits in **Messages, Clients, Unknown
  senders** (admins and Client relations). Assign it to an owner (the address is remembered) or dismiss it.
- **Attachments:** photos (JPEG, PNG, WebP, GIF) and PDFs up to 10 MB each open from the message. Spam and mail that fails
  its checks never appears.
- Owners, cleaners and Ready never see guest emails.

### Guest relations

- **Messages:** "Waiting for reply" is now **"Engaged"**, on the status buttons, on each conversation and at the top of an
  open one. The notes at the top of the guest list ("Hostaway isn't connected yet…", "5 guests have waited longer
  than…") now show in full on a phone.
- **Updates, To-do, Favorites and dropdowns** as for everyone. Reporting a repair: the type of repair is a dropdown with a
  search. Logging a guest review: a rating out of 10 is a dropdown.

### Client relations

- **Client relations** sub-pages are one dropdown when there are more than five.
- **Messages, Clients tab:** "Waiting for reply" is now **"Engaged"**.
- **Pricing on the To-do page:** each heading shows 10 rows, with "Show all" for the rest (all automatic pricing rows are
  still made).
- **Client enquiries → Start valuing:** the area is a dropdown with a search, and the property type a dropdown.

### Cleaning manager

- **Rejected clean** and other sheets are no longer squashed together.
- **Usual cleaners** for a property are picked with a search.
- Updates, To-do, Favorites (in Today) and dropdowns as for everyone.

### Cleaners

- **Favorites** is in My day, straight after Home.
- **Updates** say what each one is about, as for everyone.
- **Report a problem** on a clean: the kind of problem is a dropdown with a search.

### Ready

- **Reporting a repair:** the type of repair is a dropdown with a search.
- Updates, To-do, Favorites (in Today), trackers in thin rows and dropdowns as for everyone.

### Accounts

- **Accounts sections** (Expenses, Reconciliation, Statements, Receivable, Performance, AirCover) are one dropdown.
- **New expense:** "Received on" opens a calendar and the category is a dropdown. The cleaner invoice date opens a calendar
  too.
- **On a phone,** the summary tiles use short labels (Approve, Reconcile, Paid) on one plain background.
- **Reconciliation:** the Approve button on a platform stay has a visible edge in dark mode, and chosen filters are clearly
  marked.
- Favorites is in Overview, straight after Home.

### Owners

- **Favorites** now works for owners: a star on the screens they can open, and Favorites in Your properties, straight
  after Home. On a phone it is on the bottom bar or first in the Menu.
- **Updates** say what each one is about. Owners never see a team member's name: their own actions say "You", and
  everything else says "Recharge". Tapping an update opens the request it is about, if it is one of theirs.
- **Email:** an email to ownerrelations@ from their sign-in address shows in their Messages conversation. While their
  latest message is an email, the team's replies reach them by email too.
- **The New Property Enquiry Form** (the link owners receive): the options in each list are readable in dark mode, and
  the address fields no longer show a second box when typed in.

## Check as each role after go-live

Use View as (or a test account) for each role. Check on a computer and on a phone, and once in dark mode.

### Admin

1. **Home → the bell (Updates):** rows read "<type>: <title>", with the property and who did it (or "Automatic") under it.
   Tap a row: its task opens. Scroll to the end: "Show older updates" loads more, then stops.
2. **Menu:** Favorites is in Overview, straight after Home. In Menu order, Favorites cannot be moved to another section.
3. **Management centre:** the sections are one dropdown. "Today's checklist" is at the top. Tick an item, open the To-do
   page, and see it ticked there too; untick it in one place and it reopens in the other.
4. **Client enquiries:** open an enquiry that has not moved on: "Delete enquiry" shows and asks before deleting. Open one
   with an estimate: no Delete button. (Try a real delete only on the "Mark Raven Canete · Optimal" test enquiry.)
5. **Team performance → KPIs:** the Management bonus KPI is "Guest relations and Client relations, combined", marked
   placeholder, target 80, tiers 90 and 95. Open it: "Guest relations share %" shows 50. Set it to 60 and save; the KPI's
   history shows the change, and My performance shows the new shares.
6. **My performance** (as a person in management): the bonus bar says "Management · Guest relations and Client relations,
   combined", with "Guest relations …% (…%) · Client relations …% (…%)" under it.
7. **Messages → Guests and Clients:** the middle status reads "Engaged", with its count.
8. **Properties:** no region or status buttons; typing "onboarding" or a town narrows the table.
9. **To-do:** thin rows on a computer; open one, add an update, and see it at the top of its history with your name.
10. **Help:** in the header on a computer, at the end of the Menu on a phone. Search "Engaged", "checklist" or "bonus"
    and the new answers show.
11. **On a phone (390 px wide):** the logo is not covered; Menu, the bell, Messages and your picture are in the header, and
    Search, View as, Refresh and the dark-mode switch are at the top of the Menu. No Favorites star floats over the page.
    The "New property enquiry" card on Home is a plain card with one Add button.

### Guest relations

1. **Messages → Guests:** statuses read Needs a reply, Engaged, Closed. On a phone, the notes at the top wrap instead of
   ending in "…".
2. **Updates:** titles as above; tapping a guest message update opens Messages.
3. **Menu → Today:** Home, Favorites, To-do.
4. **Report a repair:** the type of repair is a dropdown with a search box.
5. **Guest relations** sub-pages are buttons (five or fewer).
6. **My performance:** their own bar as before (Replies within 5 minutes).
7. **Email:** send a test email to guestrelations@ from another account. It appears in Messages, Guests within seconds (and
   still arrives at Fasthosts). Press Send on a reply: the test account receives it from guestrelations@, and its answer
   comes back into the same conversation.

### Client relations

1. **Client relations:** the sub-pages are one dropdown.
2. **Messages → Clients:** Needs a reply, Engaged, Closed.
3. **To-do → Client relations:** pricing shows 10 rows and "Show all".
4. **Client enquiries → Start valuing:** area and property type are dropdowns; no Delete button (admins only).
5. **Email:** an email from an owner's sign-in address to ownerrelations@ appears in that owner's conversation in
   Messages, Clients, and a reply from the app reaches them from ownerrelations@. An email from an unknown address waits
   under Unknown senders: assign it to an owner and it moves into their conversation.

### Cleaning manager

1. **Menu → Today:** Home, Favorites, To-do.
2. **Cleaning desk → Disputes:** open a rejected clean; the sheet's sections have space between them.
3. **Updates:** "Clean: …" titles with the property.
4. **To-do:** thin rows on a computer; open one and add an update.

### Cleaner

1. **Menu → My day:** Home, Favorites, To-do. On Cleans, nothing floats over "Checklists" or the rows.
2. **Updates:** "Clean: Changeover clean" style titles; tapping one opens the clean.
3. **Report a problem** on one of their cleans: the kind is a dropdown with a search.
4. Nothing from Messages statuses, the checklist or the bonus shows.

### Ready

1. **Menu → Today:** Home, Favorites, To-do.
2. **Report a repair:** type of repair is a dropdown with a search.
3. **Ready desk** trackers: thin one-line rows on a computer.
4. **Updates:** "Repair: …" titles open the repair.

### Accounts

1. **Accounts desk:** the six sections are one dropdown.
2. **New expense:** "Received on" opens a calendar; category is a dropdown.
3. **Cleaner invoices:** the invoice date opens a calendar.
4. **On a phone:** the summary tiles read Approve, Reconcile, Paid on one line each.
5. **Reconciliation → Platform stays, in dark mode:** the Approve button has a visible edge; chosen filters stand out.
6. **Menu → Overview:** Home, Favorites, To-do.

### Owner

1. **Menu → Your properties:** Home, Favorites, My properties, … On a phone: no star floating over the page, and the
   logo shows in the header.
2. **Star a property or a request,** then open Favorites: it is there.
3. **Updates:** no team member's names anywhere; "You" for their own actions and "Recharge" for the rest. Tapping an update
   opens the request if it is theirs; anything else says "That item is no longer available to you."
4. **Messages:** no Engaged or other team statuses.
5. **Help:** the answers about updates, Favorites and dropdowns; none of the team-only answers (checklist, bonus,
   enquiries, Messages statuses).
6. **The enquiry form link,** in dark mode: list options are readable; typing an address shows one box, not two.
7. **Email:** an email from their sign-in address to ownerrelations@ shows in their Messages conversation.
