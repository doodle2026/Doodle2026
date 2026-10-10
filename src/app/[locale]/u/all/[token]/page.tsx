import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/config';
import Header from '@/components/Header';
import MailLanding from '@/components/MailLanding';

export const dynamic = 'force-dynamic';
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale as Locale });
  return { title: t('unsub.allTitle'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (<><Header /><main className="container"><MailLanding kind="all" token={/^[A-Za-z0-9_-]{43}$/.test(token) ? token : 'invalid'} /></main></>);
}
