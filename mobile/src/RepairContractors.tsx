import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Linking, Platform, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { z } from "zod";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { Button, dayLabel, Loading, message, Notice, Tag } from "./LiveKit";
import { SearchPicker } from "./SearchPicker";
import { PhotoPicker, PhotoStrip } from "./Photos";
import { OpenMessagesContext } from "./PropertyTeamChat";
import { photoSource, readInbox, readOperations, readRepairContractors, readWorkItem, readWorkMedia, uploadWorkFile } from "./backend/client";
import { icon, radius, ui, type Palette } from "./theme";
import { documentsAllowed } from "../../lib/integration-policy";
import { inboxThreadSchema } from "../../lib/guest-inbox-policy";
import { workItemFrom } from "../../lib/notice-details";
import { formatMoney } from "../../lib/format";
import { operationViewSchema, type PropertyView } from "../../lib/workspace-view";
import {
  assignedContractor, assignedTo, clashWarning, contractorLabel, contractorsSchema, contractorStage, CONTRACTOR_STAGES, guestConversationOf,
  guestSendRoute, quoteFilesOf, visitWindowLabel, type Clash, type Contractor, type ContractorStage,
} from "../../lib/repair-contractors";

// Repairs with contractors: the pieces the repair screens share (lib/repair-contractors.ts has the rules and names).

// The contractors (Ready users with access to the property) a repair can be sent to.
export function useContractors(propertyId: string | null) {
  const [list, setList] = useState<Contractor[] | null>(null), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) { setList(null); setError(""); } });
    if (!propertyId) return () => { active = false; };
    readRepairContractors(propertyId).then(r => { if (active) setList(contractorsSchema.parse(r.data)); }).catch(e => { if (active) { setList([]); setError(message(e)); } });
    return () => { active = false; };
  }, [propertyId]);
  return { list, error };
}

export function ContractorPicker({ p, propertyId, value, onChange, exclude, label = "Contractor" }: { p: Palette; propertyId: string; value: string; onChange: (id: string) => void; exclude?: string | null; label?: string }) {
  const { list, error } = useContractors(propertyId);
  const options = useMemo(() => (list ?? []).filter(c => c.id !== exclude).map(c => ({ id: c.id, label: contractorLabel(c), keywords: c.trade ?? undefined })), [list, exclude]);
  return (
    <View style={{ gap: 8 }} {...(Platform.OS === "web" ? { dataSet: { contractorPicker: propertyId } } : {})}>
      <Text style={{ color: p.text, fontWeight: "700" }}>{label}</Text>
      {list === null ? <Loading p={p} rows={1} />
        : error ? <Notice text={error} p={p} tone="bad" />
        : !options.length ? <Notice text={exclude ? "There is no other contractor for this property." : "No contractor can take repairs at this property yet. An admin gives a Ready user access to it under People."} p={p} />
        : <SearchPicker p={p} options={options} value={value} onChange={onChange} placeholder="Search contractors by name or trade" nouns="contractors" />}
      <Text style={[ui.small, { color: p.muted }]}>Only this contractor sees the job, its photos and its price.</Text>
    </View>
  );
}

