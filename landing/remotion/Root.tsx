import { AbsoluteFill, Composition, continueRender, delayRender, Html5Audio, staticFile } from "remotion";
import { FPS, Intro } from "../src/Intro";

// Instagram versions of the landing animation, with its soundtrack.
// The layout is phone-sized and rendered at 2.5x (see scripts/render-instagram.mjs),
// so text stays readable on a phone. The soundtrack is cued to these exact frames.
export const SECONDS = 12;
export const FORMATS = {
  reel: { width: 432, height: 768 }, // 1080 x 1920 (9:16)
  feed: { width: 432, height: 540 }, // 1080 x 1350 (4:5)
} as const;

// Montserrat, bundled, so the render never depends on a network font.
const fontsReady = delayRender("Loading Montserrat");
Promise.all(([500, 600] as const).map(weight => new FontFace("Montserrat", `url(${staticFile(`fonts/montserrat-${weight}.ttf`)})`, { weight: String(weight) }).load()))
  .then(faces => { faces.forEach(face => document.fonts.add(face)); continueRender(fontsReady); })
  .catch(() => continueRender(fontsReady));

function WithSound() {
  return (
    <AbsoluteFill>
      <Intro />
      <Html5Audio src={staticFile("sound/recharge-intro.wav")} />
    </AbsoluteFill>
  );
}

export function Root() {
  return (
    <>
      {Object.entries(FORMATS).map(([id, size]) => (
        <Composition key={id} id={id} component={WithSound} fps={FPS} durationInFrames={FPS * SECONDS} {...size} />
      ))}
    </>
  );
}
