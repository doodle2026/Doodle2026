import type { Metadata } from 'next';
import { loadEvent } from '@/lib/events';
import Header from '@/components/Header';
import AdminView from './AdminView';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ id: string; locale: string }> };

// No canonical/OG/twitter tags on admin pages (design §18). Token lives in the URL fragment and is
// only ever sent to the API as `Authorization: Bearer` – the page itself is public-data only.
export const metadata: Metadata = { title: 'Administrér afstemning', robots: { index: false, follow: false } };

export default async function AdminPage({ params }: Props) {
  const { id, locale } = await params;
  const ev = await loadEvent(id); // existence already checked in middleware
  const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  return (
    <>
      <Header />
      <main className="container">
        {ev ? <AdminView slug={ev.slug} shareUrl={`${appUrl}/${locale}/p/${ev.slug}`} /> : null}
      </main>
    </>
  );
}
