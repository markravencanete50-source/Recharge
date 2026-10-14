import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

// Dates are chosen on the shared calendar field (DateField in mobile/src/CalendarPicker.tsx), never typed as
// "YYYY-MM-DD". Every screen is converted, the Accounts ones included, so there are no exceptions.
const LATER = new Set();
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
    'TeamEvents.tsx': /<DateField p=\{p\} label="Dates" hint="Choose the first day, then the last\. For one day, choose it twice\."/,
    'LiveTeamTime.tsx': /<DateField p=\{p\} label="Date" mode="single"/,
    'HubItemSheet.tsx': /<DateField p=\{p\} label=\{kind === "todo" \? "Due \(optional\)" : "Send by \(optional\)"\} mode="single"/,
    // Accounts (Session A): an optional date is clearable and says what an empty one means.
    'AccountsPayable.tsx': /<DateField p=\{p\} label="Invoice date" mode="single"/,
    'AccountsReceivable.tsx': /<DateField p=\{p\} label="Send by \(optional\)" mode="single" value=\{\{ from: v\.dueOn, to: v\.dueOn \}\} onChange=\{d => set\("dueOn"\)\(d\.from\)\} wholeMonthLink=\{false\} empty="No date" clearable \/>/,
    'AccountsStatements.tsx': /<DateField p=\{p\} label="Levy stays checking in from \(optional\)" mode="single" value=\{\{ from: levy\.from, to: levy\.from \}\} onChange=\{d => setLevy\(l => \(\{ \.\.\.l, from: d\.from \}\)\)\} wholeMonthLink=\{false\} empty="Every stay" clearable \/>/,
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

test('date labels are names; the how-to sits in the open calendar', () => {
  for (const file of readdirSync('mobile/src').filter(f => f.endsWith('.tsx'))) {
    const labels = [...readFileSync(path.join('mobile/src', file), 'utf8').matchAll(/<DateField [^>]*?label="([^"]+)"/g)].map(m => m[1]);
    for (const label of labels) assert.doesNotMatch(label, /choose|tap|twice|YYYY|\(one/i, `${file}: "${label}"`);
  }
  const picker = readFileSync('mobile/src/CalendarPicker.tsx', 'utf8');
  assert.match(picker, /hint = "Choose the first day, then the last\."/);
  assert.match(picker, /\{draft\?\.from \? "Now choose the last day\." : hint\}/);
});

test('keyboard: arrows move the browser focus with the ring, Enter and Space press that one day, one Tab stop', () => {
  const picker = readFileSync('mobile/src/CalendarPicker.tsx', 'utf8');
  // Enter and Space were handled twice (the day's own press and the grid's handler), so a range could end up on the wrong days.
  assert.doesNotMatch(picker, /e\.key === "Enter"|e\.key === " "/);
  assert.match(picker, /keyed\.current = true; setFocus\(next\)/);
  assert.match(picker, /getElementById\(cellId\(focus\)\)\?\.focus\(\)/);
  assert.match(picker, /nativeID=\{id\} focusable=\{tabStop\} onFocus=\{onFocus\}/);
  assert.match(picker, /const tabStop = \[focus, value\.from, today\]/);
});

test('the open calendar comes into view, and a range reads as one band', () => {
  const picker = readFileSync('mobile/src/CalendarPicker.tsx', 'utf8');
  assert.match(picker, /getElementById\(cardId\)\?\.scrollIntoView\(\{ block: "nearest"/);
  assert.match(picker, /c\.rangeStart && !c\.rangeEnd \? \{ left: "50%", right: 0 \} : c\.rangeEnd && !c\.rangeStart \? \{ left: 0, right: "50%" \}/);
});

test('no date placeholder or typed date hint is left anywhere in the app', () => {
  const typed = /YYYY-MM-DD|placeholder="\d{4}-\d{2}-\d{2}"/;
  const left = [...files('mobile/src'), ...files('app')].filter(f => typed.test(readFileSync(f, 'utf8')));
  assert.deepEqual(left, []);
  // AccountsPayable's three dates (received on, the draft's received on, the cleaner invoice date) are all the date field.
  const payable = readFileSync('mobile/src/AccountsPayable.tsx', 'utf8');
  assert.equal((payable.match(/<DateField p=\{p\} label="(Received on|Invoice date)" mode="single"/g) ?? []).length, 3);
});

test('the dropdown\'s closed box has the 3:1 control outline, like the date field and the search box', () => {
  const dropdown = readFileSync('mobile/src/Dropdown.tsx', 'utf8');
  assert.match(dropdown, /borderColor: open \? p\.primary : p\.controlBorder, backgroundColor: p\.surface \}/);
  assert.match(dropdown, /border: `1px solid \$\{p\.controlBorder\}`/);
});
