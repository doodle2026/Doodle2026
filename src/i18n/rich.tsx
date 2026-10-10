import { Fragment, createElement, type ReactNode } from 'react';
import { IntlMessageFormat } from 'intl-messageformat';

// Catalog messages may contain a little HTML (<strong>, <em>, <code>, <br>, <ul>/<li>, <a href>, <span class>;
// design §45.6). We format the ICU message with tags ignored (variables HTML-escaped first), then turn the
// result into React elements with a tiny whitelist parser – never innerHTML, unknown tags become text.
export type Vars = Record<string, string | number>;
const esc = (v: string | number) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const ALLOWED = new Set(['strong', 'em', 'code', 'br', 'ul', 'li', 'a', 'span']);

export function formatHtml(raw: string, locale: string, vars: Vars = {}): string {
  const safe = Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, typeof v === 'number' ? v : esc(v)]));
  return String(new IntlMessageFormat(raw, locale, undefined, { ignoreTag: true }).format(safe));
}

type Node = { tag: string; attrs: Record<string, string>; kids: (Node | string)[] };
export function htmlToReact(html: string, links?: (href: string) => string): ReactNode {
  const root: Node = { tag: '', attrs: {}, kids: [] };
  const stack = [root];
  const re = /<(\/?)([a-z]+)((?:\s+[a-z-]+="[^"]*")*)\s*\/?>/gi;
  let last = 0, m: RegExpExecArray | null;
  const text = (s: string) => { if (s) stack[stack.length - 1].kids.push(unesc(s)); };
  while ((m = re.exec(html))) {
    text(html.slice(last, m.index));
    last = re.lastIndex;
    const [, close, tagRaw, attrStr] = m, tag = tagRaw.toLowerCase();
    if (!ALLOWED.has(tag)) { text(m[0]); continue; }
    if (close) { if (stack.length > 1 && stack[stack.length - 1].tag === tag) stack.pop(); continue; }
    const attrs: Record<string, string> = {};
    for (const a of attrStr.matchAll(/([a-z-]+)="([^"]*)"/gi)) attrs[a[1].toLowerCase()] = unesc(a[2]);
    const n: Node = { tag, attrs, kids: [] };
    stack[stack.length - 1].kids.push(n);
    if (tag !== 'br') stack.push(n);
  }
  text(html.slice(last));
  const out = (n: Node | string, i: number): ReactNode => {
    if (typeof n === 'string') return n;
    const props: Record<string, unknown> = { key: i };
    if (n.tag === 'a') {
      const h = n.attrs.href ?? '';
      if (/^(\/|#|https?:\/\/)/.test(h)) props.href = links ? links(h) : h;
    }
    if (n.tag === 'span' && n.attrs.class) props.className = n.attrs.class;
    return createElement(n.tag, props, ...(n.tag === 'br' ? [] : n.kids.map(out)));
  };
  return createElement(Fragment, null, ...root.kids.map(out));
}
