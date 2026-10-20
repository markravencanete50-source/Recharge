import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Image, Linking, Platform, View, useWindowDimensions } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { ChoiceField } from "./ChoiceField";
import { Entrance, MotionPress, motionTokens } from "./motion";
import { Button, Field, Loading, Notice, StatGrid, StatTile, Tag, message, useRequestId } from "./LiveKit";
import { Initials } from "./LiveAccounts";
import { PageHeading, SoftButton } from "./LivePages";
import { Segmented } from "./Segmented";
import { Sheet } from "./TeamFlows";
import { LeadTicket } from "./LeadTicket";
import { useCelebrate } from "./Celebrate";
import { depth, ui, type Palette } from "./theme";
import { enquiryFileLink, readTeams, writeTeams } from "./backend/client";
import { SCOTTISH_REGIONS } from "../../lib/regions";
import {
  DEFAULT_SUBJECT, DUPLICATE_LABEL, LINK_PLACEHOLDER, PRIORITY_LABEL, PROPERTY_TYPES, STEP_LABEL, STEP_TONE, canDeleteEnquiry, clientEnquiriesSchema, defaultBody, deleteEnquiryWarning, duplicateNote, enquiryStep,
  OWNER_ENQUIRY_LABEL, OWNER_ENQUIRY_NOTE, TEAM_ENQUIRY_NOTE, isOwnerEnquiry, isPriority, isTeamEnquiry, teamEnquiryTag, priorityFirst, valuationDraft, valueButtonLabel,
  type ClientEnquiries, type ClientEnquiry, type EnquiryStep,
} from "../../lib/client-enquiry";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import { repairLimitText } from "../../lib/journey-policy";
import { LEADS_TITLE } from "../../lib/lead-estimate";

