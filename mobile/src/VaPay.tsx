import { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, View } from "react-native";
import { Text } from "./Typography";
import { CompanyLogo } from "./CompanyLogo";
import { useSaved } from "./Celebrate";
import { Sheet } from "./TeamFlows";
import { DateField } from "./CalendarPicker";
import { Pills } from "./Pills";
import { ui, type Palette } from "./theme";
import { Button, Field, Loading, london, message, Notice, Section, useRequestId } from "./LiveKit";
import { List, Row } from "./AccountsPayable";
import { readTeams, writeTeams } from "./backend/client";
import { exportReport } from "./exportReport";
import {
  adjustVaAction, approveVaAction, hoursAmount, hoursLabel, markVaPaidAction, monthLabel, parseUsd, queryVaAction, rateLabel, rejectVaAction, saveVaPayAction, signedHours,
  TIER_LABEL, usd, VA_DOC_TITLE, VA_PAPER, vaDoc, vaFileName, vaGroups, vaPayAccessQuery, vaPayAccessSchema, vaPaySetupQuery, vaPaySetupSchema, vaRequestHtml, vaRequestQuery,
  vaRequestSchema, vaRequestsQuery, vaRequestsSchema, vaStatus, longDay, type StatusTone, type VaPayAccess, type VaPayRow, type VaPaySetup, type VaRequest,
} from "../../lib/va-pay";
import { DEPARTMENT_LABEL } from "../../lib/hub";
import { isWorkspaceAdmin } from "../../lib/modules";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";

// VA pay (migration 20261022200000). Management (admins, super admins and the management area) sees every VA's monthly
// Request for Invoice, grouped To approve, To pay and Paid, and each VA's pay setup (hourly rate and bonus per KPI tier,
// in US dollars). Each VA sees only their own requests, read only, and downloads the document. The document is the same
// designed page on screen (VaRequestPaper) and as the download (lib/va-pay.ts vaRequestHtml, printed or saved as PDF).
// The paper is always light. Nobody else sees any of it: the database refuses them.

const TAG_TONE: Record<StatusTone, "good" | "wait" | "bad" | "plain"> = { wait: "wait", good: "good", paid: "good", bad: "bad" };
const rowTags = (r: VaRequest): [string, "good" | "wait" | "bad" | "plain"][] => [[vaStatus(r).label, TAG_TONE[vaStatus(r).tone]]];
const rowDetail = (r: VaRequest) => [monthLabel(r.periodStart), hoursLabel(r.minutes), r.status === "approved" ? `due ${longDay(r.dueOn)}` : ""].filter(Boolean).join(" · ");
const areaLabel = (area: string | null) => area ? DEPARTMENT_LABEL[area] ?? area : "No area";

// The request as a page. On the web it opens in a new tab with "Print or save as PDF"; on a phone the share sheet saves
// or opens the HTML page (then Print, or Save as PDF).
export async function downloadVaRequest(request: VaRequest) {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const page = window.open("", "_blank");
    if (!page) throw new Error("Allow pop-ups for Recharge to open the request.");
    page.document.open(); page.document.write(vaRequestHtml(request, { origin: window.location.origin })); page.document.close();
    return "The request opened in a new tab. Choose Print or save as PDF.";
  }
  await exportReport(vaRequestHtml(request), vaFileName(request), { mime: "text/html", uti: "public.html" });
  return "Ready to save or share. Open it and choose Print or save as PDF.";
}

