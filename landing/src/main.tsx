import { Player, type PlayerRef } from "@remotion/player";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { staticFile } from "remotion";
import { BONE, DURATION, FPS, GREEN, INTRO_END, Intro } from "./Intro";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const touch = window.matchMedia("(hover: none)").matches;
// ?frame=120 holds a single frame, for checking the animation.
const pinned = Number(new URLSearchParams(window.location.search).get("frame") ?? NaN);
const hold = Number.isFinite(pinned) ? pinned : reduceMotion ? INTRO_END : null;
const viewport = () => ({ width: Math.round(window.innerWidth), height: Math.round(window.innerHeight) });

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

// The intro's soundtrack (sound/soundtrack.py), played once in step with the animation;
// the logo then idles in silence. There is no sound control. Browsers only allow sound
// after the visitor interacts with the page, so where autoplay is blocked the first tap,
// click or key press starts it and the intro replays from the beginning with its sound.
// Returns true while the browser is waiting for that interaction (to show the hint).
function useSoundtrack(player: React.RefObject<PlayerRef | null>, enabled: boolean) {
  const [waiting, setWaiting] = useState(false);
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
    const frameNow = () => player.current?.getCurrentFrame() ?? 0;

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
      const lead = 0.06 * FPS;
      const offset = (frame + lead) / FPS;
      if (offset >= buffer.duration - 0.05) return; // the intro is over: stay silent
      const s = ctx.createBufferSource();
      s.buffer = buffer;
      s.connect(out);
      s.onended = () => { if (source === s) source = null; };
      const at = ctx.currentTime + 0.06;
      out.gain.setTargetAtTime(1, at, 0.008);
      s.start(at, offset);
      source = s;
      anchor = { at, frame: frame + lead };
    };
    const begin = (fromStart: boolean) => {
      unlocked = true;
      setWaiting(false);
      if (fromStart) {
        player.current?.seekTo(0);
        player.current?.play();
        settle = ctx.currentTime + 0.4;
      }
      startAt(fromStart ? 0 : frameNow());
    };

    // Keep the sound on the animation's clock: if it drifts by more than about 3 frames, re-cue it.
    const onFrame = ({ detail }: { detail: { frame: number } }) => {
      if (!source || ctx.state !== "running" || ctx.currentTime < settle) return;
      const heard = anchor.frame + (ctx.currentTime - anchor.at) * FPS;
      if (Math.abs(detail.frame - heard) > 3) startAt(detail.frame);
    };
    const p = player.current;
    p?.addEventListener("frameupdate", onFrame);

    // Older iPhones: a media element playing inside the same tap moves the page's audio onto
    // the media channel, which the silent switch doesn't mute. It plays silence, on a loop.
    const media = session || typeof Audio === "undefined" ? null : new Audio(silentWav());
    if (media) media.loop = true;
    const gestures = ["touchstart", "touchend", "pointerdown", "pointerup", "mousedown", "keydown", "click"] as const;
    const unlock = () => {
      if (unlocked || disposed) return;
      if (media) void media.play().catch(() => undefined);
      void ctx.resume().then(() => {
        if (unlocked || disposed || ctx.state !== "running") return;
        gestures.forEach(type => window.removeEventListener(type, unlock, true));
        begin(true);
      });
    };
    gestures.forEach(type => window.addEventListener(type, unlock, true));

    // Pause with the tab; pick up again in step when it comes back (if the intro is still on).
    const onVisibility = () => {
      if (document.hidden) { stop(); void ctx.suspend(); return; }
      void ctx.resume().then(() => { if (unlocked) startAt(frameNow()); });
    };
    document.addEventListener("visibilitychange", onVisibility);

    void fetch(staticFile("sound/recharge.mp3"))
      .then(r => r.arrayBuffer())
      .then(data => ctx.decodeAudioData(data))
      .then(decoded => {
        if (disposed) return;
        buffer = decoded;
        // Where autoplay is allowed the sound simply joins in, in step with the picture.
        if (ctx.state === "running") begin(false);
        else if (!unlocked) setWaiting(true);
      })
      .catch(() => undefined);
    void ctx.resume().catch(() => undefined);
    // Some browsers report "running" a moment after resume() without a gesture.
    ctx.onstatechange = () => {
      if (ctx.state === "running" && buffer && !unlocked && !document.hidden) begin(false);
    };

    return () => {
      disposed = true;
      p?.removeEventListener("frameupdate", onFrame);
      gestures.forEach(type => window.removeEventListener(type, unlock, true));
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
      media?.pause();
      void ctx.close();
    };
  }, [player, enabled]);
  return waiting;
}

// A quiet hint while the browser holds the sound back. It is not a control: tapping
// anywhere on the page starts the sound, and the hint then goes away.
function SoundHint({ show }: { show: boolean }) {
  return (<>
    <style>{"@keyframes recharge-hint { 0%, 100% { opacity: .55 } 50% { opacity: .9 } }"}</style>
    <div role="status" aria-live="polite" style={{
      position: "fixed", left: 0, right: 0, bottom: 52, display: "flex", justifyContent: "center", pointerEvents: "none",
      opacity: show ? 1 : 0, transform: `translateY(${show ? 0 : 6}px)`, transition: "opacity 600ms ease, transform 600ms ease",
    }}>
      {show && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 14px", borderRadius: 999, background: `${BONE}d9`,
          border: `1px solid ${GREEN}26`, color: GREEN, font: "600 11px Montserrat, system-ui, sans-serif", letterSpacing: "0.16em",
          textTransform: "uppercase", animation: "recharge-hint 2.4s ease-in-out infinite" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M11 5 6 9H2v6h4l5 4V5z" /><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" />
          </svg>
          {touch ? "Tap for sound" : "Click for sound"}
        </div>
      )}
    </div>
  </>);
}

function App() {
  const [size, setSize] = useState(viewport);
  const player = useRef<PlayerRef>(null);
  useEffect(() => {
    const onResize = () => setSize(viewport());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const waiting = useSoundtrack(player, hold === null);
  return (
    <>
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
      <SoundHint show={waiting} />
    </>
  );
}

document.getElementById("fallback")?.remove();
createRoot(document.getElementById("root")!).render(<App />);
