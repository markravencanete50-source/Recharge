import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, View, type GestureResponderEvent } from "react-native";
import Feather from "@expo/vector-icons/Feather";
import * as Crypto from "expo-crypto";
import { Text } from "./Typography";
import { MotionPress } from "./motion";
import { message } from "./LiveKit";
import { depth, primaryFill, ui, type Palette } from "./theme";
import { uploadToLink, writeChat } from "./backend/client";
import { MAX_VOICE_MS, preparedFilesSchema, voiceLength, type ChatAttachment } from "../../lib/workspace-chat-policy";
import { encodeWav, mixAndResample, recordingPlan, VOICE_RATE, wavDurationMs } from "../../lib/voice-wav";

// Voice notes, like WhatsApp (Alex, on a phone). When the box is empty the send button is a microphone: hold it to record,
// release to send, slide left to cancel; or tap it to record hands-free, with Cancel and Send (for a desktop, and for anyone
// who cannot hold a button). A red dot, a running time and the sound level show while recording; at 5 minutes the note
// stops and sends. The microphone is asked for the first time it is used. Recording is in the browser (MediaRecorder),
// which is what the team uses; the phone app shows no microphone until it has a recorder of its own (expo-audio).
const web = Platform.OS === "web";
const TAP_MS = 350, CANCEL_DX = 90, SHORTEST_MS = 600, LEVELS = 36;

