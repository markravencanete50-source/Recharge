import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// D's round 8 review: on a property sheet (opened from Favorites or anywhere else), "Add a local event" opened its form
// behind the sheet. Like every other form there, it now closes the property sheet first (openForm), and the form's date
// is the shared DateField.
const pages = readFileSync('mobile/src/LivePages.tsx', 'utf8');

test('"Add a local event" closes the property sheet before its form opens', () => {
  assert.match(pages, /const openForm = \(form: WorkflowForm\) => \{ setSelected\(null\); onForm\(form\); \};/);
  assert.match(pages, /label="Add a local event" icon="calendar" palette=\{p\} onPress=\{\(\) => openForm\(localEventForm\(property\.id\)\)\}/);
  assert.doesNotMatch(pages, /onForm\(localEventForm/);
  // Every form or work item started inside the property sheet goes through openForm, or closes the sheet itself.
  const sheet = pages.slice(pages.indexOf('const moreFor = (property: PropertyView) =>'), pages.indexOf('title={account.role === "client" ? "Your properties"'));
  assert.doesNotMatch(sheet, /onPress=\{\(\) => onForm\(/);
  assert.match(sheet, /if \(onOpenWork\) \{ setSelected\(null\); onOpenWork\(item\); return; \}/);
  assert.match(pages, /<JourneyDetails j=\{journey\} p=\{p\} account=\{account\} propertyName=\{property\.name\} onForm=\{openForm\}/);
});

test('a workflow form date is the shared DateField', () => {
  assert.match(pages, /import \{ DateField \} from "\.\/CalendarPicker";/);
  const date = pages.slice(pages.indexOf('if (f.type === "date") {'), pages.indexOf('if (f.type === "date") {') + 900);
  assert.match(date, /<DateField p=\{p\} label=\{f\.label \+ \(!f\.required \? " \(optional\)" : ""\)\} mode="single" wholeMonthLink=\{false\} empty="Choose a date" clearable=\{!f\.required\}/);
  assert.doesNotMatch(date, /DateTimePicker|<Calendar /);
});
