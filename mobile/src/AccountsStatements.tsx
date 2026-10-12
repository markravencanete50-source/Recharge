import { useEffect, useMemo, useRef, useState } from "react";
import { Switch, View } from "react-native";
import { Text } from "./Typography";
import { ExpandChevron, MotionPress } from "./motion";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { Button, Field, Loading, london, message, Notice, useRequestId } from "./LiveKit";
import { readFinance, writeFinance } from "./backend/client";
import { StatementFiles } from "./AccountsFiles";
import { Line, type NoteAsk } from "./AccountsPayable";
import { Chip } from "./SheetTable";
import { PropertySelect } from "./SearchPicker";
import { TrackerDetailSheet, TrackerList } from "./Tracker";
import { CHANNEL_LABEL, isFinanceRole, monthLabel, pounds, shiftMonth, statementPreviewSchema, statementsSchema, type Statement, type StatementPreview } from "../../lib/accounts-live";
import { formatBps, plural } from "../../lib/format";
import { poundsToMinor } from "../../lib/repairs-live";
import { sortTracker, type TrackerItem } from "../../lib/tracker";
import {
  blockReasons, CHECK_FIGURES, CLEAN_MODE_LABEL, customRange, flagNotes, ISSUE_STATEMENT, lineGroups, monthRange, periodTitle, prepareAction, previewKey, previewQuery, previewSummary,
  RECORD_PAYOUT, rangeFromDates, SET_TERMS, statementForms, statementTrackerItems, VOID_STATEMENT,
  type LineGroup, type StatementRange, type StatementSource, type SummaryRow,
} from "../../lib/tracker-statements";
import type { FinanceAction } from "../../lib/workspace-finance-policy";
import type { WorkflowForm } from "../../lib/workflow-forms";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import type { z } from "zod";

// Statements tab of Live Accounts: check a period's figures before preparing, then prepare, issue, record the payout and void.
// Dates: people choose the first day and the LAST day included. The database wants `to` as the first day NOT included, so
// customRange (lib/tracker-statements.ts) adds the day once and every request uses its `from` and `to`.
export type StatementRow = z.infer<typeof statementsSchema>[number];
const MONTHS_SHOWN = 6;
const small = (p: Palette) => [ui.small, { color: p.muted }];
const heading = (p: Palette) => ({ color: p.muted, fontSize: 12, fontWeight: "600" as const, textTransform: "uppercase" as const, letterSpacing: 1 });

// One figure of the summary: what it is, a quiet note about how it was worked out, and the amount.
function Figure({ p, row }: { p: Palette; row: SummaryRow }) {
  return (
    <View accessible accessibilityLabel={`${row.label}, ${row.value}`} style={[ui.between, { gap: 12, alignItems: "flex-start" }, row.strong ? { borderTopWidth: 1, borderTopColor: p.border, paddingTop: 12 } : null]}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ color: p.text, fontSize: row.strong ? 16 : 14, lineHeight: 21, fontWeight: row.strong ? "600" : "400" }}>{row.label}</Text>
        {!!row.note && <Text style={small(p)}>{row.note}</Text>}
      </View>
      <Text style={{ color: p.text, fontSize: row.strong ? 18 : 14, lineHeight: 21, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{row.value}</Text>
    </View>
  );
}

