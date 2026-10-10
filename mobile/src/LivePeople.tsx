import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TextInput, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Crypto from "expo-crypto";
import { Text } from "./Typography";
import { PropertySelect, SearchPicker } from "./SearchPicker";
import { useSaved } from "./Celebrate";
import { ExpandChevron, MotionPress } from "./motion";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { Button, Field, message, Notice, Section, Tag, Loading } from "./LiveKit";
import { List, Pills, Row } from "./LiveAccounts";
import { HostawaySyncCard } from "./HostawaySyncCard";
import { readAdmin, workspaceRequest, writeAdmin, writeWorkspace, WorkspaceApiError } from "./backend/client";
import { adminPropertiesSchema, assignmentFor, canEdit, detailSchemas, peopleSchema, ROLE_LABEL, rolesFor, toolsFor, toolsOnRoleChange, type AdminProperty, type Person } from "../../lib/admin-live";
import { isWorkspaceAdmin, type ModuleId, type WorkspaceRole } from "../../lib/modules";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import { blankOtaAccount, HOLDER_LABEL, looksLikePassword, OTA_PLATFORMS, type OtaAccount } from "../../lib/ota-accounts";

// Live administration: approve and manage people, and create, edit and staff
// properties. Admins only; the database enforces the role hierarchy.
const STATUS_TAG: Record<Person["status"], [string, "good" | "wait" | "bad" | "plain"]> = { pending: ["Waiting for approval", "wait"], active: ["Active", "good"], revoked: ["Revoked", "bad"] };
const PROPERTY_TAG: Record<AdminProperty["status"], [string, "good" | "wait" | "bad" | "plain"]> = { onboarding: ["Onboarding", "wait"], active: ["Live", "good"], archived: ["Archived", "plain"] };
const roleLabel = (role: string) => ROLE_LABEL[role as WorkspaceRole] ?? role;

function Search({ p, value, onChange, placeholder }: { p: Palette; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <View style={[ui.row, { gap: 10, paddingHorizontal: 14, minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: p.controlBorder, backgroundColor: p.background }]}>
      <Feather name="search" size={18} color={p.muted} />
      <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={p.muted} accessibilityLabel={placeholder} autoCapitalize="none" style={{ flex: 1, color: p.text, fontFamily: "Montserrat_500Medium", fontSize: 14 }} />
    </View>
  );
}

