import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Platform, View, useWindowDimensions } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Crypto from "expo-crypto";
import { Text } from "./Typography";
import { useCelebrate } from "./Celebrate";
import { MotionPress } from "./motion";
import { matchesSearch, SEARCH_LIST_ABOVE, SearchBox } from "./SearchPicker";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { Button, Field, Notice, Tag, message } from "./LiveKit";
import { formatCount, formatDay, plural } from "../../lib/format";
import { PAYOUT_CHANNEL_LABEL, RECONCILED_CHANNELS, type PayoutChannel } from "../../lib/payout-report-formats";
import { writeFinance } from "./backend/client";
import { CalendarPicker } from "./CalendarPicker";
import { pillBox, pillInk } from "./Pills";
import { payoutCalendarMonth, payoutCalendarScope, payoutDataBounds, payoutDayCounts, togglePayoutDay } from "../../lib/payout-calendar";
import {
  BULK_PAYOUT_CHUNK, CHANNEL_LABEL, bulkApprovalSchema, bulkPayoutPlan, chunk, filterPayouts, payoutApproval, payoutDifference, payoutMove, payoutSearchText, payoutStateLabel, payoutTotals,
  pounds, sumBulkApprovals, type BulkApproval, type PayoutRow, type PayoutStatusFilter,
} from "../../lib/accounts-live";

