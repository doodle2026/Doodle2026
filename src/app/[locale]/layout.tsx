import { BRAND } from '@/lib/brand';
import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import Html from '@/components/HtmlShell';
import { isLocale } from '@/i18n/config';
import { languageAlternates } from '@/i18n/seo';

export const viewport: Viewport = { themeColor: '#2B6CB0', colorScheme: 'light dark' };

export async function generateMetadata(): Promise<Metadata> {
  const path = (await headers()).get('x-path') || '/';
  return {
    metadataBase: new URL(process.env.APP_URL || 'http://localhost:3000'),
    title: { default: 'GrabAday', template: '%s – GrabAday' },
    alternates: { languages: languageAlternates(path) },
    icons: {
      icon: [{ url: BRAND.icons.svg, type: 'image/svg+xml' }, { url: BRAND.icons.png32, type: 'image/png', sizes: '32x32' }],
      apple: [{ url: BRAND.icons.appleTouch, sizes: '180x180' }],
    },
  };
}

export default async function LocaleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return <Html lang={locale} nonce={nonce}><NextIntlClientProvider locale={locale} messages={await getMessages()}>{children}</NextIntlClientProvider></Html>;
}
