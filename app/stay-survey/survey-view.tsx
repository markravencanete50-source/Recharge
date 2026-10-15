"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, Check, CheckCircle2 } from "lucide-react";
import { RATING_LABEL, STAY_RATINGS, STAY_REASONS, STAY_REASON_LABEL, surveyAnswerSchema, type StayReason } from "@/lib/stay-reason";

// The guest's answers: a rating from 1 to 5, what brought them here, and an optional comment. A tap in the email is
// recorded as soon as the page opens (a person opening the page, not a mail scanner fetching the link); the rest can be
// added and sent after. Each answer can be changed while the link works.
type Answer = { rating?: number; reason?: StayReason; comment?: string };

export function SurveyView({ token, tap }: { token: string; tap: { rating?: number; reason?: StayReason } }) {
  const [rating, setRating] = useState<number | undefined>(tap.rating), [reason, setReason] = useState<StayReason | undefined>(tap.reason), [comment, setComment] = useState("");
  const [sending, setSending] = useState(false), [error, setError] = useState(""), [thanked, setThanked] = useState(false), [done, setDone] = useState(false);
  const tapped = useRef(false);

  async function send(answer: Answer) {
    const parsed = surveyAnswerSchema.safeParse({ token, ...answer });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check your answer"); return false; }
    setSending(true); setError("");
    try {
      const response = await fetch("/api/stay-survey", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(parsed.data) });
      const body = await response.json().catch(() => ({})) as { data?: { state: string }; error?: string };
      if (!response.ok || !body.data) { setError(body.error || "Your answer could not be sent just now. Please try again in a minute."); return false; }
      setThanked(true);
      return true;
    } catch { setError("Could not connect. Check your connection and try again."); return false; }
    finally { setSending(false); }
  }
  useEffect(() => {
    if (tapped.current || (!tap.rating && !tap.reason)) return;
    tapped.current = true;
    queueMicrotask(() => { void send(tap); });
    // Once, for the answer tapped in the email.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await send({ rating, reason, comment: comment.trim() || undefined })) setDone(true);
  }

  if (done) return <div className="enquiry-done" role="status">
    <span className="enquiry-done-mark"><CheckCircle2 aria-hidden size={34} /></span>
    <h2>Thank you</h2><p>We’re grateful you took the time. We hope to welcome you again.</p>
  </div>;
  return <form className="auth-form" onSubmit={submit} noValidate aria-label="Your stay">
    {thanked && <div className="enquiry-done" role="status"><h2>Thank you</h2><p>Your answer is saved. Add anything else below if you like.</p></div>}
    <fieldset className="auth-field enquiry-field">
      <legend>How was your stay?</legend>
      <div className="enquiry-choice" role="radiogroup" aria-label="How was your stay, from 1 (poor) to 5 (excellent)">
        {STAY_RATINGS.map(n => <label key={n} className="enquiry-pill" data-on={rating === n ? "true" : undefined} title={RATING_LABEL[n]}>
          <input type="radio" name="rating" value={n} checked={rating === n} onChange={() => setRating(n)} />
          {rating === n && <Check aria-hidden size={15} />}<span>{n}</span>
        </label>)}
      </div>
      <p className="enquiry-help">1 is poor and 5 is excellent.</p>
    </fieldset>
    <fieldset className="auth-field enquiry-field">
      <legend>What brought you here?</legend>
      <div className="enquiry-choice" role="radiogroup" aria-label="What brought you here">
        {STAY_REASONS.map(key => <label key={key} className="enquiry-pill" data-on={reason === key ? "true" : undefined}>
          <input type="radio" name="reason" value={key} checked={reason === key} onChange={() => setReason(key)} />
          {reason === key && <Check aria-hidden size={15} />}<span>{STAY_REASON_LABEL[key]}</span>
        </label>)}
      </div>
    </fieldset>
    <div className="auth-field enquiry-field">
      <label htmlFor="stay-comment">Anything you’d like to tell us? <span className="enquiry-help">(optional)</span></label>
      <div className="auth-control" data-bare-input="true"><textarea id="stay-comment" rows={4} maxLength={2000} value={comment} onChange={e => setComment(e.target.value)} placeholder="What you enjoyed, or what we could do better" /></div>
    </div>
    {error && <p role="alert" className="auth-alert">{error}</p>}
    <button className="auth-submit" disabled={sending}><span>{sending ? "Sending…" : "Send"}</span><ArrowRight aria-hidden size={18} /></button>
    <p className="enquiry-help">See our <a href="/privacy">privacy policy</a>.</p>
  </form>;
}
