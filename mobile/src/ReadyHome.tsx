import { useEffect, useState } from "react";
import { View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { Entrance, GrowBar, MotionPress, Stagger } from "./motion";
import { dayLabel, Loading, message, Notice, Tag } from "./LiveKit";
import { ui, type Palette } from "./theme";
import { readTeams } from "./backend/client";
import { monthLabel } from "../../lib/accounts-live";
import { readyHomeSchema, READY_STAGES, visitDone, visitSummary, type ReadyHome as ReadyHomeData } from "../../lib/repairs-live";
import { sectionAnchor, type HomeToolTarget } from "../../lib/home-tools";

// Ready's Home: the repairs at the properties they look after, by stage from Stays' referral to
// payment by Accounts, and this month's routine visits for each property (done and still due).
// Tapping a stage opens Work → Repairs on that stage.
const ACTS: string[] = ["referred", "booked"];
const STATUS: Record<string, [string, "good" | "wait" | "bad" | "plain"]> = { waiting: ["To do", "plain"], in_progress: ["In progress", "wait"], in_review: ["Done, to sign off", "good"], approved: ["Signed off", "good"], completed: ["Closed", "good"] };

export function ReadyHome({ palette: p, desktop, onTool }: { palette: Palette; desktop: boolean; onTool: (target: HomeToolTarget) => void }) {
  const [home, setHome] = useState<ReadyHomeData | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    queueMicrotask(() => void readTeams({ section: "readyHome" }).then(r => { if (active) setHome(readyHomeSchema.parse(r.data)); }).catch(e => { if (active) setError(message(e)); }));
    return () => { active = false; };
  }, []);
  const open = (sub: string) => onTool({ kind: "work", view: "repairs", sub, anchor: sectionAnchor("Reactive maintenance") });
  const total = home ? READY_STAGES.reduce((n, s) => n + (home.stages[s.phase] ?? 0), 0) : 0;
  return (
    <Entrance sessionKey="live:home:ready" style={{ gap: 20 }}>
      <View style={{ gap: 10 }}>
        <View style={ui.between}>
          <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Repairs in progress</Text>
          <MotionPress accessibilityRole="button" accessibilityLabel="Open all repairs" onPress={() => open("open")} style={{ minHeight: 44, justifyContent: "center", paddingLeft: 12 }}><Text style={[ui.small, { color: p.primary, fontWeight: "600" }]}>View all</Text></MotionPress>
        </View>
        {!home && !error && <Loading p={p} rows={2} />}
        {!!error && <Notice text={error} p={p} tone="bad" />}
        {home && <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {READY_STAGES.map((s, i) => {
              const n = home.stages[s.phase] ?? 0, yours = ACTS.includes(s.phase) && n > 0;
              return (
                <Stagger key={s.phase} index={i} style={{ flexGrow: 1, flexBasis: desktop ? 140 : 100, minWidth: 0 }}>
                  <MotionPress accessibilityRole="button" accessibilityLabel={`${s.label}: ${n}. ${s.detail}`} onPress={() => open(s.phase)}
                    style={{ minHeight: 92, padding: 12, gap: 4, borderRadius: 18, borderWidth: 1, borderColor: yours ? p.primary : p.border, backgroundColor: yours ? p.wash : p.surface }}>
                    <View style={[ui.between, { gap: 6 }]}>
                      <Text style={{ color: p.text, fontSize: 26, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{n}</Text>
                      {i < READY_STAGES.length - 1 ? <Feather name="arrow-right" size={14} color={p.muted} /> : <Feather name="check-circle" size={14} color={p.success} />}
                    </View>
                    <Text numberOfLines={1} style={{ color: p.text, fontWeight: "700", fontSize: 13 }}>{s.label}</Text>
                    <Text numberOfLines={2} style={{ color: p.muted, fontSize: 11, lineHeight: 15 }}>{s.phase === "paid" ? "This month" : s.detail}</Text>
                  </MotionPress>
                </Stagger>
              );
            })}
          </View>
          {!total && <Text style={[ui.small, { color: p.muted }]}>No repairs at your properties right now.</Text>}
        </>}
      </View>

      {home && <View style={{ gap: 10 }}>
        <View style={ui.between}>
          <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Preventative maintenance · {monthLabel(home.month)}</Text>
          <MotionPress accessibilityRole="button" accessibilityLabel="Open preventative maintenance" onPress={() => onTool({ kind: "work", view: "repairs", anchor: sectionAnchor("Preventative maintenance") })} style={{ minHeight: 44, justifyContent: "center", paddingLeft: 12 }}><Text style={[ui.small, { color: p.primary, fontWeight: "600" }]}>View all</Text></MotionPress>
        </View>
        {!home.visits.length && <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 10 }]}>
          <Text style={[ui.small, { color: p.muted }]}>No routine visits at your properties this month. Bins, garden and safety checks set up as a routine are created automatically each month.</Text>
          <MotionPress accessibilityRole="button" onPress={() => onTool({ kind: "work", view: "repairs", open: "new-routine" })} style={[ui.row, { gap: 8, minHeight: 44 }]}><Feather name="repeat" size={16} color={p.primary} /><Text style={{ color: p.primary, fontWeight: "700" }}>Add a routine</Text></MotionPress>
        </View>}
        <View style={{ flexDirection: desktop ? "row" : "column", flexWrap: "wrap", gap: 12 }}>
          {home.visits.map((prop, i) => {
            const sum = visitSummary(prop.items, home.today);
            return (
              <Stagger key={prop.propertyId} index={i} style={desktop ? { flexGrow: 1, flexBasis: 320, minWidth: 0 } : undefined}>
                <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 10 }]}>
                  <View style={[ui.between, { gap: 10 }]}>
                    <Text numberOfLines={1} style={{ color: p.text, fontSize: 15, fontWeight: "700", flex: 1 }}>{prop.propertyName}</Text>
                    {sum.overdue > 0 ? <Tag label={`${sum.overdue} overdue`} tone="bad" p={p} /> : <Tag label={prop.items.length ? `${sum.done} of ${prop.items.length} done` : "None this month"} tone={prop.items.length && sum.done === prop.items.length ? "good" : "plain"} p={p} />}
                  </View>
                  {!!prop.items.length && <View style={[ui.row, { gap: 10 }]}><GrowBar share={sum.done / prop.items.length} color={p.success} track={p.wash} height={8} /><Text style={[ui.small, { color: p.muted, fontVariant: ["tabular-nums"] }]}>{sum.due} due</Text></View>}
                  {prop.items.map(v => (
                    <MotionPress key={v.workId} accessibilityRole="button" accessibilityLabel={`${v.title}, ${STATUS[v.status]?.[0] ?? v.status}`} onPress={() => onTool({ kind: "work", view: "repairs", anchor: sectionAnchor("Preventative maintenance") })} style={[ui.row, { gap: 10, minHeight: 44 }]}>
                      <Feather name={visitDone(v.status) ? "check-circle" : "circle"} size={16} color={visitDone(v.status) ? p.success : !!v.dueOn && v.dueOn < home.today ? p.danger : p.muted} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text numberOfLines={1} style={{ color: p.text, fontWeight: "600" }}>{v.title}</Text>
                        <Text numberOfLines={1} style={[ui.small, { color: p.muted }]}>{[v.dueOn ? dayLabel(v.dueOn) : "No date", v.mine ? "You" : v.assigneeName].filter(Boolean).join(" · ")}</Text>
                      </View>
                      <Tag label={STATUS[v.status]?.[0] ?? v.status} tone={STATUS[v.status]?.[1] ?? "plain"} p={p} />
                    </MotionPress>
                  ))}
                </View>
              </Stagger>
            );
          })}
        </View>
      </View>}
    </Entrance>
  );
}
