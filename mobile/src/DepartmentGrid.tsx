import { Text, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Artwork } from "./Artwork";
import { Entrance, MotionPress as Pressable } from "./motion";
import { departmentColor, ui, type Palette } from "./theme";
import { toolsFor, type ModuleId, type WorkspaceRole } from "./model";
import { WORKSPACE_MAP, type DepartmentTone } from "../../lib/workspace-map";

export const DEPARTMENTS: { id: DepartmentTone; name: string; detail: string; art: ModuleId }[] = [
  { id: "stays", name: "Stays", detail: "Property operations", art: "property-database" },
  { id: "ready", name: "Ready", detail: "Maintenance & setup", art: "maintenance-reporting" },
  { id: "cleans", name: "Cleans", detail: "Cleaning & standards", art: "clean-reporting" },
  { id: "clients", name: "Clients", detail: "Owners & onboarding", art: "property-onboarding" },
  { id: "accounts", name: "Accounts", detail: "Invoices & finance", art: "owner-statements" },
];

export function DepartmentGrid({ role, palette: p, onSelect }: { role: WorkspaceRole; palette: Palette; onSelect: (department: string) => void }) {
  const tools = toolsFor(role);
  return <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
    {DEPARTMENTS.filter(department => tools.some(tool => WORKSPACE_MAP[tool.id].tone === department.id)).map((department, index) => {
      const tone = departmentColor(department.id, p);
      const count = tools.filter(tool => WORKSPACE_MAP[tool.id].tone === department.id).length;
      return <Entrance key={department.id} delay={index * 35} style={{ flexBasis: "46%", flexGrow: 1 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Open ${department.name} department, ${count} tools`} onPress={() => onSelect(department.id)} style={{ minHeight: 150, padding: 16, gap: 12, borderRadius: 24, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface }}>
          <View style={ui.between}><View style={{ backgroundColor: tone.wash, borderRadius: 16 }}><Artwork id={department.art} size={54} /></View><Feather name="arrow-up-right" size={17} color={p.muted} /></View>
          <View style={{ gap: 3 }}><Text style={{ color: p.text, fontSize: 19, fontWeight: "700", letterSpacing: -0.4 }}>{department.name}</Text><Text style={[ui.small, { color: p.muted }]}>{department.detail}</Text></View>
          <Text style={{ fontSize: 12, fontWeight: "600", color: tone.ink }}>{count} {count === 1 ? "tool" : "tools"}</Text>
        </Pressable>
      </Entrance>;
    })}
    <Pressable accessibilityRole="button" accessibilityLabel="Browse all tools" onPress={() => onSelect("All")} style={{ flexBasis: "46%", flexGrow: 1, minHeight: 150, padding: 16, gap: 12, borderRadius: 24, backgroundColor: p.wash, borderWidth: 1, borderColor: p.border }}>
      <View style={ui.between}><View style={{ width: 54, height: 54, borderRadius: 16, backgroundColor: p.surface, alignItems: "center", justifyContent: "center" }}><Feather name="grid" size={26} color={p.primary} /></View><Feather name="arrow-up-right" size={17} color={p.muted} /></View>
      <View style={{ gap: 3 }}><Text style={{ color: p.text, fontSize: 19, fontWeight: "700", letterSpacing: -0.4 }}>All tools</Text><Text style={[ui.small, { color: p.muted }]}>Your complete workspace</Text></View>
      <Text style={{ color: p.primary, fontSize: 12, fontWeight: "600" }}>{tools.length} available</Text>
    </Pressable>
  </View>;
}
