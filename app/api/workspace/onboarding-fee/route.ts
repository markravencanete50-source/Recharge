import { workspaceOnboardingFee } from '../../../../lib/onboarding-fee-server';
export const GET = (request: Request) => workspaceOnboardingFee(request);
export const POST = (request: Request) => workspaceOnboardingFee(request);
