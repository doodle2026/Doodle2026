import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadEvent } from '@/lib/events';
import { pollDescription, truncateGraphemes } from '@/lib/meta';
import { OG_SIZE, ogImagePath } from '@/lib/og';
import PollView from './PollView';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; edit?: string }> };
const appUrl = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');

// Design §14.3. React escapes every value; absolute URLs come from APP_URL, never the Host header.
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const ev = await loadEvent((await params).id);
  if (!ev) return { title: 'Afstemningen findes ikke', robots: { index: false } };
  // Personal edit links (?edit=<token>, feature 3) get no OG/canonical tags (design §18).
  if ((await searchParams).edit !== undefined) return { title: ev.title, robots: { index: false, follow: false } };
  const url = `${appUrl()}/p/${ev.slug}`;
  const description = pollDescription(ev.time_options.length, ev.time_options.map((o) => o.start_at));
  const image = { url: `${appUrl()}${ogImagePath(ev.slug)}`, ...OG_SIZE, alt: `Mødetid-afstemning: ${ev.title}`, type: 'image/png' };
  const ogDescription = ev.description ? truncateGraphemes(ev.description, 160) : description;
  return {
    title: ev.title,
    description,
    alternates: { canonical: url },
    robots: { index: false, follow: false }, // polls are private-by-link
    openGraph: {
      type: 'website', siteName: 'Mødetid', locale: 'da_DK', title: ev.title, description: ogDescription, url,
      images: [image],
    },
    twitter: { card: 'summary_large_image', title: ev.title, description: ogDescription, images: [image] },
  };
}

export default async function PollPage({ params, searchParams }: Props) {
  const ev = await loadEvent((await params).id);
  if (!ev) notFound();
  const created = (await searchParams).created === '1';
  return <PollView event={ev} shareUrl={`${appUrl()}/p/${ev.slug}`} justCreated={created} />;
}
