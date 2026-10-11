import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/config';
import { pageSession } from '@/lib/owner/page';
import LoginForm from '../LoginForm';

export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: (await params).locale as Locale });
  return { title: t('owner.loginTitle'), robots: { index: false, follow: false } };
}

export default async function OwnerLogin({ params }: Props) {
  const { locale } = await params;
  if (await pageSession()) redirect(`/${locale}/owner`);
  return <main className="container"><LoginForm next={`/${locale}/owner`} /></main>;
}
