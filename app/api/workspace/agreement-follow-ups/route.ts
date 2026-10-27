import { workspaceAgreementFollowUps } from '../../../../lib/agreement-follow-ups-server';
export const GET = (request: Request) => workspaceAgreementFollowUps(request);
export const POST = (request: Request) => workspaceAgreementFollowUps(request);
