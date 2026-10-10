// What people read when something goes wrong: the server's own plain-English reasons pass through,
// but internal details (a response that didn't match its shape, a network stack) never reach the screen.
export function readableError(error: unknown, fallback = "The request could not be completed.") {
  if (!(error instanceof Error)) return fallback;
  const text = error.message.trim();
  if (error.name === "ZodError" || /^[[{]/.test(text)) return "Something unexpected came back. Refresh to try again.";
  if (/failed to fetch|network request failed|load failed|networkerror/i.test(text)) return "Recharge can't be reached. Check your connection and try again.";
  if (!text || text.length > 240) return fallback;
  return text;
}
