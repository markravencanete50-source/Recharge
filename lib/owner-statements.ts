import { env } from "cloudflare:workers";
import type { AccessProfile } from "@/lib/access";
import { isHostawayConfigured, listHostawayReservations } from "@/lib/hostaway";

export type OwnerBooking = { id: string; bookingReference: string; propertyId: string; propertyName: string; ownerName: string; ownerEmail: string; channel: string; arrivalDate: string; departureDate: string; grossRevenuePence: number; cleaningFeePence: number; expectedPayoutPence: number; actualReceivedPence: number; status: string; note: string };
export type OwnerReceipt = { id: string; channel: string; payoutReference: string; receivedDate: string; amountPence: number; allocatedPence: number; status: string };
export type OwnerStatement = { id: string; propertyId: string; propertyName: string; ownerName: string; ownerEmail: string; periodStart: string; periodEnd: string; grossRevenuePence: number; receivedRevenuePence: number; cleaningCostPence: number; managementFeePence: number; ownerPayoutPence: number; status: string; issuedAt: number | null };
export type OwnerStatementsData = { available: boolean; connections: { hostaway: boolean; xero: boolean; airbnb: boolean; booking: boolean; vrbo: boolean; direct: boolean }; properties: Array<{ id: string; name: string; ownerName: string; ownerEmail: string }>; bookings: OwnerBooking[]; receipts: OwnerReceipt[]; statements: OwnerStatement[]; lastSyncedAt: number | null };

function db() { if (!env.DB) throw new Error("Accounts database is unavailable"); return env.DB; }
export function canUseOwnerStatements(profile: AccessProfile) { return profile.role === "admin" || profile.role === "stays"; }
function channel(value: string) { const name = value.toLowerCase(); if (name.includes("airbnb")) return "Airbnb"; if (name.includes("booking")) return "Booking.com"; if (name.includes("vrbo") || name.includes("homeaway")) return "Vrbo"; return "Direct"; }
function feeBps(value: string) { return value === "Airbnb" ? 1850 : value === "Booking.com" ? 1800 : value === "Vrbo" ? 1500 : 300; }
function status(expected: number, actual: number) { if (!actual) return "awaiting"; const difference = actual - expected; if (Math.abs(difference) <= 100) return "matched"; if (actual < expected) return actual < expected * 0.98 ? "underpaid" : "partial"; return "overpaid"; }

export async function getOwnerStatementsData(): Promise<OwnerStatementsData> {
  try {
    const database = db();
    const [properties, bookings, receipts, statements, sync] = await Promise.all([
      database.prepare("SELECT id, property_name, owner_name, owner_email FROM management_properties WHERE merged_into_property_id IS NULL AND status = 'live' ORDER BY property_name COLLATE NOCASE").all<any>(),
      database.prepare("SELECT id, booking_reference, property_id, property_name, owner_name, owner_email, channel, arrival_date, departure_date, gross_revenue_pence, cleaning_fee_pence, expected_payout_pence, actual_received_pence, status, note FROM owner_statement_bookings ORDER BY arrival_date DESC LIMIT 1500").all<any>(),
      database.prepare("SELECT id, channel, payout_reference, received_date, amount_pence, allocated_pence, status FROM owner_statement_receipts ORDER BY received_date DESC, created_at DESC LIMIT 1000").all<any>(),
      database.prepare("SELECT id, property_id, property_name, owner_name, owner_email, period_start, period_end, gross_revenue_pence, received_revenue_pence, cleaning_cost_pence, management_fee_pence, owner_payout_pence, status, issued_at FROM owner_statements ORDER BY period_start DESC, property_name LIMIT 500").all<any>(),
      database.prepare("SELECT MAX(updated_at) AS last_synced_at FROM owner_statement_bookings").first<any>(),
    ]);
    const configured = isHostawayConfigured();
    return { available: true, connections: { hostaway: configured, xero: false, airbnb: false, booking: false, vrbo: false, direct: false }, properties: properties.results.map((r:any) => ({ id:r.id, name:r.property_name, ownerName:r.owner_name, ownerEmail:r.owner_email })), bookings: bookings.results.map((r:any) => ({ id:r.id, bookingReference:r.booking_reference, propertyId:r.property_id, propertyName:r.property_name, ownerName:r.owner_name, ownerEmail:r.owner_email, channel:r.channel, arrivalDate:r.arrival_date, departureDate:r.departure_date, grossRevenuePence:r.gross_revenue_pence, cleaningFeePence:r.cleaning_fee_pence, expectedPayoutPence:r.expected_payout_pence, actualReceivedPence:r.actual_received_pence, status:r.status, note:r.note })), receipts: receipts.results.map((r:any) => ({ id:r.id, channel:r.channel, payoutReference:r.payout_reference, receivedDate:r.received_date, amountPence:r.amount_pence, allocatedPence:r.allocated_pence, status:r.status })), statements: statements.results.map((r:any) => ({ id:r.id, propertyId:r.property_id, propertyName:r.property_name, ownerName:r.owner_name, ownerEmail:r.owner_email, periodStart:r.period_start, periodEnd:r.period_end, grossRevenuePence:r.gross_revenue_pence, receivedRevenuePence:r.received_revenue_pence, cleaningCostPence:r.cleaning_cost_pence, managementFeePence:r.management_fee_pence, ownerPayoutPence:r.owner_payout_pence, status:r.status, issuedAt:r.issued_at })), lastSyncedAt: sync?.last_synced_at || null };
  } catch (error) { console.error("Unable to load owner statements", error); return { available:false, connections:{hostaway:false,xero:false,airbnb:false,booking:false,vrbo:false,direct:false}, properties:[], bookings:[], receipts:[], statements:[], lastSyncedAt:null }; }
}

