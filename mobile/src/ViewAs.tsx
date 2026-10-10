import { useEffect, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { Sheet } from "./TeamFlows";
import { MotionPress } from "./motion";
import { ui, type Palette } from "./theme";
import { readViewAsPeople, WorkspaceApiError } from "./backend/client";
import { viewAsGroups, viewAsKey, viewAsLabel, viewAsName, type ViewAs, type ViewAsPerson } from "../../lib/view-as";

// The super admin's "View as" picker: each role, with the people in it. Picking a person shows
// exactly what they see; a role nobody has yet can still be previewed with its screens and tools.
export function ViewAsSheet({ palette: p, visible, current, onClose, onChoose }: {
  palette: Palette; visible: boolean; current: ViewAs | null; onClose: () => void; onChoose: (view: ViewAs | null) => Promise<void>;
}) {
  const [people, setPeople] = useState<ViewAsPerson[] | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState("");
  useEffect(() => {
    if (!visible) return;
    let active = true;
    readViewAsPeople().then(list => { if (active) { setPeople(list); setError(""); } })
      .catch(e => { if (active) { setPeople(current => current ?? []); setError(e instanceof WorkspaceApiError ? e.message : "The list of people could not be loaded."); } });
    return () => { active = false; };
  }, [visible]);
  const choose = async (view: ViewAs | null) => {
    if (busy) return;
    if (viewAsKey(view) === viewAsKey(current)) { onClose(); return; }
    setBusy(viewAsKey(view)); setError("");
    try { await onChoose(view); onClose(); }
    catch (e) { setError(e instanceof WorkspaceApiError ? e.message : "That view could not be opened. Try again."); }
    finally { setBusy(""); }
  };
  const option = (view: ViewAs | null, label: string, detail: string, icon: "user" | "eye" | "layout") => {
    const key = viewAsKey(view), on = key === viewAsKey(current);
    return (
      <MotionPress key={key} accessibilityRole="radio" accessibilityState={{ selected: on, busy: busy === key }} accessibilityLabel={`${label}. ${detail}`} onPress={() => void choose(view)}
        style={[ui.row, { gap: 12, minHeight: 52, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 14, borderWidth: on ? 2 : 1, borderColor: on ? p.primary : p.border, backgroundColor: on ? p.wash : p.background }]}>
        <Feather name={icon} size={17} color={on ? p.primary : p.muted} />
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <Text numberOfLines={1} style={{ color: p.text, fontSize: 14, fontWeight: "700" }}>{label}</Text>
          <Text style={{ color: p.muted, fontSize: 12, lineHeight: 16 }}>{detail}</Text>
        </View>
        {busy === key ? <ActivityIndicator color={p.primary} /> : on ? <Feather name="check" size={18} color={p.primary} /> : null}
      </MotionPress>
    );
  };
  return (
    <Sheet palette={p} visible={visible} onClose={onClose} title="View as someone else" subtitle="See exactly what each person sees" icon="people">
      <Text style={[ui.small, { color: p.muted }]}>Pick a person to see the app exactly as they do: their Home, tools, properties, work and messages. Nothing can be changed while you look, private chats stay hidden, and each view is recorded in Access history.</Text>
      {!!error && <View accessibilityRole="alert" style={[ui.row, { gap: 10, padding: 12, borderRadius: 14, backgroundColor: p.cautionWash }]}><Feather name="alert-circle" size={16} color={p.waiting} /><Text style={[ui.small, { color: p.text, flex: 1 }]}>{error}</Text></View>}
      {option(null, "Myself", "Super admin, everything", "user")}
      {!people ? <View style={{ paddingVertical: 20, alignItems: "center" }}><ActivityIndicator accessibilityLabel="Loading people" color={p.primary} /></View> : viewAsGroups(people).map(group => (
        <View key={group.role} style={{ gap: 6 }}>
          <View style={[ui.row, { gap: 8, paddingTop: 6 }]}>
            <Text accessibilityRole="header" style={{ color: p.text, fontSize: 13, fontWeight: "800" }}>{group.label}</Text>
            <Text style={{ color: p.muted, fontSize: 12, flex: 1 }} numberOfLines={1}>{group.detail}</Text>
          </View>
          {group.people.map(person => option({ role: group.role, person: { userId: person.userId, fullName: person.fullName } }, person.fullName, `Exactly what ${person.fullName.split(" ")[0]} sees`, "eye"))}
          {option({ role: group.role, person: null }, group.people.length ? `${group.label} screens only` : "Nobody has this role yet",
            `Preview the ${group.label} menus, tools and records only, without your own${group.people.length ? "" : ". Add someone in People to see their exact view"}.`, "layout")}
        </View>
      ))}
    </Sheet>
  );
}

// Shown at the top of every page while viewing as someone else.
export function ViewAsBanner({ palette: p, view, note, onChange, onBack }: { palette: Palette; view: ViewAs; note?: string; onChange: () => void; onBack: () => void }) {
  return (
    <View accessibilityRole="alert" style={[ui.row, { gap: 12, padding: 12, paddingLeft: 14, borderRadius: 16, backgroundColor: p.header, flexWrap: "wrap" }]}>
      <Feather name="eye" size={18} color={p.headerText} />
      <View style={{ flex: 1, minWidth: 180, gap: 2 }}>
        <Text style={{ color: p.headerText, fontSize: 14, fontWeight: "700" }}>{view.person ? `Viewing as ${viewAsName(view)}` : `Previewing ${viewAsLabel(view.role)} screens`}</Text>
        <Text style={{ color: p.headerMuted, fontSize: 12, lineHeight: 17 }}>
          {view.person ? "Exactly what they see: their tools, properties, work and messages. Their private chats stay hidden, and nothing can be changed while you look around."
            : `Only the ${viewAsLabel(view.role)} menus, tools and records: work from the ${viewAsLabel(view.role)} tools, none of your own updates or favorites. Pick a person in this role to see exactly what they see. Nothing is saved while you look around.`}
          {note ? " " + note : ""}
        </Text>
      </View>
      <MotionPress accessibilityRole="button" onPress={onChange} style={{ minHeight: 40, justifyContent: "center", paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: p.headerBorder }}><Text style={{ color: p.headerText, fontSize: 13, fontWeight: "700" }}>Change</Text></MotionPress>
      <MotionPress accessibilityRole="button" onPress={onBack} style={{ minHeight: 40, justifyContent: "center", paddingHorizontal: 14, borderRadius: 999, backgroundColor: p.headerText }}><Text style={{ color: p.header, fontSize: 13, fontWeight: "700" }}>Back to my view</Text></MotionPress>
    </View>
  );
}
