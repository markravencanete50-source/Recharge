import { useCallback, useEffect, useMemo, useState } from "react";
import { message } from "./LiveKit";
import { BusinessFigures, NeedsList } from "./HomeFocus";
import { readTeams } from "./backend/client";
import { accountsNeeds, cleanerNeeds, cleaningManagerNeeds, readyNeeds, staysNeeds, type NeedLine, type NeedOpen } from "../../lib/home-needs";
import { ATTENTION_SHOWN } from "../../lib/home-overview";
import { roleFigures, roleHomeQuery, roleHomeSchema, type RoleHome as RoleHomeData, type RoleHomeRole } from "../../lib/role-home";
import { monthPay, performanceSchema } from "../../lib/cleans-live";
import type { Palette } from "./theme";

// Each role's Home, laid out as management's (Lee: what we applied for the super admin, applied to every role): their
// figures at a glance, then "Needs you now", six lines and "See all" for the rest, each opening where the work is done.
// One read (workspace_role_home) answers for the person's role; the database counts only what that role may open.
// `role` is the account's role, so View as (a super admin previewing a role) shows exactly that role's Home.
const NEEDS: Record<RoleHomeRole, (h: RoleHomeData, followUps: number) => NeedLine[]> = {
  stays: staysNeeds, cleaning_manager: h => cleaningManagerNeeds(h), cleans: h => cleanerNeeds(h), ready: h => readyNeeds(h), accounts: h => accountsNeeds(h),
};

export function RoleHome({ palette: p, desktop, role, followUps = 0, onOpen, onPlace }: { palette: Palette; desktop: boolean; role: RoleHomeRole; followUps?: number; onOpen: (line: NeedLine) => void; onPlace: (open: NeedOpen) => void }) {
  const [home, setHome] = useState<RoleHomeData | null>(null);
  const [error, setError] = useState("");
  // Cleaners: their pay this month, the same figure as Work, Cleans, Your month.
  const [pay, setPay] = useState<{ label: string; detail: string } | null>(null);
  const load = useCallback(async () => {
    const [h, perf] = await Promise.allSettled([
      readTeams(roleHomeQuery(role)).then(r => roleHomeSchema.parse(r.data)),
      role === "cleans" ? readTeams({ section: "performance" }).then(r => performanceSchema.parse(r.data)[0]) : Promise.resolve(undefined),
    ]);
    if (h.status === "fulfilled") { setHome(h.value); setError(""); } else setError(message(h.reason));
    if (role === "cleans" && perf.status === "fulfilled") { const m = monthPay(perf.value); setPay({ label: m.label, detail: m.detail }); }
  }, [role]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  // A Home read for another role (View as switched) is never shown.
  const current = home && home.role === role ? home : null;
  const lines = useMemo(() => current ? NEEDS[role](current, followUps) : [], [current, role, followUps]);
  const figures = useMemo(() => current ? roleFigures(current, { payLabel: pay?.label ?? null, payDetail: pay?.detail }) : [], [current, pay]);
  const loading = !current && !error;
  return (
    <>
      {figures.length > 0 && <BusinessFigures palette={p} title="At a glance" figures={figures} desktop={desktop} loading={loading} onOpen={f => onPlace(f.open)} />}
      <NeedsList palette={p} limit={ATTENTION_SHOWN} lines={lines} loading={loading} error={error} onOpen={onOpen} />
    </>
  );
}