export async function syncOwnerBookings() {
  if (!isHostawayConfigured()) throw new Error("Connect Hostaway before syncing bookings.");
  const database = db();
  const properties = await database.prepare("SELECT id, property_name, owner_name, owner_email, hostaway_listing_id, hostaway_listing_ids, cleaning_cost_pence FROM management_properties WHERE merged_into_property_id IS NULL AND status = 'live'").all<any>();
  const now = Math.floor(Date.now()/1000); let count = 0;
  for (const property of properties.results) {
    let extra: string[] = []; try { extra = JSON.parse(property.hostaway_listing_ids || "[]"); } catch {}
    const ids = Array.from(new Set([property.hostaway_listing_id, ...extra].filter(Boolean)));
    for (const listingId of ids) {
      const reservations = await listHostawayReservations(String(listingId));
      for (const reservation of reservations) {
        if (!reservation.arrivalDate || !reservation.grossRevenuePence || /cancel/i.test(reservation.status)) continue;
        const sourceChannel = channel(reservation.channelName); const expected = Math.max(0, Math.round(reservation.grossRevenuePence * (10000-feeBps(sourceChannel))/10000));
        await database.prepare("INSERT INTO owner_statement_bookings (id, source_key, hostaway_reservation_id, booking_reference, property_id, property_name, owner_name, owner_email, channel, arrival_date, departure_date, gross_revenue_pence, cleaning_fee_pence, expected_payout_pence, actual_received_pence, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'awaiting', ?, ?) ON CONFLICT(source_key) DO UPDATE SET booking_reference=excluded.booking_reference, property_name=excluded.property_name, owner_name=excluded.owner_name, owner_email=excluded.owner_email, channel=excluded.channel, arrival_date=excluded.arrival_date, departure_date=excluded.departure_date, gross_revenue_pence=excluded.gross_revenue_pence, cleaning_fee_pence=excluded.cleaning_fee_pence, expected_payout_pence=excluded.expected_payout_pence, updated_at=excluded.updated_at").bind(crypto.randomUUID(), `hostaway:${reservation.id}`, reservation.id, reservation.bookingReference, property.id, property.property_name, property.owner_name, property.owner_email, sourceChannel, reservation.arrivalDate, reservation.departureDate, reservation.grossRevenuePence, reservation.cleaningFeePence || property.cleaning_cost_pence || 0, expected, now, now).run(); count++;
      }
    }
  }
  return count;
}

export async function importReceipts(profile: AccessProfile, rows: Array<{ channel:string; reference:string; date:string; amountPence:number }>) {
  const database=db(); const now=Math.floor(Date.now()/1000);
  for (const row of rows) await database.prepare("INSERT INTO owner_statement_receipts (id, source_key, channel, payout_reference, received_date, amount_pence, allocated_pence, status, imported_by_email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, 'unmatched', ?, ?, ?) ON CONFLICT(source_key) DO UPDATE SET amount_pence=excluded.amount_pence, received_date=excluded.received_date, updated_at=excluded.updated_at").bind(crypto.randomUUID(), `receipt:${row.channel}:${row.reference}:${row.date}`, channel(row.channel), row.reference, row.date, row.amountPence, profile.email, now, now).run();
  await autoMatch(profile);
}

