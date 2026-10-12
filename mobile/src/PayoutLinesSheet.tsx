import { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Text } from "./Typography";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { Button, Field, Loading, message, Notice, Tag, useRequestId } from "./LiveKit";
import { readFinance, writeFinance } from "./backend/client";
import { formatDay, plural } from "../../lib/format";
import { CHANNEL_LABEL, payoutLinesReportSchema, pounds, type PayoutLineRow, type PayoutLinesReport } from "../../lib/accounts-live";

// The money behind one stay: every payout line the platforms have reported for it, newest first. A line that should not
// count (a payment for a stay that was cancelled, say) can be set aside with a reason. Nothing is deleted: a set-aside line
// stays on the list with who set it aside and why. Finance roles only; owners never reach this screen.
export type LinesStay = { reservationId: string; reference: string; channel: string; checkIn: string; checkOut: string; expectedMinor?: number | null; propertyName?: string };
const REASON_MIN = 5, REASON_MAX = 2000;
const FEES = [["commissionMinor", "Commission"], ["hostFeeMinor", "Host fee"], ["paymentFeeMinor", "Payment fee"], ["cleaningFeeMinor", "Cleaning fee"]] as const;
const uploadedDay = (iso: string | undefined) => iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";

// "Gross £500.00 · Commission £75.00 · Payment fee £10.00": only the amounts the platform's file carried.
function detailOf(line: PayoutLineRow) {
  const fees = FEES.map(([key, label]) => { const value = line[key] as number | null | undefined; return typeof value === "number" ? `${label} ${pounds(value)}` : ""; });
  return [typeof line.grossMinor === "number" ? `Gross ${pounds(line.grossMinor)}` : "", ...fees].filter(Boolean).join(" · ");
}

