'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

/** Start page confirmation after an organizer deleted a poll (/?deleted=1); the flag is stripped from the URL. */
export default function DeletedNotice() {
  const t = useTranslations('app');
  const [show, setShow] = useState(false);
  useEffect(() => {
    const u = new URL(location.href);
    if (u.searchParams.get('deleted') === '1') {
      setShow(true);
      u.searchParams.delete('deleted');
      history.replaceState(null, '', u.pathname + u.search + u.hash);
    }
  }, []);
  if (!show) return null;
  return (
    <div className="success" role="status" id="deleted-notice">
      <span aria-hidden="true">✓</span> {t('deleted')}
      <button type="button" className="link-btn" style={{ marginLeft: 'var(--s-2)' }} onClick={() => setShow(false)}>{t('close')}</button>
    </div>
  );
}
