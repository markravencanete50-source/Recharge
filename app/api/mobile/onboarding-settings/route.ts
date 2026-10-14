import { onboardingSettingsRoute } from '../../../../lib/agreement-template-server';
export const GET = (request: Request) => onboardingSettingsRoute(request, true);
export const POST = (request: Request) => onboardingSettingsRoute(request, true);
