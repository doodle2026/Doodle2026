import { getTranslations } from 'next-intl/server';
import Header from '@/components/Header';
import NotFoundCard from '@/components/NotFoundCard';

export default async function PollNotFound() {
  const t = await getTranslations();
  return (
    <>
      <Header />
      <main className="container"><NotFoundCard heading={t('nf.h1')} /></main>
    </>
  );
}
