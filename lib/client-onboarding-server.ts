import { authSecurityConfiguration, requestQuota } from './auth-security';
import { boundedJson, isSameOrigin } from './auth-security-policy';
import { businessContext, businessResponse, databaseFailure, viewAsFailure } from './business-server';
import { isNativeRequest } from './native-request-policy';
import { clientOnboardingActionSchema, clientOnboardingReadSchema } from './client-onboarding';

// The owner's onboarding checklist and the onboarding videos (migration 20261025200000). GET reads a property's ticks,
// its enquiry's answers and the videos (or, with no property, the videos alone); POST is the owner's "Next" (markSeen)
// or a super admin's video link (setVideo). The database decides who may do what; this checks the shape first.
export async function clientOnboardingRoute(request: Request, native = false) {
  if (request.method === 'POST' && (native ? !isNativeRequest(request) : !isSameOrigin(request, authSecurityConfiguration()?.origin))) return businessResponse({ error: 'Invalid request origin' }, 403);
  try {
    const session = await businessContext(request, native);
    if (!session) return businessResponse({ error: 'Sign in required' }, 401);
    if (session.account.status !== 'active') return businessResponse({ error: 'Active workspace access required' }, 403);
    if (request.method === 'GET') {
      const parsed = clientOnboardingReadSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
      if (!parsed.success) return businessResponse({ error: 'Choose the property' }, 400);
      const read = await session.client.rpc('workspace_client_onboarding_read', { target: parsed.data.propertyId ?? null });
      return read.error ? databaseFailure(read.error) : businessResponse({ data: read.data });
    }
    if (request.method !== 'POST') return businessResponse({ error: 'Method not allowed' }, 405);
    const quota = await requestQuota(request, 'client-onboarding-user', 60, 600, session.account.userId);
    if (!quota.allowed) { const r = businessResponse({ error: 'Too many changes. Please wait.' }, 429); r.headers.set('Retry-After', String(quota.retryAfter || 60)); return r; }
    const parsed = clientOnboardingActionSchema.safeParse(await boundedJson(request, 4096));
    if (!parsed.success) return businessResponse({ error: parsed.error.issues[0]?.message || 'Check the details', field: parsed.error.issues[0]?.path.at(-1) ?? null }, 400);
    const saved = await session.client.rpc('workspace_client_onboarding_action', { input: parsed.data });
    return saved.error ? databaseFailure(saved.error) : businessResponse({ ok: true, data: saved.data });
  } catch (error) { return viewAsFailure(error) ?? businessResponse({ error: 'Onboarding is temporarily unavailable' }, 503); }
}
