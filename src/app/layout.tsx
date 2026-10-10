import { BRAND } from '@/lib/brand';
import type { Metadata, Viewport } from 'next';

// Pages live under app/[locale]/ (whose layout renders <html lang>). This root layout only passes through,
// but owns the shared metadata so the global not-found page gets icons too.
export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL || 'http://localhost:3000'),
  title: { default: 'GrabAday', template: '%s – GrabAday' },
  icons: {
    icon: [{ url: BRAND.icons.svg, type: 'image/svg+xml' }, { url: BRAND.icons.png32, type: 'image/png', sizes: '32x32' }],
    apple: [{ url: BRAND.icons.appleTouch, sizes: '180x180' }],
  },
};
export const viewport: Viewport = { themeColor: '#2B6CB0', colorScheme: 'light dark' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
