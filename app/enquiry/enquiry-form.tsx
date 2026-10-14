"use client";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowRight, Building2, Check, CheckCircle2, Film, ImageIcon, Link2, Mail, MapPin, Phone, Trash2, UploadCloud, User } from "lucide-react";
import { ENQUIRY_TYPES, MAX_ENQUIRY_FILES, PROPERTY_TYPES, START_WHEN, enquiryAnswersSchema } from "@/lib/client-enquiry";

// The landlord's form: contact details, the property, photos or videos, and the services they
// want. Answers are checked here and again on the server; files upload as they are chosen.
type Upload = { key: string; id?: string; name: string; mime: string; bytes: number; progress: number; error?: string; preview?: string };
type Values = Record<string, string>;
const ROOMS = Array.from({ length: 16 }, (_, i) => String(i));
const size = (bytes: number) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

function Field({ id, label, help, required, error, icon, children }: { id: string; label: string; help?: string; required?: boolean; error?: string; icon?: ReactNode; children: ReactNode }) {
  return <div className="auth-field enquiry-field" data-invalid={error ? "true" : undefined}>
    <label htmlFor={id}>{label}{required && <span className="enquiry-required" aria-hidden> *</span>}</label>
    {help && <p className="enquiry-help" id={id + "-help"}>{help}</p>}
    {/* The frame shows focus itself: no second box inside it (data-bare-input, lib/design-tokens.ts). */}
    <div className="auth-control" data-bare-input="true">{icon}{children}</div>
    {error && <p className="enquiry-error" role="alert">{error}</p>}
  </div>;
}
function Choice({ id, label, help, value, onChange, error, options = [["yes", "Yes"], ["no", "No"]] }: { id: string; label: string; help?: string; value: string; onChange: (v: string) => void; error?: string; options?: [string, string][] }) {
  return <fieldset className="auth-field enquiry-field" data-invalid={error ? "true" : undefined}>
    <legend>{label}<span className="enquiry-required" aria-hidden> *</span></legend>
    {help && <p className="enquiry-help">{help}</p>}
    <div className="enquiry-choice" role="radiogroup" aria-label={label}>
      {options.map(([key, text]) => <label key={key} className="enquiry-pill" data-on={value === key ? "true" : undefined}>
        <input type="radio" name={id} value={key} checked={value === key} onChange={() => onChange(key)} />
        {value === key && <Check aria-hidden size={15} />}<span>{text}</span>
      </label>)}
    </div>
    {error && <p className="enquiry-error" role="alert">{error}</p>}
  </fieldset>;
}

