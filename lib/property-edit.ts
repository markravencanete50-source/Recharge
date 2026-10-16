import { isWorkspaceAdmin } from './modules';
import { PROPERTY_ADDRESS_MAX, PROPERTY_NAME_MAX } from './portfolio-policy';
import type { FieldIssue } from './journey-policy';
import type { WorkflowForm } from './workflow-forms';
import type { WorkspaceAccount } from './workspace-account-policy';
import type { PropertyView } from './workspace-view';

// Edit a property's name and address from Properties (Alex). Admins and super admins edit any property; Stays edit the
// properties they are on, with the property database tool. Owners, cleaners and contractors never see the button, and the
// database refuses them anyway (private.workspace_portfolio_action, action 'saveNameAddress', migration 20261022800000).
// Admins still change the region, bedrooms and status in Management, Properties.
export function canEditPropertyDetails(account: Pick<WorkspaceAccount, 'role' | 'modules'>): boolean {
  return isWorkspaceAdmin(account.role) || (account.role === 'stays' && account.modules.includes('property-database'));
}

// Each problem with the name and address, by field, before anything is sent. The same limits the database keeps.
export function propertyEditIssues(values: Record<string, unknown>): FieldIssue[] {
  const name = String(values.name ?? '').trim(), address = String(values.address ?? '').trim(), issues: FieldIssue[] = [];
  if (name.length < 2) issues.push({ field: 'name', message: 'Give the property a name of at least 2 characters' });
  else if (name.length > PROPERTY_NAME_MAX) issues.push({ field: 'name', message: `Keep the name to ${PROPERTY_NAME_MAX} characters or fewer` });
  if (!address) issues.push({ field: 'address', message: 'Add the property\'s address' });
  else if (address.length > PROPERTY_ADDRESS_MAX) issues.push({ field: 'address', message: `Keep the address to ${PROPERTY_ADDRESS_MAX} characters or fewer` });
  return issues;
}

// The form behind "Edit name and address", filled with what the property has now. The version it was opened at goes with
// the save, so a change someone else made in the meantime is never overwritten ("Property changed. Refresh and try again").
export function propertyEditForm(property: Pick<PropertyView, 'id' | 'name' | 'address' | 'version'>): WorkflowForm {
  return {
    key: 'saveNameAddress', title: 'Edit name and address', endpoint: 'portfolio',
    description: 'The name and address the team, owners and reports see. A Hostaway listing keeps its own name in Hostaway.',
    fields: [
      { name: 'name', label: 'Property name', type: 'text', required: true, defaultValue: property.name, help: 'A short name the team will recognise, for example "Leith Walk flat".' },
      { name: 'address', label: 'Full property address', type: 'textarea', required: true, defaultValue: property.address, lookup: 'postcode', help: 'Include the postcode. An area worked out from the old address is worked out again from the new one.' },
    ],
    checks: propertyEditIssues,
    build: (values, requestId) => ({ action: 'saveNameAddress', requestId, propertyId: property.id, version: property.version, name: String(values.name ?? '').trim(), address: String(values.address ?? '').trim() }),
  };
}
