import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Text-level wiring of the Statements screen: check before preparing, a blocked period cannot be prepared, the shared tracker
// list and sheet, the terms sheet, the Vrbo example button, and the house rules (no dialogs, no em dashes, CRLF source).
const DASH = String.fromCharCode(0x2014);
// A dialog call: window.alert, Alert.alert, or a bare alert(, confirm( or prompt( (a method call such as .confirm( or onConfirm( is not one).
const DIALOG = /window\.(alert|confirm|prompt)\b|\bAlert\.alert\b|(?<![.\w$])(alert|confirm|prompt)\s*\(/;
const path = name => new URL(`../${name}`, import.meta.url);
const read = name => readFileSync(path(name), 'utf8');
const screen = read('mobile/src/AccountsStatements.tsx');
const adapter = read('lib/tracker-statements.ts');
const tracker = read('lib/tracker.ts');
const filesScreen = read('mobile/src/AccountsFiles.tsx');
const liveAccounts = read('mobile/src/LiveAccounts.tsx');

test('the existing entry points keep their names and the props LiveAccounts passes', () => {
  assert.match(screen, /export function AccountsStatements\(/);
  assert.match(screen, /export function TermsSheet\(/);
  assert.match(screen, /export type StatementRow = /);
  for (const prop of ['p: Palette', 'role: WorkspaceAccount["role"]', 'management: boolean', 'period: string', 'statements: StatementRow[]', 'loading: boolean',
    'busyStatement: string', 'statementAction: (key: string, action: FinanceAction) => Promise<void>', 'setTerms: (row: StatementRow) => void', 'setAsk: (ask: NoteAsk) => void']) assert.ok(screen.includes(prop), prop);
  // Props the old screen needed stay accepted, but are optional now.
  assert.match(screen, /expanded\?: string \| null;/);
  assert.match(screen, /setExpanded\?: \(id: string \| null\) => void;/);
  // What LiveAccounts passes today must still type-check against them.
  const call = liveAccounts.slice(liveAccounts.indexOf('<AccountsStatements'), liveAccounts.indexOf('/>', liveAccounts.indexOf('<AccountsStatements')));
  assert.ok(call.startsWith('<AccountsStatements '), 'LiveAccounts renders the Statements tab');
  // Each prop is passed by name with a value in braces (a bare substring such as "p=" would match anything).
  for (const name of ['p', 'role', 'management', 'period', 'statements', 'loading', 'busyStatement', 'statementAction', 'setTerms', 'setAsk']) assert.match(call, new RegExp('\\s' + name + '=\\{'), name);
});

test('figures are checked before anything is prepared', () => {
  assert.match(screen, /readFinance\(previewQuery\(id, r\)\)/);
  assert.match(screen, /statementPreviewSchema\.safeParse\(reply\.data\)/);
  assert.match(screen, /label=\{active\?\.status === "loading" \? "Checking…" : "Check figures"\}/);
  // Prepare is only possible from a loaded check that is not blocked, adds up, clashes with nothing and is not issued.
  assert.match(screen, /const stopped = !preview \|\| !summary \|\| preview\.blocked \|\| summary\.problems\.length > 0 \|\| clash\.length > 0 \|\| locked;/);
  assert.match(screen, /disabled=\{stopped \|\| !!busyStatement\}/);
  assert.match(screen, /if \(!picked \|\| !propertyId \|\| stopped \|\| busyStatement\) return;/);
  // The prepare action is built from the very range that was checked.
  // A held draft is prepared again with its own method (existing is the statement for the same dates).
  assert.match(screen, /prepareAction\(propertyId, picked, existing\)/);
  // Once Prepare has finished the period is checked again, so the screen shows the stored state and not the figures from before.
  assert.match(screen, /\.\.\.prepareAction\(propertyId, picked, existing\), requestId: "" \}\)\.then\(\(\) => runCheck\(propertyId, picked\)\)/);
  assert.match(screen, /const key = propertyId && picked \? previewKey\(propertyId, picked\) : "";/);
  assert.match(screen, /check\.key === key/);
});

test('the summary reads gross, deductions in order, then the payout, with reasons and links', () => {
  assert.match(screen, /summary\.rows\.map\(row => <Figure/);
  assert.match(screen, /<Figure p=\{p\} row=\{summary\.payout\} \/>/);
  assert.match(screen, /blockReasons\(preview\.blockedReasons\)/);
  assert.match(screen, /onOpenTab\(reason\.link === "payouts" \? "payouts" : "payable"\)/);
  assert.match(screen, /Do not prepare this statement/);
  assert.match(screen, /Show the itemised lines/);
  assert.match(adapter, /Gross revenue/);
  const summary = adapter.slice(adapter.indexOf('export function previewSummary'));
  const at = text => { const n = summary.indexOf(text); assert.ok(n > 0, text); return n; };
  assert.ok(at("label: 'Gross revenue'") < at("label: 'Platform fees'") && at("label: 'Platform fees'") < at('`Changeovers (') && at('`Changeovers (') < at('`Management fee (') && at('`Management fee (') < at('VAT on the management fee') && at('VAT on the management fee') < at("label: 'Other payables'") && at("label: 'Other payables'") < at('Payout to the owner'), 'deductions are in order');
});

test('dates: the last day is shown and typed, the day after is sent', () => {
  assert.match(screen, /Last day \(included\)/);
  assert.match(screen, /Both the first and the last day are included/);
  assert.match(screen, /customRange\(fromText, lastText, today\)/);
  assert.match(adapter, /`to` is the first day NOT included/);
  assert.match(adapter, /const range = rangeOf\(from, shiftDay\(last, 1\)\);/);
  assert.match(screen, /label="Custom dates"/);
  assert.match(screen, /monthLabel\(m\)/);
});

test('the list and the sheet are the shared tracker', () => {
  assert.match(screen, /<TrackerList p=\{p\} items=\{items\}/);
  assert.match(screen, /<TrackerDetailSheet /);
  assert.match(screen, /sortTracker\(statementTrackerItems\(/);
  assert.match(screen, /<StatementExtras p=\{p\} statement=\{open\.source\.statement\} \/>/);
  assert.match(adapter, /label: 'Reconciled'/);
  assert.match(adapter, /label: 'Cleans reviewed'/);
  assert.ok(['Prepared', 'Issued', 'Paid'].every(label => adapter.includes(`label: '${label}'`)));
  assert.match(screen, /form\.key === CHECK_FIGURES/);
  assert.match(screen, /action: "issueStatement"/);
  assert.match(screen, /action: "recordOwnerPayout"/);
  assert.match(screen, /action: "voidStatement"/);
  // Owners never reach this screen: the whole check card needs a finance role.
  assert.match(screen, /\{finance && \(/);
});

test('the terms sheet has 12% and 15%, a VAT switch and a clean charge choice, all saved together', () => {
  assert.match(screen, /label="12%"/);
  assert.match(screen, /label="15%"/);
  assert.match(screen, /accessibilityLabel="Add VAT to the management fee"/);
  assert.match(screen, /Charge cleans at/);
  assert.match(screen, /CLEAN_MODE_LABEL\.agreed_fee/);
  assert.match(screen, /CLEAN_MODE_LABEL\.actual_cost/);
  assert.match(screen, /action: "setStatementTerms".*vatOnFee: vat, cleanChargeMode: mode/);
  assert.match(adapter, /agreed_fee: 'Agreed fee', actual_cost: 'Actual cost'/);
  // The fee field is still there for any other rate.
  assert.match(screen, /Management fee \(% of the payout after platform fees\)/);
});

test('the tracker knows the new sections', () => {
  assert.match(tracker, /TrackerSection = 'purchases' \| 'licensing' \| 'onboarding' \| 'statements' \| 'payables' \| 'receivable'/);
  assert.match(adapter, /STATEMENT_SECTION: TrackerItem\['section'\] = 'statements'/);
});

test('every platform has an example file button, Vrbo included, and the Vrbo one says it is a guess', () => {
  assert.match(filesScreen, /RECONCILED_CHANNELS\.map\(channel => <Button key=\{channel\} label=\{`Example \$\{PAYOUT_CHANNEL_LABEL\[channel\]\} file`\}/);
  assert.match(filesScreen, /best guess at its layout/);
  assert.match(filesScreen, /We have not seen a real Vrbo file yet|we have not seen a real Vrbo file yet/);
});

test('house rules: no browser dialogs, no em dashes, calm style, CRLF source', () => {
  for (const [name, text] of Object.entries({ screen, adapter, filesScreen, accountsFiles: read('lib/accounts-files.ts'), live: read('lib/accounts-live.ts') })) {
    assert.ok(!text.includes(DASH), `${name} has an em dash`);
    assert.doesNotMatch(text, DIALOG, `${name} opens a dialog`);
    assert.doesNotMatch(text, /(Linear|Radial)Gradient|(linear|radial|conic)-gradient|Animated\.loop|fontWeight: "(700|800|900|bold)"/, `${name} is not calm`);
  }
  for (const name of ['mobile/src/AccountsStatements.tsx', 'mobile/src/AccountsFiles.tsx', 'lib/tracker-statements.ts', 'lib/accounts-live.ts', 'lib/accounts-files.ts', 'lib/tracker.ts']) {
    const text = read(name);
    assert.equal(text.replace(/\r\n/g, '').includes('\n'), false, `${name} has a lone LF`);
    assert.ok(text.includes('\r\n'), `${name} is CRLF`);
  }
});
