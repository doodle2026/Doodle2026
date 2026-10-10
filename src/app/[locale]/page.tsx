import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/config';
import Header from '@/components/Header';
import CreateForm from './CreateForm';
import DeletedNotice from '@/components/DeletedNotice';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale as Locale });
  return { title: t('create.pageTitle') };
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
