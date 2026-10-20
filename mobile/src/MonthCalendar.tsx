import { useEffect, useState } from "react";
import { View, useWindowDimensions } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { SlidingPill, MotionPress as Pressable } from "./motion";
import { ui, type Palette } from "./theme";
import type { WorkItem } from "./model";
import { calendarCells } from "../../lib/workspace-map";
import { presetPeriod } from "../../lib/analytics";

// A month of days to pick one from, with a dot on days that have work. Its own file so the live app's date range
// (LivePages DateRangeSheet) does not pull the sample preview's screens into the web workspace bundle.
export function Calendar({
  selected,
  onSelect,
  palette: p,
  items,
  marks,
}: {
  selected: string;
  onSelect: (value: string) => void;
  palette: Palette;
  items?: WorkItem[];
  marks?: string[];
}) {
  const { width } = useWindowDimensions();
  const [month, setMonth] = useState(selected.slice(0, 7));
  const [gridWidth,setGridWidth]=useState(0);
  const selectedCell=calendarCells(month).findIndex(day=>day===selected);
  useEffect(()=>{queueMicrotask(()=>setMonth(selected.slice(0,7)));},[selected]);
  const moveMonth = (step: number) => {
    const date = new Date(`${month}-15T12:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() + step);
    setMonth(date.toISOString().slice(0, 7));
  };
  const dates = new Set([...(items || []).map((item) => item.record.date), ...(marks || [])]);
  return (
    <View
      style={[
        ui.card,
        {
          backgroundColor: p.surface,
          borderColor: p.border,
          paddingHorizontal: width < 350 ? 4 : 16,
          marginHorizontal: width < 350 ? -20 : 0,
        },
      ]}
    >
      <View style={ui.between}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          onPress={() => moveMonth(-1)}
          style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: p.elevated }}
        >
          <Feather name="chevron-left" size={18} color={p.text} />
        </Pressable>
        <Text style={{ fontSize: 16, fontWeight: "700", letterSpacing: -0.3, color: p.text }}>
          {new Date(`${month}-15T12:00:00Z`).toLocaleDateString("en-GB", {
            month: "long",
            year: "numeric",
            timeZone: "UTC",
          })}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next month"
          onPress={() => moveMonth(1)}
          style={{ width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: p.elevated }}
        >
          <Feather name="chevron-right" size={18} color={p.text} />
        </Pressable>
      </View>
      <View style={ui.row}>
        {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => (
          <Text
            key={index}
            style={{
              width: "14.2857%",
              textAlign: "center",
              fontSize: 11,
              fontWeight: "600",
              letterSpacing: 1,
              color: p.muted,
              paddingVertical: 8,
            }}
          >
            {day}
          </Text>
        ))}
      </View>
      <View onLayout={event=>setGridWidth(event.nativeEvent.layout.width)} style={{ flexDirection: "row", flexWrap: "wrap" }}>
        {/* A day-sized circle, centred in its cell, rather than a cell-wide bar. */}
        <SlidingPill x={Math.max(0,selectedCell)%7*gridWidth/7+(gridWidth/7-44)/2} y={Math.floor(Math.max(0,selectedCell)/7)*48+2} width={44} height={44} color={p.primary} visible={selectedCell>=0&&gridWidth>0}/>
        {calendarCells(month).map((day, index) => (
          <View
            key={day || `blank-${index}`}
            style={{ width: "14.2857%", minHeight: 48 }}
          >
            {day ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${day}${items ? (dates.has(day) ? ", has work" : ", no work") : ""}`}
                accessibilityState={{ selected: selected === day }}
                onPress={() => onSelect(day)}
                style={{
                  width: 44,
                  height: 44,
                  marginTop: 2,
                  alignSelf: "center",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: 22,
                  borderWidth:day===presetPeriod(1).to&&selected!==day?1.5:0,
                  borderColor:p.primary,
                  backgroundColor: "transparent",
                  gap: 2,
                }}
              >
                <Text
                  style={{
                    color: selected === day ? p.onPrimary : p.text,
                    fontSize: 15,
                    fontWeight: selected === day ? "700" : "400",
                  }}
                >
                  {Number(day.slice(-2))}
                </Text>
                <View
                  style={{
                    height: 4,
                    width: 4,
                    borderRadius: 2,
                    backgroundColor: dates.has(day)
                      ? selected === day
                        ? p.onPrimary
                        : p.primary
                      : "transparent",
                  }}
                />
              </Pressable>
            ) : null}
          </View>
        ))}
      </View>
    </View>
  );
}