// The Platform stays list on the Reconciliation screen: figures that line up, an Approve button on each row so nothing has to be
// opened, a search, a calendar of check-in days, and "Approve all" for what is in view. Approving here makes the same checks as the
// sheet behind each row (the database repeats them), and the amount is always printed on the button before anything is sent.
// What is "in view" is one thing everywhere: the search, the platform, then the status. The counts on the calendar and "Approve
// all" read from it; a day chosen on the calendar narrows the figures and the list to that day, and "Approve these N" in the
// day's heading works on that day only (lib/payout-calendar.ts), so no button reaches a stay that is not in view.
const PAGE = 50;
const WIDE = 1120, PHONE = 600;
const COLUMN = { day: 88, money: 92, status: 184, action: 196 };
const NOTE_AT_EXPECTED = "Approved from the payouts list at the expected amount, before the payout arrived.";
const NOTE_AT_RECEIVED = "Approved from the payouts list at the amount received.";
const DEFAULT_BULK_NOTE = "Checked on the payouts list.";
// "row" is a row or its wrapper, "rowhit" the part that opens it (lib/design-tokens.ts): a quiet wash on hover and a bar on keyboard focus, never a box.
const hover = (kind: "row" | "rowhit") => (Platform.OS === "web" ? { dataSet: { hover: kind } } : {});
const longDay = (iso: string) => new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).replaceAll(",", "");
const LABEL = { fontSize: 11, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase" } as const;

export type PayoutStaysProps = {
  p: Palette; rows: PayoutRow[]; periodLabel: string; canApprove: boolean;
  propertyName: (propertyId: string) => string | undefined;
  onOpen: (row: PayoutRow) => void;       // the sheet behind a row: approve with your own amount and note, or add what it is missing
  onLines?: (row: PayoutRow) => void;     // the payout lines behind a stay (PayoutLinesSheet); finance roles only
  onChanged: () => Promise<void>;         // reload the screen's figures after something was approved
};

export function PayoutStays({ p, rows, periodLabel, canApprove, propertyName, onOpen, onLines, onChanged }: PayoutStaysProps) {
  const celebrate = useCelebrate();
  const screen = useWindowDimensions();
  const [measured, setMeasured] = useState(0);
  const width = measured || screen.width;
  const wide = width >= WIDE, phone = width < PHONE;
  // The calendar sits beside the figures and filters on a wide screen, under them otherwise.
  const beside = screen.width >= 900;
  const [status, setStatus] = useState<PayoutStatusFilter>("open");
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState<"all" | PayoutChannel>("all");
  const [picked, setPicked] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [local, setLocal] = useState<Record<string, PayoutRow>>({});
  const [busy, setBusy] = useState<string[]>([]);
  const [problem, setProblem] = useState("");
  // The approval sheet.
  const [sheet, setSheet] = useState(false);
  const [includeDifferent, setIncludeDifferent] = useState(false);
  // What the approval sheet works on: everything in view, or the chosen day.
  const [target, setTarget] = useState<"all" | "day">("all");
  const [note, setNote] = useState(DEFAULT_BULK_NOTE);
  const [running, setRunning] = useState<{ done: number; total: number } | null>(null);
  const [sheetError, setSheetError] = useState("");
  const [result, setResult] = useState<BulkApproval | null>(null);
  // One request identifier per attempt, kept until it succeeds, so a retry after a lost reply replays the original request.
  const ids = useRef(new Map<string, string>());
  const idFor = (key: string) => { if (!ids.current.has(key)) ids.current.set(key, Crypto.randomUUID()); return ids.current.get(key)!; };
  const inFlight = useRef(new Set<string>());

  // A new month starts from the top with every date and no search. Rows approved here show as approved straight away; once the
  // reload arrives these local copies are dropped and the server's answer is what is shown.
  useEffect(() => { queueMicrotask(() => { setPicked(null); setQuery(""); setShown(PAGE); }); }, [periodLabel]);
  useEffect(() => { queueMicrotask(() => setLocal({})); }, [rows]);

  const all = useMemo(() => rows.map(row => local[row.reservationId] ?? row), [rows, local]);
  // A search box appears above eight stays, as it does on every other long list. Every word typed must appear somewhere in
  // what a row shows, so "pitt 1 oct" finds the stays at Pitt Street that check in on 1 October.
  const searchable = all.length > SEARCH_LIST_ABOVE;
  const needle = searchable ? query.trim() : "";
  const searched = useMemo(() => needle ? all.filter(row => matchesSearch(payoutSearchText(row, propertyName(row.propertyId)) + " " + stateOf(row)[0].toLowerCase(), needle)) : all, [all, needle, propertyName]);
  // The platform filter narrows what the search found; its chips count the search, so a chip never promises more than it shows.
  const perPlatform = useMemo(() => RECONCILED_CHANNELS.map(channel => ({ channel, count: searched.filter(row => row.channel === channel).length })), [searched]);
  const platformsHeld = perPlatform.filter(x => x.count > 0).length;
  const inPlatform = useMemo(() => platform === "all" ? searched : searched.filter(row => row.channel === platform), [searched, platform]);
  const byStatus = useMemo(() => filterPayouts(inPlatform, status), [inPlatform, status]);
  const dayCounts = useMemo(() => payoutDayCounts(byStatus), [byStatus]);
  const bounds = useMemo(() => payoutDataBounds(all), [all]);
  // A day with nothing left on it (everything there was just approved) drops out of the choice by itself.
  const chosen = picked && dayCounts[picked] ? picked : null;
  const calendar = useMemo(() => payoutCalendarScope(byStatus, chosen), [byStatus, chosen]);
  const scope = calendar.list;
  const totals = useMemo(() => payoutTotals(scope), [scope]);
  const plan = target === "day" && calendar.day ? calendar.day : calendar.all;
  const bulk = useMemo(() => bulkPayoutPlan(target === "day" && chosen ? scope : byStatus, includeDifferent), [target, chosen, scope, byStatus, includeDifferent]);
  const counts = useMemo(() => ({ open: filterPayouts(inPlatform, "open").length, settled: filterPayouts(inPlatform, "settled").length, all: inPlatform.length }), [inPlatform]);
  const visible = scope.slice(0, shown);
  const approvable = calendar.all.items.length, approvableDay = calendar.day?.items.length ?? 0;
  const bulkMinor = bulk.atExpected.minor + bulk.atReceived.minor;
  const scopeDates = target === "day" && chosen ? longDay(chosen) : `Every date in ${periodLabel}`;
  // The confirmation says what was searched for too, so nobody approves a narrower set than they think.
  const scopeLabel = needle ? `${scopeDates} · matching “${needle.length > 40 ? needle.slice(0, 40) + "…" : needle}”` : scopeDates;
  const pickDay = (date: string | null) => { setShown(PAGE); setPicked(prev => togglePayoutDay(prev, date, dayCounts)); };

  async function approveOne(row: PayoutRow) {
    const approval = payoutApproval(row);
    if (!approval || inFlight.current.has(row.reservationId)) return;
    const key = `one:${row.reservationId}:${row.version}:${approval.agreedMinor}`, text = approval.basis === "received" ? NOTE_AT_RECEIVED : NOTE_AT_EXPECTED;
    inFlight.current.add(row.reservationId); setBusy(prev => [...prev, row.reservationId]); setProblem("");
    try {
      await writeFinance({ action: "agreePayout", requestId: idFor(key), reservationId: row.reservationId, version: row.version, agreedMinor: approval.agreedMinor, note: text });
      ids.current.delete(key);
      setLocal(prev => ({ ...prev, [row.reservationId]: { ...row, state: "agreed", agreedMinor: approval.agreedMinor, settledMinor: approval.agreedMinor, agreementNote: text } }));
      celebrate(`Approved ${pounds(approval.agreedMinor)}`);
      void onChanged();
    } catch (e) {
      setProblem(`${row.reference}: ${message(e)}`);
      void onChanged();
    } finally {
      inFlight.current.delete(row.reservationId); setBusy(prev => prev.filter(id => id !== row.reservationId));
    }
  }

  function openSheet(on: "all" | "day") { setTarget(on); setResult(null); setSheetError(""); setIncludeDifferent(false); setNote(DEFAULT_BULK_NOTE); setSheet(true); }
  function closeSheet() { if (!running) setSheet(false); }
  async function approveMany() {
    if (running || !bulk.items.length) return;
    const text = note.trim();
    if (text.length < 5) { setSheetError("Write at least 5 characters for the record."); return; }
    const total = bulk.items.length, parts: BulkApproval[] = [];
    setSheetError(""); setResult(null); setRunning({ done: 0, total });
    try {
      for (const part of chunk(bulk.items, BULK_PAYOUT_CHUNK)) {
        const key = "many:" + JSON.stringify([part, includeDifferent, text]);
        const reply = await writeFinance({ action: "agreePayouts", requestId: idFor(key), note: text, ...(includeDifferent ? { includeDifferent: true } : {}), items: part });
        ids.current.delete(key);
        parts.push(bulkApprovalSchema.parse(reply.data));
        const sum = sumBulkApprovals(parts);
        setRunning({ done: Math.min(total, sum.approved + Object.values(sum.skipped).reduce((n, v) => n + v, 0)), total });
      }
      // The server was only sent what could be approved, so the stays left out on this side are added to the recap.
      const sum = sumBulkApprovals(parts);
      sum.skipped.different += includeDifferent ? 0 : plan.heldBack;
      sum.skipped.needsDetails += plan.needDetails;
      setResult(sum);
      celebrate(`Approved ${plural(sum.approved, "payout")}`);
    } catch (e) {
      const sum = sumBulkApprovals(parts), reason = message(e);
      setSheetError(/Unknown finance action/i.test(reason)
        ? "Approve all needs a database update that has not been applied yet. Approve the payouts one at a time for now."
        : reason + (sum.approved ? ` ${plural(sum.approved, "payout")} ${sum.approved === 1 ? "was" : "were"} approved before it stopped.` : ""));
      if (sum.approved) setResult(sum);
    } finally { setRunning(null); await onChanged(); }
  }

  const bulkLabel = !approvable ? "Nothing to approve here" : needle ? `Approve ${formatCount(approvable)} matching` : `Approve all ${formatCount(approvable)}`;
  const emptyText = !all.length ? "No platform stays this month."
    : needle && !searched.length ? `Nothing matches “${needle.length > 40 ? needle.slice(0, 40) + "…" : needle}”. Try part of the property name, the platform code, the date or the amount.`
    : platform !== "all" && !inPlatform.length ? `No ${PAYOUT_CHANNEL_LABEL[platform]} stays match.`
    : status === "open" && !chosen && !needle ? "Nothing is waiting for approval this month."
    : "No stays match. Choose All dates, or choose All.";
  const leftOutOf = (x: typeof plan) => [x.heldBack && `${plural(x.heldBack, "stay")} paid a different amount`, x.needDetails && `${plural(x.needDetails, "stay")} that ${x.needDetails === 1 ? "needs" : "need"} details`].filter(Boolean).join(" and ");
  const leftOut = leftOutOf(calendar.all), leftOutDay = calendar.day ? leftOutOf(calendar.day) : "";
  const figureSize = phone ? 18 : 22;
  // The check-in calendar: each day counts the stays in view; choosing a day narrows the list to it.
  const picker: ReactNode = all.length > 0 && <View style={{ gap: 6, alignSelf: phone ? "stretch" : "flex-start" }}>
    <View style={[ui.row, { gap: 10, justifyContent: "space-between" }]}>
      <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Check-in date</Text>
      {!!chosen && <MotionPress accessibilityRole="button" accessibilityLabel="All dates" onPress={() => pickDay(null)} style={{ minHeight: 32, justifyContent: "center" }}>
        <Text style={[ui.small, { color: p.primary, fontWeight: "600" }]}>All dates</Text>
      </MotionPress>}
    </View>
    <CalendarPicker key={periodLabel} p={p} mode="single" value={{ from: chosen, to: chosen }} onChange={v => pickDay(v.from ?? chosen)} counts={dayCounts}
      dataFrom={bounds.from} dataTo={bounds.to} initialMonth={payoutCalendarMonth(chosen, all, null)} countNoun={status === "open" ? "to approve" : "stays"} />
    <Text style={[ui.small, { color: p.muted }]}>{chosen ? "Choose the day again for every date." : "Choose a day to see its stays."}</Text>
  </View>;

  return (
    <View style={{ gap: 12 }}>
      <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 16, flexDirection: beside ? "row" : "column", alignItems: beside ? "flex-start" : "stretch" }]}>
       <View style={{ flex: beside ? 1 : undefined, minWidth: 0, gap: 16 }}>
        <View style={{ flexDirection: phone ? "column" : "row", alignItems: phone ? "stretch" : "center", justifyContent: "space-between", gap: 14 }}>
          <View style={{ flexDirection: "row", gap: phone ? 18 : 40, flexWrap: "wrap" }}>
            <Figure p={p} size={figureSize} label={status === "open" ? "To approve" : status === "settled" ? "Settled" : "Stays"} value={formatCount(totals.count)} />
            <Figure p={p} size={figureSize} label="Expected" value={pounds(totals.expectedMinor)} />
            <Figure p={p} size={figureSize} label="Received" value={pounds(totals.receivedMinor)} dim={totals.receivedMinor === 0} />
          </View>
          {canApprove && <View style={{ minWidth: phone ? undefined : 260, flexDirection: "row" }}><Button label={bulkLabel} icon="check-circle" primary={approvable > 0 && !chosen} disabled={approvable === 0} p={p} onPress={() => openSheet("all")} /></View>}
        </View>
        {canApprove && !!leftOut && <Text style={[ui.small, { color: p.muted }]}>{approvable > 0 ? `Approve all leaves ${leftOut} for you to check one by one.` : `Left for you to check one by one: ${leftOut}.`}</Text>}

        {searchable && <SearchBox p={p} value={query} onChange={value => { setQuery(value); setShown(PAGE); }} placeholder="Search by property, code or amount" />}

        <View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {(["open", "settled", "all"] as const).map(v => (
            <Chip key={v} p={p} role="radio" on={status === v} label={{ open: "To approve", settled: "Approved or matched", all: "All" }[v]} count={counts[v]} onPress={() => { setStatus(v); setShown(PAGE); }} />
          ))}
        </View>

        {platformsHeld > 1 && <View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          <Chip p={p} role="radio" on={platform === "all"} label="All platforms" count={searched.length} onPress={() => { setPlatform("all"); setShown(PAGE); }} />
          {perPlatform.filter(x => x.count > 0).map(x => <Chip key={x.channel} p={p} role="radio" on={platform === x.channel} label={PAYOUT_CHANNEL_LABEL[x.channel]} count={x.count} onPress={() => { setPlatform(x.channel); setShown(PAGE); }} />)}
        </View>}
       </View>
        {picker}
      </View>

      {!!chosen && <View style={{ flexDirection: phone ? "column" : "row", alignItems: phone ? "stretch" : "center", justifyContent: "space-between", gap: 10 }}>
        <View style={{ flex: phone ? undefined : 1, gap: 2, minWidth: 0 }}>
          <Text accessibilityRole="header" style={{ color: p.text, fontSize: 17, fontWeight: "500" }}>{longDay(chosen)}</Text>
          <Text style={[ui.small, { color: p.muted }]}>{`${plural(scope.length, "stay")} checking in${leftOutDay ? `. Left for you to check one by one: ${leftOutDay}.` : ""}`}</Text>
        </View>
        {canApprove && <View style={{ minWidth: phone ? undefined : 220, flexDirection: "row" }}>
          <Button label={approvableDay ? `Approve these ${formatCount(approvableDay)}` : "Nothing to approve on this day"} icon="check-circle" primary={approvableDay > 0} disabled={approvableDay === 0} p={p} onPress={() => openSheet("day")} />
        </View>}
      </View>}

      {!!problem && <Notice text={problem} p={p} tone="bad" />}

      <View onLayout={event => setMeasured(event.nativeEvent.layout.width)} style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, padding: 0, gap: 0, overflow: "hidden" }]}>
        {wide && !!visible.length && (
          <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10, backgroundColor: p.wash }}>
            <View style={{ flex: 1, flexDirection: "row", gap: 12, paddingLeft: 16 }}>
              <Head p={p} label="Stay" flex />
              <Head p={p} label="Check-in" width={COLUMN.day} />
              <Head p={p} label="Expected" width={COLUMN.money} right />
              <Head p={p} label="Received" width={COLUMN.money} right />
              <Head p={p} label="Difference" width={COLUMN.money} right />
              <Head p={p} label="Status" width={COLUMN.status} inset />
            </View>
            <View style={{ width: COLUMN.action }} />
          </View>
        )}
        {visible.map((row, i) => (
          <StayRow key={row.reservationId} p={p} wide={wide} phone={phone} first={i === 0} row={row} property={propertyName(row.propertyId)} canApprove={canApprove}
            busy={busy.includes(row.reservationId)} onOpen={() => onOpen(row)} onApprove={() => void approveOne(row)}
            onLines={canApprove && onLines && (row.lineCount ?? 0) > 0 ? () => onLines(row) : undefined} />
        ))}
        {!visible.length && <Text style={[ui.small, { color: p.muted, padding: 20 }]}>{emptyText}</Text>}
        {scope.length > visible.length && (
          <MotionPress accessibilityRole="button" onPress={() => setShown(n => n + PAGE)} style={[ui.row, { justifyContent: "center", gap: 8, minHeight: 52, borderTopWidth: 1, borderColor: p.border }]}>
            <Feather name="chevron-down" size={16} color={p.primary} />
            <Text style={{ color: p.primary, fontWeight: "700", fontSize: 14 }}>{`Show ${Math.min(PAGE, scope.length - visible.length)} more (${formatCount(scope.length - visible.length)} left)`}</Text>
          </MotionPress>
        )}
      </View>
      {scope.length > 0 && <Text style={[ui.small, { color: p.muted }]}>{`Showing ${formatCount(visible.length)} of ${formatCount(scope.length)}. ${chosen ? "Approve these works on the whole day, and Approve all at the top on every date" : "The approve button at the top works on the whole list"}, not only the stays shown.`}</Text>}

      <Sheet palette={p} visible={sheet} onClose={closeSheet} icon="coins" title={result ? "Approval finished" : `Approve ${plural(bulk.items.length, "payout")}?`} subtitle={scopeLabel}>
        {/* One wrapping view per state: the sheet spaces and staggers its direct children, and a fragment counts as one. */}
        {!result && <View style={{ gap: 14 }}>
          <View style={{ gap: 12 }}>
            <SummaryLine p={p} title={`Not paid yet · ${formatCount(bulk.atExpected.count)}`} detail="Approved at the expected amount" value={pounds(bulk.atExpected.minor)} />
            {(plan.heldBack > 0 || includeDifferent) && <SummaryLine p={p} dim={!includeDifferent} title={`Different amount · ${formatCount(plan.heldBack)}`}
              detail={includeDifferent ? "Approved at the amount received" : "Left for you to check one by one"} value={includeDifferent ? pounds(bulk.atReceived.minor) : "–"} />}
            {plan.needDetails > 0 && <SummaryLine p={p} dim title={`Need details first · ${formatCount(plan.needDetails)}`} detail="Skipped. Add the platform code or the expected payout" value="–" />}
            <View style={{ height: 1, backgroundColor: p.border }} />
            <SummaryLine p={p} strong title="Approving now" detail={plural(bulk.items.length, "payout")} value={pounds(bulkMinor)} />
          </View>
          {plan.heldBack > 0 && <MotionPress accessibilityRole="checkbox" accessibilityState={{ checked: includeDifferent }} accessibilityLabel="Also approve the stays paid a different amount, at the amount received" onPress={() => setIncludeDifferent(v => !v)} style={[ui.row, { gap: 12, minHeight: 46 }]}>
            <View style={{ width: 24, height: 24, borderRadius: 8, borderWidth: 2, borderColor: includeDifferent ? p.primary : p.controlBorder, backgroundColor: includeDifferent ? p.primary : "transparent", alignItems: "center", justifyContent: "center" }}>
              {includeDifferent && <Feather name="check" size={15} color={p.onPrimary} />}
            </View>
            <Text style={{ flex: 1, color: p.text, fontSize: 14 }}>Also approve the stays paid a different amount, at the amount received</Text>
          </MotionPress>}
          <Field label="Note for the record" value={note} onChange={setNote} p={p} multiline />
          <Notice text="Each payout is approved on its own record, with this note. To change one afterwards, open it and approve it again with the amount you want." p={p} />
          {!!sheetError && <Notice text={sheetError} p={p} tone="bad" />}
          <Button label={running ? `Approving… ${formatCount(running.done)} of ${formatCount(running.total)}` : `Approve ${plural(bulk.items.length, "payout")} · ${pounds(bulkMinor)}`}
            primary p={p} disabled={!!running || bulk.items.length === 0} onPress={() => void approveMany()} />
        </View>}
        {!!result && <View style={{ gap: 14 }}>
          <SummaryLine p={p} strong title={`Approved ${plural(result.approved, "payout")}`} detail={result.atReceived ? `${formatCount(result.atExpected)} at the expected amount, ${formatCount(result.atReceived)} at the amount received` : "At the expected amount"} value={pounds(result.approvedMinor)} />
          {skippedLines(result).map(line => <Text key={line} style={[ui.small, { color: p.muted }]}>{line}</Text>)}
          {!!sheetError && <Notice text={sheetError} p={p} tone="bad" />}
          <Button label="Done" primary p={p} onPress={closeSheet} />
        </View>}
      </Sheet>
    </View>
  );
}

