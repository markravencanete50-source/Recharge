// A small street of Scottish houses for the foot of the sign-in brand panel. The windows light up
// one by one, chimney smoke rises, clouds drift past a moon and a charging bolt pulses over the
// street. All of it is plain SVG moved by CSS (see .auth-scene in globals.css), so it costs no
// script, and it stands still, with every window lit, for anyone who asks for reduced motion.
type House = { x: number; w: number; h: number; wall: string; roof: string; kind: "gable" | "flat"; chimney?: boolean; delay: number };
const GROUND = 124;
const FRONT: House[] = [
  { x: 6, w: 64, h: 62, wall: "#E9DDC4", roof: "#2C3F45", kind: "gable", chimney: true, delay: 0.3 },
  { x: 74, w: 52, h: 82, wall: "#CFD9C8", roof: "#34484D", kind: "flat", delay: 1.6 },
  { x: 130, w: 70, h: 70, wall: "#D8C3A5", roof: "#5A3B35", kind: "gable", chimney: true, delay: 0.9 },
  { x: 204, w: 54, h: 90, wall: "#F0E6D2", roof: "#2C3F45", kind: "flat", delay: 2.4 },
  { x: 262, w: 66, h: 64, wall: "#C9B79C", roof: "#3B2F33", kind: "gable", chimney: true, delay: 1.2 },
  { x: 332, w: 62, h: 60, wall: "#DDE3D2", roof: "#34484D", kind: "gable", delay: 2.0 },
];
const BACK = [{ x: 40, w: 46, h: 96 }, { x: 108, w: 50, h: 104 }, { x: 178, w: 44, h: 98 }, { x: 236, w: 52, h: 108 }, { x: 306, w: 48, h: 100 }];
const STARS = [[28, 14], [66, 30], [150, 8], [158, 26], [214, 12], [268, 30], [318, 14], [372, 28], [96, 44], [292, 52]] as const;

function Windows({ h: house, seed }: { h: House; seed: number }) {
  const cols = Math.max(2, Math.floor(house.w / 22)), rows = Math.max(1, Math.floor((house.h - 30) / 24)), gap = house.w / cols, out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = house.x + gap * c + gap / 2 - 5, y = GROUND - house.h + 14 + r * 24, d = house.delay + (r * cols + c) * 0.35 + seed * 0.2;
    out.push(<g key={`${r}-${c}`}><rect x={x} y={y} width={10} height={13} rx={1.5} fill="#244746" /><rect className="auth-win" x={x} y={y} width={10} height={13} rx={1.5} fill="#FFD98A" style={{ ["--d" as string]: `${d.toFixed(2)}s` }} /></g>);
  }
  return <>{out}</>;
}

export function AuthScene() {
  return (
    <svg className="auth-scene" viewBox={`0 -16 400 ${GROUND + 40}`} preserveAspectRatio="xMidYMax meet" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="auth-moon-glow"><stop offset="0" stopColor="#F5F1D8" stopOpacity=".5" /><stop offset="1" stopColor="#F5F1D8" stopOpacity="0" /></radialGradient>
        <radialGradient id="auth-lamp-glow"><stop offset="0" stopColor="#FFD98A" stopOpacity=".6" /><stop offset="1" stopColor="#FFD98A" stopOpacity="0" /></radialGradient>
      </defs>
      {STARS.map(([x, y], i) => <circle key={i} className="auth-star" cx={x} cy={y} r={i % 3 === 0 ? 1.4 : 1} fill="#F3F7EE" style={{ ["--d" as string]: `${(i * 0.7).toFixed(1)}s` }} />)}
      <circle cx={356} cy={20} r={26} fill="url(#auth-moon-glow)" />
      <path d="M356 9.5A10.5 10.5 0 1 0 366.2 22.6A8.6 8.6 0 0 1 356 9.5Z" fill="#F5F1D8" />
      <g className="auth-cloud" style={{ ["--d" as string]: "-8s", ["--t" as string]: "52s" }}><ellipse cx={0} cy={40} rx={22} ry={6} fill="#A7D9C1" opacity={0.2} /><ellipse cx={14} cy={35} rx={14} ry={7} fill="#A7D9C1" opacity={0.2} /></g>
      <g className="auth-cloud" style={{ ["--d" as string]: "-30s", ["--t" as string]: "70s" }}><ellipse cx={0} cy={62} rx={26} ry={6} fill="#A7D9C1" opacity={0.14} /><ellipse cx={-12} cy={57} rx={14} ry={7} fill="#A7D9C1" opacity={0.14} /></g>
      <path d={`M0 ${GROUND - 40}Q70 ${GROUND - 76} 150 ${GROUND - 52}T310 ${GROUND - 60}T400 ${GROUND - 44}V${GROUND}H0Z`} fill="#24493F" />
      {BACK.map(b => <rect key={b.x} x={b.x} y={GROUND - b.h} width={b.w} height={b.h} fill="#2A5448" />)}
      {FRONT.map((h, i) => {
        const top = GROUND - h.h, mid = h.x + h.w / 2;
        return (
          <g key={h.x}>
            {h.chimney && <rect x={h.x + h.w * 0.68} y={top - h.w * 0.46} width={7} height={h.w * 0.4} fill="#6B574C" />}
            {h.chimney && [0, 1, 2].map(s => <circle key={s} className="auth-smoke" cx={h.x + h.w * 0.68 + 3.5} cy={top - h.w * 0.46} r={3} fill="#E8EFE4" style={{ ["--d" as string]: `${(s * 1.3 + i * 0.4).toFixed(1)}s` }} />)}
            <rect x={h.x} y={top} width={h.w} height={h.h} fill={h.wall} />
            {h.kind === "gable"
              ? <polygon points={`${h.x - 4},${top + 1} ${mid},${top - h.w * 0.4} ${h.x + h.w + 4},${top + 1}`} fill={h.roof} />
              : <rect x={h.x - 2} y={top - 5} width={h.w + 4} height={7} fill={h.roof} />}
            <Windows h={h} seed={i} />
            <rect x={mid - 6} y={GROUND - 22} width={12} height={22} rx={6} ry={2} fill="#2F5A52" />
            <circle cx={mid + 3} cy={GROUND - 10} r={0.9} fill="#FFD98A" />
          </g>
        );
      })}
      <rect x={0} y={GROUND} width={400} height={24} fill="#16312C" />
      <rect x={0} y={GROUND} width={400} height={2} fill="#A7D9C1" opacity={0.25} />
      <g><circle className="auth-lamp" cx={201} cy={GROUND - 42} r={22} fill="url(#auth-lamp-glow)" /><rect x={200} y={GROUND - 40} width={2} height={40} fill="#5E7F73" /><circle cx={201} cy={GROUND - 42} r={3} fill="#FFD98A" /></g>
      <g className="auth-bolt" transform={`translate(${104} ${19})`}>
        <circle className="auth-bolt-ring" r={14} fill="none" stroke="#A7D9C1" strokeWidth={1.4} />
        <circle r={12} fill="#76AD49" />
        <path d="M2 -7.5L-5 1.5H-0.5L-2 7.5L5 -1.5H0.5Z" fill="#FAF7F0" />
      </g>
    </svg>
  );
}
