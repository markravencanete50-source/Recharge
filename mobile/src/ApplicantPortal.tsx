import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
import { Text } from "./Typography";
import { Button, Field, Notice, Tag, message, useRequestId } from "./LiveKit";
import { liveApi } from "./LivePages";
import { SignaturePad } from "./SignaturePad";
import { ContractText, slotLabel } from "./Hiring";
import { ui, type Palette } from "./theme";
import { APPLICATION_STAGE_LABEL, RESPONSE_PROMISE, applicantReadSchema, type ApplicantApplication, type ApplicantRead } from "../../lib/careers";

// An applicant's account (migration 20261031400000): a sign-in that stays pending, so it sees only this. Each application
// shows where it is; they choose an interview time or decline it (within 3 days), accept or turn down the offer, read and
// sign the contract, message recruitment, or withdraw. Accounts that are not an applicant's show the usual waiting screen.
export function ApplicantPortal({ p, fallback, footer }: { p: Palette; fallback: ReactNode; footer: ReactNode }) {
  const [read, setRead] = useState<ApplicantRead | null>(null), [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    try { setRead(applicantReadSchema.parse((await liveApi("/applicant")).data)); setFailed(false); } catch { setFailed(true); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  if (failed && !read) return <>{fallback}</>;
  if (!read) return <View style={[ui.fill, { backgroundColor: p.background, alignItems: "center", justifyContent: "center" }]}><ActivityIndicator accessibilityLabel="Loading" color={p.primary} /></View>;
  if (!read.applicant) return <>{fallback}</>;
  return <ScrollView style={[ui.fill, { backgroundColor: p.background }]} contentContainerStyle={{ padding: 20, gap: 16, maxWidth: 720, width: "100%", alignSelf: "center" }}>
    <View style={{ gap: 4 }}>
      <Text style={{ color: p.text, fontSize: 24, fontWeight: "700" }}>Your applications</Text>
      <Text style={[ui.small, { color: p.muted }]}>{read.name ? `Hi ${read.name.split(" ")[0]}. ` : ""}{RESPONSE_PROMISE}</Text>
    </View>
    {read.applications.map(a => <Application key={a.id} p={p} a={a} onRead={setRead} />)}
    {!read.applications.length && <Text style={{ color: p.muted }}>No applications yet.</Text>}
    {footer}
  </ScrollView>;
}

function Application({ p, a, onRead }: { p: Palette; a: ApplicantApplication; onRead: (r: ApplicantRead) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [note, setNote] = useState("");
  const [reading, setReading] = useState(false), [signedName, setSignedName] = useState(""), [signature, setSignature] = useState(""), [agreed, setAgreed] = useState(false);
  const [writing, setWriting] = useState(false), [text, setText] = useState(""), [declining, setDeclining] = useState<"interview" | "offer" | null>(null), [leaving, setLeaving] = useState(false);
  const request = useRequestId(a.id);
  async function act(body: Record<string, unknown>, key: string) {
    setBusy(true); setError("");
    try { onRead(applicantReadSchema.parse((await liveApi("/applicant", { ...body, candidateId: a.id, requestId: request.get(key) })).data)); request.done(key); return true; }
    catch (e) { setError(message(e)); return false; } finally { setBusy(false); }
  }
  const i = a.interview, k = a.contract;
  const tone = a.stage === "hired" || a.stage === "signed" || a.stage === "accepted" ? "good" : a.stage === "closed" || a.stage === "withdrawn" ? "bad" : "wait";
  return <View style={{ gap: 10, padding: 16, borderRadius: 18, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface }}>
    <View style={[ui.between, { gap: 8, flexWrap: "wrap" }]}>
      <View style={{ flexShrink: 1 }}><Text style={{ color: p.text, fontSize: 17, fontWeight: "600" }}>{a.title}</Text><Text style={[ui.small, { color: p.muted }]}>{a.area}</Text></View>
      <Tag p={p} label={APPLICATION_STAGE_LABEL[a.stage]} tone={tone} />
    </View>
    {/* The interview: a time to choose, or the one booked. */}
    {i && a.open && (i.status === "invited" || i.status === "booked") && <View style={{ gap: 6 }}>
      <Text style={{ color: p.text, fontWeight: "600" }}>{i.status === "booked" && i.at ? `Your interview: ${slotLabel(i.at)}` : "Choose a time for your interview"}</Text>
      <Text style={[ui.small, { color: p.muted }]}>{i.mode === "in_person" ? "In person" : "Video call"}{i.minutes ? `, about ${i.minutes} minutes` : ""}{i.place ? `. ${i.mode === "in_person" ? "Where" : "Link"}: ${i.place}` : ""}{i.status === "invited" && i.expiresAt ? `. Please answer by ${slotLabel(i.expiresAt)}.` : ""}</Text>
      <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>
        {i.freeSlots.map(s => <Button key={s} label={slotLabel(s)} icon={i.at === s ? "check" : "clock"} primary={i.at === s} quiet={i.at !== s} p={p} disabled={busy || i.at === s} onPress={() => void act({ action: "bookInterview", at: s }, "book")} />)}
        {!i.freeSlots.length && <Text style={[ui.small, { color: p.muted }]}>No times are free just now. Message us and we will find one.</Text>}
      </View>
      <Button label="I can't make it" icon="x" quiet p={p} disabled={busy} onPress={() => setDeclining(declining === "interview" ? null : "interview")} />
    </View>}
    {i && i.status === "expired" && <Text style={[ui.small, { color: p.muted }]}>Your interview invitation has expired. Message us if you would still like one.</Text>}
    {/* The offer. */}
    {a.open && a.offerStatus === "offered" && <View style={{ gap: 6 }}>
      <Text style={{ color: p.text, fontWeight: "600" }}>We would like to offer you the job.</Text>
      <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>
        <Button label="Accept the offer" icon="thumbs-up" primary p={p} disabled={busy} onPress={() => void act({ action: "answerOffer", answer: "accept" }, "offer")} />
        <Button label="Turn it down" icon="thumbs-down" quiet p={p} disabled={busy} onPress={() => setDeclining(declining === "offer" ? null : "offer")} />
      </View>
    </View>}
    {declining && <View style={{ gap: 6 }}>
      <Field label="Anything you'd like to tell us (optional)" value={note} onChange={setNote} p={p} multiline />
      <Button label={declining === "interview" ? "Decline the interview" : "Turn down the offer"} icon="check" p={p} disabled={busy}
        onPress={() => void act(declining === "interview" ? { action: "declineInterview", note: note.trim() } : { action: "answerOffer", answer: "decline", note: note.trim() }, declining).then(ok => { if (ok) { setDeclining(null); setNote(""); } })} />
    </View>}
    {/* The contract: read it, then sign it with a drawn signature. */}
    {k && <View style={{ gap: 6, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: p.border }}>
      <View style={[ui.between, { gap: 8 }]}>
        <Text style={{ color: p.text, fontWeight: "600", flexShrink: 1 }}>{k.title}</Text>
        <Tag p={p} label={k.signedAt ? "Signed" : "To sign"} tone={k.signedAt ? "good" : "wait"} />
      </View>
      <Button label={reading ? "Hide the contract" : "Read the contract"} icon="file-text" quiet p={p} onPress={() => setReading(!reading)} />
      {reading && <ContractText p={p} body={k.body} directorName={k.directorName} directorSignature={k.directorSignature} signedName={k.signedName} signedSignature={k.signedSignature} />}
      {!k.signedAt && a.open && reading && <View style={{ gap: 8 }}>
        <Field label="Your full name" value={signedName} onChange={setSignedName} p={p} />
        <SignaturePad p={p} label="Your signature" onChange={setSignature} disabled={busy} />
        <Button label={agreed ? "I have read and agree to this contract ✓" : "I have read and agree to this contract"} icon={agreed ? "check-square" : "square"} quiet p={p} onPress={() => setAgreed(!agreed)} />
        <Button label="Sign the contract" icon="edit-3" primary p={p} disabled={busy || !agreed || !signature || signedName.trim().length < 2}
          onPress={() => void act({ action: "signContract", signedName: signedName.trim(), signatureImage: signature, consent: true }, "sign")} />
      </View>}
    </View>}
    {a.stage === "hired" && <Text style={[ui.small, { color: p.text }]}>Welcome to Recharge! Your team account is being set up and you will see your workspace here soon.</Text>}
    {/* Messages with recruitment. */}
    <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>
      <Button label={writing ? "Hide messages" : a.messages.length ? `Messages (${a.messages.length})` : "Message recruitment"} icon="message-circle" quiet p={p} onPress={() => setWriting(!writing)} />
      {a.open && a.stage !== "signed" && <Button label="Withdraw my application" icon="log-out" quiet p={p} disabled={busy} onPress={() => setLeaving(!leaving)} />}
    </View>
    {leaving && <View style={{ gap: 6 }}>
      <Text style={[ui.small, { color: p.text }]}>Withdraw your application for {a.title}? This can't be undone.</Text>
      <Button label="Yes, withdraw it" icon="check" p={p} disabled={busy} onPress={() => void act({ action: "withdraw" }, "withdraw").then(ok => { if (ok) setLeaving(false); })} />
    </View>}
    {writing && <View style={{ gap: 6 }}>
      {a.messages.map(m => <View key={m.id} style={{ alignSelf: m.fromApplicant ? "flex-end" : "flex-start", maxWidth: "88%", padding: 8, borderRadius: 10, backgroundColor: m.fromApplicant ? p.wash : p.background, borderWidth: 1, borderColor: p.border }}>
        <Text style={{ color: p.muted, fontSize: 12 }}>{m.authorName} · {slotLabel(m.at)}</Text>
        <Text style={{ color: p.text, fontSize: 14 }}>{m.body}</Text>
      </View>)}
      <Field label="Your message" value={text} onChange={setText} p={p} multiline />
      <Button label="Send" icon="send" p={p} disabled={busy || !text.trim()} onPress={() => void act({ action: "sendMessage", body: text.trim() }, "message").then(ok => { if (ok) setText(""); })} />
    </View>}
    {!!error && <Notice p={p} tone="bad" text={error} />}
  </View>;
}
