import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AppState, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { GrowBar, MotionPress } from "./motion";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { Button, Field, message, Notice, Section, Tag, useRequestId, Loading } from "./LiveKit";
import { List, Row } from "./LiveAccounts";
import { CourseSheet } from "./LiveTraining";
import { readTeams, writeTeams } from "./backend/client";
import { contractsSchema, coursesSchema, onboardingProgress, onboardingSchema, type Contract, type Course, type Onboarding, type StaffOnboarding } from "../../lib/management-live";
import { CONTRACT_AUDIENCES } from "../../lib/workspace-teams-policy";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";

// Staff onboarding. New team members sign the contract for their role and finish the required
// training before their tools open (the database enforces it); admins write the contracts.
const AUDIENCE_LABEL: Record<string, string> = { all: "Every team member", stays: "Stays", cleans: "Cleaners", cleaning_manager: "Cleaning managers", ready: "Ready", accounts: "Accounts" };
export const STAFF_ROLES = ["stays", "cleans", "cleaning_manager", "ready", "accounts"];
const when = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

function Check({ p, on, label, onPress }: { p: Palette; on: boolean; label: string; onPress: () => void }) {
  return (
    <MotionPress accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={onPress} style={[ui.row, { gap: 12, minHeight: 48 }]}>
      <Feather name={on ? "check-square" : "square"} size={20} color={p.primary} /><Text style={{ color: p.text, flex: 1 }}>{label}</Text>
    </MotionPress>
  );
}

function ContractSheet({ p, contract, defaultName, onClose, onSigned }: { p: Palette; contract: Onboarding["contracts"][number] | null; defaultName: string; onClose: () => void; onSigned: () => Promise<void> }) {
  const [name, setName] = useState(defaultName);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRequestId(contract ? ["sign", contract.id, contract.version, name.trim()].join(":") : null);
  // Reset only when a different contract opens, so a "wording has changed" message stays visible
  // while the sheet refreshes to the new wording.
  useEffect(() => { queueMicrotask(() => { setName(defaultName); setAgree(false); setError(""); }); }, [contract?.id, defaultName]);
  async function sign() {
    if (!contract || busy) return;
    if (name.trim().length < 2) { setError("Type your full name to sign."); return; }
    if (!agree) { setError("Tick the box to agree to the contract."); return; }
    setBusy(true); setError("");
    try {
      await writeTeams({ action: "signContract", requestId: request.get(), contractId: contract.id, version: contract.version, signedName: name.trim(), agree: true });
      request.done(); onClose(); await onSigned();
    } catch (e) { setError(message(e)); await onSigned(); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible={!!contract} onClose={onClose} title={contract?.title ?? ""} subtitle={contract?.signedVersion ? "Updated: please read and sign again" : "Read it in full, then sign below"} icon="clipboard">
      {contract && <>
        <View style={[ui.card, { backgroundColor: p.background, borderColor: p.border }]}><Text selectable style={[ui.body, { color: p.text }]}>{contract.body}</Text></View>
        <Field label="Your full name" value={name} onChange={setName} p={p} placeholder="As it appears on your ID" />
        <Check p={p} on={agree} label="I have read this contract and agree to it" onPress={() => setAgree(v => !v)} />
        <Text style={[ui.small, { color: p.muted }]}>Your typed name, the date and this exact wording are kept on record as your signature.</Text>
        {!!error && <Notice text={error} p={p} tone="bad" />}
        <Button label={busy ? "Signing…" : "Sign the contract"} icon="edit-3" primary p={p} disabled={busy} onPress={() => void sign()} />
      </>}
    </Sheet>
  );
}

function Step({ p, number, title, done, children }: { p: Palette; number: number; title: string; done: boolean; children: ReactNode }) {
  return (
    <View style={{ gap: 10 }}>
      <View style={[ui.row, { gap: 12 }]}>
        <View style={{ width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: done ? p.success : p.primary }}>
          {done ? <Feather name="check" size={16} color={p.onPrimary} /> : <Text style={{ color: p.onPrimary, fontWeight: "700" }}>{number}</Text>}
        </View>
        <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text, flex: 1 }]}>{title}</Text>
      </View>
      {children}
    </View>
  );
}

