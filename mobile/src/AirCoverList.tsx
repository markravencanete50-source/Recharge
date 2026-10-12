import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { Text } from "./Typography";
import { Anchor, Button, Field, message, Notice, useRequestId } from "./LiveKit";
import { useSaved } from "./Celebrate";
import { FlagButton } from "./ManagementFlag";
import { HubItemSheet } from "./HubItemSheet";
import { TrackerDetailSheet, TrackerList } from "./Tracker";
import { readTeams, writeTeams } from "./backend/client";
import { ui, type Palette } from "./theme";
import type { SectionProps } from "./SectionProps";
import { poundsToMinor } from "../../lib/repairs-live";
import { HUB_FLOW, HUB_STATUS_LABEL } from "../../lib/hub";
import { parseFlags, withFlags, type Flag } from "../../lib/management-flags";
import { aircoverTrackerItems, parseAircover, type AircoverRead, type Claim } from "../../lib/tracker-aircover";

// AirCover claims (client ask B4): their own section, and Accounts can see it. Any maintenance ticket
// can be flagged as a claim (the "Flag as AirCover claim" button on a repair); each claim then shows here
// with the issue it came from, its steps (to claim, claimed, paid or declined), the amount claimed and
// paid out, and a short journey. Accounts and management move a claim along; everyone else watches.
// Staff only: owners never see this section.
const MOVE_LABEL: Record<string, string> = { to_claim: "Move back to To claim", claimed: "Mark as claimed", paid: "Mark as paid", declined: "Mark as declined" };

// One stage button. Its request id follows what it would send, so a retry after an error is safe and a
// different stage or amount is never mistaken for the same request.
function MoveButton({ p, claim, status, note, settled, busy, onSend }: { p: Palette; claim: Claim; status: Claim["status"]; note: string; settled: string; busy: boolean; onSend: (status: Claim["status"], requestId: string, done: () => void) => void }) {
  const request = useRequestId(["move", claim.itemId, claim.version, status, note.trim(), status === "paid" ? settled.trim() : ""].join(":"));
  return <Button label={MOVE_LABEL[status] ?? HUB_STATUS_LABEL[status]} primary={status === "claimed" || status === "paid"} p={p} disabled={busy} onPress={() => onSend(status, request.get(), request.done)} />;
}

// Moving a claim: a note, the amount paid out (in pounds, when it is paid) and the stage buttons.
function ClaimMoves({ p, claim, onMoved }: { p: Palette; claim: Claim; onMoved: () => Promise<void> }) {
  const [note, setNote] = useState("");
  const [settled, setSettled] = useState(claim.settledMinor != null ? (claim.settledMinor / 100).toFixed(2) : claim.amountMinor != null ? (claim.amountMinor / 100).toFixed(2) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const moves = HUB_FLOW.aircover.filter(s => s !== claim.status) as Claim["status"][];
  async function send(status: Claim["status"], requestId: string, done: () => void) {
    if (busy) return;
    const settledMinor = status === "paid" && settled.trim() ? poundsToMinor(settled) : null;
    if (status === "paid" && settled.trim() && settledMinor === null) { setError("Enter the amount paid out in pounds, for example 149.99."); return; }
    setBusy(true); setError("");
    try {
      await writeTeams({ action: "moveHubItem", requestId, id: claim.itemId, version: claim.version, status, ...(note.trim() ? { note: note.trim() } : {}), ...(settledMinor !== null ? { settledMinor } : {}) });
      done(); await onMoved();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <View style={{ gap: 10 }}>
      <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "600" }}>Update this claim</Text>
      <Field label="Note (optional)" value={note} onChange={setNote} p={p} multiline />
      {moves.includes("paid") && <Field label="Amount paid out, £ (when paid)" value={settled} onChange={setSettled} p={p} placeholder="0.00" />}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {moves.map(s => <MoveButton key={s} p={p} claim={claim} status={s} note={note} settled={settled} busy={busy} onSend={(st, id, done) => void send(st, id, done)} />)}
      </View>
    </View>
  );
}

export function AirCoverList({ palette: p, account, properties, work, onOpenWork }: SectionProps) {
  const saved = useSaved();
  const hidden = account.role === "client";
  const [read, setRead] = useState<AircoverRead | null>(null);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const [a, f] = await Promise.allSettled([readTeams({ section: "aircover" }), readTeams({ section: "flags" })]);
    if (a.status === "fulfilled") { setRead(parseAircover(a.value.data)); setError(""); } else setError(message(a.reason));
    if (f.status === "fulfilled") setFlags(parseFlags(f.value.data));
    setLoading(false);
  }, []);
  useEffect(() => { if (hidden) return; let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load, hidden]);

  const items = useMemo(() => {
    const ctx = { property: (id: string) => properties.find(x => x.id === id), forms: () => [], now: new Date(), owner: false };
    return withFlags(aircoverTrackerItems(read ?? { canManage: false, claims: [] }, ctx), flags);
  }, [read, properties, flags]);
  const open = items.find(i => i.id === openId) ?? null;
  const claim = open?.source as Claim | undefined;
  const issueWork = claim ? work.find(w => w.workId === (claim.workId ?? claim.issue?.workId)) : undefined;
  if (hidden) return null;

  return (
    <Anchor id="section-aircover">
      <View style={{ gap: 16 }}>
        <View style={{ gap: 4 }}>
          <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>AirCover</Text>
          <Text style={[ui.small, { color: p.muted }]}>Claims for damage covered by AirCover. A maintenance ticket can be flagged as a claim; Accounts follow it to paid or declined.</Text>
        </View>
        {read?.canManage && <Button label="Add a claim" icon="plus" primary p={p} onPress={() => setAdding(true)} />}
        <TrackerList p={p} items={items} loading={loading} error={error} onOpen={i => setOpenId(i.id)} empty="No AirCover claims yet. Flag a maintenance ticket to start one." />
        <TrackerDetailSheet p={p} item={open} onClose={() => setOpenId(null)}>
          {!!open && !!claim && <View style={{ gap: 14 }}>
            {!!issueWork && <Button label="Open the issue" icon="external-link" p={p} onPress={() => { setOpenId(null); onOpenWork(issueWork); }} />}
            {read?.canManage && <ClaimMoves key={claim.itemId + ":" + claim.version} p={p} claim={claim} onMoved={saved(async () => { setOpenId(null); await load(); })} />}
            <FlagButton p={p} role={account.role} target={{ hubItemId: claim.itemId, propertyId: open.propertyId, title: `AirCover claim: ${open.title}` }} onDone={() => void load()} />
          </View>}
        </TrackerDetailSheet>
        <HubItemSheet p={p} hub={null} account={account} properties={properties} target={adding ? { kind: "aircover" } : null} onClose={() => setAdding(false)} onSaved={saved(async () => { setAdding(false); await load(); })} />
      </View>
    </Anchor>
  );
}
