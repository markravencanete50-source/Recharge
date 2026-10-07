import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import letters from "./letters.json";
import { FLOOR, HEAD, LOGO, MARK, PATHS, RING } from "./mark";

// Brand palette only: bone and forest green, plus tints of the green.
export const BONE = "#EFE7DA";
export const GREEN = "#263F3B";
const tint = (alpha: number) => `rgba(38, 63, 59, ${alpha})`;

export const FPS = 30;
export const DURATION = FPS * 60 * 30;
const CYCLE = 150;

// The story, in frames. Someone walks home, gets into the bed from the logo,
// sleeps while the charge fills, and the scene settles into the logo itself.
const T = {
  walk: [6, 62],
  climb: [60, 86],
  tuck: [80, 104],
  charge: [100, 162],
  bolt: [160, 172],
  morph: [176, 212],
  ring: [178, 210],
  letters: 204,
  dot: 240,
  soon: [208, 240],
} as const;
export const INTRO_END = 254;

const ease = Easing.bezier(0.65, 0, 0.35, 1);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const progress = (frame: number, [from, to]: readonly [number, number], easing = ease) =>
  interpolate(frame, [from, to], [0, 1], { ...clamp, easing });
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const fadeWindow = (frame: number, from: number, to: number, edge = 6) =>
  Math.min(progress(frame, [from, from + edge]), 1 - progress(frame, [to - edge, to]));

// A stroke that draws itself on.
function Stroke({ d, p }: { d: string; p: number }) {
  return <path d={d} pathLength={1} strokeDasharray="1 2" strokeDashoffset={1 - p} opacity={p > 0 ? 1 : 0} />;
}

function chargeAt(frame: number) {
  if (frame < T.charge[0]) return 8;
  return Math.round(lerp(8, 100, progress(frame, T.charge, Easing.inOut(Easing.quad))));
}

// The walker, in line art at the logo's stroke weight. The head is drawn
// separately so it can carry on into the logo.
function Walker({ x, swing, body }: { x: number; swing: number; body: number }) {
  const hip = FLOOR - 82;
  const shoulder = FLOOR - 162;
  const s = swing * 26 + (swing >= 0 ? 15 : -15);
  const a = swing * 20 + (swing >= 0 ? 24 : -24);
  return (
    <g opacity={body} transform={`translate(${x} 0)`}>
      <path d={`M0 ${shoulder} V${hip}`} />
      <path d={`M0 ${hip} L${s} ${FLOOR}`} />
      <path d={`M0 ${hip} L${-s} ${FLOOR}`} />
      <path d={`M0 ${shoulder + 14} L${-a} ${shoulder + 72}`} />
      <path d={`M0 ${shoulder + 14} L${a} ${shoulder + 72}`} />
    </g>
  );
}

function Moon({ p }: { p: number }) {
  return (
    <g opacity={p} strokeWidth={8}>
      <path d="M352 -78 A34 34 0 1 0 386 -30 A26 26 0 0 1 352 -78 Z" strokeLinejoin="round" />
    </g>
  );
}

function Stars({ frame, p }: { frame: number; p: number }) {
  const stars = [[-40, -60, 0], [250, -110, 11], [440, 40, 23], [-150, 30, 31]];
  return (
    <g strokeWidth={6} strokeLinecap="round">
      {stars.map(([x, y, phase]) => {
        const twinkle = 0.55 + 0.45 * Math.sin((frame + phase) / 7);
        const r = 9 * twinkle;
        return <path key={phase} opacity={p * twinkle} d={`M${x - r} ${y} H${x + r} M${x} ${y - r} V${y + r}`} />;
      })}
    </g>
  );
}

