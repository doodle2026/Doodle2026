import Header from '@/components/Header';
import NotFoundCard from '@/components/NotFoundCard';

export default function PollNotFound() {
  return (
    <>
      <Header />
      <main className="container"><NotFoundCard heading="Hov, den afstemning kan vi ikke finde" /></main>
    </>
  );
}
