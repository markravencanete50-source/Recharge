import { useCallback, useEffect, useState } from "react";
import { Image, Linking, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { Button, Field, Loading, Notice, Tag, message, useRequestId } from "./LiveKit";
import { Sheet } from "./TeamFlows";
import { DateField } from "./CalendarPicker";
import { liveApi } from "./LivePages";
import { listingPhotoLink, uploadListingPhoto } from "./backend/client";
import { ui, type Palette } from "./theme";
import { formatMoney } from "../../lib/format";
import {
  DEFAULT_LISTING_SETTINGS, DESCRIPTION_PLACEHOLDERS, FIELD_LABEL, LISTING_LIMITS, STATUS_LABEL, listingActionSchema, listingMissing, listingSettingsSchema, listingViewSchema,
  type ListingFields, type ListingPhoto, type ListingSettings, type ListingView,
} from "../../lib/hostaway-listing";

// The property's listing in Hostaway (migration 20261028200000), on the lead once the property is guest ready, as in the
// Business Plan's Launch Preparation. The team books the photography (the owner is told) and adds the photos; once they are
// in, the stays team checks the listing onboarding filled in; the Property Performance Manager (admins, and whoever they
// name) approves it and the app creates the listing in Hostaway. Admins set the starting wording and the approvers on the
// Leads page, where approvers also find the listings waiting for them.
const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const pounds = (minor: number) => (minor / 100).toFixed(2);
const toMinor = (v: string) => { const n = Number(v.replace(/[£,\s]/g, "")); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null; };
const toWhole = (v: string) => { const n = Number(v.trim()); return Number.isInteger(n) ? n : null; };
const hourLabel = (h: number) => `${String(h).padStart(2, "0")}:00`;
const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date(iso + "T12:00:00Z"));
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());

async function readListing(propertyId?: string) {
  return listingViewSchema.parse((await liveApi("/listing" + (propertyId ? "?propertyId=" + encodeURIComponent(propertyId) : ""))).data);
}

// Text kept as typed while numbers are being edited, so "1." or "" don't jump about.
type Draft = { fields: ListingFields; numbers: Partial<Record<keyof ListingFields, string>>; photos: ListingPhoto[] };
const TEXT_KEYS = ["name", "externalName", "address", "propertyType", "description", "houseRules", "wifiName", "wifiPassword", "accessCode", "checkInInstructions"] as const;
const COUNT_KEYS = ["bedrooms", "bathrooms", "beds", "guests", "minNights", "checkInFrom", "checkInTo", "checkOut"] as const;
const MONEY_KEYS = ["nightlyMinor", "cleaningFeeMinor"] as const;
const MULTILINE = new Set(["description", "houseRules", "checkInInstructions", "address"]);
const TEXT_MAX: Record<(typeof TEXT_KEYS)[number], number> = { name: 200, externalName: 100, address: 1000, propertyType: 120, description: 5000, houseRules: 5000, wifiName: 200, wifiPassword: 200, accessCode: 200, checkInInstructions: 3000 };

function PhotoTile({ p, propertyId, photo, index, total, edit, removable, onCaption, onMove, onRemove }: { p: Palette; propertyId: string; photo: ListingPhoto; index: number; total: number; edit: boolean; removable: boolean;
  onCaption: (v: string) => void; onMove: (by: -1 | 1) => void; onRemove: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { let active = true; listingPhotoLink(propertyId, photo.id).then(l => { if (active) setUrl(l.url); }, () => undefined); return () => { active = false; }; }, [propertyId, photo.id]);
  return <View style={{ width: 200, gap: 6, padding: 8, borderRadius: 12, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface }}>
    {url ? <Image accessibilityLabel={photo.caption || photo.name} source={{ uri: url }} style={{ width: "100%", height: 120, borderRadius: 8, backgroundColor: p.wash }} resizeMode="cover" />
      : <View style={{ height: 120, borderRadius: 8, backgroundColor: p.wash }} />}
    <Text numberOfLines={1} style={[ui.small, { color: p.muted }]}>{`${index + 1}. ${photo.name}${photo.sent ? " (in Hostaway)" : ""}`}</Text>
    {edit ? <Field p={p} label="Caption" value={photo.caption} onChange={v => onCaption(v.slice(0, 300))} /> : !!photo.caption && <Text style={{ color: p.text, fontSize: 13 }}>{photo.caption}</Text>}
    {(edit || removable) && <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>
      {edit && <Button p={p} quiet icon="arrow-left" label="Earlier" disabled={index === 0} onPress={() => onMove(-1)} />}
      {edit && <Button p={p} quiet icon="arrow-right" label="Later" disabled={index === total - 1} onPress={() => onMove(1)} />}
      {removable && <Button p={p} quiet icon="trash-2" label="Remove" onPress={onRemove} />}
    </View>}
    {!!url && <Button p={p} quiet icon="external-link" label="Open" onPress={() => void Linking.openURL(url)} />}
  </View>;
}

