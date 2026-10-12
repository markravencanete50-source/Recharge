import { useState, type ReactNode } from "react";
import { Platform, View, useWindowDimensions } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { ExpandChevron, GrowBar, MotionPress } from "./motion";
import { Sheet } from "./TeamFlows";
import { Button, Loading, Notice, Tag } from "./LiveKit";
import { SoftButton } from "./LivePages";
import { cellText, SheetTable, type Column } from "./SheetTable";
import { ListSearchBox, useListSearch } from "./SearchPicker";
import { WorkHistory } from "./WorkHistory";
import { ui, type Palette } from "./theme";
import { updateStamp, type TrackerItem, type TrackerStep } from "../../lib/tracker";
import type { WorkflowForm } from "../../lib/workflow-forms";

// The shared tracker: one row, one list and one detail sheet for every section that follows an item
// through steps (purchase orders, licensing, later onboarding). Sections build TrackerItems
// (lib/tracker.ts); nothing here knows what a purchase or a licence is.
// `owner` is true for client viewers: they read "Recharge" where staff read a name.
const DESKTOP = 1024;
const small = (p: Palette, extra = {}) => [ui.small, { color: p.muted }, extra];

// "3 of 5 steps" under a thin solid bar. Inside a pressable row it is decorative: the row's own label says it.
export function TrackerProgress({ p, progress, compact = false, decorative = false }: { p: Palette; progress: TrackerItem["progress"]; compact?: boolean; decorative?: boolean }) {
  if (!progress) return null;
  const { done, total } = progress, words = `${done} of ${total}${compact ? "" : total === 1 ? " step" : " steps"}`;
  return (
    <View {...(decorative ? { accessibilityElementsHidden: true, importantForAccessibility: "no-hide-descendants" as const } : { accessible: true, accessibilityRole: "progressbar" as const, accessibilityLabel: `${done} of ${total} steps`, accessibilityValue: { min: 0, max: total, now: done } })}
      style={[ui.row, { gap: 10, minWidth: 0 }]}>
      <GrowBar share={total ? done / total : 0} color={p.primary} track={p.elevated} height={8} />
      <Text style={[ui.small, { color: p.muted, fontVariant: ["tabular-nums"] }]}>{words}</Text>
    </View>
  );
}

// What happens next, in the colour that says whether this person can do it.
function NextAction({ p, item }: { p: Palette; item: TrackerItem }) {
  const a = item.nextAction;
  if (!a) return null;
  return <Text numberOfLines={2} style={[ui.small, { color: a.actionKey ? p.primary : p.muted, fontWeight: "600" }]}>{a.label}</Text>;
}

const labelOf = (item: TrackerItem, stamp: string) => [
  item.address, item.title !== item.address ? item.title : "", item.status.label,
  item.closed ? "" : "Next: " + item.nextStep, item.nextAction?.label ?? "", (item.lastUpdate ? "Updated " : "") + stamp,
  item.progress ? `${item.progress.done} of ${item.progress.total} steps` : "",
].filter(Boolean).join(", ");

// One item as a phone card: where, what, how it stands, what is next and when it last moved.
export function TrackerRow({ p, item, onOpen, compact = false, owner = false, first = true }: { p: Palette; item: TrackerItem; onOpen: (item: TrackerItem) => void; compact?: boolean; owner?: boolean; first?: boolean }) {
  const stamp = updateStamp(item.lastUpdate, new Date(), owner);
  return (
    <MotionPress {...(Platform.OS === "web" ? { dataSet: { hover: "row" } } : {})} accessibilityRole="button" accessibilityLabel={labelOf(item, stamp)} onPress={() => onOpen(item)}
      style={[ui.row, { gap: 12, alignItems: "flex-start", paddingVertical: compact ? 10 : 14, borderTopWidth: first ? 0 : 1, borderTopColor: p.border }]}>
      <View style={{ flex: 1, minWidth: 0, gap: compact ? 4 : 6 }}>
        <View style={[ui.row, { gap: 10, alignItems: "flex-start" }]}>
          <Text numberOfLines={compact ? 1 : 2} style={{ flex: 1, minWidth: 0, color: p.text, fontSize: 15, lineHeight: 21, fontWeight: "600" }}>{item.address}</Text>
          <Tag label={item.status.label} tone={item.status.tone} p={p} />
        </View>
        {item.title !== item.address && <Text numberOfLines={1} style={{ color: p.text, fontSize: 14, lineHeight: 20 }}>{item.title}</Text>}
        {!item.closed && <Text numberOfLines={2} style={small(p)}>Next: {item.nextStep}</Text>}
        <NextAction p={p} item={item} />
        <Text numberOfLines={1} style={small(p, { fontVariant: ["tabular-nums"] })}>{stamp}</Text>
        {!compact && <TrackerProgress p={p} progress={item.progress} decorative />}
      </View>
      <Feather name="chevron-right" size={18} color={p.muted} style={{ alignSelf: "center" }} />
    </MotionPress>
  );
}

