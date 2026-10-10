/**
 * Single place for logo assets (temporary logo D). To swap the logo: replace the files in
 * public/brand/ (same names). Nothing else references logo artwork.
 */
export const BRAND = {
  name: 'Mødetid',
  icons: {
    svg: '/brand/favicon.svg',
    png32: '/brand/favicon-32.png',
    appleTouch: '/brand/apple-touch-icon.png', // 180×180
    png512: '/brand/icon-512.png',
  },
  wordmark: { light: '/brand/wordmark.svg', dark: '/brand/wordmark-dark.svg' }, // not placed by the spec yet (header keeps "📅 Mødetid")
  /** OG image (og-template.html): logo mark + calendar background, read from disk by the OG route. */
  og: { mark: 'public/brand/og-mark.svg', background: 'public/brand/og-background.svg' },
} as const;
