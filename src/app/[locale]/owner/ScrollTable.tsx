'use client';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/i18n/use';

/** L3: wide owner tables (iPad: 900 px table, sticky first column) get a visible "scroll sideways" hint and a focusable,
 *  labelled scroll region while they actually overflow. The hint hides once scrolled to the end. */
export default function ScrollTable({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [over, setOver] = useState(false), [atEnd, setAtEnd] = useState(false);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const upd = () => { setOver(el.scrollWidth > el.clientWidth + 1); setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 2); };
    upd();
    const ro = new ResizeObserver(upd); ro.observe(el);
    el.addEventListener('scroll', upd, { passive: true });
    return () => { ro.disconnect(); el.removeEventListener('scroll', upd); };
  }, []);
  return (
    <>
      {over && <p className="meta oscroll-hint" id="o-scroll-hint" aria-hidden={atEnd || undefined} style={atEnd ? { visibility: 'hidden' } : undefined}>{t('app.ownerScrollHint')}</p>}
      <div ref={ref} className="card ocard-table" {...(over ? { tabIndex: 0, role: 'region', 'aria-label': t('app.ownerTableAria') } : {})}>{children}</div>
    </>
  );
}