// The request on screen: the same layout as the page.
export function VaRequestPaper({ request }: { request: VaRequest }) {
  const doc = vaDoc(request), c = VA_PAPER, tone = c.tone[doc.chip?.tone ?? doc.status.tone];
  const label = { color: c.muted, fontSize: 10, fontWeight: "600" as const, letterSpacing: 1.4, textTransform: "uppercase" as const };
  return (
    <View accessibilityLabel={`Request for invoice ${doc.number}, ${doc.status.label}, ${doc.totalLabel} ${doc.total}`} style={{ backgroundColor: c.page, borderRadius: 14, overflow: "hidden", borderWidth: 1, borderColor: c.rule }}>
      <View style={[ui.between, { backgroundColor: c.band, paddingHorizontal: 20, paddingVertical: 18, gap: 16, borderBottomWidth: 1, borderBottomColor: c.rule, flexWrap: "wrap" }]}>
        <CompanyLogo palette={{ isDark: false } as Palette} variant="light" width={132} />
        <View style={{ alignItems: "flex-end", flexShrink: 1 }}>
          <Text accessibilityRole="header" style={{ color: c.forest, fontSize: 15, fontWeight: "600", letterSpacing: 4, textAlign: "right" }}>{VA_DOC_TITLE}</Text>
          <Text style={{ color: c.muted, fontSize: 13, letterSpacing: 0.6, marginTop: 2 }}>{doc.number}</Text>
        </View>
      </View>
      <View style={{ padding: 20, gap: 18 }}>
        <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
          {doc.chip && <View style={{ backgroundColor: tone.wash, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 4 }}><Text style={{ color: tone.ink, fontSize: 12, fontWeight: "600" }}>{doc.chip.label}</Text></View>}
          {doc.paidStamp && <View accessible={false} style={{ marginLeft: "auto", borderWidth: 2, borderColor: c.forest, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, transform: [{ rotate: "-6deg" }], opacity: 0.8, alignItems: "center" }}>
            <Text style={{ color: c.forest, fontWeight: "600", letterSpacing: 3 }}>PAID</Text>
            <Text style={{ color: c.forest, fontSize: 10 }}>{doc.paidStamp}</Text>
          </View>}
        </View>
        <View style={{ flexDirection: "row", gap: 16, flexWrap: "wrap" }}>
          <View style={{ flexGrow: 1, flexBasis: 180, minWidth: 0, gap: 2 }}>
            <Text style={label}>From</Text>
            <Text style={{ color: c.ink, fontSize: 15, fontWeight: "600" }}>{doc.from[0]}</Text>
            {doc.from.slice(1).map(l => <Text key={l} style={{ color: c.muted, fontSize: 12 }}>{l}</Text>)}
          </View>
          <View style={{ flexGrow: 1, flexBasis: 140, minWidth: 0, gap: 2 }}><Text style={label}>To</Text><Text style={{ color: c.ink, fontSize: 15, fontWeight: "600" }}>{doc.to}</Text></View>
        </View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.rule }}>
          {doc.facts.map(f => <View key={f.label} style={{ flexGrow: 1, flexBasis: 120, paddingVertical: 10, paddingRight: 10, gap: 2 }}><Text style={label}>{f.label}</Text><Text style={{ color: c.ink, fontSize: 13 }}>{f.value}</Text></View>)}
        </View>
        <View>
          <View style={[ui.row, { borderBottomWidth: 1, borderBottomColor: c.ink, paddingBottom: 6, gap: 8 }]}>
            <Text style={[label, { flex: 1 }]}>Description</Text><Text style={[label, { textAlign: "right" }]}>Amount</Text>
          </View>
          {doc.lines.map((l, n) => (
            <View key={l.key} style={[ui.row, { gap: 8, paddingVertical: 9, paddingHorizontal: 2, borderBottomWidth: 1, borderBottomColor: c.rule, backgroundColor: n % 2 ? c.zebra : c.page, alignItems: "flex-start" }]}>
              <Text style={{ flex: 1, minWidth: 0, color: c.ink, fontSize: 13 }}>{l.label}</Text>
              <Text style={{ color: c.ink, fontSize: 13, textAlign: "right", fontVariant: ["tabular-nums"] }}>{l.amount}</Text>
            </View>
          ))}
        </View>
        {!!doc.days.length && <View style={{ gap: 4 }}>
          <Text style={label}>Hours by day</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", columnGap: 20 }}>
            {doc.days.map(d => <View key={d.key} style={[ui.between, { flexBasis: 130, flexGrow: 1, paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: c.rule }]}>
              <Text style={{ color: c.muted, fontSize: 12 }}>{d.date}</Text><Text style={{ color: c.ink, fontSize: 12, fontVariant: ["tabular-nums"] }}>{d.hours}</Text>
            </View>)}
          </View>
          {!!doc.correction && <Text style={{ color: c.muted, fontSize: 12 }}>{doc.correction}</Text>}
        </View>}
        <View style={[ui.between, { alignSelf: "flex-end", minWidth: 240, alignItems: "baseline", gap: 16, borderTopWidth: 1, borderTopColor: c.ink, paddingTop: 10 }]}>
          <Text style={{ color: c.ink, fontWeight: "600" }}>{doc.totalLabel}</Text>
          <Text style={{ color: c.forest, fontSize: 24, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{doc.total}</Text>
        </View>
        <View style={{ backgroundColor: c.zebra, borderRadius: 10, padding: 14, gap: 4 }}>
          <Text style={label}>Terms</Text>
          <Text style={{ color: c.ink, fontSize: 13 }}>{doc.terms}</Text>
        </View>
        <View style={{ borderTopWidth: 1, borderTopColor: c.rule, paddingTop: 12, gap: 2 }}>
          <Text style={{ color: c.muted, fontSize: 12 }}>{doc.footer}</Text>
          <Text style={{ color: c.muted, fontSize: 11 }}>{doc.legal}</Text>
        </View>
      </View>
    </View>
  );
}

