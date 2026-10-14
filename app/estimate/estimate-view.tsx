"use client";
import { useMemo, useState, type FormEvent } from "react";
import { ArrowRight, CalendarDays, Check, CheckCircle2, ExternalLink } from "lucide-react";
import { DECISION_LABEL, estimateComparablesOf, estimateDecisionSchema } from "@/lib/estimate-link";
import { AVAILABLE_NIGHTS, DIRECT_RANGE, OCCUPANCY_RANGE, SCENARIOS, hasFees, netProfit, project, readEstimate, startingChoices, type Choices } from "@/lib/estimate-projection";
import { formatBps, formatMoney, plural } from "@/lib/format";

// The client's estimate: the nightly rates, the notes and similar properties, a small explorer (the same sums as the
// owner app's "Explore your estimate", lib/estimate-projection.ts), and their answer: Proceed, No, thank you, or Thank you,
// I'll be in touch (with a date for us to check in).
type Decision = keyof typeof DECISION_LABEL;
const pounds = (minor: number) => formatMoney(Math.round(minor / 100) * 100).replace(/\.00$/, "");
const percent = (bps: number) => formatBps(bps).replace(".0%", "%");
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });

function Explorer({ estimate }: { estimate: Record<string, unknown> }) {
  const published = readEstimate(estimate);
  const start = useMemo(() => published ? startingChoices(published) : null, [published]);
  const [choices, setChoices] = useState<Choices | null>(start);
  if (!published || !choices || !start) return null;
  const fees = hasFees(published), result = project(published, choices), net = netProfit(estimate, result);
  const set = (next: Partial<Choices>) => setChoices(c => ({ ...c!, ...next }));
  const changed = choices.scenario !== start.scenario || choices.occupancyBps !== start.occupancyBps || choices.directBookingBps !== start.directBookingBps;
  return <section className="estimate-card" aria-labelledby="estimate-explore">
    <h2 id="estimate-explore">Explore your estimate</h2>
    <p className="enquiry-help">Change the figures to see what the property could earn.</p>
    <div className="estimate-scenarios" role="radiogroup" aria-label="Nightly rate">
      {SCENARIOS.map(s => {
        const rate = s.id === "low" ? published.lowRateMinor : s.id === "high" ? published.highRateMinor : published.mediumRateMinor;
        return <label key={s.id} className="estimate-scenario" data-on={choices.scenario === s.id ? "true" : undefined}>
          <input type="radio" name="scenario" checked={choices.scenario === s.id} onChange={() => set({ scenario: s.id })} />
          <strong>{s.label}</strong><span>{pounds(rate)} a night</span>
        </label>;
      })}
    </div>
    <label className="estimate-range">
      <span><strong>Occupancy</strong><output>{percent(choices.occupancyBps)}</output></span>
      <input type="range" min={OCCUPANCY_RANGE.min} max={OCCUPANCY_RANGE.max} step={OCCUPANCY_RANGE.step} value={choices.occupancyBps} onChange={e => set({ occupancyBps: Number(e.target.value) })} />
      <small>About {plural(result.occupiedNights, "night")} booked a year</small>
    </label>
    {fees && <label className="estimate-range">
      <span><strong>Booked direct</strong><output>{percent(choices.directBookingBps)}</output></span>
      <input type="range" min={DIRECT_RANGE.min} max={DIRECT_RANGE.max} step={DIRECT_RANGE.step} value={choices.directBookingBps} onChange={e => set({ directBookingBps: Number(e.target.value) })} />
      <small>Direct guests pay no platform fee</small>
    </label>}
    <div className="estimate-total" aria-live="polite">
      <span>{fees ? "You could earn" : "Booking income"}</span>
      <strong>{pounds(fees ? result.ownerMinor! : result.grossMinor)} <small>a year</small></strong>
      <span>About {pounds(fees ? result.monthlyOwnerMinor! : result.monthlyGrossMinor)} a month</span>
    </div>
    {fees && <dl className="estimate-lines">
      <div><dt>Booking income</dt><dd>{pounds(result.grossMinor)}</dd></div>
      <div><dt>Platform fees ({percent(published.otaFeeBps!)} on non-direct bookings)</dt><dd>{"−" + pounds(result.platformFeesMinor!)}</dd></div>
      <div><dt>Recharge management ({percent(published.managementFeeBps!)})</dt><dd>{"−" + pounds(result.managementFeesMinor!)}</dd></div>
      <div data-strong="true"><dt>Your earnings</dt><dd>{pounds(result.ownerMinor!)}</dd></div>
    </dl>}
    {/* What the two fees are, in plain words (Alex), beside the lines. */}
    {fees && <p className="enquiry-help">Airbnb and Booking.com keep a share of each booking made through their sites: that is the platform fee. Guests who book with us directly pay no platform fee. The management fee is what Recharge charges for running your let, as a share of the booking income.</p>}
    {/* Your own monthly costs, when Recharge added them (migration 20261020890000), and what is left. */}
    {net && <><h3>Your own costs</h3><dl className="estimate-lines" aria-label="Your own costs and estimated net profit">
      {net.costs.map(c => <div key={c.category}><dt>{c.category}, a month</dt><dd>{"−" + pounds(c.monthlyMinor)}</dd></div>)}
      <div data-strong="true"><dt>Estimated net profit per month</dt><dd>{(net.monthlyNetMinor < 0 ? "−" : "") + pounds(Math.abs(net.monthlyNetMinor))}</dd></div>
      <div data-strong="true"><dt>Estimated net profit per year</dt><dd>{(net.yearlyNetMinor < 0 ? "−" : "") + pounds(Math.abs(net.yearlyNetMinor))}</dd></div>
    </dl></>}
    <p className="enquiry-help">An estimate, not a guarantee. {fees ? "Before cleaning, maintenance, utilities and tax." : "We will add the fees when we talk, so you can see your earnings."} Assumes the property is available all {AVAILABLE_NIGHTS} nights of the year.</p>
    {changed && <button type="button" className="estimate-link-button" onClick={() => setChoices(start)}>Back to Recharge’s estimate</button>}
  </section>;
}

