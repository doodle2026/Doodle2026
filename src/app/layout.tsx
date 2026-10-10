import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { THEME_INIT_SCRIPT } from '@/components/ThemeToggle';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL || 'http://localhost:3000'),
  title: { default: 'Mødetid', template: '%s – Mødetid' },
};
export const viewport: Viewport = { themeColor: '#2B6CB0', colorScheme: 'light dark' };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="da" suppressHydrationWarning>
      <head>
        {/* Sets data-theme before first paint; allowed by the per-request CSP nonce. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* eslint-disable-next-line @next/next/no-css-tags -- design's plain global CSS file, kept restylable as-is */}
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body>{children}</body>
    </html>
  );
}
