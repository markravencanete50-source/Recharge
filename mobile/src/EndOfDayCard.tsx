import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import { Text } from "./Typography";
import { SignOffCard } from "./SignOffCard";
import { readTeams } from "./backend/client";
import { ui, type Palette } from "./theme";
import { END_OF_DAY_POLL_MS, endOfDayOffered, endOfDayRole, londonHour } from "../../lib/end-of-day";
import { myShiftSchema } from "../../lib/management-live";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";

// Home, for Stays: "End of day" when nobody is clocked in. The reflection (which also counts as the sign-off)
// needs an open shift, so someone who did not clock in, or has already clocked out, signs the day off here
// with the same card as before. Nothing shows while a shift is open, once the day is signed off, or for
// roles that do not sign off.
export function EndOfDayCard({ palette: p, account }: { palette: Palette; account: WorkspaceAccount }) {
  const eligible = endOfDayRole(account.role);
  const [state, setState] = useState<{ open: boolean; shifts: number } | null>(null);
  const load = useCallback(async () => {
    try { const mine = myShiftSchema.parse((await readTeams({ section: "shift" })).data); setState({ open: !!mine.open, shifts: mine.today.length }); }
    catch { setState(null); }
  }, []);
  useEffect(() => {
    if (!eligible) return;
    let active = true;
    queueMicrotask(() => { if (active) void load(); });
    const timer = setInterval(() => { if (active) void load(); }, END_OF_DAY_POLL_MS);
    return () => { active = false; clearInterval(timer); };
  }, [eligible, load]);
  if (!eligible || !state || !endOfDayOffered({ role: account.role, openShift: state.open, shiftsToday: state.shifts, hour: londonHour() })) return null;
  return (
    <View style={{ gap: 8 }}>
      <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>End of day</Text>
      <Text style={[ui.small, { color: p.muted }]}>You are not clocked in, so there is no reflection to write. Sign off the day here instead.</Text>
      <SignOffCard p={p} quietWhenDone />
    </View>
  );
}
