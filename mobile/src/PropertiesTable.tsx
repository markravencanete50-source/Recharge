import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Platform, ScrollView, View, useWindowDimensions } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { Sheet } from "./TeamFlows";
import { Loading, Notice, Tag, london, message } from "./LiveKit";
import { SearchBox } from "./SearchPicker";
import { FavoriteButton } from "./Favorites";
import { Chip } from "./LivePortfolio";
import { PropertyAccess } from "./LiveTools";
import { PropertyProfile } from "./LivePropertyProfile";
import { readFinance, readTeams, workspaceRequest } from "./backend/client";
import { ui, type Palette } from "./theme";
import { formatMoney, plural } from "../../lib/format";
import { updateStamp } from "../../lib/tracker";
import { isFinanceRole, shiftMonth, statementsSchema } from "../../lib/accounts-live";
import { defaultCleanersSchema, type DefaultCleaners } from "../../lib/workspace-teams-policy";
import { ownersSchema, profileAccess } from "../../lib/property-profile";
import {
  DEFAULT_SORT, NO_FILTER, REGION_NOT_SET, SORT_KEYS, SORT_LABEL, buildPropertyRows, filterPropertyRows, nextSort, regionOptions, seesCleaners, sortPropertyRows, statusOptions,
  type PropertyRow, type Sort, type SortKey,
} from "../../lib/property-table";
import { historyDay, historyGroups, propertyHistory, seesHistoryCost, statementHistory, type HistoryEntry, type StatementInput } from "../../lib/property-history";
import type { JourneyView, OperationView } from "../../lib/workflow-forms";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import type { PropertyView } from "../../lib/workspace-view";

// The Properties database for staff: a table on a wide screen and cards on a phone, with a search box,
// region and status filters and a click-in detail sheet (overview, people, maintenance history, and
// statements for finance roles). Owners keep the card grid in LivePages. The data shaping is in
// lib/property-table.ts and lib/property-history.ts.
const DESKTOP = 1024;
const PAGE = 50;
const small = (p: Palette, extra = {}) => [ui.small, { color: p.muted }, extra];
const heading = (p: Palette) => ({ color: p.muted, fontSize: 12, fontWeight: "600" as const, textTransform: "uppercase" as const, letterSpacing: 1 });
const STATUS_TONE: Record<string, "good" | "wait" | "bad" | "plain"> = { active: "good", onboarding: "wait", archived: "plain" };

const stampOf = (row: PropertyRow) => row.lastUpdate
  ? updateStamp(row.lastUpdate.source === "record" && !row.lastUpdate.by ? { ...row.lastUpdate, by: "Property record" } : row.lastUpdate)
  : "No update recorded";
const labelOf = (row: PropertyRow) => [row.address, row.region, row.statusLabel + (row.stage ? ", " + row.stage : ""), row.lastUpdate ? "Updated " + stampOf(row) : "No update recorded"].join(", ");

function StatusCell({ p, row }: { p: Palette; row: PropertyRow }) {
  return (
    <View style={{ gap: 4 }}>
      <Tag label={row.statusLabel} tone={STATUS_TONE[row.status] ?? "plain"} p={p} />
      {!!row.stage && <Text style={small(p)}>{row.stage}</Text>}
    </View>
  );
}

function SortChip({ p, sortKey, sort, onSort }: { p: Palette; sortKey: SortKey; sort: Sort; onSort: (key: SortKey) => void }) {
  const on = sort.key === sortKey;
  return (
    <MotionPress accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`Sort by ${SORT_LABEL[sortKey]}${on ? (sort.dir === "asc" ? ", ascending" : ", descending") : ""}`} onPress={() => onSort(sortKey)}
      style={[ui.row, { gap: 6, minHeight: 36, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: on ? p.primary : p.border, backgroundColor: on ? p.wash : p.surface }]}>
      <Text style={{ color: p.text, fontSize: 13, fontWeight: "600" }}>{SORT_LABEL[sortKey]}</Text>
      {on && <Feather name={sort.dir === "asc" ? "arrow-up" : "arrow-down"} size={14} color={p.primary} />}
    </MotionPress>
  );
}

