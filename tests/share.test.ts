import { describe, test, expect, vi } from 'vitest';
import { adminMailto, canNativeShare, copyText, participantMailto, shareLink, shareText } from '../src/lib/share';

describe('copy button logic', () => {
  test('Clipboard API success → copied', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    expect(await copyText('https://x/p/a', { clipboard: { writeText } })).toBe('copied');
    expect(writeText).toHaveBeenCalledWith('https://x/p/a');
  });
  test('Clipboard denied → legacy execCommand fallback', async () => {
    const legacyCopy = vi.fn().mockReturnValue(true);
    expect(await copyText('u', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) }, legacyCopy })).toBe('copied');
    expect(legacyCopy).toHaveBeenCalled();
  });
  test('no clipboard and legacy fails/throws → error (UI shows manual-copy hint)', async () => {
    expect(await copyText('u', { legacyCopy: () => false })).toBe('error');
    expect(await copyText('u', { legacyCopy: () => { throw new Error('x'); } })).toBe('error');
    expect(await copyText('u', {})).toBe('error');
  });
});

describe('share button logic (Web Share API with fallback)', () => {
  const data = { title: 'T', text: shareText('T'), url: 'https://x/p/a' };
  test('only offered when navigator.share exists', () => {
    expect(canNativeShare({ share: () => Promise.resolve() })).toBe(true);
    expect(canNativeShare({})).toBe(false);
    expect(canNativeShare(undefined)).toBe(false);
  });
  test('shares title/text/url', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    expect(await shareLink(data, { share })).toBe('shared');
    expect(share).toHaveBeenCalledWith(data);
  });
  test('AbortError (user cancelled) is ignored; other errors and missing API fall back to copy', async () => {
    const abort = Object.assign(new Error('x'), { name: 'AbortError' });
    expect(await shareLink(data, { share: vi.fn().mockRejectedValue(abort) })).toBe('cancelled');
    const notAllowed = Object.assign(new Error('x'), { name: 'NotAllowedError' });
    expect(await shareLink(data, { share: vi.fn().mockRejectedValue(notAllowed) })).toBe('fallback');
    expect(await shareLink(data, {})).toBe('fallback');
  });
  test('mailto links are URL-encoded and have no recipient', () => {
    const m = participantMailto('Møde & "kage"?', 'https://x/p/a');
    expect(m.startsWith('mailto:?subject=')).toBe(true);
    expect(decodeURIComponent(m.split('subject=')[1].split('&body=')[0])).toBe('Hvornår kan du? Møde & "kage"?');
    expect(decodeURIComponent(m.split('&body=')[1])).toContain('https://x/p/a');
    const a = adminMailto('T', 'https://x/p/a/admin/TOKEN', 'https://x/p/a');
    expect(decodeURIComponent(a)).toContain('Mit admin-link: T');
    expect(decodeURIComponent(a)).toContain('Gem denne mail. Del ikke linket.');
  });
});