export function EstimateView({ token, state: initial, estimate, followUpOn }: { token: string; state: "open" | "declined" | "proceeding"; estimate: Record<string, unknown>; followUpOn: string | null }) {
  const [state, setState] = useState(initial), [decision, setDecision] = useState<Decision | "">(""), [feedback, setFeedback] = useState("");
  const [date, setDate] = useState(""), [error, setError] = useState(""), [field, setField] = useState(""), [sending, setSending] = useState(false);
  const [answered, setAnswered] = useState<{ decision: Decision; followUpOn: string | null } | null>(null);
  const published = readEstimate(estimate), notes = typeof estimate.comments === "string" ? estimate.comments.trim() : "", comparables = estimateComparablesOf(estimate);

  async function submit(event: FormEvent) {
    event.preventDefault(); setError(""); setField("");
    const parsed = estimateDecisionSchema.safeParse({ token, decision: decision || undefined, feedback, followUpOn: decision === "review" ? date || null : null });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check your answer"); setField(String(parsed.error.issues[0]?.path.at(-1) ?? "")); return; }
    setSending(true);
    try {
      const response = await fetch("/api/estimate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(parsed.data) });
      const body = await response.json().catch(() => ({})) as { data?: { state: "open" | "declined" | "proceeding"; followUpOn: string | null }; error?: string; field?: string };
      if (!response.ok || !body.data) { setError(body.error || "Your answer could not be sent just now. Please try again in a minute."); setField(body.field ?? ""); return; }
      setAnswered({ decision: parsed.data.decision, followUpOn: body.data.followUpOn }); setState(body.data.state);
    } catch { setError("Could not connect. Check your connection and try again."); }
    finally { setSending(false); }
  }

  const done = answered ? {
    proceed: ["Thank you, we’ll be in touch", "We’ll send you the management agreement next. If you have any questions, reply to our email."],
    review: ["Thank you, take your time", `We’ll get back to you${answered.followUpOn ? " on " + new Date(answered.followUpOn + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long" }) : ""}. You can come back to this page and decide sooner.`],
    decline: ["Thank you for letting us know", "If anything changes, reply to our email and we’ll be happy to help."],
  }[answered.decision] : null;

  return <div className="auth-form estimate-page">
    {published && <section className="estimate-card" aria-labelledby="estimate-rates">
      <h2 id="estimate-rates">Nightly rate</h2>
      <dl className="estimate-rates">
        <div><dt>Low</dt><dd>{pounds(published.lowRateMinor)}</dd></div>
        <div data-strong="true"><dt>Expected</dt><dd>{pounds(published.mediumRateMinor)}</dd></div>
        <div><dt>High</dt><dd>{pounds(published.highRateMinor)}</dd></div>
      </dl>
    </section>}
    {!!notes && <section className="estimate-card" aria-labelledby="estimate-notes"><h2 id="estimate-notes">Notes from Recharge</h2><p className="estimate-notes">{notes}</p></section>}
    {comparables.length > 0 && <section className="estimate-card" aria-labelledby="estimate-similar">
      <h2 id="estimate-similar">Similar properties nearby</h2>
      <ul className="estimate-similar">{comparables.map(c => <li key={c.url}><a href={c.url} target="_blank" rel="noopener noreferrer"><span>{c.name}</span><small>{pounds(c.adrMinor)} a night</small><ExternalLink aria-hidden size={16} /></a></li>)}</ul>
    </section>}
    <Explorer estimate={estimate} />

    {done ? <div className="enquiry-done" role="status">
      <span className="enquiry-done-mark"><CheckCircle2 aria-hidden size={34} /></span>
      <h2>{done[0]}</h2><p>{done[1]}</p>
    </div> : state === "open" ? <form className="estimate-card" onSubmit={submit} noValidate aria-labelledby="estimate-answer">
      <h2 id="estimate-answer">How would you like to go ahead?</h2>
      {followUpOn && <p className="enquiry-help">You asked for more time{` until ${new Date(followUpOn + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long" })}`}. Decide whenever you’re ready.</p>}
      <fieldset className="auth-field enquiry-field" data-invalid={field === "decision" ? "true" : undefined}>
        <legend>Your decision</legend>
        <div className="enquiry-choice" role="radiogroup" aria-label="Your decision">
          {(Object.keys(DECISION_LABEL) as Decision[]).map(key => <label key={key} className="enquiry-pill" data-on={decision === key ? "true" : undefined}>
            <input type="radio" name="decision" value={key} checked={decision === key} onChange={() => { setDecision(key); setError(""); setField(""); }} />
            {decision === key && <Check aria-hidden size={15} />}<span>{DECISION_LABEL[key]}</span>
          </label>)}
        </div>
      </fieldset>
      {decision === "review" && <div className="auth-field enquiry-field" data-invalid={field === "followUpOn" ? "true" : undefined}>
        <label htmlFor="estimate-date">If we haven’t heard from you, when should we check in?</label>
        <div className="auth-control" data-bare-input="true"><CalendarDays aria-hidden size={17} className="auth-control-icon" />
          <input id="estimate-date" type="date" min={today()} value={date} onChange={e => { setDate(e.target.value); setField(""); }} required />
        </div>
      </div>}
      <div className="auth-field enquiry-field">
        <label htmlFor="estimate-feedback">Questions or feedback <span className="enquiry-help">(optional)</span></label>
        <div className="auth-control" data-bare-input="true"><textarea id="estimate-feedback" rows={4} maxLength={5000} value={feedback} onChange={e => setFeedback(e.target.value)} placeholder="Anything you’d like us to know" /></div>
      </div>
      {error && <p role="alert" className="auth-alert">{error}</p>}
      <button className="auth-submit" disabled={sending}><span>{sending ? "Sending…" : "Send my answer"}</span><ArrowRight aria-hidden size={18} /></button>
      <p className="enquiry-help">Questions first? Just reply to our email. See our <a href="/privacy">privacy policy</a>.</p>
    </form> : <div className="enquiry-done" role="status">
      <span className="enquiry-done-mark"><CheckCircle2 aria-hidden size={34} /></span>
      <h2>{state === "proceeding" ? "You’ve chosen to go ahead" : "You’ve let us know you won’t go ahead"}</h2>
      <p>{state === "proceeding" ? "The team will be in touch about the next steps. Reply to our email with any questions." : "If anything changes, reply to our email and we’ll be happy to help."}</p>
    </div>}
  </div>;
}