function Zs({ frame, head, still }: { frame: number; head: { x: number; y: number }; still: boolean }) {
  if (still) return null;
  let local = -1;
  if (frame >= T.tuck[1] && frame < T.morph[0]) local = (frame - T.tuck[1]) % 54;
  else if (frame >= INTRO_END) {
    const c = (frame - INTRO_END) % CYCLE;
    if (c >= 30 && c < 30 + 54 * 2) local = (c - 30) % 54;
  }
  if (local < 0) return null;
  return (
    <g fill={GREEN} stroke="none" fontFamily="Montserrat, system-ui, sans-serif" fontWeight={600}>
      {[0, 1, 2].map((i) => {
        const t = local - i * 9;
        if (t < 0 || t > 32) return null;
        const q = t / 32;
        return (
          <text key={i} x={head.x + 44 + i * 26 + q * 20} y={head.y - 36 - i * 30 - q * 44} fontSize={34 + i * 12}
            opacity={interpolate(q, [0, 0.2, 0.75, 1], [0, 0.9, 0.9, 0])}>z</text>
        );
      })}
    </g>
  );
}

function Scene({ frame, width, storyScale, still }: { frame: number; width: number; storyScale: number; still: boolean }) {
  const rightEdge = RING.cx + (width / 2) / storyScale;
  const leftEdge = RING.cx - (width / 2) / storyScale;

  const walk = progress(frame, T.walk, Easing.out(Easing.quad));
  const walkerX = lerp(rightEdge + 60, 352, walk);
  const stepping = 1 - progress(frame, [T.walk[1] - 12, T.walk[1]]);
  const swing = Math.sin((frame / 7.5) * Math.PI) * stepping;
  const bob = -Math.abs(Math.cos((frame / 7.5) * Math.PI)) * 5 * stepping;
  const climb = progress(frame, T.climb);
  const walkerHead = { x: walkerX, y: FLOOR - 162 - 42 + bob };
  const head = {
    x: lerp(walkerHead.x, HEAD.cx, climb),
    y: lerp(walkerHead.y, HEAD.cy, climb) - Math.sin(Math.PI * climb) * 70,
  };
  const breathing = frame >= T.tuck[1] && !still ? Math.sin(frame / 22) * 0.9 : 0;

  const night = 1 - progress(frame, T.morph);
  const floorIn = progress(frame, [0, 22]);
  const boltPulse = frame < INTRO_END
    ? interpolate(frame, [T.bolt[1], T.bolt[1] + 7, T.bolt[1] + 18], [1, 1.25, 1], clamp)
    : still ? 1 : interpolate((frame - INTRO_END) % CYCLE, [0, 8, 20], [1, 1.14, 1], clamp);
  const [bx, by] = [224.5, 170];

  return (
    <g fill="none" stroke={GREEN} strokeWidth={MARK.stroke} strokeLinecap="round">
      <defs>
        <clipPath id="inside"><ellipse cx={RING.cx} cy={RING.cy} rx={RING.rx} ry={RING.ry} /></clipPath>
      </defs>
      <g opacity={night}>
        <path d={`M${RING.cx} ${FLOOR} H${lerp(RING.cx, leftEdge - 40, floorIn)} M${RING.cx} ${FLOOR} H${lerp(RING.cx, rightEdge + 40, floorIn)}`}
          stroke={tint(0.35)} strokeWidth={5} />
        <Moon p={progress(frame, [10, 34])} />
        <Stars frame={frame} p={progress(frame, [18, 40])} />
      </g>
      <ellipse cx={RING.cx} cy={RING.cy} rx={RING.rx} ry={RING.ry} pathLength={1} strokeDasharray="1 2" strokeLinecap="butt"
        strokeDashoffset={1 - progress(frame, T.ring)} opacity={frame >= T.ring[0] ? 1 : 0} transform={`rotate(-90 ${RING.cx} ${RING.cy})`} />
      <g clipPath="url(#inside)" strokeLinecap="butt">
        <Stroke d={PATHS.headboard} p={progress(frame, [8, 30])} />
        <Stroke d={PATHS.footpost} p={progress(frame, [14, 32])} />
        <Stroke d={PATHS.mattress} p={progress(frame, [20, 44])} />
        <Stroke d={PATHS.blanket} p={progress(frame, T.tuck)} />
      </g>
      {frame < T.climb[1] + 4 && (
        <g transform={`translate(${lerp(0, 230 - walkerX, climb)} ${lerp(bob, -40, climb)})`}>
          <Walker x={walkerX} swing={swing} body={1 - progress(frame, [T.climb[0], T.climb[0] + 16])} />
        </g>
      )}
      <circle cx={head.x} cy={head.y} r={HEAD.r + breathing} />
      <g strokeLinejoin="round" strokeLinecap="butt" transform={`translate(${bx} ${by}) scale(${boltPulse}) translate(${-bx} ${-by})`}>
        <Stroke d={PATHS.bolt} p={progress(frame, T.bolt)} />
      </g>
      <Zs frame={frame} head={head} still={still} />
    </g>
  );
}

