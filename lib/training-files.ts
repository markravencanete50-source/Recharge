// What a course file is, worked out from its bytes (never from what the browser claims).
export const MAX_TRAINING_FILE_BYTES = 25 * 1024 * 1024;
export type TrainingFileType = { mime: string; ext: 'pdf' | 'docx' | 'jpg' | 'png' | 'webp' | 'mp4' | 'mov' | 'webm' };
const starts = (b: Uint8Array, sig: number[], at = 0) => sig.every((x, i) => b[at + i] === x);
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.slice(from, to));
export function trainingFileType(bytes: Uint8Array, name: string): TrainingFileType | null {
  if (bytes.length < 12 || bytes.length > MAX_TRAINING_FILE_BYTES) return null;
  if (ascii(bytes, 0, 5) === '%PDF-') return { mime: 'application/pdf', ext: 'pdf' };
  if (starts(bytes, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', ext: 'jpg' };
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png', ext: 'png' };
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (starts(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return { mime: 'video/webm', ext: 'webm' };
  if (ascii(bytes, 4, 8) === 'ftyp') {
    const brand = ascii(bytes, 8, 12);
    return brand === 'qt  ' ? { mime: 'video/quicktime', ext: 'mov' } : { mime: 'video/mp4', ext: 'mp4' };
  }
  // A Word document is a zip; it is accepted only when named .docx and holding Word's parts.
  if (starts(bytes, [0x50, 0x4b, 0x03, 0x04]) && /\.docx$/i.test(name)) {
    const head = new TextDecoder().decode(bytes.slice(0, Math.min(bytes.length, 65536)));
    if (head.includes('[Content_Types].xml') || head.includes('word/')) return { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' };
  }
  return null;
}
export const fileKind = (mime: string) => mime.startsWith('video/') ? 'video' as const : mime.startsWith('image/') ? 'picture' as const : mime === 'application/pdf' ? 'PDF' as const : 'document' as const;
export const fileSize = (bytes: number) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
