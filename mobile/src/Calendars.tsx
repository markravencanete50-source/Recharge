import { useMemo, useState } from "react";
import { Platform, ScrollView, View, useWindowDimensions } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { clientPortfolio, formatMoney, nights, type Booking } from "./clientPortfolio";
import { KIND_COLOUR, KIND_LABEL, type ScheduleEvent } from "./schedule";
import { MotionPress } from "./motion";
import { Sheet } from "./TeamFlows";
import { Text } from "./Typography";
import { ui, type Palette } from "./theme";

const longDate = (value: string) => new Date(value + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const shortDate = (value: string) => new Date(value + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

// The selected day's schedule: tap any entry for its details.
export function DayAgenda({ palette: p, date, events, onAction, actionLabel }: { palette: Palette; date: string; events: ScheduleEvent[]; onAction?: (event: ScheduleEvent) => void; actionLabel?: (event: ScheduleEvent) => string | null }) {
  const [open, setOpen] = useState<ScheduleEvent | null>(null);
  const today = events.filter(event => event.date === date);
  const colour = (event: ScheduleEvent) => KIND_COLOUR[event.kind][p.isDark ? "dark" : "light"];
  return (
    <View style={{ gap: 10 }}>
      <View style={[ui.between, { gap: 12 }]}>
        <Text accessibilityRole="header" style={{ color: p.text, fontSize: 17, fontWeight: "700", flex: 1, minWidth: 0 }}>{longDate(date)}</Text>
        <Text style={[ui.small, { color: p.muted }]}>{today.length ? `${today.length} scheduled` : "Nothing scheduled"}</Text>
      </View>
      {today.length ? (
        <View style={{ borderRadius: 22, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border, paddingVertical: 4 }}>
          {today.map((event, index) => (
            <MotionPress key={event.id} {...(Platform.OS === "web" ? { dataSet: { hover: "tint" } } : {})} accessibilityRole="button" accessibilityLabel={`${event.start} to ${event.end}, ${event.title}, ${event.property}, ${event.person}`} onPress={() => setOpen(event)} style={[ui.row, { gap: 12, padding: 14, borderTopWidth: index ? 1 : 0, borderColor: p.border, alignItems: "stretch" }]}>
              <View style={{ width: 52, justifyContent: "center" }}>
                <Text style={{ color: p.text, fontSize: 14, fontWeight: "700" }}>{event.start}</Text>
                <Text style={{ color: p.muted, fontSize: 12 }}>{event.end}</Text>
              </View>
              <View style={{ width: 4, borderRadius: 2, backgroundColor: colour(event) }} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text numberOfLines={1} style={{ color: p.text, fontSize: 14, fontWeight: "600" }}>{event.title}</Text>
                <Text numberOfLines={1} style={[ui.small, { color: p.muted }]}>{event.property} · {event.person}</Text>
              </View>
              <View style={{ justifyContent: "center" }}><Feather name="chevron-right" size={17} color={p.muted} /></View>
            </MotionPress>
          ))}
        </View>
      ) : (
        <View style={[ui.row, { gap: 10, padding: 14, borderRadius: 18, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border }]}>
          <Feather name="sun" size={16} color={p.muted} />
          <Text style={[ui.small, { color: p.muted, flex: 1 }]}>A clear day. Pick another date to see what is booked.</Text>
        </View>
      )}
      <Sheet palette={p} visible={!!open} onClose={() => setOpen(null)} title={open?.title ?? ""} subtitle={open ? `${shortDate(open.date)} · ${open.start} to ${open.end}` : ""} icon="calendar">
        {open && (
          <>
            {[
              ["tag", "Type", KIND_LABEL[open.kind]],
              ["home", "Property", open.property],
              ["user", "Who", open.person],
              ...(open.guests ? [["users", "Guests", `${open.guests} staying next`]] : []),
            ].map(([icon, label, value]) => (
              <View key={label} style={[ui.row, { gap: 12, paddingVertical: 6 }]}>
                <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: p.wash, alignItems: "center", justifyContent: "center" }}><Feather name={icon as "tag"} size={16} color={p.text} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={[ui.small, { color: p.muted }]}>{label}</Text>
                  <Text style={{ color: p.text, fontSize: 15, fontWeight: "600" }}>{value}</Text>
                </View>
              </View>
            ))}
            {!!open.note && <View style={{ padding: 12, borderRadius: 14, backgroundColor: p.background }}><Text style={[ui.body, { color: p.text }]}>{open.note}</Text></View>}
            {onAction && actionLabel?.(open) && (
              <MotionPress accessibilityRole="button" onPress={() => { const target = open; setOpen(null); onAction(target); }} style={[ui.between, { minHeight: 50, paddingHorizontal: 18, borderRadius: 16, backgroundColor: p.primary }]}>
                <Text style={{ color: p.onPrimary, fontSize: 15, fontWeight: "700" }}>{actionLabel(open)}</Text>
                <Feather name="arrow-right" size={18} color={p.onPrimary} />
              </MotionPress>
            )}
          </>
        )}
      </Sheet>
    </View>
  );
}

