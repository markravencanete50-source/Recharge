import { downloadReport } from "../../lib/download-report";
export async function exportReport(csv: string, filename: string, type?: { mime: string; uti: string }) {
  downloadReport(csv, filename, type ? type.mime + ";charset=utf-8" : undefined);
}
