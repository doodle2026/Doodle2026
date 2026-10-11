'use client';
import { useRouter } from 'next/navigation';
import { useI18n } from '@/i18n/use';

export default function TypeSelect({ base, type }: { base: string; type: string }) {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <form className="card ofilters ofilters--log" role="search" onSubmit={(e) => e.preventDefault()}>
      <div className="field"><label className="field__label" htmlFor="f-type">{t('owner.logType')}</label>
        <select className="input" id="f-type" value={type} onChange={(e) => router.replace(e.target.value ? `${base}?type=${e.target.value}` : base, { scroll: false })}>
          {['', 'login_ok', 'login_failed', 'locked', 'logout', 'view'].map((k) => <option key={k} value={k}>{t(`owner.lt.${k || 'all'}` as 'owner.lt.all')}</option>)}
        </select></div>
    </form>
  );
}