// The wide layout. Each column heading sorts; the row opens the detail.
const COLUMNS: { key: SortKey; flex: number }[] = [{ key: "address", flex: 2.4 }, { key: "status", flex: 1.2 }, { key: "region", flex: 1.3 }, { key: "updated", flex: 1.7 }];
function Table({ p, rows, sort, onSort, onOpen }: { p: Palette; rows: PropertyRow[]; sort: Sort; onSort: (key: SortKey) => void; onOpen: (row: PropertyRow) => void }) {
  return (
    <View style={{ borderWidth: 1, borderColor: p.border, borderRadius: 14, overflow: "hidden", backgroundColor: p.surface }}>
      <View style={{ flexDirection: "row", backgroundColor: p.wash }}>
        {COLUMNS.map(c => {
          const on = sort.key === c.key;
          return (
            <MotionPress key={c.key} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={`Sort by ${SORT_LABEL[c.key]}${on ? (sort.dir === "asc" ? ", ascending" : ", descending") : ""}`} onPress={() => onSort(c.key)}
              style={[ui.row, { flex: c.flex, minWidth: 0, gap: 6, minHeight: 40, paddingHorizontal: 12 }]}>
              <Text style={[ui.small, { color: on ? p.text : p.muted, fontWeight: "700", letterSpacing: 0.3 }]}>{SORT_LABEL[c.key]}</Text>
              {on && <Feather name={sort.dir === "asc" ? "arrow-up" : "arrow-down"} size={14} color={p.primary} />}
            </MotionPress>
          );
        })}
        <View style={{ width: 36 }} />
      </View>
      {rows.map((row, i) => (
        <MotionPress key={row.id} {...(Platform.OS === "web" ? { dataSet: { hover: "row" } } : {})} accessibilityRole="button" accessibilityLabel={labelOf(row)} onPress={() => onOpen(row)}
          style={[ui.row, { minHeight: 56, borderTopWidth: i ? 1 : 0, borderTopColor: p.border }]}>
          <View style={{ flex: COLUMNS[0].flex, minWidth: 0, paddingHorizontal: 12, paddingVertical: 10, gap: 2 }}>
            <Text numberOfLines={2} style={{ color: p.text, fontSize: 14, lineHeight: 20, fontWeight: "600" }}>{row.address}</Text>
            {row.name !== row.address && <Text numberOfLines={1} style={small(p)}>{row.name}</Text>}
          </View>
          <View style={{ flex: COLUMNS[1].flex, minWidth: 0, paddingHorizontal: 12, paddingVertical: 10 }}><StatusCell p={p} row={row} /></View>
          <View style={{ flex: COLUMNS[2].flex, minWidth: 0, paddingHorizontal: 12, paddingVertical: 10 }}><Text numberOfLines={2} style={[ui.small, { color: row.region === REGION_NOT_SET ? p.muted : p.text }]}>{row.region}</Text></View>
          <View style={{ flex: COLUMNS[3].flex, minWidth: 0, paddingHorizontal: 12, paddingVertical: 10 }}><Text numberOfLines={2} style={[ui.small, { color: row.lastUpdate ? p.text : p.muted, fontVariant: ["tabular-nums"] }]}>{stampOf(row)}</Text></View>
          <View style={{ width: 36, alignItems: "center" }}><Feather name="chevron-right" size={18} color={p.muted} /></View>
        </MotionPress>
      ))}
    </View>
  );
}