type Plan = { mime: string; convert: boolean };
function plan(): Plan | null {
  if (!web || typeof window === "undefined" || typeof MediaRecorder === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;
  return recordingPlan(navigator.userAgent, mime => { try { return MediaRecorder.isTypeSupported(mime); } catch { return false; } });
}
// What went wrong starting the microphone, in plain words.
function micProblem(error: unknown) {
  const name = (error as { name?: string } | null)?.name ?? "";
  if (["NotAllowedError", "PermissionDeniedError", "SecurityError"].includes(name)) return "Recharge can't use your microphone. To send voice notes, allow the microphone for this site in your browser's settings, then try again.";
  if (["NotFoundError", "DevicesNotFoundError", "OverconstrainedError"].includes(name)) return "No microphone was found. Connect one, then try again.";
  if (["NotReadableError", "TrackStartError", "AbortError"].includes(name)) return "Your microphone is in use by another app. Close it, then try again.";
  if (name === "NotSupportedError" || name === "TypeError") return "Voice notes can't be recorded in this browser. Use an up-to-date Chrome or Safari.";
  return "The microphone could not be started. Try again.";
}

type Session = { plan: Plan; mode: "hold" | "lock"; context: AudioContext | null; stream: MediaStream | null; recorder: MediaRecorder | null; analyser: AnalyserNode | null;
  chunks: Blob[]; started: number; timer: number; released: boolean; cancelled: boolean; finishing: boolean };
type Made = { blob: Blob; mime: string; durationMs: number; requestId: string; preparedId?: string; uploaded?: boolean };
export type VoicePhase = "idle" | "starting" | "recording" | "sending" | "failed";

// Stops the recorder and the microphone; the recording, or null when there is none.
function stop(session: Session): Promise<Blob | null> {
  window.clearInterval(session.timer);
  return new Promise(resolve => {
    const done = () => {
      session.stream?.getTracks().forEach(track => track.stop());
      resolve(session.chunks.length ? new Blob(session.chunks, { type: session.recorder?.mimeType || session.plan.mime }) : null);
    };
    const recorder = session.recorder;
    if (!recorder || recorder.state === "inactive") return done();
    recorder.addEventListener("stop", done, { once: true });
    try { recorder.stop(); } catch { done(); }
  });
}
// Opus (Chrome, Firefox, Android) becomes 16 kHz WAV, which every phone plays; the browser decodes its own recording.
async function toWav(blob: Blob, context: AudioContext | null) {
  const data = await blob.arrayBuffer();
  const Offline = window.OfflineAudioContext ?? (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
  const decoder: BaseAudioContext | null = Offline ? new Offline(1, 1, VOICE_RATE) : context;
  if (!decoder) throw new Error("No audio decoder");
  const decoded = await decoder.decodeAudioData(data);
  const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
  return encodeWav(mixAndResample(channels, decoded.sampleRate));
}

export function useVoiceNote(conversationId: string, onSent: () => void) {
  const [supported] = useState(() => !!plan());
  const [phase, setPhase] = useState<VoicePhase>("idle"), [locked, setLocked] = useState(false), [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>([]), [drag, setDrag] = useState(0), [error, setError] = useState(""), [length, setLength] = useState(0);
  const live = useRef<Session | null>(null), made = useRef<Made | null>(null), sent = useRef(onSent);
  useEffect(() => { sent.current = onSent; }, [onSent]);
  // Leaving the conversation mid-recording lets the microphone go and sends nothing.
  useEffect(() => () => { const session = live.current; if (session) { session.cancelled = true; live.current = null; void stop(session).then(() => session.context?.close().catch(() => undefined)); } }, []);

  async function begin(mode: "hold" | "lock") {
    if (live.current || made.current) return;
    const how = plan();
    if (!how) { setError("Voice notes can't be recorded in this browser. Use an up-to-date Chrome or Safari."); return; }
    setError("");
    // Made in the tap itself: an iPhone only starts sound work from a tap.
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    let context: AudioContext | null = null;
    try { context = Context ? new Context() : null; } catch { context = null; }
    const session: Session = { plan: how, mode, context, stream: null, recorder: null, analyser: null, chunks: [], started: 0, timer: 0, released: false, cancelled: false, finishing: false };
    live.current = session;
    setPhase("starting"); setLocked(mode === "lock"); setElapsed(0); setLevels([]); setDrag(0);
    let stream: MediaStream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }); }
    catch (e) {
      void context?.close().catch(() => undefined);
      if (live.current === session) { live.current = null; setPhase("idle"); setLocked(false); }
      setError(micProblem(e));
      return;
    }
    if (session.cancelled || live.current !== session) { stream.getTracks().forEach(track => track.stop()); void context?.close().catch(() => undefined); return; }
    let recorder: MediaRecorder;
    try { recorder = new MediaRecorder(stream, { mimeType: how.mime, audioBitsPerSecond: 64000 }); }
    catch {
      try { recorder = new MediaRecorder(stream); }
      catch { stream.getTracks().forEach(track => track.stop()); live.current = null; setPhase("idle"); setLocked(false); setError("Voice notes can't be recorded in this browser. Use an up-to-date Chrome or Safari."); return; }
    }
    session.stream = stream; session.recorder = recorder;
    recorder.addEventListener("dataavailable", event => { if (event.data.size) session.chunks.push(event.data); });
    if (context) {
      try {
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        context.createMediaStreamSource(stream).connect(analyser);
        session.analyser = analyser;
        if (context.state === "suspended") void context.resume().catch(() => undefined);
      } catch { session.analyser = null; }
    }
    recorder.start(250);
    session.started = Date.now();
    // Let go while the browser was asking for the microphone: it keeps recording, with Cancel and Send.
    if (session.mode === "hold" && session.released) { session.mode = "lock"; setLocked(true); }
    setPhase("recording");
    const samples = new Uint8Array(512);
    session.timer = window.setInterval(() => {
      const ms = Date.now() - session.started;
      setElapsed(ms);
      if (session.analyser) {
        session.analyser.getByteTimeDomainData(samples);
        let sum = 0;
        for (const v of samples) { const x = (v - 128) / 128; sum += x * x; }
        const level = Math.min(1, Math.sqrt(sum / samples.length) * 5);
        setLevels(list => [...list.slice(1 - LEVELS), level]);
      }
      // Five minutes: it stops and sends.
      if (ms >= MAX_VOICE_MS) void finish();
    }, 100);
  }

  // Recording carries on hands-free, with Cancel and Send (a tap on the microphone, or letting go of a slide).
  function lock() {
    const session = live.current;
    if (!session) return;
    session.mode = "lock"; session.released = true;
    setLocked(true); setDrag(0);
  }

  async function cancel() {
    const session = live.current;
    if (!session) return;
    session.cancelled = true; live.current = null;
    setPhase("idle"); setLocked(false); setDrag(0); setLevels([]);
    await stop(session);
    void session.context?.close().catch(() => undefined);
  }

  async function finish() {
    const session = live.current;
    if (!session || session.finishing) return;
    // Let go before the microphone started (the browser was asking): carry on, with Cancel and Send.
    if (!session.recorder) { session.released = true; return; }
    session.finishing = true;
    const ms = Math.min(MAX_VOICE_MS, Date.now() - session.started);
    setPhase("sending"); setLocked(false); setDrag(0); setLength(ms);
    const blob = await stop(session);
    live.current = null;
    if (!blob || ms < SHORTEST_MS) {
      void session.context?.close().catch(() => undefined);
      setPhase("idle"); setLevels([]);
      setError(blob ? "That was too short to send. Hold the microphone while you talk, or tap it to start and stop." : "Nothing was recorded. Try again.");
      return;
    }
    try {
      if (session.plan.convert) {
        const wav = await toWav(blob, session.context);
        made.current = { blob: new Blob([wav as BlobPart], { type: "audio/wav" }), mime: "audio/wav", durationMs: Math.min(MAX_VOICE_MS + 4000, Math.max(1, wavDurationMs(wav) || ms)), requestId: Crypto.randomUUID() };
      } else made.current = { blob: new Blob([blob], { type: "audio/mp4" }), mime: "audio/mp4", durationMs: Math.max(1, ms), requestId: Crypto.randomUUID() };
    } catch {
      setPhase("idle"); setLevels([]);
      setError("The voice note could not be prepared. Record it again.");
      return;
    } finally { void session.context?.close().catch(() => undefined); }
    await deliver();
  }

  // Stored privately like a chat photo (prepareFiles, then the one-off upload link), then sent as a message of its own.
  async function deliver() {
    const note = made.current;
    if (!note) return;
    setPhase("sending"); setError(""); setLength(note.durationMs);
    try {
      if (!note.uploaded) {
        if (note.preparedId) { await writeChat({ action: "discardFiles", ids: [note.preparedId] }).catch(() => undefined); note.preparedId = undefined; }
        const name = "Voice note." + (note.mime === "audio/wav" ? "wav" : "m4a");
        const target = preparedFilesSchema.parse((await writeChat({ action: "prepareFiles", conversationId, files: [{ name, mime: note.mime as "audio/mp4", bytes: note.blob.size, durationMs: Math.round(note.durationMs) }] })).data).files[0];
        note.preparedId = target.id;
        await uploadToLink(target.uploadUrl, { uri: "", file: new File([note.blob], name, { type: note.mime }), type: note.mime });
        note.uploaded = true;
      }
      await writeChat({ action: "send", requestId: note.requestId, conversationId, body: "", attachments: [note.preparedId!] });
      made.current = null; setPhase("idle"); setLevels([]);
      sent.current();
    } catch (e) { setPhase("failed"); setError(message(e)); }
  }

  function discard() {
    const note = made.current;
    made.current = null; setPhase("idle"); setError(""); setLevels([]);
    if (note?.preparedId) void writeChat({ action: "discardFiles", ids: [note.preparedId] }).catch(() => undefined);
  }

  const recording = phase === "starting" || phase === "recording";
  return { supported, phase, recording, locked, elapsed, levels, drag, error, length, active: phase !== "idle", begin, lock, cancel, finish, retry: () => void deliver(), discard, setDrag, clearError: () => setError("") };
}
export type VoiceNote = ReturnType<typeof useVoiceNote>;

