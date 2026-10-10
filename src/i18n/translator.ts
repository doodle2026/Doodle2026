import { IntlMessageFormat } from 'intl-messageformat';

// Framework-free translator over a catalog (used by pure lib helpers, server code such as mails/.ics/OG,
// and unit tests). Same ICU semantics as next-intl; tags are left as-is (plain-text consumers).
export type Vars = Record<string, string | number>;
export type Tr = (key: string, vars?: Vars) => string;
type Msgs = { [k: string]: string | Msgs };

export function makeT(locale: string, messages: Msgs, fallback?: Msgs): Tr {
  const cache = new Map<string, IntlMessageFormat>();
  const look = (m: Msgs | undefined, key: string) => key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Msgs)[k] : undefined), m);
  return (key, vars) => {
    let raw = look(messages, key);
    if (typeof raw !== 'string') raw = look(fallback, key);
    if (typeof raw !== 'string') { console.warn(`i18n: missing ${key}`); return key; }
    let f = cache.get(key);
    if (!f) cache.set(key, (f = new IntlMessageFormat(raw as string, locale, undefined, { ignoreTag: true })));
    return String(f.format(vars));
  };
}
