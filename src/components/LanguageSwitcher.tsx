'use client';
import { useLocale } from 'next-intl';
import { LOCALES, LOCALE_COOKIE, LOCALE_NAMES, swapLocale, type Locale } from '@/i18n/config';

/** Always visible; own-language names, no flags. Swaps only the locale segment, keeps path + query + #hash, sets the cookie. */
export function switchHref(loc: Location, to: Locale) {
  return swapLocale(loc.pathname, to) + loc.search + loc.hash;
}

export default function LanguageSwitcher() {
  const current = useLocale() as Locale;
  return (
    <label className="lang-switch">
      <span className="sr-only">Language</span>
      <select id="lang-switch" style={{ font: "inherit", padding: "4px 6px", borderRadius: 8, border: "1px solid var(--border, #ccc)", background: "transparent", color: "inherit" }} value={current} lang={current}
        onChange={(e) => {
          const to = e.target.value as Locale;
          document.cookie = `${LOCALE_COOKIE}=${to}; path=/; max-age=31536000; samesite=lax`;
          location.assign(switchHref(location, to));
        }}>
        {LOCALES.map((l) => <option key={l} value={l} lang={l}>{LOCALE_NAMES[l]}</option>)}
      </select>
    </label>
  );
}
