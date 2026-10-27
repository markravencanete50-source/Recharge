import { z } from 'zod';
import { rpcRoute } from './workspace-rpc-route';
import { followUpActionSchema } from './agreement-follow-ups';

// Agreement follow-ups: a property's sequence (or, with no property, just the settings), the team's ticks and the admins'
// steps. Authority lives in the database (migration 20261027200000).
export const agreementFollowUpReadSchema = z.object({ propertyId: z.string().uuid().optional() }).strict();
export const workspaceAgreementFollowUps = rpcRoute({
  readSchema: agreementFollowUpReadSchema, actionSchema: followUpActionSchema, bodyLimit: 32_768, unavailable: 'Agreement follow-ups are temporarily unavailable',
  read: (client, input) => client.rpc('workspace_agreement_followup_read', { target: input.propertyId ?? null }),
  action: 'workspace_agreement_followup_action',
});
