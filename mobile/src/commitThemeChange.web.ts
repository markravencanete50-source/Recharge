import { flushSync } from 'react-dom';

// View Transition must capture the new React content and CSS palette together.
export function commitThemeChange(update: () => void) {
  flushSync(update);
}
