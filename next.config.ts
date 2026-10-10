import type { NextConfig } from 'next';

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
    '/p/[id]/opengraph-image': ['./node_modules/@fontsource/inter/files/inter-latin*-{400,700,800}-normal.woff', './public/brand/og-*.svg'],
  },
};
export default nextConfig;