// The microphone (the send button's place while the box is empty). Press and hold records, letting go sends, sliding left
// cancels; a tap (or Enter) records hands-free and the button becomes Send.
export function MicButton({ p, voice }: { p: Palette; voice: VoiceNote }) {
  const press = useRef<{ x: number; at: number; id: number } | null>(null), down = useRef<"record" | "send" | null>(null);
  const sendMode = voice.recording && voice.locked, holding = voice.recording && !voice.locked;
  const busy = voice.phase === "sending" || voice.phase === "failed";
  function pointerDown(e: ReactPointerEvent<HTMLButtonElement>) {
    if (e.button !== 0 || busy) return;
    down.current = sendMode ? "send" : "record";
    if (sendMode) return; // the click sends
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* moves are still followed over the button */ }
    press.current = { x: e.clientX, at: e.timeStamp, id: e.pointerId };
    if (voice.recording) voice.lock(); else void voice.begin("hold");
  }
  function pointerMove(e: ReactPointerEvent<HTMLButtonElement>) {
    const at = press.current;
    if (!at || e.pointerId !== at.id) return;
    const dx = Math.min(0, e.clientX - at.x);
    voice.setDrag(dx);
    if (dx < -CANCEL_DX) { press.current = null; void voice.cancel(); }
  }
  function pointerUp(e: ReactPointerEvent<HTMLButtonElement>) {
    const at = press.current;
    if (!at || e.pointerId !== at.id) return;
    press.current = null;
    if (e.timeStamp - at.at < TAP_MS) voice.lock(); else void voice.finish();
  }
  // The browser took the touch (a scroll, a call): keep the recording, with Cancel and Send.
  function pointerCancel() { if (press.current) { press.current = null; voice.lock(); } }
  function click() {
    const how = down.current;
    down.current = null;
    if (how === "record" || busy) return;
    if (sendMode) void voice.finish();
    else if (!voice.recording) void voice.begin("lock");
  }
  if (!web) return null;
  const label = sendMode ? "Send voice note" : holding ? "Recording. Let go to send, slide left to cancel" : "Record a voice note. Hold to record and let go to send, or tap to start and stop";
  return (
    <button type="button" aria-label={label} title={sendMode ? "Send" : holding ? undefined : "Hold to record, or tap"} disabled={busy} data-voice={sendMode ? "send" : "mic"}
      onContextMenu={e => e.preventDefault()} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerCancel} onClick={click}
      style={{ width: 46, height: 46, minWidth: 46, borderRadius: 23, border: "none", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
        cursor: busy ? "default" : "pointer", touchAction: "none", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none", WebkitTapHighlightColor: "transparent",
        background: holding ? p.danger : busy ? p.wash : p.primary, transform: holding ? "scale(1.18)" : "none", transition: "transform 120ms ease, background-color 120ms ease" }}>
      <Feather name={sendMode ? "send" : "mic"} size={19} color={busy ? p.muted : p.onPrimary} />
    </button>
  );
}

