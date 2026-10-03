"use client";
import { useState } from "react";
import { Building2 } from "lucide-react";
const crops = {
  cleans: [20, 235, 405, 365], ready: [446, 225, 434, 365],
  stays: [882, 102, 410, 505], clients: [1320, 211, 390, 385], accounts: [1730, 162, 438, 444],
} as const;
export function DepartmentIllustration({ department }: { department: keyof typeof crops }) {
  const [failed, setFailed] = useState(false);
  const [x, y, width, height] = crops[department];
  const scale = 94 / Math.max(width, height);
  return <span className="department-illustration" aria-hidden="true">{failed ? <Building2 /> : <img src="/recharge-departments-v2.png" alt="" width="2172" height="724" decoding="async" draggable={false} onError={() => setFailed(true)} style={{ width: `${2172 * scale}%`, height: `${724 * scale}%`, left: `${(100 - width * scale) / 2 - x * scale}%`, top: `${(100 - height * scale) / 2 - y * scale}%`, clipPath: `inset(${y / 724 * 100}% ${(2172 - x - width) / 2172 * 100}% ${(724 - y - height) / 724 * 100}% ${x / 2172 * 100}%)` }} />}</span>;
}
