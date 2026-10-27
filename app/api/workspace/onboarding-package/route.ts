import { workspaceOnboardingPackage } from '../../../../lib/onboarding-package-server';
export const GET = (request: Request) => workspaceOnboardingPackage(request);
export const POST = (request: Request) => workspaceOnboardingPackage(request);
