import Link from 'next/link';
import BackLink from './BackLink';

// Port of doodle-ui/404.html (design §12).
export default function NotFoundCard({ heading }: { heading: string }) {
  return (
    <section className="card notfound" aria-labelledby="nf-h">
      <svg className="notfound__art" viewBox="0 0 160 140" aria-hidden="true">
        <rect x="20" y="24" width="120" height="104" rx="18" fill="#EEF2FF" />
        <rect x="20" y="24" width="120" height="30" rx="18" fill="#C7D2FE" />
        <rect x="46" y="12" width="10" height="26" rx="5" fill="#4F46E5" />
        <rect x="104" y="12" width="10" height="26" rx="5" fill="#4F46E5" />
        <circle cx="62" cy="82" r="6" fill="#4F46E5" />
        <circle cx="98" cy="82" r="6" fill="#4F46E5" />
        <path d="M64 108q16-12 32 0" stroke="#4F46E5" strokeWidth="5" fill="none" strokeLinecap="round" />
        <text x="132" y="40" fontSize="26" fontWeight="700" fill="#4F46E5">?</text>
      </svg>
      <h1 id="nf-h">{heading}</h1>
      <p className="lead">
        Linket er måske skrevet forkert, ufuldstændigt, eller afstemningen er blevet slettet. Bemærk at store og små
        bogstaver i linket har betydning.
      </p>
      <div className="notfound__actions">
        <Link className="btn btn--primary" href="/">Opret en ny afstemning</Link>
        <BackLink />
      </div>
    </section>
  );
}