// The words under a finished approval for everything that was left alone, and why.
function skippedLines(r: BulkApproval) {
  const s = r.skipped, out: string[] = [];
  if (s.different) out.push(`${plural(s.different, "stay")} paid a different amount ${s.different === 1 ? "was" : "were"} left for you to check.`);
  if (r.repeatedAmountSkipped) out.push(`${formatCount(r.repeatedAmountSkipped)} of those ${r.repeatedAmountSkipped === 1 ? "has" : "have"} the same amount on more than one payout line. Check ${r.repeatedAmountSkipped === 1 ? "it" : "them"} before approving.`);
  if (s.needsDetails) out.push(`${plural(s.needsDetails, "stay")} still ${s.needsDetails === 1 ? "needs" : "need"} details before ${s.needsDetails === 1 ? "it" : "they"} can be approved.`);
  if (s.changed) out.push(`${plural(s.changed, "stay")} changed while you were looking. The list now shows ${s.changed === 1 ? "it" : "them"} as ${s.changed === 1 ? "it is" : "they are"}.`);
  if (s.settled) out.push(`${plural(s.settled, "stay")} ${s.settled === 1 ? "was" : "were"} already settled.`);
  if (s.locked) out.push(`${plural(s.locked, "stay")} ${s.locked === 1 ? "belongs" : "belong"} to a month whose owner statement is already issued.`);
  if (s.notFound) out.push(`${plural(s.notFound, "stay")} could not be found.`);
  return out;
}

