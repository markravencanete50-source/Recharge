// "In demo, this would be sent to …": what the demo backend would have sent to an outside service
// (email, phone notifications, Hostaway), shown quietly in the demo banner instead. Also tells the
// banner when the demo's records changed outside a screen's own request (Reset, automatic jobs).
type Listener = (notes: string[]) => void;
const listeners = new Set<Listener>();
export function emitDemoNotes(notes: string[]) { for (const listener of listeners) listener(notes); }
export function subscribeDemoNotes(listener: Listener) { listeners.add(listener); return () => { listeners.delete(listener); }; }

const changed = new Set<() => void>();
export function emitDemoChanged() { for (const listener of changed) listener(); }
// For screens that want to load again after Reset or "Run today's automatic jobs".
export function onDemoChanged(listener: () => void) { changed.add(listener); return () => { changed.delete(listener); }; }
