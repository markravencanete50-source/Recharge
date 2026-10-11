import { useEffect, useState } from "react";
import { AppState, Platform, View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as ImagePicker from "expo-image-picker";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { Button, Field, message, Notice } from "./LiveKit";
import { avatarColors } from "./AccountSetup";
import { PersonAvatar } from "./ChatParts";
import { PhotoCropper } from "./PhotoCropper";
import { ui, type Palette } from "./theme";
import { uploadProfilePhoto, viewMode, writeChat, writeProfile } from "./backend/client";
import { AVATAR_COLOURS, type WorkspaceAccount } from "../../lib/workspace-account-policy";

// Your profile, as the team sees it in Messages and People: a photo (or your initials on a colour)
// and a line about you. Your name and email are changed by an admin in Access control.
const COLOUR_LABEL: Record<(typeof AVATAR_COLOURS)[number], string> = { forest: "Forest", sage: "Sage", ocean: "Ocean", plum: "Plum", clay: "Clay", slate: "Slate" };
export function ProfileEditor({ p, account, onAccount }: { p: Palette; account: WorkspaceAccount; onAccount: (next: WorkspaceAccount) => void }) {
  const [about, setAbout] = useState(account.about), [busy, setBusy] = useState<"" | "photo" | "remove" | "save">(""), [error, setError] = useState(""), [done, setDone] = useState("");
  // On the web, a chosen photo opens the crop panel first; phones crop on their own screen.
  const [cropping, setCropping] = useState<{ uri: string; name: string } | null>(null);
  const readOnly = viewMode().readOnly;
  const name = account.fullName || account.email || "You";
  const keep = (next: WorkspaceAccount) => onAccount({ ...account, avatar: next.avatar, photo: next.photo, about: next.about });
  async function run(kind: "photo" | "remove" | "save", work: () => Promise<WorkspaceAccount | null>, said: string) {
    if (busy) return false;
    setBusy(kind); setError(""); setDone("");
    try { const next = await work(); if (next) { keep(next); setDone(said); } return true; } catch (e) { setError(message(e)); return false; } finally { setBusy(""); }
  }
  async function choosePhoto() {
    if (Platform.OS !== "web") { const permission = await ImagePicker.requestMediaLibraryPermissionsAsync(); if (!permission.granted) { setError("Allow photo access to choose a profile photo."); return; } }
    const web = Platform.OS === "web";
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: !web, aspect: [1, 1], quality: 0.8 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    // The web crops it here and uploads only the cropped square, so a bigger original is fine.
    if (web) {
      if ((asset.fileSize ?? asset.file?.size ?? 0) > 25 * 1024 * 1024) { setError("Choose a photo up to 25 MB."); return; }
      setError(""); setDone(""); setCropping({ uri: asset.uri, name: asset.fileName || "profile.jpg" }); return;
    }
    const type = asset.mimeType === "image/png" || asset.mimeType === "image/webp" ? asset.mimeType : "image/jpeg";
    if ((asset.fileSize ?? asset.file?.size ?? 0) > 5 * 1024 * 1024) { setError("Choose a photo up to 5 MB."); return; }
    await run("photo", () => uploadProfilePhoto({ uri: asset.uri, name: asset.fileName || "profile.jpg", type, file: asset.file }), "Photo saved. The team sees it next to your messages.");
  }
  // The crop panel stays open if the upload fails, so they can try again.
  async function saveCropped(file: File) {
    if (await run("photo", () => uploadProfilePhoto({ uri: "", name: "profile.jpg", type: "image/jpeg", file }), "Photo saved. The team sees it next to your messages.")) setCropping(null);
  }
  const changed = about.trim() !== account.about.trim();
  return (
    <View style={{ gap: 12, padding: 16, borderRadius: 20, borderWidth: 1, borderColor: p.border, backgroundColor: p.background }}>
      {cropping && <PhotoCropper key={cropping.uri} p={p} source={cropping} busy={busy === "photo"} onCancel={() => setCropping(null)} onChooseAnother={() => void choosePhoto()} onDone={file => void saveCropped(file)} />}
      {!cropping && <View style={[ui.row, { gap: 14 }]}>
        <PersonAvatar p={p} name={name} userId={account.userId} photo={account.photo} colour={account.avatar} size={72} />
        <View style={{ flex: 1, minWidth: 0, gap: 8 }}>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            <Button label={busy === "photo" ? "Uploading…" : account.photo ? "Change photo" : "Add a photo"} icon="camera" primary p={p} disabled={readOnly || !!busy} onPress={() => void choosePhoto()} />
            {!!account.photo && <Button label={busy === "remove" ? "Removing…" : "Remove"} icon="trash-2" p={p} disabled={readOnly || !!busy} onPress={() => void run("remove", () => writeProfile({ action: "clearPhoto" }), "Photo removed.")} />}
          </View>
          <Text style={[ui.small, { color: p.muted }]}>JPG, PNG or WebP. You choose the part that shows. Shown in Messages and People.</Text>
        </View>
      </View>}
      {!account.photo && !cropping && <View style={{ gap: 6 }}>
        <Text style={[ui.small, { color: p.muted, fontWeight: "700" }]}>Colour behind your initials</Text>
        <View accessibilityRole="radiogroup" style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
          {AVATAR_COLOURS.map(c => {
            const on = account.avatar === c;
            return (
              <MotionPress key={c} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={COLOUR_LABEL[c]} disabled={readOnly || !!busy}
                onPress={() => void run("save", () => writeProfile({ action: "saveProfile", avatar: c }), "Colour saved.")}
                style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: avatarColors[c], alignItems: "center", justifyContent: "center", borderWidth: on ? 3 : 0, borderColor: p.surface, ...(on ? { outlineWidth: 2, outlineColor: avatarColors[c], outlineStyle: "solid" } as object : {}) }}>
                {on && <Feather name="check" size={16} color="#FFFFFF" />}
              </MotionPress>
            );
          })}
        </View>
      </View>}
      <Field label="About you (optional)" value={about} onChange={v => setAbout(v.slice(0, 160))} p={p} placeholder="For example: Guest relations, Leith and Portobello" />
      <View style={[ui.between, { gap: 8 }]}>
        <Text style={[ui.small, { color: p.muted }]}>{about.length}/160</Text>
        <Button label={busy === "save" ? "Saving…" : "Save"} icon="check" p={p} disabled={readOnly || !!busy || !changed} onPress={() => void run("save", () => writeProfile({ action: "saveProfile", about: about.trim() }), "Saved.")} />
      </View>
      {readOnly && <Notice text="Your profile can't be changed while viewing the app as someone else or in the demo." p={p} />}
      {!!done && <Notice text={done} p={p} />}
      {!!error && <Notice text={error} p={p} tone="bad" />}
    </View>
  );
}

// Who is online: while the app is open and in view it checks in every minute. Nothing is sent
// while viewing as someone else or in the demo.
export function usePresenceHeartbeat(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const visible = () => AppState.currentState === "active" && (Platform.OS !== "web" || typeof document === "undefined" || document.visibilityState === "visible");
    const beat = () => { if (visible() && !viewMode().readOnly) void writeChat({ action: "heartbeat" }).catch(() => undefined); };
    beat();
    const timer = setInterval(beat, 60_000);
    const app = AppState.addEventListener("change", state => { if (state === "active") beat(); });
    const onVisible = () => beat();
    if (Platform.OS === "web" && typeof document !== "undefined") document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); app.remove(); if (Platform.OS === "web" && typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisible); };
  }, [enabled]);
}
