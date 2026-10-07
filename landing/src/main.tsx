import { Player, type PlayerRef } from "@remotion/player";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { staticFile } from "remotion";
import { DURATION, FPS, INTRO_END, Intro } from "./Intro";
import TL from "./timeline.json";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// ?frame=120 holds a single frame, for checking the animation.
const pinned = Number(new URLSearchParams(window.location.search).get("frame") ?? NaN);
const hold = Number.isFinite(pinned) ? pinned : reduceMotion ? INTRO_END : null;
const viewport = () => ({ width: Math.round(window.innerWidth), height: Math.round(window.innerHeight) });

// The soundtrack is always on (there is no sound control). sound/soundtrack.py writes the
// intro, then the idle loop repeated: one loop period sits between LOOP_FROM and LOOP_TO,
// and Web Audio repeats that span with no gap. Browsers only allow sound once the visitor
// has interacted with the page, so if autoplay is blocked the first tap, click or key press
// starts it, and the intro replays from the beginning with its sound.
const LOOP = (2 * TL.cycle) / FPS;
const LOOP_FROM = TL.introEnd / FPS + LOOP;
const LOOP_TO = LOOP_FROM + LOOP;
const fileTime = (frame: number) => {
  const t = frame / FPS;
  return t < LOOP_FROM ? t : LOOP_FROM + ((t - LOOP_FROM) % LOOP);
};

// A tenth of a second of silence, as a WAV data URL.
function silentWav() {
  const bytes = new Uint8Array(44 + 800).fill(128);
  const view = new DataView(bytes.buffer);
  [..."RIFF"].forEach((c, i) => view.setUint8(i, c.charCodeAt(0)));
  view.setUint32(4, 36 + 800, true);
  [..."WAVEfmt "].forEach((c, i) => view.setUint8(8 + i, c.charCodeAt(0)));
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true); view.setUint32(28, 8000, true); view.setUint16(32, 1, true); view.setUint16(34, 8, true);
  [..."data"].forEach((c, i) => view.setUint8(36 + i, c.charCodeAt(0)));
  view.setUint32(40, 800, true);
  return "data:audio/wav;base64," + btoa(String.fromCharCode(...bytes));
}

function useSoundtrack(player: React.RefObject<PlayerRef | null>, enabled: boolean) {
  useEffect(() => {
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!enabled || !Context) return;
    // On iPhone, play as media (like a video) so the ring/silent switch doesn't mute it.
    const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (session) session.type = "playback";
    const ctx = new Context({ latencyHint: "playback" });
    const out = ctx.createGain();
    out.connect(ctx.destination);
    let buffer: AudioBuffer | null = null;
    let source: AudioBufferSourceNode | null = null;
    let anchor = { at: 0, frame: 0 }; // ctx.currentTime when the source started, and the frame it started at
    let settle = 0; // after a restart, give the picture a moment to jump to frame 0 before checking drift
    let unlocked = false;
    let disposed = false;

    const stop = () => {
      if (!source) return;
      const s = source;
      source = null;
      out.gain.setTargetAtTime(0, ctx.currentTime, 0.008);
      s.stop(ctx.currentTime + 0.05);
    };
    const startAt = (frame: number) => {
      if (!buffer || ctx.state !== "running") return;
      stop();
      const s = ctx.createBufferSource();
      s.buffer = buffer;
      s.loop = true;
      s.loopStart = LOOP_FROM;
      s.loopEnd = LOOP_TO;
      s.connect(out);
      const at = ctx.currentTime + 0.06;
      out.gain.setTargetAtTime(1, at, 0.008);
      s.start(at, fileTime(frame + 0.06 * FPS));
      source = s;
      anchor = { at, frame: frame + 0.06 * FPS };
    };
    // Keep the sound on the animation's clock: if it drifts by more than about 3 frames, re-cue it.
    const onFrame = ({ detail }: { detail: { frame: number } }) => {
      if (!source || ctx.state !== "running" || ctx.currentTime < settle) return;
      const heard = anchor.frame + (ctx.currentTime - anchor.at) * FPS;
      const drift = Math.abs(fileTime(detail.frame) - fileTime(heard)) * FPS;
      if (drift > 3 && drift < LOOP * FPS - 3) startAt(detail.frame);
    };
    const p = player.current;
    p?.addEventListener("frameupdate", onFrame);

    // A gesture unlocks the sound; replay the intro so it is heard from the start.
    const unlock = () => {
      if (unlocked || disposed) return;
      // Older iPhones: a media element playing inside the same tap moves the page's audio onto
      // the media channel, which the silent switch doesn't mute. It plays silence, on a loop.
      if (!session && media) void media.play().catch(() => undefined);
      void ctx.resume().then(() => {
        if (unlocked || disposed || ctx.state !== "running") return;
        unlocked = true;
        gestures.forEach(type => window.removeEventListener(type, unlock, true));
        const pl = player.current;
        pl?.seekTo(0);
        pl?.play();
        settle = ctx.currentTime + 0.4;
        startAt(0);
      });
    };
    const media = session || typeof Audio === "undefined" ? null : new Audio(silentWav());
    if (media) media.loop = true;
    const gestures = ["touchstart", "touchend", "pointerdown", "pointerup", "mousedown", "keydown", "click"] as const;
    gestures.forEach(type => window.addEventListener(type, unlock, true));

    // Pause with the tab; pick up again in step when it comes back.
    const onVisibility = () => {
      if (document.hidden) { stop(); void ctx.suspend(); return; }
      void ctx.resume().then(() => { if (unlocked) startAt(player.current?.getCurrentFrame() ?? 0); });
    };
    document.addEventListener("visibilitychange", onVisibility);

    void fetch(staticFile("sound/recharge.mp3"))
      .then(r => r.arrayBuffer())
      .then(data => ctx.decodeAudioData(data))
      .then(decoded => {
        if (disposed) return;
        buffer = decoded;
        // Where autoplay is allowed the sound simply joins in, in step with the picture.
        if (ctx.state === "running") { unlocked = true; startAt(player.current?.getCurrentFrame() ?? 0); }
        else if (unlocked) startAt(0);
      })
      .catch(() => undefined);
    void ctx.resume().catch(() => undefined);
    // Some browsers report "running" a moment after resume() without a gesture.
    ctx.onstatechange = () => {
      if (ctx.state === "running" && buffer && !source && !document.hidden) { unlocked = true; startAt(player.current?.getCurrentFrame() ?? 0); }
    };

    return () => {
      disposed = true;
      p?.removeEventListener("frameupdate", onFrame);
      gestures.forEach(type => window.removeEventListener(type, unlock, true));
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
      void ctx.close();
    };
  }, [player, enabled]);
}

function App() {
  const [size, setSize] = useState(viewport);
  const player = useRef<PlayerRef>(null);
  useEffect(() => {
    const onResize = () => setSize(viewport());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  useSoundtrack(player, hold === null);
  return (
    <Player
      ref={player}
      component={Intro}
      inputProps={{ still: reduceMotion }}
      durationInFrames={DURATION}
      fps={FPS}
      compositionWidth={size.width}
      compositionHeight={size.height}
      style={{ width: "100%", height: "100%" }}
      autoPlay={hold === null}
      initialFrame={hold ?? 0}
      controls={false}
      clickToPlay={false}
      doubleClickToFullscreen={false}
      spaceKeyToPlayOrPause={false}
      acknowledgeRemotionLicense
    />
  );
}

document.getElementById("fallback")?.remove();
createRoot(document.getElementById("root")!).render(<App />);