// A contractor's quote or invoice: photos (kept on the device and uploaded in the background, like every photo), and a
// PDF where the media store takes them (integration-policy DOCUMENT_PURPOSES).
export function RepairFiles({ p, workId, label, hint, onChange }: { p: Palette; workId: string; label: string; hint: string; onChange: (ids: string[], uploading: boolean) => void }) {
  const [photos, setPhotos] = useState<{ ids: string[]; uploading: boolean }>({ ids: [], uploading: false });
  const [pdfs, setPdfs] = useState<{ id: string; name: string }[]>([]), [sending, setSending] = useState(false), [error, setError] = useState("");
  // The latest callback is kept aside, so a parent re-rendering never triggers another report (as in PhotoPicker).
  const report = useRef(onChange);
  useEffect(() => { report.current = onChange; }, [onChange]);
  useEffect(() => { report.current([...photos.ids, ...pdfs.map(x => x.id)], photos.uploading || sending); }, [photos, pdfs, sending]);
  async function addPdf() {
    setError("");
    const picked = await DocumentPicker.getDocumentAsync({ type: ["application/pdf"], copyToCacheDirectory: true, multiple: false });
    if (picked.canceled || !picked.assets?.length) return;
    const asset = picked.assets[0];
    if (asset.size && asset.size > 8 * 1024 * 1024) { setError("A PDF can be up to 8 MB."); return; }
    setSending(true);
    try {
      const result = z.object({ id: z.string().uuid() }).parse(await uploadWorkFile({ requestId: Crypto.randomUUID(), workId, purpose: "maintenance" }, { uri: asset.uri, name: asset.name, file: (asset as { file?: File }).file }));
      setPdfs(list => [...list, { id: result.id, name: asset.name }]);
    } catch (e) { setError(message(e)); } finally { setSending(false); }
  }
  return (
    <View style={{ gap: 8 }}>
      <PhotoPicker p={p} workId={workId} purpose="maintenance" label={label} hint={hint} max={10} onChange={(ids, uploading) => setPhotos({ ids, uploading })} />
      {documentsAllowed("maintenance") && <>
        {pdfs.map(x => <FileChip key={x.id} p={p} name={x.name} />)}
        <Button label={sending ? "Adding the PDF…" : "Add a PDF"} icon="file-text" p={p} disabled={sending} onPress={() => void addPdf()} />
      </>}
      {!!error && <Notice text={error} p={p} tone="bad" />}
    </View>
  );
}

function FileChip({ p, name, onOpen }: { p: Palette; name: string; onOpen?: () => void }) {
  const body = <><Feather name="file-text" size={icon.row} color={p.primary} /><Text numberOfLines={1} style={[ui.small, { color: onOpen ? p.primary : p.text, fontWeight: "600", flexShrink: 1 }]}>{name}</Text></>;
  const style = [ui.row, { gap: 6, alignSelf: "flex-start" as const, maxWidth: "100%" as const, minHeight: 40, paddingHorizontal: 12, borderRadius: radius.control, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface }];
  return onOpen ? <MotionPress accessibilityRole="link" accessibilityLabel={`Open ${name}`} onPress={onOpen} style={style}>{body}</MotionPress> : <View style={style}>{body}</View>;
}

// Saved quote or invoice files on a repair: photos in a strip, a PDF as a chip that opens it.
const mediaSchema = z.array(z.object({ id: z.string().uuid(), format: z.string().optional() }).passthrough());
export function RepairFileList({ p, workId, ids, title }: { p: Palette; workId: string; ids: string[]; title: string }) {
  const [formats, setFormats] = useState<Map<string, string>>(new Map()), [error, setError] = useState("");
  const key = ids.join();
  useEffect(() => {
    let active = true;
    if (key) readWorkMedia(workId).then(r => { const parsed = mediaSchema.safeParse(r.data); if (active && parsed.success) setFormats(new Map(parsed.data.map(x => [x.id, x.format ?? "jpg"]))); }).catch(() => undefined);
    return () => { active = false; };
  }, [workId, key]);
  if (!ids.length) return null;
  const pdfs = ids.filter(id => formats.get(id) === "pdf"), images = ids.filter(id => formats.get(id) !== "pdf");
  async function open(id: string) {
    setError("");
    try {
      const source = await photoSource(id);
      // In the browser the session goes with the link. The phone app cannot hand its sign-in to another app, so it says so.
      if (Platform.OS === "web" || !source.headers) await Linking.openURL(source.uri);
      else setError("Open this PDF on the web app for now.");
    } catch (e) { setError(message(e)); }
  }
  return (
    <View style={{ gap: 6 }}>
      <Text style={[ui.small, { color: p.muted, fontWeight: "700" }]}>{title}</Text>
      {!!images.length && <PhotoStrip p={p} ids={images} />}
      {pdfs.map((id, i) => <FileChip key={id} p={p} name={pdfs.length > 1 ? `${title} ${i + 1} (PDF)` : `${title} (PDF)`} onOpen={() => void open(id)} />)}
      {!!error && <Notice text={error} p={p} tone="bad" />}
    </View>
  );
}

