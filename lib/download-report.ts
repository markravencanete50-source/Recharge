export function downloadReport(content: string | Uint8Array, filename: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([content as BlobPart], { type }));
  // The studio embeds the app. Use its same-origin outer document so browser
  // download handling receives the action at the top level as well.
  let downloadDocument = document;
  try {
    if (window.parent !== window && window.parent.location.origin === window.location.origin) downloadDocument = window.parent.document;
  } catch { /* Cross-origin embeds keep their own document. */ }
  const link = downloadDocument.createElement("a");
  link.href = url; link.download = filename; link.rel = "noopener";
  downloadDocument.body.appendChild(link); link.click(); link.remove();
  // Slow phones can still be reading the file a second later.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// On a phone or tablet a plain download often goes nowhere the person can find (or is blocked in an
// in-app browser), so the file goes to the share sheet instead: Save to Files, Drive, WhatsApp or
// email. Computers, and phones without file sharing, download as usual.
export async function saveFile(content: string | Uint8Array, filename: string, type: string): Promise<"shared" | "downloaded" | "cancelled"> {
  const touch = typeof navigator !== "undefined" && navigator.maxTouchPoints > 0 && typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  if (touch && typeof File === "function" && typeof navigator.share === "function") {
    const file = new File([content as BlobPart], filename, { type: type.split(";")[0] });
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: filename }); return "shared"; }
      catch (error) { if ((error as Error)?.name === "AbortError") return "cancelled"; }
    }
  }
  downloadReport(content, filename, type);
  return "downloaded";
}
