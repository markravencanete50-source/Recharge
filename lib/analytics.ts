import type { WorkflowData } from "./workflows";
import type { MaintenanceData } from "./maintenance-types";
import type { CleansData } from "./cleans-types";

export type AnalyticsInput = { workflows?: WorkflowData; maintenance?: MaintenanceData; cleans?: CleansData };

export function buildWorkspaceAnalytics(input: AnalyticsInput, days: number, now = Date.now()) {
  const end = new Date(now); end.setHours(23, 59, 59, 999);
  const start = new Date(end); start.setDate(start.getDate() - days + 1); start.setHours(0, 0, 0, 0);
  const inRange = (seconds: number) => seconds * 1000 >= start.getTime() && seconds * 1000 <= end.getTime();
  const workflows = (input.workflows?.tickets || []).filter(t => inRange(t.createdAt));
  const repairs = (input.maintenance?.tickets || []).filter(t => inRange(t.createdAt));
  const cleans = (input.cleans?.tickets || []).filter(t => {
    const date = new Date(`${t.cleanDate}T12:00:00`).getTime();
    return date >= start.getTime() && date <= end.getTime();
  });
  const complete = workflows.filter(t => t.status === "complete").length + repairs.filter(t => ["closed", "reconciled"].includes(t.status)).length + cleans.filter(t => ["approved", "invoiced"].includes(t.status)).length;
  const waiting = workflows.filter(t => t.status === "new").length + repairs.filter(t => ["new", "quote_required", "approval_pending"].includes(t.status)).length + cleans.filter(t => ["new", "scheduled", "unassigned"].includes(t.status)).length;
  const total = workflows.length + repairs.length + cleans.length;
  const status = [{ name: "Waiting", value: waiting }, { name: "In progress", value: total - waiting - complete }, { name: "Complete", value: complete }];
  const trend = Array.from({ length: days }, (_, i) => {
    const day = new Date(start); day.setDate(day.getDate() + i);
    const from = day.getTime() / 1000, to = from + 86400;
    return { date: day.toLocaleDateString("en-GB", { day: "numeric", month: "short" }), workflows: workflows.filter(t => t.createdAt >= from && t.createdAt < to).length, repairs: repairs.filter(t => t.createdAt >= from && t.createdAt < to).length };
  });
  const queues = [{ name: "Workflows", value: workflows.length }, { name: "Maintenance", value: repairs.length }, { name: "Cleans", value: cleans.length }];
  const sources = [{ name: "Workflow boards", available: input.workflows?.available === true }, { name: "Maintenance", available: input.maintenance?.available === true }, { name: "Cleans", available: input.cleans?.available === true }];
  return { total, complete, waiting, status, trend, queues, sources };
}
