import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// The public New Property Enquiry Form (app/enquiry): always light (Alex), a select's open list is readable, a field
// shows focus once (its frame), autofill paints no box, and nothing on a field moves.
const css = readFileSync('app/globals.css', 'utf8');
const themeCss = readFileSync('app/workspace-theme.css', 'utf8');
const form = readFileSync('app/enquiry/enquiry-form.tsx', 'utf8');
const page = readFileSync('app/enquiry/page.tsx', 'utf8');
const shell = readFileSync('components/auth-shell.tsx', 'utf8');
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
const { designTokenCss } = await vite.ssrLoadModule('/lib/design-tokens.ts');
after(() => vite.close());
const rule = selector => {
  const at = css.indexOf(selector + ' {');
  assert.ok(at >= 0, 'missing rule: ' + selector);
  return css.slice(at, css.indexOf('}', at));
};

test("the select's options have the page's colours set explicitly, and the list is light like the form", () => {
  const options = rule('.enquiry-form select option, .enquiry-form select optgroup');
  assert.match(options, /background-color: var\(--rc-surface\)/);
  assert.match(options, /color: var\(--rc-text\)/);
  assert.doesNotMatch(css, /\.enquiry-form select[^{]*\{ color-scheme: dark/, 'no dark list on the enquiry form');
});

test('the enquiry form is always light, whatever the browser or the app is set to', () => {
  // Every state of the page (the form, thank you, expired, closed) uses the one shell, pinned light.
  assert.match(page, /wide theme="light">\{body\}<\/AuthShell>/);
  assert.equal((page.match(/<AuthShell /g) ?? []).length, 1);
  assert.match(shell, /<main className="auth-page" data-recharge-theme=\{theme\}>/);
  // The frame takes the light tokens (they also apply to [data-recharge-theme="light"], not only to a light :root), and the
  // dark theme's tokens apply only to a dark :root or a dark frame.
  assert.match(designTokenCss, /,\[data-recharge-theme="light"\]\{--rc-background:/);
  assert.match(designTokenCss, /:root\.dark:not\(\[data-recharge-theme="light"\]\),\[data-recharge-theme="dark"\]\{/);
  // The older palette (danger and warning colours, the page background) follows, and so does the page behind the frame,
  // above the dark theme's own :root rules.
  assert.match(themeCss, /:root:not\(\.dark\), \[data-recharge-theme="light"\], html:root:has\(\.auth-page\[data-recharge-theme="light"\]\) \{/);
  assert.match(rule('html:root:has(.auth-page[data-recharge-theme="light"])'), /color-scheme: light/);
});

test('no correspondence address and no "existing client" question on the form', () => {
  assert.doesNotMatch(form, /correspondenceAddress|existingClient|Correspondence address|existing client/i);
});

test('autofill paints no coloured box: the field\'s own background and text, and a long transition delay', () => {
  const autofill = rule('.enquiry-form .auth-control :is(input, textarea, select):is(:-webkit-autofill, :-webkit-autofill:hover, :-webkit-autofill:focus, :autofill)');
  assert.match(autofill, /-webkit-box-shadow: 0 0 0 1000px var\(--rc-background\) inset !important/);
  assert.match(autofill, /-webkit-text-fill-color: var\(--rc-text\)/);
  assert.match(autofill, /transition: background-color 600000s 0s/);
});

test('one focus style: the frame; no outline or box inside it, and no motion on the fields', () => {
  assert.match(rule('.enquiry-form .auth-control :is(input, textarea, select):is(:focus, :focus-visible)'), /outline: none !important; box-shadow: none !important/);
  assert.match(rule('.enquiry-form .auth-control'), /transition: none/);
  assert.match(rule('.auth-control:focus-within'), /border-color: var\(--rc-primary\)/, 'the frame still shows focus');
  // The app-wide focus outline (lib/design-tokens.ts) is switched off for fields whose frame shows focus.
  assert.match(form, /<div className="auth-control" data-bare-input="true">/);
});

test('the choices on the form follow the rule: long lists are styled native selects, yes/no are pills', () => {
  for (const field of ['propertyType', 'bedrooms', 'wcs', 'bathrooms', 'startWhen', 'enquiryType']) assert.match(form, new RegExp(`<select \\{\\.\\.\\.input\\("${field}"\\)\\}>`), field);
  assert.doesNotMatch(form, /from "@\/mobile|Dropdown/, 'plain HTML here, not the app\'s Dropdown');
});
