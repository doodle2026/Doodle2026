import type en from '../../messages/en.json';
import type { Locale } from './config';
// Type-safe message keys from the source locale (en.json).
declare module 'next-intl' {
  interface AppConfig { Locale: Locale; Messages: typeof en }
}
