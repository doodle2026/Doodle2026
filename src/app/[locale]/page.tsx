import type { Metadata } from 'next';
import Header from '@/components/Header';
import CreateForm from './CreateForm';
import DeletedNotice from '@/components/DeletedNotice';

export const metadata: Metadata = { title: 'Opret afstemning' };
export const dynamic = 'force-dynamic'; // CSP nonce is per request

export default function Home() {
  return (
    <>
      <Header />
      <main className="container"><DeletedNotice /><CreateForm /></main>
    </>
  );
}
