import { workspaceOnboardingPackage } from '../../../../lib/onboarding-package-server';
export const GET = (request: Request) => workspaceOnboardingPackage(request, true);
export const POST = (request: Request) => workspaceOnboardingPackage(request, true);
