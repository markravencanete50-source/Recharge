// Training videos play inside the app: YouTube, Vimeo and Loom links become their embedded players,
// and direct video files play in a video element. Anything else is not embedded.
export type VideoEmbed = { kind: 'frame'; src: string } | { kind: 'file'; src: string };
export function videoEmbed(link: string | null | undefined): VideoEmbed | null {
  let url: URL;
  try { url = new URL(String(link ?? '')); } catch { return null; }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.replace(/^www\.|^m\./, '');
  const id = /^[\w-]{6,20}$/;
  if (host === 'youtu.be') { const v = url.pathname.slice(1); return id.test(v) ? { kind: 'frame', src: `https://www.youtube-nocookie.com/embed/${v}` } : null; }
  if (host === 'youtube.com') {
    const v = url.searchParams.get('v') ?? url.pathname.match(/^\/(?:embed|shorts|live)\/([\w-]+)/)?.[1] ?? '';
    return id.test(v) ? { kind: 'frame', src: `https://www.youtube-nocookie.com/embed/${v}` } : null;
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') { const v = url.pathname.match(/(\d{6,12})/)?.[1]; return v ? { kind: 'frame', src: `https://player.vimeo.com/video/${v}` } : null; }
  // Loom share and embed links (the onboarding videos, migration 20261025200000).
  if (host === 'loom.com') { const v = url.pathname.match(/^\/(?:share|embed)\/([0-9a-f]{32})$/)?.[1]; return v ? { kind: 'frame', src: `https://www.loom.com/embed/${v}` } : null; }
  if (/\.(mp4|webm|m4v|mov)$/i.test(url.pathname)) return { kind: 'file', src: url.toString() };
  return null;
}
// Only a YouTube, Vimeo or Loom link can be an onboarding video (no video files): the setting checks it with this.
export const isOnboardingVideoLink = (link: string) => videoEmbed(link)?.kind === 'frame';
