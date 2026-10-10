// Resync messages/*.json from Doodle UI's catalogs (i18n/{en,da,fr,de}.json), keeping our app-only namespace `app`.
// Usage: node scripts/i18n-sync.mjs [/workspace/doodle-ui/i18n]
import { readFileSync, writeFileSync } from 'node:fs';
const src = process.argv[2] || '/workspace/doodle-ui/i18n';
for (const l of ['en', 'da', 'fr', 'de']) {
  const up = JSON.parse(readFileSync(`${src}/${l}.json`, 'utf8'));
  const file = new URL(`../messages/${l}.json`, import.meta.url);
  let mine = {};
  try { mine = JSON.parse(readFileSync(file, 'utf8')); } catch { /* new */ }
  writeFileSync(file, JSON.stringify({ ...up, app: mine.app ?? {} }, null, 2) + '\n');
}
console.log('synced');
