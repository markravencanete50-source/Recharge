import { useCallback, useEffect, useState } from "react";
import { View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Crypto from "expo-crypto";
import { z } from "zod";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { Sheet } from "./TeamFlows";
import { FurnishingSheet } from "./LiveFurnishing";
import { ui, type Palette } from "./theme";
import { Button, Field, message, Notice, Section, Tag, useRequestId, Loading } from "./LiveKit";
import { List, Pills, Row } from "./LiveAccounts";
import { readTeams, readWorkspace, workspaceRequest, writeWorkspace } from "./backend/client";
import { toolsFor, type Tool, type WorkView } from "../../lib/tool-directory";
import { MODULE_ART } from "../../lib/home-tools";
import type { ModuleId } from "../../lib/modules";
import type { PropertyView } from "../../lib/workspace-view";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import { HOLDER_LABEL, storedOtaAccountsSchema } from "../../lib/ota-accounts";
import { PhotoStrip } from "./Photos";

// Every tool a person holds, and where it lives in the live app.
export function ToolDirectory({ palette: p, account, properties, onOpen }: { palette: Palette; account: WorkspaceAccount; properties: PropertyView[]; onOpen: (tab: "home" | "work" | "properties" | "analytics", view?: WorkView) => void }) {
  const tools = toolsFor(account.role, account.modules);
  const [tracker, setTracker] = useState<Tool | null>(null);
  const [calculator, setCalculator] = useState(false);
  const open = (t: Tool) => {
    if (t.place.kind === "work") onOpen("work", t.place.view);
    else if (t.place.kind === "tab") onOpen(t.place.tab);
    else if (t.place.kind === "tracker") setTracker(t);
    else setCalculator(true);
  };
  return (
    <Section title="Your tools" count={undefined} p={p}>
      <Text style={[ui.small, { color: p.muted }]}>Every tool on your account and where to find it.</Text>
      <List p={p} empty="No tools are on your account yet. Ask an administrator.">
        {tools.map((t, i) => <Row key={t.id} p={p} first={i === 0} art={MODULE_ART[t.id]} title={t.name} detail={t.place.where} onPress={() => open(t)} />)}
      </List>
      <TrackerSheet palette={p} tool={tracker} properties={properties} onClose={() => setTracker(null)} />
      <FurnishingSheet palette={p} visible={calculator} onClose={() => setCalculator(false)} />
    </Section>
  );
}

// A simple list for tools without their own workflow (AirCover claims, restock requests):
// add an item for a property, then move it along and close it.
const workRowSchema = z.object({ id: z.string().uuid(), property_id: z.string().uuid(), title: z.string(), description: z.string(), status: z.string(), due_on: z.string().nullable(), version: z.number() });
type WorkRow = z.infer<typeof workRowSchema>;
const STATUS_TAG: Record<string, [string, "good" | "wait" | "bad" | "plain"]> = { waiting: ["Open", "wait"], in_progress: ["In progress", "plain"], completed: ["Done", "good"], cancelled: ["Cancelled", "bad"] };
export function TrackerSheet({ palette: p, tool, properties, onClose }: { palette: Palette; tool: Tool | null; properties: PropertyView[]; onClose: () => void }) {
  const [rows, setRows] = useState<WorkRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [property, setProperty] = useState("");
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [busy, setBusy] = useState(false);
  const request = useRequestId(adding && tool ? ["track", tool.id, property, title, detail].join(":") : null);
  const load = useCallback(async () => {
    if (!tool) return;
    setLoading(true); setError("");
    try { setRows(z.array(workRowSchema).parse((await readWorkspace({ entity: "work", moduleId: tool.id })).data ?? [])); }
    catch (e) { setError(message(e)); }
    setLoading(false);
  }, [tool]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) { setAdding(false); void load(); } }); return () => { active = false; }; }, [load]);
  const names = new Map(properties.map(x => [x.id, x.name]));
  async function add() {
    if (!tool || busy) return;
    if (!property || title.trim().length < 2) { setError("Choose the property and add a short title."); return; }
    setBusy(true); setError("");
    try {
      await writeWorkspace({ action: "createWork", input: { requestId: request.get(), propertyId: property, moduleId: tool.id as ModuleId, title: title.trim(), description: detail.trim(), priority: "normal", clientVisible: false } });
      request.done(); setAdding(false); setTitle(""); setDetail(""); await load();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  async function move(row: WorkRow, status: "in_progress" | "completed" | "cancelled") {
    setBusy(true); setError("");
    try { await writeWorkspace({ action: "transitionWork", workId: row.id, version: row.version, status, note: "", requestId: Crypto.randomUUID() }); await load(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible={!!tool} onClose={onClose} title={tool?.name ?? ""} subtitle={tool?.description} icon="clipboard">
      {loading && <Loading p={p} />}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {!adding && <Button label="Add" icon="plus" primary p={p} onPress={() => { setAdding(true); setProperty(properties[0]?.id ?? ""); }} />}
      {adding && <View style={{ gap: 10 }}>
        <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Property</Text>
        {properties.length ? <Pills p={p} values={properties.slice(0, 60).map(x => x.id)} value={property} onChange={setProperty} label={id => names.get(id) ?? "Property"} /> : <Notice text="No properties within your access yet." p={p} />}
        <Field label="Title" value={title} onChange={setTitle} p={p} />
        <Field label="Details (optional)" value={detail} onChange={setDetail} p={p} multiline />
        <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
          <Button label={busy ? "Saving…" : "Save"} primary p={p} disabled={busy} onPress={() => void add()} />
          <Button label="Cancel" p={p} onPress={() => setAdding(false)} />
        </View>
      </View>}
      <List p={p} empty={loading ? "Loading…" : "Nothing here yet."}>
        {rows.map((r, i) => (
          <View key={r.id} style={{ gap: 8, paddingVertical: 4, borderTopWidth: i ? 1 : 0, borderColor: p.border }}>
            <Row p={p} first art={tool ? MODULE_ART[tool.id] : "clipboard"} title={r.title} detail={[names.get(r.property_id), r.description].filter(Boolean).join(" · ")} tags={[STATUS_TAG[r.status] ?? [r.status, "plain"]]} />
            {!["completed", "cancelled"].includes(r.status) && <View style={[ui.row, { gap: 8, flexWrap: "wrap", paddingBottom: 8 }]}>
              {r.status === "waiting" && <Button label="Start" p={p} disabled={busy} onPress={() => void move(r, "in_progress")} />}
              <Button label="Done" icon="check" p={p} disabled={busy} onPress={() => void move(r, "completed")} />
              <Button label="Cancel" p={p} disabled={busy} onPress={() => void move(r, "cancelled")} />
            </View>}
          </View>
        ))}
      </List>
    </Sheet>
  );
}

// Owners: the furnishing calculator, one tap from their stays and statements.
export function FurnishingCard({ palette: p }: { palette: Palette }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, gap: 10 }]}>
      <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Furnishing your property yourself?</Text>
      <Text style={[ui.small, { color: p.muted }]}>Enter the layout and get the full quantity list for every room, ready to copy or download.</Text>
      <Button label="Open the furnishing calculator" icon="arrow-right" primary p={p} onPress={() => setOpen(true)} />
      <FurnishingSheet palette={p} visible={open} onClose={() => setOpen(false)} />
    </View>
  );
}