export function ListingPanel({ p, propertyId }: { p: Palette; propertyId: string }) {
  const [view, setView] = useState<ListingView | null>(null), [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState(""), [note, setNote] = useState(""), [busy, setBusy] = useState(false), [open, setOpen] = useState(false), [dirty, setDirty] = useState(false);
  const [shootOn, setShootOn] = useState(""), [photographer, setPhotographer] = useState("");
  const request = useRequestId("listing:" + propertyId);
  const fill = (v: ListingView) => {
    setView(v); setDirty(false);
    if (v.listing) {
      setDraft({ fields: v.listing.fields, numbers: {}, photos: v.listing.photos });
      setShootOn(v.listing.photography.bookedOn ?? ""); setPhotographer(v.listing.photography.photographer);
    }
  };
  const load = useCallback(async () => { try { fill(await readListing(propertyId)); setError(""); } catch (e) { setError(message(e)); } }, [propertyId]);
  useEffect(() => { let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [load]);
  if (!view?.listing || !draft) return error ? <Notice p={p} tone="bad" text={error} /> : null;
  const l = view.listing, edit = l.canEdit, shoot = l.photography, addable = shoot.canAddPhotos;
  const setField = <K extends keyof ListingFields>(k: K, v: ListingFields[K]) => { setNote(""); setDirty(true); setDraft(d => d ? { ...d, fields: { ...d.fields, [k]: v } } : d); };
  const setNumber = (k: keyof ListingFields, raw: string, money: boolean) => {
    setNote(""); setDirty(true);
    const n = money ? toMinor(raw) : toWhole(raw);
    setDraft(d => d ? { ...d, numbers: { ...d.numbers, [k]: raw }, fields: n === null ? d.fields : { ...d.fields, [k]: n } } : d);
  };
  const setPhotos = (photos: ListingPhoto[]) => { setNote(""); setDirty(true); setDraft(d => d ? { ...d, photos } : d); };
  const missing = listingMissing(draft.fields, draft.photos.length);
  async function act(body: Record<string, unknown>, done: string) {
    if (busy) return;
    const key = JSON.stringify(body);
    const parsed = listingActionSchema.safeParse({ ...body, requestId: request.get(key), propertyId });
    if (!parsed.success) { setError(parsed.error.issues.map(i => i.path[0] === "fields" ? `${FIELD_LABEL[i.path[1] as keyof ListingFields] ?? "Listing"}: ${i.message}` : i.path[0] === "date" ? "Choose the photography date" : i.message)[0] ?? "Check the listing"); return; }
    setBusy(true); setError("");
    try {
      const out = await liveApi("/listing", parsed.data) as { data?: unknown; note?: string };
      request.done(key);
      if (out.data) fill(listingViewSchema.parse(out.data)); else await load();
      setNote(out.note ?? done);
    } catch (e) { setError(message(e)); await load().catch(() => undefined); } finally { setBusy(false); }
  }
  const save = () => {
    const bad = [...COUNT_KEYS, ...MONEY_KEYS].find(k => draft.numbers[k] !== undefined && (MONEY_KEYS.includes(k as never) ? toMinor(draft.numbers[k]!) : toWhole(draft.numbers[k]!)) === null);
    if (bad) { setError(`${FIELD_LABEL[bad]}: enter a number`); return; }
    return act({ action: "saveDraft", fields: draft.fields, photos: draft.photos.map(x => ({ id: x.id, caption: x.caption })) }, "Saved.");
  };
  async function addPhotos() {
    const picked = await DocumentPicker.getDocumentAsync({ type: ["image/jpeg", "image/png", "image/webp"], copyToCacheDirectory: true, multiple: true });
    if (picked.canceled || !picked.assets?.length) return;
    setBusy(true); setError("");
    let added = 0;
    try {
      for (const asset of picked.assets.slice(0, LISTING_LIMITS.photos - draft!.photos.length)) {
        const out = listingViewSchema.parse(await uploadListingPhoto(propertyId, { uri: asset.uri, name: asset.name, mimeType: asset.mimeType, file: (asset as { file?: File }).file }));
        added++;
        // Keep what is being typed; take the new photo list.
        if (out.listing) { const fresh = out.listing.photos; setDraft(d => d ? { ...d, photos: [...d.photos, ...fresh.filter(f => !d.photos.some(x => x.id === f.id))] } : d); setView(out); }
      }
      setNote(`${added} ${added === 1 ? "photo" : "photos"} added.${dirty ? " Save to keep your other changes." : ""}`);
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  const field = (k: keyof ListingFields) => {
    if ((TEXT_KEYS as readonly string[]).includes(k)) {
      const key = k as (typeof TEXT_KEYS)[number];
      return edit ? <Field key={k} p={p} multiline={MULTILINE.has(k)} label={FIELD_LABEL[k]} value={draft.fields[key]} onChange={v => setField(key, v.slice(0, TEXT_MAX[key]))} />
        : <View key={k} style={{ gap: 2 }}><Text style={[ui.small, { color: p.muted }]}>{FIELD_LABEL[k]}</Text><Text selectable style={{ color: p.text, fontSize: 14 }}>{draft.fields[key] || "None"}</Text></View>;
    }
    const money = (MONEY_KEYS as readonly string[]).includes(k), hour = k.startsWith("check");
    const value = draft.numbers[k] ?? (money ? pounds(draft.fields[k] as number) : String(draft.fields[k]));
    const label = FIELD_LABEL[k] + (money ? " (£)" : hour ? " (hour, 0 to 23)" : "");
    return edit ? <View key={k} style={{ flexBasis: 150, flexGrow: 1 }}><Field p={p} label={label} value={value} onChange={v => setNumber(k, v.slice(0, 12), money)} /></View>
      : <Text key={k} style={{ color: p.text, fontSize: 14 }}>{`${FIELD_LABEL[k]}: ${money ? formatMoney(draft.fields[k] as number) : hour ? hourLabel(draft.fields[k] as number) : draft.fields[k]}`}</Text>;
  };
  const move = (i: number, by: -1 | 1) => { const next = [...draft.photos]; const [x] = next.splice(i, 1); next.splice(i + by, 0, x); setPhotos(next); };
  const tone = l.status === "published" ? "good" : l.status === "failed" ? "bad" : "wait";
  return <View style={[ui.card, { backgroundColor: p.surface, borderColor: p.border, padding: 14, gap: 10 }]}>
    <View style={[ui.between, { gap: 8 }]}>
      <Text accessibilityRole="header" style={{ color: p.text, fontSize: 16, fontWeight: "700" }}>Listing in Hostaway</Text>
      <Tag p={p} label={l.linkedElsewhere ? "Linked to Hostaway" : STATUS_LABEL[l.status]} tone={l.linkedElsewhere ? "good" : tone} />
    </View>
    <Text style={[ui.small, { color: p.muted }]}>
      {l.linkedElsewhere ? `This property is already linked to Hostaway listing ${l.hostawayListingId}. Change the listing in Hostaway.`
        : l.publishedAt ? `Sent to Hostaway ${when(l.publishedAt)}${l.publishedByName ? ` by ${l.publishedByName}` : ""} (listing ${l.hostawayListingId}). Connect it to the channels in Hostaway.`
        : l.locked ? l.locked + " It is filled in from onboarding in the meantime."
        : l.saved ? "Check every part and the photos. The Property Performance Manager then approves it and it is created in Hostaway."
        : "Filled in from onboarding. Check every part, order and caption the photos, and save. The Property Performance Manager then approves it and it is created in Hostaway."}
    </Text>
    {!l.linkedElsewhere && (shoot.canBook || shoot.bookedOn) && <View style={{ gap: 8, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: p.border }}>
      <View style={[ui.between, { gap: 8 }]}>
        <Text accessibilityRole="header" style={{ color: p.text, fontWeight: "700" }}>Photography</Text>
        <Tag p={p} label={shoot.receivedAt ? "Photos in" : shoot.bookedOn ? "Booked" : "To book"} tone={shoot.receivedAt ? "good" : "wait"} />
      </View>
      {shoot.bookedOn && <Text style={{ color: p.text, fontSize: 14 }}>{`Booked for ${day(shoot.bookedOn)}${shoot.photographer ? ` with ${shoot.photographer}` : ""}${shoot.bookedByName ? ` (by ${shoot.bookedByName})` : ""}.`}</Text>}
      {shoot.receivedAt && <Text style={[ui.small, { color: p.muted }]}>{`Photos received ${when(shoot.receivedAt)}${shoot.receivedByName ? ` by ${shoot.receivedByName}` : ""}.`}</Text>}
      {shoot.canBook && <View style={{ gap: 8 }}>
        <DateField p={p} label="Photography date" mode="single" wholeMonthLink={false} empty="Choose a date" today={today()} value={{ from: shootOn, to: shootOn }} onChange={next => setShootOn(next.from)} />
        <Field p={p} label="Photographer (optional)" value={photographer} onChange={v => setPhotographer(v.slice(0, 200))} />
        <Button p={p} icon="camera" label={shoot.bookedOn ? "Change the booking" : "Book the photography"} disabled={busy || !shootOn}
          onPress={() => void act({ action: "bookPhotography", date: shootOn, photographer }, "Booked. The owner has been told in their property chat.")} />
      </View>}
      {!shoot.receivedAt && shoot.bookedOn && <Text style={[ui.small, { color: p.muted }]}>Add the photographer's photos below, then mark them received. The listing opens once they are in.</Text>}
    </View>}
    {!!l.lastError && <Notice p={p} tone="bad" text={l.lastError} />}
    {!l.linkedElsewhere && <Button p={p} icon={open ? "chevron-up" : "edit-3"} label={open ? "Close the listing" : edit ? "Check and edit the listing" : addable ? "Add the photos" : "See the listing"} onPress={() => setOpen(o => !o)} />}
    {open && !l.linkedElsewhere && <View style={{ gap: 12 }}>
      {(["name", "externalName", "propertyType", "address", "description"] as const).map(field)}
      <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>{(["bedrooms", "bathrooms", "beds", "guests", "nightlyMinor", "cleaningFeeMinor", "minNights", "checkInFrom", "checkInTo", "checkOut"] as const).map(field)}</View>
      {(["houseRules", "wifiName", "wifiPassword", "accessCode", "checkInInstructions"] as const).map(field)}
      <Text accessibilityRole="header" style={{ color: p.text, fontWeight: "700" }}>{`Photos (${draft.photos.length})`}</Text>
      <Text style={[ui.small, { color: p.muted }]}>The first photo is the cover. Photos go to Hostaway with the new listing; add any later ones in Hostaway.</Text>
      <View style={[ui.row, { gap: 10, flexWrap: "wrap", alignItems: "flex-start" }]}>
        {draft.photos.map((x, i) => <PhotoTile key={x.id} p={p} propertyId={propertyId} photo={x} index={i} total={draft.photos.length} edit={edit} removable={addable || edit}
          onCaption={v => setPhotos(draft.photos.map(y => y.id === x.id ? { ...y, caption: v } : y))} onMove={by => move(i, by)}
          onRemove={() => void act({ action: "removePhoto", photoId: x.id }, "Photo removed.")} />)}
      </View>
      {addable && draft.photos.length < LISTING_LIMITS.photos && <Button p={p} icon="image" label="Add photos" disabled={busy} onPress={() => void addPhotos()} />}
      {shoot.canReceive && <Button p={p} icon="check-circle" label="The photos are in" disabled={busy}
        onPress={() => void act({ action: "photosReceived" }, "Photos received. The owner has been told, and the listing is open to check.")} />}
      {edit && <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
        <Button p={p} quiet icon="refresh-ccw" label="Fill in again from onboarding" disabled={busy} onPress={() => { setNote(""); setDirty(true); setDraft(d => d ? { ...d, fields: l.prefill, numbers: {} } : d); }} />
        <Button p={p} icon="save" label="Save the listing" disabled={busy} onPress={() => void save()} />
      </View>}
    </View>}
    {!!error && <Notice p={p} tone="bad" text={error} />}
    {!!note && <Notice p={p} text={note} />}
    {l.canPublish && <View style={{ gap: 6 }}>
      {missing.length > 0 && <Text style={[ui.small, { color: p.muted }]}>{"Before it can be approved: " + missing.join(", ")}</Text>}
      {dirty && <Text style={[ui.small, { color: p.muted }]}>Save your changes before approving.</Text>}
      <Button p={p} primary icon="send" label={l.publishedAt ? "Approve and update in Hostaway" : "Approve and create in Hostaway"} disabled={busy || dirty || !l.saved || missing.length > 0}
        onPress={() => void act({ action: "publish" }, l.publishedAt ? "Updated in Hostaway." : "Created in Hostaway. Connect it to the channels there.")} />
    </View>}
  </View>;
}

// ---------------------------------------------------------------- the Property Performance Managers, and what waits for them
function Approvers({ p, view, onSaved }: { p: Palette; view: ListingView; onSaved: (v: ListingView) => void }) {
  const [chosen, setChosen] = useState<string[]>(() => view.approvers.map(x => x.id));
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
  const request = useRequestId("listing-approvers:" + chosen.join(","));
  const admin = view.canEditSettings;
  async function save() {
    setBusy(true); setError("");
    try { const v = listingViewSchema.parse((await liveApi("/listing", { action: "setApprovers", requestId: request.get(), userIds: chosen })).data); request.done(); setSaved(true); onSaved(v); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <View style={{ gap: 8 }}>
    <Text accessibilityRole="header" style={{ color: p.text, fontWeight: "700" }}>Property Performance Manager</Text>
    <Text style={[ui.small, { color: p.muted }]}>Approves each listing before it is created in Hostaway, and is told when one is ready. Admins can always approve.</Text>
    {admin ? <>
      {view.team.length === 0 ? <Text style={[ui.small, { color: p.muted }]}>Only stays team members who can open Leads can be chosen. There are none yet.</Text>
        : <View style={[ui.row, { gap: 6, flexWrap: "wrap" }]}>{view.team.map(t => {
          const on = chosen.includes(t.id);
          return <Button key={t.id} p={p} quiet={!on} icon={on ? "check-square" : "square"} label={t.name}
            onPress={() => { setSaved(false); setChosen(c => on ? c.filter(x => x !== t.id) : [...c, t.id]); }} />;
        })}</View>}
      <Button p={p} icon="user-check" label="Save who approves" disabled={busy} onPress={() => void save()} />
    </> : <Text style={{ color: p.text, fontSize: 13 }}>{view.approvers.length ? view.approvers.map(x => x.name).join(", ") + ", and the admins" : "The admins"}</Text>}
    {!!error && <Notice p={p} tone="bad" text={error} />}
    {saved && <Notice p={p} text="Saved." />}
  </View>;
}

function Awaiting({ p, view }: { p: Palette; view: ListingView }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!view.canApprove) return null;
  return <View style={{ gap: 8 }}>
    <Text accessibilityRole="header" style={{ color: p.text, fontWeight: "700" }}>{`Waiting for approval (${view.awaiting.length})`}</Text>
    {view.awaiting.length === 0 && <Text style={[ui.small, { color: p.muted }]}>Nothing is waiting for approval.</Text>}
    {view.awaiting.map(a => <View key={a.propertyId} style={{ gap: 8 }}>
      <View style={[ui.between, { gap: 8 }]}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: p.text, fontWeight: "600" }}>{a.name}</Text>
          <Text style={[ui.small, { color: p.muted }]}>{`${STATUS_LABEL[a.status as keyof typeof STATUS_LABEL] ?? a.status}${a.updatedAt ? `, saved ${when(a.updatedAt)}` : ""}${a.updatedByName ? ` by ${a.updatedByName}` : ""}`}</Text>
        </View>
        <Button p={p} quiet icon={open === a.propertyId ? "chevron-up" : "eye"} label={open === a.propertyId ? "Close" : "Open"} onPress={() => setOpen(o => o === a.propertyId ? null : a.propertyId)} />
      </View>
      {open === a.propertyId && <ListingPanel p={p} propertyId={a.propertyId} />}
    </View>)}
  </View>;
}

// ---------------------------------------------------------------- admins: the starting wording and times
export function ListingSettingsSheet({ p, visible, onClose }: { p: Palette; visible: boolean; onClose: () => void }) {
  const [view, setView] = useState<ListingView | null>(null), [draft, setDraft] = useState<ListingSettings | null>(null), [numbers, setNumbers] = useState<Record<string, string>>({});
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [saved, setSaved] = useState(false);
  const request = useRequestId("listing-settings:" + JSON.stringify(draft));
  const load = useCallback(async () => { try { const v = await readListing(); setView(v); setDraft(v.settings); setNumbers({}); setError(""); } catch (e) { setError(message(e)); } }, []);
  useEffect(() => { if (!visible) return; let active = true; queueMicrotask(() => { if (active) void load(); }); return () => { active = false; }; }, [visible, load]);
  const canEdit = !!view?.canEditSettings;
  const set = (patch: Partial<ListingSettings>) => { setSaved(false); setDraft(d => d ? { ...d, ...patch } : d); };
  const num = (k: "checkInFrom" | "checkInTo" | "checkOut" | "minNights" | "guestsPerBedroom" | "cleaningFeeMinor", label: string) => {
    const money = k === "cleaningFeeMinor";
    const value = numbers[k] ?? (draft ? money ? pounds(draft[k]) : String(draft[k]) : "");
    return canEdit ? <View key={k} style={{ flexBasis: 150, flexGrow: 1 }}><Field p={p} label={label} value={value} onChange={v => {
      setNumbers(n => ({ ...n, [k]: v })); const n = money ? toMinor(v) : toWhole(v); if (n !== null) set({ [k]: n } as Partial<ListingSettings>);
    }} /></View> : <Text key={k} style={{ color: p.text, fontSize: 13 }}>{`${label}: ${draft ? money ? formatMoney(draft[k]) : draft[k] : ""}`}</Text>;
  };
  async function save() {
    if (!draft) return;
    const parsed = listingSettingsSchema.safeParse(draft);
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? "Check the settings"); return; }
    setBusy(true); setError("");
    try { const v = listingViewSchema.parse((await liveApi("/listing", { action: "saveSettings", requestId: request.get(), settings: parsed.data })).data); setView(v); setDraft(v.settings); setNumbers({}); request.done(); setSaved(true); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return (
    <Sheet palette={p} visible={visible} onClose={onClose} title="Listings" subtitle="How each new Hostaway listing is filled in, and who approves it" icon="house" width={680}>
      <View style={{ gap: 14 }}>
        <Text style={[ui.small, { color: p.muted }]}>{`Each property's listing starts from these, with its own details from onboarding. In the description, ${DESCRIPTION_PLACEHOLDERS.map(x => `{${x}}`).join(", ")} are filled in for each property; a line whose detail is not known is left out.`}</Text>
        {!draft && !error && <Loading p={p} rows={4} />}
        {draft && <>
          {canEdit ? <Field p={p} multiline label="Description" value={draft.descriptionTemplate} onChange={v => set({ descriptionTemplate: v.slice(0, 5000) })} />
            : <Text selectable style={{ color: p.text, fontSize: 13 }}>{draft.descriptionTemplate}</Text>}
          {canEdit ? <Field p={p} multiline label="House rules" value={draft.houseRules} onChange={v => set({ houseRules: v.slice(0, 5000) })} />
            : <Text selectable style={{ color: p.text, fontSize: 13 }}>{draft.houseRules}</Text>}
          <View style={[ui.row, { gap: 10, flexWrap: "wrap" }]}>
            {num("checkInFrom", "Check-in from (hour)")}{num("checkInTo", "Check-in until (hour)")}{num("checkOut", "Check-out by (hour)")}
            {num("minNights", "Minimum nights")}{num("guestsPerBedroom", "Guests per bedroom")}{num("cleaningFeeMinor", "Cleaning fee (£)")}
          </View>
        </>}
        {!!error && <Notice p={p} tone="bad" text={error} />}
        {saved && <Notice p={p} text="Saved. Drafts not yet saved by the team follow these from now on." />}
        {view && !canEdit && <Notice p={p} text="Only admins can change the listing settings." />}
        {view?.settingsUpdatedByName && view.settingsUpdatedAt && <Text style={[ui.small, { color: p.muted }]}>{`Last changed by ${view.settingsUpdatedByName}, ${when(view.settingsUpdatedAt)}.`}</Text>}
        {canEdit && draft && <View style={[ui.row, { gap: 8, flexWrap: "wrap" }]}>
          <Button p={p} quiet icon="rotate-ccw" label="Back to the starting wording" onPress={() => { setSaved(false); setNumbers({}); setDraft(DEFAULT_LISTING_SETTINGS); }} />
          <Button p={p} primary icon="check" label="Save" disabled={busy} onPress={() => void save()} />
        </View>}
        {view && <Awaiting p={p} view={view} />}
        {view && <Approvers key={view.approvers.map(x => x.id).join(",")} p={p} view={view} onSaved={setView} />}
        <View style={[ui.row, { gap: 6 }]}><Feather name="info" size={14} color={p.muted} /><Text style={[ui.small, { color: p.muted, flex: 1 }]}>Connecting a new listing to Airbnb, Booking.com and the other channels is done once in Hostaway.</Text></View>
      </View>
    </Sheet>
  );
}
