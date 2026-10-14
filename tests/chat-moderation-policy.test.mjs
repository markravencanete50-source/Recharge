import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// What a report or a block may carry, the labels people read, and where the admins find Reported
// messages (left panel, search, notices).
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { chatActionSchema, chatReadSchema, messageSchema, REPORT_REASONS, MAX_REPORT_NOTE } = await vite.ssrLoadModule('/lib/workspace-chat-policy.ts');
const { teamsActionSchema, teamsReadSchema } = await vite.ssrLoadModule('/lib/workspace-teams-policy.ts');
const moderation = await vite.ssrLoadModule('/lib/chat-moderation.ts');
const { noticeCopy } = await vite.ssrLoadModule('/lib/notice-copy.ts');
const { rolePanel } = await vite.ssrLoadModule('/lib/role-panel.ts');
const search = await vite.ssrLoadModule('/lib/workspace-search.ts');
const { DEFAULT_ROLE_MODULES, MODULE_IDS } = await vite.ssrLoadModule('/lib/modules.ts');
after(() => vite.close());
const id = '11111111-1111-4111-8111-111111111111';

test('reports and blocks are strict requests', () => {
  assert.deepEqual([...REPORT_REASONS], ['offensive', 'harassment', 'media', 'spam', 'other']);
  assert.deepEqual(REPORT_REASONS.map(r => moderation.REPORT_REASON_LABEL[r]), ['Offensive or abusive', 'Harassment', 'Inappropriate photo or video', 'Spam', 'Something else']);
  assert.ok(chatActionSchema.safeParse({ action: 'reportMessage', requestId: id, messageId: id, reason: 'spam' }).success, 'a note is optional');
  assert.ok(chatActionSchema.safeParse({ action: 'reportMessage', requestId: id, messageId: id, reason: 'other', note: 'x'.repeat(MAX_REPORT_NOTE) }).success);
  assert.ok(!chatActionSchema.safeParse({ action: 'reportMessage', requestId: id, messageId: id, reason: 'other', note: 'x'.repeat(MAX_REPORT_NOTE + 1) }).success, 'notes stop at 500 characters');
  assert.ok(!chatActionSchema.safeParse({ action: 'reportMessage', requestId: id, messageId: id, reason: 'rude' }).success, 'one of the listed reasons');
  assert.ok(!chatActionSchema.safeParse({ action: 'reportMessage', messageId: id, reason: 'spam' }).success, 'a request id, so a retry never reports twice');
  assert.ok(!chatActionSchema.safeParse({ action: 'reportMessage', requestId: id, messageId: id, reason: 'spam', userId: id }).success, 'no extra fields');
  assert.ok(chatActionSchema.safeParse({ action: 'blockUser', userId: id }).success && chatActionSchema.safeParse({ action: 'unblockUser', userId: id }).success);
  assert.ok(!chatActionSchema.safeParse({ action: 'blockUser' }).success && !chatActionSchema.safeParse({ action: 'blockUser', userId: id, reason: 'x' }).success);
  assert.ok(chatReadSchema.safeParse({ section: 'blocks' }).success && !chatReadSchema.safeParse({ section: 'blocks', conversationId: id }).success);
  assert.ok(teamsReadSchema.safeParse({ section: 'chatReports' }).success);
  assert.ok(teamsActionSchema.safeParse({ action: 'decideChatReport', requestId: id, reportId: id, version: 1, decision: 'remove' }).success);
  assert.ok(teamsActionSchema.safeParse({ action: 'decideChatReport', requestId: id, reportId: id, version: 1, decision: 'dismiss' }).success);
  for (const bad of [{ decision: 'ban' }, { version: 0 }, { reportId: 'x' }, { note: 'hi' }]) assert.ok(!teamsActionSchema.safeParse({ action: 'decideChatReport', requestId: id, reportId: id, version: 1, decision: 'remove', ...bad }).success, JSON.stringify(bad));
});

test('older servers\' messages still read: removed and blocked default to false', () => {
  const m = messageSchema.parse({ id, body: 'Hi', at: '2026-10-12T09:00:00Z', mine: false, authorName: 'Ewan' });
  assert.deepEqual([m.removed, m.blocked], [false, false]);
  assert.equal(messageSchema.parse({ ...m, removed: true, body: '' }).removed, true);
});

test('the words people read', () => {
  assert.equal(moderation.REPORT_THANKS, 'Thanks. An admin will review this.');
  assert.equal(moderation.REMOVED_LABEL, 'Removed by an admin');
  assert.equal(moderation.BLOCKED_LABEL, 'Message from someone you blocked');
  assert.deepEqual(moderation.REPORT_STATUSES.map(s => moderation.REPORT_STATUS_LABEL[s]), ['Open', 'Message removed', 'Dismissed']);
  assert.ok(moderation.canModerateChat('admin') && moderation.canModerateChat('super_admin'));
  for (const role of ['stays', 'cleans', 'accounts', 'client', 'ready', 'cleaning_manager']) assert.ok(!moderation.canModerateChat(role), role);
  assert.deepEqual(moderation.reportCounts([{ status: 'open' }, { status: 'open' }, { status: 'actioned' }, { status: 'dismissed' }]), { open: 2, actioned: 1, dismissed: 1, all: 4 });
  assert.equal(moderation.attachmentSummary([]), '');
  assert.equal(moderation.attachmentSummary([{ kind: 'image' }]), '1 photo');
  assert.equal(moderation.attachmentSummary([{ kind: 'image' }, { kind: 'image' }, { kind: 'video' }]), '2 photos and 1 video');
  assert.equal(moderation.attachmentSummary([], 3), '3 photos or videos', 'after removal only the count is left');
});

test('reporters and senders are told the outcome, without names', () => {
  for (const type of ['chat.report_reviewed', 'chat.report_removed', 'chat.message_removed']) {
    const copy = noticeCopy(type);
    assert.notEqual(copy.title, noticeCopy('nothing.here').title, type);
    assert.doesNotMatch(copy.message, /@|£|\d{4}/, type);
  }
  assert.equal(noticeCopy('chat.report_removed').title, 'Your report was reviewed');
  assert.equal(noticeCopy('chat.message_removed').title, 'An admin removed one of your messages');
});

test('admins are told, and find Reported messages in the left panel and search', () => {
  const copy = noticeCopy('chat.reported');
  assert.equal(copy.title, 'A message was reported');
  assert.match(copy.message, /Reported messages/);
  assert.doesNotMatch(copy.message, /@|£|\d{4}/, 'no names, places or money in a notification');
  const hasLink = (role) => rolePanel(role, DEFAULT_ROLE_MODULES[role]).groups.flatMap(g => g.links).find(l => l.key === 'page:moderation');
  for (const role of ['admin', 'super_admin']) assert.deepEqual([hasLink(role)?.label, hasLink(role)?.section], ['Reported messages', 'moderation'], role);
  for (const role of Object.keys(DEFAULT_ROLE_MODULES).filter(r => r !== 'admin' && r !== 'super_admin')) assert.equal(hasLink(role), undefined, role);
  const index = role => search.buildSearchIndex({ role, modules: MODULE_IDS, properties: [], work: [], invoices: [] });
  for (const role of ['admin', 'super_admin']) assert.equal(search.searchWorkspace(index(role), 'reported').groups[0].entries[0].key, 'section:moderation', role);
  assert.equal(search.searchWorkspace(index('super_admin'), 'abusive').groups[0].entries[0].key, 'section:moderation', 'other words for the same place');
  for (const role of ['stays', 'cleans', 'client']) assert.ok(!index(role).some(e => e.key === 'section:moderation'), role);
});