export function PayoutLinesSheet({ p, stay, canSetAside, onClose, onChanged }: { p: Palette; stay: LinesStay | null; canSetAside: boolean; onClose: () => void; onChanged: () => Promise<void> }) {
  const [report, setReport] = useState<PayoutLinesReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [asking, setAsking] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // One request identifier per attempt, kept until it succeeds, so a retry after a lost reply replays the original request.
  const request = useRequestId(asking ? ["aside", asking, reason.trim()].join(":") : null);
  const reservationId = stay?.reservationId ?? null;
  const latest = useRef(0);

  const load = useCallback(async () => {
    if (!reservationId) return;
    const mine = ++latest.current;
    setLoading(true); setLoadError("");
    try {
      const next = payoutLinesReportSchema.parse((await readFinance({ section: "payoutLines", id: reservationId })).data);
      if (mine === latest.current) setReport(next);
    } catch (e) { if (mine === latest.current) setLoadError(message(e)); }
    finally { if (mine === latest.current) setLoading(false); }
  }, [reservationId]);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (!active) return; setReport(null); setAsking(null); setReason(""); setError(""); void load(); });
    return () => { active = false; };
  }, [load]);

  function ask(line: PayoutLineRow) { setAsking(line.lineId); setReason(""); setError(""); }
  function cancel() { if (busy) return; setAsking(null); setReason(""); setError(""); }
  async function confirmSetAside(line: PayoutLineRow) {
    if (busy) return;
    const text = reason.trim();
    if (text.length < REASON_MIN) { setError(`Write at least ${REASON_MIN} characters, so the record says why.`); return; }
    if (text.length > REASON_MAX) { setError(`Keep the reason under ${REASON_MAX.toLocaleString("en-GB")} characters.`); return; }
    setBusy(true); setError("");
    try {
      await writeFinance({ action: "setAsidePayoutLine", requestId: request.get(), lineId: line.lineId, note: text });
      request.done(); setAsking(null); setReason("");
      await load();
      void onChanged();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }

  const lines = report?.lines ?? [];
  const anyLocked = lines.some(line => line.locked);
  const subtitle = stay ? [stay.propertyName, CHANNEL_LABEL[stay.channel] ?? stay.channel, `${formatDay(stay.checkIn)} to ${formatDay(stay.checkOut)}`].filter(Boolean).join(" · ") : undefined;

  return (
    <Sheet palette={p} visible={!!stay} onClose={onClose} title={stay ? `Payout lines · ${stay.reference}` : "Payout lines"} subtitle={subtitle} icon="coins">
      {loading && !report && <Loading p={p} />}
      {!!loadError && <Notice text={loadError} p={p} tone="bad" />}
      {!!report && <View style={{ gap: 6 }}>
        <Text style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>{lines.length ? `${plural(report.count, "line")} · ${pounds(report.activeMinor)} received` : "No payout lines yet"}</Text>
        {stay?.expectedMinor != null && <Text style={[ui.small, { color: p.muted }]}>{`Expected ${pounds(stay.expectedMinor)}. Lines that are set aside are not counted.`}</Text>}
        {report.more && <Text style={[ui.small, { color: p.muted }]}>Showing the newest lines only.</Text>}
      </View>}
      {!!report && !lines.length && <Text style={[ui.small, { color: p.muted }]}>Upload the platform’s payout report and the lines for this stay appear here.</Text>}
      {anyLocked && <Notice text="An owner statement has been issued for this stay, so its lines can no longer be set aside." p={p} />}
      {lines.map((line, i) => {
        const setAside = line.active === false || !!line.setAsideAt;
        const detail = detailOf(line);
        const allowed = canSetAside && !setAside && !line.locked && line.canSetAside !== false;
        const open = asking === line.lineId;
        const when = line.paidOn ? formatDay(line.paidOn) : line.uploadedAt ? `Uploaded ${uploadedDay(line.uploadedAt)}` : "No date";
        return (
          <View key={line.lineId} style={{ gap: 8, paddingTop: i === 0 ? 0 : 12, borderTopWidth: i === 0 ? 0 : 1, borderColor: p.border }}>
            <View style={[ui.between, { gap: 12, alignItems: "flex-start" }]}>
              <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                <Text style={{ color: p.text, fontSize: 14, fontWeight: "700" }}>{[when, line.lineType].filter(Boolean).join(" · ")}</Text>
                {!!detail && <Text style={[ui.small, { color: p.muted }]}>{detail}</Text>}
                {!!line.fileName && <Text numberOfLines={1} style={[ui.small, { color: p.muted }]}>{line.fileName}</Text>}
              </View>
              <Text style={{ color: setAside ? p.muted : p.text, fontSize: 16, fontWeight: "700", fontVariant: ["tabular-nums"], textAlign: "right", textDecorationLine: setAside ? "line-through" : "none" }}>{pounds(line.amountMinor)}</Text>
            </View>
            {setAside && <View style={{ gap: 4 }}>
              <Tag label="Set aside" tone="plain" p={p} />
              {!!line.setAsideNote && <Text style={[ui.small, { color: p.muted }]}>{`Reason: ${line.setAsideNote}`}</Text>}
              {(!!line.setAsideBy || !!line.setAsideAt) && <Text style={[ui.small, { color: p.muted }]}>{[line.setAsideBy ? `By ${line.setAsideBy}` : "", line.setAsideAt ? uploadedDay(line.setAsideAt) : ""].filter(Boolean).join(" · ")}</Text>}
            </View>}
            {allowed && !open && <View style={{ flexDirection: "row" }}><Button label="Set aside" icon="slash" p={p} onPress={() => ask(line)} /></View>}
            {allowed && open && <View style={{ gap: 10 }}>
              <Field label="Why should this line not count?" value={reason} onChange={setReason} p={p} multiline placeholder="For example: the guest cancelled and the platform took this back" />
              {!!error && <Notice text={error} p={p} tone="bad" />}
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                <Button label={busy ? "Saving…" : "Confirm set aside"} primary p={p} disabled={busy} onPress={() => void confirmSetAside(line)} />
                <Button label="Cancel" p={p} disabled={busy} onPress={cancel} />
              </View>
            </View>}
          </View>
        );
      })}
    </Sheet>
  );
}
