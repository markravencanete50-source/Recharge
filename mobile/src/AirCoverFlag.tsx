import { useEffect, useState } from "react";
import { Text } from "./Typography";
import { Sheet } from "./TeamFlows";
import { Button, Field, message, Notice, useRequestId } from "./LiveKit";
import { readTeams, writeTeams } from "./backend/client";
import { ui, type Palette } from "./theme";
import { canFlagAirCover, flagAirCoverAction, hasLiveClaim } from "../../lib/aircover-flag";
import { parseAircover } from "../../lib/tracker-aircover";

// "Flag as AirCover claim" on a repair (client ask B4): starts a claim for this maintenance ticket, with
// the amount and AirCover's reference if they are known. The claim then follows its steps in the AirCover
// list. Once the repair has a claim in progress the button gives way to a short line saying so. The
// database refuses a second claim and says why; that message is shown as it comes.
export function AirCoverFlag({ p, role, workId, title }: { p: Palette; role: string; workId: string; title: string }) {
  const allowed = canFlagAirCover(role);
  const [flagged, setFlagged] = useState(false);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRequestId(open ? ["aircover", workId, amount.trim(), reference.trim()].join(":") : null);
  // Does this repair already have a claim in progress? (The parent keys this by repair, so each repair starts unflagged.)
  // Anyone who cannot see the claims finds out from the database's refusal.
  useEffect(() => {
    if (!allowed) return;
    let active = true;
    readTeams({ section: "aircover" }).then(r => { if (active) setFlagged(hasLiveClaim(parseAircover(r.data).claims, workId)); }).catch(() => undefined);
    return () => { active = false; };
  }, [allowed, workId]);
  if (!allowed) return null;
  const close = () => { if (!busy) { setOpen(false); setError(""); } };
  async function send() {
    if (busy) return;
    const built = flagAirCoverAction(workId, amount, reference, request.get());
    if ("error" in built) { setError(built.error); return; }
    setBusy(true); setError("");
    try {
      await writeTeams(built.action);
      request.done(); setOpen(false); setAmount(""); setReference(""); setFlagged(true);
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  if (flagged) return <Text style={[ui.small, { color: p.muted }]}>Flagged as an AirCover claim. Follow it in Guest relations or Accounts, under AirCover.</Text>;
  return (
    <>
      <Button label="Flag as AirCover claim" icon="shield" p={p} onPress={() => setOpen(true)} />
      <Sheet palette={p} visible={open} onClose={close} title="Flag as AirCover claim" subtitle={title} icon="clipboard">
        <Text style={[ui.small, { color: p.muted }]}>Starts a claim for this repair. Accounts follow it from there. Both boxes below are optional.</Text>
        <Field label="Amount to claim (optional)" value={amount} onChange={setAmount} p={p} placeholder="£0.00" />
        <Field label="AirCover reference (optional)" value={reference} onChange={setReference} p={p} />
        {!!error && <Notice text={error} p={p} tone="bad" />}
        <Button label={busy ? "Sending…" : "Flag the claim"} primary p={p} disabled={busy} onPress={() => void send()} />
      </Sheet>
    </>
  );
}
