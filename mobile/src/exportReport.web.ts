import { downloadReport, saveFile } from "../../lib/download-report";
export async function exportReport(content: string | Uint8Array, filename: string, type?: { mime: string; uti: string }, options: { share?: boolean } = {}) {
  const mime = type ? type.mime + (type.mime.startsWith("text/") ? ";charset=utf-8" : "") : "text/csv;charset=utf-8";
  if (options.share) return saveFile(content, filename, mime);
  downloadReport(content, filename, mime);
  return "downloaded" as const;
}
