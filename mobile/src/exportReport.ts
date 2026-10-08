import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

export async function exportReport(csv: string, filename: string, type = { mime: "text/csv", uti: "public.comma-separated-values-text" }) {
  if (!await Sharing.isAvailableAsync()) throw new Error("File sharing is unavailable on this device.");
  const file = new File(Paths.cache, filename);
  try {
    file.create({ overwrite: true });
    file.write(csv);
    await Sharing.shareAsync(file.uri, { mimeType: type.mime, UTI: type.uti, dialogTitle: "Save from Recharge" });
  } finally {
    if (file.exists) file.delete();
  }
}
