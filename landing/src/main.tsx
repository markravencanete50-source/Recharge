import { Player } from "@remotion/player";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { DURATION, FPS, INTRO_END, Intro } from "./Intro";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
// ?frame=120 holds a single frame, for checking the animation.
const pinned = Number(new URLSearchParams(window.location.search).get("frame") ?? NaN);
const hold = Number.isFinite(pinned) ? pinned : reduceMotion ? INTRO_END : null;
const viewport = () => ({ width: Math.round(window.innerWidth), height: Math.round(window.innerHeight) });

function App() {
  const [size, setSize] = useState(viewport);
  useEffect(() => {
    const onResize = () => setSize(viewport());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return (
    <Player
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
  );
}

document.getElementById("fallback")?.remove();
createRoot(document.getElementById("root")!).render(<App />);
