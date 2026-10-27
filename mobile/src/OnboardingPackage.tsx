import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Switch, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { Button, Field, Loading, Notice, Tag, message, useRequestId } from "./LiveKit";
import { Sheet } from "./TeamFlows";
import { CourseVideo } from "./LiveTraining";
import { liveApi } from "./LivePages";
import { ui, type Palette } from "./theme";
import { formatMoney } from "../../lib/format";
import {
  DEFAULT_PACKAGE_SETTINGS, PACKAGE_SECTIONS, SECTION_TITLE, packageActionSchema, packageLines, packageMissing, packageSettingsSchema, packageViewSchema,
  type PackageAnswers, type PackageSection, type PackageSettings, type PackageView,
} from "../../lib/onboarding-package";

// The onboarding package (Business Plan v1.0, migration 20261028100000). For the owner, on their checklist once they go
// ahead: a questionnaire, one part at a time (Recharge does it, or they do), the operator information that fills in the
// agreement, and the summary with "Proceed to signing". For the team, on the lead: what the owner chose and what it comes to.
// For admins, on the Leads page: every question, note, price and video.
const money = (minor: number | null) => minor === null ? "Price to be confirmed" : formatMoney(minor);
const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

async function readPackage(propertyId?: string) {
  return packageViewSchema.parse((await liveApi("/onboarding-package" + (propertyId ? "?propertyId=" + encodeURIComponent(propertyId) : ""))).data);
}

function Choice<T extends string | boolean>({ p, value, options, onChange, disabled }: { p: Palette; value: T | undefined; options: { value: T; label: string; recharge?: boolean }[]; onChange: (v: T) => void; disabled?: boolean }) {
  return <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
    {options.map(o => {
      const on = value === o.value;
      return <MotionPress key={String(o.value)} accessibilityRole="radio" accessibilityState={{ checked: on, disabled }} disabled={disabled} onPress={() => onChange(o.value)}
        style={[ui.row, { gap: 6, minHeight: 40, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: on ? p.primary : p.border, backgroundColor: on ? p.wash : p.surface }]}>
        {o.recharge !== undefined && <Feather name={o.recharge ? "zap" : "user"} size={14} color={on ? p.primary : p.muted} />}
        <Text style={{ color: on ? p.primary : p.text, fontSize: 14, fontWeight: on ? "600" : "400" }}>{o.label}</Text>
      </MotionPress>;
    })}
  </View>;
}
const YES_NO = [{ value: true, label: "Yes" }, { value: false, label: "No" }];

function Part({ p, title, done, children, video }: { p: Palette; title: string; done: boolean; children: ReactNode; video?: string }) {
  const [error, setError] = useState("");
  return <View style={{ gap: 10, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface }}>
    <View style={[ui.row, { gap: 8 }]}>
      <Feather name={done ? "check-circle" : "circle"} size={18} color={done ? p.success : p.danger} />
      <Text accessibilityRole="header" style={{ color: p.text, fontWeight: "600", flex: 1 }}>{title}</Text>
    </View>
    {!!video && <CourseVideo p={p} url={video} title={title} onError={setError} />}
    {!!error && <Notice p={p} tone="bad" text={error} />}
    {children}
  </View>;
}
const Note = ({ p, text }: { p: Palette; text: string }) => text ? <Text style={[ui.small, { color: p.muted }]}>{text}</Text> : null;
const Q = ({ p, text }: { p: Palette; text: string }) => <Text style={[ui.body, { color: p.text }]}>{text}</Text>;

