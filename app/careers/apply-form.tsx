"use client";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, CheckCircle2, FileText, Mail, Phone, Trash2, UploadCloud, User } from "lucide-react";
import { CV_RULE, MAX_CV_BYTES, RESPONSE_PROMISE, answersProblem, applicationSchema, type Listing } from "@/lib/careers";

// The application form on the careers page: contact details, the CV (sent with the form), the role's own questions and
// whether to be considered for other roles. Checked here and again on the server and in the database.
const size = (bytes: number) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

function Field({ id, label, help, required, error, icon, children }: { id: string; label: string; help?: string; required?: boolean; error?: string; icon?: ReactNode; children: ReactNode }) {
  return <div className="auth-field enquiry-field" data-invalid={error ? "true" : undefined}>
    <label htmlFor={id}>{label}{required && <span className="enquiry-required" aria-hidden> *</span>}</label>
    {help && <p className="enquiry-help">{help}</p>}
    <div className="auth-control" data-bare-input="true">{icon}{children}</div>
    {error && <p className="enquiry-error" role="alert">{error}</p>}
  </div>;
}

export function ApplyForm({ listing }: { listing: Listing }) {
  const [values, setValues] = useState<Record<string, string>>({ fullName: "", email: "", phone: "" });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [otherRoles, setOtherRoles] = useState(false);
  const [cv, setCv] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState(""), [sending, setSending] = useState(false), [done, setDone] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const clear = (key: string) => setErrors(e => { const { [key]: _gone, ...rest } = e; void _gone; return rest; });
  const input = (key: string) => ({ id: "apply-" + key, value: values[key] ?? "", onChange: (e: { target: { value: string } }) => { setValues(v => ({ ...v, [key]: e.target.value })); clear(key); } });
  const answer = (key: string) => ({ id: "apply-" + key, value: answers[key] ?? "", onChange: (e: { target: { value: string } }) => { setAnswers(v => ({ ...v, [key]: e.target.value })); clear(key); } });

  function choose(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX_CV_BYTES) { setErrors(e => ({ ...e, cv: `That file is over 10 MB. ${CV_RULE}` })); return; }
    setCv(file); clear("cv");
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    const application = { vacancyId: listing.id, ...values, answers: Object.fromEntries(Object.entries(answers).filter(([, v]) => v.trim() !== "")), otherRoles };
    const parsed = applicationSchema.safeParse(application);
    const found: Record<string, string> = {};
    if (!parsed.success) for (const issue of parsed.error.issues) { const key = String(issue.path.at(-1) ?? ""); if (key && !found[key]) found[key] = issue.message; }
    const problem = answersProblem(listing.questions, answers);
    if (problem && !found[problem.id]) found[problem.id] = problem.message;
    if (!cv) found.cv = `Add your CV. ${CV_RULE}`;
    if (Object.keys(found).length || !parsed.success || !cv) {
      setErrors(found); setError("Some answers need another look.");
      document.getElementById("apply-" + Object.keys(found)[0])?.focus();
      return;
    }
    setSending(true);
    try {
      const form = new FormData();
      form.append("application", JSON.stringify(parsed.data)); form.append("cv", cv);
      const response = await fetch("/api/careers/apply", { method: "POST", body: form });
      const body = (await response.json().catch(() => ({}))) as { error?: string; field?: string };
      if (!response.ok) { setError(body.error || "Your application could not be sent. Please try again."); const field = body.field; if (field) setErrors(e => ({ ...e, [field]: body.error ?? "" })); return; }
      setDone(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch { setError("Could not connect. Please try again."); } finally { setSending(false); }
  }

  if (done) return <div className="enquiry-done" role="status">
    <span className="enquiry-done-mark"><CheckCircle2 aria-hidden size={34} /></span>
    <h2>Thank you, {values.fullName.trim().split(/\s+/)[0]}!</h2>
    <p>We have your application for {listing.title}. {RESPONSE_PROMISE}</p>
    <p>We have emailed {values.email.trim()} a link to create your account, where you can follow your application, choose an interview time if we invite you, and message our recruitment team.</p>
  </div>;

  return <form className="auth-form enquiry-form" onSubmit={submit} noValidate style={{ marginTop: 18 }}>
    <section className="enquiry-section">
      <h2><span>1</span>Your details</h2>
      <Field id="apply-fullName" label="Full name" required error={errors.fullName} icon={<User aria-hidden size={17} className="auth-control-icon" />}>
        <input {...input("fullName")} autoComplete="name" maxLength={200} />
      </Field>
      <div className="enquiry-pair">
        <Field id="apply-email" label="Email" help="We send updates about your application here." required error={errors.email} icon={<Mail aria-hidden size={17} className="auth-control-icon" />}>
          <input {...input("email")} type="email" autoComplete="email" maxLength={320} spellCheck={false} autoCapitalize="none" />
        </Field>
        <Field id="apply-phone" label="Phone number" required error={errors.phone} icon={<Phone aria-hidden size={17} className="auth-control-icon" />}>
          <input {...input("phone")} type="tel" autoComplete="tel" maxLength={40} placeholder="07700 900123" />
        </Field>
      </div>
      <div className="auth-field enquiry-field" data-invalid={errors.cv ? "true" : undefined}>
        <label htmlFor="apply-cv">Your CV<span className="enquiry-required" aria-hidden> *</span></label>
        {cv ? <ul className="enquiry-files"><li>
          <span className="enquiry-thumb"><FileText aria-hidden size={18} /></span>
          <span className="enquiry-file-text"><strong>{cv.name}</strong><small>{size(cv.size)}</small></span>
          <button type="button" className="enquiry-remove" onClick={() => setCv(null)} aria-label={"Remove " + cv.name}><Trash2 aria-hidden size={16} /></button>
        </li></ul>
          : <div className="enquiry-drop" onClick={() => picker.current?.click()} role="button" tabIndex={0} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); choose(e.dataTransfer.files[0]); }}
            onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); picker.current?.click(); } }}>
            <UploadCloud aria-hidden size={28} /><strong>Drop your CV here or choose it</strong><span>{CV_RULE}</span>
          </div>}
        <input ref={picker} id="apply-cv" type="file" hidden accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={e => { choose(e.target.files?.[0]); e.target.value = ""; }} />
        {errors.cv && <p className="enquiry-error" role="alert">{errors.cv}</p>}
      </div>
    </section>

    {listing.questions.length > 0 && <section className="enquiry-section">
      <h2><span>2</span>About the role</h2>
      {listing.questions.map(q => q.kind === "yes_no"
        ? <fieldset key={q.id} className="auth-field enquiry-field" data-invalid={errors[q.id] ? "true" : undefined}>
          <legend>{q.label}{q.required && <span className="enquiry-required" aria-hidden> *</span>}</legend>
          <div className="enquiry-choice">{["Yes", "No"].map(o => <label key={o} className="enquiry-pill" data-on={answers[q.id] === o ? "" : undefined}>
            <input type="radio" name={q.id} id={o === "Yes" ? "apply-" + q.id : undefined} checked={answers[q.id] === o} onChange={() => { setAnswers(v => ({ ...v, [q.id]: o })); clear(q.id); }} />{o}</label>)}</div>
          {errors[q.id] && <p className="enquiry-error" role="alert">{errors[q.id]}</p>}
        </fieldset>
        : <Field key={q.id} id={"apply-" + q.id} label={q.label} required={q.required} error={errors[q.id]}>
          {q.kind === "long" ? <textarea {...answer(q.id)} rows={4} maxLength={3000} /> : <input {...answer(q.id)} inputMode={q.kind === "number" ? "decimal" : undefined} maxLength={q.kind === "number" ? 20 : 300} />}
        </Field>)}
    </section>}

    <section className="enquiry-section">
      <h2><span>{listing.questions.length > 0 ? 3 : 2}</span>Other roles</h2>
      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: "0.92rem", lineHeight: 1.5 }}>
        <input type="checkbox" checked={otherRoles} onChange={e => setOtherRoles(e.target.checked)} style={{ marginTop: 4, width: 18, height: 18 }} />
        <span>Please consider me for other roles at Recharge too.</span>
      </label>
    </section>

    {error && <p role="alert" className="auth-alert">{error}</p>}
    <button className="auth-submit" disabled={sending}><span>{sending ? "Sending…" : "Send my application"}</span><ArrowRight aria-hidden size={18} /></button>
    <p className="enquiry-help">We use these details and your CV only to consider your application and to contact you about it. See our <a href="/privacy">privacy policy</a>.</p>
  </form>;
}