export async function autoMatch(profile: AccessProfile) {
  const database=db(); const receipts=await database.prepare("SELECT * FROM owner_statement_receipts WHERE status != 'matched' ORDER BY received_date").all<any>();
  for (const receipt of receipts.results) {
    const candidates=await database.prepare("SELECT * FROM owner_statement_bookings WHERE actual_received_pence = 0 AND lower(channel)=lower(?) AND (booking_reference = ? OR abs(expected_payout_pence - ?) <= 100) ORDER BY CASE WHEN booking_reference = ? THEN 0 ELSE 1 END LIMIT 2").bind(receipt.channel, receipt.payout_reference, receipt.amount_pence, receipt.payout_reference).all<any>();
    if (candidates.results.length !== 1) continue; const booking=candidates.results[0]; const amount=Math.min(receipt.amount_pence, booking.expected_payout_pence); const now=Math.floor(Date.now()/1000);
    await database.batch([
      database.prepare("INSERT INTO owner_statement_allocations (id, receipt_id, booking_id, amount_pence, created_by_email, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(receipt_id, booking_id) DO UPDATE SET amount_pence=excluded.amount_pence").bind(crypto.randomUUID(), receipt.id, booking.id, amount, profile.email, now),
      database.prepare("UPDATE owner_statement_receipts SET allocated_pence=?, status=?, updated_at=? WHERE id=?").bind(amount, amount===receipt.amount_pence?"matched":"partially_matched", now, receipt.id),
      database.prepare("UPDATE owner_statement_bookings SET actual_received_pence=?, status=?, updated_at=? WHERE id=?").bind(amount, status(booking.expected_payout_pence, amount), now, booking.id),
    ]);
  }
}

export async function allocateReceipt(profile: AccessProfile, receiptId:string, bookingId:string, amountPence:number) {
  const database=db(); const now=Math.floor(Date.now()/1000); const [receipt,booking]=await Promise.all([database.prepare("SELECT * FROM owner_statement_receipts WHERE id=?").bind(receiptId).first<any>(), database.prepare("SELECT * FROM owner_statement_bookings WHERE id=?").bind(bookingId).first<any>()]); if(!receipt||!booking) throw new Error("Receipt or booking not found.");
  const receiptAllocated=Math.min(receipt.amount_pence, receipt.allocated_pence+amountPence); const bookingReceived=booking.actual_received_pence+amountPence;
  await database.batch([database.prepare("INSERT INTO owner_statement_allocations (id, receipt_id, booking_id, amount_pence, created_by_email, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(receipt_id, booking_id) DO UPDATE SET amount_pence=amount_pence+excluded.amount_pence").bind(crypto.randomUUID(),receiptId,bookingId,amountPence,profile.email,now), database.prepare("UPDATE owner_statement_receipts SET allocated_pence=?, status=?, updated_at=? WHERE id=?").bind(receiptAllocated,receiptAllocated>=receipt.amount_pence?"matched":"partially_matched",now,receiptId), database.prepare("UPDATE owner_statement_bookings SET actual_received_pence=?, status=?, updated_at=? WHERE id=?").bind(bookingReceived,status(booking.expected_payout_pence,bookingReceived),now,bookingId)]);
}

export async function createOwnerStatement(profile:AccessProfile, propertyId:string, month:string) {
  const database=db(); const start=`${month}-01`; const end=new Date(`${start}T12:00:00Z`); end.setUTCMonth(end.getUTCMonth()+1); end.setUTCDate(0); const endDate=end.toISOString().slice(0,10); const property=await database.prepare("SELECT * FROM management_properties WHERE id=?").bind(propertyId).first<any>(); if(!property) throw new Error("Property not found.");
  const rows=await database.prepare("SELECT * FROM owner_statement_bookings WHERE property_id=? AND arrival_date BETWEEN ? AND ? AND actual_received_pence > 0").bind(propertyId,start,endDate).all<any>(); if(!rows.results.length) throw new Error("No cleared booking receipts are available for this property and month.");
  const gross=rows.results.reduce((n:number,r:any)=>n+r.gross_revenue_pence,0); const received=rows.results.reduce((n:number,r:any)=>n+r.actual_received_pence,0); const cleaning=rows.results.reduce((n:number,r:any)=>n+(r.cleaning_fee_pence||property.cleaning_cost_pence||0),0); const feeRate=(property.management_fee_bps||1500)/10000; const management=Math.max(0,Math.round((received-cleaning)*feeRate*1.2)); const payout=Math.max(0,received-cleaning-management); const now=Math.floor(Date.now()/1000); const sourceKey=`statement:${propertyId}:${month}`;
  await database.prepare("INSERT INTO owner_statements (id, source_key, property_id, property_name, owner_name, owner_email, period_start, period_end, gross_revenue_pence, received_revenue_pence, cleaning_cost_pence, management_fee_pence, owner_payout_pence, status, created_by_email, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?) ON CONFLICT(source_key) DO UPDATE SET gross_revenue_pence=excluded.gross_revenue_pence, received_revenue_pence=excluded.received_revenue_pence, cleaning_cost_pence=excluded.cleaning_cost_pence, management_fee_pence=excluded.management_fee_pence, owner_payout_pence=excluded.owner_payout_pence, updated_at=excluded.updated_at").bind(crypto.randomUUID(),sourceKey,propertyId,property.property_name,property.owner_name,property.owner_email,start,endDate,gross,received,cleaning,management,payout,profile.email,now,now).run();
}

export async function issueOwnerStatement(id:string) { const now=Math.floor(Date.now()/1000); await db().prepare("UPDATE owner_statements SET status='issued', issued_at=?, updated_at=? WHERE id=?").bind(now,now,id).run(); }
