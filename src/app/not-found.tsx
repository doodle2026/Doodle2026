import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { headers } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import Header from '@/components/Header';
import Html from '@/components/HtmlShell';
import NotFoundCard from '@/components/NotFoundCard';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/config';
import { clientMessages } from '@/i18n/request';

export async function generateMetadata(): Promise<Metadata> {
  const l = (await headers()).get('x-locale');
  const t = await getTranslations({ locale: isLocale(l) ? l : DEFAULT_LOCALE });
  return { title: t('app.nfPageTitle'), robots: { index: false } };
}

/** Global 404 (middleware rewrites unknown pages / missing polls here); renders its own <html> in the request locale. */
export default async function NotFound() {
  const h = await headers();
  const poll = h.get('x-not-found') === 'poll';
  const l = h.get('x-locale');
  const locale = isLocale(l) ? l : DEFAULT_LOCALE;
  const t = await getTranslations({ locale });
  return (
    <Html lang={locale} nonce={h.get('x-nonce') ?? undefined}>
      <NextIntlClientProvider locale={locale} messages={await clientMessages(locale)}>
        <Header />
        <main className="container">
          <NotFoundCard heading={poll ? t('nf.h1') : t('app.nfPage')} />
        </main>
      </NextIntlClientProvider>
    </Html>
  );
}
