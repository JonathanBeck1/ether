// Imperative DOM builders in the Stats.ts idiom: Object.assign(style),
// no innerHTML, no template strings, no XSS surface.

type Styles = Partial<CSSStyleDeclaration>;

interface ElOptions {
  class?: string;
  text?: string;
  style?: Styles;
  attrs?: Record<string, string>;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: ElOptions = {},
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.style) Object.assign(node.style, opts.style);
  if (opts.attrs) {
    for (const k in opts.attrs) node.setAttribute(k, opts.attrs[k]);
  }
  return node;
}
