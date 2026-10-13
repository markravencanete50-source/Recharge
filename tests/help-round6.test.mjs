import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// Help and FAQ for what round 6 changed (round 7): each answer reaches the people it is about, in plain short sentences.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { faqsForAccess } = await vite.ssrLoadModule('/lib/access-faq.ts');
const { MODULES } = await vite.ssrLoadModule('/lib/modules.ts');
const ALL = MODULES.map(m => m.id);
const ids = role => faqsForAccess(role, ALL).map(f => f.id);
const ROUND6 = ['updates-titles', 'favorites-menu', 'choice-lists', 'messages-status', 'management-checklist', 'enquiry-delete', 'management-bonus'];

test('who sees which round 6 answer', () => {
  for (const role of ['admin', 'super_admin']) assert.deepEqual(ROUND6.filter(id => ids(role).includes(id)), ROUND6, role);
  // Everyone: the updates, Favorites and the dropdowns.
  for (const role of ['client', 'cleans', 'ready', 'accounts', 'stays', 'cleaning_manager']) for (const id of ['updates-titles', 'favorites-menu', 'choice-lists']) assert.ok(ids(role).includes(id), `${role}: ${id}`);
  // Owners get nothing about team statuses, the checklist, deleting enquiries or bonuses.
  for (const id of ['messages-status', 'management-checklist', 'enquiry-delete', 'management-bonus']) assert.ok(!ids('client').includes(id), `client: ${id}`);
  assert.ok(ids('stays').includes('messages-status') && ids('stays').includes('management-bonus'));
  assert.ok(!ids('stays').includes('enquiry-delete') && !ids('stays').includes('management-checklist'));
  assert.ok(!ids('cleans').includes('messages-status'));
});

test('the words match what was built', () => {
  const faq = Object.fromEntries(faqsForAccess('super_admin', ALL).map(f => [f.id, f]));
  assert.match(faq['messages-status'].answer, /Engaged: we wrote last and the conversation is still open\./);
  assert.match(faq['management-checklist'].question, /Today’s checklist/);
  assert.match(faq['enquiry-delete'].answer, /Delete enquiry/);
  assert.match(faq['favorites-menu'].answer, /first section of the menu, straight after Home/);
  assert.match(faq['management-bonus'].answer, /Guest relations: guest messages answered within five minutes\. Client relations: daily work done against its targets\./);
  assert.match(faq['updates-titles'].answer, /“Repair: Boiler not working”/);
  assert.match(faq['updates-titles'].answer, /Show older updates/);
  for (const id of ROUND6) {
    const { question, answer } = faq[id];
    assert.doesNotMatch(question + answer, /—|–/, `${id}: no dashes`);
    // Plain short sentences: none longer than 40 words.
    for (const sentence of answer.split(/(?<=[.!?])\s+/)) assert.ok(sentence.split(/\s+/).length <= 40, `${id}: ${sentence}`);
  }
  // The old status name appears only where the answer says it was renamed.
  const all = faqsForAccess('super_admin', ALL).map(f => f.answer).join(' ');
  assert.equal((all.match(/Waiting for reply/g) ?? []).length, 1);
  assert.match(all, /Engaged used to be called Waiting for reply\./);
});