// Shown instead of the workspace until a team member has finished onboarding.
export function OnboardingGate({ account, palette: p, onSignOut, children }: { account: WorkspaceAccount; palette: Palette; onSignOut: () => void; children: ReactNode }) {
  const staff = STAFF_ROLES.includes(account.role);
  const [status, setStatus] = useState<Onboarding | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [checked, setChecked] = useState(!staff);
  const [error, setError] = useState("");
  const [signing, setSigning] = useState<Onboarding["contracts"][number] | null>(null);
  const [reading, setReading] = useState<Course | null>(null);
  const load = useCallback(async () => {
    if (!staff) return;
    setError("");
    try {
      const next = onboardingSchema.parse((await readTeams({ section: "onboarding" })).data);
      setStatus(next);
      // An open contract refreshes to its latest wording; it closes once signed.
      setSigning(current => current ? next.contracts.find(c => c.id === current.id && !c.current) ?? null : current);
      if (next.courses.length) setCourses(coursesSchema.parse((await readTeams({ section: "training" })).data));
    } catch (e) {
      // The database still keeps tools closed; an older backend without onboarding lets them through.
      setError(message(e));
    }
    setChecked(true);
  }, [staff]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  // Check again when the app comes back to the front and every 10 minutes, so a newly published
  // contract or required course brings the checklist back instead of leaving tools closed.
  useEffect(() => {
    if (!staff) return;
    const subscription = AppState.addEventListener("change", state => { if (state === "active") void load(); });
    const timer = setInterval(() => void load(), 600_000);
    return () => { subscription.remove(); clearInterval(timer); };
  }, [staff, load]);

  if (!checked) return <View style={[ui.fill, { backgroundColor: p.background, alignItems: "center", justifyContent: "center" }]}><Loading p={p} /></View>;
  if (!staff || !status || !status.required || status.complete) return <>{children}</>;

  const contractsDone = status.contractsSigned === status.contractsNeeded, coursesDone = status.coursesDone === status.coursesNeeded;
  const minutes = courses.filter(c => status.courses.some(x => x.id === c.id && !x.completedAt)).reduce((sum, c) => sum + c.minutes, 0);
  const firstName = account.fullName.split(" ")[0] || "there";
  return (
    <SafeAreaView style={[ui.fill, { backgroundColor: p.background }]} edges={["top", "bottom"]}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingVertical: 32, alignItems: "center" }}>
        <View style={{ width: "100%", maxWidth: 720, gap: 24 }}>
          <View style={[ui.card, { backgroundColor: p.header, borderColor: p.header, gap: 8, padding: 24 }]}>
            <Text style={{ color: p.headerMuted, fontSize: 13, fontWeight: "600", letterSpacing: 0.5 }}>WELCOME TO RECHARGE</Text>
            <Text accessibilityRole="header" style={{ color: p.headerText, fontSize: 28, lineHeight: 34, fontWeight: "700" }}>Hi {firstName}, let’s get you started.</Text>
            <Text style={{ color: p.headerMuted, fontSize: 15, lineHeight: 22 }}>
              Sign your contract and finish your training, and your tools open straight away.{minutes ? ` The training takes about ${minutes} minutes.` : ""}
            </Text>
            <View style={[ui.row, { gap: 8, marginTop: 6 }]}><Tag label={onboardingProgress(status)} tone="wait" p={p} /></View>
            <GrowBar share={(status.contractsSigned + status.coursesDone) / Math.max(1, status.contractsNeeded + status.coursesNeeded)} height={8} color={p.headerText} track={p.headerBorder} />
          </View>
          {!!error && <Notice text={error} p={p} tone="bad" />}
          {!!status.contractsNeeded && <Step p={p} number={1} title="Sign your contract" done={contractsDone}>
            <List p={p} empty="">
              {status.contracts.map((c, i) => (
                <Row key={c.id} p={p} first={i === 0} title={c.title} detail={c.current ? `Signed ${c.signedAt ? when(c.signedAt) : ""}` : c.signedVersion ? "The wording has changed. Read it and sign again." : "Read and sign"}
                  tags={[c.current ? ["Signed", "good"] : ["To sign", "wait"]]} onPress={c.current ? undefined : () => setSigning(c)} />
              ))}
            </List>
          </Step>}
          {!!status.coursesNeeded && <Step p={p} number={status.contractsNeeded ? 2 : 1} title="Complete your training" done={coursesDone}>
            <List p={p} empty="">
              {status.courses.map((c, i) => {
                const course = courses.find(x => x.id === c.id);
                return <Row key={c.id} p={p} first={i === 0} title={c.title} detail={c.completedAt ? `Completed ${when(c.completedAt)}` : course ? `${course.minutes} min` : "Open to read"}
                  tags={[c.completedAt ? ["Completed", "good"] : ["To do", "wait"]]} onPress={course ? () => setReading(course) : undefined} />;
              })}
            </List>
          </Step>}
          <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
            <Button label="Refresh" icon="refresh-cw" p={p} onPress={() => void load()} />
            <Button label="Sign out" icon="log-out" p={p} onPress={onSignOut} />
          </View>
          <Text style={[ui.small, { color: p.muted, textAlign: "center" }]}>Questions about your contract or training? Ask your manager at Recharge.</Text>
        </View>
      </ScrollView>
      <ContractSheet p={p} contract={signing} defaultName={account.fullName} onClose={() => setSigning(null)} onSigned={load} />
      <CourseSheet p={p} course={reading} onClose={() => setReading(null)} onCompleted={load} />
    </SafeAreaView>
  );
}

