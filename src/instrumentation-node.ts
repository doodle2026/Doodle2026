import { emailConfig } from './lib/email';
for (const p of emailConfig().problems) console.error(`[email] config: ${p}`);
