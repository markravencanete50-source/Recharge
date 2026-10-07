// The bed-and-bolt mark, redrawn as strokes in the logo's own pixel space
// (viewBox 0 0 354 346) so each line can be drawn on. Measured from the artwork.
export const MARK = { width: 354, height: 346, stroke: 12 } as const;

export const RING = { cx: 177, cy: 172.5, rx: 170.5, ry: 166.5 } as const;
export const HEAD = { cx: 119.5, cy: 158.5, r: 31.5 } as const;

export const PATHS = {
  headboard: "M58.5 36 V310",
  mattress: "M52.5 210 H302.5",
  blanket: "M169.5 216 V125 H269.5 A27 27 0 0 1 296.5 152 V302",
  bolt: "M252 129.5 L205 172.5 L244 172.5 L205 210",
} as const;

// Full logo artwork: 1818 x 346, mark at the left edge.
export const LOGO = { width: 1818, height: 346 } as const;
