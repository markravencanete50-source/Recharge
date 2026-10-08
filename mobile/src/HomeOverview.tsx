import { useEffect, useState } from "react";
import { ONBOARDING_STEPS, stageIndex, type ClientProperty } from "./clientPortfolio";
import { Animated, Easing, Modal, Platform, Pressable, ScrollView, TextInput, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import Svg, { Path } from "react-native-svg";
import { designTokens } from "../../lib/design-tokens";
import { DimensionalIcon, type DimensionalName } from "./DimensionalIcon";
import { HomeScene } from "./HomeScene";
import { CountUp, Entrance, MotionPress, useReducedMotion } from "./motion";
import { Text } from "./Typography";
import { ui, type Palette } from "./theme";

const hover = Platform.OS === "web" ? { dataSet: { hover: "lift" } } : {};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase() || "R";
}

// Mobile Home opens with the green bar flowing into a curved welcome panel,
// so the greeting, the person and their properties read as one moment.
export function WelcomeHeader({
  palette: p,
  name,
  dateLabel,
  subtitle,
  onCalendar,
}: {
  palette: Palette;
  name: string;
  dateLabel: string;
  subtitle: string;
  onCalendar: () => void;
}) {
  const reduced = useReducedMotion();
  const [float] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== "web" }),
        Animated.timing(float, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: Platform.OS !== "web" }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [float, reduced]);
  const t = designTokens[p.isDark ? "dark" : "light"];
  const bob = float.interpolate({ inputRange: [0, 1], outputRange: [0, -3] });
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  // Compact, so the person's tools sit in the first screen: greeting and date on one row,
  // one short line underneath, and the property pair tucked into the corner.
  return (
    <View testID="home-welcome" style={{ marginHorizontal: -20, marginTop: -24, backgroundColor: p.header, paddingHorizontal: 20, paddingTop: 6, paddingBottom: 34, overflow: "hidden" }}>
      <Animated.View pointerEvents="none" style={{ position: "absolute", right: -4, bottom: 12, transform: [{ translateY: bob }] }}>
        <HomeScene width={118} />
      </Animated.View>
      <View style={[ui.row, { gap: 12 }]}>
        <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: p.isDark ? "#1B3E38" : "#FAF7F0", alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#A7D9C1" }}>
          <Text style={{ color: p.isDark ? "#FAF7F0" : "#1F3D38", fontSize: 16, fontWeight: "700", letterSpacing: -0.3 }}>{initials(name)}</Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ color: p.headerMuted, fontSize: 13, fontWeight: "500" }}>{greeting},</Text>
          <Text accessibilityRole="header" numberOfLines={1} style={{ color: p.headerText, fontSize: 22, lineHeight: 28, fontWeight: "700", letterSpacing: -0.5 }}>{name.split(" ")[0]}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={"Open calendar, " + dateLabel}
          onPress={onCalendar}
          style={[ui.row, { minHeight: 36, gap: 6, paddingHorizontal: 11, borderRadius: 999, backgroundColor: p.headerControl, borderWidth: 1, borderColor: p.headerBorder }]}
        >
          <Feather name="calendar" size={13} color={p.headerText} />
          <Text style={{ color: p.headerText, fontSize: 13, fontWeight: "600" }}>{dateLabel}</Text>
        </Pressable>
      </View>
      <Text numberOfLines={2} style={{ color: p.headerMuted, fontSize: 13, lineHeight: 19, marginTop: 10, paddingRight: 116 }}>{subtitle}</Text>
      <Svg pointerEvents="none" width="100%" height={30} viewBox="0 0 390 30" preserveAspectRatio="none" style={{ position: "absolute", left: 0, right: 0, bottom: -1 }}>
        <Path d="M0 6 C 110 34, 250 32, 390 2 L390 30 L0 30 Z" fill={p.isDark ? "#2E6B5E" : "#A7D9C1"} opacity={0.35} />
        <Path d="M0 13 C 120 38, 260 35, 390 9 L390 30 L0 30 Z" fill={t.background} />
      </Svg>
    </View>
  );
}

export type OverviewItem = {
  key: string;
  icon: DimensionalName;
  value: number | null;
  prefix?: string;
  suffix?: string;
  label: string;
  hint: string;
  onPress: () => void;
};