// The visit as booked, and any guest stays around it.
export function VisitDetails({ p, data }: { p: Palette; data: Record<string, unknown> }) {
  const window = visitWindowLabel(data.visitFrom, data.visitTo);
  if (typeof data.repairOn !== "string") return null;
  return (
    <View style={{ gap: 2 }}>
      <Text style={[ui.small, { color: p.muted, fontWeight: "600" }]}>Visit</Text>
      <Text style={{ color: p.text, fontSize: 14 }}>{dayLabel(data.repairOn)}{window ? `, ${window}` : ""}</Text>
    </View>
  );
}

export function ClashNotice({ p, clashes, forContractor = true }: { p: Palette; clashes: readonly Clash[]; forContractor?: boolean }) {
  const warning = clashWarning(clashes, forContractor);
  if (!warning) return null;
  return (
    <View accessibilityRole="alert" {...(Platform.OS === "web" ? { dataSet: { clashNotice: String(clashes.length) } } : {})} style={{ gap: 6, padding: 12, borderRadius: radius.control, backgroundColor: p.cautionWash }}>
      <View style={[ui.row, { gap: 8 }]}><Feather name="alert-triangle" size={icon.row} color={p.text} /><Text style={{ color: p.text, fontWeight: "700", flex: 1 }}>{warning}</Text></View>
      {clashes.map((c, i) => <Text key={i} style={[ui.small, { color: p.text }]}>{c.label}{c.checkIn ? ` (${dayLabel(c.checkIn)}${c.checkOut ? " to " + dayLabel(c.checkOut) : ""})` : ""}</Text>)}
    </View>
  );
}

// Can a message reach the guest from Recharge in this conversation (the guest inbox's own Send)? null while it is checked.
export function useGuestSend(threadId: string | null): "send" | "none" | null {
  const [route, setRoute] = useState<"send" | "none" | null>(null);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) setRoute(null); });
    if (!threadId) return () => { active = false; };
    readInbox({ section: "thread", threadId }).then(r => { const parsed = inboxThreadSchema.safeParse(r.data); if (active) setRoute(parsed.success ? guestSendRoute(parsed.data) : "none"); })
      .catch(() => { if (active) setRoute("none"); });
    return () => { active = false; };
  }, [threadId]);
  return route;
}

// Back to the guest conversation a repair came from (Messages → Guests). Only for the team who talk to guests.
export function GuestChatLink({ p, data }: { p: Palette; data: Record<string, unknown> }) {
  const open = useContext(OpenMessagesContext), id = guestConversationOf(data);
  if (!id || !open) return null;
  return <Button label="Open the guest chat" icon="message-square" p={p} onPress={() => open("guest:" + id)} />;
}

// Who has the job, on the repair and on Management's approval.
export function ContractorLine({ p, data }: { p: Palette; data: Record<string, unknown> }) {
  const who = assignedContractor(data);
  if (!who) return null;
  return <View style={[ui.row, { gap: 8 }]}><Feather name="tool" size={icon.row} color={p.muted} /><Text style={{ color: p.text, fontSize: 14 }}>Contractor: <Text style={{ fontWeight: "600" }}>{who.name}</Text></Text></View>;
}

// Management approving a contractor's estimate: who sent it and the quote they attached (read from the repair itself,
// so the management queue needs no change).
export function ApprovalContractor({ p, workId, version }: { p: Palette; workId: string; version: number }) {
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    let active = true;
    readWorkItem(workId).then(r => { const item = workItemFrom(r.data, workId); if (active && item) setData(item.data); }).catch(() => undefined);
    return () => { active = false; };
  }, [workId, version]);
  if (!data) return null;
  const quote = quoteFilesOf(data);
  if (!assignedContractor(data) && !quote.length) return null;
  return (
    <View style={{ gap: 8 }} {...(Platform.OS === "web" ? { dataSet: { approvalContractor: workId } } : {})}>
      <ContractorLine p={p} data={data} />
      <RepairFileList p={p} workId={workId} ids={quote} title="Contractor's quote" />
    </View>
  );
}

