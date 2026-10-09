import { useEffect, useState } from "react";
import { Linking, TextInput, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { FeatureTile } from "./Artwork";
import { Sheet } from "./TeamFlows";
import { Button, Loading, Notice, message } from "./LiveKit";
import { MotionPress } from "./motion";
import { ui, type Palette } from "./theme";
import { exportReport } from "./exportReport";
import { deleteMyAccount, liveApiOrigin, readPrivacy } from "./backend/client";
import { DELETE_PHRASE, deletionCopy, deletionSummarySchema, exportFileName, type DeletionSummary } from "../../lib/privacy-policy";
import { LEGAL_PATHS } from "../../lib/legal-details";

// Your data and your account: the privacy policy and terms, a copy of your data, and deleting
// your account. The policy pages live on the backend's own site, so they open in the browser.
export const openLegal = (page: keyof typeof LEGAL_PATHS) => Linking.openURL((liveApiOrigin() ?? "") + LEGAL_PATHS[page]).catch(() => undefined);

function LinkText({ p, label, onPress }: { p: Palette; label: string; onPress: () => void }) {
  return <Text accessibilityRole="link" onPress={onPress} style={{ color: p.primary, fontWeight: "700", textDecorationLine: "underline" }}>{label}</Text>;
}
// "By continuing you agree to the Terms and Privacy policy", under the sign-in button.
export function LegalConsent({ p }: { p: Palette }) {
  return <Text style={[ui.small, { color: p.muted, textAlign: "center" }]}>By continuing you agree to the <LinkText p={p} label="Terms" onPress={() => void openLegal("terms")} /> and <LinkText p={p} label="Privacy policy" onPress={() => void openLegal("privacy")} />.</Text>;
}
// The quiet links at the foot of Help.
export function LegalLinks({ p }: { p: Palette }) {
  return (
    <View style={[ui.row, { gap: 18, flexWrap: "wrap", justifyContent: "center", paddingVertical: 8 }]}>
      <LinkText p={p} label="Privacy policy" onPress={() => void openLegal("privacy")} />
      <LinkText p={p} label="Terms" onPress={() => void openLegal("terms")} />
      <LinkText p={p} label="Delete your account" onPress={() => void openLegal("deleteAccount")} />
    </View>
  );
}

function Row({ p, icon, title, detail, onPress, tone = "plain", busy = false, last = false }: { p: Palette; icon: "download" | "shield" | "file-text" | "trash-2"; title: string; detail: string; onPress: () => void; tone?: "plain" | "bad"; busy?: boolean; last?: boolean }) {
  return <>
    <MotionPress accessibilityRole="button" accessibilityState={{ disabled: busy, busy }} disabled={busy} onPress={onPress} style={[ui.between, { gap: 16, minHeight: 64, paddingHorizontal: 16, paddingVertical: 12 }]}>
      <FeatureTile icon={icon} size={36} palette={p} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[ui.body, { color: tone === "bad" ? p.danger : p.text, fontWeight: "600" }]}>{title}</Text>
        <Text style={[ui.small, { color: p.muted }]}>{detail}</Text>
      </View>
      <Feather name={icon === "download" ? "download" : icon === "trash-2" ? "chevron-right" : "external-link"} size={17} color={tone === "bad" ? p.danger : p.muted} />
    </MotionPress>
    {!last && <View style={{ height: 1, backgroundColor: p.border, marginLeft: 68 }} />}
  </>;
}

// The "Your data" block in Profile & preferences.
export function PrivacySection({ p, onDelete }: { p: Palette; onDelete: () => void }) {
  const [busy, setBusy] = useState(false), [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  async function download() {
    setBusy(true); setNote(null);
    try {
      const result = await readPrivacy({ section: "export" }) as { data?: unknown };
      await exportReport(JSON.stringify(result.data ?? {}, null, 2), exportFileName(), { mime: "application/json", uti: "public.json" });
      setNote({ text: "Your data is ready. It holds your profile, your work, your messages and, for owners, your onboarding and statements.", bad: false });
    } catch (e) { setNote({ text: message(e), bad: true }); } finally { setBusy(false); }
  }
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: p.muted, fontSize: 11, fontWeight: "600", letterSpacing: 1.4, textTransform: "uppercase" }}>Your data</Text>
      <View style={{ borderRadius: 20, borderWidth: 1, borderColor: p.border, backgroundColor: p.background }}>
        <Row p={p} icon="download" title={busy ? "Preparing your data…" : "Download my data"} detail="A copy of what Recharge holds about you, as a file." busy={busy} onPress={() => void download()} />
        <Row p={p} icon="shield" title="Privacy policy" detail="What we keep, why, and for how long." onPress={() => void openLegal("privacy")} />
        <Row p={p} icon="file-text" title="Terms" detail="The rules for using Recharge." onPress={() => void openLegal("terms")} />
        <Row p={p} icon="trash-2" tone="bad" title="Delete my account" detail="Removes your sign-in and personal details." onPress={onDelete} last />
      </View>
      {!!note && <Notice p={p} text={note.text} tone={note.bad ? "bad" : "plain"} />}
    </View>
  );
}