function columnsFor(p: Palette, owner: boolean): Column<TrackerItem>[] {
  const now = new Date();
  return [
    { label: "Property", width: 280, cell: i => <View style={{ gap: 2 }}><Text numberOfLines={2} style={{ color: p.text, fontWeight: "600" }}>{i.address}</Text>{i.title !== i.address && <Text numberOfLines={1} style={small(p)}>{i.title}</Text>}</View> },
    { label: "Status", width: 150, cell: i => <Tag label={i.status.label} tone={i.status.tone} p={p} /> },
    { label: "Next step", width: 190, cell: i => cellText(p, i.closed ? "" : i.nextStep) },
    { label: "Next action", width: 200, cell: i => i.nextAction ? <NextAction p={p} item={i} /> : cellText(p, "") },
    { label: "Last update", width: 210, cell: i => cellText(p, updateStamp(i.lastUpdate, now, owner)) },
    { label: "Progress", width: 150, cell: i => i.progress ? <TrackerProgress p={p} progress={i.progress} compact decorative /> : cellText(p, "") },
  ];
}

// The items as a table on a wide screen and as cards on a phone. One search box over everything
// once the list is long; finished items fold away under "Done".
export function TrackerList({ p, items, onOpen, empty, loading = false, error = "", layout = "auto", groups = true, owner = false }: {
  p: Palette; items: TrackerItem[]; onOpen: (item: TrackerItem) => void; empty: string; loading?: boolean; error?: string;
  layout?: "auto" | "table" | "cards"; groups?: boolean; owner?: boolean;
}) {
  const { width } = useWindowDimensions();
  const [doneOpen, setDoneOpen] = useState(false);
  const search = useListSearch(items, i => i.search);
  const table = layout === "table" || (layout === "auto" && width >= DESKTOP);
  const shown = [...search.shown], open = groups ? shown.filter(i => !i.closed) : shown, done = groups ? shown.filter(i => i.closed) : [];
  const doneShown = doneOpen || !!search.query.trim();
  const draw = (rows: TrackerItem[]) => table
    ? <SheetTable p={p} columns={columnsFor(p, owner)} rows={rows} keyOf={i => i.id} onRow={onOpen} labelOf={i => labelOf(i, updateStamp(i.lastUpdate, new Date(), owner))} empty={empty} search={false} />
    : <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, paddingVertical: 4, gap: 0 }]}>{rows.map((i, n) => <TrackerRow key={i.id} p={p} item={i} onOpen={onOpen} owner={owner} first={!n} />)}</View>;
  return (
    <View style={{ gap: 12 }}>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {loading && !items.length && <Loading p={p} />}
      {!loading && !error && !items.length && <Notice text={empty} p={p} />}
      {!!items.length && <ListSearchBox p={p} search={search} nouns="items" />}
      {!!open.length && draw(open)}
      {!!items.length && !search.missed && groups && !open.length && <Text style={small(p)}>Nothing is open at the moment.</Text>}
      {!!done.length && (
        <View style={{ gap: 10 }}>
          <MotionPress accessibilityRole="button" accessibilityState={{ expanded: doneShown }} accessibilityLabel={`Done, ${done.length}`} onPress={() => setDoneOpen(!doneOpen)} style={[ui.row, { gap: 6, minHeight: 44, alignSelf: "flex-start" }]}>
            <Text style={{ color: p.muted, fontSize: 13, fontWeight: "600" }}>Done · {done.length}</Text>
            <ExpandChevron open={doneShown} size={16} color={p.muted} />
          </MotionPress>
          {doneShown && draw(done)}
        </View>
      )}
    </View>
  );
}

const STEP_ICON = { done: "check-circle", current: "arrow-right-circle", todo: "circle", skipped: "minus-circle" } as const;
const STEP_WORDS = { done: "done", current: "next", todo: "not started", skipped: "skipped" } as const;

// The steps with the same icons the onboarding checklist uses, any sub-checks indented, and a
// Record button where this person can do that step.
export function TrackerChecklist({ p, steps, forms = [], onForm, skipKey }: { p: Palette; steps: TrackerStep[]; forms?: WorkflowForm[]; onForm?: (form: WorkflowForm) => void; skipKey?: string }) {
  return (
    <View style={{ gap: 12 }}>
      {steps.map(step => {
        const ink = step.state === "done" ? p.success : step.state === "current" ? p.primary : p.muted;
        const form = onForm && step.actionKey ? forms.find(f => f.key === step.actionKey && f.key !== skipKey && !f.unavailable) : undefined;
        return (
          <View key={step.key} style={{ gap: 6 }}>
            <View accessible accessibilityLabel={`${step.label}, ${STEP_WORDS[step.state]}${step.detail ? ", " + step.detail : ""}`} style={[ui.row, { gap: 10, alignItems: "flex-start" }]}>
              <Feather name={STEP_ICON[step.state]} size={18} color={ink} style={{ marginTop: 1 }} />
              <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                <Text style={{ color: step.state === "todo" || step.state === "skipped" ? p.muted : p.text, fontWeight: step.state === "current" ? "600" : "400" }}>{step.label}{step.state === "skipped" ? " · Skipped" : ""}</Text>
                {!!step.detail && <Text style={small(p)}>{step.detail}</Text>}
              </View>
            </View>
            {!!step.checks?.length && <View style={{ gap: 4, marginLeft: 28 }}>{step.checks.map(c => (
              <View key={c.key} accessible accessibilityLabel={`${c.label}, ${c.done ? "done" : "not done"}`} style={[ui.row, { gap: 8 }]}>
                <Feather name={c.done ? "check-square" : "square"} size={15} color={c.done ? p.success : p.muted} />
                <Text style={{ flex: 1, minWidth: 0, fontSize: 13, lineHeight: 19, color: c.done ? p.text : p.muted }}>{c.label}</Text>
              </View>
            ))}</View>}
            {!!form && <View style={{ marginLeft: 28 }}><SoftButton label={`Record: ${step.label}`} icon="arrow-right" palette={p} onPress={() => onForm?.(form)} /></View>}
          </View>
        );
      })}
    </View>
  );
}

