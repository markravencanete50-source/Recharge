const INLINE_MEDIA = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/avif",
  "video/mp4", "video/webm", "video/quicktime", "audio/mpeg", "audio/ogg",
]);

/** Uploaded content must never execute with the application's identity. */
export function privateFileHeaders(
  contentType: string,
  fileName: string,
  forceDownload = false,
): Record<string, string> {
  const mime = contentType.split(";", 1)[0].trim().toLowerCase();
  const validMime = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mime);
  const type = validMime ? mime : "application/octet-stream";
  // Existing generated estimates and agreements are static HTML documents.
  // Keep their previews, but sandbox both scripts and same-origin privileges.
  const inline = !forceDownload && (INLINE_MEDIA.has(type) || type === "text/html");
  const name = fileName.replace(/[\u0000-\u001f\u007f"\\/]/g, "_") || "download";
  const asciiName = name.replace(/[^\x20-\x7e]/g, "_");
  const encodedName = encodeURIComponent(name).replace(/['()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return {
    "content-type": type === "text/html" ? "text/html; charset=utf-8" : type,
    "content-disposition": `${inline ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${encodedName}`,
    "cache-control": "private, no-store",
    "x-content-type-options": "nosniff",
    "content-security-policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; media-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
    "referrer-policy": "no-referrer",
  };
}