// A column heading; `inset` keeps a column that follows right-aligned figures clear of them.
function Head({ p, label, width, flex = false, right = false, inset = false }: { p: Palette; label: string; width?: number; flex?: boolean; right?: boolean; inset?: boolean }) {
  return <Text style={{ ...LABEL, color: p.muted, textAlign: right ? "right" : "left", ...(inset ? { paddingLeft: 8 } : {}), ...(flex ? { flex: 1 } : { width }) }}>{label}</Text>;
}

function Figure({ p, label, value, size, dim = false }: { p: Palette; label: string; value: string; size: number; dim?: boolean }) {
  return (
    <View style={{ gap: 2, minWidth: 0 }}>
      <Text style={{ ...LABEL, color: p.muted }}>{label}</Text>
      <Text style={{ color: dim ? p.muted : p.text, fontSize: size, fontWeight: "700", letterSpacing: -0.4 }}>{value}</Text>
    </View>
  );
}

function Chip({ p, label, count, on, onPress, role }: { p: Palette; label: string; count: number; on: boolean; onPress: () => void; role: "radio" | "checkbox" }) {
  return (
    <MotionPress accessibilityRole={role} accessibilityState={role === "radio" ? { selected: on } : { checked: on }} accessibilityLabel={`${label}, ${count}`} onPress={onPress}
      style={[{ minHeight: 44, paddingHorizontal: 14, borderRadius: 999, flexDirection: "row", alignItems: "center", gap: 8 }, pillBox(p, on)]}>
      <Text style={{ color: pillInk(p, on), fontSize: 13, fontWeight: "600" }}>{label}</Text>
      <Text style={{ color: pillInk(p, on, true), fontSize: 13, fontWeight: "600" }}>{formatCount(count)}</Text>
    </MotionPress>
  );
}