// The phone layout: one card per property, with the same facts.
function Cards({ p, rows, onOpen }: { p: Palette; rows: PropertyRow[]; onOpen: (row: PropertyRow) => void }) {
  return (
    <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, paddingVertical: 4, gap: 0 }]}>
      {rows.map((row, i) => (
        <MotionPress key={row.id} accessibilityRole="button" accessibilityLabel={labelOf(row)} onPress={() => onOpen(row)} style={[ui.row, { gap: 12, alignItems: "flex-start", paddingVertical: 14, borderTopWidth: i ? 1 : 0, borderTopColor: p.border }]}>
          <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
            <View style={[ui.row, { gap: 10, alignItems: "flex-start" }]}>
              <Text numberOfLines={2} style={{ flex: 1, minWidth: 0, color: p.text, fontSize: 15, lineHeight: 21, fontWeight: "600" }}>{row.address}</Text>
              <Tag label={row.statusLabel} tone={STATUS_TONE[row.status] ?? "plain"} p={p} />
            </View>
            <Text numberOfLines={1} style={small(p)}>{[row.region, row.stage].filter(Boolean).join(" · ")}</Text>
            <Text numberOfLines={1} style={small(p, { fontVariant: ["tabular-nums"] })}>{row.lastUpdate ? "Updated " : ""}{stampOf(row)}</Text>
          </View>
          <Feather name="chevron-right" size={18} color={p.muted} style={{ alignSelf: "center" }} />
        </MotionPress>
      ))}
    </View>
  );
}

// --- The detail sheet.
function Section({ p, title, children }: { p: Palette; title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 10, paddingTop: 16, borderTopWidth: 1, borderTopColor: p.border }}>
      <Text accessibilityRole="header" style={heading(p)}>{title}</Text>
      {children}
    </View>
  );
}
function Fact({ p, label, value, tone }: { p: Palette; label: string; value: string; tone?: "bad" }) {
  return (
    <View style={{ gap: 2 }}>
      <Text style={[ui.small, { color: p.muted }]}>{label}</Text>
      <Text selectable style={[ui.body, { color: tone === "bad" ? p.danger : p.text }]}>{value}</Text>
    </View>
  );
}

// Landlord names only. The profile below carries the contact details for the roles that may have them.
function OwnerNames({ p, propertyId }: { p: Palette; propertyId: string }) {
  const [names, setNames] = useState<string[] | null>(null), [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    void workspaceRequest("/api/mobile/property-details?" + new URLSearchParams({ propertyId, section: "owner" })).then(r => r.json()).then(body => {
      const parsed = ownersSchema.safeParse(body.data);
      if (active) setNames(parsed.success ? parsed.data.owners.map(o => o.name.trim() || "Name not given") : []);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [propertyId]);
  if (names === null) return failed ? <Fact p={p} label="Landlord" value="Could not be loaded." /> : <Loading p={p} rows={1} />;
  return <Fact p={p} label={names.length > 1 ? "Landlords" : "Landlord"} value={names.length ? names.join(", ") : "No owner is linked yet."} />;
}

function People({ p, account, propertyId, cleaners }: { p: Palette; account: WorkspaceAccount; propertyId: string; cleaners: DefaultCleaners | "error" | null }) {
  const showCleaners = seesCleaners(account.role, account.modules);
  const row = cleaners && cleaners !== "error" ? cleaners.properties.find(x => x.propertyId === propertyId) : undefined;
  const others = cleaners && cleaners !== "error" ? cleaners.cleaners.filter(c => c.propertyIds.includes(propertyId) && c.userId !== row?.cleanerId).map(c => c.fullName) : [];
  return (
    <Section p={p} title="People">
      {showCleaners && (cleaners === null ? <Loading p={p} rows={1} />
        : cleaners === "error" ? <Fact p={p} label="Assigned cleaner" value="Could not be loaded." />
        : <>
          <Fact p={p} label="Assigned cleaner" value={row?.cleanerName ?? "No usual cleaner set"} />
          {!!others.length && <Fact p={p} label="Also cleans here" value={others.join(", ")} />}
        </>)}
      {profileAccess(account).owners ? <OwnerNames p={p} propertyId={propertyId} /> : !showCleaners && <Text style={small(p)}>People details are not part of your access.</Text>}
    </Section>
  );
}

const HISTORY_SHOWN = 5;
function HistoryGroup({ p, title, empty, entries, showCost, onOpen }: { p: Palette; title: string; empty: string; entries: HistoryEntry[]; showCost: boolean; onOpen?: (workId: string) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? entries : entries.slice(0, HISTORY_SHOWN);
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: p.text, fontSize: 14, fontWeight: "600" }}>{title}{entries.length ? ` · ${entries.length}` : ""}</Text>
      {!entries.length && <Text style={small(p)}>{empty}</Text>}
      {shown.map((e, i) => (
        <MotionPress key={e.workId} accessibilityRole={onOpen ? "button" : undefined} disabled={!onOpen} accessibilityLabel={`${e.title}, ${e.status}, ${historyDay(e.date)}`} onPress={() => onOpen?.(e.workId)}
          style={[ui.between, { gap: 12, alignItems: "flex-start", minHeight: 44, paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderTopColor: p.border }]}>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text numberOfLines={2} style={{ color: p.text, fontSize: 14, lineHeight: 20 }}>{e.title}</Text>
            <Text style={small(p, { fontVariant: ["tabular-nums"] })}>{[historyDay(e.date), e.by].filter(Boolean).join(" · ")}</Text>
          </View>
          <View style={{ alignItems: "flex-end", gap: 4 }}>
            <Tag label={e.status} tone={e.tone} p={p} />
            {showCost && e.costMinor !== null && <Text style={small(p, { fontVariant: ["tabular-nums"] })}>{formatMoney(e.costMinor)}{e.costKind === "estimate" ? " estimate" : ""}</Text>}
          </View>
        </MotionPress>
      ))}
      {entries.length > HISTORY_SHOWN && (
        <MotionPress accessibilityRole="button" accessibilityState={{ expanded: all }} onPress={() => setAll(!all)} style={{ alignSelf: "flex-start", minHeight: 40, justifyContent: "center" }}>
          <Text style={[ui.small, { color: p.primary, fontWeight: "600" }]}>{all ? "Show fewer" : `Show all ${entries.length}`}</Text>
        </MotionPress>
      )}
    </View>
  );
}