// Owners: what the cleaners did with the post at their properties, as the owner allowed.
const MAIL_LABEL: Record<string, string> = { photograph: "Photographed the post", open_and_photograph: "Opened and photographed the post", leave_safely: "Left the post somewhere safe" };
const mailSchema = z.array(z.object({ workId: z.string(), propertyId: z.string(), propertyName: z.string(), on: z.string(), action: z.string(), note: z.string(), photoIds: z.array(z.string().uuid()).default([]) }));
export function MailboxSection({ palette: p }: { palette: Palette }) {
  const [mail, setMail] = useState<z.infer<typeof mailSchema>>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => void readTeams({ section: "mailbox" }).then(r => { if (active) setMail(mailSchema.parse(r.data)); }).catch(e => { if (active) setError(message(e)); }).finally(() => { if (active) setLoading(false); }));
    return () => { active = false; };
  }, []);
  return (
    <Section title="Mailbox" count={undefined} p={p}>
      <Text style={[ui.small, { color: p.muted }]}>Post handled at your properties in the last 90 days, as you asked during onboarding.</Text>
      {loading && <Loading p={p} />}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <List p={p} empty={loading ? "Loading…" : "No post has been handled yet."}>
        {mail.map((m, i) => <View key={m.workId} style={{ gap: 6, paddingBottom: m.photoIds.length ? 10 : 0 }}>
          <Row p={p} first={i === 0} icon="mail" tone="clients" title={m.propertyName} detail={`${new Date(m.on + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })} · ${MAIL_LABEL[m.action] ?? m.action}${m.note ? " · " + m.note : ""}`} />
          <PhotoStrip p={p} ids={m.photoIds} size={64} />
        </View>)}
      </List>
    </Section>
  );
}

