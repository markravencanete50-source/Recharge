// When a row of choices stays pills and when it becomes a dropdown (mobile/src/Pills.tsx). Lee, round 6: a long row of tabs
// ran off the screen ("I'd rather have a drop down, so it's much cleaner"). Five or fewer stay pills on one line.
export const PILLS_LIMIT = 5;
export const pillsMode = (count: number): 'pills' | 'dropdown' => count > PILLS_LIMIT ? 'dropdown' : 'pills';
// The dropdown's choices: every value with the same words the pill shows, so a count in a label ("Waiting (3)") is listed too.
export const pillOptions = <T extends string>(values: readonly T[], text: (v: T) => string) => values.map(value => ({ value, label: text(value) }));
