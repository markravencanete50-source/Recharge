import { useState } from 'react';
import { Platform, View } from 'react-native';
import { Text } from './Typography';
import { MotionPress } from './motion';
import { depth, ui, type Palette } from './theme';

// Exact figures on every chart: point at a bar, a day or a segment (hover on a computer, tap on a
// phone) and a small card shows its numbers. Shared so every chart reads the same way.
export type TipRow = { label: string; value: string | number; color?: string };

// The card itself, kept inside the chart's width and above whatever it describes (`bottom` hangs it above its anchor instead).
export function ChartTip({ p, x, width, top = 0, bottom, title, rows, tipWidth = 150 }: { p: Palette; x: number; width: number; top?: number; bottom?: number; title: string; rows: TipRow[]; tipWidth?: number }) {
  const left = Math.min(Math.max(0, x - tipWidth / 2), Math.max(0, width - tipWidth));
  return (
    <View pointerEvents="none" accessibilityLiveRegion="polite" style={{ position: 'absolute', ...(bottom === undefined ? { top } : { bottom }), left, width: tipWidth, padding: 10, borderRadius: 14, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border, gap: 3, zIndex: 20, ...depth.raised }}>
      <Text numberOfLines={2} style={{ color: p.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.6, textTransform: 'uppercase' }}>{title}</Text>
      {rows.map(row => (
        <View key={row.label} style={[ui.between, { gap: 8 }]}>
          <Text numberOfLines={1} style={{ color: p.text, fontSize: 12, flexShrink: 1 }}>{row.label}</Text>
          <Text numberOfLines={1} style={{ color: row.color ?? p.text, flexShrink: 0, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{row.value}</Text>
        </View>
      ))}
    </View>
  );
}

// Which item is in focus, and how to point at one. `press` adds tap-to-show for charts that are not
// themselves buttons; inside a card that opens somewhere on tap, use `hover` so taps still go through.
export function useChartFocus() {
  const [focus, setFocus] = useState<number | null>(null);
  const hover = (i: number) => Platform.OS === 'web'
    ? { onMouseEnter: () => setFocus(i), onMouseLeave: () => setFocus(f => (f === i ? null : f)) } as object
    : {};
  const press = (i: number) => ({ onHoverIn: () => setFocus(i), onHoverOut: () => setFocus(f => (f === i ? null : f)), onPress: () => setFocus(f => (f === i ? null : i)) });
  const leave = Platform.OS === 'web' ? { onMouseLeave: () => setFocus(null) } as object : {};
  return { focus, setFocus, hover, press, leave };
}

// Invisible columns over a plotted chart (lines, areas): one per point, centred on `xs`, picking it
// on hover or tap. Leaving the chart clears it.
export function HoverColumns({ xs, width, top = 0, height, label, focus }: { xs: number[]; width: number; top?: number; height: number; label: (i: number) => string; focus: ReturnType<typeof useChartFocus> }) {
  return (
    <View style={{ position: 'absolute', left: 0, right: 0, top, height }} {...focus.leave}>
      {xs.map((x, i) => {
        const left = i === 0 ? 0 : (xs[i - 1] + x) / 2, right = i === xs.length - 1 ? width : (x + xs[i + 1]) / 2;
        return <MotionPress key={i} accessibilityRole="button" accessibilityLabel={label(i)} {...focus.press(i)} style={{ position: 'absolute', left, width: Math.max(1, right - left), top: 0, bottom: 0 }} />;
      })}
    </View>
  );
}
