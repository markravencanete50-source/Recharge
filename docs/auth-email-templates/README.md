# Supabase Auth email templates (with the Recharge logo)

Lee asked for every email to carry the Recharge logo. The app's own emails already have it (`lib/email-brand.ts`). Two emails are sent by Supabase Auth itself, from its own templates, so they are branded here and pasted into Supabase by hand.

**Wait until this batch is live.** The logo image is `https://app.rechargegroup.co.uk/recharge-email-logo.png`, which only exists once the batch with commit e5ffa3a is deployed. Before then, check by opening that address in a browser: it must show the Recharge logo.

## Which emails the app sends through Supabase

| Supabase template | Sent when | File |
| --- | --- | --- |
| **Reset Password** | "Forgot password" on the sign-in page | `reset-password.html` |
| **Confirm signup** | Someone registers with an email in the app (they type the code it sends) | `confirm-signup.html` |

None of these are sent, so leave them as they are:
- **Invite user**: people are added by a super admin, who copies a set-password link.
- **Magic Link**: phone recovery sends a text message, not an email.
- **Change Email Address** and **Reauthentication**.

## Paste steps (Lee)

1. Open Supabase and choose the Recharge project.
2. In the left menu, choose **Authentication**, then **Emails** (some versions call it **Email Templates**).
3. Choose the **Reset Password** template.
   - **Subject:** `Reset your Recharge password`
   - **Message body:** switch to the source view (the `<>` tab), select everything in it and delete it, then paste the whole of `reset-password.html`.
   - Press **Save**.
4. Choose the **Confirm signup** template.
   - **Subject:** `Your Recharge verification code`
   - **Message body:** delete everything in it, then paste the whole of `confirm-signup.html`.
   - Press **Save**.
5. Check it: on the sign-in page choose "Forgot password" and enter your own email. The email should show the Recharge logo at the top and a **Choose a new password** button, and the button should take you to choose a new password.

Keep the parts in double curly brackets exactly as they are, for example `{{ .ConfirmationURL }}`, `{{ .Token }}` and `{{ .Email }}`. Supabase fills these in.

Supabase's built-in email sender sends only a few emails an hour. That limit is unchanged by these templates.