function SummaryLine({ p, title, detail, value, strong = false, dim = false }: { p: Palette; title: string; detail: string; value: string; strong?: boolean; dim?: boolean }) {
  return (
    <View style={[ui.between, { gap: 12, alignItems: "flex-start" }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: dim ? p.muted : p.text, fontSize: strong ? 16 : 14, fontWeight: strong ? "700" : "600" }}>{title}</Text>
        <Text style={[ui.small, { color: p.muted }]}>{detail}</Text>
      </View>
      <Text style={{ color: dim ? p.muted : p.text, fontSize: strong ? 18 : 15, fontWeight: "700", textAlign: "right" }}>{value}</Text>
    </View>
  );
}

// A figure with its label above it, for the stacked layout. On a phone the three share the row; wider, each keeps a fixed
// width so the figures stay close together instead of spreading across the card.
function Stat({ p, label, children, width }: { p: Palette; label: string; children: ReactNode; width?: number }) {
  return <View style={{ ...(width ? { width } : { flex: 1 }), gap: 3, minWidth: 0 }}><Text style={{ ...LABEL, color: p.muted }}>{label}</Text>{children}</View>;
}
// A date or a platform name that wraps as one piece: "Thu 1 Oct" never leaves "Oct" alone on the next line.
const unbroken = (text: string) => text.replace(/ /g, " ");
function Amount({ p, value, size = 15, align = "left" }: { p: Palette; value: number | null; size?: number; align?: "left" | "right" }) {
  return <Text numberOfLines={1} style={{ color: value === null ? p.muted : p.text, fontSize: size, fontWeight: "700", textAlign: align }}>{pounds(value)}</Text>;
}
// Received minus expected: short is red with a minus, over is amber with a plus, exact and unknown are quiet.
function Gap({ p, row, size = 15, align = "left" }: { p: Palette; row: PayoutRow; size?: number; align?: "left" | "right" }) {
  const diff = payoutDifference(row);
  const color = diff === null || diff === 0 ? p.muted : diff < 0 ? p.danger : p.waiting;
  return <Text numberOfLines={1} style={{ color, fontSize: size, fontWeight: "700", textAlign: align }}>{diff === null ? "–" : diff > 0 ? "+" + pounds(diff) : pounds(diff)}</Text>;
}

