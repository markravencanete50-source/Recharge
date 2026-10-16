import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServer } from 'vite';

// Session E's design review, the items given to Session A: pills use the `selected` tokens, the payout row's Approve
// button has an edge, Accounts' six sections are a dropdown, the New expense sheet uses a date field and a category
// dropdown, and the step tick sits on success in `onSuccess`.
const vite = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false } });
after(() => vite.close());
const { designTokens } = await vite.ssrLoadModule('/lib/design-tokens.ts');
const { contrastRatio } = await vite.ssrLoadModule('/lib/contrast.ts');
const { pillsMode } = await vite.ssrLoadModule('/lib/pills.ts');
const src = name => readFileSync('mobile/src/' + name, 'utf8');

test('1. every pill draws a chosen pill with the selected tokens and an unchosen one with controlBorder', () => {
  const pills = src('Pills.tsx');
  assert.match(pills, /export const pillBox = \(p: Palette, on: boolean\) => \(\{ borderWidth: 1, borderColor: on \? p\.selectedBorder : p\.controlBorder, backgroundColor: on \? p\.selected : p\.surface \}\);/);
  assert.match(pills, /export const pillInk = \(p: Palette, on: boolean, muted = false\) => on \? p\.onSelected : muted \? p\.muted : p\.text;/);
  for (const file of ['Pills.tsx', 'PayoutStays.tsx', 'SheetTable.tsx', 'LivePortfolio.tsx']) {
    const text = src(file);
    assert.match(text, /pillBox\(p, on\)/, file);
    assert.doesNotMatch(text, /backgroundColor: on \? p\.primary|on \? primaryFill\(p\)/, file + ': no solid primary block');
  }
  // The selected label reads on the selected fill in both themes (4.5:1 for 13px text).
  for (const mode of ['light', 'dark']) {
    const t = designTokens[mode];
    assert.ok(contrastRatio(t.onSelected, t.selected) >= 4.5, mode + ' onSelected on selected');
    assert.ok(contrastRatio(t.text, t.surface) >= 4.5, mode + ' text on an unchosen pill');
  }
});

test('2. the Approve button on a payout row has a visible edge', () => {
  assert.match(src('PayoutStays.tsx'), /backgroundColor: busy \? p\.elevated : p\.wash, borderWidth: 1, borderColor: busy \? p\.border : p\.washBorder/);
});

test('3. Accounts: its six sections are one dropdown for finance roles, pills for the three others see', () => {
  const accounts = src('LiveAccounts.tsx');
  assert.match(accounts, /\{!alone && <Pills p=\{p\} title="Choose an accounts tool" showTitle value=\{view\} onChange=\{setView\} label=\{v => TAB_LABEL\[v\]\}/);
  assert.doesNotMatch(accounts, /<Button key="performance"|<Button key="aircover"/);
  assert.equal(pillsMode(6), 'dropdown');
  assert.equal(pillsMode(3), 'pills');
});

test('4. New expense: a date field for the day received and a dropdown for the category', () => {
  const payable = src('AccountsPayable.tsx');
  assert.doesNotMatch(payable, /Received on \(YYYY-MM-DD\)/);
  assert.match(payable, /<DateField p=\{p\} label="Received on" mode="single" value=\{\{ from: receivedOn, to: receivedOn \}\} onChange=\{v => setReceivedOn\(v\.from\)\}/);
  assert.match(payable, /<Dropdown p=\{p\} label="Category" value=\{category\} onChange=\{setCategory\} options=\{EXPENSE_CATEGORIES\.map/);
});

test('11. the step tick on a success fill uses onSuccess', () => {
  const flows = src('AccountsFlows.tsx');
  assert.match(flows, /<Feather name="check" size=\{13\} color=\{p\.onSuccess\} \/>/);
  assert.doesNotMatch(flows, /name="check" size=\{13\} color="#FFFFFF"/);
});

test('17. the cleaner invoice date in AccountsPayable is a date field; no typed YYYY-MM-DD dates are left there', () => {
  const payable = src('AccountsPayable.tsx');
  assert.doesNotMatch(payable, /YYYY-MM-DD/);
  assert.match(payable, /<DateField p=\{p\} label="Invoice date" mode="single" value=\{\{ from: invoiceDate, to: invoiceDate \}\} onChange=\{v => setInvoiceDate\(v\.from\)\}/);
});

test('20. the phone Accounts summary tiles: one fill and short one-line labels', () => {
  const accounts = src('LiveAccounts.tsx');
  assert.match(accounts, /const TILE_SHORT: Record<string, string> = \{ "To approve": "Approve", "To reconcile": "Reconcile", "Statements paid": "Paid" \};/);
  assert.match(accounts, /label=\{phone \? TILE_SHORT\[tile\.label\] \?\? tile\.label : tile\.label\}/);
  assert.match(accounts, /attention=\{!phone && tile\.attention\}/);
});

test('14 and 15. Client relations (up to 8) goes through Pills, so it is a dropdown; Management lists its tools as cards', async () => {
  const { CLIENT_RELATIONS_SUBS } = await vite.ssrLoadModule('/lib/workspace-map.ts');
  assert.match(src('ClientRelations.tsx'), /<Pills p=\{p\} title="Choose a client relations tool" showTitle values=\{subs\}/);
  // Lee, 16 October 2026: each management tool has its own page, so the centre has cards and no section dropdown.
  assert.doesNotMatch(src('LiveManagement.tsx'), /<Pills /);
  assert.match(src('LiveManagement.tsx'), /<ToolCards p=\{p\} title="Choose a management tool"/);
  assert.equal(pillsMode(CLIENT_RELATIONS_SUBS.length), 'dropdown');
});
