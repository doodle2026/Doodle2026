import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isAdmin, loadEvent } from '@/lib/events';
import PollView from '../../PollView';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ id: string; token: string }> };

// Deliberately minimal metadata: no canonical/og:url, so the token never ends up in link previews.
export const metadata: Metadata = { title: 'Administrér afstemning', robots: { index: false, follow: false } };

export default async function AdminPage({ params }: Props) {
  const { id, token } = await params;
  if (!(await isAdmin(id, token))) notFound(); // middleware already rewrote invalid links to the 404 page
  const ev = await loadEvent(id);
  if (!ev) notFound();
  const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  return <PollView event={ev} shareUrl={`${appUrl}/p/${ev.slug}`} justCreated={false} isAdmin />;
}
