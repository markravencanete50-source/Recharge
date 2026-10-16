import { useState } from "react";
import { View } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as ImagePicker from "expo-image-picker";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { ui, web, type Palette } from "./theme";
import { uploadEnquiryFile } from "./backend/client";
import { readableError } from "../../lib/error-copy";
import { MAX_ENQUIRY_FILES, enquiryFilesProblem } from "../../lib/client-enquiry";

// Photos and short videos on an owner's own enquiry ("Add a property enquiry"). They go where the public form's files go
// (the same route checks, limits and storage, lib/client-enquiry-server.ts), so the team sees them on the enquiry in the
// same way. They are chosen here and sent once the enquiry is saved, because the enquiry only exists from then.
export type EnquiryFile = { key: string; uri: string; file?: File; name: string; mime: string; bytes: number; kind: "image" | "video"; status: "waiting" | "uploading" | "done" | "failed"; error?: string };
const VIDEO_MIME: Record<string, string> = { mov: "video/quicktime", webm: "video/webm", mp4: "video/mp4", m4v: "video/mp4" };
const IMAGE_MIME: Record<string, string> = { png: "image/png", webp: "image/webp", jpg: "image/jpeg", jpeg: "image/jpeg", heic: "image/heic", heif: "image/heic" };
const size = (bytes: number) => bytes >= 1024 * 1024 ? (bytes / 1024 / 1024).toFixed(1) + " MB" : Math.max(1, Math.round(bytes / 1024)) + " KB";

// Choosing: the files picked so far, each with a remove button, and the limits checked as they are added.
export function EnquiryUploadPicker({ p, label, help, files, onChange, disabled }: { p: Palette; label: string; help?: string; files: EnquiryFile[]; onChange: (files: EnquiryFile[]) => void; disabled?: boolean }) {
  const [problem, setProblem] = useState("");
  async function pick() {
    setProblem("");
    const left = MAX_ENQUIRY_FILES - files.length;
    if (left <= 0) { setProblem(`Up to ${MAX_ENQUIRY_FILES} photos or videos. For more, paste a link to an album.`); return; }
    if (!web) { const permission = await ImagePicker.requestMediaLibraryPermissionsAsync(); if (!permission.granted) { setProblem("Allow photo access to add photos and videos."); return; } }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images", "videos"], allowsMultipleSelection: true, selectionLimit: left, quality: 0.8 });
    if (result.canceled) return;
    const chosen: EnquiryFile[] = [];
    for (const asset of result.assets.slice(0, left)) {
      const name = asset.fileName || asset.file?.name || (asset.type === "video" ? "video.mp4" : "photo.jpg"), ext = name.split(".").pop()?.toLowerCase() ?? "";
      const video = asset.type === "video" || (asset.mimeType ?? "").startsWith("video/");
      const mime = asset.mimeType || (video ? VIDEO_MIME[ext] ?? "video/mp4" : IMAGE_MIME[ext] ?? "image/jpeg");
      let bytes = asset.fileSize ?? asset.file?.size ?? 0;
      if (!bytes) try { bytes = (await (await fetch(asset.uri)).blob()).size; } catch { bytes = 0; }
      chosen.push({ key: Math.random().toString(36).slice(2), uri: asset.uri, file: asset.file, name, mime, bytes: Math.max(1, bytes), kind: video ? "video" : "image", status: "waiting" });
    }
    const next = [...files, ...chosen], found = enquiryFilesProblem(next);
    if (found) { setProblem(found); return; }
    onChange(next);
  }
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: p.text, fontSize: 14, fontWeight: "600" }}>{label} (optional)</Text>
      {files.map(f => (
        <View key={f.key} style={[ui.row, { gap: 10, minHeight: 44, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: p.border, backgroundColor: p.surface }]}>
          <Feather name={f.kind === "video" ? "film" : "image"} size={16} color={p.muted} />
          <Text numberOfLines={1} style={[ui.small, { color: p.text, flex: 1 }]}>{f.name}</Text>
          <Text style={[ui.small, { color: p.muted }]}>{size(f.bytes)}</Text>
          <MotionPress disabled={disabled} accessibilityRole="button" accessibilityLabel={`Remove ${f.name}`} onPress={() => onChange(files.filter(x => x.key !== f.key))} style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}>
            <Feather name="x" size={16} color={p.muted} />
          </MotionPress>
        </View>
      ))}
      <MotionPress disabled={disabled || files.length >= MAX_ENQUIRY_FILES} accessibilityRole="button" accessibilityLabel="Add photos or videos" onPress={() => void pick()}
        style={[ui.row, { gap: 8, minHeight: 48, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderStyle: "dashed", borderColor: p.controlBorder, justifyContent: "center" }]}>
        <Feather name="upload" size={16} color={p.text} />
        <Text style={{ color: p.text, fontWeight: "600" }}>{files.length ? "Add more" : "Add photos or videos"}</Text>
      </MotionPress>
      {help && <Text style={[ui.small, { color: p.muted }]}>{help}</Text>}
      {!!problem && <Text accessibilityRole="alert" style={[ui.small, { color: p.danger }]}>{problem}</Text>}
    </View>
  );
}

// Sending: one at a time, after the enquiry is saved. A file that fails keeps its reason and can be tried again.
export async function sendEnquiryFiles(propertyId: string, files: EnquiryFile[], patch: (key: string, change: Partial<EnquiryFile>) => void) {
  for (const f of files) {
    if (f.status === "done") continue;
    patch(f.key, { status: "uploading", error: undefined });
    try { await uploadEnquiryFile(propertyId, f); patch(f.key, { status: "done" }); }
    catch (e) { patch(f.key, { status: "failed", error: readableError(e) }); }
  }
}

// After saving: how each file is getting on, and a retry for any that failed.
export function EnquiryUploadStatus({ p, files, onRetry }: { p: Palette; files: EnquiryFile[]; onRetry: () => void }) {
  if (!files.length) return null;
  const done = files.filter(f => f.status === "done").length, failed = files.filter(f => f.status === "failed"), busy = files.some(f => f.status === "uploading" || f.status === "waiting");
  return (
    <View style={{ gap: 8 }}>
      <Text accessibilityLiveRegion="polite" style={[ui.small, { color: p.text, fontWeight: "600" }]}>
        {busy ? `Uploading your photos and videos: ${done} of ${files.length} sent` : failed.length ? `${done} of ${files.length} sent. ${failed.length === 1 ? "One did" : failed.length + " did"} not upload.` : `All ${files.length} ${files.length === 1 ? "file" : "files"} sent.`}
      </Text>
      {failed.map(f => <Text key={f.key} style={[ui.small, { color: p.danger }]}>{f.name}: {f.error}</Text>)}
      {!busy && !!failed.length && (
        <MotionPress accessibilityRole="button" accessibilityLabel="Try the uploads again" onPress={onRetry} style={[ui.row, { gap: 8, minHeight: 44, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: p.controlBorder, alignSelf: "flex-start" }]}>
          <Feather name="refresh-cw" size={14} color={p.text} />
          <Text style={{ color: p.text, fontWeight: "600" }}>Try again</Text>
        </MotionPress>
      )}
    </View>
  );
}
