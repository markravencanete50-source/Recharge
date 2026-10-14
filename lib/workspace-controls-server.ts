import { authSecurityConfiguration, requestQuota } from './auth-security';
import { boundedJson, isSameOrigin } from './auth-security-policy';
import { businessContext, businessResponse, databaseFailure, viewAsFailure } from './business-server';
import { isNativeRequest } from './native-request-policy';
import { controlsActionSchema, controlsReadSchema } from './workspace-controls-policy';

export async function workspaceControls(request: Request, native = false) {
  if (native ? !isNativeRequest(request) : request.method === 'POST' && !isSameOrigin(request, authSecurityConfiguration()?.origin)) return businessResponse({ error: 'Invalid request origin' }, 403);
  try {
    const session = await businessContext(request, native);
    if (!session) return businessResponse({ error: 'Sign in required' }, 401);
    if (session.account.status !== 'active') return businessResponse({ error: 'Active workspace access required' }, 403);
    if (request.method === 'GET') {
      const input = controlsReadSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
      if (!input.success) return businessResponse({ error: 'Check the workspace filter' }, 400);
      const result = await session.client.rpc('workspace_controls_read', { section: input.data.section, target_property: input.data.propertyId || null, target_work: input.data.workId || null });
      return result.error ? databaseFailure(result.error) : businessResponse({ data: result.data, mode: 'live' });
    }
    if (request.method !== 'POST') return businessResponse({ error: 'Method not allowed' }, 405);
    const quota = await requestQuota(request, 'business-user', 60, 60, session.account.userId);
    if (!quota.allowed) {
      const response = businessResponse({ error: 'Too many updates. Please wait.' }, 429);
      response.headers.set('Retry-After', String(quota.retryAfter));
      return response;
    }
    const input = controlsActionSchema.safeParse(await boundedJson(request));
    if (!input.success) return businessResponse({ error: input.error.issues[0]?.message || 'Check the update' }, 400);
    const result = input.data.action === 'markAllNotificationsRead'
      ? await session.client.rpc('workspace_notifications_read_all', { up_to: Number(input.data.upTo) })
      : await session.client.rpc('workspace_controls_action', { input: input.data });
    return result.error ? databaseFailure(result.error) : businessResponse({ data: result.data, ok: true });
  } catch (error) { return viewAsFailure(error) ?? businessResponse({ error: 'Workspace controls are temporarily unavailable' }, 503); }
}