const heading = (p: Palette) => ({ color: p.muted, fontSize: 12, fontWeight: "600" as const, textTransform: "uppercase" as const, letterSpacing: 1 });

// Everything about one item: where it stands, what is next, the steps, the facts, then whatever the
// caller adds (photos, favourite, access) and the history.
export function TrackerDetail({ p, item, forms = [], onForm, children, owner = false }: { p: Palette; item: TrackerItem; forms?: WorkflowForm[]; onForm?: (form: WorkflowForm) => void; children?: ReactNode; owner?: boolean }) {
  const next = onForm && item.nextAction?.actionKey ? forms.find(f => f.key === item.nextAction?.actionKey && !f.unavailable) : undefined;
  const recorded = new Set(item.steps.map(s => s.actionKey).filter(Boolean));
  const others = onForm ? forms.filter(f => f !== next && !(recorded.has(f.key) && !f.unavailable)) : [];
  const stamp = updateStamp(item.lastUpdate, new Date(), owner);
  return (
    <View style={{ gap: 18 }}>
      <View style={{ gap: 8 }}>
        <View style={[ui.row, { gap: 10, alignItems: "flex-start" }]}>
          <Text accessibilityRole="header" style={{ flex: 1, minWidth: 0, color: p.text, fontSize: 16, lineHeight: 22, fontWeight: "600" }}>{item.address}</Text>
          <Tag label={item.status.label} tone={item.status.tone} p={p} />
        </View>
        <TrackerProgress p={p} progress={item.progress} />
        <Text style={small(p, { fontVariant: ["tabular-nums"] })}>{item.lastUpdate ? "Updated " : ""}{stamp}{item.lastUpdate?.what && !owner ? " · " + item.lastUpdate.what : ""}</Text>
      </View>
      <View style={{ gap: 8, padding: 14, borderRadius: 14, backgroundColor: p.wash }}>
        <Text style={heading(p)}>{item.closed ? "Status" : "Next"}</Text>
        <Text style={{ color: p.text, fontSize: 15, lineHeight: 22, fontWeight: "600" }}>{item.nextStep}</Text>
        {next ? <Button label={next.title} primary p={p} onPress={() => onForm?.(next)} />
          : !!item.nextAction && <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>{item.nextAction.label}</Text>}
      </View>
      {!!item.steps.length && <View style={{ gap: 10 }}><Text accessibilityRole="header" style={heading(p)}>Steps</Text><TrackerChecklist p={p} steps={item.steps} forms={forms} onForm={onForm} skipKey={next?.key} /></View>}
      {item.details.map(d => (
        <View key={d.label} style={{ gap: 4 }}>
          <Text style={heading(p)}>{d.label}</Text>
          <Text selectable style={[ui.body, { color: d.tone === "bad" ? p.danger : d.tone === "good" ? p.success : p.text, fontWeight: d.tone ? "600" : "400" }]}>{d.value}</Text>
        </View>
      ))}
      {others.map(f => <SoftButton key={f.key} label={f.title} icon="arrow-right" palette={p} onPress={() => onForm?.(f)} />)}
      {children}
      {!!item.workId && <WorkHistory key={item.workId} p={p} workId={item.workId} version={item.version ?? 0} hideNames={owner} />}
    </View>
  );
}

// The same sheet on a phone and on a computer. Opening a form closes it first, so two sheets never stack.
export function TrackerDetailSheet({ p, item, forms = [], onForm, onClose, children, owner = false }: { p: Palette; item: TrackerItem | null; forms?: WorkflowForm[]; onForm?: (form: WorkflowForm) => void; onClose: () => void; children?: ReactNode; owner?: boolean }) {
  return (
    <Sheet palette={p} visible={!!item} onClose={onClose} title={item?.title ?? ""} icon="clipboard">
      {item && <TrackerDetail p={p} item={item} forms={forms} owner={owner} onForm={onForm && (f => { onClose(); onForm(f); })}>{children}</TrackerDetail>}
    </Sheet>
  );
}