// One request: read with its days (and, for management, its change log), shown as the paper, with Download; management
// also decides here, never on their own request.
export function VaRequestSheet({ p, requestId, canAct = false, onClose, onChanged }: { p: Palette; requestId: string | null; canAct?: boolean; onClose: () => void; onChanged?: () => Promise<void> }) {
  const saved = useSaved();
  const [request, setRequest] = useState<VaRequest | null>(null), [error, setError] = useState(""), [note, setNote] = useState("");
  const load = useCallback(async () => {
    if (!requestId) return;
    try { setRequest(vaRequestSchema.parse((await readTeams(vaRequestQuery(requestId))).data)); setError(""); } catch (e) { setError(message(e)); }
  }, [requestId]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) { setRequest(null); setNote(""); void load(); } }); return () => { active = false; }; }, [load]);
  const download = async () => { if (!request) return; try { setNote(await downloadVaRequest(request)); } catch (e) { setNote(message(e)); } };
  return (
    <Sheet palette={p} visible={!!requestId} onClose={onClose} title={request ? `Request ${request.number}` : "Request for invoice"} subtitle={request ? `${request.vaName} · ${usd(request.totalMinor)}` : undefined} icon="receipt">
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {!request && !error && <Loading p={p} rows={3} />}
      {request && <>
        {request.queried && !!request.queryNote && <Notice text={`Management asked: ${request.queryNote}`} p={p} />}
        {request.status === "rejected" && !!request.rejectNote && <Notice text={`Rejected: ${request.rejectNote}`} p={p} tone="bad" />}
        {!!request.hoursAdjustMinutes && <Notice text={`Hours corrected by ${signedHours(request.hoursAdjustMinutes)}${request.hoursAdjustReason ? `: ${request.hoursAdjustReason}` : ""}`} p={p} />}
        {request.bonusAdjusted && <Notice text={`Bonus set to ${usd(request.bonusMinor)} (the KPI's was ${usd(request.bonusAutoMinor)})${request.bonusAdjustReason ? `: ${request.bonusAdjustReason}` : ""}`} p={p} />}
        <VaRequestPaper request={request} />
        <Button label="Download (print or save as PDF)" icon="download" p={p} onPress={() => void download()} />
        {!!note && <Text accessibilityLiveRegion="polite" style={[ui.small, { color: p.muted }]}>{note}</Text>}
        {canAct && !request.own && <VaDecision p={p} request={request} onDone={saved(async () => { await load(); await onChanged?.(); })} />}
        {canAct && request.own && request.status !== "paid" && <Text style={[ui.small, { color: p.muted }]}>This is your own request: someone else in management decides it.</Text>}
        {!!request.changes?.length && <View style={{ gap: 4 }}>
          <Text style={[ui.small, { color: p.muted, fontWeight: "700" }]}>History</Text>
          {request.changes.map((c, i) => <Text key={i} style={[ui.small, { color: p.muted }]}>{`${longDay(c.changedAt.slice(0, 10))} · ${c.changedByName ?? "Automatic"} · ${c.change}${c.reason ? `: ${c.reason}` : ""}`}</Text>)}
        </View>}
      </>}
    </Sheet>
  );
}

