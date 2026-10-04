import { downloadReport } from "../../lib/download-report";
export async function exportReport(csv: string, filename: string) {
  downloadReport(csv, filename);
}