// ---------------------------------------------------------------- the owner's questionnaire
export function PackageBuilder({ p, propertyId, onSubmitted }: { p: Palette; propertyId: string; onSubmitted?: () => void }) {
  const [view, setView] = useState<PackageView | null>(null), [a, setA] = useState<PackageAnswers>({});
  const [bank, setBank] = useState({ accountName: "", sortCode: "", accountNumber: "" }), [repair, setRepair] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [saved, setSaved] = useState(""), [editing, setEditing] = useState(false);
  const request = useRequestId("package:" + propertyId);
  const fill = (v: PackageView) => {
    setView(v);
    const answers = v.package?.answers ?? {};
    setA(answers);
    const limit = answers.repairLimitMinor ?? v.package?.ownerRepairLimit ?? null;
    setRepair(limit === null || limit === undefined ? "" : (limit / 100).toFixed(2));
    setBank({ accountName: v.package?.bank?.accountName ?? "", sortCode: v.package?.bank?.sortCode ?? "", accountNumber: "" });
  };
  const load = useCallback(async () => { try { fill(await readPackage(propertyId)); setError(""); } catch (e) { setError(message(e)); } }, [propertyId]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  if (!view?.package) return error ? <Notice p={p} tone="bad" text={error} /> : <Loading p={p} rows={3} />;
  const s = view.settings, pkg = view.package, edit = pkg.canEdit && (editing || !pkg.submittedAt);
  const set = (patch: Partial<PackageAnswers>) => { setSaved(""); setA(x => ({ ...x, ...patch })); };
  const hasBank = !!pkg.bank || !!bank.accountNumber;
  const lines = packageLines(s, a, view.baseMinor);
  async function save(submit: boolean) {
    if (busy) return;
    const limit = repair.trim().replace(/[£,\s]/g, "");
    if (limit && !/^\d+(\.\d{1,2})?$/.test(limit)) { setError("Enter the repair limit in pounds, for example 200"); return; }
    const answers: PackageAnswers = { ...a, ...(limit ? { repairLimitMinor: Math.round(Number(limit) * 100) } : {}) };
    if (!limit) delete answers.repairLimitMinor;
    const changedBank = !!bank.accountNumber.trim();
    if (submit) {
      const missing = packageMissing(s, answers, !!pkg.bank || changedBank);
      if (missing.length) { setError("Answer every part first: " + missing.join(", ")); return; }
    }
    const parsed = packageActionSchema.safeParse({ action: "savePackage", requestId: request.get(JSON.stringify([answers, bank, submit])), propertyId, answers, submit,
      ...(changedBank ? { bank: { accountName: bank.accountName.trim(), sortCode: bank.sortCode.trim(), accountNumber: bank.accountNumber.trim() } } : {}) });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check your answers"); return; }
    setBusy(true); setError("");
    try {
      fill(packageViewSchema.parse((await liveApi("/onboarding-package", parsed.data)).data));
      request.done(JSON.stringify([answers, bank, submit]));
      setEditing(false);
      setSaved(submit ? "Your package is in. Next: your management agreement, filled in from it." : "Saved. You can come back to it.");
      if (submit) onSubmitted?.();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const done = (section: PackageSection) => !packageMissing({ ...s, ...Object.fromEntries(PACKAGE_SECTIONS.filter(x => x !== section).map(x => [x, { ...s[x], on: false }])) } as PackageSettings, a, true).length;
  if (!edit) return <View style={{ gap: 12 }}>
    {pkg.submittedAt ? <Notice p={p} text={`Package submitted ${when(pkg.submittedAt)}.`} /> : <Notice p={p} text="Your onboarding package opens once you choose to go ahead with your estimate." />}
    <Summary p={p} view={view} answers={a} />
    {!!saved && <Notice p={p} text={saved} />}
    {pkg.canEdit && pkg.submittedAt && <Button p={p} icon="edit-3" label="Change my answers" onPress={() => { setSaved(""); setEditing(true); }} />}
  </View>;
  return <View style={{ gap: 12 }}>
    {!!s.intro.video && <CourseVideo p={p} url={s.intro.video} title={SECTION_TITLE.intro} onError={setError} />}
    <Text style={[ui.body, { color: p.text }]}>{s.intro.note}</Text>
    <View style={[ui.row, { gap: 14, flexWrap: "wrap" }]}>
      <View style={[ui.row, { gap: 6 }]}><Feather name="zap" size={14} color={p.primary} /><Text style={[ui.small, { color: p.muted }]}>Recharge does it</Text></View>
      <View style={[ui.row, { gap: 6 }]}><Feather name="user" size={14} color={p.muted} /><Text style={[ui.small, { color: p.muted }]}>You do it</Text></View>
    </View>
    {s.setUp.on && <Part p={p} title={SECTION_TITLE.setUp} done={done("setUp")} video={s.setUp.video}>
      <Q p={p} text={s.setUp.question} /><Note p={p} text={s.setUp.note} />
      <Choice p={p} value={a.setUp} onChange={v => set({ setUp: v })} options={[{ value: "recharge", label: "Recharge does it", recharge: true }, { value: "self", label: "I will do it", recharge: false }]} />
      {a.setUp && <Note p={p} text={a.setUp === "recharge" ? s.setUp.rechargeNote : s.setUp.selfNote} />}
    </Part>}
    {s.broadband.on && <Part p={p} title={SECTION_TITLE.broadband} done={done("broadband")} video={s.broadband.video}>
      <Q p={p} text={s.broadband.question} />
      <Choice p={p} value={a.broadbandInstalled} onChange={v => set({ broadbandInstalled: v, ...(v ? { broadbandRecharge: undefined } : {}) })} options={YES_NO} />
      {a.broadbandInstalled === false && <>
        <Note p={p} text={s.broadband.note} /><Note p={p} text={s.broadband.guide} />
        <Q p={p} text={`${s.broadband.installQuestion} (${money(s.broadband.priceMinor)} + VAT)`} />
        <Choice p={p} value={a.broadbandRecharge} onChange={v => set({ broadbandRecharge: v })} options={[{ value: true, label: "Yes, Recharge installs it", recharge: true }, { value: false, label: "No, I will", recharge: false }]} />
      </>}
    </Part>}
    {s.utilities.on && <Part p={p} title={SECTION_TITLE.utilities} done={done("utilities")} video={s.utilities.video}>
      <Q p={p} text={s.utilities.question} /><Note p={p} text={s.utilities.note} />
      <Text style={[ui.small, { color: p.text, fontWeight: "600" }]}>Are the utilities connected?</Text>
      <Choice p={p} value={a.utilitiesConnected} onChange={v => set({ utilitiesConnected: v })} options={YES_NO} />
      <Text style={[ui.small, { color: p.text, fontWeight: "600" }]}>Is it on prepayment meters?</Text>
      <Choice p={p} value={a.prepaymentMeters} onChange={v => set({ prepaymentMeters: v })} options={YES_NO} />
      <View style={[ui.row, { gap: 10 }]}>
        <Switch accessibilityLabel={s.utilities.understand} value={!!a.utilitiesUnderstood} onValueChange={v => set({ utilitiesUnderstood: v })} />
        <Text style={[ui.small, { color: p.text, flex: 1 }]}>{s.utilities.understand}</Text>
      </View>
    </Part>}
    {s.compliance.on && <Part p={p} title={SECTION_TITLE.compliance} done={done("compliance")} video={s.compliance.video}>
      <Q p={p} text={s.compliance.question} /><Note p={p} text={`${s.compliance.note} ${money(s.compliance.priceMinor)} + VAT for each one Recharge organises.`} />
      {s.compliance.documents.map(doc => {
        const on = (a.complianceRecharge ?? []).includes(doc);
        return <View key={doc} style={[ui.row, { gap: 10 }]}>
          <Switch accessibilityLabel={"Recharge organises " + doc} value={on} onValueChange={v => set({ complianceRecharge: v ? [...(a.complianceRecharge ?? []), doc] : (a.complianceRecharge ?? []).filter(d => d !== doc) })} />
          <Text style={{ color: p.text, fontSize: 14, flex: 1 }}>{doc}</Text>
          {on && <Feather name="zap" size={14} color={p.primary} />}
        </View>;
      })}
      {a.complianceRecharge === undefined && <Button p={p} quiet icon="check" label="I have them all or will organise them myself" onPress={() => set({ complianceRecharge: [] })} />}
    </Part>}
    {s.licensing.on && <Part p={p} title={SECTION_TITLE.licensing} done={done("licensing")} video={s.licensing.video}>
      <Q p={p} text={s.licensing.question} /><Note p={p} text={s.licensing.note} />
      <Choice p={p} value={a.licensingContact} onChange={v => set({ licensingContact: v })} options={YES_NO} />
    </Part>}
    {s.garden.on && <Part p={p} title={SECTION_TITLE.garden} done={done("garden")} video={s.garden.video}>
      <Q p={p} text={s.garden.question} /><Note p={p} text={s.garden.note} />
      <Choice p={p} value={a.garden} onChange={v => set({ garden: v, ...(v ? {} : { gardenQuote: undefined }) })} options={YES_NO} />
      {a.garden && <>
        <Q p={p} text={s.garden.quoteQuestion} />
        <Choice p={p} value={a.gardenQuote} onChange={v => set({ gardenQuote: v })} options={[{ value: true, label: "Yes, get a quote", recharge: true }, { value: false, label: "No, I will look after it", recharge: false }]} />
        {a.gardenQuote === false && <Note p={p} text={s.garden.selfNote} />}
      </>}
    </Part>}
    {s.waste.on && <Part p={p} title={SECTION_TITLE.waste} done={done("waste")} video={s.waste.video}>
      <Q p={p} text={s.waste.question} /><Note p={p} text={s.waste.note} />
      <Choice p={p} value={a.waste} onChange={v => set({ waste: v, ...(v === "communal" ? { wasteRecharge: undefined } : {}) })} options={[{ value: "communal", label: "Communal" }, { value: "private", label: "Private" }]} />
      {a.waste === "communal" && <Note p={p} text={s.waste.communalNote} />}
      {a.waste === "private" && <>
        <Note p={p} text={`${s.waste.privateNote} ${money(s.waste.monthlyMinor)} a month + VAT.`} />
        <Choice p={p} value={a.wasteRecharge} onChange={v => set({ wasteRecharge: v })} options={[{ value: true, label: "Recharge arranges it", recharge: true }, { value: false, label: "I will arrange my own", recharge: false }]} />
      </>}
    </Part>}
    <Part p={p} title={SECTION_TITLE.operator} done={!!a.operatorName && a.operatorName.trim().length >= 2 && hasBank && (!!repair.trim() || !!a.fullRepairPermission)} video={s.operator.video}>
      <Note p={p} text={s.operator.note} />
      <Field p={p} label="Owner or operator (person or business)" value={a.operatorName ?? ""} onChange={v => set({ operatorName: v.slice(0, 200) })} />
      <Field p={p} label="Payout account holder" value={bank.accountName} onChange={v => setBank(b => ({ ...b, accountName: v.slice(0, 200) }))} />
      <Field p={p} label="Sort code" value={bank.sortCode} onChange={v => setBank(b => ({ ...b, sortCode: v.slice(0, 8) }))} placeholder="12-34-56" />
      <Field p={p} label={pkg.bank ? `Account number (ending ${pkg.bank.last4}; enter it again only to change it)` : "Account number (8 digits)"} value={bank.accountNumber} onChange={v => setBank(b => ({ ...b, accountNumber: v.replace(/\D/g, "").slice(0, 8) }))} />
      <View style={[ui.row, { gap: 10 }]}>
        <Switch accessibilityLabel="Authorise repairs without a limit" value={!!a.fullRepairPermission} onValueChange={v => set({ fullRepairPermission: v })} />
        <Text style={[ui.small, { color: p.text, flex: 1 }]}>Authorise repairs without a limit</Text>
      </View>
      {!a.fullRepairPermission && <Field p={p} label="Automatic repair limit per repair (£)" value={repair} onChange={v => { setSaved(""); setRepair(v.slice(0, 12)); }} placeholder="200" />}
      <Field p={p} multiline label="Preferred contacts for repair work (optional)" value={a.preferredRepairContact ?? ""} onChange={v => set({ preferredRepairContact: v.slice(0, 2000) })} />
    </Part>
    <Summary p={p} view={view} answers={a} />
    {!!error && <Notice p={p} tone="bad" text={error} />}
    {!!saved && <Notice p={p} text={saved} />}
    <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
      <Button p={p} quiet icon="save" label="Save for later" disabled={busy} onPress={() => void save(false)} />
      <Button p={p} primary icon="arrow-right" label="Proceed to signing" disabled={busy} onPress={() => void save(true)} />
    </View>
  </View>;
}

function Summary({ p, view, answers }: { p: Palette; view: PackageView; answers: PackageAnswers }) {
  const s = view.settings, l = packageLines(s, answers, view.baseMinor);
  return <View style={{ gap: 8, padding: 14, borderRadius: 16, backgroundColor: p.wash }}>
    <Text accessibilityRole="header" style={{ color: p.text, fontWeight: "700" }}>{SECTION_TITLE.summary}</Text>
    {!!s.summary.note && <Note p={p} text={s.summary.note} />}
    {s.summary.included.map(item => <View key={item} style={[ui.row, { gap: 8 }]}><Feather name="check" size={14} color={p.success} /><Text style={{ color: p.text, fontSize: 14, flex: 1 }}>{item}</Text></View>)}
    <Text style={[ui.small, { color: p.muted }]}>{`Included: ${money(view.baseMinor)}${view.baseMinor === null ? "" : " + VAT"}`}</Text>
    {l.choices.map(c => <View key={c.section} style={[ui.row, { gap: 8 }]}><Feather name={c.recharge ? "zap" : "user"} size={14} color={c.recharge ? p.primary : p.muted} /><Text style={{ color: p.text, fontSize: 14, flex: 1 }}>{c.label}</Text></View>)}
    {l.oneOff.slice(1).map(x => <View key={x.label} style={[ui.between, { gap: 8 }]}><Text style={{ color: p.text, fontSize: 14, flex: 1 }}>{x.label}</Text><Text style={{ color: p.text, fontSize: 14 }}>{money(x.amountMinor)}</Text></View>)}
    {l.monthly.map(x => <View key={x.label} style={[ui.between, { gap: 8 }]}><Text style={{ color: p.text, fontSize: 14, flex: 1 }}>{x.label}, monthly</Text><Text style={{ color: p.text, fontSize: 14 }}>{money(x.amountMinor)} a month</Text></View>)}
    <View style={[ui.between, { gap: 8, paddingTop: 6, borderTopWidth: 1, borderColor: p.border }]}>
      <Text style={{ color: p.text, fontWeight: "700" }}>Onboarding fee</Text>
      <Text style={{ color: p.text, fontWeight: "700" }}>{l.totalMinor === null ? (l.extrasMinor ? `${money(l.extrasMinor)} extras, plus the included fee` : "To be confirmed") : `${money(l.totalMinor)} + VAT`}</Text>
    </View>
  </View>;
}

// ---------------------------------------------------------------- the team's view on a lead
export function PackagePanel({ p, propertyId }: { p: Palette; propertyId: string }) {
  const [view, setView] = useState<PackageView | null>(null), [error, setError] = useState(""), [open, setOpen] = useState(false);
  const load = useCallback(async () => { try { setView(await readPackage(propertyId)); setError(""); } catch (e) { setError(message(e)); } }, [propertyId]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  if (!view?.package) return error ? <Notice p={p} tone="bad" text={error} /> : null;
  const pkg = view.package;
  return <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, padding: 14, gap: 10 }]}>
    <View style={[ui.between, { gap: 8 }]}>
      <Text accessibilityRole="header" style={{ color: p.text, fontSize: 16, fontWeight: "700" }}>Onboarding package</Text>
      <Tag p={p} label={pkg.submittedAt ? "Submitted" : Object.keys(pkg.answers).length ? "In progress" : "Not started"} tone={pkg.submittedAt ? "good" : "wait"} />
    </View>
    {pkg.submittedAt && <Text style={[ui.small, { color: p.muted }]}>{`Submitted ${when(pkg.submittedAt)}. The agreement is filled in from it.`}</Text>}
    {!pkg.submittedAt && <Text style={[ui.small, { color: p.muted }]}>The agreement can be published once the owner has built their package.</Text>}
    {(pkg.submittedAt || Object.keys(pkg.answers).length > 0) && <Summary p={p} view={view} answers={pkg.answers} />}
    {!!pkg.answers.operatorName && <Text style={[ui.small, { color: p.text }]}>{`Operator: ${pkg.answers.operatorName}${pkg.bank ? `. Payouts to ${pkg.bank.accountName}, ${pkg.bank.sortCode}, account ending ${pkg.bank.last4}` : ""}.`}</Text>}
    {pkg.canEdit && <Button p={p} icon="edit-3" label={open ? "Close" : "Record the owner's package"} onPress={() => setOpen(o => !o)} />}
    {open && <PackageBuilder p={p} propertyId={propertyId} onSubmitted={() => void load()} />}
  </View>;
}

// ---------------------------------------------------------------- admins: every question, note, price and video
type Obj = { [k: string]: unknown };
export function PackageSettingsSheet({ p, visible, onClose }: { p: Palette; visible: boolean; onClose: () => void }) {
  const [view, setView] = useState<PackageView | null>(null), [draft, setDraft] = useState<PackageSettings | null>(null);
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
  const request = useRequestId("package-settings:" + JSON.stringify(draft));
  const load = useCallback(async () => { try { const v = await readPackage(); setView(v); setDraft(v.settings); setError(""); } catch (e) { setError(message(e)); } }, []);
  useEffect(() => { if (!visible) return; let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [visible, load]);
  const canEdit = !!view?.canEditSettings;
  const patch = <K extends keyof PackageSettings>(key: K, change: Partial<PackageSettings[K]>) => { setSaved(false); setDraft(d => d ? { ...d, [key]: { ...d[key], ...change } } : d); };
  async function save() {
    if (!draft) return;
    const parsed = packageSettingsSchema.safeParse(draft);
    if (!parsed.success) { const i = parsed.error.issues[0]; setError(`${SECTION_TITLE[i?.path[0] as keyof typeof SECTION_TITLE] ?? "Settings"}: ${i?.message ?? "check it"}`); return; }
    setBusy(true); setError("");
    try { const v = packageViewSchema.parse((await liveApi("/onboarding-package", { action: "saveSettings", requestId: request.get(), settings: parsed.data })).data); setView(v); setDraft(v.settings); request.done(); setSaved(true); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const text = (key: keyof PackageSettings, field: string, label: string, multiline = true) => {
    const value = String((draft?.[key] as Obj | undefined)?.[field] ?? "");
    return canEdit ? <Field key={key + field} p={p} multiline={multiline} label={label} value={value} onChange={v => patch(key, { [field]: v.slice(0, 2000) } as never)} />
      : <View key={key + field} style={{ gap: 2 }}><Text style={[ui.small, { color: p.muted }]}>{label}</Text><Text selectable style={{ color: p.text, fontSize: 13 }}>{value || "None"}</Text></View>;
  };
  const price = (key: keyof PackageSettings, field: string, label: string) => {
    const minor = Number((draft?.[key] as Obj | undefined)?.[field] ?? 0);
    return canEdit ? <Field key={key + field} p={p} label={label} value={(minor / 100).toFixed(2)} onChange={v => { const n = Number(v.replace(/[£,\s]/g, "")); if (Number.isFinite(n)) patch(key, { [field]: Math.round(n * 100) } as never); }} />
      : <Text key={key + field} style={{ color: p.text, fontSize: 13 }}>{`${label}: ${money(minor)}`}</Text>;
  };
  const list = (key: "compliance" | "summary", field: "documents" | "included", label: string) => {
    const items = ((draft?.[key] as Obj | undefined)?.[field] as string[] | undefined) ?? [];
    return canEdit ? <Field key={key + field} p={p} multiline label={label + " (one per line)"} value={items.join("\n")} onChange={v => patch(key, { [field]: v.split("\n").map(x => x.slice(0, 300)).slice(0, 20) } as never)} />
      : <Text key={key + field} style={{ color: p.text, fontSize: 13 }}>{`${label}: ${items.join(", ")}`}</Text>;
  };
  const on = (key: PackageSection) => <View style={[ui.row, { gap: 10 }]}>
    <Switch accessibilityLabel={"Ask about " + SECTION_TITLE[key]} disabled={!canEdit} value={!!draft?.[key].on} onValueChange={v => patch(key, { on: v } as never)} />
    <Text style={{ color: p.text, fontSize: 14, fontWeight: "600", flex: 1 }}>{`Ask about ${SECTION_TITLE[key].toLowerCase()}`}</Text>
  </View>;
  const group = (title: string, children: ReactNode) => <View key={title} style={{ gap: 8, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: p.border }}>
    <Text accessibilityRole="header" style={{ color: p.text, fontWeight: "700" }}>{title}</Text>{children}</View>;
  return (
    <Sheet palette={p} visible={visible} onClose={onClose} title="Onboarding package" subtitle="The questions owners answer before signing, with prices, notes and videos" icon="house" width={720}>
      <View style={{ gap: 14 }}>
        <Text style={[ui.small, { color: p.muted }]}>Owners build their package after choosing to go ahead. For each part they choose whether Recharge does it or they do. Videos take a YouTube, Vimeo or Loom link. The included fee is the onboarding fee setting; the extras here are added to it on the fee invoice.</Text>
        {!draft && !error && <Loading p={p} rows={5} />}
        {draft && <>
          {group(SECTION_TITLE.intro, <>{text("intro", "note", "Introduction")}{text("intro", "video", "Video link", false)}</>)}
          {group(SECTION_TITLE.setUp, <>{on("setUp")}{text("setUp", "question", "Question")}{text("setUp", "note", "Note")}{text("setUp", "rechargeNote", "When Recharge does it")}{text("setUp", "selfNote", "When they do it")}{text("setUp", "video", "Video link", false)}</>)}
          {group(SECTION_TITLE.broadband, <>{on("broadband")}{text("broadband", "question", "Question")}{text("broadband", "note", "Note when not installed")}{text("broadband", "guide", "Guide to choosing broadband")}{text("broadband", "installQuestion", "Installation question")}{price("broadband", "priceMinor", "Installation price, £ + VAT")}{text("broadband", "video", "Video link", false)}</>)}
          {group(SECTION_TITLE.utilities, <>{on("utilities")}{text("utilities", "question", "Question")}{text("utilities", "note", "Note")}{text("utilities", "understand", "What they confirm")}{text("utilities", "video", "Video link", false)}</>)}
          {group(SECTION_TITLE.compliance, <>{on("compliance")}{text("compliance", "question", "Question")}{text("compliance", "note", "Note")}{list("compliance", "documents", "Documents")}{price("compliance", "priceMinor", "Price per document, £ + VAT")}{text("compliance", "video", "Video link", false)}</>)}
          {group(SECTION_TITLE.licensing, <>{on("licensing")}{text("licensing", "question", "Question")}{text("licensing", "note", "Note")}{text("licensing", "video", "Video link", false)}</>)}
          {group(SECTION_TITLE.garden, <>{on("garden")}{text("garden", "question", "Question")}{text("garden", "note", "Note")}{text("garden", "quoteQuestion", "Quote question")}{text("garden", "selfNote", "When they look after it")}{text("garden", "video", "Video link", false)}</>)}
          {group(SECTION_TITLE.waste, <>{on("waste")}{text("waste", "question", "Question")}{text("waste", "note", "Note")}{text("waste", "communalNote", "Communal bins")}{text("waste", "privateNote", "Private bins")}{price("waste", "monthlyMinor", "Monthly price, £ + VAT")}{text("waste", "video", "Video link", false)}</>)}
          {group(SECTION_TITLE.operator, <>{text("operator", "note", "Introduction")}{text("operator", "video", "Video link", false)}</>)}
          {group(SECTION_TITLE.summary, <>{list("summary", "included", "Included in the onboarding fee")}{text("summary", "note", "Note")}</>)}
        </>}
        {!!error && <Notice p={p} tone="bad" text={error} />}
        {saved && <Notice p={p} text="Saved. Owners see these questions and prices from now on." />}
        {view && !canEdit && <Notice p={p} text="Only admins can change the onboarding package." />}
        {view?.updatedByName && view.updatedAt && <Text style={[ui.small, { color: p.muted }]}>{`Last changed by ${view.updatedByName}, ${when(view.updatedAt)}.`}</Text>}
        {canEdit && draft && <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
          <Button p={p} quiet icon="rotate-ccw" label="Back to the plan's wording" onPress={() => { setSaved(false); setDraft(DEFAULT_PACKAGE_SETTINGS); }} />
          <Button p={p} primary icon="check" label="Save" disabled={busy} onPress={() => void save()} />
        </View>}
      </View>
    </Sheet>
  );
}