const PROPERTY_COLOURS = [
  { light: "#1F5F55", dark: "#8FD3C2" },
  { light: "#B4512F", dark: "#F2AE8C" },
  { light: "#3B5866", dark: "#A9C6D2" },
  { light: "#6B4768", dark: "#D9B5D5" },
];
const DAY_MS = 86400000;
const addDays = (value: string, days: number) => new Date(Date.parse(value + "T00:00:00Z") + days * DAY_MS).toISOString().slice(0, 10);

// A month view in the style of Google Calendar: stays drawn as bars across the
// nights they cover, coloured by property. Tap a stay or a day for details.
export function BookingMonthCalendar({ palette: p }: { palette: Palette }) {
  const { width } = useWindowDimensions();
  const compact = width < 700;
  const data = useMemo(() => clientPortfolio(), []);
  const live = data.perProperty;
  const [month, setMonth] = useState(data.today.slice(0, 7));
  const [selected, setSelected] = useState(data.today);
  const [hidden, setHidden] = useState<string[]>([]);
  const [open, setOpen] = useState<Booking | null>(null);
  const colourOf = (propertyId: string) => PROPERTY_COLOURS[Math.max(0, live.findIndex(item => item.id === propertyId)) % PROPERTY_COLOURS.length][p.isDark ? "dark" : "light"];
  const nameOf = (propertyId: string) => live.find(item => item.id === propertyId)?.name ?? "Property";
  const bookings = data.bookings.filter(booking => !hidden.includes(booking.propertyId));
  const first = month + "-01";
  const firstWeekday = (new Date(first + "T12:00:00Z").getUTCDay() + 6) % 7;
  const gridStart = addDays(first, -firstWeekday);
  const weeks = Array.from({ length: 6 }, (_, week) => Array.from({ length: 7 }, (_, dayIndex) => addDays(gridStart, week * 7 + dayIndex)));
  const label = new Date(first + "T12:00:00Z").toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const move = (step: number) => { const date = new Date(first + "T12:00:00Z"); date.setUTCMonth(date.getUTCMonth() + step); setMonth(date.toISOString().slice(0, 7)); };
  const barHeight = compact ? 16 : 20;
  const dayStays = bookings.filter(booking => booking.checkIn <= selected && booking.checkOut >= selected);
  return (
    <View style={{ gap: 14 }}>
      <View style={[ui.between, { gap: 10, flexWrap: "wrap" }]}>
        <View style={[ui.row, { gap: 8 }]}>
          <MotionPress accessibilityRole="button" onPress={() => { setMonth(data.today.slice(0, 7)); setSelected(data.today); }} style={{ minHeight: 38, paddingHorizontal: 14, justifyContent: "center", borderRadius: 999, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface }}>
            <Text style={{ color: p.text, fontSize: 13, fontWeight: "700" }}>Today</Text>
          </MotionPress>
          <MotionPress accessibilityRole="button" accessibilityLabel="Previous month" onPress={() => move(-1)} style={{ width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: p.elevated }}><Feather name="chevron-left" size={18} color={p.text} /></MotionPress>
          <MotionPress accessibilityRole="button" accessibilityLabel="Next month" onPress={() => move(1)} style={{ width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: p.elevated }}><Feather name="chevron-right" size={18} color={p.text} /></MotionPress>
          <Text accessibilityRole="header" style={{ color: p.text, fontSize: 18, fontWeight: "700", marginLeft: 4 }}>{label}</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {live.map(property => {
            const on = !hidden.includes(property.id);
            return (
              <MotionPress key={property.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => setHidden(on ? [...hidden, property.id] : hidden.filter(id => id !== property.id))} style={[ui.row, { gap: 6, minHeight: 34, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: p.border, backgroundColor: on ? p.surface : "transparent", opacity: on ? 1 : 0.55 }]}>
                <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: colourOf(property.id) }} />
                <Text numberOfLines={1} style={{ color: p.text, fontSize: 12, fontWeight: "600", maxWidth: 160 }}>{property.name.replace("Example ", "")}</Text>
              </MotionPress>
            );
          })}
        </ScrollView>
      </View>
      <View style={{ borderRadius: 18, borderWidth: 1, borderColor: p.border, overflow: "hidden", backgroundColor: p.surface }}>
        <View style={{ flexDirection: "row", borderBottomWidth: 1, borderColor: p.border }}>
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map(name => (
            <Text key={name} style={{ flex: 1, textAlign: "center", paddingVertical: 8, color: p.muted, fontSize: 11, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase" }}>{compact ? name.slice(0, 1) : name}</Text>
          ))}
        </View>
        {weeks.map((days, row) => {
          const weekEnd = addDays(days[0], 7);
          const segments = bookings
            .filter(booking => booking.checkIn < weekEnd && booking.checkOut > days[0])
            .sort((a, b) => a.checkIn.localeCompare(b.checkIn))
            .map(booking => {
              const start = booking.checkIn < days[0] ? 0 : nights(days[0], booking.checkIn);
              const end = booking.checkOut > weekEnd ? 7 : nights(days[0], booking.checkOut);
              return { booking, start, span: Math.max(1, end - start), continues: booking.checkOut > weekEnd, began: booking.checkIn < days[0] };
            });
          const lanes: number[] = [];
          const placed = segments.map(segment => {
            let lane = lanes.findIndex(endCol => endCol <= segment.start);
            if (lane < 0) { lane = lanes.length; lanes.push(0); }
            lanes[lane] = segment.start + segment.span;
            return { ...segment, lane };
          });
          const height = Math.max(compact ? 64 : 92, 28 + lanes.length * (barHeight + 4) + 6);
          return (
            <View key={row} style={{ height, borderTopWidth: row ? 1 : 0, borderColor: p.border }}>
              <View style={{ flexDirection: "row", flex: 1 }}>
                {days.map((date, col) => {
                  const inMonth = date.startsWith(month);
                  const isToday = date === data.today;
                  const isSelected = date === selected;
                  return (
                    <MotionPress key={date} accessibilityRole="button" accessibilityState={{ selected: isSelected }} accessibilityLabel={longDate(date)} onPress={() => setSelected(date)} style={{ flex: 1, borderLeftWidth: col ? 1 : 0, borderColor: p.border, backgroundColor: isSelected ? p.wash : "transparent", paddingTop: 4, alignItems: "center" }}>
                      <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: isToday ? p.primary : "transparent" }}>
                        <Text style={{ color: isToday ? p.onPrimary : inMonth ? p.text : p.muted, opacity: inMonth || isToday ? 1 : 0.55, fontSize: 12, fontWeight: isToday ? "700" : "500" }}>{Number(date.slice(8))}</Text>
                      </View>
                    </MotionPress>
                  );
                })}
              </View>
              {placed.map(segment => (
                <MotionPress
                  key={segment.booking.id + row}
                  accessibilityRole="button"
                  accessibilityLabel={`${segment.booking.guest} at ${nameOf(segment.booking.propertyId)}, ${shortDate(segment.booking.checkIn)} to ${shortDate(segment.booking.checkOut)}`}
                  onPress={() => setOpen(segment.booking)}
                  style={{
                    position: "absolute",
                    top: 30 + segment.lane * (barHeight + 4),
                    left: `${(segment.start / 7) * 100}%`,
                    width: `${(segment.span / 7) * 100}%`,
                    height: barHeight,
                    paddingHorizontal: 3,
                  }}
                >
                  <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 6, backgroundColor: colourOf(segment.booking.propertyId), borderTopLeftRadius: segment.began ? 0 : 6, borderBottomLeftRadius: segment.began ? 0 : 6, borderTopRightRadius: segment.continues ? 0 : 6, borderBottomRightRadius: segment.continues ? 0 : 6 }}>
                    <Text numberOfLines={1} style={{ color: p.isDark ? "#0F1E1A" : "#FFFFFF", fontSize: compact ? 10 : 12, fontWeight: "700" }}>{compact ? segment.booking.guest.replace("Example guest ", "") : segment.booking.guest.replace("Example guest", "Guest") + " · " + nights(segment.booking.checkIn, segment.booking.checkOut) + "n"}</Text>
                  </View>
                </MotionPress>
              ))}
            </View>
          );
        })}
      </View>
      <View style={{ gap: 10 }}>
        <Text accessibilityRole="header" style={{ color: p.text, fontSize: 16, fontWeight: "700" }}>{longDate(selected)}</Text>
        {dayStays.length ? dayStays.map(booking => {
          const arriving = booking.checkIn === selected, leaving = booking.checkOut === selected;
          return (
            <MotionPress key={booking.id} accessibilityRole="button" onPress={() => setOpen(booking)} style={[ui.row, { gap: 12, padding: 12, borderRadius: 16, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border }]}>
              <View style={{ width: 6, alignSelf: "stretch", borderRadius: 3, backgroundColor: colourOf(booking.propertyId) }} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: p.text, fontSize: 14, fontWeight: "600" }}>{booking.guest} · {arriving ? "Arriving" : leaving ? "Leaving" : "Staying"}</Text>
                <Text style={[ui.small, { color: p.muted }]}>{nameOf(booking.propertyId)} · {booking.guests} guests · {booking.channel}</Text>
              </View>
              <Text style={{ color: p.text, fontWeight: "700" }}>{formatMoney(booking.payoutMinor)}</Text>
            </MotionPress>
          );
        }) : <Text style={[ui.small, { color: p.muted }]}>No guests on this day.</Text>}
      </View>
      <Sheet palette={p} visible={!!open} onClose={() => setOpen(null)} title={open?.guest ?? ""} subtitle={open ? nameOf(open.propertyId) : ""} icon="calendar">
        {open && [
          ["log-in", "Check-in", shortDate(open.checkIn) + ", from 3pm"],
          ["log-out", "Check-out", shortDate(open.checkOut) + ", by 11am"],
          ["moon", "Nights", String(nights(open.checkIn, open.checkOut))],
          ["users", "Guests", String(open.guests)],
          ["globe", "Booked on", open.channel],
          ["hash", "Reservation code", open.code],
          ["credit-card", "Payout", formatMoney(open.payoutMinor)],
        ].map(([icon, title, value]) => (
          <View key={title} style={[ui.row, { gap: 12, paddingVertical: 4 }]}>
            <View style={{ width: 36, height: 36, borderRadius: 12, backgroundColor: p.wash, alignItems: "center", justifyContent: "center" }}><Feather name={icon as "hash"} size={16} color={p.text} /></View>
            <View style={{ flex: 1 }}><Text style={[ui.small, { color: p.muted }]}>{title}</Text><Text style={{ color: p.text, fontSize: 15, fontWeight: "600" }}>{value}</Text></View>
          </View>
        ))}
      </Sheet>
    </View>
  );
}
