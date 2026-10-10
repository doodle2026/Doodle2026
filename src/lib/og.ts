import { textLength } from './validate';

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_TITLE_MAX = 90; // graphemes (design §14.4)
export const OG_LONG_AT = 40;   // > 40 graphemes → 56 px instead of 68 px

const graphemes = (s: string) => [...new Intl.Segmenter('da', { granularity: 'grapheme' }).segment(s)].map((x) => x.segment);

/**
 * Title for the image: trimmed, control chars removed, max 90 graphemes; longer titles are cut at a
 * word boundary + "…", never inside a grapheme (emoji/ZWJ). Rendering is text-only (no HTML), so
 * markup in titles is drawn literally.
 */
export function ogTitle(raw: string): { text: string; long: boolean } {
  const t = raw.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  const g = graphemes(t);
  let text = t;
  if (g.length > OG_TITLE_MAX) {
    const cut = g.slice(0, OG_TITLE_MAX - 1).join('');
    const atWord = cut.replace(/\s+\S*$/, '');
    text = (atWord.length >= cut.length * 0.6 ? atWord : cut).trimEnd() + '…';
  }
  return { text, long: textLength(text) > OG_LONG_AT };
}

export const countLabel = (n: number) => `${n} datoforslag`;
export const ogImagePath = (slug: string) => `/p/${slug}/opengraph-image`;
