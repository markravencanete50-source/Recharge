import { useCallback, useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { Entrance, GrowBar, MotionPress, Stagger } from "./motion";
import { dayLabel, IconChip, Loading, message, Notice, Tag, type IconName } from "./LiveKit";
import { PropertyAccess } from "./LiveTools";
import { ui, type Palette } from "./theme";
import { readTeams } from "./backend/client";
import { scheduleSchema } from "../../lib/cleans-live";
import { boardJobs, boardRole, bucketJobs, byCleaner, jobAction, jobsFor, jobWindow, londonDay, nextUp, progressLabel, progressOf, shiftDay, type BoardJob } from "../../lib/today-board";
import { plural } from "../../lib/format";
import type { HomeToolTarget } from "../../lib/home-tools";
import type { OperationView } from "../../lib/workflow-forms";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import type { PropertyView } from "../../lib/workspace-view";

// Home for cleaners, cleaning managers and Ready: today's jobs in the order they are done, with
// Tomorrow for getting ready and Overdue when something was missed. One button on each job opens
// it where the work happens. Cleaning managers see their team's day, by cleaner.
type Bucket = "today" | "tomorrow" | "overdue";
const ICON: Record<BoardJob["type"], IconName> = { clean: "droplet", repair: "tool", visit: "repeat", other: "clipboard" };
const TYPE_LABEL: Record<BoardJob["type"], string> = { clean: "Clean", repair: "Repair", visit: "Routine visit", other: "Job" };
const STATUS: Record<string, [string, "good" | "wait" | "bad" | "plain"]> = { waiting: ["To do", "plain"], in_progress: ["In progress", "wait"], in_review: ["Submitted", "good"], approved: ["Done", "good"], completed: ["Done", "good"] };
const statusOf = (job: BoardJob, manager: boolean): [string, "good" | "wait" | "bad" | "plain"] =>
  job.redo ? ["Redo", "bad"] : manager && !job.assigneeId && !job.done ? ["Needs a cleaner", "bad"] : STATUS[job.status] ?? [job.status.replace(/_/g, " "), "plain"];

// Where the job's button goes: the clean or repair opens straight away in Work.
const targetOf = (job: BoardJob): HomeToolTarget => job.type === "clean" ? { kind: "work", view: "cleans", workId: job.workId } : job.type === "other" ? { kind: "work", view: "all" } : { kind: "work", view: "repairs", workId: job.workId };
function guestsLine(job: BoardJob) {
  if (job.type !== "clean") return "";
  return [job.guestsLeaving ? `${plural(job.guestsLeaving, "guest")} leaving` : "", job.sameDay ? `${job.arrivingGuests ? plural(job.arrivingGuests, "guest") : "Guests"} arriving today` : ""].filter(Boolean).join(" · ");
}

export function TodayBoard({ palette: p, account, properties, work, desktop, onTool }: { palette: Palette; account: WorkspaceAccount; properties: PropertyView[]; work: OperationView[]; desktop: boolean; onTool: (target: HomeToolTarget) => void }) {
  const role = boardRole(account.role)!;
  const manager = role === "cleaning_manager";
  const today = londonDay(new Date());
  const [rows, setRows] = useState<{ schedule: ReturnType<typeof scheduleSchema.parse> } | null>(null);
  const [error, setError] = useState("");
  const [bucket, setBucket] = useState<Bucket>("today");
  const load = useCallback(async () => {
    // Three weeks either side: overdue jobs, today, tomorrow and the next job after an empty day.
    const query: Record<string, string> = { section: "schedule", from: shiftDay(today, -21), to: shiftDay(today, 21) };
    if (role === "cleans") query.userId = account.userId;
    try { setRows({ schedule: scheduleSchema.parse((await readTeams(query)).data) }); setError(""); }
    catch (e) { setError(message(e)); }
  }, [today, role, account.userId]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);

  const buckets = useMemo(() => {
    if (!rows) return null;
    const names = new Map([...properties.map(x => [x.id, x.name] as const), ...rows.schedule.work.map(w => [w.propertyId, w.propertyName] as const)]);
    const ops = work.map(o => ({ ...o, propertyName: names.get(o.propertyId) ?? o.title, dueOn: o.dueOn ?? null }));
    return bucketJobs(jobsFor(boardJobs(rows.schedule.work, ops, rows.schedule.cleanGuests ?? []), role, account.userId), today);
  }, [rows, properties, work, role, account.userId, today]);
  const overdue = buckets?.overdue.length ?? 0;
  // Overdue only shows while something is overdue.
  const active: Bucket = bucket === "overdue" && !overdue ? "today" : bucket;
  const list = buckets ? buckets[active] : [];
  const next = active === "today" && !manager ? nextUp(list) : null;
  const rest = next ? list.filter(job => job.workId !== next.workId) : list;
  const open = (job: BoardJob) => onTool(targetOf(job));

  const segments: [Bucket, string, number][] = [["today", "Today", buckets?.today.length ?? 0], ["tomorrow", "Tomorrow", buckets?.tomorrow.length ?? 0], ...(overdue ? [["overdue", "Overdue", overdue] as [Bucket, string, number]] : [])];
  const { done, total } = progressOf(list);
  return (
    <Entrance sessionKey="live:home:today-board" style={{ gap: 12 }}>
      <View style={[ui.between, { gap: 10 }]}>
        <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text, flex: 1 }]}>{manager ? "Your team's day" : "Your day"}</Text>
        <MotionPress accessibilityRole="button" accessibilityLabel="Refresh your day" onPress={() => void load()} style={[ui.row, { minHeight: 44, gap: 6, paddingLeft: 12 }]}>
          <Feather name="refresh-cw" size={14} color={p.primary} />
          <Text style={[ui.small, { color: p.primary, fontWeight: "600" }]}>{dayLabel(today)}</Text>
        </MotionPress>
      </View>
      <View accessibilityRole="tablist" style={{ flexDirection: "row", gap: 4, padding: 4, borderRadius: 999, backgroundColor: p.wash, alignSelf: desktop ? "flex-start" : "stretch" }}>
        {segments.map(([key, label, count]) => {
          const on = active === key, late = key === "overdue";
          return (
            <MotionPress key={key} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={`${label}, ${plural(count, "job")}`} onPress={() => setBucket(key)}
              style={[ui.row, { flexGrow: 1, flexBasis: 0, minWidth: desktop ? 120 : 0, justifyContent: "center", gap: 6, minHeight: 40, paddingHorizontal: 12, borderRadius: 999, backgroundColor: on ? p.primary : "transparent" }]}>
              <Text numberOfLines={1} style={{ color: on ? p.onPrimary : p.text, fontSize: 13, fontWeight: "700" }}>{label}</Text>
              <View style={{ minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: late ? p.danger : on ? p.onPrimary : p.surface }}>
                <Text style={{ color: late ? p.onPrimary : p.primary, fontSize: 11, fontWeight: "700", fontVariant: ["tabular-nums"] }}>{count}</Text>
              </View>
            </MotionPress>
          );
        })}
      </View>
      {!buckets && !error && <Loading p={p} rows={2} />}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {buckets && <>
        {active !== "overdue" && total > 0 && <View style={[ui.row, { gap: 10 }]}>
          <GrowBar share={total ? done / total : 0} color={p.success} track={p.wash} height={8} />
          <Text style={[ui.small, { color: p.muted, fontVariant: ["tabular-nums"] }]}>{progressLabel(list, active === "today" ? "today" : "tomorrow")}</Text>
        </View>}
        {active === "overdue" && <Text style={[ui.small, { color: p.muted }]}>Past their day and not finished yet. Do these first, or tell your manager.</Text>}
        {next && <NextUp p={p} account={account} job={next} today={today} onOpen={() => open(next)} />}
        {!list.length && <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 6, alignItems: "flex-start" }]}>
          <Feather name="sun" size={22} color={p.primary} />
          <Text style={{ color: p.text, fontWeight: "700", fontSize: 15 }}>{active === "today" ? "Nothing booked for today" : "Nothing booked for tomorrow"}</Text>
          <Text style={[ui.small, { color: p.muted }]}>{buckets.next ? `Next job: ${dayLabel(buckets.next.dueOn)} · ${buckets.next.propertyName}` : "No jobs booked in the next three weeks."}</Text>
        </View>}
        {!!list.length && (manager
          ? byCleaner(list).map((group, g) => (
            <Stagger key={group.assigneeId ?? "none"} index={g}>
              <View style={{ gap: 6 }}>
                <View style={[ui.between, { gap: 8 }]}>
                  <Text style={{ color: group.assigneeId ? p.text : p.danger, fontWeight: "700" }}>{group.name}</Text>
                  <Text style={[ui.small, { color: p.muted, fontVariant: ["tabular-nums"] }]}>{active === "overdue" ? plural(group.jobs.length, "clean") : `${progressOf(group.jobs).done} of ${group.jobs.length} done`}</Text>
                </View>
                <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, paddingVertical: 4, gap: 0 }]}>
                  {group.jobs.map((job, i) => <JobRow key={job.workId} p={p} job={job} first={i === 0} manager today={today} onOpen={() => open(job)} />)}
                </View>
              </View>
            </Stagger>
          ))
          // The next job already has its own card above, so the list shows the rest of the day.
          : rest.length > 0 && <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, paddingVertical: 4, gap: 0 }]}>
            {rest.map((job, i) => <JobRow key={job.workId} p={p} job={job} first={i === 0} manager={false} today={today} onOpen={() => open(job)} />)}
          </View>)}
      </>}
    </Entrance>
  );
}

