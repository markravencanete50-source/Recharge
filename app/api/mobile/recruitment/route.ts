import { workspaceRecruitment } from '../../../../lib/recruitment-server';
export const GET = (request: Request) => workspaceRecruitment(request, true);
export const POST = (request: Request) => workspaceRecruitment(request, true);
