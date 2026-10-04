import { Text, TextInput, View, ScrollView, Keyboard, useWindowDimensions } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Artwork } from "./Artwork";
import { MotionPress as Pressable } from "./motion";
import { departmentColor, ui, type Palette } from "./theme";
import { filteredTools, toolsFor, type Tool, type WorkspaceRole } from "./model";
import { DEPARTMENTS } from "./DepartmentGrid";
import { WORKSPACE_MAP } from "../../lib/workspace-map";

type Props = {
  role: WorkspaceRole; palette: Palette; query: string; onQuery: (query: string) => void;
  area: string; onArea: (area: string) => void; saved: string[]; onlySaved: boolean;
  onOnlySaved: () => void; onSave: (id: string) => void; onOpen: (tool: Tool) => void;
  storageError: string;
};
export function ToolDirectory({ role, palette: p, query, onQuery, area, onArea, saved, onlySaved, onOnlySaved, onSave, onOpen, storageError }: Props) {
  const tools = toolsFor(role);
  const results = filteredTools(role, query, area, onlySaved ? saved : undefined);
  const { width } = useWindowDimensions();
  const columns = width >= 680 ? 3 : 2;
  const tileWidth = (Math.min(width, 760) - 44 - 12 * (columns - 1)) / columns;
  const areas = [{ id: "All", name: "All" }, ...DEPARTMENTS.filter(department => tools.some(tool => WORKSPACE_MAP[tool.id].tone === department.id))];
  const savedCount = tools.filter(tool => saved.includes(tool.id)).length;
  return <>
    <View style={{ gap: 5 }}><Text accessibilityRole="header" style={[ui.title, { color: p.text }]}>All tools</Text><Text style={[ui.body, { color: p.muted }]}>Organized by department. Ready when you are.</Text></View>
    <View style={[ui.row, { backgroundColor: p.surface, borderWidth: 1, borderColor: p.border, minHeight: 50, borderRadius: 14, paddingLeft: 14, gap: 10 }]}><Feather name="search" size={18} color={p.muted} /><TextInput accessibilityLabel="Search feature titles" placeholder="Search feature titles" placeholderTextColor={p.muted} value={query} onChangeText={onQuery} autoCorrect={false} returnKeyType="search" onSubmitEditing={() => Keyboard.dismiss()} style={{ color: p.text, fontSize: 16, flex: 1, minHeight: 48 }} />{query ? <Pressable accessibilityRole="button" accessibilityLabel="Clear feature search" onPress={() => onQuery("")} style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}><Feather name="x" size={18} color={p.text} /></Pressable> : <View style={{ width: 14 }} />}</View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>{areas.map(value => <Pressable key={value.id} accessibilityRole="button" accessibilityState={{ selected: area === value.id }} onPress={() => onArea(value.id)} style={[ui.button, { backgroundColor: area === value.id ? p.primary : p.surface, borderWidth: 1, borderColor: p.border, paddingHorizontal: 14 }]}><Text style={[ui.buttonText, { color: area === value.id ? p.onPrimary : p.text }]}>{value.name}</Text></Pressable>)}</ScrollView>
    <View style={ui.between}><Text accessibilityLiveRegion="polite" style={[ui.small, { color: p.muted }]}>{results.length} of {tools.length} tools</Text><Pressable accessibilityRole="checkbox" accessibilityLabel={`Show saved tools, ${savedCount} available`} accessibilityState={{ checked: onlySaved }} onPress={onOnlySaved} style={[ui.row, { minHeight: 48, paddingHorizontal: 12, gap: 7, borderRadius: 12, backgroundColor: onlySaved ? p.wash : "transparent" }]}><Feather name="bookmark" size={16} color={p.primary} /><Text style={[ui.small, { color: p.text, fontWeight: "600" }]}>Saved {savedCount}</Text></Pressable></View>
    {storageError ? <Text accessibilityRole="alert" style={[ui.small, { color: p.text }]}>{storageError}</Text> : null}
    {DEPARTMENTS.map(department => {
      const departmentTools = results.filter(tool => WORKSPACE_MAP[tool.id].tone === department.id);
      if (!departmentTools.length) return null;
      const tone = departmentColor(department.id, p);
      return <View key={department.id} style={{ gap: 14 }}><View style={ui.between}><View style={[ui.row, { gap: 8 }]}><View style={{ width: 6, height: 18, borderRadius: 3, backgroundColor: tone.ink }} /><Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>{department.name}</Text></View><Text style={[ui.small, { color: p.muted }]}>{departmentTools.length} tools</Text></View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>{departmentTools.map(tool => <View key={tool.id} style={{ width: tileWidth, borderRadius: 22, padding: 14, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface }}>
          <Pressable accessibilityRole="button" accessibilityLabel={"Open " + tool.name} onPress={() => onOpen(tool)} style={{ flex: 1, gap: 12, minHeight: 142 }}><View style={ui.between}><View style={{ borderRadius: 20, padding: 4, backgroundColor: tone.art }}><Artwork id={tool.id} size={64} /></View><Feather name="arrow-up-right" size={16} color={tone.ink} /></View><Text style={{ color: p.text, fontSize: 16, lineHeight: 22, fontWeight: "600", letterSpacing: -0.2 }}>{tool.name}</Text></Pressable>
          <View style={[ui.between, { borderTopWidth: 1, borderColor: p.border, marginTop: 12, gap: 6 }]}><Text style={{ fontSize: 12, lineHeight: 17, color: p.muted, flex: 1 }}>Open tool</Text><Pressable accessibilityRole="checkbox" accessibilityLabel={"Save " + tool.name} accessibilityState={{ checked: saved.includes(tool.id) }} onPress={() => onSave(tool.id)} style={{ width: 44, height: 48, alignItems: "center", justifyContent: "center" }}><Feather name={saved.includes(tool.id) ? "check" : "bookmark"} size={18} color={p.primary} /></Pressable></View>
        </View>)}</View>
      </View>;
    })}
    {!results.length ? <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border }]}><Text style={[ui.sectionTitle, { color: p.text }]}>{onlySaved && !savedCount ? "Keep your go-to tools here" : "No matching tools"}</Text><Text style={[ui.body, { color: p.muted }]}>{onlySaved && !savedCount ? "Bookmark a feature to save it on this device." : "Try another feature title or workspace."}</Text><Pressable accessibilityRole="button" onPress={() => { onQuery(""); onArea("All"); if (onlySaved) onOnlySaved(); }} style={[ui.button, { backgroundColor: p.wash }]}><Text style={[ui.buttonText, { color: p.text }]}>Show all tools</Text></Pressable></View> : null}
  </>;
}
