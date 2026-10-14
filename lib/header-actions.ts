import { unreadNotices } from './workspace-view';

// The Updates bell in the workspace header (round 5, from Session C's Messages redesign): on desktop and the
// phone, for every role. Its badge is the number of unread notices; it opens the Updates feed, which is the
// section "activity" (for the team that lands on Messages showing the feed; owners get their Updates page).
export const UPDATES_SECTION = 'activity' as const;
export function updatesBell(notices: readonly { id: number; read_at?: string | null }[]) {
  const count = unreadNotices([...notices]).length;
  return { count, badge: count > 99 ? '99+' : String(count), label: count ? `Updates, ${count} unread` : 'Updates', section: UPDATES_SECTION };
}

// The phone header (round 6, from E's design review): the logo is never covered. Menu, the bell, Messages and the
// profile avatar always show; the other buttons (Search, View as, Refresh, the dark-mode switch) show only while
// the logo keeps at least logoMin (88), and otherwise move to the top of the Menu. Pull to refresh still works on phones.
// Sizes: IconButton 46 wide, the avatar 44, 8 between them; 20 padding each side and 12 before the buttons.
export const PHONE_HEADER = { padding: 40, gap: 12, button: 46, avatar: 44, between: 8, logoMin: 88, logoMax: 144 } as const;
export type HeaderExtra = 'search' | 'viewAs' | 'refresh' | 'theme';
export const HEADER_EXTRA_LABEL: Record<HeaderExtra, string> = { search: 'Search', viewAs: 'View as someone else', refresh: 'Refresh', theme: 'Dark mode' };
const ALWAYS = 3; // Menu, the bell and Messages; the avatar is counted on its own.
const rowWidth = (buttons: number) => buttons * (PHONE_HEADER.button + PHONE_HEADER.between) + PHONE_HEADER.avatar;
export function phoneHeader(width: number, has: { search: boolean; viewAs: boolean }) {
  const offered: HeaderExtra[] = [...(has.search ? ['search' as const] : []), ...(has.viewAs ? ['viewAs' as const] : []), 'refresh', 'theme'];
  const room = (extras: number) => width - PHONE_HEADER.padding - PHONE_HEADER.gap - rowWidth(ALWAYS + extras);
  let shown = 0;
  while (shown < offered.length && room(shown + 1) >= PHONE_HEADER.logoMin) shown++;
  return {
    inHeader: offered.slice(0, shown), inMenu: offered.slice(shown),
    // Never under the buttons: on phones narrower than 346 the logo shrinks to the room left instead.
    logoWidth: Math.max(48, Math.min(PHONE_HEADER.logoMax, room(shown))),
  };
}
