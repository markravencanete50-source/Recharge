import { Player, type PlayerRef } from "@remotion/player";
import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { staticFile } from "remotion";
import { BONE, DURATION, FPS, GREEN, INTRO_END, Intro } from "./Intro";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// ?frame=120 holds a single frame, for checking the animation.
const pinned = Number(new URLSearchParams(window.location.search).get("frame") ?? NaN);
const hold = Number.isFinite(pinned) ? pinned : reduceMotion ? INTRO_END : null;
const viewport = () => ({ width: Math.round(window.innerWidth), height: Math.round(window.innerHeight) });

// The same soundtrack as the Instagram videos, cued to the same frames. Browsers
// only allow sound after a tap, so the button replays the intro from the start with it.
const soundtrack = typeof Audio === "undefined" ? null : new Audio(staticFile("sound/recharge-intro.mp3"));
if (soundtrack) soundtrack.preload = "auto";

function SoundButton({ on, onPress }: { on: boolean; onPress: () => void }) {
  return (
    <button type="button" onClick={onPress} aria-pressed={on} aria-label={on ? "Turn the sound off" : "Play the intro with sound"}
      style={{ position: "fixed", right: 20, bottom: 20, display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRadius: 999,
        border: `1px solid ${GREEN}33`, background: `${BONE}e6`, color: GREEN, font: "600 12px Montserrat, system-ui, sans-serif",
        letterSpacing: "0.12em", textTransform: "uppercase", cursor: "pointer", backdropFilter: "blur(6px)" }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={GREEN} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M11 5 6 9H2v6h4l5 4V5z" />
        {on ? <path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a10 10 0 0 1 0 14" /> : <path d="m22 9-6 6M16 9l6 6" />}
      </svg>
      {on ? "Sound on" : "Play with sound"}
    </button>
  );
}

function App() {
  const [size, setSize] = useState(viewport);
  const [sound, setSound] = useState(false);
  const player = useRef<PlayerRef>(null);
  useEffect(() => {
    const onResize = () => setSize(viewport());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  // Keep the soundtrack on the animation's clock: nudge it if it drifts by more than 80 ms.
  useEffect(() => {
    const p = player.current;
    if (!p || !soundtrack) return;
    const onFrame = ({ detail }: { detail: { frame: number } }) => {
      if (!sound || soundtrack.paused) return;
      const target = detail.frame / FPS;
      if (target >= soundtrack.duration) return;
      if (Math.abs(soundtrack.currentTime - target) > 0.08) soundtrack.currentTime = target;
    };
    p.addEventListener("frameupdate", onFrame);
    return () => p.removeEventListener("frameupdate", onFrame);
  }, [sound]);
  function toggleSound() {
    const p = player.current;
    if (!p || !soundtrack) return;
    if (sound) { soundtrack.pause(); setSound(false); return; }
    // Replay from the start so the sound lands on the motion it was written for.
    soundtrack.currentTime = 0;
    void soundtrack.play().catch(() => setSound(false));
    p.seekTo(0); p.play(); setSound(true);
  }
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
        initiallyMuted
        acknowledgeRemotionLicense
      />
      {hold === null && <SoundButton on={sound} onPress={toggleSound} />}
    </>
  );
}

document.getElementById("fallback")?.remove();
createRoot(document.getElementById("root")!).render(<App />);
