import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { Text } from "./Typography";
import { Button, Notice } from "./LiveKit";
import { ui } from "./theme";
import { centredView, clampView, cropRect, MAX_ZOOM, MIN_ZOOM, moveView, zoomView, type CropView, type Size } from "../../lib/photo-crop";
import type { PhotoCropperProps } from "./PhotoCropper";

// Choosing the part of a photo that shows in your round profile picture, on the web (phones use
// their own crop screen). Drag the photo (or use the arrow keys), zoom with the slider, the mouse
// wheel, a pinch or + and −, and the circle shows exactly what the team will see.
const FRAME = 260;
const OUTPUT = 512;

export function PhotoCropper({ p, source, busy, onCancel, onChooseAnother, onDone }: PhotoCropperProps) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [size, setSize] = useState<Size | null>(null);
  const [view, setView] = useState<CropView | null>(null);
  const [error, setError] = useState("");
  const stage = useRef<HTMLDivElement | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const state = useRef<{ view: CropView | null; size: Size | null }>({ view: null, size: null });
  useEffect(() => { state.current = { view, size }; }, [view, size]);

  useEffect(() => {
    let live = true;
    const img = new Image();
    img.onload = () => {
      if (!live) return;
      const s = { width: img.naturalWidth, height: img.naturalHeight };
      if (!s.width || !s.height) { setError("This photo couldn't be opened. Choose a JPG or PNG."); return; }
      setImage(img); setSize(s); setView(centredView(s, FRAME)); setError("");
    };
    img.onerror = () => { if (live) setError("This photo couldn't be opened here. Choose a JPG, PNG or WebP."); };
    img.src = source.uri;
    return () => { live = false; };
  }, [source.uri]);

  const update = (next: (v: CropView, s: Size) => CropView) => {
    const { view: v, size: s } = state.current;
    if (v && s) setView(next(v, s));
  };
  // The mouse wheel zooms the photo instead of scrolling the page (needs a non-passive listener).
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => { e.preventDefault(); update((v, s) => zoomView(v, v.zoom * Math.exp(-e.deltaY * 0.0015), s, FRAME)); };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [image]);

  const spread = () => { const [a, b] = [...pointers.current.values()]; return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0; };
  function down(e: React.PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2 && state.current.view) pinch.current = { distance: spread(), zoom: state.current.view.zoom };
  }
  function move(e: React.PointerEvent<HTMLDivElement>) {
    const last = pointers.current.get(e.pointerId);
    if (!last) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size >= 2 && pinch.current) {
      const start = pinch.current, now = spread();
      if (start.distance > 0) update((v, s) => zoomView(v, start.zoom * now / start.distance, s, FRAME));
    } else update((v, s) => moveView(v, e.clientX - last.x, e.clientY - last.y, s, FRAME));
  }
  function up(e: React.PointerEvent<HTMLDivElement>) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
  }
  function key(e: React.KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 30 : 10;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    if (moves[e.key]) { e.preventDefault(); update((v, s) => moveView(v, moves[e.key][0], moves[e.key][1], s, FRAME)); }
    else if (e.key === "+" || e.key === "=") { e.preventDefault(); update((v, s) => zoomView(v, v.zoom + 0.2, s, FRAME)); }
    else if (e.key === "-" || e.key === "_") { e.preventDefault(); update((v, s) => zoomView(v, v.zoom - 0.2, s, FRAME)); }
  }

  async function use() {
    if (!image || !size || !view || busy) return;
    const { sx, sy, size: side } = cropRect(view, size, FRAME);
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT; canvas.height = OUTPUT;
    const ctx = canvas.getContext("2d");
    if (!ctx) { setError("Your browser couldn't prepare the photo. Try another browser."); return; }
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, sx, sy, side, side, 0, 0, OUTPUT, OUTPUT);
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) { setError("Your browser couldn't prepare the photo. Try another browser."); return; }
    onDone(new File([blob], "profile.jpg", { type: "image/jpeg" }));
  }

  const scale = size && view ? (FRAME / Math.min(size.width, size.height)) * view.zoom : 1;
  return (
    <View style={{ gap: 12 }}>
      <View style={{ gap: 2 }}>
        <Text style={{ color: p.text, fontWeight: "800", fontSize: 15 }}>Choose what shows in your photo</Text>
        <Text style={[ui.small, { color: p.muted }]}>Drag the photo to move it and zoom to fit. The circle is what the team sees.</Text>
      </View>
      <View style={{ alignItems: "center" }}>
        <div ref={stage} role="img" tabIndex={0} aria-label="Photo position. Drag, or use the arrow keys to move and + or − to zoom."
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}
          style={{ position: "relative", width: FRAME, height: FRAME, overflow: "hidden", borderRadius: 18, background: "#101614", touchAction: "none", cursor: "grab", userSelect: "none", outlineColor: p.primary }}>
          {image && size && view && (
            // A local photo being positioned, never served by Next, so its image optimiser doesn't apply.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={source.uri} alt="" draggable={false}
              style={{ position: "absolute", left: view.x, top: view.y, width: size.width * scale, height: size.height * scale, maxWidth: "none", pointerEvents: "none" }} />
          )}
          <div style={{ position: "absolute", inset: 0, borderRadius: "50%", boxShadow: "0 0 0 999px rgba(16,22,20,0.6)", border: "2px solid rgba(255,255,255,0.9)", pointerEvents: "none" }} />
        </div>
      </View>
      <View style={[ui.row, { gap: 10, alignItems: "center" }]}>
        <Text style={[ui.small, { color: p.muted, fontWeight: "700" }]}>Zoom</Text>
        <input type="range" aria-label="Zoom" min={MIN_ZOOM} max={MAX_ZOOM} step={0.01} value={view?.zoom ?? 1} disabled={!view}
          onChange={e => { const z = Number(e.currentTarget.value); update((v, s) => zoomView(v, z, s, FRAME)); }}
          style={{ flex: 1, accentColor: p.primary }} />
        <Button label="Reset" icon="refresh-cw" p={p} disabled={!size} onPress={() => { if (size) setView(clampView(centredView(size, FRAME), size, FRAME)); }} />
      </View>
      {!!error && <Notice text={error} p={p} tone="bad" />}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        <Button label={busy ? "Uploading…" : "Use this photo"} icon="check" primary p={p} disabled={!view || busy} onPress={() => void use()} />
        <Button label="Choose another" icon="image" p={p} disabled={busy} onPress={onChooseAnother} />
        <Button label="Cancel" icon="x" p={p} disabled={busy} onPress={onCancel} />
      </View>
    </View>
  );
}