function Levels({ p, levels }: { p: Palette; levels: number[] }) {
  const bars = [...Array.from({ length: Math.max(0, LEVELS - levels.length) }, () => 0), ...levels];
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[ui.row, { flex: 1, minWidth: 0, gap: 2, height: 28, overflow: "hidden" }]}>
      {bars.map((level, i) => <View key={i} style={{ width: 3, borderRadius: 2, height: 3 + Math.round(level * 24), backgroundColor: level > 0 ? p.primary : p.border }} />)}
    </View>
  );
}

// Where the box to write in was, while a voice note is recorded or sent: a red dot, the time and the level; Cancel while
// recording hands-free; Retry and Discard if it did not send.
export function VoiceBar({ p, voice }: { p: Palette; voice: VoiceNote }) {
  const left = MAX_VOICE_MS - voice.elapsed, ending = voice.phase === "recording" && left <= 15000;
  if (voice.phase === "sending" || voice.phase === "failed") return (
    <View accessibilityLiveRegion="polite" style={[ui.row, { flex: 1, minHeight: 46, gap: 10, paddingHorizontal: 14, borderRadius: 18, backgroundColor: p.wash }]}>
      {voice.phase === "sending" ? <ActivityIndicator color={p.primary} /> : <Feather name="alert-circle" size={17} color={p.danger} />}
      <Text numberOfLines={1} style={{ flex: 1, color: p.text, fontSize: 14 }}>{voice.phase === "sending" ? `Sending voice note (${voiceLength(voice.length)})…` : "Voice note not sent"}</Text>
      {voice.phase === "failed" && <>
        <MotionPress accessibilityRole="button" accessibilityLabel="Try sending the voice note again" onPress={voice.retry} style={{ minHeight: 36, paddingHorizontal: 8, justifyContent: "center" }}><Text style={{ color: p.primary, fontWeight: "600" }}>Retry</Text></MotionPress>
        <MotionPress accessibilityRole="button" accessibilityLabel="Discard the voice note" onPress={voice.discard} style={{ minHeight: 36, paddingHorizontal: 8, justifyContent: "center" }}><Text style={{ color: p.muted, fontWeight: "600" }}>Discard</Text></MotionPress>
      </>}
    </View>
  );
  return (
    <View style={[ui.row, { flex: 1, minHeight: 46, gap: 10, paddingLeft: voice.locked ? 4 : 14, paddingRight: 10, borderRadius: 18, backgroundColor: p.wash, overflow: "hidden" }]}>
      {voice.locked && <MotionPress accessibilityRole="button" accessibilityLabel="Cancel the voice note" onPress={() => void voice.cancel()}
        style={[ui.row, { gap: 4, minHeight: 38, paddingHorizontal: 10, borderRadius: 19, backgroundColor: p.surface }]}>
        <Feather name="trash-2" size={16} color={p.danger} /><Text style={{ color: p.danger, fontSize: 13, fontWeight: "600" }}>Cancel</Text>
      </MotionPress>}
      <View accessibilityLabel="Recording" style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: p.danger }} />
      <Text accessibilityLiveRegion="none" style={{ color: ending ? p.danger : p.text, fontSize: 15, fontWeight: "600", fontVariant: ["tabular-nums"], minWidth: 40 }}>
        {voice.phase === "starting" ? "0:00" : voiceLength(voice.elapsed, true)}
      </Text>
      {voice.phase === "starting" ? <Text numberOfLines={1} style={{ flex: 1, color: p.muted, fontSize: 13 }}>Starting the microphone…</Text> : <Levels p={p} levels={voice.levels} />}
      {ending && <Text style={{ color: p.danger, fontSize: 12, fontWeight: "600" }}>{Math.ceil(left / 1000)}s left</Text>}
      {!voice.locked && voice.phase === "recording" && !ending &&
        <View style={[ui.row, { gap: 2, transform: [{ translateX: Math.max(-60, voice.drag / 2) }], opacity: Math.max(0.35, 1 + voice.drag / 120) }]}>
          <Feather name="chevron-left" size={15} color={p.muted} /><Text numberOfLines={1} style={{ color: p.muted, fontSize: 13 }}>Slide to cancel</Text>
        </View>}
    </View>
  );
}

