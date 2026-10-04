import { Text } from "./Typography";
import { TextInput, View, Keyboard } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Artwork } from "./Artwork";
import { Entrance, MotionPress as Pressable } from "./motion";
import { departmentColor, ui, type Palette } from "./theme";
import {
  filteredTools,
  toolsFor,
  type Tool,
  type WorkspaceRole,
} from "./model";
import { DEPARTMENTS } from "./DepartmentGrid";
import { WORKSPACE_MAP } from "../../lib/workspace-map";
import { FilterBar } from "./FilterBar";
import { StateGraphic } from "./StateGraphic";

type Props = {
  role: WorkspaceRole;
  palette: Palette;
  query: string;
  onQuery: (query: string) => void;
  area: string;
  onArea: (area: string) => void;
  saved: string[];
  onlySaved: boolean;
  onOnlySaved: () => void;
  onSave: (id: string) => void;
  onOpen: (tool: Tool) => void;
  storageError: string;
};
export function ToolDirectory({
  role,
  palette: p,
  query,
  onQuery,
  area,
  onArea,
  saved,
  onlySaved,
  onOnlySaved,
  onSave,
  onOpen,
  storageError,
}: Props) {
  const tools = toolsFor(role);
  const results = filteredTools(
    role,
    query,
    area,
    onlySaved ? saved : undefined,
  );
  const areas = [
    { id: "All", name: "All" },
    ...DEPARTMENTS.filter((department) =>
      tools.some((tool) => WORKSPACE_MAP[tool.id].tone === department.id),
    ),
  ];
  const savedCount = tools.filter((tool) => saved.includes(tool.id)).length;
  return (
    <>
      <View style={{ gap: 5 }}>
        <Text accessibilityRole="header" style={[ui.title, { color: p.text }]}>
          Find your tool.
        </Text>
        <Text style={[ui.body, { color: p.muted }]}>
          Every feature, organized around your work.
        </Text>
      </View>
      <View
        style={[
          ui.row,
          {
            backgroundColor: p.surface,
            borderWidth: 1,
            borderColor: p.border,
            minHeight: 52,
            borderRadius: 16,
            paddingLeft: 14,
            gap: 10,
          },
        ]}
      >
        <Feather name="search" size={18} color={p.muted} />
        <TextInput
          accessibilityLabel="Search feature titles"
          placeholder="Search feature titles"
          placeholderTextColor={p.muted}
          value={query}
          onChangeText={onQuery}
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={() => Keyboard.dismiss()}
          style={{
            color: p.text,
            fontSize: 15,
            fontFamily: "Inter_400Regular",
            flex: 1,
            minHeight: 50,
          }}
        />
        {query ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear feature search"
            onPress={() => onQuery("")}
            style={{
              width: 48,
              height: 48,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Feather name="x" size={18} color={p.text} />
          </Pressable>
        ) : (
          <View style={{ width: 14 }} />
        )}
      </View>
      <FilterBar
        values={areas.map((value) => value.name)}
        selected={areas.find((value) => value.id === area)?.name || "All"}
        onSelect={(name) =>
          onArea(areas.find((value) => value.name === name)?.id || "All")
        }
        palette={p}
      />
      <View style={ui.between}>
        <Text
          accessibilityLiveRegion="polite"
          style={[ui.small, { color: p.muted }]}
        >
          {results.length} of {tools.length} tools
        </Text>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityLabel={`Show saved tools, ${savedCount} available`}
          accessibilityState={{ checked: onlySaved }}
          onPress={onOnlySaved}
          style={[
            ui.row,
            {
              minHeight: 48,
              paddingHorizontal: 12,
              gap: 7,
              borderRadius: 14,
              backgroundColor: onlySaved ? p.wash : "transparent",
            },
          ]}
        >
          <Feather name="bookmark" size={16} color={p.primary} />
          <Text style={[ui.small, { color: p.primary, fontWeight: "600" }]}>
            Saved {savedCount}
          </Text>
        </Pressable>
      </View>
      {storageError ? (
        <Text accessibilityRole="alert" style={[ui.small, { color: p.text }]}>
          {storageError}
        </Text>
      ) : null}
      {DEPARTMENTS.map((department) => {
        const departmentTools = results.filter(
          (tool) => WORKSPACE_MAP[tool.id].tone === department.id,
        );
        if (!departmentTools.length) return null;
        const tone = departmentColor(department.id, p);
        return (
          <View key={department.id} style={{ gap: 12 }}>
            <View style={ui.between}>
              <View style={[ui.row, { gap: 8 }]}>
                <View
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 4,
                    backgroundColor: tone.ink,
                  }}
                />
                <Text
                  accessibilityRole="header"
                  style={[ui.sectionTitle, { color: p.text }]}
                >
                  {department.name}
                </Text>
              </View>
              <Text style={[ui.small, { color: p.muted }]}>
                {departmentTools.length} tools
              </Text>
            </View>
            <Entrance
              trigger={`${query}:${area}:${onlySaved}`}
              style={[
                ui.card,
                {
                  paddingVertical: 0,
                  backgroundColor: p.surface,
                  borderColor: p.border,
                },
              ]}
            >
              {departmentTools.map((tool, index) => (
                <View
                  key={tool.id}
                  style={[
                    ui.row,
                    {
                      gap: 4,
                      borderBottomWidth:
                        index < departmentTools.length - 1 ? 1 : 0,
                      borderColor: p.border,
                    },
                  ]}
                >
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={"Open " + tool.name}
                    onPress={() => onOpen(tool)}
                    style={[
                      ui.row,
                      { flex: 1, gap: 12, paddingVertical: 16, minHeight: 80 },
                    ]}
                  >
                    <Artwork id={tool.id} size={42} palette={p} />
                    <Text
                      style={{
                        flex: 1,
                        color: p.text,
                        fontSize: 15,
                        lineHeight: 22,
                        fontWeight: "500",
                        letterSpacing: -0.2,
                      }}
                    >
                      {tool.name}
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="checkbox"
                    accessibilityLabel={"Save " + tool.name}
                    accessibilityState={{ checked: saved.includes(tool.id) }}
                    onPress={() => onSave(tool.id)}
                    style={{
                      width: 44,
                      height: 48,
                      borderRadius: 14,
                      backgroundColor: saved.includes(tool.id)
                        ? p.wash
                        : "transparent",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Feather
                      name={saved.includes(tool.id) ? "check" : "bookmark"}
                      size={18}
                      color={saved.includes(tool.id) ? p.primary : p.muted}
                    />
                  </Pressable>
                </View>
              ))}
            </Entrance>
          </View>
        );
      })}
      {!results.length ? (
        <View
          style={[
            ui.card,
            {
              backgroundColor: p.surface,
              borderColor: p.border,
              alignItems: "center",
              paddingVertical: 28,
            },
          ]}
        >
          <StateGraphic palette={p} icon={onlySaved ? "bookmark" : "search"} />
          <Text
            style={[ui.sectionTitle, { color: p.text, textAlign: "center" }]}
          >
            {onlySaved && !savedCount
              ? "Your favourites start here"
              : "No matching tools"}
          </Text>
          <Text style={[ui.body, { color: p.muted, textAlign: "center" }]}>
            {onlySaved && !savedCount
              ? "Bookmark a feature to save it on this device."
              : "Try another feature title or department."}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              onQuery("");
              onArea("All");
              if (onlySaved) onOnlySaved();
            }}
            style={[ui.button, { backgroundColor: p.wash }]}
          >
            <Text style={[ui.buttonText, { color: p.primary }]}>
              Show all tools
            </Text>
          </Pressable>
        </View>
      ) : null}
    </>
  );
}