type Mode = "idle" | "query" | "reject" | "adjust";
// Approve, Query or Reject with a note, Adjust (hours and/or bonus, with a reason) while it waits; Mark paid once approved.
function VaDecision({ p, request, onDone }: { p: Palette; request: VaRequest; onDone: () => Promise<void> }) {
  const today = london(new Date());
  const [mode, setMode] = useState<Mode>("idle"), [note, setNote] = useState(""), [paidOn, setPaidOn] = useState(today), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [hours, setHours] = useState(String(request.hoursAdjustMinutes)), [bonus, setBonus] = useState(request.bonusAdjusted ? (request.bonusMinor / 100).toFixed(2) : "");
  const ids = useRequestId(`va:${request.id}:${request.version}`);
  async function send(kind: "approve" | "query" | "reject" | "adjust" | "paid") {
    if (busy) return;
    if (kind !== "approve" && kind !== "paid" && note.trim().length < 5) { setError(kind === "adjust" ? "Write the reason (at least 5 characters)." : "Write the note for the VA (at least 5 characters)."); return; }
    let hoursAdjustMinutes: number | undefined, bonusMinor: number | null | undefined;
    if (kind === "adjust") {
      const h = hours.trim() === "" ? 0 : Number(hours);
      if (!Number.isInteger(h)) { setError("The hours correction is a whole number of minutes, for example 30 or -45."); return; }
      if (request.workedMinutes + h < 0) { setError("The correction cannot take the hours below zero."); return; }
      if (h !== request.hoursAdjustMinutes) hoursAdjustMinutes = h;
      const b = bonus.trim() === "" ? null : parseUsd(bonus);
      if (bonus.trim() !== "" && b === null) { setError("Enter the bonus in dollars, for example 50.00, or leave it empty for the KPI's."); return; }
      if (b !== (request.bonusAdjusted ? request.bonusMinor : null)) bonusMinor = b;
      if (hoursAdjustMinutes === undefined && bonusMinor === undefined) { setError("Change the hours or the bonus first."); return; }
    }
    setBusy(true); setError("");
    try {
      const requestId = ids.get(kind + ":" + note.trim() + ":" + paidOn + ":" + hours + ":" + bonus);
      await writeTeams(kind === "approve" ? approveVaAction({ requestId, request }) : kind === "query" ? queryVaAction({ requestId, request, note })
        : kind === "reject" ? rejectVaAction({ requestId, request, note }) : kind === "adjust" ? adjustVaAction({ requestId, request, reason: note, hoursAdjustMinutes, bonusMinor })
        : markVaPaidAction({ requestId, request, paidOn }));
      setMode("idle"); setNote(""); await onDone();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  if (request.status === "to_approve") {
    const preview = mode === "adjust" ? (() => {
      const h = hours.trim() === "" ? 0 : Number(hours), b = bonus.trim() === "" ? request.bonusAutoMinor : parseUsd(bonus);
      return Number.isInteger(h) && b !== null ? `New total ${usd(hoursAmount(request.workedMinutes + h, request.hourlyRateMinor) + b)}: ${hoursLabel(request.workedMinutes + h)} at ${rateLabel(request.hourlyRateMinor)}, bonus ${usd(b)}` : "";
    })() : "";
    return (
      <View style={{ gap: 12 }}>
        {mode === "adjust" && <>
          <Field label="Hours correction, in minutes (for example 30 or -45; 0 for none)" value={hours} onChange={setHours} p={p} placeholder="0" />
          <Field label={`Bonus in dollars (empty for the KPI's ${usd(request.bonusAutoMinor)})`} value={bonus} onChange={setBonus} p={p} placeholder={(request.bonusAutoMinor / 100).toFixed(2)} />
          {!!preview && <Text style={[ui.small, { color: p.muted }]}>{preview}</Text>}
        </>}
        {mode !== "idle" && <Field label={mode === "adjust" ? "Reason (kept with the request)" : mode === "query" ? "Your question for the VA" : "Why it is rejected"} value={note} onChange={setNote} p={p} multiline
          placeholder={mode === "adjust" ? "For example: forgot to clock out on the 7th" : undefined} />}
        {!!error && <Notice text={error} p={p} tone="bad" />}
        <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
          {mode === "idle"
            ? <>
              <Button label={busy ? "Approving…" : "Approve"} icon="check" primary p={p} disabled={busy} onPress={() => void send("approve")} />
              <Button label="Query" icon="help-circle" p={p} disabled={busy} onPress={() => { setMode("query"); setError(""); }} />
              <Button label="Adjust" icon="edit-2" p={p} disabled={busy} onPress={() => { setMode("adjust"); setError(""); }} />
              <Button label="Reject" icon="x" quiet p={p} disabled={busy} onPress={() => { setMode("reject"); setError(""); }} />
            </>
            : <>
              <Button label="Cancel" p={p} disabled={busy} onPress={() => { setMode("idle"); setError(""); }} />
              <Button label={busy ? "Saving…" : mode === "query" ? "Send query" : mode === "reject" ? "Reject" : "Save adjustment"} icon="check" primary p={p} disabled={busy} onPress={() => void send(mode)} />
            </>}
        </View>
      </View>
    );
  }
  if (request.status === "approved") return (
    <View style={{ gap: 12 }}>
      <DateField p={p} label="Paid on" mode="single" value={{ from: paidOn, to: paidOn }} onChange={v => setPaidOn(v.from)} wholeMonthLink={false} today={today} />
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : "Mark paid"} icon="check-circle" primary p={p} disabled={busy || !paidOn} onPress={() => void send("paid")} />
      <Text style={[ui.small, { color: p.muted }]}>Recording the payment is enough here: the bank is not connected.</Text>
    </View>
  );
  return null;
}

function useVaRequests(tick = 0) {
  const [state, setState] = useState<{ data: VaRequest[] | null; error: string }>({ data: null, error: "" });
  const load = useCallback(async () => {
    try { setState({ data: vaRequestsSchema.parse((await readTeams(vaRequestsQuery())).data), error: "" }); }
    catch (e) { setState(s => ({ ...s, error: message(e) })); }
  }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load, tick]);
  return { ...state, reload: load };
}

