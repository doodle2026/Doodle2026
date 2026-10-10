import { THEME_INIT_SCRIPT } from './ThemeToggle';

/** Shared document shell (also used by the global not-found page). */
export default function Html({ lang, nonce, children }: { lang: string; nonce?: string; children: React.ReactNode }) {
  return (
    <html lang={lang} suppressHydrationWarning>
      <head>
        {/* Sets data-theme before first paint; allowed by the per-request CSP nonce. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* eslint-disable-next-line @next/next/no-css-tags -- design's plain global CSS file, kept restylable as-is */}
        <link rel="stylesheet" href="/styles.css" />
        {/* eslint-disable-next-line @next/next/no-css-tags -- small app-only additions (see file header) */}
        <link rel="stylesheet" href="/app.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
