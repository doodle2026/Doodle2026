/**
 * Single place for logo assets (temporary logo A "Stemmeboblen"). To swap the logo: replace the files in
 * public/brand/ (same names) and the OG mark paths below.
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
  /** OG-card mark (og-template.html), viewBox 0 0 512 512. */
  ogMark: {
    rect: { x: 16, y: 16, width: 480, height: 480, rx: 112, fill: '#2B6CB0' },
    bubble: 'M120 112h272a48 48 0 0 1 48 48v152a48 48 0 0 1-48 48H232l-84 72v-72h-28a48 48 0 0 1-48-48V160a48 48 0 0 1 48-48z',
    check: 'M168 236l60 60 120-124',
  },
} as const;
