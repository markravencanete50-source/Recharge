// Choosing which part of a photo shows in a round profile picture. The photo always covers the
// square frame (no empty edges); the person drags it to choose the part shown and zooms in or out.
// Positions are the photo's top-left corner inside the frame, in screen pixels.
export type CropView = { x: number; y: number; zoom: number };
export type Size = { width: number; height: number };
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

// The scale at zoom 1: the photo's shorter side just fills the frame.
export const coverScale = (image: Size, frame: number) => frame / Math.min(image.width, image.height);

const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));
export const clampZoom = (zoom: number) => clamp(Number.isFinite(zoom) ? zoom : MIN_ZOOM, MIN_ZOOM, MAX_ZOOM);

// Keeps the photo covering the frame: it can't be dragged so far that an edge shows.
export function clampView(view: CropView, image: Size, frame: number): CropView {
  const zoom = clampZoom(view.zoom), scale = coverScale(image, frame) * zoom;
  return { zoom, x: clamp(view.x, frame - image.width * scale, 0), y: clamp(view.y, frame - image.height * scale, 0) };
}

// The starting view: centred, not zoomed.
export function centredView(image: Size, frame: number): CropView {
  const scale = coverScale(image, frame);
  return { zoom: 1, x: (frame - image.width * scale) / 2, y: (frame - image.height * scale) / 2 };
}

export const moveView = (view: CropView, dx: number, dy: number, image: Size, frame: number) => clampView({ ...view, x: view.x + dx, y: view.y + dy }, image, frame);

// Zooming keeps the middle of the frame on the same spot of the photo.
export function zoomView(view: CropView, zoom: number, image: Size, frame: number): CropView {
  const before = coverScale(image, frame) * view.zoom, next = clampZoom(zoom), after = coverScale(image, frame) * next;
  const cx = (frame / 2 - view.x) / before, cy = (frame / 2 - view.y) / before;
  return clampView({ zoom: next, x: frame / 2 - cx * after, y: frame / 2 - cy * after }, image, frame);
}

// The square of the original photo (in its own pixels) that the frame shows.
export function cropRect(view: CropView, image: Size, frame: number) {
  const v = clampView(view, image, frame), scale = coverScale(image, frame) * v.zoom;
  const size = Math.min(frame / scale, image.width, image.height);
  return { sx: clamp(-v.x / scale, 0, image.width - size), sy: clamp(-v.y / scale, 0, image.height - size), size };
}
