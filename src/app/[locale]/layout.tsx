import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages, setRequestLocale } from 'next-intl/server';
import Html from '@/components/HtmlShell';
import { isLocale } from '@/i18n/config';
import { languageAlternates } from '@/i18n/seo';

export async function generateMetadata(): Promise<Metadata> {
  const path = (await headers()).get('x-path') || '/';
  return { alternates: { languages: languageAlternates(path) } };
}

export default async function LocaleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return <Html lang={locale} nonce={nonce}><NextIntlClientProvider locale={locale} messages={await getMessages()}>{children}</NextIntlClientProvider></Html>;
}