// ---------------------------------------------------------------- playing a voice note
// One note plays at a time: starting another pauses this one. Each note's player keeps its own audio element, made on the
// first tap (an iPhone only plays sound started by a tap).
type PlayerEvents = { position: (ms: number) => void; state: (state: "loading" | "playing" | "paused" | "idle") => void; broken: () => void };
type Player = { audio: HTMLAudioElement | null; url: string; events: PlayerEvents | null };
let playing: Player | null = null;
const newPlayer = (): Player => ({ audio: null, url: "", events: null });
function audioOf(player: Player, url: string) {
  if (player.audio && player.url === url) return player.audio;
  player.audio?.pause();
  const a = new Audio();
  a.preload = "auto";
  a.addEventListener("timeupdate", () => player.events?.position(a.currentTime * 1000));
  a.addEventListener("playing", () => player.events?.state("playing"));
  a.addEventListener("waiting", () => player.events?.state("loading"));
  a.addEventListener("pause", () => { if (!a.ended) player.events?.state("paused"); });
  a.addEventListener("ended", () => { player.events?.state("idle"); player.events?.position(0); if (playing === player) playing = null; });
  a.addEventListener("error", () => { player.events?.broken(); player.events?.state("idle"); });
  a.src = url;
  player.audio = a; player.url = url;
  return a;
}
function playOrPause(player: Player, url: string) {
  const a = audioOf(player, url);
  if (!a.paused) { a.pause(); return; }
  if (playing && playing !== player) playing.audio?.pause();
  playing = player;
  player.events?.state("loading");
  void a.play().catch(() => { player.events?.state("idle"); player.events?.broken(); });
}
function seekPlayer(player: Player, url: string, ms: number) {
  const a = audioOf(player, url);
  try { a.currentTime = ms / 1000; } catch { /* before it has loaded: it starts from here */ }
}
function stopPlayer(player: Player) {
  player.audio?.pause();
  player.events = null;
  if (playing === player) playing = null;
}
function listen(player: Player, events: PlayerEvents) { player.events = events; }

