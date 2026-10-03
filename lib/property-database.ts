import { env } from "cloudflare:workers";
import type { AccessProfile } from "@/lib/access";
import { isHostawayConfigured, listHostawayProperties } from "@/lib/hostaway";
import type { HostawayProperty } from "@/lib/hostaway-types";
import { reconcileMisimportedMaintenance } from "@/lib/maintenance-import-cleanup";

export type PropertyStatus = "new_enquiry" | "sign_them_up" | "onboarding" | "live" | "archived";

export type PropertyListingLink = { label: string; url: string };

export type SourceAttachment = {
  id: string;
  title: string;
  extension: string;
  mimetype: string;
  size: number;
  date: string;
};

export type SourceChecklistItem = {
  id: string;
  name: string;
  resolved: boolean;
  children: SourceChecklistItem[];
};

export type SourceChecklist = {
  id: string;
  name: string;
  resolved: number;
  unresolved: number;
  items: SourceChecklistItem[];
};

export type SourceComment = {
  id: string;
  text: string;
  date: string;
  author: string;
  resolved: boolean;
  replyCount: number;
  replies: Array<{ id: string; text: string; date: string; author: string; resolved: boolean }>;
};

export type ManagementProperty = {
  id: string;
  hostawayListingId: string | null;
  hostawayListingIds: string[];
  clickupTaskId: string | null;
  clickupUrl: string;
  sourceStatus: string;
  sourcePriority: string;
  sourceDueAt: string;
  sourceCreatedAt: string;
  sourceUpdatedAt: string;
  propertyName: string;
  propertyAddress: string;
  region: string;
  propertyType: string;
  bedrooms: string;
  beds: string;
  bathrooms: string;
  wcCount: string;
  parking: string;
  garden: string;
  ownerName: string;
  ownerCompany: string;
  ownerEmail: string;
  ownerPhone: string;
  correspondenceAddress: string;
  existingClient: string;
  accessCode: string;
  accessInfo: string;
  guidebookUrl: string;
  listingLinks: PropertyListingLink[];
  payoutSchedule: string;
  managementFeePercent: number;
  cleaningCostPence: number;
  payoutNotes: string;
  currentlyOperating: string;
  furnishingPreference: string;
  licensingPreference: string;
  startPreference: string;
  enquiryReason: string;
  additionalNotes: string;
  sourceDescription: string;
  sourceCustomFields: Record<string, string>;
  sourceChecklists: SourceChecklist[];
  sourceComments: SourceComment[];
  sourceAttachments: SourceAttachment[];
  sourceLinkedTaskIds: string[];
  sourceRecords: ClickUpImportRecord[];
  clickupImportedAt: number | null;
  status: PropertyStatus;
  lastSyncedAt: number | null;
  updatedAt: number;
};

export type ClientPortfolio = {
  key: string;
  companyName: string;
  ownerName: string;
  directorNames: string[];
  ownerEmail: string;
  ownerPhone: string;
  properties: ManagementProperty[];
};

export type PropertyDatabaseData = {
  available: boolean;
  hostawayConnected: boolean;
  canEdit: boolean;
  properties: ManagementProperty[];
  clients: ClientPortfolio[];
  reporting: PropertyReporting;
};

export type PropertyReporting = {
  newEnquiries: { week: number; month: number; quarter: number; year: number };
  signedUp: Array<{ propertyName: string; signedAt: number }>;
  strikeRate: number;
};

export type ClickUpImportRecord = {
  clickupTaskId: string;
  parentTaskId?: string;
  parent?: string;
  clickupUrl: string;
  clickupStatus: string;
  status: PropertyStatus;
  region: string;
  propertyName: string;
  propertyAddress: string;
  propertyType: string;
  bedrooms: string;
  beds: string;
  bathrooms: string;
  wcCount: string;
  parking: string;
  garden: string;
  ownerName: string;
  ownerCompany: string;
  ownerEmail: string;
  ownerPhone: string;
  correspondenceAddress: string;
  existingClient: string;
  currentlyOperating: string;
  furnishingPreference: string;
  licensingPreference: string;
  startPreference: string;
  enquiryReason: string;
  additionalNotes: string;
  descriptionMarkdown: string;
  textContent: string;
  priority: string;
  dueAt: string;
  createdAt: string;
  updatedAt: string;
  customFields: Record<string, string>;
  checklists: SourceChecklist[];
  comments: SourceComment[];
  attachments: SourceAttachment[];
  linkedTaskIds: string[];
};

type PropertyRow = {
  id: string;
  hostaway_listing_id: string | null;
  hostaway_listing_ids: string;
  clickup_task_id: string | null;
  clickup_url: string;
  source_status: string;
  source_priority: string;
  source_due_at: string;
  source_created_at: string;
  source_updated_at: string;
  property_name: string;
  property_address: string;
  region: string;
  property_type: string;
  bedrooms: string;
  beds: string;
  bathrooms: string;
  wc_count: string;
  parking: string;
  garden: string;
  owner_name: string;
  owner_company: string;
  owner_email: string;
  owner_phone: string;
  correspondence_address: string;
  existing_client: string;
  access_code: string;
  access_info: string;
  guidebook_url: string;
  listing_links: string;
  payout_schedule: string;
  management_fee_bps: number;
  cleaning_cost_pence: number;
  payout_notes: string;
  currently_operating: string;
  furnishing_preference: string;
  licensing_preference: string;
  start_preference: string;
  enquiry_reason: string;
  additional_notes: string;
  source_description: string;
  source_custom_fields: string;
  source_checklists: string;
  source_comments: string;
  source_attachments: string;
  source_linked_task_ids: string;
  clickup_imported_at: number | null;
  status: PropertyStatus;
  last_synced_at: number | null;
  updated_at: number;
};

type PropertySourceRow = {
  clickup_task_id: string;
  property_id: string;
  payload_json: string;
};

export function canUsePropertyDatabase(profile: AccessProfile) {
  if (profile.role === "client") return profile.modules.includes("client-dashboard");
  return profile.role === "admin" || profile.modules.includes("property-database");
}

export async function getPropertyDatabaseData(profile: AccessProfile): Promise<PropertyDatabaseData | undefined> {
  if (!canUsePropertyDatabase(profile)) return undefined;
  const canEdit = profile.role !== "client";
  try {
    await reconcileMisimportedMaintenance();
    if (canEdit) await reconcileNonPropertyClickUpImports(profile);
    if (canEdit) await reconcileDuplicateProperties(profile);
    let rows = await loadRows();
    const mostRecentHostawaySync = rows.reduce((latest, row) => Math.max(latest, row.last_synced_at || 0), 0);
    const hostawaySyncIsStale = mostRecentHostawaySync < Math.floor(Date.now() / 1000) - 15 * 60;
    if (canEdit && isHostawayConfigured() && (rows.length === 0 || hostawaySyncIsStale)) {
      try {
        await syncPropertiesFromHostaway(profile);
        await reconcileDuplicateProperties(profile);
        rows = await loadRows();
      } catch (error) {
        console.error("Initial Hostaway property import failed", error);
      }
    }
    const visibleRows = profile.role === "client"
      ? rows.filter((row) => row.owner_email.toLowerCase() === profile.email.toLowerCase())
      : rows;
    const sourceRows = await loadSourceRows();
    const sourceRecords = new Map<string, ClickUpImportRecord[]>();
    for (const row of sourceRows) {
      const parsed = parseSourceRecord(row.payload_json);
      if (!parsed) continue;
      const current = sourceRecords.get(row.property_id) || [];
      current.push(parsed);
      sourceRecords.set(row.property_id, current);
    }
    const onboardingStatuses = await loadLinkedOnboardingStatuses();
    const properties = visibleRows.map((row) => ({
      ...mapProperty(row),
      status: onboardingStatuses.get(row.id) || onboardingStatuses.get(`clickup:${row.clickup_task_id || ""}`) || normalisePropertyStatus(row.status),
      sourceRecords: (sourceRecords.get(row.id) || []).sort((a, b) =>
        b.updatedAt.localeCompare(a.updatedAt),
      ),
    }));
    const reporting = await loadPropertyReporting();
    return {
      available: true,
      hostawayConnected: isHostawayConfigured(),
      canEdit,
      properties,
      clients: buildClientPortfolios(properties.filter((property) => property.status !== "archived")),
      reporting,
    };
  } catch (error) {
    console.error("Unable to load the management property database", error);
    return { available: false, hostawayConnected: isHostawayConfigured(), canEdit, properties: [], clients: [], reporting: emptyPropertyReporting() };
  }
}

