/** Server startup: report email misconfiguration once, without secrets, without crashing the app. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { emailConfig } = await import('./lib/email');
  for (const p of emailConfig().problems) console.error(`[email] config: ${p}`);
}
