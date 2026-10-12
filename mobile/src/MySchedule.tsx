import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { readTeams } from "./backend/client";
import { ui, type Palette } from "./theme";
import { rotaPlanSchema, type RotaPlan } from "../../lib/workspace-teams-policy";
import { ownEvents, scheduleDays, SHIFT_LABEL, type OwnEvent } from "../../lib/my-performance";
import { DEPARTMENT_LABEL } from "../../lib/management-live";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";

const DAYS = 7;
const londonToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
const addDays = (iso: string, n: number) => new Date(Date.parse(iso + "T12:00:00Z") + n * 86400000).toISOString().slice(0, 10);
const dayName = (iso: string, today: string) => iso === today ? "Today" : iso === addDays(today, 1) ? "Tomorrow" : new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const when = (e: OwnEvent) => e.startTime ? (e.endTime ? `${e.startTime} to ${e.endTime}` : e.startTime) : "All day";

// The person's own week ahead: the shifts they are rota'd on and their own absences, meetings and
// training. Both reads are optional: if either is missing or refused the card still shows the other.
export function MySchedule({ palette: p, account, onOpen }: { palette: Palette; account: WorkspaceAccount; onOpen?: () => void }) {
  const [plan, setPlan] = useState<RotaPlan | null>(null);
  const [events, setEvents] = useState<OwnEvent[]>([]);
  const [state, setState] = useState<"loading" | "ready">("loading");
  const today = londonToday();
  useEffect(() => {
    let active = true;
    const from = londonToday(), to = addDays(from, DAYS - 1);
    // The rota read and the team events read are independent, and the events read may not exist yet.
    const rota = readTeams({ section: "rotaPlan", from, to }).then(r => rotaPlanSchema.parse(r.data)).catch(() => null);
    const team = readTeams({ section: "teamEvents", from, to }).then(r => ownEvents(r.data, account.userId)).catch(() => [] as OwnEvent[]);
    void Promise.all([rota, team]).then(([nextPlan, nextEvents]) => { if (!active) return; setPlan(nextPlan); setEvents(nextEvents); setState("ready"); });
    return () => { active = false; };
  }, [account.userId]);
  const days = useMemo(() => scheduleDays(plan, events, account.userId, today, DAYS).filter(d => d.planned), [plan, events, account.userId, today]);
  return (
    <View testID="my-schedule" style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 10 }]}>
      <View style={[ui.between, { gap: 12 }]}>
        <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text, flexShrink: 1 }]}>My schedule</Text>
        {!!onOpen && <MotionPress accessibilityRole="button" accessibilityLabel="Open the calendar" onPress={onOpen} style={{ minHeight: 44, justifyContent: "center", paddingLeft: 12 }}><Text style={[ui.small, { color: p.primary, fontWeight: "600" }]}>Calendar</Text></MotionPress>}
      </View>
      {state === "loading" ? <Text style={[ui.small, { color: p.muted }]}>Loading your week…</Text>
        : !days.length ? <Text style={[ui.body, { color: p.muted }]}>Nothing planned for the next 7 days.</Text>
        : days.map((d, i) => (
          <View key={d.day} style={{ gap: 4, paddingTop: i ? 10 : 0, borderTopWidth: i ? 1 : 0, borderColor: p.border }}>
            <Text style={{ color: p.text, fontSize: 14, lineHeight: 20, fontWeight: "600" }}>{dayName(d.day, today)}</Text>
            {!!d.shift && d.shift !== "off" && (
              <View style={[ui.row, { gap: 8 }]}>
                <Feather name="clock" size={15} color={p.muted} />
                <Text style={[ui.small, { color: p.text, flex: 1 }]}>{SHIFT_LABEL[d.shift]} shift, {d.hours}{d.department ? ` · ${DEPARTMENT_LABEL[d.department] ?? d.department}` : ""}{d.note ? ` · ${d.note}` : ""}</Text>
              </View>
            )}
            {d.events.map(e => (
              <View key={e.id} style={[ui.row, { gap: 8 }]}>
                <Feather name="calendar" size={15} color={p.muted} />
                <Text style={[ui.small, { color: p.text, flex: 1 }]}>{e.title} · {when(e)}{e.location ? ` · ${e.location}` : ""}</Text>
              </View>
            ))}
          </View>
        ))}
    </View>
  );
}