// What a row offers beside its figures: approve it in place (only for people who may), add what it is missing, or nothing.
function actionKind(row: PayoutRow, canApprove: boolean): "approve" | "details" | null {
  const move = payoutMove(row);
  if (move === "approve") return canApprove ? "approve" : null;
  return move === "details" ? "details" : null;
}

// "fill" fills the column it sits in, so every button in a table is the same width; "grow" is full width, for a phone.
type ActionFit = "fill" | "grow";
function RowAction({ p, kind, fit, row, busy, onOpen, onApprove }: { p: Palette; kind: "approve" | "details"; fit: ActionFit; row: PayoutRow; busy: boolean; onOpen: () => void; onApprove: () => void }) {
  const base = { minHeight: 44, paddingHorizontal: 14, borderRadius: 12, flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "center" as const, gap: 6, ...(fit === "fill" ? { alignSelf: "stretch" as const } : { flexGrow: 1 }) };
  if (kind === "approve") {
    const amount = pounds(payoutApproval(row)?.agreedMinor);
    return (
      <MotionPress accessibilityRole="button" accessibilityLabel={`Approve ${amount} for ${row.reference}`} accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={onApprove}
        style={[base, { backgroundColor: busy ? p.elevated : p.wash, borderWidth: 1, borderColor: busy ? p.border : p.washBorder }]}>
        <Feather name="check" size={15} color={busy ? p.muted : p.primary} />
        <Text numberOfLines={1} style={{ color: busy ? p.muted : p.primary, fontSize: 13, fontWeight: "700" }}>{busy ? "Approving…" : `Approve ${amount}`}</Text>
      </MotionPress>
    );
  }
  return (
    <MotionPress accessibilityRole="button" accessibilityLabel={`Add details for ${row.reference}`} onPress={onOpen} style={[base, { borderWidth: 1, borderColor: p.controlBorder }]}>
      <Feather name="edit-2" size={14} color={p.text} />
      <Text numberOfLines={1} style={{ color: p.text, fontSize: 13, fontWeight: "700" }}>Add details</Text>
    </MotionPress>
  );
}