export async function syncPropertiesFromHostaway(profile: AccessProfile) {
  requireEditor(profile);
  const listings = await listHostawayProperties();
  const db = database();
  const now = Math.floor(Date.now() / 1000);
  const grouped = groupHostawayListings(listings);
  const existing = await db.prepare(
    "SELECT id, hostaway_listing_id, hostaway_listing_ids, clickup_task_id, property_name, property_address, listing_links FROM management_properties WHERE merged_into_property_id IS NULL",
  ).all<{ id: string; hostaway_listing_id: string | null; hostaway_listing_ids: string; clickup_task_id: string | null; property_name: string; property_address: string; listing_links: string }>();
  const mergeStatements: ReturnType<typeof db.prepare>[] = [];
  const statements = grouped.map((property) => {
    const match = findHostawayDatabaseMatch(existing.results, property);
    const id = match?.id || crypto.randomUUID();
    const canonicalAddress = cleanPropertyTitle(match?.property_address || property.address || property.name);
    const links = mergeLinks(parseLinks(match?.listing_links || "[]"), property.listingLinks);
    for (const duplicate of findHostawayDatabaseDuplicates(existing.results, property, id)) {
      mergeStatements.push(
        db.prepare("UPDATE management_properties SET hostaway_listing_id = NULL, hostaway_listing_ids = '[]', merged_into_property_id = ?, updated_by_email = ?, updated_by_name = ?, updated_at = ? WHERE id = ?").bind(id, profile.email, profile.fullName, now, duplicate.id),
        db.prepare("UPDATE management_property_sources SET property_id = ? WHERE property_id = ?").bind(id, duplicate.id),
      );
    }
    return db.prepare(
      "INSERT INTO management_properties (id, hostaway_listing_id, hostaway_listing_ids, property_name, property_address, owner_name, owner_email, owner_phone, access_code, access_info, guidebook_url, listing_links, payout_schedule, management_fee_bps, payout_notes, status, last_synced_at, updated_by_email, updated_by_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', 0, '', 'live', ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET hostaway_listing_id = excluded.hostaway_listing_id, hostaway_listing_ids = excluded.hostaway_listing_ids, property_name = excluded.property_name, property_address = CASE WHEN management_properties.property_address = '' THEN excluded.property_address ELSE management_properties.property_address END, owner_name = CASE WHEN management_properties.owner_name = '' THEN excluded.owner_name ELSE management_properties.owner_name END, owner_email = CASE WHEN management_properties.owner_email = '' THEN excluded.owner_email ELSE management_properties.owner_email END, owner_phone = CASE WHEN management_properties.owner_phone = '' THEN excluded.owner_phone ELSE management_properties.owner_phone END, access_code = CASE WHEN management_properties.access_code = '' THEN excluded.access_code ELSE management_properties.access_code END, access_info = CASE WHEN management_properties.access_info = '' THEN excluded.access_info ELSE management_properties.access_info END, guidebook_url = CASE WHEN management_properties.guidebook_url = '' THEN excluded.guidebook_url ELSE management_properties.guidebook_url END, listing_links = excluded.listing_links, status = CASE WHEN management_properties.status = 'archived' THEN 'archived' ELSE 'live' END, last_synced_at = excluded.last_synced_at, updated_at = excluded.updated_at",
    ).bind(
      id, property.primaryId, JSON.stringify(property.ids), canonicalAddress, cleanPropertyTitle(match?.property_address || property.address),
      property.ownerName, property.ownerEmail.toLowerCase(), property.ownerPhone, property.accessCode,
      property.accessInfo, property.guidebookUrl, JSON.stringify(links), now, profile.email, profile.fullName, now, now,
    );
  });
  for (let index = 0; index < statements.length; index += 40) await db.batch(statements.slice(index, index + 40));
  for (let index = 0; index < mergeStatements.length; index += 40) await db.batch(mergeStatements.slice(index, index + 40));
  return { listings: listings.length, properties: grouped.length, combinedAliases: listings.length - grouped.length };
}

