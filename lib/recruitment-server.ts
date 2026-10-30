import { rpcRoute } from './workspace-rpc-route';
import { recruitmentActionSchema, recruitmentQuerySchema } from './recruitment';

// Recruitment: vacancies, adverts, candidates and new starters. Authority lives in the database (migration 20261029600000).
export const workspaceRecruitment = rpcRoute({
  readSchema: recruitmentQuerySchema, actionSchema: recruitmentActionSchema, bodyLimit: 340_000, unavailable: 'Recruitment is temporarily unavailable',
  read: client => client.rpc('workspace_recruitment_read'),
  action: 'workspace_recruitment_action',
});