function PasswordInput({ p, value, onChange }: { p: Palette; value: string; onChange: (v: string) => void }) {
  const [shown, setShown] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Your password</Text>
      <View style={[ui.row, { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: p.controlBorder, backgroundColor: p.background }]}>
        <TextInput value={value} onChangeText={onChange} secureTextEntry={!shown} autoCapitalize="none" autoCorrect={false} autoComplete="current-password" textContentType="password" accessibilityLabel="Your password"
          style={{ flex: 1, minWidth: 0, minHeight: 46, paddingHorizontal: 12, color: p.text, fontFamily: "Montserrat_500Medium", fontSize: 14 }} />
        <MotionPress accessibilityRole="button" accessibilityLabel={shown ? "Hide password" : "Show password"} onPress={() => setShown(!shown)} style={{ width: 48, minHeight: 46, alignItems: "center", justifyContent: "center" }}>
          <Feather name={shown ? "eye-off" : "eye"} size={17} color={p.muted} />
        </MotionPress>
      </View>
    </View>
  );
}

function List({ p, title, items, icon, colour }: { p: Palette; title: string; items: string[]; icon: "x-circle" | "archive"; colour: string }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={[ui.body, { color: p.text, fontWeight: "700" }]}>{title}</Text>
      {items.map(item => <View key={item} style={[ui.row, { gap: 10, alignItems: "flex-start" }]}><Feather name={icon} size={15} color={colour} style={{ marginTop: 3 }} /><Text style={[ui.small, { color: p.text, flex: 1 }]}>{item}</Text></View>)}
    </View>
  );
}

// Explains what goes and what stays, then asks for DELETE and the password.
export function DeleteAccountSheet({ p, visible, onClose, onDeleted }: { p: Palette; visible: boolean; onClose: () => void; onDeleted: () => void }) {
  const [summary, setSummary] = useState<DeletionSummary | null>(null), [phrase, setPhrase] = useState(""), [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    if (!visible) return;
    let active = true;
    queueMicrotask(() => { if (active) { setSummary(null); setPhrase(""); setPassword(""); setError(""); } });
    readPrivacy({ section: "deletion" }).then(result => { if (active) setSummary(deletionSummarySchema.parse((result as { data?: unknown }).data)); }).catch(e => { if (active) setError(message(e)); });
    return () => { active = false; };
  }, [visible]);
  const ready = phrase.trim() === DELETE_PHRASE && password.length > 0 && !busy;
  async function remove() {
    if (!ready) return;
    setBusy(true); setError("");
    try { await deleteMyAccount({ confirm: DELETE_PHRASE, password }); setPassword(""); onDeleted(); }
    catch (e) { setPassword(""); setError(message(e)); } finally { setBusy(false); }
  }
  const copy = summary ? deletionCopy(summary) : null;
  return (
    <Sheet palette={p} visible={visible} onClose={onClose} title="Delete my account" subtitle="This can’t be undone" icon="people">
      {!copy && !error && <Loading p={p} rows={3} />}
      {copy && <>
        {!!copy.blocked && <Notice p={p} tone="bad" text={copy.blocked} />}
        <List p={p} title="What is deleted" items={copy.deleted} icon="x-circle" colour={p.danger} />
        <List p={p} title="What is kept" items={copy.kept} icon="archive" colour={p.primary} />
        {!!copy.properties && <Notice p={p} text={copy.properties} />}
        {!copy.blocked && <>
          <View style={{ gap: 6 }}>
            <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Type {DELETE_PHRASE} to confirm</Text>
            <TextInput value={phrase} onChangeText={setPhrase} autoCapitalize="characters" autoCorrect={false} accessibilityLabel={`Type ${DELETE_PHRASE} to confirm`} placeholder={DELETE_PHRASE} placeholderTextColor={p.muted}
              style={{ minHeight: 48, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: p.controlBorder, color: p.text, backgroundColor: p.background, fontFamily: "Montserrat_500Medium", fontSize: 14 }} />
          </View>
          <PasswordInput p={p} value={password} onChange={setPassword} />
        </>}
      </>}
      {!!error && <Notice p={p} tone="bad" text={error} />}
      <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
        <Button label="Keep my account" p={p} onPress={onClose} />
        {!copy?.blocked && <MotionPress accessibilityRole="button" accessibilityState={{ disabled: !ready, busy }} disabled={!ready} onPress={() => void remove()}
          style={[ui.button, { flexGrow: 1, backgroundColor: ready ? p.danger : p.elevated }]}>
          <Feather name="trash-2" size={16} color={ready ? p.onPrimary : p.muted} />
          <Text style={[ui.buttonText, { color: ready ? p.onPrimary : p.muted }]}>{busy ? "Deleting…" : "Delete my account"}</Text>
        </MotionPress>}
      </View>
    </Sheet>
  );
}

// For accounts still waiting for approval (or blocked): the same deletion, from the waiting screen.
export function DeleteAccountButton({ p, onDeleted }: { p: Palette; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  return <>
    <MotionPress accessibilityRole="button" onPress={() => setOpen(true)} style={{ alignSelf: "center", minHeight: 44, justifyContent: "center", paddingHorizontal: 12 }}>
      <Text style={{ color: p.danger, fontWeight: "700" }}>Delete my account</Text>
    </MotionPress>
    <DeleteAccountSheet p={p} visible={open} onClose={() => setOpen(false)} onDeleted={() => { setOpen(false); onDeleted(); }} />
  </>;
}
