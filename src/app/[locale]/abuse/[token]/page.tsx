import type { Metadata } from 'next';
import Header from '@/components/Header';
import MailLanding from '@/components/MailLanding';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Rapportér misbrug', robots: { index: false, follow: false }, referrer: 'no-referrer' };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return (<><Header /><main className="container"><MailLanding kind="abuse" token={/^[A-Za-z0-9_-]{43}$/.test(token) ? token : 'invalid'} /></main></>);
}