// A contractor's Home: their jobs by what they do next. Only jobs given to them are counted.
type Job = z.infer<typeof operationViewSchema>;
export function ContractorJobs({ p, userId, properties, onOpen }: { p: Palette; userId: string; properties?: PropertyView[]; onOpen: (workId: string) => void }) {
  const [jobs, setJobs] = useState<Job[] | null>(null), [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    queueMicrotask(() => void readOperations().then(r => { if (active) setJobs(z.array(operationViewSchema).parse(r.data).filter(op => op.kind === "maintenance" && assignedTo(op.data, userId) && !!assignedContractor(op.data))); }).catch(e => { if (active) setError(message(e)); }));
    return () => { active = false; };
  }, [userId]);
  const name = (id: string) => properties?.find(x => x.id === id)?.name ?? "Property";
  const groups = CONTRACTOR_STAGES.filter(s => s.stage !== "done").map(s => ({ ...s, jobs: (jobs ?? []).filter(j => contractorStage(j.data) === s.stage) })).filter(g => g.jobs.length);
  const tone: Record<ContractorStage, "good" | "wait" | "bad" | "plain"> = { estimate: "wait", waiting: "plain", book: "good", booked: "plain", declined: "bad", done: "good" };
  return (
    <View style={{ gap: 10 }} {...(Platform.OS === "web" ? { dataSet: { contractorJobs: "home" } } : {})}>
      <Text accessibilityRole="header" style={[ui.sectionTitle, { color: p.text }]}>Jobs for you</Text>
      {!jobs && !error && <Loading p={p} rows={2} />}
      {!!error && <Notice text={error} p={p} tone="bad" />}
      {jobs && !groups.length && <Text style={[ui.small, { color: p.muted }]}>No jobs waiting for you. New jobs from Recharge show here.</Text>}
      {groups.map(g => (
        <View key={g.stage} style={{ gap: 6 }}>
          <Text style={[ui.small, { color: p.muted, fontWeight: "700" }]}>{g.label} · {g.jobs.length}</Text>
          <View style={{ borderRadius: radius.tile, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface, overflow: "hidden" }}>
            {g.jobs.map((j, i) => {
              const issue = typeof j.data.issue === "string" && j.data.issue ? j.data.issue : j.title;
              const when = g.stage === "booked" && typeof j.data.repairOn === "string" ? `${dayLabel(j.data.repairOn)}${visitWindowLabel(j.data.visitFrom, j.data.visitTo) ? ", " + visitWindowLabel(j.data.visitFrom, j.data.visitTo) : ""}`
                : typeof j.data.estimatedCostMinor === "number" && j.data.estimatedCostMinor > 0 && g.stage !== "estimate" ? `Your estimate ${formatMoney(j.data.estimatedCostMinor)}` : g.detail;
              return (
                <MotionPress key={j.workId} accessibilityRole="button" accessibilityLabel={`${name(j.propertyId)}: ${issue}. ${g.label}`} onPress={() => onOpen(j.workId)}
                  style={[ui.row, { gap: 10, minHeight: 56, paddingVertical: 8, paddingHorizontal: 12, borderTopWidth: i ? 1 : 0, borderColor: p.border }]}>
                  <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                    <Text numberOfLines={1} style={{ color: p.text, fontSize: 14 }}><Text style={{ fontWeight: "600" }}>{name(j.propertyId)}</Text>{` · ${issue}`}</Text>
                    <Text numberOfLines={1} style={[ui.small, { color: p.muted }]}>{when}</Text>
                  </View>
                  {j.data.urgent === true && <Tag label="Urgent" tone="bad" p={p} />}
                  <Tag label={g.label} tone={tone[g.stage]} p={p} />
                  <Feather name="chevron-right" size={icon.row} color={p.muted} />
                </MotionPress>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

