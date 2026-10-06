import type { CSSProperties, ImgHTMLAttributes } from "react";

// The legacy portal preview is built with plain Vite, where `next/image`
// resolves to a module object instead of a component and crashes React.
// Render the same unoptimised image the production portal requests.
type ImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string | { src: string };
  unoptimized?: boolean;
  priority?: boolean;
  fill?: boolean;
  style?: CSSProperties;
};

export default function Image({ src, unoptimized, priority, fill, style, alt = "", ...props }: ImageProps) {
  void unoptimized;
  return (
    <img
      {...props}
      alt={alt}
      src={typeof src === "string" ? src : src.src}
      loading={priority ? "eager" : props.loading}
      style={fill ? { position: "absolute", inset: 0, width: "100%", height: "100%", ...style } : style}
    />
  );
}
