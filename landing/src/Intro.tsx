import { AbsoluteFill, Easing, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import letters from "./letters.json";
import TL from "./timeline.json";
import { FLOOR, HEAD, LOGO, MARK, PATHS, RING } from "./mark";

// Brand palette only: bone and forest green, plus tints of the green.
export const BONE = "#EFE7DA";
export const GREEN = "#263F3B";
const tint = (alpha: number) => `rgba(38, 63, 59, ${alpha})`;

// One timeline drives both the picture and the soundtrack (sound/soundtrack.py reads the
// same file). It sits on a 120 bpm grid: a beat is 15 frames and a footstep 7.5.
// The story: someone comes home through the door, climbs into the bed from the logo,
// the lamp goes off, they charge from 1% to 100% in the moonlight, and at dawn the
// scene settles into the logo itself.
export const FPS = TL.fps;
export const DURATION = FPS * 60 * 30;
export const INTRO_END = TL.introEnd;
const CYCLE = TL.cycle;
type Span = readonly number[];

const ease = Easing.bezier(0.65, 0, 0.35, 1);
const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;
const progress = (frame: number, span: Span, easing = ease) =>
  interpolate(frame, [span[0], span[1]], [0, 1], { ...clamp, easing });
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const fadeWindow = (frame: number, from: number, to: number, edge = 6) =>
  Math.min(progress(frame, [from, from + edge]), 1 - progress(frame, [to - edge, to]));

// A stroke that draws itself on.
function Stroke({ d, p }: { d: string; p: number }) {
  return <path d={d} pathLength={1} strokeDasharray="1 2" strokeDashoffset={1 - p} opacity={p > 0 ? 1 : 0} />;
}

// The charge: 1% as they come through the door, 100% exactly as the bolt fills.
const chargeEase = Easing.inOut(Easing.cubic);
function chargeAt(frame: number) {
  const tired = interpolate(frame, [0, TL.charge[0]], [1, 18], clamp);
  return Math.round(lerp(tired, 100, progress(frame, TL.charge, chargeEase)));
}

// ---------------------------------------------------------------------------------------
// The figure: a jointed line drawing at the logo's stroke weight, facing left.
type Pt = [number, number];
type Pose = { head: Pt; shoulder: Pt; hip: Pt; legs: [Pt, Pt, Pt][]; arms: [Pt, Pt][] };
const BODY = { torso: 65, neck: 14, head: 18, thigh: 58, shin: 58, foot: 26, upper: 44, fore: 44 };
const rad = (deg: number) => (deg * Math.PI) / 180;
// A limb hanging straight down, swung `deg` degrees forward (towards the left).
const hang = (deg: number): Pt => [-Math.sin(rad(deg)), Math.cos(rad(deg))];
const at = (p: Pt, d: Pt, length: number): Pt => [p[0] + d[0] * length, p[1] + d[1] * length];
const mix = (a: Pt, b: Pt, t: number): Pt => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
const bump = (p: number, centre: number, width: number) => {
  const d = Math.abs(p - centre);
  return Math.exp(-((Math.min(d, 1 - d) / width) ** 2));
};

// Walking: seven steps on the eighth notes, slowing over the last two so the feet come
// together on beat four. The body moves exactly one step per stride, so feet don't skate.
const REACH = 22;
const STEP = 2 * (BODY.thigh + BODY.shin) * Math.sin(rad(REACH));
const SPEED = STEP / TL.stride;
const STOP = TL.walk[1];
const SLOW = STOP - 2 * TL.stride;
const WALK_DISTANCE = SPEED * (SLOW + (STOP - SLOW) / 2);
const REST_X = 340;
function walked(frame: number) {
  if (frame <= SLOW) return SPEED * Math.max(0, frame);
  const u = Math.min(frame, STOP) - SLOW;
  return SPEED * (SLOW + u - (u * u) / (2 * (STOP - SLOW)));
}
const walkerX = (frame: number) => REST_X + WALK_DISTANCE - walked(frame);

function leg(hip: Pt, phase: number, amp: number): [Pt, Pt, Pt] {
  const p = ((phase % 1) + 1) % 1;
  // Stance (first half): the planted foot slides back under the hip at walking speed.
  // Swing (second half): the leg comes through, knee bent, for the next contact.
  const reach = Math.sin(rad(REACH));
  const thigh = amp * (p < 0.5 ? (Math.asin(reach * (1 - 4 * p)) * 180) / Math.PI : -REACH * Math.cos(2 * Math.PI * (p - 0.5)));
  const knee = 3 + amp * (8 * bump(p, 0.1, 0.07) + 55 * bump(p, 0.7, 0.13));
  const ankle = amp * (-10 * bump(p, 0, 0.06) + 24 * bump(p, 0.5, 0.07));
  const kneeAt = at(hip, hang(thigh), BODY.thigh);
  const shin = thigh - knee;
  const ankleAt = at(kneeAt, hang(shin), BODY.shin);
  return [kneeAt, ankleAt, at(ankleAt, hang(shin + 90 - ankle), BODY.foot)];
}
function arm(shoulder: Pt, phase: number, amp: number): [Pt, Pt] {
  const upper = -16 * Math.cos(2 * Math.PI * phase) * amp;
  const elbow = at(shoulder, hang(upper), BODY.upper);
  return [elbow, at(elbow, hang(upper + 12 + 16 * Math.max(0, upper / 16)), BODY.fore)];
}
function walkPose(frame: number): Pose {
  const amp = 1 - progress(frame, [SLOW, STOP], Easing.inOut(Easing.sin));
  const phase = walked(frame) / (2 * STEP); // near leg plants at 0, far leg half a cycle later
  const lean = rad(3 + 3 * amp);
  const pose = (hip: Pt): Pose => {
    const shoulder: Pt = [hip[0] - Math.sin(lean) * BODY.torso, hip[1] - Math.cos(lean) * BODY.torso];
    const neck = lean + rad(6);
    const head: Pt = [shoulder[0] - Math.sin(neck) * (BODY.neck + BODY.head), shoulder[1] - Math.cos(neck) * (BODY.neck + BODY.head)];
    return { hip, shoulder, head, legs: [leg(hip, phase, amp), leg(hip, phase + 0.5, amp)], arms: [arm(shoulder, phase, amp), arm(shoulder, phase + 0.5, amp)] };
  };
  // Stand on the floor: the lowest foot touches it, which gives the natural rise and fall.
  const lowest = Math.max(...pose([0, 0]).legs.flatMap(([, ankle, toe]) => [ankle[1], toe[1]]));
  return pose([walkerX(frame), FLOOR - 6 - lowest]);
}

// On hands and knees on the mattress, then lying back on the pillow, knees up.
const KNEEL: Pose = {
  hip: [222, 141], shoulder: [160, 124], head: [130, 114],
  legs: [[[214, 198], [272, 198], [296, 188]], [[224, 196], [280, 196], [302, 186]]],
  arms: [[[148, 166], [138, 198]], [[158, 166], [150, 198]]],
};
const LIE: Pose = {
  hip: [211, 186], shoulder: [146, 184], head: [116, 174],
  legs: [[[245, 140], [266, 194], [270, 168]], [[240, 143], [262, 196], [266, 170]]],
  arms: [[[188, 198], [230, 194]], [[184, 196], [226, 192]]],
};
const mixPose = (a: Pose, b: Pose, t: number): Pose => ({
  hip: mix(a.hip, b.hip, t), shoulder: mix(a.shoulder, b.shoulder, t), head: mix(a.head, b.head, t),
  legs: a.legs.map((l, i) => l.map((p, j) => mix(p, b.legs[i][j], t))) as Pose["legs"],
  arms: a.arms.map((l, i) => l.map((p, j) => mix(p, b.arms[i][j], t))) as Pose["arms"],
});
function poseAt(frame: number): Pose {
  if (frame <= STOP) return walkPose(frame);
  if (frame <= TL.climb[1]) {
    const t = progress(frame, TL.climb);
    const pose = mixPose(walkPose(STOP), KNEEL, t);
    const lift = Math.sin(Math.PI * t) * 16; // a little hop up onto the bed
    return { ...pose, hip: [pose.hip[0], pose.hip[1] - lift], legs: pose.legs.map(l => l.map(([x, y]) => [x, y - lift * 0.6])) as Pose["legs"] };
  }
  return mixPose(KNEEL, LIE, progress(frame, TL.lie));
}

const line = (points: Pt[]) => "M" + points.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join(" L");
function Figure({ pose }: { pose: Pose }) {
  const [hx, hy] = pose.head;
  const [sx, sy] = pose.shoulder;
  const d = Math.hypot(hx - sx, hy - sy) || 1;
  const neck: Pt = [hx - ((hx - sx) / d) * (BODY.head + 2), hy - ((hy - sy) / d) * (BODY.head + 2)];
  const limb = (side: number, color: string) => (
    <g stroke={color}>
      <path d={line([pose.hip, ...pose.legs[side]])} />
      <path d={line([pose.shoulder, ...pose.arms[side]])} />
    </g>
  );
  return (
    <g strokeLinejoin="round">
      {limb(1, tint(0.42))}
      <path d={line([pose.hip, pose.shoulder])} strokeWidth={MARK.stroke + 5} />
      <path d={line([pose.shoulder, neck])} />
      {limb(0, GREEN)}
    </g>
  );
}

// A work bag on the far shoulder. It slips off and lands by the bed on beat four.
const BAG = { drop: STOP - 6, w: 38, h: 30 };
function Bag({ frame, pose }: { frame: number; pose: Pose }) {
  const carried = walkPose(Math.min(frame, BAG.drop));
  const from: Pt = [carried.hip[0] + 4, carried.hip[1] + 4];
  const floor = FLOOR - 6 - BAG.h;
  const t = Math.min(1, Math.max(0, (frame - BAG.drop) / (STOP - BAG.drop)));
  const swing = frame < BAG.drop ? Math.sin(2 * Math.PI * (walked(frame) / (2 * STEP)) + 1) * 5 : lerp(0, -6, t);
  const [x, y] = frame < BAG.drop ? from : [from[0] + 6 * t, lerp(from[1], floor, t * t)];
  return (
    <g stroke={tint(0.5)} strokeWidth={7} strokeLinejoin="round" transform={`rotate(${swing} ${x} ${y})`}>
      {frame < BAG.drop && <path d={line([pose.shoulder, [x, y]])} strokeWidth={5} transform={`rotate(${-swing} ${x} ${y})`} />}
      <rect x={x - BAG.w / 2} y={y} width={BAG.w} height={BAG.h} rx={6} />
      <path d={`M${x - 9} ${y} V${y - 7} H${x + 9} V${y}`} strokeWidth={5} />
    </g>
  );
}

// ---------------------------------------------------------------------------------------
// The room. Light is drawn as the absence of a green tint, so it stays on palette.
const LAMP: Pt = [-21, 146];
const BOLT: Pt = [228.5, 170];
const BLANKET_AREA = "M169.5 216 V125 H269.5 A27 27 0 0 1 296.5 152 V216 Z";
const MOONLIGHT = "M306 -14 L436 -14 L268 214 L132 214 Z";
const WINDOW = { x: 300, y: -156, w: 140, h: 140 };

function Lighting({ frame }: { frame: number }) {
  const day = 1 - progress(frame, TL.morph);
  const dark = interpolate(frame, [TL.lamp, TL.lamp + 3], [0.075, 0.16], clamp) * day;
  const lampR = interpolate(frame, [TL.lamp, TL.lamp + 2], [380, 0], clamp);
  const moon = progress(frame, [TL.lamp + 3, TL.lamp + 30]);
  const flashR = interpolate(frame, [TL.flash, TL.flash + 26], [0, 1400], { ...clamp, easing: Easing.out(Easing.cubic) });
  const darken = { mixBlendMode: "darken" } as const;
  return (
    <>
      <defs>
        <radialGradient id="lampGlow"><stop offset="0" stopColor="#000" /><stop offset="0.4" stopColor="#3a3a3a" /><stop offset="1" stopColor="#fff" /></radialGradient>
        <radialGradient id="flashGlow"><stop offset="0" stopColor="#000" /><stop offset="0.7" stopColor="#000" /><stop offset="1" stopColor="#fff" /></radialGradient>
        <linearGradient id="moonShaft" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7a7a7a" /><stop offset="1" stopColor="#b8b8b8" /></linearGradient>
        <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="9" /></filter>
        <mask id="light" stroke="none" maskUnits="userSpaceOnUse" x={-5000} y={-5000} width={10000} height={10000}>
          <rect x={-5000} y={-5000} width={10000} height={10000} fill="#fff" />
          {lampR > 0 && <circle cx={LAMP[0]} cy={LAMP[1]} r={lampR} fill="url(#lampGlow)" style={darken} />}
          {moon > 0 && <path d={MOONLIGHT} fill="url(#moonShaft)" opacity={moon} filter="url(#soft)" style={darken} />}
          {flashR > 0 && <circle cx={BOLT[0]} cy={BOLT[1]} r={flashR} fill="url(#flashGlow)" style={darken} />}
        </mask>
      </defs>
      {dark > 0 && <rect x={-5000} y={-5000} width={10000} height={10000} fill={GREEN} opacity={dark} mask="url(#light)" stroke="none" />}
    </>
  );
}

function Room({ frame, p }: { frame: number; p: number }) {
  const lampOn = frame < TL.lamp;
  const night = progress(frame, [TL.lamp, TL.lamp + 6]);
  const stars = [[328, -128, 0], [356, -44, 11], [418, -52, 23], [322, -60, 31], [386, -138, 17]];
  const { x, y, w, h } = WINDOW;
  return (
    <g opacity={p}>
      {/* Wall, floor and the doorway they come in through. */}
      <path d={`M-1600 ${FLOOR - 24} H2400`} stroke={tint(0.14)} strokeWidth={4} />
      {Array.from({ length: 16 }, (_, i) => -1560 + i * 260).map(jx => <path key={jx} d={`M${jx} ${FLOOR - 24} V${FLOOR}`} stroke={tint(0.14)} strokeWidth={3} />)}
      <path d={`M-1600 ${FLOOR} H2400`} stroke={tint(0.4)} strokeWidth={5} />
      <rect x={896} y={26} width={128} height={FLOOR - 26} fill={tint(0.07)} stroke="none" />
      <path d={`M884 ${FLOOR} V14 H1036 V${FLOOR}`} stroke={tint(0.22)} strokeWidth={4} strokeLinejoin="round" />
      <path d={`M896 ${FLOOR} V26 H1024 V${FLOOR}`} stroke={tint(0.5)} strokeWidth={7} strokeLinejoin="round" />
      {/* Window, with the moon and stars. */}
      <defs><clipPath id="glass"><rect x={x} y={y} width={w} height={h} rx={8} /></clipPath></defs>
      <rect x={x} y={y} width={w} height={h} rx={8} fill={tint(lerp(0.05, 0.13, night))} stroke="none" />
      <g clipPath="url(#glass)">
        <path d="M400 -140 A18 18 0 1 0 418 -122 A14 14 0 0 1 400 -140 Z" fill={BONE} stroke={tint(0.6)} strokeWidth={4} strokeLinejoin="round" />
        <g strokeWidth={3.5} stroke={tint(0.6)}>
          {stars.map(([sx, sy, phase]) => {
            const twinkle = 0.5 + 0.5 * Math.sin((frame + phase) / 6);
            const r = 6 * twinkle;
            return <path key={phase} opacity={progress(frame, [16, 40]) * twinkle} d={`M${sx - r} ${sy} H${sx + r} M${sx} ${sy - r} V${sy + r}`} />;
          })}
        </g>
      </g>
      <rect x={x} y={y} width={w} height={h} rx={8} stroke={tint(0.5)} strokeWidth={7} />
      <path d={`M${x + w / 2} ${y} V${y + h} M${x} ${y + h / 2} H${x + w}`} stroke={tint(0.42)} strokeWidth={5} />
      <path d={`M${x - 12} ${y + h + 8} H${x + w + 12}`} stroke={tint(0.5)} strokeWidth={7} />
      {/* Bedside table and lamp. */}
      <g stroke={tint(0.55)} strokeWidth={6} strokeLinejoin="round">
        <path d="M-72 210 H30" strokeWidth={8} />
        <path d="M-64 210 V244 H22 V210" />
        <circle cx={-21} cy={227} r={3} fill={tint(0.55)} />
        <path d={`M-58 244 V${FLOOR} M16 244 V${FLOOR}`} />
        <path d="M-40 204 H-2" strokeWidth={7} />
        <path d="M-21 204 V150" />
        <path d="M-46 150 L-36 108 H-6 L4 150 Z" fill={lampOn ? BONE : tint(0.1)} />
      </g>
    </g>
  );
}

function Zs({ frame, head, r, still }: { frame: number; head: Pt; r: number; still: boolean }) {
  if (still) return null;
  const groups: number[] = frame < TL.morph[0] ? [...TL.zs] : [];
  if (frame >= INTRO_END) {
    const n = Math.floor((frame - INTRO_END) / CYCLE);
    for (const k of [n - 1, n]) if (k >= 0) TL.idleZs.forEach(o => groups.push(INTRO_END + k * CYCLE + o));
  }
  const size = Math.sqrt(r / HEAD.r);
  return (
    <g fill={GREEN} stroke="none" fontFamily="Montserrat, system-ui, sans-serif" fontWeight={600}>
      {groups.flatMap(g => [0, 1, 2].map(i => {
        const t = frame - (g + i * TL.stride);
        if (t < 0 || t > 30) return null;
        const q = t / 30;
        return (
          <text key={`${g}-${i}`} x={head[0] + r * 1.4 + (i * 26 + q * 20) * size} y={head[1] - r * 1.15 - (i * 30 + q * 44) * size}
            fontSize={(34 + i * 12) * size} opacity={interpolate(q, [0, 0.15, 0.75, 1], [0, 0.9, 0.9, 0])}>z</text>
        );
      }))}
    </g>
  );
}

function Scene({ frame, still }: { frame: number; still: boolean }) {
  const m = progress(frame, TL.morph);
  const room = progress(frame, [0, 10]) * (1 - m);
  const pose = poseAt(frame);
  const tuck = progress(frame, TL.tuck);
  const sleeping = frame >= TL.lie[1] && !still ? 1 - m : 0;
  const breath = Math.sin((2 * Math.PI * (frame - TL.lamp)) / (TL.beat * 4)) * sleeping;
  const head = mix(pose.head, [HEAD.cx, HEAD.cy], m);
  const r = lerp(BODY.head, HEAD.r, m);
  const bodyOpacity = progress(frame, [0, 8]) * (1 - progress(frame, [TL.morph[0], TL.morph[0] + 10]));
  const standing = 1 - progress(frame, TL.climb);

  const fill = progress(frame, TL.charge, chargeEase);
  const outline = progress(frame, [TL.lamp, TL.lamp + 10]) * (1 - fill);
  const boltPulse = frame < INTRO_END
    ? interpolate(frame, [TL.flash, TL.flash + 7, TL.flash + 18], [1, 1.25, 1], clamp)
    : still ? 1 : interpolate((frame - INTRO_END) % CYCLE, [0, 8, 20], [1, 1.14, 1], clamp);
  const ripple = (start: number, life: number, grow: number, alpha: number, width: number) => {
    const t = frame - start;
    if (t < 0 || t > life) return null;
    return <circle key={start} cx={BOLT[0]} cy={BOLT[1]} r={30 + t * grow} stroke={tint(alpha * (1 - t / life))} strokeWidth={width} />;
  };
  const idle = frame >= INTRO_END && !still ? INTRO_END + Math.floor((frame - INTRO_END) / CYCLE) * CYCLE : -1;

  return (
    <g fill="none" stroke={GREEN} strokeWidth={MARK.stroke} strokeLinecap="round">
      <defs>
        <clipPath id="inside"><ellipse cx={RING.cx} cy={RING.cy} rx={RING.rx} ry={RING.ry} /></clipPath>
        <clipPath id="tuck"><rect x={160} y={100} width={150 * tuck} height={130} /></clipPath>
        <mask id="cover" stroke="none" maskUnits="userSpaceOnUse" x={-500} y={-500} width={2500} height={1200}>
          <rect x={-500} y={-500} width={2500} height={1200} fill="#fff" />
          <path d={BLANKET_AREA} fill="#000" stroke="none" clipPath="url(#tuck)" />
        </mask>
      </defs>
      <Lighting frame={frame} />
      <g opacity={room} stroke="none" filter="url(#soft)">
        <ellipse cx={RING.cx} cy={FLOOR + 2} rx={150} ry={8} fill={tint(0.14)} />
        <ellipse cx={-21} cy={FLOOR + 2} rx={56} ry={6} fill={tint(0.12)} />
        <ellipse cx={pose.hip[0]} cy={FLOOR + 2} rx={34} ry={6} fill={tint(0.16 * standing * bodyOpacity)} />
      </g>
      <Room frame={frame} p={room} />

      {/* The bed, which is the logo. */}
      <ellipse cx={RING.cx} cy={RING.cy} rx={RING.rx} ry={RING.ry} pathLength={1} strokeDasharray="1 2" strokeLinecap="butt"
        strokeDashoffset={1 - progress(frame, TL.ring)} opacity={frame >= TL.ring[0] ? 1 : 0} transform={`rotate(-90 ${RING.cx} ${RING.cy})`} />
      <g clipPath="url(#inside)" strokeLinecap="butt">
        <Stroke d={PATHS.headboard} p={progress(frame, [4, 24])} />
        <Stroke d={PATHS.footpost} p={progress(frame, [8, 26])} />
        <Stroke d={PATHS.mattress} p={progress(frame, [12, 34])} />
      </g>
      <path d="M74 204 C66 188 84 182 112 184 C140 182 160 188 152 204" stroke={tint(0.5)} strokeWidth={7} fill={tint(0.05)} opacity={room} />

      <g opacity={room}><Bag frame={frame} pose={pose} /></g>
      <g opacity={bodyOpacity} mask="url(#cover)">
        <Figure pose={pose} />
      </g>

      <g transform={`translate(0 210) scale(1 ${1 + 0.018 * breath}) translate(0 -210)`}>
        <g clipPath="url(#tuck)" opacity={1 - m} stroke="none">
          <path d={BLANKET_AREA} fill={tint(0.05)} />
          <path d="M198 136 Q208 172 200 206 M238 130 Q248 168 242 206" stroke={tint(0.2)} strokeWidth={4} fill="none" />
        </g>
        <g clipPath="url(#inside)" strokeLinecap="butt">
          <Stroke d={PATHS.blanket} p={tuck} />
        </g>
      </g>
      <circle cx={head[0]} cy={head[1] - breath * 0.8} r={r} opacity={progress(frame, [0, 8])} />

      <g strokeLinejoin="round" strokeLinecap="butt" transform={`translate(${BOLT[0]} ${BOLT[1]}) scale(${boltPulse}) translate(${-BOLT[0]} ${-BOLT[1]})`}>
        <defs><clipPath id="charge"><rect x={190} y={lerp(218, 122, fill)} width={80} height={100} /></clipPath></defs>
        {outline > 0 && <path d={PATHS.bolt} stroke={tint(0.22)} opacity={outline} />}
        <g clipPath="url(#charge)"><path d={PATHS.bolt} /></g>
      </g>
      {!still && <g fill="none">
        {TL.pulses.map(b => ripple(b, 14, 4, 0.3, 4))}
        {[0, 6].map(d => ripple(TL.flash + d, 26, 11, 0.45, 5))}
        {idle >= 0 && ripple(idle, 20, 5, 0.22, 4)}
      </g>}
      <Zs frame={frame} head={head} r={r} still={still} />
    </g>
  );
}

// ---------------------------------------------------------------------------------------
function Caption({ frame, fontSize, width, still }: { frame: number; fontSize: number; width: number; still: boolean }) {
  const pct = chargeAt(frame);
  const story = [
    [0, TL.climb[0] + 2, "Heading home"],
    [TL.climb[0] + 2, TL.lamp + 2, "Settling in"],
    [TL.lamp + 2, TL.flash + 2, "Recharging"],
    [TL.flash + 2, TL.morph[0] + 14, "Fully charged"],
  ] as const;
  const fill = frame < TL.morph[0] ? pct / 100 : 1;
  const sweep = frame >= INTRO_END && !still ? ((frame - INTRO_END) % CYCLE) / CYCLE : -1;
  const reveal = progress(frame, TL.soon, Easing.linear);
  const text = "Coming soon";
  const style = { fontSize, fontWeight: 600, letterSpacing: "0.42em", paddingLeft: "0.42em", textTransform: "uppercase" as const, color: GREEN, whiteSpace: "nowrap" as const };
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: fontSize * 1.1 }}>
      <div style={{ position: "relative", height: fontSize * 1.3, width: "100%", display: "flex", justifyContent: "center" }}>
        {story.map(([from, to, label]) => {
          const o = from === 0 ? 1 - progress(frame, [to - 6, to]) : fadeWindow(frame, from, to);
          if (o <= 0) return null;
          return (
            <div key={label} style={{ ...style, position: "absolute", opacity: o * 0.9, transform: `translateY(${(1 - o) * fontSize * 0.4}px)` }}>
              {label}<span style={{ fontVariantNumeric: "tabular-nums", opacity: 0.6 }}>{"  "}{pct}%</span>
            </div>
          );
        })}
        <div style={{ ...style, position: "absolute" }}>
          {[...text].map((c, i) => {
            const start = (i / text.length) * 0.85;
            const p = interpolate(reveal, [start, start + 0.15], [0, 1], clamp);
            return <span key={i} style={{ opacity: p * 0.9, display: "inline-block", transform: `translateY(${(1 - p) * fontSize * 0.5}px)` }}>{c === " " ? "\u00a0" : c}</span>;
          })}
        </div>
      </div>
      <div style={{ position: "relative", width, height: 2, borderRadius: 2, background: tint(0.14), overflow: "hidden" }}>
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
        // Each spring starts two frames early so the letter lands on its sixteenth note.
        const p = spring({ frame: frame - (dot ? TL.dot : TL.letters + i * TL.letterStep) + 2, fps, config: dot ? { damping: 9, mass: 0.6 } : { damping: 16 } });
        const w = wave - i * TL.letterStep;
        const lift = w >= 0 && w <= TL.beat * 2 ? -Math.sin((Math.PI * w) / (TL.beat * 2)) * l.h * k * 0.06 : 0;
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

