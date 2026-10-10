'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

// Port of doodle-ui/theme.js: Auto → Lys → Mørk, stored in localStorage['mt-theme'].
type Theme = 'auto' | 'light' | 'dark';
const ICON: Record<Theme, string> = { auto: '◐', light: '☀', dark: '☾' };
const NEXT: Record<Theme, Theme> = { auto: 'light', light: 'dark', dark: 'auto' };
const KEY = 'mt-theme';

export function applyTheme(t: Theme) {
  const r = document.documentElement;
  if (t === 'auto') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', t);
}

export default function ThemeToggle() {
  const t = useTranslations('theme');
  const [theme, setTheme] = useState<Theme>('auto');
  useEffect(() => {
    const cur = document.documentElement.getAttribute('data-theme');
    setTheme(cur === 'light' || cur === 'dark' ? cur : 'auto');
  }, []);
  return (
    <button type="button" className="icon-btn" id="theme-toggle"
      aria-label={t('aria', { name: t(theme) })}
      onClick={() => {
        const n = NEXT[theme];
        try { localStorage.setItem(KEY, n); } catch { /* private mode */ }
        applyTheme(n); setTheme(n);
      }}>
      {`${ICON[theme]} ${t(theme)}`}
    </button>
  );
}

/** Runs inline in <head> before first paint (no flash). Supports ?theme=dark|light like the mockups. */
export const THEME_INIT_SCRIPT =
  "(function(){try{var q=new URLSearchParams(location.search).get('theme'),t=q||localStorage.getItem('mt-theme');" +
  "if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}})();";
