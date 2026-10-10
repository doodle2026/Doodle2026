import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  // Tests build into a separate dir so they never clobber a running dev/prod server's .next.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  poweredByHeader: false,
  // Trailing-slash redirects are done in middleware so they carry our security headers (N1).
  skipTrailingSlashRedirect: true,
  reactStrictMode: true,
  // Render metadata blocking (not streamed) for every UA, so notFound() yields a real SSR 404 page
  // and link-preview tags are always in <head>.
  htmlLimitedBots: /.*/,
  // OG image route reads Inter font files at runtime; make sure they ship with the serverless function.
  outputFileTracingIncludes: {
    '/[locale]/p/[id]/opengraph-image': ['./node_modules/@fontsource/inter/files/inter-latin*-{400,700,800}-normal.woff', './public/brand/og-*.svg'],
  },
  // /api/* is outside the locale middleware; its security headers are set here instead.
  async headers() {
    const base = [
      { key: 'X-Content-Type-Options', value: 'nosniff' }, { key: 'Referrer-Policy', value: 'no-referrer' }, { key: 'X-Frame-Options', value: 'DENY' },
    ];
    const secret = [{ key: 'Cache-Control', value: 'no-store, private' }, { key: 'X-Robots-Tag', value: 'noindex, nofollow' }];
    return [
      { source: '/api/:path*', headers: base },
      { source: '/api/events/:id/:op(admin|close|reopen|rotate-admin|invitations|reminders|invite)', headers: secret },
      { source: '/api/events/:id/invitations/:rest*', headers: secret },
      { source: '/api/u/:rest*', headers: secret },
      { source: '/api/abuse/:rest*', headers: secret },
    ];
  },
};
export default withNextIntl(nextConfig);