export function QuickOverview({
  palette: p,
  items,
  sessionKey,
  onReports,
  columns = 2,
}: {
  palette: Palette;
  items: OverviewItem[];
  sessionKey: string;
  onReports: () => void;
  columns?: 2 | 4;
}) {
  const rows = columns === 4 ? [items] : [items.slice(0, 2), items.slice(2, 4)];
  return (
    <Entrance sessionKey={sessionKey} style={{ gap: 14, marginTop: -6 }}>
      <View style={ui.between}>
        <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Quick overview</Text>
        <MotionPress
          accessibilityRole="button"
          accessibilityLabel="Open reports"
          onPress={onReports}
          style={[ui.row, { gap: 8, minHeight: 44, paddingLeft: 6, paddingRight: 12, borderRadius: 999, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border }]}
        >
          <DimensionalIcon name="chart" size={32} />
          <Text style={{ color: p.text, fontSize: 12, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" }}>Reports</Text>
          <Feather name="chevron-right" size={16} color={p.muted} />
        </MotionPress>
      </View>
      {rows.map((row, r) => (
        <View key={r} style={{ flexDirection: "row", gap: 12 }}>
          {row.map(item => (
            <MotionPress
              key={item.key}
              {...hover}
              accessibilityRole="button"
              accessibilityLabel={`${item.prefix ?? ""}${item.value ?? "Unavailable"}${item.suffix ?? ""} ${item.label}. ${item.hint}`}
              onPress={item.onPress}
              style={{
                flex: 1,
                minWidth: 0,
                padding: 16,
                gap: 12,
                borderRadius: 24,
                backgroundColor: p.surface,
                borderWidth: 1,
                borderColor: p.border,
                ...(Platform.OS === "web" ? { boxShadow: "0 14px 30px -24px rgba(21, 45, 40, 0.45)" } : { elevation: 2 }),
              }}
            >
              <View style={[ui.between, { alignItems: "flex-start" }]}>
                <View style={{ width: 54, height: 54, borderRadius: 18, backgroundColor: p.wash, alignItems: "center", justifyContent: "center" }}>
                  <DimensionalIcon name={item.icon} size={42} />
                </View>
                <Feather name="chevron-right" size={18} color={p.muted} />
              </View>
              <View style={{ gap: 2 }}>
                <View style={[ui.row, { gap: 1, alignItems: "flex-end" }]}>
                  {!!item.prefix && item.value !== null && <Text style={{ color: p.text, fontSize: 18, lineHeight: 30, fontWeight: "700" }}>{item.prefix}</Text>}
                  {item.value === null ? (
                    <Text style={{ color: p.text, fontSize: 28, lineHeight: 34, fontWeight: "700" }}>—</Text>
                  ) : (
                    <CountUp value={item.value} sessionKey={sessionKey + ":" + item.key} style={{ color: p.text, fontSize: 28, lineHeight: 34, fontWeight: "700", letterSpacing: -1 }} />
                  )}
                  {!!item.suffix && item.value !== null && <Text style={{ color: p.text, fontSize: 18, lineHeight: 30, fontWeight: "700" }}>{item.suffix}</Text>}
                </View>
                <Text numberOfLines={1} style={{ color: p.muted, fontSize: 13, fontWeight: "500" }}>{item.label}</Text>
              </View>
            </MotionPress>
          ))}
        </View>
      ))}
    </Entrance>
  );
}

// Desktop: a small shortcut card under the side tiles, so the column ends on
// something useful instead of empty space.
export function JumpBackIn({ palette: p, links }: { palette: Palette; links: { key: string; icon: DimensionalName; title: string; detail: string; onPress: () => void }[] }) {
  return (
    <View style={{ flex: 1, minHeight: 0, padding: 22, gap: 6, borderRadius: 26, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface }}>
      <Text style={{ fontSize: 12, fontWeight: "600", letterSpacing: 1.2, textTransform: "uppercase", color: p.muted, marginBottom: 4 }}>Jump back in</Text>
      <View style={{ flex: 1, justifyContent: "space-around", gap: 4 }}>
        {links.map(link => (
          <MotionPress key={link.key} {...(Platform.OS === "web" ? { dataSet: { hover: "tint" } } : {})} accessibilityRole="button" accessibilityLabel={link.title + ". " + link.detail} onPress={link.onPress} style={[ui.row, { gap: 12, minHeight: 56, paddingHorizontal: 8, marginHorizontal: -8, borderRadius: 16 }]}>
            <View style={{ width: 46, height: 46, borderRadius: 15, backgroundColor: p.wash, alignItems: "center", justifyContent: "center" }}><DimensionalIcon name={link.icon} size={36} /></View>
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={{ color: p.text, fontSize: 14, fontWeight: "600" }}>{link.title}</Text>
              <Text numberOfLines={1} style={{ color: p.muted, fontSize: 12 }}>{link.detail}</Text>
            </View>
            <Feather name="chevron-right" size={17} color={p.muted} />
          </MotionPress>
        ))}
      </View>
    </View>
  );
}

// Client Home: where each property is in onboarding, with the next step.
export function ClientPropertyProgress({ palette: p, properties, onOpen, title = "Your properties", detail = "Where each property is, from enquiry to live" }: { palette: Palette; properties: ClientProperty[]; onOpen: () => void; title?: string; detail?: string }) {
  return (
    <Entrance sessionKey="client-home:properties" delay={40} style={{ gap: 12 }}>
      <View style={ui.between}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>{title}</Text>
          <Text style={[ui.small, { color: p.muted }]}>{detail}</Text>
        </View>
        <MotionPress accessibilityRole="button" onPress={onOpen} style={[ui.row, { gap: 4, minHeight: 44, paddingHorizontal: 6 }]}>
          <Text style={{ color: p.text, fontSize: 13, fontWeight: "700" }}>View all</Text>
          <Feather name="chevron-right" size={16} color={p.muted} />
        </MotionPress>
      </View>
      {properties.map(property => {
        const step = stageIndex(property.stage);
        const live = property.stage === "live";
        return (
          <MotionPress key={property.id} {...hover} accessibilityRole="button" accessibilityLabel={`${property.name}, ${ONBOARDING_STEPS[step].label}. ${property.nextStep}`} onPress={onOpen} style={{ padding: 16, gap: 12, borderRadius: 22, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border }}>
            <View style={[ui.row, { gap: 12 }]}>
              <View style={{ width: 48, height: 48, borderRadius: 16, backgroundColor: p.wash, alignItems: "center", justifyContent: "center" }}>
                <DimensionalIcon name={live ? "house" : "key"} size={38} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text numberOfLines={1} style={{ color: p.text, fontSize: 15, fontWeight: "600" }}>{property.name}</Text>
                <Text numberOfLines={1} style={[ui.small, { color: p.muted }]}>{property.region} · {property.bedrooms} bedrooms</Text>
              </View>
              <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, backgroundColor: live ? p.successWash : p.cautionWash }}>
                <Text style={{ color: p.text, fontSize: 12, fontWeight: "700" }}>{ONBOARDING_STEPS[step].label}</Text>
              </View>
            </View>
            <View accessible={false} style={{ flexDirection: "row", gap: 4 }}>
              {ONBOARDING_STEPS.map((item, index) => (
                <View key={item.key} style={{ flex: 1, height: 6, borderRadius: 3, backgroundColor: index <= step ? p.primary : p.border }} />
              ))}
            </View>
            <View style={[ui.row, { gap: 8 }]}>
              <Feather name={live ? "check-circle" : "arrow-right-circle"} size={14} color={p.muted} />
              <Text style={[ui.small, { flex: 1, color: p.muted }]}>{live ? "Live and taking bookings" : "Next: " + property.nextStep}</Text>
            </View>
          </MotionPress>
        );
      })}
    </Entrance>
  );
}

