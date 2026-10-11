import type { Palette } from "./theme";

// Phones crop with their own square crop screen when the photo is picked (allowsEditing), so this
// is only used on the web (PhotoCropper.web.tsx).
export type PhotoCropperProps = {
  p: Palette; source: { uri: string; name: string }; busy: boolean;
  onCancel: () => void; onChooseAnother: () => void; onDone: (file: File) => void;
};
export function PhotoCropper(props: PhotoCropperProps) { void props; return null; }
