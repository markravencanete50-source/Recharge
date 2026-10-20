import { useCallback, useEffect, useState } from "react";
import { Platform, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import * as Linking from "expo-linking";
import { Text } from "./Typography";
import { ui, type Palette } from "./theme";
import { Button, Field, Loading, message, Notice, Section, Tag, useRequestId } from "./LiveKit";
import { MotionPress } from "./motion";
import { useToolTitled } from "./ToolPage";
import { agreementFileLink, readClientOnboarding, readOnboardingSettings, saveClientOnboarding, saveOnboardingSettings, uploadAgreementTemplate } from "./backend/client";
import { clientOnboardingSchema, VIDEO_LINK_MESSAGE, VIDEO_SETTINGS_HELP, VIDEO_STEP_LABEL, VIDEO_STEPS, type VideoStep } from "../../lib/client-onboarding";
import { isOnboardingVideoLink } from "../../lib/video-embed";
import { isWorkspaceAdmin } from "../../lib/modules";
import {
  AGREEMENT_PLACEHOLDERS, MAX_AGREEMENT_BYTES, MAX_OWN_COST_CATEGORIES, PLACEHOLDER_HELP, fileSizeLabel, onboardingSettingsSchema, placeholderToken, type OnboardingSettings as Settings,
} from "../../lib/agreement-template";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";

// Onboarding settings (Management centre, admins only): the contract every new management agreement is made from,
// Recharge's details for the agreement, and the "Your own costs" categories on the estimate. The database keeps every
// contract uploaded; an agreement already published or signed keeps the wording it was made with.
const day = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" });
const KIND = { docx: "Word document", pdf: "PDF" } as const;

export function OnboardingSettings({ p, account }: { p: Palette; account: WorkspaceAccount }) {
  const allowed = isWorkspaceAdmin(account.role), titled = useToolTitled();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [company, setCompany] = useState("");
  const [categories, setCategories] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const show = useCallback((next: Settings) => { setSettings(next); setCompany(next.companyDetails); setCategories(next.ownCostCategories); }, []);
  const load = useCallback(async () => {
    setError("");
    try { show(onboardingSettingsSchema.parse((await readOnboardingSettings()).data)); } catch (e) { setError(message(e)); }
  }, [show]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active && allowed) void load(); }); return () => { active = false; }; }, [load, allowed]);

  async function act(key: string, action: Record<string, unknown>, done: string) {
    setBusy(key); setError(""); setNote("");
    try { show(onboardingSettingsSchema.parse((await saveOnboardingSettings(action)).data)); setNote(done); } catch (e) { setError(message(e)); } finally { setBusy(""); }
  }
  async function upload() {
    setError(""); setNote("");
    const picked = await DocumentPicker.getDocumentAsync({ type: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/pdf"], copyToCacheDirectory: true, multiple: false });
    if (picked.canceled || !picked.assets?.length) return;
    const asset = picked.assets[0];
    if (asset.size && asset.size > MAX_AGREEMENT_BYTES) { setError("Contracts can be up to 5 MB."); return; }
    setBusy("upload");
    try {
      const result = await uploadAgreementTemplate(Crypto.randomUUID(), { uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? undefined, file: (asset as { file?: File }).file });
      show(onboardingSettingsSchema.parse((result as { data?: unknown }).data));
      setNote("Contract uploaded. New agreements are made from it; agreements already published keep their wording.");
    } catch (e) { setError(message(e)); } finally { setBusy(""); }
  }
  async function open(templateId: string) {
    setBusy("open:" + templateId); setError("");
    try { await Linking.openURL((await agreementFileLink(templateId)).url); } catch (e) { setError(message(e)); } finally { setBusy(""); }
  }

  if (!allowed) return <Notice text="Onboarding settings are for admins." p={p} />;
  if (!settings) return error ? <Notice text={error} p={p} tone="bad" /> : <Loading p={p} />;
  const t = settings.template;
  const cleaned = categories.map(c => c.trim());
  const categoriesChanged = cleaned.join("\n") !== settings.ownCostCategories.join("\n");

  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 4 }}>
        {!titled && <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Onboarding settings</Text>}
        <Text style={[ui.small, { color: p.muted }]}>{"The contract new management agreements are made from, Recharge's details, and the owner's own costs on the estimate."}</Text>
      </View>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {!!note && <Text accessibilityLiveRegion="polite" style={[ui.small, { color: p.muted }]}>{note}</Text>}

      <Section title="Agreement contract" p={p}>
        <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 12 }]}>
          {t ? <>
            <View style={[ui.row, { gap: 10 }]}>
              <Feather name="file-text" size={20} color={p.primary} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text numberOfLines={2} style={{ color: p.text, fontWeight: "600" }}>{t.fileName}</Text>
                <Text style={[ui.small, { color: p.muted }]}>Contract {t.version} · {KIND[t.kind]} · {fileSizeLabel(t.bytes)} · uploaded {day(t.uploadedAt)}{t.uploadedByName ? " by " + t.uploadedByName : ""} · used for {t.agreements} {t.agreements === 1 ? "agreement" : "agreements"}</Text>
              </View>
            </View>
            {t.kind === "pdf"
              ? <Text style={[ui.small, { color: p.muted }]}>{"A PDF can't be filled in. Each agreement gets a cover page with the owner's, the property's and Recharge's details, and the PDF goes with it."}</Text>
              : t.placeholders.length
                ? <View style={{ gap: 6 }}>
                    <Text style={[ui.small, { color: p.text, fontWeight: "600" }]}>Filled in for each owner</Text>
                    <View style={[ui.row, { flexWrap: "wrap", gap: 6 }]}>{t.placeholders.map(name => <Tag key={name} label={name} tone="good" p={p} />)}</View>
                  </View>
                : <Text style={[ui.small, { color: p.muted }]}>{"No placeholders were found, so each agreement starts with a block of the owner's, the property's and Recharge's details, then this contract's wording."}</Text>}
            {!!t.unknown.length && <Notice tone="bad" p={p} text={`Not recognised, so left as written: ${t.unknown.join(", ")}. Use the names listed below, then upload the contract again.`} />}
            <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
              <Button label={busy === "open:" + t.id ? "Opening…" : "Open the contract"} icon="external-link" p={p} disabled={!!busy} onPress={() => void open(t.id)} />
              <Button label={busy === "upload" ? "Uploading…" : "Upload a new contract"} icon="upload" p={p} primary disabled={!!busy} onPress={() => void upload()} />
            </View>
            <MotionPress accessibilityRole="button" disabled={!!busy} onPress={() => void act("stop", { action: "stopTemplate" }, "New agreements are typed in again until a contract is chosen.")} style={{ alignSelf: "flex-start", paddingVertical: 6 }}>
              <Text style={[ui.small, { color: p.primary, fontWeight: "600" }]}>Stop using a contract (type agreements in instead)</Text>
            </MotionPress>
          </> : <>
            <Text style={[ui.body, { color: p.text }]}>No contract yet. Agreements are typed in for each property.</Text>
            <Text style={[ui.small, { color: p.muted }]}>Upload your management agreement as a Word document (.docx) or a PDF, up to 5 MB. Every agreement published after that is made from it.</Text>
            <Button label={busy === "upload" ? "Uploading…" : "Upload the contract"} icon="upload" p={p} primary disabled={!!busy} onPress={() => void upload()} />
          </>}
        </View>
      </Section>

      <Section title="Placeholders a Word contract can use" count={AGREEMENT_PLACEHOLDERS.length} p={p}>
        <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 10 }]}>
          <Text style={[ui.small, { color: p.muted }]}>{"Type these in the Word document exactly as shown, with the double curly brackets. Each one is replaced with the owner's details when the agreement is published."}</Text>
          {AGREEMENT_PLACEHOLDERS.map(name => (
            <View key={name} style={{ gap: 2 }}>
              <Text selectable style={{ color: p.text, fontWeight: "600", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" }}>{placeholderToken(name)}</Text>
              <Text style={[ui.small, { color: p.muted }]}>{PLACEHOLDER_HELP[name]}</Text>
            </View>
          ))}
        </View>
      </Section>

      {settings.history.length > 1 && <Section title="Earlier contracts" count={settings.history.length - 1} p={p}>
        <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 10 }]}>
          {settings.history.filter(h => !h.inUse).map(h => (
            <View key={h.id} style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
              <View style={{ flex: 1, minWidth: 180 }}>
                <Text numberOfLines={2} style={{ color: p.text, fontWeight: "600" }}>{h.fileName}</Text>
                <Text style={[ui.small, { color: p.muted }]}>Contract {h.version} · {KIND[h.kind]} · uploaded {day(h.uploadedAt)} · used for {h.agreements} {h.agreements === 1 ? "agreement" : "agreements"}</Text>
              </View>
              <Button label="Open" p={p} disabled={!!busy} onPress={() => void open(h.id)} />
              <Button label="Use this one" p={p} disabled={!!busy} onPress={() => void act("use:" + h.id, { action: "useTemplate", templateId: h.id }, `New agreements are made from ${h.fileName} again.`)} />
            </View>
          ))}
        </View>
      </Section>}

      <Section title="Recharge's details" p={p}>
        <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 10 }]}>
          <Field p={p} label="Shown on agreements without placeholders and on a PDF contract's cover page" value={company} onChange={setCompany} multiline placeholder={"Recharge Property Management Ltd\nCompany number\nRegistered address"} />
          <Button label={busy === "company" ? "Saving…" : "Save Recharge's details"} p={p} disabled={!!busy || company.trim() === settings.companyDetails} onPress={() => void act("company", { action: "saveCompanyDetails", companyDetails: company }, "Recharge's details saved.")} />
        </View>
      </Section>

      <Section title="Your own costs on the estimate" count={settings.ownCostCategories.length} p={p}>
        <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 10 }]}>
          <Text style={[ui.small, { color: p.muted }]}>{"The owner's monthly costs the team can add to an estimate, so it shows the estimated net profit. Estimates already published keep their own list."}</Text>
          {categories.map((c, i) => (
            <View key={i} style={[ui.row, { gap: 8, alignItems: "flex-end" }]}>
              <View style={{ flex: 1 }}><Field p={p} label={`Category ${i + 1}`} value={c} onChange={v => setCategories(list => list.map((x, n) => n === i ? v : x))} /></View>
              <MotionPress accessibilityRole="button" accessibilityLabel={`Remove ${c || "category " + (i + 1)}`} disabled={categories.length <= 1} onPress={() => setCategories(list => list.filter((_, n) => n !== i))} style={{ padding: 12, opacity: categories.length <= 1 ? 0.35 : 1 }}>
                <Feather name="trash-2" size={18} color={p.danger} />
              </MotionPress>
            </View>
          ))}
          <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
            <Button label="Add a category" icon="plus" p={p} disabled={!!busy || categories.length >= MAX_OWN_COST_CATEGORIES} onPress={() => setCategories(list => [...list, ""])} />
            <Button label={busy === "costs" ? "Saving…" : "Save the categories"} p={p} primary disabled={!!busy || !categoriesChanged || cleaned.some(c => !c)} onPress={() => void act("costs", { action: "saveCostCategories", categories: cleaned }, "Categories saved. New estimates use them.")} />
          </View>
        </View>
      </Section>
      {account.role === "super_admin" && <OnboardingVideos p={p} />}
    </View>
  );
}

