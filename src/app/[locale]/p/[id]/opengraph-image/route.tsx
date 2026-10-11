import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import { BRAND } from '@/lib/brand';
import { loadEvent } from '@/lib/events';
import { formatSpan } from '@/lib/dates';
import { OG_SIZE, ogTitle } from '@/lib/og';
import { getTranslations } from 'next-intl/server';
import { DEFAULT_LOCALE, isLocale } from '@/i18n/config';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Inter (OFL) from @fontsource; files are traced into the function via next.config outputFileTracingIncludes.
type Weight = 400 | 700 | 800;
let fontsPromise: Promise<{ name: string; data: Buffer; weight: Weight; style: 'normal' }[]> | null = null;
// Logo artwork lives only in public/brand (see src/lib/brand.ts); embedded as data URIs.
let artPromise: Promise<{ mark: string; background: string }> | null = null;
function brandArt() {
  const uri = async (p: string) => `data:image/svg+xml;base64,${(await readFile(join(process.cwd(), p))).toString('base64')}`;
  artPromise ??= Promise.all([uri(BRAND.og.mark), uri(BRAND.og.background)]).then(([mark, background]) => ({ mark, background }));
  return artPromise;
}

function fonts() {
  fontsPromise ??= Promise.all(
    (['latin', 'latin-ext'] as const).flatMap((sub) => ([400, 700, 800] as const).map(async (weight) => ({
      name: 'Inter', weight, style: 'normal' as const,
      data: await readFile(join(process.cwd(), 'node_modules/@fontsource/inter/files', `inter-${sub}-${weight}-normal.woff`)),
    }))),
  );
  return fontsPromise;
}

const CACHE = 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800';

/** OG image 1200×630 (design §14.4, port of doodle-ui/og-template.html). Public data only – never tokens. */
/** Texts ("5 date proposals", range, "Vote now →") in the URL's locale (§45.3); the title is never translated. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; locale: string }> }) {
  const { id, locale: l } = await params;
  const locale = isLocale(l) ? l : DEFAULT_LOCALE;
  const t = await getTranslations({ locale });
  const ev = await loadEvent(id);
  if (!ev) return new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

  const art = await brandArt();
  const title = ogTitle(ev.title);
  const count = t('og.count', { n: ev.time_options.length });
  const dates = formatSpan(ev.time_options.map((o) => o.date), locale);
  const el = (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative',
      backgroundImage: 'linear-gradient(135deg, #2B6CB0 0%, #63B3ED 100%)', fontFamily: 'Inter' }}>
      <img src={art.background} width={1200} height={630} alt="" style={{ position: 'absolute', left: 0, top: 0 }} />
      <div style={{ width: 1000, height: 470, marginTop: 40, background: '#fff', borderRadius: 32, padding: '56px 64px', display: 'flex', flexDirection: 'column',
        boxShadow: '0 20px 60px rgba(14,40,70,.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 34, fontWeight: 700, color: '#2B6CB0' }}>
          {/* Temporary logo (favicon mark) */}
          <img src={art.mark} width={64} height={64} alt="" />
          {/* wordmark colours per Doodle UI: "grab" dark + "Aday" blue */}
          <span style={{ display: 'flex' }}><span style={{ color: '#1A2B3C' }}>grab</span><span>Aday</span></span>
        </div>
        <div style={{ marginTop: 36, fontSize: title.long ? 56 : 68, lineHeight: 1.12, fontWeight: 800, color: '#1A2B3C',
          letterSpacing: '-0.01em', display: 'block', lineClamp: 2, overflow: 'hidden', wordBreak: 'break-word' }}>
          {title.text}
        </div>
        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 20 }}>
          <span style={{ background: '#EBF4FC', color: '#1F5690', fontSize: 30, fontWeight: 700, padding: '14px 28px', borderRadius: 999 }}>{count}</span>
          <span style={{ fontSize: 28, color: '#5A6B7D', maxWidth: 520, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{dates}</span>
          <span style={{ marginLeft: 'auto', fontSize: 28, fontWeight: 700, color: '#2B6CB0' }}>{t('og.cta')}</span>
        </div>
      </div>
    </div>
  );

  const f = await fonts();
  // Render fully before responding so emoji-asset failures can fall back (ImageResponse streams lazily).
  let png: ArrayBuffer;
  try {
    png = await new ImageResponse(el, { ...OG_SIZE, fonts: f, emoji: 'twemoji' }).arrayBuffer();
    if (png.byteLength === 0) throw new Error('empty');
  } catch {
    png = await new ImageResponse(el, { ...OG_SIZE, fonts: f }).arrayBuffer();
  }
  return new Response(png, { headers: { 'Content-Type': 'image/png', 'Cache-Control': CACHE, 'Content-Length': String(png.byteLength) } });
}
