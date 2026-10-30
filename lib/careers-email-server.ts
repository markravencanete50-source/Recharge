import { z } from 'zod';
import { authSecurityConfiguration, securityHash, securityRpc } from './auth-security';
import { enquiryEmailReady } from './integration-policy';
import { integrationSettings } from './integration-server';
import { sendEmail } from './integration-providers';
import { tokenHash } from './client-enquiry';
import { APP_PATH } from './client-onboarding';
import { CAREERS_ADDRESS, CAREERS_FROM, careersEmail, careersEmailJobSchema } from './careers';

const publicRpc = <T>(input: Record<string, unknown>) => securityRpc<T>('workspace_careers_public', { input });
// ---------------------------------------------------------------- the careers@ emails
// Every minute from the Worker: up to 20 queued emails. Someone without an account gets the link that makes one (the same
// link for the same email, so a retried send is the same email); someone with one gets a link to sign in.
export async function runCareersEmails(settings = integrationSettings()) {
  const config = authSecurityConfiguration();
  if (!config || !enquiryEmailReady(settings)) return { sent: 0 };
  const jobs = z.array(careersEmailJobSchema).parse(await publicRpc({ action: 'emailClaim' }));
  let sent = 0;
  for (const job of jobs) {
    let ok = true, error = '';
    try {
      const origin = config.origin.replace(/\/$/, '');
      let link: { url: string; label: string };
      if (job.hasAccount) link = { url: `${origin}${APP_PATH}?${new URLSearchParams({ email: job.to })}`, label: 'Open your account' };
      else {
        const token = await securityHash('careers-account', job.id);
        const refreshed = await publicRpc<{ ok: boolean }>({ action: 'refreshToken', id: job.candidateId, tokenHash: await tokenHash(token) });
        link = refreshed.ok ? { url: `${origin}/careers/account?t=${token}`, label: 'Create your account' } : { url: `${origin}${APP_PATH}?${new URLSearchParams({ email: job.to })}`, label: 'Open your account' };
      }
      await sendEmail(settings, { to: job.to, ...careersEmail(job, link), from: CAREERS_FROM, replyTo: CAREERS_ADDRESS, idempotencyKey: `recharge-careers/${job.id}` });
      sent++;
    } catch (e) { ok = false; error = e instanceof Error ? e.message.slice(0, 200) : 'failed'; }
    await publicRpc({ action: 'emailDone', id: job.id, ok, error }).catch(() => undefined);
  }
  return { sent };
}