// The last six months of this property's owner statements, from the finance read. Only mounted for
// finance roles; the database refuses everyone else anyway.
const STATEMENT_MONTHS = 6;
function Statements({ p, propertyId }: { p: Palette; propertyId: string }) {
  const [rows, setRows] = useState<ReturnType<typeof statementHistory> | null>(null), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const thisMonth = london(new Date()).slice(0, 7);
    void Promise.allSettled(Array.from({ length: STATEMENT_MONTHS }, (_, i) => readFinance({ section: "statements", period: shiftMonth(thisMonth, -i), propertyId }))).then(results => {
      if (!active) return;
      const found: StatementInput[] = [];
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        const parsed = statementsSchema.safeParse(r.value.data);
        if (parsed.success) for (const line of parsed.data) found.push(...[line.statement, ...(line.periodStatements ?? [])].filter((s): s is NonNullable<typeof s> => !!s));
      }
      const failed = results.filter(r => r.status === "rejected");
      if (failed.length === results.length) setError(message((failed[0] as PromiseRejectedResult).reason));
      else setRows(statementHistory(found, propertyId));
    });
    return () => { active = false; };
  }, [propertyId]);
  return (
    <Section p={p} title="Statements and payout">
      {!rows && !error && <Loading p={p} rows={2} />}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {rows && !rows.length && <Text style={small(p)}>No statements in the last {STATEMENT_MONTHS} months.</Text>}
      {rows?.map((s, i) => (
        <View key={s.id} style={[ui.between, { gap: 12, paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderTopColor: p.border }]}>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <Text numberOfLines={1} style={{ color: p.text, fontSize: 14 }}>{s.label}</Text>
            <Text style={small(p, { fontVariant: ["tabular-nums"] })}>{s.paidAt ? "Paid " + historyDay(s.paidAt) : "Payout " + formatMoney(s.payoutMinor)}</Text>
          </View>
          <Tag label={s.statusLabel} tone={s.status === "paid" ? "good" : s.status === "issued" ? "wait" : "plain"} p={p} />
        </View>
      ))}
      {!!rows && <Text style={small(p)}>Payout details are shown on request, further down this page.</Text>}
    </Section>
  );
}

