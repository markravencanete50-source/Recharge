import test, { after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const state = {};
globalThis.__registrationTest = state;
const mocks = {
  "@/lib/auth-security": `const s=globalThis.__registrationTest; export async function requestQuota(...args){s.quotas.push(args);if(s.outage)throw Error('private outage');return s.quota;}`,
  "@/lib/registration-provider": `const s=globalThis.__registrationTest;
    export const registrationConfiguration=()=>s.config;
    export const registrationProvider=()=>({auth:{
      signUp:async input=>{s.calls.push(['signup',input]);return s.signup;},
      signOut:async()=>{s.calls.push(['signout']);},
      verifyOtp:async input=>{s.calls.push(['verify',input]);return s.verified;},
      getUser:async token=>{s.calls.push(['user',token]);return {data:{user:s.user},error:null};}
    }});
    export async function saveRegistrationProfile(config,token,profile){s.calls.push(['profile',token,profile]);return {ok:s.saved};}`,
};
const vite = await createServer({
  configFile: false,
  appType: "custom",
  root,
  resolve: { alias: { "@": root } },
  server: { middlewareMode: true, hmr: false },
  plugins: [
    {
      name: "registration-provider-test",
      enforce: "pre",
      transform(code, id) {
        if (
          !id.replaceAll("\\", "/").endsWith("/app/api/mobile/account/route.ts")
        )
          return null;
        for (const key of Object.keys(mocks)) {
          code = code.replaceAll(
            `from '${key}'`,
            `from 'registration-test:${key}'`,
          );
          code = code.replaceAll(`from "${key}"`, `from "registration-test:${key}"`);
        }
        return { code, map: null };
      },
      resolveId(id) {
        return id.startsWith("registration-test:") ? "\0" + id : null;
      },
      load(id) {
        return id.startsWith("\0registration-test:")
          ? mocks[id.slice(19)]
          : null;
      },
    },
  ],
});
after(async () => {
  delete globalThis.__registrationTest;
  await vite.close();
});
const route = await vite.ssrLoadModule("/app/api/mobile/account/route.ts");
const policy = await vite.ssrLoadModule("/lib/registration-policy.ts");
const token = "synthetic.test.token." + "a".repeat(40);
const user = {
  id: "own-user",
  email: "client@example.com",
  email_confirmed_at: "2026-10-04",
};
function reset() {
  Object.assign(state, {
    config: { origin: "https://recharge.example", phoneEnabled: true },
    quota: { allowed: true, retryAfter: 0 },
    outage: false,
    calls: [],
    quotas: [],
    signup: { data: { session: null }, error: null },
    verified: { data: { user, session: { access_token: token } }, error: null },
    user,
    saved: true,
  });
}
function request(body, headers = {}) {
  return new Request("https://recharge.example/api/mobile/account", {
    method: "POST",
    headers: {
      origin: "https://recharge.example",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
const signup = {
  action: "register",
  method: "email",
  address: " Client@Example.Com ",
  password: "synthetic-password-12",
};

test("registration requires trusted origin, configured security and durable quota", async () => {
  reset();
  assert.equal(
    (await route.POST(request(signup, { origin: "https://attacker.example" })))
      .status,
    403,
  );
  assert.equal(state.calls.length, 0);
  state.config = null;
  assert.equal(route.GET().status, 200);
  assert.deepEqual(await route.GET().json(), {
    enabled: false,
    phoneEnabled: false,
  });
  assert.equal((await route.POST(request(signup))).status, 503);
  reset();
  state.outage = true;
  assert.equal((await route.POST(request(signup))).status, 503);
  assert.equal(state.calls.length, 0);
  reset();
  state.quota = { allowed: false, retryAfter: 60 };
  const limited = await route.POST(request(signup));
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
  assert.equal(state.calls.length, 0);
});
test("signup normalizes a single contact without accepting IDs, roles or grant metadata", async () => {
  reset();
  const result = await route.POST(request(signup));
  assert.equal(result.status, 200);
  assert.deepEqual(state.calls[0], [
    "signup",
    { email: "client@example.com", password: signup.password },
  ]);
  assert.equal(state.quotas[1][4], "email:client@example.com");
  for (const extra of [
    { role: "super_admin" },
    { phone: "+447123456789" },
    { userId: "other-user" },
    { data: { role: "admin" } },
  ]) {
    reset();
    assert.equal(
      (await route.POST(request({ ...signup, ...extra }))).status,
      400,
    );
    assert.equal(state.calls.length, 0);
  }
  reset();
  assert.equal(
    (await route.POST(request({ ...signup, password: "short" }))).status,
    400,
  );
});
test("provider errors conceal existence and automatic confirmation fails closed", async () => {
  reset();
  state.signup.error = { message: "private existing account" };
  const result = await route.POST(request(signup));
  assert.equal(result.status, 200);
  assert.ok(!(await result.text()).includes("private existing account"));
  reset();
  state.signup.data.session = { access_token: token };
  assert.equal((await route.POST(request(signup))).status, 503);
  assert.deepEqual(
    state.calls.map((call) => call[0]),
    ["signup", "signout"],
  );
});
test("phone signup is gated by SMS configuration and enforces international numbering", async () => {
  reset();
  state.config.phoneEnabled = false;
  const input = { ...signup, method: "phone", address: "+447123456789" };
  assert.equal((await route.POST(request(input))).status, 503);
  assert.equal(state.calls.length, 0);
  reset();
  assert.equal((await route.POST(request(input))).status, 200);
  assert.equal(state.calls[0][1].phone, input.address);
  reset();
  assert.equal(
    (await route.POST(request({ ...input, address: "07123456789" }))).status,
    400,
  );
  assert.equal(state.calls.length, 0);
});
test("OTP verification cannot accept a session for a different or unconfirmed contact", async () => {
  const input = {
    action: "verify",
    method: "email",
    address: "client@example.com",
    code: "123456",
  };
  reset();
  assert.equal((await route.POST(request(input))).status, 200);
  reset();
  state.verified.data.user = { ...user, email: "other@example.com" };
  assert.equal((await route.POST(request(input))).status, 400);
  reset();
  state.verified.data.user = { ...user, email_confirmed_at: undefined };
  assert.equal((await route.POST(request(input))).status, 400);
  reset();
  assert.equal(
    (await route.POST(request({ ...input, code: "abc123" }))).status,
    400,
  );
  assert.equal(state.calls.length, 0);
  assert.equal(
    policy.confirmedContact(
      { phone: "+447123456789", phone_confirmed_at: "now" },
      "phone",
      "+447123456789",
    ),
    true,
  );
});
test("only verified bearer identities can save their own appearance and never workspace permissions", async () => {
  const appearance = { displayName: " Alex ", avatar: "forest" };
  reset();
  assert.equal((await route.POST(request(appearance))).status, 401);
  reset();
  state.user = { id: "own-user" };
  assert.equal(
    (
      await route.POST(
        request(appearance, { authorization: `Bearer ${token}` }),
      )
    ).status,
    401,
  );
  assert.ok(!state.calls.some((call) => call[0] === "profile"));
  reset();
  const result = await route.POST(
    request(appearance, { authorization: `Bearer ${token}` }),
  );
  assert.equal(result.status, 200);
  assert.deepEqual((await result.json()).profile, {
    displayName: "Alex",
    avatar: "forest",
  });
  assert.equal(state.calls[1][1], token);
  assert.equal(state.calls[1][2].displayName, "Alex");
  reset();
  assert.equal(
    (
      await route.POST(
        request(
          { ...appearance, role: "super_admin" },
          { authorization: `Bearer ${token}` },
        ),
      )
    ).status,
    400,
  );
  assert.equal(state.calls.length, 0);
  reset();
  assert.equal(
    (
      await route.POST(
        request(
          { ...appearance, avatar: "https://attacker.example/tracker" },
          { authorization: `Bearer ${token}` },
        ),
      )
    ).status,
    400,
  );
});
