export function downloadReport(csv: string, filename: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([csv], { type }));
  // The studio embeds the app. Use its same-origin outer document so browser
  // download handling receives the action at the top level as well.
  let downloadDocument = document;
  try {
    if (window.parent !== window && window.parent.location.origin === window.location.origin) downloadDocument = window.parent.document;
  } catch { /* Cross-origin embeds keep their own document. */ }
  const link = downloadDocument.createElement("a");
  link.href = url; link.download = filename;
  downloadDocument.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
