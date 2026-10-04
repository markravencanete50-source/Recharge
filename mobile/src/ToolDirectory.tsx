import { Text, TextInput, View, ScrollView, Keyboard } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Artwork } from "./Artwork";
import { MotionPress as Pressable } from "./motion";
import { departmentColor, ui, type Palette } from "./theme";
import { filteredTools, toolsFor, type Tool, type WorkspaceRole } from "./model";
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
  const areas = ["All", ...new Set(tools.map(tool => WORKSPACE_MAP[tool.id].area))];
  const savedCount = tools.filter(tool => saved.includes(tool.id)).length;
  return <>
    <View style={{ gap: 5 }}><Text accessibilityRole="header" style={[ui.title, { color: p.text }]}>All tools</Text><Text style={[ui.body, { color: p.muted }]}>Every feature, easier to find.</Text></View>
    <View style={[ui.row, { backgroundColor: p.surface, borderWidth: 1, borderColor: p.muted, minHeight: 50, borderRadius: 14, paddingLeft: 14, gap: 10 }]}><Feather name="search" size={18} color={p.muted} /><TextInput accessibilityLabel="Search feature titles" placeholder="Search feature titles" placeholderTextColor={p.muted} value={query} onChangeText={onQuery} autoCorrect={false} returnKeyType="search" onSubmitEditing={() => Keyboard.dismiss()} style={{ color: p.text, fontSize: 16, flex: 1, minHeight: 48 }} />{query ? <Pressable accessibilityRole="button" accessibilityLabel="Clear feature search" onPress={() => onQuery("")} style={{ width: 48, height: 48, alignItems: "center", justifyContent: "center" }}><Feather name="x" size={18} color={p.text} /></Pressable> : <View style={{ width: 14 }} />}</View>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>{areas.map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: area === value }} onPress={() => onArea(value)} style={[ui.button, { backgroundColor: area === value ? p.primary : p.surface, borderWidth: 1, borderColor: p.border, paddingHorizontal: 14 }]}><Text style={[ui.buttonText, { color: area === value ? p.onPrimary : p.text }]}>{value}</Text></Pressable>)}</ScrollView>
    <View style={ui.between}><Text accessibilityLiveRegion="polite" style={[ui.small, { color: p.muted }]}>{results.length} of {tools.length} tools</Text><Pressable accessibilityRole="checkbox" accessibilityLabel={`Show saved tools, ${savedCount} available`} accessibilityState={{ checked: onlySaved }} onPress={onOnlySaved} style={[ui.row, { minHeight: 48, paddingHorizontal: 12, gap: 7, borderRadius: 12, backgroundColor: onlySaved ? p.wash : "transparent" }]}><Feather name="bookmark" size={16} color={p.primary} /><Text style={[ui.small, { color: p.text, fontWeight: "600" }]}>Saved {savedCount}</Text></Pressable></View>
    {storageError ? <Text accessibilityRole="alert" style={[ui.small, { color: p.text }]}>{storageError}</Text> : null}
    <View style={{ gap: 12 }}>{results.map(tool => {
      const tone = departmentColor(WORKSPACE_MAP[tool.id].tone, p);
      return <View key={tool.id} style={[ui.row, { backgroundColor: p.surface, borderColor: p.border, borderWidth: 1, borderRadius: 18, padding: 12, gap: 8 }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Open ${tool.name}`} onPress={() => onOpen(tool)} style={[ui.row, { flex: 1, gap: 12, minHeight: 76 }]}>
          <View style={{ backgroundColor: tone.wash, borderRadius: 16 }}><Artwork id={tool.id} size={58} /></View>
          <View style={{ flex: 1, gap: 7 }}><Text style={{ color: p.text, fontSize: 16, lineHeight: 22, fontWeight: "600" }}>{tool.name}</Text><Text style={{ color: tone.ink, fontSize: 12, fontWeight: "500" }}>{WORKSPACE_MAP[tool.id].area}</Text></View>
        </Pressable>
        <Pressable accessibilityRole="checkbox" accessibilityLabel={`Save ${tool.name}`} accessibilityState={{ checked: saved.includes(tool.id) }} onPress={() => onSave(tool.id)} style={[ui.iconButton, { width: 44, backgroundColor: saved.includes(tool.id) ? p.wash : p.surface }]}><Feather name={saved.includes(tool.id) ? "check" : "bookmark"} size={18} color={p.primary} /></Pressable>
      </View>;
    })}</View>
    {!results.length ? <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border }]}><Text style={[ui.sectionTitle, { color: p.text }]}>{onlySaved && !savedCount ? "Keep your go-to tools here" : "No matching tools"}</Text><Text style={[ui.body, { color: p.muted }]}>{onlySaved && !savedCount ? "Bookmark a feature to save it on this device." : "Try another feature title or workspace."}</Text><Pressable accessibilityRole="button" onPress={() => { onQuery(""); onArea("All"); if (onlySaved) onOnlySaved(); }} style={[ui.button, { backgroundColor: p.wash }]}><Text style={[ui.buttonText, { color: p.text }]}>Show all tools</Text></Pressable></View> : null}
  </>;
}
