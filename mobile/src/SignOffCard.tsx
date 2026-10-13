import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { useCelebrate } from "./Celebrate";
import { ui, type Palette } from "./theme";
import { Anchor, Button, Field, message, Notice, useRequestId } from "./LiveKit";
import { Check } from "./ListingSheets";
import { readTeams, writeTeams } from "./backend/client";
import { signoffSchema, type Signoff } from "../../lib/management-live";
import { plural } from "../../lib/format";

// The end-of-day sign-off: every listing visible, reviews handled, suspensions dealt with, re-listings done.
export function SignOffCard({ p, refreshKey = 0, quietWhenDone = false }: { p: Palette; refreshKey?: number; quietWhenDone?: boolean }) {
  const celebrate = useCelebrate();
  const [state, setState] = useState<Signoff | null>(null);
  const [ticks, setTicks] = useState({ allVisible: false, reviewsHandled: false, suspensionsHandled: false, relistingsDone: false });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRequestId(state && !state.mine ? "signoff:" + state.today : null);
  const load = useCallback(async () => { try { setState(signoffSchema.parse((await readTeams({ section: "signoff" })).data)); } catch (e) { setError(message(e)); } }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load, refreshKey]);
  if (!state) return error ? <Notice text={error} p={p} tone="bad" /> : null;
  // Home's End of day card has nothing to say once the day is signed off.
  if (state.mine && quietWhenDone) return null;
  if (state.mine) return (
    <Anchor id="stays-signoff"><View style={[ui.row, { gap: 12, padding: 14, borderRadius: 18, backgroundColor: p.successWash }]}>
      <Feather name="check-circle" size={20} color={p.success} />
      <Text style={{ color: p.text, flex: 1, fontWeight: "600" }}>Signed off today at {new Date(state.mine.createdAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })}{state.mine.note ? ` · ${state.mine.note}` : ""}</Text>
    </View></Anchor>
  );
  const s = state.snapshot, all = Object.values(ticks).every(Boolean);
  async function sign() {
    if (busy) return;
    if (!all) { setError("Tick all four checks before signing off."); return; }
    if (s.openRelistings > 0 && note.trim().length < 5) { setError("Say where the open re-listings are up to."); return; }
    setBusy(true); setError("");
    try { await writeTeams({ action: "signOffDay", requestId: request.get(), ...ticks, allVisible: true, reviewsHandled: true, suspensionsHandled: true, relistingsDone: true, note: note.trim() }); request.done(); celebrate("Day signed off"); await load(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const set = (k: keyof typeof ticks) => (v: boolean) => setTicks(t => ({ ...t, [k]: v }));
  return (
    <Anchor id="stays-signoff"><View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 8 }]}>
      <Text accessibilityRole="header" style={{ color: p.text, fontSize: 16, fontWeight: "700" }}>Today’s sign-off</Text>
      <Text style={[ui.small, { color: p.muted }]}>{plural(s.listingChecksToday, "listing check")} and {plural(s.reviewsToday, "review")} logged by you today · {plural(s.openRelistings, "re-listing")} open{s.flaggedToday ? ` · ${plural(s.flaggedToday, "listing")} flagged today` : ""}</Text>
      <Check p={p} label="Every listing is live and visible" value={ticks.allVisible} onChange={set("allVisible")} />
      <Check p={p} label="No bad review is left without a reply" value={ticks.reviewsHandled} onChange={set("reviewsHandled")} />
      <Check p={p} label="Any suspension has been dealt with" value={ticks.suspensionsHandled} onChange={set("suspensionsHandled")} />
      <Check p={p} label="Re-listings due are done or under way" value={ticks.relistingsDone} onChange={set("relistingsDone")} />
      {(s.openRelistings > 0 || all) && <Field label={s.openRelistings > 0 ? "Where the open re-listings are up to" : "Anything to hand over (optional)"} value={note} onChange={setNote} p={p} multiline />}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Signing off…" : "Sign off today"} icon="check" primary p={p} disabled={busy} onPress={() => void sign()} />
    </View></Anchor>
  );
}
