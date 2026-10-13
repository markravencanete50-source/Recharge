import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { TodaysRoutine } from "./StaysRoutine";
import { addDays, london } from "./LiveKit";
import { readTeams } from "./backend/client";
import { scheduleSchema } from "../../lib/cleans-live";
import type { SectionProps } from "./SectionProps";

// "Today's routine" for Guest relations staff and admins, each part one tap from where it is done. It reads
// the schedule itself (arrivals, departures and cleans) and takes the work list from the host.
//   part "guests"   top of Guest relations: repairs to refer, cleans, AirCover claims, direct-booking offers
//                   and the Monday owner reports
//   part "clients"  top of Client relations: listing checks and empty nights to price
// TodaysRoutine draws a part only for someone holding its tool, so each card hides the other card's tools.
// A role that holds none of them sees nothing.
type Schedule = z.infer<typeof scheduleSchema>;
export const ROUTINE_ROLES = ["stays", "admin", "super_admin"] as const;
const CLIENT_TOOLS: readonly string[] = ["listing-health", "daily-pricing"];

export function StaysRoutineCard({ palette: p, account: person, properties, work, part = "guests" }: Pick<SectionProps, "palette" | "account" | "properties" | "work"> & { part?: "guests" | "clients" }) {
  const eligible = (ROUTINE_ROLES as readonly string[]).includes(person.role);
  // The person with only this card's tools, so TodaysRoutine leaves out the other card's parts.
  const account = useMemo(() => ({ ...person, modules: person.modules.filter(m => CLIENT_TOOLS.includes(m) === (part === "clients")) }), [person, part]);
  const [today] = useState(() => london(new Date()));
  const [schedule, setSchedule] = useState<Schedule>({ work: [], stays: [] });
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    try { setSchedule(scheduleSchema.parse((await readTeams({ section: "schedule", from: addDays(today, -1), to: addDays(today, 30) })).data)); } catch { /* the card shows what it can */ }
    setLoading(false);
  }, [today]);
  useEffect(() => { if (!eligible) return; let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [eligible, load]);
  if (!eligible) return null;
  return <TodaysRoutine p={p} account={account} properties={properties} operations={work} schedule={schedule} today={today} loading={loading} />;
}
