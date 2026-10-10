import { useCallback, useEffect, useState, type ReactNode } from "react";
import { AppState, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { useSaved } from "./Celebrate";
import { GrowBar, MotionPress } from "./motion";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { Button, Field, message, Notice, Section, Tag, useRequestId, Loading } from "./LiveKit";
import { List, Pills, Row } from "./LiveAccounts";
import { CourseSheet } from "./LiveTraining";
import { readTeams, writeTeams } from "./backend/client";
import { contractsSchema, coursesSchema, myContractsSchema, onboardingFor, onboardingProgress, onboardingSchema, ONBOARDED_ROLES, type Contract, type Course, type MyContract, type Onboarding, type StaffOnboarding } from "../../lib/management-live";
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
  // Whether the checklist was shown this time, so finishing it shows "You're all set" once.
  const [sawChecklist, setSawChecklist] = useState(false), [welcomed, setWelcomed] = useState(false);
  useEffect(() => { if (status && status.required && !status.complete && !sawChecklist) queueMicrotask(() => setSawChecklist(true)); }, [status, sawChecklist]);
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
  // The checklist couldn't be read: say so and offer to try again, rather than opening a workspace
  // whose tools the database still keeps closed.
  if (staff && !status && error) return (
    <SafeAreaView style={[ui.fill, { backgroundColor: p.background, alignItems: "center", justifyContent: "center", padding: 24 }]} edges={["top", "bottom"]}>
      <View style={{ width: "100%", maxWidth: 480, gap: 14 }}>
        <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>We couldn’t load your start-up checklist</Text>
        <Notice text={error} p={p} tone="bad" />
        <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}><Button label="Try again" icon="refresh-cw" primary p={p} onPress={() => void load()} /><Button label="Sign out" icon="log-out" p={p} onPress={onSignOut} /></View>
      </View>
    </SafeAreaView>
  );
  // Just finished: a moment to say so before the tools open.
  if (staff && status?.complete && sawChecklist && !welcomed) return (
    <SafeAreaView style={[ui.fill, { backgroundColor: p.background, alignItems: "center", justifyContent: "center", padding: 24 }]} edges={["top", "bottom"]}>
      <View style={[ui.card, { width: "100%", maxWidth: 520, backgroundColor: p.header, borderColor: p.header, gap: 12, padding: 28, alignItems: "flex-start" }]}>
        <View style={{ width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center", backgroundColor: p.success }}><Feather name="check" size={26} color={p.onPrimary} /></View>
        <Text accessibilityRole="header" style={{ color: p.headerText, fontSize: 26, lineHeight: 32, fontWeight: "700" }}>You’re all set, {account.fullName.split(" ")[0] || "there"}.</Text>
        <Text style={{ color: p.headerMuted, fontSize: 15, lineHeight: 22 }}>Your contract is signed and your training is done, so your tools are open. Your manager has been told. You can read your contract again any time in Help.</Text>
        <Button label="Open my tools" icon="arrow-right" primary p={p} onPress={() => setWelcomed(true)} />
      </View>
    </SafeAreaView>
  );
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
                <Row key={c.id} p={p} first={i === 0} icon={c.current ? "check-circle" : "edit-3"} title={c.title} detail={c.current ? `Signed ${c.signedAt ? when(c.signedAt) : ""}` : c.signedVersion ? "The wording has changed. Read it and sign again." : "Read and sign"}
                  tags={[c.current ? ["Signed", "good"] : ["To sign", "wait"]]} onPress={c.current ? undefined : () => setSigning(c)} />
              ))}
            </List>
          </Step>}
          {!!status.coursesNeeded && <Step p={p} number={status.contractsNeeded ? 2 : 1} title="Complete your training" done={coursesDone}>
            <List p={p} empty="">
              {status.courses.map((c, i) => {
                const course = courses.find(x => x.id === c.id);
                return <Row key={c.id} p={p} first={i === 0} icon={c.completedAt ? "check-circle" : "play-circle"} title={c.title} detail={c.completedAt ? `Completed ${when(c.completedAt)}` : course ? `${course.minutes} min` : "Open to read"}
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

const ROLE_LABEL: Record<string, string> = { stays: "Stays", cleans: "Cleaners", cleaning_manager: "Cleaning managers", ready: "Ready", accounts: "Accounts" };

// How the whole process works, in four steps, for whoever sets it up.
function HowItWorks({ p }: { p: Palette }) {
  const steps: [string, string, string][] = [
    ["file-text", "Write the contracts", "Add the contract each role signs (or one for every team member). Only contracts marked “In use” are asked for."],
    ["book-open", "Choose the training", "In Training below, publish courses and tick “Required before they start” on the ones new people must finish. Attach documents, pictures or short videos."],
    ["user-plus", "Add the person", "Access control → Add a person, or approve someone who signed up. Send them their set-password link."],
    ["unlock", "They complete it, tools open", "When they sign in they see only their checklist: sign, then finish the courses. Their tools open the moment the last step is done, and you’re notified."],
  ];
  return (
    <View style={[ui.card, { backgroundColor: p.wash, borderColor: p.border, gap: 12 }]}>
      <Text accessibilityRole="header" style={{ color: p.text, fontSize: 16, fontWeight: "700" }}>How staff onboarding works</Text>
      {steps.map(([icon, title, text], i) => (
        <View key={title} style={[ui.row, { gap: 12, alignItems: "flex-start" }]}>
          <View style={{ width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: p.primary }}><Text style={{ color: p.onPrimary, fontWeight: "700" }}>{i + 1}</Text></View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <View style={[ui.row, { gap: 6 }]}><Feather name={icon as "file-text"} size={14} color={p.primary} /><Text style={{ color: p.text, fontWeight: "700" }}>{title}</Text></View>
            <Text style={[ui.small, { color: p.muted }]}>{text}</Text>
          </View>
        </View>
      ))}
      <Text style={[ui.small, { color: p.muted }]}>Admins, super admins and owners never go through this. Moving someone to another role asks for that role’s contract and courses. Editing a contract or course can ask everyone to sign or do it again.</Text>
    </View>
  );
}

// The checklist a new person in a role would see, without signing anything.
function PreviewSheet({ p, role, contracts, courses, onClose }: { p: Palette; role: string | null; contracts: Contract[]; courses: Course[]; onClose: () => void }) {
  const [reading, setReading] = useState<Contract | null>(null);
  const plan = role ? onboardingFor(role, contracts, courses) : null;
  return (
    <Sheet palette={p} visible={!!role} onClose={onClose} title={role ? `What a new ${ROLE_LABEL[role] ?? role} sees` : ""} subtitle="A preview: nothing is signed or completed" icon="clipboard">
      {plan && (plan.nothing ? <Notice text={`Nothing to sign or complete: a new ${ROLE_LABEL[role!] ?? role} goes straight to their tools. Add a contract for this role, or mark a course required, if they should.`} p={p} /> : <>
        <View style={[ui.card, { backgroundColor: p.header, borderColor: p.header, gap: 6 }]}>
          <Text style={{ color: p.headerMuted, fontSize: 12, fontWeight: "600", letterSpacing: 0.5 }}>WELCOME TO RECHARGE</Text>
          <Text style={{ color: p.headerText, fontSize: 20, fontWeight: "700" }}>Hi there, let’s get you started.</Text>
          <Text style={{ color: p.headerMuted }}>Sign your contract and finish your training, and your tools open straight away.{plan.minutes ? ` The training takes about ${plan.minutes} minutes.` : ""}</Text>
        </View>
        {!!plan.contracts.length && <Step p={p} number={1} title="Sign your contract" done={false}>
          <List p={p} empty="">{plan.contracts.map((c, i) => <Row key={c.id} p={p} first={i === 0} icon="edit-3" title={c.title} detail={`Version ${c.version} · tap to read`} tags={[["To sign", "wait"]]} onPress={() => setReading(c)} />)}</List>
        </Step>}
        {!!plan.courses.length && <Step p={p} number={plan.contracts.length ? 2 : 1} title="Complete your training" done={false}>
          <List p={p} empty="">{plan.courses.map((c, i) => <Row key={c.id} p={p} first={i === 0} icon="play-circle" title={c.title} detail={`${c.minutes} min${c.files.length ? ` · ${c.files.length} file${c.files.length === 1 ? "" : "s"}` : ""}`} tags={[["To do", "wait"]]} />)}</List>
        </Step>}
      </>)}
      {reading && <View style={[ui.card, { backgroundColor: p.background, borderColor: p.border, gap: 8 }]}>
        <Text style={{ color: p.text, fontWeight: "700" }}>{reading.title}</Text>
        <Text selectable style={[ui.body, { color: p.text }]}>{reading.body}</Text>
        <Button label="Close the contract" p={p} onPress={() => setReading(null)} />
      </View>}
    </Sheet>
  );
}

// One team member's progress: each contract and course, and when they finished.
function PersonSheet({ p, person, onClose }: { p: Palette; person: StaffOnboarding | null; onClose: () => void }) {
  const optional = person?.training.filter(c => !c.required) ?? [];
  return (
    <Sheet palette={p} visible={!!person} onClose={onClose} title={person?.fullName || "Team member"} subtitle={person ? `${ROLE_LABEL[person.role] ?? person.role} · ${onboardingProgress(person)}` : undefined} icon="people">
      {person && <>
        {person.onboardedAt && person.required ? <Notice text={`Finished onboarding on ${when(person.onboardedAt)}. Their tools are open.`} p={p} />
          : !person.required ? <Notice text="Nothing to sign or complete for their role, so their tools are open." p={p} />
          : <Notice text="Their tools stay closed until everything below is done. They see this checklist when they sign in." p={p} tone="bad" />}
        {!!person.contracts.length && <Section title="Contracts" p={p}>
          <List p={p} empty="">{person.contracts.map((c, i) => <Row key={c.id} p={p} first={i === 0} icon={c.current ? "check-circle" : "edit-3"} title={c.title}
            detail={c.current ? `Signed ${c.signedAt ? when(c.signedAt) : ""} (version ${c.signedVersion})` : c.signedVersion ? `Signed version ${c.signedVersion}; needs to sign the new wording (version ${c.version})` : "Not signed yet"}
            tags={[c.current ? ["Signed", "good"] : ["To sign", "wait"]]} />)}</List>
        </Section>}
        {!!person.courses.length && <Section title="Required training" p={p}>
          <List p={p} empty="">{person.courses.map((c, i) => <Row key={c.id} p={p} first={i === 0} icon={c.completedAt ? "check-circle" : "play-circle"} title={c.title}
            detail={c.completedAt ? `Completed ${when(c.completedAt)}` : "Not completed yet"} tags={[c.completedAt ? ["Done", "good"] : ["To do", "wait"]]} />)}</List>
        </Section>}
        {!!optional.length && <Section title="Other training for their role" p={p}>
          <List p={p} empty="">{optional.map((c, i) => <Row key={c.id} p={p} first={i === 0} icon={c.completedAt ? "check-circle" : "book-open"} title={c.title}
            detail={c.completedAt ? `Completed ${when(c.completedAt)}` : "Not done (optional)"} tags={[c.completedAt ? ["Done", "good"] : ["Optional", "plain"]]} />)}</List>
        </Section>}
      </>}
    </Sheet>
  );
}

// Admins: how it works, what each role is asked for, the contracts, and each person's progress.
export function StaffContracts({ p }: { p: Palette }) {
  const saved = useSaved();
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [people, setPeople] = useState<StaffOnboarding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Contract | null | "new">(null);
  const [viewing, setViewing] = useState<Contract | null>(null);
  const [previewing, setPreviewing] = useState<string | null>(null);
  const [person, setPerson] = useState<StaffOnboarding | null>(null);
  const [filter, setFilter] = useState<"todo" | "done" | "all">("todo");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [data, training] = await Promise.all([readTeams({ section: "contracts" }), readTeams({ section: "training" })]);
      const parsed = contractsSchema.parse(data.data); setContracts(parsed.contracts); setPeople(parsed.people); setCourses(coursesSchema.parse(training.data));
    } catch (e) { setError(message(e)); }
    setLoading(false);
  }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  const waiting = people.filter(x => x.required && !x.complete);
  const shown = filter === "all" ? people : filter === "todo" ? waiting : people.filter(x => !x.required || x.complete);
  // Who in the contract's audience hasn't signed its current wording.
  const unsigned = (c: Contract) => people.filter(x => x.contracts.some(k => k.id === c.id && !k.current));
  return (
    <View style={{ gap: 18 }}>
      <HowItWorks p={p} />
      {loading && <Loading p={p} />}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Section title="What each role is asked for" p={p}>
        <Text style={[ui.small, { color: p.muted }]}>Tap a role to preview exactly what a new person in it sees.</Text>
        <List p={p} empty="">
          {ONBOARDED_ROLES.map((role, i) => {
            const plan = onboardingFor(role, contracts, courses)!;
            const detail = plan.nothing ? "Nothing to sign or complete: tools open straight away" : [plan.contracts.map(c => c.title).join(", "), plan.courses.length ? `${plan.courses.length} required course${plan.courses.length === 1 ? "" : "s"} (${plan.minutes} min)` : ""].filter(Boolean).join(" · ");
            return <Row key={role} p={p} first={i === 0} icon={plan.nothing ? "alert-circle" : "clipboard"} title={ROLE_LABEL[role]} detail={detail}
              tags={[plan.nothing ? ["Not set up", "wait"] : [`${plan.contracts.length} contract${plan.contracts.length === 1 ? "" : "s"} · ${plan.courses.length} course${plan.courses.length === 1 ? "" : "s"}`, "good"]]} onPress={() => setPreviewing(role)} />;
          })}
        </List>
      </Section>
      <Section title="Staff contracts" p={p}>
        <Text style={[ui.small, { color: p.muted }]}>Each one is signed in the app with a typed name; the exact wording and date are kept on record.</Text>
        <Button label="New contract" icon="plus" p={p} onPress={() => setEditing("new")} />
        <List p={p} empty="No contracts yet. Add the one new staff sign.">
          {contracts.map((c, i) => {
            const current = new Set((c.signatures ?? []).filter(s => s.version === c.version).map(s => s.userId)).size, still = unsigned(c).length;
            return <Row key={c.id} p={p} first={i === 0} icon="file-text" title={c.title} detail={`${c.audience.map(a => AUDIENCE_LABEL[a] ?? a).join(", ")} · version ${c.version}`}
              tags={[c.active ? ["In use", "good"] : ["Not in use", "plain"], [`${current} signed this wording`, "plain"], ...(c.active && still ? [[`${still} still to sign`, "wait"] as [string, "wait"]] : [])]} onPress={() => setViewing(c)} />;
          })}
        </List>
      </Section>
      <Section title="Team onboarding" count={waiting.length} p={p}>
        <Pills p={p} values={["todo", "done", "all"] as const} value={filter} onChange={setFilter} label={v => ({ todo: `Still to finish${waiting.length ? ` (${waiting.length})` : ""}`, done: "Done", all: "Everyone" })[v]} />
        <List p={p} empty={filter === "todo" ? "Nobody is waiting to finish onboarding." : "No team members here yet."}>
          {shown.map((x, i) => <Row key={x.userId} p={p} first={i === 0} icon={!x.required || x.complete ? "user-check" : "user"} title={x.fullName || "Team member"}
            detail={`${ROLE_LABEL[x.role] ?? x.role}${x.onboardedAt && x.required && x.complete ? ` · finished ${when(x.onboardedAt)}` : ""}`}
            tags={[[onboardingProgress(x), !x.required || x.complete ? "good" : "wait"]]} onPress={() => setPerson(x)} />)}
        </List>
      </Section>
      <Sheet palette={p} visible={!!viewing} onClose={() => setViewing(null)} title={viewing?.title ?? ""} subtitle={viewing ? `Version ${viewing.version} · ${when(viewing.publishedAt)}` : undefined} icon="clipboard">
        {viewing && <>
          <Button label="Edit contract" icon="edit-3" primary p={p} onPress={() => { const c = viewing; setViewing(null); setEditing(c); }} />
          {viewing.active && !!unsigned(viewing).length && <Section title="Still to sign this wording" count={unsigned(viewing).length} p={p}>
            <List p={p} empty="">{unsigned(viewing).map((x, i) => <Row key={x.userId} p={p} first={i === 0} avatar={x.fullName || "Team member"} title={x.fullName || "Team member"} detail={ROLE_LABEL[x.role] ?? x.role} tags={[["To sign", "wait"]]} />)}</List>
          </Section>}
          <Section title="Signatures" count={undefined} p={p}>
            <List p={p} empty="Nobody has signed yet.">
              {(viewing.signatures ?? []).map((s, i) => <Row key={s.userId + s.version} p={p} first={i === 0} icon="edit-3" title={s.fullName} detail={`Signed “${s.signedName}” on ${when(s.signedAt)}`}
                tags={[s.version === viewing.version ? ["Current wording", "good"] : [`Version ${s.version}`, "plain"]]} />)}
            </List>
          </Section>
          <Text selectable style={[ui.body, { color: p.text }]}>{viewing.body}</Text>
        </>}
      </Sheet>
      <PreviewSheet p={p} role={previewing} contracts={contracts} courses={courses} onClose={() => setPreviewing(null)} />
      <PersonSheet p={p} person={person} onClose={() => setPerson(null)} />
      <ContractEditor p={p} contract={editing === "new" ? null : editing} visible={editing !== null} onClose={() => setEditing(null)} onDone={saved(load)} />
    </View>
  );
}

// Team members (Help): the contracts they have signed, with the exact wording.
export function MyContracts({ palette: p, account }: { palette: Palette; account: WorkspaceAccount }) {
  const [items, setItems] = useState<MyContract[] | null>(null);
  const [open, setOpen] = useState<MyContract | null>(null);
  const staff = STAFF_ROLES.includes(account.role);
  useEffect(() => {
    if (!staff) return;
    let active = true;
    void readTeams({ section: "myContracts" }).then(r => { if (active) setItems(myContractsSchema.parse(r.data)); }).catch(() => { if (active) setItems([]); });
    return () => { active = false; };
  }, [staff]);
  if (!staff || !items?.length) return null;
  return (
    <Section title="Your contracts" count={items.length} p={p}>
      <List p={p} empty="">
        {items.map((c, i) => <Row key={c.contractId + c.version} p={p} first={i === 0} icon="file-text" title={c.title} detail={`Signed “${c.signedName}” on ${when(c.signedAt)} · version ${c.version}`}
          tags={[c.latest ? ["Current", "good"] : ["Earlier wording", "plain"]]} onPress={() => setOpen(c)} />)}
      </List>
      <Sheet palette={p} visible={!!open} onClose={() => setOpen(null)} title={open?.title ?? ""} subtitle={open ? `You signed version ${open.version} on ${when(open.signedAt)}` : undefined} icon="clipboard">
        {open && <Text selectable style={[ui.body, { color: p.text }]}>{open.body}</Text>}
      </Sheet>
    </Section>
  );
}
