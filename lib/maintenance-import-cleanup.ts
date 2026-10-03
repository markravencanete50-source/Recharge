import { env } from "cloudflare:workers";

const LEGACY_MAINTENANCE_IMPORTS = [
  { id: "d08952bb-2af8-4d56-9a24-720216718a01", taskId: "86cae4yhx", property: "152 Northfield Farm Avenue", address: "152 Northfield Farm Avenue, Edinburgh, EH8 7QZ", category: "Safety", summary: "Hob/Cooker Gas Leak", priority: "urgent", complete: true },
  { id: "d08952bb-2af8-4d56-9a24-720216718a02", taskId: "86cajjjj3", property: "7 Cedarbank", address: "7 Cedarbank, Livingston, EH54 6DR", category: "Appliances", summary: "Burnt wall, dishwasher not working and stained sheet", priority: "urgent", complete: false },
  { id: "d08952bb-2af8-4d56-9a24-720216718a03", taskId: "86caf9d9c", property: "20 Willow Grove", address: "20 Willow Grove, Livingston, EH54 5NA", category: "Furniture & fittings", summary: "Both bedroom windows do not have handles", priority: "normal", complete: false },
  { id: "d08952bb-2af8-4d56-9a24-720216718a04", taskId: "86caj0rv1", property: "Property to confirm — Hilary Poytress booking", address: "Glasgow West", category: "Access & locks", summary: "Broken key fob and curtain rod", priority: "normal", complete: false },
  { id: "d08952bb-2af8-4d56-9a24-720216718a05", taskId: "86cahajd3", property: "34 Wilderhaugh", address: "34 Wilderhaugh, Galashiels, TD1 1PW", category: "Heating & hot water", summary: "Set up gas supply", priority: "normal", complete: false },
  { id: "d08952bb-2af8-4d56-9a24-720216718a06", taskId: "86cajbp5w", property: "22A North Bridge Street", address: "22A North Bridge Street, Hawick, TD9 9QW", category: "General repair", summary: "Airbnb listing and photos", priority: "normal", complete: true },
  { id: "d08952bb-2af8-4d56-9a24-720216718a07", taskId: "86cahv9z7", property: "80 Huntly Avenue", address: "80 Huntly Avenue, Livingston, EH54 8NG", category: "General repair", summary: "Cutlery shortage", priority: "normal", complete: false },
  { id: "d08952bb-2af8-4d56-9a24-720216718a08", taskId: "86cahv9ef", property: "", address: "", category: "Furniture & fittings", summary: "Tile loose behind toilet | June 8", priority: "normal", complete: false },
  { id: "d08952bb-2af8-4d56-9a24-720216718a09", taskId: "86cafezzk", property: "", address: "", category: "Safety", summary: "Support Cases | Smoke Weed/Drugs | Stairs", priority: "urgent", complete: false },
  { id: "d08952bb-2af8-4d56-9a24-720216718a10", taskId: "86cafewma", property: "", address: "", category: "Waste", summary: "Rubbish Bins", priority: "normal", complete: false },
  { id: "d08952bb-2af8-4d56-9a24-720216718a11", taskId: "86cafewtc", property: "", address: "", category: "General repair", summary: "GHRUM Security Deposit | May 22 - June 1", priority: "normal", complete: false },
] as const;

export async function reconcileMisimportedMaintenance() {
  if (!env.DB) return;
  const ids = LEGACY_MAINTENANCE_IMPORTS.map((item) => item.taskId);
  const placeholders = ids.map(() => "?").join(", ");
  const rows = await env.DB.prepare(
    `SELECT id, clickup_task_id, clickup_url, property_name, property_address, source_description, source_comments, source_created_at, source_updated_at FROM management_properties WHERE clickup_task_id IN (${placeholders})`,
  ).bind(...ids).all<{ id: string; clickup_task_id: string; clickup_url: string; property_name: string; property_address: string; source_description: string; source_comments: string; source_created_at: string; source_updated_at: string }>();
  const statements: ReturnType<typeof env.DB.prepare>[] = [];
  for (const row of rows.results) {
    const item = LEGACY_MAINTENANCE_IMPORTS.find((candidate) => candidate.taskId === row.clickup_task_id);
    if (!item) continue;
    const sourceMessageId = `clickup-property:${item.taskId}`;
    const ticketId = item.id;
    const createdAt = clickUpSeconds(row.source_created_at) || Math.floor(Date.now() / 1000);
    const updatedAt = clickUpSeconds(row.source_updated_at) || createdAt;
    const details = [commentsAsText(row.source_comments), row.clickup_url ? `Original ClickUp task: ${row.clickup_url}` : ""].filter(Boolean).join("\n\n");
    const identified = identifyProperty(item.property, item.address, row);
    statements.push(
      env.DB.prepare(
        "INSERT INTO maintenance_tickets (id, reference, source, source_message_id, property_name, property_address, category, priority, summary, details, troubleshooting_outcome, physical_repair, status, ready_reference, closed_reason, closed_at, raised_by_email, raised_by_name, created_at, updated_at) VALUES (?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, ?, ?, 'enquiries@rechargestays.co.uk', 'ClickUp property cleanup', ?, ?) ON CONFLICT(source_message_id) DO UPDATE SET property_name = excluded.property_name, property_address = excluded.property_address, category = excluded.category, priority = excluded.priority, summary = excluded.summary, details = excluded.details, updated_at = excluded.updated_at",
      ).bind(ticketId, `MNT-CU-${item.taskId.toUpperCase()}`, sourceMessageId, identified.property, identified.address, item.category, item.priority, item.summary, details || "Imported from the ClickUp Property Info board.", item.complete ? "resolved" : "pending", item.complete ? "closed" : "new", item.complete ? "Completed in ClickUp before migration." : "", item.complete ? updatedAt : null, createdAt, updatedAt),
      env.DB.prepare("UPDATE management_properties SET merged_into_property_id = ?, updated_at = ? WHERE id = ?").bind(`maintenance:${ticketId}`, updatedAt, row.id),
      env.DB.prepare("DELETE FROM onboarding_cases WHERE clickup_task_id = ?").bind(item.taskId),
    );
  }
  if (statements.length) await env.DB.batch(statements);
  await reconcileRemainingOperationalCases();
}

