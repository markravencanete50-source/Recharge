import { choiceControl, RADIO_MAX } from './choice-control';

// When a row of choices stays pills and when it becomes a dropdown (mobile/src/Pills.tsx). Lee, round 6: a long row of tabs
// ran off the screen ("I'd rather have a drop down, so it's much cleaner"). The rule is the forms' one (lib/choice-control.ts):
// 5 or fewer stay pills on one line, 6 to 10 are a dropdown, more than 10 a dropdown with a search box.
export const PILLS_LIMIT = RADIO_MAX;
export const pillsMode = (count: number): 'pills' | 'dropdown' | 'search' => {
  const control = choiceControl(count);
  return control === 'radio' ? 'pills' : control;
};
// The dropdown's choices: every value with the same words the pill shows, so a count in a label ("Waiting (3)") is listed too.
export const pillOptions = <T extends string>(values: readonly T[], text: (v: T) => string) => values.map(value => ({ value, label: text(value) }));