function ContractEditor({ p, contract, visible, onClose, onDone }: { p: Palette; contract: Contract | null; visible: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const [title, setTitle] = useState("");
  const [audience, setAudience] = useState<string[]>(["all"]);
  const [body, setBody] = useState("");
  const [active, setActive] = useState(true);
  const [resign, setResign] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRequestId(visible ? ["contract", contract?.id ?? "new", contract?.version ?? 0, title, audience.join(","), body, active, resign].join(":") : null);
  useEffect(() => {
    queueMicrotask(() => {
      if (!visible) return;
      setTitle(contract?.title ?? ""); setAudience(contract?.audience ?? ["all"]); setBody(contract?.body ?? ""); setActive(contract?.active ?? true); setResign(false); setError("");
    });
  }, [contract, visible]);
  const toggle = (value: string) => setAudience(current => {
    if (value === "all") return ["all"];
    const next = current.filter(x => x !== "all");
    return next.includes(value) ? next.filter(x => x !== value) : [...next, value];
  });
  async function save() {
    if (title.trim().length < 2 || body.trim().length < 20 || !audience.length) { setError("Add a title, who signs it and the contract wording (at least 20 characters)."); return; }
    setBusy(true); setError("");
    try {
      await writeTeams({ action: "saveContract", requestId: request.get(), ...(contract ? { contractId: contract.id, version: contract.version } : {}), title: title.trim(),
        audience: audience as never, body: body.trim(), active, ...(contract && resign ? { resignRequired: true } : {}) });
      request.done(); onClose(); await onDone();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible={visible} onClose={onClose} title={contract ? "Edit contract" : "New staff contract"} subtitle="Team members sign it before their tools open" icon="clipboard">
      <Field label="Title" value={title} onChange={setTitle} p={p} placeholder="For example, Cleaner agreement" />
      <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Who signs it</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {CONTRACT_AUDIENCES.map(value => {
          const on = audience.includes(value);
          return <MotionPress key={value} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => toggle(value)} style={{ minHeight: 40, paddingHorizontal: 14, borderRadius: 999, justifyContent: "center", backgroundColor: on ? p.primary : p.surface, borderWidth: 1, borderColor: on ? p.primary : p.border }}><Text style={{ color: on ? p.onPrimary : p.text, fontSize: 13, fontWeight: "600" }}>{AUDIENCE_LABEL[value]}</Text></MotionPress>;
        })}
      </View>
      <Field label="Contract wording" value={body} onChange={setBody} p={p} multiline placeholder="Paste the full contract here" />
      <Check p={p} on={active} label="In use: team members must sign it before they start" onPress={() => setActive(v => !v)} />
      {!!contract && <Check p={p} on={resign} label="Ask everyone who signed to sign this new wording again" onPress={() => setResign(v => !v)} />}
      {!!contract && <Text style={[ui.small, { color: p.muted }]}>Every saved wording is kept with the signatures made against it. Small fixes don’t need a new signature.</Text>}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : "Save contract"} primary p={p} disabled={busy} onPress={() => void save()} />
    </Sheet>
  );
}

