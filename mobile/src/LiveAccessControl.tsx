import { useCallback, useEffect, useState } from "react";
import { Switch, TextInput, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { useCelebrate } from "./Celebrate";
import { MotionPress, Pop, SwapIn } from "./motion";
import { Sheet } from "./TeamFlows";
import { departmentColor, ui, type Palette } from "./theme";
import { Anchor, Button, Field, Loading, message, Notice, Section, StatGrid, StatTile, Tag } from "./LiveKit";
import { Pills } from "./LiveAccounts";
import { readAdmin, writeAdmin } from "./backend/client";
import { accessHistorySchema, accessPeopleSchema, accessState, accessSummary, eventLabel, lastSeen, matchesSearch, STATE_LABEL, toolGroups, type AccessEvent, type AccessPerson, type AccessState } from "../../lib/access-control";
import { ROLE_LABEL, rolesFor, toolsFor, toolsOnRoleChange } from "../../lib/admin-live";
import { isWorkspaceAdmin, type ModuleId, type WorkspaceRole } from "../../lib/modules";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";

// Access control, for super admins: every account, its role and tools, and the security actions
// (sign out everywhere, revoke the password, block, delete). The database checks every change.
const roleLabel = (role: string) => ROLE_LABEL[role as WorkspaceRole] ?? role;
const initials = (name: string) => name.trim().split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase() || "?";
const FILTERS = ["all", "active", "pending", "blocked", "deleted"] as const;
const FILTER_LABEL: Record<(typeof FILTERS)[number], string> = { all: "Everyone", active: "Active", pending: "Waiting", blocked: "Blocked", deleted: "Deleted" };

function PersonRow({ p, person, first, onPress }: { p: Palette; person: AccessPerson; first: boolean; onPress: () => void }) {
  const state = accessState(person), [label, tone] = STATE_LABEL[state];
  const tools = isWorkspaceAdmin(person.role) ? "Every tool" : `${person.modules.length} tool${person.modules.length === 1 ? "" : "s"}`;
  return (
    <MotionPress accessibilityRole="button" accessibilityLabel={`${person.fullName}, ${roleLabel(person.role)}, ${label}`} onPress={onPress}
      style={[ui.row, { gap: 12, paddingVertical: 12, borderTopWidth: first ? 0 : 1, borderColor: p.border, alignItems: "center" }]}>
      <View style={{ width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: state === "blocked" ? p.cautionWash : p.wash }}>
        <Text style={{ color: p.text, fontWeight: "700", fontSize: 14 }}>{initials(person.fullName)}</Text>
        {person.activeSessions > 0 && <View accessibilityLabel="Signed in now" style={{ position: "absolute", right: 0, bottom: 1, width: 12, height: 12, borderRadius: 6, backgroundColor: p.success, borderWidth: 2, borderColor: p.surface }} />}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <Text numberOfLines={1} style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>{person.fullName || "No name yet"}</Text>
        <Text numberOfLines={1} style={[ui.small, { color: p.muted }]}>{person.email ?? person.phone ?? "No contact"} · {lastSeen(person.lastSignInAt)}</Text>
        <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>
          <Tag label={roleLabel(person.role)} tone="plain" p={p} />
          <Tag label={label} tone={tone} p={p} />
          {person.passwordRevoked && !person.closed && <Tag label="Password reset needed" tone="wait" p={p} />}
        </View>
      </View>
      <View style={{ alignItems: "flex-end", gap: 2 }}>
        <Text style={[ui.small, { color: p.text, fontWeight: "700", fontVariant: ["tabular-nums"] }]}>{tools}</Text>
        <Feather name="chevron-right" size={18} color={p.muted} />
      </View>
    </MotionPress>
  );
}

type Danger = "signOut" | "revokePassword" | "block" | "unblock" | "deleteAccount";
const DANGER: Record<Danger, { label: string; icon: "log-out" | "key" | "slash" | "unlock" | "trash-2"; explain: string; done: string }> = {
  signOut: { label: "Sign out everywhere", icon: "log-out", explain: "Ends every session on every device. They can sign in again with their password.", done: "Signed out everywhere" },
  revokePassword: { label: "Revoke password", icon: "key", explain: "Their current password stops working and they are signed out. They set a new one with “Forgot password” (email or phone).", done: "Password revoked" },
  block: { label: "Block", icon: "slash", explain: "They are signed out and can’t sign in or use the app until you unblock them. Their tools and history are kept.", done: "Blocked" },
  unblock: { label: "Unblock", icon: "unlock", explain: "They can sign in again with the tools they had.", done: "Unblocked" },
  deleteAccount: { label: "Delete account", icon: "trash-2", explain: "Takes away every tool and property and signs them out for good. An account with no work history is removed completely; one with history is closed and shown as “Deleted account”, so records of who did what stay intact. This can’t be undone.", done: "Account deleted" },
};

function AccessSheet({ p, actor, person, onClose, onDone }: { p: Palette; actor: WorkspaceAccount; person: AccessPerson; onClose: () => void; onDone: () => Promise<void> }) {
  const celebrate = useCelebrate();
  const [role, setRole] = useState<WorkspaceRole>(person.role as WorkspaceRole);
  const [modules, setModules] = useState<ModuleId[]>(person.modules as ModuleId[]);
  const [asking, setAsking] = useState<Danger | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const self = person.userId === actor.userId, state = accessState(person), admin = isWorkspaceAdmin(role);
  const allowed = new Set(toolsFor(role).map(t => t.id));
  const changed = role !== person.role || [...modules].sort().join() !== [...person.modules].sort().join();
  const run = async (body: Parameters<typeof writeAdmin>[0], done: string) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await writeAdmin(body); celebrate(done); setAsking(null); setTyped(""); await onDone(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  };
  const saveAccess = () => {
    if (!admin && person.status === "active" && !modules.length) { setError("Choose at least one tool, or block the account instead."); return; }
    void run({ action: "setAccess", userId: person.userId, role, modules: admin ? [] : modules.filter(m => allowed.has(m)) }, "Access saved");
  };
  const confirm = (d: Danger) => d === "deleteAccount" ? run({ action: "deleteAccount", userId: person.userId, confirm: true }, DANGER[d].done) : run({ action: d, userId: person.userId }, DANGER[d].done);
  const actions: Danger[] = state === "blocked" ? ["unblock", "revokePassword", "deleteAccount"] : ["signOut", "revokePassword", "block", "deleteAccount"];
  const detail = (icon: "mail" | "phone" | "calendar" | "clock" | "monitor" | "home", text: string) => <View style={[ui.row, { gap: 10 }]}><Feather name={icon} size={15} color={p.muted} /><Text selectable style={[ui.small, { color: p.text, flex: 1 }]}>{text}</Text></View>;
  return (
    <Sheet palette={p} visible onClose={onClose} title={person.fullName || "Account"} subtitle={`${roleLabel(person.role)} · ${STATE_LABEL[state][0]}`} icon="people">
      <View style={{ gap: 8, padding: 14, borderRadius: 18, backgroundColor: p.background, borderWidth: 1, borderColor: p.border }}>
        {!!person.email && detail("mail", person.email + (person.emailVerified ? "" : " (not verified)"))}
        {!!person.phone && detail("phone", person.phone)}
        {detail("clock", lastSeen(person.lastSignInAt))}
        {detail("monitor", person.activeSessions ? `${person.activeSessions} active session${person.activeSessions === 1 ? "" : "s"}` : "Not signed in anywhere")}
        {detail("home", `${person.properties} propert${person.properties === 1 ? "y" : "ies"} assigned`)}
        {detail("calendar", "Joined " + new Date(person.joinedAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/London" }))}
      </View>
      {self && <Notice text="This is your account. Another super admin changes your access, so you can’t lock yourself out." p={p} />}
      {state === "deleted" && <Notice text="This account has been deleted. Its history stays on record." p={p} />}
      {!self && state !== "deleted" && <>
        <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>Role</Text>
        <Pills p={p} values={rolesFor("super_admin")} value={role} onChange={r => { setRole(r); setModules(toolsOnRoleChange(r)); }} label={roleLabel} />
        <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "700" }}>Tools{admin ? "" : ` · ${modules.filter(m => allowed.has(m)).length} on`}</Text>
        {admin ? <Text style={[ui.small, { color: p.muted }]}>Admins and super admins have every tool.</Text> : <>
          {toolGroups().map(g => {
            const tools = g.tools.filter(t => allowed.has(t.id));
            if (!tools.length) return null;
            return (
              <View key={g.tone} style={{ gap: 2, padding: 12, borderRadius: 16, backgroundColor: departmentColor(g.tone, p).wash }}>
                <Text style={{ color: departmentColor(g.tone, p).ink, fontSize: 12, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", paddingBottom: 4 }}>{g.label}</Text>
                {tools.map(t => {
                  const on = modules.includes(t.id);
                  return (
                    <View key={t.id} style={[ui.between, { minHeight: 44, gap: 12 }]}>
                      <Text style={{ color: p.text, flex: 1, fontWeight: on ? "600" : "400" }}>{t.name}</Text>
                      <Switch accessibilityLabel={t.name} value={on} onValueChange={v => setModules(v ? [...modules, t.id] : modules.filter(m => m !== t.id))} trackColor={{ false: p.controlBorder, true: p.primary }} thumbColor={p.surface} />
                    </View>
                  );
                })}
              </View>
            );
          })}
          <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
            <Button label="Usual tools for this role" p={p} onPress={() => setModules(toolsOnRoleChange(role))} />
            <Button label="Remove all" p={p} onPress={() => setModules([])} />
          </View>
        </>}
        {changed && <Button label={busy ? "Saving…" : "Save role and tools"} icon="check" primary p={p} disabled={busy} onPress={saveAccess} />}
        <Text accessibilityRole="header" style={{ color: p.text, fontSize: 15, fontWeight: "700", paddingTop: 6 }}>Security</Text>
        {actions.map(d => {
          const open = asking === d, deleting = d === "deleteAccount";
          return (
            <View key={d} style={{ gap: 8 }}>
              <MotionPress accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => { setAsking(open ? null : d); setTyped(""); setError(""); }}
                style={[ui.row, { gap: 12, minHeight: 52, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: deleting ? p.danger : p.border, backgroundColor: open ? (deleting ? p.cautionWash : p.wash) : p.surface }]}>
                <Feather name={DANGER[d].icon} size={18} color={deleting ? p.danger : p.primary} />
                <Text style={{ color: deleting ? p.danger : p.text, fontWeight: "700", flex: 1 }}>{DANGER[d].label}</Text>
                <Feather name={open ? "chevron-up" : "chevron-down"} size={18} color={p.muted} />
              </MotionPress>
              {open && <SwapIn swapKey={d}><View style={{ gap: 10, padding: 12, borderRadius: 14, backgroundColor: p.background }}>
                <Text style={[ui.small, { color: p.text }]}>{DANGER[d].explain}</Text>
                {deleting && <Field label="Type DELETE to confirm" value={typed} onChange={setTyped} p={p} placeholder="DELETE" />}
                <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
                  <Button label={busy ? "Working…" : `Yes, ${DANGER[d].label.toLowerCase()}`} primary p={p} disabled={busy || (deleting && typed.trim() !== "DELETE")} onPress={() => void confirm(d)} />
                  <Button label="Cancel" p={p} onPress={() => setAsking(null)} />
                </View>
              </View></SwapIn>}
            </View>
          );
        })}
      </>}
      {!!error && <Notice text={error} p={p} tone="bad" />}
    </Sheet>
  );
}

function HistoryRow({ p, e, first }: { p: Palette; e: AccessEvent; first: boolean }) {
  const when = new Date(e.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" });
  return (
    <View style={[ui.row, { gap: 12, paddingVertical: 10, borderTopWidth: first ? 0 : 1, borderColor: p.border }]}>
      <Feather name={e.event === "account_blocked" || e.event === "account_deleted" ? "slash" : e.event === "password_revoked" ? "key" : e.event === "signed_out_everywhere" ? "log-out" : "sliders"} size={16} color={p.muted} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ color: p.text, fontWeight: "600", fontSize: 14 }}>{eventLabel(e.event)} · {e.target}</Text>
        <Text numberOfLines={1} style={[ui.small, { color: p.muted }]}>By {e.actor} · {when}</Text>
      </View>
    </View>
  );
}

export function AccessControl({ palette: p, account }: { palette: Palette; account: WorkspaceAccount }) {
  const [people, setPeople] = useState<AccessPerson[]>([]), [history, setHistory] = useState<AccessEvent[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState("");
  const [query, setQuery] = useState(""), [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError("");
    const [list, log] = await Promise.allSettled([readAdmin("accessControl"), readAdmin("accessHistory")]);
    if (list.status === "fulfilled") { const parsed = accessPeopleSchema.safeParse(list.value.data); if (parsed.success) setPeople(parsed.data); else setError("Access control could not be read. Refresh to try again."); }
    else setError(message(list.reason));
    if (log.status === "fulfilled") { const parsed = accessHistorySchema.safeParse(log.value.data); if (parsed.success) setHistory(parsed.data); }
    setLoading(false);
  }, []);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  if (account.role !== "super_admin") return <Notice text="Access control is for super admins." p={p} />;
  const summary = accessSummary(people);
  const shown = people.filter(x => (filter === "all" ? !x.closed : accessState(x) === (filter as AccessState)) && matchesSearch(x, query));
  const person = people.find(x => x.userId === openId) ?? null;
  return (
    <Anchor id="access-control"><View style={{ gap: 18 }}>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Access control</Text>
        <Text style={[ui.small, { color: p.muted }]}>Everyone with a Recharge account. Open a person to change their role and tools, sign them out, revoke their password, block or delete them.</Text>
      </View>
      <StatGrid>
        <StatTile key="people" p={p} icon="users" label="People" value={summary.people} />
        <StatTile key="signed" p={p} icon="monitor" label="Signed in now" value={summary.signedIn} />
        <StatTile key="blocked" p={p} icon="slash" label="Blocked" value={summary.blocked} attention={summary.blocked > 0} />
      </StatGrid>
      <View style={[ui.row, { gap: 10, paddingHorizontal: 14, minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: p.controlBorder, backgroundColor: p.background }]}>
        <Feather name="search" size={18} color={p.muted} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search by name, email, phone or role" placeholderTextColor={p.muted} accessibilityLabel="Search people" autoCapitalize="none" style={{ flex: 1, color: p.text, fontFamily: "Montserrat_500Medium", fontSize: 14 }} />
      </View>
      <Pills p={p} values={FILTERS} value={filter} onChange={setFilter} label={v => FILTER_LABEL[v] + (v === "pending" && summary.waiting ? ` (${summary.waiting})` : "")} />
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {loading ? <Loading p={p} /> : (
        <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, paddingVertical: 4, gap: 0 }]}>
          {shown.length ? shown.map((x, i) => <Pop key={x.userId} active={x.userId === openId}><PersonRow p={p} person={x} first={i === 0} onPress={() => setOpenId(x.userId)} /></Pop>)
            : <Text style={[ui.small, { color: p.muted, paddingVertical: 16 }]}>{query ? "No one matches that search." : "No one in this view."}</Text>}
        </View>
      )}
      {!!history.length && <Section title="Recent access changes" p={p}>
        <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, paddingVertical: 4, gap: 0 }]}>
          {history.slice(0, 20).map((e, i) => <HistoryRow key={e.id} p={p} e={e} first={i === 0} />)}
        </View>
      </Section>}
      {person && <AccessSheet key={person.userId + person.status + person.modules.join() + person.role + String(person.passwordRevoked) + person.activeSessions} p={p} actor={account} person={person} onClose={() => setOpenId(null)} onDone={load} />}
    </View></Anchor>
  );
}
