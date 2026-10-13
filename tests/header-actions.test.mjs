import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// Round 5, from Session C's Messages redesign: an Updates bell in the header for every role (unread notice count,
// opens the Updates feed), and pull to refresh on phones calling the workspace's quiet refresh.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { updatesBell, UPDATES_SECTION } = await vite.ssrLoadModule('/lib/header-actions.ts');
const { PAGE_SECTIONS } = await vite.ssrLoadModule('/lib/workspace-map.ts');
const workspace = readFileSync('mobile/src/LiveWorkspace.tsx', 'utf8');
const ROLES = ['super_admin', 'admin', 'stays', 'cleaning_manager', 'cleans', 'ready', 'accounts', 'client'];
const notice = (id, read) => ({ id, read_at: read ? '2026-10-15T09:00:00Z' : null });

test('the bell counts unread notices, for every role', () => {
  // The same notices give the same count whoever is signed in: the bell is not tied to a role.
  for (const role of ROLES) {
    const bell = updatesBell([notice(1, false), notice(2, true), notice(3, false)]);
    assert.deepEqual([bell.count, bell.badge, bell.label], [2, '2', 'Updates, 2 unread'], role);
  }
  assert.deepEqual(updatesBell([]), { count: 0, badge: '0', label: 'Updates', section: 'activity' });
  assert.equal(updatesBell([notice(9, true)]).count, 0);
  assert.equal(updatesBell(Array.from({ length: 140 }, (_, i) => notice(i, false))).badge, '99+');
});

test('the bell is in the header for every role, on desktop and the phone, with its badge', () => {
  const at = workspace.indexOf('<IconButton label={bell.label} icon="bell" palette={header} onPress={() => navigate(bell.section)} />');
  assert.ok(at > 0, 'the bell button');
  // Not inside a role or screen-size condition: the line has no `team &&`, `desktop &&` or role check in front of it.
  const line = workspace.slice(workspace.lastIndexOf('\n', at), at);
  assert.doesNotMatch(line, /team|desktop|role|&&/);
  assert.match(workspace, /\{bell\.count > 0 && <Bump value=\{bell\.count\}[^]*?\{bell\.badge\}<\/Text>/);
  assert.match(workspace, /const bell = updatesBell\(notices\);/);
});

test('the bell opens the Updates feed', () => {
  assert.equal(UPDATES_SECTION, 'activity');
  assert.ok(PAGE_SECTIONS.includes('activity'), 'a page every role can open');
  // For the team, "activity" opens Messages showing the feed; owners get the Updates page itself.
  assert.match(workspace, /if \(value === "activity" && team\) \{ openLink\(\{ section: "inbox", messagesTab: "updates" \}\); return; \}/);
  assert.match(workspace, /tab === "activity" \? <LiveActivity /);
});

test('pull to refresh on the phone calls the quiet refresh', () => {
  assert.match(workspace, /import \{[^}]*RefreshControl[^}]*\} from "react-native";/);
  assert.match(workspace, /refreshControl=\{desktop \? undefined : <RefreshControl refreshing=\{pulling\} onRefresh=\{\(\) => void pullToRefresh\(\)\}/);
  assert.match(workspace, /const pullToRefresh = useCallback\(async \(\) => \{ setPulling\(true\); try \{ await refresh\(true\); \} finally \{ setPulling\(false\); \} \}, \[refresh\]\);/);
});