// Admins: the staff contracts, who has signed, and how far each team member has got.
export function StaffContracts({ p }: { p: Palette }) {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [people, setPeople] = useState<StaffOnboarding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Contract | null | "new">(null);
  const [viewing, setViewing] = useState<Contract | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try { const data = contractsSchema.parse((await readTeams({ section: "contracts" })).data); setContracts(data.contracts); setPeople(data.people); }
    catch (e) { setError(message(e)); }
    setLoading(false);
  }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  const waiting = people.filter(x => x.required && !x.complete).length;
  return (
    <View style={{ gap: 18 }}>
      <Section title="Staff contracts" p={p}>
        <Text style={[ui.small, { color: p.muted }]}>New team members sign these, and finish any course marked “Required”, before their tools open.</Text>
        {loading && <Loading p={p} />}
        {!!error && <Notice text={error} p={p} tone="bad" />}
        <Button label="New contract" icon="plus" p={p} onPress={() => setEditing("new")} />
        <List p={p} empty="No contracts yet. Add the one new staff sign.">
          {contracts.map((c, i) => (
            <Row key={c.id} p={p} first={i === 0} title={c.title} detail={`${c.audience.map(a => AUDIENCE_LABEL[a] ?? a).join(", ")} · version ${c.version}`}
              tags={[c.active ? ["In use", "good"] : ["Not in use", "plain"], [`${new Set((c.signatures ?? []).map(s => s.userId)).size} signed`, "plain"]]} onPress={() => setViewing(c)} />
          ))}
        </List>
      </Section>
      <Section title="Team onboarding" count={waiting} p={p}>
        <List p={p} empty="No active team members yet.">
          {people.map((x, i) => <Row key={x.userId} p={p} first={i === 0} title={x.fullName || "Team member"} detail={AUDIENCE_LABEL[x.role] ?? x.role}
            tags={[[onboardingProgress(x), !x.required || x.complete ? "good" : "wait"]]} />)}
        </List>
      </Section>
      <Sheet palette={p} visible={!!viewing} onClose={() => setViewing(null)} title={viewing?.title ?? ""} subtitle={viewing ? `Version ${viewing.version} · ${when(viewing.publishedAt)}` : undefined} icon="clipboard">
        {viewing && <>
          <Button label="Edit contract" icon="edit-3" primary p={p} onPress={() => { const c = viewing; setViewing(null); setEditing(c); }} />
          <Section title="Signatures" count={undefined} p={p}>
            <List p={p} empty="Nobody has signed yet.">
              {(viewing.signatures ?? []).map((s, i) => <Row key={s.userId + s.version} p={p} first={i === 0} title={s.fullName} detail={`Signed “${s.signedName}” on ${when(s.signedAt)}`}
                tags={[s.version === viewing.version ? ["Current wording", "good"] : [`Version ${s.version}`, "plain"]]} />)}
            </List>
          </Section>
          <Text selectable style={[ui.body, { color: p.text }]}>{viewing.body}</Text>
        </>}
      </Sheet>
      <ContractEditor p={p} contract={editing === "new" ? null : editing} visible={editing !== null} onClose={() => setEditing(null)} onDone={load} />
    </View>
  );
}
