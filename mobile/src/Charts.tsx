import { Text, View } from "react-native";
import Svg, { Circle, Line, Polyline, Text as SvgText } from "react-native-svg";
import { ui, type Palette } from "./theme";
import type { buildAnalytics } from "./model";
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
  const points = values
    .map(
      (value, index) =>
        `${28 + (index / Math.max(1, values.length - 1)) * 260},${130 - (value / max) * 110}`,
    )
    .join(" ");
  return (
    <View
      accessible
      accessibilityLabel={`Activity chart with ${data.total} records. Daily values are listed in chart data.`}
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
        <SvgText x={4} y={25} fill={p.muted} fontSize={10}>
          {max}
        </SvgText>
        <SvgText x={9} y={133} fill={p.muted} fontSize={10}>
          0
        </SvgText>
        <Polyline
          points={points}
          fill="none"
          stroke={p.chart}
          strokeWidth={3}
          strokeLinejoin="round"
        />
        {values.length === 1 && (
          <Circle
            cx={28}
            cy={130 - (values[0] / max) * 110}
            r={4}
            fill={p.chart}
          />
        )}
        <SvgText x={28} y={153} fill={p.muted} fontSize={10}>
          {data.trend[0]?.date.split(" ").slice(0, 2).join(" ")}
        </SvgText>
        <SvgText x={288} y={153} textAnchor="end" fill={p.muted} fontSize={10}>
          {data.trend.at(-1)?.date.split(" ").slice(0, 2).join(" ")}
        </SvgText>
      </Svg>
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
            {data.total}
          </SvgText>
          <SvgText
            x={90}
            y={110}
            textAnchor="middle"
            fontSize={11}
            fill={p.muted}
          >
            recorded items
          </SvgText>
        </Svg>
      </View>
      {data.status.map((item, index) => (
        <View key={item.name} style={ui.between}>
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
        </View>
      ))}
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
            <View
              style={{
                height: 12,
                borderRadius: 8,
                width: `${(queue.value / max) * 100}%`,
                backgroundColor: p.chart,
              }}
            />
          </View>
        </View>
      ))}
    </View>
  );
}
