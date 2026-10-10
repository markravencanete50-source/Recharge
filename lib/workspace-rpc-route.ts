import type { SupabaseClient } from '@supabase/supabase-js';
import type { z } from 'zod';
import { authSecurityConfiguration, requestQuota } from './auth-security';
import { boundedJson, isSameOrigin } from './auth-security-policy';
import { businessContext, businessResponse, databaseFailure, viewAsFailure } from './business-server';
import { isNativeRequest } from './native-request-policy';

// Shared transport for checked database read/action pairs. Authority lives in the
// database; this layer verifies transport, session, quota and strict input shape.
export type RpcRoute<R extends z.ZodTypeAny, A extends z.ZodTypeAny> = {
  readSchema: R; actionSchema: A; bodyLimit: number; unavailable: string;
  read: (client: SupabaseClient, input: z.infer<R>) => PromiseLike<{ data: unknown; error: { code?: string } | null }>;
  // Returns the RPC input, or a message describing why the request cannot be sent.
  prepare?: (input: z.infer<A>) => { input: unknown } | { error: string };
  // Actions the server carries out itself (for example with the sign-in service); null sends the
  // action to the database as usual.
  handle?: (context: RpcContext, input: z.infer<A>) => Promise<Response> | null;
  action: string;
  // The database function for an action, when some actions go to another one.
  actionFor?: (input: z.infer<A>) => string;
};
export type RpcContext = { request: Request; client: SupabaseClient; account: { userId: string; role: string } };

export function rpcRoute<R extends z.ZodTypeAny, A extends z.ZodTypeAny>(spec: RpcRoute<R, A>) {
  return async function route(request: Request, native = false) {
    if (native ? !isNativeRequest(request) : request.method === 'POST' && !isSameOrigin(request, authSecurityConfiguration()?.origin)) return businessResponse({ error: 'Invalid request origin' }, 403);
    try {
      const session = await businessContext(request, native);
      if (!session) return businessResponse({ error: 'Sign in required' }, 401);
      if (session.account.status !== 'active') return businessResponse({ error: 'Active workspace access required' }, 403);
      if (request.method === 'GET') {
        const input = spec.readSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
        if (!input.success) return businessResponse({ error: input.error.issues[0]?.message || 'Check the workspace filter' }, 400);
        const result = await spec.read(session.client, input.data);
        return result.error ? databaseFailure(result.error) : businessResponse({ data: result.data, mode: 'live' });
      }
      if (request.method !== 'POST') return businessResponse({ error: 'Method not allowed' }, 405);
      const quota = await requestQuota(request, 'business-user', 60, 60, session.account.userId);
      if (!quota.allowed) {
        const response = businessResponse({ error: 'Too many updates. Please wait.' }, 429);
        response.headers.set('Retry-After', String(quota.retryAfter));
        return response;
      }
      const input = spec.actionSchema.safeParse(await boundedJson(request, spec.bodyLimit));
      if (!input.success) return businessResponse({ error: input.error.issues[0]?.message || 'Check the update' }, 400);
      const handled = spec.handle?.({ request, client: session.client, account: session.account }, input.data);
      if (handled) return await handled;
      const prepared = spec.prepare ? spec.prepare(input.data) : { input: input.data };
      if ('error' in prepared) return businessResponse({ error: prepared.error }, 400);
      const result = await session.client.rpc(spec.actionFor?.(input.data) ?? spec.action, { input: prepared.input });
      return result.error ? databaseFailure(result.error) : businessResponse({ data: result.data, ok: true });
    } catch (error) { return viewAsFailure(error) ?? businessResponse({ error: spec.unavailable }, 503); }
  };
}