async function reconcileRemainingOperationalCases() {
  if (!env.DB) return;
  const result=await env.DB.prepare("SELECT c.id, c.clickup_task_id, c.property_name, c.property_address, c.client_name, c.created_at, c.updated_at, p.id AS property_row_id, p.clickup_url, p.source_description, p.source_comments FROM onboarding_cases c LEFT JOIN management_properties p ON p.clickup_task_id = c.clickup_task_id WHERE c.clickup_task_id IS NOT NULL").all<{id:string;clickup_task_id:string;property_name:string;property_address:string;client_name:string;created_at:number;updated_at:number;property_row_id:string|null;clickup_url:string|null;source_description:string|null;source_comments:string|null}>();
  const operational=result.results.filter((row)=>isOperationalTask(row.property_name));
  for (const row of operational) {
    const source={property_name:row.property_name,property_address:row.property_address,source_description:row.source_description||"",source_comments:row.source_comments||"[]"};
    const identified=identifyProperty("","",source);
    const summary=row.property_name.trim();
    const details=[row.source_description||"",commentsAsText(row.source_comments||"[]"),row.clickup_url?`Original ClickUp task: ${row.clickup_url}`:"",`Removed from Property Onboarding because this is an operational task, not a new property enquiry.`].filter(Boolean).join("\n\n");
    const ticketId=`clickup-maintenance-${row.clickup_task_id.toLowerCase()}`;
    const sourceMessageId=`clickup-property:${row.clickup_task_id.toLowerCase()}`;
    const category=maintenanceCategory(summary);
    await env.DB.batch([
      env.DB.prepare("INSERT INTO maintenance_tickets (id, reference, source, source_message_id, property_name, property_address, category, priority, summary, details, troubleshooting_outcome, physical_repair, status, ready_reference, raised_by_email, raised_by_name, created_at, updated_at) VALUES (?, ?, 'manual', ?, ?, ?, ?, 'normal', ?, ?, 'pending', 0, 'new', NULL, 'enquiries@rechargestays.co.uk', 'ClickUp onboarding cleanup', ?, ?) ON CONFLICT(source_message_id) DO UPDATE SET property_name = excluded.property_name, property_address = excluded.property_address, category = excluded.category, summary = excluded.summary, details = excluded.details, updated_at = excluded.updated_at").bind(ticketId,`MNT-CU-${row.clickup_task_id.toUpperCase()}`,sourceMessageId,identified.property,identified.address,category,summary,details,row.created_at,row.updated_at),
      env.DB.prepare("DELETE FROM onboarding_notifications WHERE onboarding_id = ?").bind(row.id),
      env.DB.prepare("DELETE FROM onboarding_updates WHERE onboarding_id = ?").bind(row.id),
      env.DB.prepare("DELETE FROM onboarding_cases WHERE id = ?").bind(row.id),
      ...(row.property_row_id ? [env.DB.prepare("UPDATE management_properties SET merged_into_property_id = ?, updated_at = ? WHERE id = ?").bind(`maintenance:${ticketId}`,row.updated_at,row.property_row_id)] : []),
    ]);
  }
}

function isOperationalTask(title:string) { return /\b(walls? need|fix(?:ed|ing)?|council tax|invoice|empty bins?|return the .*bin|no lightbulb|lightbulb|security deposit|support cases?|rubbish|tile loose|loose tile|smoke|weed|drugs|stairs?|leak(?:ing)?|broken|repair|maintenance|not working|stain(?:ed)?|washer|dishwasher|missing keys?|curtain|hob|cooker|plumbing|shower|fridge|toaster|sofa bed|bed frame|bodily fluids?)\b/i.test(title); }
function maintenanceCategory(title:string) { if (/bin|rubbish|waste/i.test(title)) return "Waste"; if (/light|electric/i.test(title)) return "Electrical"; if (/invoice|tax|deposit/i.test(title)) return "Administration"; if (/smoke|drug|stairs/i.test(title)) return "Safety"; return "General repair"; }

function identifyProperty(fallbackProperty: string, fallbackAddress: string, row: { property_name: string; property_address: string; source_description: string; source_comments: string }) {
  if (fallbackProperty) return { property: fallbackProperty, address: fallbackAddress };
  const source=[row.property_address,row.source_description,commentsAsText(row.source_comments)].join("\n");
  const address=source.match(/\b(?:flat\s*)?\d+[a-z]?(?:\s*[\/,-]\s*\d+[a-z]?)?\s+[A-Za-z][^\n,]{2,45}(?:,\s*[A-Za-z][^\n,]{2,30})?(?:,\s*[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i)?.[0]?.trim() || "";
  if (address) return { property: address.split(",")[0], address };
  return { property: `Property to confirm — ${row.property_name}`, address: "Property reference retained from ClickUp; confirm against the original task." };
}

function clickUpSeconds(value: string) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? Math.floor(timestamp / 1000) : 0;
}

function commentsAsText(value: string) {
  try {
    const comments = JSON.parse(value) as Array<{ author?: string; text?: string }>;
    return comments.map((comment) => `${comment.author || "ClickUp"}: ${comment.text || ""}`.trim()).filter(Boolean).join("\n\n");
  } catch {
    return "";
  }
}