function Detail({ p, account, row, journey, work, cleaners, onClose, onOpenWork, extra }: {
  p: Palette; account: WorkspaceAccount; row: PropertyRow; journey?: JourneyView; work: OperationView[]; cleaners: DefaultCleaners | "error" | null;
  onClose: () => void; onOpenWork?: (item: OperationView) => void; extra?: (property: PropertyView) => ReactNode;
}) {
  const property = row.property, costs = seesHistoryCost(account.role);
  const groups = useMemo(() => historyGroups(propertyHistory(work, property.id, { costs })), [work, property.id, costs]);
  const open = onOpenWork && ((workId: string) => { const item = work.find(w => w.workId === workId); if (item) { onClose(); onOpenWork(item); } });
  const finance = isFinanceRole(account.role) && account.modules.includes("owner-statements");
  return (
    <>
      <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
        <StatusCell p={p} row={row} />
        {!!property.bedrooms && <Tag label={plural(property.bedrooms, "bedroom")} tone="plain" p={p} />}
        <FavoriteButton entryKey={"property:" + property.id} label={property.name} palette={p} />
      </View>
      <Section p={p} title="Overview">
        <Fact p={p} label="Address" value={row.address} />
        <Fact p={p} label="Scotland region" value={row.region} />
        <Fact p={p} label="Status" value={row.statusLabel + (row.stage ? " · " + row.stage : "")} />
        {!!row.nextStep && <Fact p={p} label="Next onboarding step" value={row.nextStep} />}
        <Fact p={p} label="Last update" value={row.lastUpdate ? stampOf(row) + (row.lastUpdate.what && row.lastUpdate.source === "work" ? " · " + row.lastUpdate.what : "") : "No update recorded"} />
        <PropertyAccess palette={p} account={account} propertyId={property.id} />
      </Section>
      <People p={p} account={account} propertyId={property.id} cleaners={cleaners} />
      <Section p={p} title="Maintenance history">
        <HistoryGroup p={p} title="Reactive repairs" empty="No repairs reported here." entries={groups.reactive} showCost={costs} onOpen={open} />
        <HistoryGroup p={p} title="Preventative visits" empty="No routine visits recorded here." entries={groups.preventative} showCost={false} onOpen={open} />
      </Section>
      {finance && <Statements p={p} propertyId={property.id} />}
      <PropertyProfile palette={p} account={account} propertyId={property.id} journey={journey} />
      {extra?.(property)}
    </>
  );
}

