import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { z } from "zod";
import { Text } from "./Typography";
import { addDays, Button, london, message } from "./LiveKit";
import { useSaved } from "./Celebrate";
import { FlagButton } from "./ManagementFlag";
import { TrackerDetailSheet, TrackerList } from "./Tracker";
import { ListingSheet, PricingSheet, ReviewSheet } from "./ListingSheets";
import { readOperations, readTeams } from "./backend/client";
import { ui } from "./theme";
import type { SectionProps } from "./SectionProps";
import { canFlag, canFlagTarget, FLAG_NEEDS_RECORD_HINT, parseFlags, withFlags, type Flag } from "../../lib/management-flags";
import type { TrackerItem } from "../../lib/tracker";
import {
  listingHealthTrackerItems, parseStayDates, PRICING_HORIZON_DAYS, pricingTrackerItems, relistingTrackerItems, reviewTrackerItems,
  type ListingKind, type ListingSource, type ListingsContext, type LogKey, type StayDates,
} from "../../lib/tracker-listings";
import { createOperationForms, workItemForms, type OperationView } from "../../lib/workflow-forms";
import { operationViewSchema, type PropertyView } from "../../lib/workspace-view";

// Client relations tabs (client ask C7): listing health, pricing, reviews and re-listing in the same
// row format as every other tracker. One row per live property (re-listing: one per piece of work),
// with the address, what is next, the action to take, when and by whom it last moved, and a progress
// bar. Open a row for its checklist and the button that opens the existing sheet to log a check, a
// price or a review. Staff only: owners never see these sections.
const COPY: Record<ListingKind, { title: string; intro: string; empty: string; log?: { label: string; icon: "check-circle" | "tag" | "star" } }> = {
  listing_health: { title: "Listing health", intro: "A check on every live listing each day: is it visible, is anything suspended, is there a new review. Open a property to record the check.", empty: "No live properties to check yet.", log: { label: "Record a listing check", icon: "check-circle" } },
  pricing: { title: "Pricing", intro: "Empty nights in the next seven days. Each one is held or changed, with a reason. Open a property to price its nights.", empty: "No live properties to price yet.", log: { label: "Price a night", icon: "tag" } },
  reviews: { title: "Reviews", intro: "Guest reviews logged for each property in the last 30 days, and any bad review still waiting for a reply.", empty: "No live properties yet.", log: { label: "Log a guest review", icon: "star" } },
  relisting: { title: "Re-listing", intro: "Properties that need their listing put back up, after a bad review or a hidden or suspended listing.", empty: "Nothing needs re-listing." },
};
const LOG_KEY: Record<Exclude<ListingKind, "relisting">, LogKey> = { listing_health: "listing_health", pricing: "daily_pricing", reviews: "guest_review" };

