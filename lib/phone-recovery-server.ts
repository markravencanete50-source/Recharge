import { z } from 'zod';
import { NextResponse } from 'next/server';
import { boundedJson, isSameOrigin, newPasswordSchema, phoneSchema, securityHeaders, uuidSchema } from './auth-security-policy';
import { recoveryPhase, requestQuota, securityHash } from './auth-security';
import { confirmedContact } from './registration-policy';
import { registrationConfiguration, registrationProvider } from './registration-provider';
import { isNativeRequest } from './native-request-policy';

export const phoneRecoverySchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('request'), phone: phoneSchema }).strict(),
  z.object({ action: z.literal('verify'), phone: phoneSchema, code: z.string().regex(/^\d{6,8}$/), password: newPasswordSchema.shape.password }).strict(),
]);
const response = (body: object, status = 200) => NextResponse.json(body, { status, headers: { ...securityHeaders, Vary: 'Cookie, Authorization' } });
export async function phoneRecovery(request: Request, native = false) {
  const config = registrationConfiguration();
  if (native ? !isNativeRequest(request) : !isSameOrigin(request, config?.origin)) return response({ error: 'Invalid request origin' }, 403);
  if (!config?.phoneEnabled) return response({ error: 'Phone recovery is awaiting SMS configuration' }, 503);
  let proof: Parameters<typeof recoveryPhase>[0] | undefined;
  let provider: ReturnType<typeof registrationProvider> | undefined;
  let passwordChanged = false;
  try {
    const input = phoneRecoverySchema.safeParse(await boundedJson(request));
    if (!input.success) return response({ error: 'Check your phone number, verification code and password' }, 400);
    const ipQuota = await requestQuota(request, 'phone-recovery-ip', 20, 3600);
    const contactQuota = ipQuota.allowed ? await requestQuota(request, 'phone-recovery-' + input.data.action, input.data.action === 'request' ? 3 : 5, input.data.action === 'request' ? 3600 : 600, input.data.phone) : ipQuota;
    if (!contactQuota.allowed) {
      const limited = response({ error: 'Please wait before trying again' }, 429);
      limited.headers.set('Retry-After', String(contactQuota.retryAfter)); return limited;
    }
    provider = registrationProvider(config);
    if (input.data.action === 'request') {
      await provider.auth.signInWithOtp({ phone: input.data.phone, options: { shouldCreateUser: false } });
      // Existing and unknown numbers receive the same response. This endpoint never creates users.
      return response({ ok: true, message: 'If this number has an account, a verification code will arrive shortly.' });
    }
    const verified = await provider.auth.verifyOtp({ phone: input.data.phone, token: input.data.code, type: 'sms' });
    const user = verified.data.user, session = verified.data.session;
    if (verified.error || !user || !session || !confirmedContact(user, 'phone', input.data.phone)) return response({ error: 'The verification code is invalid or expired' }, 403);
    const claims = await provider.auth.getClaims(session.access_token);
    const sessionId = uuidSchema.safeParse(claims.data?.claims.session_id);
    if (claims.error || !sessionId.success || claims.data?.claims.sub !== user.id) return response({ error: 'Verification could not be confirmed' }, 403);
    proof = { proofHash: await securityHash('recovery-proof', crypto.randomUUID()), userId: user.id, sessionId: sessionId.data, leaseId: crypto.randomUUID(), phase: 'create' };
    if (!await recoveryPhase(proof) || !await recoveryPhase({ ...proof, phase: 'begin' })) throw new Error('Recovery proof unavailable');
    const updated = await provider.auth.updateUser({ password: input.data.password });
    if (updated.error) {
      await recoveryPhase({ ...proof, phase: 'release' }); proof = undefined;
      return response({ error: 'Use a strong, different password that meets the account password rules' }, 400);
    }
    passwordChanged = true;
    if (!await recoveryPhase({ ...proof, phase: 'complete', subjectHash: await securityHash('password-account', input.data.phone) })) throw new Error('Recovery completion unavailable');
    proof = undefined;
    // Resetting a password never approves a workspace session or restores a revoked role.
    return response({ ok: true, message: 'Password updated. Sign in with your new password.' });
  } catch {
    if (proof) await recoveryPhase({ ...proof, phase: 'release' }).catch(() => false);
    return response({ error: 'Phone recovery is temporarily unavailable. Please try again.' }, 503);
  } finally {
    if (provider) await provider.auth.signOut({ scope: passwordChanged ? 'global' : 'local' }).catch(() => null);
  }
}