// The lines that come off gross, in the order they come off: platform fees, changeovers, management fee, VAT, other payables.
function LineGroups({ p, groups }: { p: Palette; groups: LineGroup[] }) {
  if (!groups.length) return <Text style={small(p)}>Nothing is taken off in this period.</Text>;
  return (
    <View style={{ gap: 14 }}>
      {groups.map(group => (
        <View key={group.kind} style={{ gap: 6 }}>
          <View style={[ui.between, { gap: 12 }]}>
            <Text accessibilityRole="header" style={heading(p)}>{group.title}</Text>
            <Text style={{ color: p.text, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{pounds(-group.totalMinor)}</Text>
          </View>
          {group.lines.map((line, n) => <Line key={n} p={p} label={line.label + (line.when ? " · " + line.when : "")} value={pounds(-line.amountMinor)} />)}
        </View>
      ))}
    </View>
  );
}

// Inside a statement's sheet: what was taken off in order, the stays behind the figures and the files to print or download.
function StatementExtras({ p, statement }: { p: Palette; statement: Statement }) {
  const lines = statement.detail.lines;
  return (
    <View style={{ gap: 18 }}>
      {lines && lines.length > 0
        ? <View style={{ gap: 10 }}><Text accessibilityRole="header" style={heading(p)}>Taken off, in order</Text><LineGroups p={p} groups={lineGroups(lines)} /></View>
        : <View style={{ gap: 6 }}>
          <Line p={p} label="Payouts received" value={pounds(statement.revenueMinor)} />
          <Line p={p} label={`Cleaning (${statement.cleaningCount})`} value={pounds(-statement.cleaningMinor)} />
          <Line p={p} label="Approved expenses" value={pounds(-statement.expensesMinor)} />
          <Line p={p} label={`Management fee (${formatBps(statement.feeBps)})`} value={pounds(-statement.feeMinor)} />
          {statement.detail.expenses.map(x => <Line key={x.reference} p={p} label={`${x.supplier} · ${x.reference}`} value={pounds(-x.amountMinor)} />)}
        </View>}
      {statement.detail.stays.length > 0 && (
        <View style={{ gap: 6 }}>
          <Text accessibilityRole="header" style={heading(p)}>Stays, after platform fees</Text>
          {statement.detail.stays.map(x => {
            const share = x.nights && x.nightsInPeriod != null && x.nightsInPeriod < x.nights ? ` · ${x.nightsInPeriod} of ${x.nights} nights in this period` : "";
            const value = x.ownerStay ? "Owner stay" : x.counted === false ? "Counted before" : pounds(x.amountMinor);
            return <Line key={(x.reservationId ?? x.reference) + x.checkIn} p={p} label={`${x.reference} · ${CHANNEL_LABEL[x.channel] ?? x.channel} · ${x.checkIn}${share}`} value={value} />;
          })}
        </View>
      )}
      <StatementFiles p={p} statement={statement} audience="accounts" />
    </View>
  );
}

// The statement terms: the management fee (12% or 15%, or another rate), whether VAT is added to it, the cleaning cost
// and whether owners are charged the agreed fee or what each clean cost.
export function TermsSheet({ p, row, onClose, onDone }: { p: Palette; row: StatementRow | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [fee, setFee] = useState("");
  const [clean, setClean] = useState("");
  const [vat, setVat] = useState(false);
  const [mode, setMode] = useState<"agreed_fee" | "actual_cost">("agreed_fee");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRequestId(row ? ["terms", row.propertyId, fee, clean, vat, mode].join(":") : null);
  useEffect(() => {
    queueMicrotask(() => {
      if (!row) return;
      setFee(row.terms?.managementFeeBps != null ? String(row.terms.managementFeeBps / 100) : "");
      setClean(row.terms?.cleaningCostMinor != null ? (row.terms.cleaningCostMinor / 100).toFixed(2) : "");
      setVat(row.terms?.vatOnFee === true);
      setMode(row.terms?.cleanChargeMode === "actual_cost" ? "actual_cost" : "agreed_fee");
      setError("");
    });
  }, [row]);
  async function save() {
    if (!row || busy) return;
    const percent = Number(fee), cleaningCostMinor = poundsToMinor(clean);
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(fee.trim()) || percent > 100 || cleaningCostMinor === null) { setError("Enter the fee as a percentage (for example 15) and the cleaning cost per clean."); return; }
    setBusy(true); setError("");
    try {
      await writeFinance({ action: "setStatementTerms", requestId: request.get(), propertyId: row.propertyId, managementFeeBps: Math.round(percent * 100), cleaningCostMinor, vatOnFee: vat, cleanChargeMode: mode });
      request.done(); onClose(); await onDone();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const vatRate = formatBps(row?.terms?.vatRateBps ?? 2000);
  return (
    <Sheet palette={p} visible={!!row} onClose={onClose} title="Statement terms" subtitle={row?.propertyName} icon="clipboard">
      <Text style={small(p)}>{"Take these from the owner’s management agreement."}</Text>
      <View style={{ gap: 8 }}>
        <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Management fee</Text>
        <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
          <Chip p={p} label="12%" on={Number(fee) === 12 && fee.trim() !== ""} onPress={() => setFee("12")} />
          <Chip p={p} label="15%" on={Number(fee) === 15 && fee.trim() !== ""} onPress={() => setFee("15")} />
        </View>
      </View>
      <Field label="Management fee (% of the payout after platform fees)" value={fee} onChange={setFee} p={p} placeholder="15" />
      <View style={[ui.between, { gap: 16, minHeight: 56 }]}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: p.text, fontWeight: "600" }}>Add VAT to the management fee</Text>
          <Text style={small(p)}>{`VAT at ${vatRate} is added to the fee and shown on its own line of the statement.`}</Text>
        </View>
        <Switch accessibilityLabel="Add VAT to the management fee" value={vat} onValueChange={setVat} trackColor={{ false: p.controlBorder, true: p.primary }} thumbColor={p.surface} />
      </View>
      <Field label="Agreed cleaning cost per clean" value={clean} onChange={setClean} p={p} placeholder="£0.00" />
      <View style={{ gap: 8 }}>
        <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Charge cleans at</Text>
        <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
          <Chip p={p} label={CLEAN_MODE_LABEL.agreed_fee} on={mode === "agreed_fee"} onPress={() => setMode("agreed_fee")} />
          <Chip p={p} label={CLEAN_MODE_LABEL.actual_cost} on={mode === "actual_cost"} onPress={() => setMode("actual_cost")} />
        </View>
        <Text style={small(p)}>{mode === "agreed_fee"
          ? "The owner pays the agreed cost for every clean. A clean that cost more is reviewed first, and a statement waits for the review."
          : "The owner pays what each clean actually cost: the cleaner’s invoice, otherwise their rate."}</Text>
      </View>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : "Save terms"} primary p={p} disabled={busy} onPress={() => void save()} />
    </Sheet>
  );
}

type Check = { key: string; status: "loading" | "ready" | "error"; preview?: StatementPreview; error?: string };
type Props = {
  p: Palette;
  role: WorkspaceAccount["role"];
  management: boolean;
  // The month the page is showing. The list shows every statement overlapping it.
  period: string;
  statements: StatementRow[];
  loading: boolean;
  // Kept so existing callers compile: the breakdown now opens in the statement's own sheet.
  expanded?: string | null;
  setExpanded?: (id: string | null) => void;
  busyStatement: string;
  statementAction: (key: string, action: FinanceAction) => Promise<void>;
  setTerms: (row: StatementRow) => void;
  setAsk: (ask: NoteAsk) => void;
  // Optional: the properties (for their addresses); the month chips change the page's month when given; and where the
  // "Reconciliation" and "Cleans to review" links go. Without them the month follows the page's arrows and the links are text.
  properties?: readonly { id: string; name: string; address?: string | null; region?: string | null }[];
  onPeriod?: (month: string) => void;
  onOpenTab?: (tab: "payouts" | "payable") => void;
};

// The Statements tab body, rendered by LiveAccounts while that tab is selected.
export function AccountsStatements({ p, role, period, statements, loading, busyStatement, statementAction, setTerms, setAsk, properties, onPeriod, onOpenTab }: Props) {
  const finance = isFinanceRole(role);
  const today = london(new Date()), thisMonth = today.slice(0, 7);
  const [custom, setCustom] = useState(false);
  const [fromText, setFromText] = useState("");
  const [lastText, setLastText] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [check, setCheck] = useState<Check | null>(null);
  const [showLines, setShowLines] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const latest = useRef(0);

  // The period being asked about: the page's month, or the dates typed (last day included, turned into `to` once).
  const range = custom ? customRange(fromText, lastText, today) : monthRange(period);
  const picked: StatementRange | null = range && !("error" in range) ? range : null;
  const rangeError = custom && fromText.trim() && lastText.trim() && range && "error" in range ? range.error : "";
  // Without onPeriod the page's own arrows choose the month, so there is just the one chip.
  const recent = Array.from({ length: MONTHS_SHOWN }, (_, n) => shiftMonth(thisMonth, -n));
  const months = !onPeriod ? [period] : recent.includes(period) ? recent : [period, ...recent];
  const options = useMemo(() => (properties ?? statements.map(r => ({ id: r.propertyId, name: r.propertyName }))), [properties, statements]);

  const key = propertyId && picked ? previewKey(propertyId, picked) : "";
  const active = check && check.key === key ? check : null;
  const preview = active?.status === "ready" ? active.preview : undefined;
  const summary = preview ? previewSummary(preview) : null;
  const reasons = preview ? blockReasons(preview.blockedReasons) : [];
  const notes = preview ? flagNotes(preview.flags, preview.blockedReasons) : [];
  const sameDates = (s: Statement) => !!picked && (s.periodStart ?? s.period + "-01") === picked.from && (s.periodEnd ?? monthRange(s.period)?.to) === picked.to;
  const overlapping = preview?.statements ?? [];
  const existing = overlapping.find(sameDates), clash = overlapping.filter(s => !sameDates(s));
  const locked = !!existing && existing.status !== "draft";
  const stopped = !preview || !summary || preview.blocked || summary.problems.length > 0 || clash.length > 0 || locked;

  async function runCheck(id: string, r: StatementRange) {
    const mine = ++latest.current, at = previewKey(id, r);
    setCheck({ key: at, status: "loading" }); setShowLines(false);
    try {
      const reply = await readFinance(previewQuery(id, r));
      const parsed = statementPreviewSchema.safeParse(reply.data);
      if (mine !== latest.current) return;
      setCheck(parsed.success ? { key: at, status: "ready", preview: parsed.data } : { key: at, status: "error", error: "The figures could not be read. Refresh and try again." });
    } catch (e) { if (mine === latest.current) setCheck({ key: at, status: "error", error: message(e) }); }
  }
  function prepare() {
    if (!picked || !propertyId || stopped || busyStatement) return;
    // Once the statement is stored the period is checked again, so the screen shows what is held now and not the figures from before.
    // Preparing a held draft again keeps its own method (prepareAction leaves the method out).
    void statementAction(`prepare:${key}:${existing?.version ?? 0}`, { ...prepareAction(propertyId, picked, existing), requestId: "" }).then(() => runCheck(propertyId, picked));
  }
  function chooseCustom() {
    const month = monthRange(period);
    if (!custom && month && !fromText && !lastText) { setFromText(month.from); setLastText(month.lastDay); }
    setCustom(true);
  }

  const items = useMemo(() => {
    const now = new Date();
    return sortTracker(statementTrackerItems(statements, { now, role, month: period, property: id => options.find(o => o.id === id), preview: check?.status === "ready" ? check.preview : null }));
  }, [statements, role, period, options, check]);
  const open = items.find(i => i.id === openId);

  function openCheck(item: TrackerItem<StatementSource>) {
    const { row, statement } = item.source;
    const r = statement?.periodStart && statement.periodEnd ? rangeFromDates(statement.periodStart, statement.periodEnd) : monthRange(statement?.period ?? item.source.month);
    if (!r) return;
    setPropertyId(row.propertyId);
    if (r.month) { setCustom(false); if (r.month !== period) onPeriod?.(r.month); } else { setCustom(true); setFromText(r.from); setLastText(r.lastDay); }
    void runCheck(row.propertyId, r);
  }
  function onForm(item: TrackerItem<StatementSource> | undefined, form: WorkflowForm) {
    if (!item) return;
    const { row, statement: st } = item.source;
    const full = statements.find(r => r.propertyId === row.propertyId);
    if (form.key === CHECK_FIGURES) openCheck(item);
    else if (form.key === SET_TERMS && full) setTerms(full);
    else if (form.key === ISSUE_STATEMENT && st) void statementAction(`issue:${st.id}:${st.version}`, { action: "issueStatement", requestId: "", statementId: st.id, version: st.version });
    else if (form.key === RECORD_PAYOUT && st) setAsk({ title: "Record the owner payout", subtitle: `${row.propertyName} · ${pounds(st.payoutMinor)}`, label: "Bank transfer reference", min: 3, confirm: "Mark as paid", build: reference => ({ action: "recordOwnerPayout", requestId: "", statementId: st.id, version: st.version, method: "bank_transfer", reference }) });
    else if (form.key === VOID_STATEMENT && st) setAsk({ title: "Void this statement", subtitle: `${row.propertyName} · ${periodTitle(st)}`, label: "Reason", min: 5, confirm: "Void statement", build: reason => ({ action: "voidStatement", requestId: "", statementId: st.id, version: st.version, reason }) });
  }

  return (
    <View style={{ gap: 20 }}>
      {finance && (
        <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 16 }]}>
          <View style={{ gap: 4 }}>
            <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Prepare a statement</Text>
            <Text style={small(p)}>Choose the dates and a property, check the figures, then prepare the statement.</Text>
          </View>
          <View style={{ gap: 8 }}>
            <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Dates</Text>
            <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
              {months.map(m => <Chip key={m} p={p} label={monthLabel(m)} on={!custom && m === period} onPress={() => { setCustom(false); onPeriod?.(m); }} />)}
              <Chip p={p} label="Custom dates" on={custom} onPress={chooseCustom} />
            </View>
            {!onPeriod && !custom && <Text style={small(p)}>Use the month arrows at the top to change the month.</Text>}
          </View>
          {custom && (
            <View style={{ gap: 12 }}>
              <Field label="First day" value={fromText} onChange={setFromText} p={p} placeholder="2026-11-01" />
              <Field label="Last day (included)" value={lastText} onChange={setLastText} p={p} placeholder="2026-11-30" />
              {!!rangeError && <Notice text={rangeError} p={p} tone="bad" />}
            </View>
          )}
          {!!picked && <Text style={small(p)}>{`${periodTitle({ periodStart: picked.from, periodEnd: picked.to })} · ${plural(picked.days, "day")}${custom ? ". Both the first and the last day are included." : ""}`}</Text>}
          <View style={{ gap: 8 }}>
            <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Property</Text>
            <PropertySelect p={p} properties={options} value={propertyId} onChange={setPropertyId} empty="No properties are available for statements yet." />
          </View>
          <Button label={active?.status === "loading" ? "Checking…" : "Check figures"} icon="search" primary p={p} disabled={!propertyId || !picked || active?.status === "loading"} onPress={() => picked && void runCheck(propertyId, picked)} />
          {!propertyId && <Text style={small(p)}>Choose a property to check its figures.</Text>}

          {active?.status === "loading" && <Loading p={p} rows={4} />}
          {active?.status === "error" && <Notice text={active.error ?? "The figures could not be checked."} p={p} tone="bad" />}
          {preview && summary && (
            <View style={{ gap: 14 }}>
              <View style={{ gap: 4 }}>
                <Text accessibilityRole="header" style={{ color: p.text, fontSize: 16, lineHeight: 22, fontWeight: "600" }}>{`${periodTitle({ periodStart: preview.periodStart, periodEnd: preview.periodEnd })}, ${options.find(o => o.id === propertyId)?.name ?? ""}`}</Text>
                <Text style={small(p)}>{summary.occupancy}</Text>
              </View>
              <View style={{ gap: 12 }}>
                {summary.rows.map(row => <Figure key={row.key} p={p} row={row} />)}
                <Figure p={p} row={summary.payout} />
              </View>
              <MotionPress accessibilityRole="button" accessibilityState={{ expanded: showLines }} onPress={() => setShowLines(!showLines)} hitSlop={8} style={[ui.row, { gap: 6, minHeight: 44, alignSelf: "flex-start" }]}>
                <ExpandChevron open={showLines} size={16} color={p.primary} /><Text style={{ color: p.primary, fontWeight: "600" }}>{showLines ? "Hide the itemised lines" : "Show the itemised lines"}</Text>
              </MotionPress>
              {showLines && <LineGroups p={p} groups={lineGroups(preview.lines)} />}
              {reasons.map(reason => (
                <View key={reason.kind} style={{ gap: 8 }}>
                  <Notice text={`${reason.text}. ${reason.pointer}`} p={p} tone="bad" />
                  {reason.link && onOpenTab && <Button label={reason.link === "payouts" ? "Open Reconciliation" : "Open cleans to review"} icon="arrow-right" p={p} onPress={() => onOpenTab(reason.link === "payouts" ? "payouts" : "payable")} />}
                </View>
              ))}
              {preview.blocked && !reasons.length && <Notice text="This period cannot be prepared yet. Refresh and check again." p={p} tone="bad" />}
              {summary.problems.map(text => <Notice key={text} text={`${text} Do not prepare this statement. Tell the developer.`} p={p} tone="bad" />)}
              {clash.map(s => <Notice key={s.id} text={`Another statement already covers part of these dates: ${periodTitle(s)}. Void it or choose other dates.`} p={p} tone="bad" />)}
              {locked && existing && <Notice text={`This statement has already been ${existing.status === "paid" ? "paid" : "issued"}. Management voids it before it can be prepared again.`} p={p} />}
              {existing?.status === "draft" && <Notice text="A draft for these dates already exists. Preparing again replaces its figures." p={p} />}
              {notes.length > 0 && <View style={{ gap: 4 }}><Text style={heading(p)}>Worth a look</Text>{notes.map(note => <Text key={note} style={small(p)}>{note}</Text>)}</View>}
              <Button label={busyStatement.startsWith("prepare:") ? "Preparing…" : existing ? "Prepare again" : "Prepare statement"} icon="file-text" primary p={p} disabled={stopped || !!busyStatement} onPress={prepare} />
              {!onPeriod && picked && !picked.month && <Text style={small(p)}>A statement for other dates appears in the list under the month it starts in. Use the month arrows to find it.</Text>}
            </View>
          )}
        </View>
      )}

      <View style={{ gap: 10 }}>
        <View style={{ gap: 4 }}>
          <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Statements</Text>
          <Text style={small(p)}>{`Every statement that covers a day in ${monthLabel(period)}, and the properties that have none yet.`}</Text>
        </View>
        <TrackerList p={p} items={items} onOpen={i => setOpenId(i.id)} empty="No properties are available for statements yet." loading={loading} />
      </View>

      <TrackerDetailSheet p={p} item={open ?? null} forms={open ? statementForms(role, open.source.row, open.source.statement) as unknown as WorkflowForm[] : []} onForm={f => onForm(open, f)} onClose={() => setOpenId(null)}>
        {open?.source.statement && <StatementExtras p={p} statement={open.source.statement} />}
      </TrackerDetailSheet>
      <Text style={small(p)}>Owners see issued and paid statements in their app. Stripe payouts will be added when Stripe is connected.</Text>
    </View>
  );
}
