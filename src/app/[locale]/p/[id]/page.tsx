import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadEvent } from '@/lib/events';
import { pollDescription, truncateGraphemes } from '@/lib/meta';
import { OG_SIZE, ogImagePath, OG_LOCALE } from '@/lib/og';
import PollView from './PollView';
import { languageAlternates } from '@/i18n/seo';
import { getTranslations } from 'next-intl/server';
import { LOCALES, type Locale } from '@/i18n/config';


export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ id: string; locale: string }>; searchParams: Promise<{ created?: string; edit?: string }> };
const appUrl = () => (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');

// Design §14.3. React escapes every value; absolute URLs come from APP_URL, never the Host header.
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { id, locale: l } = await params;
  const locale = l as Locale;
  const t = await getTranslations({ locale });
  const ev = await loadEvent(id);
  if (!ev) return { title: t('nf.pageTitle'), robots: { index: false } };
  // Personal edit links (?edit=<token>, feature 3) get no OG/canonical tags (design §18).
  if ((await searchParams).edit !== undefined) return { title: ev.title, robots: { index: false, follow: false } };
  const url = `${appUrl()}/${locale}/p/${ev.slug}`;
  const description = pollDescription(ev.time_options.map((o) => o.date), locale, t);
  const image = { url: `${appUrl()}${ogImagePath(ev.slug, locale)}`, ...OG_SIZE, alt: t('app.ogAlt', { title: ev.title }), type: 'image/png' };
  const ogDescription = ev.description ? truncateGraphemes(ev.description, 160) : description;
  return {
    title: ev.title,
    description,
    alternates: { canonical: url, languages: languageAlternates(`/p/${ev.slug}`) },
    robots: { index: false, follow: false }, // polls are private-by-link
    openGraph: {
      type: 'website', siteName: 'grabAday', locale: OG_LOCALE[locale], alternateLocale: LOCALES.filter((x) => x !== locale).map((x) => OG_LOCALE[x]), title: ev.title, description: ogDescription, url,
      images: [image],
    },
    twitter: { card: 'summary_large_image', title: ev.title, description: ogDescription, images: [image] },
  };
}

export default async function PollPage({ params, searchParams }: Props) {
  const { id, locale } = await params;
  const ev = await loadEvent(id);
  if (!ev) notFound();
  const created = (await searchParams).created === '1';
  return <PollView event={ev} shareUrl={`${appUrl()}/${locale}/p/${ev.slug}`} justCreated={created} />;
}
