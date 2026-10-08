import { useEffect, useState, type ReactNode } from "react";
import { View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Linking from "expo-linking";
import { Text } from "./Typography";
import { MotionPress, Stagger } from "./motion";
import { ui, type Palette } from "./theme";
import { IconChip, Loading, Notice, Tag, london, message, type IconName, type Tone } from "./LiveKit";
import { workspaceRequest } from "./backend/client";
import type { WorkspaceAccount } from "../../lib/workspace-account-policy";
import type { JourneyView } from "../../lib/workflow-forms";
import { plural } from "../../lib/format";
import { listingLinks, maskAccount, ownersSchema, payoutSchema, profileAccess, reservationsSchema, setupAnswers, stayLines, type Answer, type ListingLink, type Owner, type StayLine } from "../../lib/property-profile";

// Everything about one property in one place: who owns it, where it is listed, who is staying,
// what the owner told us at set-up, and (on request) where the payouts go.
const read = async (path: string) => (await (await workspaceRequest(path)).json()).data as unknown;

function Panel({ p, icon, tone, title, detail, children }: { p: Palette; icon: IconName; tone: Tone; title: string; detail?: string; children: ReactNode }) {
  return (
    <View style={[ui.card, { backgroundColor: p.background, borderColor: p.border, gap: 12 }]}>
      <View style={[ui.row, { gap: 12 }]}>
        <IconChip icon={icon} tone={tone} p={p} size={36} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text accessibilityRole="header" style={{ color: p.text, fontSize: 16, fontWeight: "700" }}>{title}</Text>
          {!!detail && <Text style={[ui.small, { color: p.muted }]}>{detail}</Text>}
        </View>
      </View>
      {children}
    </View>
  );
}

function Pair({ p, label, value, first }: { p: Palette; label: string; value: string; first?: boolean }) {
  return (
    <View style={{ gap: 2, paddingTop: first ? 0 : 10, borderTopWidth: first ? 0 : 1, borderColor: p.border }}>
      <Text style={{ color: p.muted, fontSize: 12, fontWeight: "600", letterSpacing: 0.6, textTransform: "uppercase" }}>{label}</Text>
      <Text selectable style={[ui.body, { color: p.text }]}>{value}</Text>
    </View>
  );
}

const GROUPS: [Answer["group"], string][] = [["owner", "Owner"], ["ready", "Getting ready to go live"], ["repairs", "Repairs"], ["setup", "Post, furnishing and licensing"]];
function SetupAnswers({ p, answers }: { p: Palette; answers: Answer[] }) {
  return (
    <View style={{ gap: 22 }}>{GROUPS.map(([group, label]) => {
      const rows = answers.filter(a => a.group === group);
      return rows.length ? <View key={group} style={{ gap: 10 }}>
        <Text style={{ color: p.primary, fontSize: 13, fontWeight: "700" }}>{label}</Text>
        {rows.map((a, i) => <Pair key={a.label} p={p} label={a.label} value={a.value} first={i === 0} />)}
      </View> : null;
    })}</View>
  );
}

function StayRow({ p, stay, first }: { p: Palette; stay: StayLine; first: boolean }) {
  const tone = stay.when === "now" ? "good" : stay.when === "upcoming" ? "wait" : "plain";
  return (
    <View style={[ui.between, { gap: 12, paddingTop: first ? 0 : 10, borderTopWidth: first ? 0 : 1, borderColor: p.border }]}>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Text style={{ color: p.text, fontWeight: "600", fontVariant: ["tabular-nums"] }}>{stay.dates}</Text>
        <Text numberOfLines={2} style={[ui.small, { color: p.muted }]}>{plural(stay.nights, "night")} · {stay.reference} · {stay.source}{stay.status === "enquiry" ? " · Enquiry" : ""}</Text>
      </View>
      <Tag label={stay.when === "now" ? "Staying now" : stay.when === "upcoming" ? "Upcoming" : "Past"} tone={tone} p={p} />
    </View>
  );
}

function Payout({ p, propertyId, own }: { p: Palette; propertyId: string; own: boolean }) {
  const [state, setState] = useState<"closed" | "loading" | "open">("closed"), [full, setFull] = useState(false), [error, setError] = useState("");
  const [payout, setPayout] = useState<{ bankAccountName?: string | null; bankAccountNumber?: string | null; bankSortCode?: string | null }>({});
  async function show() {
    setState("loading"); setError("");
    try { const parsed = payoutSchema.safeParse(await read("/api/mobile/portfolio?" + new URLSearchParams({ section: "onboardingPayout", propertyId }))); setPayout(parsed.success ? parsed.data : {}); setState("open"); }
    catch (e) { setError(message(e)); setState("closed"); }
  }
  const number = payout.bankAccountNumber ?? "";
  return (
    <Panel p={p} icon="credit-card" tone="accounts" title="Payout details" detail={(own ? "Where your earnings are paid." : "Where the owner's earnings are paid.") + " Shown only when asked for."}>
      {state === "closed" && <MotionPress accessibilityRole="button" onPress={() => void show()} style={[ui.row, { gap: 8, minHeight: 44 }]}><Feather name="eye" size={17} color={p.primary} /><Text style={{ color: p.primary, fontWeight: "700" }}>Show payout details</Text></MotionPress>}
      {state === "loading" && <Loading p={p} rows={2} />}
      {state === "open" && (payout.bankAccountName || number || payout.bankSortCode ? <View style={{ gap: 10 }}>
        {!!payout.bankAccountName && <Pair p={p} label="Account holder" value={payout.bankAccountName} first />}
        {!!payout.bankSortCode && <Pair p={p} label="Sort code" value={payout.bankSortCode} first={!payout.bankAccountName} />}
        {!!number && <View style={[ui.between, { gap: 12, paddingTop: 10, borderTopWidth: 1, borderColor: p.border }]}>
          <View style={{ gap: 2 }}><Text style={{ color: p.muted, fontSize: 12, fontWeight: "600", letterSpacing: 0.6, textTransform: "uppercase" }}>Account number</Text><Text selectable style={[ui.body, { color: p.text, fontVariant: ["tabular-nums"] }]}>{full ? number : maskAccount(number)}</Text></View>
          <MotionPress accessibilityRole="button" onPress={() => setFull(!full)} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 8 }}><Text style={{ color: p.primary, fontWeight: "700" }}>{full ? "Hide" : "Show all"}</Text></MotionPress>
        </View>}
        <MotionPress accessibilityRole="button" onPress={() => { setState("closed"); setPayout({}); setFull(false); }} style={{ alignSelf: "flex-start", minHeight: 40, justifyContent: "center" }}><Text style={{ color: p.muted, fontWeight: "600" }}>Hide payout details</Text></MotionPress>
      </View> : <Text style={[ui.small, { color: p.muted }]}>No payout details yet. {own ? "You add them" : "The owner adds them"} in the property set-up form.</Text>)}
      {!!error && <Notice text={error} p={p} tone="bad" />}
    </Panel>
  );
}