// Very faint green tints drifting behind.
function Backdrop({ frame }: { frame: number }) {
  const { width, height } = useVideoConfig();
  const size = Math.max(width, height) * 0.7;
  const t = frame / FPS;
  const blob = (x: number, y: number, alpha: number) => (
    <div style={{ position: "absolute", width: size, height: size, left: x - size / 2, top: y - size / 2, borderRadius: "50%",
      background: `radial-gradient(circle, ${tint(alpha)} 0%, ${tint(0)} 65%)` }} />
  );
  return (
    <AbsoluteFill style={{ background: BONE, overflow: "hidden" }}>
      {blob(width * (0.3 + Math.sin(t / 9) * 0.06), height * (0.35 + Math.cos(t / 11) * 0.06), 0.06)}
      {blob(width * (0.72 + Math.cos(t / 10) * 0.06), height * (0.68 + Math.sin(t / 8) * 0.06), 0.05)}
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

  // Story camera: the bed large and centred, the floor just above the caption. It tracks
  // the walker in from the door, eases in slowly while they sleep, then settles into the logo.
  const storyScale = Math.min(width * 0.56, height * 0.38, 420) / MARK.width;
  const captionTop = blockTop + LOGO.height * k + gap;
  const story = { x: width / 2, y: captionTop - gap - (FLOOR - RING.cy) * storyScale };
  const final = { x: logoLeft + RING.cx * k, y: blockTop + RING.cy * k };
  const halfView = width / 2 / storyScale;
  const lead = walkerX(frame) - 0.7 * halfView;
  const follow = (RING.cx + lead + Math.hypot(RING.cx - lead, 60)) / 2; // a soft max(bed, walker)
  const camX = lerp(follow, RING.cx, progress(frame, [STOP - 8, TL.climb[1]]));
  const m = progress(frame, TL.morph);
  const push = 1 + 0.06 * progress(frame, [TL.lamp, TL.flash], Easing.inOut(Easing.sin));
  const scale = lerp(storyScale * push, k, m);
  const cx = lerp(story.x, final.x, m);
  const cy = lerp(story.y, final.y, m);

  return (
    <AbsoluteFill style={{ fontFamily: "Montserrat, system-ui, sans-serif" }}>
      <Backdrop frame={frame} />
      <svg width={width} height={height} style={{ position: "absolute", inset: 0, overflow: "visible" }}>
        <g transform={`translate(${cx - lerp(camX, RING.cx, m) * scale} ${cy - RING.cy * scale}) scale(${scale})`}>
          <Scene frame={frame} still={still} />
        </g>
      </svg>
      <Wordmark frame={frame} k={k} left={logoLeft} top={blockTop} still={still} />
      <div style={{ position: "absolute", left: 0, right: 0, top: captionTop, display: "flex", justifyContent: "center" }}>
        <Caption frame={frame} fontSize={fontSize} width={fontSize * 13} still={still} />
      </div>
      <div style={{ position: "absolute", bottom: 24, width: "100%", textAlign: "center", fontSize: 12, fontWeight: 500,
        letterSpacing: "0.04em", color: GREEN, opacity: progress(frame, [TL.dot - 10, TL.dot + 16]) * 0.55 }}>
        © {new Date().getFullYear()} Recharge Group
      </div>
    </AbsoluteFill>
  );
}
