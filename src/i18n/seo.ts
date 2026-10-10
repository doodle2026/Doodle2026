import { LOCALES, DEFAULT_LOCALE } from './config';
const appUrl = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
/** hreflang alternates for a locale-less path ("/" or "/p/x"), x-default → /en/…. Absolute (APP_URL). */
export function languageAlternates(path: string): Record<string, string> {
  const tail = path === '/' ? '' : path;
  const out: Record<string, string> = {};
  for (const l of LOCALES) out[l] = `${appUrl()}/${l}${tail}`;
  out['x-default'] = `${appUrl()}/${DEFAULT_LOCALE}${tail}`;
  return out;
}
