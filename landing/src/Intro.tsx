import { AbsoluteFill, Easing, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import letters from "./letters.json";
import { HEAD, LOGO, MARK, PATHS, RING } from "./mark";

// Brand palette only: bone and forest green, plus tints of the green.
export const BONE = "#EFE7DA";
export const GREEN = "#263F3B";
const tint = (alpha: number) => `rgba(38, 63, 59, ${alpha})`;

export const FPS = 30;
export const INTRO_END = 180;
export const DURATION = FPS * 60 * 30;
const CYCLE = 120;

const ease = Easing.bezier(0.65, 0, 0.35, 1);
const progress = (frame: number, from: number, to: number) =>
  interpolate(frame, [from, to], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: ease });

// A stroke that draws itself on between two frames.
function Stroke({ d, from, to }: { d: string; from: number; to: number }) {
  const frame = useCurrentFrame();
  const p = progress(frame, from, to);
  return <path d={d} pathLength={1} strokeDasharray="1 2" strokeDashoffset={1 - p} opacity={p > 0 ? 1 : 0} />;
}

function Mark({ size }: { size: number }) {
  const frame = useCurrentFrame();
  const ring = progress(frame, 0, 36);
  const head = progress(frame, 38, 62);
  const after = Math.max(0, frame - INTRO_END);
  const charge = frame < INTRO_END
    ? interpolate(frame, [86, 94, 104], [1, 1.22, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : interpolate(after % CYCLE, [0, 8, 20], [1, 1.12, 1], { extrapolateRight: "clamp" });
  const [bx, by] = [224.5, 170];
  return (
    <svg width={size} height={size * (MARK.height / MARK.width)} viewBox={`0 0 ${MARK.width} ${MARK.height}`}
      fill="none" stroke={GREEN} strokeWidth={MARK.stroke} style={{ overflow: "visible", flex: "none" }}>
      <defs>
        <clipPath id="inside"><ellipse cx={RING.cx} cy={RING.cy} rx={RING.rx} ry={RING.ry} /></clipPath>
      </defs>
      <ellipse cx={RING.cx} cy={RING.cy} rx={RING.rx} ry={RING.ry} pathLength={1} strokeDasharray="1 2"
        strokeDashoffset={1 - ring} opacity={ring > 0 ? 1 : 0} transform={`rotate(-90 ${RING.cx} ${RING.cy})`} />
      <g clipPath="url(#inside)">
        <Stroke d={PATHS.headboard} from={18} to={42} />
        <Stroke d={PATHS.mattress} from={28} to={52} />
        <Stroke d={PATHS.blanket} from={44} to={74} />
      </g>
      <circle cx={HEAD.cx} cy={HEAD.cy} r={HEAD.r} pathLength={1} strokeDasharray="1 2" strokeDashoffset={1 - head}
        opacity={head > 0 ? 1 : 0} transform={`rotate(90 ${HEAD.cx} ${HEAD.cy})`} />
      <g strokeLinejoin="round" transform={`translate(${bx} ${by}) scale(${charge}) translate(${-bx} ${-by})`}>
        <Stroke d={PATHS.bolt} from={74} to={86} />
      </g>
    </svg>
  );
}

// Thin rings that pulse out from the mark, like a charge going out.
function Ripples({ size }: { size: number }) {
  const frame = useCurrentFrame();
  const waves = frame < INTRO_END ? [frame - 90] : [(frame - INTRO_END) % CYCLE, (frame - INTRO_END + CYCLE / 2) % CYCLE];
  return (
    <>
      {waves.filter((t) => t >= 0 && t < CYCLE).map((t, i) => {
        const p = t / CYCLE;
        return (
          <div key={i} style={{
            position: "absolute", left: "50%", top: "50%", width: size, height: size * (MARK.height / MARK.width),
            border: `${Math.max(1, size / 180)}px solid ${GREEN}`, borderRadius: "50%",
            transform: `translate(-50%, -50%) scale(${1 + Easing.out(Easing.cubic)(p) * 1.6})`,
            opacity: interpolate(p, [0, 0.15, 1], [0, 0.22, 0]), pointerEvents: "none",
          }} />
        );
      })}
    </>
  );
}

function Wordmark({ k }: { k: number }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const wave = frame >= INTRO_END ? (frame - INTRO_END) % (CYCLE * 2) : -1;
  return (
    <>
      {letters.map((l, i) => {
        const dot = i === letters.length - 1;
        const p = spring({ frame: frame - (dot ? 112 : 60 + i * 5), fps, config: dot ? { damping: 9, mass: 0.6 } : { damping: 16 } });
        const lift = wave >= 0 ? -Math.sin(Math.max(0, Math.min(Math.PI, (wave - i * 4) / 10))) * l.h * k * 0.06 : 0;
        return (
          <Img key={i} src={`/letters/${i}.png`} alt="" style={{
            position: "absolute", left: l.x * k, top: l.y * k, width: l.w * k, height: l.h * k,
            opacity: Math.min(1, p * 1.4),
            transform: dot ? `scale(${p})` : `translateY(${(1 - p) * l.h * k * 0.45 + lift}px)`,
            filter: dot ? undefined : `blur(${Math.max(0, 1 - p) * 6}px)`,
          }} />
        );
      })}
    </>
  );
}

function ComingSoon({ fontSize }: { fontSize: number }) {
  const frame = useCurrentFrame();
  const text = "Coming soon";
  const fill = progress(frame, 112, 166);
  const width = fontSize * 13;
  const sweep = frame >= INTRO_END ? ((frame - INTRO_END) % CYCLE) / CYCLE : -1;
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: fontSize * 1.1 }}>
      <div style={{ fontSize, fontWeight: 600, letterSpacing: "0.42em", paddingLeft: "0.42em", textTransform: "uppercase", color: GREEN, whiteSpace: "nowrap" }}>
        {[...text].map((c, i) => {
          const start = (i / text.length) * 0.9;
          const p = interpolate(fill, [start, start + 0.1], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          return <span key={i} style={{ opacity: p * 0.9, display: "inline-block", transform: `translateY(${(1 - p) * fontSize * 0.5}px)` }}>{c === " " ? " " : c}</span>;
        })}
      </div>
      <div style={{ position: "relative", width, height: 2, borderRadius: 2, background: tint(0.14), overflow: "hidden", opacity: progress(frame, 100, 112) }}>
        <div style={{ position: "absolute", inset: 0, width: `${fill * 100}%`, background: GREEN, borderRadius: 2 }} />
        {sweep >= 0 && (
          <div style={{ position: "absolute", top: 0, bottom: 0, width: width * 0.3, left: (sweep * 1.6 - 0.3) * width,
            background: `linear-gradient(90deg, transparent, ${BONE}, transparent)`, opacity: 0.85 }} />
        )}
      </div>
    </div>
  );
}

