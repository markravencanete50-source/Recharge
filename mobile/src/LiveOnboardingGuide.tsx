import { useState } from "react";
import { View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { ExpandChevron, MotionPress, SwapIn } from "./motion";
import { ui, type Palette } from "./theme";
import { IconChip, type IconName } from "./LiveKit";
import { EXTRAS, INSPECTION_CHECKS, OWNER_FAQ, PROCESS, SERVICES } from "../../lib/onboarding-content";
import { formatDay } from "../../lib/format";
import type { JourneyView } from "../../lib/workflow-forms";

// What the owner reads alongside their estimate: what Recharge does, the extras, how onboarding
// runs and the common questions. Plus the questions asked on this journey and the inspection result.
function Fold({ p, title, icon, open: start = false, children }: { p: Palette; title: string; icon: IconName; open?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(start);
  return (
    <View style={[ui.card, { backgroundColor: p.background, borderColor: p.border, gap: 10 }]}>
      <MotionPress accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(!open)} style={[ui.row, { gap: 12, minHeight: 40 }]}>
        <IconChip icon={icon} tone="clients" p={p} size={34} />
        <Text style={{ color: p.text, fontWeight: "700", flex: 1, fontSize: 15 }}>{title}</Text>
        <ExpandChevron open={open} size={18} color={p.muted} />
      </MotionPress>
      {open && <SwapIn swapKey={title} style={{ gap: 10 }}>{children}</SwapIn>}
    </View>
  );
}

export function EstimateGuide({ palette: p }: { palette: Palette }) {
  return (
    <View style={{ gap: 10 }}>
      <Fold p={p} title="What Recharge does" icon="star" open>
        {SERVICES.map(s => (
          <View key={s.title} style={[ui.row, { gap: 10, alignItems: "flex-start" }]}>
            <Feather name={s.icon as IconName} size={17} color={p.primary} style={{ marginTop: 2 }} />
            <View style={{ flex: 1, gap: 2 }}><Text style={{ color: p.text, fontWeight: "600" }}>{s.title}</Text><Text style={[ui.small, { color: p.muted }]}>{s.detail}</Text></View>
          </View>
        ))}
      </Fold>
      <Fold p={p} title="Extra services" icon="plus-circle">
        {EXTRAS.map(e => <View key={e.title} style={{ gap: 2 }}><Text style={{ color: p.text, fontWeight: "600" }}>{e.title}</Text><Text style={[ui.small, { color: p.muted }]}>{e.detail}</Text></View>)}
      </Fold>
      <Fold p={p} title="How onboarding works" icon="map">
        {PROCESS.map((s, i) => (
          <View key={s.step} style={[ui.row, { gap: 10, alignItems: "flex-start" }]}>
            <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: p.wash }}><Text style={{ color: p.primary, fontSize: 12, fontWeight: "700" }}>{i + 1}</Text></View>
            <View style={{ flex: 1, gap: 2 }}><Text style={{ color: p.text, fontWeight: "600" }}>{s.step}</Text><Text style={[ui.small, { color: p.muted }]}>{s.detail}</Text></View>
          </View>
        ))}
      </Fold>
      <Fold p={p} title="Questions owners ask" icon="help-circle">
        {OWNER_FAQ.map(f => <View key={f.q} style={{ gap: 2 }}><Text style={{ color: p.text, fontWeight: "600" }}>{f.q}</Text><Text style={[ui.small, { color: p.muted }]}>{f.a}</Text></View>)}
      </Fold>
    </View>
  );
}

export function JourneyQuestions({ palette: p, j, owner }: { palette: Palette; j: JourneyView; owner: boolean }) {
  const questions = j.questions ?? [];
  if (!questions.length) return null;
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: p.text, fontWeight: "700" }}>Questions</Text>
      {questions.map(q => (
        <View key={q.id} style={{ gap: 6, padding: 12, borderRadius: 14, backgroundColor: p.background, borderWidth: 1, borderColor: p.border }}>
          <Text style={[ui.small, { color: p.muted }]}>{q.askedByOwner ? (owner ? "You asked" : "The owner asked") : "Recharge noted"} · {formatDay(q.askedAt)}</Text>
          <Text style={{ color: p.text, fontWeight: "600" }}>{q.question}</Text>
          {q.answer ? <View style={[ui.row, { gap: 8, alignItems: "flex-start" }]}><Feather name="corner-down-right" size={15} color={p.success} style={{ marginTop: 3 }} /><Text style={{ color: p.text, flex: 1 }}>{q.answer}</Text></View>
            : <Text style={[ui.small, { color: p.waiting, fontWeight: "600" }]}>Waiting for an answer</Text>}
        </View>
      ))}
    </View>
  );
}

export function InspectionResult({ palette: p, j }: { palette: Palette; j: JourneyView }) {
  const checks = j.inspectionChecks?.checks ?? {}, issues = j.inspectionChecks?.issues ?? "";
  const recorded = INSPECTION_CHECKS.filter(c => typeof checks[c.key] === "boolean");
  if (!recorded.length && !issues) return null;
  return (
    <View style={{ gap: 6 }}>
      {recorded.map(c => (
        <View key={c.key} style={[ui.row, { gap: 8 }]}>
          <Feather name={checks[c.key] ? "check-circle" : "x-circle"} size={16} color={checks[c.key] ? p.success : p.danger} />
          <Text style={{ color: p.text, flex: 1 }}>{c.label}</Text>
        </View>
      ))}
      {!!issues && <Text style={[ui.small, { color: p.text }]}>Issues found: {issues}</Text>}
    </View>
  );
}
