import { rpcRoute } from './workspace-rpc-route';
import { ACCOUNTS_ACTIONS, ACCOUNTS_SECTIONS, financeActionSchema, financeReadSchema, prepareFinanceAction } from './workspace-finance-policy';
import { teamsActionSchema, teamsReadSchema } from './workspace-teams-policy';
import { adminActionSchema, adminReadSchema } from './workspace-admin-policy';
import { integrationConfiguration } from './integration-policy';

export const workspaceFinance = rpcRoute({
  readSchema: financeReadSchema, actionSchema: financeActionSchema, bodyLimit: 300_000, unavailable: 'Accounts is temporarily unavailable',
  read: (client, input) => ACCOUNTS_SECTIONS.includes(input.section) ? client.rpc('workspace_accounts_read', { section: input.section, target_property: input.propertyId || null, target_id: input.id || null })
    : client.rpc('workspace_finance_read', { section: input.section, target_property: input.propertyId || null, period: input.period || null, target_id: input.id || null, status_filter: input.status || null }),
  prepare: prepareFinanceAction, action: 'workspace_finance_action',
  // Expense paperwork and purchase invoices have their own database function.
  actionFor: input => ACCOUNTS_ACTIONS.includes(input.action) ? 'workspace_accounts_action' : 'workspace_finance_action',
});

export const workspaceTeams = rpcRoute({
  readSchema: teamsReadSchema, actionSchema: teamsActionSchema, bodyLimit: 300_000, unavailable: 'Team tools are temporarily unavailable',
  read: (client, input) => input.section === 'readyHome' ? client.rpc('workspace_ready_home')
    : input.section === 'favorites' ? client.rpc('workspace_favorites')
    : input.section === 'viewAsPeople' ? client.rpc('workspace_view_as_people')
    // Client enquiries also say whether the email service is set up (or the team copies the link).
    : input.section === 'clientEnquiries' ? Promise.all([client.rpc('workspace_teams_read', { section: input.section }),
      import('./integration-server').then(m => integrationConfiguration(m.integrationSettings()).email, () => false)]).then(([r, email]) => r.error ? r : { ...r, data: { ...(r.data as object), emailReady: email } })
    : client.rpc('workspace_teams_read', { section: input.section, start_on: input.from || null, end_on: input.to || null, target_property: input.propertyId || null, target_user: input.userId || null }),
  action: 'workspace_teams_action',
  // Sending the enquiry form makes its link and sends the email on the server.
  // Deleting a course also deletes its stored files.
  handle: (context, input) => input.action === 'inviteEnquiry' || input.action === 'resendEnquiry' ? import('./client-enquiry-server').then(m => m.sendEnquiryForm(context, input))
    : input.action === 'deleteCourse' ? import('./training-files-server').then(m => m.deleteCourse(context, input)) : null,
  // Favorites and View as have their own database functions.
  actionFor: input => input.action === 'saveFavorites' ? 'workspace_save_favorites' : input.action === 'startViewAs' ? 'workspace_view_as_start'
    : input.action === 'stopViewAs' ? 'workspace_view_as_stop' : 'workspace_teams_action',
});

export const workspaceAdmin = rpcRoute({
  readSchema: adminReadSchema, actionSchema: adminActionSchema, bodyLimit: 16_384, unavailable: 'Administration is temporarily unavailable',
  read: (client, input) => client.rpc('workspace_admin_read', { section: input.section }),
  // Adding people and set-password links use the sign-in service; loaded only when used.
  handle: (context, input) => input.action === 'addPerson' ? import('./account-invite-server').then(m => m.addPerson(context, input))
    : input.action === 'passwordLink' ? import('./account-invite-server').then(m => m.passwordLink(context, input)) : null,
  action: 'workspace_admin_action',
});