export async function importClickUpProperties(profile: AccessProfile, records: ClickUpImportRecord[]) {
  if (profile.role !== "admin") throw new Error("Admin access required");
  const db = database();
  const now = Math.floor(Date.now() / 1000);
  const existing = await db.prepare(
    "SELECT id, hostaway_listing_id, clickup_task_id, property_name, property_address FROM management_properties",
  ).all<{ id: string; hostaway_listing_id: string | null; clickup_task_id: string | null; property_name: string; property_address: string }>();
  const candidates = [...existing.results];
  const statements: ReturnType<typeof db.prepare>[] = [];
  const sourceStatements: ReturnType<typeof db.prepare>[] = [];
  const onboardingStatements: ReturnType<typeof db.prepare>[] = [];
  let created = 0;
  let updated = 0;
  let matchedToHostaway = 0;
  let ignoredNonProperties = 0;
  let ignoredNonEnquiries = 0;

  for (const record of records) {
    if (!isPropertyEnquiryRecord(record)) {
      ignoredNonProperties += 1;
      continue;
    }
    const match = findExistingProperty(candidates, record);
    // New database records originate with genuine enquiries. Later ClickUp
    // statuses may update a property already created here or matched to Hostaway.
    if (!match && record.status !== "new_enquiry") {
      ignoredNonEnquiries += 1;
      continue;
    }
    let propertyId: string;
    const sourceDescription = record.descriptionMarkdown || record.textContent || "";
    const sourceJson = [
      JSON.stringify(record.customFields), JSON.stringify(record.checklists),
      JSON.stringify(record.comments), JSON.stringify(record.attachments),
      JSON.stringify(record.linkedTaskIds),
    ];
    if (match) {
      propertyId = match.id;
      statements.push(db.prepare(
        "UPDATE management_properties SET clickup_task_id = ?, clickup_url = ?, source_status = ?, source_priority = ?, source_due_at = ?, source_created_at = ?, source_updated_at = ?, property_name = CASE WHEN hostaway_listing_id IS NULL THEN ? ELSE property_name END, property_address = CASE WHEN ? != '' THEN ? ELSE property_address END, region = ?, property_type = ?, bedrooms = ?, beds = CASE WHEN beds = '' THEN ? ELSE beds END, bathrooms = ?, wc_count = ?, parking = ?, garden = ?, owner_name = CASE WHEN owner_name = '' THEN ? ELSE owner_name END, owner_company = CASE WHEN owner_company = '' THEN ? ELSE owner_company END, owner_email = CASE WHEN owner_email = '' THEN ? ELSE owner_email END, owner_phone = CASE WHEN owner_phone = '' THEN ? ELSE owner_phone END, correspondence_address = CASE WHEN correspondence_address = '' THEN ? ELSE correspondence_address END, existing_client = ?, currently_operating = ?, furnishing_preference = ?, licensing_preference = ?, start_preference = ?, enquiry_reason = ?, additional_notes = ?, source_description = ?, source_custom_fields = ?, source_checklists = ?, source_comments = ?, source_attachments = ?, source_linked_task_ids = ?, clickup_imported_at = ?, status = CASE WHEN hostaway_listing_id IS NOT NULL THEN 'live' ELSE ? END, updated_by_email = ?, updated_by_name = ?, updated_at = ? WHERE id = ?",
      ).bind(
        record.clickupTaskId, record.clickupUrl, record.clickupStatus, record.priority, record.dueAt,
        record.createdAt, record.updatedAt, record.propertyName, record.propertyAddress, record.propertyAddress,
        record.region, record.propertyType, record.bedrooms, bedsFromRecord(record), record.bathrooms, record.wcCount,
        record.parking, record.garden, record.ownerName, record.ownerCompany,
        record.ownerEmail.toLowerCase(), record.ownerPhone, record.correspondenceAddress,
        record.existingClient, record.currentlyOperating, record.furnishingPreference,
        record.licensingPreference, record.startPreference, record.enquiryReason, record.additionalNotes,
        sourceDescription, ...sourceJson, now, record.status, profile.email, profile.fullName, now, match.id,
      ));
      updated += 1;
      if (match.hostaway_listing_id) matchedToHostaway += 1;
      match.clickup_task_id = record.clickupTaskId;
      match.property_address = record.propertyAddress || match.property_address;
    } else {
      const id = crypto.randomUUID();
      propertyId = id;
      statements.push(db.prepare(
        "INSERT INTO management_properties (id, hostaway_listing_id, clickup_task_id, clickup_url, source_status, source_priority, source_due_at, source_created_at, source_updated_at, property_name, property_address, region, property_type, bedrooms, bathrooms, wc_count, parking, garden, owner_name, owner_company, owner_email, owner_phone, correspondence_address, existing_client, access_code, access_info, guidebook_url, listing_links, payout_schedule, management_fee_bps, payout_notes, currently_operating, furnishing_preference, licensing_preference, start_preference, enquiry_reason, additional_notes, source_description, source_custom_fields, source_checklists, source_comments, source_attachments, source_linked_task_ids, clickup_imported_at, status, last_synced_at, updated_by_email, updated_by_name, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', '', '[]', '', 0, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)",
      ).bind(
        id, record.clickupTaskId, record.clickupUrl, record.clickupStatus, record.priority, record.dueAt,
        record.createdAt, record.updatedAt, record.propertyName, record.propertyAddress, record.region,
        record.propertyType, record.bedrooms, record.bathrooms, record.wcCount, record.parking, record.garden,
        record.ownerName, record.ownerCompany, record.ownerEmail.toLowerCase(), record.ownerPhone,
        record.correspondenceAddress, record.existingClient, record.currentlyOperating,
        record.furnishingPreference, record.licensingPreference, record.startPreference, record.enquiryReason,
        record.additionalNotes, sourceDescription, ...sourceJson, now, record.status,
        profile.email, profile.fullName, now, now,
      ));
      candidates.push({ id, hostaway_listing_id: null, clickup_task_id: record.clickupTaskId, property_name: record.propertyName, property_address: record.propertyAddress });
      created += 1;
    }
    sourceStatements.push(db.prepare(
      "INSERT INTO management_property_sources (clickup_task_id, property_id, clickup_url, source_status, source_property_name, payload_json, imported_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(clickup_task_id) DO UPDATE SET property_id = excluded.property_id, clickup_url = excluded.clickup_url, source_status = excluded.source_status, source_property_name = excluded.source_property_name, payload_json = excluded.payload_json, imported_at = excluded.imported_at",
    ).bind(
      record.clickupTaskId,
      propertyId,
      record.clickupUrl,
      record.clickupStatus,
      record.propertyName,
      JSON.stringify(record),
      now,
    ));
    onboardingStatements.push(db.prepare(
      "INSERT INTO onboarding_cases (id, clickup_task_id, reference, client_email, client_name, property_name, property_address, property_type, bedrooms, bathrooms, status, created_by_email, created_by_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(clickup_task_id) DO UPDATE SET client_email = CASE WHEN excluded.client_email != '' THEN excluded.client_email ELSE onboarding_cases.client_email END, client_name = CASE WHEN excluded.client_name != '' THEN excluded.client_name ELSE onboarding_cases.client_name END, property_name = excluded.property_name, property_address = CASE WHEN excluded.property_address != '' THEN excluded.property_address ELSE onboarding_cases.property_address END, property_type = CASE WHEN excluded.property_type != '' THEN excluded.property_type ELSE onboarding_cases.property_type END, bedrooms = CASE WHEN excluded.bedrooms > 0 THEN excluded.bedrooms ELSE onboarding_cases.bedrooms END, bathrooms = CASE WHEN excluded.bathrooms > 0 THEN excluded.bathrooms ELSE onboarding_cases.bathrooms END, status = excluded.status, updated_at = excluded.updated_at",
    ).bind(
      `clickup:${record.clickupTaskId}`,
      record.clickupTaskId,
      `CU-${record.clickupTaskId.toUpperCase()}`,
      record.ownerEmail.trim().toLowerCase(),
      record.ownerName.trim(),
      record.propertyName.trim(),
      record.propertyAddress.trim(),
      record.propertyType.trim() || "Not recorded",
      parsePositiveInteger(record.bedrooms),
      parsePositiveInteger(record.bathrooms),
      onboardingStatusFromClickUp(record),
      profile.email,
      profile.fullName,
      clickUpTimestamp(record.createdAt) || now,
      clickUpTimestamp(record.updatedAt) || now,
    ));
  }
  for (let index = 0; index < statements.length; index += 20) await db.batch(statements.slice(index, index + 20));
  for (let index = 0; index < sourceStatements.length; index += 20) await db.batch(sourceStatements.slice(index, index + 20));
  for (let index = 0; index < onboardingStatements.length; index += 20) await db.batch(onboardingStatements.slice(index, index + 20));
  await reconcileDuplicateProperties(profile);
  await reconcileNonPropertyClickUpImports(profile);
  return { imported: created + updated, created, updated, matchedToHostaway, ignoredNonProperties, ignoredNonEnquiries };
}

