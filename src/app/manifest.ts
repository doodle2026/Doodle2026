import type { MetadataRoute } from 'next';
import { BRAND } from '@/lib/brand';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'grabAday', short_name: 'grabAday', start_url: '/', display: 'standalone',
    background_color: '#ffffff', theme_color: '#4F46E5',
    icons: [
      { src: BRAND.icons.svg, type: 'image/svg+xml', sizes: 'any' },
      { src: BRAND.icons.png32, type: 'image/png', sizes: '32x32' },
      { src: BRAND.icons.appleTouch, type: 'image/png', sizes: '180x180' },
      { src: '/brand/icon-512.png', type: 'image/png', sizes: '512x512', purpose: 'any' },
    ],
  };
}
