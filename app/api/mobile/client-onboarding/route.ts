import { clientOnboardingRoute } from '../../../../lib/client-onboarding-server';
export const GET = (request: Request) => clientOnboardingRoute(request, true);
export const POST = (request: Request) => clientOnboardingRoute(request, true);
