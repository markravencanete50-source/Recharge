import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

// Alex, on a phone: "Do you think we could have the message box work the same as WhatsApp, where it's always down the
// bottom?" An open conversation on a phone fills the screen over the header and the bottom bar (Lee: hide the bar, like
// WhatsApp), only the messages scroll, the box sits at the bottom of what the keyboard leaves, grows to about five lines,
// and new messages keep you at the newest unless you have scrolled up, when a "New messages" pill shows instead.
const chat = await fs.readFile('mobile/src/LiveChat.tsx', 'utf8'), workspace = await fs.readFile('mobile/src/LiveWorkspace.tsx', 'utf8');

test('a phone opens a chat conversation full screen, over the bottom bar, sized to what the keyboard leaves', () => {
  assert.match(chat, /function PhoneConversation\(/);
  assert.match(chat, /const vv = window\.visualViewport;\s*\r?\n\s*return vv \? \{ top: Math\.max\(0, vv\.offsetTop\), height: vv\.height \}/, 'the visual viewport (iPhone Safari, Android, the installed app)');
  assert.match(chat, /vv\?\.addEventListener\("resize", update\); vv\?\.addEventListener\("scroll", update\)/);
  assert.match(chat, /<Modal visible transparent animationType="none" onRequestClose=\{onBack\}>/, 'over the header and the bottom bar');
  assert.match(chat, /<KeyboardAvoidingView behavior=\{Platform\.OS === "ios" \? "padding" : "height"\}/, 'the phone app lifts it above the keyboard too');
  assert.match(chat, /const fullScreen = !desktop && !!open && !open\.startsWith\("email:"\) && \(owner \? !!onLeave : phoneThread\);/, 'team and owner chats on a phone; emails and desktop stay in the page');
  assert.match(chat, /\{fullScreen && open && <PhoneConversation p=\{p\} onBack=\{owner \? onLeave! : back\}>\{thread\(open, owner \? onLeave : back, true\)\}<\/PhoneConversation>\}/);
  assert.match(workspace, /onLeave=\{\(\) => navigate\("home"\)\}/, "an owner's back arrow goes Home (their Messages is the one conversation)");
  assert.doesNotMatch(chat, /WhatsApp/i, 'WhatsApp is not a guest channel here (tests/guest-inbox-policy.test.mjs)');
});

test('only the messages scroll, the box grows to about five lines, and new messages keep you at the newest', () => {
  assert.match(chat, /const INPUT_LINE = 22, INPUT_MIN = 48, INPUT_MAX = INPUT_MIN \+ 4 \* INPUT_LINE;/);
  assert.match(chat, /maxHeight: INPUT_MAX/);
  assert.match(chat, /onContentSizeChange=\{\(\) => \{ if \(atEnd\.current\) toEnd\(\); \}\} onLayout=\{\(\) => \{ if \(atEnd\.current\) toEnd\(\); \}\}/, 'stays at the newest when the keyboard opens or a photo loads');
  assert.match(chat, /if \(first \|\| atEnd\.current \|\| newest\?\.mine\) \{ atEnd\.current = true;[^\n]*\r?\n\s*else setUnseen\(true\);/, 'opens at the newest; scrolled up, a pill instead of a jump');
  assert.match(chat, /<Text style=\{\{ color: p\.onPrimary, fontSize: 13, fontWeight: "600" \}\}>New messages<\/Text>/);
  assert.match(chat, /maxHeight: !screen && Platform\.OS === "web" \? 560 : undefined/, 'desktop keeps its conversation height');
  // Searching the list finds a conversation by its newest message too.
  assert.match(chat, /r\.c\.last\?\.authorName, r\.c\.last\?\.body,/);
});