function Caption({ frame, fontSize, width, still }: { frame: number; fontSize: number; width: number; still: boolean }) {
  const pct = chargeAt(frame);
  const story = [
    [0, T.climb[0] + 2, "Heading home"],
    [T.climb[0] + 2, T.charge[0] + 2, "Settling in"],
    [T.charge[0] + 2, T.bolt[0] + 2, "Recharging"],
    [T.bolt[0] + 2, T.morph[0] + 14, "Fully charged"],
  ] as const;
  const fill = frame < T.morph[0] ? pct / 100 : 1;
  const sweep = frame >= INTRO_END && !still ? ((frame - INTRO_END) % CYCLE) / CYCLE : -1;
  const reveal = progress(frame, T.soon, Easing.linear);
  const text = "Coming soon";
  const line = { fontSize, fontWeight: 600, letterSpacing: "0.42em", paddingLeft: "0.42em", textTransform: "uppercase" as const, color: GREEN, whiteSpace: "nowrap" as const };
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: fontSize * 1.1 }}>
      <div style={{ position: "relative", height: fontSize * 1.3, width: "100%", display: "flex", justifyContent: "center" }}>
        {story.map(([from, to, label]) => {
          const o = fadeWindow(frame, from, to);
          if (o <= 0) return null;
          return (
            <div key={label} style={{ ...line, position: "absolute", opacity: o * 0.9, transform: `translateY(${(1 - o) * fontSize * 0.4}px)` }}>
              {label}<span style={{ fontVariantNumeric: "tabular-nums", opacity: 0.6 }}>{"  "}{pct}%</span>
            </div>
          );
        })}
        <div style={{ ...line, position: "absolute" }}>
          {[...text].map((c, i) => {
            const start = (i / text.length) * 0.85;
            const p = interpolate(reveal, [start, start + 0.15], [0, 1], clamp);
            return <span key={i} style={{ opacity: p * 0.9, display: "inline-block", transform: `translateY(${(1 - p) * fontSize * 0.5}px)` }}>{c === " " ? " " : c}</span>;
          })}
        </div>
      </div>
      <div style={{ position: "relative", width, height: 2, borderRadius: 2, background: tint(0.14), overflow: "hidden", opacity: progress(frame, [0, 12]) }}>
        <div style={{ position: "absolute", inset: 0, width: `${fill * 100}%`, background: GREEN, borderRadius: 2 }} />
        {sweep >= 0 && (
          <div style={{ position: "absolute", top: 0, bottom: 0, width: width * 0.3, left: (sweep * 1.6 - 0.3) * width,
            background: `linear-gradient(90deg, transparent, ${BONE}, transparent)`, opacity: 0.85 }} />
        )}
      </div>
    </div>
  );
}

function Wordmark({ frame, k, left, top, still }: { frame: number; k: number; left: number; top: number; still: boolean }) {
  const { fps } = useVideoConfig();
  const wave = frame >= INTRO_END && !still ? (frame - INTRO_END) % (CYCLE * 2) - CYCLE : -1;
  return (
    <>
      {letters.map((l, i) => {
        const dot = i === letters.length - 1;
        const p = spring({ frame: frame - (dot ? T.dot : T.letters + i * 4), fps, config: dot ? { damping: 9, mass: 0.6 } : { damping: 16 } });
        const lift = wave >= 0 ? -Math.sin(Math.max(0, Math.min(Math.PI, (wave - i * 4) / 10))) * l.h * k * 0.06 : 0;
        return (
          <Img key={i} src={staticFile(`letters/${i}.png`)} alt="" style={{
            position: "absolute", left: left + l.x * k, top: top + l.y * k, width: l.w * k, height: l.h * k,
            opacity: Math.min(1, p * 1.4),
            transform: dot ? `scale(${p})` : `translateY(${(1 - p) * l.h * k * 0.45 + lift}px)`,
            filter: dot ? undefined : `blur(${Math.max(0, 1 - p) * 6}px)`,
          }} />
        );
      })}
    </>
  );
}

