// A sheet's body, one entry per block: fragments (<>…</>, including `{cond && <>…</>}`) and arrays are
// opened up, recursively, so every real element is its own child of the sheet and gets the sheet's
// spacing. Empty slots (null, false, true, undefined, "") are dropped. Keys stay stable: the element's
// own key when it has one, otherwise its position, both prefixed by the fragments and arrays it sat in.
// Fragments are recognised by React's own symbol, so this works with whichever copy of React made them.
const FRAGMENT = Symbol.for("react.fragment");
type Element = { $$typeof: unknown; type: unknown; key: string | null; props: { children?: unknown } };
const isElement = (value: unknown): value is Element => typeof value === "object" && value !== null && "$$typeof" in value && "props" in value && "type" in value;

export function flattenSheetChildren(children: unknown, path = ""): { key: string; node: unknown }[] {
  if (children === null || children === undefined || typeof children === "boolean" || children === "") return [];
  const list = Array.isArray(children) ? children : [children];
  return list.flatMap((child, index) => {
    if (child === null || child === undefined || typeof child === "boolean" || child === "") return [];
    const own = isElement(child) && child.key != null ? "k" + child.key : "i" + index;
    const key = path ? `${path}.${own}` : own;
    if (Array.isArray(child)) return flattenSheetChildren(child, key);
    if (isElement(child) && child.type === FRAGMENT) return flattenSheetChildren(child.props.children, key);
    return [{ key, node: child }];
  });
}
