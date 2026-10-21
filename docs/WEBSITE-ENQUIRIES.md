# Website enquiries

The company website (rechargestays.co.uk) has its own copy of the New Property Enquiry Form, with the same fields and
options as `/enquiry`. Its form posts straight from the visitor's browser to this app's `/api/enquiry`: first
`{ "action": "start" }` to get a token, then `{ token, answers }`. Both calls get the same quotas and checks as the app's
own form. Each enquiry is recorded the same way too, so it shows in Client Enquiries like one sent from `/enquiry`.

## App setting: `ENQUIRY_ALLOWED_ORIGINS`

A comma-separated list of the exact sites allowed to post the form, set in the app's Worker environment (next to
`APP_ORIGIN`):

```
ENQUIRY_ALLOWED_ORIGINS=https://rechargestays.co.uk,https://www.rechargestays.co.uk,https://recharge-website-flax.vercel.app
```

- Each entry is a bare origin: `https://`, the host, and an optional port. It has no path, query or trailing page. An entry
  that isn't one, including `*`, is ignored. `http://` works only for `localhost` and `127.0.0.1`.
- A request's `Origin` header must exactly match one of these entries. Subdomains are not included automatically, so
  list `www.` separately.
- Only `/api/enquiry` accepts these origins. Photo and video uploads (`/api/enquiry/upload`) and every other route stay
  same-origin only. The website sends a link to its photos instead of uploading files.
- `/api/enquiry` handles CORS for those origins only. A preflight (`OPTIONS`) gets `Access-Control-Allow-Origin` set to
  that exact origin (never `*`), along with `Access-Control-Allow-Methods: POST, OPTIONS`,
  `Access-Control-Allow-Headers: content-type`, `Access-Control-Max-Age: 600` and `Vary: Origin`. Every POST answer,
  errors included, carries the same `Access-Control-Allow-Origin` and `Vary`, so the website can show the error message.
  No cookies are shared.
- If this setting is unset or empty, only `/enquiry` can send the form, which is how the app worked before.

## Website setting: `NEXT_PUBLIC_ENQUIRY_API`

In the website's Vercel project, set:

```
NEXT_PUBLIC_ENQUIRY_API=https://app.rechargegroup.co.uk
```

Then redeploy both the app and the website. Until this is set, the website links visitors to
`https://app.rechargegroup.co.uk/enquiry`.

Code: `enquirySubmitRoute` and `enquiryPreflightRoute` in `lib/client-enquiry-server.ts`, `originList` and `listedOrigin`
in `lib/auth-security-policy.ts`, and the `/api/enquiry` exception in `proxy.ts`. Tests: `tests/website-enquiries-http.test.mjs`.
