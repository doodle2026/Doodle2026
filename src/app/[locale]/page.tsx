import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/config';
import Header from '@/components/Header';
import CreateForm from './CreateForm';
import DeletedNotice from '@/components/DeletedNotice';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale as Locale });
  const title = `${t('create.pageTitle')} – grabAday`, description = t('app.homeDesc');
  const image = { url: '/brand/og-image.png', width: 1200, height: 630, alt: 'grabAday' };
  return {
    title: t('create.pageTitle'), description,
    openGraph: { type: 'website', siteName: 'grabAday', title, description, url: `/${(await params).locale}`, images: [image] },
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
