import { useMemo, useState, type ComponentProps } from "react";
import { Modal, Platform, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Feather from "@expo/vector-icons/Feather";
import { Artwork } from "./Artwork";
import { Entrance, MotionPress as Pressable, useReducedMotion } from "./motion";
import { departmentColor, ui, type Palette } from "./theme";
import { approvalItems, inboxFor, isComplete, isWaiting, propertiesFor, toolsFor, workFor, type PreviewRecord, type Tool, type WorkspaceRole, type WorkItem } from "./model";
import { calendarCells, WORKSPACE_MAP, type WorkspaceSection } from "../../lib/workspace-map";
import { presetPeriod } from "../../lib/analytics";

type IconName = ComponentProps<typeof Feather>["name"];
type Props = { section: WorkspaceSection; role: WorkspaceRole; palette: Palette; onNavigate: (section: WorkspaceSection) => void; onOpen: (tool: Tool, record?: PreviewRecord) => void; onProfile: () => void; savedCount: number };

function LinkRow({ title, subtitle, icon, palette: p, onPress }: { title: string; subtitle?: string; icon: IconName; palette: Palette; onPress: () => void }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={[ui.row, { gap: 14, minHeight: 68, paddingVertical: 12 }]}>
    <View style={{ backgroundColor: p.wash, width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" }}><Feather name={icon} size={20} color={p.primary} /></View>
    <View style={{ flex: 1, gap: 3 }}><Text style={{ color: p.text, fontSize: 16, fontWeight: "600" }}>{title}</Text>{subtitle ? <Text style={[ui.small, { color: p.muted }]}>{subtitle}</Text> : null}</View>
    <Feather name="chevron-right" size={18} color={p.muted} />
  </Pressable>;
}
export function WorkRow({ item, palette: p, onPress }: { item: WorkItem; palette: Palette; onPress: () => void }) {
  const tone = departmentColor(WORKSPACE_MAP[item.tool.id].tone, p);
  return <Pressable accessibilityRole="button" accessibilityLabel={`${item.record.title}, ${item.tool.name}, ${item.record.status.replaceAll("_", " ")}`} onPress={onPress} style={[ui.row, { gap: 12, paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: p.border }]}>
    <View style={{ backgroundColor: tone.wash, width: 44, height: 44, borderRadius: 14, justifyContent: "center", alignItems: "center" }}><Feather name={WORKSPACE_MAP[item.tool.id].icon as IconName} size={20} color={tone.ink} /></View>
    <View style={{ flex: 1, gap: 5 }}>
      <Text style={{ color: p.text, fontSize: 16, lineHeight: 22, fontWeight: "600" }}>{item.record.title}</Text>
      <Text style={[ui.small, { color: p.muted }]}>{item.tool.name}</Text>
      <Text style={[ui.small, { color: p.muted }]}>{item.record.date || "No date set"} · {item.record.status.replaceAll("_", " ")}</Text>
    </View>
    <Feather name="chevron-right" size={18} color={p.muted} />
  </Pressable>;
}
function Empty({ title, detail, palette: p, icon = "check-circle" }: { title: string; detail: string; palette: Palette; icon?: IconName }) {
  return <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, alignItems: "center", paddingVertical: 30 }]}>
    <View style={{ backgroundColor: p.wash, padding: 16, borderRadius: 20 }}><Feather name={icon} size={25} color={p.primary} /></View>
    <Text style={[ui.sectionTitle, { color: p.text, textAlign: "center" }]}>{title}</Text>
    <Text style={[ui.body, { color: p.muted, textAlign: "center" }]}>{detail}</Text>
  </View>;
}
function Chips({ values, selected, onSelect, palette: p }: { values: string[]; selected: string; onSelect: (value: string) => void; palette: Palette }) {
  return <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
    {values.map(value => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: selected === value }} onPress={() => onSelect(value)} style={[ui.button, { backgroundColor: selected === value ? p.primary : p.surface, borderWidth: 1, borderColor: p.border, paddingHorizontal: 16 }]}><Text style={[ui.buttonText, { color: selected === value ? p.onPrimary : p.text }]}>{value}</Text></Pressable>)}
  </ScrollView>;
}
function Calendar({ selected, onSelect, palette: p, items }: { selected: string; onSelect: (value: string) => void; palette: Palette; items: WorkItem[] }) {
  const { width } = useWindowDimensions();
  const [month, setMonth] = useState(selected.slice(0, 7));
  const moveMonth = (step: number) => {
    const date = new Date(`${month}-15T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + step);
    setMonth(date.toISOString().slice(0, 7));
  };
  const dates = new Set(items.map(item => item.record.date));
  return <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, paddingHorizontal: width < 350 ? 4 : 16, marginHorizontal: width < 350 ? -20 : 0 }]}>
    <View style={ui.between}>
      <Pressable accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => moveMonth(-1)} style={[ui.iconButton, { backgroundColor: p.wash }]}><Feather name="chevron-left" size={20} color={p.text} /></Pressable>
      <Text style={{ fontSize: 16, fontWeight: "600", color: p.text }}>{new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Next month" onPress={() => moveMonth(1)} style={[ui.iconButton, { backgroundColor: p.wash }]}><Feather name="chevron-right" size={20} color={p.text} /></Pressable>
    </View>
    <View style={ui.row}>{["M", "T", "W", "T", "F", "S", "S"].map((day, index) => <Text key={index} style={{ width: "14.2857%", textAlign: "center", fontSize: 13, color: p.muted, paddingVertical: 8 }}>{day}</Text>)}</View>
    <View style={{ flexDirection: "row", flexWrap: "wrap" }}>{calendarCells(month).map((day, index) => <View key={day || `blank-${index}`} style={{ width: "14.2857%", minHeight: 48 }}>
      {day ? <Pressable accessibilityRole="button" accessibilityLabel={`${day}${dates.has(day) ? ", has work" : ", no work"}`} accessibilityState={{ selected: selected === day }} onPress={() => onSelect(day)} style={{ flex: 1, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: selected === day ? p.primary : "transparent", gap: 3 }}><Text style={{ color: selected === day ? p.onPrimary : p.text, fontSize: 15, fontWeight: selected === day ? "700" : "400" }}>{Number(day.slice(-2))}</Text><View style={{ height: 4, width: 4, borderRadius: 2, backgroundColor: dates.has(day) ? selected === day ? p.onPrimary : p.primary : "transparent" }} /></Pressable> : null}
    </View>)}</View>
  </View>;
}

export function WorkspaceScreens({ section, role, palette: p, onNavigate, onOpen, onProfile, savedCount }: Props) {
  const items = useMemo(() => workFor(role), [role]);
  const properties = useMemo(() => propertiesFor(role), [role]);
  const [query, setQuery] = useState("");
  const [propertyQuery, setPropertyQuery] = useState("");
  const [filter, setFilter] = useState("Active");
  const [date, setDate] = useState(() => presetPeriod(1).from);
  const [view, setView] = useState("List");
  const [selectedProperty, setSelectedProperty] = useState<(typeof properties)[number] | null>(null);
  const [pendingTool, setPendingTool] = useState<Tool | null>(null);
  const openPropertyTool = (tool: Tool) => {
    if (Platform.OS === "ios") setPendingTool(tool);
    setSelectedProperty(null);
    if (Platform.OS !== "ios") onOpen(tool);
  };
  const reduced = useReducedMotion();
  const pending = items.filter(item => !isComplete(item.record.status));
  const waiting = pending.filter(item => isWaiting(item.record.status));
  const inbox = inboxFor(role);
  const card = { backgroundColor: p.surface, borderColor: p.border };
  const searchQuery = section === "properties" ? propertyQuery : query;
  const updateQuery = section === "properties" ? setPropertyQuery : setQuery;
  const openQueue = (status = "Active") => { setQuery(""); setFilter(status); setView("List"); onNavigate("work"); };
  const heading = (title: string, subtitle: string) => <View style={{ gap: 6 }}><Text accessibilityRole="header" style={[ui.title, { color: p.text }]}>{title}</Text><Text style={[ui.body, { color: p.muted }]}>{subtitle}</Text></View>;
  const search = (placeholder: string) => <View style={[ui.row, { borderRadius: 14, minHeight: 50, borderWidth: 1, borderColor: p.muted, paddingHorizontal: 14, backgroundColor: p.surface, gap: 10 }]}><Feather name="search" size={18} color={p.muted} /><TextInput accessibilityLabel={placeholder} placeholder={placeholder} placeholderTextColor={p.muted} value={searchQuery} onChangeText={updateQuery} autoCorrect={false} style={{ flex: 1, color: p.text, fontSize: 16, minHeight: 48 }} />{searchQuery ? <Pressable accessibilityLabel="Clear search" accessibilityRole="button" onPress={() => updateQuery("")} style={{ minHeight: 48, width: 40, alignItems: "center", justifyContent: "center" }}><Feather name="x" color={p.text} size={18} /></Pressable> : null}</View>;
  const openRow = (item: WorkItem) => <WorkRow key={`${item.tool.id}:${item.record.id}`} item={item} palette={p} onPress={() => onOpen(item.tool, item.record)} />;

  return <>
    {section === "home" ? <>
      {heading(role === "client" ? "Your properties, in focus." : role === "cleans" ? "Your day, ready." : "The work that matters.", role === "client" ? "Decisions, updates and progress in one place." : role === "cleans" ? "Your assigned jobs and next steps." : "A clear view of what needs attention.")}
      <Entrance style={[ui.card, { backgroundColor: p.primary, borderColor: p.primary, padding: 20 }]}>
        <View style={ui.between}><View style={{ flex: 1, gap: 8 }}><Text style={{ color: p.onPrimary, fontSize: 13, fontWeight: "600" }}>{role === "client" ? "PENDING DECISIONS" : "ACTIVE WORK"}</Text><Text style={{ color: p.onPrimary, fontSize: 36, fontWeight: "700" }}>{role === "client" ? approvalItems(role).length : pending.length}</Text></View><View style={{ width: 72, height: 72, borderRadius: 24, backgroundColor: p.background }}><Artwork id={role === "client" ? "client-purchase-order-quotes" : role === "cleans" ? "cleaning-schedule" : "new-property-inspection-board"} size={72} /></View></View>
        <Pressable accessibilityRole="button" onPress={() => role === "client" ? onNavigate("approvals") : openQueue()} style={[ui.between, { minHeight: 48, borderTopWidth: 1, borderColor: p.onPrimary, paddingTop: 10, gap: 10 }]}><Text style={{ color: p.onPrimary, fontSize: 16, fontWeight: "600", flex: 1 }}>{role === "client" ? "Review your approvals" : "Open your work queue"}</Text><Feather name="arrow-right" size={20} color={p.onPrimary} /></Pressable>
      </Entrance>
      <View style={[ui.row, { gap: 12 }]}>{[{ value: properties.length, label: role === "cleans" ? "Assigned properties" : "Properties", section: "properties" as const, icon: "home" as const }, { value: waiting.length, label: "Waiting", section: role === "client" ? "approvals" as const : "work" as const, icon: "clock" as const }].map(stat => <Pressable key={stat.label} accessibilityRole="button" onPress={() => stat.section === "work" ? openQueue("Waiting") : onNavigate(stat.section)} style={[ui.card, card, { flex: 1, padding: 15 }]}><Feather name={stat.icon} size={19} color={p.primary} /><Text style={{ color: p.text, fontSize: 27, fontWeight: "700" }}>{stat.value}</Text><Text style={[ui.small, { color: p.muted }]}>{stat.label}</Text></Pressable>)}</View>
      <View style={ui.between}><Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Next up</Text><Pressable accessibilityRole="button" accessibilityLabel="See all work" onPress={() => openQueue()} style={{ minHeight: 48, justifyContent: "center" }}><Text style={[ui.small, { color: p.primary, fontWeight: "600" }]}>See all</Text></Pressable></View>
      {pending.length ? <View style={[ui.card, card, { paddingVertical: 0 }]}>{pending.slice(0, 3).map(openRow)}</View> : <Empty title="Nothing waiting here" detail="There are no active sample tasks in your workspace." palette={p} />}
      <View style={[ui.card, card, { paddingVertical: 0 }]}><LinkRow title="Your reports" subtitle="Trends and progress within your access" icon="bar-chart-2" palette={p} onPress={() => onNavigate("analytics")} /><LinkRow title="All tools" subtitle={`${toolsFor(role).length} features in your workspace`} icon="grid" palette={p} onPress={() => onNavigate("workspace")} /></View>
    </> : null}

    {section === "work" || section === "calendar" ? <>
      {heading(role === "cleans" ? "Your jobs" : "Your work", "Find the next action, then keep things moving.")}
      {search("Search job or property titles")}
      <Chips values={["List", "Calendar"]} selected={section === "calendar" ? "Calendar" : view} onSelect={value => { setView(value); if (section === "calendar" && value === "List") onNavigate("work"); }} palette={p} />
      {section === "calendar" || view === "Calendar" ? <><Calendar selected={date} onSelect={setDate} items={items} palette={p} /><Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>{date}</Text></> : <Chips values={["Active", "Waiting", "Completed", "All"]} selected={filter} onSelect={setFilter} palette={p} />}
      {(() => {
        const results = items.filter(item => `${item.record.title} ${item.record.propertyName || ""}`.toLowerCase().includes(query.trim().toLowerCase()))
          .filter(item => section === "calendar" || view === "Calendar" ? item.record.date === date : filter === "All" || (filter === "Completed" ? isComplete(item.record.status) : filter === "Waiting" ? isWaiting(item.record.status) : !isComplete(item.record.status)));
        return <><Text accessibilityLiveRegion="polite" style={[ui.small, { color: p.muted }]}>{results.length} {results.length === 1 ? "item" : "items"}</Text>{results.length ? <View style={[ui.card, card, { paddingVertical: 0 }]}>{results.map(openRow)}</View> : <Empty title="No work in this view" detail="Try another status, search or calendar date." palette={p} />}</>;
      })()}
    </> : null}

    {section === "properties" ? <>
      {heading(role === "client" ? "Your properties" : role === "cleans" ? "Assigned properties" : "Properties", "One place for the details and work you can access.")}
      {search("Search property names")}
      {properties.filter(property => property.propertyName.toLowerCase().includes(propertyQuery.trim().toLowerCase())).map((property, index) => <Entrance key={property.id} delay={index * 40}><Pressable accessibilityRole="button" accessibilityLabel={`Open ${property.propertyName}`} onPress={() => setSelectedProperty(property)} style={[ui.card, card]}><View style={[ui.row, { gap: 14 }]}><View style={{ backgroundColor: departmentColor("stays", p).wash, borderRadius: 18 }}><Artwork id="property-database" size={62} /></View><View style={{ flex: 1, gap: 6 }}><Text style={{ color: p.text, fontSize: 18, lineHeight: 24, fontWeight: "700" }}>{property.propertyName}</Text><Text style={[ui.small, { color: p.muted }]}>{property.region}</Text></View></View><View style={[ui.between, { borderTopWidth: 1, borderColor: p.border, paddingTop: 12 }]}><Text style={[ui.small, { color: p.muted }]}>{property.bedrooms} bedrooms · {property.bathrooms} bathrooms</Text><Feather name="arrow-up-right" color={p.primary} size={20} /></View></Pressable></Entrance>)}
      {!properties.some(property => property.propertyName.toLowerCase().includes(propertyQuery.trim().toLowerCase())) ? <Empty title="No matching properties" detail="Your property list only includes your accessible sample records." palette={p} icon="home" /> : null}
    </> : null}

    {section === "approvals" ? <>{heading("Your approvals", "Review the decisions waiting for your attention.")}{approvalItems(role).length ? <View style={[ui.card, card, { paddingVertical: 0 }]}>{approvalItems(role).map(openRow)}</View> : <Empty title="You're up to date" detail="There are no sample quotes or approvals waiting for you." palette={p} />}<LinkRow title="Purchase Order Quotes" subtitle="View the quote workflow" icon="file-text" palette={p} onPress={() => { const tool = toolsFor(role).find(tool => tool.id === "client-purchase-order-quotes"); if (tool) onOpen(tool); }} /></> : null}

    {section === "inbox" ? <>{heading("Inbox", "Property mail and conversations within your access.")}{inbox.length ? <View style={[ui.card, card, { paddingVertical: 0 }]}>{inbox.map(openRow)}</View> : <Empty title="No sample messages" detail="Connected conversation channels will appear here when configured." palette={p} icon="message-circle" />}</> : null}

    {section === "more" ? <>{heading("Your workspace", "The right tools, without the clutter.")}<View style={[ui.card, card, { paddingVertical: 0 }]}><LinkRow title="All tools" subtitle={`${toolsFor(role).length} available features`} icon="grid" palette={p} onPress={() => onNavigate("workspace")} /><LinkRow title="Reports and analytics" subtitle="Choose dates and explore your progress" icon="bar-chart-2" palette={p} onPress={() => onNavigate("analytics")} /><LinkRow title="Calendar" subtitle="Your dated work and visits" icon="calendar" palette={p} onPress={() => onNavigate("calendar")} /><LinkRow title="Inbox" subtitle={`${inbox.length} sample ${inbox.length === 1 ? "conversation" : "items"}`} icon="message-circle" palette={p} onPress={() => onNavigate("inbox")} /><LinkRow title="Profile and preferences" subtitle="Your name, avatar and preview role" icon="user" palette={p} onPress={onProfile} /></View><View style={[ui.card, card]}><Text style={[ui.sectionTitle, { color: p.text }]}>Your saved tools</Text><Text style={[ui.body, { color: p.muted }]}>{savedCount ? `${savedCount} bookmarked features are ready in your tool directory.` : "Bookmark a feature in All tools to keep it close."}</Text></View></> : null}

    <Modal visible={Boolean(selectedProperty)} animationType={reduced ? "none" : "slide"} onRequestClose={() => setSelectedProperty(null)} onDismiss={() => { if (pendingTool) { setPendingTool(null); onOpen(pendingTool); } }}>
      <SafeAreaView style={[ui.fill, { backgroundColor: p.background }]}>
        <View style={[ui.row, { gap: 12, paddingHorizontal: 20, paddingVertical: 8, borderBottomWidth: 1, borderColor: p.border, backgroundColor: p.surface }]}><Pressable accessibilityRole="button" accessibilityLabel="Back to properties" onPress={() => setSelectedProperty(null)} style={[ui.iconButton, { backgroundColor: p.wash }]}><Feather name="arrow-left" size={22} color={p.text} /></Pressable><Text style={[ui.sectionTitle, { color: p.text, flex: 1 }]}>Property overview</Text></View>
        <ScrollView contentContainerStyle={ui.page}>{selectedProperty ? <>
          {heading(selectedProperty.propertyName, selectedProperty.region)}
          <View style={[ui.card, card]}><Text style={[ui.sectionTitle, { color: p.text }]}>Property details</Text><Text style={[ui.body, { color: p.muted }]}>{selectedProperty.propertyAddress}</Text><Text style={[ui.body, { color: p.text }]}>{selectedProperty.bedrooms} bedrooms · {selectedProperty.bathrooms} bathrooms</Text><Text style={[ui.small, { color: p.muted }]}>Status: {selectedProperty.status}</Text></View>
          <View style={[ui.card, card, { paddingVertical: 0 }]}><LinkRow title="Work for this property" subtitle={`${items.filter(item => item.record.propertyName === selectedProperty.propertyName).length} sample items`} icon="check-square" palette={p} onPress={() => { setQuery(selectedProperty.propertyName); setFilter("All"); setView("List"); setSelectedProperty(null); onNavigate("work"); }} /></View>
          <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Property tools</Text>
          <View style={[ui.card, card, { paddingVertical: 0 }]}>{toolsFor(role).filter(tool => ["properties", "onboarding", "maintenance", "purchase-order", "licensing", "external-calculator"].includes(WORKSPACE_MAP[tool.id].service)).map(tool => <LinkRow key={tool.id} title={tool.name} icon={WORKSPACE_MAP[tool.id].icon as IconName} palette={p} onPress={() => openPropertyTool(tool)} />)}</View>
          <Text style={[ui.small, { color: p.muted }]}>Sample property. Connected documents and financial records are not available in this preview.</Text>
        </> : null}</ScrollView>
      </SafeAreaView>
    </Modal>
  </>;
}
