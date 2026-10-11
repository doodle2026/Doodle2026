'use client';
import { useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/i18n/use';
import { LOCALES, LOCALE_NAMES } from '@/i18n/config';

import { qs, type F } from './qs';
const COLS: [string, string][] = [['title', 'owner.cTitle'], ['createdAt', 'owner.cCreated'], ['locale', 'owner.cLang'], ['status', 'owner.cStatus'], ['dateCount', 'owner.cDates'],
  ['participants', 'owner.cParts'], ['invitesSent', 'owner.cSent'], ['invitesRejected', 'owner.cRejected'], ['finalDate', 'owner.cFinal']];


/** Server-side filtering; this form only rewrites the URL (state lives in the URL, §47.4). */
export default function Filters({ base, f, dayTz }: { base: string; f: F; dayTz: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const deb = useRef<ReturnType<typeof setTimeout>>(undefined);
  const go = (patch: Partial<F>) => router.replace(base + qs({ ...f, ...patch, page: 1 }), { scroll: false });
  const opt = (v: string, l: string) => <option key={v} value={v}>{l}</option>;
  return (
    <form className="card ofilters" role="search" id="ff" aria-label={t('owner.evTitle')} onSubmit={(e) => e.preventDefault()}>
      <div className="field ofilters__q">
        <label className="field__label" htmlFor="f-q">{t('owner.search')}</label>
        <input className="input" id="f-q" type="search" defaultValue={f.q} placeholder={t('owner.searchPh')} autoComplete="off" aria-describedby="f-q-h"
          onChange={(e) => { const v = e.target.value; clearTimeout(deb.current); deb.current = setTimeout(() => go({ q: v }), 250); }} />
        <p className="field__hint" id="f-q-h">{t('owner.searchHint')}</p>
      </div>
      <div className="field"><label className="field__label" htmlFor="f-status">{t('owner.fStatus')}</label>
        <select className="input" id="f-status" value={f.status} onChange={(e) => go({ status: e.target.value })}>{opt('', t('owner.fAll'))}{opt('open', t('owner.st.open'))}{opt('closed', t('owner.st.closed'))}</select></div>
      <div className="field"><label className="field__label" htmlFor="f-lang">{t('owner.fLang')}</label>
        <select className="input" id="f-lang" value={f.pl} onChange={(e) => go({ pl: e.target.value })}>{opt('', t('owner.fAll'))}{LOCALES.map((l) => opt(l, LOCALE_NAMES[l]))}</select></div>
      <div className="field"><label className="field__label" htmlFor="f-period">{t('owner.fPeriod')}</label>
        <select className="input" id="f-period" value={f.period} onChange={(e) => go({ period: e.target.value })}>
          {opt('', t('owner.fAll'))}{opt('today', `${t('owner.pToday')} (${dayTz})`)}{opt('7', t('owner.p7'))}{opt('30', t('owner.p30'))}{opt('90', t('owner.p90'))}</select></div>
      <div className="field ofilters__sort"><label className="field__label" htmlFor="f-sort">{t('owner.sortBy')}</label>
        <select className="input" id="f-sort" value={`${f.sort}:${f.dir}`} onChange={(e) => { const [sort, dir] = e.target.value.split(':'); go({ sort, dir }); }}>
          {COLS.flatMap(([k, lk]) => [opt(`${k}:desc`, `${t(lk as 'owner.cTitle')} – ${t('owner.sortDesc')}`), opt(`${k}:asc`, `${t(lk as 'owner.cTitle')} – ${t('owner.sortAsc')}`)])}</select></div>
      <button type="button" className="link-btn" id="f-clear" onClick={() => { (document.getElementById('f-q') as HTMLInputElement).value = ''; router.replace(base + qs({ sort: f.sort, dir: f.dir }), { scroll: false }); document.getElementById('f-q')?.focus(); }}>{t('owner.clear')}</button>
    </form>
  );
}