// The words on a row's status tag. "Missing" is a stay whose payout has not come at all; an approved stay whose money has not
// arrived reads "Approved, not received" (lib/accounts-live payoutStateLabel).
function stateOf(row: PayoutRow): [string, "good" | "wait" | "bad"] {
  return row.state === "missing" ? ["Missing", "wait"] : payoutStateLabel(row);
}
// A line under the status that explains it: nothing to add for a matched stay.
function hintOf(row: PayoutRow): { text: string; warn: boolean } | null {
  if (row.state === "missing") return { text: "No payout yet", warn: false };
  if (row.state === "different" && row.repeatedAmount != null) return { text: "Looks like the same payment twice", warn: true };
  return null;
}

// Which platform a stay is on, as a quiet outlined chip beside its name.
function ChannelChip({ p, channel }: { p: Palette; channel: string }) {
  return (
    <View style={{ alignSelf: "center", paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, borderWidth: 1, borderColor: p.border }}>
      <Text numberOfLines={1} style={{ color: p.muted, fontSize: 11, lineHeight: 15, fontWeight: "600" }}>{unbroken(CHANNEL_LABEL[channel] ?? channel)}</Text>
    </View>
  );
}

// Opens the payout lines behind a stay. A sibling of the row's own press area, never inside it.
function LinesButton({ p, row, fit, onPress }: { p: Palette; row: PayoutRow; fit: ActionFit; onPress: () => void }) {
  const count = row.lineCount ?? 0;
  return (
    <MotionPress accessibilityRole="button" accessibilityLabel={`Payout lines for ${row.reference}, ${count}`} onPress={onPress}
      style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderWidth: 1, borderColor: p.controlBorder, ...(fit === "fill" ? { alignSelf: "stretch" as const } : { flexGrow: 1 }) }}>
      <Feather name="list" size={14} color={p.text} />
      <Text numberOfLines={1} style={{ color: p.text, fontSize: 13, fontWeight: "700" }}>{count === 1 ? "1 payout line" : `${formatCount(count)} payout lines`}</Text>
    </MotionPress>
  );
}

