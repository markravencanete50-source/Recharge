import { isWorkspaceAdmin, type WorkspaceRole } from "./modules";
export function canManageAccess(actor: WorkspaceRole, target?: WorkspaceRole, next?: WorkspaceRole) {
  if (actor === "super_admin") return true;
  return actor === "admin" && !isWorkspaceAdmin(target) && !isWorkspaceAdmin(next);
}
