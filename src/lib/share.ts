// Sharing helpers (design §14.2 / §19). Pure + injectable so they can be unit-tested without a browser.

export type CopyResult = 'copied' | 'error';

export interface ClipboardEnv {
  clipboard?: { writeText(text: string): Promise<void> };
  /** Legacy fallback: select the input and run document.execCommand('copy'). */
  legacyCopy?: () => boolean;
}

/** Clipboard API first; if missing/denied, legacy execCommand on the selected field; else 'error'. */
export async function copyText(text: string, env: ClipboardEnv): Promise<CopyResult> {
  try {
    if (!env.clipboard) throw new Error('no clipboard');
    await env.clipboard.writeText(text);
    return 'copied';
  } catch {
    try { if (env.legacyCopy?.()) return 'copied'; } catch { /* fall through */ }
    return 'error';
  }
}

export type ShareResult = 'shared' | 'cancelled' | 'fallback';

/**
 * Web Share API. AbortError (user cancelled) is ignored; any other failure – or no API at all – returns
 * 'fallback' so the caller copies the link instead.
 */
export async function shareLink(
  data: { title: string; text: string; url: string },
  nav: { share?: (d: { title: string; text: string; url: string }) => Promise<void> },
): Promise<ShareResult> {
  if (typeof nav.share !== 'function') return 'fallback';
  try { await nav.share(data); return 'shared'; }
  catch (e) { return (e as { name?: string })?.name === 'AbortError' ? 'cancelled' : 'fallback'; }
}

export const canNativeShare = (nav: unknown) => typeof (nav as { share?: unknown })?.share === 'function';

export const shareText = (title: string) => `Hvornår kan du? ${title}`;

export function participantMailto(title: string, url: string): string {
  return `mailto:?subject=${encodeURIComponent(shareText(title))}&body=${encodeURIComponent(
    `Hej!\n\nVælg de datoer, der passer dig:\n${url}\n`)}`;
}

/** "Send til mig selv": both links, no recipient (design §19). */
export function adminMailto(title: string, adminUrl: string, url: string): string {
  return `mailto:?subject=${encodeURIComponent(`Mit admin-link: ${title}`)}&body=${encodeURIComponent(
    `Admin-link (hemmeligt):\n${adminUrl}\n\nLink til deltagerne:\n${url}\n\nGem denne mail. Del ikke linket.\n`)}`;
}
