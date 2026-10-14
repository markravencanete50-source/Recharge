import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'vite';

// Direct pop-ups (Lee, 14 October): the pop-up names the person it is for, who sent it and what it says.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { pushCopy } = await vite.ssrLoadModule('/lib/push-copy.ts');

test('a guest message names the person it is for, the guest, the property and the message', () => {
  assert.deepEqual(pushCopy('guest.message', null, { recipient: 'Mark Raven', who: 'John Smith', propertyName: 'Rose Cottage', preview: 'What time is check-in?' }),
    { title: 'Mark, new guest message from John Smith', message: 'Rose Cottage: What time is check-in?' });
  assert.equal(pushCopy('guest.message', null, { recipient: 'Alex Coghill', who: 'John', replied: true }).title, 'Alex, John (guest) replied');
});

test('team chat, owner chat and client email say who and what', () => {
  assert.deepEqual(pushCopy('chat.message', null, { recipient: 'Mark', who: 'Alex Coghill', preview: 'Can you call the owner?' }),
    { title: 'Mark, Alex Coghill sent you a message', message: 'Can you call the owner?' });
  assert.equal(pushCopy('chat.message', null, { recipient: 'Mark', who: 'Alex', context: 'Management' }).title, 'Mark, Alex in Management');
  assert.equal(pushCopy('chat.owner_message', null, { recipient: 'Mark', who: 'Sarah Jones', preview: 'The boiler is fixed' }).title, 'Mark, Sarah Jones (owner) sent a message');
  assert.deepEqual(pushCopy('client.email', null, { recipient: 'Mark', who: 'Sarah Jones', preview: 'Managing my flat' }),
    { title: 'Mark, new email from Sarah Jones', message: 'Managing my flat' });
  assert.equal(pushCopy('client.email', null, { recipient: 'Mark', who: 'Sarah', replied: true }).title, 'Mark, Sarah replied by email');
});

test('work notices keep their wording, with the name in front and who, what and where below', () => {
  const todo = pushCopy('hub.todo_added', null, { recipient: 'Mark', actorName: 'Alex', workTitle: 'Call the plumber', propertyName: 'Rose Cottage' });
  assert.equal(todo.title, 'Mark, new to-do for you');
  assert.equal(todo.message, 'Alex · Call the plumber · Rose Cottage');
});

test('without details it falls back to the general wording, never "Sign in to see the details", and long text is cut', () => {
  const bare = pushCopy('guest.message');
  assert.equal(bare.title, 'New guest message');
  assert.doesNotMatch(bare.message, /Sign in to Recharge/);
  const long = pushCopy('chat.message', null, { recipient: 'Mark', who: 'Alex', preview: 'x'.repeat(400) });
  assert.ok(long.message.length <= 180 && long.message.endsWith('…'));
});
