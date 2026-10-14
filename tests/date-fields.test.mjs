import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Dates are chosen on the shared calendar field (DateField in mobile/src/CalendarPicker.tsx), never typed as
// "YYYY-MM-DD". The Accounts screens are Session A's and are converted there; they are the only ones allowed for now.
const LATER = new Set(['AccountsPayable.tsx', 'AccountsReceivable.tsx', 'AccountsStatements.tsx']);
const files = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []);

test('no screen asks for a date typed as YYYY-MM-DD', () => {
  const left = [...files('mobile/src'), ...files('app')].filter(f => !LATER.has(path.basename(f)) && readFileSync(f, 'utf8').includes('YYYY-MM-DD'));
  assert.deepEqual(left, []);
});

test('the converted forms use the shared calendar field', () => {
  const uses = {
    'LiveCleans.tsx': /<DateField p=\{p\} label="Date" mode="single"/,
    'StaySheet.tsx': /<DateField p=\{p\} label="Check-in to check-out"/,
    'StayEditSheet.tsx': /<DateField p=\{p\} label="Check-in to check-out"/,
    'LiveRepairs.tsx': /<DateField p=\{p\} label="Repair date" mode="single"/,
    'LiveCalendar.tsx': /<DateField p=\{p\} label="Date" mode="single"/,
    'LocalEvents.tsx': /<DateField p=\{p\} label="Date" mode="single"/,
    'TeamEvents.tsx': /<DateField p=\{p\} label="Dates/,
    'LiveTeamTime.tsx': /<DateField p=\{p\} label="Date" mode="single"/,
    'HubItemSheet.tsx': /<DateField p=\{p\} label=\{kind === "todo" \? "Due \(optional\)" : "Send by \(optional\)"\} mode="single"/,
  };
  for (const [file, pattern] of Object.entries(uses)) {
    const text = readFileSync(path.join('mobile/src', file), 'utf8');
    assert.match(text, pattern, file);
    assert.match(text, /import \{ DateField \} from "\.\/CalendarPicker";/, file);
  }
});

test('one date component: DateField takes "empty" and "clearable" rather than a second field', () => {
  const picker = readFileSync('mobile/src/CalendarPicker.tsx', 'utf8');
  assert.match(picker, /export function DateField\([^)]*empty, clearable = false/);
  assert.match(picker, /onChange\(\{ from: "", to: "" \}\)/, 'clearing hands back empty strings');
  assert.match(picker, /value=\{\{ from: shown\.from \|\| null, to: shown\.to \|\| null \}\}/, 'an empty date opens on this month');
  assert.ok(!readdirSync('mobile/src').includes('DayField.tsx'));
});
