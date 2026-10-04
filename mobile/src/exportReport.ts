import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

export async function exportReport(csv: string, filename: string) {
  if (!await Sharing.isAvailableAsync()) throw new Error("File sharing is unavailable on this device.");
  const file = new File(Paths.cache, filename);
  try {
    file.create({ overwrite: true });
    file.write(csv);
    await Sharing.shareAsync(file.uri, { mimeType: "text/csv", UTI: "public.comma-separated-values-text", dialogTitle: "Save Recharge report" });
  } finally {
    if (file.exists) file.delete();
  }
}
