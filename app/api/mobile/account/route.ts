import { NextResponse } from "next/server";
import { isNativeRequest } from "@/lib/native-request-policy";
import { requestQuota } from "@/lib/auth-security";
import {
  boundedJson,
  isSameOrigin,
  securityHeaders,
} from "@/lib/auth-security-policy";
import {
  appearanceSchema,
  confirmedContact,
  normalizeContact,
  registrationSchema,
  verificationSchema,
} from "@/lib/registration-policy";
import {
  registrationConfiguration,
  registrationProvider,
  saveRegistrationProfile,
} from "@/lib/registration-provider";

const response = (
  body: object,
  status = 200,
  headers: Record<string, string> = {},
) =>
  NextResponse.json(body, {
    status,
    headers: { ...securityHeaders, ...headers },
  });
const unavailable = () =>
  response(
    {
      error:
        "Account registration is awaiting secure email and SMS configuration.",
    },
    503,
  );
export function GET() {
  const config = registrationConfiguration();
  return response({
    enabled: Boolean(config),
    phoneEnabled: Boolean(config?.phoneEnabled),
  });
}
export async function POST(request: Request) {
  const config = registrationConfiguration();
  if (!isSameOrigin(request, config?.origin) && !isNativeRequest(request))
    return response({ error: "Invalid request origin" }, 403);
  if (!config) return unavailable();
  try {
    const quota = await requestQuota(request, "onboarding-ip", 20, 3600);
    if (!quota.allowed)
      return response({ error: "Please wait before trying again." }, 429, {
        "Retry-After": String(quota.retryAfter),
      });
    const body = await boundedJson(request);
    const client = registrationProvider(config);
    const signup = registrationSchema.safeParse(body);
    if (signup.success) {
      const { method, password } = signup.data;
      if (method === "phone" && !config.phoneEnabled) return unavailable();
      const address = normalizeContact(method, signup.data.address);
      const limit = await requestQuota(
        request,
        "onboarding-contact",
        3,
        3600,
        `${method}:${address}`,
      );
      if (!limit.allowed)
        return response(
          { error: "Please wait before requesting another verification code." },
          429,
          { "Retry-After": String(limit.retryAfter) },
        );
      const result = await client.auth.signUp(
        method === "email"
          ? { email: address, password }
          : { phone: address, password },
      );
      if (result.data.session) {
        await client.auth.signOut({ scope: "local" });
        return unavailable(); // Confirmation must be enabled. No auto-confirmed onboarding.
      }
      // Conceal existing accounts and provider delivery details. Rate limits still apply.
      return response({
        message:
          "If registration is available for these details, a verification code will arrive shortly. Existing users should sign in or reset their password.",
      });
    }
    const verification = verificationSchema.safeParse(body);
    if (verification.success) {
      const { method, code } = verification.data;
      if (method === "phone" && !config.phoneEnabled) return unavailable();
      const address = normalizeContact(method, verification.data.address);
      const limit = await requestQuota(
        request,
        "onboarding-verification",
        8,
        900,
        `${method}:${address}`,
      );
      if (!limit.allowed)
        return response(
          { error: "Too many verification attempts. Please try again later." },
          429,
          { "Retry-After": String(limit.retryAfter) },
        );
      const { data, error } = await client.auth.verifyOtp(
        method === "email"
          ? { email: address, token: code, type: "email" }
          : { phone: address, token: code, type: "sms" },
      );
      if (
        error ||
        !data.session ||
        !data.user ||
        !confirmedContact(data.user, method, address)
      )
        return response(
          {
            error:
              "The code is incorrect or expired. Check your code and try again.",
          },
          400,
        );
      // This session is only used to complete the user's own profile. No role or workspace grant is created.
      return response({ accessToken: data.session.access_token });
    }
    const appearance = appearanceSchema.safeParse(body);
    if (appearance.success) {
      const bearer = request.headers
        .get("authorization")
        ?.match(/^Bearer ([A-Za-z0-9_.-]{32,8192})$/)?.[1];
      if (!bearer)
        return response({ error: "Verify your contact details first." }, 401);
      const verified = await client.auth.getUser(bearer);
      if (
        verified.error ||
        !verified.data.user ||
        !confirmedContact(verified.data.user)
      )
        return response({ error: "Verify your contact details first." }, 401);
      // A separate public-key client forwards only the user's token. Never accept IDs, roles or module grants.
      const saved = await saveRegistrationProfile(
        config,
        bearer,
        appearance.data,
      );
      if (!saved.ok)
        return response(
          { error: "Your profile could not be saved. Please try again." },
          503,
        );
      return response({
        ok: true,
        access: "pending",
        profile: appearance.data,
      });
    }
    return response(
      { error: "Check your contact details, password or profile." },
      400,
    );
  } catch {
    return response(
      {
        error:
          "Account setup is temporarily unavailable. Please try again later.",
      },
      503,
    );
  }
}
