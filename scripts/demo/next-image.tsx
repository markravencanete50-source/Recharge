// next/image for the harness: a plain image.
export default function Image({ src, alt, style, className }: { src: string; alt: string; style?: object; className?: string; width?: number; height?: number; unoptimized?: boolean }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} style={style} className={className} />;
}
