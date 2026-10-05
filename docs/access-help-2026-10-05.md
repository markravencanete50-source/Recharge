# Access-specific help, personal activity and company branding

Alex's four recordings were transcribed on the user's laptop with the installed Whisper engine and cached small model. Timestamped transcripts and the consolidated requirements are saved outside Git in `Recharge-Client-Notes/2026-10-05`. Raw client audio and transcripts are not part of the public preview build.

## Changes

- Shared FAQ content is filtered by role and actual module grants. Cleaning, cleaning management, Ready, Stays, client and administration guidance remain distinct.
- Mobile Help offers topic filters, search, expandable answers and links to permitted tools. The portal uses a searchable dialog with keyboard-accessible disclosures.
- Mobile Today includes recent activity and a link to Help. Tools offers both destinations. The existing five navigation tabs and 37 module destinations remain intact.
- Personal activity records tool views, record views, pins, profile updates and successful report downloads where those actions exist. Only minimal action metadata is retained, with a 50-entry cap and accidental double-tap suppression.
- Preview history is separated by role. Protected portal history is separated by verified account and role and filtered against current grants. No message bodies, property addresses, credentials or payment information are saved in activity.
- The existing Recharge company wordmark replaces the blue letter avatar in the mobile header, desktop mobile navigation and studio. Colour treatments keep its lettering and geometry readable in both themes.
- The visible database title is Property Management Database; its module ID, routes and grants are preserved.

## Scope

Recent activity is clearly labelled as the user's actions on this device. Mobile uses local storage and the protected portal uses session storage. It is not a server audit trail or a manager view of everyone's actions. Preview records remain read-only. Viewing a tool does not record a completed job, sent message, settled invoice or approved repair.

The FAQ describes the operating process Alex wants. Hostaway, WhatsApp, email, e-signature, notifications and departmental automation must be connected and tested separately before guidance can imply live delivery. Inconsistent shift hours, bonus bands and direct-booking duration rules are flagged in the local client notes rather than silently hardcoded.

## Verification

- Root and mobile TypeScript checks passed. Mobile lint passed. Targeted root lint passed with the same three existing portal warnings.
- 68 relevant automated checks passed, covering help grants, history validation, analytics, exports, authentication, password lockout, PostgreSQL RLS, registration, vector design, role scopes and preview routes.
- The first broader run found a stale preview server route, resolved by restarting the local worker after its build. Two unrelated legacy checks remain incompatible: the rendered-server test requires a Cloudflare runtime, and an old artwork test still expects retired 3D illustration assets.
- Browser checks verified mobile FAQ search, topic selection, accordion expansion, permitted tool links, scrolling, theme changes, isolated cleaner history, activity persistence after reload, and portal tool/export history.
- Checked 375-pixel mobile views in both themes and a 320-pixel compact header without horizontal overflow. Mobile visual lint reported zero findings. Desktop FAQ dialogs were visually reviewed.
- A duplicate sibling React key discovered during browser testing was fixed so help content mounts only once after rerenders.

Local screenshots and visual-lint evidence are saved in the ignored `.audit/access-help-review` folder.