function useVaAccess() {
  const [access, setAccess] = useState<VaPayAccess | null>(null);
  useEffect(() => {
    let active = true;
    readTeams(vaPayAccessQuery()).then(r => { if (active) setAccess(vaPayAccessSchema.parse(r.data)); }).catch(() => { if (active) setAccess({ canManage: false, isVa: false }); });
    return () => { active = false; };
  }, []);
  return access;
}

// A VA's own requests, read only: the status and the document.
export function VaPayMine({ p }: { p: Palette }) {
  const list = useVaRequests();
  const [open, setOpen] = useState<string | null>(null);
  const mine = (list.data ?? []).filter(r => r.own);
  return (
    <Section title="Your requests for invoice" p={p}>
      <Text style={[ui.small, { color: p.muted }]}>On the 1st of each month Recharge asks you to invoice us for the month just ended: your hours at your hourly rate, plus your bonus for the KPI tier you reached. Open one to see it and download it.</Text>
      {!!list.error && <Notice text={list.error} p={p} tone="bad" />}
      {!list.data && !list.error && <Loading p={p} rows={1} />}
      {list.data && <List p={p} search={false} empty="No requests yet. The first one comes on the 1st of next month.">
        {mine.map((r, n) => <Row key={r.id} p={p} first={n === 0} icon="file-text" tone="stays" title={r.number} detail={rowDetail(r)} amount={usd(r.totalMinor)} tags={rowTags(r)} onPress={() => setOpen(r.id)} />)}
      </List>}
      <VaRequestSheet p={p} requestId={open} onClose={() => setOpen(null)} />
    </Section>
  );
}

