// Native palettes update together in the same React commit, without a screen fade.
export function commitThemeChange(update: () => void) {
  update();
}