function NextUp({ p, account, job, today, onOpen }: { p: Palette; account: WorkspaceAccount; job: BoardJob; today: string; onOpen: () => void }) {
  const action = jobAction(job), guests = guestsLine(job);
  return (
    <View style={[ui.card, { gap: 10, backgroundColor: p.surface, borderColor: p.primary, borderWidth: 2 }]}>
      <View style={[ui.row, { gap: 12 }]}>
        <IconChip icon={ICON[job.type]} tone={job.type === "clean" ? "cleans" : "ready"} p={p} size={44} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={{ color: p.primary, fontSize: 12, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" }}>Next up</Text>
          <Text numberOfLines={2} style={{ color: p.text, fontSize: 17, fontWeight: "700" }}>{job.propertyName}</Text>
          <Text numberOfLines={2} style={[ui.small, { color: p.muted }]}>{[TYPE_LABEL[job.type], jobWindow(job, today), job.type !== "clean" ? job.title : ""].filter(Boolean).join(" · ")}</Text>
        </View>
      </View>
      {(job.sameDay || !!guests) && <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
        {job.sameDay && <Tag label="Same-day turnover" tone="wait" p={p} />}
        {!!guests && <Text style={[ui.small, { color: p.muted }]}>{guests}</Text>}
      </View>}
      <MotionPress accessibilityRole="button" accessibilityLabel={`${action}: ${job.propertyName}`} onPress={onOpen} style={[ui.button, { backgroundColor: p.primary }]}>
        <Feather name={action === "Start" ? "play" : "arrow-right"} size={16} color={p.onPrimary} />
        <Text style={[ui.buttonText, { color: p.onPrimary }]}>{action}</Text>
      </MotionPress>
      {/* Entry details and logins, for the roles that may read them (not cleaners). */}
      <PropertyAccess key={job.propertyId} palette={p} account={account} propertyId={job.propertyId} />
    </View>
  );
}

function JobRow({ p, job, first, manager, today, highlight = false, onOpen }: { p: Palette; job: BoardJob; first: boolean; manager: boolean; today: string; highlight?: boolean; onOpen: () => void }) {
  const action = jobAction(job, manager), [label, tone] = statusOf(job, manager), guests = guestsLine(job);
  const when = job.dueOn < today ? dayLabel(job.dueOn) : jobWindow(job, today);
  return (
    <MotionPress accessibilityRole="button" accessibilityLabel={`${job.propertyName}, ${TYPE_LABEL[job.type]}, ${when}, ${label}. ${action}`} onPress={onOpen}
      style={[ui.row, { gap: 12, paddingVertical: 12, paddingHorizontal: highlight ? 8 : 0, marginHorizontal: highlight ? -8 : 0, borderRadius: highlight ? 12 : 0, backgroundColor: highlight ? p.wash : "transparent", borderTopWidth: first ? 0 : 1, borderColor: p.border, opacity: job.done ? 0.7 : 1 }]}>
      <IconChip icon={job.done ? "check" : ICON[job.type]} tone={job.type === "clean" ? "cleans" : "ready"} p={p} size={38} />
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text numberOfLines={1} style={[ui.small, { color: job.dueOn < today ? p.danger : p.muted, fontWeight: "700" }]}>{when}</Text>
        <Text numberOfLines={1} style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>{job.propertyName}</Text>
        <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>
          <Tag label={label} tone={tone} p={p} />
          {job.sameDay && <Tag label="Same-day" tone="wait" p={p} />}
          {manager && !!job.assigneeId && <Text style={[ui.small, { color: p.muted }]}>{job.assigneeName ?? "Cleaner"}</Text>}
          {!manager && job.type !== "clean" && <Text numberOfLines={1} style={[ui.small, { color: p.muted, flexShrink: 1 }]}>{job.title}</Text>}
        </View>
        {!!guests && <Text numberOfLines={1} style={[ui.small, { color: p.muted }]}>{guests}</Text>}
      </View>
      <View style={{ minHeight: 36, paddingHorizontal: 12, borderRadius: 999, justifyContent: "center", backgroundColor: action === "Open" ? p.wash : p.primary }}>
        <Text style={{ color: action === "Open" ? p.primary : p.onPrimary, fontSize: 13, fontWeight: "700" }}>{action}</Text>
      </View>
    </MotionPress>
  );
}
