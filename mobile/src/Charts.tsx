import { useEffect, useState } from "react";
import { Animated, Text, View } from "react-native";
import { Feather } from "@expo/vector-icons";
import Svg, { Circle, Line, Polyline, Text as SvgText } from "react-native-svg";
import { ui, type Palette } from "./theme";
import type { buildAnalytics } from "./model";
import { MotionPress, useReducedMotion } from "./motion";
type Analytics = ReturnType<typeof buildAnalytics>;
export function LineChart({
  data,
  palette: p,
}: {
  data: Analytics;
  palette: Palette;
}) {
  const values = data.trend.map((day) =>
    Object.entries(day).reduce(
      (total, [key, value]) =>
        total +
        (key !== "key" && key !== "date" && typeof value === "number"
          ? value
          : 0),
      0,
    ),
  );
  const max = Math.max(1, ...values);
  const [selected, setSelected] = useState(Math.max(0, values.length - 1));
  const [width, setWidth] = useState(306);
  const selectedIndex = Math.min(selected, Math.max(0, values.length - 1));
  const selectedDay = data.trend[selectedIndex];
  const points = values
    .map(
      (value, index) =>
        `${28 + (index / Math.max(1, values.length - 1)) * 260},${130 - (value / max) * 110}`,
    )
    .join(" ");
  return (
    <View style={{ gap: 12 }}>
      <MotionPress
        accessibilityRole="button"
        accessibilityLabel={`Activity chart with ${data.total} records. Tap to inspect a day, or use the previous and next day buttons below.`}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        onPress={(event) => {
          const x = (event.nativeEvent.locationX / Math.max(1, width)) * 306;
          setSelected(
            Math.max(
              0,
              Math.min(
                values.length - 1,
                Math.round(((x - 28) / 260) * (values.length - 1)),
              ),
            ),
          );
        }}
      >
        <Svg width="100%" height={170} viewBox="0 0 306 160">
          {[0, 1, 2, 3].map((index) => (
            <Line
              key={index}
              x1={28}
              x2={288}
              y1={20 + index * 36.6}
              y2={20 + index * 36.6}
              stroke={p.border}
              strokeDasharray="3 5"
            />
          ))}
          <SvgText x={4} y={25} fill={p.muted} fontSize={12}>
            {max}
          </SvgText>
          <SvgText x={9} y={133} fill={p.muted} fontSize={12}>
            0
          </SvgText>
          <Polyline
            points={points}
            fill="none"
            stroke={p.chart}
            strokeWidth={3}
            strokeLinejoin="round"
          />
          {values.length > 0 && (
            <>
              <Line
                x1={28 + (selectedIndex / Math.max(1, values.length - 1)) * 260}
                x2={28 + (selectedIndex / Math.max(1, values.length - 1)) * 260}
                y1={20}
                y2={130}
                stroke={p.muted}
                strokeDasharray="3 4"
              />
              <Circle
                cx={28 + (selectedIndex / Math.max(1, values.length - 1)) * 260}
                cy={130 - (values[selectedIndex] / max) * 110}
                r={5}
                fill={p.chart}
                stroke={p.surface}
                strokeWidth={2}
              />
            </>
          )}
          {values.length === 1 && (
            <Circle
              cx={28}
              cy={130 - (values[0] / max) * 110}
              r={4}
              fill={p.chart}
            />
          )}
          <SvgText x={28} y={153} fill={p.muted} fontSize={12}>
            {data.trend[0]?.date.split(" ").slice(0, 2).join(" ")}
          </SvgText>
          <SvgText
            x={288}
            y={153}
            textAnchor="end"
            fill={p.muted}
            fontSize={12}
          >
            {data.trend.at(-1)?.date.split(" ").slice(0, 2).join(" ")}
          </SvgText>
        </Svg>
      </MotionPress>
      <View
        style={[
          ui.between,
          { gap: 10, backgroundColor: p.wash, padding: 8, borderRadius: 14 },
        ]}
      >
        <MotionPress
          accessibilityRole="button"
          accessibilityLabel="Previous chart day"
          disabled={selectedIndex === 0}
          accessibilityState={{ disabled: selectedIndex === 0 }}
          onPress={() => setSelected(selectedIndex - 1)}
          style={[
            ui.iconButton,
            { borderColor: p.border, opacity: selectedIndex === 0 ? 0.4 : 1 },
          ]}
        >
          <Feather name="chevron-left" size={18} color={p.text} />
        </MotionPress>
        <View
          accessibilityLiveRegion="polite"
          style={{ flex: 1, alignItems: "center", gap: 3 }}
        >
          <Text style={[ui.small, { color: p.text, fontWeight: "600" }]}>
            {selectedDay?.date ?? "No daily records"}
          </Text>
          <Text style={[ui.small, { color: p.muted }]}>
            {values[selectedIndex] ?? 0} records
          </Text>
        </View>
        <MotionPress
          accessibilityRole="button"
          accessibilityLabel="Next chart day"
          disabled={selectedIndex >= values.length - 1}
          accessibilityState={{ disabled: selectedIndex >= values.length - 1 }}
          onPress={() => setSelected(selectedIndex + 1)}
          style={[
            ui.iconButton,
            {
              borderColor: p.border,
              opacity: selectedIndex >= values.length - 1 ? 0.4 : 1,
            },
          ]}
        >
          <Feather name="chevron-right" size={18} color={p.text} />
        </MotionPress>
      </View>
    </View>
  );
}
export function StatusChart({
  data,
  palette: p,
}: {
  data: Analytics;
  palette: Palette;
}) {
  const colors = [p.waiting, p.chart, p.accent],
    circumference = 2 * Math.PI * 62;
  const [selectedStatus, setSelectedStatus] = useState<number | null>(null);
  const status = selectedStatus === null ? null : data.status[selectedStatus];

  return (
    <View style={{ gap: 14 }}>
      <View
        accessible
        accessibilityLabel={`Work status. ${data.waiting} waiting, ${data.total - data.waiting - data.complete} in progress, ${data.complete} complete.`}
        style={{ alignItems: "center" }}
      >
        <Svg width={190} height={190} viewBox="0 0 180 180">
          <Circle
            cx={90}
            cy={90}
            r={62}
            stroke={p.wash}
            strokeWidth={18}
            fill="none"
          />
          {data.status.map((item, index) => {
            const length = data.total
              ? (item.value / data.total) * circumference
              : 0;
            const previous = data.total
              ? (data.status
                  .slice(0, index)
                  .reduce((sum, entry) => sum + entry.value, 0) /
                  data.total) *
                circumference
              : 0;
            return item.value > 0 ? (
              <Circle
                key={item.name}
                cx={90}
                cy={90}
                r={62}
                stroke={colors[index]}
                strokeWidth={18}
                fill="none"
                strokeDasharray={`${Math.max(0, length - 4)} ${circumference}`}
                strokeDashoffset={-previous}
                rotation={-90}
                origin="90,90"
              />
            ) : null;
          })}
          <SvgText
            x={90}
            y={89}
            textAnchor="middle"
            fontSize={32}
            fontWeight="700"
            fill={p.text}
          >
            {status ? status.value : data.total}
          </SvgText>
          <SvgText
            x={90}
            y={110}
            textAnchor="middle"
            fontSize={12}
            fill={p.muted}
          >
            {status ? status.name.toLowerCase() : "recorded items"}
          </SvgText>
        </Svg>
      </View>
      {data.status.map((item, index) => (
        <MotionPress
          key={item.name}
          accessibilityRole="button"
          accessibilityState={{ selected: selectedStatus === index }}
          accessibilityLabel={`${item.name}: ${item.value} of ${data.total} records`}
          onPress={() =>
            setSelectedStatus(selectedStatus === index ? null : index)
          }
          style={[
            ui.between,
            {
              minHeight: 44,
              paddingHorizontal: 10,
              borderRadius: 12,
              backgroundColor:
                selectedStatus === index ? p.wash : "transparent",
            },
          ]}
        >
          <View style={[ui.row, { gap: 8 }]}>
            <View
              style={{
                width: 7,
                height: 7,
                borderRadius: 4,
                backgroundColor: colors[index],
              }}
            />
            <Text style={[ui.small, { color: p.muted }]}>{item.name}</Text>
          </View>
          <Text style={[ui.small, { color: p.text, fontWeight: "700" }]}>
            {item.value}
          </Text>
        </MotionPress>
      ))}
      <Text
        accessibilityLiveRegion="polite"
        style={[ui.small, { color: p.muted, textAlign: "center" }]}
      >
        {status
          ? `${data.total ? Math.round((status.value / data.total) * 100) : 0}% of recorded items are ${status.name.toLowerCase()}.`
          : "Tap a status to inspect its share."}
      </Text>
    </View>
  );
}
export function QueueChart({
  data,
  palette: p,
}: {
  data: Analytics;
  palette: Palette;
}) {
  const max = Math.max(1, ...data.queues.map((queue) => queue.value));
  const reduced = useReducedMotion();
  const growth = useState(() => new Animated.Value(1))[0];
  const signature = data.queues
    .map((queue) => `${queue.name}:${queue.value}`)
    .join("|");
  useEffect(() => {
    growth.stopAnimation();
    if (reduced) {
      growth.setValue(1);
      return;
    }
    growth.setValue(0);
    const animation = Animated.timing(growth, {
      toValue: 1,
      duration: 400,
      useNativeDriver: false,
    });
    animation.start();
    return () => animation.stop();
  }, [growth, reduced, signature]);
  return (
    <View style={{ gap: 18 }}>
      {data.queues.map((queue) => (
        <View
          key={queue.name}
          accessible
          accessibilityLabel={`${queue.name}: ${queue.value} records`}
          style={{ gap: 8 }}
        >
          <View style={ui.between}>
            <Text style={[ui.small, { color: p.muted }]}>{queue.name}</Text>
            <Text style={[ui.small, { color: p.text, fontWeight: "700" }]}>
              {queue.value}
            </Text>
          </View>
          <View
            style={{
              height: 12,
              borderRadius: 8,
              backgroundColor: p.wash,
              overflow: "hidden",
            }}
          >
            <Animated.View
              style={{
                height: 12,
                borderRadius: 8,
                width: growth.interpolate({
                  inputRange: [0, 1],
                  outputRange: ["0%", `${(queue.value / max) * 100}%`],
                }),
                backgroundColor: p.chart,
              }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}
