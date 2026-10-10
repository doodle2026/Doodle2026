import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { NextIntlClientProvider } from 'next-intl';
import Header from '@/components/Header';
import Html from '@/components/HtmlShell';
import NotFoundCard from '@/components/NotFoundCard';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/config';
import { loadMessages } from '@/i18n/request';

export const metadata: Metadata = { title: 'Siden findes ikke', robots: { index: false } };

/** Global 404 (middleware rewrites unknown pages / missing polls here); renders its own <html> in the request locale. */
export default async function NotFound() {
  const h = await headers();
  const poll = h.get('x-not-found') === 'poll';
  const l = h.get('x-locale');
  const locale = isLocale(l) ? l : DEFAULT_LOCALE;
  return (
    <Html lang={locale} nonce={h.get('x-nonce') ?? undefined}>
      <NextIntlClientProvider locale={locale} messages={await loadMessages(locale)}>
        <Header />
        <main className="container">
          <NotFoundCard heading={poll ? 'Hov, den afstemning kan vi ikke finde' : 'Hov, den side kan vi ikke finde'} />
        </main>
      </NextIntlClientProvider>
    </Html>
  );
}
