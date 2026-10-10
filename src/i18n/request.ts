import { getRequestConfig } from 'next-intl/server';
import { DEFAULT_LOCALE, isLocale } from './config';
import en from '../../messages/en.json';

type Msgs = Record<string, unknown>;
/** Deep merge: missing keys in a locale fall back to en at runtime (CI's i18n:check fails on missing keys). */
function merge(base: Msgs, over: Msgs): Msgs {
  const out: Msgs = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? merge(base[k] as Msgs, v as Msgs) : v;
  return out;
}
export async function loadMessages(locale: string): Promise<Msgs> {
  if (!isLocale(locale) || locale === DEFAULT_LOCALE) return en;
  return merge(en, (await import(`../../messages/${locale}.json`)).default);
}

/** Messages for the browser: everything except the mail strings (server-only). */
export async function clientMessages(locale: string): Promise<Msgs> {
  const { email: _mail, ...rest } = await loadMessages(locale); // eslint-disable-line @typescript-eslint/no-unused-vars
  return rest;
}

export default getRequestConfig(async ({ requestLocale, locale: explicit }) => {
  // explicit locale (getTranslations({locale})) → [locale] segment → middleware's x-locale (global not-found).
  const r = explicit ?? (await requestLocale) ?? (await (await import('next/headers')).headers()).get('x-locale');
  const locale = isLocale(r) ? r : DEFAULT_LOCALE;
  return { locale, messages: await loadMessages(locale), timeZone: 'UTC' };
});