// Management: every VA's requests, To approve, To pay and Paid, and each VA's pay setup.
export function VaPayManagement({ p }: { p: Palette }) {
  const [tick, setTick] = useState(0);
  const list = useVaRequests(tick);
  const [open, setOpen] = useState<string | null>(null);
  const [view, setView] = useState<"requests" | "setup">("requests");
  const groups = useMemo(() => vaGroups(list.data ?? []), [list.data]);
  const changed = useCallback(async () => { setTick(t => t + 1); }, []);
  const section = (title: string, rows: VaRequest[], totalMinor: number, empty: string, detail: (r: VaRequest) => string) => (
    <Section title={title} count={rows.length} p={p}>
      {list.data && <List p={p} empty={empty}>
        {rows.map((r, n) => <Row key={r.id} p={p} first={n === 0} avatar={r.vaName} tone="stays" title={`${r.vaName} · ${r.number}`} detail={detail(r)} amount={usd(r.totalMinor)} tags={rowTags(r)} onPress={() => setOpen(r.id)} />)}
      </List>}
      {rows.length > 0 && <View style={[ui.between, { padding: 14, borderRadius: 14, backgroundColor: p.wash }]}>
        <Text style={{ color: p.text, fontWeight: "700" }}>Total</Text>
        <Text style={{ color: p.text, fontWeight: "700", fontSize: 18, fontVariant: ["tabular-nums"] }}>{usd(totalMinor)}</Text>
      </View>}
    </Section>
  );
  return (
    <>
      <Pills p={p} title="VA pay" values={["requests", "setup"] as const} value={view} onChange={setView} label={v => v === "requests" ? "Requests for invoice" : "Pay setup"} />
      {view === "requests" && <>
        <Text style={[ui.small, { color: p.muted }]}>Made on the 1st of each month for the month just ended: each VA&apos;s hours at their hourly rate, plus the bonus for the highest KPI tier they reached. Amounts are in US dollars.</Text>
        {!!list.error && <Notice text={list.error} p={p} tone="bad" />}
        {!list.data && !list.error && <Loading p={p} rows={2} />}
        {section("To approve", groups.toApprove, groups.toApproveMinor, "No requests are waiting for approval.", r => `${rowDetail(r)}${r.queried ? " · queried" : ""}`)}
        {section("To pay", groups.toPay, groups.toPayMinor, "No approved requests are waiting to be paid.", r => `${monthLabel(r.periodStart)} · due ${longDay(r.dueOn)}`)}
        {section("Paid", groups.paid, groups.paidMinor, "Nothing paid yet.", r => `${monthLabel(r.periodStart)} · paid ${r.paidOn ? longDay(r.paidOn) : ""}`)}
        <VaRequestSheet p={p} requestId={open} canAct onClose={() => setOpen(null)} onChanged={changed} />
      </>}
      {view === "setup" && <VaPaySetupList p={p} onChanged={changed} />}
    </>
  );
}

// Each VA's hourly rate and bonus amounts, with the bonus KPI of their area and its tiers.
function VaPaySetupList({ p, onChanged }: { p: Palette; onChanged: () => Promise<void> }) {
  const [setup, setSetup] = useState<VaPaySetup | null>(null), [error, setError] = useState(""), [editing, setEditing] = useState<VaPayRow | null>(null), [tick, setTick] = useState(0);
  useEffect(() => {
    let active = true;
    readTeams(vaPaySetupQuery()).then(r => { if (active) { setSetup(vaPaySetupSchema.parse(r.data)); setError(""); } }).catch(e => { if (active) setError(message(e)); });
    return () => { active = false; };
  }, [tick]);
  const kpiFor = (area: string | null) => setup?.bonusKpis.find(k => k.area === area);
  return (
    <Section title="VA pay setup" count={setup?.vas.length} p={p}>
      <Text style={[ui.small, { color: p.muted }]}>Hourly rate and the bonus at each KPI tier, in US dollars. Only the highest tier reached pays; they do not add up. Every change is kept with who made it and when.</Text>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {!setup && !error && <Loading p={p} rows={2} />}
      {setup && <List p={p} empty="No VAs yet.">
        {setup.vas.map((v, n) => {
          const k = kpiFor(v.area);
          return <Row key={v.userId} p={p} first={n === 0} avatar={v.fullName ?? "VA"} tone="stays" title={`${v.fullName ?? "VA"} · ${areaLabel(v.area)}`}
            detail={v.hourlyRateMinor == null ? "No hourly rate yet, so no request" : `${rateLabel(v.hourlyRateMinor)} · bonus ${usd(v.bonusTargetMinor)} / ${usd(v.bonusTier2Minor)} / ${usd(v.bonusTier3Minor)}${k ? ` on ${k.name}` : ""}`}
            tags={v.own ? [["You", "plain"]] : v.hourlyRateMinor == null ? [["Not set", "wait"]] : undefined} onPress={v.own ? undefined : () => setEditing(v)} />;
        })}
      </List>}
      {!!setup?.history.length && <View style={{ gap: 4 }}>
        <Text style={[ui.small, { color: p.muted, fontWeight: "700" }]}>Recent changes</Text>
        {setup.history.slice(0, 10).map((h, i) => <Text key={i} style={[ui.small, { color: p.muted }]}>{`${longDay(h.changedAt.slice(0, 10))} · ${h.changedByName ?? "Someone"} changed ${h.fullName ?? "a VA"}'s pay`}</Text>)}
      </View>}
      <VaPaySetupSheet p={p} row={editing} kpi={editing ? kpiFor(editing.area) ?? null : null} onClose={() => setEditing(null)} onDone={async () => { setTick(t => t + 1); await onChanged(); }} />
    </Section>
  );
}

