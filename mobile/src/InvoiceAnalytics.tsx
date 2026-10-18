import { useMemo } from "react";
import { type Palette } from "./theme";
import { london } from "./LiveKit";
import { AnalyticsPanel, PeriodBar, usePeriod } from "./AnalyticsKit";
import { STANDARD_PERIODS } from "../../lib/report-analytics";
import { invoicesModel } from "../../lib/report-analytics-models";
import { readableStage, type InvoiceView } from "../../lib/workspace-view";

// Reports > Invoices (and Accounts' invoice list): the analytics over the invoices the page already has, for the same people
// who see the list. Invoiced and paid in the period against the period before, what is outstanding now, the value invoiced
// over time and every invoice by status. Pounds only: an invoice in another currency is left out of the sums.
export function InvoiceAnalytics({ p, invoices }: { p: Palette; invoices: readonly InvoiceView[] }) {
  const period = usePeriod(STANDARD_PERIODS, "90d", london(new Date()));
  const model = useMemo(() => invoicesModel(invoices, period.range, period.previous, period.against, readableStage), [invoices, period.range, period.previous, period.against]);
  return <AnalyticsPanel p={p} model={model} controls={<PeriodBar p={p} period={period} />} caption={`${period.label}, ${period.against}.`} />;
}
