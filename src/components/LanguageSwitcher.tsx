'use client';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { usePathname } from 'next/navigation';
import { useLocale } from 'next-intl';
import { LOCALES, LOCALE_COOKIE, LOCALE_NAMES, swapLocale, type Locale } from '@/i18n/config';

const LABEL: Record<Locale, string> = { en: 'Language', da: 'Sprog', fr: 'Langue', de: 'Sprache' };

/** Href for `to`: only the locale segment changes; query + #hash are kept (hash is client-only, added on click). */
export function switchHref(loc: Pick<Location, 'pathname' | 'search' | 'hash'>, to: Locale) {
  return swapLocale(loc.pathname, to) + loc.search + loc.hash;
}

/**
 * Design §45.2: header button (globe + endonym, code < 640 px) opening a menu of real links (work without JS),
 * endonyms in fixed order, no flags, aria-current on the active one; Enter/Space/↓ open, ↑/↓/Home/End move,
 * Esc closes → focus back on the button; Tab out / outside click close. Choice stored in NEXT_LOCALE (1 year).
 */
export default function LanguageSwitcher() {
  const current = useLocale() as Locale;
  const pathname = usePathname() || `/${current}`;
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const items = () => [...(menu.current?.querySelectorAll<HTMLAnchorElement>('a') ?? [])];

  useEffect(() => {
    if (!open) return;
    (menu.current?.querySelector<HTMLAnchorElement>('[aria-current]') ?? items()[0])?.focus();
    const out = (e: MouseEvent) => { if (!btn.current?.parentElement?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', out);
    return () => document.removeEventListener('mousedown', out);
  }, [open]);

  const onMenuKey = (e: KeyboardEvent) => {
    const all = items(), i = all.indexOf(document.activeElement as HTMLAnchorElement);
    const go = (n: number) => { e.preventDefault(); all[(n + all.length) % all.length]?.focus(); };
    if (e.key === 'ArrowDown') go(i + 1); else if (e.key === 'ArrowUp') go(i - 1);
    else if (e.key === 'Home') go(0); else if (e.key === 'End') go(all.length - 1);
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); btn.current?.focus(); }
    else if (e.key === 'Tab') setOpen(false);
  };

  return (
    <div className="langsw">
      <button ref={btn} type="button" className="icon-btn langsw__btn" id="lang-btn" aria-expanded={open} aria-controls="lang-menu"
        aria-label={`${LABEL[current]}: ${LOCALE_NAMES[current]}`}
        onClick={() => setOpen(!open)} onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); } }}>
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M1.5 8h13M8 1.5c2 2 2 11 0 13M8 1.5c-2 2-2 11 0 13" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
        <span className="langsw__cur">{current.toUpperCase()}</span><span className="langsw__name">{LOCALE_NAMES[current]}</span>
        <span aria-hidden="true" className="langsw__caret">▾</span>
      </button>
      <ul ref={menu} className="langsw__menu" id="lang-menu" hidden={!open} aria-label={LABEL[current]} onKeyDown={onMenuKey}>
        {LOCALES.map((l) => (
          <li key={l}>
            <a href={swapLocale(pathname, l)} lang={l} hrefLang={l} aria-current={l === current ? 'true' : undefined} data-lang={l}
              onClick={(e) => {
                document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
                e.preventDefault();
                location.assign(switchHref(location, l));
              }}>
              <span className="langsw__check" aria-hidden="true">{l === current ? '✓' : ''}</span>{LOCALE_NAMES[l]}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
