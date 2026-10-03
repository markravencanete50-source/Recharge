export function buildMaintenanceProposalPdf(ticket) {
  const commands = [];
  const green = "0.110 0.224 0.204";
  const muted = "0.365 0.439 0.447";
  const dark = "0.110 0.224 0.204";

  commands.push(`${green} rg 0 742 595 100 re f`);
  drawText(commands, 42, 792, 25, "F2", "RECHARGE", "1 1 1");
  drawText(commands, 42, 769, 10, "F1", "PROPERTY MAINTENANCE PROPOSAL", "0.718 0.937 0.392");
  drawText(commands, 430, 792, 9, "F1", clean(ticket.reference), "1 1 1");

  let y = 704;
  drawText(commands, 42, y, 20, "F2", clean(ticket.propertyName), dark);
  y -= 36;
  sectionLabel(commands, 42, y, "CLIENT AND REPAIR DETAILS", green);
  y -= 24;
  const detailRows = [
    ["Client", clean(ticket.clientName || "Property owner")],
    ["Repair type", clean(ticket.category)],
    ["Priority", title(clean(ticket.priority))],
    ["Ready reference", clean(ticket.readyReference || "Pending")],
    ["Proposed repair date", formatDate(ticket.proposedRepairDate)],
  ];
  for (const [label, value] of detailRows) {
    drawText(commands, 42, y, 9, "F2", label, muted);
    drawText(commands, 176, y, 10, "F1", value, dark);
    y -= 21;
  }

  y -= 4;
  sectionLabel(commands, 42, y, "REPORTED ISSUE", green);
  y -= 24;
  drawText(commands, 42, y, 12, "F2", clean(ticket.summary), dark);
  y -= 19;
  for (const line of wrap(clean(ticket.details), 88, 5)) {
    drawText(commands, 42, y, 10, "F1", line, muted);
    y -= 14;
  }

  y -= 10;
  sectionLabel(commands, 42, y, "PROPOSED WORK", green);
  y -= 24;
  for (const line of wrap(clean(ticket.workRequired || "Quote details pending"), 88, 7)) {
    drawText(commands, 42, y, 10, "F1", line, dark);
    y -= 14;
  }

  y -= 12;
  commands.push("0.949 0.969 0.957 rg 42 " + (y - 58) + " 511 70 re f");
  drawText(commands, 58, y - 20, 9, "F2", "PROPOSED REPAIR COST", muted);
  drawText(commands, 58, y - 46, 20, "F2", money(ticket.quoteAmountPence), dark);
  drawText(commands, 282, y - 20, 9, "F2", "APPROVAL STATUS", muted);
  drawText(commands, 282, y - 43, 11, "F2", approvalStatus(ticket), dark);

  const footerY = 70;
  commands.push(`${green} RG 42 ${footerY + 34} 511 0.7 re S`);
  drawText(
    commands,
    42,
    footerY + 18,
    9,
    "F1",
    "Once approved, the repair will be scheduled by Recharge Ready.",
    muted,
  );
  drawText(
    commands,
    42,
    footerY + 4,
    9,
    "F1",
    "The approved cost will be deducted from the client's next available payout.",
    muted,
  );
  drawText(commands, 42, 34, 8, "F1", "Recharge | Perfection at every stage", muted);
  drawText(commands, 471, 34, 8, "F1", formatDate(new Date().toISOString().slice(0, 10)), muted);

  return buildPdf(commands.join("\n"));
}

function buildPdf(content) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    `<< /Length ${byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let output = "%PDF-1.4\n%Recharge\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(byteLength(output));
    output += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) {
    output += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(output);
}

function drawText(commands, x, y, size, font, value, colour) {
  commands.push(`BT /${font} ${size} Tf ${colour} rg 1 0 0 1 ${x} ${y} Tm (${pdfEscape(value)}) Tj ET`);
}

function sectionLabel(commands, x, y, value, colour) {
  drawText(commands, x, y, 9, "F2", value, colour);
  commands.push(`${colour} rg ${x} ${y - 8} 511 1 re f`);
}

function wrap(value, width, maxLines) {
  const words = value.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length <= width) {
      line = next;
      continue;
    }
    if (line) lines.push(line);
    line = word;
    if (lines.length >= maxLines) break;
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (words.join(" ").length > lines.join(" ").length && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].slice(0, Math.max(0, width - 3))}...`;
  }
  return lines.length ? lines : ["Not provided"];
}

function clean(value) {
  return String(value || "")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/£/g, "GBP ")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .trim();
}

function pdfEscape(value) {
  return clean(value).replace(/([\\()])/g, "\\$1");
}

function money(pence) {
  if (typeof pence !== "number") return "Quote pending";
  return `GBP ${(pence / 100).toFixed(2)}`;
}

function approvalStatus(ticket) {
  if (ticket.approvalRoute === "none") return "No approval required";
  if (ticket.clientApproval === "pending") return "Awaiting client approval";
  if (ticket.managementApproval === "pending") return "Awaiting management approval";
  if (ticket.clientApproval === "rejected" || ticket.managementApproval === "rejected") return "Quote rejected";
  return "Approved";
}

function formatDate(value) {
  if (!value) return "To be agreed";
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return clean(value);
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function title(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : "Normal";
}

function byteLength(value) {
  return new TextEncoder().encode(value).length;
}