// Client Enquiries: send the New Property Enquiry Form to a landlord (by email, or a link to send
// yourself), see every answer when it comes back, and start valuing the property from it.
type Filter = "value" | "waiting" | "progress" | "all";
const FILTER_STEPS: Record<Exclude<Filter, "all">, EnquiryStep[]> = { value: ["received"], waiting: ["sent", "opened", "expired"], progress: ["valuing", "estimate_ready", "estimate", "won"] };
const ago = (iso: string) => {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : minutes < 48 * 60 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} days ago`;
};
const fileSize = (bytes: number) => bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export function LiveEnquiries({ palette: p, account, onOpenProperty, onRefresh }: { palette: Palette; account: WorkspaceAccount; onOpenProperty: (id: string) => void; onRefresh?: () => Promise<void> | void }) {
  const [data, setData] = useState<ClientEnquiries | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter | null>(null);
  const [sending, setSending] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setData(clientEnquiriesSchema.parse((await readTeams({ section: "clientEnquiries" })).data)); setError(""); } catch (e) { setError(message(e)); }
  }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  const steps = useMemo(() => new Map((data?.items ?? []).map(e => [e.id, enquiryStep(e)])), [data]);
  const count = (f: Exclude<Filter, "all">) => (data?.items ?? []).filter(e => FILTER_STEPS[f].includes(steps.get(e.id)!)).length;
  // Opens on what needs doing: answers to value, or everything when there are none.
  const shown: Filter = filter ?? (count("value") ? "value" : "all");
  // "As soon as possible" comes first within its step (Alex).
  const items = priorityFirst((data?.items ?? []).filter(e => shown === "all" || FILTER_STEPS[shown].includes(steps.get(e.id)!)), e => steps.get(e.id)!);
  const open = data?.items.find(e => e.id === openId) ?? null;
  return (
    <View style={{ gap: 18 }}>
      <PageHeading palette={p} title={LEADS_TITLE} subtitle="Send landlords the New Property Enquiry Form, see their answers here, then work each lead through to its estimate."
        action={<SoftButton palette={p} primary icon="plus" label="Send the form to a landlord" onPress={() => setSending(true)} />} />
      <StatGrid>
        <StatTile p={p} icon="inbox" tone="clients" label="To value" value={count("value")} attention={count("value") > 0} detail="Answered forms, ready to value" />
        <StatTile p={p} icon="clock" tone="stays" label="Waiting" value={count("waiting")} detail="Form sent, waiting for them" />
        <StatTile p={p} icon="trending-up" tone="accounts" label="Valuing" value={(data?.items ?? []).filter(e => steps.get(e.id) === "valuing").length} detail="Estimate being prepared" />
        <StatTile p={p} icon="award" tone="cleans" label="Sent" value={(data?.items ?? []).filter(e => ["estimate", "won"].includes(steps.get(e.id)!)).length} detail="Estimates with the landlord" />
      </StatGrid>
      <Segmented p={p} label="Leads" value={shown} onChange={setFilter} items={[
        { key: "value", label: "To value", count: count("value"), alert: count("value") > 0 }, { key: "waiting", label: "Waiting", count: count("waiting") },
        { key: "progress", label: "In progress", count: count("progress") }, { key: "all", label: "All" },
      ]} />
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {!data && !error && <Loading p={p} />}
      {data && !items.length && <Notice text={shown === "value" ? "No answered forms waiting. Send the form to a landlord to start." : "Nothing here yet."} p={p} />}
      <View style={{ gap: 10 }}>
        {items.map((e, i) => <Entrance key={e.id} delay={Math.min(i, 10) * motionTokens.stagger}><EnquiryRow p={p} enquiry={e} step={steps.get(e.id)!} onPress={() => setOpenId(e.id)} /></Entrance>)}
      </View>
      <SendSheet p={p} visible={sending} emailReady={!!data?.emailReady} onClose={() => setSending(false)} onSent={load} />
      <EnquirySheet key={open?.id ?? "none"} p={p} enquiry={open} step={open ? steps.get(open.id)! : "sent"} emailReady={!!data?.emailReady} onClose={() => setOpenId(null)} onChanged={load}
        canDelete={!!open && canDeleteEnquiry(account.role, open)} onDeleted={async () => { setOpenId(null); await Promise.all([load(), onRefresh?.()]); }}
        onOpenProperty={id => { setOpenId(null); onOpenProperty(id); }} />
    </View>
  );
}

function EnquiryRow({ p, enquiry: e, step, onPress }: { p: Palette; enquiry: ClientEnquiry; step: EnquiryStep; onPress: () => void }) {
  const a = e.answers;
  // On a phone the tags go under the details, so the name and address keep the row's width (round 6).
  const narrow = useWindowDimensions().width < 600;
  const priority = isPriority(e, step);
  const when = e.submittedAt ? `Answered ${ago(e.submittedAt)}` : e.openedAt ? `Opened ${ago(e.openedAt)}` : `Sent ${ago(e.sentAt)}${e.emailStatus === "failed" ? " · email failed" : e.delivery === "link" ? " · link copied" : ""}`;
  const tags = <>
    <Tag label={STEP_LABEL[step]} tone={STEP_TONE[step]} p={p} />
    {priority && <Tag label={PRIORITY_LABEL} tone="wait" p={p} />}
    {isOwnerEnquiry(e) && <Tag label={OWNER_ENQUIRY_LABEL} tone="plain" p={p} />}
    {isTeamEnquiry(e) && <Tag label={teamEnquiryTag(e)} tone="plain" p={p} />}
    {e.delivery === "email" && ["sent", "opened", "expired"].includes(step) && e.emailStatus !== "sent" && <Tag label={e.emailStatus === "failed" ? "Email failed" : "Sending…"} tone={e.emailStatus === "failed" ? "bad" : "plain"} p={p} />}
    {!!e.duplicateReason && step !== "closed" && <Tag label={DUPLICATE_LABEL} tone="bad" p={p} />}
    {e.files.length > 0 && <View style={[ui.row, { gap: 4 }]}><Feather name="image" size={12} color={p.muted} /><Text style={{ color: p.muted, fontSize: 11 }}>{e.files.length}</Text></View>}
  </>;
  return (
    <MotionPress {...(Platform.OS === "web" ? { dataSet: { hover: "lift" } } : {})} accessibilityRole="button" accessibilityLabel={`${a?.fullName ?? e.recipientName}, ${STEP_LABEL[step]}${priority ? ", " + PRIORITY_LABEL : ""}${e.duplicateReason ? ", " + DUPLICATE_LABEL : ""}${isTeamEnquiry(e) ? ", " + teamEnquiryTag(e) : ""}`} onPress={onPress}
      style={[ui.row, { gap: 14, padding: 16, borderRadius: 20, borderWidth: 1, borderColor: step === "received" ? p.waiting : p.border, backgroundColor: p.surface, ...depth.card }]}>
      <Initials p={p} name={a?.fullName ?? e.recipientName} tone="clients" size={44} />
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text numberOfLines={1} style={{ color: p.text, fontSize: 15, fontWeight: "800" }}>{a?.fullName ?? e.recipientName}{a?.companyName ? ` · ${a.companyName}` : ""}</Text>
        <Text numberOfLines={1} style={{ color: p.muted, fontSize: 13 }}>{a ? a.propertyAddress.replace(/\s*\n\s*/g, ", ") : e.recipientEmail}</Text>
        <View style={[ui.row, { gap: 8, flexWrap: "wrap", marginTop: 2 }]}>
          {a && <Text style={{ color: p.text, fontSize: 12, fontWeight: "600" }}>{a.propertyType} · {a.bedrooms} bed · {a.bathrooms} bath</Text>}
          <Text style={{ color: p.muted, fontSize: 12 }}>{when}</Text>
        </View>
        {narrow && <View style={[ui.row, { gap: 6, flexWrap: "wrap", marginTop: 4 }]}>{tags}</View>}
      </View>
      {!narrow && <View style={{ alignItems: "flex-end", gap: 6 }}>{tags}</View>}
      <Feather name="chevron-right" size={18} color={p.muted} />
    </MotionPress>
  );
}

// Writing the email: who to, the subject and the message (the form link is added for you).
function SendSheet({ p, visible, emailReady, onClose, onSent, resend }: { p: Palette; visible: boolean; emailReady: boolean; onClose: () => void; onSent: () => Promise<void>; resend?: ClientEnquiry }) {
  const celebrate = useCelebrate();
  const [name, setName] = useState(""), [email, setEmail] = useState(""), [subject, setSubject] = useState(DEFAULT_SUBJECT), [body, setBody] = useState(defaultBody(""));
  const [edited, setEdited] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [result, setResult] = useState<{ link: string; to: string; emailed: boolean; failed: boolean } | null>(null);
  const [copied, setCopied] = useState(false), [showPreview, setShowPreview] = useState(false);
  const request = useRequestId(visible ? ["send", resend?.id ?? "", name, email, subject, body].join(":") : null);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active || !visible) return;
      setName(resend?.recipientName ?? ""); setEmail(resend?.recipientEmail ?? ""); setSubject(resend?.subject ?? DEFAULT_SUBJECT); setBody(resend?.body ?? defaultBody(resend?.recipientName ?? ""));
      setEdited(false); setError(""); setResult(null); setCopied(false); setShowPreview(false);
    });
    return () => { active = false; };
  }, [visible, resend]);
  // The greeting follows the name until the message is edited by hand.
  const changeName = (v: string) => { setName(v); if (!edited) setBody(defaultBody(v)); };
  // With email ready the sheet only sends (the email goes out by itself); without it, or if a send fails, the link is the fallback.
  async function send(delivery: "email" | "link") {
    if (busy) return;
    if (!resend && (name.trim().length < 1 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim()))) { setError("Add their name and a valid email address."); return; }
    if (!subject.trim() || !body.trim()) { setError("Add a subject and a message."); return; }
    setBusy(true); setError("");
    try {
      const response = await writeTeams(resend
        ? { action: "resendEnquiry", requestId: request.get(), enquiryId: resend.id, version: resend.version, subject: subject.trim(), body: body.trim(), delivery }
        : { action: "inviteEnquiry", requestId: request.get(), name: name.trim(), email: email.trim(), subject: subject.trim(), body: body.trim(), delivery }) as { data: { link: string; enquiry: { emailStatus: string; recipientEmail: string } } };
      request.done();
      const status = response.data.enquiry.emailStatus;
      setResult({ link: response.data.link, to: response.data.enquiry.recipientEmail, emailed: status === "sent", failed: status === "failed" });
      if (status === "sent") celebrate("Email sent");
      await onSent();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function copy() {
    if (!result) return;
    try { await (globalThis.navigator as Navigator | undefined)?.clipboard?.writeText(result.link); setCopied(true); } catch { setError("Copy the link from the box below."); }
  }
  const mailto = result ? `mailto:${encodeURIComponent(result.to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.includes(LINK_PLACEHOLDER) ? body.split(LINK_PLACEHOLDER).join(result.link) : body + "\n\n" + result.link)}` : "";
  const preview = body.includes(LINK_PLACEHOLDER) ? body.split(LINK_PLACEHOLDER) : [body, ""];
  return (
    <Sheet palette={p} visible={visible} onClose={onClose} title={resend ? "Send a new link" : "Send the enquiry form"} subtitle={resend ? `${resend.recipientName} · ${resend.recipientEmail}` : "To a landlord, by email"} icon="building">
      {result ? <>
        <View style={{ alignItems: "center", gap: 10, paddingVertical: 8 }}>
          <View style={{ width: 64, height: 64, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: result.failed ? p.dangerWash : p.successWash }}>
            <Feather name={result.failed ? "alert-triangle" : result.emailed ? "check" : "link"} size={28} color={result.failed ? p.danger : p.success} />
          </View>
          <Text style={{ color: p.text, fontSize: 18, fontWeight: "800", textAlign: "center" }}>{result.emailed ? `Sent to ${result.to}` : result.failed ? "The email didn't go" : "Your link is ready"}</Text>
          <Text style={[ui.small, { color: p.muted, textAlign: "center" }]}>{result.emailed ? "Their answers will appear in Leads, and their replies to the email arrive in Messages. The link works for 30 days." : result.failed ? "Recharge couldn't send it. Try again from this enquiry, or send the link yourself: copy it below, or open your email app with the message filled in." : "Send it from your own email: copy the link, or open your email app with the message filled in."}</Text>
        </View>
        {/* Sent by Recharge: nothing to copy. Only the fallback (email not ready, or the send failed) shows the link. */}
        {!result.emailed && <>
          <View style={{ padding: 12, borderRadius: 14, backgroundColor: p.wash }}><Text selectable numberOfLines={2} style={{ color: p.text, fontSize: 12, fontVariant: ["tabular-nums"] }}>{result.link}</Text></View>
          <Button label={copied ? "Copied" : "Copy the link"} icon={copied ? "check" : "copy"} p={p} primary onPress={() => void copy()} />
          <Button label="Open my email app" icon="mail" p={p} onPress={() => void Linking.openURL(mailto).catch(() => setError("No email app could be opened. Copy the link instead."))} />
        </>}
        {!!error && <Notice text={error} p={p} tone="bad" />}
        <Button label="Done" icon="check" p={p} onPress={onClose} />
      </> : <>
        {!resend && <>
          <Field label="Their name" value={name} onChange={changeName} p={p} placeholder="Their name" />
          <Field label="Their email" value={email} onChange={setEmail} p={p} email placeholder="name@example.com" />
        </>}
        <Field label="Subject" value={subject} onChange={setSubject} p={p} />
        <Field label="Message" value={body} onChange={v => { setBody(v); setEdited(true); }} p={p} multiline />
        <Text style={[ui.small, { color: p.muted }]}>The form link goes at the end, or wherever you write {LINK_PLACEHOLDER}.</Text>
        {/* What they'll receive, behind a toggle: the message above is the same text, so it is not shown twice by default. */}
        <MotionPress accessibilityRole="button" accessibilityState={{ expanded: showPreview }} accessibilityLabel="Preview the email" onPress={() => setShowPreview(v => !v)} style={[ui.row, { gap: 8, minHeight: 40 }]}>
          <Text style={{ flex: 1, color: p.text, fontSize: 14, fontWeight: "600" }}>Preview the email</Text>
          <Feather name={showPreview ? "chevron-up" : "chevron-down"} size={18} color={p.muted} />
        </MotionPress>
        {showPreview && <View style={{ borderRadius: 18, borderWidth: 1, borderColor: p.border, backgroundColor: p.background, overflow: "hidden" }}>
          <View style={[ui.row, { gap: 8, paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 1, borderColor: p.border, backgroundColor: p.surface }]}>
            <Feather name="mail" size={14} color={p.muted} /><Text numberOfLines={1} style={{ flex: 1, color: p.text, fontSize: 13, fontWeight: "700" }}>{subject || "(no subject)"}</Text>
          </View>
          <View style={{ padding: 14, gap: 12 }}>
            <Text style={{ color: p.text, fontSize: 13, lineHeight: 20 }}>{preview[0].trim()}</Text>
            <View style={{ alignSelf: "flex-start", paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, backgroundColor: p.primary }}><Text style={{ color: p.onPrimary, fontSize: 13, fontWeight: "700" }}>Open the property form</Text></View>
            {!!preview[1]?.trim() && <Text style={{ color: p.text, fontSize: 13, lineHeight: 20 }}>{preview.slice(1).join(" ").trim()}</Text>}
          </View>
        </View>}
        {!emailReady && <Notice text="Recharge's email service isn't connected yet, so you send this yourself: make the link, then copy it or open your email app with the message filled in." p={p} />}
        {!!error && <Notice text={error} p={p} tone="bad" />}
        {emailReady ? <Button label={busy ? "Sending…" : resend ? "Send the new link" : "Send the form"} icon="send" primary p={p} disabled={busy} onPress={() => void send("email")} />
          : <Button label={busy ? "Making the link…" : "Make the link"} icon="link" primary p={p} disabled={busy} onPress={() => void send("link")} />}
      </>}
    </Sheet>
  );
}

const Line = ({ p, label, value, onPress }: { p: Palette; label: string; value?: string | null; onPress?: () => void }) => !value ? null : (
  <View style={[ui.row, { gap: 12, alignItems: "flex-start", paddingVertical: 9, borderBottomWidth: 1, borderColor: p.border }]}>
    <Text style={{ width: 132, color: p.muted, fontSize: 12, fontWeight: "600" }}>{label}</Text>
    {onPress ? <MotionPress accessibilityRole="link" onPress={onPress} style={{ flex: 1 }}><Text style={{ color: p.primary, fontSize: 13, fontWeight: "700", textDecorationLine: "underline" }}>{value}</Text></MotionPress>
      : <Text selectable style={{ flex: 1, color: p.text, fontSize: 13, lineHeight: 19 }}>{value}</Text>}
  </View>
);
function Group({ p, title, icon, children }: { p: Palette; title: string; icon: "user" | "home" | "image" | "briefcase" | "mail"; children: ReactNode }) {
  return <View style={{ gap: 4, marginTop: 10 }}>
    <View style={[ui.row, { gap: 8, marginBottom: 4 }]}><View style={{ width: 26, height: 26, borderRadius: 8, alignItems: "center", justifyContent: "center", backgroundColor: p.wash }}><Feather name={icon} size={13} color={p.primary} /></View><Text style={[ui.label, { color: p.muted }]}>{title}</Text></View>
    {children}
  </View>;
}

// Everything the landlord sent, and what to do next.
function EnquirySheet({ p, enquiry: e, step, emailReady, onClose, onChanged, onOpenProperty, canDelete = false, onDeleted }: {
  p: Palette; enquiry: ClientEnquiry | null; step: EnquiryStep; emailReady: boolean; onClose: () => void; onChanged: () => Promise<void>; onOpenProperty: (id: string) => void;
  canDelete?: boolean; onDeleted?: () => Promise<void>;
}) {
  const [mode, setMode] = useState<"view" | "value" | "close" | "resend" | "delete">("view");
  const [fileError, setFileError] = useState("");
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const a = e?.answers;
  // Pictures show as thumbnails (each a short-lived link); videos and HEIC photos as tiles.
  useEffect(() => {
    if (!e) return;
    let active = true;
    for (const f of e.files.filter(x => x.mime.startsWith("image/") && x.mime !== "image/heic").slice(0, 15))
      void enquiryFileLink(e.id, f.id).then(link => { if (active) setThumbs(t => ({ ...t, [f.id]: link.url })); }).catch(() => undefined);
    return () => { active = false; };
  }, [e]);
  async function openFile(fileId: string) {
    if (!e) return;
    setFileError("");
    try { const file = await enquiryFileLink(e.id, fileId); await Linking.openURL(file.url); } catch (err) { setFileError(message(err)); }
  }
  if (e && mode === "value") return <ValueSheet p={p} enquiry={e} onClose={() => setMode("view")} onDone={async id => { await onChanged(); onOpenProperty(id); }} />;
  if (e && mode === "close") return <CloseSheet p={p} enquiry={e} onClose={() => setMode("view")} onDone={async () => { setMode("view"); await onChanged(); }} />;
  if (e && mode === "delete") return <DeleteSheet p={p} enquiry={e} onClose={() => setMode("view")} onDone={async () => { setMode("view"); await onDeleted?.(); }} />;
  if (e && mode === "resend") return <SendSheet p={p} visible emailReady={emailReady} resend={e} onClose={() => setMode("view")} onSent={onChanged} />;
  if (!e) return null;
  // The lead's ticket (lib/lead-estimate.ts): what the landlord told us, with TBC beside what is still to collect, sits in
  // LeadTicket with the checklist and the thread; the notices, the photos and the enquiry's own buttons go above it.
  const header = <>
    {!!e.duplicateReason && step !== "closed" && <Notice text={`${DUPLICATE_LABEL}. ${duplicateNote(e)}`} p={p} tone="bad" />}
    {isOwnerEnquiry(e) && <Notice text={`${OWNER_ENQUIRY_LABEL}. ${OWNER_ENQUIRY_NOTE}`} p={p} />}
    {isTeamEnquiry(e) && <Notice text={`${teamEnquiryTag(e)}. ${TEAM_ENQUIRY_NOTE}`} p={p} />}
    {step === "received" && <Button label={valueButtonLabel(e)} icon="trending-up" primary p={p} onPress={() => setMode("value")} />}
    {e.propertyId && step !== "closed" && <Button label={`Open ${e.propertyName ?? "the property"}`} icon="arrow-right" primary={step !== "received"} p={p} onPress={() => onOpenProperty(e.propertyId!)} />}
    {e.propertyId && step === "received" && <Text style={[ui.small, { color: p.muted }]}>It is already in Properties as a new enquiry. Check the details, then work through Estimate Delivery on the checklist.</Text>}
    {e.propertyId && e.status === "valuing" && <Text style={[ui.small, { color: p.muted }]}>Valuing since {e.valuedAt ? ago(e.valuedAt) : "–"}{e.valuedByName ? `, by ${e.valuedByName}` : ""}. Work through Estimate Delivery on the checklist.</Text>}
    {!!e.ownerRepairLimit && <Text style={[ui.small, { color: p.text }]}>Repair limit chosen at Proceed: {repairLimitText(e.ownerRepairLimit.limitMinor)}. The limit in use is in Limit Changer.</Text>}
    {e.status === "closed" && <Notice text={`Closed by ${e.closedByName ?? "the team"}: ${e.closeNote}`} p={p} />}
    {(e.files.length > 0 || !!a?.mediaLink) && <Group p={p} title={`Photos and videos${e.files.length ? ` · ${e.files.length}` : ""}`} icon="image">
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {e.files.map(f => (
          <MotionPress key={f.id} {...(Platform.OS === "web" ? { dataSet: { hover: "lift" } } : {})} accessibilityRole="button" accessibilityLabel={"Open " + f.name} onPress={() => void openFile(f.id)}
            style={{ width: 132, padding: 10, gap: 6, borderRadius: 14, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface }}>
            <View style={{ height: 84, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: p.wash, overflow: "hidden" }}>
              {thumbs[f.id] ? <Image source={{ uri: thumbs[f.id] }} accessibilityIgnoresInvertColors style={{ width: "100%", height: "100%" }} resizeMode="cover" /> : <Feather name={f.mime.startsWith("video/") ? "film" : "image"} size={22} color={p.primary} />}
            </View>
            <Text numberOfLines={1} style={{ color: p.text, fontSize: 12, fontWeight: "700" }}>{f.name}</Text>
            <Text style={{ color: p.muted, fontSize: 11 }}>{fileSize(f.bytes)}</Text>
          </MotionPress>
        ))}
      </View>
      {!!a?.mediaLink && <Line p={p} label="Link they shared" value={a.mediaLink} onPress={() => void Linking.openURL(a.mediaLink!)} />}
      {!!fileError && <Notice text={fileError} p={p} tone="bad" />}
    </Group>}
    {!a && <Group p={p} title="The email" icon="mail">
      <Line p={p} label="To" value={`${e.recipientName} · ${e.recipientEmail}`} />
      <Line p={p} label="Subject" value={e.subject} />
      <Line p={p} label="How" value={e.delivery === "email" ? (e.emailStatus === "sent" ? "Sent by Recharge's email" : e.emailStatus === "failed" ? "The email failed: press Try again" : "Sending…") : "Link copied to send yourself"} />
      <Line p={p} label="Sent" value={`${ago(e.sentAt)}${e.sentByName ? ` by ${e.sentByName}` : ""}`} />
      <Line p={p} label="Opened" value={e.openedAt ? ago(e.openedAt) : "Not yet"} />
      <Line p={p} label="Link works until" value={new Date(e.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} />
    </Group>}
    {["sent", "opened", "expired"].includes(step) && <Button label={e.emailStatus === "failed" ? "Try again" : "Send a new link"} icon="refresh-cw" primary={e.emailStatus === "failed"} p={p} onPress={() => setMode("resend")} />}
    {!["valuing", "estimate", "won", "declined", "closed"].includes(step) && <Button label="Close this enquiry" icon="x" p={p} onPress={() => setMode("close")} />}
    {canDelete && <DeleteLink p={p} onPress={() => setMode("delete")} />}
  </>;
  return (
    <LeadTicket p={p} enquiry={e} header={header} subtitle={STEP_LABEL[step] + (e.submittedAt ? ` · answered ${ago(e.submittedAt)}` : ` · sent ${ago(e.sentAt)}`)}
      onClose={onClose} onChanged={onChanged} onOpenProperty={onOpenProperty} onValue={step === "received" ? () => setMode("value") : undefined} />
  );
}

// "Start valuing": the property's details from the answers, checked, then the property and its
// onboarding journey are made, ready for the estimate. Since 20261015200000 the property is made when the
// form comes back, so this is "Check the details and value": the corrections are saved onto it.
function ValueSheet({ p, enquiry: e, onClose, onDone }: { p: Palette; enquiry: ClientEnquiry; onClose: () => void; onDone: (propertyId: string) => Promise<void> }) {
  const celebrate = useCelebrate();
  const draft = valuationDraft(e.answers!);
  const [name, setName] = useState(draft.name), [address, setAddress] = useState(draft.address), [region, setRegion] = useState(SCOTTISH_REGIONS.some(r => r === draft.region) ? draft.region : "");
  const [type, setType] = useState(draft.propertyType), [bedrooms, setBedrooms] = useState(String(draft.bedrooms)), [bathrooms, setBathrooms] = useState(String(draft.bathrooms));
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useRequestId(["value", e.id, e.version].join(":"));
  async function start() {
    if (busy) return;
    const beds = Number(bedrooms), baths = Number(bathrooms);
    if (name.trim().length < 2 || address.trim().length < 5 || type.trim().length < 2 || !Number.isInteger(beds) || !Number.isInteger(baths) || beds < 0 || baths < 0) { setError("Check the name, address, type and rooms."); return; }
    setBusy(true); setError("");
    try {
      const result = await writeTeams({ action: "startValuing", requestId: request.get(), enquiryId: e.id, version: e.version, name: name.trim(), address: address.trim(), region, propertyType: type.trim(), bedrooms: beds, bathrooms: baths, enquiry: draft.enquiry }) as { data: ClientEnquiry };
      request.done(); celebrate("Valuation started");
      await onDone(result.data.propertyId!);
    } catch (err) { setError(message(err)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible onClose={onClose} title={valueButtonLabel(e)} subtitle={e.answers!.fullName} icon="building">
      <Text style={[ui.small, { color: p.muted }]}>{e.propertyId
        ? "The property is already in Properties. Correct anything here and it is saved onto it, with everything they told us. Then publish the estimate from the property."
        : "This adds the property and its onboarding, with everything they told us. Then publish the estimate from the property."}</Text>
      <Field label="Property name" value={name} onChange={setName} p={p} placeholder="A short name the team will recognise" />
      <Field label="Property address" value={address} onChange={setAddress} p={p} multiline />
      <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Area</Text>
      <ChoiceField p={p} label="Area" value={region} onChange={setRegion} options={[{ value: "", label: "Not sure" }, ...SCOTTISH_REGIONS.map(r => ({ value: r as string, label: r as string }))]} />
      <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Property type</Text>
      <ChoiceField p={p} label="Property type" value={type} onChange={setType} options={[...(type ? [] : [{ value: "", label: "Not chosen yet" }]), ...[...new Set([type, ...PROPERTY_TYPES])].filter(Boolean).map(t => ({ value: t, label: t }))]} />
      <View style={[ui.row, { gap: 10 }]}>
        <View style={{ flex: 1 }}><Field label="Bedrooms" value={bedrooms} onChange={setBedrooms} p={p} /></View>
        <View style={{ flex: 1 }}><Field label="Full bathrooms" value={bathrooms} onChange={setBathrooms} p={p} /></View>
      </View>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : e.propertyId ? "Save and start valuing" : "Start valuing"} icon="trending-up" primary p={p} disabled={busy} onPress={() => void start()} />
    </Sheet>
  );
}

// The quiet danger link for Delete, at the bottom of the enquiry sheet and the property's Onboarding sheet (E's review).
function DeleteLink({ p, onPress }: { p: Palette; onPress: () => void }) {
  return (
    <MotionPress accessibilityRole="button" accessibilityLabel="Delete this enquiry" onPress={onPress} style={[ui.row, { gap: 8, minHeight: 44, alignSelf: "flex-start", paddingHorizontal: 4 }]}>
      <Feather name="trash-2" size={15} color={p.danger} />
      <Text style={{ color: p.danger, fontSize: 14, fontWeight: "600" }}>Delete this enquiry</Text>
    </MotionPress>
  );
}

// Delete from elsewhere (the property's Onboarding sheet): a quiet danger link at the bottom, then the same sheet.
// Admins and super admins only, at the stages canDeleteEnquiry allows.
export function DeleteEnquiryAction({ p, role, enquiry, onDeleted }: { p: Palette; role: string; enquiry: ClientEnquiry; onDeleted: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  if (!canDeleteEnquiry(role, enquiry)) return null;
  return <>
    <DeleteLink p={p} onPress={() => setOpen(true)} />
    {open && <DeleteSheet p={p} enquiry={enquiry} onClose={() => setOpen(false)} onDone={async () => { setOpen(false); await onDeleted(); }} />}
  </>;
}

// Delete (admins and super admins): asks first, in a sheet. The database refuses one past the agreement, or with money or bookings.
function DeleteSheet({ p, enquiry: e, onClose, onDone }: { p: Palette; enquiry: ClientEnquiry; onClose: () => void; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useRequestId(["delete", e.id, e.version].join(":"));
  async function remove() {
    if (busy) return;
    setBusy(true); setError("");
    try { await writeTeams({ action: "deleteEnquiry", requestId: request.get(), enquiryId: e.id, version: e.version }); request.done(); await onDone(); }
    catch (err) { setError(message(err)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible onClose={onClose} title="Delete enquiry" subtitle={e.answers?.fullName ?? e.recipientName} icon="building">
      <Text style={[ui.body, { color: p.text }]}>{deleteEnquiryWarning(e)}</Text>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
        <Button label={busy ? "Deleting…" : "Delete enquiry"} icon="trash-2" primary p={p} disabled={busy} onPress={() => void remove()} />
        <Button label="Keep it" p={p} disabled={busy} onPress={onClose} />
      </View>
    </Sheet>
  );
}

function CloseSheet({ p, enquiry: e, onClose, onDone }: { p: Palette; enquiry: ClientEnquiry; onClose: () => void; onDone: () => Promise<void> }) {
  const [note, setNote] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const request = useRequestId(["close", e.id, e.version, note.trim()].join(":"));
  async function close() {
    if (busy) return;
    if (note.trim().length < 3) { setError("Say why, for the record."); return; }
    setBusy(true); setError("");
    try { await writeTeams({ action: "closeEnquiry", requestId: request.get(), enquiryId: e.id, version: e.version, note: note.trim() }); request.done(); await onDone(); }
    catch (err) { setError(message(err)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible onClose={onClose} title="Close this enquiry" subtitle={e.answers?.fullName ?? e.recipientName} icon="building">
      <Text style={[ui.small, { color: p.muted }]}>{!e.answers ? "The form link stops working, and it stays on record."
        : e.propertyId && (!e.stage || e.stage === "enquiry") ? "It stays on record, closed. Its property in Properties is archived too." : "It stays on record, closed."}</Text>
      <Field label="Why" value={note} onChange={setNote} p={p} multiline placeholder="Not in an area we cover" />
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : "Close the enquiry"} icon="x" primary p={p} disabled={busy} onPress={() => void close()} />
    </Sheet>
  );
}
