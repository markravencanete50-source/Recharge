// One-off: creates Recharge's own web push key pair and stores it on the backend Worker as two
// secrets, so the private key is never shown, printed or saved in a file. Run once from your
// computer, signed in to Wrangler:   npm run push:setup
// Running it again replaces the keys, and every browser has to allow notifications again.
import { spawnSync } from "node:child_process";
import { webcrypto } from "node:crypto";

const b64url = bytes => Buffer.from(bytes).toString("base64url");
const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const publicKey = b64url(new Uint8Array(await webcrypto.subtle.exportKey("raw", pair.publicKey)));
const privateKey = (await webcrypto.subtle.exportKey("jwk", pair.privateKey)).d;
const wrangler = process.platform === "win32" ? "npx.cmd" : "npx";
for (const [name, value] of [["VAPID_PUBLIC_KEY", publicKey], ["VAPID_PRIVATE_KEY", privateKey]]) {
  const result = spawnSync(wrangler, ["wrangler", "secret", "put", name, "--name", "recharge-backend"], { input: value, stdio: ["pipe", "inherit", "inherit"], shell: process.platform === "win32" });
  if (result.status !== 0) { console.error(`Could not save ${name}. Check you are signed in to Wrangler (npx wrangler login), then run this again.`); process.exit(1); }
}
console.log("Web push is set up. People can now turn on notifications in the app (Profile → Notifications).");
