import type { CleansData } from "./cleans-types";
import type { WorkspaceRole } from "./modules";

export function scopeCleanerData(viewer: { role: WorkspaceRole; email: string }, data: CleansData): CleansData {
  if (viewer.role !== "cleans") return data;
  const email = viewer.email.trim().toLowerCase();
  const cleaners = data.cleaners.filter(cleaner => cleaner.status === "active" && Boolean(email) && cleaner.email.trim().toLowerCase() === email);
  const ids = new Set(cleaners.map(cleaner => cleaner.id));
  const tickets = data.tickets.filter(ticket => Boolean(ticket.assignedCleanerId && ids.has(ticket.assignedCleanerId)));
  const propertyIds = new Set(tickets.map(ticket => ticket.propertyId));
  return {
    ...data,
    cleaners: cleaners.map(cleaner => ({ ...cleaner, notes: "" })),
    properties: data.properties.filter(property => Boolean(property.cleanerId && ids.has(property.cleanerId)) || propertyIds.has(property.id))
      .map(property => ({ ...property, clientName: "", clientEmail: "" })),
    tickets,
    mail: [], replenishments: [], reviews: [], onboarding: [],
  };
}

export function assertCleanerAction(role: WorkspaceRole, action: string) {
  if (role === "cleans" && !["start_clean", "submit_clean", "upload_evidence"].includes(action)) {
    throw new Error("Cleaning manager access required for this action");
  }
}
