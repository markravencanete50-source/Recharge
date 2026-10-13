import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The public New Property Enquiry Form (app/enquiry): a select's open list must be readable in both
// themes, a field shows focus once (its frame), autofill paints no box, and nothing on a field moves.
const css = readFileSync('app/globals.css', 'utf8');
const form = readFileSync('app/enquiry/enquiry-form.tsx', 'utf8');
const rule = selector => {
  const at = css.indexOf(selector + ' {');
  assert.ok(at >= 0, 'missing rule: ' + selector);
  return css.slice(at, css.indexOf('}', at));
};

test("the select's options have the page's colours set explicitly, and the list follows the dark theme", () => {
  const options = rule('.enquiry-form select option, .enquiry-form select optgroup');
  assert.match(options, /background-color: var\(--rc-surface\)/);
  assert.match(options, /color: var\(--rc-text\)/);
  assert.match(rule(':root.dark .enquiry-form select, [data-recharge-theme="dark"] .enquiry-form select'), /color-scheme: dark/);
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