// A quick, always-visible way for a client to start a new property enquiry.
export function EnquiryCard({ palette: p, onStart }: { palette: Palette; onStart: () => void }) {
  return (
    <MotionPress {...hover} accessibilityRole="button" accessibilityLabel="Start a new property enquiry" onPress={onStart} style={[ui.row, { gap: 14, padding: 18, borderRadius: 24, backgroundColor: p.primary }]}>
      <View style={{ width: 52, height: 52, borderRadius: 18, backgroundColor: p.isDark ? "#1F3D3814" : "#FFFFFF1F", alignItems: "center", justifyContent: "center" }}>
        <DimensionalIcon name="house" size={42} />
      </View>
      <View style={{ flex: 1, gap: 3 }}>
        <Text style={{ color: p.onPrimary, fontSize: 16, fontWeight: "700" }}>Have another property?</Text>
        <Text style={{ color: p.onPrimary, fontSize: 13, opacity: 0.85 }}>Start a new enquiry in under a minute.</Text>
      </View>
      <View style={{ width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: p.onPrimary }}>
        <Feather name="plus" size={20} color={p.primary} />
      </View>
    </MotionPress>
  );
}

const ENQUIRY_FIELDS = [
  { key: "name", label: "Property name", placeholder: "For example, Harbour View Flat" },
  { key: "address", label: "Full property address", placeholder: "Street, town and postcode", multiline: true },
  { key: "region", label: "Region", placeholder: "For example, Edinburgh" },
  { key: "propertyType", label: "Property type", placeholder: "Flat, house, cottage…" },
  { key: "bedrooms", label: "Bedrooms", placeholder: "2", numeric: true },
  { key: "bathrooms", label: "Bathrooms", placeholder: "1", numeric: true },
] as const;

