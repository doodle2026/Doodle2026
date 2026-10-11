import { getTranslations } from 'next-intl/server';
import type { Locale } from '@/i18n/config';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type T = (key: any, values?: any) => string;
export const ST_ICON = { open: '●', closed: '✓', deleted: '⊘' } as const;
export function StatusBadge({ t, s }: { t: T; s: 'open' | 'closed' | 'deleted' }) {
  return <span className={`ost ost--${s}`}>{`${ST_ICON[s]} ${t(`owner.st.${s}`)}`}</span>;
}
export async function ErrorBox({ locale, href }: { locale: Locale; href: string }) {
  const t = await getTranslations({ locale });
  return <div className="owner-error" role="alert"><p>{`⚠ ${t('owner.loadError')}`}</p><a className="btn btn--secondary btn--sm" href={href}>{t('owner.retry')}</a></div>;
}
/** Pager per mockup: first, last, current ±1, "…" gaps. Links keep the URL state. */
export function Pager({ t, page, pages, href }: { t: T; page: number; pages: number; href: (p: number) => string }) {
  if (pages <= 1) return null;
  const pg: (number | '…')[] = [];
  for (let i = 1; i <= pages; i++) if (i === 1 || i === pages || Math.abs(i - page) <= 1) pg.push(i); else if (pg[pg.length - 1] !== '…') pg.push('…');
  const edge = (p: number, label: string, off: boolean) => off
    ? <span className="btn btn--secondary btn--sm" aria-disabled="true">{label}</span>
    : <a className="btn btn--secondary btn--sm" href={href(p)}>{label}</a>;
  return (
    <nav className="opager" aria-label={t('owner.pagesAria')}>
      {edge(page - 1, `← ${t('owner.prev')}`, page <= 1)}
      <ul>{pg.map((p, i) => p === '…' ? <li key={`g${i}`} aria-hidden="true">{'…'}</li>
        : <li key={p}><a className="opager__n" href={href(p)} aria-current={p === page ? 'page' : undefined} aria-label={t('owner.pageAria', { n: p })}>{p}</a></li>)}</ul>
      {edge(page + 1, `${t('owner.next')} →`, page >= pages)}
    </nav>
  );
}
