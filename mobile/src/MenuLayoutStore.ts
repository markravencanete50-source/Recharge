import type { MenuLayout } from "../../lib/menu-layout";

// After "Save and publish" in Access control → Menu order, the editor's own app shows the new order at once:
// the editor publishes the saved layout here and the workspace, if it is showing that role, takes it.
// Everyone else picks it up on the workspace's one-minute quiet refresh (or when they reopen the app).
type Listener = (role: string, layout: MenuLayout | null) => void;
const listeners = new Set<Listener>();
export function onMenuLayoutSaved(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function publishMenuLayout(role: string, layout: MenuLayout | null) {
  for (const listener of listeners) listener(role, layout);
}
