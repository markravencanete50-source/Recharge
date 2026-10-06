import { Text } from "./Typography";
import { View, ScrollView } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { DepartmentArtwork } from "./Artwork";
import { Entrance, MotionPress as Pressable } from "./motion";
import { departmentColor, ui, type Palette } from "./theme";
import { toolsFor, type ModuleId, type WorkspaceRole } from "./model";
import { WORKSPACE_MAP, type DepartmentTone } from "../../lib/workspace-map";

export const DEPARTMENTS: {
  id: DepartmentTone;
  name: string;
  detail: string;
  art: ModuleId;
}[] = [
  {
    id: "stays",
    name: "Stays",
    detail: "Property operations",
    art: "property-database",
  },
  {
    id: "ready",
    name: "Ready",
    detail: "Maintenance and setup",
    art: "maintenance-reporting",
  },
  {
    id: "cleans",
    name: "Cleans",
    detail: "Cleaning and standards",
    art: "clean-reporting",
  },
  {
    id: "clients",
    name: "Clients",
    detail: "Owners and onboarding",
    art: "property-onboarding",
  },
  {
    id: "accounts",
    name: "Accounts",
    detail: "Invoices and finance",
    art: "owner-statements",
  },
];
export function DepartmentGrid({
  role,
  palette: p,
  onSelect,
  compact = false,
}: {
  role: WorkspaceRole;
  palette: Palette;
  onSelect: (department: string) => void;
  compact?: boolean;
}) {
  const tools = toolsFor(role);
  const departments = DEPARTMENTS.filter((department) =>
    tools.some((tool) => WORKSPACE_MAP[tool.id].tone === department.id),
  );
  if (compact)
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 16, paddingVertical: 2 }}
      >
        {departments.map((department) => (
          <Pressable
            key={department.id}
            accessibilityRole="button"
            accessibilityLabel={`Open ${department.name} department`}
            onPress={() => onSelect(department.id)}
            style={{
              width: 65,
              gap: 9,
              alignItems: "center",
              paddingVertical: 4,
            }}
          >
            <DepartmentArtwork
              department={department.id}
              size={52}
              palette={p}
            />
            <Text style={{ color: p.text, fontSize: 12, fontWeight: "500" }}>
              {department.name}
            </Text>
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Browse all tools"
          onPress={() => onSelect("All")}
          style={{
            width: 65,
            gap: 9,
            alignItems: "center",
            paddingVertical: 4,
          }}
        >
          <View
            style={{
              width: 52,
              height: 52,
              backgroundColor: p.wash,
              borderRadius: 16,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Feather name="grid" size={24} color={p.primary} />
          </View>
          <Text style={{ color: p.text, fontSize: 12, fontWeight: "500" }}>
            All tools
          </Text>
        </Pressable>
      </ScrollView>
    );
  return (
    <View style={{ gap: 18 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Browse all tools"
        onPress={() => onSelect("All")}
        style={[
          ui.between,
          { padding: 18, borderRadius: 20, backgroundColor: p.wash, gap: 12 },
        ]}
      >
        <View style={[ui.row, { gap: 14, flex: 1 }]}>
          <Feather name="grid" size={26} color={p.primary} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={{ color: p.text, fontSize: 17, fontWeight: "600" }}>
              Explore all tools
            </Text>
            <Text style={[ui.small, { color: p.muted }]}>
              {tools.length} features within your access
            </Text>
          </View>
        </View>
        <Feather name="arrow-right" size={20} color={p.primary} />
      </Pressable>
      <View
        style={[
          ui.card,
          {
            paddingVertical: 0,
            backgroundColor: p.surface,
            borderColor: p.border,
          },
        ]}
      >
        {departments.map((department, index) => {
          const count = tools.filter(
            (tool) => WORKSPACE_MAP[tool.id].tone === department.id,
          ).length;
          const tone = departmentColor(department.id, p);
          return (
            <Entrance key={department.id} delay={index * 30}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open ${department.name} department, ${count} tools`}
                onPress={() => onSelect(department.id)}
                style={[
                  ui.row,
                  {
                    gap: 14,
                    paddingVertical: 17,
                    borderBottomWidth: index < departments.length - 1 ? 1 : 0,
                    borderColor: p.border,
                  },
                ]}
              >
                <DepartmentArtwork
                  department={department.id}
                  size={48}
                  palette={p}
                />
                <View style={{ flex: 1, gap: 3 }}>
                  <Text
                    style={{ color: p.text, fontSize: 17, fontWeight: "600" }}
                  >
                    {department.name}
                  </Text>
                  <Text style={[ui.small, { color: p.muted }]}>
                    {department.detail}
                  </Text>
                </View>
                <View style={{ gap: 7, alignItems: "flex-end" }}>
                  <Text
                    style={{ color: tone.ink, fontSize: 12, fontWeight: "500" }}
                  >
                    {count} tools
                  </Text>
                  <Feather name="chevron-right" size={17} color={p.muted} />
                </View>
              </Pressable>
            </Entrance>
          );
        })}
      </View>
    </View>
  );
}