async function reconcileNonPropertyClickUpImports(profile: AccessProfile) {
  const db = database();
  const result = await db.prepare(
    "SELECT id, clickup_task_id, property_name, property_address, property_type, bedrooms, bathrooms, owner_name, owner_company, owner_email, owner_phone, enquiry_reason, source_custom_fields FROM management_properties WHERE merged_into_property_id IS NULL AND clickup_task_id IS NOT NULL AND hostaway_listing_id IS NULL",
  ).all<{ id: string; clickup_task_id: string; property_name: string; property_address: string; property_type: string; bedrooms: string; bathrooms: string; owner_name: string; owner_company: string; owner_email: string; owner_phone: string; enquiry_reason: string; source_custom_fields: string }>();
  // Existing data is cleaned conservatively: remove only unmistakable jobs and
  // test cards. The stricter identity check is applied before all future imports.
  const rejected = result.results.filter((row) => isDefinitelyNonPropertyTitle(row.property_name));
  if (!rejected.length) return 0;
  const now = Math.floor(Date.now() / 1000);
  const statements: ReturnType<typeof db.prepare>[] = [];
  for (const row of rejected) {
    statements.push(
      db.prepare("UPDATE management_properties SET merged_into_property_id = ?, updated_by_email = ?, updated_by_name = ?, updated_at = ? WHERE id = ?").bind(`excluded:clickup-non-property:${row.clickup_task_id}`, profile.email, profile.fullName, now, row.id),
      db.prepare("DELETE FROM onboarding_cases WHERE id = ? AND clickup_task_id = ?").bind(`clickup:${row.clickup_task_id}`, row.clickup_task_id),
    );
  }
  for (let index = 0; index < statements.length; index += 40) await db.batch(statements.slice(index, index + 40));
  return rejected.length;
}

function isPropertyEnquiryRecord(record: ClickUpImportRecord) {
  // ClickUp maintenance items are subtasks beneath the parent property card.
  if (record.parentTaskId?.trim() || record.parent?.trim()) return false;
  const title = record.propertyName.trim();
  const address = record.propertyAddress.trim();
  if (isDefinitelyNonPropertyTitle(title)) return false;
  const hasAddress = Boolean(address || extractPostcode(title) || /^\s*(?:flat\s*)?\d+[a-z]?(?:\s*[/,-]\s*\d+[a-z]?)?\s+\S+/i.test(title));
  const hasOwner = Boolean(record.ownerName.trim() || record.ownerCompany.trim() || record.ownerEmail.trim());
  const hasPropertyDetail = Boolean(record.propertyType.trim() || record.bedrooms.trim() || record.bathrooms.trim() || record.enquiryReason.trim());
  return hasAddress || (hasOwner && hasPropertyDetail);
}

function isDefinitelyNonPropertyTitle(title: string) {
  return /\b(test|pay\s+.+bill|follow\s+up|business rates|energy balance|security deposit|support cases?|cleaner assignment|compliance check|license (?:application|renewal)|internal refurb|reimbursement|installation|delivery|leak(?:ing)?|broken|repair|maintenance|not working|stain(?:ed)?|washer|dishwasher|missing keys?|duplicate keys?|curtain|hob|cooker|top up gas|rubbish bins?|plumbing issue|shower backing up|fire reported|fridge|toaster|sofa bed|bed frame|shed blown|grease all over|bodily fluids?|tile loose|loose tile|smoke|weed|drugs|stairs?)\b/i.test(title);
}

export async function saveManagementProperty(profile: AccessProfile, input: {
  id?: string;
  propertyName: string;
  propertyAddress: string;
  region: string;
  propertyType: string;
  bedrooms: string;
  beds: string;
  bathrooms: string;
  wcCount: string;
  parking: string;
  garden: string;
  ownerName: string;
  ownerCompany: string;
  ownerEmail: string;
  ownerPhone: string;
  correspondenceAddress: string;
  accessCode: string;
  accessInfo: string;
  guidebookUrl: string;
  listingLinks: PropertyListingLink[];
  payoutSchedule: string;
  managementFeePercent: number;
  cleaningCostPence: number;
  payoutNotes: string;
  status: PropertyStatus;
}) {
  requireEditor(profile);
  const db = database();
  const now = Math.floor(Date.now() / 1000);
  const editable = [
    input.propertyName.trim(), input.propertyAddress.trim(), input.region.trim(), input.propertyType.trim(),
    input.bedrooms.trim(), input.beds.trim(), input.bathrooms.trim(), input.wcCount.trim(), input.parking.trim(),
    input.garden.trim(), input.ownerName.trim(), input.ownerCompany.trim(),
    input.ownerEmail.trim().toLowerCase(), input.ownerPhone.trim(), input.correspondenceAddress.trim(),
    input.accessCode.trim(), input.accessInfo.trim(), input.guidebookUrl.trim(),
    JSON.stringify(input.listingLinks), input.payoutSchedule.trim(), Math.round(input.managementFeePercent * 100),
    input.cleaningCostPence, input.payoutNotes.trim(), input.status,
  ] as const;
  if (input.id) {
    const result = await db.prepare(
      "UPDATE management_properties SET property_name = ?, property_address = ?, region = ?, property_type = ?, bedrooms = ?, beds = ?, bathrooms = ?, wc_count = ?, parking = ?, garden = ?, owner_name = ?, owner_company = ?, owner_email = ?, owner_phone = ?, correspondence_address = ?, access_code = ?, access_info = ?, guidebook_url = ?, listing_links = ?, payout_schedule = ?, management_fee_bps = ?, cleaning_cost_pence = ?, payout_notes = ?, status = ?, updated_by_email = ?, updated_by_name = ?, updated_at = ? WHERE id = ?",
    ).bind(...editable, profile.email, profile.fullName, now, input.id).run();
    if (!result.meta.changes) throw new Error("Property not found");
    return input.id;
  }
  const id = crypto.randomUUID();
  await db.prepare(
    "INSERT INTO management_properties (id, hostaway_listing_id, property_name, property_address, region, property_type, bedrooms, beds, bathrooms, wc_count, parking, garden, owner_name, owner_company, owner_email, owner_phone, correspondence_address, access_code, access_info, guidebook_url, listing_links, payout_schedule, management_fee_bps, cleaning_cost_pence, payout_notes, status, last_synced_at, updated_by_email, updated_by_name, created_at, updated_at) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)",
  ).bind(id, ...editable, profile.email, profile.fullName, now, now).run();
  return id;
}

async function loadRows() {
  const result = await database().prepare(
    "SELECT id, hostaway_listing_id, hostaway_listing_ids, clickup_task_id, clickup_url, source_status, source_priority, source_due_at, source_created_at, source_updated_at, property_name, property_address, region, property_type, bedrooms, beds, bathrooms, wc_count, parking, garden, owner_name, owner_company, owner_email, owner_phone, correspondence_address, existing_client, access_code, access_info, guidebook_url, listing_links, payout_schedule, management_fee_bps, cleaning_cost_pence, payout_notes, currently_operating, furnishing_preference, licensing_preference, start_preference, enquiry_reason, additional_notes, source_description, source_custom_fields, source_checklists, source_comments, source_attachments, source_linked_task_ids, clickup_imported_at, status, last_synced_at, updated_at FROM management_properties WHERE merged_into_property_id IS NULL ORDER BY property_name COLLATE NOCASE",
  ).all<PropertyRow>();
  return result.results;
}

async function loadSourceRows() {
  const result = await database().prepare(
    "SELECT clickup_task_id, property_id, payload_json FROM management_property_sources ORDER BY imported_at DESC",
  ).all<PropertySourceRow>();
  return result.results;
}

async function loadLinkedOnboardingStatuses() {
  const result = await database().prepare(
    "SELECT id, clickup_task_id, status FROM onboarding_cases",
  ).all<{ id: string; clickup_task_id: string | null; status: string }>();
  const statuses = new Map<string, PropertyStatus>();
  for (const row of result.results) {
    const status = propertyStatusFromOnboarding(row.status);
    statuses.set(`onboarding:${row.id}`, status);
    if (row.clickup_task_id) statuses.set(`clickup:${row.clickup_task_id}`, status);
  }
  return statuses;
}

