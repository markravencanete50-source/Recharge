import { z } from "zod";
import type { AnalyticsSnapshot } from "./analytics";
import { parseAnalyticsDate, presetPeriod } from "./analytics";
import { analyticsCsv, analyticsFilename } from "./analytics-export";
import { isWorkspaceAdmin } from "./modules";
import { businessContext, businessResponse, databaseFailure, viewAsFailure } from "./business-server";
import { reportPeriodSchema } from "./business-policy";

const reportSchema = z.object({
  propertyCount: z.number().int().nonnegative(),
  series: z.array(z.object({ source: z.enum(["workflows", "repairs", "cleans", "onboarding", "mail"]), date: z.string().refine(value => Boolean(parseAnalyticsDate(value))), status: z.enum(["waiting", "progress", "complete"]), count: z.number().int().positive() })),
});
const names = { workflows: "Workflows", repairs: "Maintenance", cleans: "Cleans", onboarding: "Onboarding", mail: "Mailbox" } as const;
export async function businessReport(request: Request, native = false, exportReport = false) {
  try {
    const session = await businessContext(request, native);
    if (!session) return businessResponse({ error: "Sign in required" }, 401);
    const account = session.account;
    if (account.status !== "active" || (exportReport && !isWorkspaceAdmin(account.role))) return businessResponse({ error: exportReport ? "Active admin access required to export reports" : "Active workspace access required" }, 403);
    const query = new URL(request.url).searchParams;
    const period = reportPeriodSchema.safeParse(query.size ? Object.fromEntries(query) : presetPeriod(90));
    if (!period.success) return businessResponse({ error: "Choose a valid date range of up to 366 days" }, 400);
    const duration = (Date.parse(period.data.to + "T00:00:00Z") - Date.parse(period.data.from + "T00:00:00Z")) / 86400000 + 1;
    // Includes the preceding comparison period and Today's two 7-day cohorts.
    const earliest = Math.min(Date.parse(period.data.from + "T00:00:00Z") - duration * 86400000, Date.parse(period.data.to + "T00:00:00Z") - 13 * 86400000);
    const result = await session.client.rpc("workspace_report", { from_date: new Date(earliest).toISOString().slice(0, 10), to_date: period.data.to });
    if (result.error) return databaseFailure(result.error);
    const parsed = reportSchema.safeParse(result.data);
    if (!parsed.success) return businessResponse({ error: "Report connection returned invalid data" }, 503);
    const sourceFor = (module: string) => ["maintenance-reporting", "stays-maintenance-reporting", "client-property-maintenance"].includes(module) ? "repairs" : ["cleaning-schedule", "cleaner-performance", "clean-reporting", "clean-property-onboarding"].includes(module) ? "cleans" : module === "property-onboarding" ? "onboarding" : module === "client-mailbox" ? "mail" : "workflows";
    const allowed = new Set(account.modules.map(sourceFor));
    const snapshot: AnalyticsSnapshot = {
      title: isWorkspaceAdmin(account.role) ? "Workspace analytics" : account.role === "client" ? "My property analytics" : account.role === "cleans" ? "My cleaning analytics" : account.role === "cleaning_manager" ? "Cleaning team analytics" : "My workspace analytics",
      description: "Your permitted live records. Dates use Europe/London.", propertyLabel: account.role === "cleans" ? "Assigned properties" : account.role === "client" ? "My properties" : "Properties", propertyCount: parsed.data.propertyCount, propertyAvailable: true,
      sources: (Object.keys(names) as (keyof typeof names)[]).filter(key => isWorkspaceAdmin(account.role) || allowed.has(key) || parsed.data.series.some(row => row.source === key)).map(key => ({ key, name: names[key], available: true, records: parsed.data.series.filter(row => row.source === key).map(({ date, status, count }) => ({ date, status, count })) })),
    };
    if (exportReport) return new Response(analyticsCsv(snapshot, period.data), { headers: { "Cache-Control": "private, no-store", Vary: "Cookie, Authorization", "X-Content-Type-Options": "nosniff", "Content-Type": "text/csv;charset=utf-8", "Content-Disposition": `attachment; filename="${analyticsFilename(period.data)}"` } });
    return businessResponse({ data: snapshot, period: period.data, mode: "live" });
  } catch (error) { return viewAsFailure(error) ?? businessResponse({ error: "Reports are temporarily unavailable" }, 503); }
}