function ListingsSection({ palette: p, account, properties, journeys, work, onForm, onOpenWork, kind }: SectionProps & { kind: ListingKind }) {
  const saved = useSaved();
  const hidden = account.role === "client";
  const [today] = useState(() => london(new Date()));
  const [fresh, setFresh] = useState<{ base: OperationView[]; data: OperationView[] } | null>(null);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [stays, setStays] = useState<StayDates[] | undefined>(undefined);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [listingFor, setListingFor] = useState<PropertyView | null>(null);
  const [reviewFor, setReviewFor] = useState<PropertyView | null>(null);
  const [pricingFor, setPricingFor] = useState<{ property: PropertyView; nights: string[] } | null>(null);
  // After logging something the list reads the operations again; a newer list from the host wins.
  const rows = fresh && fresh.base === work ? fresh.data : work;

  const load = useCallback(async (operations: boolean) => {
    const [o, f, s] = await Promise.allSettled([
      operations ? readOperations() : Promise.resolve(null),
      readTeams({ section: "flags" }),
      kind === "pricing" ? readTeams({ section: "schedule", from: today, to: addDays(today, PRICING_HORIZON_DAYS) }) : Promise.resolve(null),
    ]);
    if (o.status === "fulfilled" && o.value) {
      const parsed = z.array(operationViewSchema).safeParse((o.value as { data: unknown }).data);
      if (parsed.success) { setFresh({ base: work, data: parsed.data }); setError(""); } else setError("The list could not be read. Refresh to try again.");
    } else if (o.status === "rejected") setError(message(o.reason));
    if (f.status === "fulfilled") setFlags(parseFlags((f.value as { data: unknown }).data));
    // Without the stays the empty nights come only from the system's own tickets.
    if (s.status === "fulfilled" && s.value) setStays(parseStayDates((s.value as { data: unknown }).data));
  }, [kind, today, work]);
  useEffect(() => { if (hidden) return; let active = true; queueMicrotask(() => { if (active) void load(false); }); return () => { active = false; }; }, [load, hidden]);

  const items = useMemo(() => {
    const allowed = new Map<string, Set<string>>();
    const can = (propertyId: string, key: LogKey) => {
      if (!allowed.has(propertyId)) allowed.set(propertyId, new Set(createOperationForms(account, propertyId).map(f => f.key)));
      return allowed.get(propertyId)!.has(key);
    };
    const ctx: ListingsContext = { properties, today, now: new Date(), owner: false, property: (id: string) => properties.find(x => x.id === id), forms: (w: OperationView) => workItemForms(account, w, journeys, rows), can, ...(stays ? { stays } : {}) };
    const built: TrackerItem[] = kind === "listing_health" ? listingHealthTrackerItems(rows, ctx) : kind === "pricing" ? pricingTrackerItems(rows, ctx) : kind === "reviews" ? reviewTrackerItems(rows, ctx) : relistingTrackerItems(rows, ctx);
    return withFlags(built, flags);
  }, [kind, rows, properties, journeys, account, today, stays, flags]);
  const open = items.find(i => i.id === openId) ?? null;
  const copy = COPY[kind];
  if (hidden) return null;

  const isWork = kind === "relisting";
  const source = open && !isWork ? (open.source as ListingSource) : null;
  const property = open ? properties.find(x => x.id === open.propertyId) ?? null : null;
  const openWork = open ? (isWork ? rows.find(w => w.workId === open.workId) : source?.latest ?? undefined) : undefined;
  const mayLog = !!open && !isWork && createOperationForms(account, open.propertyId ?? "").some(f => f.key === LOG_KEY[kind as Exclude<ListingKind, "relisting">]);
  const done = saved(() => load(true));
  const startLog = () => {
    if (!property || !source) return;
    setOpenId(null);
    if (kind === "listing_health") setListingFor(property);
    else if (kind === "reviews") setReviewFor(property);
    else if (source.nights.length) setPricingFor({ property, nights: source.nights });
  };

  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>{copy.title}</Text>
        <Text style={[ui.small, { color: p.muted }]}>{copy.intro}</Text>
      </View>
      <TrackerList p={p} items={items} error={error} onOpen={i => setOpenId(i.id)} empty={copy.empty} groups={kind !== "reviews"} />
      <TrackerDetailSheet p={p} item={open} forms={isWork && openWork ? workItemForms(account, openWork, journeys, rows) : []} onForm={onForm} onClose={() => setOpenId(null)}>
        {!!open && <View style={{ gap: 10 }}>
          {!isWork && !!copy.log && mayLog && (kind !== "pricing" || !!source?.nights.length) && <Button label={copy.log.label} icon={copy.log.icon} primary p={p} onPress={startLog} />}
          {kind === "pricing" && !!source?.pending && <Button label="Record the applied price" icon="check" p={p} onPress={() => { setOpenId(null); onOpenWork(source.pending!); }} />}
          {!!openWork && <Button label={isWork ? "Open the full ticket" : "Open the latest record"} icon="external-link" p={p} onPress={() => { setOpenId(null); onOpenWork(openWork); }} />}
          {canFlagTarget(open)
            ? <FlagButton p={p} role={account.role} target={{ workId: open.workId, propertyId: open.propertyId, title: `${copy.title}: ${open.address}` }} onDone={() => void load(false)} />
            : canFlag(account.role) && <View style={{ gap: 6 }}><Button label="Flag for management" icon="flag" p={p} disabled onPress={() => undefined} /><Text style={[ui.small, { color: p.muted }]}>{FLAG_NEEDS_RECORD_HINT}</Text></View>}
        </View>}
      </TrackerDetailSheet>
      <ListingSheet p={p} property={listingFor} onClose={() => setListingFor(null)} onDone={done} />
      <ReviewSheet p={p} property={reviewFor} onClose={() => setReviewFor(null)} onDone={done} />
      <PricingSheet p={p} target={pricingFor} onClose={() => setPricingFor(null)} onDone={done} />
    </View>
  );
}

export const ListingHealthList = (props: SectionProps) => <ListingsSection {...props} kind="listing_health" />;
export const PricingList = (props: SectionProps) => <ListingsSection {...props} kind="pricing" />;
export const ReviewsList = (props: SectionProps) => <ListingsSection {...props} kind="reviews" />;
export const RelistingList = (props: SectionProps) => <ListingsSection {...props} kind="relisting" />;
