import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Header from '@/components/Header';
import NotFoundCard from '@/components/NotFoundCard';

export const metadata: Metadata = { title: 'Siden findes ikke', robots: { index: false } };

export default async function NotFound() {
  const poll = (await headers()).get('x-not-found') === 'poll';
  return (
    <>
      <Header />
      <main className="container">
        <NotFoundCard heading={poll ? 'Hov, den afstemning kan vi ikke finde' : 'Hov, den side kan vi ikke finde'} />
      </main>
    </>
  );
}