async function loadPropertyReporting(): Promise<PropertyReporting> {
  const result = await database().prepare(
    "SELECT property_name, property_address, created_at, agreement_signed_at, status FROM onboarding_cases ORDER BY COALESCE(agreement_signed_at, created_at) DESC",
  ).all<{ property_name: string; property_address: string; created_at: number; agreement_signed_at: number | null; status: string }>();
  const now = new Date();
  const startOfWeek = new Date(now); startOfWeek.setUTCDate(now.getUTCDate() - ((now.getUTCDay() + 6) % 7)); startOfWeek.setUTCHours(0, 0, 0, 0);
  const startOfMonth = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000;
  const startOfQuarter = Date.UTC(now.getUTCFullYear(), Math.floor(now.getUTCMonth() / 3) * 3, 1) / 1000;
  const startOfYear = Date.UTC(now.getUTCFullYear(), 0, 1) / 1000;
  const created = result.results.map((row) => row.created_at);
  const signedUp = result.results.filter((row) => row.agreement_signed_at).map((row) => ({
    propertyName: row.property_name || row.property_address || "Property address required",
    signedAt: row.agreement_signed_at || 0,
  }));
  const reachedOnboarding = result.results.filter((row) => row.agreement_signed_at || !["enquiry_received", "estimate_drafting", "estimate_received", "reviewing", "not_proceeding", "agreement_pending"].includes(row.status)).length;
  return {
    newEnquiries: {
      week: created.filter((value) => value >= startOfWeek.getTime() / 1000).length,
      month: created.filter((value) => value >= startOfMonth).length,
      quarter: created.filter((value) => value >= startOfQuarter).length,
      year: created.filter((value) => value >= startOfYear).length,
    },
    signedUp,
    strikeRate: result.results.length ? Math.round(reachedOnboarding / result.results.length * 1000) / 10 : 0,
  };
}

function emptyPropertyReporting(): PropertyReporting {
  return { newEnquiries: { week: 0, month: 0, quarter: 0, year: 0 }, signedUp: [], strikeRate: 0 };
}

function mapProperty(row: PropertyRow): ManagementProperty {
  return {
    id: row.id, hostawayListingId: row.hostaway_listing_id, hostawayListingIds: parseArray<string>(row.hostaway_listing_ids), clickupTaskId: row.clickup_task_id,
    clickupUrl: row.clickup_url, sourceStatus: row.source_status, sourcePriority: row.source_priority,
    sourceDueAt: row.source_due_at, sourceCreatedAt: row.source_created_at, sourceUpdatedAt: row.source_updated_at,
    propertyName: row.property_name, propertyAddress: row.property_address, region: row.region,
    propertyType: row.property_type, bedrooms: row.bedrooms, beds: row.beds, bathrooms: row.bathrooms,
    wcCount: row.wc_count, parking: row.parking, garden: row.garden, ownerName: row.owner_name,
    ownerCompany: row.owner_company, ownerEmail: row.owner_email, ownerPhone: row.owner_phone,
    correspondenceAddress: row.correspondence_address, existingClient: row.existing_client,
    accessCode: row.access_code, accessInfo: row.access_info, guidebookUrl: row.guidebook_url,
    listingLinks: parseLinks(row.listing_links), payoutSchedule: row.payout_schedule,
    managementFeePercent: row.management_fee_bps / 100, cleaningCostPence: row.cleaning_cost_pence, payoutNotes: row.payout_notes,
    currentlyOperating: row.currently_operating, furnishingPreference: row.furnishing_preference,
    licensingPreference: row.licensing_preference, startPreference: row.start_preference,
    enquiryReason: row.enquiry_reason, additionalNotes: row.additional_notes,
    sourceDescription: row.source_description, sourceCustomFields: parseObject(row.source_custom_fields),
    sourceChecklists: parseArray<SourceChecklist>(row.source_checklists),
    sourceComments: parseArray<SourceComment>(row.source_comments),
    sourceAttachments: parseArray<SourceAttachment>(row.source_attachments),
    sourceLinkedTaskIds: parseArray<string>(row.source_linked_task_ids),
    sourceRecords: [],
    clickupImportedAt: row.clickup_imported_at, status: normalisePropertyStatus(row.status),
    lastSyncedAt: row.last_synced_at, updatedAt: row.updated_at,
  };
}

function findExistingProperty(candidates: Array<{ id: string; hostaway_listing_id: string | null; clickup_task_id: string | null; property_name: string; property_address: string }>, record: ClickUpImportRecord) {
  const direct = candidates.find((item) => item.clickup_task_id === record.clickupTaskId);
  if (direct) return direct;
  const confirmedAddress = confirmedCanonicalAddress(record.propertyName, record.propertyAddress);
  if (confirmedAddress) {
    const confirmed = candidates.find((item) => [item.property_name, item.property_address].some((value) => normaliseAddress(value) === normaliseAddress(confirmedAddress)));
    if (confirmed) return confirmed;
  }
  const sourceKeys = [record.propertyName, record.propertyAddress].map(normaliseAddress).filter(Boolean);
  const exact = candidates.find((item) => {
    const targetKeys = [item.property_name, item.property_address].map(normaliseAddress).filter(Boolean);
    return sourceKeys.some((source) => targetKeys.includes(source));
  });
  if (exact) return exact;
  const postcode = extractPostcode(record.propertyAddress || record.propertyName);
  if (!postcode) return undefined;
  const samePostcode = candidates.filter((item) => [item.property_address, item.property_name].some((value) => extractPostcode(value) === postcode));
  if (samePostcode.length === 1) return samePostcode[0];
  const sourceNumbers = leadingAddressNumbers(record.propertyAddress || record.propertyName);
  if (!sourceNumbers) return undefined;
  return samePostcode.find((item) => [item.property_address, item.property_name].some((value) => leadingAddressNumbers(value) === sourceNumbers));
}

function normaliseAddress(value: string) {
  return value.toLowerCase().replace(/\b(united kingdom|uk)\b/g, "").replace(/[^a-z0-9]/g, "").trim();
}

function extractPostcode(value: string) {
  return value.toUpperCase().match(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/)?.[0].replace(/\s/g, "") || "";
}

function leadingAddressNumbers(value: string) {
  return value.trim().toLowerCase().match(/^(?:flat\s*)?([\da-z]+(?:[\/-][\da-z]+)?)/)?.[1] || "";
}

function parseLinks(value: string): PropertyListingLink[] {
  return parseArray<PropertyListingLink>(value).filter((link) => Boolean(link) && typeof link.label === "string" && typeof link.url === "string" && /^https?:\/\//i.test(link.url));
}

function parseArray<T>(value: string): T[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch { return []; }
}

function parseObject(value: string): Record<string, string> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, string> : {};
  } catch { return {}; }
}

function parseSourceRecord(value: string): ClickUpImportRecord | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed as ClickUpImportRecord : null;
  } catch { return null; }
}