export function PropertyProfile({ palette: p, account, propertyId, journey }: { palette: Palette; account: WorkspaceAccount; propertyId: string; journey?: JourneyView }) {
  const access = profileAccess(account);
  const [owners, setOwners] = useState<Owner[] | null>(null), [links, setLinks] = useState<ListingLink[] | null>(null), [stays, setStays] = useState<StayLine[] | null>(null);
  const [failed, setFailed] = useState<string[]>([]), [linkError, setLinkError] = useState("");
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) { setOwners(null); setLinks(null); setStays(null); setFailed([]); } });
    const jobs: [string, () => Promise<void>][] = [];
    if (access.owners) jobs.push(["owner details", async () => { const parsed = ownersSchema.safeParse(await read("/api/mobile/property-details?" + new URLSearchParams({ propertyId, section: "owner" }))); if (active) setOwners(parsed.success ? parsed.data.owners : []); }]);
    if (access.listings) jobs.push(["listing links", async () => { const data = await read("/api/mobile/portfolio?" + new URLSearchParams({ section: "portfolio", propertyId })); if (active) setLinks(listingLinks(data, propertyId)); }]);
    if (access.stays) jobs.push(["stays", async () => { const parsed = reservationsSchema.safeParse(await read("/api/mobile/portfolio?" + new URLSearchParams({ section: "reservations", propertyId }))); if (active) setStays(stayLines(parsed.success ? parsed.data : [], london(new Date()))); }]);
    void Promise.allSettled(jobs.map(([, job]) => job())).then(results => { if (active) setFailed(jobs.filter((_, i) => results[i].status === "rejected").map(([name]) => name)); });
    return () => { active = false; };
  }, [propertyId, access.owners, access.listings, access.stays]);

  const answers = setupAnswers(journey?.form);
  const panels: ReactNode[] = [];
  if (access.owners) panels.push(
    <Panel key="owner" p={p} icon="user" tone="clients" title={owners && owners.length > 1 ? "Owners" : "Owner"}>
      {owners === null ? (failed.includes("owner details") ? <Text style={[ui.small, { color: p.muted }]}>Owner details could not be loaded.</Text> : <Loading p={p} rows={1} />)
        : owners.length ? owners.map((o, i) => (
          <View key={o.email + i} style={[ui.between, { gap: 12, paddingTop: i ? 10 : 0, borderTopWidth: i ? 1 : 0, borderColor: p.border }]}>
            <View style={{ flex: 1, minWidth: 0, gap: 2 }}><Text style={{ color: p.text, fontWeight: "600" }}>{o.name || "Name not given"}</Text>{!!o.email && <Text selectable numberOfLines={1} style={[ui.small, { color: p.muted }]}>{o.email}</Text>}</View>
            {!!o.email && <MotionPress accessibilityRole="link" accessibilityLabel={"Email " + (o.name || o.email)} onPress={() => void Linking.openURL("mailto:" + o.email).catch(() => undefined)} style={{ width: 44, height: 44, alignItems: "center", justifyContent: "center" }}><Feather name="mail" size={18} color={p.primary} /></MotionPress>}
          </View>
        )) : <Text style={[ui.small, { color: p.muted }]}>No owner is linked yet. Admins link owners in Management → Properties.</Text>}
    </Panel>);
  if (access.listings) panels.push(
    <Panel key="listings" p={p} icon="globe" tone="stays" title="Listings" detail="Where guests book this property.">
      {links === null ? (failed.includes("listing links") ? <Text style={[ui.small, { color: p.muted }]}>Listing links could not be loaded.</Text> : <Loading p={p} rows={1} />)
        : links.length ? links.map((l, i) => (
          <MotionPress key={l.url} accessibilityRole="link" onPress={() => void Linking.openURL(l.url).catch(() => setLinkError("The listing could not be opened."))} style={[ui.between, { gap: 12, minHeight: 44, paddingTop: i ? 10 : 0, borderTopWidth: i ? 1 : 0, borderColor: p.border }]}>
            <View style={{ flex: 1, minWidth: 0 }}><Text style={{ color: p.text, fontWeight: "600" }}>{l.platform}</Text><Text numberOfLines={1} style={[ui.small, { color: p.muted }]}>{new URL(l.url).host}</Text></View>
            <Feather name="external-link" size={17} color={p.primary} />
          </MotionPress>
        )) : <Text style={[ui.small, { color: p.muted }]}>No live listings recorded yet. They are added when the property goes live.</Text>}
      {!!linkError && <Notice text={linkError} p={p} tone="bad" />}
    </Panel>);
  if (access.stays) panels.push(
    <Panel key="stays" p={p} icon="calendar" tone="stays" title="Stays" detail="Guests staying now, coming up, and recently.">
      {stays === null ? (failed.includes("stays") ? <Text style={[ui.small, { color: p.muted }]}>Stays could not be loaded.</Text> : <Loading p={p} rows={2} />)
        : stays.length ? stays.map((s, i) => <StayRow key={s.id} p={p} stay={s} first={i === 0} />)
        : <Text style={[ui.small, { color: p.muted }]}>No stays recorded for this property yet.</Text>}
    </Panel>);
  if (answers.length) panels.push(
    <Panel key="setup" p={p} icon="clipboard" tone="ready" title="Property set-up" detail={account.role === "client" ? "What you told us in the set-up form." : "What the owner told us in the set-up form."}>
      <SetupAnswers p={p} answers={answers} />
    </Panel>);
  if (access.payout) panels.push(<Payout key="payout" p={p} propertyId={propertyId} own={account.role === "client"} />);
  return panels.length ? <View style={{ gap: 12 }}>{panels.map((panel, i) => <Stagger key={i} index={i}>{panel}</Stagger>)}</View> : null;
}
