import { rpcRoute } from './workspace-rpc-route';
import { financeActionSchema, financeReadSchema, prepareFinanceAction } from './workspace-finance-policy';
import { teamsActionSchema, teamsReadSchema } from './workspace-teams-policy';

export const workspaceFinance = rpcRoute({
  readSchema: financeReadSchema, actionSchema: financeActionSchema, bodyLimit: 300_000, unavailable: 'Accounts is temporarily unavailable',
  read: (client, input) => client.rpc('workspace_finance_read', { section: input.section, target_property: input.propertyId || null, period: input.period || null, target_id: input.id || null, status_filter: input.status || null }),
  prepare: prepareFinanceAction, action: 'workspace_finance_action',
});

export const workspaceTeams = rpcRoute({
  readSchema: teamsReadSchema, actionSchema: teamsActionSchema, bodyLimit: 65_536, unavailable: 'Team tools are temporarily unavailable',
  read: (client, input) => client.rpc('workspace_teams_read', { section: input.section, start_on: input.from || null, end_on: input.to || null, target_property: input.propertyId || null, target_user: input.userId || null }),
  action: 'workspace_teams_action',
});
