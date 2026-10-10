'use client';
import { useTranslations } from 'next-intl';
import { useLp } from '@/i18n/link';
// javascript: URLs are blocked by our CSP, so "back" is a real button.
export default function BackLink() {
  const t = useTranslations();
  const lp = useLp();
  return (
    <button type="button" className="btn btn--ghost" onClick={() => (history.length > 1 ? history.back() : location.assign(lp('/')))}>
      {t('nf.back')}
    </button>
  );
}