export function EnquiryForm({ token, name, email, files }: { token: string; name: string; email: string; files: { id: string; name: string; mime: string; bytes: number }[] }) {
  const [values, setValues] = useState<Values>({ fullName: name, email, shortLet: "", furnishQuote: "", compliance: "", bedrooms: "", wcs: "", bathrooms: "", propertyType: "", startWhen: "", enquiryType: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [uploads, setUploads] = useState<Upload[]>(() => files.map(f => ({ key: f.id, ...f, progress: 1 })));
  const [error, setError] = useState(""), [sending, setSending] = useState(false), [done, setDone] = useState(false);
  const [dragging, setDragging] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const set = (key: string) => (value: string) => { setValues(v => ({ ...v, [key]: value })); setErrors(e => { const { [key]: _gone, ...rest } = e; void _gone; return rest; }); };
  const input = (key: string) => ({ id: "enquiry-" + key, name: key, value: values[key] ?? "", onChange: (e: { target: { value: string } }) => set(key)(e.target.value) });
  useEffect(() => () => uploads.forEach(u => u.preview && URL.revokeObjectURL(u.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Each file uploads on its own, with progress; a file that fails says why and can be removed.
  function upload(file: File) {
    const key = crypto.randomUUID();
    setUploads(list => [...list, { key, name: file.name, mime: file.type, bytes: file.size, progress: 0, preview: file.type.startsWith("image/") && file.type !== "image/heic" ? URL.createObjectURL(file) : undefined }]);
    const form = new FormData(); form.append("token", token); form.append("file", file);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/enquiry/upload");
    // The link goes in a header too, so the site checks it before reading the file.
    xhr.setRequestHeader("X-Enquiry-Token", token);
    xhr.upload.onprogress = e => { if (e.lengthComputable) setUploads(list => list.map(u => u.key === key ? { ...u, progress: Math.min(0.97, e.loaded / e.total) } : u)); };
    xhr.onload = () => {
      let body: { data?: { id: string }; error?: string } = {};
      try { body = JSON.parse(xhr.responseText); } catch { /* not JSON */ }
      setUploads(list => list.map(u => u.key === key ? (xhr.status < 300 && body.data ? { ...u, id: body.data.id, progress: 1 } : { ...u, progress: 1, error: body.error || "This file could not be added." }) : u));
    };
    xhr.onerror = () => setUploads(list => list.map(u => u.key === key ? { ...u, progress: 1, error: "Could not connect. Check your connection and try again." } : u));
    xhr.send(form);
  }
  function choose(list: FileList | null) {
    if (!list) return;
    const room = MAX_ENQUIRY_FILES - uploads.filter(u => !u.error).length;
    Array.from(list).slice(0, Math.max(0, room)).forEach(upload);
    if (list.length > room) setError(`Up to ${MAX_ENQUIRY_FILES} photos or videos. For more, paste a link to an album below.`);
  }
  async function remove(u: Upload) {
    setUploads(list => list.filter(x => x.key !== u.key));
    if (u.preview) URL.revokeObjectURL(u.preview);
    if (u.id) await fetch("/api/enquiry/upload", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "remove", token, fileId: u.id }) }).catch(() => undefined);
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setError("");
    const raw = { ...values, bedrooms: values.bedrooms === "" ? undefined : Number(values.bedrooms), wcs: values.wcs === "" ? undefined : Number(values.wcs), bathrooms: values.bathrooms === "" ? undefined : Number(values.bathrooms) };
    const answers = Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([, v]) => v !== "" && v !== undefined));
    const parsed = enquiryAnswersSchema.safeParse(answers);
    if (!parsed.success) {
      const found: Record<string, string> = {};
      for (const issue of parsed.error.issues) { const key = String(issue.path[0] ?? ""); if (key && !found[key]) found[key] = issue.message.startsWith("Required") || issue.message.startsWith("Expected") ? "Please answer this question" : issue.message; }
      setErrors(found);
      document.getElementById("enquiry-" + Object.keys(found)[0])?.focus();
      setError("Some answers need another look.");
      return;
    }
    if (uploads.some(u => u.progress < 1)) { setError("Please wait for your photos and videos to finish uploading."); return; }
    setSending(true);
    try {
      const response = await fetch("/api/enquiry", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, answers: parsed.data }) });
      const body = (await response.json().catch(() => ({}))) as { error?: string; field?: string };
      if (!response.ok) { setError(body.error || "The form could not be sent. Please try again."); const field = body.field; if (field) setErrors(e => ({ ...e, [field]: body.error ?? "" })); return; }
      setDone(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch { setError("Could not connect. Please try again."); } finally { setSending(false); }
  }

  if (done) return <div className="enquiry-done" role="status">
    <span className="enquiry-done-mark"><CheckCircle2 aria-hidden size={34} /></span>
    <h2>Thank you, {values.fullName.split(" ")[0] || "we have your details"}!</h2>
    <p>We have your enquiry{uploads.some(u => u.id) ? " and your photos" : ""}. A member of the team shall be in touch with your FREE performance estimate.</p>
  </div>;

  const pending = uploads.filter(u => u.progress < 1).length;
  return <form className="auth-form enquiry-form" onSubmit={submit} noValidate>
    <section className="enquiry-section">
      <h2><span>1</span>Contact information</h2>
      <Field id="enquiry-fullName" label="Full name" help="This is your name, not a company name." required error={errors.fullName} icon={<User aria-hidden size={17} className="auth-control-icon" />}>
        <input {...input("fullName")} autoComplete="name" maxLength={200} />
      </Field>
      <Field id="enquiry-companyName" label="Company name" help="If the property is owned in a company." error={errors.companyName} icon={<Building2 aria-hidden size={17} className="auth-control-icon" />}>
        <input {...input("companyName")} autoComplete="organization" maxLength={200} />
      </Field>
      <div className="enquiry-pair">
        <Field id="enquiry-email" label="Email" required error={errors.email} icon={<Mail aria-hidden size={17} className="auth-control-icon" />}>
          <input {...input("email")} type="email" autoComplete="email" maxLength={320} spellCheck={false} autoCapitalize="none" />
        </Field>
        <Field id="enquiry-phone" label="Contact number" required error={errors.phone} icon={<Phone aria-hidden size={17} className="auth-control-icon" />}>
          <input {...input("phone")} type="tel" autoComplete="tel" maxLength={30} placeholder="07700 900123" />
        </Field>
      </div>
    </section>

    <section className="enquiry-section">
      <h2><span>2</span>Property information</h2>
      <Field id="enquiry-propertyAddress" label="Property address" required error={errors.propertyAddress} icon={<MapPin aria-hidden size={17} className="auth-control-icon" />}>
        <textarea {...input("propertyAddress")} rows={3} maxLength={1000} placeholder="Include the postcode" />
      </Field>
      <Field id="enquiry-propertyType" label="Property type" required error={errors.propertyType}>
        <select {...input("propertyType")}><option value="">Choose…</option>{PROPERTY_TYPES.map(t => <option key={t}>{t}</option>)}</select>
      </Field>
      <div className="enquiry-trio">
        <Field id="enquiry-bedrooms" label="No. of bedrooms" required error={errors.bedrooms}><select {...input("bedrooms")}><option value="">–</option>{ROOMS.map(n => <option key={n}>{n}</option>)}</select></Field>
        <Field id="enquiry-wcs" label="No. of WCs" required error={errors.wcs}><select {...input("wcs")}><option value="">–</option>{ROOMS.map(n => <option key={n}>{n}</option>)}</select></Field>
        <Field id="enquiry-bathrooms" label="No. of full bathrooms" required error={errors.bathrooms}><select {...input("bathrooms")}><option value="">–</option>{ROOMS.map(n => <option key={n}>{n}</option>)}</select></Field>
      </div>
      <div className="enquiry-pair">
        <Field id="enquiry-parking" label="Parking" help="Please specify if this is free, public or private." error={errors.parking}><input {...input("parking")} maxLength={300} /></Field>
        <Field id="enquiry-garden" label="Garden" help="Please specify if this is private, public or shared." error={errors.garden}><input {...input("garden")} maxLength={300} /></Field>
      </div>
      <div className="auth-field enquiry-field">
        <label htmlFor="enquiry-files">Please upload any photos/videos of the property below</label>
        <div className={"enquiry-drop" + (dragging ? " is-dragging" : "")} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); choose(e.dataTransfer.files); }} onClick={() => picker.current?.click()} role="button" tabIndex={0}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); picker.current?.click(); } }}>
          <UploadCloud aria-hidden size={28} />
          <strong>Drop files here or choose them</strong>
          <span>Photos (JPG, PNG, HEIC) or videos (MP4, MOV), up to 25 MB each · {MAX_ENQUIRY_FILES} files</span>
          <input ref={picker} id="enquiry-files" type="file" multiple accept="image/jpeg,image/png,image/webp,image/heic,video/mp4,video/quicktime,video/webm" hidden onChange={e => { choose(e.target.files); e.target.value = ""; }} />
        </div>
        {uploads.length > 0 && <ul className="enquiry-files">
          {uploads.map(u => <li key={u.key} data-error={u.error ? "true" : undefined}>
            <span className="enquiry-thumb">{/* A local preview of the chosen file (a blob: address), which next/image cannot load. */}{/* eslint-disable-next-line @next/next/no-img-element */}
            {u.preview ? <img src={u.preview} alt="" /> : u.mime.startsWith("video/") ? <Film aria-hidden size={18} /> : <ImageIcon aria-hidden size={18} />}</span>
            <span className="enquiry-file-text"><strong>{u.name}</strong><small>{u.error ?? (u.progress < 1 ? `Uploading… ${Math.round(u.progress * 100)}%` : `${size(u.bytes)} · added`)}</small>
              {u.progress < 1 && <span className="enquiry-progress"><span style={{ width: `${Math.round(u.progress * 100)}%` }} /></span>}</span>
            <button type="button" className="enquiry-remove" onClick={() => void remove(u)} aria-label={"Remove " + u.name}><Trash2 aria-hidden size={16} /></button>
          </li>)}
        </ul>}
      </div>
      <Field id="enquiry-mediaLink" label="If it's easier to attach a link for photos/videos, paste it below." error={errors.mediaLink} icon={<Link2 aria-hidden size={17} className="auth-control-icon" />}>
        <input {...input("mediaLink")} type="url" inputMode="url" maxLength={1000} placeholder="https://" spellCheck={false} autoCapitalize="none" />
      </Field>
    </section>

    <section className="enquiry-section">
      <h2><span>3</span>Services</h2>
      <Choice id="shortLet" label="Is the property currently operating as a short-term let?" value={values.shortLet} onChange={set("shortLet")} error={errors.shortLet} />
      <Choice id="furnishQuote" label="Would you like us to provide a quote to furnish the property?" value={values.furnishQuote} onChange={set("furnishQuote")} error={errors.furnishQuote} />
      <Choice id="compliance" label="Would you like us to handle your compliance and licensing?" value={values.compliance} onChange={set("compliance")} error={errors.compliance} />
      <Field id="enquiry-startWhen" label="When would you like to get started?" error={errors.startWhen}>
        <select {...input("startWhen")}><option value="">Choose…</option>{START_WHEN.map(t => <option key={t}>{t}</option>)}</select>
      </Field>
      <Field id="enquiry-notes" label="Is there anything else you'd like us to know?" error={errors.notes}><textarea {...input("notes")} rows={4} maxLength={3000} /></Field>
      <Field id="enquiry-enquiryType" label="How would you best describe your enquiry? (There is no wrong answer!)" required error={errors.enquiryType}>
        <select {...input("enquiryType")}><option value="">Choose…</option>{ENQUIRY_TYPES.map(t => <option key={t}>{t}</option>)}</select>
      </Field>
    </section>

    {error && <p role="alert" className="auth-alert">{error}</p>}
    <button className="auth-submit" disabled={sending}><span>{sending ? "Sending…" : pending ? `Uploading ${pending} file${pending === 1 ? "" : "s"}…` : "Submit"}</span><ArrowRight aria-hidden size={18} /></button>
    <p className="enquiry-help">We use these details only to prepare your estimate and to contact you about it. See our <a href="/privacy">privacy policy</a>.</p>
  </form>;
}