// Two large, very faint green tints drifting behind everything.
function Backdrop() {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const size = Math.max(width, height) * 0.7;
  const t = frame / FPS;
  const fadeIn = progress(frame, 0, 40);
  const blob = (x: number, y: number, alpha: number) => (
    <div style={{ position: "absolute", width: size, height: size, left: x - size / 2, top: y - size / 2, borderRadius: "50%",
      background: `radial-gradient(circle, ${tint(alpha)} 0%, ${tint(0)} 65%)`, opacity: fadeIn }} />
  );
  return (
    <AbsoluteFill style={{ background: BONE, overflow: "hidden" }}>
      {blob(width * (0.3 + Math.sin(t / 9) * 0.06), height * (0.35 + Math.cos(t / 11) * 0.06), 0.07)}
      {blob(width * (0.72 + Math.cos(t / 10) * 0.06), height * (0.68 + Math.sin(t / 8) * 0.06), 0.06)}
    </AbsoluteFill>
  );
}

export function Intro({ still = false }: { still?: boolean }) {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();
  const logoWidth = Math.min(720, width * 0.86);
  const k = logoWidth / LOGO.width;
  const markSize = MARK.width * k;
  const fontSize = Math.max(12, Math.min(16, width * 0.016));
  const breathe = frame >= INTRO_END ? 1 + Math.sin(((frame - INTRO_END) / FPS) * 0.8) * 0.006 : 1;
  return (
    <AbsoluteFill style={{ fontFamily: "Montserrat, system-ui, sans-serif" }}>
      <Backdrop />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", gap: Math.max(28, height * 0.05) }}>
        <div style={{ position: "relative", width: logoWidth, height: LOGO.height * k, transform: `scale(${breathe})` }}>
          <div style={{ position: "absolute", left: 0, top: 0, width: markSize, height: LOGO.height * k }}>
            {!still && <Ripples size={markSize} />}
            <Mark size={markSize} />
          </div>
          <Wordmark k={k} />
        </div>
        <ComingSoon fontSize={fontSize} />
      </AbsoluteFill>
      <div style={{ position: "absolute", bottom: 24, width: "100%", textAlign: "center", fontSize: 12, fontWeight: 500,
        letterSpacing: "0.04em", color: GREEN, opacity: progress(frame, 150, 176) * 0.55 }}>
        © {new Date().getFullYear()} Recharge Group
      </div>
    </AbsoluteFill>
  );
}
