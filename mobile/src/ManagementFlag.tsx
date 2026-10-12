import { createContext, useContext, useState } from "react";
import { Sheet } from "./TeamFlows";
import { Button, Field, message, Notice, useRequestId } from "./LiveKit";
import { writeTeams } from "./backend/client";
import { canFlag, flagAction, type FlagTarget } from "../../lib/management-flags";
import type { Palette } from "./theme";

export type { FlagTarget };

// The signed-in role, given once near the top of the workspace (<FlagRoleContext.Provider value={account.role}>)
// so FlagButton can hide itself from owners without every detail sheet passing the account down.
// With no role known the button stays hidden: it is better missing than offered to an owner.
export const FlagRoleContext = createContext<string | null>(null);

// "Flag for management": a button that opens a small sheet asking why (a few words at least) and,
// if it matters, how much. It sends flagForManagement and tells the caller when it is done, so a list
// can reload and show the row as flagged. Owners get nothing.
export function FlagButton({ p, target, onDone, role }: { p: Palette; target: FlagTarget; onDone?: () => void; role?: string | null }) {
  const context = useContext(FlagRoleContext);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRequestId(open ? JSON.stringify([target.workId ?? "", target.hubItemId ?? "", target.title, reason.trim(), amount.trim()]) : null);
  if (!canFlag(role ?? context)) return null;
  const close = () => { if (!busy) { setOpen(false); setError(""); } };
  async function send() {
    if (busy) return;
    const built = flagAction(target, reason, amount, request.get());
    if ("error" in built) { setError(built.error); return; }
    setBusy(true); setError("");
    try {
      await writeTeams(built.action);
      request.done(); setOpen(false); setReason(""); setAmount("");
      onDone?.();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <>
      <Button label="Flag for management" icon="flag" p={p} onPress={() => setOpen(true)} />
      <Sheet palette={p} visible={open} onClose={close} title="Flag for management" subtitle={target.title} icon="clipboard">
        <Field label="Why does management need to look at this?" value={reason} onChange={setReason} p={p} multiline placeholder="A few words are enough" />
        <Field label="Amount, if there is one (optional)" value={amount} onChange={setAmount} p={p} placeholder="£0.00" />
        {!!error && <Notice text={error} p={p} tone="bad" />}
        <Button label={busy ? "Sending…" : "Send to management"} primary p={p} disabled={busy} onPress={() => void send()} />
      </Sheet>
    </>
  );
}
