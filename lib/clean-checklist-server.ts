import { rpcRoute } from './workspace-rpc-route';
import { checklistActionSchema, checklistReadSchema } from './clean-checklist-policy';

// Clean checklists and their photo rules. Authority lives in the database.
export const workspaceChecklists = rpcRoute({
  readSchema: checklistReadSchema, actionSchema: checklistActionSchema, bodyLimit: 32_768, unavailable: 'Cleaning checklists are temporarily unavailable',
  read: (client, input) => client.rpc('clean_checklists_read', { section: input.section, target: input.section === 'clean' ? input.workId : null }),
  action: 'clean_checklists_action',
});