function StayRow({ p, wide, phone, first, row, property, canApprove, busy, onOpen, onApprove, onLines }: {
  p: Palette; wide: boolean; phone: boolean; first: boolean; row: PayoutRow; property?: string; canApprove: boolean; busy: boolean; onOpen: () => void; onApprove: () => void; onLines?: () => void;
}) {
  const [statusLabel, statusTone] = stateOf(row);
  const openable = row.state !== "matched";
  const kind = actionKind(row, canApprove);
  const channel = CHANNEL_LABEL[row.channel] ?? row.channel;
  const hint = hintOf(row);
  const diff = payoutDifference(row);
  const approvedAt = row.state === "agreed" && row.agreedMinor !== null ? `at ${pounds(row.agreedMinor)}` : "";
  const spoken = [row.reference, property, channel, `check-in ${formatDay(row.checkIn)}`, `expected ${pounds(row.expectedMinor)}`, row.receivedMinor === null ? "not received" : `received ${pounds(row.receivedMinor)}`,
    diff !== null && diff !== 0 ? `difference ${pounds(diff)}` : "", statusLabel, approvedAt, hint?.text].filter(Boolean).join(", ");
  // The part of the row that opens the full form. Its Approve button is a sibling, never inside it.
  const main = {
    ...hover("rowhit"), accessibilityRole: openable ? ("button" as const) : undefined, disabled: !openable, accessibilityLabel: spoken, onPress: onOpen,
    accessibilityHint: !openable ? undefined : row.state === "no_reference" || row.state === "no_expected_amount" ? "Opens the form to add the missing details" : "Opens the form to approve with your own amount and note",
  };
  const action = kind && <RowAction p={p} kind={kind} fit={phone ? "grow" : "fill"} row={row} busy={busy} onOpen={onOpen} onApprove={onApprove} />;
  const lines = onLines && <LinesButton p={p} row={row} fit={phone ? "grow" : "fill"} onPress={onLines} />;
  const wrapper = openable ? hover("row") : {};
  const statWidth = phone ? undefined : 150;
  const title = <View style={{ flexDirection: "row", alignItems: "center", gap: 8, minWidth: 0 }}><View style={{ flexShrink: 1, minWidth: 0 }}><Text numberOfLines={1} style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>{row.reference}</Text></View><ChannelChip p={p} channel={row.channel} /></View>;
  const state = <View style={{ gap: 3 }}><Tag label={statusLabel} tone={statusTone} p={p} />{!!approvedAt && <Text style={[ui.small, { color: p.muted }]}>{approvedAt}</Text>}</View>;
  const note = hint && <Text style={[ui.small, { color: hint.warn ? p.waiting : p.muted, fontWeight: hint.warn ? "600" : "400" }]}>{hint.text}</Text>;
  if (wide) {
    return (
      <View {...wrapper} style={{ flexDirection: "row", alignItems: "center", borderTopWidth: first ? 0 : 1, borderColor: p.border }}>
        <MotionPress {...main} style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 14, paddingLeft: 16 }}>
          <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
            {title}
            {!!property && <Text numberOfLines={1} style={[ui.small, { color: p.muted }]}>{property}</Text>}
            {!!row.channelReference && <Text numberOfLines={2} style={[ui.small, { color: p.muted }]}>{row.channelReference}</Text>}
            {note}
          </View>
          <Text numberOfLines={2} style={{ width: COLUMN.day, color: p.text, fontSize: 14, fontWeight: "600" }}>{formatDay(row.checkIn)}</Text>
          <View style={{ width: COLUMN.money }}><Amount p={p} value={row.expectedMinor} align="right" /></View>
          <View style={{ width: COLUMN.money }}><Amount p={p} value={row.receivedMinor} align="right" /></View>
          <View style={{ width: COLUMN.money }}><Gap p={p} row={row} align="right" /></View>
          <View style={{ width: COLUMN.status, paddingLeft: 8 }}>{state}</View>
        </MotionPress>
        <View style={{ width: COLUMN.action, paddingHorizontal: 8, gap: 6 }}>{action}{lines}</View>
      </View>
    );
  }
  // Stacked: the stay's lines run the full width, then the three figures. The actions go under them on a phone and beside them
  // on a tablet or a narrow laptop window.
  const actions = !!action || !!lines;
  return (
    <View {...wrapper} style={{ flexDirection: phone ? "column" : "row", alignItems: phone ? "stretch" : "flex-end", borderTopWidth: first ? 0 : 1, borderColor: p.border }}>
      <MotionPress {...main} style={{ flex: phone ? undefined : 1, minWidth: 0, gap: 10, paddingTop: 14, paddingBottom: phone && actions ? 8 : 14, paddingHorizontal: 16 }}>
        <View style={[ui.between, { gap: 12 }]}>
          <View style={{ flex: 1, minWidth: 0 }}>{title}</View>
          {state}
        </View>
        <View style={{ gap: 2 }}>
          <Text numberOfLines={2} style={[ui.small, { color: p.muted }]}>{[property, unbroken(formatDay(row.checkIn))].filter(Boolean).join(" · ")}</Text>
          {!!row.channelReference && <Text numberOfLines={2} style={[ui.small, { color: p.muted }]}>{row.channelReference}</Text>}
          {note}
        </View>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <Stat p={p} width={statWidth} label="Expected"><Amount p={p} value={row.expectedMinor} size={16} /></Stat>
          <Stat p={p} width={statWidth} label="Received"><Amount p={p} value={row.receivedMinor} size={16} /></Stat>
          <Stat p={p} width={statWidth} label="Difference"><Gap p={p} row={row} size={16} /></Stat>
        </View>
      </MotionPress>
      {actions && <View style={phone ? { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 14 } : { width: COLUMN.action, gap: 6, paddingRight: 16, paddingBottom: 14 }}>{action}{lines}</View>}
    </View>
  );
}