const money2 = (minor: number | null) => minor == null ? "" : (minor / 100).toFixed(2);
function VaPaySetupSheet({ p, row, kpi, onClose, onDone }: { p: Palette; row: VaPayRow | null; kpi: VaPaySetup["bonusKpis"][number] | null; onClose: () => void; onDone: () => Promise<void> }) {
  const [rate, setRate] = useState(""), [target, setTarget] = useState(""), [tier2, setTier2] = useState(""), [tier3, setTier3] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const ids = useRequestId(row ? `vapay:${row.userId}:${row.version}` : null);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active && row) { setRate(money2(row.hourlyRateMinor)); setTarget(money2(row.bonusTargetMinor)); setTier2(money2(row.bonusTier2Minor)); setTier3(money2(row.bonusTier3Minor)); setError(""); } });
    return () => { active = false; };
  }, [row]);
  const tiers = kpi ? [kpi.targetPercent, ...kpi.bonusTiers].map(t => `${t}%`) : [];
  async function save() {
    if (!row || busy) return;
    const r = rate.trim() === "" ? null : parseUsd(rate), amounts = [target, tier2, tier3].map(t => t.trim() === "" ? 0 : parseUsd(t));
    if (rate.trim() !== "" && (r === null || r < 1)) { setError("Enter the hourly rate in dollars, for example 12.50."); return; }
    if (amounts.some(a => a === null)) { setError("Enter each bonus in dollars, for example 50.00 (0 for none)."); return; }
    setBusy(true); setError("");
    try {
      await writeTeams(saveVaPayAction({ requestId: ids.get(`${rate}:${target}:${tier2}:${tier3}`), vaId: row.userId, version: row.version, hourlyRateMinor: r, bonusTargetMinor: amounts[0]!, bonusTier2Minor: amounts[1]!, bonusTier3Minor: amounts[2]! }));
      onClose(); await onDone();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible={!!row} onClose={onClose} title="VA pay" subtitle={row?.fullName ?? undefined} icon="receipt">
      <Text style={[ui.body, { color: p.text }]}>Paid by the hour, in US dollars, from their clocked time less unpaid pauses. The bonus follows {kpi ? `"${kpi.name}"` : "their area's bonus KPI"}: only the highest tier reached pays.</Text>
      <Field label="Hourly rate ($, empty for none)" value={rate} onChange={setRate} p={p} placeholder="12.50" />
      <Field label={`Bonus at the target${tiers[0] ? ` (${tiers[0]})` : ""} ($)`} value={target} onChange={setTarget} p={p} placeholder="0.00" />
      <Field label={`Bonus at ${TIER_LABEL.tier2.toLowerCase()}${tiers[1] ? ` (${tiers[1]})` : ""} ($)`} value={tier2} onChange={setTier2} p={p} placeholder="0.00" />
      <Field label={`Bonus at ${TIER_LABEL.tier3.toLowerCase()}${tiers[2] ? ` (${tiers[2]})` : ""} ($)`} value={tier3} onChange={setTier3} p={p} placeholder="0.00" />
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : "Save VA pay"} icon="check" primary p={p} disabled={busy} onPress={() => void save()} />
    </Sheet>
  );
}

// Where VA pay shows. In Management (admins and super admins): everything. On My performance: a VA's own requests, and
// for a management-area VA who is not an admin (so has no Management tab) the management view as well.
export function VaPayPanel({ p, account, place }: { p: Palette; account: WorkspaceAccount; place: "management" | "mine" }) {
  const access = useVaAccess();
  if (!access) return null;
  if (place === "management") return access.canManage ? <VaPayManagement p={p} /> : <Notice text="Only management can see VA pay." p={p} />;
  return (
    <>
      {access.isVa && <VaPayMine p={p} />}
      {access.canManage && !isWorkspaceAdmin(account.role) && <View style={{ gap: 12 }}>
        <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>VA pay</Text>
        <VaPayManagement p={p} />
      </View>}
    </>
  );
}