// The owner's onboarding checklist videos (Alex's framework, migration 20261025200000): super admins only. A YouTube,
// Vimeo or Loom link for each of the three steps; until one is set the step shows its words only.
function OnboardingVideos({ p }: { p: Palette }) {
  const [saved, setSaved] = useState<Record<VideoStep, string> | null>(null);
  const [links, setLinks] = useState<Record<VideoStep, string>>({ welcome: "", process: "", estimate: "" });
  const [busy, setBusy] = useState<VideoStep | "">("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const request = useRequestId("onboarding-videos");
  const load = useCallback(async () => {
    try { const videos = clientOnboardingSchema.parse((await readClientOnboarding()).data).videos; setSaved(videos); setLinks(videos); setError(""); }
    catch (e) { setError(message(e)); }
  }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  async function save(step: VideoStep) {
    const url = links[step].trim();
    if (url && !isOnboardingVideoLink(url)) { setError(VIDEO_LINK_MESSAGE); return; }
    setBusy(step); setError(""); setNote("");
    try { await saveClientOnboarding({ action: "setVideo", requestId: request.get(step + "|" + url), step, url }); request.done(step + "|" + url); await load(); setNote(url ? VIDEO_STEP_LABEL[step] + " video saved." : VIDEO_STEP_LABEL[step] + " video removed."); }
    catch (e) { setError(message(e)); } finally { setBusy(""); }
  }
  return (
    <Section title="Onboarding videos" p={p}>
      <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 12 }]}>
        <Text style={[ui.small, { color: p.muted }]}>{VIDEO_SETTINGS_HELP}</Text>
        {!!error && <Notice text={error} p={p} tone="bad" />}
        {!!note && <Text accessibilityLiveRegion="polite" style={[ui.small, { color: p.muted }]}>{note}</Text>}
        {!saved && !error ? <Loading p={p} rows={2} /> : VIDEO_STEPS.map(step => (
          <View key={step} style={{ gap: 8 }}>
            <Field p={p} label={VIDEO_STEP_LABEL[step] + " video"} value={links[step]} onChange={v => setLinks(l => ({ ...l, [step]: v }))} placeholder="https://www.youtube.com/watch?v=..." />
            <Button label={busy === step ? "Saving…" : "Save"} p={p} disabled={!!busy || !saved || links[step].trim() === saved[step]} onPress={() => void save(step)} />
          </View>
        ))}
      </View>
    </Section>
  );
}
