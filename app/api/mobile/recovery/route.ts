import { phoneRecovery } from '../../../../lib/phone-recovery-server';
export const POST = (request: Request) => phoneRecovery(request, true);