// Each platform's login: the account, who holds it, where the password is kept, who gets the code.
function OtaAccountsList({ p, value }: { p: Palette; value: unknown }) {
  const accounts = storedOtaAccountsSchema.parse(value ?? []);
  if (!accounts.length) return null;
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: p.muted, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 1 }}>Platform logins</Text>
      {accounts.map((a, i) => (
        <View key={i} style={{ gap: 3, padding: 10, borderRadius: 12, backgroundColor: p.surface, borderWidth: 1, borderColor: p.border }}>
          <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}><Text style={{ color: p.text, fontWeight: "700" }}>{a.platform}</Text><Tag label={HOLDER_LABEL[a.holder]} tone="plain" p={p} /></View>
          {!!a.login && <Text selectable style={[ui.small, { color: p.text }]}>Login: {a.login}</Text>}
          {!!a.passwordWhere && <Text style={[ui.small, { color: p.text }]}>Password kept in: {a.passwordWhere}</Text>}
          {!!a.twoFactor && <Text style={[ui.small, { color: p.text }]}>Security code goes to: {a.twoFactor}</Text>}
          {!!a.notes && <Text style={[ui.small, { color: p.muted }]}>{a.notes}</Text>}
        </View>
      ))}
    </View>
  );
}

// Staff with the property database or OTA logins tools: entry details and platform logins.
export function PropertyAccess({ palette: p, account, propertyId }: { palette: Palette; account: WorkspaceAccount; propertyId: string }) {
  // Entry instructions, platform logins and finance are separate sections, each with its own permission.
  const sections = [
    ...(account.modules.includes("property-database") ? ["access" as const] : []),
    ...(account.modules.includes("ota-logins") && account.role !== "cleaning_manager" ? ["ota" as const] : []),
    ...(account.modules.includes("owner-statements") ? ["finance" as const] : []),
  ];
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState("");
  if (!sections.length || ["client", "cleans"].includes(account.role)) return null;
  async function show() {
    setOpen(true); setError("");
    const parts = await Promise.allSettled(sections.map(async section => (await (await workspaceRequest("/api/mobile/property-details?" + new URLSearchParams({ propertyId, section }))).json()).data as Record<string, unknown>));
    const loaded = parts.flatMap(part => part.status === "fulfilled" && part.value ? [part.value] : []);
    const failed = parts.find((part): part is PromiseRejectedResult => part.status === "rejected");
    if (loaded.length) setDetails(Object.assign({}, ...loaded));
    if (failed) setError(loaded.length ? "Some details could not be loaded for this property." : message(failed.reason));
  }
  const line = (label: string, value: unknown) => typeof value === "string" && value.trim() ? <View key={label} style={{ gap: 4 }}><Text style={{ color: p.muted, fontSize: 12, fontWeight: "600", textTransform: "uppercase", letterSpacing: 1 }}>{label}</Text><Text selectable style={[ui.body, { color: p.text }]}>{value}</Text></View> : null;
  if (!open) return <MotionPress accessibilityRole="button" onPress={() => void show()} style={[ui.row, { gap: 10, minHeight: 48 }]}><Feather name="key" size={18} color={p.primary} /><Text style={{ color: p.primary, fontWeight: "700", flex: 1 }}>Access and logins</Text><Feather name="chevron-down" size={18} color={p.primary} /></MotionPress>;
  return (
    <View style={[ui.card, { backgroundColor: p.background, borderColor: p.border, gap: 10 }]}>
      <Text style={{ color: p.text, fontWeight: "700" }}>Access and logins</Text>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {!details && !error && <Loading p={p} />}
      {details && <>
        {line("Access instructions", details.accessInstructions)}
        <OtaAccountsList p={p} value={details.otaAccounts} />
        {line(Array.isArray(details.otaAccounts) && details.otaAccounts.length ? "Other login notes" : "Platform logins and notes", details.otaInstructions)}
        {typeof details.managementFeeBps === "number" && <Tag label={`Management fee ${(details.managementFeeBps / 100).toFixed(1)}%`} tone="plain" p={p} />}
        {line("Payment notes", details.paymentNotes)}
        {!(Array.isArray(details.otaAccounts) && details.otaAccounts.length) && !["accessInstructions", "otaInstructions", "paymentNotes"].some(k => typeof details[k] === "string" && String(details[k]).trim()) && typeof details.managementFeeBps !== "number" && <Text style={[ui.small, { color: p.muted }]}>Nothing recorded yet. Admins add these in Management → Properties.</Text>}
      </>}
    </View>
  );
}
