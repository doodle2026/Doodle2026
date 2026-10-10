/** Server startup: report email misconfiguration once, without secrets, without crashing the app. */
export async function register() {
  // Inline condition so the edge bundle drops the import (email code uses node fs in capture mode).
  if (process.env.NEXT_RUNTIME === 'nodejs') await import('./instrumentation-node');
}