// Very faint green tints drifting behind; a touch deeper while it is "night".
function Backdrop({ frame }: { frame: number }) {
  const { width, height } = useVideoConfig();
  const size = Math.max(width, height) * 0.7;
  const t = frame / FPS;
  const night = 1 - progress(frame, T.morph);
  const blob = (x: number, y: number, alpha: number) => (
    <div style={{ position: "absolute", width: size, height: size, left: x - size / 2, top: y - size / 2, borderRadius: "50%",
      background: `radial-gradient(circle, ${tint(alpha)} 0%, ${tint(0)} 65%)` }} />
  );
  return (
    <AbsoluteFill style={{ background: BONE, overflow: "hidden" }}>
      <AbsoluteFill style={{ background: tint(0.07), opacity: night }} />
      {blob(width * (0.3 + Math.sin(t / 9) * 0.06), height * (0.35 + Math.cos(t / 11) * 0.06), 0.07)}
      {blob(width * (0.72 + Math.cos(t / 10) * 0.06), height * (0.68 + Math.sin(t / 8) * 0.06), 0.06)}
    </AbsoluteFill>
  );
}

export function Intro({ still = false }: { still?: boolean }) {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  // Final layout: the logo centred above the caption.
  const logoWidth = Math.min(720, width * 0.86);
  const k = logoWidth / LOGO.width;
  const fontSize = Math.max(12, Math.min(16, width * 0.016));
  const gap = Math.max(28, height * 0.05);
  const captionHeight = fontSize * 2.4 + 2;
  const blockTop = (height - (LOGO.height * k + gap + captionHeight)) / 2;
  const logoLeft = (width - logoWidth) / 2;

  // Story camera: the bed large and centred, then easing into the logo.
  const storyScale = Math.min(width * 0.56, height * 0.38, 420) / MARK.width;
  // The floor sits just above the caption while the story plays.
  const captionTop = blockTop + LOGO.height * k + gap;
  const story = { x: width / 2, y: captionTop - gap - (FLOOR - RING.cy) * storyScale };
  const final = { x: logoLeft + RING.cx * k, y: blockTop + RING.cy * k };
  const m = progress(frame, T.morph);
  const scale = lerp(storyScale, k, m);
  const cx = lerp(story.x, final.x, m);
  const cy = lerp(story.y, final.y, m);

  return (
    <AbsoluteFill style={{ fontFamily: "Montserrat, system-ui, sans-serif" }}>
      <Backdrop frame={frame} />
      <svg width={width} height={height} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        <g transform={`translate(${cx - RING.cx * scale} ${cy - RING.cy * scale}) scale(${scale})`}>
          <Scene frame={frame} width={width} storyScale={storyScale} still={still} />
        </g>
      </svg>
      <Wordmark frame={frame} k={k} left={logoLeft} top={blockTop} still={still} />
      <div style={{ position: "absolute", left: 0, right: 0, top: captionTop, display: "flex", justifyContent: "center" }}>
        <Caption frame={frame} fontSize={fontSize} width={fontSize * 13} still={still} />
      </div>
      <div style={{ position: "absolute", bottom: 24, width: "100%", textAlign: "center", fontSize: 12, fontWeight: 500,
        letterSpacing: "0.04em", color: GREEN, opacity: progress(frame, [T.dot - 10, T.dot + 16]) * 0.55 }}>
        © {new Date().getFullYear()} Recharge Group
      </div>
    </AbsoluteFill>
  );
}