export function EnquirySheet({ palette: p, visible, onClose }: { palette: Palette; visible: boolean; onClose: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const close = () => { setValues({}); setError(""); setSent(false); onClose(); };
  const submit = () => {
    const missing = ENQUIRY_FIELDS.find(field => !(values[field.key] || "").trim());
    if (missing) { setError(`Add the ${missing.label.toLowerCase()}.`); return; }
    if (ENQUIRY_FIELDS.some(field => "numeric" in field && !/^\d{1,2}$/.test(values[field.key].trim()))) { setError("Use whole numbers for bedrooms and bathrooms."); return; }
    setError("");
    setSent(true);
  };
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <View {...(Platform.OS === "web" ? { dataSet: { overlay: "blur" } } : {})} style={{ flex: 1, backgroundColor: p.overlay, alignItems: "center", justifyContent: "center", padding: 16 }}>
        <View accessibilityViewIsModal style={{ width: "100%", maxWidth: 520, maxHeight: "92%", borderRadius: 28, backgroundColor: p.surface, overflow: "hidden" }}>
          <View style={[ui.between, { gap: 12, padding: 20, borderBottomWidth: 1, borderColor: p.border }]}>
            <View style={[ui.row, { gap: 12, flex: 1 }]}>
              <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: p.wash, alignItems: "center", justifyContent: "center" }}><DimensionalIcon name="house" size={34} /></View>
              <View style={{ flex: 1 }}>
                <Text accessibilityRole="header" style={{ color: p.text, fontSize: 18, fontWeight: "700" }}>New property enquiry</Text>
                <Text style={[ui.small, { color: p.muted }]}>Tell us about the property and we will prepare an estimate.</Text>
              </View>
            </View>
            <MotionPress accessibilityRole="button" accessibilityLabel="Close enquiry" onPress={close} style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: p.elevated }}>
              <Feather name="x" size={18} color={p.text} />
            </MotionPress>
          </View>
          {sent ? (
            <View style={{ padding: 24, gap: 14, alignItems: "center" }}>
              <DimensionalIcon name="medal" size={84} />
              <Text style={{ color: p.text, fontSize: 20, fontWeight: "700", textAlign: "center" }}>Enquiry ready to send</Text>
              <Text style={[ui.body, { color: p.muted, textAlign: "center" }]}>This preview does not send anything. Once your account is live, {values.name || "your property"} goes straight to the Recharge team and appears in Your properties.</Text>
              <MotionPress accessibilityRole="button" onPress={close} style={[ui.between, { alignSelf: "stretch", minHeight: 52, paddingHorizontal: 18, borderRadius: 18, backgroundColor: p.primary }]}>
                <Text style={{ color: p.onPrimary, fontSize: 15, fontWeight: "700" }}>Done</Text>
                <Feather name="check" size={18} color={p.onPrimary} />
              </MotionPress>
            </View>
          ) : (
            <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }} keyboardShouldPersistTaps="handled">
              {ENQUIRY_FIELDS.map(field => (
                <View key={field.key} style={{ gap: 6 }}>
                  <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>{field.label}</Text>
                  <TextInput
                    accessibilityLabel={field.label}
                    value={values[field.key] || ""}
                    onChangeText={text => setValues(current => ({ ...current, [field.key]: text }))}
                    placeholder={field.placeholder}
                    placeholderTextColor={p.muted}
                    multiline={"multiline" in field}
                    keyboardType={"numeric" in field ? "number-pad" : "default"}
                    maxLength={"multiline" in field ? 400 : 120}
                    style={[ui.input, { color: p.text, backgroundColor: p.background, borderColor: p.border, minHeight: "multiline" in field ? 84 : 48, textAlignVertical: "multiline" in field ? "top" : "center" }]}
                  />
                </View>
              ))}
              {!!error && <Text accessibilityRole="alert" style={[ui.small, { color: p.danger }]}>{error}</Text>}
              <MotionPress accessibilityRole="button" onPress={submit} style={[ui.between, { minHeight: 52, paddingHorizontal: 18, borderRadius: 18, backgroundColor: p.primary, marginTop: 4 }]}>
                <Text style={{ color: p.onPrimary, fontSize: 15, fontWeight: "700" }}>Send enquiry</Text>
                <Feather name="arrow-right" size={18} color={p.onPrimary} />
              </MotionPress>
              <Text style={[ui.small, { color: p.muted, textAlign: "center" }]}>Preview only. Nothing is sent.</Text>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}
