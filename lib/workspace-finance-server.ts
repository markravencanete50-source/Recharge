import { rpcRoute } from './workspace-rpc-route';
import { ACCOUNTS_ACTIONS, ACCOUNTS_SECTIONS, PAYABLES_ACTIONS, REPORT_SECTIONS, financeActionSchema, financeBodyLimit, financeReadSchema, prepareFinanceAction } from './workspace-finance-policy';
import { teamsActionSchema, teamsReadSchema } from './workspace-teams-policy';
import { adminActionSchema, adminReadSchema } from './workspace-admin-policy';
import { integrationConfiguration } from './integration-policy';

// Only the filters asked for are sent; the database refuses any other key.
const reportFilters = (input: { channel?: string; region?: string; reportId?: string; state?: string; status?: string; cleanerId?: string; method?: string }) =>
  Object.fromEntries(Object.entries({ channel: input.channel, region: input.region, reportId: input.reportId, state: input.state, status: input.status, cleanerId: input.cleanerId, method: input.method }).filter(([, value]) => value));
export const workspaceFinance = rpcRoute({
  // Payout reports can be large (a year of a larger portfolio); only the finance roles may send one that size.
  readSchema: financeReadSchema, actionSchema: financeActionSchema, bodyLimit: financeBodyLimit, unavailable: 'Accounts is temporarily unavailable',
  read: (client, input) => ACCOUNTS_SECTIONS.includes(input.section) ? client.rpc('workspace_accounts_read', { section: input.section, target_property: input.propertyId || null, target_id: input.id || null })
    // Reports (payout lines, cleans to review, cleaner invoices, receivable, performance) take from and to dates and filters.
    : REPORT_SECTIONS.includes(input.section) ? client.rpc('workspace_finance_report', { section: input.section, target_property: input.propertyId || null, target_id: input.id || null,
      from_on: input.from || null, to_on: input.to || null, filters: reportFilters(input) })
    : client.rpc('workspace_finance_read', { section: input.section, target_property: input.propertyId || null, period: input.period || null, target_id: input.id || null, status_filter: input.status || null }),
  // Payout reports are read here and reach the database as lines (prepareFinanceAction).
  prepare: prepareFinanceAction, action: 'workspace_finance_action',
  // Expense paperwork and purchase invoices, and cleaner invoices with the clean cost review, have their own database functions.
  actionFor: input => ACCOUNTS_ACTIONS.includes(input.action) ? 'workspace_accounts_action' : PAYABLES_ACTIONS.includes(input.action) ? 'workspace_payables_action' : 'workspace_finance_action',
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
    // Deleting an enquiry also removes its stored photos and videos.
    : input.action === 'deleteEnquiry' ? import('./client-enquiry-server').then(m => m.deleteEnquiry(context, input))
    : input.action === 'deleteCourse' ? import('./training-files-server').then(m => m.deleteCourse(context, input))
    // Removing a reported chat message also deletes its stored photos and videos.
    : input.action === 'decideChatReport' && input.decision === 'remove' ? import('./chat-media-server').then(m => m.decideChatReport(context, input)) : null,
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
