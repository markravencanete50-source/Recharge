import { z } from 'zod';
import { rpcRoute } from './workspace-rpc-route';
import { feeSettingsActionSchema } from './onboarding-fee';

// The onboarding fee: a property's fee ticket and where it is (or, with no property, just the settings), and the admins'
// settings. The ticket itself moves in Accounts > Receivable. Authority lives in the database (migration 20261027300000).
export const onboardingFeeReadSchema = z.object({ propertyId: z.string().uuid().optional() }).strict();
export const workspaceOnboardingFee = rpcRoute({
  readSchema: onboardingFeeReadSchema, actionSchema: feeSettingsActionSchema, bodyLimit: 16_384, unavailable: 'The onboarding fee is temporarily unavailable',
  read: (client, input) => client.rpc('workspace_onboarding_fee_read', { target: input.propertyId ?? null }),
  action: 'workspace_onboarding_fee_action',
});