export function VoiceNotePlayer({ p, item, url, failed, mine }: { p: Palette; item: ChatAttachment; url?: string; failed?: boolean; mine: boolean }) {
  const [player] = useState(newPlayer);
  const [state, setState] = useState<"idle" | "loading" | "playing" | "paused">("idle"), [position, setPosition] = useState(0), [broken, setBroken] = useState(false), [width, setWidth] = useState(0);
  const total = Math.max(1, item.durationMs ?? 0);
  useEffect(() => {
    listen(player, { position: ms => setPosition(Math.min(total, ms)), state: setState, broken: () => setBroken(true) });
    return () => stopPlayer(player);
  }, [player, total]);
  function toggle() {
    if (!url) return;
    if (!web) { void Linking.openURL(url); return; }
    setBroken(false);
    // Played straight from the tap, as an iPhone requires.
    playOrPause(player, url);
  }
  function seekTo(ms: number) {
    if (!Number.isFinite(ms)) return;
    const at = Math.max(0, Math.min(total, ms));
    setPosition(at);
    if (url && web) seekPlayer(player, url, at);
    if (state === "idle") setState("paused");
  }
  // Where on the bar it was pressed: in a browser from the page position (a click carries no position within the bar).
  const bar = useRef<View>(null);
  function seek(event: GestureResponderEvent) {
    const touch = event.nativeEvent as unknown as { locationX?: number; pageX?: number; clientX?: number };
    let x = touch.locationX;
    if (web) {
      const rect = (bar.current as unknown as HTMLElement | null)?.getBoundingClientRect?.(), at = touch.clientX ?? touch.pageX;
      if (rect && typeof at === "number") x = at - rect.left;
    }
    if (width > 0 && typeof x === "number" && Number.isFinite(x)) seekTo(x / width * total);
  }
  const share = Math.min(1, position / total), ink = mine ? p.onPrimary : p.primary, quiet = mine ? p.onPrimary : p.muted;
  const shown = state === "idle" && position === 0 ? voiceLength(total) : voiceLength(position, true);
  const unavailable = failed || broken;
  return (
    <View {...(web ? { dataSet: { voiceNote: state } } : {})} style={[ui.row, { gap: 10, width: 248, maxWidth: "100%", paddingVertical: 8, paddingLeft: 8, paddingRight: 14, borderRadius: 22, borderBottomRightRadius: mine ? 6 : 22, borderBottomLeftRadius: mine ? 22 : 6 },
      mine ? primaryFill(p) : { backgroundColor: p.surface, borderWidth: 1, borderColor: p.border, ...depth.card }]}>
      <MotionPress accessibilityRole="button" accessibilityLabel={state === "playing" || state === "loading" ? "Pause voice note" : `Play voice note, ${voiceLength(total)}`} disabled={!url} onPress={toggle}
        style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: mine ? p.onPrimary : p.wash }}>
        {state === "loading" ? <ActivityIndicator size="small" color={p.primary} /> : !url && !unavailable ? <ActivityIndicator size="small" color={p.primary} />
          : <Feather name={state === "playing" ? "pause" : "play"} size={18} color={p.primary} style={state === "playing" ? undefined : { marginLeft: 2 }} />}
      </MotionPress>
      <View style={{ flex: 1, gap: 4 }}>
        <Pressable accessibilityRole="adjustable" accessibilityLabel="Position in the voice note" accessibilityValue={{ min: 0, max: Math.round(total / 1000), now: Math.round(position / 1000), text: `${voiceLength(position, true)} of ${voiceLength(total)}` }}
          accessibilityActions={[{ name: "increment" }, { name: "decrement" }]} onAccessibilityAction={e => seekTo(position + (e.nativeEvent.actionName === "increment" ? 5000 : -5000))}
          ref={bar} onLayout={e => setWidth(e.nativeEvent.layout.width)} onPress={seek} disabled={!url || !web} style={{ height: 22, justifyContent: "center" }}>
          <View pointerEvents="none" style={{ height: 4, borderRadius: 2, backgroundColor: mine ? p.bright : p.border }}>
            <View style={{ width: `${share * 100}%`, height: 4, borderRadius: 2, backgroundColor: ink }} />
          </View>
          <View pointerEvents="none" style={{ position: "absolute", left: Math.max(0, share * width - 6), width: 12, height: 12, borderRadius: 6, backgroundColor: ink }} />
        </Pressable>
        <View style={[ui.row, { gap: 6 }]}>
          <Feather name="mic" size={12} color={quiet} />
          <Text style={{ color: quiet, fontSize: 12, fontVariant: ["tabular-nums"] }}>{unavailable ? "Can't be played just now" : shown}</Text>
        </View>
      </View>
    </View>
  );
}
