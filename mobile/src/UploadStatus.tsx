import { useState } from "react";
import { ActivityIndicator, Image, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import { Text } from "./Typography";
import { MotionPress, useReducedMotion } from "./motion";
import { Button, Notice } from "./LiveKit";
import { Sheet } from "./TeamFlows";
import { ui, type Palette } from "./theme";
import { uploadSummary, type QueuedUpload } from "../../lib/upload-queue";
import { uploads, useLocalPhoto, useUploadRunner, useUploads } from "./uploadQueue";

// Photos waiting to upload: the badge on each one, the line across the top of the workspace, and
// the warning before signing out with photos still on the device.
export const PURPOSE_LABEL: Record<string, string> = { cleaning: "Clean", mailbox: "Post", delivery: "Delivery", licence: "Licensing", maintenance: "Repair", inspection: "Inspection", setup: "From the owner", expense: "Invoice" };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function Badge({ item, p, short }: { item: QueuedUpload; p: Palette; short?: boolean }) {
  const reduced = useReducedMotion();
  const [label, bg, fg, icon] = {
    waiting: [short ? "Waiting" : "Waiting to upload", p.cautionWash, p.waiting, "clock"],
    uploading: ["Uploading", p.wash, p.primary, "upload-cloud"],
    failed: ["Failed", p.dangerWash, p.danger, "alert-circle"],
    done: ["Saved", p.successWash, p.success, "check"],
  }[item.status] as [string, string, string, "clock" | "upload-cloud" | "alert-circle" | "check"];
  return (
    <View style={[ui.row, { alignSelf: "flex-start", gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, backgroundColor: bg }]}>
      {item.status === "uploading" && !reduced ? <ActivityIndicator size="small" color={fg} style={{ transform: [{ scale: 0.7 }], width: 12, height: 12 }} /> : <Feather name={icon} size={11} color={fg} />}
      <Text style={{ color: fg, fontSize: 11, fontWeight: "700", flexShrink: 1 }}>{label}</Text>
    </View>
  );
}

// One photo from the line, shown straight away from the copy on this device.
export function QueuedPhoto({ p, item, size = 96 }: { p: Palette; item: QueuedUpload; size?: number }) {
  const uri = useLocalPhoto(item.file);
  const state = { waiting: "waiting to upload", uploading: "uploading", failed: "failed to upload", done: "saved" }[item.status];
  const action = (label: string, onPress: () => void, tone: "plain" | "bad") => (
    <MotionPress accessibilityRole="button" accessibilityLabel={`${label}, photo`} onPress={onPress} style={{ minHeight: 44, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: tone === "bad" ? p.dangerWash : p.wash }}>
      <Text style={[ui.small, { color: tone === "bad" ? p.danger : p.primary, fontWeight: "700" }]}>{label}</Text>
    </MotionPress>
  );
  return (
    <View style={{ width: size, gap: 6 }}>
      <View style={{ width: size, height: size, borderRadius: 12, overflow: "hidden", backgroundColor: p.wash, alignItems: "center", justifyContent: "center" }}>
        {uri ? <Image source={{ uri }} style={{ width: size, height: size, opacity: item.status === "done" ? 1 : 0.7 }} resizeMode="cover" accessibilityLabel={`Photo, ${state}`} /> : <Feather name="image" size={20} color={p.muted} accessibilityLabel={`Photo, ${state}`} />}
      </View>
      <Badge item={item} p={p} short={size < 80} />
      {item.status === "failed" && <>
        {action(size < 80 ? "Retry" : "Try again", () => void uploads.retry(item.id), "plain")}
        {action("Remove", () => void uploads.remove(item.id), "bad")}
      </>}
    </View>
  );
}

// "3 photos waiting to upload", across the top of the workspace while any are on the device.
// It also keeps the line running for the signed-in person.
export function UploadBanner({ p, userId }: { p: Palette; userId: string }) {
  useUploadRunner(userId);
  const { owner, items } = useUploads();
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const mine = items.filter(x => x.ownerId === owner && x.status !== "done");
  if (!mine.length && !open) return null;
  const s = uploadSummary(items, owner), pending = s.waiting + s.uploading;
  const text = [pending ? `${plural(pending, "photo", "photos")} waiting to upload` : "", s.failed ? `${plural(s.failed, "photo", "photos")} couldn't upload` : ""].filter(Boolean).join(" · ");
  const failed = mine.find(x => x.status === "failed");
  return (
    <>
      {!!mine.length && <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4, backgroundColor: p.background }}>
        <View style={[ui.row, { width: "100%", maxWidth: 760, alignSelf: "center", gap: 8, paddingVertical: 4, paddingLeft: 14, paddingRight: 4, borderRadius: 999, backgroundColor: pending ? p.cautionWash : p.dangerWash }]}>
          {s.uploading && !reduced ? <ActivityIndicator size="small" color={p.waiting} /> : <Feather name={pending ? "upload-cloud" : "alert-circle"} size={16} color={pending ? p.waiting : p.danger} />}
          <MotionPress accessibilityRole="button" accessibilityLabel={`${text}. See the photos`} accessibilityLiveRegion="polite" onPress={() => setOpen(true)} style={{ flex: 1, minHeight: 44, justifyContent: "center" }}>
            <Text numberOfLines={2} style={[ui.small, { color: p.text, fontWeight: "600" }]}>{text}</Text>
          </MotionPress>
          {pending > 0 && <MotionPress accessibilityRole="button" onPress={() => void uploads.retryNow()} style={{ minHeight: 44, minWidth: 44, paddingHorizontal: 14, borderRadius: 999, alignItems: "center", justifyContent: "center", backgroundColor: p.surface }}>
            <Text style={[ui.small, { color: p.primary, fontWeight: "700" }]}>Retry now</Text>
          </MotionPress>}
        </View>
      </View>}
      <Sheet palette={p} visible={open} onClose={() => setOpen(false)} title="Photos on this device" subtitle="They upload by themselves when there's a connection." icon="hourglass">
        {mine.length ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          {mine.map(item => (
            <View key={item.id} style={{ width: 96, gap: 4 }}>
              <QueuedPhoto p={p} item={item} />
              <Text numberOfLines={2} style={[ui.small, { color: p.muted }]}>{PURPOSE_LABEL[item.purpose] ?? item.label}</Text>
            </View>
          ))}
        </View> : <Notice text="All your photos have uploaded." p={p} />}
        {!!failed?.error && <Notice text={failed.error} p={p} tone="bad" />}
        {pending > 0 && <Button label="Retry now" icon="refresh-cw" p={p} onPress={() => void uploads.retryNow()} />}
      </Sheet>
    </>
  );
}

// Shown in place of "Sign out" while photos are still waiting on this device.
export function SignOutUploadsWarning({ p, busy, onCancel, onConfirm }: { p: Palette; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const { owner, items } = useUploads();
  const count = items.filter(x => x.ownerId === owner && x.status !== "done").length;
  return (
    <View accessibilityRole="alert" style={{ gap: 10, padding: 14, borderRadius: 16, backgroundColor: p.cautionWash }}>
      <Text style={{ color: p.text, fontWeight: "700" }}>{count ? `${plural(count, "photo hasn't", "photos haven't")} uploaded yet` : "Your photos have uploaded"}</Text>
      {!!count && <Text style={[ui.small, { color: p.text }]}>If you sign out now, they stay on this device and upload next time you sign in here. To send them first, stay signed in until you have a connection.</Text>}
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <Button label="Stay signed in" primary p={p} onPress={onCancel} />
        <Button label={busy ? "Signing out…" : count ? "Sign out anyway" : "Sign out"} icon="log-out" p={p} disabled={busy} onPress={onConfirm} />
      </View>
    </View>
  );
}
