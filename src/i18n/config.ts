/** Locale config shared by middleware, server and client (pure, edge-safe). en = source + fallback. */
export const LOCALES = ['en', 'da', 'fr', 'de'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'en';
export const LOCALE_COOKIE = 'NEXT_LOCALE';
export const LOCALE_NAMES: Record<Locale, string> = { en: 'English', da: 'Dansk', fr: 'Français', de: 'Deutsch' };
/** BCP-47 tags for Intl (dates, plurals). */
export const INTL_TAG: Record<Locale, string> = { en: 'en-GB', da: 'da-DK', fr: 'fr-FR', de: 'de-DE' };

export const isLocale = (s: unknown): s is Locale => typeof s === 'string' && (LOCALES as readonly string[]).includes(s);

/** "/p/x" → "/da/p/x"; "/" → "/da". Leaves already-prefixed paths alone. */
export function localePath(locale: Locale, path: string): string {
  if (localeOf(path)) return path;
  const p = path.startsWith('/') ? path : `/${path}`;
  return p === '/' ? `/${locale}` : p.startsWith('/?') || p.startsWith('/#') ? `/${locale}${p.slice(1)}` : `/${locale}${p}`;
}
/** Locale segment of a path, or null. */
export function localeOf(path: string): Locale | null {
  const seg = path.split(/[/?#]/)[1];
  return isLocale(seg) ? seg : null;
}
/** Swap only the locale segment (path, query, hash untouched). */
export function swapLocale(path: string, to: Locale): string {
  const cur = localeOf(path);
  return cur ? `/${to}${path.slice(cur.length + 1)}` : localePath(to, path);
}

/** Accept-Language → best supported locale (q-values honoured; "da-DK" matches "da"), or null. */
export function fromAcceptLanguage(h: string | null | undefined): Locale | null {
  if (!h) return null;
  const items = h.split(',').map((part, i) => {
    const [tag, ...params] = part.trim().split(';');
    const q = params.map((p) => /^\s*q=([0-9.]+)\s*$/.exec(p)).find(Boolean);
    return { lang: tag.trim().toLowerCase().split('-')[0], q: q ? Number(q[1]) : 1, i };
  }).filter((x) => x.q > 0 && !Number.isNaN(x.q)).sort((a, b) => b.q - a.q || a.i - b.i);
  return items.map((x) => x.lang).find(isLocale) ?? null;
}
/** Redirect locale: cookie NEXT_LOCALE → Accept-Language → en. */
export const detectLocale = (cookie: string | null | undefined, acceptLanguage: string | null | undefined): Locale =>
  (isLocale(cookie) ? cookie : null) ?? fromAcceptLanguage(acceptLanguage) ?? DEFAULT_LOCALE;