function buildClientPortfolios(properties: ManagementProperty[]): ClientPortfolio[] {
  const companiesByDirector = new Map<string, Set<string>>();
  for (const property of properties) {
    const director = normaliseIdentity(property.ownerName);
    const company = cleanIdentity(property.ownerCompany);
    if (!director || !company) continue;
    const companies = companiesByDirector.get(director) || new Set<string>();
    companies.add(company);
    companiesByDirector.set(director, companies);
  }
  const clients = new Map<string, ClientPortfolio>();
  for (const property of properties) {
    const directorKey = normaliseIdentity(property.ownerName);
    const knownCompanies = companiesByDirector.get(directorKey);
    const companyName = cleanIdentity(property.ownerCompany) || (knownCompanies?.size === 1 ? [...knownCompanies][0] : "");
    const directorName = cleanIdentity(property.ownerName);
    const key = companyName
      ? `company:${normaliseIdentity(companyName)}`
      : directorName
        ? `director:${normaliseIdentity(directorName)}`
        : property.ownerEmail
          ? `email:${property.ownerEmail.trim().toLowerCase()}`
          : "unassigned";
    const current = clients.get(key) || {
      key,
      companyName,
      ownerName: companyName || directorName || "Owner details required",
      directorNames: [],
      ownerEmail: property.ownerEmail,
      ownerPhone: property.ownerPhone,
      properties: [],
    };
    if (directorName && !current.directorNames.some((name) => normaliseIdentity(name) === normaliseIdentity(directorName))) {
      current.directorNames.push(directorName);
    }
    if (!current.companyName && companyName) current.companyName = companyName;
    if (!current.ownerEmail && property.ownerEmail) current.ownerEmail = property.ownerEmail;
    if (!current.ownerPhone && property.ownerPhone) current.ownerPhone = property.ownerPhone;
    current.properties.push(property);
    clients.set(key, current);
  }
  return Array.from(clients.values()).sort((a, b) => a.ownerName.localeCompare(b.ownerName, "en-GB", { sensitivity: "base" }));
}

