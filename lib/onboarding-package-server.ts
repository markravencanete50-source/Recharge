import { rpcRoute } from './workspace-rpc-route';
import { packageActionSchema, packageReadSchema } from './onboarding-package';

// The onboarding package: the settings (the questions owners answer) and, for a property, its package; the owner's answers
// and an admin's settings. Authority lives in the database (migration 20261028100000).
export const workspaceOnboardingPackage = rpcRoute({
  readSchema: packageReadSchema, actionSchema: packageActionSchema, bodyLimit: 80_000, unavailable: 'The onboarding package is temporarily unavailable',
  read: (client, input) => client.rpc('workspace_package_read', { target: input.propertyId ?? null }),
  action: 'workspace_package_action',
});
