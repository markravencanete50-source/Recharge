import { env } from "cloudflare:workers";

export type MyRechargeData = {
  available: boolean;
  openEntry: { id: number; clockIn: number } | null;
  recentEntries: Array<{
    id: number;
    clockIn: number;
    clockOut: number | null;
  }>;
  schedule: Array<{
    id: number;
    shiftDate: string;
    startTime: string;
    endTime: string;
    label: string;
  }>;
  performance: {
    hoursThisWeek: number;
    daysClocked: number;
    completedShifts: number;
  };
};

function database() {
  if (!env.DB) throw new Error("Recharge workspace database is unavailable");
  return env.DB;
}

export async function getMyRechargeData(email: string): Promise<MyRechargeData> {
  const normalised = email.trim().toLowerCase();
  const now = new Date();
  const monday = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - ((now.getUTCDay() + 6) % 7),
    ),
  );
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const finalDay = new Date(today);
  finalDay.setUTCDate(finalDay.getUTCDate() + 6);

  try {
    const db = database();
    const [openEntry, entries, schedule, performance] = await Promise.all([
      db
        .prepare(
          "SELECT id, clock_in FROM time_entries WHERE email = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1",
        )
        .bind(normalised)
        .first<{ id: number; clock_in: number }>(),
      db
        .prepare(
          "SELECT id, clock_in, clock_out FROM time_entries WHERE email = ? ORDER BY clock_in DESC LIMIT 7",
        )
        .bind(normalised)
        .all<{ id: number; clock_in: number; clock_out: number | null }>(),
      db
        .prepare(
          "SELECT id, shift_date, start_time, end_time, label FROM work_schedules WHERE email = ? AND status = 'scheduled' AND shift_date BETWEEN ? AND ? ORDER BY shift_date, start_time",
        )
        .bind(normalised, isoDate(today), isoDate(finalDay))
        .all<{
          id: number;
          shift_date: string;
          start_time: string;
          end_time: string;
          label: string;
        }>(),
      db
        .prepare(
          "SELECT COALESCE(SUM(COALESCE(clock_out, unixepoch()) - clock_in), 0) AS seconds_worked, COUNT(DISTINCT date(clock_in, 'unixepoch')) AS days_clocked, SUM(CASE WHEN clock_out IS NOT NULL THEN 1 ELSE 0 END) AS completed_shifts FROM time_entries WHERE email = ? AND clock_in >= ?",
        )
        .bind(normalised, Math.floor(monday.getTime() / 1000))
        .first<{
          seconds_worked: number;
          days_clocked: number;
          completed_shifts: number;
        }>(),
    ]);

    return {
      available: true,
      openEntry: openEntry
        ? { id: openEntry.id, clockIn: openEntry.clock_in }
        : null,
      recentEntries: entries.results.map((entry) => ({
        id: entry.id,
        clockIn: entry.clock_in,
        clockOut: entry.clock_out,
      })),
      schedule: schedule.results.map((shift) => ({
        id: shift.id,
        shiftDate: shift.shift_date,
        startTime: shift.start_time,
        endTime: shift.end_time,
        label: shift.label,
      })),
      performance: {
        hoursThisWeek: Number(((performance?.seconds_worked || 0) / 3600).toFixed(1)),
        daysClocked: Number(performance?.days_clocked || 0),
        completedShifts: Number(performance?.completed_shifts || 0),
      },
    };
  } catch (error) {
    console.error("Unable to load My Recharge", error);
    return emptyMyRechargeData(false);
  }
}

export async function updateClock(email: string, action: "clock_in" | "clock_out") {
  const normalised = email.trim().toLowerCase();
  const db = database();
  const openEntry = await db
    .prepare(
      "SELECT id FROM time_entries WHERE email = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1",
    )
    .bind(normalised)
    .first<{ id: number }>();

  if (action === "clock_in") {
    if (!openEntry) {
      await db
        .prepare(
          "INSERT INTO time_entries (email, clock_in, created_at) VALUES (?, unixepoch(), unixepoch())",
        )
        .bind(normalised)
        .run();
    }
  } else {
    if (!openEntry) throw new Error("No active clock-in was found");
    await db
      .prepare("UPDATE time_entries SET clock_out = unixepoch() WHERE id = ? AND email = ?")
      .bind(openEntry.id, normalised)
      .run();
  }

  return getMyRechargeData(normalised);
}

function emptyMyRechargeData(available: boolean): MyRechargeData {
  return {
    available,
    openEntry: null,
    recentEntries: [],
    schedule: [],
    performance: { hoursThisWeek: 0, daysClocked: 0, completedShifts: 0 },
  };
}

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}
