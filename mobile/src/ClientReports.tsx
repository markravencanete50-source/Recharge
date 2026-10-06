import { useMemo } from "react";
import { Platform, View, useWindowDimensions } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { clientPortfolio, formatMoney, nights, type Booking } from "./clientPortfolio";
import { DimensionalIcon, type DimensionalName } from "./DimensionalIcon";
import { CountUp, Entrance } from "./motion";
import { BookingMonthCalendar } from "./Calendars";
import { Text } from "./Typography";
import { ui, type Palette } from "./theme";

const CHANNEL = {
  Airbnb: { light: "#B4512F", dark: "#F2AE8C" },
  "Booking.com": { light: "#3B5866", dark: "#A9C6D2" },
  Direct: { light: "#1F5F55", dark: "#8FD3C2" },
} as const;
const shortDate = (value: string) => new Date(value + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

// Client reporting: one place for how every property is performing, who is
// staying, what is booked next and what each property is earning.
export function ClientReports({ palette: p }: { palette: Palette }) {
  const { width } = useWindowDimensions();
  const desktop = width >= 1024;
  const data = useMemo(() => clientPortfolio(), []);
  const names = Object.fromEntries(data.properties.map((property) => [property.id, property.name]));
  const card = { ...ui.card, backgroundColor: p.surface, borderColor: p.border };
  const heading = (title: string, detail?: string) => (
    <View style={{ gap: 3 }}>
      <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>{title}</Text>
      {!!detail && <Text style={[ui.small, { color: p.muted }]}>{detail}</Text>}
    </View>
  );
  const kpis: { key: string; icon: DimensionalName; value: number; prefix?: string; suffix?: string; label: string }[] = [
    { key: "earnings", icon: "coins", value: Math.round(data.earningsMinor / 100), prefix: "£", label: "Earnings this month" },
    { key: "occupancy", icon: "chart", value: Math.round(data.occupancy * 100), suffix: "%", label: "Occupancy" },
    { key: "rate", icon: "key", value: Math.round(data.averageNightlyMinor / 100), prefix: "£", label: "Average nightly rate" },
    { key: "upcoming", icon: "calendar", value: data.upcoming.length, label: "Upcoming bookings" },
  ];
  const bookingRow = (booking: Booking, now: boolean) => {
    const colour = CHANNEL[booking.channel][p.isDark ? "dark" : "light"];
    return (
      <View key={booking.id} {...(Platform.OS === "web" ? { dataSet: { hover: "tint" } } : {})} style={[ui.row, { gap: 12, paddingVertical: 12, paddingHorizontal: 10, marginHorizontal: -10, borderRadius: 16 }]}>
        <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: p.wash, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ color: p.text, fontSize: 14, fontWeight: "700" }}>{booking.guest.split(" ").pop()}</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text numberOfLines={1} style={{ color: p.text, fontSize: 15, fontWeight: "600" }}>{booking.guest}</Text>
          <Text numberOfLines={1} style={[ui.small, { color: p.muted }]}>{names[booking.propertyId]} · {shortDate(booking.checkIn)} to {shortDate(booking.checkOut)} · {nights(booking.checkIn, booking.checkOut)} nights</Text>
          <View style={[ui.row, { gap: 6, marginTop: 4 }]}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colour }} />
            <Text style={{ color: p.muted, fontSize: 12 }}>{booking.channel} · {booking.guests} {booking.guests === 1 ? "guest" : "guests"}</Text>
            {now && <View style={{ paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: p.successWash }}><Text style={{ color: p.text, fontSize: 11, fontWeight: "700" }}>Staying now</Text></View>}
          </View>
        </View>
        <Text style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>{formatMoney(booking.payoutMinor)}</Text>
      </View>
    );
  };
  const maxEarnings = Math.max(1, ...data.perProperty.map((property) => property.earningsMinor));
  return (
    <View style={{ gap: 24 }}>
      <Entrance sessionKey="client-reports:heading" style={{ gap: 6 }}>
        <Text style={{ color: p.muted, fontSize: 12, fontWeight: "600", letterSpacing: 1.4, textTransform: "uppercase" }}>{data.monthLabel}</Text>
        <Text accessibilityRole="header" style={[ui.title, { color: p.text }]}>Your portfolio</Text>
        <Text style={[ui.body, { color: p.muted }]}>How your properties are performing, who is staying and what is booked next.</Text>
      </Entrance>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        {kpis.map((kpi) => (
          <View key={kpi.key} style={[card, { flexBasis: desktop ? "23%" : "46%", flexGrow: 1, gap: 12, padding: 16 }]}>
            <View style={{ width: 50, height: 50, borderRadius: 16, backgroundColor: p.wash, alignItems: "center", justifyContent: "center" }}><DimensionalIcon name={kpi.icon} size={38} /></View>
            <View style={[ui.row, { gap: 1, alignItems: "flex-end" }]}>
              {!!kpi.prefix && <Text style={{ color: p.text, fontSize: 18, lineHeight: 30, fontWeight: "700" }}>{kpi.prefix}</Text>}
              <CountUp value={kpi.value} sessionKey={"client-reports:" + kpi.key} style={{ color: p.text, fontSize: 28, lineHeight: 34, fontWeight: "700", letterSpacing: -1 }} />
              {!!kpi.suffix && <Text style={{ color: p.text, fontSize: 18, lineHeight: 30, fontWeight: "700" }}>{kpi.suffix}</Text>}
            </View>
            <Text style={[ui.small, { color: p.muted }]}>{kpi.label}</Text>
          </View>
        ))}
      </View>

      <View style={[card, { gap: 14 }]}>
        {heading("Booking calendar", "Every stay across your properties. Tap a stay or a day for details.")}
        <BookingMonthCalendar palette={p} />
      </View>

      <View style={{ flexDirection: desktop ? "row" : "column", gap: 16, alignItems: "flex-start" }}>
        <View style={[card, { flex: desktop ? 1 : undefined, alignSelf: "stretch", gap: 4 }]}>
          {heading("Guests staying now", data.inHouse.length ? `${data.inHouse.length} ${data.inHouse.length === 1 ? "stay" : "stays"} in progress` : "No guests in residence today")}
          {data.inHouse.map((booking) => bookingRow(booking, true))}
          <View style={{ height: 1, backgroundColor: p.border, marginVertical: 8 }} />
          {heading("Upcoming bookings", "Live bookings that are confirmed")}
          {data.upcoming.map((booking) => bookingRow(booking, false))}
        </View>
        <View style={[card, { flex: desktop ? 1 : undefined, alignSelf: "stretch", gap: 14 }]}>
          {heading("Earnings by property", `${data.monthLabel}, by nights stayed`)}
          {data.perProperty.map((property) => (
            <View key={property.id} style={{ gap: 8 }}>
              <View style={ui.between}>
                <Text numberOfLines={1} style={{ flex: 1, color: p.text, fontSize: 14, fontWeight: "600" }}>{property.name}</Text>
                <Text style={{ color: p.text, fontSize: 14, fontWeight: "700" }}>{formatMoney(property.earningsMinor)}</Text>
              </View>
              <View style={{ height: 10, borderRadius: 5, backgroundColor: p.background, overflow: "hidden" }}>
                <View style={{ width: `${(property.earningsMinor / maxEarnings) * 100}%`, height: 10, borderRadius: 5, backgroundColor: p.primary }} />
              </View>
              <Text style={[ui.small, { color: p.muted }]}>{Math.round(property.occupancy * 100)}% occupied · {property.nights} nights · {property.bookings} bookings</Text>
            </View>
          ))}
          <View style={[ui.row, { gap: 10, padding: 12, borderRadius: 16, backgroundColor: p.background }]}>
            <Feather name="info" size={16} color={p.muted} />
            <Text style={[ui.small, { flex: 1, color: p.muted }]}>Sample figures. Live bookings and payouts appear once your account is connected to Hostaway.</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