export function PropertiesTable({ palette: p, account, properties, journeys, work, loading, selected, onSelect, onClose, onOpenWork, extra }: {
  palette: Palette; account: WorkspaceAccount; properties: PropertyView[]; journeys: JourneyView[]; work: OperationView[]; loading: boolean;
  // The open property is held by the page, so the portfolio map and onboarding pipeline can open it too.
  selected: PropertyView | null; onSelect: (property: PropertyView) => void; onClose: () => void;
  onOpenWork?: (item: OperationView) => void;
  // More for the detail sheet, below the profile: set-up steps, new work, reports and invoices.
  extra?: (property: PropertyView) => ReactNode;
}) {
  const { width } = useWindowDimensions();
  const [query, setQuery] = useState(""), [region, setRegion] = useState<string | null>(NO_FILTER.region), [status, setStatus] = useState<string | null>(NO_FILTER.status);
  const [sort, setSort] = useState<Sort>(DEFAULT_SORT), [shown, setShown] = useState(PAGE);
  const [cleaners, setCleaners] = useState<DefaultCleaners | "error" | null>(null);
  const wantCleaners = seesCleaners(account.role, account.modules);
  useEffect(() => {
    if (!wantCleaners) return;
    let active = true;
    void readTeams({ section: "defaultCleaners" }).then(r => { if (active) setCleaners(defaultCleanersSchema.parse(r.data)); }).catch(() => { if (active) setCleaners("error"); });
    return () => { active = false; };
  }, [wantCleaners]);

  const all = useMemo(() => buildPropertyRows(properties, journeys, work), [properties, journeys, work]);
  const regions = useMemo(() => regionOptions(all), [all]), statuses = useMemo(() => statusOptions(all), [all]);
  // A filter whose region or status has since left the data is ignored rather than showing nothing.
  const activeRegion = region && regions.some(r => r.region === region) ? region : null, activeStatus = status && statuses.some(s => s.status === status) ? status : null;
  const rows = useMemo(() => sortPropertyRows(filterPropertyRows(all, { query, region: activeRegion, status: activeStatus }), sort), [all, query, activeRegion, activeStatus, sort]);
  const table = width >= DESKTOP, filtered = !!(query.trim() || activeRegion || activeStatus);
  const row = selected ? all.find(r => r.id === selected.id) : undefined;
  const open = (r: PropertyRow) => onSelect(r.property);
  const change = (apply: () => void) => { apply(); setShown(PAGE); };

  return (
    <View style={{ gap: 12 }}>
      <SearchBox p={p} value={query} onChange={v => change(() => setQuery(v))} placeholder="Search by address, region or status" />
      {!!all.length && (
        <View style={{ gap: 8 }}>
          {regions.length > 1 && <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityLabel="Filter by Scotland region" contentContainerStyle={{ gap: 8 }}>
            {regions.map(r => <Chip key={r.region} p={p} label={r.region} count={r.count} on={activeRegion === r.region} onPress={() => change(() => setRegion(activeRegion === r.region ? null : r.region))} />)}
          </ScrollView>}
          {statuses.length > 1 && <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityLabel="Filter by status" contentContainerStyle={{ gap: 8 }}>
            {statuses.map(s => <Chip key={s.status} p={p} label={s.label} count={s.count} on={activeStatus === s.status} onPress={() => change(() => setStatus(activeStatus === s.status ? null : s.status))} />)}
          </ScrollView>}
          {!table && <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityLabel="Sort the list" contentContainerStyle={{ gap: 8 }}>
            {SORT_KEYS.map(k => <SortChip key={k} p={p} sortKey={k} sort={sort} onSort={key => setSort(nextSort(sort, key))} />)}
          </ScrollView>}
        </View>
      )}
      <View style={[ui.between, { gap: 12 }]}>
        <Text style={small(p, { fontVariant: ["tabular-nums"] })}>{filtered ? `${rows.length} of ${plural(all.length, "property", "properties")}` : plural(all.length, "property", "properties")}</Text>
        {filtered && <MotionPress accessibilityRole="button" onPress={() => change(() => { setQuery(""); setRegion(null); setStatus(null); })} style={{ minHeight: 40, justifyContent: "center" }}><Text style={[ui.small, { color: p.primary, fontWeight: "600" }]}>Clear filters</Text></MotionPress>}
      </View>
      {loading && !all.length && <Loading p={p} />}
      {!loading && !!all.length && !rows.length && <Notice text="No properties match. Try another word, or clear the filters." p={p} />}
      {!!rows.length && (table ? <Table p={p} rows={rows.slice(0, shown)} sort={sort} onSort={key => setSort(nextSort(sort, key))} onOpen={open} /> : <Cards p={p} rows={rows.slice(0, shown)} onOpen={open} />)}
      {rows.length > shown && <MotionPress accessibilityRole="button" onPress={() => setShown(shown + PAGE)} style={{ alignSelf: "flex-start", minHeight: 44, justifyContent: "center" }}><Text style={{ color: p.primary, fontWeight: "600" }}>Show more ({rows.length - shown} more)</Text></MotionPress>}
      <Sheet palette={p} visible={!!row} onClose={onClose} title={row?.name ?? ""} subtitle={row && row.address !== row.name ? row.address : undefined} icon="house">
        {row && <Detail key={row.id} p={p} account={account} row={row} journey={journeys.find(j => j.propertyId === row.id)} work={work} cleaners={cleaners} onClose={onClose} onOpenWork={onOpenWork} extra={extra} />}
      </Sheet>
    </View>
  );
}
