"use client";

import { useState, useSyncExternalStore } from "react";
import { CalendarDays } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { dateKey, parseAnalyticsDate, periodError, periodLabel, presetPeriod, type AnalyticsPeriod } from "@/lib/analytics";

function subscribeSize(callback: () => void) {
  const query = window.matchMedia("(min-width: 640px)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

export function AnalyticsDateRange({ period, choice, onChange }: {
  period: AnalyticsPeriod; choice: string; onChange: (period: AnalyticsPeriod, choice: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(period);
  const [month, setMonth] = useState(parseAnalyticsDate(period.from));
  const wide = useSyncExternalStore(subscribeSize, () => window.matchMedia("(min-width: 640px)").matches, () => false);
  const error = periodError(draft);
  function changeOpen(next: boolean) {
    if (next) { setDraft(period); setMonth(parseAnalyticsDate(period.from)); }
    setOpen(next);
  }
  return <>
    <label className="sr-only" htmlFor="analytics-period">Analytics period</label>
    <select id="analytics-period" value={choice} onChange={event => {
      const next = event.target.value;
      if (next === "custom") changeOpen(true);
      else onChange(presetPeriod(Number(next)), next);
    }}>
      <option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="custom">Custom range</option>
    </select>
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild><button className="analytics-calendar-trigger" type="button" aria-label="Choose custom date range"><CalendarDays size={17} /><span>Custom dates</span></button></DialogTrigger>
      <DialogContent className="analytics-range-dialog">
        <DialogHeader><DialogTitle>Choose your date range</DialogTitle><DialogDescription>Select a start and end date. All charts update together. You can include up to 366 days.</DialogDescription></DialogHeader>
        <div className="analytics-range-presets" aria-label="Quick date ranges">{[7, 30, 90].map(days => <Button type="button" variant="outline" key={days} onClick={() => { const range = presetPeriod(days); setDraft(range); setMonth(parseAnalyticsDate(range.from)); }}>Last {days} days</Button>)}</div>
        <div className="analytics-range-fields">
          <label htmlFor="analytics-from">Start date<input id="analytics-from" type="date" value={draft.from} aria-describedby="analytics-range-feedback" onInput={event => { setDraft({ ...draft, from: event.currentTarget.value }); const day = parseAnalyticsDate(event.currentTarget.value); if (day) setMonth(day); }} /></label>
          <label htmlFor="analytics-to">End date<input id="analytics-to" type="date" value={draft.to} aria-describedby="analytics-range-feedback" aria-invalid={Boolean(error)} onInput={event => setDraft({ ...draft, to: event.currentTarget.value })} /></label>
        </div>
        <Calendar className="analytics-calendar" mode="range" numberOfMonths={wide ? 2 : 1} month={month} onMonthChange={setMonth} weekStartsOn={1} captionLayout="dropdown" startMonth={new Date(2000, 0)} endMonth={new Date(2100, 11)} selected={{ from: parseAnalyticsDate(draft.from), to: parseAnalyticsDate(draft.to) }} onSelect={range => setDraft({ from: range?.from ? dateKey(range.from) : "", to: range?.to ? dateKey(range.to) : "" })} />
        <p id="analytics-range-feedback" className={error ? "analytics-error" : "analytics-range-summary"} role="status" aria-live="polite">{error || periodLabel(draft)}</p>
        <DialogFooter><Button type="button" variant="outline" onClick={() => changeOpen(false)}>Cancel</Button><Button type="button" disabled={Boolean(error)} onClick={() => { onChange(draft, "custom"); changeOpen(false); }}>Apply dates</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}