function cleanIdentity(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function normaliseIdentity(value: string) {
  return cleanIdentity(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalisePropertyStatus(value: string): PropertyStatus {
  if (value === "active") return "live";
  if (value === "inactive") return "archived";
  if (value === "live" || value === "archived" || value === "new_enquiry" || value === "sign_them_up") return value;
  return "onboarding";
}

function propertyStatusFromOnboarding(value: string): PropertyStatus {
  if (value === "live") return "live";
  if (value === "not_proceeding") return "archived";
  if (["enquiry_received", "estimate_drafting"].includes(value)) return "new_enquiry";
  if (["estimate_received", "reviewing", "agreement_pending"].includes(value)) return "sign_them_up";
  return "onboarding";
}

function bedsFromRecord(record: ClickUpImportRecord) {
  const fields = record.customFields;
  return fields.Beds || fields["No. of Beds"] || fields["Number of Beds"] || fields["Bed Configuration"] || "";
}

type GroupedHostawayProperty = HostawayProperty & { primaryId: string; ids: string[] };

function groupHostawayListings(listings: HostawayProperty[]): GroupedHostawayProperty[] {
  const groups = new Map<string, HostawayProperty[]>();
  const ordered = [...listings].sort((a, b) => Number(isVersionTwo(a.name)) - Number(isVersionTwo(b.name)));
  for (const listing of ordered) {
    const baseName = normaliseListingName(listing.name);
    const addressKey = normaliseAddress(listing.address);
    const exactNameMatch = groups.has(baseName) ? baseName : undefined;
    const aliasMatch = exactNameMatch || (isVersionTwo(listing.name)
      ? Array.from(groups.keys()).find((key) => key.includes(baseName) || baseName.includes(key))
      : undefined);
    const key = aliasMatch || baseName || addressKey;
    const current = groups.get(key) || [];
    current.push(listing);
    groups.set(key, current);
  }
  return Array.from(groups.values()).map((items) => {
    const primary = items.find((item) => !isVersionTwo(item.name)) || items[0];
    return {
      ...primary,
      primaryId: primary.id,
      ids: items.map((item) => item.id),
      listingLinks: mergeLinks([], items.flatMap((item) => item.listingLinks)),
      address: primary.address || items.find((item) => item.address)?.address || "",
    };
  });
}

type DeduplicationRow = PropertyRow & { merged_into_property_id: string | null };

/** Collapses only records with a stable shared identity and retains merged history. */
async function reconcileDuplicateProperties(profile: AccessProfile) {
  const db = database();
  const cleanupTime = Math.floor(Date.now() / 1000);
  await db.prepare(
    "UPDATE management_properties SET merged_into_property_id = 'maintenance:misimported', updated_by_email = ?, updated_by_name = ?, updated_at = ? WHERE merged_into_property_id IS NULL AND (lower(trim(property_name)) = 'wifi delivery' OR lower(property_name) LIKE 'burnt wall, stained sheets and washer%')",
  ).bind(profile.email, profile.fullName, cleanupTime).run();
  const result = await db.prepare(
    "SELECT * FROM management_properties WHERE merged_into_property_id IS NULL ORDER BY created_at ASC",
  ).all<DeduplicationRow>();
  const rows = result.results;
  if (rows.length < 2) return 0;

  const parent = new Map(rows.map((row) => [row.id, row.id]));
  const find = (id: string): string => {
    const current = parent.get(id) || id;
    if (current === id) return id;
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const union = (left: string, right: string) => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot);
  };
  const identityOwner = new Map<string, string>();
  for (const row of rows) {
    for (const key of propertyIdentityKeys(row)) {
      const owner = identityOwner.get(key);
      if (owner) union(owner, row.id);
      else identityOwner.set(key, row.id);
    }
  }

  const groups = new Map<string, DeduplicationRow[]>();
  for (const row of rows) {
    const root = find(row.id);
    const group = groups.get(root) || [];
    group.push(row);
    groups.set(root, group);
  }

  let merged = 0;
  const now = Math.floor(Date.now() / 1000);
  for (const group of groups.values()) {
    if (group.length < 2) {
      const row = group[0];
      if (isVersionTwo(row.property_name)) {
        const title = confirmedCanonicalAddress(row.property_name, row.property_address)
          || cleanPropertyTitle(row.property_address)
          || cleanPropertyTitle(row.property_name.replace(/\s*[-–—]?\s*\b(?:v|ver|version)\s*2\b/ig, ""));
        await db.prepare("UPDATE management_properties SET property_name = ?, property_address = CASE WHEN ? != '' THEN ? ELSE property_address END, updated_by_email = ?, updated_by_name = ?, updated_at = ? WHERE id = ?")
          .bind(title, title, title, profile.email, profile.fullName, now, row.id).run();
      }
      continue;
    }
    const keeper = [...group].sort((a, b) => propertyKeeperScore(b) - propertyKeeperScore(a))[0];
    const duplicates = group.filter((row) => row.id !== keeper.id);
    const canonicalAddress = canonicalPropertyAddress(group) || cleanPropertyTitle(keeper.property_address || keeper.property_name);
    const hostawayIds = Array.from(new Set(group.flatMap((row) => [row.hostaway_listing_id || "", ...parseArray<string>(row.hostaway_listing_ids)]).filter(Boolean)));
    const listingLinks = mergeLinks([], group.flatMap((row) => parseLinks(row.listing_links)));
    const values = mergePropertyValues(keeper, duplicates);

    for (const duplicate of duplicates) {
      await db.batch([
        db.prepare("UPDATE management_property_sources SET property_id = ? WHERE property_id = ?").bind(keeper.id, duplicate.id),
        db.prepare("UPDATE management_properties SET hostaway_listing_id = NULL, hostaway_listing_ids = '[]', clickup_task_id = NULL, merged_into_property_id = ?, updated_by_email = ?, updated_by_name = ?, updated_at = ? WHERE id = ?").bind(keeper.id, profile.email, profile.fullName, now, duplicate.id),
      ]);
      merged += 1;
    }
    await db.prepare(
      "UPDATE management_properties SET hostaway_listing_id = ?, hostaway_listing_ids = ?, clickup_task_id = ?, clickup_url = ?, property_name = ?, property_address = ?, region = ?, property_type = ?, bedrooms = ?, beds = ?, bathrooms = ?, wc_count = ?, parking = ?, garden = ?, owner_name = ?, owner_company = ?, owner_email = ?, owner_phone = ?, correspondence_address = ?, access_code = ?, access_info = ?, guidebook_url = ?, listing_links = ?, payout_schedule = ?, management_fee_bps = ?, cleaning_cost_pence = ?, payout_notes = ?, updated_by_email = ?, updated_by_name = ?, updated_at = ? WHERE id = ?",
    ).bind(
      hostawayIds[0] || null, JSON.stringify(hostawayIds), values.clickup_task_id, values.clickup_url,
      canonicalAddress, canonicalAddress, values.region, values.property_type, values.bedrooms, values.beds,
      values.bathrooms, values.wc_count, values.parking, values.garden, values.owner_name,
      values.owner_company, values.owner_email, values.owner_phone, values.correspondence_address,
      values.access_code, values.access_info, values.guidebook_url, JSON.stringify(listingLinks),
      values.payout_schedule, values.management_fee_bps, values.cleaning_cost_pence, values.payout_notes,
      profile.email, profile.fullName, now, keeper.id,
    ).run();
  }
  return merged;
}

const VERIFIED_PROPERTY_ALIASES: Record<string, string> = {
  "245jameson": "24/5 Jameson Place, Edinburgh, EH6 8PB",
  "9iona": "9 Iona Rd, Dunfermline, KY11 4ED",
  townend: "21f Townend Rd, Dumbarton, G82 2BA",
  drumilaw: "14, 1/1 Drumilaw Way, Rutherglen, Glasgow, G73 4NW",
  howburn: "2r, 6 Howburn Pl, Aberdeen, AB10 6BL",
  "39upperpitt": "39(1F1) Pitt St, Edinburgh, EH6 4BZ",
  "39lowerpitt": "39(PF) Pitt, Edinburgh, EH6 4BZ",
  "25mayfield": "25 Mayfield Drive, Armadale, EH48 2JQ",
  thewardlaw: "28/13 Wardlaw Place, Edinburgh, EH11 1UQ",
  "642rannoch": "64/2 Rannoch Road, Edinburgh, EH4 7EN",
  "642rannochroadedinburgheh47en": "64/2 Rannoch Road, Edinburgh, EH4 7EN",
  "42fairfaxaveglasgowukg445be": "67 Carna Drive, Glasgow, G44 5BE",
  "42fairfaxaveglasgowg445be": "67 Carna Drive, Glasgow, G44 5BE",
  "67carnadrglasgowg445be": "67 Carna Drive, Glasgow, G44 5BE",
  "67carnadriveglasgowg445be": "67 Carna Drive, Glasgow, G44 5BE",
  "416main": "416 Main Street, Alexandria, G83 0BH",
  "416mainst": "416 Main Street, Alexandria, G83 0BH",
  "416mainstalexandriag830bh": "416 Main Street, Alexandria, G83 0BH",
  "40foxbarcres": "40 Foxbar Crescent, Paisley, PA2 0RJ",
  "40foxbar": "40 Foxbar Crescent, Paisley, PA2 0RJ",
  "4dovemountplhawicktd98azuk": "4 Dovemount Place, Hawick, TD9 8AZ",
  "3bf2albert": "3 (BF2) Albert Street, Edinburgh, EH7 5HL",
  "3bf2albertstreetedinburgheh75hl": "3 (BF2) Albert Street, Edinburgh, EH7 5HL",
  "2813wardlaw": "28/13 Wardlaw Place, Edinburgh, EH11 1UQ",
  "2813wardlawplaceedinburgheh111uq": "28/13 Wardlaw Place, Edinburgh, EH11 1UQ",
  "25mayfielddrivearmadaleeh482jq": "25 Mayfield Drive, Armadale, EH48 2JQ",
  "243firhill": "24/3 Firhill Crescent, Edinburgh, EH13 9EQ",
  "243firhillcrescentedinburgheh139eq": "24/3 Firhill Crescent, Edinburgh, EH13 9EQ",
  "25myreslaw": "2/5 Myreslaw Green, Hawick, TD9 0HZ",
  "25myreslawgrnhawicktd90hz": "2/5 Myreslaw Green, Hawick, TD9 0HZ",
  "1805restalrig": "180/5 Restalrig Road South, Edinburgh, EH7 6EA",
  "1805restalrigroadsouthedinburgheh76ea": "180/5 Restalrig Road South, Edinburgh, EH7 6EA",
  restalrig: "180/5 Restalrig Road South, Edinburgh, EH7 6EA",
  "160westernrd": "160 Western Road, Cambuslang, Glasgow, G72 8EG",
  "160western": "160 Western Road, Cambuslang, Glasgow, G72 8EG",
  "152northfield": "152 Northfield Farm Avenue, Edinburgh, EH8 7QZ",
  "152northfieldfarmavenueedinburgheh87qz": "152 Northfield Farm Avenue, Edinburgh, EH8 7QZ",
  "1411drumilaw": "14, 1/1 Drumilaw Way, Rutherglen, Glasgow, G73 4NW",
  "1411drumilawwayrutherglenglasgowg734nw": "14, 1/1 Drumilaw Way, Rutherglen, Glasgow, G73 4NW",
  donst: "2/1, 35 Don Street, Glasgow, G33 2DG",
  "2135donstglasgowg332dguk": "2/1, 35 Don Street, Glasgow, G33 2DG",
  granton: "11/6 Lower Granton Road, Edinburgh, EH5 3RU",
  "116lowergrantonroadedinburgheh53ru": "11/6 Lower Granton Road, Edinburgh, EH5 3RU",
};

function propertyIdentityKeys(row: DeduplicationRow) {
  const keys: string[] = [];
  const ids = [row.hostaway_listing_id || "", ...parseArray<string>(row.hostaway_listing_ids)].filter(Boolean);
  keys.push(...ids.map((id) => `hostaway:${id}`));
  const canonical = confirmedCanonicalAddress(row.property_name, row.property_address);
  if (canonical) keys.push(`address:${normaliseAddress(canonical)}`);
  const address = normaliseAddress(row.property_address);
  if (!canonical && address.length >= 8) keys.push(`address:${address}`);
  const name = normaliseListingName(row.property_name);
  if (name.length >= 6) keys.push(`name:${name}`);
  return Array.from(new Set(keys));
}

function confirmedCanonicalAddress(name: string, address: string) {
  const alias = VERIFIED_PROPERTY_ALIASES[normaliseListingName(name)];
  if (alias) return alias;
  for (const canonical of Object.values(VERIFIED_PROPERTY_ALIASES)) {
    if (normaliseAddress(address) === normaliseAddress(canonical) || normaliseListingName(name) === normaliseListingName(canonical)) return canonical;
  }
  return "";
}

function canonicalPropertyAddress(rows: DeduplicationRow[]) {
  for (const row of rows) {
    const confirmed = confirmedCanonicalAddress(row.property_name, row.property_address);
    if (confirmed) return confirmed;
  }
  return [...rows].map((row) => cleanPropertyTitle(row.property_address)).filter(Boolean)
    .sort((a, b) => Number(Boolean(extractPostcode(b))) - Number(Boolean(extractPostcode(a))) || b.length - a.length)[0] || "";
}

function propertyKeeperScore(row: DeduplicationRow) {
  return Number(Boolean(row.clickup_task_id)) * 100 + Number(Boolean(extractPostcode(row.property_address))) * 30
    + Number(!isVersionTwo(row.property_name)) * 20 + Number(Boolean(row.hostaway_listing_id)) * 10
    + [row.owner_company, row.owner_name, row.bedrooms, row.beds, row.parking, row.garden].filter(Boolean).length;
}

function mergePropertyValues(keeper: DeduplicationRow, duplicates: DeduplicationRow[]) {
  const rows = [keeper, ...duplicates];
  const first = (key: keyof DeduplicationRow) => String(rows.find((row) => String(row[key] ?? "").trim())?.[key] ?? "");
  return {
    clickup_task_id: first("clickup_task_id") || null, clickup_url: first("clickup_url"), region: first("region"),
    property_type: first("property_type"), bedrooms: first("bedrooms"), beds: first("beds"), bathrooms: first("bathrooms"),
    wc_count: first("wc_count"), parking: first("parking"), garden: first("garden"), owner_name: first("owner_name"),
    owner_company: first("owner_company"), owner_email: first("owner_email"), owner_phone: first("owner_phone"),
    correspondence_address: first("correspondence_address"), access_code: first("access_code"), access_info: first("access_info"),
    guidebook_url: first("guidebook_url"), payout_schedule: first("payout_schedule"),
    management_fee_bps: rows.find((row) => row.management_fee_bps > 0)?.management_fee_bps || 0,
    cleaning_cost_pence: rows.find((row) => row.cleaning_cost_pence > 0)?.cleaning_cost_pence || 0,
    payout_notes: first("payout_notes"),
  };
}

function findHostawayDatabaseMatch(
  rows: Array<{ id: string; hostaway_listing_id: string | null; hostaway_listing_ids: string; clickup_task_id: string | null; property_name: string; property_address: string }>,
  property: GroupedHostawayProperty,
) {
  const ids = new Set(property.ids);
  const confident = rows.filter((row) => isConfidentHostawayMatch(row, property));
  const linkedFromClickUp = confident.find((row) => row.clickup_task_id);
  if (linkedFromClickUp) return linkedFromClickUp;
  const direct = rows.find((row) => ids.has(row.hostaway_listing_id || "") || parseArray<string>(row.hostaway_listing_ids).some((id) => ids.has(id)));
  if (direct) {
    const allDirect = rows.filter((row) => ids.has(row.hostaway_listing_id || "") || parseArray<string>(row.hostaway_listing_ids).some((id) => ids.has(id)));
    return allDirect.find((row) => row.clickup_task_id) || direct;
  }
  const address = normaliseAddress(property.address);
  if (address) {
    const matches = rows.filter((row) => normaliseAddress(row.property_address) === address);
    if (matches.length === 1) return matches[0];
  }
  const name = normaliseListingName(property.name);
  const matches = rows.filter((row) => normaliseListingName(row.property_name) === name);
  return matches.length === 1 ? matches[0] : undefined;
}

function findHostawayDatabaseDuplicates(
  rows: Array<{ id: string; hostaway_listing_id: string | null; hostaway_listing_ids: string; property_name?: string; property_address?: string }>,
  property: GroupedHostawayProperty,
  keepId: string,
) {
  const ids = new Set(property.ids);
  return rows.filter((row) => row.id !== keepId && (
    ids.has(row.hostaway_listing_id || "")
    || parseArray<string>(row.hostaway_listing_ids).some((id) => ids.has(id))
    || isConfidentHostawayMatch(row, property)
  ));
}

function isConfidentHostawayMatch(
  row: { property_name?: string; property_address?: string },
  property: GroupedHostawayProperty,
) {
  if (matchesConfirmedHostawayAlias(row, property)) return true;
  const sourceAddress = normaliseAddress(property.address);
  const targetAddress = normaliseAddress(row.property_address || "");
  if (sourceAddress && targetAddress && sourceAddress === targetAddress) return true;
  const sourceName = normaliseListingName(property.name);
  const targetName = normaliseListingName(row.property_name || "");
  if (!sourceName || !targetName) return false;
  return sourceName === targetName;
}

function matchesConfirmedHostawayAlias(
  row: { property_name?: string; property_address?: string },
  property: GroupedHostawayProperty,
) {
  const sourceName = normaliseListingName(property.name);
  const targetValues = [row.property_name || "", row.property_address || ""].map(normaliseAddress);
  const confirmedTargets: Record<string, string[]> = {
    "39upperpitt": ["391f1pittstedinburgheh64bz", "391f1pittedinburgheh64bz"],
    "39lowerpitt": ["39pfpittedinburgheh64bz"],
    "25mayfield": ["25mayfielddrive"],
    "25mayfielddrive": ["25mayfielddrive"],
    "thewardlaw": ["2813wardlaw"],
  };
  return (confirmedTargets[sourceName] || []).some((target) =>
    targetValues.some((value) => value === target || value.startsWith(target) || target.startsWith(value)),
  );
}

function normaliseListingName(value: string) {
  return cleanPropertyTitle(value).toLowerCase().replace(/\s*[-–—]?\s*\b(?:v|ver|version)\s*2\b\s*$/i, "").replace(/[^a-z0-9]/g, "");
}

function cleanPropertyTitle(value: string) {
  return value.replace(/\s+\([^()]*\)\s*$/g, "").replace(/\s+/g, " ").trim();
}

function isVersionTwo(value: string) {
  return /\b(?:v|ver|version)\s*2\b/i.test(value);
}

function mergeLinks(existing: PropertyListingLink[], incoming: PropertyListingLink[]) {
  const links = new Map<string, PropertyListingLink>();
  for (const link of [...existing, ...incoming]) {
    if (link.url) links.set(link.url.trim().toLowerCase(), link);
  }
  return Array.from(links.values());
}

function parsePositiveInteger(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function clickUpTimestamp(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed / 1000) : 0;
}

function onboardingStatusFromClickUp(record: ClickUpImportRecord) {
  if (record.status === "live") return "live";
  if (record.status === "archived") return "not_proceeding";
  const status = record.clickupStatus.toLowerCase();
  if (/listing/.test(status)) return "listings_in_progress";
  if (/guest.?ready/.test(status)) return "guest_ready";
  if (/furnish/.test(status)) return "furnishing";
  if (/invoice|account/.test(status)) return "invoices_pending";
  if (/purchase|order/.test(status)) return "purchase_order_review";
  if (/inspection/.test(status)) return "inspection_to_book";
  if (/onboard/.test(status)) return "onboarding_form";
  if (/sign|agreement|contract/.test(status)) return "agreement_pending";
  if (/review|estimate/.test(status)) return "reviewing";
  return "enquiry_received";
}

function requireEditor(profile: AccessProfile) {
  if (!canUsePropertyDatabase(profile) || profile.role === "client") throw new Error("Property database editing access required");
}

function database() {
  if (!env.DB) throw new Error("Recharge property database is unavailable");
  return env.DB;
}
