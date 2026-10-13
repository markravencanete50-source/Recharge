import { unreadNotices } from './workspace-view';

// The Updates bell in the workspace header (round 5, from Session C's Messages redesign): on desktop and the
// phone, for every role. Its badge is the number of unread notices; it opens the Updates feed, which is the
// section "activity" (for the team that lands on Messages showing the feed; owners get their Updates page).
export const UPDATES_SECTION = 'activity' as const;
export function updatesBell(notices: readonly { id: number; read_at?: string | null }[]) {
  const count = unreadNotices([...notices]).length;
  return { count, badge: count > 99 ? '99+' : String(count), label: count ? `Updates, ${count} unread` : 'Updates', section: UPDATES_SECTION };
}
