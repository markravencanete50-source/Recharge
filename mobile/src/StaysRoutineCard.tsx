import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { TodaysRoutine } from "./StaysRoutine";
import { addDays, london } from "./LiveKit";
import { readTeams } from "./backend/client";
import { scheduleSchema } from "../../lib/cleans-live";
import type { SectionProps } from "./SectionProps";

// "Today's routine" at the top of Guest relations, for Stays and admins: listing checks, empty nights to
// price, repairs to refer, cleans, AirCover claims and direct-booking offers, each one tap from where it is
// done. It reads the schedule itself (arrivals, departures and cleans) and takes the work list from the host.
// A role that holds none of those tools sees nothing.
type Schedule = z.infer<typeof scheduleSchema>;
export const ROUTINE_ROLES = ["stays", "admin", "super_admin"] as const;

export function StaysRoutineCard({ palette: p, account, properties, work }: Pick<SectionProps, "palette" | "account" | "properties" | "work">) {
  const eligible = (ROUTINE_ROLES as readonly string[]).includes(account.role);
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
