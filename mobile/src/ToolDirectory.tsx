import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Keyboard,
  Platform,
  ScrollView,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { Artwork, Glyph, DepartmentArtwork, FeatureTile } from "./Artwork";
import { MotionPress as Pressable, useReducedMotion } from "./motion";
import { departmentColor, ui, type Palette } from "./theme";
import { toolsFor, type Tool, type WorkspaceRole } from "./model";
import { DEPARTMENTS } from "./DepartmentGrid";
import {
  WORKSPACE_MAP,
  type WorkspaceSection,
  type DepartmentTone,
} from "../../lib/workspace-map";
import { findTools, titleParts, type FinderEntry } from "../../lib/tool-finder";
import { StateGraphic } from "./StateGraphic";
import { PinnedTools } from "./PinnedTools";
type Props = {
  role: WorkspaceRole;
  palette: Palette;
  query: string;
  onQuery: (value: string) => void;
  area: string;
  onArea: (value: string) => void;
  saved: string[];
  onlySaved: boolean;
  onOnlySaved: () => void;
  onSave: (id: string) => void;
  onMovePin: (id: string, target: number) => void;
  onOpen: (tool: Tool) => void;
  storageError: string;
  onNavigate: (section: WorkspaceSection) => void;
  onProfile: () => void;
  catalog?: FinderEntry<Tool>[];
};
const sectionMemory: Partial<Record<WorkspaceRole, string[]>> = {};
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
  onMovePin,
  onOpen,
  storageError,
  onNavigate,
  onProfile,
  catalog,
}: Props) {
  const { width } = useWindowDimensions();
  const desktop = width >= 1024;
  const reduced = useReducedMotion();
  const entries =
    catalog ||
    toolsFor(role).map((tool) => ({
      key: tool.id,
      name: tool.name,
      tone: WORKSPACE_MAP[tool.id].tone,
      tool,
    }));
  const results = findTools(entries, query, onlySaved ? saved : undefined);
  const departments = DEPARTMENTS.filter((d) =>
    entries.some((t) => t.tone === d.id),
  );
  const first = departments[0]?.id;
  const [open, setOpen] = useState<string[]>(() => {
    if (sectionMemory[role]) return sectionMemory[role];
    if (Platform.OS === "web") {
      try {
        const value = JSON.parse(
          sessionStorage.getItem(`recharge:preview:sections:${role}`) || "null",
        );
        if (Array.isArray(value))
          return value.filter((id) => departments.some((d) => d.id === id));
      } catch {
        /* Keep the finder usable when browser storage is unavailable. */
      }
    }
    return [first, ...(area !== "All" ? [area] : [])].filter(
      Boolean,
    ) as string[];
  });
  const [active, setActive] = useState(area === "All" ? "All" : area);
  const [hidden, setHidden] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const positions = useRef<Record<string, number>>({});
  const directoryY = useRef(0);
  const initialJump = useRef(area !== "All");
  const previous = useRef(0);
  const jumping = useRef(false);
  const [header] = useState(() => new Animated.Value(0));
  useEffect(() => {
    Animated.timing(header, {
      toValue: hidden ? 1 : 0,
      duration: reduced ? 0 : 180,
      useNativeDriver: Platform.OS !== "web",
    }).start();
    return () => header.stopAnimation();
  }, [hidden, reduced, header]);
  useEffect(() => {
    sectionMemory[role] = open;
    if (Platform.OS === "web") {
      try {
        sessionStorage.setItem(
          `recharge:preview:sections:${role}`,
          JSON.stringify(open),
        );
      } catch {
        /* The in-memory preference still lasts for this visit. */
      }
    }
  }, [open, role]);
  function changeOpen(next: string[]) {
    setOpen(next);
  }
  function jump(id: string) {
    setActive(id);
    onArea(id);
    setHidden(false);
    if (desktop) return;
    if (id === "All") {
      scroll.current?.scrollTo({ y: 0, animated: !reduced });
      return;
    }
    if (!open.includes(id)) changeOpen([...open, id]);
    jumping.current = true;
    requestAnimationFrame(() => {
      scroll.current?.scrollTo({
        y: Math.max(0, (positions.current[id] || 0) - 152),
        animated: !reduced,
      });
      setTimeout(
        () => {
          jumping.current = false;
        },
        reduced ? 0 : 600,
      );
    });
  }
  const count = (id: string) =>
    id === "All" ? results.length : results.filter((t) => t.tone === id).length;
  const chip = (id: string, name: string) => (
    <Pressable
      key={id}
      accessibilityRole="button"
      accessibilityLabel={`${name}, ${count(id)} tools`}
      accessibilityState={{ selected: active === id }}
      onPress={() => jump(id)}
      style={[
        ui.row,
        {
          gap: 8,
          minHeight: 44,
          paddingHorizontal: 14,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: active === id ? p.primary : p.border,
          backgroundColor: active === id ? p.wash : p.surface,
        },
      ]}
    >
      {id !== "All" && (
        <View
          style={{
            width: 6,
            height: 6,
            borderRadius: 3,
            backgroundColor: departmentColor(id as DepartmentTone, p).ink,
          }}
        />
      )}
      <Text
        style={{
          color: active === id ? p.primary : p.text,
          fontSize: 13,
          fontWeight: "500",
        }}
      >
        {name}
      </Text>
      <Text
        style={{ color: p.muted, fontSize: 12, fontVariant: ["tabular-nums"] }}
      >
        {count(id)}
      </Text>
    </Pressable>
  );
  const selected = active === "All" ? first : active;
  const row = (entry: FinderEntry<Tool>) => (
    <View
      key={entry.key}
      {...(desktop && Platform.OS === "web" ? { dataSet: { hover: "lift" } } : {})}
      style={[
        ui.row,
        {
          gap: 4,
          minHeight: 72,
          borderBottomWidth: desktop ? 0 : 1,
          borderColor: p.border,
          ...(desktop
            ? {
                width: "47%",
                flexGrow: 1,
                borderWidth: 1,
                borderRadius: 22,
                paddingHorizontal: 12,
                backgroundColor: p.surface,
              }
            : {}),
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={"Open " + entry.name}
        onPress={() => onOpen(entry.tool)}
        style={[
          ui.row,
          { flex: 1, minHeight: 72, gap: 12, paddingVertical: 12 },
        ]}
      >
        <Artwork id={entry.tool.id} size={40} palette={p} />
        <Text
          style={{
            flex: 1,
            color: p.text,
            fontSize: 15,
            lineHeight: 22,
            fontWeight: "500",
          }}
        >
          {titleParts(entry.name, query).map((part, i) => (
            <Text
              key={i}
              style={
                part.match
                  ? {
                      color: p.primary,
                      backgroundColor: p.wash,
                      fontWeight: "600",
                    }
                  : undefined
              }
            >
              {part.text}
            </Text>
          ))}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityLabel={"Save " + entry.name}
        accessibilityState={{ checked: saved.includes(entry.key) }}
        onPress={() => onSave(entry.key)}
        style={{
          width: 44,
          height: 48,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 14,
          backgroundColor: saved.includes(entry.key) ? p.wash : "transparent",
        }}
      >
        <Glyph
          name="bookmark"
          size={20}
          color={saved.includes(entry.key) ? p.primary : p.muted}
          filled={saved.includes(entry.key)}
        />
      </Pressable>
    </View>
  );
  const searchBar = (
    <Animated.View
      style={{
        gap: 12,
        paddingVertical: 12,
        backgroundColor: p.background,
        transform: [
          {
            translateY: header.interpolate({
              inputRange: [0, 1],
              outputRange: [0, -160],
            }),
          },
        ],
        opacity: header.interpolate({
          inputRange: [0, 0.75, 1],
          outputRange: [1, 1, 0],
        }),
      }}
      pointerEvents={hidden ? "none" : "auto"}
    >
      <View
        {...(Platform.OS==='web'?{dataSet:{searchShell:'true'}}:{})}
        style={[
          ui.row,
          {
            backgroundColor: p.surface,
            borderColor: p.controlBorder,
            borderWidth: 1,
            borderRadius: 16,
            minHeight: 52,
            paddingLeft: 16,
            gap: 12,
          },
        ]}
      >
        <Feather name="search" size={20} color={p.muted} />
        <TextInput
          accessibilityLabel="Search feature titles"
          placeholder="Search feature titles"
          placeholderTextColor={p.muted}
          value={query}
          onChangeText={(value) => {
            onQuery(value);
            setHidden(false);
          }}
          autoCorrect={false}
          returnKeyType="search"
          onSubmitEditing={() => Keyboard.dismiss()}
          style={{
            flex: 1,
            minHeight: 52,
            color: p.text,
            fontFamily: "Montserrat_400Regular",
            fontSize: 15,
          }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear feature search"
          disabled={!query}
          onPress={() => onQuery("")}
          style={{
            width: 48,
            height: 48,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {query ? <Feather name="x" size={18} color={p.muted} /> : null}
        </Pressable>
      </View>
      {!desktop && (
        <ScrollView
          horizontal
          keyboardShouldPersistTaps="handled"
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingVertical: 2 }}
        >
          {chip("All", "All")}
          {departments.map((d) => chip(d.id, d.name))}
        </ScrollView>
      )}
    </Animated.View>
  );
  return (
    <View style={[ui.fill, { flexDirection: desktop ? "row" : "column" }]}>
      {desktop && (
        <View
          style={{
            width: 232,
            padding: 24,
            gap: 12,
            borderRightWidth: 1,
            borderColor: p.border,
            backgroundColor: p.surface,
          }}
        >
          <Text style={[ui.sectionTitle, { color: p.text, marginBottom: 8 }]}>
            Departments
          </Text>
          {departments.map((d) => (
            <Pressable
              key={d.id}
              accessibilityRole="button"
              accessibilityLabel={`${d.name}, ${count(d.id)} tools`}
              accessibilityState={{ selected: selected === d.id }}
              onPress={() => jump(d.id)}
              style={[
                ui.row,
                {
                  gap: 12,
                  minHeight: 64,
                  paddingHorizontal: 12,
                  borderRadius: 16,
                  borderLeftWidth: 3,
                  borderLeftColor:
                    selected === d.id ? p.primary : "transparent",
                  backgroundColor: selected === d.id ? p.wash : p.surface,
                },
              ]}
            >
              <DepartmentArtwork department={d.id} size={40} palette={p} />
              <View style={{ flex: 1, gap: 4 }}>
                <Text
                  style={{ color: p.text, fontSize: 15, fontWeight: "500" }}
                >
                  {d.name}
                </Text>
                <Text style={[ui.small, { color: p.muted }]}>
                  {count(d.id)} tools
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}
      <ScrollView
        ref={scroll}
        testID="workspace-scroll"
        style={ui.fill}
        contentContainerStyle={{
          paddingHorizontal: desktop ? 32 : 20,
          paddingTop: 24,
          paddingBottom: 112,
          gap: 16,
        }}
        stickyHeaderIndices={desktop ? undefined : [1]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={Platform.OS === "web"}
        scrollEventThrottle={32}
        onScroll={(event) => {
          const y = event.nativeEvent.contentOffset.y;
          if (!desktop) {
            if (!jumping.current) {
              if (y < 40) setHidden(false);
              else if (Math.abs(y - previous.current) > 8)
                setHidden(y > previous.current);
            }
            if (!jumping.current) {
              const visible = departments
                .filter((d) => (positions.current[d.id] || Infinity) <= y + 180)
                .at(-1);
              if (visible) setActive(visible.id);
              else if (y < 200) setActive("All");
            }
          }
          previous.current = y;
        }}
      >
        <View style={{ gap: 8 }}>
          <Text
            accessibilityRole="header"
            style={[ui.title, { color: p.text }]}
          >
            Find your tool.
          </Text>
          <Text style={[ui.body, { color: p.muted }]}>
            A clear place for every part of your work.
          </Text>
        </View>
        {searchBar}
        <View style={ui.between}>
          <Text
            accessibilityLiveRegion="polite"
            style={[ui.small, { color: p.muted }]}
          >
            {results.length} of {entries.length} tools within your access
          </Text>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityLabel="Show saved tools"
            accessibilityState={{ checked: onlySaved }}
            onPress={onOnlySaved}
            style={[ui.row, { gap: 6, minHeight: 44, paddingHorizontal: 8 }]}
          >
            <Glyph
              name="bookmark"
              size={16}
              color={p.primary}
              filled={onlySaved}
            />
            <Text style={[ui.small, { color: p.primary }]}>
              Saved {entries.filter((t) => saved.includes(t.key)).length}
            </Text>
          </Pressable>
        </View>
        {storageError ? (
          <Text accessibilityRole="alert" style={[ui.small, { color: p.text }]}>
            {storageError}
          </Text>
        ) : null}
        {!query && !onlySaved && (
          <View style={{ gap: 12 }}>
            <View style={ui.between}>
              <Text
                accessibilityRole="header"
                style={[ui.sectionTitle, { color: p.text }]}
              >
                Pinned tools
              </Text>
              <Text style={[ui.small, { color: p.muted }]}>
                This session only
              </Text>
            </View>
            {entries.some((t) => saved.includes(t.key)) ? (
              <PinnedTools entries={entries} saved={saved} palette={p} onOpen={onOpen} onMove={onMovePin}/>
            ) : (
              <View
                style={[
                  ui.card,
                  {
                    backgroundColor: p.surface,
                    borderColor: p.border,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 16,
                  },
                ]}
              >
                <StateGraphic palette={p} icon="bookmark" />
                <View style={{ flex: 1, gap: 6 }}>
                  <Text style={[ui.sectionTitle, { color: p.text }]}>
                    Make it yours
                  </Text>
                  <Text style={[ui.small, { color: p.muted }]}>
                    Save a tool using its bookmark. Your shortcuts stay here for
                    this preview session.
                  </Text>
                </View>
              </View>
            )}
          </View>
        )}
        <View
          onLayout={(e) => {
            directoryY.current = e.nativeEvent.layout.y;
          }}
          style={{ gap: 12 }}
        >
          <View style={ui.between}>
            <Text
              accessibilityRole="header"
              style={[ui.sectionTitle, { color: p.text }]}
            >
              {desktop
                ? query
                  ? "Search results"
                  : onlySaved
                    ? "Saved tools"
                    : departments.find((d) => d.id === selected)?.name
                : "Your departments"}
            </Text>
            {!desktop && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  open.length === departments.length
                    ? "Collapse all departments"
                    : "Expand all departments"
                }
                onPress={() =>
                  changeOpen(
                    open.length === departments.length
                      ? []
                      : departments.map((d) => d.id),
                  )
                }
                style={{ minHeight: 44, justifyContent: "center" }}
              >
                <Text style={[ui.small, { color: p.primary }]}>
                  {open.length === departments.length
                    ? "Collapse all"
                    : "Expand all"}
                </Text>
              </Pressable>
            )}
          </View>
          {departments
            .filter(
              (d) => !desktop || !!query || onlySaved || d.id === selected,
            )
            .map((d) => {
              const rows = results.filter((t) => t.tone === d.id);
              if (!rows.length) return null;
              const expanded =
                desktop || !!query || onlySaved || open.includes(d.id);
              const c = departmentColor(d.id, p);
              return (
                <View
                  key={d.id}
                  onLayout={(e) => {
                    positions.current[d.id] =
                      directoryY.current + e.nativeEvent.layout.y;
                    if (initialJump.current && area === d.id) {
                      initialJump.current = false;
                      requestAnimationFrame(() => jump(d.id));
                    }
                  }}
                  style={{ gap: 12 }}
                  {...(Platform.OS === "web"
                    ? {
                        dataSet: {
                          toolSection: expanded ? "expanded" : "collapsed",
                        },
                      }
                    : {})}
                >
                  {desktop && (query || onlySaved) && (
                    <View style={ui.between}>
                      <Text style={[ui.sectionTitle, { color: p.text }]}>
                        {d.name}
                      </Text>
                      <Text style={[ui.small, { color: p.muted }]}>
                        {rows.length} tools
                      </Text>
                    </View>
                  )}
                  {!desktop && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ expanded }}
                      accessibilityLabel={`${d.name}, ${rows.length} tools, ${expanded ? "collapse" : "expand"}`}
                      onPress={() =>
                        changeOpen(
                          expanded
                            ? open.filter((id) => id !== d.id)
                            : [...open, d.id],
                        )
                      }
                      style={[
                        ui.row,
                        {
                          gap: 12,
                          minHeight: 76,
                          padding: 16,
                          borderRadius: 22,
                          borderWidth: 1,
                          borderColor: p.border,
                          backgroundColor: p.surface,
                        },
                      ]}
                    >
                      <View
                        style={{
                          height: 8,
                          width: 8,
                          borderRadius: 4,
                          backgroundColor: c.ink,
                        }}
                      />
                      <View style={{ flex: 1, gap: 5 }}>
                        <Text
                          style={{
                            color: p.text,
                            fontSize: 17,
                            fontWeight: "600",
                          }}
                        >
                          {d.name}
                        </Text>
                        <Text style={[ui.small, { color: p.muted }]}>
                          {d.detail}
                        </Text>
                      </View>
                      <Text style={[ui.small, { color: p.muted }]}>
                        {rows.length}
                      </Text>
                      <Feather
                        name={expanded ? "chevron-up" : "chevron-down"}
                        size={18}
                        color={p.muted}
                      />
                    </Pressable>
                  )}
                  {expanded && (
                    <View
                      style={
                        desktop
                          ? { flexDirection: "row", flexWrap: "wrap", gap: 16 }
                          : {
                              paddingHorizontal: 16,
                              borderWidth: 1,
                              borderRadius: 22,
                              borderColor: p.border,
                              backgroundColor: p.surface,
                            }
                      }
                    >
                      {rows.map(row)}
                    </View>
                  )}
                </View>
              );
            })}
          {!results.length && (
            <View
              style={[
                ui.card,
                {
                  backgroundColor: p.surface,
                  borderColor: p.border,
                  alignItems: "center",
                  paddingVertical: 32,
                },
              ]}
            >
              <StateGraphic palette={p} icon="search" />
              <Text style={[ui.sectionTitle, { color: p.text }]}>
                No tool matches.
              </Text>
              <Text style={[ui.body, { color: p.muted }]}>
                Try a shorter word.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  onQuery("");
                  if (onlySaved) onOnlySaved();
                  jump("All");
                }}
                style={[ui.button, { backgroundColor: p.wash }]}
              >
                <Text style={[ui.buttonText, { color: p.primary }]}>
                  Show all tools
                </Text>
              </Pressable>
            </View>
          )}
        </View>
        <View style={{ gap: 12 }}>
          <Text
            accessibilityRole="header"
            style={[ui.sectionTitle, { color: p.text }]}
          >
            Quick access
          </Text>
          <View
            style={[
              ui.card,
              {
                borderColor: p.border,
                backgroundColor: p.surface,
                paddingVertical: 4,
              },
            ]}
          >
            {[
              {name:"Help and FAQs",icon:"help-circle" as const,action:()=>onNavigate("help")},
              {name:"Recent activity",icon:"activity" as const,action:()=>onNavigate("activity")},
              {
                name: "Reports and analytics",
                icon: "bar-chart-2" as const,
                action: () => onNavigate("analytics"),
              },
              {
                name: "Calendar",
                icon: "calendar" as const,
                action: () => onNavigate("calendar"),
              },
              {
                name: "Inbox",
                icon: "message-circle" as const,
                action: () => onNavigate("inbox"),
              },
              {
                name: "Profile and preferences",
                icon: "user" as const,
                action: onProfile,
              },
            ].map((link) => (
              <Pressable
                key={link.name}
                accessibilityRole="button"
                onPress={link.action}
                style={[ui.row, { minHeight: 64, gap: 12 }]}
              >
                <FeatureTile icon={link.icon} size={40} palette={p} />
                <Text
                  style={{
                    flex: 1,
                    color: p.text,
                    fontSize: 15,
                    fontWeight: "500",
                  }}
                >
                  {link.name}
                </Text>
                <Feather name="chevron-right" size={18} color={p.muted} />
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