function PersonSheet({ p, actorRole, person, properties, onClose, onDone }: { p: Palette; actorRole: string; person: Person | null; properties: AdminProperty[]; onClose: () => void; onDone: () => Promise<void> }) {
  // The parent remounts this sheet per person, so edits survive list reloads.
  const [fullName, setFullName] = useState(person?.fullName ?? "");
  const [role, setRole] = useState<WorkspaceRole>((person?.role ?? "stays") as WorkspaceRole);
  // A pending request starts from the role's usual tools.
  const [modules, setModules] = useState<ModuleId[]>(() => person && person.status === "pending" && !person.modules.length ? toolsOnRoleChange(person.role as WorkspaceRole) : (person?.modules ?? []) as ModuleId[]);
  const [responsibilities, setResponsibilities] = useState(person?.responsibilities ?? "");
  const [showTools, setShowTools] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!person) return <Sheet palette={p} visible={false} onClose={onClose} title=""><View /></Sheet>;
  const editable = canEdit(actorRole, person);
  const roles = rolesFor(actorRole);
  const tools = toolsFor(role);
  const admin = isWorkspaceAdmin(role);

  async function saveAccess(status: Person["status"]) {
    if (!person || busy) return;
    if (fullName.trim().length < 2) { setError("Add the person's name."); return; }
    if (status === "active" && !admin && !modules.length) { setError("Choose at least one tool."); return; }
    setBusy(true); setError("");
    try {
      await writeAdmin({ action: "saveAccess", userId: person.userId, fullName: fullName.trim(), role, status, modules: admin ? [] : modules, responsibilities: responsibilities.trim() });
      onClose(); await onDone();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function assignment(propertyId: string, add: boolean) {
    if (!person || busy) return;
    setBusy(true); setError("");
    try {
      await writeWorkspace(add ? { action: "assignProperty", propertyId, userId: person.userId, assignment: assignmentFor(person.role) } : { action: "unassignProperty", propertyId, userId: person.userId });
      await onDone();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function assignEverything() {
    if (!person || busy) return;
    setBusy(true); setError("");
    try { await writeAdmin({ action: "assignAllProperties", userId: person.userId }); await onDone(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const assigned = new Set(person.assignments.map(a => a.propertyId));
  const available = properties.filter(x => x.status !== "archived" && !assigned.has(x.id));

  return (
    <Sheet palette={p} visible onClose={onClose} title={person.fullName || person.email || "New account"} subtitle={person.email ?? "Signed up by phone"} icon="people">
      <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
        <Tag label={STATUS_TAG[person.status][0]} tone={STATUS_TAG[person.status][1]} p={p} />
        {!person.emailVerified && <Tag label="Email not verified" tone="wait" p={p} />}
      </View>
      {!editable && <Notice text="Only a super admin can change an admin's access." p={p} />}
      {editable && <>
        <Field label="Full name" value={fullName} onChange={setFullName} p={p} />
        <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Role</Text>
        <Pills p={p} values={roles} value={role} onChange={r => { setRole(r); setModules(toolsOnRoleChange(r)); }} label={roleLabel} />
        {role !== person.role && <Text style={[ui.small, { color: p.muted }]}>A new role brings that role’s usual tools{admin ? " (admins have every tool)" : `: ${modules.length} tools`}. Switch single tools on or off after saving. Property assignments stay; check they still fit.</Text>}
        {!admin && role === person.role && <>
          <MotionPress accessibilityRole="button" onPress={() => setShowTools(v => !v)} style={[ui.row, { gap: 8, minHeight: 44 }]}>
            <ExpandChevron open={showTools} size={18} color={p.primary} />
            <Text style={{ color: p.primary, fontWeight: "600", flex: 1 }}>Tools: {modules.length} selected</Text>
          </MotionPress>
          {showTools && <View style={{ gap: 2 }}>
            {tools.map(t => {
              const on = modules.includes(t.id);
              return (
                <MotionPress key={t.id} accessibilityRole="checkbox" accessibilityState={{ checked: on }} onPress={() => setModules(on ? modules.filter(m => m !== t.id) : [...modules, t.id])} style={[ui.row, { gap: 12, minHeight: 42 }]}>
                  <Feather name={on ? "check-square" : "square"} size={19} color={on ? p.primary : p.muted} /><Text style={{ color: p.text, flex: 1 }}>{t.name}</Text>
                </MotionPress>
              );
            })}
            <Button label="Use the usual tools for this role" p={p} onPress={() => setModules(toolsOnRoleChange(role))} />
          </View>}
        </>}
        {admin && <Text style={[ui.small, { color: p.muted }]}>Admins have every tool.</Text>}
        <Field label="Responsibilities (optional)" value={responsibilities} onChange={setResponsibilities} p={p} multiline />
        {!!error && <Notice text={error} p={p} tone="bad" />}
        {person.status === "pending" && <Button label={busy ? "Saving…" : "Approve access"} icon="check" primary p={p} disabled={busy || !person.emailVerified} onPress={() => void saveAccess("active")} />}
        {person.status === "pending" && !person.emailVerified && <Text style={[ui.small, { color: p.muted }]}>{person.email ? "They need to verify their email before access can be approved." : "They signed up by phone, and access can only be approved for a verified email. Ask them to sign up with their email."}</Text>}
        {person.status === "active" && <Button label={busy ? "Saving…" : "Save changes"} primary p={p} disabled={busy} onPress={() => void saveAccess("active")} />}
        {person.status === "revoked" && <Button label={busy ? "Saving…" : "Restore access"} primary p={p} disabled={busy} onPress={() => void saveAccess("active")} />}
        {person.status !== "revoked" && <Button label="Revoke access" icon="slash" p={p} disabled={busy} onPress={() => void saveAccess("revoked")} />}
      </>}

      {!isWorkspaceAdmin(person.role) && <Section title="Properties" count={person.assignments.length} p={p}>
        {person.assignments.map(a => (
          <View key={a.propertyId} style={[ui.between, { gap: 10, minHeight: 44 }]}>
            <Text style={{ color: p.text, flex: 1 }}>{a.propertyName}{a.propertyStatus === "archived" ? " (archived)" : ""}</Text>
            {editable && <MotionPress accessibilityRole="button" accessibilityLabel={`Remove ${a.propertyName}`} onPress={() => void assignment(a.propertyId, false)} style={{ padding: 8 }}><Feather name="x-circle" size={20} color={p.muted} /></MotionPress>}
          </View>
        ))}
        {!person.assignments.length && <Text style={[ui.small, { color: p.muted }]}>No properties yet. People only see the properties they are assigned to.</Text>}
        {editable && person.status === "active" && available.length > 0 && <>
          {person.role !== "client" && <Button label={busy ? "Saving…" : `Give every property (${available.length} more)`} icon="plus" p={p} disabled={busy} onPress={() => void assignEverything()} />}
          <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Add a property</Text>
          <PropertySelect p={p} properties={available} value="" onChange={id => void assignment(id, true)} />
        </>}
        {editable && person.status !== "active" && <Text style={[ui.small, { color: p.muted }]}>Approve access before assigning properties.</Text>}
      </Section>}
      {!!error && !editable && <Notice text={error} p={p} tone="bad" />}
    </Sheet>
  );
}

type Details = { access: string; ota: string; accounts: OtaAccount[]; paymentNotes: string; feeBps: number | null };

// One row per platform: which account, who holds it, where the password is kept, who gets the code.
function OtaAccountsEditor({ p, accounts, onChange }: { p: Palette; accounts: OtaAccount[]; onChange: (next: OtaAccount[]) => void }) {
  const set = (i: number, patch: Partial<OtaAccount>) => onChange(accounts.map((a, j) => j === i ? { ...a, ...patch } : a));
  const unused = OTA_PLATFORMS.find(x => !accounts.some(a => a.platform === x)) ?? "Other";
  return (
    <View style={{ gap: 10 }}>
      <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Platform logins</Text>
      <Text style={[ui.small, { color: p.muted }]}>Never type a password here. Say where it’s kept (for example “1Password, Stays vault”) and who gets the security code.</Text>
      {accounts.map((a, i) => (
        <View key={i} style={{ gap: 8, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface }}>
          <Pills p={p} values={OTA_PLATFORMS} value={(OTA_PLATFORMS as readonly string[]).includes(a.platform) ? a.platform as (typeof OTA_PLATFORMS)[number] : "Other"} onChange={v => set(i, { platform: v })} label={v => v} />
          <Pills p={p} values={["recharge", "owner"] as const} value={a.holder} onChange={v => set(i, { holder: v })} label={v => HOLDER_LABEL[v]} />
          <Field label="Login (email or username)" value={a.login} onChange={v => set(i, { login: v })} p={p} email />
          <Field label="Password kept in" value={a.passwordWhere} onChange={v => set(i, { passwordWhere: v })} p={p} placeholder="1Password, Stays vault" />
          <Field label="Security code goes to" value={a.twoFactor} onChange={v => set(i, { twoFactor: v })} p={p} placeholder="Owner’s mobile ending 4821" />
          <Field label="Notes" value={a.notes} onChange={v => set(i, { notes: v })} p={p} multiline />
          {[a.login, a.passwordWhere, a.twoFactor, a.notes].some(looksLikePassword) && <Notice text="That looks like a password. Remove it and say where it’s kept instead." p={p} tone="bad" />}
          <Button label="Remove this login" icon="trash-2" p={p} onPress={() => onChange(accounts.filter((_, j) => j !== i))} />
        </View>
      ))}
      {accounts.length < 20 && <Button label="Add a platform login" icon="plus" p={p} onPress={() => onChange([...accounts, blankOtaAccount(unused)])} />}
    </View>
  );
}
function PropertySheet({ p, property, creating, people, onClose, onDone }: { p: Palette; property: AdminProperty | null; creating: boolean; people: Person[]; onClose: () => void; onDone: () => Promise<void> }) {
  // The parent remounts this sheet per property, so edits survive list reloads.
  const [name, setName] = useState(property?.name ?? "");
  const [address, setAddress] = useState(property?.address ?? "");
  const [region, setRegion] = useState(property?.region ?? "");
  const [bedrooms, setBedrooms] = useState(String(property?.bedrooms ?? 0));
  const [status, setStatus] = useState<AdminProperty["status"]>(property?.status ?? "onboarding");
  const [details, setDetails] = useState<Details | null>(null);
  const [draft, setDraft] = useState<Details | null>(null);
  const [requestId] = useState(() => Crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const visible = creating || !!property;
  const propertyId = property?.id;
  useEffect(() => {
    if (!propertyId) return;
    let active = true;
    // Private details are read section by section; each section has its own access check.
    void Promise.all((["access", "ota", "finance"] as const).map(async section => (await (await workspaceRequest("/api/mobile/property-details?" + new URLSearchParams({ propertyId, section }))).json()).data))
      .then(([access, ota, finance]) => {
        if (!active) return;
        const a = detailSchemas.access.parse(access), o = detailSchemas.ota.parse(ota), f = detailSchemas.finance.parse(finance);
        const loaded = { access: a.accessInstructions ?? "", ota: o.otaInstructions ?? "", accounts: o.otaAccounts ?? [], paymentNotes: f.paymentNotes ?? "", feeBps: f.managementFeeBps ?? null };
        setDetails(loaded); setDraft(loaded);
      }).catch(e => { if (active) setError(e instanceof WorkspaceApiError ? e.message : "Private details could not be loaded."); });
    return () => { active = false; };
  }, [propertyId]);

  // What a part-finished save already wrote, so trying again carries on from the property's new version
  // instead of failing with "changed by someone else".
  const written = useRef<{ id: string; key: string; version: number; sections: string[] } | null>(null);
  async function save() {
    if (busy) return;
    const beds = Number(bedrooms);
    if (name.trim().length < 2 || !Number.isInteger(beds) || beds < 0 || beds > 100) { setError("Add a name (at least 2 characters) and the number of bedrooms."); return; }
    setBusy(true); setError("");
    try {
      const fields = { name: name.trim(), address: address.trim(), region: region.trim(), bedrooms: beds, status }, key = JSON.stringify(fields);
      const resume = property && written.current?.id === property.id && written.current.key === key ? written.current : null;
      if (!resume) await writeWorkspace({ action: "saveProperty", input: property ? { id: property.id, version: property.version, ...fields } : { requestId, ...fields } });
      // Each detail section saved bumps the property's version, so carry it forward.
      if (property && details && draft) {
        let version = resume ? resume.version : property.version + 1;
        const done = resume ? resume.sections : [];
        written.current = { id: property.id, key, version, sections: done };
        const changes: [string, Record<string, unknown>][] = [];
        if (draft.access !== details.access) changes.push(["access", { accessInstructions: draft.access }]);
        if (draft.ota !== details.ota) changes.push(["ota", { otaInstructions: draft.ota }]);
        const accounts = draft.accounts.map(x => ({ ...x, platform: x.platform.trim(), login: x.login.trim(), passwordWhere: x.passwordWhere.trim(), twoFactor: x.twoFactor.trim(), notes: x.notes.trim() }));
        if (JSON.stringify(accounts) !== JSON.stringify(details.accounts)) changes.push(["otaAccounts", { accounts }]);
        if (draft.paymentNotes !== details.paymentNotes) changes.push(["finance", { managementFeeBps: details.feeBps, paymentNotes: draft.paymentNotes }]);
        for (const [section, input] of changes) {
          if (done.includes(section)) continue;
          await workspaceRequest("/api/mobile/property-details", { propertyId: property.id, version, section, input });
          version += 1; done.push(section); written.current = { id: property.id, key, version, sections: done };
        }
      }
      written.current = null;
      onClose(); await onDone();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function assignment(person: Pick<Person, "userId" | "role">, add: boolean) {
    if (!property || busy) return;
    setBusy(true); setError("");
    try {
      await writeWorkspace(add ? { action: "assignProperty", propertyId: property.id, userId: person.userId, assignment: assignmentFor(person.role) } : { action: "unassignProperty", propertyId: property.id, userId: person.userId });
      await onDone();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const onProperty = new Set(property?.people.map(x => x.userId) ?? []);
  const candidates = people.filter(x => x.status === "active" && !isWorkspaceAdmin(x.role) && !onProperty.has(x.userId));
  return (
    <Sheet palette={p} visible={visible} onClose={onClose} title={property ? property.name : "New property"} subtitle={property ? `${property.region || "No region"} · ${property.bedrooms} bedrooms` : "Add the basics; details and people come next"} icon="house">
      <Field label="Name" value={name} onChange={setName} p={p} />
      <Field label="Address" value={address} onChange={setAddress} p={p} multiline />
      <View style={[ui.row, { gap: 10 }]}>
        <View style={{ flex: 2 }}><Field label="Region" value={region} onChange={setRegion} p={p} /></View>
        <View style={{ flex: 1 }}><Field label="Bedrooms" value={bedrooms} onChange={setBedrooms} p={p} /></View>
      </View>
      <Pills p={p} values={["onboarding", "active", "archived"] as const} value={status} onChange={setStatus} label={v => PROPERTY_TAG[v][0]} />
      {status === "archived" && property?.status !== "archived" && <Text style={[ui.small, { color: p.muted }]}>Archived properties drop out of schedules, statements and lists. Their history is kept.</Text>}
      {property && <Section title="Private details" p={p}>
        {!draft && !error && <Loading p={p} />}
        {draft && <>
          <Field label="Access instructions (key safe, door codes)" value={draft.access} onChange={v => setDraft({ ...draft, access: v })} p={p} multiline />
          <OtaAccountsEditor p={p} accounts={draft.accounts} onChange={accounts => setDraft({ ...draft, accounts })} />
          <Field label="Other login notes" value={draft.ota} onChange={v => setDraft({ ...draft, ota: v })} p={p} multiline />
          <Field label="Owner payment notes" value={draft.paymentNotes} onChange={v => setDraft({ ...draft, paymentNotes: v })} p={p} multiline />
          <Text style={[ui.small, { color: p.muted }]}>These never appear in activity, exports or reports. The management fee and cleaning cost are set in Accounts, under Statements.</Text>
        </>}
      </Section>}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <Button label={busy ? "Saving…" : property ? "Save property" : "Create property"} primary p={p} disabled={busy} onPress={() => void save()} />

      {property && <Section title="People" count={property.people.length} p={p}>
        {property.people.map(x => (
          <View key={x.userId} style={[ui.between, { gap: 10, minHeight: 44 }]}>
            <Text style={{ color: p.text, flex: 1 }}>{x.fullName} · {roleLabel(x.role)}{x.status !== "active" ? " (inactive)" : ""}</Text>
            <MotionPress accessibilityRole="button" accessibilityLabel={`Remove ${x.fullName}`} onPress={() => void assignment(x, false)} style={{ padding: 8 }}><Feather name="x-circle" size={20} color={p.muted} /></MotionPress>
          </View>
        ))}
        {!property.people.length && <Text style={[ui.small, { color: p.muted }]}>Nobody is assigned yet. Add the owner and the team who look after it.</Text>}
        {candidates.length > 0 && <>
          <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Add someone</Text>
          <SearchPicker p={p} value="" placeholder="Search people by name" nouns="people"
            options={candidates.map(x => ({ id: x.userId, label: `${x.fullName} · ${roleLabel(x.role)}`, keywords: x.email ?? "" }))}
            onChange={id => { const x = candidates.find(c => c.userId === id); if (x) void assignment(x, true); }} />
        </>}
      </Section>}
    </Sheet>
  );
}

export function LivePeople({ palette: p, account, view }: { palette: Palette; account: WorkspaceAccount; view: "people" | "properties" }) {
  const saved = useSaved();
  const [people, setPeople] = useState<Person[]>([]);
  const [properties, setProperties] = useState<AdminProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [personFilter, setPersonFilter] = useState<"pending" | "active" | "revoked" | "all">("pending");
  const [propertyFilter, setPropertyFilter] = useState<"active" | "onboarding" | "archived" | "all">("all");
  const [openPerson, setOpenPerson] = useState<string | null>(null);
  const [openProperty, setOpenProperty] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    const [pe, pr] = await Promise.allSettled([readAdmin("people"), readAdmin("properties")]);
    try {
      if (pe.status === "fulfilled") setPeople(peopleSchema.parse(pe.value.data)); else throw pe.reason;
      if (pr.status === "fulfilled") setProperties(adminPropertiesSchema.parse(pr.value.data)); else throw pr.reason;
    } catch (e) { setError(e instanceof WorkspaceApiError ? e.message : "Administration could not be loaded."); }
    setLoading(false);
  }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  // Start on everyone when nobody is waiting.
  const pending = people.filter(x => x.status === "pending").length;
  const shownFilter = personFilter === "pending" && !pending && !loading ? "all" : personFilter;
  const q = query.trim().toLowerCase();
  const shownPeople = useMemo(() => people.filter(x => (shownFilter === "all" || x.status === shownFilter) && (!q || (x.fullName + " " + (x.email ?? "")).toLowerCase().includes(q))), [people, shownFilter, q]);
  const shownProperties = properties.filter(x => (propertyFilter === "all" ? x.status !== "archived" : x.status === propertyFilter) && (!q || (x.name + " " + x.region + " " + x.address).toLowerCase().includes(q)));
  const person = people.find(x => x.userId === openPerson) ?? null;
  const property = properties.find(x => x.id === openProperty) ?? null;

  return (
    <View style={{ gap: 16 }}>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {loading && <Loading p={p} />}
      <Search p={p} value={query} onChange={setQuery} placeholder={view === "people" ? "Search people" : "Search properties"} />
      {view === "people" && <>
        <Pills p={p} values={["pending", "active", "revoked", "all"] as const} value={shownFilter} onChange={setPersonFilter} label={v => ({ pending: `Waiting (${pending})`, active: "Active", revoked: "Revoked", all: "Everyone" })[v]} />
        <List p={p} empty={shownFilter === "pending" ? "Nobody is waiting for approval." : "No people match."}>
          {shownPeople.map((x, i) => (
            <Row key={x.userId} p={p} first={i === 0} icon={x.status === "pending" ? "user-plus" : x.status === "revoked" ? "user-x" : "user"} title={x.fullName || x.email || "New account"} detail={`${roleLabel(x.role)} · ${x.email ?? "phone sign-up"}${!isWorkspaceAdmin(x.role) ? ` · ${x.assignments.length} propert${x.assignments.length === 1 ? "y" : "ies"}` : ""}`}
              tags={[STATUS_TAG[x.status], ...(!x.emailVerified ? [["Email not verified", "wait"] as [string, "wait"]] : [])]} onPress={() => setOpenPerson(x.userId)} />
          ))}
        </List>
        <Text style={[ui.small, { color: p.muted }]}>New people sign up in the app and ask for access. Their request appears here for approval.</Text>
      </>}
      {view === "properties" && <>
        <HostawaySyncCard p={p} onSynced={() => void load()} />
        <Button label="New property" icon="plus" primary p={p} onPress={() => setCreating(true)} />
        <Pills p={p} values={["all", "active", "onboarding", "archived"] as const} value={propertyFilter} onChange={setPropertyFilter} label={v => ({ all: "Current", active: "Live", onboarding: "Onboarding", archived: "Archived" })[v]} />
        <List p={p} empty="No properties match.">
          {shownProperties.map((x, i) => {
            const owners = x.people.filter(y => y.assignment === "client").map(y => y.fullName);
            return <Row key={x.id} p={p} first={i === 0} icon="home" tone="stays" title={x.name} detail={`${x.region || "No region"} · ${x.bedrooms} bed · ${owners.length ? "Owner " + owners.join(", ") : "No owner assigned"} · ${x.people.length} people`}
              tags={[PROPERTY_TAG[x.status]]} onPress={() => setOpenProperty(x.id)} />;
          })}
        </List>
      </>}
      <PersonSheet key={openPerson ?? "none"} p={p} actorRole={account.role} person={person} properties={properties} onClose={() => setOpenPerson(null)} onDone={saved(load)} />
      <PropertySheet key={(openProperty ?? "none") + (creating ? ":new" : "")} p={p} property={property} creating={creating} people={people} onClose={() => { setOpenProperty(null); setCreating(false); }} onDone={saved(load)} />
    </View>
  );
}
