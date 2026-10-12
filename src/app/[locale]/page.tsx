import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';
import { OG_LOCALE } from '@/lib/og';
import Header from '@/components/Header';
import CreateForm from './CreateForm';
import DeletedNotice from '@/components/DeletedNotice';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const locale = (await params).locale as Locale;
  const t = await getTranslations({ locale });
  const title = `${t('create.pageTitle')} – grabAday`, description = t('app.homeDesc');
  // §50: per-language home image (absolute via metadataBase), fallback og-home.en.png for unknown locales
  const image = { url: `/og-home.${LOCALES.includes(locale) ? locale : 'en'}.png`, width: 1200, height: 630, alt: t('og.homeAlt'), type: 'image/png' };
  return {
    title: t('create.pageTitle'), description,
    openGraph: { type: 'website', siteName: 'grabAday', title, description, url: `/${locale}`, images: [image],
      locale: OG_LOCALE[locale], alternateLocale: LOCALES.filter((x) => x !== locale).map((x) => OG_LOCALE[x]) },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}
export const dynamic = 'force-dynamic'; // CSP nonce is per request

export default function Home() {
  return (
    <>
      <Header />
      <main className="container"><DeletedNotice /><CreateForm /></main>
    </>
  );
}
